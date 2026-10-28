import { describe, it, expect, afterEach, vi } from "vitest";
import worker from "../worker/index";
import { env } from "cloudflare:workers";
import {
  SELF,
  reset,
  evictDurableObject,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
afterEach(async () => {
  await reset();
});
const admin = "runtime-test-admin";
describe("participant red team", () => {
  it("the network limiter still blocks rotating bearer identifiers and returns retry guidance", async () => {
    const clientLimit = vi.fn(async () => ({ success: true }));
    const networkLimit = vi.fn(async () => ({ success: false }));
    for (const token of ["guess-one", "guess-two", "guess-three"]) {
      const r = await worker.fetch(
        new Request("https://arena.test/api/health", {
          headers: {
            Authorization: `Bearer ${token}`,
            "CF-Connecting-IP": "192.0.2.1",
          },
        }),
        {
          ...env,
          IP_LIMITER: { limit: clientLimit },
          NETWORK_LIMITER: { limit: networkLimit },
        } as Env,
      );
      expect(r.status).toBe(429);
      expect(r.headers.get("Retry-After")).toBe("60");
      expect(await r.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    }
    expect(new Set(clientLimit.mock.calls.map((c: any) => c[0].key)).size).toBe(
      3,
    );
    expect(
      networkLimit.mock.calls.every((c: any) => c[0].key === "ip:192.0.2.1"),
    ).toBe(true);
  });
  it("a real HTTP collusion fill triggers organizer review without exposing sealed orders", async () => {
    const { a, b } = await setup();
    for (const [token, side] of [
      [a.apiKey, "BUY"],
      [b.apiKey, "SELL"],
    ])
      expect(
        (
          await req("/api/markets/runtime-market/decision", {
            token,
            data: { ...order, side, price: 100, quantity: 10 },
          })
        ).status,
      ).toBe(200);
    expect(
      (await req("/api/admin/markets/runtime-market/status", { token: admin }))
        .body.integrity.offReferenceTrades,
    ).toBe(0);
    const stub = env.MARKETS.get(env.MARKETS.idFromName("runtime-market"));
    await runInDurableObject(stub, async (_, ctx) => {
      const row = ctx.storage.sql
        .exec<{ state: string }>("SELECT state FROM market WHERE id=1")
        .one();
      const s = JSON.parse(row.state);
      s.openedAt = Date.now() - 60001;
      ctx.storage.sql.exec(
        "UPDATE market SET state=? WHERE id=1",
        JSON.stringify(s),
      );
    });
    await evictDurableObject(stub);
    await runDurableObjectAlarm(stub);
    const status = await req("/api/admin/markets/runtime-market/status", {
      token: admin,
    });
    expect(status.body.integrity).toMatchObject({
      requiresReview: true,
      offReferenceTrades: 1,
    });
    expect(status.body.conserved).toBe(true);
    const snapshot = (await req("/api/markets/runtime-market")).body;
    expect(snapshot.rankingBasis).toBe("cash");
    expect(snapshot.leaderboard[0].id).toBe(b.account.id);
    expect(snapshot.leaderboard[0].cash).toBeGreaterThan(snapshot.leaderboard[1].cash);
    expect(snapshot.integrity).toBeUndefined();
    expect(JSON.stringify(status.body)).not.toContain(order.requestId);
  });
  it("unknown-room probing performs no schema writes and still allows later creation", async () => {
    for (let i = 0; i < 8; i++) {
      const id = `probe-room-${i}`;
      expect((await req(`/api/markets/${id}`)).status).toBe(404);
      expect(
        (await req(`/api/markets/${id}/account`, { token: "guessed-key" }))
          .status,
      ).toBe(404);
      const stub = env.MARKETS.get(env.MARKETS.idFromName(id));
      await runInDurableObject(stub, async (_, ctx) => {
        expect(
          ctx.storage.sql
            .exec(
              "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('market','invites','orders','trades')",
            )
            .toArray(),
        ).toHaveLength(0);
      });
    }
    await create(true, { id: "probe-room-0" });
    await evictDurableObject(
      env.MARKETS.get(env.MARKETS.idFromName("probe-room-0")),
    );
    expect((await req("/api/markets/probe-room-0")).body.status).toBe("lobby");
  });
  it("rejects every organizer operation with participant authority", async () => {
    const { a } = await setup();
    for (const op of [
      "start",
      "pause",
      "resume",
      "invites",
      "rotate",
      "export",
      "status",
    ]) {
      const r = await req(`/api/admin/markets/runtime-market/${op}`, {
        token: a.apiKey,
        ...(["export", "status"].includes(op) ? {} : { data: {} }),
      });
      expect(r.status).toBe(403);
    }
    expect((await req("/api/markets/runtime-market")).body.status).toBe(
      "running",
    );
  });
  it("malicious numeric and identity payloads cannot mutate the ledger", async () => {
    const { a, b } = await setup();
    for (const extra of [
      { price: -1 },
      { price: 1.5 },
      { price: 1e300 },
      { price: "10000" },
      { quantity: -10 },
      { quantity: 11 },
      { quantity: 0.5 },
      { round: 0 },
      { round: 101 },
      { side: "ADMIN" },
      { agentId: b.account.id },
      { cash: 1e9 },
      { filled: 10 },
      { createdAt: 0 },
      { keyHash: "a".repeat(64) },
    ]) {
      expect(
        (
          await req("/api/markets/runtime-market/decision", {
            token: a.apiKey,
            data: { ...order, ...extra },
          })
        ).status,
      ).toBe(400);
    }
    const acc = (
      await req("/api/markets/runtime-market/account", { token: a.apiKey })
    ).body;
    expect(acc).toMatchObject({ cash: 1000000, dat: 100, orders: [] });
    expect(
      (await req("/api/admin/markets/runtime-market/status", { token: admin }))
        .body.conserved,
    ).toBe(true);
  });
  it("mixed replay storm accepts exactly one immutable decision", async () => {
    const { a } = await setup();
    const receipt = await req("/api/markets/runtime-market/decision", {
      token: a.apiKey,
      data: order,
    });
    const replies = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        req("/api/markets/runtime-market/decision", {
          token: a.apiKey,
          data:
            i % 3 === 0
              ? order
              : {
                  ...order,
                  ...(i % 3 === 1
                    ? { price: 12000 }
                    : { requestId: `attacker-${i}` }),
                },
        }),
      ),
    );
    expect(replies.filter((r) => r.status === 200)).toHaveLength(20);
    expect(replies.filter((r) => r.status === 409)).toHaveLength(40);
    expect(
      replies
        .filter((r) => r.status === 200)
        .every((r) => r.body.id === receipt.body.id),
    ).toBe(true);
    expect(
      (await req("/api/markets/runtime-market/account", { token: a.apiKey }))
        .body.orders,
    ).toHaveLength(1);
  });
  it("SQL and prototype payloads remain data, not executable authority", async () => {
    await create();
    expect((await join("x'); DROP TABLE market; --")).status).toBe(201);
    expect(
      (
        await req("/api/markets/runtime-market/join", {
          raw: '{"name":"Prototype attacker","__proto__":{"admin":true}}',
        })
      ).status,
    ).toBe(400);
    expect(
      (await req("/api/markets/runtime-market")).body.participantCount,
    ).toBe(1);
    expect(
      (await req("/api/admin/dashboard", { token: "runtime-test-admin-extra" }))
        .status,
    ).toBe(403);
  });
  it("MCP cannot route a participant to arbitrary admin tools or identities", async () => {
    const { a, b } = await setup();
    const client = new Client({ name: "red-team-client", version: "1" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://arena.test/mcp/runtime-market"),
      {
        requestInit: { headers: { Authorization: `Bearer ${a.apiKey}` } },
        fetch: ((url: any, init: any) => SELF.fetch(url, init)) as typeof fetch,
      },
    );
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: "rotate",
        arguments: { agentId: b.account.id },
      });
      expect(result.isError).toBe(true);
      const forged = await client.callTool({
        name: "submit_decision",
        arguments: { ...order, agentId: b.account.id },
      });
      expect(forged.isError).toBe(true);
      expect(
        (await req("/api/markets/runtime-market/account", { token: b.apiKey }))
          .body.orders,
      ).toHaveLength(0);
    } finally {
      await client.close();
    }
  });
});
describe("organizer dashboard", () => {
  it("requires organizer authentication, GET and a bounded page offset", async () => {
    expect((await req("/api/admin/dashboard")).status).toBe(401);
    expect(
      (await req("/api/admin/dashboard", { token: "invalid" })).status,
    ).toBe(403);
    expect(
      (await req("/api/admin/dashboard", { token: admin, data: {} })).status,
    ).toBe(405);
    for (const offset of ["-1", "101", "bad", "1.5"])
      expect(
        (await req(`/api/admin/dashboard?offset=${offset}`, { token: admin }))
          .status,
      ).toBe(400);
    const empty = await req("/api/admin/dashboard", { token: admin });
    expect(empty.body.markets).toEqual([]);
    expect(empty.body.nextOffset).toBeNull();
    expect(empty.headers.get("Cache-Control")).toBe("no-store");
  });
  it("counts decisions separately from fills and never leaks sealed order content or credentials", async () => {
    await create();
    const a = await join("Dashboard Agent");
    await join("Dashboard Counterparty");
    await req("/api/admin/markets/runtime-market/start", {
      token: admin,
      data: {},
    });
    await req("/api/markets/runtime-market/decision", {
      token: a.body.apiKey,
      data: {
        round: 1,
        side: "BUY",
        price: 12345,
        quantity: 2,
        requestId: "secret-decision",
        note: "sealed-note",
      },
    });
    expect(
      (await req("/api/admin/dashboard", { token: a.body.apiKey })).status,
    ).toBe(403);
    expect(
      (
        await req("/api/admin/markets/runtime-market/status", {
          token: a.body.apiKey,
        })
      ).status,
    ).toBe(403);
    const r = await req("/api/admin/markets/runtime-market/status", {
      token: admin,
    });
    expect(r.body.currentDecisions).toBe(1);
    expect(r.body.decisions).toBe(1);
    expect(r.body.trades).toBe(0);
    expect(r.body.conserved).toBe(true);
    expect(r.body.agents[0].decided).toBe(true);
    const text = JSON.stringify(r.body);
    for (const hidden of [
      a.body.apiKey,
      "keyHash",
      "seed",
      "sealed-note",
      "secret-decision",
      "12345",
      '"orders"',
    ])
      expect(text).not.toContain(hidden);
    const overview = await req("/api/admin/dashboard", { token: admin });
    expect(overview.body.markets[0]).toMatchObject({
      id: "runtime-market",
      currentDecisions: 1,
      trades: 0,
      conserved: true,
    });
  });
  it("paginates at 20 rooms and reports unreadable rooms without pretending they are empty", async () => {
    for (let i = 0; i < 21; i++)
      await req("/api/admin/markets", {
        token: admin,
        data: {
          id: `dashboard-${String(i).padStart(2, "0")}`,
          name: `Dashboard ${i}`,
          practice: true,
        },
      });
    await env.CATALOG.get(env.CATALOG.idFromName("v1")).put({
      id: "missing-room",
      name: "Missing room",
      practice: true,
    });
    const first = await req("/api/admin/dashboard", { token: admin });
    expect(first.body.markets.length + first.body.failures.length).toBe(20);
    expect(first.body.nextOffset).toBe(20);
    expect(first.body.catalogCount).toBe(22);
    expect(first.body.failures).toEqual([
      { id: "missing-room", name: "Missing room" },
    ]);
    const next = await req("/api/admin/dashboard?offset=20", { token: admin });
    expect(next.body.markets).toHaveLength(2);
    expect(next.body.nextOffset).toBeNull();
    expect(
      new Set([...first.body.markets, ...next.body.markets].map((x) => x.id))
        .size,
    ).toBe(21);
  });
});
async function req(
  path: string,
  opts: {
    token?: string;
    data?: any;
    method?: string;
    headers?: Record<string, string>;
    raw?: string;
  } = {},
) {
  const r = await SELF.fetch(`https://arena.test${path}`, {
    method:
      opts.method ||
      (opts.data !== undefined || opts.raw !== undefined ? "POST" : "GET"),
    headers: {
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.data !== undefined || opts.raw !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...opts.headers,
    },
    body:
      opts.raw ??
      (opts.data === undefined ? undefined : JSON.stringify(opts.data)),
  });
  return {
    status: r.status,
    headers: r.headers,
    body: r.status === 204 ? null : ((await r.json()) as any),
  };
}
async function create(practice = true, extra = {}) {
  const r = await req("/api/admin/markets", {
    token: admin,
    data: { id: "runtime-market", name: "Runtime market", practice, assetMode: "legacy", ...extra },
  });
  expect(r.status).toBe(201);
  return r;
}
async function join(name = "Agent One", invite?: string) {
  const r = await req("/api/markets/runtime-market/join", {
    data: {
      name,
      description: "Client controlled",
      ...(invite ? { invite } : {}),
    },
  });
  return r;
}
async function setup() {
  await create();
  const a = await join(),
    b = await join("Agent Two");
  expect(
    (
      await req("/api/admin/markets/runtime-market/start", {
        token: admin,
        data: {},
      })
    ).status,
  ).toBe(200);
  return { a: a.body, b: b.body };
}
const order = {
  round: 1,
  side: "BUY",
  price: 11000,
  quantity: 5,
  requestId: "runtime-order-1",
};
describe("HTTP authentication and validation", () => {
  it("health, API discovery and no cache", async () => {
    const h = await req("/api/health");
    expect(h.status).toBe(200);
    expect(h.body.settlement).toBe("simulation");
    expect(h.headers.get("cache-control")).toBe("no-store");
    expect(h.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await req("/api/openapi.json")).body.openapi).toBe("3.1.0");
  });
  it("cannot create or administer without organizer authority", async () => {
    expect((await req("/api/admin/markets", { data: {} })).status).toBe(401);
    expect(
      (await req("/api/admin/markets", { token: "wrong", data: {} })).status,
    ).toBe(403);
    await create();
    const a = await join();
    expect(
      (
        await req("/api/admin/markets/runtime-market/start", {
          token: a.body.apiKey,
          data: {},
        })
      ).status,
    ).toBe(403);
  });
  it("validates formal schedule and rejects unknown fields", async () => {
    expect(
      (
        await req("/api/admin/markets", {
          token: admin,
          data: {
            id: "bad-config",
            name: "Bad",
            practice: false,
            roundMs: 2000,
          },
        })
      ).status,
    ).toBe(400);
    await create();
    expect((await join("x")).status).toBe(400);
    expect(
      (
        await req("/api/markets/runtime-market/join", {
          data: { name: "Agent extra", cash: 999999999 },
        })
      ).status,
    ).toBe(400);
  });
  it("rejects wrong methods, malformed JSON, content type and huge bodies", async () => {
    await create();
    expect(
      (await req("/api/markets/runtime-market/join", { method: "GET" })).status,
    ).toBe(405);
    expect(
      (await req("/api/markets/runtime-market/join", { raw: "{" })).status,
    ).toBe(400);
    expect(
      (
        await req("/api/markets/runtime-market/join", {
          raw: "{}",
          headers: { "Content-Type": "text/plain" },
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await req("/api/markets/runtime-market/join", {
          raw: JSON.stringify({ name: "x".repeat(9000) }),
        })
      ).status,
    ).toBe(413);
  });
  it("rejects hostile browser origin for API and MCP", async () => {
    expect(
      (
        await req("/api/health", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req("/mcp/runtime-market", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await req("/api/health", { headers: { Origin: "https://arena.test" } }))
        .status,
    ).toBe(200);
  });
  it("unknown resources return JSON 404", async () => {
    expect((await req("/api/markets/missing-market")).status).toBe(404);
    expect((await req("/api/unknown")).status).toBe(404);
  });
  it("scopes credentials to the owner and the match", async () => {
    const { a, b } = await setup();
    expect((await req("/api/markets/runtime-market/account")).status).toBe(401);
    expect(
      (await req("/api/markets/runtime-market/account", { token: "fake" }))
        .status,
    ).toBe(401);
    const self = await req("/api/markets/runtime-market/account", {
      token: a.apiKey,
    });
    expect(self.body.id).toBe(a.account.id);
    expect(self.body.id).not.toBe(b.account.id);
    await req("/api/admin/markets", {
      token: admin,
      data: { id: "other-market", name: "Other", practice: true },
    });
    expect(
      (await req("/api/markets/other-market/account", { token: a.apiKey }))
        .status,
    ).toBe(401);
  });
  it("rotation invalidates old key but preserves balances and identity", async () => {
    const { a } = await setup();
    const r = await req("/api/admin/markets/runtime-market/rotate", {
      token: admin,
      data: { agentId: a.account.id },
    });
    expect(r.status).toBe(200);
    expect(
      (await req("/api/markets/runtime-market/account", { token: a.apiKey }))
        .status,
    ).toBe(401);
    const n = await req("/api/markets/runtime-market/account", {
      token: r.body.apiKey,
    });
    expect(n.body).toMatchObject({ id: a.account.id, cash: 1000000, dat: 100 });
  });
  it("never exposes another agent private orders, credentials or future path", async () => {
    const { a, b } = await setup();
    await req("/api/markets/runtime-market/decision", {
      token: a.apiKey,
      data: order,
    });
    const p = await req("/api/markets/runtime-market");
    const text = JSON.stringify(p.body);
    expect(text).not.toContain(a.apiKey);
    expect(text).not.toContain(order.requestId);
    expect(p.body.history).toEqual([10000]);
    expect(p.body.reveal).toBeNull();
    expect(
      (await req("/api/markets/runtime-market/account", { token: b.apiKey }))
        .body.orders,
    ).toHaveLength(0);
    const exp = await req("/api/admin/markets/runtime-market/export", {
      token: admin,
    });
    expect(JSON.stringify(exp.body)).not.toContain("keyHash");
    expect(exp.body.orders).toHaveLength(0);
  });
});
describe("race conditions and persistence", () => {
  it("single-use invite is atomically consumed under concurrent joins", async () => {
    await create(false);
    expect((await join()).status).toBe(403);
    const codes = (
      await req("/api/admin/markets/runtime-market/invites", {
        token: admin,
        data: { count: 1 },
      })
    ).body.codes;
    const all = await Promise.all(
      Array.from({ length: 20 }, (_, i) => join(`Racer ${i}`, codes[0])),
    );
    expect(all.filter((r) => r.status === 201)).toHaveLength(1);
    expect(all.filter((r) => r.status === 403)).toHaveLength(19);
  });
  it("failed registration rolls back invite consumption", async () => {
    await create(false);
    const codes = (
      await req("/api/admin/markets/runtime-market/invites", {
        token: admin,
        data: { count: 2 },
      })
    ).body.codes;
    expect((await join("Same Name", codes[0])).status).toBe(201);
    expect((await join("Same Name", codes[1])).status).toBe(409);
    expect((await join("New Name", codes[1])).status).toBe(201);
  });
  it("capacity is enforced under concurrent open registration", async () => {
    await create(true, { capacity: 5 });
    const all = await Promise.all(
      Array.from({ length: 20 }, (_, i) => join(`Racer ${i}`)),
    );
    expect(all.filter((r) => r.status === 201)).toHaveLength(5);
    expect(
      (await req("/api/markets/runtime-market")).body.participantCount,
    ).toBe(5);
  });
  it("20 simultaneous identical retries create one receipt", async () => {
    const { a } = await setup();
    const all = await Promise.all(
      Array.from({ length: 20 }, () =>
        req("/api/markets/runtime-market/decision", {
          token: a.apiKey,
          data: order,
        }),
      ),
    );
    expect(all.every((r) => r.status === 200)).toBe(true);
    expect(new Set(all.map((r) => r.body.id)).size).toBe(1);
    expect(
      (await req("/api/markets/runtime-market/account", { token: a.apiKey }))
        .body.orders,
    ).toHaveLength(1);
  });
  it("20 competing decisions cannot create more than one order", async () => {
    const { a } = await setup();
    const all = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        req("/api/markets/runtime-market/decision", {
          token: a.apiKey,
          data: { ...order, requestId: `different-${i}` },
        }),
      ),
    );
    expect(all.filter((r) => r.status === 200)).toHaveLength(1);
    expect(all.filter((r) => r.status === 409)).toHaveLength(19);
  });
  it("JSON cannot override authenticated agent identity", async () => {
    const { a, b } = await setup();
    expect(
      (
        await req("/api/markets/runtime-market/decision", {
          token: a.apiKey,
          data: { ...order, agentId: b.account.id },
        })
      ).status,
    ).toBe(400);
  });
  it("restores accepted orders and idempotency after object eviction", async () => {
    const { a } = await setup();
    const accepted = await req("/api/markets/runtime-market/decision", {
      token: a.apiKey,
      data: order,
    });
    const stub = env.MARKETS.get(env.MARKETS.idFromName("runtime-market"));
    await evictDurableObject(stub);
    const retry = await req("/api/markets/runtime-market/decision", {
      token: a.apiKey,
      data: order,
    });
    expect(retry.body).toEqual(accepted.body);
    expect(
      (await req("/api/markets/runtime-market/account", { token: a.apiKey }))
        .body.orders,
    ).toHaveLength(1);
  });
  it("stored alarm settles, survives eviction, and does not double-execute", async () => {
    const { a, b } = await setup();
    await req("/api/markets/runtime-market/decision", {
      token: a.apiKey,
      data: order,
    });
    await req("/api/markets/runtime-market/decision", {
      token: b.apiKey,
      data: { ...order, side: "SELL", price: 9000 },
    });
    const stub = env.MARKETS.get(env.MARKETS.idFromName("runtime-market"));
    await runInDurableObject(stub, async (_, state) => {
      await expect(state.storage.getAlarm()).resolves.not.toBeNull();
      const row = state.storage.sql
        .exec<{ state: string }>("SELECT state FROM market WHERE id=1")
        .one();
      const s = JSON.parse(row.state);
      s.openedAt = Date.now() - 60001;
      state.storage.sql.exec(
        "UPDATE market SET state=? WHERE id=1",
        JSON.stringify(s),
      );
    });
    await evictDurableObject(stub);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    let p = (await req("/api/markets/runtime-market")).body;
    expect(p.results).toHaveLength(1);
    expect(p.tradeCount).toBe(1);
    await runDurableObjectAlarm(stub);
    p = (await req("/api/markets/runtime-market")).body;
    expect(p.results).toHaveLength(1);
  });
  it("paused state survives restart and resumes without losing decisions", async () => {
    const { a } = await setup();
    await req("/api/markets/runtime-market/decision", {
      token: a.apiKey,
      data: order,
    });
    expect(
      (
        await req("/api/admin/markets/runtime-market/pause", {
          token: admin,
          data: {},
        })
      ).status,
    ).toBe(200);
    const stub = env.MARKETS.get(env.MARKETS.idFromName("runtime-market"));
    await evictDurableObject(stub);
    expect((await req("/api/markets/runtime-market")).body.status).toBe(
      "paused",
    );
    expect(
      (
        await req("/api/admin/markets/runtime-market/resume", {
          token: admin,
          data: {},
        })
      ).body.status,
    ).toBe("running");
    expect(
      (await req("/api/markets/runtime-market/account", { token: a.apiKey }))
        .body.orders,
    ).toHaveLength(1);
  });
});
describe("official MCP client compatibility", () => {
  it("initializes, lists tools, reads account, submits and retries through the same ledger", async () => {
    const { a } = await setup();
    const client = new Client({ name: "acceptance-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://arena.test/mcp/runtime-market"),
      {
        requestInit: { headers: { Authorization: `Bearer ${a.apiKey}` } },
        fetch: ((url: any, init: any) => SELF.fetch(url, init)) as typeof fetch,
      },
    );
    await client.connect(transport);
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual([
      "market_snapshot",
      "my_account",
      "submit_decision",
    ]);
    const snapshot = await client.callTool({
      name: "market_snapshot",
      arguments: {},
    });
    expect(snapshot.isError).toBe(false);
    const accepted = await client.callTool({
      name: "submit_decision",
      arguments: order,
    });
    expect(accepted.isError).toBe(false);
    const retry = await req("/api/markets/runtime-market/decision", {
      token: a.apiKey,
      data: order,
    });
    expect(retry.status).toBe(200);
    const conflict = await client.callTool({
      name: "submit_decision",
      arguments: { ...order, quantity: 1 },
    });
    expect(conflict.isError).toBe(true);
    const own = await client.callTool({ name: "my_account", arguments: {} });
    expect(JSON.parse((own.content as any)[0].text).orders).toHaveLength(1);
    await client.close();
  });
  it("MCP requires valid credentials and denies unsupported GET", async () => {
    const { a } = await setup();
    expect((await req("/mcp/runtime-market")).status).toBe(401);
    const r = await SELF.fetch("https://arena.test/mcp/runtime-market", {
      headers: { Authorization: `Bearer ${a.apiKey}` },
    });
    expect(r.status).toBe(405);
  });
});

describe('dual-asset HTTP and persisted ledger', () => {
  it('creates AI markets by default, persists both instruments, settles separately, and keeps future paths private', async () => {
    const created=await req('/api/admin/markets',{token:admin,data:{id:'dual-runtime',name:'Dual runtime',practice:true,rounds:2}});
    expect(created.status).toBe(201);
    expect(created.body.instruments.map((i:any)=>i.symbol)).toEqual(['OPENAI','ANTHROPIC']);
    const base='/api/markets/dual-runtime';
    const a=(await req(`${base}/join`,{data:{name:'Buyer'}})).body;
    const b=(await req(`${base}/join`,{data:{name:'Seller'}})).body;
    await req('/api/admin/markets/dual-runtime/start',{token:admin,data:{}});
    expect((await req(`${base}/decision`,{token:a.apiKey,data:order})).status).toBe(400);
    for(const symbol of ['OPENAI','ANTHROPIC']) {
      for(const [token,side] of [[a.apiKey,'BUY'],[b.apiKey,'SELL']]) {
        expect((await req(`${base}/decision`,{token,data:{...order,symbol,side,requestId:`${symbol}-${side}-runtime`,price:symbol==='OPENAI'?10000:12000}})).status).toBe(200);
      }
    }
    const stub=env.MARKETS.get(env.MARKETS.idFromName('dual-runtime'));
    await evictDurableObject(stub);
    const account=(await req(`${base}/account`,{token:a.apiKey})).body;
    expect(account.orders).toHaveLength(2);expect(account.availableCash).toBe(890000);
    const snapshot=(await req(base)).body;
    expect(snapshot.instruments[0].orderBook.bids).toEqual([{price:10000,quantity:5}]);
    const exported=(await req('/api/admin/markets/dual-runtime/export',{token:admin})).body;
    expect(exported.reveal).toBeNull();expect(exported.audit.assets.OPENAI.path).toBeUndefined();
    const settle=async()=>{
      await runInDurableObject(stub,(_,ctx)=>{
        const state=JSON.parse(ctx.storage.sql.exec<{state:string}>('SELECT state FROM market WHERE id=1').one().state);
        state.openedAt=Date.now()-60001;
        ctx.storage.sql.exec('UPDATE market SET state=? WHERE id=1',JSON.stringify(state));
      });
      await evictDurableObject(stub);await runDurableObjectAlarm(stub);
    };
    await settle();
    const after=(await req(base)).body;
    expect(after.tradeCount).toBe(2);
    expect(after.instruments.map((i:any)=>i.candles[0].close)).toEqual([10000,12000]);
    expect(after.instruments.every((i:any)=>i.orderBook.bids.length===0)).toBe(true);
    expect((await req(`${base}/account`,{token:a.apiKey})).body.holdings).toEqual({OPENAI:105,ANTHROPIC:105});
    await settle();await evictDurableObject(stub);
    const final=(await req(base)).body;
    expect(final.status).toBe('finished');expect(final.reveal.paths.OPENAI).toHaveLength(3);
    expect((await req(`${base}/account`,{token:a.apiKey})).body.holdings).toEqual({OPENAI:0,ANTHROPIC:0});
    expect((await req('/api/admin/markets/dual-runtime/status',{token:admin})).body.conserved).toBe(true);
  });
  it('concurrent requests across symbols cannot overspend shared cash',async()=>{
    await create(true,{assetMode:'ai'});const a=(await join()).body;await join('Second Agent');
    await req('/api/admin/markets/runtime-market/start',{token:admin,data:{}});
    const stub=env.MARKETS.get(env.MARKETS.idFromName('runtime-market'));
    await runInDurableObject(stub,(_,ctx)=>{
      const state=JSON.parse(ctx.storage.sql.exec<{state:string}>('SELECT state FROM market WHERE id=1').one().state);
      state.agents[0].cash=300000;state.treasuryCash+=700000;
      ctx.storage.sql.exec('UPDATE market SET state=? WHERE id=1',JSON.stringify(state));
    });await evictDurableObject(stub);
    const results=await Promise.all(['OPENAI','ANTHROPIC'].map(symbol=>req('/api/markets/runtime-market/decision',{token:a.apiKey,data:{...order,symbol,price:20000,quantity:10,requestId:`concurrent-${symbol}`}})));
    expect(results.map(r=>r.status).sort()).toEqual([200,400]);
    await evictDurableObject(stub);
    const account=(await req('/api/markets/runtime-market/account',{token:a.apiKey})).body;
    expect(account.orders).toHaveLength(1);expect(account.availableCash).toBe(100000);
  });
});

describe("news and system maker persistence", () => {
  it("persists funding/quotes once, blocks credential takeover, and releases news only as rounds advance", async () => {
    const id = "news-runtime",
      base = `/api/markets/${id}`;
    expect(
      (
        await req("/api/admin/markets", {
          token: admin,
          data: {
            id,
            name: "News runtime",
            practice: true,
            rounds: 3,
            newsEnabled: true,
            makerCashShare: 0.5,
          },
        })
      ).status,
    ).toBe(201);
    const a = (await req(`${base}/join`, { data: { name: "News Trader" } }))
      .body;
    expect(
      (await req(`/api/admin/markets/${id}/start`, { token: admin, data: {} }))
        .status,
    ).toBe(200);
    const first = (await req(base)).body;
    expect(first.participantCount).toBe(1);
    expect(first.leaderboard).toHaveLength(1);
    expect(first.maker.cashShare).toBe(0.5);
    expect(first.news).toEqual([]);
    expect(first.instruments[0].orderBook.bids.length).toBe(1);
    expect(
      (
        await req(`/api/admin/markets/${id}/rotate`, {
          token: admin,
          data: { agentId: first.maker.id },
        })
      ).status,
    ).toBe(400);
    const stub = env.MARKETS.get(env.MARKETS.idFromName(id));
    await evictDurableObject(stub);
    expect((await req(base)).body.maker).toEqual(first.maker);
    expect(
      await stub.command({
        action: "rotate",
        data: { agentId: first.maker.id, keyHash: "0".repeat(64) },
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      (await req(`/api/admin/markets/${id}/start`, { token: admin, data: {} }))
        .status,
    ).toBe(409);
    expect(
      (
        await req(`${base}/decision`, {
          token: a.apiKey,
          data: { ...order, symbol: "OPENAI", price: 12000, quantity: 5 },
        })
      ).status,
    ).toBe(200);
    for (let round = 1; round <= 3; round++) {
      await runInDurableObject(stub, (_, ctx) => {
        const s = JSON.parse(
          ctx.storage.sql
            .exec<{ state: string }>("SELECT state FROM market WHERE id=1")
            .one().state,
        );
        s.openedAt = Date.now() - 60001;
        ctx.storage.sql.exec(
          "UPDATE market SET state=? WHERE id=1",
          JSON.stringify(s),
        );
      });
      await evictDurableObject(stub);
      await runDurableObjectAlarm(stub);
      await evictDurableObject(stub);
      const snapshot = (await req(base)).body;
      expect(snapshot.news.every((n: any) => n.round <= snapshot.round)).toBe(
        true,
      );
      const exported = (
        await req(`/api/admin/markets/${id}/export`, { token: admin })
      ).body;
      expect(exported.agents.filter((a: any) => a.system)).toHaveLength(1);
      if (round < 3) {
        expect(exported.reveal).toBeNull();
        expect(exported.audit.assets.OPENAI.path).toBeUndefined();
      }
      expect(
        (await req(`/api/admin/markets/${id}/status`, { token: admin })).body
          .conserved,
      ).toBe(true);
    }
    const final = (await req(base)).body;
    expect(final.status).toBe("finished");
    expect(final.maker.volume).toBe(5);
    const exported = (
      await req(`/api/admin/markets/${id}/export`, { token: admin })
    ).body;
    const ids = exported.orders.map((o: any) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      exported.events.filter((e: any) => e.type === "maker_funded"),
    ).toHaveLength(1);
  });
  it("rejects invalid cash fractions and incompatible legacy configuration", async () => {
    for (const data of [
      { makerCashShare: 0.075, newsEnabled: true },
      { makerCashShare: 0.5, newsEnabled: false },
      { assetMode: "legacy", newsEnabled: true },
    ])
      expect(
        (
          await req("/api/admin/markets", {
            token: admin,
            data: {
              id: "invalid-news",
              name: "Invalid config",
              practice: true,
              ...data,
            },
          })
        ).status,
      ).toBe(400);
  });
});


describe('organizer bulk initial balances',()=>{
 it('requires admin, persists bulk updates across eviction, covers later joins and locks after start',async()=>{
  const id='balances-runtime',base=`/api/markets/${id}`,path=`/api/admin/markets/${id}/initial-balances`;
  await req('/api/admin/markets',{token:admin,data:{id,name:'Balance debug',practice:true,newsEnabled:true,makerCashShare:.2}});
  const a=(await req(`${base}/join`,{data:{name:'Existing agent'}})).body;
  const balances={cash:123456,DAT:100,OPENAI:25,ANTHROPIC:250};
  expect((await req(path,{token:a.apiKey,data:balances})).status).toBe(403);
  expect((await req(path,{token:admin,data:{...balances,OPENAI:2.5}})).status).toBe(400);
  expect((await req(path,{token:admin,data:balances})).status).toBe(200);
  const stub=env.MARKETS.get(env.MARKETS.idFromName(id));await evictDurableObject(stub);
  expect((await req(`${base}/account`,{token:a.apiKey})).body).toMatchObject({cash:123456,holdings:{OPENAI:25,ANTHROPIC:250}});
  const b=(await req(`${base}/join`,{data:{name:'Later agent'}})).body;
  expect(b.account.cash).toBe(123456);
  const initial=(await req(base)).body;
  expect(initial.initialBalances).toEqual(balances);expect(initial.leaderboard.every((a:any)=>a.profit===0)).toBe(true);
  await req(`/api/admin/markets/${id}/start`,{token:admin,data:{}});await evictDurableObject(stub);
  const running=(await req(base)).body;
  expect(running.maker).toMatchObject({initialCash:61728,initialInventory:{OPENAI:12,ANTHROPIC:125},profit:0});
  expect((await req(path,{token:admin,data:{...balances,cash:1}})).status).toBe(409);
  expect((await req(`/api/admin/markets/${id}/status`,{token:admin})).body.conserved).toBe(true);
  expect((await req(`${base}/account`,{token:a.apiKey})).body.cash).toBe(123456);
 });
});

describe('configurable instruments over HTTP',()=>{
 const items=[{symbol:'RED',name:'红杉模拟',initialPrice:4200,icon:'🌲'},{symbol:'BLUE',name:'海洋模拟',initialPrice:12500,icon:'🌊'},{symbol:'GOLD',name:'黄金模拟',initialPrice:19900,icon:'🌟'}];
 it('updates a waiting room, survives eviction, joins with all custom stocks, and accepts custom-symbol orders',async()=>{
  const id='custom-runtime',base=`/api/markets/${id}`,manage=`/api/admin/markets/${id}`;
  await req('/api/admin/markets',{token:admin,data:{id,name:'Custom runtime',practice:true,newsEnabled:true,makerCashShare:.2}});
  const a=(await req(`${base}/join`,{data:{name:'Custom Existing'}})).body;
  expect((await req(`${manage}/instruments`,{token:a.apiKey,data:items})).status).toBe(403);
  expect((await req(`${manage}/instruments`,{token:admin,data:[items[0],items[0]]})).status).toBe(400);
  expect((await req(`${manage}/instruments`,{token:admin,data:items})).status).toBe(200);
  const stub=env.MARKETS.get(env.MARKETS.idFromName(id));await evictDurableObject(stub);
  const view=(await req(base)).body;
  expect(view.instruments.map((i:any)=>[i.symbol,i.name,i.reference,i.icon])).toEqual(items.map(i=>[i.symbol,i.name,i.initialPrice,i.icon]));
  expect((await req(`${base}/account`,{token:a.apiKey})).body.holdings).toEqual({RED:100,BLUE:100,GOLD:100});
  const b=(await req(`${base}/join`,{data:{name:'Custom Later'}})).body;
  expect(b.account.holdings).toEqual({RED:100,BLUE:100,GOLD:100});
  await req(`${manage}/start`,{token:admin,data:{}});
  expect((await req(`${manage}/instruments`,{token:admin,data:items.slice(0,1)})).status).toBe(409);
  expect((await req(`${base}/decision`,{token:a.apiKey,data:{...order,symbol:'RED',price:4500,quantity:2}})).status).toBe(200);
  expect((await req(`${base}/decision`,{token:a.apiKey,data:{...order,symbol:'OPENAI',requestId:'invalid-symbol-custom'}})).status).toBe(400);
  await evictDurableObject(stub);
  expect((await req(`${base}/account`,{token:a.apiKey})).body.orders[0].symbol).toBe('RED');
  expect((await req(`${manage}/status`,{token:admin})).body.conserved).toBe(true);
 });
 it('cannot overwrite a concurrent join during asynchronous price commitment generation',async()=>{
  const id='custom-race',base=`/api/markets/${id}`,manage=`/api/admin/markets/${id}`;
  await req('/api/admin/markets',{token:admin,data:{id,name:'Custom race',practice:true,newsEnabled:true,makerCashShare:.2}});
  const [configured,joined]=await Promise.all([req(`${manage}/instruments`,{token:admin,data:items}),req(`${base}/join`,{data:{name:'Concurrent join'}})]);
  expect(joined.status).toBe(201);expect([200,409]).toContain(configured.status);
  const account=(await req(`${base}/account`,{token:joined.body.apiKey})).body;
  expect(account.name).toBe('Concurrent join');
  if(configured.status===409)expect((await req(`${manage}/instruments`,{token:admin,data:items})).status).toBe(200);
  const view=(await req(base)).body;
  expect(view.participantCount).toBe(1);expect(view.instruments).toHaveLength(3);
  expect((await req(`${base}/account`,{token:joined.body.apiKey})).body.holdings).toEqual({RED:100,BLUE:100,GOLD:100});
 });
});
