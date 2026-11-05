import { afterEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, reset } from "cloudflare:test";

afterEach(async () => { vi.restoreAllMocks(); await reset(); });

it("advertises CIMD with strict public-fetch runtime protection enabled", async () => {
  const response = await SELF.fetch(`${env.APP_ORIGIN}/.well-known/oauth-authorization-server`);
  expect(response.status).toBe(200);
  const metadata = await response.json() as { client_id_metadata_document_supported?: boolean };
  expect(metadata.client_id_metadata_document_supported).toBe(true);
});

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

it("connects a ChatGPT-shaped CIMD client using PKCE and a signed private_key_jwt assertion", async () => {
  const origin = env.APP_ORIGIN;
  const clientId = "https://chatgpt.com/oauth/client.json";
  const jwksUri = "https://chatgpt.com/oauth/jwks.json";
  const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
  const verifier = "browser-cimd-verifier-that-is-longer-than-forty-three-characters";
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const outbound = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const data = url === clientId ? {
      client_id: clientId, client_name: "ChatGPT", redirect_uris: [redirectUri],
      token_endpoint_auth_method: "private_key_jwt", jwks_uri: jwksUri,
    } : url === jwksUri ? { keys: [{ ...publicKey, kid: "local-cimd-test", alg: "ES256", use: "sig" }] } : null;
    if (!data) throw new Error("Unexpected outbound request in isolated CIMD test");
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  });
  // Both URLs above are mocked; no request reaches ChatGPT or any external server.
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => SELF.fetch(`${origin}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  expect((await post("/api/admin/markets", { id: "oauth-cimd", name: "Isolated CIMD", practice: true,
    assetMode: "legacy", retailAgents: false, rounds: 30, roundMs: 60000,
  }, { Authorization: "Bearer runtime-test-admin" })).status).toBe(201);
  const registered = await post("/api/markets/oauth-cimd/join", { name: "CIMD participant" });
  expect(registered.status).toBe(201);
  const participant = await registered.json() as { apiKey: string; account: { id: string } };
  const metadataResponse = await SELF.fetch(`${origin}/.well-known/oauth-authorization-server`);
  const metadata = await metadataResponse.json() as { token_endpoint: string; token_endpoint_auth_methods_supported: string[] };
  expect(metadata.token_endpoint_auth_methods_supported).toContain("private_key_jwt");
  const codeChallenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    state: "cimd-client-state", scope: "market:read account:read trade:write", resource: `${origin}/mcp`,
    code_challenge: codeChallenge, code_challenge_method: "S256" });
  const pending = await SELF.fetch(`${origin}/oauth/authorize/info?${query}`);
  expect(pending.status).toBe(200);
  const info = await pending.json() as { requestId: string; csrfToken: string; client: { domain: string; name: string; redirectUri: string } };
  expect(info.client).toMatchObject({ name: "ChatGPT", domain: "chatgpt.com", redirectUri });
  const cookie = pending.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const approved = await post("/oauth/authorize", { requestId: info.requestId, csrfToken: info.csrfToken,
    approve: true, marketId: "oauth-cimd", apiKey: participant.apiKey,
  }, { Cookie: cookie, Origin: origin });
  expect(approved.status).toBe(200);
  const callback = new URL((await approved.json() as { redirectTo: string }).redirectTo);
  expect(callback.origin + callback.pathname).toBe(redirectUri);
  const code = callback.searchParams.get("code")!;
  const issueAssertion = async (signingKey: CryptoKey) => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
    const input = `${encode({ alg: "ES256", kid: "local-cimd-test", typ: "JWT" })}.${encode({
      iss: clientId, sub: clientId, aud: origin, iat: now, exp: now + 60, jti: crypto.randomUUID(),
    })}`;
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, new TextEncoder().encode(input));
    return `${input}.${base64url(new Uint8Array(signature))}`;
  };
  const exchange = async (assertion: string) => SELF.fetch(metadata.token_endpoint, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier,
      client_id: clientId, redirect_uri: redirectUri, resource: `${origin}/mcp`,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion }),
  });
  const wrongKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const invalid = await exchange(await issueAssertion(wrongKeys.privateKey));
  expect(invalid.status).toBe(401);
  expect((await invalid.json() as { access_token?: string }).access_token).toBeUndefined();
  const tokenResponse = await exchange(await issueAssertion(keys.privateKey));
  expect(tokenResponse.status).toBe(200);
  const token = await tokenResponse.json() as { access_token: string; resource: string };
  expect(token.resource).toBe(`${origin}/mcp`);
  const accountResponse = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "my_account", arguments: {} } }, {
    Authorization: `Bearer ${token.access_token}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26",
  });
  expect(accountResponse.status).toBe(200);
  const account = await accountResponse.json() as { result: { content: { text: string }[] } };
  expect(JSON.parse(account.result.content[0].text).id).toBe(participant.account.id);
  expect(outbound).toHaveBeenCalled();
  expect(outbound.mock.calls.every(([input]) => [clientId, jwksUri].includes(typeof input === "string" ? input : input instanceof URL ? input.href : input.url))).toBe(true);
});

it("rejects private loopback client metadata URLs without creating a consent transaction", async () => {
  for (const clientId of ["http://127.0.0.1/internal", "https://127.0.0.1/internal"]) {
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "https://chatgpt.com/connector_platform/oauth/callback",
      response_type: "code", state: "private-metadata-test",
      scope: "market:read", resource: `${env.APP_ORIGIN}/mcp`,
      code_challenge: "A".repeat(43), code_challenge_method: "S256",
    });
    const response = await SELF.fetch(`${env.APP_ORIGIN}/oauth/authorize/info?${query}`);
    expect(response.status).toBe(400);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const data = await response.json() as { error?: string; requestId?: string };
    expect(data.error).toBeTruthy();
    expect(data.requestId).toBeUndefined();
  }
});
