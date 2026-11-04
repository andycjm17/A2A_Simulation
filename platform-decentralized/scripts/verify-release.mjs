// Read-only reconciliation of the completed endurance match after the audit-export fix.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {api} from './agent-runner.mjs';
const run=JSON.parse(await readFile('reports/run-acceptance-1789186009126.json','utf8'));
assert.equal(run.errors.length,0);assert.ok(run.elapsedSeconds>=1800);assert.equal(run.observations.length,30);assert.ok(run.observations.every(r=>r.accepted===50));
const a=await api(process.env.BASE_URL,`/api/admin/markets/${run.marketId}/export`,{token:process.env.ADMIN_TOKEN});
assert.equal(a.status,'finished');assert.equal(a.orders.length,1500);assert.equal(a.agents.length,50);assert.equal(a.trades.length,a.tradeCount);
assert.equal(new Set(a.trades.map(t=>t.id)).size,a.trades.length);assert.equal(new Set(a.orders.map(o=>`${o.agentId}:${o.round}`)).size,1500);
assert.equal(createHash('sha256').update(JSON.stringify(a.reveal)).digest('hex'),a.commitment);
const ledger=new Map(a.agents.map(x=>[x.id,{cash:1000000,dat:100}]));
for(const t of a.trades){assert.notEqual(t.buyer,t.seller);assert.ok(Number.isSafeInteger(t.price)&&Number.isSafeInteger(t.quantity));const b=ledger.get(t.buyer),s=ledger.get(t.seller);assert.ok(b&&s);b.cash-=t.price*t.quantity;b.dat+=t.quantity;s.cash+=t.price*t.quantity;s.dat-=t.quantity;assert.ok(b.cash>=0&&s.dat>=0);}
for(const x of a.agents){const expected=ledger.get(x.id);assert.equal(x.cash,expected.cash+expected.dat*a.terminalPrice);assert.equal(x.dat,0);}
assert.equal(a.agents.reduce((n,x)=>n+x.cash,0)+a.audit.treasuryCash,a.audit.totalCash);
assert.equal(a.audit.treasuryDat,a.audit.totalDat);assert.ok(a.audit.treasuryCash>=0);
assert.equal(a.results.reduce((n,x)=>n+x.trades,0),a.trades.length);
assert.equal(a.trades.reduce((n,x)=>n+x.quantity,0),a.volume);
await writeFile('reports/endurance-full-audit.json',JSON.stringify(a,null,2));
const result={verifiedAt:new Date().toISOString(),marketId:run.marketId,agents:50,rounds:30,decisions:1500,elapsedSeconds:run.elapsedSeconds,trades:a.tradeCount,volume:a.volume,retries:run.retries.length,errors:run.errors.length,commitmentVerified:true,allFillsReconciled:true,allBalancesReconstructed:true,treasuryConserved:true,maxSettlementDelayMs:Math.max(...a.results.map(r=>r.clearedAt-r.scheduledAt))};
await writeFile('reports/release-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
