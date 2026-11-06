import * as engine from "../worker/engine";
// The runner changes only the buying-scale function for this experimental control.
import * as hardStop from "maker-hard-stop";
import { seededRandom, scriptedDecision } from "./scripted-trader";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import assert from "node:assert/strict";

const repetitions = Number(process.env.MAKER_SEEDS ?? 100);
assert.ok(Number.isInteger(repetitions) && repetitions > 0);
const populations = process.env.MAKER_POPULATIONS
  ? process.env.MAKER_POPULATIONS.split(",").map(Number)
  : process.env.MAKER_PRIMARY_ONLY ? [20] : [20, 10, 40];
assert.ok(populations.every(n => [10, 20, 40].includes(n)));
const firstSeed = Number(process.env.MAKER_SEED_START ?? 0);
assert.ok(Number.isInteger(firstSeed) && firstSeed >= 0);
const output = process.argv[2] ?? "reports/graded-maker-comparison.json";
const rows: Record<string, number | string | boolean | null>[] = [];
const treatments = [
  { name: "capital-preserving", engine, policy: "capital-preserving-v1" as const },
  { name: "hard-stop-v2", engine: hardStop as typeof engine, policy: engine.GRADED_MAKER_POLICY },
  { name: "graduated-v2", engine, policy: engine.GRADED_MAKER_POLICY },
];
const started = Date.now();
for (const population of populations) {
  const count = population === 20 ? repetitions : Math.min(repetitions, 50);
  const lastSeed = Math.min(count, Number(process.env.MAKER_SEED_END ?? count));
  assert.ok(Number.isInteger(lastSeed) && lastSeed > firstSeed);
  for (let seedIndex = firstSeed; seedIndex < lastSeed; seedIndex++) {
    const seed = `graded-maker-v1:${seedIndex}`;
    const random = seededRandom(parseInt((await engine.sha256(seed + ":traders")).slice(0, 8), 16));
    const draws = Array.from({ length: 240 }, () =>
      Array.from({ length: population }, () =>
        Array.from({ length: 2 }, () => Array.from({ length: 5 }, random))));
    let commitment: string | undefined;
    for (const treatment of treatments) {
      const api = treatment.engine;
      const s = await api.createState({
        id: "graded-maker-benchmark",
        name: "Paired 240-round maker comparison",
        rounds: 240, roundMs: 5000, capacity: 100, practice: true,
        assetMode: "ai", instruments: engine.DEFAULT_INSTRUMENTS,
        newsEnabled: true, makerCashShare: 0.2, makerPolicy: treatment.policy,
        retailAgents: true, autoRedeem: false,
      }, seed, 0);
      if (commitment !== undefined) assert.equal(s.commitment, commitment);
      commitment = s.commitment;
      for (let i = 0; i < population; i++)
        api.addAgent(s, {
          id: `agent-${i}`, name: `Agent ${i}`,
          keyHash: `key-${i}`, description: "",
        }, 0);
      api.start(s, 1);
      const maker = s.agents.find(a => a.system === "fundamental-maker")!;
      const symbols = engine.DEFAULT_INSTRUMENTS.map(i => i.symbol);
      const initialMakerEquity = maker.initialCash! + symbols.reduce(
        (sum, symbol) => sum + maker.initialInventory![symbol] * s.assets![symbol].path[0], 0);
      assert.equal(s.agents.filter(a => a.system === "retail-trader").length, 5);
      let twoSided = 0, spreadBps = 0, depth = 0, bidCoverage = 0;
      let peakEquity = 0, maxDrawdownPct = 0, stopRounds = 0;
      const mark = (equity: number) => {
        peakEquity = Math.max(peakEquity, equity);
        maxDrawdownPct = Math.max(maxDrawdownPct, 100 * (peakEquity - equity) / peakEquity);
      };
      let quoteStart = 0;
      for (let round = 0; round < 240; round++) {
        // Give the scripted policies only published references/history and their own balances.
        // Round-open balances have no outstanding participant orders. Reserve buys as submitted.
        const instruments = symbols.map(symbol => ({
          symbol,
          reference: s.assets![symbol].path[round],
          history: s.assets![symbol].path.slice(0, round + 1),
        }));
        const equity = maker.cash + instruments.reduce(
          (sum, i) => sum + maker.holdings![i.symbol] * i.reference, 0);
        mark(equity);
        if (treatment.name === "capital-preserving"
          ? equity < initialMakerEquity * 0.9
          : api.makerBuyScale(equity, initialMakerEquity) === 0) stopRounds++;
        const quotes = s.orders.slice(quoteStart).filter(o => o.agentId === maker.id);
        for (const instrument of instruments) {
          const bid = quotes.find(o => o.symbol === instrument.symbol && o.side === "BUY");
          const ask = quotes.find(o => o.symbol === instrument.symbol && o.side === "SELL");
          if (bid) bidCoverage++;
          if (bid && ask) {
            twoSided++;
            spreadBps += 10000 * (ask.price - bid.price) / instrument.reference;
            depth += Math.min(bid.quantity, ask.quantity);
          }
        }
        for (let i = 0; i < population; i++) {
          const account = { availableCash: s.agents[i].cash, availableHoldings: s.agents[i].holdings! };
          for (let j = 0; j < 2; j++) {
            const decision = scriptedDecision(i, instruments[j], account, draws[round][i][j]);
            api.submit(s, s.agents[i].id, {
              ...decision,
              symbol: instruments[j].symbol,
              round: s.round,
              requestId: `agent-${i}-round-${round}-asset-${j}`,
            }, s.openedAt + 1);
            if (decision.side === "BUY") account.availableCash -= decision.price * decision.quantity;
          }
        }
        quoteStart = s.orders.length;
        // clearRound audits nonnegative balances and exact conservation after every settlement.
        api.clearRound(s, api.settlementAt(s));
        if (treatment.name !== "capital-preserving")
          for (const instrument of instruments)
            assert.ok(maker.holdings![instrument.symbol] <= Math.floor(maker.initialInventory![instrument.symbol] * 1.5));
      }
      const final = api.publicState(s, s.openedAt);
      mark(final.maker!.equity);
      assert.equal(s.status, "finished");
      assert.equal(s.results.length, 240);
      assert.equal(final.retailTraders.length, 5);
      assert.ok(final.retailTraders.every(a => a.scoreFrozen && a.decisionHorizon === "indefinite"));
      assert.ok(!s.events.some(e => e.type === "redeemed"));
      const initialEquity = final.initialEquity;
      const participantEquity = s.agents.filter(a => !a.system).reduce((sum, a) =>
        sum + a.cash + final.instruments.reduce((n, i) => n + a.holdings![i.symbol] * i.reference, 0), 0);
      rows.push({
        population, seed: seedIndex, treatment: treatment.name,
        commitment: s.commitment, newsCount: s.news!.length,
        volume: final.volume,
        makerVolumeShare: final.maker!.volumeShare ?? 0,
        makerTwoSidedPct: 100 * twoSided / 480,
        makerBidCoveragePct: 100 * bidCoverage / 480,
        makerSpreadBps: twoSided ? spreadBps / twoSided : null,
        makerDepth: depth / 480,
        makerProfitDUSD: final.maker!.profit / 100,
        makerReturnPct: 100 * final.maker!.profit / final.maker!.initialEquity,
        maxDrawdownPct,
        stoppedPct: 100 * stopRounds / 240,
        participantReturnPct: 100 * (participantEquity / population / initialEquity - 1),
        retailMeanScoreDUSD: final.retailTraders.reduce((sum, a) => sum + a.score, 0) / 500,
        conservation: true,
      });
    }
    if (seedIndex % 10 === 0)
      console.log(`population ${population}: ${seedIndex + 1}/${count} seeds (${Math.round((Date.now() - started) / 1000)}s)`);
  }
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({
  protocol: "graded-maker-240-v1",
  rounds: 240, roundMs: 5000, retailAgents: 5, autoRedeem: false,
  makerCashShare: 0.2,
  tierLossPct: [2, 5, 10, 15], tierBuyingScale: [1, 0.75, 0.5, 0.25, 0],
  strategies: { fundamental: 0.4, noise: 0.4, momentum: 0.2 },
  generatedAt: new Date().toISOString(), rows,
}, null, 2));
console.log(`Saved ${rows.length} matches to ${output}`);
