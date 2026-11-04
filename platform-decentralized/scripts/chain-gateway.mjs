import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {z} from 'zod';
import {connect,snapshot} from './chain-lib.mjs';
const uint=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const orderSchema=z.object({owner:z.string().regex(/^0x[0-9a-fA-F]{40}$/),round:uint,asset:uint,side:uint.max(2),price:uint.max(20000),quantity:uint.max(10),nonce:z.string().regex(/^0x[0-9a-fA-F]{64}$/),epoch:uint}).strict();
const submitSchema=z.object({order:orderSchema,signature:z.string().regex(/^0x[0-9a-fA-F]{130}$/)}).strict();
export async function createGateway(contract,port=8790){
 async function execute(action,input){
  if(action==='snapshot')return snapshot(contract);
  let tx;
  if(action==='submit'){const p=submitSchema.parse(input);tx=await contract.submit(p.order,p.signature);}
  else if(action==='settle')tx=await contract.settle();else throw new Error('Unknown action');
  const receipt=await tx.wait();return {transaction:tx.hash,block:receipt.blockNumber,status:receipt.status};
 }
 const server=createServer(async(req,res)=>{
  let mcp;
  try{
   if(req.headers.origin)throw new Error('Browser-origin requests not accepted by local gas sponsor');
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)throw new Error('Body limit')}
   const url=new URL(req.url,'http://127.0.0.1'),input=raw?JSON.parse(raw):{};
   if(url.pathname==='/mcp' && req.method==='POST'){
    mcp=new McpServer({name:'agent-exchange-chain',version:'1'});
    const tool=(action)=>async(data)=>{try{return {content:[{type:'text',text:JSON.stringify(await execute(action,data))}]}}catch{return {isError:true,content:[{type:'text',text:'Chain rejected request; verify signature, balances, round, and deadline.'}]}}};
    mcp.registerTool('market_snapshot',{description:'Read the contract ledger directly. Simulated assets only.',inputSchema:{},annotations:{readOnlyHint:true}},tool('snapshot'));
    mcp.registerTool('submit_signed_order',{description:'Relay a locally signed EIP-712 order. Never send private keys. Inclusion is confirmed only by the chain receipt.',inputSchema:submitSchema,annotations:{readOnlyHint:false,idempotentHint:true}},tool('submit'));
    mcp.registerTool('settle_round',{description:'Anyone may trigger due deterministic contract settlement.',inputSchema:{},annotations:{readOnlyHint:false}},tool('settle'));
    const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await mcp.connect(transport);
    const response=await transport.handleRequest(new Request('http://127.0.0.1/mcp',{method:'POST',headers:req.headers,body:raw}),{parsedBody:input});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
   }else{
    const match=url.pathname.match(/^\/api\/chain\/(snapshot|submit|settle)$/);
    if(!match || req.method!==(match[1]==='snapshot'?'GET':'POST')){res.writeHead(404).end();return;}
    const result=await execute(match[1],input);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));
   }
  }catch{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Rejected request. No private keys accepted.'}));}
  finally{if(mcp)await mcp.close()}
 });
 await new Promise(r=>server.listen(port,'127.0.0.1',r));return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [manifestFile,keyFile]=process.argv.slice(2);if(!keyFile)throw new Error('Usage: node scripts/chain-gateway.mjs MANIFEST GAS_KEY_FILE');
 const {contract,provider}=await connect(JSON.parse(await readFile(manifestFile,'utf8')),keyFile);
 const server=await createGateway(contract);console.log('Local chain API: http://127.0.0.1:8790/api/chain ; MCP: http://127.0.0.1:8790/mcp');
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await new Promise(r=>server.close(r));provider.destroy();process.exit(0)});
}
