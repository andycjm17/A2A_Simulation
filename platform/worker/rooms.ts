import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { adminStatus } from "./admin-status";
import {
  type State,
  MarketError,
  ensure,
  createState,
  addAgent,
  authenticate,
  start,
  pause,
  resume,
  submit,
  advance,
  audit,
  publicState,
  accountState,
  settlementAt,
} from "./engine";

export const decisionSchema = z
  .object({
    symbol: z.enum(["OPENAI", "ANTHROPIC", "DAT"]).optional(),
    round: z.number().int().min(1).max(100),
    side: z.enum(["BUY", "SELL", "PASS"]),
    price: z.number().int().min(0).max(20000),
    quantity: z.number().int().min(0).max(10),
    requestId: z
      .string()
      .min(8)
      .max(100)
      .regex(/^[a-zA-Z0-9_.:-]+$/),
    note: z.string().max(500).optional(),
  })
  .strict();
export const configSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/),
    name: z.string().trim().min(2).max(80),
    rounds: z.number().int().min(1).max(100).default(30),
    roundMs: z.number().int().min(2000).max(60000).default(60000),
    capacity: z.number().int().min(2).max(100).default(50),
    practice: z.boolean().default(false),
    assetMode: z.enum(["ai", "legacy"]).default("ai"),
    newsEnabled: z.boolean().default(false),
    makerCashShare: z.number().min(0).max(0.5).default(0),
  })
  .strict()
  .refine((c) => c.practice || (c.rounds === 30 && c.roundMs === 60000), {
    message: "正式比赛固定 30 轮，每轮 60 秒",
  });
const joinSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(2).max(40),
    description: z.string().trim().max(500).default(""),
    keyHash: z.string().length(64),
    inviteHash: z.string().length(64).optional(),
  })
  .strict();
export type Reply =
  | { ok: true; data: any }
  | { ok: false; error: { code: string; message: string; status: number } };
type Command = { action: string; data?: any; keyHash?: string };
export class MarketRoom extends DurableObject<Env> {
  private state: State | null;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Public probes can instantiate objects, but must not create persistent application tables.
    const exists =
      ctx.storage.sql
        .exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='market'",
        )
        .toArray().length > 0;
    if (!exists) {
      this.state = null;
      return;
    }
    const row = ctx.storage.sql
      .exec<{ state: string }>("SELECT state FROM market WHERE id=1")
      .toArray()[0];
    this.state = row ? JSON.parse(row.state) : null;
    if (this.state) {
      this.initializeSchema();
      if (this.state.orders) {
        ctx.storage.transactionSync(() => this.write(this.state!, true));
      } else {
        this.state.orders = ctx.storage.sql
          .exec<{ payload: string }>("SELECT payload FROM orders ORDER BY seq")
          .toArray()
          .map((r) => JSON.parse(r.payload));
        this.state.trades = ctx.storage.sql
          .exec<{ payload: string }>("SELECT payload FROM trades ORDER BY seq")
          .toArray()
          .map((r) => JSON.parse(r.payload));
      }
    }
  }
  private initializeSchema() {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS market (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, agent_id TEXT)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, seq INTEGER UNIQUE, payload TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, seq INTEGER UNIQUE, payload TEXT NOT NULL)",
    );
  }
  private write(next: State, full = false) {
    audit(next);
    const { orders, trades, ...meta } = next;
    this.ctx.storage.sql.exec(
      "INSERT INTO market(id,state) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
      JSON.stringify(meta),
    );
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i],
        prior = this.state?.orders[i];
      if (
        full ||
        !prior ||
        o.filled !== prior.filled ||
        o.cashFlow !== prior.cashFlow ||
        o.status !== prior.status
      )
        this.ctx.storage.sql.exec(
          "INSERT INTO orders(id,seq,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
          o.id,
          i,
          JSON.stringify(o),
        );
    }
    for (
      let i = full ? 0 : this.state?.trades.length || 0;
      i < trades.length;
      i++
    ) {
      const t = trades[i];
      this.ctx.storage.sql.exec(
        "INSERT INTO trades(id,seq,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
        t.id,
        i,
        JSON.stringify(t),
      );
    }
  }
  private persist(next: State, extra?: () => void) {
    this.ctx.storage.transactionSync(() => {
      extra?.();
      this.write(next);
    });
    this.state = next;
  }
  private async schedule() {
    if (this.state?.status === "running")
      await this.ctx.storage.setAlarm(settlementAt(this.state));
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    if (!this.state) return;
    const next = structuredClone(this.state);
    if (advance(next, Date.now())) this.persist(next);
    await this.schedule();
  }
  async command(c: Command): Promise<Reply> {
    try {
      if (c.action === "create") {
        const config = configSchema.parse(c.data);
        const next = await createState(
          config,
          crypto.randomUUID() + crypto.randomUUID(),
          Date.now(),
        );
        ensure(!this.state, "EXISTS", "比赛编号已经存在", 409);
        this.initializeSchema();
        this.persist(next);
        return { ok: true, data: publicState(next, Date.now()) };
      }
      ensure(this.state, "NOT_FOUND", "找不到这场比赛", 404);
      // All dependent reads/writes below are synchronous. No external calls inside settlement.
      const now = Date.now();
      if (this.state.status !== "running" || now < settlementAt(this.state)) {
        if (c.action === "admin_status")
          return { ok: true, data: adminStatus(this.state, now) };
        if (c.action === "snapshot")
          return { ok: true, data: publicState(this.state, now) };
        if (c.action === "account")
          return {
            ok: true,
            data: accountState(
              this.state,
              authenticate(this.state, c.keyHash || ""),
            ),
          };
      }
      let s = structuredClone(this.state);
      if (advance(s, now)) {
        this.persist(s);
        await this.schedule();
        s = structuredClone(this.state!);
      }
      let data: any,
        changed = false;
      switch (c.action) {
        case "admin_status":
          data = adminStatus(s, now);
          break;
        case "snapshot":
          data = publicState(s, now);
          break;
        case "account":
          data = accountState(s, authenticate(s, c.keyHash || ""));
          break;
        case "decision": {
          const a = authenticate(s, c.keyHash || ""),
            before = s.orders.length;
          data = submit(s, a.id, decisionSchema.parse(c.data), now);
          changed = s.orders.length > before;
          break;
        }
        case "join": {
          const a = joinSchema.parse(c.data);
          const agent = addAgent(s, a, now);
          this.persist(s, () => {
            if (!s.config.practice) {
              ensure(
                a.inviteHash,
                "INVITE_REQUIRED",
                "正式比赛需要组织者的邀请码",
                403,
              );
              const invite = this.ctx.storage.sql
                .exec<{ agent_id: string | null }>(
                  "SELECT agent_id FROM invites WHERE hash=?",
                  a.inviteHash,
                )
                .toArray()[0];
              ensure(
                invite && !invite.agent_id,
                "INVALID_INVITE",
                "邀请码无效或已使用",
                403,
              );
              this.ctx.storage.sql.exec(
                "UPDATE invites SET agent_id=? WHERE hash=?",
                a.id,
                a.inviteHash,
              );
            }
          });
          data = accountState(s, agent);
          break;
        }
        case "start":
          start(s, now);
          changed = true;
          break;
        case "pause":
          pause(s, now);
          changed = true;
          break;
        case "resume":
          resume(s, now);
          changed = true;
          break;
        case "invites": {
          ensure(
            s.status === "lobby",
            "BAD_STATE",
            "只能在比赛开始前创建邀请码",
            409,
          );
          const hashes = z
            .array(z.string().length(64))
            .min(1)
            .max(100)
            .parse(c.data);
          const count = this.ctx.storage.sql
            .exec<{ n: number }>("SELECT COUNT(*) as n FROM invites")
            .one().n;
          ensure(
            count + hashes.length <= s.config.capacity * 2,
            "INVITE_LIMIT",
            "邀请码数量已达到上限",
            409,
          );
          this.ctx.storage.transactionSync(() => {
            for (const hash of hashes)
              this.ctx.storage.sql.exec(
                "INSERT INTO invites(hash) VALUES(?)",
                hash,
              );
          });
          data = { count: hashes.length };
          break;
        }
        case "rotate": {
          const p = z
            .object({ agentId: z.string(), keyHash: z.string().length(64) })
            .parse(c.data);
          const a = s.agents.find((a) => a.id === p.agentId);
          ensure(
            a && !a.system,
            "NOT_FOUND",
            "找不到可重置凭证的参赛 Agent",
            404,
          );
          a.keyHash = p.keyHash;
          changed = true;
          data = { agentId: a.id };
          break;
        }
        case "export": {
          // Organizer export excludes credentials and future prices until final settlement.
          data = {
            ...publicState(s, now),
            agents: s.agents.map(({ keyHash, ...a }) => a),
            orders: s.status === "finished" ? s.orders : [],
            // Public snapshots cap their feed at 100; audit exports must retain every fill.
            trades: s.trades,
            events: s.events,
            audit: {
              totalCash: s.totalCash,
              totalDat: s.totalDat,
              treasuryCash: s.treasuryCash,
              treasuryDat: s.treasuryDat,
              assets: s.assets
                ? Object.fromEntries(
                    Object.entries(s.assets).map(([symbol, a]) => [
                      symbol,
                      { total: a.total, treasury: a.treasury },
                    ]),
                  )
                : undefined,
            },
          };
          break;
        }
        default:
          throw new MarketError("NOT_FOUND", "未知操作", 404);
      }
      if (changed) {
        this.persist(s);
        await this.schedule();
      }
      return { ok: true, data: data ?? publicState(s, now) };
    } catch (e) {
      if (e instanceof z.ZodError)
        return {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: e.issues
              .map((x) => `${x.path.join(".")}: ${x.message}`)
              .join("; "),
            status: 400,
          },
        };
      if (e instanceof MarketError)
        return {
          ok: false,
          error: { code: e.code, message: e.message, status: e.status },
        };
      console.error(
        "market_operation_failed",
        c.action,
        e instanceof Error ? e.name : "unknown",
      );
      return {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "服务暂时不可用，请使用相同 requestId 重试",
          status: 500,
        },
      };
    }
  }
}
export class MarketCatalog extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS catalog (id TEXT PRIMARY KEY, name TEXT NOT NULL, practice INTEGER NOT NULL, created_at INTEGER NOT NULL)",
    );
  }
  list() {
    return this.ctx.storage.sql
      .exec(
        "SELECT id,name,practice,created_at AS createdAt FROM catalog ORDER BY created_at DESC LIMIT 100",
      )
      .toArray();
  }
  put(c: { id: string; name: string; practice: boolean }) {
    this.ctx.storage.sql.exec(
      "INSERT INTO catalog VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING",
      c.id,
      c.name,
      Number(c.practice),
      Date.now(),
    );
  }
}
