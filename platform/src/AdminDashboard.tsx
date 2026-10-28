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
const events: Record<string, string> = {
  created: "创建比赛",
  joined: "Agent 注册",
  agent_joined: "Agent 注册",
  started: "比赛开始",
  paused: "比赛暂停",
  resumed: "比赛恢复",
  round_settled: "轮次结算",
  redeemed: "终值兑换",
};
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
          <span>{page ? "管理员已验证" : "验证凭证后加载后台数据"}</span>
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
                {loading ? "正在更新" : "刷新数据"}
              </button>
              <button
                className="textbutton"
                onClick={() => {
                  setEnabled(false);
                  setPage(null);
                  setDetail(null);
                  lock();
                }}
              >
                <LockKeyhole size={15} />
                锁定后台
              </button>
            </>
          ) : (
            <button
              className="primary"
              disabled={!token}
              onClick={() => setEnabled(true)}
            >
              进入管理后台
            </button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}。请检查凭证或刷新重试。
        </div>
      )}
      {!page && (
        <section className="admin-locked panel padding">
          <LockKeyhole size={25} />
          <div>
            <h2>{loading ? "正在读取赛事账本…" : "赛事运行，一处掌握"}</h2>
            <p className="hint">
              验证后查看赛事总览、决策参与情况、结算状态和运行事件。管理凭证只保留在当前页面内存。
            </p>
          </div>
        </section>
      )}
      {page && (
        <>
          <div className="admin-section-title row between">
            <h2>赛事总览</h2>
            <span className="hint">
              本页统计 · 每 15 秒更新 ·{" "}
              {new Date(page.serverTime).toLocaleTimeString("zh-CN")}
            </span>
          </div>
          <div className="admin-kpis">
            {[
              [
                Activity,
                "进行中的比赛",
                rows.filter((m) => m.status === "running").length,
                "当前页",
              ],
              [
                Users,
                "参赛席位",
                rows.reduce((n, m) => n + m.participants, 0),
                "跨场注册分别计数",
              ],
              [
                ArrowLeftRight,
                "累计成交",
                rows.reduce((n, m) => n + m.trades, 0),
                "撮合成功笔数",
              ],
              [
                ShieldCheck,
                "需处理异常",
                issues.length + page.failures.length,
                "调度 / 守恒 / 成交复核 / 读取异常",
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
                  {m.name}：
                  {!m.conserved
                    ? "资产守恒校验异常，请暂停并导出审计。"
                    : m.pauseReason === "scheduler_delay"
                      ? "调度延迟保护暂停，请检查后恢复。"
                      : "发现成交复核信号，请在发奖前核查。"}
                </p>
              ))}
              {page.failures.map((m) => (
                <p key={m.id}>{m.name}：读取失败，本页汇总不包含此场比赛。</p>
              ))}
            </div>
          )}
          <section className="panel admin-market-list">
            <div className="paneltitle">
              <h2>比赛列表</h2>
              <label className="row hint">
                状态
                <select
                  className="select"
                  aria-label="筛选赛事状态"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">全部</option>
                  {Object.entries(statusName).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>比赛</th>
                    <th>状态</th>
                    <th>轮次</th>
                    <th>参赛席位</th>
                    <th>本轮决定</th>
                    <th>成交笔数</th>
                    <th>管理</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr
                      key={m.id}
                      className={id === m.id ? "admin-selected" : ""}
                    >
                      <td>
                        <strong>{m.name}</strong>
                        <small className="admin-row-id">
                          {m.id} · {m.practice ? "练习赛" : "正式赛"}
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
                          aria-label={`管理 ${m.name}`}
                        >
                          查看赛事 ↗
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!shown.length && (
                <div className="empty">本页没有符合条件的比赛。</div>
              )}
            </div>
            <div className="admin-pagination row between">
              <span className="hint">
                最近 {page.catalogCount} 场中的第{" "}
                {page.catalogCount
                  ? Math.min(offset + 1, page.catalogCount)
                  : 0}
                –{Math.min(offset + 20, page.catalogCount)} 场（目录最多展示最近
                100 场索引）
              </span>
              <div className="row">
                <button
                  className="secondary"
                  disabled={!offset || loading}
                  onClick={() => setOffset((n) => Math.max(0, n - 20))}
                >
                  上一页
                </button>
                <button
                  className="secondary"
                  disabled={page.nextOffset === null || loading}
                  onClick={() => setOffset(page.nextOffset!)}
                >
                  下一页
                </button>
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
                <a className="secondary admin-anchor" href="#admin-management">
                  赛事操作 ↓
                </a>
              </div>
              <div className="admin-detail-grid">
                <section className="panel padding">
                  <div className="row between">
                    <h2>结算进度</h2>
                    <span className="badge">{statusName[detail.status]}</span>
                  </div>
                  <div className="admin-progress-number">
                    {detail.completedRounds}
                    <small> / {detail.rounds} 轮已结算</small>
                  </div>
                  <progress
                    max={detail.rounds}
                    value={detail.completedRounds}
                    aria-label="已结算轮次"
                  />
                  <div className="ticket-facts admin-health">
                    <div>
                      <dt>资产守恒</dt>
                      <dd
                        className={detail.conserved ? "positive" : "negative"}
                      >
                        {detail.conserved ? "校验通过" : "校验异常"}
                      </dd>
                    </div>
                    <div>
                      <dt>最近结算延迟</dt>
                      <dd>
                        {detail.settlementDelayMs === null
                          ? "尚未结算"
                          : `${detail.settlementDelayMs} ms`}
                      </dd>
                    </div>
                    <div>
                      <dt>已接受决定</dt>
                      <dd>{detail.decisions}</dd>
                    </div>
                  </div>
                  <p className="hint">
                    延迟为实际结算时间减去计划时间，不代表 API 响应延迟。
                  </p>
                </section>
                <section className="panel">
                  <div className="paneltitle">
                    <h2>最近运行事件</h2>
                    <span className="hint">最近 20 条</span>
                  </div>
                  <ol className="admin-events">
                    {detail.events.map((e) => (
                      <li key={e.seq}>
                        <span>{events[e.type] || e.type}</span>
                        <time>
                          {new Date(e.at).toLocaleTimeString("zh-CN")}
                        </time>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
              <section className="panel">
                <div className="paneltitle">
                  <h2>交易公平性复核</h2>
                  <span className="badge">
                    {detail.integrity.requiresReview
                      ? "需人工复核"
                      : "未触发规则"}
                  </span>
                </div>
                <div className="padding stack">
                  <p className="hint">
                    已结算成交偏离当轮开盘参考价 ≥25%，或至少 3
                    人参赛时同一对手组合占 ≥70% 成交且不少于 5
                    笔，会触发提醒。规则不能认定或排除串谋，不自动扣分。发奖前请核对参赛人、Agent
                    ID 与完整审计。
                  </p>
                  <p>
                    {detail.integrity.offReferenceTrades} 笔偏价成交 ·{" "}
                    {detail.integrity.flaggedPairs} 组需复核对手（最多显示 20
                    组）
                  </p>
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
                      <p>
                        {p.trades} 笔 / {p.volume} DAT · 偏价{" "}
                        {p.offReferenceTrades} 笔 · 最大偏离{" "}
                        {(p.maxDeviationBps / 100).toFixed(2)}%
                        {p.concentrated ? " · 对手集中" : ""}
                      </p>
                      <small className="admin-row-id">
                        {p.agentIds.join(" / ")}
                      </small>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <div className="paneltitle">
                  <h2>参与者与决策情况</h2>
                  <span className="hint">
                    第 {detail.round} 轮 · 不公开未结算订单方向与价格
                  </span>
                </div>
                <div className="tablewrap admin-participants">
                  <table>
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th>能力说明</th>
                        <th>当前轮决定</th>
                        <th>累计决定</th>
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
                            {a.description || "未填写"}
                          </td>
                          <td>
                            {detail.round
                              ? a.decided
                                ? "已提交"
                                : detail.status === "finished"
                                  ? "未参与"
                                  : "尚未提交"
                              : "尚未开赛"}
                          </td>
                          <td>{a.decisions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!detail.agents.length && (
                    <div className="empty">还没有 Agent 注册。</div>
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
