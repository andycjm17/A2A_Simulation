import {
  AuthorizationError, CimdFetchError, OAuthError,
  OAuthAuthorizationServer, OAuthResourceServer,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { MarketError, ensure, sha256 } from "./engine";

export const OAUTH_SCOPES = ["market:read", "account:read", "trade:write"];
export type OAuthIdentity = { marketId: string; keyHash: string; scopes: string[] };
type Services = {
  account: (marketId: string, keyHash: string) => Promise<{ id: string }>;
  mcp: (request: Request, identity: OAuthIdentity) => Promise<Response>;
};

export function isOAuthRoute(path: string) {
  return path === "/mcp" || path.startsWith("/oauth/") ||
    path.startsWith("/.well-known/oauth-");
}

function response(data: unknown, status = 200, headers?: Headers) {
  const h = new Headers(headers);
  h.set("Cache-Control", "no-store");
  h.set("Content-Type", "application/json");
  h.delete("Location");
  return new Response(JSON.stringify(data), { status, headers: h });
}

function errorResponse(error: string, description: string, status = 400) {
  return response({ error, error_description: description }, status);
}

/** Buffer only an explicitly bounded OAuth request, including chunked bodies. */
async function boundedRequest(request: Request): Promise<Request> {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw new MarketError("BODY_TOO_LARGE", "Request must not exceed 8 KB.", 413);
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return new Request(request, { body: data });
}

async function singleUse(env: Env, kind: string, value: string, ttl: number, action: () => Promise<Response>) {
  const hash = await sha256(`${kind}:${value}`);
  const guard = env.OAUTH_REPLAY.get(env.OAUTH_REPLAY.idFromName(hash));
  const lease = await guard.begin(ttl);
  if (!lease) return errorResponse("invalid_grant", "This authorization has already been used or is being processed.");
  try {
    const result = await action();
    if (result.ok) {
      if (!(await guard.finish(lease))) return errorResponse("temporarily_unavailable", "Authorization expired while processing. Start again.", 503);
    } else await guard.release(lease);
    return result;
  } catch (error) {
    await guard.release(lease);
    throw error;
  }
}

const consentSchema = z.object({
  requestId: z.string().min(32).max(256),
  csrfToken: z.string().min(32).max(256),
  approve: z.boolean(),
  marketId: z.string().max(40).optional(),
  apiKey: z.string().max(512).optional(),
}).strict();

const identitySchema = z.object({
  marketId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/),
  keyHash: z.string().regex(/^[a-f0-9]{64}$/),
  scopes: z.array(z.enum(["market:read", "account:read", "trade:write"])),
});

export async function handleOAuth(request: Request, env: Env, ctx: ExecutionContext, services: Services): Promise<Response> {
  const url = new URL(request.url);
  // Only an explicitly configured local development server may use a loopback issuer.
  const local = env.DEV_ORIGIN && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const issuer = local ? url.origin : new URL(env.APP_ORIGIN).origin;
  const resource = `${issuer}/mcp`;
  if (url.origin !== issuer) {
    if (request.method === "GET" || request.method === "HEAD")
      return Response.redirect(`${issuer}${url.pathname}${url.search}`, 308);
    return errorResponse("invalid_request", "Use the canonical authorization server origin.");
  }
  ensure(url.search.length <= 8192, "INVALID_REQUEST", "Authorization URL is too long.");
  const origin = request.headers.get("Origin");
  // Consent is browser initiated; OAuth protocol endpoints are server-to-server.
  if (url.pathname.startsWith("/oauth/authorize") && origin && origin !== issuer)
    return errorResponse("invalid_request", "Consent must be completed on the authorization website.", 403);
  if (request.method === "OPTIONS") {
    if (origin && origin !== issuer) return errorResponse("invalid_request", "Cross-origin browser requests are not supported.", 403);
    return new Response(null, { status: 204, headers: { "Allow": "GET, POST, OPTIONS" } });
  }
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const limiter = url.pathname === "/mcp" ? env.IP_LIMITER : env.OAUTH_LIMITER;
  const key = url.pathname === "/mcp"
    ? `oauth-mcp:${await sha256(request.headers.get("Authorization") || ip)}`
    : `oauth:${url.pathname}:${ip}`;
  const results = await Promise.all([
    limiter.limit({ key }),
    ...(request.headers.has("CF-Connecting-IP") ? [env.NETWORK_LIMITER.limit({ key: `ip:${ip}` })] : []),
  ]);
  ensure(results.every(result => result.success), "RATE_LIMITED", "Too many requests. Please try again shortly.", 429);
  request = await boundedRequest(request);

  const authorization = new OAuthAuthorizationServer<Env>({
    issuer,
    resources: [resource],
    defaultResource: resource,
    authorizeEndpoint: "/oauth/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    accessTokenTTL: 600,
    refreshTokenTTL: 86400,
    // ChatGPT reuses a DCR client for a connection; expiring it breaks reconnects.
    clientRegistrationTTL: undefined,
    scopesSupported: OAUTH_SCOPES,
    clientIdMetadataDocumentEnabled: true,
    allowTokenExchangeGrant: false,
    async tokenExchangeCallback(options) {
      const identity = identitySchema.safeParse(options.props);
      if (!identity.success) throw new OAuthError("invalid_grant", { description: "Authorization is no longer valid." });
      try { await services.account(identity.data.marketId, identity.data.keyHash); }
      catch (error) {
        if (error instanceof MarketError && [401, 403, 404].includes(error.status))
          throw new OAuthError("invalid_grant", { description: "Agent access was revoked. Connect again with current credentials." });
        throw error;
      }
      return { accessTokenProps: { ...identity.data, scopes: options.requestedScope } };
    },
    onError(error) {
      // Deliberately omit request URL, tokens, client metadata and provider error detail.
      console.warn(JSON.stringify({ event: "oauth_rejected", code: error.code, category: error.internal.category, reason: error.internal.reason }));
    },
  });
  const oauth = authorization.getOAuthApi(env);

  try {
    if (url.pathname === "/oauth/authorize" && request.method === "GET") {
      const asset = new URL("/index.html", url);
      const result = await env.ASSETS.fetch(new Request(asset, { headers: request.headers }));
      const headers = new Headers(result.headers);
      headers.set("Cache-Control", "no-store");
      return new Response(result.body, { status: result.status, headers });
    }
    if (url.pathname === "/oauth/authorize/info" && request.method === "GET") {
      const authorizeUrl = new URL(url);
      authorizeUrl.pathname = "/oauth/authorize";
      const auth = await oauth.parseAuthRequest(new Request(authorizeUrl));
      // All clients, including confidential clients, must use S256 PKCE.
      if (auth.codeChallengeMethod !== "S256" || !auth.codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(auth.codeChallenge))
        return errorResponse("invalid_request", "S256 PKCE is required.");
      auth.scope = auth.scope.length ? [...new Set(auth.scope)] : [...OAUTH_SCOPES];
      if (!auth.scope.every(scope => OAUTH_SCOPES.includes(scope)))
        return errorResponse("invalid_scope", "The requested permission is not supported.");
      const details = await oauth.describeConsent(auth);
      const transaction = await oauth.beginConsent(auth);
      return response({
        requestId: transaction.handle,
        csrfToken: transaction.handle,
        client: { name: details.clientName, redirectUri: details.redirectUri,
          domain: details.clientDomain, redirectIsLoopback: details.redirectIsLoopback },
        scopes: auth.scope,
        expiresAt: Date.now() + 600_000,
      }, 200, transaction.headers);
    }
    if (url.pathname === "/oauth/authorize" && request.method === "POST") {
      if (origin !== issuer) return errorResponse("invalid_request", "A same-origin consent request is required.", 403);
      if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json")
        return errorResponse("invalid_request", "Use application/json.", 415);
      let parsed: unknown;
      try { parsed = await request.json(); } catch { return errorResponse("invalid_request", "Invalid JSON."); }
      const payload = consentSchema.safeParse(parsed);
      if (!payload.success) return errorResponse("invalid_request", "Invalid consent form.");
      const data = payload.data;
      // The handle is the provider's unpredictable CSRF value; its HttpOnly cookie
      // binds it to the original browser. Identity is verified separately below.
      if (data.requestId !== data.csrfToken) return errorResponse("invalid_request", "Invalid consent verification.", 403);
      let keyHash = "", agentId = "";
      if (data.approve) {
        if (!data.marketId || !/^[a-z0-9][a-z0-9-]{2,39}$/.test(data.marketId) || !data.apiKey)
          return errorResponse("invalid_request", "Select your competition and verify your Agent API key.");
        keyHash = await sha256(data.apiKey);
        agentId = (await services.account(data.marketId, keyHash)).id;
      }
      return await singleUse(env, "consent", data.requestId, 1200, async () => {
        if (!data.approve) {
          const denied = await oauth.denyConsent(request, data.requestId);
          return response({ redirectTo: denied.redirectTo }, 200, denied.headers);
        }
        const approved = await oauth.approveConsent(request, data.requestId);
        const identity: OAuthIdentity = { marketId: data.marketId!, keyHash, scopes: approved.request.scope };
        const result = await oauth.completeAuthorization({
          request: approved.request,
          userId: `${data.marketId}.${agentId}`,
          metadata: { marketId: data.marketId, agentId },
          scope: approved.request.scope,
          props: identity,
        });
        return response(result, 200, approved.headers);
      });
    }
    if (url.pathname === "/mcp" || url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      // Also serve the origin-level alias for older MCP discovery clients.
      if (url.pathname === "/.well-known/oauth-protected-resource")
        request = new Request(new URL("/.well-known/oauth-protected-resource/mcp", issuer), request);
      const server = new OAuthResourceServer<Env, OAuthIdentity>({
        resourceMetadata: { resource, authorization_servers: [issuer], resource_name: "Agent Exchange simulated trading" },
        // This provider advertises (does not enforce) these scopes. Request all
        // useful permissions on first connection; reduced grants remain valid
        // and each tool enforces its own scope in the MCP handler.
        requiredScopes: OAUTH_SCOPES,
        validateToken: () => async (audience, token) => {
          const value = await authorization.validateToken<OAuthIdentity>(audience, token, env);
          if (!value || !identitySchema.safeParse(value.props).success) return null;
          // Rotation invalidates access immediately through the authoritative room,
          // even while the OAuth provider's KV revocation is propagating.
          try { await services.account(value.props.marketId, value.props.keyHash); }
          catch (error) {
            if (error instanceof MarketError && [401, 403, 404].includes(error.status)) return null;
            throw error;
          }
          return value;
        },
        handler: { fetch(req, _env, context) {
          return services.mcp(req, { ...context.props, scopes: context.auth.scope });
        } },
      });
      return await server.fetch(request, env, ctx);
    }
    if (url.pathname === "/oauth/token" && request.method === "POST") {
      const type = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
      if (type === "application/x-www-form-urlencoded") {
        const form = new URLSearchParams(await request.clone().text());
        const grant = form.get("grant_type");
        const secret = grant === "authorization_code" ? form.get("code") : grant === "refresh_token" ? form.get("refresh_token") : null;
        if (secret) return await singleUse(env, grant!, secret, grant === "refresh_token" ? 172800 : 1200,
          () => authorization.fetch(request, env, ctx));
      }
    }
    return await authorization.fetch(request, env, ctx);
  } catch (error) {
    if (error instanceof AuthorizationError) return errorResponse(error.code, error.description);
    if (error instanceof CimdFetchError) return errorResponse("invalid_client", "The requesting application's identity could not be verified. Please try again.");
    throw error;
  }
}
