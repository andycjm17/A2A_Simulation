import { t, rich, useLocale, localizedLabels, localeTag, message, displayName } from "./i18n";
import { useState, useEffect } from "react";
import {
  startingBalances,
  DEFAULT_INSTRUMENTS,
  type InitialBalances,
  type InstrumentConfig,
} from "../worker/engine";
import {
  InstrumentFields,
  InstrumentsEditor,
  CapitalPreview,
} from "./InstrumentSettings";
import { AdminDashboard } from "./AdminDashboard";
import { useSessionGuard } from "./useSessionGuard";
import {
  api,
  money,
  download,
  CopyButton,
  statusName,
  type Snapshot,
  type Act,
} from "./App";
export function Connect({
  id,
  legacy = false,
  s,
}: {
  id: string;
  legacy?: boolean;
  s?: Snapshot | null;
}) {
  useLocale();
  const base = location.origin,
    market = id || "YOUR_MARKET_ID",
    endpoint = `${base}/mcp/${market}`;
  const sample = `curl '${base}/api/markets/${market}/decision' \\\n+  -H 'Authorization: Bearer YOUR_AGENT_KEY' \\\n+  -H 'Content-Type: application/json' \\\n+  -d '{"round":1,"symbol":"${s?.instruments[0]?.symbol ?? (legacy ? "DAT" : DEFAULT_INSTRUMENTS[0].symbol)}","side":"BUY","price":10000,"quantity":5,"requestId":"round-1-attempt-1"}'`;
  return (
    <>
      <div className="notice">{rich("m97bcd87652")}</div>
      <div className="grid">
        <section className="panel">
          <div className="paneltitle">
            <h2>{rich("me6d6f89902")}</h2>
            <span className="badge">Streamable HTTP</span>
          </div>
          <div className="padding stack">
            <label className="field">
              MCP Endpoint
              <input readOnly value={endpoint} />
            </label>
            <CopyButton text={endpoint} />
            <p className="hint">{rich("md1be32c501", [<code>Authorization: Bearer YOUR_AGENT_KEY</code>])}</p>
            <pre>
              {JSON.stringify(
                {
                  mcpServers: {
                    "agent-exchange": {
                      type: "http",
                      url: endpoint,
                      headers: { Authorization: "Bearer YOUR_AGENT_KEY" },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
            <p className="hint">{rich("m03488c4016")}</p>
            {[
              ["market_snapshot", t("m0cce7b1958")],
              ["my_account", t("m7cef5f54e1")],
              ["submit_decision", t("m42dd4d39a0")],
            ].map(([n, d]) => (
              <div className="tool" key={n}>
                <code>{n}</code>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="paneltitle">
            <h2>REST API</h2>
            <a
              className="textbutton"
              href="/api/openapi.json"
              target="_blank"
              rel="noreferrer"
            >
              OpenAPI ↗
            </a>
          </div>
          <div className="padding stack">
            {[
              ["GET /api/markets", t("ma9d10ccb24")],
              [`GET /api/markets/${market}`, t("mad41935caf")],
              [
                `GET /api/markets/${market}/account`,
                t("m5d7f1d0c6b"),
              ],
              [
                `POST /api/markets/${market}/decision`,
                t("m6474b4b03e"),
              ],
            ].map(([n, d]) => (
              <div className="tool" key={n}>
                <code>{n}</code>
                <span>{d}</span>
              </div>
            ))}
            <p className="hint">{rich("m3b33ea304d", [<strong>10000 = 100.00 DUSD</strong>])}</p>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="paneltitle">
          <h2>{rich("m0a428a7d95")}</h2>
          <CopyButton text={sample} />
        </div>
        <div className="padding">
          <pre>{sample}</pre>
          <p className="hint">{rich("m23ce07d3f3")}</p>
          <p className="hint">{rich("m56a8a7c90c")}</p>
        </div>
      </section>
    </>
  );
}
export function Rules() {
  useLocale();
  return (
    <section className="panel padding rules">
      <h2>{rich("m174a917436")}</h2>
      {[
        [
          t("m054a481def"),
          t("mf8b10b1075"),
        ],
        [
          t("m18192a0a0a"),
          t("mfa1424f142"),
        ],
        [
          t("m8f13409e2a"),
          t("mc96d10cff7"),
        ],
        [
          t("m7104a07891"),
          t("m1dbe70b83a"),
        ],
        [
          t("m5da50829bc"),
          t("m829ca70bc0"),
        ],
        [
          t("maf9b3107cb"),
          t("mf327aef1a9"),
        ],
        [
          t("me8cf1e93f2"),
          t("me31b4a34b1"),
        ],
      ].map(([h, p]) => (
        <div key={h}>
          <h3>{h}</h3>
          <p>{p}</p>
        </div>
      ))}
    </section>
  );
}
export function Admin({
  id,
  s,
  busy,
  action: runAction,
  changed,
}: {
  id: string;
  s: Snapshot | null;
  busy: boolean;
  action: Act;
  changed: (newId?: string, current?: () => boolean) => Promise<void>;
}) {
  useLocale();
  const [token, setToken] = useState(""),
    [name, setName] = useState(""),
    [slug, setSlug] = useState(""),
    [practice, setPractice] = useState(false),
    [capacity, setCapacity] = useState(50),
    [makerCashShare, setMakerCashShare] = useState(0.2),
    [instruments, setInstruments] = useState<InstrumentConfig[]>(
      DEFAULT_INSTRUMENTS.map((i) => ({ ...i, name: displayName(i.name) })),
    ),
    [initialBalances, setInitialBalances] = useState<InitialBalances>(
      startingBalances({ instruments: DEFAULT_INSTRUMENTS } as Snapshot["config"]),
    ),
    [count, setCount] = useState(10),
    [codes, setCodes] = useState<string[]>([]),
    [rotateId, setRotateId] = useState(""),
    [newKey, setNewKey] = useState(""),
    [revision, setRevision] = useState(0);
  const captureSession = useSessionGuard([id, token]);
  const captureCredential = useSessionGuard([token]);
  const action = (
    fn: (current: () => boolean) => Promise<void>,
    scope: "market" | "credential" = "market",
  ) => {
    const current =
      scope === "credential" ? captureCredential() : captureSession();
    return runAction(async () => {
      try {
        await fn(current);
      } catch (e) {
        if (current()) throw e;
      }
      if (current()) setRevision((n) => n + 1);
    });
  };
  useEffect(() => {
    setCodes([]);
    setRotateId("");
    setNewKey("");
  }, [id]);
  useEffect(() => {
    setCodes([]);
    setNewKey("");
  }, [token]);
  return (
    <>
      <section className="panel padding">
        <label className="field">{rich("m12fbf3c530", [<input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t("md92993521d")}
          />])}</label>
        <p className="hint">{rich("m4741d25b25")}</p>
      </section>
      <AdminDashboard
        token={token}
        id={id}
        revision={revision}
        select={changed}
        lock={() => setToken("")}
      />
      <div className="admin-section-title" id="admin-management">
        <h2>{rich("m5ac5a8e510")}</h2>
        <p className="hint">{rich("m8357491e2b")}</p>
      </div>
      <div className="grid">
        <section className="panel">
          <div className="paneltitle">
            <h2>{rich("m59c9f32baf")}</h2>
          </div>
          <form
            className="padding stack"
            onSubmit={(e) => {
              e.preventDefault();
              action(async (current) => {
                await api("/api/admin/markets", token, {
                  id: slug,
                  name,
                  practice,
                  capacity,
                  assetMode: "ai",
                  newsEnabled: true,
                  makerCashShare,
                  initialBalances,
                  instruments,
                  rounds: 240,
                  roundMs: 5000,
                  retailAgents: true,
                  auditEnabled: true,
                });
                if (current()) await changed(slug, current);
              }, "credential");
            }}
          >
            <label className="field">{rich("m9dea12fa93", [<input
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />])}</label>
            <label className="field">{rich("m8fd0c0c078", [<input
                required
                pattern="[a-z0-9][a-z0-9-]{2,39}"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={t("ma0a96eecd4")}
              />])}</label>
            <label className="field">{rich("m4fbbcde919", [<input
                type="number"
                min={2}
                max={100}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
              />])}</label>
            <InstrumentFields value={instruments} change={setInstruments} />
            <InitialBalanceFields
              instruments={instruments}
              value={initialBalances}
              change={setInitialBalances}
            />
            <label className="field">{rich("m48cc27fb59", [<select
                value={makerCashShare}
                onChange={(e) => setMakerCashShare(Number(e.target.value))}
              >
                {Array.from({ length: 10 }, (_, i) => (i + 1) / 20).map((p) => (
                  <option key={p} value={p}>
                    {(p * 100).toFixed(0)}%
                  </option>
                ))}
              </select>])}</label>
            <p className="hint">{rich("m06a4831e5e")}</p>
            <label className="row hint">{rich("m8f6a46ecb1", [<input
                type="checkbox"
                checked={practice}
                onChange={(e) => setPractice(e.target.checked)}
              />])}</label>
            <span className="hint">{rich("m018d418223")}</span>
            <button className="primary" disabled={busy || !token}>{rich("m392db785de")}</button>
          </form>
        </section>
        <section className="panel">
          <div className="paneltitle">
            <h2>{rich("ma8798c778a")}</h2>
            <span className="badge">
              {s ? statusName[s.status] : t("mc5768ca972")}
            </span>
          </div>
          <div className="padding stack">
            <strong>{s?.config.name || t("md7ca35df16")}</strong>
            {s && (
              <InstrumentsEditor
                s={s}
                busy={busy || !token}
                save={(items, applied) =>
                  action(async (current) => {
                    await api(
                      `/api/admin/markets/${id}/instruments`,
                      token,
                      items,
                    );
                    if (current()) {
                      await changed(undefined, current);
                      if (current()) applied();
                    }
                  })
                }
              />
            )}
            {s && (
              <InitialBalancesEditor
                key={id}
                s={s}
                busy={busy || !token}
                save={(balances, applied) =>
                  action(async (current) => {
                    await api(
                      `/api/admin/markets/${id}/initial-balances`,
                      token,
                      balances,
                    );
                    if (current()) {
                      await changed(undefined, current);
                      if (current()) applied();
                    }
                  })
                }
              />
            )}
            <div className="adminActions">
              {(["start", "pause", "resume"] as const).map((v) => (
                <button
                  className="secondary"
                  disabled={
                    busy ||
                    !token ||
                    !s ||
                    s.status !==
                      { start: "lobby", pause: "running", resume: "paused" }[v]
                  }
                  key={v}
                  onClick={() => {
                    if (
                      v === "start" &&
                      !confirm(
                        t("m1d7ed6fb69"),
                      )
                    )
                      return;
                    action(async (current) => {
                      await api(`/api/admin/markets/${id}/${v}`, token, {});
                      if (current()) await changed(undefined, current);
                    });
                  }}
                >
                  {
                    {
                      start: t("m4453aaf22b"),
                      pause: t("m971f2f4487"),
                      resume: t("mc2a1969691"),
                    }[v]
                  }
                </button>
              ))}
            </div>
            <button
              className="secondary"
              disabled={busy || !token || !id}
              onClick={() =>
                action(async (current) => {
                  const data = await api(
                    `/api/admin/markets/${id}/export`,
                    token,
                  );
                  if (current()) download(`${id}-audit.json`, data);
                })
              }
            >{rich("m95fb743d26")}</button>
            <hr />
            <label className="field">{rich("m813565f7cd", [<input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />])}</label>
            <button
              className="secondary"
              disabled={busy || !token || s?.status !== "lobby"}
              onClick={() =>
                action(async (current) => {
                  const data = await api(
                    `/api/admin/markets/${id}/invites`,
                    token,
                    { count },
                  );
                  if (current()) setCodes(data.codes);
                })
              }
            >{rich("m0e0d3c019a")}</button>
            {codes.length > 0 && (
              <>
                <div className="notice">{rich("m82f99d736a")}</div>
                <pre>{codes.join("\n")}</pre>
                <CopyButton text={codes.join("\n")} />
              </>
            )}
          </div>
        </section>
      </div>
      <details className="panel padding">
        <summary>{rich("m617360819f")}</summary>
        <div className="stack">
          <p className="hint">{rich("m978bd7b5a6")}</p>
          <label className="field">{rich("mfe56f69842", [<select
              aria-label={t("m76837845cc")}
              value={rotateId}
              onChange={(e) => setRotateId(e.target.value)}
            >
              <option value="">{rich("mda590a8fe3")}</option>
              {s?.leaderboard.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>])}</label>
          <button
            className="secondary danger"
            disabled={busy || !token || !rotateId}
            onClick={() => {
              if (confirm(t("mb001381d8b")))
                action(async (current) => {
                  const data = await api(
                    `/api/admin/markets/${id}/rotate`,
                    token,
                    { agentId: rotateId },
                  );
                  if (current()) setNewKey(data.apiKey);
                });
            }}
          >{rich("m97d7b31286")}</button>
          {newKey && (
            <div className="keybox">
              {newKey}
              <CopyButton text={newKey} />
            </div>
          )}
        </div>
      </details>
    </>
  );
}

function InitialBalanceFields({
  value,
  change,
  legacy = false,
  disabled = false,
  instruments = DEFAULT_INSTRUMENTS,
}: {
  value: InitialBalances;
  instruments?: Pick<InstrumentConfig, "symbol" | "name">[];
  change: (value: InitialBalances) => void;
  legacy?: boolean;
  disabled?: boolean;
}) {
  useLocale();
  return (
    <fieldset className="initial-balances-fields" disabled={disabled}>
      <legend>{rich("m715061b8e0")}</legend>
      <label className="field">{rich("m191812ef9f", [<input
          required
          type="number"
          min={0}
          max={10000000}
          step="0.01"
          value={value.cash / 100}
          onChange={(e) =>
            change({ ...value, cash: Math.round(Number(e.target.value) * 100) })
          }
        />])}</label>
      {(legacy ? [{ symbol: "DAT", name: "DAT" }] : instruments).map(
        ({ symbol, name }) => (
          <label className="field" key={symbol}>{rich("me527fc57c5", [displayName(name), <input
              required
              type="number"
              min={0}
              max={100000}
              step={1}
              value={value[symbol] ?? 100}
              onChange={(e) =>
                change({ ...value, [symbol]: Number(e.target.value) })
              }
            />])}</label>
        ),
      )}
    </fieldset>
  );
}
function InitialBalancesEditor({
  s,
  busy,
  save,
}: {
  s: Snapshot;
  busy: boolean;
  save: (balances: InitialBalances, applied: () => void) => Promise<void>;
}) {
  useLocale();
  const actual = s.initialBalances ?? startingBalances(s.config);
  const [value, setValue] = useState(actual),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    setValue(actual);
  }, [s.config.id, JSON.stringify(actual)]);
  const locked = s.status !== "lobby";
  return (
    <form
      className="stack initial-balances-editor"
      aria-label={t("md0f3d0ded5")}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        await save(value, () => setSaved(true));
      }}
    >
      <h3>{rich("m01a4b5c51c")}</h3>
      <InitialBalanceFields
        value={value}
        change={(v) => {
          setValue(v);
          setSaved(false);
        }}
        instruments={s.instruments}
        legacy={s.orderBookMode === "sealed"}
        disabled={locked || busy}
      />
      <p className="hint">{rich("m542b05c93b", [locked
          ? t("me606c6eea4")
          : t("m4ece98f84d")])}</p>
      <CapitalPreview
        instruments={s.instruments}
        balances={value}
        count={s.participantCount}
        share={s.config.makerCashShare ?? 0}
      />
      <button className="secondary" disabled={locked || busy}>{rich("md23e0e863a")}</button>
      {saved && (
        <span role="status" className="hint">{rich("mca67cdb105")}</span>
      )}
    </form>
  );
}
