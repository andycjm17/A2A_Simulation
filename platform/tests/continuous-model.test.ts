import { describe, it, expect } from "vitest";
import { Book } from "../scripts/timing-model";
import {
  EventQueue,
  newsTape,
  runContinuous,
  type Trigger,
} from "../scripts/continuous-model";
describe("no periodic matching: continuous-v2", () => {
  it("processes irregular millisecond timestamps and stable ties in causal order", () => {
    const q = new EventQueue();
    for (const at of [503, 7, 229, 7, 1501]) q.push({ at, kind: "expiry" });
    const times = [];
    while (q.heap.length) times.push(q.pop().at);
    expect(times).toEqual([7, 7, 229, 503, 1501]);
  });
  it("uses the best resting price, then oldest same-price order, and leaves partial GTC orders", () => {
    const b = new Book(
      Array.from({ length: 4 }, () => ({ cash: 100000, stocks: [20, 20] })),
      "resting",
    );
    b.place(0, 0, "SELL", 10000, 2, 7, Number.MAX_SAFE_INTEGER, true);
    b.place(1, 0, "SELL", 9900, 2, 229, Number.MAX_SAFE_INTEGER, true);
    b.place(2, 0, "SELL", 9900, 2, 503, Number.MAX_SAFE_INTEGER, true);
    b.place(3, 0, "BUY", 11000, 3, 67123, Number.MAX_SAFE_INTEGER, true);
    expect(b.fills.map((f) => [f.seller, f.price, f.quantity, f.at])).toEqual([
      [1, 9900, 2, 67123],
      [2, 9900, 1, 67123],
    ]);
    expect(b.orders.find((o) => o.agent === 2)?.remaining).toBe(1);
    b.audit(400000, [80, 80]);
  });
  it("has no hidden 250ms grid, scheduled auction or mandatory order expiry", () => {
    const r = runContinuous("irregular", newsTape("irregular", 20000), {
      trigger: "timer5",
      durationMs: 20000,
      population: 10,
      trace: true,
    });
    const fills = r.trace!.filter((t: any) => t.kind === "fill") as any[];
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.some((f) => f.at % 250 !== 0)).toBe(true);
    expect(r.artificialMatchingWaitMs).toBe(0);
    expect(r.expired).toBe(0);
    expect(r.conservation).toBe(true);
  });
  it("ignores future news in a prefix replay, including unrelated future event counts", () => {
    const a = [
      { at: 3271, asset: 0, price: 11000 },
      { at: 19001, asset: 1, price: 9000 },
    ];
    const b = [
      { at: 3271, asset: 0, price: 11000 },
      { at: 19001, asset: 1, price: 15000 },
      { at: 19002, asset: 0, price: 8000 },
    ];
    expect(
      runContinuous("prefix", a, {
        trigger: "market",
        durationMs: 10000,
        population: 10,
        trace: true,
      }),
    ).toEqual(
      runContinuous("prefix", b, {
        trigger: "market",
        durationMs: 10000,
        population: 10,
        trace: true,
      }),
    );
  });
  it("accepts six-second responses, skipping overlapping periodic requests rather than expiring a round", () => {
    const r = runContinuous("slow", [], {
      trigger: "timer5",
      durationMs: 30000,
      baseLatencyMs: 6000,
      population: 10,
    });
    expect(r.arrivedCalls).toBeGreaterThan(0);
    expect(r.orders).toBeGreaterThan(0);
    expect(r.skippedBusyCalls).toBeGreaterThan(0);
    expect(r.closePendingCalls).toBeLessThanOrEqual(10);
  });
  it("coalesces market notifications and has finite serial inference throughput", () => {
    const r = runContinuous(
      "coalesce",
      [
        { at: 1001, asset: 0, price: 11000 },
        { at: 1002, asset: 1, price: 9000 },
      ],
      {
        trigger: "market",
        durationMs: 10000,
        baseLatencyMs: 10000,
        population: 10,
      },
    );
    expect(r.calls).toBeLessThanOrEqual(20);
    expect(r.calls - r.arrivedCalls).toBeLessThanOrEqual(10);
    expect(r.conservation).toBe(true);
  });
  it("replays all trigger policies deterministically without a closing auction", () => {
    const tape = newsTape("replay", 10000);
    for (const trigger of [
      "timer10",
      "timer5",
      "targeted",
      "market",
      "serial",
    ] as Trigger[]) {
      const r = runContinuous("replay", tape, {
        trigger,
        durationMs: 10000,
        population: 10,
        trace: true,
      });
      expect(r).toEqual(
        runContinuous("replay", tape, {
          trigger,
          durationMs: 10000,
          population: 10,
          trace: true,
        }),
      );
      expect(
        r
          .trace!.filter((t: any) => t.kind === "fill")
          .every((t: any) => t.at < 10000),
      ).toBe(true);
    }
  });
});
