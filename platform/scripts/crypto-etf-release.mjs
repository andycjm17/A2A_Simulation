// Bounded verification against this project's production API. Never prints credentials.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const base = 'https://a2a.andycui.com';
const admin = (await readFile('private/admin-token.txt', 'utf8')).trim();
async function api(path, token, data) {
  const r = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const body = await r.json();
  if (!r.ok) throw new Error(`API ${r.status}: ${body.error?.code}`);
  return body;
}
const oldId = 'browser-mobile-1789189053494';
const historical = await api(`/api/markets/${oldId}`);
const before = { config: historical.config, commitment: historical.commitment, status: historical.status, round: historical.round, leaderboard: historical.leaderboard };
await api('/api/admin/dashboard', admin);
const id = `crypto-etf-check-${Date.now()}`;
const created = await api('/api/admin/markets', admin, { id, name: 'Crypto ETF 验收', practice: true, rounds: 1, roundMs: 10000 });
const expected = ['BFBT', 'EFET'];
assert.deepEqual(created.instruments.map(i => i.symbol), expected);
assert.deepEqual(created.config.instruments.map(i => i.symbol), expected);
assert.deepEqual(created.instruments.map(i => i.icon), ['₿', 'Ξ']);
assert.ok(created.instruments.every(i => i.name.includes('ETF（模拟）')));
const agents = [];
for (const name of ['ETF Buyer', 'ETF Seller']) agents.push(await api(`/api/markets/${id}/join`, '', { name }));
assert.deepEqual(agents[0].account.holdings, { BFBT: 100, EFET: 100 });
await api(`/api/admin/markets/${id}/start`, admin, {});
for (const symbol of expected) for (const [index, a] of agents.entries()) await api(`/api/markets/${id}/decision`, a.apiKey, { round: 1, symbol, side: index ? 'SELL' : 'BUY', price: 10000, quantity: 1, requestId: `check-${symbol}-${index}` });
await new Promise(r => setTimeout(r, 11000));
const done = await api(`/api/markets/${id}`);
assert.equal(done.status, 'finished'); assert.equal(done.tradeCount, 2);
assert.deepEqual(Object.keys(done.reveal.paths), expected);
assert.equal((await api(`/api/admin/markets/${id}/status`, admin)).conserved, true);
const old = await api(`/api/markets/${oldId}`);
assert.deepEqual({ config: old.config, commitment: old.commitment, status: old.status, round: old.round, leaderboard: old.leaderboard }, before);
const demoId = 'crypto-etf-demo-20261030';
const existing = await fetch(`${base}/api/markets/${demoId}`);
let demo;
if (existing.status === 404) demo = await api('/api/admin/markets', admin, { id: demoId, name: 'Crypto ETF 模拟交易', practice: true, newsEnabled: true, makerCashShare: 0.2 });
else { assert.equal(existing.status, 200); demo = await existing.json(); }
assert.equal(demo.status, 'lobby'); assert.deepEqual(demo.instruments.map(i => i.symbol), expected);
const report = { verifiedAt: new Date().toISOString(), base, smokeMarket: id, status: done.status, trades: done.tradeCount, instruments: demo.instruments.map(({ symbol, name, icon, reference }) => ({ symbol, name, icon, reference })), demoId, demoUrl: `${base}/?market=${demoId}`, historicalMatchUnchanged: true, conserved: true };
await writeFile('reports/crypto-etf-production.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
