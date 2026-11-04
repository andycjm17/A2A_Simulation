import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const base = 'https://a2a.andycui.com', id = 'crypto-etf-demo-20261030';
const token = (await readFile('private/admin-token.txt', 'utf8')).trim();
const get = async () => { const r = await fetch(`${base}/api/markets/${id}`); assert.equal(r.status, 200); return r.json(); };
const before = await get();
assert.equal(before.status, 'lobby', 'Do not rename a started match');
assert.equal(before.participantCount, 0, 'Do not reconfigure a populated match');
assert.deepEqual(before.config.instruments.map(i => i.symbol), ['BFBT', 'EFET']);
const names = { BFBT: 'Luma ETF（模拟）', EFET: 'Vela ETF（模拟）' };
const instruments = before.config.instruments.map(i => ({ ...i, name: names[i.symbol] }));
if (JSON.stringify(instruments) !== JSON.stringify(before.config.instruments)) {
  const r = await fetch(`${base}/api/admin/markets/${id}/instruments`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(instruments) });
  assert.equal(r.status, 200); await r.arrayBuffer();
}
const after = await get();
// Saving materializes previously implicit starting balances without changing values.
assert.deepEqual(after.config, { ...before.config, instruments, initialBalances: before.initialBalances });
assert.deepEqual(after.initialBalances, before.initialBalances);
assert.equal(after.participantCount, 0); assert.equal(after.tradeCount, 0);
assert.deepEqual(after.instruments.map(i => i.name), Object.values(names));
const report = { verifiedAt: new Date().toISOString(), id, instruments: after.config.instruments, status: after.status, initialBalancesUnchanged: true, rulesUnchanged: true };
await writeFile('reports/etf-rename-production.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
