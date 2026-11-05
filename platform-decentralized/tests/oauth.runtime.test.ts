import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, reset } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { chatgptEndpoint } from "../src/mcp-endpoints";

// Every request is handled by the isolated Workers test runtime, even though we
// use its configured canonical origin to exercise real audience validation.
const origin = env.APP_ORIGIN;
const resource = `${origin}/mcp`;
const callback = "https://chatgpt.com/connector_platform/oauth/callback";
const scopes = "market:read account:read trade:write";
const admin = "runtime-test-admin";
const market = "oauth-practice";
const verifier = "test-verifier-with-at-least-forty-three-characters-0123456789";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

async function http(path: string, init: RequestInit = {}) {
  const response = await SELF.fetch(new URL(path, origin), {
    redirect: "manual",
    ...init,
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, headers: response.headers, data, text };
}

async function json(path: string, data: unknown, headers: Record<string, string> = {}) {
  return http(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data),
  });
}

async function form(path: string, data: Record<string, string>) {
  return http(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
  });
}

async function seed(id = market, name = "OAuth participant") {
  expect((await json("/api/admin/markets", {
    id, name: "OAuth isolated practice", practice: true, assetMode: "legacy",
    retailAgents: false, rounds: 30, roundMs: 60000,
  }, { Authorization: `Bearer ${admin}` })).status).toBe(201);
  const joined = await json(`/api/markets/${id}/join`, { name, description: "OAuth compatibility test" });
  expect(joined.status).toBe(201);
  return joined.data as { apiKey: string; account: { id: string; name: string } };
}

async function startMarket() {
  expect((await json(`/api/markets/${market}/join`, { name: "OAuth counterparty" })).status).toBe(201);
  expect((await json(`/api/admin/markets/${market}/start`, {}, { Authorization: `Bearer ${admin}` })).status).toBe(200);
}

async function discover() {
  const metadata = await http("/.well-known/oauth-authorization-server");
  expect(metadata.status).toBe(200);
  return metadata.data;
}

async function register() {
  const metadata = await discover();
  const result = await json(metadata.registration_endpoint, {
    client_name: "Browser OAuth acceptance client",
    redirect_uris: [callback],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  expect(result.status).toBe(201);
  return { metadata, clientId: result.data.client_id as string };
}

async function challenge() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type ClientRegistration = Awaited<ReturnType<typeof register>>;
async function begin(client: ClientRegistration, overrides: Record<string, string | null> = {}) {
  const query = new URLSearchParams({
    client_id: client.clientId, redirect_uri: callback, response_type: "code",
    scope: scopes, state: "opaque-browser-client-state", resource,
    code_challenge: await challenge(), code_challenge_method: "S256",
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) query.delete(key); else query.set(key, value);
  }
  const result = await http(`/oauth/authorize/info?${query}`);
  return {
    ...result,
    cookie: (result.headers.getSetCookie?.() ?? [result.headers.get("Set-Cookie") || ""])
      .map(value => value.split(";")[0]).filter(Boolean).join("; "),
    query,
  };
}

type Consent = Awaited<ReturnType<typeof begin>>;
async function consent(pending: Consent, key: string, id = market, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return json("/oauth/authorize", {
    requestId: pending.data.requestId, csrfToken: pending.data.csrfToken,
    marketId: id, apiKey: key, approve: true, ...extra,
  }, { Cookie: pending.cookie, Origin: origin, ...headers });
}

async function authorize(key: string, id = market, scope = scopes) {
  const client = await register();
  const pending = await begin(client, { scope });
  expect(pending.status).toBe(200);
  const approved = await consent(pending, key, id);
  expect(approved.status).toBe(200);
  const redirect = new URL(approved.data.redirectTo);
  expect(redirect.origin + redirect.pathname).toBe(callback);
  expect(redirect.searchParams.get("state")).toBe("opaque-browser-client-state");
  expect(redirect.searchParams.get("iss")).toBe(client.metadata.issuer);
  const code = redirect.searchParams.get("code");
  expect(code).toBeTruthy();
  return { ...client, pending, code: code! };
}

type Authorization = Awaited<ReturnType<typeof authorize>>;
function exchange(auth: Authorization, changes: Record<string, string> = {}) {
  return form(auth.metadata.token_endpoint, {
    grant_type: "authorization_code", client_id: auth.clientId,
    redirect_uri: callback, code: auth.code, code_verifier: verifier, resource,
    ...changes,
  });
}

async function grant(key: string, id = market, scope = scopes) {
  const auth = await authorize(key, id, scope);
  const token = await exchange(auth);
  expect(token.status).toBe(200);
  return { ...auth, token: token.data };
}

function rpc(token: string, method: string, params: unknown = {}, endpoint = "/mcp") {
  return json(endpoint, { jsonrpc: "2.0", id: 1, method, params }, {
    Authorization: `Bearer ${token}`,
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-03-26",
  });
}

const pass = { round: 1, side: "PASS", price: 0, quantity: 0, requestId: "oauth-pass-round-one" };
function toolData(response: Awaited<ReturnType<typeof http>>) {
  return JSON.parse(response.data.result.content[0].text);
}

describe("ChatGPT browser OAuth MCP compatibility", () => {
  it("canonicalizes production aliases while keeping lab and local OAuth resources separate", async () => {
    for (const alias of ["https://a2asimulation.com", "https://www.a2asimulation.com", "https://a2a.andycui.com"])
      expect(chatgptEndpoint(alias)).toBe("https://a2asimulation.com/mcp");
    expect(chatgptEndpoint("https://lab.a2asimulation.com")).toBe("https://lab.a2asimulation.com/mcp");
    expect(chatgptEndpoint("http://127.0.0.1:5191")).toBe("http://127.0.0.1:5191/mcp");
    const aliasDiscovery = await http("https://www.a2asimulation.com/.well-known/oauth-authorization-server");
    expect(aliasDiscovery.status).toBe(308);
    expect(aliasDiscovery.headers.get("Location")).toBe(`${origin}/.well-known/oauth-authorization-server`);
  });

  it("publishes discoverable OAuth and protected-resource metadata without exposing account tools", async () => {
    const missing = await json("/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "discovery", version: "1" },
    } }, { Accept: "application/json, text/event-stream" });
    expect(missing.status).toBe(401);
    const challengeHeader = missing.headers.get("WWW-Authenticate") || "";
    for (const scope of scopes.split(" ")) expect(challengeHeader).toContain(scope);
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challengeHeader)?.[1];
    expect(metadataUrl).toBeTruthy();
    const protectedResource = await http(metadataUrl!);
    expect(protectedResource.status).toBe(200);
    expect(protectedResource.data.resource).toBe(resource);
    expect(protectedResource.data.authorization_servers).toContain(origin);
    const metadata = await discover();
    expect(metadata.issuer).toBe(origin);
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.scopes_supported).toEqual(expect.arrayContaining(scopes.split(" ")));
    expect(metadata.grant_types_supported).toContain("authorization_code");
    expect(missing.text).not.toContain("availableCash");
  });

  it("completes registration, explicit consent, PKCE exchange, SDK discovery, own-account reads and simulated decisions", async () => {
    const participant = await seed();
    const authorized = await grant(participant.apiKey);
    expect(authorized.token.token_type.toLowerCase()).toBe("bearer");
    expect(authorized.token.expires_in).toBeGreaterThan(0);
    expect(authorized.token.expires_in).toBeLessThanOrEqual(900);
    expect(authorized.token.refresh_token).toBeTruthy();
    expect(JSON.stringify(authorized.pending.data)).not.toContain(participant.apiKey);
    expect(authorized.pending.headers.get("Cache-Control")).toContain("no-store");
    expect(authorized.pending.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(authorized.pending.headers.get("Set-Cookie")).toContain("Secure");
    expect(authorized.pending.headers.get("Set-Cookie")).toMatch(/SameSite=(?:Lax|Strict)/i);
    const client = new Client({ name: "ChatGPT-compatible client", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { Authorization: `Bearer ${authorized.token.access_token}` } },
      fetch: ((input: any, init: any) => SELF.fetch(input, init)) as typeof fetch,
    });
    await client.connect(transport);
    try {
      const list = await client.listTools();
      expect(list.tools.map(tool => tool.name).sort()).toEqual(["market_snapshot", "my_account", "submit_decision"]);
      expect(list.tools.find(tool => tool.name === "submit_decision")?.annotations?.readOnlyHint).toBe(false);
      // Validate the raw protocol: older SDK clients may strip unknown tool fields.
      const rawList = await rpc(authorized.token.access_token, "tools/list");
      for (const [name, scope] of [["market_snapshot", "market:read"], ["my_account", "account:read"], ["submit_decision", "trade:write"]]) {
        const tool = rawList.data.result.tools.find((item: { name: string }) => item.name === name);
        expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: [scope] }]);
        expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
      }
      const account = await client.callTool({ name: "my_account", arguments: {} });
      const own = JSON.parse((account.content as { text: string }[])[0].text);
      expect(own.id).toBe(participant.account.id);
      const snapshot = await client.callTool({ name: "market_snapshot", arguments: {} });
      expect(JSON.parse((snapshot.content as { text: string }[])[0].text).config.id).toBe(market);
      await startMarket();
      const decision = await client.callTool({ name: "submit_decision", arguments: pass });
      expect(decision.isError).not.toBe(true);
      const retry = await client.callTool({ name: "submit_decision", arguments: pass });
      expect(retry).toEqual(decision);
      const final = await http(`/api/markets/${market}/account`, { headers: { Authorization: `Bearer ${participant.apiKey}` } });
      expect(final.data.orders).toHaveLength(1);
    } finally { await client.close(); }
  });

  it("requires S256 PKCE and rejects unknown scopes before issuing a consent handle", async () => {
    const client = await register();
    for (const overrides of [
      { code_challenge: null, code_challenge_method: null },
      { code_challenge: verifier, code_challenge_method: "plain" },
      { code_challenge: "bad", code_challenge_method: "S256" },
      { scope: "admin:write" },
      { response_type: "token" },
    ]) {
      const denied = await begin(client, overrides);
      expect(denied.status).toBeGreaterThanOrEqual(400);
      expect(denied.data.requestId).toBeUndefined();
    }
  });

  it("also requires PKCE for a confidential registered client", async () => {
    const metadata = await discover();
    const registered = await json(metadata.registration_endpoint, {
      client_name: "Confidential OAuth test", redirect_uris: [callback],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    });
    expect(registered.status).toBe(201);
    expect(registered.data.client_secret).toBeTruthy();
    const rejected = await begin({ metadata, clientId: registered.data.client_id }, { code_challenge: null, code_challenge_method: null });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(rejected.data.requestId).toBeUndefined();
  });

  it("rejects unregistered redirects and foreign resource audiences without redirecting to them", async () => {
    const client = await register();
    for (const overrides of [
      { redirect_uri: "https://attacker.example/collect" },
      { redirect_uri: `${callback}/extra` },
      { redirect_uri: `${callback}?next=https://attacker.example` },
      { resource: "https://attacker.example/mcp" },
      { resource: `${origin}/api/admin` },
    ]) {
      const denied = await begin(client, overrides);
      expect(denied.status).toBeGreaterThanOrEqual(400);
      expect(denied.headers.has("Location")).toBe(false);
      expect(denied.data.redirectTo).toBeUndefined();
    }
  });

  it("rejects script, remote plaintext, fragment and userinfo callback registration", async () => {
    const metadata = await discover();
    for (const redirect of ["javascript:alert(1)", "http://attacker.example/cb", "https://chatgpt.com/cb#fragment", "https://user:secret@chatgpt.com/cb"]) {
      const result = await json(metadata.registration_endpoint, {
        client_name: "Invalid callback", redirect_uris: [redirect], token_endpoint_auth_method: "none",
      });
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.data.client_id).toBeUndefined();
    }
  });

  it("binds consent to its browser cookie, same-origin request and opaque transaction", async () => {
    const participant = await seed();
    const client = await register();
    const attempts: [Record<string, unknown>, Record<string, string>][] = [
      [{}, { Cookie: "" }],
      [{}, { Cookie: "unrelated-browser=invalid" }],
      [{}, { Origin: "https://attacker.example" }],
      [{ csrfToken: "forged" }, {}],
      [{ requestId: "forged" }, {}],
    ];
    for (const [extra, headers] of attempts) {
      const pending = await begin(client);
      expect(pending.status).toBe(200);
      const denied = await consent(pending, participant.apiKey, market, extra, headers);
      expect(denied.status).toBeGreaterThanOrEqual(400);
      expect(denied.data.redirectTo).toBeUndefined();
    }
  });

  it("declines consent without issuing a code and preserves client state and issuer", async () => {
    const client = await register();
    const pending = await begin(client);
    const declined = await consent(pending, "", market, { approve: false });
    expect(declined.status).toBe(200);
    const redirect = new URL(declined.data.redirectTo);
    expect(redirect.origin + redirect.pathname).toBe(callback);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("code")).toBeNull();
    expect(redirect.searchParams.get("state")).toBe("opaque-browser-client-state");
    expect(redirect.searchParams.get("iss")).toBe(origin);
    expect((await consent(pending, "", market, { approve: false })).status).toBeGreaterThanOrEqual(400);
  });

  it("rejects wrong competition credentials and administrator credentials at participant consent", async () => {
    const first = await seed();
    await seed("oauth-other-market");
    const client = await register();
    for (const [id, key] of [["oauth-other-market", first.apiKey], [market, admin], [market, "invented-key"]]) {
      const pending = await begin(client);
      const denied = await consent(pending, key, id);
      expect(denied.status).toBeGreaterThanOrEqual(400);
      expect(denied.data.redirectTo).toBeUndefined();
    }
  });

  it("rejects missing or incorrect verifier and prevents authorization-code reuse", async () => {
    const participant = await seed();
    for (const badVerifier of ["", "a-different-verifier-with-forty-three-or-more-characters-123456789"]) {
      const auth = await authorize(participant.apiKey);
      const invalid = await exchange(auth, { code_verifier: badVerifier });
      expect(invalid.status).toBeGreaterThanOrEqual(400);
      expect(invalid.data.access_token).toBeUndefined();
      // An invalid attempt must not permanently consume the replay guard lease.
      expect((await exchange(auth)).status).toBe(200);
    }
    const auth = await authorize(participant.apiKey);
    expect((await exchange(auth)).status).toBe(200);
    const replay = await exchange(auth);
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(replay.data.access_token).toBeUndefined();
  });

  it("binds code exchange to the registered client, redirect and requested resource", async () => {
    const participant = await seed();
    const other = await register();
    for (const changes of [
      { client_id: other.clientId },
      { redirect_uri: "https://attacker.example/collect" },
      { resource: "https://attacker.example/mcp" },
    ]) {
      const auth = await authorize(participant.apiKey);
      const denied = await exchange(auth, changes);
      expect(denied.status).toBeGreaterThanOrEqual(400);
      expect(denied.data.access_token).toBeUndefined();
    }
  });

  it("accepts at most one concurrent consent approval for a browser-bound handle", async () => {
    const participant = await seed();
    const client = await register();
    const pending = await begin(client);
    expect(pending.status).toBe(200);
    const results = await Promise.all(Array.from({ length: 6 }, () => consent(pending, participant.apiKey)));
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => result.status >= 400)).toHaveLength(5);
  });

  it("accepts at most one concurrent redemption of an authorization code", async () => {
    const participant = await seed();
    const auth = await authorize(participant.apiKey);
    const results = await Promise.all(Array.from({ length: 6 }, () => exchange(auth)));
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => result.status >= 400)).toHaveLength(5);
  });

  it("cannot bypass code replay protection with mixed-case MIME types or duplicate form parameters", async () => {
    const participant = await seed();
    const auth = await authorize(participant.apiKey);
    const parameters = new URLSearchParams({ grant_type: "authorization_code", client_id: auth.clientId,
      redirect_uri: callback, code: auth.code, code_verifier: verifier, resource });
    const mixedCase = () => http(auth.metadata.token_endpoint, { method: "POST",
      headers: { "Content-Type": "Application/X-Www-Form-Urlencoded; charset=UTF-8" }, body: parameters.toString() });
    const duplicated = new URLSearchParams(parameters);
    duplicated.append("code", "different-code");
    expect((await http(auth.metadata.token_endpoint, { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: duplicated.toString() })).status).toBe(400);
    const results = await Promise.all([mixedCase(), mixedCase(), mixedCase()]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => result.status >= 400)).toHaveLength(2);
    expect((await exchange(auth)).status).toBe(400);
  });

  it("enforces read-only scopes at execution even if a client directly names the trading tool", async () => {
    const participant = await seed();
    const authorized = await grant(participant.apiKey, market, "market:read account:read");
    await startMarket();
    expect(toolData(await rpc(authorized.token.access_token, "tools/call", { name: "my_account", arguments: {} })).id).toBe(participant.account.id);
    const denied = await rpc(authorized.token.access_token, "tools/call", { name: "submit_decision", arguments: pass });
    expect(denied.status >= 400 || denied.data.error || denied.data.result?.isError).toBeTruthy();
    const account = await http(`/api/markets/${market}/account`, { headers: { Authorization: `Bearer ${participant.apiKey}` } });
    expect(account.data.orders).toHaveLength(0);
  });

  it("limits a market-only grant so it cannot read private balances or submit decisions", async () => {
    const participant = await seed();
    const authorized = await grant(participant.apiKey, market, "market:read");
    expect(toolData(await rpc(authorized.token.access_token, "tools/call", { name: "market_snapshot", arguments: {} })).config.id).toBe(market);
    for (const [name, args] of [["my_account", {}], ["submit_decision", pass]] as const) {
      const denied = await rpc(authorized.token.access_token, "tools/call", { name, arguments: args });
      expect(denied.status >= 400 || denied.data.error || denied.data.result?.isError).toBeTruthy();
    }
  });

  it("keeps grants scoped to the chosen Agent and rejects OAuth tokens on another market's legacy endpoint", async () => {
    const first = await seed();
    const second = await seed("oauth-second", "Second market participant");
    const firstGrant = await grant(first.apiKey);
    const secondGrant = await grant(second.apiKey, "oauth-second");
    const firstAccount = toolData(await rpc(firstGrant.token.access_token, "tools/call", { name: "my_account", arguments: {} }));
    const secondAccount = toolData(await rpc(secondGrant.token.access_token, "tools/call", { name: "my_account", arguments: {} }));
    expect(firstAccount.id).toBe(first.account.id);
    expect(secondAccount.id).toBe(second.account.id);
    expect(firstAccount.id).not.toBe(secondAccount.id);
    expect((await rpc(firstGrant.token.access_token, "tools/list", {}, "/mcp/oauth-second")).status).toBe(401);
    expect((await http("/api/markets/oauth-second/account", { headers: { Authorization: `Bearer ${firstGrant.token.access_token}` } })).status).toBe(401);
  });

  it("invalidates an OAuth grant's account authority when the participant key is rotated", async () => {
    const participant = await seed();
    const authorized = await grant(participant.apiKey);
    const rotated = await json(`/api/admin/markets/${market}/rotate`, { agentId: participant.account.id }, { Authorization: `Bearer ${admin}` });
    expect(rotated.status).toBe(200);
    const denied = await rpc(authorized.token.access_token, "tools/call", { name: "my_account", arguments: {} });
    expect(denied.status >= 400 || denied.data.error || denied.data.result?.isError).toBeTruthy();
    expect((await http(`/api/markets/${market}/account`, { headers: { Authorization: `Bearer ${participant.apiKey}` } })).status).toBe(401);
    expect((await http(`/api/markets/${market}/account`, { headers: { Authorization: `Bearer ${rotated.data.apiKey}` } })).status).toBe(200);
  });

  it("rotates refresh tokens, rejects older generations, and revokes the grant", async () => {
    const participant = await seed();
    const authorized = await grant(participant.apiKey);
    const refresh = (token: string) => form(authorized.metadata.token_endpoint, {
      grant_type: "refresh_token", client_id: authorized.clientId, refresh_token: token, resource,
    });
    const first = await refresh(authorized.token.refresh_token);
    expect(first.status).toBe(200);
    expect(first.data.refresh_token).not.toBe(authorized.token.refresh_token);
    const second = await refresh(first.data.refresh_token);
    expect(second.status).toBe(200);
    // The provider deliberately retains only the previous generation for a lost
    // response retry. Once its replacement is used, the original must fail.
    expect((await refresh(authorized.token.refresh_token)).status).toBeGreaterThanOrEqual(400);
    expect((await form(authorized.metadata.revocation_endpoint, {
      token: second.data.refresh_token, token_type_hint: "refresh_token", client_id: authorized.clientId,
    })).status).toBe(200);
    expect((await refresh(second.data.refresh_token)).status).toBeGreaterThanOrEqual(400);
    expect((await rpc(second.data.access_token, "tools/list")).status).toBe(401);
  });

  it("rejects expired access tokens after their advertised lifetime", async () => {
    const participant = await seed();
    const authorized = await grant(participant.apiKey);
    const future = Date.now() + (authorized.token.expires_in + 1) * 1000;
    vi.spyOn(Date, "now").mockReturnValue(future);
    expect((await rpc(authorized.token.access_token, "tools/list")).status).toBe(401);
  });

  it("rejects expired refresh grants and accepts at most one concurrent refresh", async () => {
    const participant = await seed();
    const authorized = await grant(participant.apiKey);
    const renew = (token: string) => form(authorized.metadata.token_endpoint, {
      grant_type: "refresh_token", client_id: authorized.clientId, refresh_token: token, resource,
    });
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => renew(authorized.token.refresh_token)));
    const accepted = concurrent.filter(result => result.status === 200);
    expect(accepted).toHaveLength(1);
    expect(concurrent.filter(result => result.status >= 400)).toHaveLength(4);
    expect((await rpc(accepted[0].data.access_token, "tools/list")).status).toBe(200);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86401 * 1000);
    const expired = await renew(accepted[0].data.refresh_token);
    expect(expired.status).toBeGreaterThanOrEqual(400);
    expect(expired.data.access_token).toBeUndefined();
  });

  it("keeps existing Bearer API-key MCP clients working and never treats an API key as an OAuth token", async () => {
    const participant = await seed();
    const legacy = await rpc(participant.apiKey, "tools/call", { name: "my_account", arguments: {} }, `/mcp/${market}`);
    expect(legacy.status).toBe(200);
    expect(toolData(legacy).id).toBe(participant.account.id);
    expect((await rpc(participant.apiKey, "tools/list")).status).toBe(401);
    expect((await rpc("invented-oauth-token", "tools/list")).status).toBe(401);
  });

  it("bounds authorization payloads and prevents JSON-RPC batch amplification on both interfaces", async () => {
    const oversized = await json("/oauth/register", { client_name: "x".repeat(8200), redirect_uris: [callback] });
    expect(oversized.status).toBe(413);
    const participant = await seed();
    const authorized = await grant(participant.apiKey);
    const batch = Array.from({ length: 3 }, (_, id) => ({ jsonrpc: "2.0", id, method: "tools/list", params: {} }));
    for (const [endpoint, token] of [["/mcp", authorized.token.access_token], [`/mcp/${market}`, participant.apiKey]]) {
      const denied = await json(endpoint, batch, { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" });
      expect(denied.status).toBe(400);
      expect(denied.data.error.code).toBe("MCP_BATCH_UNSUPPORTED");
    }
  });
});
