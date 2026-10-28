import { mkdir, writeFile } from "node:fs/promises";
import { api } from "./agent-runner.mjs";
const base = process.env.BASE_URL || "http://127.0.0.1:8787",
  admin = process.env.ADMIN_TOKEN || "local-test-admin-not-for-production";
if (
  !/^(127\.0\.0\.1|localhost)$/.test(new URL(base).hostname) &&
  process.env.ALLOW_REMOTE_LOAD !== "yes"
)
  throw new Error(
    "Remote load requires explicit ALLOW_REMOTE_LOAD=yes and a bounded scope.",
  );
const levels = (process.env.LEVELS || "10,50,100").split(",").map(Number),
  remote = !/^(127\.0\.0\.1|localhost)$/.test(new URL(base).hostname);
if (remote && (Math.max(...levels) > 100 || levels.length > 3))
  throw new Error("Remote probe bounded to <=100 participants and <=3 levels.");
const metrics = [],
  started = Date.now();
async function pool(jobs, concurrency) {
  let index = 0;
  const out = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (index < jobs.length) {
        const i = index++,
          t = performance.now();
        try {
          await jobs[i]();
          out[i] = { ms: performance.now() - t, status: 200 };
        } catch (e) {
          out[i] = {
            ms: performance.now() - t,
            status: e.status || 0,
            error: e.message,
          };
        }
      }
    }),
  );
  return out;
}
function stats(label, n, out, ms) {
  const latency = out.map((r) => r.ms).sort((a, b) => a - b),
    status = {};
  for (const r of out) status[r.status] = (status[r.status] || 0) + 1;
  return {
    label,
    participants: n,
    requests: out.length,
    durationMs: ms,
    requestsPerSecond: (out.length / ms) * 1000,
    p50Ms: latency[Math.floor(latency.length * 0.5)],
    p95Ms:
      latency[Math.min(latency.length - 1, Math.floor(latency.length * 0.95))],
    p99Ms:
      latency[Math.min(latency.length - 1, Math.floor(latency.length * 0.99))],
    status,
    errors: out.filter((x) => x.status !== 200).slice(0, 10),
  };
}
for (const n of levels) {
  const id = `load-${n}-${Date.now()}`;
  await api(base, "/api/admin/markets", {
    token: admin,
    data: {
      id,
      name: `负载验收 · ${n} Agents`,
      practice: true, assetMode: "legacy",
      capacity: n,
      roundMs: 60000,
      rounds: 1,
    },
  });
  const agents = [];
  const registration = await pool(
    Array.from({ length: n }, (_, i) => async () => {
      agents[i] = await api(base, `/api/markets/${id}/join`, {
        data: { name: `Load Agent ${i}` },
      });
    }),
    Math.min(n, 50),
  );
  if (registration.some((r) => r.status !== 200)) {
    metrics.push({
      marketId: id,
      failedAt: "registration",
      failures: registration.filter((r) => r.status !== 200),
    });
    break;
  }
  await api(base, `/api/admin/markets/${id}/start`, { token: admin, data: {} });
  const jobs = agents.map(
    (a, i) => async () =>
      api(base, `/api/markets/${id}/decision`, {
        token: a.apiKey,
        data: {
          round: 1,
          side: i % 2 ? "SELL" : "BUY",
          price: i % 2 ? 9900 : 10100,
          quantity: 5,
          requestId: `load-${i}-round1`,
        },
      }),
  );
  let t = performance.now();
  const writes = await pool(jobs, n);
  const writeStats = stats(
    "simultaneous distinct orders",
    n,
    writes,
    performance.now() - t,
  );
  console.log(JSON.stringify(writeStats));
  t = performance.now();
  const reads = await pool(
    agents.flatMap((a) => [
      () => api(base, `/api/markets/${id}/account`, { token: a.apiKey }),
      () => api(base, `/api/markets/${id}`, { token: a.apiKey }),
    ]),
    n,
  );
  const readStats = stats(
    "mixed account and public snapshot reads",
    n,
    reads,
    performance.now() - t,
  );
  console.log(JSON.stringify(readStats));
  t = performance.now();
  const retries = await pool(jobs, n);
  const retryStats = stats(
    "identical retry burst",
    n,
    retries,
    performance.now() - t,
  );
  console.log(JSON.stringify(retryStats));
  const exported = await api(base, `/api/admin/markets/${id}/export`, {
    token: admin,
  });
  await api(base, `/api/admin/markets/${id}/pause`, { token: admin, data: {} });
  const receipts = await Promise.all(
    agents.map((a) =>
      api(base, `/api/markets/${id}/account`, { token: a.apiKey }),
    ),
  );
  metrics.push({
    marketId: id,
    writeStats,
    readStats,
    retryStats,
    uniqueReceipts: receipts.reduce((sum, a) => sum + a.orders.length, 0),
    noDuplicateOrders: receipts.every((a) => a.orders.length === 1),
    cashConserved:
      exported.agents.reduce((n, a) => n + a.cash, 0) +
        exported.audit.treasuryCash ===
      exported.audit.totalCash,
    datConserved:
      exported.agents.reduce((n, a) => n + a.dat, 0) +
        exported.audit.treasuryDat ===
      exported.audit.totalDat,
  });
}
await mkdir("reports", { recursive: true });
const output = `reports/load-${remote ? "remote" : "local"}-${started}.json`;
await writeFile(
  output,
  JSON.stringify(
    {
      base,
      startedAt: new Date(started).toISOString(),
      completedAt: new Date().toISOString(),
      environment: remote
        ? "Cloudflare production bounded probe"
        : "local Wrangler/workerd on development Mac; includes client and network loopback overhead",
      note: "Short bursts, not sustained regional capacity. Application enrollment cap is distinct from infrastructure maximum. Each market independent. Paused test markets retain audit evidence.",
      metrics,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ report: output }));
if (
  metrics.some(
    (m) =>
      m.failedAt ||
      !m.noDuplicateOrders ||
      !m.cashConserved ||
      !m.datConserved ||
      m.writeStats.errors.length ||
      m.readStats.errors.length ||
      m.retryStats.errors.length,
  )
)
  process.exitCode = 1;
