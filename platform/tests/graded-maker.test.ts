import { describe, expect, it } from "vitest";
import {
  GRADED_MAKER_POLICY,
  DEFAULT_INSTRUMENTS,
  addAgent,
  audit,
  clearRound,
  createState,
  makerBuyScale,
  makerState,
  publicState,
  settlementAt,
  setInitialBalances,
  start,
  submit,
} from "../worker/engine";

async function market(count = 20, retailAgents = false) {
  const s = await createState({
    id: "graded-maker-test",
    name: "Graduated maker",
    rounds: 240,
    roundMs: 5000,
    capacity: 50,
    practice: true,
    assetMode: "ai",
    instruments: DEFAULT_INSTRUMENTS,
    newsEnabled: true,
    makerCashShare: 0.2,
    makerPolicy: GRADED_MAKER_POLICY,
    autoRedeem: false,
    retailAgents,
  }, "graded-maker-test-seed", 0);
  for (let i = 0; i < count; i++)
    addAgent(s, { id: `a${i}`, name: `Agent ${i}`, keyHash: `key-${i}`, description: "" }, 0);
  return s;
}

function flatPaths(s: Awaited<ReturnType<typeof market>>) {
  for (const asset of Object.values(s.assets!)) asset.path.fill(10000);
}

describe("graduated maker risk controls", () => {
  it.each([
    [1000000, 1], [980001, 1], [980000, 0.75],
    [950001, 0.75], [950000, 0.5], [900001, 0.5],
    [900000, 0.25], [850001, 0.25], [850000, 0],
  ])("scales the buying budget at equity %i", (equity, expected) => {
    expect(makerBuyScale(equity, 1000000)).toBe(expected);
  });

  it("keeps protective bids after a 5% loss and restores buying budgets on recovery", async () => {
    const s = await market();
    flatPaths(s);
    start(s, 1000);
    const maker = s.agents.find(a => a.system === "fundamental-maker")!;
    const originalCash = maker.cash;
    const initial = makerState(s)!.initialEquity;
    maker.cash -= initial * 0.06;
    s.agents[0].cash += initial * 0.06;
    clearRound(s, settlementAt(s));
    const reduced = publicState(s, s.openedAt);
    expect(reduced.maker).toMatchObject({ buyScale: 0.5, riskMode: "reduced-buying" });
    for (const instrument of reduced.instruments) {
      expect(instrument.orderBook.bids[0].quantity).toBeGreaterThan(0);
      expect(instrument.orderBook.bids[0].price).toBeLessThanOrEqual(instrument.reference);
      expect(instrument.orderBook.asks[0].price).toBeGreaterThanOrEqual(instrument.reference);
    }
    s.agents[0].cash -= originalCash - maker.cash;
    maker.cash = originalCash;
    clearRound(s, settlementAt(s));
    expect(makerState(s)).toMatchObject({ buyScale: 1, riskMode: "normal" });
  });

  it("caps inventory and reserves worst-case execution losses across quotes", async () => {
    const s = await market(2);
    flatPaths(s);
    start(s, 1000);
    const maker = s.agents.find(a => a.system === "fundamental-maker")!;
    maker.holdings!.BFBT += 25;
    s.agents[0].holdings!.BFBT -= 25;
    s.agents[0].cash += maker.cash - 175050;
    maker.cash = 175050;
    clearRound(s, settlementAt(s));
    const book = publicState(s, s.openedAt).instruments[0].orderBook;
    expect(book.bids).toEqual([]);
    expect(book.asks).toEqual([{ price: 9975, quantity: 2 }]);
    submit(s, s.agents[0].id, {
      round: 2, symbol: "BFBT", side: "BUY", price: 9975, quantity: 2,
      requestId: "execution-loss-budget",
    }, s.openedAt + 1);
    clearRound(s, settlementAt(s));
    expect(makerState(s)!.equity).toBe(1425000);
    expect(makerState(s)!.buyScale).toBe(0.5);
    expect(publicState(s, s.openedAt).instruments.every(i =>
      i.orderBook.asks.every(a => a.price >= i.reference))).toBe(true);
  });

  it("stops new buys at the severe-loss tier while retaining protective sells", async () => {
    const s = await market();
    flatPaths(s);
    start(s, 1000);
    const maker = s.agents.find(a => a.system === "fundamental-maker")!;
    const loss = makerState(s)!.initialEquity * 0.15;
    maker.cash -= loss;
    s.agents[0].cash += loss;
    clearRound(s, settlementAt(s));
    const view = publicState(s, s.openedAt);
    expect(view.maker).toMatchObject({ buyScale: 0, riskMode: "no-new-buys" });
    expect(view.instruments.every(i =>
      i.orderBook.bids.length === 0 && i.orderBook.asks[0].price >= i.reference)).toBe(true);
  });

  it("provides a bounded buy quote when an instrument starts with no maker inventory", async () => {
    const s = await market(2);
    flatPaths(s);
    setInitialBalances(s, { cash: 1000000, BFBT: 0, EFET: 100 }, 1);
    start(s, 1000);
    const book = publicState(s, s.openedAt).instruments[0].orderBook;
    expect(book.bids[0].quantity).toBeGreaterThan(0);
    expect(book.bids[0].quantity).toBeLessThanOrEqual(5);
    expect(book.asks).toEqual([]);
  });

  it("responds to positive and negative public news through quantities without future inputs", async () => {
    const states = await Promise.all([market(), market(), market()]);
    for (const [index, s] of states.entries()) {
      flatPaths(s);
      s.assets!.BFBT.path.fill([9000, 10000, 11000][index], 1);
      start(s, 1000);
    }
    expect(states[0].orders).toEqual(states[1].orders);
    expect(states[2].orders).toEqual(states[1].orders);
    const sizes = states.map(s => {
      clearRound(s, settlementAt(s));
      const book = publicState(s, s.openedAt).instruments[0].orderBook;
      return [book.bids[0].quantity, book.asks[0].quantity];
    });
    expect(sizes[0][0]).toBeLessThan(sizes[1][0]);
    expect(sizes[1][0]).toBeLessThan(sizes[2][0]);
    expect(sizes[0][1]).toBeGreaterThan(sizes[1][1]);
    expect(sizes[1][1]).toBeGreaterThan(sizes[2][1]);
  });

  it("uses final-price protection only for redeeming competitions", async () => {
    const s = await market(2);
    flatPaths(s);
    start(s, 1000);
    const maker = s.agents.find(a => a.system === "fundamental-maker")!;
    maker.holdings!.BFBT += 25;
    maker.holdings!.EFET -= 25;
    s.agents[0].holdings!.BFBT -= 25;
    s.agents[0].holdings!.EFET += 25;
    const short = structuredClone(s);
    short.config.rounds = 2;
    const redeeming = structuredClone(short);
    redeeming.config.autoRedeem = true;
    for (const state of [s, short, redeeming]) clearRound(state, settlementAt(state));
    const quotes = (state: typeof s) => state.orders.filter(o => o.round === 2 && o.agentId === maker.id);
    expect(quotes(short)).toEqual(quotes(s));
    for (const order of quotes(redeeming))
      expect(order.side === "BUY" ? order.price <= 10000 : order.price >= 10000).toBe(true);
    expect(quotes(short).some(o => o.side === "SELL" && o.price < 10000)).toBe(true);
  });

  it("finishes 240 rounds with five retail traders, finite balances and retained holdings", async () => {
    const s = await market(3, true);
    start(s, 1000);
    const first = publicState(s, s.openedAt);
    expect(first.retailTraders).toHaveLength(5);
    expect(first.maker!.id).toBe(`system-maker:${s.config.id}`);
    while (s.status === "running") {
      clearRound(s, settlementAt(s));
      audit(s);
    }
    const final = publicState(s, s.openedAt);
    expect(s.results).toHaveLength(240);
    expect(final.maker!.policy).toBe(GRADED_MAKER_POLICY);
    expect(final.retailTraders.every(a => a.scoreFrozen && a.decisionHorizon === "indefinite")).toBe(true);
    expect(s.events.some(e => e.type === "redeemed")).toBe(false);
    const maker = s.agents.find(a => a.system === "fundamental-maker")!;
    expect(final.maker!.equity).toBe(maker.cash + final.instruments.reduce(
      (sum, i) => sum + maker.holdings![i.symbol] * i.reference, 0));
    expect(s.agents.every(a => a.cash >= 0)).toBe(true);
  });
});
