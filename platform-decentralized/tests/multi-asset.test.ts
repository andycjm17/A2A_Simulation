import { describe, it, expect } from "vitest";
import {
  createState,
  addAgent,
  start,
  submit,
  clearRound,
  accountState,
  publicState,
  audit,
  sha256,
  type State,
  type Decision,
} from "../worker/engine";
const config = {
  id: "ai-unit",
  name: "AI market",
  assetMode: "ai" as const,
  practice: true,
  rounds: 3,
  roundMs: 60000,
  capacity: 100,
};
async function setup(count = 3) {
  const s = await createState(config, "dual-asset-seed", 0);
  for (let i = 0; i < count; i++)
    addAgent(
      s,
      { id: `a${i}`, name: `Agent ${i}`, description: "", keyHash: `key${i}` },
      0,
    );
  start(s, 1000);
  return s;
}
function order(
  s: State,
  agent: string,
  symbol: "OPENAI" | "ANTHROPIC",
  side: Decision["side"],
  price = 10000,
  quantity = 2,
) {
  return submit(
    s,
    agent,
    {
      round: s.round,
      symbol,
      side,
      price,
      quantity,
      requestId: `${agent}-${symbol}-${s.round}`,
    },
    s.openedAt + 1,
  );
}
const end = (s: State) => clearRound(s, s.openedAt + s.config.roundMs);
describe("two instruments sharing cash", () => {
  it("starts with independent holdings, values both paths, and redeems both with conserved totals", async () => {
    const s = await setup();
    const a = s.agents[0];
    expect(accountState(s, a)).toMatchObject({
      cash: 1000000,
      dat: 0,
      holdings: { OPENAI: 100, ANTHROPIC: 100 },
    });
    expect(publicState(s, 1000).leaderboard[0]).toMatchObject({
      equity: 3000000,
      profit: 0,
    });
    expect(s.assets!.OPENAI.path).not.toEqual(s.assets!.ANTHROPIC.path);
    const expected =
      a.cash +
      100 * s.assets!.OPENAI.path[3] +
      100 * s.assets!.ANTHROPIC.path[3];
    end(s);
    end(s);
    end(s);
    audit(s);
    expect(a.holdings).toEqual({ OPENAI: 0, ANTHROPIC: 0 });
    expect(a.cash).toBe(expected);
    expect(await sha256(JSON.stringify(publicState(s, 999999).reveal))).toBe(
      s.commitment,
    );
  });
  it("cannot spend the same shared cash twice; rejected orders do not reserve funds", async () => {
    const s = await setup();
    s.agents[0].cash = 250000;
    s.treasuryCash += 750000;
    order(s, "a0", "OPENAI", "BUY", 20000, 10);
    expect(accountState(s, s.agents[0]).availableCash).toBe(50000);
    expect(() => order(s, "a0", "ANTHROPIC", "BUY", 20000, 3)).toThrow(
      "现金不足",
    );
    order(s, "a0", "ANTHROPIC", "BUY", 20000, 2);
    expect(accountState(s, s.agents[0]).availableCash).toBe(10000);
    end(s);
    expect(accountState(s, s.agents[0]).availableCash).toBe(250000);
    audit(s);
  });
  it("does not match OpenAI buys with Anthropic sells, supports both directions with separate inventory", async () => {
    const s = await setup();
    order(s, "a0", "OPENAI", "BUY", 11000);
    order(s, "a1", "ANTHROPIC", "SELL", 9000);
    end(s);
    expect(s.trades).toHaveLength(0);
    order(s, "a0", "OPENAI", "BUY", 11000);
    order(s, "a1", "OPENAI", "SELL", 9000);
    order(s, "a0", "ANTHROPIC", "SELL", 11000);
    order(s, "a1", "ANTHROPIC", "BUY", 13000);
    end(s);
    expect(s.trades.map((t) => [t.symbol, t.price])).toEqual([
      ["OPENAI", 10000],
      ["ANTHROPIC", 12000],
    ]);
    expect(s.agents[0].holdings).toEqual({ OPENAI: 102, ANTHROPIC: 98 });
    expect(
      publicState(s, 1000).leaderboard.find((a) => a.id === "a0")!.decisions,
    ).toBe(2);
    audit(s);
  });
  it("requires valid symbols and binds idempotency across both instruments", async () => {
    const s = await setup();
    expect(() =>
      submit(
        s,
        "a0",
        {
          round: 1,
          side: "PASS",
          price: 0,
          quantity: 0,
          requestId: "missing-symbol",
        },
        1001,
      ),
    ).toThrow("本场标的");
    const o = order(s, "a0", "OPENAI", "BUY");
    expect(submit(s, "a0", o, 1001)).toBe(o);
    expect(() => submit(s, "a0", { ...o, symbol: "ANTHROPIC" }, 1001)).toThrow(
      "不同订单",
    );
    expect(() => order(s, "a0", "OPENAI", "SELL")).toThrow();
    order(s, "a0", "ANTHROPIC", "SELL");
    expect(s.orders).toHaveLength(2);
  });
  it("rejects short selling in either instrument and releases expired sell reservations", async () => {
    const s = await setup();
    s.agents[0].holdings!.ANTHROPIC = 1;
    s.assets!.ANTHROPIC.total -= 99;
    expect(() => order(s, "a0", "ANTHROPIC", "SELL", 10000, 2)).toThrow(
      "ANTHROPIC 不足",
    );
    order(s, "a0", "OPENAI", "SELL", 10000, 10);
    expect(accountState(s, s.agents[0]).availableHoldings).toEqual({
      OPENAI: 90,
      ANTHROPIC: 1,
    });
    end(s);
    expect(accountState(s, s.agents[0]).availableHoldings.OPENAI).toBe(100);
    audit(s);
  });
});
describe("public market data", () => {
  it("aggregates by price, sorts each side, limits to five levels, and excludes private metadata", async () => {
    const s = await setup(17);
    for (let i = 0; i < 8; i++) {
      order(s, `a${i}`, "OPENAI", "BUY", 9000 + i * 100, i === 7 ? 4 : 2);
      order(s, `a${i + 8}`, "OPENAI", "SELL", 11000 + i * 100, 3);
    }
    order(s, "a8", "ANTHROPIC", "BUY", 8000, 5);
    // Aggregate an additional agent at the best bid.
    const extra = order(s, "a16", "OPENAI", "BUY", 9700, 2);
    extra.note = "private-strategy";
    const p = publicState(s, 1001),
      book = p.instruments[0].orderBook;
    expect(book.bids).toEqual(
      [9700, 9600, 9500, 9400, 9300].map((price, i) => ({
        price,
        quantity: i === 0 ? 6 : 2,
      })),
    );
    expect(book.asks).toEqual(
      [11000, 11100, 11200, 11300, 11400].map((price) => ({
        price,
        quantity: 3,
      })),
    );
    expect(p.instruments[1].orderBook.bids).toEqual([
      { price: 8000, quantity: 5 },
    ]);
    expect(JSON.stringify(book)).not.toContain("agentId");
    expect(JSON.stringify(p)).not.toContain("private-strategy");
    expect(JSON.stringify(p)).not.toContain(extra.requestId);
  });
  it("shows actual OHLC/volume, leaves empty rounds blank, and clears expired depth", async () => {
    const s = await setup(4);
    order(s, "a0", "OPENAI", "BUY", 12000, 4);
    order(s, "a1", "OPENAI", "SELL", 8000, 2);
    order(s, "a2", "OPENAI", "SELL", 10000, 2);
    end(s);
    const i = publicState(s, 61000).instruments[0];
    expect(i.candles[0]).toMatchObject({
      round: 1,
      open: 10000,
      high: 11000,
      low: 10000,
      close: 11000,
      volume: 4,
      trades: 2,
    });
    expect(i.orderBook).toEqual({ bids: [], asks: [] });
    end(s);
    expect(publicState(s, 121000).instruments[0].candles[1]).toMatchObject({
      open: null,
      high: null,
      low: null,
      close: null,
      volume: 0,
    });
    expect(
      publicState(s, 121000).instruments[1].candles.every(
        (c) => c.close === null,
      ),
    ).toBe(true);
  });
  it("never reveals future prices in public data before finish", async () => {
    const s = await setup();
    const p = publicState(s, 1001);
    expect(p.reveal).toBeNull();
    expect(p.instruments.every((i) => i.history.length === 1)).toBe(true);
    expect(JSON.stringify(p)).not.toContain(s.seed);
    expect(JSON.stringify(p)).not.toContain("key0");
  });
});
