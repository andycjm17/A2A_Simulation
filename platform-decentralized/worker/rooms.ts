import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { adminStatus } from "./admin-status";
import { checkSignature, decisionTyped, identityTyped, makeEntry, ledger, type LogEntry, type LogOperation } from './audit-log';
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
  setInitialBalances,
  retainHoldings,
  reconfigureInstruments,
} from "./engine";

export const decisionSchema = z
  .object({
    symbol: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,15}$/)
      .optional(),
    round: z.number().int().min(1).max(240),
    side: z.enum(["BUY", "SELL", "PASS"]),
    price: z.number().int().min(0).max(20000),
    quantity: z.number().int().min(0).max(10),
    requestId: z
      .string()
      .min(8)
      .max(100)
      .regex(/^[a-zA-Z0-9_.:-]+$/),
    note: z.string().max(500).optional(),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).optional(),
  })
  .strict();
export const initialBalancesSchema = z
  .object({ cash: z.number().int().min(0).max(1_000_000_000) })
  .catchall(z.number().int().min(0).max(100_000))
  .refine(
    (b) =>
      Object.keys(b).length <= 32 &&
      Object.keys(b).every(
        (k) => k === "cash" || /^[A-Z][A-Z0-9_]{0,15}$/.test(k),
      ),
    { message: "初始库存须使用有效的标的代码" },
  );
export const instrumentsSchema = z
  .array(
    z
      .object({
        symbol: z.string().regex(/^[A-Z][A-Z0-9_]{0,15}$/),
        name: z.string().trim().min(1).max(40),
        initialPrice: z.number().int().min(100).max(20000),
        icon: z.string().min(1).max(512),
      })
      .strict(),
  )
  .min(1)
  .max(8);
export const configSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/),
    name: z.string().trim().min(2).max(80),
    rounds: z.number().int().min(1).max(240).default(240),
    roundMs: z.number().int().min(2000).max(60000).default(5000),
    capacity: z.number().int().min(2).max(100).default(50),
    practice: z.boolean().default(false),
    assetMode: z.enum(["ai", "legacy"]).default("ai"),
    newsEnabled: z.boolean().default(false),
    retailAgents: z.boolean().default(true),
    autoRedeem: z.literal(false).default(false),
    makerCashShare: z.number().min(0).max(0.5).default(0),
    initialBalances: initialBalancesSchema.optional(),
    instruments: instrumentsSchema.optional(),
    auditEnabled: z.boolean().default(false),
  })
  .strict()
  .refine((c) => c.practice || (c.rounds === 240 && c.roundMs === 5000 && c.retailAgents), {
    message: "正式比赛固定 240 轮，每轮 5 秒，并启用五名模拟散户",
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
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS audit_log (seq INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS identities (agent_id TEXT PRIMARY KEY, signer TEXT NOT NULL UNIQUE)');
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
  private entries() {
    return this.ctx.storage.sql.exec<{payload:string}>('SELECT payload FROM audit_log ORDER BY seq').toArray().map(r=>JSON.parse(r.payload) as LogEntry);
  }
  private persist(next: State, extra?: () => void, operation: LogOperation = {type:'advance'}, at=Date.now()) {
    let entry:LogEntry | undefined;
    if (next.config.auditEnabled) {
      ensure(this.env.AUDIT_SIGNING_KEY,'AUDIT_NOT_CONFIGURED','审计签名尚未配置',503);
      const row=this.ctx.storage.sql.exec<{payload:string}>('SELECT payload FROM audit_log ORDER BY seq DESC LIMIT 1').toArray()[0];
      entry=makeEntry(next,this.env.APP_ORIGIN,this.env.AUDIT_SIGNING_KEY,row ? JSON.parse(row.payload):undefined,operation,at);
    }
    this.ctx.storage.transactionSync(() => {
      extra?.();
      this.write(next);
      if(entry) this.ctx.storage.sql.exec('INSERT INTO audit_log VALUES(?,?)',entry.seq,JSON.stringify(entry));
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
    const now=Date.now();
    if (advance(next, now)) this.persist(next,undefined,{type:'advance'},now);
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
        this.persist(next,undefined,{type:'create',data:{config,createdAt:next.createdAt,commitment:next.commitment}},next.createdAt);
        return { ok: true, data: publicState(next, Date.now()) };
      }
      ensure(this.state, "NOT_FOUND", "找不到这场比赛", 404);
      // All dependent reads/writes below are synchronous. No external calls inside settlement.
      const now = Date.now();
      if(c.action==='audit') return {ok:true,data:{version:1,origin:this.env.APP_ORIGIN,
        enabled:!!this.state.config.auditEnabled,entries:this.entries(),state:ledger(this.state),
        reveal:this.state.status==='finished'?{seed:this.state.seed}:null,
        anchoring:'not-anchored',notice:'签名日志可复算；公开测试网锚定待部署。'}};
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
        this.persist(s,undefined,{type:'advance'},now);
        await this.schedule();
        s = structuredClone(this.state!);
      }
      let data: any,
        changed = false;
      let operation:LogOperation={type:c.action};
      switch (c.action) {
        case 'identity': {
          ensure(s.config.auditEnabled,'AUDIT_DISABLED','本场未启用签名审计',409);
          ensure(s.status==='lobby','LOCKED','身份在开赛后锁定',409);
          const a=authenticate(s,c.keyHash||'');
          const p=z.object({signer:z.string().regex(/^0x[0-9a-fA-F]{40}$/),signature:z.string().regex(/^0x[0-9a-fA-F]{130}$/)}).strict().parse(c.data);
          checkSignature(identityTyped(this.env.APP_ORIGIN,s.config.id,a.id),p.signature,p.signer);
          const existing=this.ctx.storage.sql.exec<{signer:string}>('SELECT signer FROM identities WHERE agent_id=?',a.id).toArray()[0];
          ensure(!existing || existing.signer.toLowerCase()===p.signer.toLowerCase(),'IDENTITY_LOCKED','身份绑定后不可替换',409);
          const used=this.ctx.storage.sql.exec('SELECT agent_id FROM identities WHERE signer=?',p.signer.toLowerCase()).toArray();
          ensure(existing || !used.length,'SIGNER_USED','同一签名地址不能注册多个 Agent',409);
          if(!existing) this.persist(s,()=>this.ctx.storage.sql.exec('INSERT INTO identities VALUES(?,?)',a.id,p.signer.toLowerCase()),{type:'identity',data:{agentId:a.id,...p}},now);
          data={agentId:a.id,signer:p.signer};
          break;
        }
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
          const {signature,...d}=decisionSchema.parse(c.data);
          if(s.config.auditEnabled) {
            const identity=this.ctx.storage.sql.exec<{signer:string}>('SELECT signer FROM identities WHERE agent_id=?',a.id).toArray()[0];
            ensure(identity && signature,'SIGNATURE_REQUIRED','需要已绑定 Agent 的本地订单签名',401);
            checkSignature(decisionTyped(this.env.APP_ORIGIN,s.config.id,a.id,d),signature,identity.signer);
          }
          data = submit(s, a.id, d, now);
          operation={type:'decision',data:{agentId:a.id,decision:d,signature}};
          changed = s.orders.length > before;
          break;
        }
        case "join": {
          const a = joinSchema.parse(c.data);
          const agent = addAgent(s, a, now);
          this.persist(s, undefined, {type:'join',data:{id:a.id,name:a.name,description:a.description}},now);
          data = accountState(s, agent);
          break;
        }
        case "start":
          if(s.config.auditEnabled) ensure(this.ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM identities').one().n===s.agents.filter(a=>!a.system).length,'UNBOUND_AGENTS','所有参赛 Agent 必须先绑定签名身份',409);
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
        case "retain-holdings":
          changed = retainHoldings(s, now);
          data = publicState(s, now);
          break;
        case "instruments": {
          const before = this.state;
          await reconfigureInstruments(s, instrumentsSchema.parse(c.data), now);
          ensure(
            this.state === before,
            "STATE_CHANGED",
            "比赛状态已变化，请重新读取后再保存标的",
            409,
          );
          changed = true;
          operation.data=c.data;
          data = publicState(s, now);
          break;
        }
        case "initial-balances": {
          setInitialBalances(s, initialBalancesSchema.parse(c.data), now);
          changed = true;
          operation.data=c.data;
          data = publicState(s, now);
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
        this.persist(s,undefined,operation,now);
        await this.schedule();
      }
      if(c.action==='decision' && s.config.auditEnabled) {
        const receipt=this.entries().find(e=>e.operation.type==='decision' && e.operation.data.agentId===data.agentId && e.operation.data.decision.requestId===data.requestId);
        data={...data,receipt};
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
