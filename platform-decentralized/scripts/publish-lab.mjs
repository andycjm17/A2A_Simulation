import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
if(config.name!=='andycui-a2a-lab'||config.routes.length!==1||config.routes[0].pattern!=='test.a2asimulation.com'||config.vars.APP_ORIGIN!=='https://test.a2asimulation.com')throw new Error('Refusing unexpected deployment target');
const admin=(await readFile('private/admin-token.txt','utf8')).trim(),audit=(await readFile('private/audit-signing-key.txt','utf8')).trim();
function wrangler(args,input){const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{encoding:'utf8',input,env:{...process.env,WRANGLER_LOG_PATH:'./reports/wrangler-deploy.log'}});for(const s of [r.stdout,r.stderr])if(s)process.stdout.write(s.replaceAll(admin,'[redacted]').replaceAll(audit,'[redacted]'));if(r.status!==0)throw new Error('Wrangler command failed: '+args[0]);}
wrangler(['deploy','--dry-run']);
wrangler(['deploy']);
wrangler(['secret','bulk'],JSON.stringify({ADMIN_TOKEN:admin,AUDIT_SIGNING_KEY:audit}));
console.log('Isolated lab deployed with separate credentials.');
