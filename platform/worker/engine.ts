/** Pure deterministic market. All cash/prices are integer DUSD cents; asset quantities are integral. */
export const INITIAL_CASH = 1_000_000,
  INITIAL_DAT = 100,
  MIN_PRICE = 100,
  MAX_PRICE = 20_000,
  MAX_QTY = 10;
export class MarketError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function ensure(
  ok: unknown,
  code: string,
  message: string,
  status = 400,
): asserts ok {
  if (!ok) throw new MarketError(code, message, status);
}
export type Symbol = "DAT" | "OPENAI" | "ANTHROPIC";
export const AI_SYMBOLS = ["OPENAI", "ANTHROPIC"] as const;
export const assetName = (symbol: Symbol) =>
  ({ DAT: "DAT", OPENAI: "OpenAI", ANTHROPIC: "Anthropic" })[symbol];
type AssetLedger = { path: number[]; total: number; treasury: number };
export const symbols = (s: State): Symbol[] =>
  s.assets ? [...AI_SYMBOLS] : ["DAT"];
export const pathFor = (s: State, symbol: Symbol) =>
  symbol === "DAT" ? s.path : s.assets![symbol].path;
export const holding = (a: Agent, symbol: Symbol) =>
  symbol === "DAT" ? a.dat : (a.holdings?.[symbol] ?? 0);
function changeHolding(a: Agent, symbol: Symbol, delta: number) {
  if (symbol === "DAT") a.dat += delta;
  else a.holdings![symbol] += delta;
}
const orderSymbol = (o: { symbol?: Symbol }): Symbol => o.symbol ?? "DAT";
export type Side = "BUY" | "SELL" | "PASS";
export type MarketConfig = {
  id: string;
  name: string;
  rounds: number;
  roundMs: number;
  capacity: number;
  practice: boolean;
  assetMode?: "ai" | "legacy";
};
export type Agent = {
  id: string;
  name: string;
  description: string;
  cash: number;
  dat: number;
  holdings?: Record<"OPENAI" | "ANTHROPIC", number>;
  createdAt: number;
  keyHash: string;
};
export type Decision = {
  symbol?: Symbol;
  round: number;
  side: Side;
  price: number;
  quantity: number;
  requestId: string;
  note?: string;
};
export type Order = Decision & {
  id: string;
  agentId: string;
  createdAt: number;
  filled: number;
  cashFlow: number;
  status: "pending" | "filled" | "partial" | "expired" | "pass";
};
export type Trade = {
  symbol?: Symbol;
  id: string;
  round: number;
  buyer: string;
  seller: string;
  price: number;
  quantity: number;
  at: number;
};
export type RoundResult = {
  round: number;
  reference: number;
  trades: number;
  volume: number;
  decisions: number;
  clearedAt: number;
  scheduledAt: number;
};
export type AuditEvent = {
  seq: number;
  at: number;
  type: string;
  detail: string;
};
export type State = {
  assets?: Record<"OPENAI" | "ANTHROPIC", AssetLedger>;
  config: MarketConfig;
  status: "lobby" | "running" | "paused" | "finished";
  round: number;
  openedAt: number;
  pausedAt: number | null;
  pauseReason: string | null;
  createdAt: number;
  finishedAt: number | null;
  seed: string;
  commitment: string;
  path: number[];
  agents: Agent[];
  orders: Order[];
  trades: Trade[];
  results: RoundResult[];
  events: AuditEvent[];
  treasuryCash: number;
  treasuryDat: number;
  totalCash: number;
  totalDat: number;
};
export function hash32(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export async function generatePath(seed: string, rounds: number) {
  const noise = await Promise.all(
    Array.from(
      { length: rounds },
      async (_, i) =>
        (parseInt((await sha256(`${seed}:price:${i + 1}`)).slice(0, 8), 16) %
          1201) -
        600,
    ),
  );
  const path = [10000];
  for (const n of noise)
    path.push(Math.max(2500, Math.min(17500, path[path.length - 1] + n)));
  return path;
}
export async function sha256(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function createState(
  config: MarketConfig,
  seed: string,
  now: number,
): Promise<State> {
  const path = await generatePath(seed, config.rounds);
  const assets =
    config.assetMode === "ai"
      ? {
          OPENAI: {
            path: await generatePath(`${seed}:OPENAI`, config.rounds),
            total: 0,
            treasury: 0,
          },
          ANTHROPIC: {
            path: await generatePath(`${seed}:ANTHROPIC`, config.rounds),
            total: 0,
            treasury: 0,
          },
        }
      : undefined;
  const commitment = await sha256(
    JSON.stringify(
      assets
        ? {
            seed,
            paths: {
              OPENAI: assets.OPENAI.path,
              ANTHROPIC: assets.ANTHROPIC.path,
            },
          }
        : { seed, path },
    ),
  );
  return {
    config,
    ...(assets ? { assets } : {}),
    status: "lobby",
    round: 0,
    openedAt: 0,
    pausedAt: null,
    pauseReason: null,
    createdAt: now,
    finishedAt: null,
    seed,
    commitment,
    path: assets?.OPENAI.path ?? path,
    agents: [],
    orders: [],
    trades: [],
    results: [],
    events: [],
    treasuryCash: 0,
    treasuryDat: 0,
    totalCash: 0,
    totalDat: 0,
  };
}
function event(s: State, now: number, type: string, detail: string) {
  s.events.push({ seq: s.events.length + 1, at: now, type, detail });
}
export function addAgent(
  s: State,
  a: Pick<Agent, "id" | "name" | "description" | "keyHash">,
  now: number,
) {
  ensure(
    s.status === "lobby",
    "REGISTRATION_CLOSED",
    "比赛开始后不可加入",
    409,
  );
  ensure(
    s.agents.length < s.config.capacity,
    "MARKET_FULL",
    "参赛名额已满",
    409,
  );
  ensure(
    !s.agents.some(
      (x) => x.name.toLocaleLowerCase() === a.name.toLocaleLowerCase(),
    ),
    "NAME_TAKEN",
    "Agent 名称已被使用",
    409,
  );
  const agent = {
    id: a.id,
    name: a.name,
    description: a.description,
    keyHash: a.keyHash,
    cash: INITIAL_CASH,
    dat: s.assets ? 0 : INITIAL_DAT,
    ...(s.assets
      ? { holdings: { OPENAI: INITIAL_DAT, ANTHROPIC: INITIAL_DAT } }
      : {}),
    createdAt: now,
  };
  s.agents.push(agent);
  const reserve = INITIAL_DAT * MAX_PRICE * symbols(s).length;
  s.treasuryCash += reserve;
  s.totalCash += INITIAL_CASH + reserve;
  if (s.assets)
    for (const symbol of AI_SYMBOLS) s.assets[symbol].total += INITIAL_DAT;
  else s.totalDat += INITIAL_DAT;
  event(s, now, "agent_joined", a.id);
  audit(s);
  return agent;
}
export function authenticate(s: State, keyHash: string) {
  const a = s.agents.find((a) => a.keyHash === keyHash);
  ensure(a, "UNAUTHORIZED", "无效或已失效的 Agent 凭证", 401);
  return a;
}
export function orderDeadline(s: State) {
  return (
    s.openedAt +
    s.config.roundMs -
    Math.min(5000, Math.floor(s.config.roundMs / 10))
  );
}
export function settlementAt(s: State) {
  return s.openedAt + s.config.roundMs;
}
export function start(s: State, now: number) {
  ensure(s.status === "lobby", "BAD_STATE", "只有等待中的比赛可以开始", 409);
  ensure(s.agents.length >= 2, "NOT_ENOUGH_AGENTS", "至少需要两名 Agent", 409);
  s.status = "running";
  s.round = 1;
  s.openedAt = now;
  event(s, now, "started", "round 1");
}
export function pause(s: State, now: number, reason = "organizer") {
  ensure(s.status === "running", "BAD_STATE", "比赛当前没有运行", 409);
  s.status = "paused";
  s.pausedAt = now;
  s.pauseReason = reason;
  event(s, now, "paused", reason);
}
export function resume(s: State, now: number) {
  ensure(
    s.status === "paused" && s.pausedAt !== null,
    "BAD_STATE",
    "比赛当前没有暂停",
    409,
  );
  s.openedAt += now - s.pausedAt;
  s.status = "running";
  s.pausedAt = null;
  s.pauseReason = null;
  event(s, now, "resumed", `round ${s.round}`);
}
export function submit(
  s: State,
  agentId: string,
  d: Decision,
  now: number,
): Order {
  const a = s.agents.find((x) => x.id === agentId);
  ensure(a, "UNAUTHORIZED", "找不到 Agent", 401);
  const symbol = d.symbol ?? "DAT";
  ensure(
    symbols(s).includes(symbol),
    "INVALID_SYMBOL",
    "请选择本场标的 OPENAI 或 ANTHROPIC；历史比赛使用 DAT",
  );
  const prior = s.orders.find(
    (x) => x.agentId === agentId && x.requestId === d.requestId,
  );
  if (prior) {
    ensure(
      orderSymbol(prior) === symbol &&
        prior.round === d.round &&
        prior.side === d.side &&
        prior.price === d.price &&
        prior.quantity === d.quantity &&
        (prior.note || "") === (d.note || ""),
      "IDEMPOTENCY_CONFLICT",
      "同一请求编号不能用于不同订单",
      409,
    );
    return prior;
  }
  ensure(
    s.status === "running",
    "MARKET_NOT_RUNNING",
    "比赛当前未开放下单",
    409,
  );
  ensure(d.round === s.round, "WRONG_ROUND", "轮次已变化，请重新读取状态", 409);
  ensure(
    now >= s.openedAt && now < orderDeadline(s),
    "ORDER_WINDOW_CLOSED",
    "本轮下单窗口已关闭",
    409,
  );
  ensure(
    !s.orders.some(
      (x) =>
        x.agentId === agentId &&
        x.round === s.round &&
        orderSymbol(x) === symbol,
    ),
    "ALREADY_DECIDED",
    "每种标的每轮仅允许一个有效决定",
    409,
  );
  ensure(
    ["BUY", "SELL", "PASS"].includes(d.side),
    "INVALID_SIDE",
    "无效交易方向",
  );
  ensure(
    Number.isSafeInteger(d.price) && Number.isSafeInteger(d.quantity),
    "INVALID_NUMBER",
    "价格和数量必须是安全整数",
  );
  if (d.side === "PASS") {
    ensure(
      d.price === 0 && d.quantity === 0,
      "INVALID_PASS",
      "观望的价格和数量须为 0",
    );
  } else {
    ensure(
      d.price >= MIN_PRICE && d.price <= MAX_PRICE,
      "INVALID_PRICE",
      "价格范围为 100–20000 分",
    );
    ensure(
      d.quantity >= 1 && d.quantity <= MAX_QTY,
      "INVALID_QUANTITY",
      "每单 1–10 单位",
    );
    ensure(
      d.side !== "BUY" ||
        accountState(s, a).availableCash >= d.price * d.quantity,
      "INSUFFICIENT_CASH",
      "可用现金不足",
    );
    ensure(
      d.side !== "SELL" || holding(a, symbol) >= d.quantity,
      "INSUFFICIENT_DAT",
      `可用 ${symbol} 不足`,
    );
  }
  const order: Order = {
    ...d,
    id: `${s.config.id}:${s.round}:${a.id}${s.assets ? `:${symbol}` : ""}`,
    agentId,
    createdAt: now,
    filled: 0,
    cashFlow: 0,
    status: d.side === "PASS" ? "pass" : "pending",
  };
  s.orders.push(order);
  return order;
}
export function clearRound(s: State, now: number) {
  ensure(s.status === "running", "BAD_STATE", "比赛未运行", 409);
  ensure(now >= settlementAt(s), "TOO_EARLY", "尚未到结算时间", 409);
  const scheduled = settlementAt(s),
    orders = s.orders.filter((o) => o.round === s.round);
  const tie = (a: Order, b: Order) =>
    hash32(`${s.seed}:${s.round}:${a.agentId}`) -
      hash32(`${s.seed}:${s.round}:${b.agentId}`) ||
    a.agentId.localeCompare(b.agentId);
  let count = 0,
    volume = 0;
  for (const symbol of symbols(s)) {
    const buys = orders
      .filter((o) => o.side === "BUY" && orderSymbol(o) === symbol)
      .sort((a, b) => b.price - a.price || tie(a, b));
    const sells = orders
      .filter((o) => o.side === "SELL" && orderSymbol(o) === symbol)
      .sort((a, b) => a.price - b.price || tie(a, b));
    const agents = new Map(s.agents.map((a) => [a.id, a]));
    let i = 0,
      j = 0;
    while (i < buys.length && j < sells.length) {
      const b = buys[i],
        a = sells[j];
      if (b.price < a.price) break;
      ensure(b.agentId !== a.agentId, "SELF_TRADE", "检测到自成交", 500);
      const quantity = Math.min(b.quantity - b.filled, a.quantity - a.filled),
        price = Math.floor((b.price + a.price) / 2),
        cash = price * quantity;
      const buyer = agents.get(b.agentId)!,
        seller = agents.get(a.agentId)!;
      buyer.cash -= cash;
      changeHolding(buyer, symbol, quantity);
      seller.cash += cash;
      changeHolding(seller, symbol, -quantity);
      b.filled += quantity;
      b.cashFlow -= cash;
      a.filled += quantity;
      a.cashFlow += cash;
      s.trades.push({
        ...(s.assets ? { symbol } : {}),
        id: `${s.config.id}:${s.round}:${count++}`,
        round: s.round,
        buyer: b.agentId,
        seller: a.agentId,
        price,
        quantity,
        at: now,
      });
      volume += quantity;
      if (b.filled === b.quantity) i++;
      if (a.filled === a.quantity) j++;
    }
  }
  for (const o of orders)
    if (o.side !== "PASS")
      o.status =
        o.filled === o.quantity
          ? "filled"
          : o.filled > 0
            ? "partial"
            : "expired";
  s.results.push({
    round: s.round,
    reference: s.path[s.round],
    trades: count,
    volume,
    decisions: orders.length,
    clearedAt: now,
    scheduledAt: scheduled,
  });
  event(
    s,
    now,
    "round_settled",
    JSON.stringify({ round: s.round, trades: count, volume }),
  );
  if (s.round === s.config.rounds) {
    for (const symbol of symbols(s)) {
      const price = pathFor(s, symbol)[s.config.rounds];
      for (const a of s.agents) {
        const quantity = holding(a, symbol),
          payout = quantity * price;
        s.treasuryCash -= payout;
        if (symbol === "DAT") s.treasuryDat += quantity;
        else s.assets![symbol].treasury += quantity;
        a.cash += payout;
        changeHolding(a, symbol, -quantity);
      }
    }
    s.status = "finished";
    s.finishedAt = now;
    event(
      s,
      now,
      "redeemed",
      "all instruments redeemed at their committed terminal prices",
    );
  } else {
    s.round++;
    s.openedAt = scheduled;
  }
  audit(s);
}
export function advance(s: State, now: number) {
  if (s.status !== "running" || now < settlementAt(s)) return false;
  // A long scheduler outage must not silently consume missed decision windows.
  const late = now - settlementAt(s);
  clearRound(s, now);
  if (s.status === "running" && late >= s.config.roundMs) {
    s.openedAt = now;
    pause(s, now, "scheduler_delay");
  }
  return true;
}
export function audit(s: State) {
  if (s.assets)
    for (const symbol of AI_SYMBOLS) {
      const asset = s.assets[symbol];
      ensure(
        s.agents.every(
          (a) =>
            Number.isSafeInteger(holding(a, symbol)) && holding(a, symbol) >= 0,
        ) &&
          Number.isSafeInteger(asset.treasury) &&
          asset.treasury >= 0 &&
          s.agents.reduce((n, a) => n + holding(a, symbol), 0) +
            asset.treasury ===
            asset.total,
        "INVARIANT",
        `${symbol} 资产不守恒`,
        500,
      );
    }
  for (const a of s.agents)
    ensure(
      Number.isSafeInteger(a.cash) &&
        a.cash >= 0 &&
        Number.isSafeInteger(a.dat) &&
        a.dat >= 0,
      "INVARIANT",
      "账户资产不合法",
      500,
    );
  ensure(
    Number.isSafeInteger(s.treasuryCash) && s.treasuryCash >= 0,
    "INVARIANT",
    "金库资产不足",
    500,
  );
  ensure(
    s.agents.reduce((n, a) => n + a.cash, 0) + s.treasuryCash === s.totalCash,
    "INVARIANT",
    "现金不守恒",
    500,
  );
  ensure(
    s.agents.reduce((n, a) => n + a.dat, 0) + s.treasuryDat === s.totalDat,
    "INVARIANT",
    "DAT 不守恒",
    500,
  );
  ensure(
    s.results.length === new Set(s.results.map((r) => r.round)).size,
    "INVARIANT",
    "轮次重复结算",
    500,
  );
}
export function publicState(s: State, now: number) {
  const reference =
    s.path[
      s.status === "finished" ? s.config.rounds : Math.max(0, s.round - 1)
    ];
  const counts = new Map<
    string,
    { decisions: Set<number>; tradedRounds: Set<number> }
  >();
  for (const o of s.orders) {
    const count = counts.get(o.agentId) || {
      decisions: new Set<number>(),
      tradedRounds: new Set<number>(),
    };
    count.decisions.add(o.round);
    if (o.filled > 0) count.tradedRounds.add(o.round);
    counts.set(o.agentId, count);
  }
  const instruments = symbols(s).map((symbol) => instrumentState(s, symbol));
  const equity = (a: Agent) =>
    a.cash +
    instruments.reduce((n, i) => n + holding(a, i.symbol) * i.reference, 0);
  const initialEquity =
    INITIAL_CASH +
    symbols(s).reduce(
      (n, symbol) => n + INITIAL_DAT * pathFor(s, symbol)[0],
      0,
    );
  const standings = s.agents
    .map((a) => ({
      id: a.id,
      name: a.name,
      cash: a.cash,
      dat: a.dat,
      holdings: Object.fromEntries(
        symbols(s).map((symbol) => [symbol, holding(a, symbol)]),
      ),
      equity: equity(a),
      profit: equity(a) - initialEquity,
      decisions: counts.get(a.id)?.decisions.size || 0,
      tradedRounds: counts.get(a.id)?.tradedRounds.size || 0,
    }))
    .sort((a, b) => b.equity - a.equity || a.name.localeCompare(b.name));
  let rank = 0,
    prev = -Infinity;
  const leaderboard = standings.map((a, i) => {
    if (a.equity !== prev) rank = i + 1;
    prev = a.equity;
    return { ...a, rank };
  });
  return {
    config: s.config,
    instruments,
    initialEquity,
    orderBookMode: s.assets ? ("public-top5" as const) : ("sealed" as const),
    status: s.status,
    round: s.round,
    openedAt: s.openedAt,
    deadline: s.status === "running" ? orderDeadline(s) : null,
    settlesAt: s.status === "running" ? settlementAt(s) : null,
    serverTime: now,
    createdAt: s.createdAt,
    finishedAt: s.finishedAt,
    pauseReason: s.pauseReason,
    reference,
    history: s.path.slice(
      0,
      s.status === "finished" ? s.config.rounds + 1 : Math.max(1, s.round),
    ),
    commitment: s.commitment,
    participantCount: s.agents.length,
    tradeCount: s.trades.length,
    volume: s.trades.reduce((n, t) => n + t.quantity, 0),
    leaderboard,
    trades: s.trades.slice(-100).reverse(),
    results: s.results,
    settlementMode: "simulation" as const,
    terminalPrice: s.status === "finished" ? reference : null,
    reveal:
      s.status === "finished"
        ? s.assets
          ? {
              seed: s.seed,
              paths: {
                OPENAI: s.assets.OPENAI.path,
                ANTHROPIC: s.assets.ANTHROPIC.path,
              },
            }
          : { seed: s.seed, path: s.path }
        : null,
  };
}
export function accountState(s: State, a: Agent) {
  const orders = s.orders.filter((o) => o.agentId === a.id);
  const pending = orders.filter(
    (o) => o.round === s.round && o.status === "pending",
  );
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    cash: a.cash,
    dat: a.dat,
    holdings: Object.fromEntries(
      symbols(s).map((symbol) => [symbol, holding(a, symbol)]),
    ),
    availableHoldings: Object.fromEntries(
      symbols(s).map((symbol) => [
        symbol,
        holding(a, symbol) -
          pending
            .filter((o) => o.side === "SELL" && orderSymbol(o) === symbol)
            .reduce((n, o) => n + o.quantity - o.filled, 0),
      ]),
    ),
    availableCash:
      a.cash -
      pending
        .filter((o) => o.side === "BUY")
        .reduce((n, o) => n + o.price * (o.quantity - o.filled), 0),
    availableDat:
      a.dat -
      pending
        .filter((o) => o.side === "SELL" && orderSymbol(o) === "DAT")
        .reduce((n, o) => n + o.quantity - o.filled, 0),
    orders,
    createdAt: a.createdAt,
  };
}

export type Candle = {
  round: number;
  at: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number;
  trades: number;
};
export function instrumentState(s: State, symbol: Symbol) {
  const path = pathFor(s, symbol);
  const trades = s.trades.filter((t) => orderSymbol(t) === symbol);
  const candles: Candle[] = s.results.map((r) => {
    const fills = trades.filter((t) => t.round === r.round);
    const prices = fills.map((t) => t.price);
    return {
      round: r.round,
      at: r.scheduledAt,
      open: prices[0] ?? null,
      high: prices.length ? Math.max(...prices) : null,
      low: prices.length ? Math.min(...prices) : null,
      close: prices.at(-1) ?? null,
      volume: fills.reduce((n, t) => n + t.quantity, 0),
      trades: fills.length,
    };
  });
  const depth = (side: Side) => {
    const levels = new Map<number, number>();
    if (s.assets && (s.status === "running" || s.status === "paused"))
      for (const o of s.orders)
        if (
          o.round === s.round &&
          orderSymbol(o) === symbol &&
          o.side === side &&
          o.status === "pending" &&
          o.quantity > o.filled
        )
          levels.set(
            o.price,
            (levels.get(o.price) ?? 0) + o.quantity - o.filled,
          );
    return [...levels]
      .sort(([a], [b]) => (side === "BUY" ? b - a : a - b))
      .slice(0, 5)
      .map(([price, quantity]) => ({ price, quantity }));
  };
  const reference =
    path[s.status === "finished" ? s.config.rounds : Math.max(0, s.round - 1)];
  return {
    symbol,
    name: assetName(symbol),
    reference,
    history: path.slice(
      0,
      s.status === "finished" ? s.config.rounds + 1 : Math.max(1, s.round),
    ),
    terminalPrice: s.status === "finished" ? reference : null,
    lastPrice: trades.at(-1)?.price ?? null,
    trades: trades.slice(-100).reverse(),
    tradeCount: trades.length,
    volume: trades.reduce((n, t) => n + t.quantity, 0),
    candles,
    orderBook: { bids: depth("BUY"), asks: depth("SELL") },
  };
}
