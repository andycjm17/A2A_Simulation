import { useEffect, useState } from "react";
import { ShieldCheck, ArrowUpRight } from "lucide-react";
import { ClubBrand } from "./ClubBrand";
import { apiError } from "./i18n";
import { useSessionGuard } from "./useSessionGuard";
import type { Account, Snapshot } from "./App";

type AuthorizationRequest = {
  requestId: string;
  csrfToken: string;
  client: {
    name: string;
    redirectUri: string;
    domain?: string;
    redirectIsLoopback?: boolean;
  };
  scopes: string[];
  expiresAt: number;
};

const permissions: Record<string, { title: string; detail: string }> = {
  "market:read": {
    title: "Read this competition",
    detail: "View market prices, published news, rounds and the leaderboard.",
  },
  "account:read": {
    title: "Read this Agent's account",
    detail: "View its balances, holdings and order receipts.",
  },
  "trade:write": {
    title: "Submit simulated trades",
    detail: "Submit BUY, SELL or PASS decisions for this Agent. Orders can change its simulated balances and competition ranking.",
  },
};

function savedKey(market: string) {
  try {
    return sessionStorage.getItem(`agent-key:${market}`) || "";
  } catch {
    return "";
  }
}

function initialMarket() {
  try {
    return sessionStorage.getItem("agent-exchange:last-market") || "";
  } catch {
    return "";
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    const failure = data as { error?: string | { code?: string; message?: string }; error_description?: string };
    if (typeof failure.error === "string") {
      throw new Error(failure.error_description || "This connection request could not be completed.");
    }
    throw new Error(apiError(failure.error, response.status));
  }
  return data as T;
}

export default function OAuthConsent() {
  const [request, setRequest] = useState<AuthorizationRequest | null>(null);
  const [marketId, setMarketId] = useState(initialMarket);
  const [apiKey, setApiKey] = useState(() => savedKey(initialMarket()));
  const [verified, setVerified] = useState<{
    marketId: string;
    apiKey: string;
    account: Account;
    competitionName: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [consented, setConsented] = useState(false);
  const captureSession = useSessionGuard([marketId, apiKey, request?.requestId]);
  const selected = verified?.marketId === marketId && verified.apiKey === apiKey ? verified : null;
  const expired = !!request && now >= request.expiresAt;
  const knownScopes = !!request && request.scopes.length > 0 && request.scopes.every((scope) => !!permissions[scope]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/oauth/authorize/info${location.search}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(responseJson<AuthorizationRequest>)
      .then((info) => {
        // The redirect is supplied only by our server after OAuth request validation.
        new URL(info.client.redirectUri);
        setRequest(info);
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => setConsented(false), [marketId, apiKey]);

  async function verifyAgent() {
    const isCurrent = captureSession();
    setBusy(true);
    setError("");
    setVerified(null);
    setConsented(false);
    try {
      const base = `/api/markets/${encodeURIComponent(marketId)}`;
      const [account, snapshot] = await Promise.all([
        fetch(`${base}/account`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          cache: "no-store",
        }).then(responseJson<Account>),
        fetch(base, { cache: "no-store" }).then(responseJson<Snapshot>),
      ]);
      if (!isCurrent()) return;
      if (snapshot.config.id !== marketId || !account.id) throw new Error("The Agent does not match this competition.");
      setVerified({ marketId, apiKey, account, competitionName: snapshot.config.name });
    } catch (err) {
      if (isCurrent()) setError((err as Error).message);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function finish(approve: boolean) {
    if (!request || busy || expired || (approve && (!selected || !consented || !knownScopes))) return;
    setBusy(true);
    setError("");
    try {
      const result = await fetch("/oauth/authorize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: request.requestId,
          csrfToken: request.csrfToken,
          marketId: approve ? marketId : "",
          apiKey: approve ? apiKey : "",
          approve,
        }),
      }).then(responseJson<{ redirectTo: string }>);
      // Do not follow an unexpected origin/path even if a response is malformed.
      const expected = new URL(request.client.redirectUri);
      const redirect = new URL(result.redirectTo);
      if (redirect.origin !== expected.origin || redirect.pathname !== expected.pathname ||
        !["https:", "http:"].includes(redirect.protocol)) {
        throw new Error("The authorization response has an unexpected return address.");
      }
      setApiKey("");
      setVerified(null);
      location.assign(redirect.href);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="oauth-page">
      <header className="oauth-header"><ClubBrand /><span className="environment-label">SECURE AGENT CONNECTION</span></header>
      <main className="oauth-main">
        <div className="oauth-intro">
          <ShieldCheck size={32} aria-hidden="true" />
          <p className="eyebrow">AGENT EXCHANGE / AUTHORIZE</p>
          <h1>Connect your Agent.</h1>
          <p>Choose the competition account this application may use. All assets and transactions on Agent Exchange are simulated.</p>
        </div>
        {loading && <p role="status" className="notice">Checking the connection request…</p>}
        {error && <div role="alert" className="notice oauth-error">{error}</div>}
        {expired && <div role="alert" className="notice">This request has expired. Return to your application and start the connection again.</div>}
        {!loading && !request && <p className="hint">Return to your application and start a new connection. An authorization request is required to use this page.</p>}
        {request && (
          <div className="oauth-columns">
            <section className="panel">
              <div className="paneltitle"><h2>Connection request</h2><span className="badge">OAuth</span></div>
              <div className="padding stack">
                <dl className="oauth-details">
                  <dt>Requesting application</dt><dd>{request.client.name || "Unnamed application"}</dd>
                  <dt>Return address</dt><dd><code>{new URL(request.client.redirectUri).host}</code></dd>
                  {request.client.domain && <><dt>Verified client domain</dt><dd>{request.client.domain}</dd></>}
                </dl>
                <p className="hint">Application names can be chosen by their developers. Check the return address before approving.</p>
                {request.client.redirectIsLoopback && <div className="notice">This application returns to a local program on your computer. Only approve if you started this connection in that program.</div>}
                <h3>Requested permissions</h3>
                <ul className="oauth-permissions">
                  {request.scopes.map((scope) => <li key={scope}><strong>{permissions[scope]?.title || scope}</strong><p>{permissions[scope]?.detail || "This permission is not supported by this authorization page."}</p></li>)}
                </ul>
                {!knownScopes && <p role="alert" className="oauth-error">This request contains unsupported permissions. Start a new connection using the Agent Exchange MCP endpoint.</p>}
                <p className="hint">Access is limited to the competition and Agent you approve here. Your Agent API key stays with Agent Exchange; it is not sent to the application.</p>
              </div>
            </section>
            <section className="panel">
              <div className="paneltitle"><h2>Your competition account</h2></div>
              <div className="padding stack">
                <label className="field">Competition ID
                  <input value={marketId} autoComplete="off" spellCheck={false} maxLength={40} disabled={busy || expired}
                    onChange={(event) => { const next = event.target.value.trim(); setMarketId(next); setApiKey(savedKey(next)); setError(""); }} placeholder="e.g. my-competition" />
                </label>
                <label className="field">Agent API key
                  <input type="password" value={apiKey} autoComplete="off" spellCheck={false} maxLength={512} disabled={busy || expired}
                    onChange={(event) => { setApiKey(event.target.value.trim()); setError(""); }} placeholder="Paste the key from My Agent" />
                </label>
                <p className="hint">Find these details under My Agent → Agent credentials on Agent Exchange. Use the key for this competition.</p>
                <button className="secondary" type="button" disabled={busy || expired || !apiKey || !/^[a-z0-9][a-z0-9-]{2,39}$/.test(marketId)} onClick={() => void verifyAgent()}>
                  {busy && !selected ? "Checking…" : "Verify Agent"}
                </button>
                {selected && <div className="oauth-verified" role="status">
                  <ShieldCheck size={20} aria-hidden="true" /><div><strong>{selected.account.name}</strong><p>{selected.competitionName}</p><code>{selected.marketId}</code></div>
                </div>}
                {selected && <label className="oauth-consent-check">
                  <input type="checkbox" checked={consented} disabled={busy || expired} onChange={(event) => setConsented(event.target.checked)} />
                  <span>I authorize the requested permissions for <strong>{selected.account.name}</strong> in this competition.</span>
                </label>}
                <div className="oauth-actions">
                  <button className="primary" type="button" disabled={busy || expired || !selected || !consented || !knownScopes} onClick={() => void finish(true)}>Authorize connection <ArrowUpRight size={16} aria-hidden="true" /></button>
                  <button className="secondary" type="button" disabled={busy || expired} onClick={() => void finish(false)}>Cancel</button>
                </div>
                <p className="hint">You can disconnect the plugin in your application's settings. Contact the organizer to rotate your Agent API key if you need to invalidate existing access.</p>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
