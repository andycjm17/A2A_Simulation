import { t, rich, useLocale, localizedLabels, localeTag, message, displayName, displayMarketName } from "./i18n";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Users,
  ArrowLeftRight,
  ShieldCheck,
  RefreshCw,
  LockKeyhole,
} from "lucide-react";
import { api, statusName } from "./App";
import type { AdminStatus, DashboardPage } from "../worker/admin-status";
const events: Record<string, string> = localizedLabels({
  created: "创建比赛",
  joined: "Agent 注册",
  agent_joined: "Agent 注册",
  started: "比赛开始",
  paused: "比赛暂停",
  resumed: "比赛恢复",
  round_settled: "轮次结算",
  redeemed: "终值兑换",
});
export function AdminDashboard({
  token,
  id,
  revision,
  select,
  lock,
}: {
  token: string;
  id: string;
  revision: number;
  select: (id: string) => Promise<void>;
  lock: () => void;
}) {
  useLocale();
  const [enabled, setEnabled] = useState(false),
    [page, setPage] = useState<DashboardPage | null>(null),
    [detail, setDetail] = useState<AdminStatus | null>(null),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all");
  const currentToken = useRef(token);
  currentToken.current = token;
  useEffect(() => {
    setEnabled(false);
    setPage(null);
    setDetail(null);
    setError("");
    setOffset(0);
    setLoading(false);
  }, [token]);
  useEffect(() => {
    if (!enabled || !token) return;
    let dead = false,
      inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const result: DashboardPage = await api(
          `/api/admin/dashboard?offset=${offset}`,
          token,
        );
        if (dead || currentToken.current !== token) return;
        const selected = id
          ? result.markets.find((m) => m.id === id) ||
            (await api(`/api/admin/markets/${id}/status`, token))
          : null;
        if (!dead && currentToken.current === token) {
          setPage(result);
          setDetail(selected);
          setError("");
        }
      } catch (e) {
        if (!dead && currentToken.current === token) {
          setError((e as Error).message);
          setPage(null);
          setDetail(null);
        }
      } finally {
        inFlight = false;
        if (!dead) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [enabled, token, id, offset, tick, revision]);
  const rows = page?.markets || [],
    shown = rows.filter((m) => filter === "all" || m.status === filter);
  const issues = rows.filter(
    (m) =>
      !m.conserved ||
      m.pauseReason === "scheduler_delay" ||
      m.integrity.requiresReview,
  );
  return (
    <div className="admin-dashboard">
      <div className="admin-session row between">
        <div className="row">
          <ShieldCheck size={19} />
          <span>{page ? t("md0cb2c79bc") : t("mc166de5220")}</span>
        </div>
        <div className="row">
          {enabled ? (
            <>
              <button
                className="secondary"
                disabled={loading}
                onClick={() => setTick((n) => n + 1)}
              >
                <RefreshCw size={15} />
                {loading ? t("m2336147a7f") : t("m0468ee76ee")}
              </button>
              <button
                className="textbutton"
                onClick={() => {
                  setEnabled(false);
                  setPage(null);
                  setDetail(null);
                  lock();
                }}
              >{rich("m9fa3d8d528", [<LockKeyhole size={15} />])}</button>
            </>
          ) : (
            <button
              className="primary"
              disabled={!token}
              onClick={() => setEnabled(true)}
            >{rich("mbde5e6fb16")}</button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="notice error">{rich("m2a186148b5", [message(error)])}</div>
      )}
      {!page && (
        <section className="admin-locked panel padding">
          <LockKeyhole size={25} />
          <div>
            <h2>{loading ? t("m81b8821774") : t("m7c89ce963c")}</h2>
            <p className="hint">{rich("md9308fb17d")}</p>
          </div>
        </section>
      )}
      {page && (
        <>
          <div className="admin-section-title row between">
            <h2>{rich("md8429aafda")}</h2>
            <span className="hint">{rich("mb2f1b27595", [new Date(page.serverTime).toLocaleTimeString(localeTag())])}</span>
          </div>
          <div className="admin-kpis">
            {[
              [
                Activity,
                t("m74b37be9ed"),
                rows.filter((m) => m.status === "running").length,
                t("mc71a069dc5"),
              ],
              [
                Users,
                t("m85b636dce3"),
                rows.reduce((n, m) => n + m.participants, 0),
                t("mae12fe63ae"),
              ],
              [
                ArrowLeftRight,
                t("m31369dffb9"),
                rows.reduce((n, m) => n + m.trades, 0),
                t("m9a8c2de300"),
              ],
              [
                ShieldCheck,
                t("mb194df33e0"),
                issues.length + page.failures.length,
                t("m7afdfcb3fa"),
              ],
            ].map(([Icon, label, value, caption]) => {
              const I = Icon as typeof Activity;
              return (
                <section className="admin-kpi" key={String(label)}>
                  <div className="row between">
                    <span>{String(label)}</span>
                    <I size={18} />
                  </div>
                  <strong>{String(value)}</strong>
                  <small>{String(caption)}</small>
                </section>
              );
            })}
          </div>
          {(issues.length > 0 || page.failures.length > 0) && (
            <div className="notice" role="status">
              {issues.map((m) => (
                <p key={m.id}>
                  {displayMarketName(m.name)}{localeTag()==='en-US'?': ':'：'}
                  {!m.conserved
                    ? t("mdd0157e4f6")
                    : m.pauseReason === "scheduler_delay"
                      ? t("m85380d5d6e")
                      : t("mbcc2a20bb6")}
                </p>
              ))}
              {page.failures.map((m) => (
                <p key={m.id}>{rich("m9c39667958", [m.name])}</p>
              ))}
            </div>
          )}
          <section className="panel admin-market-list">
            <div className="paneltitle">
              <h2>{rich("m6641c5b3e7")}</h2>
              <label className="row hint">{rich("m1bd0855b9a", [<select
                  className="select"
                  aria-label={t("m293fbf6a30")}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">{rich("m5c55a67935")}</option>
                  {Object.entries(statusName).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </select>])}</label>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>{rich("m7595b4b87e")}</th>
                    <th>{rich("m6320b4a872")}</th>
                    <th>{rich("m4890584bb5")}</th>
                    <th>{rich("m85b636dce3")}</th>
                    <th>{rich("m5337e2b6db")}</th>
                    <th>{rich("m29889f8cc9")}</th>
                    <th>{rich("mbb6d995724")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr
                      key={m.id}
                      className={id === m.id ? "admin-selected" : ""}
                    >
                      <td>
                        <strong>{displayMarketName(m.name)}</strong>
                        <small className="admin-row-id">
                          {m.id} · {m.practice ? t("maec9fca791") : t("md1cf34ca68")}
                        </small>
                      </td>
                      <td>
                        <span className="badge">{statusName[m.status]}</span>
                      </td>
                      <td>
                        {m.round} / {m.rounds}
                      </td>
                      <td>
                        {m.participants} / {m.capacity}
                      </td>
                      <td>
                        {m.round
                          ? `${m.currentDecisions} / ${m.participants}`
                          : "—"}
                      </td>
                      <td>{m.trades}</td>
                      <td>
                        <button
                          className="textbutton"
                          onClick={() =>
                            void select(m.id).catch((e) =>
                              setError((e as Error).message),
                            )
                          }
                          aria-label={t("m443cb3b17b", [m.name])}
                        >{rich("mf26f11ae4f")}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!shown.length && (
                <div className="empty">{rich("mb73df6fbc6")}</div>
              )}
            </div>
            <div className="admin-pagination row between">
              <span className="hint">{rich("mca00a4c911", [page.catalogCount, page.catalogCount
                  ? Math.min(offset + 1, page.catalogCount)
                  : 0, Math.min(offset + 20, page.catalogCount)])}</span>
              <div className="row">
                <button
                  className="secondary"
                  disabled={!offset || loading}
                  onClick={() => setOffset((n) => Math.max(0, n - 20))}
                >{rich("mec97570fa9")}</button>
                <button
                  className="secondary"
                  disabled={page.nextOffset === null || loading}
                  onClick={() => setOffset(page.nextOffset!)}
                >{rich("m66a455c41f")}</button>
              </div>
            </div>
          </section>
          {detail && detail.id === id && (
            <>
              <div className="admin-section-title row between">
                <div>
                  <span className="eyebrow">SELECTED COMPETITION</span>
                  <h2>{detail.name}</h2>
                </div>
                <a className="secondary admin-anchor" href="#admin-management">{rich("m9308ca8ef1")}</a>
              </div>
              <div className="admin-detail-grid">
                <section className="panel padding">
                  <div className="row between">
                    <h2>{rich("mdd5caa6040")}</h2>
                    <span className="badge">{statusName[detail.status]}</span>
                  </div>
                  <div className="admin-progress-number">
                    {detail.completedRounds}
                    <small>{rich("m2039dfcf33", [detail.rounds])}</small>
                  </div>
                  <progress
                    max={detail.rounds}
                    value={detail.completedRounds}
                    aria-label={t("mef0c8e2bef")}
                  />
                  <div className="ticket-facts admin-health">
                    <div>
                      <dt>{rich("m9284612832")}</dt>
                      <dd
                        className={detail.conserved ? "positive" : "negative"}
                      >
                        {detail.conserved ? t("m3051a776ea") : t("mc5bc81e882")}
                      </dd>
                    </div>
                    <div>
                      <dt>{rich("m812446b0ac")}</dt>
                      <dd>
                        {detail.settlementDelayMs === null
                          ? t("m0ea2010511")
                          : `${detail.settlementDelayMs} ms`}
                      </dd>
                    </div>
                    <div>
                      <dt>{rich("md1866015e7")}</dt>
                      <dd>{detail.decisions}</dd>
                    </div>
                  </div>
                  <p className="hint">{rich("m079e90e8b5")}</p>
                </section>
                <section className="panel">
                  <div className="paneltitle">
                    <h2>{rich("m324375246f")}</h2>
                    <span className="hint">{rich("m11366cf63b")}</span>
                  </div>
                  <ol className="admin-events">
                    {detail.events.map((e) => (
                      <li key={e.seq}>
                        <span>{events[e.type] || e.type}</span>
                        <time>
                          {new Date(e.at).toLocaleTimeString(localeTag())}
                        </time>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
              <section className="panel">
                <div className="paneltitle">
                  <h2>{rich("m9a2ea2a2b5")}</h2>
                  <span className="badge">
                    {detail.integrity.requiresReview
                      ? t("md4dfce3469")
                      : t("m212880dc21")}
                  </span>
                </div>
                <div className="padding stack">
                  <p className="hint">{rich("mc37c9e7118")}</p>
                  <p>{rich("m57cf9f3473", [detail.integrity.offReferenceTrades, detail.integrity.flaggedPairs])}</p>
                  {detail.integrity.pairs.map((p) => (
                    <div className="notice" key={p.agentIds.join(":")}>
                      <strong>
                        {p.agentIds
                          .map(
                            (agentId) =>
                              detail.agents.find((a) => a.id === agentId)
                                ?.name || agentId,
                          )
                          .join(" ↔ ")}
                      </strong>
                      <p>{rich("m305d0d94f1", [p.trades, p.volume, p.offReferenceTrades, (p.maxDeviationBps / 100).toFixed(2), p.concentrated ? t("m4849083826") : ""])}</p>
                      <small className="admin-row-id">
                        {p.agentIds.join(" / ")}
                      </small>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <div className="paneltitle">
                  <h2>{rich("m695e5d6288")}</h2>
                  <span className="hint">{rich("m7cdcf286b6", [detail.round])}</span>
                </div>
                <div className="tablewrap admin-participants">
                  <table>
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>{rich("m68d67ce74e")}</th>
                        <th>{rich("m63e8ec97e1")}</th>
                        <th>{rich("m3d7206102d")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.agents.map((a) => (
                        <tr key={a.id}>
                          <td>
                            {a.name}
                            <small className="admin-row-id">{a.id}</small>
                          </td>
                          <td className="admin-description">
                            {a.description || t("m7f05190592")}
                          </td>
                          <td>
                            {detail.round
                              ? a.decided
                                ? t("mbc37a6110a")
                                : detail.status === "finished"
                                  ? t("me6e4194d6b")
                                  : t("m2c49a14f28")
                              : t("me71c9ff6df")}
                          </td>
                          <td>{a.decisions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!detail.agents.length && (
                    <div className="empty">{rich("m6cba971676")}</div>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
