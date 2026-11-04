import {readFile,writeFile} from 'node:fs/promises';
import {Wallet} from 'ethers';
import {identityTyped,decisionTyped} from '../worker/audit-log';
import {verifyAudit} from '../worker/audit-verify';
const origin=process.env.LAB_URL||'https://test.a2asimulation.com';
if(!['https://test.a2asimulation.com','http://127.0.0.1:8788'].includes(origin))throw new Error('Lab target required');
const admin=(await readFile('private/admin-token.txt','utf8')).trim();
async function api(path:string,data?:unknown,token=''){const r=await fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});const j:any=await r.json();if(!r.ok)throw new Error(`${r.status} ${j.error?.code}`);return j;}
const id='signed-check-'+Date.now(),base='/api/markets/'+id;
await api('/api/admin/markets',{id,name:'签名审计验收',practice:true,rounds:1,roundMs:10000,capacity:2,auditEnabled:true},admin);
const signingOrigin=(await api(base+'/audit')).origin,agents=[];
for(let i=0;i<2;i++){
 const joined=await api(base+'/join',{name:`Verification agent ${i}`}),wallet=Wallet.createRandom(),agentId=joined.account.id;
 const t=identityTyped(signingOrigin,id,agentId);await api(base+'/identity',{signer:wallet.address,signature:await wallet.signTypedData(t.domain,t.types,t.message)},joined.apiKey);
 agents.push({wallet,agentId,apiKey:joined.apiKey});
}
await api('/api/admin/markets/'+id+'/start',{},admin);const receipts=[];
for(let i=0;i<2;i++)for(const symbol of ['BFBT','EFET']){
 const a=agents[i],d={round:1,symbol,side:i===0?'BUY' as const:'SELL' as const,price:i===0?11000:9000,quantity:5,requestId:`release-${i}-${symbol}`};
 const t=decisionTyped(signingOrigin,id,a.agentId,d);const response=await api(base+'/decision',{...d,signature:await a.wallet.signTypedData(t.domain,t.types,t.message)},a.apiKey);receipts.push(response.receipt);
}
for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,1000));if((await api(base)).status==='finished')break;}
const bundle=await api(base+'/audit');const verification=await verifyAudit(bundle,receipts[0].attestor);
for(const receipt of receipts)if(!bundle.entries.some((e:any)=>e.hash===receipt.hash))throw new Error('Missing accepted receipt');
await writeFile('reports/live-audit.json',JSON.stringify(bundle,null,2));await writeFile('reports/live-audit-verification.json',JSON.stringify(verification,null,2));
const demo='signed-demo-20261030';const list=await api('/api/markets');
if(!list.markets.some((m:any)=>m.id===demo))await api('/api/admin/markets',{id:demo,name:'Luma / Vela · 签名审计练习场',practice:true,rounds:30,roundMs:60000,capacity:50,auditEnabled:true,newsEnabled:true,makerCashShare:0.2},admin);
console.log(JSON.stringify({origin,smoke:id,verified:verification.verified,entries:verification.entries,demo}));
