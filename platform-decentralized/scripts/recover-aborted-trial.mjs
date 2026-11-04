import {writeFile} from 'node:fs/promises';
import {api} from './agent-runner.mjs';
const base='http://127.0.0.1:8787',id='acceptance-1789184090432';
const snapshot=await api(base,`/api/markets/${id}`),audit=await api(base,`/api/admin/markets/${id}/export`,{token:'local-test-admin-not-for-production'});
const report={recordedAt:new Date().toISOString(),outcome:'FAILED_CLIENT_ENDURANCE',explanation:'The original strict client stopped with fetch failed after submitting round 26 while local development configuration was being changed. The server may have finished its alarms, but absent decisions in later rounds mean this is NOT a passed 30-minute participant endurance test. Retained for audit; replaced by a fresh frozen-production 50-agent 30-minute run.',confirmedDecisions:audit.orders.length,expectedDecisions:300,snapshot,audit};
await writeFile('reports/aborted-local-30min.json',JSON.stringify(report,null,2));console.log(JSON.stringify({outcome:report.outcome,confirmedDecisions:report.confirmedDecisions,expectedDecisions:300,serverStatus:snapshot.status}));
