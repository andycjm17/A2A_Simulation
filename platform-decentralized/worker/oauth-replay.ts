import { DurableObject } from "cloudflare:workers";

type Lease = { state: "pending" | "spent"; lease: string; expiresAt: number; spentUntil: number };

/** Strongly consistent single-use gate around the provider's KV-backed flows.
 * Each object is addressed by SHA-256(kind + credential), never a raw secret.
 */
export class OAuthReplayGuard extends DurableObject<Env> {
  async begin(ttlSeconds: number): Promise<string | null> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const current = await this.ctx.storage.get<Lease>("lease");
      if (current && current.expiresAt > now) return null;
      const lease = crypto.randomUUID();
      const record: Lease = {
        state: "pending", lease, expiresAt: now + 120_000,
        spentUntil: now + Math.min(172800, Math.max(600, ttlSeconds)) * 1000,
      };
      await this.ctx.storage.put("lease", record);
      await this.ctx.storage.setAlarm(record.expiresAt);
      return lease;
    });
  }
  async finish(lease: string): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.ctx.storage.get<Lease>("lease");
      if (!current || current.state !== "pending" || current.lease !== lease || current.expiresAt <= Date.now()) return false;
      current.state = "spent";
      current.expiresAt = current.spentUntil;
      await this.ctx.storage.put("lease", current);
      await this.ctx.storage.setAlarm(current.expiresAt);
      return true;
    });
  }
  async release(lease: string): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.ctx.storage.get<Lease>("lease");
      if (current?.state === "pending" && current.lease === lease) {
        await this.ctx.storage.deleteAll();
        await this.ctx.storage.deleteAlarm();
      }
    });
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.ctx.storage.get<Lease>("lease");
      if (!current || current.expiresAt <= Date.now()) await this.ctx.storage.deleteAll();
      else await this.ctx.storage.setAlarm(current.expiresAt);
    });
  }
}
