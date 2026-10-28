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
export type Symbol = string;
export type InstrumentConfig = {
  symbol: string;
  name: string;
  initialPrice: number;
  icon: string;
};
export const DEFAULT_INSTRUMENTS: InstrumentConfig[] = [
  { symbol: "OPENAI", name: "OpenAI", initialPrice: 10000, icon: "◉" },
  { symbol: "ANTHROPIC", name: "Anthropic", initialPrice: 10000, icon: "✳" },
];
export const instrumentConfigs = (config: MarketConfig): InstrumentConfig[] =>
  config.assetMode === "legacy"
    ? [{ symbol: "DAT", name: "DAT", initialPrice: 10000, icon: "◈" }]
    : (config.instruments ?? DEFAULT_INSTRUMENTS);
export function validIcon(icon: string) {
  if (!icon.startsWith("https://"))
    return (
      [...icon].length >= 1 &&
      [...icon].length <= 8 &&
      !/[\u0000-\u001f]/.test(icon)
    );
  try {
    const url = new URL(icon);
    return icon.length <= 512 && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function validateInstruments(instruments: InstrumentConfig[]) {
  ensure(
    instruments.length >= 1 && instruments.length <= 8,
    "INVALID_INSTRUMENTS",
    "每场可设置 1–8 个标的",
  );
  ensure(
    new Set(instruments.map((i) => i.symbol)).size === instruments.length,
    "INVALID_INSTRUMENTS",
    "标的代码不能重复",
  );
  for (const i of instruments) {
    ensure(
      /^[A-Z][A-Z0-9_]{0,15}$/.test(i.symbol) && i.symbol !== "DAT",
      "INVALID_INSTRUMENTS",
      "标的代码须为 1–16 位大写字母、数字或下划线，DAT 保留给历史比赛",
    );
    ensure(
      i.name.trim().length >= 1 && i.name.length <= 40,
      "INVALID_INSTRUMENTS",
      "标的名称须为 1–40 字",
    );
    ensure(
      Number.isSafeInteger(i.initialPrice) &&
        i.initialPrice >= MIN_PRICE &&
        i.initialPrice <= MAX_PRICE,
      "INVALID_INSTRUMENTS",
      "初始价格须为 1–200 DUSD，精确到分",
    );
    ensure(
      validIcon(i.icon),
      "INVALID_INSTRUMENTS",
      "图标请使用 1–8 个字符或有效的 HTTPS 图片地址",
    );
  }
}
export const AI_SYMBOLS = ["OPENAI", "ANTHROPIC"] as const;
export const assetName = (symbol: Symbol, config?: MarketConfig) =>
  config?.instruments?.find((i) => i.symbol === symbol)?.name ??
  (
    { DAT: "DAT", OPENAI: "OpenAI", ANTHROPIC: "Anthropic" } as Record<
      string,
      string
    >
  )[symbol] ??
  symbol;
type AssetLedger = { path: number[]; total: number; treasury: number };
export const symbols = (s: State): Symbol[] =>
  s.assets ? Object.keys(s.assets) : ["DAT"];
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
export type InitialBalances = { cash: number; [symbol: string]: number };
export const startingBalances = (config: MarketConfig): InitialBalances => {
  const values: InitialBalances = {
    cash: INITIAL_CASH,
    DAT: INITIAL_DAT,
    OPENAI: INITIAL_DAT,
    ANTHROPIC: INITIAL_DAT,
    ...Object.fromEntries(
      instrumentConfigs(config).map((i) => [i.symbol, INITIAL_DAT]),
    ),
    ...config.initialBalances,
  };
  return config.instruments
    ? {
        cash: values.cash,
        ...Object.fromEntries(
          config.instruments.map((i) => [i.symbol, values[i.symbol]]),
        ),
      }
    : values;
};
function validateBalances(config: MarketConfig) {
  const b = startingBalances(config);
  ensure(
    Number.isSafeInteger(b.cash) && b.cash >= 0 && b.cash <= 1_000_000_000,
    "INVALID_BALANCES",
    "初始现金须为 0–10,000,000 DUSD，精确到分",
  );
  for (const symbol of Object.keys(b).filter((key) => key !== "cash"))
    ensure(
      /^[A-Z][A-Z0-9_]{0,15}$/.test(symbol) &&
        Number.isSafeInteger(b[symbol]) &&
        b[symbol] >= 0 &&
        b[symbol] <= 100_000,
      "INVALID_BALANCES",
      "初始股票数量须为 0–100,000 的整数",
    );
  ensure(
    !(config.makerCashShare && b.cash === 0),
    "INVALID_BALANCES",
    "启用庄家时，普通 Agent 初始现金须大于 0",
  );
}
export type MarketConfig = {
  id: string;
  name: string;
  rounds: number;
  roundMs: number;
  capacity: number;
  practice: boolean;
  assetMode?: "ai" | "legacy";
  newsEnabled?: boolean;
  makerCashShare?: number;
  initialBalances?: InitialBalances;
  instruments?: InstrumentConfig[];
};
export type NewsItem = {
  id: string;
  round: number;
  symbol: Symbol;
  headline: string;
  impactBps: number;
  before: number;
  after: number;
};
export type Agent = {
  system?: "fundamental-maker";
  initialCash?: number;
  initialHoldings?: number;
  initialInventory?: Record<Symbol, number>;
  id: string;
  name: string;
  description: string;
  cash: number;
  dat: number;
  holdings?: Record<Symbol, number>;
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
  assets?: Record<Symbol, AssetLedger>;
  news?: NewsItem[];
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
export async function generatePath(
  seed: string,
  rounds: number,
  initialPrice = 10000,
  custom = false,
) {
  const noise = await Promise.all(
    Array.from(
      { length: rounds },
      async (_, i) =>
        (parseInt((await sha256(`${seed}:price:${i + 1}`)).slice(0, 8), 16) %
          1201) -
        600,
    ),
  );
  const path = [initialPrice];
  for (const n of noise)
    path.push(
      Math.max(
        custom ? MIN_PRICE : 2500,
        Math.min(
          custom ? MAX_PRICE : 17500,
          path[path.length - 1] +
            (custom ? Math.round((n * initialPrice) / 10000) : n),
        ),
      ),
    );
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
  if (config.instruments) {
    ensure(
      config.assetMode === "ai",
      "INVALID_CONFIG",
      "自定义标的需要使用多标的模式",
    );
    validateInstruments(config.instruments);
  }
  validateBalances(config);
  if (config.instruments && config.initialBalances)
    config = { ...config, initialBalances: startingBalances(config) };
  const path = await generatePath(seed, config.rounds);
  const assets: Record<Symbol, AssetLedger> | undefined =
    config.assetMode === "ai"
      ? Object.fromEntries(
          await Promise.all(
            instrumentConfigs(config).map(async (i) => [
              i.symbol,
              {
                path: await generatePath(
                  `${seed}:${i.symbol}`,
                  config.rounds,
                  i.initialPrice,
                  !!config.instruments,
                ),
                total: 0,
                treasury: 0,
              },
            ]),
          ),
        )
      : undefined;
  ensure(
    !config.newsEnabled || assets,
    "INVALID_CONFIG",
    "随机新闻仅适用于多标的比赛",
  );
  const share = config.makerCashShare ?? 0;
  ensure(
    Number.isFinite(share) &&
      share >= 0 &&
      share <= 0.5 &&
      Math.abs(share * 20 - Math.round(share * 20)) < 1e-9,
    "INVALID_CONFIG",
    "庄家初始现金占比须为 0 或 5%–50%，步长 5%",
  );
  ensure(
    !share || (assets && config.newsEnabled),
    "INVALID_CONFIG",
    "庄家需要开启多标的随机新闻",
  );
  const news: NewsItem[] | undefined = config.newsEnabled ? [] : undefined;
  if (news && assets) {
    const positive = config.instruments
      ? ["客户需求增长", "研发取得突破", "运营成本下降", "收入表现超预期"]
      : [
          "企业客户签约增长",
          "新模型评测取得突破",
          "算力成本下降",
          "开发者使用量超预期",
        ];
    const negative = config.instruments
      ? ["项目交付出现延期", "供应链趋紧", "订单增速放缓", "运营可靠性承压"]
      : [
          "产品交付出现延期",
          "算力供应趋紧",
          "企业订单增速放缓",
          "服务可靠性承压",
        ];
    for (const symbol of Object.keys(assets)) {
      const values = [assets[symbol].path[0]];
      for (let round = 2; round <= config.rounds; round++) {
        const digest = await sha256(`${seed}:news:${symbol}:${round}`);
        const draw = (offset: number) =>
          parseInt(digest.slice(offset, offset + 8), 16);
        const before = values.at(-1)!;
        let after = before;
        if (draw(0) % 100 < 35) {
          const impactBps = (draw(8) % 2 ? 1 : -1) * (300 + (draw(16) % 901));
          after = Math.max(
            config.instruments ? MIN_PRICE : 2500,
            Math.min(
              config.instruments ? MAX_PRICE : 17500,
              Math.round(before * (1 + impactBps / 10000)),
            ),
          );
          news.push({
            id: `${symbol}:${round}`,
            round,
            symbol,
            impactBps,
            before,
            after,
            headline: `${assetName(symbol, config)}：${(impactBps > 0 ? positive : negative)[draw(24) % 4]}`,
          });
        }
        values.push(after);
      }
      // The final redemption uses the last published fundamental: no unseen closing shock.
      values.push(values.at(-1)!);
      assets[symbol].path = values;
    }
    news.sort((a, b) => a.round - b.round || a.symbol.localeCompare(b.symbol));
  }
  const commitment = await sha256(
    JSON.stringify(
      assets
        ? {
            seed,
            paths: Object.fromEntries(
              Object.entries(assets).map(([symbol, a]) => [symbol, a.path]),
            ),
            ...(news ? { news } : {}),
          }
        : { seed, path },
    ),
  );
  return {
    config,
    ...(assets ? { assets } : {}),
    ...(news ? { news } : {}),
    status: "lobby",
    round: 0,
    openedAt: 0,
    pausedAt: null,
    pauseReason: null,
    createdAt: now,
    finishedAt: null,
    seed,
    commitment,
    path: assets ? Object.values(assets)[0].path : path,
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
    !(s.config.makerCashShare && a.name.trim() === "基本面庄家"),
    "NAME_RESERVED",
    "该名称保留给系统庄家",
  );
  ensure(
    !s.agents.some(
      (x) => x.name.toLocaleLowerCase() === a.name.toLocaleLowerCase(),
    ),
    "NAME_TAKEN",
    "Agent 名称已被使用",
    409,
  );
  const b = startingBalances(s.config);
  const agent = {
    id: a.id,
    name: a.name,
    description: a.description,
    keyHash: a.keyHash,
    cash: b.cash,
    dat: s.assets ? 0 : b.DAT,
    ...(s.assets
      ? {
          holdings: Object.fromEntries(
            symbols(s).map((symbol) => [symbol, b[symbol]]),
          ),
        }
      : {}),
    createdAt: now,
  };
  s.agents.push(agent);
  const reserve = symbols(s).reduce(
    (sum, symbol) => sum + b[symbol] * MAX_PRICE,
    0,
  );
  s.treasuryCash += reserve;
  s.totalCash += b.cash + reserve;
  if (s.assets)
    for (const symbol of symbols(s)) s.assets[symbol].total += b[symbol];
  else s.totalDat += b.DAT;
  event(s, now, "agent_joined", a.id);
  audit(s);
  return agent;
}
/** Reset a waiting match atomically; already registered and future agents get the same allocation. */
export function setInitialBalances(
  s: State,
  balances: InitialBalances,
  now: number,
) {
  ensure(s.status === "lobby", "BAD_STATE", "仅可在开赛前调整初始资产", 409);
  validateBalances({ ...s.config, initialBalances: balances });
  balances = startingBalances({ ...s.config, initialBalances: balances });
  const before = startingBalances(s.config);
  s.config.initialBalances = { ...balances };
  for (const a of s.agents) {
    a.cash = balances.cash;
    if (s.assets)
      a.holdings = Object.fromEntries(
        symbols(s).map((symbol) => [symbol, balances[symbol]]),
      );
    else a.dat = balances.DAT;
  }
  const count = s.agents.length;
  s.treasuryCash = symbols(s).reduce(
    (sum, symbol) => sum + balances[symbol] * count * MAX_PRICE,
    0,
  );
  s.totalCash = s.treasuryCash + count * balances.cash;
  if (s.assets)
    for (const symbol of symbols(s))
      s.assets[symbol].total = count * balances[symbol];
  else s.totalDat = count * balances.DAT;
  event(
    s,
    now,
    "initial_balances_changed",
    JSON.stringify({ before, after: balances, agents: count }),
  );
  audit(s);
}
export async function reconfigureInstruments(
  s: State,
  instruments: InstrumentConfig[],
  now: number,
) {
  ensure(
    s.status === "lobby" && s.assets,
    "BAD_STATE",
    "仅可在多标的比赛开赛前调整标的",
    409,
  );
  const fresh = await createState(
    { ...s.config, instruments },
    s.seed,
    s.createdAt,
  );
  s.config = fresh.config;
  s.assets = fresh.assets;
  s.path = fresh.path;
  s.news = fresh.news;
  s.commitment = fresh.commitment;
  setInitialBalances(s, startingBalances(s.config), now);
  event(s, now, "instruments_changed", JSON.stringify(instruments));
  return s;
}
export function authenticate(s: State, keyHash: string) {
  const a = s.agents.find((a) => !a.system && a.keyHash === keyHash);
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
  ensure(
    s.agents.length >= ((s.config.makerCashShare ?? 0) > 0 ? 1 : 2),
    "NOT_ENOUGH_AGENTS",
    "至少需要两名 Agent；启用庄家时至少一名普通 Agent",
    409,
  );
  initializeMaker(s, now);
  s.status = "running";
  s.round = 1;
  s.openedAt = now;
  event(s, now, "started", "round 1");
  openRound(s, now);
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
  ensure(a && !a.system, "UNAUTHORIZED", "找不到可提交决定的 Agent", 401);
  const symbol = d.symbol ?? "DAT";
  ensure(
    symbols(s).includes(symbol),
    "INVALID_SYMBOL",
    "请选择本场标的 instruments 中有效的 symbol；历史比赛使用 DAT",
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
    openRound(s, now);
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
    for (const symbol of symbols(s)) {
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
  const balances = startingBalances(s.config);
  const initialEquity =
    balances.cash +
    symbols(s).reduce(
      (n, symbol) => n + balances[symbol] * pathFor(s, symbol)[0],
      0,
    );
  const standings = s.agents
    .filter((a) => !a.system)
    .map((a) => ({
      id: a.id,
      name: a.name,
      cash: a.cash,
      cashChange: a.cash - balances.cash,
      dat: a.dat,
      holdings: Object.fromEntries(
        symbols(s).map((symbol) => [symbol, holding(a, symbol)]),
      ),
      equity: equity(a),
      profit: equity(a) - initialEquity,
      decisions: counts.get(a.id)?.decisions.size || 0,
      tradedRounds: counts.get(a.id)?.tradedRounds.size || 0,
    }))
    .sort((a, b) => b.cash - a.cash || a.name.localeCompare(b.name));
  let rank = 0,
    prev = -Infinity;
  const leaderboard = standings.map((a, i) => {
    if (a.cash !== prev) rank = i + 1;
    prev = a.cash;
    return { ...a, rank };
  });
  return {
    config: s.config,
    instruments,
    initialEquity,
    initialBalances: balances,
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
    participantCount: s.agents.filter((a) => !a.system).length,
    news: (s.news ?? [])
      .filter((n) => n.round <= s.round)
      .slice()
      .reverse(),
    maker: makerState(s),
    tradeCount: s.trades.length,
    volume: s.trades.reduce((n, t) => n + t.quantity, 0),
    rankingBasis: "cash" as const,
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
              paths: Object.fromEntries(
                Object.entries(s.assets).map(([symbol, a]) => [symbol, a.path]),
              ),
              ...(s.news ? { news: s.news } : {}),
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
    name: assetName(symbol, s.config),
    icon:
      instrumentConfigs(s.config).find((i) => i.symbol === symbol)?.icon ?? "◈",
    initialPrice: path[0],
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

/** One system participant is funded once at start. Treasury redemption reserves are excluded
 * from the cash-share denominator, as they cannot trade. Ordinary endowments never change. */
function initializeMaker(s: State, now: number) {
  const share = s.config.makerCashShare ?? 0;
  if (!share) return;
  ensure(!s.agents.some((a) => a.system), "INVARIANT", "庄家重复初始化", 500);
  const ordinaryCash = s.agents.reduce((sum, a) => sum + a.cash, 0);
  const cash = Math.round((ordinaryCash * share) / (1 - share));
  const inventory = Object.fromEntries(
    symbols(s).map((symbol) => [
      symbol,
      Math.floor(
        (s.agents.reduce((n, a) => n + holding(a, symbol), 0) * share) /
          (1 - share),
      ),
    ]),
  ) as Record<Symbol, number>;
  const maker: Agent = {
    id: `system-maker:${s.config.id}`,
    name: "基本面庄家",
    system: "fundamental-maker",
    description: "按已公布的新闻基本面双向报价，不使用未来新闻。",
    keyHash: "",
    cash,
    dat: 0,
    holdings: { ...inventory },
    initialCash: cash,
    initialHoldings: inventory[symbols(s)[0]],
    initialInventory: inventory,
    createdAt: now,
  };
  s.agents.push(maker);
  const reserve =
    Object.values(inventory).reduce((n, q) => n + q, 0) * MAX_PRICE;
  s.treasuryCash += reserve;
  s.totalCash += cash + reserve;
  for (const symbol of symbols(s)) s.assets![symbol].total += inventory[symbol];
  event(
    s,
    now,
    "maker_funded",
    JSON.stringify({
      cash,
      inventory,
      cashShare: cash / (cash + ordinaryCash),
    }),
  );
  audit(s);
}

function openRound(s: State, now: number) {
  for (const n of s.news ?? [])
    if (n.round === s.round) event(s, now, "news_published", n.id);
  const a = s.agents.find((a) => a.system);
  if (!a) return;
  // Fixed, public policy: 1% half-spread, inventory skew capped at 2%, and 10%
  // of current cash per asset / 10% of inventory offered per round. No future reads.
  const cashPerAsset = Math.floor(
    a.cash * Math.min(0.1, 0.8 / symbols(s).length),
  );
  for (const symbol of symbols(s)) {
    const fundamental = pathFor(s, symbol)[s.round - 1];
    const inventory = holding(a, symbol);
    const initial = a.initialInventory?.[symbol] ?? a.initialHoldings!;
    const imbalance = (inventory - initial) / Math.max(1, initial);
    const skew = Math.max(-0.02, Math.min(0.02, imbalance * 0.02));
    const center = fundamental * (1 - skew);
    const ask = Math.max(
      MIN_PRICE + 1,
      Math.min(MAX_PRICE, Math.ceil(center + fundamental * 0.01)),
    );
    const bid = Math.min(
      ask - 1,
      Math.max(MIN_PRICE, Math.floor(center - fundamental * 0.01)),
    );
    for (const side of ["BUY", "SELL"] as const) {
      const price = side === "BUY" ? bid : ask;
      const quantity =
        side === "BUY"
          ? Math.floor(cashPerAsset / price)
          : Math.floor(inventory * 0.1);
      if (quantity < 1) continue;
      const id = `${s.config.id}:${s.round}:${a.id}:${symbol}:${side}`;
      s.orders.push({
        id,
        requestId: id,
        agentId: a.id,
        symbol,
        round: s.round,
        side,
        price,
        quantity,
        createdAt: now,
        filled: 0,
        cashFlow: 0,
        status: "pending",
        note: "系统庄家：已公开基本面 ±1% 点差，库存偏移上限 2%",
      });
    }
  }
}

export function makerState(s: State) {
  const a = s.agents.find((a) => a.system);
  if (!a) return null;
  const initialInventory =
    a.initialInventory ??
    Object.fromEntries(
      symbols(s).map((symbol) => [symbol, a.initialHoldings!]),
    );
  const initialEquity =
    a.initialCash! +
    symbols(s).reduce(
      (n, symbol) => n + initialInventory[symbol] * pathFor(s, symbol)[0],
      0,
    );
  const equity =
    a.cash +
    symbols(s).reduce(
      (sum, symbol) =>
        sum +
        holding(a, symbol) *
          pathFor(s, symbol)[
            s.status === "finished" ? s.config.rounds : Math.max(0, s.round - 1)
          ],
      0,
    );
  const makerVolume = s.trades
    .filter((t) => t.buyer === a.id || t.seller === a.id)
    .reduce((sum, t) => sum + t.quantity, 0);
  const volume = s.trades.reduce((sum, t) => sum + t.quantity, 0);
  return {
    id: a.id,
    name: a.name,
    cash: a.cash,
    holdings: a.holdings!,
    equity,
    profit: equity - initialEquity,
    initialEquity,
    initialCash: a.initialCash!,
    initialInventory,
    cashShare:
      a.initialCash! /
      (a.initialCash! +
        (s.agents.length - 1) * startingBalances(s.config).cash),
    volume: makerVolume,
    volumeShare: volume ? makerVolume / volume : null,
    policy: "public-fundamentals-v1" as const,
  };
}
