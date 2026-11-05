import { afterEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, reset } from "cloudflare:test";
import { Wallet } from "ethers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { decisionTyped, identityTyped } from "../worker/audit-log";

afterEach(async () => reset());
const origin = env.APP_ORIGIN;
const callback = "https://chatgpt.com/connector_platform/oauth/callback";
const market = "oauth-signed-audit";

async function request(path: string, data?: unknown, headers: Record<string, string> = {}) {
  const response = await SELF.fetch(new URL(path, origin), {
    method: data === undefined ? "GET" : "POST",
    headers: { ...(data === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, headers: response.headers, body: await response.json() as any };
}

it("OAuth trading preserves the lab's signed-order requirement and signed receipts", async () => {
  const adminHeaders = { Authorization: "Bearer runtime-test-admin" };
  expect((await request("/api/admin/markets", {
    id: market, name: "OAuth signed audit acceptance", practice: true,
    rounds: 1, roundMs: 60000, auditEnabled: true, retailAgents: false,
  }, adminHeaders)).status).toBe(201);

  const participants = [];
  for (let index = 0; index < 2; index++) {
    const joined = await request(`/api/markets/${market}/join`, { name: `OAuth signed participant ${index}` });
    expect(joined.status).toBe(201);
    const wallet = Wallet.createRandom();
    const identity = identityTyped(origin, market, joined.body.account.id);
    expect((await request(`/api/markets/${market}/identity`, {
      signer: wallet.address,
      signature: await wallet.signTypedData(identity.domain, identity.types, identity.message),
    }, { Authorization: `Bearer ${joined.body.apiKey}` })).status).toBe(200);
    participants.push({ wallet, apiKey: joined.body.apiKey as string, id: joined.body.account.id as string });
  }
  expect((await request(`/api/admin/markets/${market}/start`, {}, adminHeaders)).status).toBe(200);

  const registered = await request("/oauth/register", {
    client_name: "Local OAuth signed audit test", redirect_uris: [callback],
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  expect(registered.status).toBe(201);
  const verifier = "isolated-signed-audit-verifier-at-least-43-characters-long";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const query = new URLSearchParams({
    client_id: registered.body.client_id, redirect_uri: callback, response_type: "code",
    scope: "market:read account:read trade:write", state: "signed-test-state",
    resource: `${origin}/mcp`, code_challenge: challenge, code_challenge_method: "S256",
  });
  const pending = await request(`/oauth/authorize/info?${query}`);
  expect(pending.status).toBe(200);
  const cookie = pending.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const approved = await request("/oauth/authorize", {
    requestId: pending.body.requestId, csrfToken: pending.body.csrfToken,
    marketId: market, apiKey: participants[0].apiKey, approve: true,
  }, { Cookie: cookie, Origin: origin });
  expect(approved.status).toBe(200);
  const code = new URL(approved.body.redirectTo).searchParams.get("code")!;
  const tokens = await SELF.fetch(`${origin}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", client_id: registered.body.client_id,
      redirect_uri: callback, code, code_verifier: verifier, resource: `${origin}/mcp`,
    }).toString(),
  });
  expect(tokens.status).toBe(200);
  const token = await tokens.json() as { access_token: string };
  const client = new Client({ name: "oauth-signed-audit", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } },
    fetch: SELF.fetch.bind(SELF),
  });
  await client.connect(transport);
  try {
    const decision = { round: 1, symbol: "BFBT", side: "PASS" as const, price: 0, quantity: 0, requestId: "signed-oauth-pass" };
    const missing = await client.callTool({ name: "submit_decision", arguments: decision }) as any;
    expect(missing.isError).toBe(true);
    expect(JSON.parse(missing.content[0].text).code).toBe("SIGNATURE_REQUIRED");
    const typed = decisionTyped(origin, market, participants[0].id, decision);
    const forged = await participants[1].wallet.signTypedData(typed.domain, typed.types, typed.message);
    const rejected = await client.callTool({ name: "submit_decision", arguments: { ...decision, signature: forged } }) as any;
    expect(rejected.isError).toBe(true);
    expect(JSON.parse(rejected.content[0].text).code).toBe("INVALID_SIGNATURE");
    const signature = await participants[0].wallet.signTypedData(typed.domain, typed.types, typed.message);
    const accepted = await client.callTool({ name: "submit_decision", arguments: { ...decision, signature } }) as any;
    expect(accepted.isError).toBe(false);
    const receipt = JSON.parse(accepted.content[0].text).receipt;
    expect(receipt.operation.type).toBe("decision");
    expect(receipt.hash).toMatch(/^0x/);
    const restRetry = await request(`/api/markets/${market}/decision`, { ...decision, signature }, { Authorization: `Bearer ${participants[0].apiKey}` });
    expect(restRetry.status).toBe(200);
    expect(restRetry.body.receipt.hash).toBe(receipt.hash);
  } finally {
    await client.close();
  }
});
