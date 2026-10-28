import { describe, it, expect } from "vitest";
import {
  createState,
  addAgent,
  start,
  submit,
  clearRound,
  settlementAt,
  publicState,
  audit,
  sha256,
  reconfigureInstruments,
  accountState,
} from "../worker/engine";
const instruments = [
  { symbol: "ALPHA", name: "星河科技", initialPrice: 2500, icon: "🚀" },
  { symbol: "BETA", name: "蓝海能源", initialPrice: 15000, icon: "🌊" },
  { symbol: "GAMMA", name: "绿洲", initialPrice: 7500, icon: "🌿" },
];
const config = {
  id: "custom-assets",
  name: "Custom market",
  rounds: 5,
  roundMs: 60000,
  capacity: 20,
  practice: true,
  assetMode: "ai" as const,
  newsEnabled: true,
  makerCashShare: 0.2,
  instruments,
  initialBalances: { cash: 1000000, ALPHA: 10, BETA: 20, GAMMA: 30 },
};
function join(s: any, i: number) {
  return addAgent(
    s,
    { id: `a${i}`, name: `Agent ${i}`, keyHash: `key${i}`, description: "" },
    0,
  );
}
describe("configurable instruments", () => {
  it("supports names, icons, independent initial prices, news, reserves and final redemption for three custom symbols", async () => {
    const s = await createState(config, "generic-seed", 0);
    join(s, 0);
    join(s, 1);
    const first = publicState(s, 0);
    expect(
      first.instruments.map((i) => [i.symbol, i.name, i.icon, i.reference]),
    ).toEqual(
      instruments.map((i) => [i.symbol, i.name, i.icon, i.initialPrice]),
    );
    expect(first.initialEquity).toBe(
      1000000 + 10 * 2500 + 20 * 15000 + 30 * 7500,
    );
    expect(Object.keys(first.initialBalances)).toEqual([
      "cash",
      "ALPHA",
      "BETA",
      "GAMMA",
    ]);
    start(s, 1000);
    expect(publicState(s, 1000).maker!.profit).toBe(0);
    for (const i of instruments)
      submit(
        s,
        "a0",
        {
          symbol: i.symbol,
          round: 1,
          side: "BUY",
          price: Math.min(20000, i.initialPrice + 1000),
          quantity: 1,
          requestId: `custom-${i.symbol}`,
        },
        1001,
      );
    while (s.status === "running") {
      expect(
        publicState(s, s.openedAt).news.every((n) => n.round <= s.round),
      ).toBe(true);
      clearRound(s, settlementAt(s));
      audit(s);
    }
    const final = publicState(s, 9999999);
    expect(final.volume).toBeGreaterThan(0);
    expect(await sha256(JSON.stringify(final.reveal))).toBe(s.commitment);
    expect(Object.keys(final.reveal!.paths!)).toEqual([
      "ALPHA",
      "BETA",
      "GAMMA",
    ]);
    expect(
      final.news.every((n) =>
        n.headline.startsWith(
          instruments.find((i) => i.symbol === n.symbol)!.name,
        ),
      ),
    ).toBe(true);
    expect(
      s.agents.every((a) => Object.values(a.holdings!).every((q) => q === 0)),
    ).toBe(true);
  });
  it("reconfigures a lobby with existing identities and credentials and regenerates initial valuations and commitment", async () => {
    const s = await createState(
      { ...config, instruments: undefined },
      "reconfigure-seed",
      0,
    );
    join(s, 0);
    const commitment = s.commitment;
    await reconfigureInstruments(s, instruments, 1);
    expect(s.commitment).not.toBe(commitment);
    expect(s.agents[0].keyHash).toBe("key0");
    expect(accountState(s, s.agents[0]).holdings).toEqual({
      ALPHA: 10,
      BETA: 20,
      GAMMA: 30,
    });
    join(s, 1);
    start(s, 1000);
    await expect(
      reconfigureInstruments(s, instruments.slice(0, 1), 1001),
    ).rejects.toThrow("开赛前");
    audit(s);
  });
  it("keeps boundary-price maker quotes within bounds and strictly separated, including eight assets", async () => {
    const list = Array.from({ length: 8 }, (_, i) => ({
      symbol: `S${i}`,
      name: `Symbol ${i}`,
      icon: "◈",
      initialPrice: i % 2 ? 20000 : 100,
    }));
    const s = await createState(
      { ...config, instruments: list },
      "boundary-config",
      0,
    );
    join(s, 0);
    join(s, 1);
    start(s, 1000);
    const maker = s.agents.at(-1)!;
    expect(accountState(s, maker).availableCash).toBeGreaterThanOrEqual(
      maker.cash * 0.2,
    );
    for (const symbol of list.map((i) => i.symbol)) {
      const bids = s.orders.filter(
        (o) => o.symbol === symbol && o.side === "BUY",
      );
      const asks = s.orders.filter(
        (o) => o.symbol === symbol && o.side === "SELL",
      );
      expect(
        [...bids, ...asks].every((o) => o.price >= 100 && o.price <= 20000),
      ).toBe(true);
      if (bids.length && asks.length)
        expect(bids[0].price).toBeLessThan(asks[0].price);
    }
    while (s.status === "running") clearRound(s, settlementAt(s));
    audit(s);
  });
  it("rejects duplicate/reserved symbols, invalid icon URLs and prices", async () => {
    for (const list of [
      [],
      [...instruments, instruments[0]],
      [{ ...instruments[0], symbol: "DAT" }],
      [{ ...instruments[0], symbol: "__proto__" }],
      [{ ...instruments[0], initialPrice: 99 }],
      [{ ...instruments[0], icon: "javascript:alert(1)" }],
      [
        {
          ...instruments[0],
          icon: "https://user:password@example.com/icon.png",
        },
      ],
    ])
      await expect(
        createState({ ...config, instruments: list }, "invalid", 0),
      ).rejects.toThrow();
  });
});
