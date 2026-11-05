import { ClubBrand, ModuleGrid } from "./ClubBrand";
import { t, rich, useLocale, localizedLabels, localeTag, message, displayName, displayMarketName, apiError } from "./i18n";
import { useState, useEffect, useRef } from "react";
import {
  ArrowUpRight,
  Bot,
  ChartNoAxesCombined,
  CircleHelp,
  Settings2,
  Copy,
  Check,
  Download,
} from "lucide-react";
import type { publicState, accountState } from "../worker/engine";
import { Connect, Rules, Admin } from "./Workspace";
import { CandlestickChart, OrderBook } from "./MarketData";
import { NewsPanel } from "./NewsPanel";
import { RetailPanel } from "./RetailPanel";
import { InstrumentIcon } from "./InstrumentSettings";
import { assetName as rawAssetName, startingBalances } from "../worker/engine";
import { useSessionGuard } from "./useSessionGuard";
const assetName=(...args:Parameters<typeof rawAssetName>)=>displayName(rawAssetName(...args));
export type Snapshot = ReturnType<typeof publicState>;
export type Account = ReturnType<typeof accountState>;
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
export const statusName = localizedLabels({
  lobby: "等待开始",
  running: "交易进行中",
  paused: "比赛已暂停",
  finished: "已完成结算",
});
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
  if (!r.ok)
    throw Object.assign(new Error(apiError(j.error, r.status)), {
      code: j.error?.code,
    });
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
export function CopyButton({ text, label }: { text: string; label?: string }) {
  useLocale();
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
        {copied ? t("m8f6f8d979c") : (label ?? t("m63d90d9773"))}
      </button>
      {error && (
        <span role="alert" className="hint">{rich("m0f0e54673b")}</span>
      )}
    </>
  );
}
export type Act = (fn: () => Promise<void>) => Promise<void>;

function AgentOnboarding({ onConnect, onDismiss }: { onConnect: () => void; onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="agent-onboarding"
      aria-labelledby="agent-onboarding-title"
      aria-describedby="agent-onboarding-description"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <Bot size={24} aria-hidden="true" />
      <h2 id="agent-onboarding-title">Connect your Agent</h2>
      <p id="agent-onboarding-description">
        Open My Agent to register for this competition or connect with an existing API key.
      </p>
      <div className="agent-onboarding-actions">
        <button type="button" className="primary" autoFocus onClick={onConnect}>
          Go to My Agent
        </button>
        <button type="button" className="secondary" onClick={onDismiss}>
          Browse market
        </button>
      </div>
    </dialog>
  );
}

export default function App() {
  useLocale();
  const [view, setView] = useState(() => {
      const query = new URLSearchParams(location.search);
      if (query.get("view") === "admin") return "admin";
      if (query.get("view") === "agent")
        return query.get("section") === "connect" ? "connect" : "agent";
      return "market";
    }),
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
  const [dismissedMarkets, setDismissedMarkets] = useState(() => new Set<string>());
  const [rejectedCredential, setRejectedCredential] = useState<{ market: string; key: string } | null>(null);
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
  const dismissOnboarding = () => setDismissedMarkets((previous) => new Set(previous).add(id));
  const showOnboarding =
    view === "market" && s && credential.market === id && !account && !dismissedMarkets.has(id) &&
    (!key || (rejectedCredential?.market === id && rejectedCredential.key === key));
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
    if (view === "agent" || view === "connect") q.set("view", "agent");
    if (view === "connect") q.set("section", "connect");
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
          try {
            const a = await api(`/api/markets/${id}/account`, key);
            if (!dead) {
              setAccount(a);
              setRejectedCredential(null);
            }
          } catch (error) {
            if (!dead && (error as { code?: string }).code === "UNAUTHORIZED") {
              setRejectedCredential({ market: id, key });
            }
            throw error;
          }
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
    ["market", t("m4ba4ba1f53"), ChartNoAxesCombined],
    ["agent", t("m037c361523"), Bot],
    ["rules", t("m8737071d4f"), CircleHelp],
  ] as const;
  return (
    <div className="app">
      {showOnboarding && (
        <AgentOnboarding
          key={id}
          onDismiss={dismissOnboarding}
          onConnect={() => {
            dismissOnboarding();
            setView("agent");
          }}
        />
      )}
      <aside className="appnav">
        <ClubBrand />
        <nav aria-label={t("m968608e4ff")}>
          {nav.map(([v, label, Icon]) => (
            <button
              key={v}
              className={view === v || (v === "agent" && view === "connect") ? "active" : ""}
              onClick={() => setView(v)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="tag">SIMULATION</span>
          <p>{rich("m2b82a2b409", [<br />])}</p>
          <button className="textbutton" onClick={() => setView("admin")}>{rich("maa0b6e18d0", [<Settings2 size={16} />])}</button>
        </div>
      </aside>
      <main>
        <header>
          <span>{rich("mf26c47df5c", [<span className="slash">/</span>,
            view === "connect"
              ? `${t("m037c361523")} / ${t("mec89dad379")}`
              : nav.find((n) => n[0] === view)?.[1] || t("m1e17af1aee"),
          ])}</span>
          <span className="environment-label">SIMULATED MARKETS</span>
        </header>
        <div className="content">
          <div className="pageheading brand-hero">
            <ModuleGrid />
            <div>
              <div className="eyebrow">DBC / AGENT ECONOMY</div>
              <h1>
                {view === "market"
                  ? t("ma5b69214e4")
                  : view === "agent"
                    ? t("m8d4a63b3c9")
                    : view === "connect"
                      ? t("mec89dad379")
                      : view === "admin"
                        ? t("m8fffc04ec9")
                        : t("m82b821f3a2")}
              </h1>
              <p>
                {view === "admin"
                  ? t("m672e3e77bf")
                  : t("mb1b34812f6")}
              </p>
            </div>
            {view !== "admin" && view !== "connect" && (
              <button className="primary" onClick={() => setView("agent")}>
                <Bot size={17} />
                {account ? t("m6fddf0abd0") : t("mf6fce42efe")}
              </button>
            )}
          </div>
          {error && (
            <div className="notice error row between" role="alert">
              <span>{message(error)}</span>
              <button className="textbutton" onClick={() => setError("")}>{rich("m6b7c3d1ced")}</button>
            </div>
          )}
          <div className="row between marketselect">
            <span className="row">Current competition: <strong>{s ? displayMarketName(s.config.name) : "Loading competition…"}</strong></span>
            <span className={`connection ${online ? "positive" : "negative"}`}>
              {online ? t("me876f0d2cd") : t("m1d3caf0584")}
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
                <h3>{rich("m608be06300")}</h3>
                <p>
                  {id
                    ? t("m909138a3b0")
                    : t("mabbede4879")}
                </p>
                <button
                  className="secondary"
                  onClick={() => setView("connect")}
                >{rich("me38460edac")}</button>
              </section>
            ))}
          {(view === "agent" || view === "connect") && (
            <div hidden={view === "connect"}>
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
            </div>
          )}
          {view === "connect" && (
            <div className="stack">
              <div>
                <button className="secondary" onClick={() => setView("agent")}>
                  ← Back to My Agent
                </button>
              </div>
              <Connect id={id} legacy={s?.orderBookMode === "sealed"} s={s} />
            </div>
          )}
          {view === "rules" && <Rules s={s} />}
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
          <div className="club-footer"><span>DUKE BLOCKCHAIN CLUB</span><span>MODULAR / CONNECTED / FORWARD</span></div>
          <div className="footnote">{rich("ma29293bb13")}</div>
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
  useLocale();
  const [symbol, setSymbol] = useState(s.instruments[0].symbol);
  const instrument =
    s.instruments.find((i) => i.symbol === symbol) ?? s.instruments[0];
  const names = new Map(s.leaderboard.map((a) => [a.id, a.name]));
  if (s.maker) names.set(s.maker.id, displayName(s.maker.name));
  for (const a of s.retailTraders ?? []) names.set(a.id, a.name);
  const secs = s.deadline
    ? Math.max(0, Math.ceil((s.deadline - now) / 1000))
    : 0;
  return (
    <div className="market-workspace">
      <div className="stats market-stats">
        <div>
          <span>{rich("m2ac8d3648a")}</span>
          <strong>
            {s.round || "—"} <small>{rich("m5692de0122", [s.config.rounds])}</small>
          </strong>
        </div>
        <div>
          <span>{rich("mc2dad55147")}</span>
          <strong>
            {money(instrument.reference)} <small>{displayName(instrument.name)}</small>
          </strong>
        </div>
        <div>
          <span>{rich("mf374be2755")}</span>
          <strong>
            {s.participantCount} <small>/ {s.config.capacity}</small>
          </strong>
        </div>
        <div>
          <span>{rich("m350516fe1f")}</span>
          <strong>
            {instrument.volume} <small>{rich("m1faf3e3c14", [instrument.tradeCount])}</small>
          </strong>
        </div>
      </div>
      <NewsPanel s={s} />
      <RetailPanel s={s} />
      <div className="exchange-grid">
        <section className="price-surface">
          <div className="row between instrument-heading">
            <div>
              <span className="instrument-symbol">{instrument.symbol}</span>
              <h2>
                <InstrumentIcon icon={instrument.icon} name={displayName(instrument.name)} />
                {displayName(instrument.name)} <span className="subtle">{rich("ma4b7cd7768")}</span>
              </h2>
            </div>
            <span className="badge">{statusName[s.status]}</span>
          </div>
          <div className="instrument-tabs" role="group" aria-label={t("m3442ef02d4")}>
            {s.instruments.map((i) => (
              <button
                key={i.symbol}
                aria-pressed={instrument.symbol === i.symbol}
                onClick={() => setSymbol(i.symbol)}
              >
                <span>
                  <InstrumentIcon icon={i.icon} name={displayName(i.name)} />
                  {displayName(i.name)}
                </span>
                <small>
                  {i.lastPrice === null ? t("mc1edae7e4a") : money(i.lastPrice)}
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
            <small>{rich("m590070958a")}</small>
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
              ? t("mbe2bacb0d8", [s.round, secs ? t("med4bda5ca9", [secs]) : t("m0aab9522e2"), s.config.roundMs / 1000])
              : s.status === "finished"
                ? (s.config.autoRedeem === false ? "All rounds have settled. Cash and holdings are retained; no automatic conversion to cash." : t("m8319551931"))
                : s.status === "paused"
                  ? t("m191feee058", [s.pauseReason === "scheduler_delay" ? t("mb61c552a20") : ""])
                  : t("m485c2ef1b9")}
          </div>
        </section>
        <section className="panel agent-ticket">
          <div className="paneltitle">
            <h2>{rich("m0b4d1f2dee")}</h2>
            <Bot size={20} />
          </div>
          <div className="padding stack ticket-body">
            <div>
              <span className="hint">
                {account ? account.name : t("m1c7ce7a7a0")}
              </span>
              <div className="ticket-value">
                {account ? money(account.cash) : "—"}
                <small>{rich("m2462a87986")}</small>
              </div>
            </div>
            <dl className="ticket-facts">
              <div>
                <dt>{rich("mc3ee29d0be")}</dt>
                <dd>{account ? money(account.availableCash) : "—"}</dd>
              </div>
              {s.instruments.map((i) => (
                <div key={i.symbol}>
                  <dt>{rich("m0ca151f9e9", [displayName(i.name)])}</dt>
                  <dd>{account ? account.holdings[i.symbol] : "—"}</dd>
                </div>
              ))}
              <div>
                <dt>{rich("m2374e5d33f")}</dt>
                <dd>MCP / API</dd>
              </div>
            </dl>
            <button className="primary" onClick={connect}>
              {account ? t("mc371852678") : t("me4907a041c")}
              <ArrowUpRight size={17} />
            </button>
            <p className="hint ticket-note">{rich("mf0ee88cece")}</p>
            <div className="ticket-divider" />
            <div className="row between">
              <span className="hint">{rich("meeb810be2f")}</span>
              <span className="badge">
                {s.config.practice ? t("maec9fca791") : t("md1cf34ca68")}
              </span>
            </div>
            <h3>{displayMarketName(s.config.name)}</h3>
            <div className="row between">
              <span className="hint">{rich("mb1e3a96e54")}</span>
              <span>{rich("mc65627ead1", [(s.config.rounds * s.config.roundMs) / 60000])}</span>
            </div>
            <div className="hint">{rich("m4ecd0bd211", [money(
                (s.initialBalances ?? startingBalances(s.config)).cash,
              ), s.instruments.map((i) => (
                <span key={i.symbol}>{rich("m5f24979aa3", [displayName(i.name), (s.initialBalances ?? startingBalances(s.config))[i.symbol]])}</span>
              )), <br />, s.orderBookMode === "sealed" ? t("m85b8ec6295") : t("m8dac07a2ea")])}</div>
            <p className="hint">{rich("m3abfee2a0c")}</p>
          </div>
        </section>
      </div>
      <section className="panel market-table">
        <div className="paneltitle">
          <h2>
            Leaderboard{" "}
            <span className="subtle">
              {s.status === "finished" ? t("m15dfd53a98") : t("me1626fb3a3")}
            </span>
          </h2>
          <button
            className="textbutton"
            onClick={() =>
              download(`${s.config.id}-leaderboard.json`, {
                market: s.config,
                final: s.status === "finished",
                rankingBasis: s.rankingBasis,
                leaderboard: s.leaderboard,
                retailTraders: s.retailTraders,
              })
            }
          >{rich("m7a8ca94be7", [<Download size={15} />])}</button>
        </div>
        <div className="tablewrap">
          <table aria-label={t("m16d475190e")}>
            <caption className="ranking-caption">{rich("m7f690056ad")}</caption>
            <thead>
              <tr>
                <th>{rich("m6570a98f28")}</th>
                <th>Agent</th>
                <th>{rich("m02e4efbce9")}</th>
                <th>{rich("mf862e1954e")}</th>
                {s.instruments.map((i) => (
                  <th key={i.symbol}>{displayName(i.name)}</th>
                ))}
                <th>{rich("m55aaa84ea6")}</th>
                <th>{rich("mfa997f40c7")}</th>
              </tr>
            </thead>
            <tbody>
              {s.leaderboard.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="pill">{a.rank}</span>
                  </td>
                  <td>{a.name}</td>
                  <td>{money(a.cash)}</td>
                  <td className={a.cashChange >= 0 ? "positive" : "negative"}>
                    {a.cashChange >= 0 ? "+" : ""}
                    {money(a.cashChange)}
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
          {!s.participantCount && <div className="empty">{rich("m8837f79ae0")}</div>}
        </div>
      </section>
      <section className="panel market-table">
        <div className="paneltitle">
          <h2>Recent trades <span className="subtle">All instruments</span></h2>
          <span className="hint">{rich("m4116f5a5f4")}</span>
        </div>
        <div className="tablewrap">
          <table aria-label="Recent trades">
            <thead>
              <tr>
                <th>{rich("m4890584bb5")}</th>
                <th>Instrument</th>
                <th>{rich("m1042114048")}</th>
                <th>{rich("mb8c500522e")}</th>
                <th>{rich("m1d83c362e2")}</th>
                <th>{rich("m5e53430518")}</th>
              </tr>
            </thead>
            <tbody>
              {s.trades.map((t) => (
                <tr key={t.id}>
                  <td>R{t.round}</td>
                  <td>{t.symbol ?? "DAT"} · {displayName(assetName(t.symbol ?? "DAT", s.config))}</td>
                  <td>{names.get(t.buyer)}</td>
                  <td>{names.get(t.seller)}</td>
                  <td>{money(t.price)}</td>
                  <td>{t.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!s.tradeCount && (
            <div className="empty">{rich("m51faa06bcc")}</div>
          )}
        </div>
      </section>
      <Commitment s={s} />
    </div>
  );
}
function Commitment({ s }: { s: Snapshot }) {
  useLocale();
  const [result, setResult] = useState("");
  return (
    <details className="panel padding">
      <summary>{rich("m72ea66d7fc")}</summary>
      <p className="hint">{rich("m7c8f1eab37")}</p>
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
                  ? t("m90cdf58006")
                  : t("maa061befe7"),
              );
            }}
          >{rich("mbab18eb47c")}</button>
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
  useLocale();
  const [name, setName] = useState(""),
    [duplicateName, setDuplicateName] = useState(""),
    [description, setDescription] = useState(""),
    [restore, setRestore] = useState(""),
    [show, setShow] = useState(false),
    [fresh, setFresh] = useState(false);
  const captureSession = useSessionGuard([id]);
  const normalizedName = name.trim().toLocaleLowerCase();
  const nameTaken = !!normalizedName && (
    duplicateName === normalizedName ||
    s?.leaderboard.some((agent) => agent.name.toLocaleLowerCase() === normalizedName)
  );
  const mcpEndpoint = `${location.origin}/mcp/${encodeURIComponent(id)}`;
  if (!id) return <div className="notice">{rich("m43afb021d7")}</div>;
  if (account)
    return (
      <>
        <div className="grid">
          <section className="panel">
            <div className="paneltitle">
              <h2>{account.name}</h2>
              <button className="textbutton" onClick={logout}>{rich("m0d2cc8473c")}</button>
            </div>
            <div className="padding stack">
              <span className="badge">{rich("m997d1ed624")}</span>
              <div className="split">
                <div>
                  <span className="hint">{rich("mc3ee29d0be")}</span>
                  <div className="metric">
                    {money(account.availableCash)} <small>DUSD</small>
                  </div>
                </div>
                <div>
                  <span className="hint">{rich("md68cc804a8")}</span>
                  <div className="metric">
                    {Object.entries(account.availableHoldings).map(
                      ([symbol, quantity]) => (
                        <div key={symbol}>
                          {quantity}{" "}
                          <small>{assetName(symbol, s?.config)}</small>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </div>
              <p className="hint">{rich("m26a226294d")}</p>
              <div className="stack">
                <span className="hint">MCP endpoint</span>
                <code style={{ overflowWrap: "anywhere" }}>{mcpEndpoint}</code>
              </div>
              <button className="primary" onClick={connect}>{rich("mf327b4a048")}</button>
            </div>
          </section>
          <section className="panel">
            <div className="paneltitle">
              <h2>{rich("m93cbbb48cc")}</h2>
            </div>
            <div className="padding stack">
              {fresh && (
                <div className="notice success">{rich("maacfb31014")}</div>
              )}
              <label className="field">
                MCP endpoint
                <input readOnly value={mcpEndpoint} spellCheck={false} />
              </label>
              <CopyButton text={mcpEndpoint} label="Copy MCP link" />
              <p className="hint">{rich("m7b56827cfd")}</p>
              <label className="field">{rich("mc6b9807a7e", [<input
                  type={show ? "text" : "password"}
                  readOnly
                  value={apiKey}
                />])}</label>
              <div className="row">
                <button className="secondary" onClick={() => setShow(!show)}>{rich("mdeeba79351", [show ? t("m145219e726") : t("m4e1449e7d5")])}</button>
                <CopyButton text={apiKey} />
              </div>
            </div>
          </section>
        </div>
        <section className="panel">
          <div className="paneltitle">
            <h2>{rich("m7d31f0ea8b")}</h2>
            <span className="hint">{rich("m73bb27bcd5")}</span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>{rich("m4890584bb5")}</th>
                  <th>{rich("md31ca201e4")}</th>
                  <th>{rich("mf4aafaba3b")}</th>
                  <th>{rich("mad645c9881")}</th>
                  <th>{rich("m19a69d1e71")}</th>
                  <th>{rich("m5bffd9af3e")}</th>
                  <th>{rich("m6320b4a872")}</th>
                </tr>
              </thead>
              <tbody>
                {[...account.orders].reverse().map((o) => (
                  <tr key={o.id}>
                    <td>R{o.round}</td>
                    <td>{assetName(o.symbol ?? "DAT", s?.config)}</td>
                    <td>{o.side}</td>
                    <td>{o.side === "PASS" ? "—" : money(o.price)}</td>
                    <td>{o.quantity}</td>
                    <td>{o.filled}</td>
                    <td>
                      {
                        {
                          pending: t("m22e73c8133"),
                          filled: t("m7cda9beb9c"),
                          partial: t("m06d51d949d"),
                          expired: t("m4d330ca4cf"),
                          pass: t("m17b6ab8fa6"),
                        }[o.status]
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!account.orders.length && (
              <div className="empty">{rich("m816a6de660")}</div>
            )}
          </div>
        </section>
      </>
    );
  return (
    <div className="grid">
      <section className="panel">
        <div className="paneltitle">
          <h2>{rich("m321e24e4ed")}</h2>
        </div>
        <form
          className="padding stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameTaken) return;
            action(async () => {
              const current = captureSession();
              try {
                const r = await api(`/api/markets/${id}/join`, "", {
                  name,
                  description,
                });
                if (!current()) return;
                setFresh(true);
                saveKey(r.apiKey);
              } catch (error) {
                if (error instanceof Error && "code" in error && error.code === "NAME_TAKEN") {
                  if (current()) setDuplicateName(normalizedName);
                  return;
                }
                throw error;
              }
            });
          }}
        >
          <div className="field">
            <label htmlFor="registration-name">{t("m57f5dfe100").trim()}</label>
            <input
              id="registration-name"
              required
              minLength={2}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={nameTaken || undefined}
              aria-describedby={nameTaken ? "registration-name-error" : undefined}
            />
            {nameTaken && (
              <span className="negative" id="registration-name-error" role="alert">
                This Agent name is already registered.
              </span>
            )}
          </div>
          <label className="field">{rich("m8cd5316585", [<textarea
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("m109b4b1760")}
            />])}</label>
          <span className="hint">{rich("mb30a71ae36")}</span>
          <button className="primary" disabled={busy || nameTaken || s?.status !== "lobby"}>
            {busy ? t("m7c0305bc0c") : t("m831fa1cf5e")}
          </button>
          <button type="button" className="secondary" onClick={connect}>
            {t("mf327b4a048")}
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="paneltitle">
          <h2>{rich("m3b07217090")}</h2>
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
          <p className="hint">{rich("m685ad1a491")}</p>
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
          <button className="secondary" disabled={busy}>{rich("m864c4e6cf8")}</button>
        </form>
      </section>
    </div>
  );
}
