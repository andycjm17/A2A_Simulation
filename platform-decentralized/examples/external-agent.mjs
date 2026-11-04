// Runs on the participant's computer. MARKET_ID=... AGENT_KEY=... node examples/external-agent.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const market=process.env.MARKET_ID,key=process.env.AGENT_KEY;
if(!market||!key)throw new Error('Set MARKET_ID and AGENT_KEY locally; never commit them.');
const client=new Client({name:'my-external-agent',version:'3.0.0'});
await client.connect(new StreamableHTTPClientTransport(new URL(`https://a2a.andycui.com/mcp/${encodeURIComponent(market)}`),{requestInit:{headers:{Authorization:`Bearer ${key}`}}}));
async function tool(name,args={}){const r=await client.callTool({name,arguments:args});const value=JSON.parse(r.content.find(c=>c.type==='text').text);if(r.isError)throw Object.assign(new Error(value.message),{code:value.code});return value;}
function strategy(snapshot, instrument, account){
  // Replace with your strategy. Names are simulated assets, not real securities.
  const symbol=instrument.symbol;
  const side=account.holdings[symbol]>(snapshot.initialBalances?.[symbol]??100)?'SELL':'BUY';
  const price=Math.max(100,Math.min(20000,instrument.reference+(side==='BUY'?100:-100)));
  const quantity=Math.min(2,side==='BUY'?Math.floor(account.availableCash/price):account.availableHoldings[symbol]);
  return {round:snapshot.round,symbol,side:quantity?side:'PASS',price:quantity?price:0,quantity,requestId:`${account.id}:${symbol}:${snapshot.round}`};
}
try{while(true){
  const snapshot=await tool('market_snapshot');
  if(snapshot.status==='finished'){console.log('Competition finished. Check the final leaderboard.');break;}
  if(snapshot.status==='running'&&snapshot.deadline-snapshot.serverTime>1500){
    for(const instrument of snapshot.instruments){
      // Re-read after each instrument so the next order respects shared reserved cash.
      const account=await tool('my_account');
      if(account.orders.some(o=>o.round===snapshot.round&&(o.symbol??'DAT')===instrument.symbol))continue;
      const decision=strategy(snapshot,instrument,account);
      for(let attempt=0;attempt<3;attempt++){
        try{const receipt=await tool('submit_decision',decision);console.log(JSON.stringify({round:receipt.round,symbol:receipt.symbol,side:receipt.side,status:receipt.status}));break;}
        catch(e){if(['WRONG_ROUND','ALREADY_DECIDED','ORDER_WINDOW_CLOSED','MARKET_NOT_RUNNING','INSUFFICIENT_CASH'].includes(e.code))break;if(attempt===2)throw e;await new Promise(r=>setTimeout(r,300*(attempt+1)));}
      }
    }
  }
  await new Promise(r=>setTimeout(r,5000));
}}finally{await client.close();}
