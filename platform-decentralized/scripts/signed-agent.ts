import {readFile} from 'node:fs/promises';
import {Wallet} from 'ethers';
import {identityTyped,decisionTyped} from '../worker/audit-log';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
if(!/^https:\/\/test\.a2asimulation\.com$|^http:\/\/127\.0\.0\.1:\d+$/.test(config.origin))throw new Error('Lab origin required');
const wallet=new Wallet(config.privateKey);
async function api(path:string,data?:any){const r=await fetch(config.origin+path,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${config.apiKey}`,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});const j:any=await r.json();if(!r.ok)throw new Error(j.error?.message||r.statusText);return j;}
const base=`/api/markets/${config.market}`;
const origin=(await api(base+'/audit')).origin;
if((await api(base)).status==='lobby') {const t=identityTyped(origin,config.market,config.agentId);await api(base+'/identity',{signer:wallet.address,signature:await wallet.signTypedData(t.domain,t.types,t.message)});}
const seen=new Set<string>();
// Minimal strategy example: PASS. Replace only this decision policy with your external Agent.
for(;;){
 const s=await api(base);if(s.status==='finished')break;
 if(s.status==='running')for(const instrument of s.instruments){
  const requestId=`pass:${s.round}:${instrument.symbol}`;if(seen.has(requestId))continue;
  const d={round:s.round,symbol:instrument.symbol,side:'PASS' as const,price:0,quantity:0,requestId};
  const t=decisionTyped(origin,config.market,config.agentId,d);
  const r=await api(base+'/decision',{...d,signature:await wallet.signTypedData(t.domain,t.types,t.message)});
  seen.add(requestId);console.log(JSON.stringify({requestId,receipt:r.receipt?.hash}));
 }
 await new Promise(r=>setTimeout(r,1000));
}
