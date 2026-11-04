import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createGateway} from './chain-gateway.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import ganache from 'ganache';
import {Wallet,BrowserProvider,ContractFactory,encodeBytes32String,id,AbiCoder,keccak256,SigningKey} from 'ethers';
import {orderTypes,sessionTypes,chainDomain,matchIndependent,snapshot} from './chain-lib.mjs';
const artifact=JSON.parse(await readFile('artifacts/Competition.json','utf8'));
const anchorArtifact=JSON.parse(await readFile('artifacts/AuditAnchor.json','utf8'));
const wallets=Array.from({length:66},()=>Wallet.createRandom());
const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:31337,hardfork:'shanghai'},miner:{blockGasLimit:30000000},wallet:{accounts:wallets.map(w=>({secretKey:w.privateKey,balance:'0x3635c9adc5dea00000'}))}});
const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});
const sender=await provider.getSigner(wallets[64].address),backup=await provider.getSigner(wallets[65].address);
const checks=[],gas=[],started=Date.now();let relay;
const check=(name)=>{checks.push({name,passed:true});console.log('PASS '+name)};
const rejects=async(name,fn)=>{await assert.rejects(fn);check(name)};
const now=async()=>Number((await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]})).timestamp);
const at=async(t)=>{await rpc.request({method:'evm_setTime',params:[t*1000]});await rpc.request({method:'evm_mine',params:[]})};
async function deploy(n=10,rounds=30,assets=2,initialCash=1000000,initialQuantity=100){
 const startAt=await now()+20;
 const c=await new ContractFactory(artifact.abi,artifact.bytecode,sender).deploy(wallets.slice(0,n).map(w=>w.address),Array.from({length:assets},(_,i)=>encodeBytes32String(['BFBT','EFET'][i]||'ASSET'+i)),Array(assets).fill(10000),[startAt,60,rounds,initialCash,initialQuantity]);
 await c.waitForDeployment();return {c,startAt,domain:chainDomain(31337,await c.getAddress())};
}
function order(w,round,asset,side,price=10000,quantity=5,epoch=0){return {owner:w.address,round,asset,side,price:side?price:0,quantity:side?quantity:0,nonce:id(`${w.address}:${round}:${asset}:${side}:${epoch}`),epoch}}
const sign=(w,d,o)=>w.signTypedData(d,orderTypes,o);
try {
 const {c,startAt,domain}=await deploy();
 const original=order(wallets[0],1,0,1),sig=await sign(wallets[0],domain,original);
 await rejects('拒绝提前结算',()=>c.settle.staticCall());
 await rejects('拒绝提前下单',()=>c.submit.staticCall(original,sig));
 await at(startAt);
 await rejects('拒绝被篡改的签名订单',()=>c.submit.staticCall({...original,price:10100},sig));
 await rejects('拒绝跨链重放',async()=>c.submit.staticCall(original,await sign(wallets[0],{...domain,chainId:84532},original)));
 const other=await deploy(2,1);
 await rejects('拒绝跨合约重放',()=>other.c.submit.staticCall(original,sig));
 await at(startAt);
 const wrong=order(wallets[11],1,0,1);
 await rejects('拒绝未报名地址',async()=>c.submit.staticCall(wrong,await sign(wallets[11],domain,wrong)));
 const tooBig={...original,quantity:11};await rejects('拒绝超限数量',async()=>c.submit.staticCall(tooBig,await sign(wallets[0],domain,tooBig)));
 const badPass={...original,side:0};await rejects('拒绝带价格的 PASS',async()=>c.submit.staticCall(badPass,await sign(wallets[0],domain,badPass)));
 const session=Wallet.createRandom();
 const grant={owner:wallets[0].address,key:session.address,expires:startAt+1800,epoch:1};
 await (await c.authorizeSession(grant.owner,grant.key,grant.expires,grant.epoch,await wallets[0].signTypedData(domain,sessionTypes,grant))).wait();
 await rejects('拒绝旧授权 epoch',()=>c.submit.staticCall(original,sig));
 const so=order(wallets[0],1,0,1,10000,5,1);
 await c.submit.staticCall(so,await sign(session,domain,so));check('接受限定比赛的会话密钥签名');
 const revoke={...grant,key:'0x0000000000000000000000000000000000000000',epoch:2};
 await (await c.authorizeSession(revoke.owner,revoke.key,revoke.expires,revoke.epoch,await wallets[0].signTypedData(domain,sessionTypes,revoke))).wait();
 await rejects('撤销会话密钥后拒绝下单',async()=>{const o={...so,epoch:2};return c.submit.staticCall(o,await sign(session,domain,o))});
 await rejects('拒绝会话授权重放',async()=>c.authorizeSession.staticCall(grant.owner,grant.key,grant.expires,grant.epoch,await wallets[0].signTypedData(domain,sessionTypes,grant)));
 const server=await createGateway(c,0);relay=server;
 const relayURL=`http://127.0.0.1:${server.address().port}/api/chain/submit`;
 const mcp=new Client({name:'chain-test',version:'1'});
 await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
 const snap=await mcp.callTool({name:'market_snapshot',arguments:{}});assert.equal(snap.isError,undefined);check('链上 MCP 使用官方客户端读取合约');
 await mcp.close();
 const accounts=new Map(wallets.slice(0,10).map(w=>[w.address.toLowerCase(),{cash:1000000,holdings:[100,100]}]));
 const rulesHash=await c.rulesHash();let trades=0;
 const policies=Array.from({length:10},(_,i)=>`deterministic-parameterized-agent-${i}`);
 for(let round=1;round<=30;round++){
  await at(startAt+(round-1)*60);const orders=[];
  for(let i=0;i<10;i++)for(let asset=0;asset<2;asset++){
   const state=accounts.get(wallets[i].address.toLowerCase());
   let side=(i+round+asset)%3===0?0:(i+round+asset)%2===0?1:2;
   const price=9700+((i*137+round*59+asset*97)%601),quantity=1+((i+round)%5);
   if(side===2&&state.holdings[asset]<quantity)side=0;
   const o=order(wallets[i],round,asset,side,price,quantity,i===0?2:0),signature=await sign(wallets[i],domain,o);
   if(round===1&&i===0&&asset===0){const response=await fetch(relayURL,{method:'POST',body:JSON.stringify({order:o,signature})});assert.equal(response.status,200);
    // Shut down the actual HTTP relay, not just a flag in the test.
    await new Promise(r=>server.close(r));relay=null;
    await assert.rejects(()=>fetch(relayURL,{method:'POST',body:'{}'}));check('主 HTTP 中继关闭后不可用');
   }else {await (await c.connect(backup).submit(o,signature)).wait();}
   orders.push(o);
   if(round===1&&i===0&&asset===0){
    const count=await c.orderCount();await(await c.connect(backup).submit(o,signature)).wait();assert.equal(await c.orderCount(),count);check('相同签名订单重试不重复入账');
    const conflict={...o,side:1,price:12000,quantity:1};await rejects('拒绝 nonce 冲突',async()=>c.submit.staticCall(conflict,await sign(wallets[0],domain,conflict)));
    const duplicate={...o,nonce:id('different-nonce')};await rejects('同轮同资产只能提交一次',async()=>c.submit.staticCall(duplicate,await sign(wallets[0],domain,duplicate)));
   }
  }
  const expectedTrades=matchIndependent(accounts,orders,2,rulesHash,round);trades+=expectedTrades.length;
  await at(startAt+round*60-5);
  if(round===1){const late=order(wallets[1],1,1,0);await rejects('拒绝截止后的新订单',async()=>c.submit.staticCall({...late,nonce:id('late')},await sign(wallets[1],domain,{...late,nonce:id('late')})));}
  await at(startAt+round*60);
  const receipt=await(await c.connect(backup).settle()).wait();gas.push(Number(receipt.gasUsed));
  const actualTrades=receipt.logs.map(l=>{try{return c.interface.parseLog(l)}catch{return null}}).filter(l=>l?.name==='Trade');
  assert.equal(actualTrades.length,expectedTrades.length);
  for(let i=0;i<expectedTrades.length;i++){const e=expectedTrades[i],a=actualTrades[i].args;assert.equal(Number(a.price),e.price);assert.equal(Number(a.quantity),e.quantity);assert.equal(Number(a.asset),e.asset);}
  if(round===30)for(const a of accounts.values()){a.cash+=a.holdings.reduce((n,q)=>n+q*10000,0);a.holdings=[0,0]}
  const state=await snapshot(c);
  for(const a of state.accounts)assert.deepEqual({cash:a.cash,holdings:a.holdings},accounts.get(a.address.toLowerCase()));
  if(round%10===0)console.log(`Verified round ${round}/30`);
 }
 check('备用客户端直接提交并完成剩余全部轮次');check('30 轮成交及余额与独立算法逐轮一致');check('最终持仓兑付及现金排名可复算');
 assert.equal([...accounts.values()].reduce((n,a)=>n+a.cash,0),30000000);check('现金与固定兑付守恒');
 await rejects('拒绝重复最终结算',()=>c.settle.staticCall());
 await rejects('合约无管理员改账入口',async()=>sender.sendTransaction({to:await c.getAddress(),data:id('setBalance(address,uint256)').slice(0,10)}));
 const poor=await deploy(2,1,2,15000,0);await at(poor.startAt);
 const p0=order(wallets[0],1,0,1,10000,1);await(await poor.c.submit(p0,await sign(wallets[0],poor.domain,p0))).wait();
 const p1=order(wallets[0],1,1,1,10000,1);await rejects('多标的共享现金不能重复花费',async()=>poor.c.submit.staticCall(p1,await sign(wallets[0],poor.domain,p1)));
 const sell=order(wallets[1],1,0,2,10000,1);await rejects('拒绝卖出不存在的持仓',async()=>poor.c.submit.staticCall(sell,await sign(wallets[1],poor.domain,sell)));
 await at(poor.startAt+60);await(await poor.c.connect(backup).settle()).wait();assert.equal(await poor.c.reservedCash(wallets[0].address),0n);check('未成交订单过期并释放现金');
 await rejects('拒绝超过每轮 128 张订单的配置',()=>deploy(64,1,3));
 const wide=await deploy(64,1,2);await at(wide.startAt);
 for(let i=0;i<64;i++)for(let a=0;a<2;a++){const o=order(wallets[i],1,a,i%2?2:1,10000,1);await(await wide.c.submit(o,await sign(wallets[i],wide.domain,o))).wait();}
 await at(wide.startAt+60);const wideReceipt=await(await wide.c.connect(backup).settle()).wait();assert.ok(wideReceipt.gasUsed<25000000n);check('64 个账户 128 张订单单轮结算');
 const attestor=Wallet.createRandom(),anchor=await new ContractFactory(anchorArtifact.abi,anchorArtifact.bytecode,sender).deploy(attestor.address);await anchor.waitForDeployment();
 const coder=AbiCoder.defaultAbiCoder(),market=id('audit-test'),root=id('root-1'),chain=31337,address=await anchor.getAddress();
 const anchorSig=(r,seq=1)=>attestor.signingKey.sign(keccak256(coder.encode(['uint256','address','bytes32','uint256','bytes32'],[chain,address,market,seq,r]))).serialized;
 await(await anchor.connect(backup).anchor(market,1,root,anchorSig(root))).wait();assert.equal(await anchor.roots(market,1),root);check('第三方可提交签名审计锚点');
 await rejects('拒绝锚点覆盖',()=>anchor.anchor.staticCall(market,1,id('different'),anchorSig(id('different'))));
 await rejects('拒绝伪造锚点',()=>anchor.anchor.staticCall(market,2,id('fake'),anchorSig(root)));
 const final=await snapshot(c);
 const report={environment:'local-evm',chainId:31337,acceleratedTime:true,publicTestnetDeployed:false,checkedAt:new Date().toISOString(),checks,
  simulation:{agents:10,rounds:30,assets:2,orders:600,trades,policies,leaderboard:final.leaderboard},
  gas:{settleMin:Math.min(...gas),settleMax:Math.max(...gas),capacity64Orders128:Number(wideReceipt.gasUsed)},
  elapsedSeconds:(Date.now()-started)/1000,limitations:['Fixed redemption; no simulated news or system maker in contract profile.','Local EVM results are not public-network throughput measurements.','Contract accepts up to 64 participants and 8 assets; tested load is 64 participants and 2 assets.']};
 await mkdir('reports',{recursive:true});await writeFile('reports/chain-verification.json',JSON.stringify(report,null,2));await writeFile('public/lab/verification.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({checks:checks.length,gas:report.gas,elapsedSeconds:report.elapsedSeconds}));
}finally{if(relay)await new Promise(r=>relay.close(r));provider.destroy();await rpc.disconnect()}
