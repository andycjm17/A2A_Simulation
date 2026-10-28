/** OFFLINE experimental scheduler. It is not imported by the deployed Worker.
 * Matching is continuous or periodic; all conditions share a 10s order TTL,
 * public news clock, maker refresh clock, endowments and terminal redemption.
 */
export type Matching = "batch5" | "batch10" | "continuous";
export type Cadence = "5s" | "10s" | "event";
export type PriceRule = "midpoint" | "resting";
export type Tape = { paths: number[][]; seed: string };
export type Options = {
  matching: Matching;
  cadence: Cadence;
  latencyMs?: number;
  priceRule?: PriceRule;
  population?: number;
};
export type Account = { cash: number; stocks: number[] };
export type Limit = {
  id: number;
  agent: number;
  asset: number;
  side: "BUY" | "SELL";
  price: number;
  remaining: number;
  at: number;
  expires: number;
};
export type Fill = {
  buyer: number;
  seller: number;
  asset: number;
  price: number;
  quantity: number;
  at: number;
  buyAt: number;
  sellAt: number;
};
export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export const draw = (key: string) => {
  let n = hash(key);
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
export function policy(
  seed: string,
  agent: number,
  index: number,
  asset: number,
  fundamental: number,
  previous: number,
) {
  const d = (tag: string) => draw(`${seed}:${agent}:${index}:${asset}:${tag}`);
  if (d("pass") < 0.08) return null;
  const side = d("side") < 0.5 ? ("BUY" as const) : ("SELL" as const);
  const kind = agent % 5,
    range = kind < 2 ? 0.02 : kind < 4 ? 0.1 : 0.04;
  const center =
    kind === 4 ? fundamental + (fundamental - previous) * 0.5 : fundamental;
  const price = Math.max(
    100,
    Math.min(
      20000,
      Math.round(
        center +
          fundamental * (d("noise") * 2 - 1) * range +
          (side === "BUY" ? 1 : -1) * d("aggression") * fundamental * 0.02,
      ),
    ),
  );
  return { side, price, quantity: 1 + Math.floor(d("quantity") * 10) };
}
export class Book {
  orders: Limit[] = [];
  fills: Fill[] = [];
  nextId = 0;
  submitted = 0;
  cancelled = 0;
  expired = 0;
  constructor(
    public accounts: Account[],
    public priceRule: PriceRule = "midpoint",
  ) {}
  prune(now: number) {
    this.orders = this.orders.filter((o) => {
      if (o.remaining <= 0) return false;
      if (o.expires <= now) {
        this.expired++;
        return false;
      }
      return true;
    });
  }
  cancel(agent: number, asset?: number) {
    this.orders = this.orders.filter((o) => {
      const remove =
        o.agent === agent && (asset === undefined || o.asset === asset);
      if (remove && o.remaining > 0) this.cancelled++;
      return !remove;
    });
  }
  availableCash(agent: number) {
    return (
      this.accounts[agent].cash -
      this.orders
        .filter((o) => o.agent === agent && o.side === "BUY")
        .reduce((n, o) => n + o.price * o.remaining, 0)
    );
  }
  availableStock(agent: number, asset: number) {
    return (
      this.accounts[agent].stocks[asset] -
      this.orders
        .filter(
          (o) => o.agent === agent && o.asset === asset && o.side === "SELL",
        )
        .reduce((n, o) => n + o.remaining, 0)
    );
  }
  place(
    agent: number,
    asset: number,
    side: "BUY" | "SELL",
    price: number,
    quantity: number,
    now: number,
    expires: number,
    immediate: boolean,
  ) {
    quantity = Math.min(
      quantity,
      side === "BUY"
        ? Math.floor(this.availableCash(agent) / price)
        : this.availableStock(agent, asset),
    );
    if (quantity < 1) return;
    const incoming: Limit = {
      id: this.nextId++,
      agent,
      asset,
      side,
      price,
      remaining: quantity,
      at: now,
      expires,
    };
    this.submitted++;
    if (immediate) {
      const opposite = this.orders
        .filter(
          (o) =>
            o.remaining > 0 &&
            o.asset === asset &&
            o.agent !== agent &&
            o.side !== side &&
            (side === "BUY" ? o.price <= price : o.price >= price),
        )
        .sort(
          (a, b) =>
            (side === "BUY" ? a.price - b.price : b.price - a.price) ||
            a.at - b.at ||
            a.id - b.id,
        );
      for (const resting of opposite) {
        if (!incoming.remaining) break;
        this.fill(
          side === "BUY" ? incoming : resting,
          side === "SELL" ? incoming : resting,
          now,
          this.priceRule === "resting" ? resting.price : undefined,
        );
      }
    }
    if (incoming.remaining > 0) this.orders.push(incoming);
    return incoming;
  }
  fill(b: Limit, a: Limit, now: number, executionPrice?: number) {
    if (b.agent === a.agent) throw new Error("self trade");
    const quantity = Math.min(b.remaining, a.remaining),
      price = executionPrice ?? Math.floor((b.price + a.price) / 2);
    if (price < a.price || price > b.price || quantity <= 0)
      throw new Error("invalid execution");
    const cash = price * quantity;
    this.accounts[b.agent].cash -= cash;
    this.accounts[a.agent].cash += cash;
    this.accounts[b.agent].stocks[b.asset] += quantity;
    this.accounts[a.agent].stocks[a.asset] -= quantity;
    b.remaining -= quantity;
    a.remaining -= quantity;
    this.fills.push({
      buyer: b.agent,
      seller: a.agent,
      asset: b.asset,
      price,
      quantity,
      at: now,
      buyAt: b.at,
      sellAt: a.at,
    });
  }
  auction(now: number, seed: string) {
    for (let asset = 0; asset < 2; asset++) {
      const priority = (a: Limit, b: Limit) =>
        hash(`${seed}:${now}:${a.agent}`) - hash(`${seed}:${now}:${b.agent}`) ||
        a.id - b.id;
      const buys = this.orders
        .filter((o) => o.asset === asset && o.side === "BUY" && o.remaining > 0)
        .sort((a, b) => b.price - a.price || priority(a, b));
      const sells = this.orders
        .filter(
          (o) => o.asset === asset && o.side === "SELL" && o.remaining > 0,
        )
        .sort((a, b) => a.price - b.price || priority(a, b));
      for (const b of buys)
        for (const a of sells) {
          if (!b.remaining) break;
          if (!a.remaining || a.agent === b.agent) continue;
          if (b.price < a.price) break;
          this.fill(b, a, now);
        }
    }
    this.orders = this.orders.filter((o) => o.remaining > 0);
  }
  audit(expectedCash: number, expectedStocks: number[]) {
    if (this.accounts.reduce((n, a) => n + a.cash, 0) !== expectedCash)
      throw new Error("cash conservation");
    for (let j = 0; j < 2; j++)
      if (
        this.accounts.reduce((n, a) => n + a.stocks[j], 0) !== expectedStocks[j]
      )
        throw new Error("stock conservation");
    for (let i = 0; i < this.accounts.length; i++)
      if (
        !Number.isSafeInteger(this.accounts[i].cash) ||
        this.availableCash(i) < 0 ||
        this.accounts[i].stocks.some(
          (q, j) =>
            !Number.isSafeInteger(q) || q < 0 || this.availableStock(i, j) < 0,
        )
      )
        throw new Error("negative/unreserved balance");
  }
}
export function runModel(tape: Tape, options: Options) {
  const population = options.population ?? 20,
    maker = population,
    duration = 300000,
    dt = 250;
  const accounts: Account[] = Array.from({ length: population }, () => ({
    cash: 1000000,
    stocks: [100, 100],
  }));
  const makerCash = Math.round((population * 1000000 * 0.2) / 0.8),
    makerStock = Math.floor((population * 100 * 0.2) / 0.8);
  accounts.push({ cash: makerCash, stocks: [makerStock, makerStock] });
  const book = new Book(accounts, options.priceRule ?? "midpoint"),
    cash = accounts.reduce((n, a) => n + a.cash, 0),
    stocks = [population * 100 + makerStock, population * 100 + makerStock];
  const last = [10000, 10000],
    callCount = Array(population).fill(0),
    busy = Array(population).fill(false),
    observed = Array(population).fill(-1),
    lastRequest = Array(population).fill(-10000);
  const pending: {
    at: number;
    agent: number;
    intents: ReturnType<typeof policy>[];
    observedVersion: number;
  }[] = [];
  const immediate = options.matching === "continuous",
    period = options.matching === "batch5" ? 5000 : 10000;
  let version = 0,
    measured = 0,
    gapSum = 0,
    arrivedCalls = 0,
    afterCloseCalls = 0,
    wait = 0,
    volume = 0,
    makerVolume = 0,
    notional = 0,
    staleVolume = 0;
  const latency = (i: number) =>
    Math.ceil(
      ((options.latencyMs ?? 1000) + draw(`${tape.seed}:latency:${i}`) * 500) /
        dt,
    ) * dt;
  const reference = (j: number, t: number) =>
    tape.paths[j][Math.min(29, Math.floor(t / 10000))];
  const makerQuote = (t: number) => {
    book.cancel(maker);
    const a = accounts[maker],
      budget = Math.floor(a.cash * 0.1);
    // One maker refresh every 10s in EVERY treatment, independent of clearing.
    for (let j = 0; j < 2; j++) {
      const f = reference(j, t),
        inv = a.stocks[j],
        skew = Math.max(
          -0.02,
          Math.min(0.02, ((inv - makerStock) / Math.max(1, makerStock)) * 0.02),
        );
      const center = f * (1 - skew),
        ask = Math.max(101, Math.min(20000, Math.ceil(center + f * 0.01))),
        bid = Math.min(ask - 1, Math.max(100, Math.floor(center - f * 0.01)));
      book.place(
        maker,
        j,
        "BUY",
        bid,
        Math.floor(budget / bid),
        t,
        t + 10000,
        immediate,
      );
      book.place(
        maker,
        j,
        "SELL",
        ask,
        Math.floor(inv * 0.1),
        t,
        t + 10000,
        immediate,
      );
    }
  };
  for (let t = 0; t <= duration; t += dt) {
    // At a boundary, settle the preceding interval BEFORE publishing new news.
    if (t > 0 && !immediate && t % period === 0) book.auction(t, tape.seed);
    book.prune(t);
    if (t === duration) {
      afterCloseCalls = pending.length;
      break;
    }
    if (t % 10000 === 0) {
      version++;
      makerQuote(t);
    }
    // Requests landing together have a seed-randomized ordering; fixed agent IDs do not buy latency priority.
    const arriving = pending
      .filter((p) => p.at === t)
      .sort(
        (a, b) =>
          hash(`${tape.seed}:arrival:${t}:${a.agent}`) -
          hash(`${tape.seed}:arrival:${t}:${b.agent}`),
      );
    for (const p of arriving) {
      pending.splice(pending.indexOf(p), 1);
      busy[p.agent] = false;
      arrivedCalls++;
      for (let j = 0; j < 2; j++) {
        book.cancel(p.agent, j);
        const intent = p.intents[j];
        if (intent)
          book.place(
            p.agent,
            j,
            intent.side,
            intent.price,
            intent.quantity,
            t,
            t + 10000,
            immediate,
          );
      }
    }
    if (book.fills.length !== measured) {
      for (const f of book.fills.slice(measured)) {
        last[f.asset] = f.price;
        volume += f.quantity;
        notional += f.price * f.quantity;
        wait += ((f.at - f.buyAt + (f.at - f.sellAt)) * f.quantity) / 2;
        if (f.buyer === maker || f.seller === maker) makerVolume += f.quantity;
        const idx = Math.min(
          29,
          Math.floor((immediate ? f.at : f.at - 1) / 10000),
        );
        if (
          Math.abs(f.price - tape.paths[f.asset][idx]) /
            tape.paths[f.asset][idx] >
          0.02
        )
          staleVolume += f.quantity;
      }
      version++;
      measured = book.fills.length;
    }
    for (let i = 0; i < population; i++) {
      if (busy[i]) continue;
      const ready =
        options.cadence === "event"
          ? t - lastRequest[i] >= 1000 &&
            (version !== observed[i] || t - lastRequest[i] >= 10000)
          : t % (options.cadence === "5s" ? 5000 : 10000) === 0;
      if (!ready) continue;
      const index = callCount[i]++,
        intents = [0, 1].map((j) =>
          policy(
            tape.seed,
            i,
            index,
            j,
            reference(j, t),
            tape.paths[j][Math.max(0, Math.floor(t / 10000) - 1)],
          ),
        );
      pending.push({
        at: t + latency(i),
        agent: i,
        intents,
        observedVersion: version,
      });
      observed[i] = version;
      lastRequest[i] = t;
      busy[i] = true;
    }
    for (let j = 0; j < 2; j++)
      gapSum += (Math.abs(last[j] - reference(j, t)) / reference(j, t)) * 100;
    book.audit(cash, stocks);
  }
  // The last auction's fills were appended at t=duration and need the same accounting.
  for (const f of book.fills.slice(measured)) {
    volume += f.quantity;
    notional += f.price * f.quantity;
    wait += ((f.at - f.buyAt + (f.at - f.sellAt)) * f.quantity) / 2;
    if (f.buyer === maker || f.seller === maker) makerVolume += f.quantity;
    if (
      Math.abs(f.price - reference(f.asset, duration - 1)) /
        reference(f.asset, duration - 1) >
      0.02
    )
      staleVolume += f.quantity;
  }
  book.orders = [];
  book.audit(cash, stocks);
  const terminal = tape.paths.map((p) => p[29]),
    buyHold = 1000000 + 100 * (terminal[0] + terminal[1]);
  const finals = accounts.map(
    (a) => a.cash + a.stocks.reduce((n, q, j) => n + q * terminal[j], 0),
  );
  const ordinary = finals.slice(0, population),
    mean = ordinary.reduce((n, c) => n + c, 0) / population;
  const excessCash =
    ordinary.reduce((n, c) => n + c - buyHold, 0) +
    finals[maker] -
    makerCash -
    makerStock * (terminal[0] + terminal[1]);
  if (excessCash !== 0) throw new Error("terminal transfer conservation");
  return {
    ...options,
    population,
    volume,
    notionalDUSD: notional / 100,
    trades: book.fills.length,
    calls: callCount.reduce((a, b) => a + b, 0),
    arrivedCalls,
    afterCloseCalls,
    orders: book.submitted,
    cancelled: book.cancelled,
    expired: book.expired,
    meanCashDUSD: mean / 100,
    returnPp: ((mean - 3000000) / 3000000) * 100,
    excessReturnPp: ((mean - buyHold) / 3000000) * 100,
    gapPct: gapSum / ((duration / dt) * 2),
    waitSeconds: volume ? wait / volume / 1000 : null,
    makerVolumeShare: volume ? makerVolume / volume : null,
    offFundamentalVolumeShare: volume ? staleVolume / volume : null,
    terminal,
    newsChanges: tape.paths.reduce(
      (n, p) => n + p.slice(1, 30).filter((v, i) => v !== p[i]).length,
      0,
    ),
    conservation: true,
  };
}
