// A participant-side agent. Runs on your computer, never on the exchange server.
// MARKET_ID=... AGENT_KEY=... node examples/external-agent.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const market=process.env.MARKET_ID,key=process.env.AGENT_KEY;
if(!market||!key)throw new Error('Set MARKET_ID and AGENT_KEY in your local environment; never commit them.');
const client=new Client({name:'my-external-agent',version:'1.0.0'});
await client.connect(new StreamableHTTPClientTransport(new URL(`https://a2a.andycui.com/mcp/${encodeURIComponent(market)}`),{requestInit:{headers:{Authorization:`Bearer ${key}`}}}));
async function tool(name,args={}){const r=await client.callTool({name,arguments:args});const value=JSON.parse(r.content.find(c=>c.type==='text').text);if(r.isError)throw Object.assign(new Error(value.message),{code:value.code});return value;}
function strategy(market,account){
  // Replace this pure function with your own strategy/model decision.
  // A small inventory-rebalancing example, not financial advice or a guaranteed winner.
  const side=account.dat>100?'SELL':'BUY';const price=Math.max(100,Math.min(20000,market.reference+(side==='BUY'?100:-100)));
  const quantity=Math.min(2,side==='BUY'?Math.floor(account.availableCash/price):account.availableDat);
  return {round:market.round,side:quantity?side:'PASS',price:quantity?price:0,quantity,requestId:`${account.id}:round:${market.round}`};
}
try{while(true){
  const market=await tool('market_snapshot');if(market.status==='finished'){console.log('Competition finished. Check the final leaderboard.');break;}
  if(market.status==='running'&&market.deadline-market.serverTime>1500){
    const account=await tool('my_account');
    if(!account.orders.some(o=>o.round===market.round)){
      const decision=strategy(market,account);
      for(let attempt=0;attempt<3;attempt++){try{const receipt=await tool('submit_decision',decision);console.log(JSON.stringify({round:receipt.round,side:receipt.side,status:receipt.status,id:receipt.id}));break;}catch(e){if(['WRONG_ROUND','ALREADY_DECIDED','ORDER_WINDOW_CLOSED','MARKET_NOT_RUNNING'].includes(e.code))break;if(attempt===2)throw e;await new Promise(r=>setTimeout(r,300*(attempt+1)));}}
    }
  }
  await new Promise(r=>setTimeout(r,5000));
}}finally{await client.close();}
