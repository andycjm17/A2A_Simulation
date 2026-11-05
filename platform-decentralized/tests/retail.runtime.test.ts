import { it, expect, afterEach } from "vitest";
import {
  SELF,
  reset,
  evictDurableObject,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { configSchema, decisionSchema } from "../worker/rooms";
import {
  createState,
  addAgent,
  start,
  clearRound,
  settlementAt,
  DEFAULT_INSTRUMENTS,
} from "../worker/engine";
afterEach(async () => reset());
const admin = "runtime-test-admin";
async function request(path: string, data?: unknown, token = "") {
  const r = await SELF.fetch("https://arena.test" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: r.status, body: (await r.json()) as any };
}
it("defaults to 240 × 5s and validates configurable schedules, defaults five traders, and accepts late-round decisions", () => {
  const base = { id: "new-formal", name: "New formal" };
  expect(configSchema.parse(base)).toMatchObject({
    rounds: 240,
    roundMs: 5000,
    retailAgents: true,
  });
  for (const extra of [
    { rounds: 0 },
    { roundMs: 2500 },
    { retailAgents: false },
    { rounds: 7201 },
  ])
    expect(configSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  expect(
    configSchema.safeParse({
      ...base,
      practice: true,
      rounds: 30,
      roundMs: 60000,
      retailAgents: false,
    }).success,
  ).toBe(true);
  expect(
    decisionSchema.safeParse({
      round: 240,
      symbol: "BFBT",
      side: "PASS",
      price: 0,
      quantity: 0,
      requestId: "late-round",
    }).success,
  ).toBe(true);
  expect(
    decisionSchema.safeParse({
      round: 7201,
      side: "PASS",
      price: 0,
      quantity: 0,
      requestId: "invalid-round",
    }).success,
  ).toBe(false);
});
it("funds bots once, persists book and cost basis across eviction, and rolls back failed start", async () => {
  const id = "retail-persistence",
    base = `/api/markets/${id}`;
  const created = await request(
    "/api/admin/markets",
    { id, name: "Retail persistence", practice: true },
    admin,
  );
  expect(created.status).toBe(201);
  const joined = await request(base + "/join", { name: "Only participant" });
  expect(joined.status).toBe(201);
  const stub = env.MARKETS.get(env.MARKETS.idFromName(id));
  await runInDurableObject(stub, (_, ctx) => {
    ctx.storage.sql.exec(
      "CREATE TRIGGER fail_retail BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'retail start failure'); END",
    );
  });
  expect(
    (await request(`/api/admin/markets/${id}/start`, {}, admin)).status,
  ).toBe(500);
  expect((await request(base)).body.retailTraders).toEqual([]);
  await evictDurableObject(stub);
  expect((await request(base)).body.status).toBe("lobby");
  await runInDurableObject(stub, (_, ctx) => {
    ctx.storage.sql.exec("DROP TRIGGER fail_retail");
  });
  expect(
    (await request(`/api/admin/markets/${id}/start`, {}, admin)).status,
  ).toBe(200);
  const before = (await request(base)).body;
  expect(before.retailTraders).toHaveLength(5);
  expect(before.retailTraders.every((a: any) => a.decisionHorizon === "indefinite")).toBe(true);
  expect(before.participantCount).toBe(1);
  expect(before.deadline - before.openedAt).toBe(4500);
  await evictDurableObject(stub);
  expect((await request(base)).body.retailTraders).toEqual(
    before.retailTraders,
  );
  expect(
    (await request(`/api/admin/markets/${id}/start`, {}, admin)).status,
  ).toBe(409);
  // Alarm advances one boundary; replaying it immediately cannot fund or order twice.
  await runInDurableObject(stub, (_, ctx) => {
    const row = ctx.storage.sql
      .exec<{ state: string }>("SELECT state FROM market WHERE id=1")
      .one();
    const s = JSON.parse(row.state);
    s.openedAt = Date.now() - 5001;
    ctx.storage.sql.exec(
      "UPDATE market SET state=? WHERE id=1",
      JSON.stringify(s),
    );
  });
  await evictDurableObject(stub);
  await runDurableObjectAlarm(stub);
  const next = (await request(base)).body;
  expect(next.round).toBe(2);
  expect(next.retailTraders.every((a: any) => a.decisions === 2)).toBe(true);
  await runDurableObjectAlarm(stub);
  expect((await request(base)).body.retailTraders).toEqual(next.retailTraders);
  await evictDurableObject(stub);
  expect((await request(base)).body.retailTraders).toEqual(next.retailTraders);
});
it("accepts round 300 over HTTP and preserves final retail scores after SQL restart", async () => {
  const id = "retail-final",
    config = configSchema.parse({
      id,
      name: "Retail final",
      rounds: 300,
      practice: true,
      instruments: DEFAULT_INSTRUMENTS,
    });
  const s = await createState(config, "runtime-seed", Date.now());
  addAgent(
    s,
    {
      id: "human",
      name: "Human",
      keyHash: await (
        await import("../worker/engine")
      ).sha256("late-round-key"),
      description: "",
    },
    Date.now(),
  );
  start(s, Date.now() - 299 * 5000);
  for (let r = 1; r < 300; r++) clearRound(s, settlementAt(s));
  const stub = env.MARKETS.get(env.MARKETS.idFromName(id));
  expect((await stub.command({ action: "create", data: config })).ok).toBe(
    true,
  );
  await runInDurableObject(stub, (instance) => {
    (instance as any).persist(s);
  });
  await evictDurableObject(stub);
  const d = {
    round: 300,
    symbol: "BFBT",
    side: "PASS",
    price: 0,
    quantity: 0,
    requestId: "last-round-pass",
  };
  expect(
    (await request(`/api/markets/${id}/decision`, d, "late-round-key")).status,
  ).toBe(200);
  await runInDurableObject(stub, (_, ctx) => {
    const row = ctx.storage.sql
      .exec<{ state: string }>("SELECT state FROM market WHERE id=1")
      .one();
    const state = JSON.parse(row.state);
    state.openedAt = Date.now() - 5001;
    ctx.storage.sql.exec(
      "UPDATE market SET state=? WHERE id=1",
      JSON.stringify(state),
    );
  });
  await evictDurableObject(stub);
  await runDurableObjectAlarm(stub);
  const final = (await request(`/api/markets/${id}`)).body;
  expect(final.status).toBe("finished");
  expect(
    final.retailTraders.every((a: any) => a.scoreFrozen && a.decisions === 300),
  ).toBe(true);
  await evictDurableObject(stub);
  expect((await request(`/api/markets/${id}`)).body.retailTraders).toEqual(
    final.retailTraders,
  );
  expect(
    (await request(`/api/markets/${id}/decision`, d, "late-round-key")).status,
  ).toBe(200);
});
