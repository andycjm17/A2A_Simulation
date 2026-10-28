import {it,expect,afterEach} from 'vitest';
import {env} from 'cloudflare:workers';
import {SELF,reset,runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {createState,addAgent,start,submit,clearRound} from '../worker/engine';
afterEach(async()=>{await reset();});
const config={id:'durability-check',name:'Durability',capacity:100,rounds:30,roundMs:60000,practice:true};
it('SQL write failure rolls back persistent data AND cached state, then identical retry succeeds',async()=>{
 const stub=env.MARKETS.get(env.MARKETS.idFromName(config.id));await stub.command({action:'create',data:config});
 for(let i=0;i<2;i++)await stub.command({action:'join',data:{id:`agent-${i}`,name:`Agent ${i}`,keyHash:String(i).repeat(64),description:''}});
 await stub.command({action:'start'});
 await runInDurableObject(stub,(_,state)=>{state.storage.sql.exec("CREATE TRIGGER fail_write BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'injected failure'); END");});
 const data={round:1,side:'BUY',price:10000,quantity:5,requestId:'durability-order'};
 const failed=await stub.command({action:'decision',keyHash:'0'.repeat(64),data});expect(failed.ok).toBe(false);
 let account=await stub.command({action:'account',keyHash:'0'.repeat(64)});expect(account.ok&&account.data.orders).toHaveLength(0);expect(account.ok&&account.data.cash).toBe(1000000);
 await evictDurableObject(stub);account=await stub.command({action:'account',keyHash:'0'.repeat(64)});expect(account.ok&&account.data.orders).toHaveLength(0);
 await runInDurableObject(stub,(_,state)=>{state.storage.sql.exec('DROP TRIGGER fail_write');});
 expect((await stub.command({action:'decision',keyHash:'0'.repeat(64),data})).ok).toBe(true);
});
it('normalized storage survives >2 MB of multibyte order history and cold restart',async()=>{
 const s=await createState(config,'large-history-seed',0);
 for(let i=0;i<80;i++)addAgent(s,{id:`a${i}`,name:`Agent ${i}`,description:'',keyHash:String(i).padStart(64,'0')},0);
 start(s,1000);for(let round=1;round<=30;round++){for(let i=0;i<80;i++)submit(s,`a${i}`,{round,side:i%2?'BUY':'SELL',price:10000,quantity:1,requestId:`large-${round}-${i}`,note:'中'.repeat(500)},s.openedAt+1);clearRound(s,s.openedAt+60000);}
 expect(new TextEncoder().encode(JSON.stringify(s)).length).toBeGreaterThan(2*1024*1024);
 const stub=env.MARKETS.get(env.MARKETS.idFromName(config.id));await stub.command({action:'create',data:config});
 await runInDurableObject(stub,(instance)=>{(instance as any).persist(s);});await evictDurableObject(stub);
 const result=await stub.command({action:'account',keyHash:'0'.repeat(64)});expect(result.ok&&result.data.orders).toHaveLength(30);
 const p=await stub.command({action:'snapshot'});expect(p.ok&&p.data.status).toBe('finished');expect(p.ok&&p.data.leaderboard).toHaveLength(80);
 expect(p.ok&&p.data.trades).toHaveLength(100);
 const exported=await stub.command({action:'export'});expect(exported.ok&&exported.data.trades).toHaveLength(1200);expect(exported.ok&&exported.data.tradeCount).toBe(1200);expect(exported.ok&&exported.data.orders).toHaveLength(2400);
},30000);
it('IP limit cannot be bypassed by changing the presented Bearer token',async()=>{
 let throttled=0;
 // More than two windows of allowance: robust even when the real limiter clock crosses a minute boundary during this <30-second test.
 for(let offset=0;offset<12300;offset+=50){const results=await Promise.all(Array.from({length:50},(_,i)=>SELF.fetch('https://arena.test/api/health',{headers:{Authorization:`Bearer random-${offset+i}`,'CF-Connecting-IP':'198.51.100.24'}})));for(const r of results){if(r.status===429){throttled++;expect(r.headers.get('Retry-After')).toBe('60');}else expect(r.status).toBe(200);await r.arrayBuffer();}}
 expect(throttled).toBeGreaterThan(0);
},30000);
