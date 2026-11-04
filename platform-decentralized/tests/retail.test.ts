import { describe, it, expect } from "vitest";
import {
  createState,
  addAgent,
  start,
  clearRound,
  settlementAt,
  orderDeadline,
  publicState,
  accountState,
  audit,
  authenticate,
  submit,
  pause,
  resume,
  advance,
  retailState,
  retailDecision,
  sha256,
  DEFAULT_INSTRUMENTS,
  type MarketConfig,
  type State,
} from "../worker/engine";
const config: MarketConfig = {
  id: "retail-test",
  name: "Retail test",
  rounds: 240,
  roundMs: 5000,
  capacity: 2,
  practice: true,
  assetMode: "ai",
  instruments: DEFAULT_INSTRUMENTS,
  newsEnabled: true,
  makerCashShare: 0.2,
  retailAgents: true,
};
async function setup(extra: Partial<MarketConfig> = {}, seed = "retail-seed") {
  const s = await createState({ ...config, ...extra }, seed, 0);
  for (let i = 0; i < 2; i++)
    addAgent(
      s,
      {
        id: `a${i}`,
        name: `Participant ${i}`,
        description: "",
        keyHash: `key${i}`,
      },
      0,
    );
  return s;
}
const bots = (s: State) => s.agents.filter((a) => a.system === "retail-trader");
describe("five retail traders and the 20-minute competition", () => {
  it("runs all 240 five-second rounds with finite resources, two assets and participant cash rankings", async () => {
    const s = await setup();
    start(s, 1000);
    expect(orderDeadline(s) - s.openedAt).toBe(4500);
    expect(s.agents).toHaveLength(8);
    expect(bots(s)).toHaveLength(5);
    expect(publicState(s, 1000).maker!.cashShare).toBeCloseTo(0.2);
    while (s.status === "running") {
      const r = s.round;
      for (const a of bots(s)) {
        const orders = s.orders.filter(
          (o) => o.agentId === a.id && o.round === r,
        );
        expect(orders).toHaveLength(2);
        expect(orders.every((o) => o.quantity >= 0 && o.quantity <= 10)).toBe(
          true,
        );
        const account = accountState(s, a);
        expect(account.availableCash).toBeGreaterThanOrEqual(0);
        expect(
          Object.values(account.availableHoldings).every((q) => q >= 0),
        ).toBe(true);
      }
      for (const [i, side] of ["BUY", "SELL"].entries()) {
        const a = s.agents.find((a) => a.id === `a${i}`)!;
        const canTrade =
          side === "BUY" ? a.cash >= 10000 : a.holdings!.BFBT > 0;
        submit(
          s,
          a.id,
          {
            round: r,
            symbol: "BFBT",
            side: canTrade ? (side as "BUY" | "SELL") : "PASS",
            price: canTrade ? 10000 : 0,
            quantity: canTrade ? 1 : 0,
            requestId: `human:${r}:${i}`,
          },
          s.openedAt + 1,
        );
      }
      clearRound(s, settlementAt(s));
      audit(s);
    }
    const view = publicState(s, s.finishedAt!);
    expect(s.finishedAt! - 1000).toBe(20 * 60 * 1000);
    expect(s.results).toHaveLength(240);
    expect(
      s.orders.filter((o) => o.agentId.startsWith("system-retail:")),
    ).toHaveLength(2400);
    expect(
      view.retailTraders.every(
        (a) => a.decisions === 240 && a.scoreFrozen && a.unrealizedPnl === 0,
      ),
    ).toBe(true);
    expect(
      new Set(view.retailTraders.map((a) => a.score)).size,
    ).toBeGreaterThan(1);
    expect(view.retailTraders.some((a) => a.score !== 0)).toBe(true);
    expect(view.leaderboard).toHaveLength(2);
    expect(view.participantCount).toBe(2);
    expect(view.rankingBasis).toBe("cash");
    expect(view.leaderboard[0].cash).toBeGreaterThanOrEqual(
      view.leaderboard[1].cash,
    );
    for (const a of bots(s))
      expect(s.trades.some((t) => t.buyer === a.id || t.seller === a.id)).toBe(
        true,
      );
    expect(s.trades.every((t) => t.buyer !== t.seller)).toBe(true);
  });
  it("is deterministic across JSON restart, pause/resume and seed replay", async () => {
    const s = await setup(),
      replay = await setup();
    start(s, 1000);
    start(replay, 1000);
    expect(s).toEqual(replay);
    let restored = JSON.parse(JSON.stringify(s)) as State;
    for (let i = 0; i < 240; i++) {
      clearRound(s, settlementAt(s));
      clearRound(restored, settlementAt(restored));
      if (i === 100) restored = JSON.parse(JSON.stringify(restored));
    }
    expect(restored).toEqual(s);
    const paused = await setup();
    start(paused, 1000);
    const saved = JSON.stringify(paused.orders),
      cash = paused.totalCash;
    pause(paused, 2000);
    resume(paused, 12000);
    expect(JSON.stringify(paused.orders)).toBe(saved);
    expect(paused.totalCash).toBe(cash);
    expect(advance(paused, settlementAt(paused))).toBe(true);
    const count = paused.orders.length;
    expect(advance(paused, paused.openedAt)).toBe(false);
    expect(paused.orders).toHaveLength(count);
  });
  it("never reads future prices, cannot impersonate bots, and supports a single human", async () => {
    const s = await setup({ makerCashShare: 0 }),
      future = structuredClone(s);
    for (const asset of Object.values(future.assets!))
      asset.path.fill(20000, 1);
    start(s, 1000);
    start(future, 1000);
    expect(s.orders).toEqual(future.orders);
    expect(publicState(s, 1000).maker).toBeNull();
    expect(() => authenticate(s, "")).toThrow();
    expect(() =>
      submit(
        s,
        bots(s)[0].id,
        {
          round: 1,
          side: "PASS",
          price: 0,
          quantity: 0,
          symbol: "BFBT",
          requestId: "spoof-bot",
        },
        1001,
      ),
    ).toThrow();
    const one = await createState(
      { ...config, makerCashShare: 0 },
      "single",
      0,
    );
    expect(() => start(one, 1000)).toThrow();
    addAgent(
      one,
      { id: "solo", name: "Solo", keyHash: "k", description: "" },
      0,
    );
    start(one, 1000);
    expect(bots(one)).toHaveLength(5);
  });
  it("keeps historical markets and explicit no-retail controls unchanged", async () => {
    for (const retailAgents of [undefined, false]) {
      const s = await setup({ rounds: 30, roundMs: 60000, retailAgents });
      start(s, 1000);
      expect(bots(s)).toEqual([]);
      expect(s.orders).toHaveLength(4);
      expect(publicState(s, 1000).retailTraders).toEqual([]);
      while (s.status === "running") clearRound(s, settlementAt(s));
      expect(s.finishedAt! - 1000).toBe(1800000);
    }
  });
  it.each([
    { cash: 0, BFBT: 0, EFET: 0 },
    { cash: 100, BFBT: 0, EFET: 0 },
    { cash: 0, BFBT: 1, EFET: 1 },
  ])(
    "does not overdraw or sell short with depleted allocations %o",
    async (initialBalances) => {
      const s = await setup({ initialBalances, makerCashShare: 0 });
      start(s, 1000);
      while (s.status === "running") clearRound(s, settlementAt(s));
      audit(s);
      expect(bots(s).every((a) => a.cash >= 0)).toBe(true);
      expect(
        s.orders
          .filter((o) => o.side === "PASS")
          .every((o) => o.price === 0 && o.quantity === 0),
      ).toBe(true);
    },
  );
  it("supports legacy DAT with retail enabled without changing legacy history", async () => {
    const s = await setup({
      assetMode: "legacy",
      instruments: undefined,
      newsEnabled: false,
      makerCashShare: 0,
    });
    start(s, 1000);
    while (s.status === "running") clearRound(s, settlementAt(s));
    audit(s);
    expect(s.orders).toHaveLength(1200);
    expect(bots(s).every((a) => a.dat === 0)).toBe(true);
  });
  it("accounts for acquisition cost, partial-sale rounding and final score before redemption", async () => {
    const s = await setup({
      rounds: 3,
      makerCashShare: 0,
      newsEnabled: false,
      instruments: [
        { symbol: "TEST", name: "Test asset", icon: "T", initialPrice: 10000 },
      ],
      initialBalances: { cash: 1000000, TEST: 3 },
    });
    start(s, 1000);
    const bot = bots(s)[0];
    const symbol = "TEST";
    // Control only the test book, retaining real settlement and conservation logic.
    const book = (side: "BUY" | "SELL", quantity: number, price: number) => {
      s.orders = s.orders.filter((o) => o.round !== s.round);
      submit(
        s,
        "a0",
        {
          round: s.round,
          symbol,
          side: side === "BUY" ? "SELL" : "BUY",
          price,
          quantity,
          requestId: `counter-${s.round}`,
        },
        s.openedAt + 1,
      );
      s.orders.push({
        id: `test-bot-${s.round}`,
        requestId: `test-bot-${s.round}`,
        agentId: bot.id,
        symbol,
        round: s.round,
        side,
        price,
        quantity,
        createdAt: s.openedAt + 1,
        filled: 0,
        cashFlow: 0,
        status: "pending",
      });
    };
    book("BUY", 2, 9001);
    clearRound(s, settlementAt(s));
    expect(bot.holdings!.TEST).toBe(5);
    expect(bot.inventoryCost!.TEST).toBe(48002);
    const reference = s.assets!.TEST.path[s.round - 1];
    expect(retailState(s).find((a) => a.id === bot.id)!.score).toBe(
      5 * reference - 48002,
    );
    book("SELL", 2, 12000);
    clearRound(s, settlementAt(s));
    expect(bot.inventoryCost!.TEST).toBe(48002 - Math.floor((48002 * 2) / 5));
    const expected = 3 * s.assets!.TEST.path[2] - bot.inventoryCost!.TEST;
    s.orders = s.orders.filter((o) => o.round !== s.round);
    clearRound(s, settlementAt(s));
    expect(bot.finalUnrealizedPnl).toBe(expected);
    expect(bot.inventoryCost!.TEST).toBe(0);
    expect(retailState(s).find((a) => a.id === bot.id)).toMatchObject({
      score: expected,
      unrealizedPnl: 0,
      scoreFrozen: true,
    });
    audit(s);
  });
  it("full liquidation removes all cost and realized profit contributes no score", async () => {
    const s = await setup({ rounds: 1, makerCashShare: 0 });
    start(s, 1000);
    const bot = bots(s)[0];
    // Sell all initial inventory to a funded counterparty using real matching.
    s.orders = [];
    for (const symbol of ["BFBT", "EFET"]) {
      const q = bot.holdings![symbol];
      s.orders.push(
        {
          id: `sell-${symbol}`,
          requestId: `sell-${symbol}`,
          agentId: bot.id,
          symbol,
          round: 1,
          side: "SELL",
          price: 100,
          quantity: q,
          createdAt: 1001,
          filled: 0,
          cashFlow: 0,
          status: "pending",
        },
        {
          id: `buy-${symbol}`,
          requestId: `buy-${symbol}`,
          agentId: "a0",
          symbol,
          round: 1,
          side: "BUY",
          price: 100,
          quantity: q,
          createdAt: 1001,
          filled: 0,
          cashFlow: 0,
          status: "pending",
        },
      );
    }
    clearRound(s, settlementAt(s));
    expect(bot.finalUnrealizedPnl).toBe(0);
    expect(Object.values(bot.inventoryCost!)).toEqual([0, 0]);
    audit(s);
  });
});

it("completes 240 rounds with 50 participants and five retail traders under accumulated history", async () => {
  const s = await createState(
    { ...config, capacity: 50 },
    "fifty-participants",
    0,
  );
  for (let i = 0; i < 50; i++)
    addAgent(
      s,
      {
        id: `load-${i}`,
        name: `Load ${i}`,
        description: "",
        keyHash: `load-key-${i}`,
      },
      0,
    );
  start(s, 1000);
  while (s.status === "running") {
    for (const a of s.agents.filter((a) => !a.system))
      for (const symbol of ["BFBT", "EFET"]) {
        const account = accountState(s, a),
          side = account.availableHoldings[symbol] > 100 ? "SELL" : "BUY";
        const price = s.assets![symbol].path[s.round - 1];
        const quantity = Math.min(
          2,
          side === "BUY"
            ? Math.floor(account.availableCash / price)
            : account.availableHoldings[symbol],
        );
        submit(
          s,
          a.id,
          {
            round: s.round,
            symbol,
            side: quantity ? side : "PASS",
            price: quantity ? price : 0,
            quantity,
            requestId: `${a.id}:${symbol}:${s.round}`,
          },
          s.openedAt + 1,
        );
      }
    clearRound(s, settlementAt(s));
  }
  const view = publicState(s, s.finishedAt!);
  audit(s);
  expect(s.orders.filter((o) => !o.agentId.startsWith("system-"))).toHaveLength(
    24000,
  );
  expect(view.leaderboard).toHaveLength(50);
  expect(view.retailTraders.every((a) => a.decisions === 240)).toBe(true);
  expect(s.trades.length).toBeGreaterThan(0);
  expect(new Set(s.orders.map((o) => o.id)).size).toBe(s.orders.length);
}, 30000);

it("uses identical final-round decisions and fills when the market is assumed to continue", async () => {
  const finite = await setup();
  start(finite, 1000);
  while (finite.round < 239) clearRound(finite, settlementAt(finite));
  const continuing = structuredClone(finite);
  continuing.config.rounds = 2400;
  // Neither the horizon nor future/terminal prices may enter the policy.
  for (const asset of Object.values(continuing.assets!))
    asset.path.fill(20000, 240);
  clearRound(finite, settlementAt(finite));
  clearRound(continuing, settlementAt(continuing));
  const finalOrders = (s: State) =>
    s.orders.filter(
      (o) => o.round === 240 && o.agentId.startsWith("system-retail:"),
    );
  expect(finalOrders(finite)).toHaveLength(10);
  expect(finalOrders(finite)).toEqual(finalOrders(continuing));
  expect(finalOrders(finite).some((o) => o.side === "BUY")).toBe(true);
  clearRound(finite, settlementAt(finite));
  clearRound(continuing, settlementAt(continuing));
  expect(finite.status).toBe("finished");
  expect(continuing.status).toBe("running");
  expect(finite.trades).toEqual(continuing.trades);
  expect(
    publicState(finite, finite.finishedAt!).retailTraders.every(
      (a) => a.decisionHorizon === "indefinite",
    ),
  ).toBe(true);
});

it("retail policies operate from current observations and retain cash and inventory constraints", () => {
  for (const policy of [
    "Random mix",
    "Dip buyer",
    "Profit taker",
    "Momentum",
    "Inventory balancer",
  ]) {
    const observation = Object.freeze({
      policy,
      reference: 10000,
      previous: 9900,
      owned: 100,
      inventoryCost: 1000000,
      initialInventory: 100,
      availableCash: 1000000,
    });
    expect(
      retailDecision(observation, { side: 0, price: 0.5, quantity: 0.9 }),
    ).toEqual({ side: "BUY", price: 10000, quantity: 10 });
    expect(
      retailDecision(
        { ...observation, availableCash: 0 },
        { side: 0, price: 0.5, quantity: 0.9 },
      ),
    ).toEqual({ side: "SELL", price: 10000, quantity: 10 });
    expect(
      retailDecision(
        { ...observation, availableCash: 0, owned: 0, inventoryCost: 0 },
        { side: 0, price: 0.5, quantity: 0.9 },
      ),
    ).toEqual({ side: "PASS", price: 0, quantity: 0 });
  }
});

it("replays the previous release's full retail ledger byte-for-byte", async () => {
  // Recorded from a51744d's engine: protects existing signed audit histories.
  const s = await createState(
    { ...config, id: "historical-retail", name: "Historical retail" },
    "historical-retail-seed",
    0,
  );
  for (let i = 0; i < 2; i++)
    addAgent(
      s,
      {
        id: `a${i}`,
        name: `Participant ${i}`,
        description: "",
        keyHash: `key${i}`,
      },
      0,
    );
  start(s, 1000);
  while (s.status === "running") clearRound(s, settlementAt(s));
  expect(await sha256(JSON.stringify(s))).toBe(
    "80b9b7456b4ae986d89d4230f1a2c5e3d58548d2aa32bad91d1de818b2394a1c",
  );
});
