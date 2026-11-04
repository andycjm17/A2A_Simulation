import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export const strategies = [
  "Value buyer",
  "Value seller",
  "Momentum",
  "Contrarian",
  "Inventory balancer",
  "Patient buyer",
  "Patient seller",
  "Alternating maker",
  "Adaptive spread",
  "Random baseline",
];
export async function api(base, path, { token, data, method, retries=0, onRetry } = {}) {
 for(let attempt=0;;attempt++) { try {
  const r = await fetch(base + path, {
    method: method || (data === undefined ? "GET" : "POST"),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let j;
  try { j=JSON.parse(text); } catch { throw Object.assign(new Error(`HTTP ${r.status}: ${text.slice(0,240)}`),{status:r.status}); }
  if (!r.ok)
    throw Object.assign(
      new Error(`${r.status} ${j.error?.code}: ${j.error?.message}`),
      { status: r.status, code: j.error?.code },
    );
  return j;
 } catch(e) {
   const safeToRetry=data===undefined||path.endsWith('/decision');
   if(!safeToRetry||attempt>=retries||(e.status!==undefined&&e.status<500))throw e;
   onRetry?.({path,attempt:attempt+1,status:e.status||0,message:e.message});
   await new Promise(r=>setTimeout(r,150*(attempt+1)));
 } }
}
export function decide(s, a, index) {
  const ref = s.reference,
    prev = s.history.at(-2) || ref,
    round = s.round;
  let side,
    price,
    qty = 5;
  switch (index % 10) {
    case 0:
      side = "BUY";
      price = ref + 220;
      break;
    case 1:
      side = "SELL";
      price = ref - 220;
      break;
    case 2:
      side = ref >= prev ? "BUY" : "SELL";
      price = ref + (side === "BUY" ? 350 : -350);
      break;
    case 3:
      side = ref >= prev ? "SELL" : "BUY";
      price = ref + (side === "BUY" ? 180 : -180);
      break;
    case 4:
      side = a.dat < 100 ? "BUY" : "SELL";
      price = ref + (side === "BUY" ? 250 : -250);
      break;
    case 5:
      side = "BUY";
      price = ref - 100;
      break;
    case 6:
      side = "SELL";
      price = ref + 100;
      break;
    case 7:
      side = round % 2 ? "BUY" : "SELL";
      price = ref + (side === "BUY" ? 300 : -300);
      break;
    case 8:
      side = a.dat > 95 ? "SELL" : "BUY";
      price = ref + (side === "BUY" ? 100 : -100);
      qty = 3;
      break;
    default:
      side = (round * 7 + index) % 3 ? "BUY" : "SELL";
      price = ref + (((round * 137) % 801) - 400);
  }
  price = Math.min(20000, Math.max(100, price));
  qty = Math.min(
    qty,
    side === "BUY" ? Math.floor(a.availableCash / price) : a.availableDat,
  );
  if (qty <= 0) {
    side = "PASS";
    price = 0;
    qty = 0;
  }
  return {
    round,
    side,
    price,
    quantity: qty,
    requestId: `r${round}-agent-${index}-v1`,
    note: strategies[index % 10],
  };
}
async function run() {
  const base = process.env.BASE_URL || "http://127.0.0.1:8787",
    admin = process.env.ADMIN_TOKEN || "local-test-admin-not-for-production";
  if (
    !new URL(base).hostname.match(/^(127\.0\.0\.1|localhost)$/) &&
    !process.env.ADMIN_TOKEN
  )
    throw new Error("Remote runs require explicit ADMIN_TOKEN");
  const roundMs = Number(process.env.ROUND_MS || 60000),
    rounds = Number(process.env.ROUNDS || 30),
    count = Number(process.env.AGENTS || 10),
    id = `acceptance-${Date.now()}`;
  const started = Date.now(),
    agents = [],
    observations = [],
    errors = [], recoveries=[];
  const call=(path,options={})=>api(base,path,{...options,retries:3,onRetry:event=>recoveries.push(event)});
  await call("/api/admin/markets", {
    token: admin,
    data: {
      id,
      name: `验收测试 · ${count} Agents · ${rounds} 轮`,
      practice: true, assetMode: "legacy",
      roundMs,
      rounds,
      capacity: Math.max(50, count),
    },
  });
  for (let i = 0; i < count; i++)
    agents.push(
      await call(`/api/markets/${id}/join`, {
        data: {
          name: `${String(i + 1).padStart(2, "0")} ${strategies[i % 10]}`,
          description:
            "Automated acceptance-test strategy; not a platform-hosted AI model.",
        },
      }),
    );
  await call(`/api/admin/markets/${id}/start`, { token: admin, data: {} });
  console.log(
    JSON.stringify({
      event: "started",
      id,
      base,
      agents: count,
      rounds,
      roundMs,
    }),
  );
  let last = 0,
    s;
  while (true) {
    s = await call(`/api/markets/${id}`);
    if (s.status === "finished") break;
    if (s.status === "paused")
      throw new Error(`Scheduler paused: ${s.pauseReason}`);
    if (s.round !== last) {
      const result = await Promise.allSettled(
        agents.map(async (agent, i) => {
          const a = await call(`/api/markets/${id}/account`, {
            token: agent.apiKey,
          });
          const d = decide(s, a, i);
          return call(`/api/markets/${id}/decision`, {
            token: agent.apiKey,
            data: d,
          });
        }),
      );
      const rejected = result
        .filter((r) => r.status === "rejected")
        .map((r) => String(r.reason));
      errors.push(...rejected);
      observations.push({
        round: s.round,
        at: Date.now(),
        accepted: count - rejected.length,
        rejected,
      });
      last = s.round;
      console.log(
        JSON.stringify({
          event: "round",
          round: last,
          accepted: count - rejected.length,
          elapsedSeconds: Math.round((Date.now() - started) / 1000),
        }),
      );
    }
    await new Promise((r) =>
      setTimeout(
        r,
        Math.min(2000, Math.max(50, s.settlesAt - Date.now() + 80)),
      ),
    );
  }
  const audit = await call(`/api/admin/markets/${id}/export`, {
    token: admin,
  });
  const commitmentVerified =
    createHash("sha256").update(JSON.stringify(s.reveal)).digest("hex") ===
    s.commitment;
  const report = {
    test: "real HTTP participant agents, server-side clock and alarms",
    base,
    marketId: id,
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    elapsedSeconds: (Date.now() - started) / 1000,
    roundMs,
    rounds,
    agents: count,
    observations,
    errors,
    retries:recoveries,
    commitmentVerified,
    summary: s,
    audit,
  };
  await mkdir("reports", { recursive: true });
  const output = `reports/run-${id}.json`;
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      event: "complete",
      output,
      elapsedSeconds: report.elapsedSeconds,
      trades: s.tradeCount,
      rounds: s.results.length,
      commitmentVerified,
      errors: errors.length,
      retries:recoveries.length,
    }),
  );
  if (
    errors.length ||
    !commitmentVerified ||
    s.results.length !== rounds ||
    s.leaderboard.some((a) => a.decisions !== rounds)
  )
    process.exitCode = 1;
}
if (process.argv[1]?.endsWith("agent-runner.mjs"))
  run().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
