import {it,expect,afterEach} from 'vitest';
import {SELF,reset,evictDurableObject,runInDurableObject} from 'cloudflare:test';
import {env} from 'cloudflare:workers';
import {Wallet} from 'ethers';
import {identityTyped,decisionTyped,digest} from '../worker/audit-log';
import {verifyAudit} from '../worker/audit-verify';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
afterEach(async()=>reset());
const admin='runtime-test-admin',origin='https://test.a2asimulation.com';
async function req(path:string,data?:unknown,token=''){const r=await SELF.fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,body:await r.json() as any};}
async function setup(roundMs=2000){
 const market='audit-'+crypto.randomUUID().slice(0,8),base='/api/markets/'+market;
 const created=await req('/api/admin/markets',{id:market,name:'Audited test',practice:true,capacity:10,rounds:1,roundMs,auditEnabled:true,newsEnabled:true,makerCashShare:0.2},admin);expect(created.status).toBe(201);
 const agents=[];
 for(let i=0;i<2;i++){
  const joined=await req(base+'/join',{name:'Signed agent '+i});expect(joined.status).toBe(201);
  const wallet=Wallet.createRandom(),agentId=joined.body.account.id,t=identityTyped(origin,market,agentId);
  const proof={signer:wallet.address,signature:await wallet.signTypedData(t.domain,t.types,t.message)};
  const bind=await req(base+'/identity',proof,joined.body.apiKey);expect(bind.status).toBe(200);
  agents.push({wallet,agentId,token:joined.body.apiKey,proof});
 }
 return {market,base,agents};
}
it('requires a bound identity before starting and rejects fabricated binding',async()=>{
 const {market,base,agents}=await setup();
 const c=await req(base+'/join',{name:'Unbound agent'});
 expect((await req('/api/admin/markets/'+market+'/start',{},admin)).body.error.code).toBe('UNBOUND_AGENTS');
 expect((await req(base+'/identity',agents[0].proof,c.body.apiKey)).body.error.code).toBe('INVALID_SIGNATURE');
});
it('atomically signs receipts, persists through eviction, rejects tampering and independently replays full ledger',async()=>{
 const {market,base,agents}=await setup(3000);
 expect((await req('/api/admin/markets/'+market+'/start',{},admin)).status).toBe(200);
 const a=agents[0],d={round:1,symbol:'BFBT',side:'BUY' as const,price:11000,quantity:5,requestId:'signed-buy-1'};
 const t=decisionTyped(origin,market,a.agentId,d),signature=await a.wallet.signTypedData(t.domain,t.types,t.message);
 expect((await req(base+'/decision',d,a.token)).body.error.code).toBe('SIGNATURE_REQUIRED');
 expect((await req(base+'/decision',{...d,price:12000,signature},a.token)).body.error.code).toBe('INVALID_SIGNATURE');
 const response=await req(base+'/decision',{...d,signature},a.token);expect(response.status).toBe(200);expect(response.body.receipt.hash).toMatch(/^0x/);
 const receipt=response.body.receipt;
 await evictDurableObject(env.MARKETS.get(env.MARKETS.idFromName(market)));
 const retry=await req(base+'/decision',{...d,signature},a.token);expect(retry.body.receipt).toEqual(receipt);
 const b=agents[1],sell={...d,side:'SELL' as const,price:9000,requestId:'signed-sell-1'},st=decisionTyped(origin,market,b.agentId,sell);
 expect((await req(base+'/decision',{...sell,signature:await b.wallet.signTypedData(st.domain,st.types,st.message)},b.token)).status).toBe(200);
 expect((await req(base+'/identity',a.proof,a.token)).body.error.code).toBe('LOCKED');
 const pending=(await req(base+'/audit')).body;expect(pending.reveal).toBeNull();expect(JSON.stringify(pending)).not.toContain('keyHash');
 await new Promise(r=>setTimeout(r,3200));await req(base);
 const bundle=(await req(base+'/audit')).body;
 expect(bundle.state.agents.filter((a:any)=>a.system==='retail-trader')).toHaveLength(5);
 expect(bundle.state.agents.filter((a:any)=>a.system==='retail-trader').every((a:any)=>Number.isSafeInteger(a.finalUnrealizedPnl))).toBe(true);
 const result=await verifyAudit(bundle,receipt.attestor);expect(result.verified).toBe(true);expect(result.leaderboard.length).toBe(2);
 expect(bundle.entries.find((e:any)=>e.hash===receipt.hash)).toEqual(receipt);
 const tampered=structuredClone(bundle);tampered.state.agents[0].cash+=1;
 await expect(verifyAudit(tampered,receipt.attestor)).rejects.toThrow('Final ledger mismatch');
 const omitted=structuredClone(bundle);omitted.entries.splice(3,1);await expect(verifyAudit(omitted,receipt.attestor)).rejects.toThrow();
 await expect(verifyAudit(bundle,Wallet.createRandom().address)).rejects.toThrow();
 await expect(verifyAudit(bundle,receipt.attestor,digest('wrong-head'))).rejects.toThrow('head mismatch');
});
it('MCP transports the same signed order and receipt as REST',async()=>{
 const {market,base,agents}=await setup(60000);await req('/api/admin/markets/'+market+'/start',{},admin);
 const client=new Client({name:'signed-test',version:'1'});
 const transport=new StreamableHTTPClientTransport(new URL(origin+'/mcp/'+market),{requestInit:{headers:{Authorization:`Bearer ${agents[0].token}`}},fetch:SELF.fetch.bind(SELF)});
 await client.connect(transport);
 const d={round:1,symbol:'EFET',side:'PASS' as const,price:0,quantity:0,requestId:'signed-mcp-pass'};
 const t=decisionTyped(origin,market,agents[0].agentId,d),signature=await agents[0].wallet.signTypedData(t.domain,t.types,t.message);
 const result:any=await client.callTool({name:'submit_decision',arguments:{...d,signature}});expect(result.isError).toBe(false);
 const body=JSON.parse(result.content[0].text);expect(body.receipt.operation.type).toBe('decision');
 expect((await req(base+'/decision',{...d,signature},agents[0].token)).body.receipt.hash).toBe(body.receipt.hash);
 await client.close();
});
it('an audit write failure rolls back both order and receipt and allows identical retry',async()=>{
 const {market,base,agents}=await setup(60000);await req('/api/admin/markets/'+market+'/start',{},admin);
 const a=agents[0],d={round:1,symbol:'BFBT',side:'BUY' as const,price:10000,quantity:1,requestId:'atomic-audit-write'};
 const t=decisionTyped(origin,market,a.agentId,d),payload={...d,signature:await a.wallet.signTypedData(t.domain,t.types,t.message)};
 const stub=env.MARKETS.get(env.MARKETS.idFromName(market));
 const before=(await req(base+'/audit')).body;
 await runInDurableObject(stub,async(_,ctx)=>{ctx.storage.sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'injected failure'); END");});
 expect((await req(base+'/decision',payload,a.token)).status).toBe(500);
 const after=(await req(base+'/audit')).body;expect(after.entries).toEqual(before.entries);expect(after.state).toEqual(before.state);
 await runInDurableObject(stub,async(_,ctx)=>{ctx.storage.sql.exec('DROP TRIGGER fail_audit');});
 const accepted=await req(base+'/decision',payload,a.token);expect(accepted.status).toBe(200);expect(accepted.body.receipt.seq).toBe(before.entries.length+1);
});
