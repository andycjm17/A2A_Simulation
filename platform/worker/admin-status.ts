import { audit, type State } from "./engine";
import { integrityReview } from "./integrity";
// Read-only projection. Never expose sealed order sides/prices, seed, or credentials.
export function adminStatus(s: State, now: number) {
  const decided = new Set(
    s.orders.filter((o) => o.round === s.round).map((o) => o.agentId),
  );
  const totals = new Map<string, number>();
  for (const o of s.orders)
    totals.set(o.agentId, (totals.get(o.agentId) || 0) + 1);
  let conserved = true;
  try {
    audit(s);
  } catch {
    conserved = false;
  }
  const latest = s.results.at(-1);
  return {
    id: s.config.id,
    name: s.config.name,
    practice: s.config.practice,
    status: s.status,
    round: s.round,
    rounds: s.config.rounds,
    capacity: s.config.capacity,
    participants: s.agents.length,
    decisions: s.orders.length,
    currentDecisions: decided.size,
    trades: s.trades.length,
    volume: s.trades.reduce((n, t) => n + t.quantity, 0),
    completedRounds: s.results.length,
    pauseReason: s.pauseReason || null,
    conserved,
    integrity: integrityReview(s),
    settlementDelayMs: latest
      ? Math.max(0, latest.clearedAt - latest.scheduledAt)
      : null,
    serverTime: now,
    agents: s.agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      decided: decided.has(a.id),
      decisions: totals.get(a.id) || 0,
    })),
    results: s.results,
    events: s.events
      .slice(-20)
      .reverse()
      .map((e) => ({ seq: e.seq, at: e.at, type: e.type })),
  };
}
export type AdminStatus = ReturnType<typeof adminStatus>;
export type DashboardPage = {
  markets: AdminStatus[];
  failures: { id: string; name: string }[];
  offset: number;
  nextOffset: number | null;
  catalogCount: number;
  serverTime: number;
};
