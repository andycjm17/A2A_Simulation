import {readFile,writeFile} from 'node:fs/promises';
import {Wallet} from 'ethers';
import {identityTyped,decisionTyped} from '../worker/audit-log';
import {verifyAudit} from '../worker/audit-verify';
const base='http://127.0.0.1:8788',origin='https://test.a2asimulation.com';
const admin=(await readFile('private/admin-token.txt','utf8')).trim();
async function api(path:string,data?:unknown,token=''){const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});const j:any=await r.json();if(!r.ok)throw new Error(`${r.status} ${j.error?.code}`);return j;}
const results=[];
for(const count of [10,30,50]){
 const id=`audit-load-${count}-${Date.now()}`,path='/api/markets/'+id;
 await api('/api/admin/markets',{id,name:`Local signed load ${count}`,practice:true,capacity:count,rounds:1,roundMs:10000,auditEnabled:true},admin);
 const agents=[];
 for(let i=0;i<count;i++){
  const a=await api(path+'/join',{name:`Load ${i}`}),wallet=Wallet.createRandom(),t=identityTyped(origin,id,a.account.id);
  await api(path+'/identity',{signer:wallet.address,signature:await wallet.signTypedData(t.domain,t.types,t.message)},a.apiKey);
  agents.push({...a,wallet});
 }
 const requests=[];
 for(const [i,a] of agents.entries())for(const symbol of ['BFBT','EFET']){
  const d={round:1,symbol,side:i%2?'SELL' as const:'BUY' as const,price:10000,quantity:1,requestId:`load-${i}-${symbol}`},t=decisionTyped(origin,id,a.account.id,d);
  requests.push({apiKey:a.apiKey,body:{...d,signature:await a.wallet.signTypedData(t.domain,t.types,t.message)}});
 }
 await api('/api/admin/markets/'+id+'/start',{},admin);const begin=performance.now();
 const latencies=await Promise.all(requests.map(async r=>{const at=performance.now();const receipt=await api(path+'/decision',r.body,r.apiKey);if(!receipt.receipt)throw new Error('Missing receipt');return performance.now()-at}));
 const elapsed=performance.now()-begin;latencies.sort((a,b)=>a-b);
 await new Promise(r=>setTimeout(r,Math.max(0,10500-elapsed)));await api(path);
 const bundle=await api(path+'/audit');const result=await verifyAudit(bundle,bundle.entries[0].attestor);
 results.push({agents:count,simultaneousRequests:requests.length,accepted:latencies.length,elapsedMs:Math.round(elapsed),p95Ms:Math.round(latencies[Math.ceil(latencies.length*.95)-1]),replayVerified:result.verified});
 console.log(JSON.stringify(results.at(-1)));
}
await writeFile('reports/audit-load.json',JSON.stringify({environment:'local-workerd',results,limitation:'Bounded load points, not a measured maximum or public-network capacity.'},null,2));
