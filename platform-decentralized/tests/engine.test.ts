import { describe, it, expect } from "vitest";
import { integrityReview } from "../worker/integrity";
import {
  createState,
  addAgent,
  start,
  submit,
  clearRound,
  advance,
  pause,
  resume,
  audit,
  publicState,
  accountState,
  sha256,
  generatePath,
  MarketError,
  type State,
  type Decision,
} from "../worker/engine";
const cfg = {
  id: "unit-market",
  name: "Unit market",
  rounds: 30,
  roundMs: 60000,
  capacity: 50,
  practice: false,
};
async function setup(n = 2) {
  const s = await createState(cfg, "fixed-test-seed", 0);
  for (let i = 0; i < n; i++)
    addAgent(
      s,
      {
        id: `a${i}`,
        name: `Agent ${i}`,
        description: "test",
        keyHash: `hash${i}`,
      },
      0,
    );
  start(s, 1000);
  return s;
}
const buy: Decision = {
  round: 1,
  side: "BUY",
  price: 11000,
  quantity: 10,
  requestId: "buy-order-1",
};
const sell: Decision = {
  round: 1,
  side: "SELL",
  price: 9000,
  quantity: 10,
  requestId: "sell-order-1",
};
const end = (s: State) => s.openedAt + s.config.roundMs;
describe("competition manipulation review", () => {
  it("colluding agents can transfer ranking value but trigger settled-price review", async () => {
    const s = await setup(3);
    submit(s, "a0", { ...buy, price: 100 }, 2000);
    submit(s, "a1", { ...sell, price: 100 }, 2000);
    expect(integrityReview(s).requiresReview).toBe(false); // Do not inspect sealed orders.
    clearRound(s, end(s));
    const value = (id: string) => {
      const a = s.agents.find((a) => a.id === id)!;
      return a.cash + a.dat * 10000;
    };
    expect(value("a0") - value("a2")).toBe(99000);
    expect(value("a2") - value("a1")).toBe(99000);
    expect(integrityReview(s)).toMatchObject({
      requiresReview: true,
      offReferenceTrades: 1,
      flaggedPairs: 1,
      pairs: [
        { agentIds: ["a0", "a1"], maxDeviationBps: 9900, concentrated: false },
      ],
    });
    audit(s); // Accounting correctness does not imply contest fairness.
  });
  it("normal midpoint fills and empty markets do not trigger price review", async () => {
    const s = await setup();
    expect(integrityReview(s).requiresReview).toBe(false);
    submit(s, "a0", buy, 2000);
    submit(s, "a1", sell, 2000);
    clearRound(s, end(s));
    expect(integrityReview(s).requiresReview).toBe(false);
  });
  it("uses the public opening reference and flags the inclusive 25 percent boundary", async () => {
    const s = await setup();
    s.trades = [2499, 2500].map((deviation, i) => ({
      id: `t${i}`,
      round: 1,
      buyer: "a0",
      seller: "a1",
      price: 10000 + deviation,
      quantity: 1,
      at: 61000,
    }));
    s.path[1] = 19000;
    expect(integrityReview(s).offReferenceTrades).toBe(1);
  });
  it("concentration is a review signal only with sufficient fills and participants", async () => {
    const s = await setup(3);
    s.trades = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      round: 1,
      buyer: "a0",
      seller: "a1",
      price: 10000,
      quantity: 1,
      at: 61000,
    }));
    expect(integrityReview(s).pairs[0].concentrated).toBe(true);
    s.agents.pop();
    expect(integrityReview(s).requiresReview).toBe(false);
  });
});
describe("matching and accounting", () => {
  it("midpoint matching transfers both assets and preserves total supply", async () => {
    const s = await setup();
    submit(s, "a0", buy, 2000);
    submit(s, "a1", sell, 2000);
    clearRound(s, end(s));
    expect(s.trades[0]).toMatchObject({ price: 10000, quantity: 10 });
    expect(s.agents[0]).toMatchObject({ cash: 900000, dat: 110 });
    expect(s.agents[1]).toMatchObject({ cash: 1100000, dat: 90 });
    expect(() => audit(s)).not.toThrow();
  });
  it("no compatible prices => no fabricated trade", async () => {
    const s = await setup();
    submit(s, "a0", { ...buy, price: 8000 }, 2000);
    submit(s, "a1", sell, 2000);
    clearRound(s, end(s));
    expect(s.trades).toHaveLength(0);
    expect(s.orders.map((o) => o.status)).toEqual(["expired", "expired"]);
  });
  it("fills multiple counterparties and expires remaining volume", async () => {
    const s = await setup(3);
    submit(s, "a0", buy, 2000);
    submit(s, "a1", { ...sell, quantity: 4 }, 2000);
    submit(s, "a2", { ...sell, quantity: 3, requestId: "sell-order-2" }, 2000);
    clearRound(s, end(s));
    expect(s.orders[0]).toMatchObject({ filled: 7, status: "partial" });
    expect(s.trades).toHaveLength(2);
    audit(s);
  });
  it("uses price priority then deterministic tie order, independent of arrival", async () => {
    const a = await setup(4),
      b = structuredClone(a);
    const orders = [
      ["a0", buy],
      ["a1", { ...buy, price: 12000, requestId: "other-buy" }],
      ["a2", sell],
      ["a3", { ...sell, requestId: "other-sell" }],
    ] as const;
    for (const [id, d] of orders) submit(a, id, d, 2000);
    for (const [id, d] of [...orders].reverse()) submit(b, id, d, 2000);
    clearRound(a, end(a));
    clearRound(b, end(b));
    expect(a.trades).toEqual(b.trades);
    expect(a.trades[0].buyer).toBe("a1");
  });
  it("rounds midpoint down to a cent", async () => {
    const s = await setup();
    submit(s, "a0", { ...buy, price: 11001 }, 2000);
    submit(s, "a1", sell, 2000);
    clearRound(s, end(s));
    expect(s.trades[0].price).toBe(10000);
  });
  it("reserves pending cash only in availability and releases on expiry", async () => {
    const s = await setup();
    submit(s, "a0", buy, 2000);
    expect(accountState(s, s.agents[0]).availableCash).toBe(890000);
    expect(s.agents[0].cash).toBe(1000000);
    clearRound(s, end(s));
    expect(accountState(s, s.agents[0]).availableCash).toBe(1000000);
  });
  it("replays identical request after settlement without mutation", async () => {
    const s = await setup();
    const first = submit(s, "a0", buy, 2000);
    clearRound(s, end(s));
    const before = JSON.stringify(s);
    expect(submit(s, "a0", buy, 999999)).toEqual(first);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("rejects conflicting retry and second decision", async () => {
    const s = await setup();
    submit(s, "a0", buy, 2000);
    expect(() => submit(s, "a0", { ...buy, quantity: 2 }, 2000)).toThrow(
      "同一请求",
    );
    expect(() =>
      submit(s, "a0", { ...buy, requestId: "different-id" }, 2000),
    ).toThrow("每轮");
  });
  it("rejects insufficient cash and naked sells", async () => {
    const s = await setup();
    s.agents[0].cash = 1;
    s.agents[1].dat = 0;
    expect(() => submit(s, "a0", buy, 2000)).toThrow("现金不足");
    expect(() => submit(s, "a1", sell, 2000)).toThrow("DAT 不足");
  });
  it.each([
    { price: 1 },
    { price: 20001 },
    { price: 1.2 },
    { price: NaN },
    { quantity: 0 },
    { quantity: 11 },
    { quantity: 1.5 },
    { quantity: Infinity },
    { side: "BOGUS" },
  ])("rejects invalid input %j", async (fields) => {
    const s = await setup();
    expect(() =>
      submit(s, "a0", { ...buy, ...fields } as Decision, 2000),
    ).toThrow(MarketError);
  });
  it("PASS is zero quantity and cannot silently buy", async () => {
    const s = await setup();
    expect(() => submit(s, "a0", { ...buy, side: "PASS" }, 2000)).toThrow();
    submit(s, "a0", { ...buy, side: "PASS", price: 0, quantity: 0 }, 2000);
    clearRound(s, end(s));
    expect(s.trades).toHaveLength(0);
    expect(s.orders[0].status).toBe("pass");
  });
  it("does not allow spoofing unknown agents", async () => {
    const s = await setup();
    expect(() => submit(s, "unknown", buy, 2000)).toThrow("找不到");
  });
});
describe("clock, lifecycle and secrecy", () => {
  it("accepts immediately before deadline, rejects at deadline and future round", async () => {
    const s = await setup();
    submit(s, "a0", buy, 55999);
    expect(() => submit(s, "a1", sell, 56000)).toThrow("窗口");
    expect(() => submit(s, "a1", { ...sell, round: 2 }, 2000)).toThrow("轮次");
    expect(() => clearRound(s, 60999)).toThrow("结算时间");
  });
  it("pause/resume preserves remaining time and decision", async () => {
    const s = await setup();
    submit(s, "a0", buy, 2000);
    pause(s, 21000);
    expect(advance(s, 500000)).toBe(false);
    expect(() => submit(s, "a1", sell, 30000)).toThrow("未开放");
    resume(s, 41000);
    expect(s.openedAt).toBe(21000);
    expect(s.orders).toHaveLength(1);
    expect(() => clearRound(s, 80999)).toThrow();
    clearRound(s, 81000);
    expect(s.round).toBe(2);
  });
  it("long scheduler outage settles once and pauses instead of skipping rounds", async () => {
    const s = await setup();
    expect(advance(s, 181000)).toBe(true);
    expect(s.results).toHaveLength(1);
    expect(s.status).toBe("paused");
    expect(advance(s, 9999999)).toBe(false);
  });
  it("duplicate alarm cannot settle the next round early", async () => {
    const s = await setup();
    advance(s, 61000);
    expect(advance(s, 61000)).toBe(false);
    expect(s.results).toHaveLength(1);
  });
  it("locks registration and detects duplicate names/capacity", async () => {
    const s = await createState({ ...cfg, capacity: 2 }, "seed", 0);
    const a = { id: "a", name: "NAME", description: "", keyHash: "h" };
    addAgent(s, a, 0);
    expect(() => addAgent(s, { ...a, id: "b", name: "name" }, 0)).toThrow(
      "已被使用",
    );
    expect(() => start(s, 0)).toThrow("至少");
    addAgent(s, { ...a, id: "b", name: "Other" }, 0);
    expect(() => addAgent(s, { ...a, id: "c", name: "Extra" }, 0)).toThrow(
      "名额",
    );
    start(s, 0);
    expect(() => addAgent(s, a, 0)).toThrow("开始后");
    expect(() => start(s, 0)).toThrow();
  });
  it("public response excludes orders, keys, future path and seed before finish", async () => {
    const s = await setup();
    submit(s, "a0", buy, 2000);
    const p = publicState(s, 2000),
      text = JSON.stringify(p);
    expect(p.history).toEqual([10000]);
    expect(p.reveal).toBeNull();
    expect(text).not.toContain("fixed-test-seed");
    expect(text).not.toContain("hash0");
    expect(text).not.toContain("buy-order-1");
  });
  it("terminal redemption and commitment are verifiable; equal balances share rank", async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++) clearRound(s, end(s));
    const p = publicState(s, 99999999);
    expect(p.status).toBe("finished");
    expect(p.leaderboard.map((a) => a.rank)).toEqual([1, 1]);
    expect(s.agents.every((a) => a.dat === 0)).toBe(true);
    expect(await sha256(JSON.stringify(p.reveal))).toBe(s.commitment);
    expect(advance(s, 999999999)).toBe(false);
    audit(s);
  });
  it("path is deterministic from seed, bounded and varies across seeds", async () => {
    expect(await generatePath("s", 30)).toEqual(await generatePath("s", 30));
    expect(await generatePath("s", 30)).not.toEqual(
      await generatePath("t", 30),
    );
    expect(
      (await generatePath("s", 100)).every((p) => p >= 2500 && p <= 17500),
    ).toBe(true);
  });
  it("invariant check catches money creation", async () => {
    const s = await setup();
    s.agents[0].cash++;
    expect(() => audit(s)).toThrow("现金不守恒");
  });
  it("1,000 seeded simulations keep nonnegative balances and conservation for 30 rounds", async () => {
    for (let seed = 0; seed < 1000; seed++) {
      const s = await createState({ ...cfg, capacity: 10 }, `fuzz-${seed}`, 0);
      for (let i = 0; i < 10; i++)
        addAgent(
          s,
          { id: `a${i}`, name: `Agent ${i}`, keyHash: "h", description: "" },
          0,
        );
      start(s, 1000);
      for (let r = 1; r <= 30; r++) {
        for (let i = 0; i < 10; i++) {
          const a = s.agents[i],
            side = (seed + i + r) % 2 ? "BUY" : "SELL",
            price = 100 + ((seed * 31 + i * 17 + r * 93) % 19901),
            qty = Math.min(
              10,
              side === "BUY" ? Math.floor(a.cash / price) : a.dat,
            );
          submit(
            s,
            a.id,
            {
              round: r,
              side: qty ? side : "PASS",
              price: qty ? price : 0,
              quantity: qty,
              requestId: `s${seed}-a${i}-r${r}`,
            },
            s.openedAt + 10,
          );
        }
        clearRound(s, end(s));
        audit(s);
      }
      expect(s.status).toBe("finished");
    }
  }, 60000);
});

describe('cash-only leaderboard',()=>{
 it('ranks by owned cash and shares ties even when inventories and reference valuations differ',async()=>{
  const s=await setup(3);
  s.agents[0].dat=250;s.agents[1].dat=25;s.agents[2].dat=25;
  expect(publicState(s,2000).leaderboard.map(a=>a.rank)).toEqual([1,1,1]);
  s.agents[0].cash=100000;s.agents[1].cash=1900000;
  const view=publicState(s,2000);
  expect(view.rankingBasis).toBe('cash');
  expect(view.leaderboard.map(a=>[a.id,a.rank,a.cash])).toEqual([['a1',1,1900000],['a2',2,1000000],['a0',3,100000]]);
  // The last-ranked agent still has the highest reference equity.
  expect(view.leaderboard[2].equity).toBeGreaterThan(view.leaderboard[0].equity);
  const before=view.leaderboard.map(a=>[a.id,a.rank]);
  s.path[1]=17500;clearRound(s,end(s));
  expect(publicState(s,999999).leaderboard.map(a=>[a.id,a.rank])).toEqual(before);
  expect(view.leaderboard[0].cashChange).toBe(900000);audit(s);
 });
 it('does not subtract reserved buy cash or count unfilled sell proceeds',async()=>{
  const s=await setup();
  submit(s,'a0',{...buy,price:20000,quantity:10},2000);
  expect(accountState(s,s.agents[0]).availableCash).toBe(800000);
  const view=publicState(s,2000);
  expect(view.leaderboard.map(a=>[a.cash,a.rank])).toEqual([[1000000,1],[1000000,1]]);
  const sell={...buy,side:'SELL' as const,price:20000,quantity:1,requestId:'cash-rank-sell'};
  submit(s,'a1',sell,2000);
  expect(publicState(s,2000).leaderboard[0].cash).toBe(1000000);
  clearRound(s,end(s));
  expect(publicState(s,999999).leaderboard.map(a=>[a.id,a.cash,a.rank])).toEqual([['a1',1020000,1],['a0',980000,2]]);audit(s);
 });
 it('uses the committed fundamental for final cash redemption rather than an inflated last trade',async()=>{
  const s=await setup();
  submit(s,'a0',{...buy,price:20000,quantity:1},2000);
  submit(s,'a1',{...buy,side:'SELL',price:20000,quantity:1,requestId:'bubble-sell'},2000);
  clearRound(s,end(s));
  const expected=s.agents[0].cash+s.agents[0].dat*s.path[s.config.rounds];
  expect(publicState(s,999999).instruments[0].lastPrice).toBe(20000);
  while(s.status==='running')clearRound(s,end(s));
  expect(s.agents[0].cash).toBe(expected);
  const final=publicState(s,99999999);
  expect(final.leaderboard.every(a=>a.equity===a.cash)).toBe(true);
  expect(final.leaderboard.map(a=>a.cash)).toEqual(final.leaderboard.map(a=>a.cash).sort((a,b)=>b-a));audit(s);
 });
});
