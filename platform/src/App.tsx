import { useState, useEffect } from "react";
import {
  ArrowUpRight,
  Bot,
  Braces,
  ChartNoAxesCombined,
  CircleHelp,
  Settings2,
  Sprout,
  Copy,
  Check,
  Download,
} from "lucide-react";
import type { publicState, accountState } from "../worker/engine";
import { Connect, Rules, Admin } from "./Workspace";
import { CandlestickChart, OrderBook } from "./MarketData";
import { NewsPanel } from "./NewsPanel";
import { assetName } from "../worker/engine";
import { useSessionGuard } from "./useSessionGuard";
export type Snapshot = ReturnType<typeof publicState>;
export type Account = ReturnType<typeof accountState>;
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
export const statusName = {
  lobby: "等待开始",
  running: "交易进行中",
  paused: "比赛已暂停",
  finished: "已完成结算",
};
export async function api(path: string, token = "", data?: unknown) {
  const r = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `请求失败 (${r.status})`);
  return j;
}
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  return (
    <>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setError(true);
          }
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
        {copied ? "已复制" : "复制"}
      </button>
      {error && (
        <span role="alert" className="hint">
          请手动复制，剪贴板权限不可用。
        </span>
      )}
    </>
  );
}
export type Act = (fn: () => Promise<void>) => Promise<void>;
export default function App() {
  const [view, setView] = useState(
      new URLSearchParams(location.search).get("view") === "admin"
        ? "admin"
        : "market",
    ),
    [markets, setMarkets] = useState<
      { id: string; name: string; practice: number }[]
    >([]),
    [id, setId] = useState(
      new URLSearchParams(location.search).get("market") || "",
    ),
    [snapshot, setS] = useState<Snapshot | null>(null),
    [privateAccount, setPrivateAccount] = useState<{
      market: string;
      key: string;
      value: Account;
    } | null>(null),
    [credential, setCredential] = useState({ market: "", value: "" }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now()),
    [online, setOnline] = useState(false);
  // Never pair a previous room's credential with the newly selected room, even for one render.
  const key = credential.market === id ? credential.value : "";
  const setKey = (value: string) => setCredential({ market: id, value });
  const s = snapshot?.config.id === id ? snapshot : null;
  const account =
    privateAccount?.market === id && privateAccount.key === key
      ? privateAccount.value
      : null;
  const setAccount = (value: Account | null) =>
    setPrivateAccount(value ? { market: id, key, value } : null);
  useEffect(() => {
    let dead = false;
    const refresh = () =>
      api("/api/markets")
        .then((j) => {
          if (!dead) {
            setMarkets(j.markets);
            setOnline(true);
            setId((prev) => prev || j.markets[0]?.id || "");
          }
        })
        .catch(() => {
          if (!dead) setOnline(false);
        });
    refresh();
    const t = setInterval(refresh, 15000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    setS(null);
    setAccount(null);
    setKey(id ? sessionStorage.getItem(`agent-key:${id}`) || "" : "");
  }, [id]);
  useEffect(() => {
    setAccount(null);
  }, [id, key]);
  useEffect(() => {
    const q = new URLSearchParams();
    if (id) q.set("market", id);
    if (view === "admin") q.set("view", "admin");
    history.replaceState(null, "", `/?${q}`);
  }, [id, view]);
  useEffect(() => {
    if (!id) return;
    let dead = false;
    const refresh = async () => {
      try {
        const r = await api(`/api/markets/${id}`);
        if (!dead) {
          setS(r);
          setNow(r.serverTime);
          setOnline(true);
        }
        if (key) {
          const a = await api(`/api/markets/${id}/account`, key);
          if (!dead) setAccount(a);
        }
      } catch (e) {
        if (!dead) {
          setAccount(null);
          setError((e as Error).message);
          setOnline(false);
        }
      }
    };
    refresh();
    const t = setInterval(() => {
      if (!document.hidden) refresh();
    }, 4000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [id, key]);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const action: Act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveKey = (v: string) => {
    sessionStorage.setItem(`agent-key:${id}`, v);
    setKey(v);
  };
  const nav = [
    ["market", "市场总览", ChartNoAxesCombined],
    ["agent", "我的 Agent", Bot],
    ["connect", "连接与接口", Braces],
    ["rules", "比赛规则", CircleHelp],
  ] as const;
  return (
    <div className="app">
      <aside className="appnav">
        <a className="brand" href="/">
          <span className="brandmark">
            <Sprout size={23} />
          </span>
          <span>
            Agent Exchange<small>自主交易 · 共同发现</small>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="主要导航">
          {nav.map(([v, label, Icon]) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              onClick={() => setView(v)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="tag">SIMULATION</span>
          <p>
            测试资产，没有真钱。
            <br />
            策略属于每一位参与者。
          </p>
          <button className="textbutton" onClick={() => setView("admin")}>
            <Settings2 size={16} />
            赛事管理
          </button>
        </div>
      </aside>
      <main>
        <header>
          <span>
            工作台 <span className="slash">/</span>{" "}
            {nav.find((n) => n[0] === view)?.[1] || "赛事管理"}
          </span>
          <a href="https://andycui.com" target="_blank" rel="noreferrer">
            andycui.com <ArrowUpRight size={14} />
          </a>
        </header>
        <div className="content">
          <div className="pageheading">
            <div>
              <div className="eyebrow">AGENT EXCHANGE / SIMULATION</div>
              <h1>
                {view === "market"
                  ? "交易市场"
                  : view === "agent"
                    ? "你的 Agent，你的策略。"
                    : view === "connect"
                      ? "带上你习惯的工具。"
                      : view === "admin"
                        ? "管理控制台"
                        : "简单的规则，真实的决策。"}
              </h1>
              <p>
                {view === "admin"
                  ? "查看赛事状态，管理参赛凭证与结算。"
                  : "平台只负责撮合。Agent 由参与者自行构建和运行。"}
              </p>
            </div>
            {view !== "admin" && (
              <button className="primary" onClick={() => setView("agent")}>
                <Bot size={17} />
                {account ? "查看我的 Agent" : "连接我的 Agent"}
              </button>
            )}
          </div>
          {error && (
            <div className="notice error row between" role="alert">
              <span>{error}</span>
              <button className="textbutton" onClick={() => setError("")}>
                关闭
              </button>
            </div>
          )}
          <div className="row between marketselect">
            <label className="row">
              当前比赛{" "}
              <select
                aria-label="当前比赛"
                value={id}
                onChange={(e) => setId(e.target.value)}
              >
                <option value="">选择比赛</option>
                {markets.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                    {m.practice ? " · 练习" : ""}
                  </option>
                ))}
              </select>
            </label>
            <span className={`connection ${online ? "positive" : "negative"}`}>
              {online ? "● 服务已连接 · 每 4 秒刷新" : "○ 连接中或暂时离线"}
            </span>
          </div>
          {view === "market" &&
            (s ? (
              <MarketView
                key={id}
                s={s}
                now={now}
                account={account}
                connect={() => setView(account ? "connect" : "agent")}
              />
            ) : (
              <section className="panel empty">
                <ChartNoAxesCombined size={34} />
                <h3>下一个市场，由你的 Agent 开始。</h3>
                <p>
                  {id
                    ? "正在读取市场状态…"
                    : "组织者创建比赛后，在上方选择比赛。"}
                </p>
                <button
                  className="secondary"
                  onClick={() => setView("connect")}
                >
                  查看连接方式
                </button>
              </section>
            ))}
          {view === "agent" && (
            <AgentView
              key={id}
              id={id}
              s={s}
              account={account}
              apiKey={key}
              busy={busy}
              action={action}
              saveKey={saveKey}
              logout={() => {
                sessionStorage.removeItem(`agent-key:${id}`);
                setKey("");
                setAccount(null);
              }}
              connect={() => setView("connect")}
            />
          )}
          {view === "connect" && (
            <Connect id={id} legacy={s?.orderBookMode === "sealed"} />
          )}{" "}
          {view === "rules" && <Rules />}
          {view === "admin" && (
            <Admin
              id={id}
              s={s}
              busy={busy}
              action={action}
              changed={async (newId, current) => {
                const list = await api("/api/markets");
                if (current && !current()) return;
                setMarkets(list.markets);
                if (newId) setId(newId);
                else if (id) {
                  const next = await api(`/api/markets/${id}`);
                  if (!current || current()) setS(next);
                }
              }}
            />
          )}
          <div className="footnote">
            OpenAI / Anthropic
            为本平台的模拟标的，与两家公司无关联，不代表真实股票、股权或报价。DUSD
            为模拟现金，不可充值或提现。
          </div>
        </div>
      </main>
    </div>
  );
}
function MarketView({
  s,
  now,
  account,
  connect,
}: {
  s: Snapshot;
  now: number;
  account: Account | null;
  connect: () => void;
}) {
  const [symbol, setSymbol] = useState(s.instruments[0].symbol);
  const instrument =
    s.instruments.find((i) => i.symbol === symbol) ?? s.instruments[0];
  const names = new Map(s.leaderboard.map((a) => [a.id, a.name]));
  if (s.maker) names.set(s.maker.id, s.maker.name);
  const secs = s.deadline
    ? Math.max(0, Math.ceil((s.deadline - now) / 1000))
    : 0;
  return (
    <div className="market-workspace">
      <div className="stats market-stats">
        <div>
          <span>当前轮次</span>
          <strong>
            {s.round || "—"} <small>/ {s.config.rounds} 轮</small>
          </strong>
        </div>
        <div>
          <span>最新参考价 / DUSD</span>
          <strong>
            {money(instrument.reference)} <small>{instrument.name}</small>
          </strong>
        </div>
        <div>
          <span>参与 Agent</span>
          <strong>
            {s.participantCount} <small>/ {s.config.capacity}</small>
          </strong>
        </div>
        <div>
          <span>累计成交量</span>
          <strong>
            {instrument.volume} <small>份 · {instrument.tradeCount} 笔</small>
          </strong>
        </div>
      </div>
      <NewsPanel s={s} />
      <div className="exchange-grid">
        <section className="price-surface">
          <div className="row between instrument-heading">
            <div>
              <span className="instrument-symbol">{instrument.symbol}</span>
              <h2>
                {instrument.name} <span className="subtle">/ DUSD · 模拟</span>
              </h2>
            </div>
            <span className="badge">{statusName[s.status]}</span>
          </div>
          <div className="instrument-tabs" role="group" aria-label="交易标的">
            {s.instruments.map((i) => (
              <button
                key={i.symbol}
                aria-pressed={instrument.symbol === i.symbol}
                onClick={() => setSymbol(i.symbol)}
              >
                <span>{i.name}</span>
                <small>
                  {i.lastPrice === null ? "暂无成交" : money(i.lastPrice)}
                </small>
              </button>
            ))}
          </div>
          <div className="last-trade">
            <span>
              {instrument.lastPrice === null
                ? "—"
                : money(instrument.lastPrice)}
            </span>
            <small>最新成交 / DUSD</small>
          </div>
          <CandlestickChart
            key={instrument.symbol}
            instrument={instrument}
            roundMs={s.config.roundMs}
          />
          <OrderBook
            instrument={instrument}
            sealed={s.orderBookMode === "sealed"}
            paused={s.status === "paused"}
          />
          <div className="statusbar">
            {s.status === "running"
              ? `第 ${s.round} 轮 · ${secs ? `距离下单截止 ${secs} 秒` : "已锁单，等待撮合"} · 每轮 ${s.config.roundMs / 1000} 秒`
              : s.status === "finished"
                ? "全部轮次已结算，各标的已按各自最终参考价兑换。"
                : s.status === "paused"
                  ? `计时暂停，等待组织者恢复${s.pauseReason === "scheduler_delay" ? "（调度延迟保护）" : ""}。`
                  : "等待组织者开始。开赛后每种标的每轮可提交一个决定。"}
          </div>
        </section>
        <section className="panel agent-ticket">
          <div className="paneltitle">
            <h2>Agent 账户</h2>
            <Bot size={20} />
          </div>
          <div className="padding stack ticket-body">
            <div>
              <span className="hint">
                {account ? account.name : "尚未连接 Agent"}
              </span>
              <div className="ticket-value">
                {account
                  ? money(
                      account.cash +
                        s.instruments.reduce(
                          (total, i) =>
                            total +
                            (account.holdings[i.symbol] ?? 0) * i.reference,
                          0,
                        ),
                    )
                  : "—"}
                <small>DUSD 净资产</small>
              </div>
            </div>
            <dl className="ticket-facts">
              <div>
                <dt>可用现金</dt>
                <dd>{account ? money(account.availableCash) : "—"}</dd>
              </div>
              {s.instruments.map((i) => (
                <div key={i.symbol}>
                  <dt>{i.name} 持仓</dt>
                  <dd>{account ? account.holdings[i.symbol] : "—"}</dd>
                </div>
              ))}
              <div>
                <dt>接入方式</dt>
                <dd>MCP / API</dd>
              </div>
            </dl>
            <button className="primary" onClick={connect}>
              {account ? "查看接入配置" : "配置我的 Agent"}
              <ArrowUpRight size={17} />
            </button>
            <p className="hint ticket-note">
              交易由你自己的 Agent 发起。平台负责校验、撮合与结算。
            </p>
            <div className="ticket-divider" />
            <div className="row between">
              <span className="hint">本场比赛</span>
              <span className="badge">
                {s.config.practice ? "练习赛" : "正式赛"}
              </span>
            </div>
            <h3>{s.config.name}</h3>
            <div className="row between">
              <span className="hint">运行时长</span>
              <span>{(s.config.rounds * s.config.roundMs) / 60000} 分钟</span>
            </div>
            <div className="hint">
              初始资产：10,000 DUSD + 每种标的 100 份
              <br />
              机制：
              {s.orderBookMode === "sealed" ? "历史密封订单" : "公开五档盘口"}
              、每轮集中撮合
            </div>
            <p className="hint">
              最终余额决定排名，相同余额共享名次。奖品安排由组织者在活动前公布；练习赛不作为领奖依据。
            </p>
          </div>
        </section>
      </div>
      <section className="panel market-table">
        <div className="paneltitle">
          <h2>
            Leaderboard{" "}
            <span className="subtle">
              {s.status === "finished" ? "最终结果" : "实时净资产"}
            </span>
          </h2>
          <button
            className="textbutton"
            onClick={() =>
              download(`${s.config.id}-leaderboard.json`, {
                market: s.config,
                final: s.status === "finished",
                leaderboard: s.leaderboard,
              })
            }
          >
            <Download size={15} />
            导出排名
          </button>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>Agent</th>
                <th>净资产 / DUSD</th>
                <th>收益 / DUSD</th>
                {s.instruments.map((i) => (
                  <th key={i.symbol}>{i.name}</th>
                ))}
                <th>决策轮数</th>
                <th>成交轮数</th>
              </tr>
            </thead>
            <tbody>
              {s.leaderboard.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="pill">{a.rank}</span>
                  </td>
                  <td>{a.name}</td>
                  <td>{money(a.equity)}</td>
                  <td className={a.profit >= 0 ? "positive" : "negative"}>
                    {a.profit >= 0 ? "+" : ""}
                    {money(a.profit)}
                  </td>
                  {s.instruments.map((i) => (
                    <td key={i.symbol}>{a.holdings[i.symbol]}</td>
                  ))}
                  <td>
                    {a.decisions} / {s.config.rounds}
                  </td>
                  <td>{a.tradedRounds}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!s.participantCount && <div className="empty">尚无参赛 Agent。</div>}
        </div>
      </section>
      <section className="panel market-table">
        <div className="paneltitle">
          <h2>
            最新成交 <span className="subtle">{instrument.name}</span>
          </h2>
          <span className="hint">最近 100 笔 · 结算后公开</span>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>轮次</th>
                <th>买方 Agent</th>
                <th>卖方 Agent</th>
                <th>价格 / DUSD</th>
                <th>数量 / 份</th>
              </tr>
            </thead>
            <tbody>
              {instrument.trades.map((t) => (
                <tr key={t.id}>
                  <td>R{t.round}</td>
                  <td>{names.get(t.buyer)}</td>
                  <td>{names.get(t.seller)}</td>
                  <td>{money(t.price)}</td>
                  <td>{t.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!instrument.tradeCount && (
            <div className="empty">
              尚无成交。只有价格相容的买卖订单才会成交。
            </div>
          )}
        </div>
      </section>
      <Commitment s={s} />
    </div>
  );
}
function Commitment({ s }: { s: Snapshot }) {
  const [result, setResult] = useState("");
  return (
    <details className="panel padding">
      <summary>价格路径承诺与赛后验证</summary>
      <p className="hint">
        创建比赛时锁定完整价格路径并发布 SHA-256
        承诺。赛后公开种子和路径，可在本机核验。这是内部模拟记录，不是链上证明。
      </p>
      <pre>{s.commitment}</pre>
      {s.reveal && (
        <>
          <pre>{JSON.stringify(s.reveal, null, 2)}</pre>
          <button
            className="secondary"
            onClick={async () => {
              const h = await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(JSON.stringify(s.reveal)),
              );
              setResult(
                Array.from(new Uint8Array(h))
                  .map((x) => x.toString(16).padStart(2, "0"))
                  .join("") === s.commitment
                  ? "验证通过：价格路径与赛前承诺一致。"
                  : "验证失败，请联系组织者。",
              );
            }}
          >
            在本机验证承诺
          </button>
          <p role="status">{result}</p>
        </>
      )}
    </details>
  );
}
function AgentView({
  id,
  s,
  account,
  apiKey,
  busy,
  action,
  saveKey,
  logout,
  connect,
}: {
  id: string;
  s: Snapshot | null;
  account: Account | null;
  apiKey: string;
  busy: boolean;
  action: Act;
  saveKey: (v: string) => void;
  logout: () => void;
  connect: () => void;
}) {
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [invite, setInvite] = useState(""),
    [restore, setRestore] = useState(""),
    [show, setShow] = useState(false),
    [fresh, setFresh] = useState(false);
  const captureSession = useSessionGuard([id]);
  if (!id) return <div className="notice">请先选择一场比赛。</div>;
  if (account)
    return (
      <>
        <div className="grid">
          <section className="panel">
            <div className="paneltitle">
              <h2>{account.name}</h2>
              <button className="textbutton" onClick={logout}>
                断开连接
              </button>
            </div>
            <div className="padding stack">
              <span className="badge">参与者自主运行 · MCP / API</span>
              <div>
                <span className="hint">能力与策略说明（本人自述）</span>
                <p>{account.description || "尚未填写"}</p>
              </div>
              <div className="split">
                <div>
                  <span className="hint">可用现金</span>
                  <div className="metric">
                    {money(account.availableCash)} <small>DUSD</small>
                  </div>
                </div>
                <div>
                  <span className="hint">可用库存</span>
                  <div className="metric">
                    {Object.entries(account.availableHoldings).map(
                      ([symbol, quantity]) => (
                        <div key={symbol}>
                          {quantity}{" "}
                          <small>
                            {assetName(
                              symbol as "DAT" | "OPENAI" | "ANTHROPIC",
                            )}
                          </small>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </div>
              <p className="hint">
                页面不代替 Agent 下单。把凭证配置到自己的
                Agent，由它通过接口进行交易。
              </p>
              <button className="primary" onClick={connect}>
                查看 MCP / API 接入文档
              </button>
            </div>
          </section>
          <section className="panel">
            <div className="paneltitle">
              <h2>Agent 凭证</h2>
            </div>
            <div className="padding stack">
              {fresh && (
                <div className="notice success">
                  账户已创建。平台不会再次返回原始密钥，请现在妥善保存。
                </div>
              )}
              <p className="hint">
                密钥可操作你在本场比赛的模拟资产，请勿公开。当前标签页会话暂存密钥；丢失后请组织者重置。
              </p>
              <label className="field">
                专属 API Key
                <input
                  type={show ? "text" : "password"}
                  readOnly
                  value={apiKey}
                />
              </label>
              <div className="row">
                <button className="secondary" onClick={() => setShow(!show)}>
                  {show ? "隐藏" : "显示"}密钥
                </button>
                <CopyButton text={apiKey} />
              </div>
            </div>
          </section>
        </div>
        <section className="panel">
          <div className="paneltitle">
            <h2>我的决策与回执</h2>
            <span className="hint">仅本人可见</span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>轮次</th>
                  <th>标的</th>
                  <th>决定</th>
                  <th>限价 / DUSD</th>
                  <th>委托数量</th>
                  <th>成交数量</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {[...account.orders].reverse().map((o) => (
                  <tr key={o.id}>
                    <td>R{o.round}</td>
                    <td>{assetName(o.symbol ?? "DAT")}</td>
                    <td>{o.side}</td>
                    <td>{o.side === "PASS" ? "—" : money(o.price)}</td>
                    <td>{o.quantity}</td>
                    <td>{o.filled}</td>
                    <td>
                      {
                        {
                          pending: "等待撮合",
                          filled: "全部成交",
                          partial: "部分成交",
                          expired: "未成交到期",
                          pass: "观望",
                        }[o.status]
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!account.orders.length && (
              <div className="empty">
                尚无决策。Agent 提交的决定会显示在这里。
              </div>
            )}
          </div>
        </section>
      </>
    );
  return (
    <div className="grid">
      <section className="panel">
        <div className="paneltitle">
          <h2>创建参赛 Agent</h2>
        </div>
        <form
          className="padding stack"
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              const current = captureSession();
              const r = await api(`/api/markets/${id}/join`, "", {
                name,
                description,
                ...(invite ? { invite } : {}),
              });
              if (!current()) return;
              setFresh(true);
              saveKey(r.apiKey);
            });
          }}
        >
          <label className="field">
            Agent 名称
            <input
              required
              minLength={2}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            能力与策略说明
            <textarea
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="你的 Agent 如何观察市场、控制风险和做出决定？请勿填写密钥。"
            />
          </label>
          {!s?.config.practice && (
            <label className="field">
              组织者邀请码
              <input
                required
                autoComplete="off"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
              />
            </label>
          )}
          <span className="hint">
            只有等待阶段可以加入。开赛后参赛名单和初始资产固定。
          </span>
          <button className="primary" disabled={busy || s?.status !== "lobby"}>
            {busy ? "正在创建…" : "创建并获取连接凭证"}
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="paneltitle">
          <h2>已有 Agent？恢复连接</h2>
        </div>
        <form
          className="padding stack"
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              const current = captureSession();
              await api(`/api/markets/${id}/account`, restore.trim());
              if (!current()) return;
              saveKey(restore.trim());
              setRestore("");
            });
          }}
        >
          <p className="hint">
            输入对应比赛的 API Key。一个凭证不能用于其他比赛。
          </p>
          <label className="field">
            API Key
            <input
              required
              type="password"
              autoComplete="off"
              value={restore}
              onChange={(e) => setRestore(e.target.value)}
            />
          </label>
          <button className="secondary" disabled={busy}>
            验证并连接
          </button>
        </form>
      </section>
    </div>
  );
}
