import type { Decision } from "../worker/engine";

export function seededRandom(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared fundamental/noise/momentum policies from the capital experiment. */
export function scriptedDecision(
  agentIndex: number,
  instrument: { symbol: string; reference: number; history: number[] },
  account: { availableCash: number; availableHoldings: Record<string, number> },
  draws: number[],
): Pick<Decision, "side" | "price" | "quantity"> {
  const [pass, sideDraw, qtyDraw, noise, aggression] = draws;
  const f = instrument.reference;
  const kind = agentIndex % 5;
  const previous = instrument.history.at(-2) ?? f;
  const center = kind < 4 ? f : f + (f - previous) * 0.5;
  const noiseRange = kind < 2 ? 0.02 : kind < 4 ? 0.1 : 0.04;
  let side: Decision["side"] =
    pass < 0.08 ? "PASS" : sideDraw < 0.5 ? "BUY" : "SELL";
  let price = Math.max(
    100,
    Math.min(20000, Math.round(
      center + f * (noise * 2 - 1) * noiseRange +
      (side === "BUY" ? 1 : -1) * aggression * f * 0.02,
    )),
  );
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
  return { side, price, quantity };
}
