import { mkdir, writeFile } from "node:fs/promises";
import {
  createState,
  addAgent,
  start,
  submit,
  clearRound,
  settlementAt,
  accountState,
  publicState,
  audit,
  sha256,
  type State,
} from "../worker/engine";
import {
  runModel,
  policy,
  draw,
  type Matching,
  type Cadence,
  type Tape,
} from "./timing-model";
const destination = process.argv[2] ?? "experiments/timing/raw.json";
const seeds = Number(process.env.TIMING_SEEDS ?? 200),
  sensitivitySeeds = Math.min(seeds, 50);
const production: any[] = [],
  factorial: any[] = [],
  sensitivity: any[] = [];
function addOrdinary(s: State) {
  for (let i = 0; i < 20; i++)
    addAgent(
      s,
      {
        id: `agent-${String(i).padStart(2, "0")}`,
        name: `Agent ${i}`,
        description: "scripted timing experiment",
        keyHash: `hash-${i}`,
      },
      0,
    );
}
function runProduction(
  base: State,
  period: number,
  latency: number,
  index: number,
  condition = "fixed-rounds",
) {
  const s = structuredClone(base);
  s.config.roundMs = period;
  start(s, 1);
  let missed = 0,
    calls = 0;
  for (let r = 0; r < s.config.rounds; r++) {
    for (let i = 0; i < 20; i++) {
      calls++;
      const delay = latency + Math.floor(draw(`${s.seed}:latency:${i}`) * 500);
      if (delay >= period - Math.min(5000, Math.floor(period / 10))) {
        missed++;
        continue;
      }
      for (let j = 0; j < 2; j++) {
        const a = s.agents[i],
          symbol = j === 0 ? "OPENAI" : "ANTHROPIC",
          p = s.assets![symbol].path;
        const intent = policy(s.seed, i, r, j, p[r], p[Math.max(0, r - 1)]),
          account = accountState(s, a);
        const quantity = intent
          ? Math.min(
              intent.quantity,
              intent.side === "BUY"
                ? Math.floor(account.availableCash / intent.price)
                : account.availableHoldings[symbol],
            )
          : 0;
        submit(
          s,
          a.id,
          {
            symbol,
            round: s.round,
            side: quantity ? intent!.side : "PASS",
            price: quantity ? intent!.price : 0,
            quantity,
            requestId: `${i}-${j}-${r}`,
          },
          s.openedAt + delay,
        );
      }
    }
    clearRound(s, settlementAt(s));
    audit(s);
  }
  const snapshot = publicState(s, s.finishedAt!),
    mean = s.agents.slice(0, 20).reduce((n, a) => n + a.cash, 0) / 20;
  const fingerprint = JSON.stringify({
    trades: s.trades.map(({ at, id, ...t }) => t),
    cash: s.agents.map((a) => a.cash),
  });
  return {
    seed: index,
    condition,
    periodMs: period,
    rounds: s.config.rounds,
    durationSeconds: (s.config.rounds * period) / 1000,
    latencyMs: latency,
    missedCalls: missed,
    calls,
    volume: snapshot.volume,
    returnPp: ((mean - 3000000) / 3000000) * 100,
    meanCashDUSD: mean / 100,
    conservation: true,
    fingerprint,
  };
}
for (let i = 0; i < seeds; i++) {
  const seed = `timing-v1:${i}`;
  const base = await createState(
    {
      id: "timing-experiment",
      name: "Timing experiment",
      rounds: 30,
      roundMs: 10000,
      capacity: 100,
      practice: true,
      assetMode: "ai",
      newsEnabled: true,
      makerCashShare: 0.2,
    },
    seed,
    0,
  );
  addOrdinary(base);
  const tape: Tape = {
    seed,
    paths: [base.assets!.OPENAI.path, base.assets!.ANTHROPIC.path],
  };
  const controls = [5000, 10000, 60000].map((period) =>
    runProduction(base, period, 250, i),
  );
  if (!controls.every((c) => c.fingerprint === controls[0].fingerprint))
    throw new Error("wall-clock invariance failed");
  production.push(...controls.map(({ fingerprint, ...row }) => row));
  if (i < sensitivitySeeds)
    for (const latency of [1000, 3000, 6000])
      for (const period of [5000, 10000, 60000]) {
        const { fingerprint, ...row } = runProduction(
          base,
          period,
          latency,
          i,
          "deadline-sensitivity",
        );
        production.push(row);
      }
  // Same 300-second news tape, but real deployed batch engine at 30 or 60 rounds.
  for (const period of [5000, 10000]) {
    const b = structuredClone(base),
      rounds = 300000 / period;
    b.config.rounds = rounds;
    for (let j = 0; j < 2; j++) {
      const symbol = j === 0 ? "OPENAI" : "ANTHROPIC";
      b.assets![symbol].path = Array.from(
        { length: rounds + 1 },
        (_, r) => tape.paths[j][Math.min(29, Math.floor((r * period) / 10000))],
      );
    }
    b.path = b.assets!.OPENAI.path;
    b.news = base.news!.map((n) => ({
      ...n,
      round: 1 + ((n.round - 1) * 10000) / period,
    }));
    b.commitment = await sha256(
      JSON.stringify({
        seed: b.seed,
        paths: Object.fromEntries(
          Object.entries(b.assets!).map(([symbol, a]) => [symbol, a.path]),
        ),
        news: b.news,
      }),
    );
    const { fingerprint, ...row } = runProduction(
      b,
      period,
      1000,
      i,
      "fixed-duration",
    );
    production.push(row);
  }
  for (const matching of ["batch5", "batch10", "continuous"] as Matching[])
    for (const cadence of ["5s", "10s", "event"] as Cadence[]) {
      factorial.push({
        seed: i,
        ...runModel(tape, {
          matching,
          cadence,
          latencyMs: 1000,
          priceRule: "midpoint",
        }),
      });
    }
  if (i < sensitivitySeeds) {
    for (const latencyMs of [250, 3000, 6000])
      for (const matching of ["batch5", "batch10", "continuous"] as Matching[])
        for (const cadence of ["5s", "10s", "event"] as Cadence[]) {
          sensitivity.push({
            seed: i,
            ...runModel(tape, {
              matching,
              cadence,
              latencyMs,
              priceRule: "midpoint",
            }),
            family: "latency",
          });
        }
    for (const cadence of ["5s", "10s", "event"] as Cadence[])
      sensitivity.push({
        seed: i,
        ...runModel(tape, {
          matching: "continuous",
          cadence,
          latencyMs: 1000,
          priceRule: "resting",
        }),
        family: "resting-price",
      });
  }
  if (i % 20 === 0)
    console.log(`timing: ${i + 1}/${seeds} paired seeds complete`);
}
// Deterministic replay checks use the same inputs, not another source of random seeds.
const replaySeed = "timing-v1:0";
const replayBase = await createState(
  {
    id: "replay",
    name: "Replay",
    rounds: 30,
    roundMs: 10000,
    capacity: 100,
    practice: true,
    assetMode: "ai",
    newsEnabled: true,
    makerCashShare: 0.2,
  },
  replaySeed,
  0,
);
for (const matching of ["batch5", "batch10", "continuous"] as Matching[])
  for (const cadence of ["5s", "10s", "event"] as Cadence[]) {
    const original = factorial.find(
      (r) => r.seed === 0 && r.matching === matching && r.cadence === cadence,
    );
    const replay = runModel(
      {
        seed: replaySeed,
        paths: [
          replayBase.assets!.OPENAI.path,
          replayBase.assets!.ANTHROPIC.path,
        ],
      },
      { matching, cadence, latencyMs: 1000, priceRule: "midpoint" },
    );
    if (
      JSON.stringify({ ...original, seed: undefined }) !==
      JSON.stringify(replay)
    )
      throw new Error("deterministic replay failed");
  }
await mkdir(destination.substring(0, destination.lastIndexOf("/")), {
  recursive: true,
});
await writeFile(
  destination,
  JSON.stringify(
    {
      protocol: "timing-v1",
      generatedAt: new Date().toISOString(),
      seeds,
      sensitivitySeeds,
      production,
      factorial,
      sensitivity,
      validation: {
        allConserved: true,
        wallClockInvarianceSeeds: seeds,
        replayCells: 9,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    destination,
    production: production.length,
    factorial: factorial.length,
    sensitivity: sensitivity.length,
  }),
);
