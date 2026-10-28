/** Offline continuous double auction: no matching timer, rounds, or global tick. */
import { Book, draw, policy, type Account } from "./timing-model";
export type Trigger = "timer10" | "timer5" | "targeted" | "market" | "serial";
export type News = { at: number; asset: number; price: number };
export type ContinuousOptions = {
  trigger: Trigger;
  durationMs?: number;
  baseLatencyMs?: number;
  heterogeneous?: boolean;
  ttlMs?: number;
  makerLatencyMs?: number;
  cooldownMs?: number;
  cancelOnNews?: boolean;
  population?: number;
  trace?: boolean;
};
type Event = {
  at: number;
  seq: number;
  kind: "news" | "wake" | "response" | "notice" | "maker" | "expiry";
  agent?: number;
  news?: News;
  token?: number;
  newsNotice?: boolean;
  intents?: ReturnType<typeof policy>[];
};
export class EventQueue {
  heap: Event[] = [];
  seq = 0;
  push(event: Omit<Event, "seq">) {
    const e = { ...event, seq: this.seq++ };
    let i = this.heap.push(e) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(e, this.heap[p])) break;
      this.heap[i] = this.heap[p];
      i = p;
    }
    this.heap[i] = e;
  }
  less(a: Event, b: Event) {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }
  pop() {
    const top = this.heap[0],
      last = this.heap.pop()!;
    if (this.heap.length) {
      let i = 0;
      while (i * 2 + 1 < this.heap.length) {
        let j = i * 2 + 1;
        if (
          j + 1 < this.heap.length &&
          this.less(this.heap[j + 1], this.heap[j])
        )
          j++;
        if (!this.less(this.heap[j], last)) break;
        this.heap[i] = this.heap[j];
        i = j;
      }
      this.heap[i] = last;
    }
    return top;
  }
}
export function newsTape(seed: string, duration = 300000): News[] {
  const result: News[] = [];
  for (let asset = 0; asset < 2; asset++) {
    let at = 0,
      price = 10000,
      index = 0;
    while (true) {
      const key = `${seed}:news:${asset}:${index++}`;
      at += Math.max(
        1,
        Math.round((-Math.log(1 - draw(`${key}:wait`)) / 0.035) * 1000),
      );
      if (at >= duration) break;
      const magnitude = 300 + Math.floor(draw(`${key}:size`) * 901),
        sign = draw(`${key}:sign`) < 0.5 ? -1 : 1;
      price = Math.max(
        2500,
        Math.min(17500, Math.round(price * (1 + (sign * magnitude) / 10000))),
      );
      result.push({ at, asset, price });
    }
  }
  return result.sort((a, b) => a.at - b.at || a.asset - b.asset);
}
export function runContinuous(
  seed: string,
  tape: News[],
  options: ContinuousOptions,
) {
  const duration = options.durationMs ?? 300000,
    n = options.population ?? 20,
    maker = n,
    queue = new EventQueue();
  const makerCash = Math.round((n * 1000000 * 0.2) / 0.8),
    makerStock = Math.floor((n * 100 * 0.2) / 0.8);
  const accounts: Account[] = Array.from({ length: n }, () => ({
    cash: 1000000,
    stocks: [100, 100],
  }));
  accounts.push({ cash: makerCash, stocks: [makerStock, makerStock] });
  const book = new Book(accounts, "resting");
  book.auction = () => {
    throw new Error("No batch matching is allowed in continuous-v2");
  };
  const totalCash = n * 1000000 + makerCash,
    totalStocks = [n * 100 + makerStock, n * 100 + makerStock];
  const fundamental = [10000, 10000],
    previous = [10000, 10000],
    last = [10000, 10000];
  const busy = Array(n).fill(false),
    dirty = Array(n).fill(false),
    noticeAt: (number | null)[] = Array(n).fill(null),
    noticeNews = Array(n).fill(false),
    noticeCount = Array(n).fill(0),
    wakeAt: (number | null)[] = Array(n).fill(null),
    lastCall = Array(n).fill(-Infinity),
    calls = Array(n).fill(0);
  const fast = Array.from(
    { length: n },
    (_, i) =>
      (Math.floor(i / 5) + (draw(`${seed}:group:${i % 5}`) < 0.5 ? 0 : 1)) %
        2 ===
      0,
  );
  const isEvent =
    options.trigger === "targeted" || options.trigger === "market";
  let makerPending = false,
    makerUpdates = 0,
    processed = 0,
    arrived = 0,
    skipped = 0,
    measured = 0,
    volume = 0,
    notional = 0,
    makerVolume = 0,
    wait = 0,
    integratedAt = 0,
    gapArea = 0,
    lateOrders = 0,
    newsCount = 0;
  const trace: object[] = [];
  const integrate = (at: number) => {
    for (let j = 0; j < 2; j++)
      gapArea +=
        (((at - integratedAt) * Math.abs(last[j] - fundamental[j])) /
          fundamental[j]) *
        100;
    integratedAt = at;
  };
  const fingerprint = () =>
    [0, 1].map((j) =>
      ["BUY", "SELL"].map((side) => {
        const levels = new Map<number, number>();
        for (const o of book.orders)
          if (o.asset === j && o.side === side && o.remaining > 0)
            levels.set(o.price, (levels.get(o.price) ?? 0) + o.remaining);
        return [...levels]
          .sort((a, b) => (side === "BUY" ? b[0] - a[0] : a[0] - b[0]))
          .slice(0, 5);
      }),
    );
  const requestWake = (i: number, at: number) => {
    if (busy[i]) {
      dirty[i] = true;
      return;
    }
    at = Math.max(at, lastCall[i] + (options.cooldownMs ?? 0));
    if (wakeAt[i] !== null && wakeAt[i]! <= at) return;
    wakeAt[i] = at;
    queue.push({ kind: "wake", at, agent: i, token: at });
  };
  const notify = (i: number, at: number, isNews = false) => {
    if (!isEvent) return;
    if (isNews) noticeNews[i] = true;
    if (!isNews && dirty[i] && busy[i]) return;
    if (noticeAt[i] !== null) return;
    const delay =
      20 + Math.floor(draw(`${seed}:notice:${i}:${noticeCount[i]++}`) * 81);
    noticeAt[i] = at + delay;
    queue.push({ kind: "notice", at: at + delay, agent: i });
  };
  const requote = (at: number) => {
    if (makerPending) return;
    makerPending = true;
    const base = options.makerLatencyMs ?? 100,
      delay = Math.round(
        base * (1 + draw(`${seed}:maker:${makerUpdates}`) * 0.25),
      );
    queue.push({ kind: "maker", at: at + delay });
  };
  const afterMutation = (at: number, before: string, source: number) => {
    const own = new Set<number>();
    for (const f of book.fills.slice(measured)) {
      if (f.at !== at) throw new Error("Artificial matching scheduling delay");
      last[f.asset] = f.price;
      volume += f.quantity;
      notional += f.price * f.quantity;
      wait += (f.quantity * (at - f.buyAt + (at - f.sellAt))) / 2;
      own.add(f.buyer);
      own.add(f.seller);
      if (f.buyer === maker || f.seller === maker) {
        makerVolume += f.quantity;
        requote(at);
      }
      if (options.trace) trace.push({ kind: "fill", ...f });
    }
    const traded = book.fills.length > measured;
    measured = book.fills.length;
    for (const i of own) if (i < n) notify(i, at);
    if (
      options.trigger === "market" &&
      (traded || before !== JSON.stringify(fingerprint()))
    )
      for (let i = 0; i < n; i++) if (traded || i !== source) notify(i, at);
  };
  const place = (
    agent: number,
    j: number,
    side: "BUY" | "SELL",
    price: number,
    quantity: number,
    at: number,
  ) => {
    const expires = options.ttlMs
      ? at + options.ttlMs
      : Number.MAX_SAFE_INTEGER;
    const order = book.place(
      agent,
      j,
      side,
      price,
      quantity,
      at,
      expires,
      true,
    );
    if (order && order.remaining > 0 && options.ttlMs)
      queue.push({ kind: "expiry", at: expires });
  };
  for (const news of tape) queue.push({ kind: "news", at: news.at, news });
  requote(0);
  for (let i = 0; i < n; i++) {
    const period =
      options.trigger === "timer10"
        ? 10000
        : options.trigger === "timer5"
          ? 5000
          : 0;
    const at = Math.floor(draw(`${seed}:phase:${i}`) * (period || 250));
    if (period) queue.push({ kind: "wake", at, agent: i });
    else requestWake(i, at);
  }
  while (queue.heap.length && queue.heap[0].at < duration) {
    if (++processed > 2000000)
      throw new Error("event runaway; experiment must stop and be repaired");
    const e = queue.pop(),
      at = e.at;
    integrate(at);
    // TTL expiry itself has an event. Main GTC condition never schedules expiry events.
    if (e.kind === "news") {
      const news = e.news!;
      previous[news.asset] = fundamental[news.asset];
      fundamental[news.asset] = news.price;
      newsCount++;
      for (let i = 0; i < n; i++) notify(i, at, true);
      requote(at);
      if (options.trace) trace.push({ kind: "news", ...news });
    } else if (e.kind === "notice") {
      const i = e.agent!;
      noticeAt[i] = null;
      if (noticeNews[i] && options.cancelOnNews) {
        const before = JSON.stringify(fingerprint());
        book.cancel(i);
        afterMutation(at, before, i);
      }
      noticeNews[i] = false;
      requestWake(i, at);
    } else if (e.kind === "wake") {
      const i = e.agent!,
        period =
          options.trigger === "timer10"
            ? 10000
            : options.trigger === "timer5"
              ? 5000
              : 0;
      if (period) queue.push({ kind: "wake", at: at + period, agent: i });
      else {
        if (wakeAt[i] !== e.token) continue;
        wakeAt[i] = null;
      }
      if (busy[i]) {
        if (period) skipped++;
        else dirty[i] = true;
        continue;
      }
      busy[i] = true;
      dirty[i] = false;
      lastCall[i] = at;
      const index = calls[i]++;
      const base = options.heterogeneous
        ? fast[i]
          ? 250
          : 3000
        : (options.baseLatencyMs ?? 1000);
      const latency = Math.max(
        1,
        Math.round(
          base * (0.8 + 0.4 * draw(`${seed}:inference:${i}:${index}`)) +
            20 +
            80 * draw(`${seed}:network:${i}:${index}`),
        ),
      );
      const intents = [0, 1].map((j) =>
        policy(seed, i, index, j, fundamental[j], previous[j]),
      );
      queue.push({ kind: "response", at: at + latency, agent: i, intents });
    } else if (e.kind === "response") {
      const i = e.agent!,
        before = JSON.stringify(fingerprint());
      book.prune(at);
      busy[i] = false;
      arrived++;
      for (let j = 0; j < 2; j++) {
        const intent = e.intents![j],
          existing = book.orders.find(
            (o) => o.agent === i && o.asset === j && o.remaining > 0,
          );
        if (
          intent &&
          existing &&
          existing.side === intent.side &&
          existing.price === intent.price &&
          existing.remaining === intent.quantity
        )
          continue;
        book.cancel(i, j);
        if (intent) place(i, j, intent.side, intent.price, intent.quantity, at);
      }
      afterMutation(at, before, i);
      if (options.trigger === "serial") requestWake(i, at);
      else if (isEvent && dirty[i]) requestWake(i, at);
    } else if (e.kind === "maker") {
      makerPending = false;
      makerUpdates++;
      const before = JSON.stringify(fingerprint());
      book.prune(at);
      book.cancel(maker);
      const budget = Math.floor(accounts[maker].cash * 0.1);
      for (let j = 0; j < 2; j++) {
        const inv = accounts[maker].stocks[j],
          f = fundamental[j],
          skew = Math.max(
            -0.02,
            Math.min(
              0.02,
              ((inv - makerStock) / Math.max(1, makerStock)) * 0.02,
            ),
          );
        const center = f * (1 - skew),
          ask = Math.max(101, Math.min(20000, Math.ceil(center + f * 0.01))),
          bid = Math.min(ask - 1, Math.max(100, Math.floor(center - f * 0.01)));
        place(maker, j, "BUY", bid, Math.floor(budget / bid), at);
        place(maker, j, "SELL", ask, Math.floor(inv * 0.1), at);
      }
      afterMutation(at, before, maker);
    } else if (e.kind === "expiry") {
      const before = JSON.stringify(fingerprint());
      book.prune(at);
      afterMutation(at, before, -1);
    }
    // Remove fully filled entries; GTC orders cannot be expired by an arbitrary loop clock.
    book.orders = book.orders.filter((o) => o.remaining > 0);
    book.audit(totalCash, totalStocks);
  }
  integrate(duration);
  book.audit(totalCash, totalStocks);
  const finals = accounts.map(
      (a) => a.cash + a.stocks.reduce((v, q, j) => v + q * fundamental[j], 0),
    ),
    buyHold = 1000000 + 100 * (fundamental[0] + fundamental[1]);
  const mean = finals.slice(0, n).reduce((v, c) => v + c, 0) / n;
  const transfer =
    finals.slice(0, n).reduce((v, c) => v + c - buyHold, 0) +
    finals[maker] -
    makerCash -
    makerStock * (fundamental[0] + fundamental[1]);
  if (
    transfer !== 0 ||
    finals.reduce((v, c) => v + c, 0) !==
      totalCash + totalStocks.reduce((v, q, j) => v + q * fundamental[j], 0)
  )
    throw new Error("terminal cash transfer conservation");
  const groupCash = (group: boolean) => {
    const count = fast.filter((x) => x === group).length;
    return count
      ? finals
          .slice(0, n)
          .filter((_, i) => fast[i] === group)
          .reduce((v, c) => v + c, 0) /
          count /
          100
      : null;
  };
  lateOrders = calls.reduce((v, c) => v + c, 0) - arrived;
  return {
    trigger: options.trigger,
    durationMs: duration,
    baseLatencyMs: options.baseLatencyMs ?? 1000,
    heterogeneous: options.heterogeneous ?? false,
    ttlMs: options.ttlMs ?? null,
    makerLatencyMs: options.makerLatencyMs ?? 100,
    cooldownMs: options.cooldownMs ?? 0,
    cancelOnNews: options.cancelOnNews ?? false,
    volume,
    trades: book.fills.length,
    notionalDUSD: notional / 100,
    meanCashDUSD: mean / 100,
    returnPp: ((mean - 3000000) / 3000000) * 100,
    excessReturnPp: ((mean - buyHold) / 3000000) * 100,
    gapPct: gapArea / (duration * 2),
    calls: calls.reduce((v, c) => v + c, 0),
    arrivedCalls: arrived,
    closePendingCalls: lateOrders,
    skippedBusyCalls: skipped,
    orders: book.submitted,
    cancelled: book.cancelled,
    expired: book.expired,
    makerUpdates,
    makerVolumeShare: volume ? makerVolume / volume : 0,
    passiveWaitSeconds: volume ? wait / volume / 1000 : 0,
    artificialMatchingWaitMs: 0,
    processedEvents: processed,
    newsCount,
    terminal: [...fundamental],
    fastMeanCashDUSD: groupCash(true),
    slowMeanCashDUSD: groupCash(false),
    conservation: true,
    ...(options.trace ? { trace } : {}),
    finalCash: finals.slice(0, n),
  };
}
