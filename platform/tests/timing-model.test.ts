import { describe, it, expect } from "vitest";
import { Book, runModel, policy } from "../scripts/timing-model";
describe("offline timing model (not production)", () => {
  const setup = () =>
    new Book([
      { cash: 100000, stocks: [20, 20] },
      { cash: 100000, stocks: [20, 20] },
      { cash: 100000, stocks: [20, 20] },
    ]);
  it("reserves shared cash across assets, releases it on cancellation and clips size", () => {
    const b = setup();
    b.place(0, 0, "BUY", 10000, 8, 0, 10000, false);
    b.place(0, 1, "BUY", 10000, 8, 0, 10000, false);
    expect(b.orders.map((o) => o.remaining)).toEqual([8, 2]);
    expect(b.availableCash(0)).toBe(0);
    b.cancel(0, 0);
    expect(b.availableCash(0)).toBe(80000);
    b.audit(300000, [60, 60]);
  });
  it("continuous fills happen at arrival, inside limits, with conserved holdings and cash", () => {
    const b = setup();
    b.place(0, 0, "SELL", 9000, 4, 0, 10000, true);
    b.place(1, 0, "BUY", 11000, 3, 1250, 11250, true);
    expect(b.fills).toMatchObject([{ price: 10000, quantity: 3, at: 1250 }]);
    expect(b.orders[0].remaining).toBe(1);
    b.audit(300000, [60, 60]);
  });
  it("resting-price sensitivity changes execution price explicitly", () => {
    const b = setup();
    b.priceRule = "resting";
    b.place(0, 0, "SELL", 9000, 4, 0, 10000, true);
    b.place(1, 0, "BUY", 11000, 3, 1250, 11250, true);
    expect(b.fills[0].price).toBe(9000);
    b.audit(300000, [60, 60]);
  });
  it("batch matching waits, honors price priority, and refuses self trades", () => {
    const b = setup();
    b.place(0, 0, "SELL", 9000, 3, 0, 10000, false);
    b.place(0, 0, "BUY", 11000, 3, 0, 10000, false);
    b.place(1, 0, "BUY", 10500, 2, 1250, 11250, false);
    expect(b.fills).toHaveLength(0);
    b.auction(5000, "test");
    expect(b.fills).toHaveLength(1);
    expect(b.fills[0]).toMatchObject({
      buyer: 1,
      seller: 0,
      quantity: 2,
      at: 5000,
    });
    b.audit(300000, [60, 60]);
  });
  it("expired or replaced orders cannot execute later", () => {
    const b = setup();
    b.place(0, 0, "SELL", 9000, 3, 0, 1000, false);
    b.prune(1000);
    b.place(1, 0, "BUY", 11000, 3, 1250, 11250, true);
    expect(b.fills).toHaveLength(0);
    b.cancel(1, 0);
    b.place(2, 0, "SELL", 9000, 3, 2000, 12000, true);
    expect(b.fills).toHaveLength(0);
    b.audit(300000, [60, 60]);
  });
  it("never creates overlapping calls when latency exceeds the periodic cadence", () => {
    const tape = {
      seed: "slow",
      paths: [Array(31).fill(10000), Array(31).fill(10000)],
    };
    const r = runModel(tape, {
      matching: "continuous",
      cadence: "5s",
      latencyMs: 6000,
      population: 2,
    });
    expect(r.calls).toBe(60);
    expect(r.arrivedCalls).toBe(60);
    expect(r.conservation).toBe(true);
  });
  it("uses only the supplied released fundamentals and deterministic keyed policy randomness", () => {
    expect(policy("x", 1, 2, 0, 10000, 9000)).toEqual(
      policy("x", 1, 2, 0, 10000, 9000),
    );
    const tape = {
      seed: "repeat",
      paths: [Array(31).fill(10000), Array(31).fill(10000)],
    };
    const a = runModel(tape, {
      matching: "batch5",
      cadence: "event",
      population: 2,
    });
    expect(a).toEqual(
      runModel(tape, { matching: "batch5", cadence: "event", population: 2 }),
    );
    expect(a.conservation).toBe(true);
  });
});
