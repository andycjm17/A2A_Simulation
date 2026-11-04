import type { Snapshot } from "./App";
import { money } from "./App";

export function RetailPanel({ s }: { s: Snapshot }) {
  if (!s.config.retailAgents && !s.retailTraders?.length) return null;
  return (
    <section
      className="panel market-table"
      aria-label="Simulated retail traders"
    >
      <div className="paneltitle">
        <h2>
          Retail traders{" "}
          <span className="subtle">
            {s.status === "finished" ? "Final scores" : "Unrealized P&L"}
          </span>
        </h2>
        <span className="badge">5 automated traders</span>
      </div>
      <div className="tablewrap">
        <table aria-label="Retail trader scores">
          <caption className="ranking-caption">
            Traders assume the market continues indefinitely and make decisions
            without knowing when the competition ends. Score: held units ×
            published reference price − remaining acquisition cost.
            Realized gains do not count. Final scores are saved before
            redemption. Participant cash rankings are separate.
          </caption>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Trader</th>
              <th>Strategy</th>
              <th>Score / DUSD</th>
              <th>Cash / DUSD</th>
              {s.instruments.map((i) => (
                <th key={i.symbol}>{i.symbol}</th>
              ))}
              <th>Rounds decided</th>
            </tr>
          </thead>
          <tbody>
            {(s.retailTraders ?? []).map((a) => (
              <tr key={a.id}>
                <td>
                  <span className="pill">{a.rank}</span>
                </td>
                <td>{a.name}</td>
                <td>{a.policy}</td>
                <td className={a.score >= 0 ? "positive" : "negative"}>
                  {money(a.score)}
                </td>
                <td>{money(a.cash)}</td>
                {s.instruments.map((i) => (
                  <td key={i.symbol}>{a.holdings[i.symbol]}</td>
                ))}
                <td>
                  {a.decisions} / {s.config.rounds}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!s.retailTraders?.length && (
          <div className="empty">
            Five simulated retail traders join automatically at the start and
            make a decision for each instrument every round.
          </div>
        )}
      </div>
    </section>
  );
}
