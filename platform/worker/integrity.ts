import { pathFor, type State } from "./engine";

// Review signals, not a cheating verdict. Only settled fills and already public prices.
export function integrityReview(s: State) {
  const pairs = new Map<
    string,
    {
      agentIds: string[];
      trades: number;
      volume: number;
      offReferenceTrades: number;
      maxDeviationBps: number;
    }
  >();
  let offReferenceTrades = 0;
  for (const t of s.trades) {
    const ids = [t.buyer, t.seller].sort(),
      key = ids.join(":");
    const p = pairs.get(key) || {
      agentIds: ids,
      trades: 0,
      volume: 0,
      offReferenceTrades: 0,
      maxDeviationBps: 0,
    };
    const reference = pathFor(s, t.symbol ?? "DAT")[t.round - 1];
    const deviation = Math.abs(t.price - reference);
    p.trades++;
    p.volume += t.quantity;
    p.maxDeviationBps = Math.max(
      p.maxDeviationBps,
      Math.floor((deviation * 10000) / reference),
    );
    if (deviation * 100 >= reference * 25) {
      p.offReferenceTrades++;
      offReferenceTrades++;
    }
    pairs.set(key, p);
  }
  const flagged = [...pairs.values()]
    .map((p) => ({
      ...p,
      concentrated:
        s.agents.length >= 3 &&
        p.trades >= 5 &&
        p.trades * 100 >= s.trades.length * 70,
    }))
    .filter((p) => p.offReferenceTrades > 0 || p.concentrated)
    .sort(
      (a, b) =>
        b.offReferenceTrades - a.offReferenceTrades ||
        b.trades - a.trades ||
        a.agentIds.join(":").localeCompare(b.agentIds.join(":")),
    );
  return {
    requiresReview: flagged.length > 0,
    offReferenceTrades,
    flaggedPairs: flagged.length,
    pairs: flagged.slice(0, 20),
    thresholds: {
      deviationPercent: 25,
      concentrationPercent: 70,
      minimumPairTrades: 5,
    },
  };
}
