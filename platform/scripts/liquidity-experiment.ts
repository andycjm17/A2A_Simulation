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
  MAKER_POLICY_V1,
  MAKER_POLICY_V2,
} from "../worker/engine";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function rng(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const args = process.argv.slice(2);
const comparePolicies = args[0] === "--maker-policies";
const output = comparePolicies
  ? (args[1] ?? "reports/maker-policy.json")
  : (args[0] ?? "experiments/raw.json");
const primarySeeds = Number(process.env.EXPERIMENT_SEEDS ?? 200);
const populations = process.env.EXPERIMENT_PRIMARY_ONLY ? [20] : [20, 10, 40];
const treatments = comparePolicies
  ? [MAKER_POLICY_V1, MAKER_POLICY_V2].map((makerPolicy) => ({
      share: 0.2,
      makerPolicy,
    }))
  : Array.from({ length: 11 }, (_, step) => ({
      share: step / 20,
      makerPolicy: undefined,
    }));
const rows: any[] = [];
for (const population of populations) {
  const repetitions =
    population === 20 ? primarySeeds : Math.min(primarySeeds, 100);
  for (let seedIndex = 0; seedIndex < repetitions; seedIndex++) {
    const seed = `capital-v1:${seedIndex}`;
    const random = rng(
      parseInt((await sha256(`${seed}:traders`)).slice(0, 8), 16),
    );
    const draws = Array.from({ length: 30 }, () =>
      Array.from({ length: population }, () =>
        Array.from({ length: 2 }, () => Array.from({ length: 5 }, random)),
      ),
    );
    let commitment: string | undefined;
    for (const { share, makerPolicy } of treatments) {
      const s = await createState(
        {
          id: "experiment-v1",
          name: "Capital experiment",
          rounds: 30,
          roundMs: 60000,
          capacity: 100,
          practice: true,
          assetMode: "ai",
          newsEnabled: true,
          makerCashShare: share,
          ...(makerPolicy ? { makerPolicy } : {}),
        },
        seed,
        0,
      );
      if (commitment !== undefined && s.commitment !== commitment)
        throw new Error("Paired treatments must share the same news and price path");
      commitment = s.commitment;
      for (let i = 0; i < population; i++)
        addAgent(
          s,
          {
            id: `agent-${String(i).padStart(2, "0")}`,
            name: `Agent ${i}`,
            description: "",
            keyHash: `hash-${i}`,
          },
          0,
        );
      start(s, 1);
      let assetRounds = 0;
      let twoSidedQuotes = 0;
      let spreadSumBps = 0;
      let twoSidedDepth = 0;
      let lossThresholdOpens = 0;
      let equityPeak = 0;
      let drawdownPct = 0;
      const mark = (equity: number) => {
        equityPeak = Math.max(equityPeak, equity);
        drawdownPct = Math.max(
          drawdownPct,
          (100 * (equityPeak - equity)) / equityPeak,
        );
      };
      for (let r = 0; r < 30; r++) {
        // Snapshot is the only market information supplied to ordinary policies.
        const snapshot = publicState(s, s.openedAt);
        if (comparePolicies) {
          const maker = snapshot.maker!;
          mark(maker.equity);
          if (maker.equity <= Math.ceil(maker.initialEquity * 0.95))
            lossThresholdOpens++;
          for (const { orderBook, reference } of snapshot.instruments) {
            assetRounds++;
            const bid = orderBook.bids[0];
            const ask = orderBook.asks[0];
            if (!bid || !ask) continue;
            twoSidedQuotes++;
            spreadSumBps += ((ask.price - bid.price) * 10000) / reference;
            twoSidedDepth += Math.min(bid.quantity, ask.quantity);
          }
        }
        for (let i = 0; i < population; i++)
          for (let j = 0; j < 2; j++) {
            const a = s.agents[i],
              instrument = snapshot.instruments[j];
            const [pass, sideDraw, qtyDraw, noise, aggression] = draws[r][i][j];
            const f = instrument.reference;
            const kind = i % 5;
            const last = instrument.history.at(-2) ?? f;
            const center = kind < 2 ? f : kind < 4 ? f : f + (f - last) * 0.5;
            const noiseRange = kind < 2 ? 0.02 : kind < 4 ? 0.1 : 0.04;
            let side: "BUY" | "SELL" | "PASS" =
              pass < 0.08 ? "PASS" : sideDraw < 0.5 ? "BUY" : "SELL";
            let price = Math.max(
              100,
              Math.min(
                20000,
                Math.round(
                  center +
                    f * (noise * 2 - 1) * noiseRange +
                    (side === "BUY" ? 1 : -1) * aggression * f * 0.02,
                ),
              ),
            );
            const account = accountState(s, a);
            let quantity = Math.min(
              1 + Math.floor(qtyDraw * 10),
              side === "BUY"
                ? Math.floor(account.availableCash / price)
                : account.availableHoldings[instrument.symbol],
            );
            if (side === "PASS" || quantity < 1) {
              side = "PASS";
              price = quantity = 0;
            }
            submit(
              s,
              a.id,
              {
                symbol: instrument.symbol,
                round: s.round,
                side,
                price,
                quantity,
                requestId: `${a.id}-${r}-${j}`,
              },
              s.openedAt + 1,
            );
          }
        clearRound(s, settlementAt(s));
        audit(s);
      }
      const snapshot = publicState(s, s.openedAt);
      const maker = snapshot.maker;
      if (comparePolicies) mark(maker!.equity);
      const buyHold =
        1_000_000 +
        100 * snapshot.instruments.reduce((n, x) => n + x.reference, 0);
      const finals = s.agents.filter((a) => !a.system).map((a) => a.cash);
      const returns = finals
        .map((c) => ((c - 3_000_000) / 3_000_000) * 100)
        .sort((a, b) => a - b);
      const makerBenchmark = maker
        ? maker.initialCash +
          s.agents.at(-1)!.initialHoldings! *
            snapshot.instruments.reduce((n, x) => n + x.reference, 0)
        : 0;
      const transfer =
        finals.reduce((n, c) => n + c - buyHold, 0) +
        (maker ? maker.equity - makerBenchmark : 0);
      if (transfer !== 0 || s.results.length !== 30)
        throw new Error("PnL/round validation failed");
      rows.push({
        population,
        seed: seedIndex,
        share,
        actualCashShare: maker?.cashShare ?? 0,
        volume: snapshot.volume,
        notionalDUSD:
          s.trades.reduce((n, t) => n + t.price * t.quantity, 0) / 100,
        returnPp: returns.reduce((n, x) => n + x, 0) / population,
        medianReturnPp:
          (returns[population / 2 - 1] + returns[population / 2]) / 2,
        excessReturnPp:
          ((finals.reduce((n, c) => n + c, 0) / population - buyHold) /
            3_000_000) *
          100,
        makerVolumeShare: maker?.volumeShare ?? 0,
        peerVolume: snapshot.volume - (maker?.volume ?? 0),
        makerProfitDUSD: (maker?.profit ?? 0) / 100,
        makerExcessProfitDUSD: maker
          ? (maker.equity - makerBenchmark) / 100
          : 0,
        ...(comparePolicies
          ? {
              makerPolicy: maker!.policy,
              twoSidedOpenPct: (100 * twoSidedQuotes) / assetRounds,
              openSpreadBps: twoSidedQuotes
                ? spreadSumBps / twoSidedQuotes
                : null,
              openDepth: twoSidedDepth / assetRounds,
              openingDrawdownPct: drawdownPct,
              lossThresholdOpenPct: (100 * lossThresholdOpens) / s.config.rounds,
            }
          : {}),
        newsCount: s.news!.length,
        commitment: s.commitment,
        conservation: true,
      });
    }
    if (seedIndex % 20 === 0)
      console.log(
        `population ${population}: ${seedIndex + 1}/${repetitions} seeds`,
      );
  }
}
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      protocol: comparePolicies ? "maker-policy-paired-v1" : "capital-v1",
      generatedAt: new Date().toISOString(),
      rows,
    },
    null,
    2,
  ),
);
console.log(`Saved ${rows.length} complete matches to ${output}`);
