import { describe, it, expect } from "vitest";
import {
  createState,
  setInitialBalances,
  addAgent,
  start,
  clearRound,
  settlementAt,
  submit,
  publicState,
  accountState,
  authenticate,
  sha256,
  audit,
  pause,
  resume,
  MAKER_POLICY_V2,
  type MarketConfig,
} from "../worker/engine";
const config = {
  id: "news-test",
  name: "News market",
  rounds: 30,
  roundMs: 60000,
  capacity: 20,
  practice: true,
  assetMode: "ai" as const,
  newsEnabled: true,
  makerCashShare: 0.2,
};
async function setup(share = 0.2, count = 2, overrides: Partial<MarketConfig> = {}) {
  const s = await createState(
    { ...config, makerCashShare: share, ...overrides },
    "news-test-seed",
    0,
  );
  for (let i = 0; i < count; i++)
    addAgent(
      s,
      { id: `a${i}`, name: `Agent ${i}`, keyHash: `key${i}`, description: "" },
      0,
    );
  return s;
}

describe("risk-limited market maker", () => {
  async function startWithNews(openai: number, anthropic = 10000, count = 2) {
    const s = await setup(0.2, count, { makerPolicy: MAKER_POLICY_V2, rounds: 3 });
    // Fix the public marks in these fixtures so each guard can be tested independently.
    s.assets!.OPENAI.path.fill(openai, 1);
    s.assets!.ANTHROPIC.path.fill(anthropic, 1);
    start(s, 1000);
    return s;
  }

  it("shifts both quote sizes with the public news while future marks cannot affect quotes", async () => {
    const flat = await startWithNews(10000, 10000, 20);
    const positive = await startWithNews(11000, 10000, 20);
    const negative = await startWithNews(9000, 10000, 20);
    expect(positive.orders).toEqual(flat.orders);
    expect(negative.orders).toEqual(flat.orders);
    for (const s of [flat, positive, negative]) clearRound(s, settlementAt(s));
    const quantities = [negative, flat, positive].map((s) => {
      const book = publicState(s, s.openedAt).instruments[0].orderBook;
      return { bid: book.bids[0].quantity, ask: book.asks[0].quantity };
    });
    expect(quantities[0].bid).toBeLessThan(quantities[1].bid);
    expect(quantities[1].bid).toBeLessThan(quantities[2].bid);
    expect(quantities[0].ask).toBeGreaterThan(quantities[1].ask);
    expect(quantities[1].ask).toBeGreaterThan(quantities[2].ask);
  });

  it("clamps final quotes to the public redemption price even with skewed inventory", async () => {
    const s = await startWithNews(10000);
    const maker = s.agents.find((a) => a.system)!;
    maker.holdings!.OPENAI += 25;
    maker.holdings!.ANTHROPIC -= 25;
    s.agents[0].holdings!.OPENAI -= 25;
    s.agents[0].holdings!.ANTHROPIC += 25;
    clearRound(s, settlementAt(s));
    const [beforeOpenAI, beforeAnthropic] = publicState(s, s.openedAt).instruments;
    expect(beforeOpenAI.orderBook.asks[0].price).toBeLessThan(10000);
    expect(beforeAnthropic.orderBook.bids[0].price).toBeGreaterThan(10000);
    clearRound(s, settlementAt(s));
    const final = publicState(s, s.openedAt);
    expect(final.maker?.policy).toBe(MAKER_POLICY_V2);
    expect(final.instruments[0].orderBook.asks[0].price).toBe(10000);
    expect(final.instruments[1].orderBook.bids[0].price).toBe(10000);
  });

  it("caps inventory and reserves the loss budget at the worst allowed fill price", async () => {
    const s = await startWithNews(10000);
    const maker = s.agents.find((a) => a.system)!;
    maker.holdings!.OPENAI += 25;
    s.agents[0].holdings!.OPENAI -= 25;
    s.agents[0].cash += maker.cash - 175050;
    maker.cash = 175050;
    clearRound(s, settlementAt(s));
    const book = publicState(s, s.openedAt).instruments[0].orderBook;
    expect(book.bids).toEqual([]);
    expect(book.asks).toEqual([{ price: 9975, quantity: 2 }]);
    submit(s, s.agents[0].id, {
      round: 2, symbol: "OPENAI", side: "BUY", price: 9975, quantity: 2,
      requestId: "maker-loss-bound",
    }, s.openedAt + 1);
    clearRound(s, settlementAt(s));
    const atFloor = publicState(s, s.openedAt);
    expect(atFloor.maker?.equity).toBe(1425000);
    expect(atFloor.instruments.every((i) => !i.orderBook.bids.length)).toBe(true);
  });

  it("keeps protective sell quotes after a public shock crosses the loss threshold", async () => {
    const s = await startWithNews(9000, 9000);
    clearRound(s, settlementAt(s));
    const snapshot = publicState(s, s.openedAt);
    expect(snapshot.maker?.equity).toBeLessThan(snapshot.maker!.initialEquity * 0.95);
    for (const instrument of snapshot.instruments) {
      expect(instrument.orderBook.bids).toEqual([]);
      expect(instrument.orderBook.asks[0].price).toBeGreaterThanOrEqual(9000);
    }
  });

  it("can provide a buy quote with zero starting inventory", async () => {
    const s = await setup(0.2, 2, {
      makerPolicy: MAKER_POLICY_V2,
      initialBalances: { cash: 1000000, OPENAI: 0, ANTHROPIC: 100 },
    });
    start(s, 1000);
    const { orderBook } = publicState(s, s.openedAt).instruments[0];
    expect(orderBook.bids[0].quantity).toBeGreaterThan(0);
    expect(orderBook.bids[0].quantity).toBeLessThanOrEqual(5);
    expect(orderBook.asks).toEqual([]);
  });
});

describe("random public news and a single capital-funded maker", () => {
  it("commits deterministic news, exposes it only at release, and redeems at the last known fundamental", async () => {
    const s = await setup();
    const copy = await setup();
    expect(s.news!.length).toBeGreaterThan(0);
    expect(s.news).toEqual(copy.news);
    expect(s.commitment).toBe(copy.commitment);
    expect(publicState(s, 0).news).toEqual([]);
    start(s, 1000);
    while (s.status === "running") {
      const view = publicState(s, s.openedAt);
      expect(view.reveal).toBeNull();
      expect(view.news.every((n) => n.round <= s.round)).toBe(true);
      expect(view.instruments.every((i) => i.history.length === s.round)).toBe(
        true,
      );
      for (const n of view.news.filter((n) => n.round === s.round))
        expect(
          view.instruments.find((i) => i.symbol === n.symbol)!.reference,
        ).toBe(n.after);
      clearRound(s, settlementAt(s));
    }
    for (const i of publicState(s, 9999999).instruments)
      expect(i.history.at(-1)).toBe(i.history.at(-2));
    expect(await sha256(JSON.stringify(publicState(s, 9999999).reveal))).toBe(
      s.commitment,
    );
    expect(s.events.filter((e) => e.type === "news_published")).toHaveLength(
      s.news!.length,
    );
    audit(s);
  });
  it.each([0.05, 0.2, 0.5])(
    "allocates %.2f cash share once, preserves ordinary endowments and keeps maker out of ranks",
    async (share) => {
      const s = await setup(share, 20);
      start(s, 1000);
      const maker = publicState(s, 1000).maker!;
      expect(Math.abs(maker.cashShare - share)).toBeLessThan(1e-7);
      expect(s.agents.filter((a) => a.system)).toHaveLength(1);
      expect(
        s.agents
          .filter((a) => !a.system)
          .every((a) => a.cash === 1_000_000 && a.holdings!.OPENAI === 100),
      ).toBe(true);
      expect(publicState(s, 1000).leaderboard).toHaveLength(20);
      expect(publicState(s, 1000).participantCount).toBe(20);
      expect(maker.profit).toBe(0);
      expect(() => start(s, 1001)).toThrow();
      expect(s.agents).toHaveLength(21);
      audit(s);
    },
  );
  it("cannot authenticate, submit user decisions or self-trade as the system maker", async () => {
    const s = await setup();
    start(s, 1000);
    const maker = s.agents.find((a) => a.system)!;
    expect(() => authenticate(s, "")).toThrow();
    expect(() =>
      submit(
        s,
        maker.id,
        {
          round: 1,
          symbol: "OPENAI",
          side: "BUY",
          price: 10000,
          quantity: 1,
          requestId: "spoof-maker",
        },
        1001,
      ),
    ).toThrow();
    clearRound(s, settlementAt(s));
    expect(s.trades).toHaveLength(0);
    audit(s);
  });
  it("posts quotes before orders, never reads future fundamentals, and respects shared collateral", async () => {
    const s = await setup(0.5, 20);
    const copy = structuredClone(s);
    copy.assets!.OPENAI.path.fill(17500, 1);
    copy.assets!.ANTHROPIC.path.fill(2500, 1);
    start(s, 1000);
    start(copy, 1000);
    expect(s.orders).toEqual(copy.orders);
    expect(s.orders).toHaveLength(4);
    const maker = s.agents.find((a) => a.system)!;
    const account = accountState(s, maker);
    expect(account.availableCash).toBeGreaterThanOrEqual(maker.cash * 0.8);
    expect(account.availableHoldings.OPENAI).toBeGreaterThanOrEqual(
      maker.holdings!.OPENAI * 0.9,
    );
    expect(s.orders.some((o) => o.quantity > 10)).toBe(true);
    expect(() =>
      submit(
        s,
        "a0",
        {
          round: 1,
          symbol: "OPENAI",
          side: "BUY",
          price: 10000,
          quantity: 11,
          requestId: "over-limit",
        },
        1001,
      ),
    ).toThrow();
    const before = s.orders.length;
    pause(s, 2000);
    resume(s, 4000);
    expect(s.orders).toHaveLength(before);
  });
  it("matches ordinary agents against maker in both assets and preserves PnL transfers on redemption", async () => {
    const s = await setup();
    start(s, 1000);
    for (const symbol of ["OPENAI", "ANTHROPIC"] as const) {
      submit(
        s,
        "a0",
        {
          round: 1,
          symbol,
          side: "BUY",
          price: 12000,
          quantity: 5,
          requestId: `buy-${symbol}`,
        },
        1001,
      );
    }
    clearRound(s, settlementAt(s));
    for (const symbol of ["OPENAI", "ANTHROPIC"] as const)
      submit(
        s,
        "a1",
        {
          round: 2,
          symbol,
          side: "SELL",
          price: 100,
          quantity: 2,
          requestId: `sell-${symbol}`,
        },
        s.openedAt + 1,
      );
    while (s.status === "running") clearRound(s, settlementAt(s));
    const result = publicState(s, 999999);
    expect(result.maker!.volume).toBeGreaterThan(0);
    expect(result.maker!.volumeShare).toBeGreaterThan(0);
    expect(
      s.agents.every(
        (a) => a.holdings!.OPENAI === 0 && a.holdings!.ANTHROPIC === 0,
      ),
    ).toBe(true);
    const end = result.instruments.reduce((n, i) => n + i.reference, 0);
    expect(s.agents.reduce((n, a) => n + a.cash, 0)).toBe(
      2 * (1_000_000 + 100 * end) +
        result.maker!.initialCash +
        s.agents.find((a) => a.system)!.initialHoldings! * end,
    );
    audit(s);
  });
  it("supports a zero-maker control and rejects invalid configuration", async () => {
    const s = await setup(0);
    start(s, 1000);
    expect(publicState(s, 1000).maker).toBeNull();
    expect(s.orders).toHaveLength(0);
    for (const makerCashShare of [-0.05, 0.075, 0.55, NaN])
      await expect(
        createState({ ...config, makerCashShare }, "invalid", 0),
      ).rejects.toThrow();
    await expect(
      createState({ ...config, newsEnabled: false }, "invalid", 0),
    ).rejects.toThrow();
    await expect(
      createState({ ...config, assetMode: "legacy" }, "invalid", 0),
    ).rejects.toThrow();
  });
});

describe("organizer initial balances", () => {
  const balances = { cash: 123456, DAT: 5, OPENAI: 25, ANTHROPIC: 250 };
  it("applies to existing and future agents and recalculates maker funding and all profit baselines", async () => {
    const s = await setup();
    setInitialBalances(s, balances, 1);
    addAgent(
      s,
      {
        id: "later",
        name: "Later agent",
        keyHash: "later-key",
        description: "",
      },
      2,
    );
    expect(
      s.agents.every(
        (a) =>
          a.cash === 123456 &&
          a.holdings!.OPENAI === 25 &&
          a.holdings!.ANTHROPIC === 250,
      ),
    ).toBe(true);
    expect(s.totalCash).toBe(3 * 123456 + 3 * 275 * 20000);
    start(s, 1000);
    const view = publicState(s, 1000);
    expect(view.initialEquity).toBe(123456 + 275 * 10000);
    expect(view.leaderboard.every((a) => a.profit === 0)).toBe(true);
    expect(view.maker!.initialInventory).toEqual({
      OPENAI: 18,
      ANTHROPIC: 187,
    });
    expect(view.maker!.profit).toBe(0);
    expect(view.maker!.cashShare).toBeCloseTo(0.2, 5);
    while (s.status === "running") clearRound(s, settlementAt(s));
    expect(publicState(s, 99999999).maker!.profit).toBe(
      s.agents.at(-1)!.cash - view.maker!.initialEquity,
    );
    audit(s);
  });
  it("uses configured balances at registration and cannot reset a running or paused match", async () => {
    const s = await createState(
      { ...config, initialBalances: balances },
      "custom-balance",
      0,
    );
    addAgent(
      s,
      { id: "one", name: "One agent", keyHash: "one", description: "" },
      0,
    );
    expect(s.agents[0].holdings).toEqual({ OPENAI: 25, ANTHROPIC: 250 });
    start(s, 1000);
    const saved = JSON.stringify(s);
    expect(() =>
      setInitialBalances(s, { ...balances, cash: 999 }, 1001),
    ).toThrow("开赛前");
    expect(JSON.stringify(s)).toBe(saved);
    pause(s, 1002);
    expect(() => setInitialBalances(s, balances, 1003)).toThrow("开赛前");
  });
  it("rejects negative, fractional, oversized and zero-cash maker allocations without mutation", async () => {
    const s = await setup();
    const before = JSON.stringify(s);
    for (const b of [
      { ...balances, cash: -1 },
      { ...balances, cash: 0 },
      { ...balances, cash: 1.5 },
      { ...balances, OPENAI: 0.5 },
      { ...balances, ANTHROPIC: 100001 },
    ]) {
      expect(() => setInitialBalances(s, b, 1)).toThrow();
      expect(JSON.stringify(s)).toBe(before);
    }
  });
  it("supports zero stock inventory and legacy DAT funding", async () => {
    const s = await createState(
      { ...config, assetMode: "legacy", newsEnabled: false, makerCashShare: 0 },
      "legacy-balance",
      0,
    );
    addAgent(
      s,
      { id: "one", name: "One agent", keyHash: "one", description: "" },
      0,
    );
    setInitialBalances(s, { ...balances, cash: 0, DAT: 0 }, 1);
    expect(s.totalCash).toBe(0);
    expect(s.totalDat).toBe(0);
    audit(s);
  });
});
