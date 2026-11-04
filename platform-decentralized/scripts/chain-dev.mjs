import ganache from 'ganache';
import {Wallet,JsonRpcProvider,ContractFactory,encodeBytes32String} from 'ethers';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('private/local-chain',{recursive:true,mode:0o700});
let wallets;
try{wallets=JSON.parse(await readFile('private/local-chain/accounts.json','utf8')).map(k=>new Wallet(k));}
catch(e){if(e.code!=='ENOENT')throw e;wallets=Array.from({length:12},()=>Wallet.createRandom());await writeFile('private/local-chain/accounts.json',JSON.stringify(wallets.map(w=>w.privateKey)),{mode:0o600,flag:'wx'});}
for(let i=0;i<wallets.length;i++)await writeFile(`private/local-chain/key-${i}.txt`,wallets[i].privateKey+'\n',{mode:0o600});
const server=ganache.server({logging:{quiet:true},chain:{chainId:31337,hardfork:'shanghai'},database:{dbPath:'private/local-chain/database'},wallet:{accounts:wallets.map(w=>({secretKey:w.privateKey,balance:'0x3635c9adc5dea00000'}))}});
await server.listen(8546,'127.0.0.1');
const provider=new JsonRpcProvider('http://127.0.0.1:8546',undefined,{cacheTimeout:-1}),signer=await provider.getSigner(wallets[10].address);
let manifest;
try{manifest=JSON.parse(await readFile('private/local-chain/deployment.json','utf8'));if(await provider.getCode(manifest.competition)==='0x')throw new Error('Deployment lost');}
catch(e){if(e.code!=='ENOENT')throw e;
 const artifact=JSON.parse(await readFile('artifacts/Competition.json','utf8'));
 const config={participants:wallets.slice(0,10).map(w=>w.address),symbols:['BFBT','EFET'].map(encodeBytes32String),redemptionPrices:[10000,10000],settings:[Math.floor(Date.now()/1000)+120,60,30,1000000,100]};
 const c=await new ContractFactory(artifact.abi,artifact.bytecode,signer).deploy(config.participants,config.symbols,config.redemptionPrices,config.settings);await c.waitForDeployment();
 const anchorArtifact=JSON.parse(await readFile('artifacts/AuditAnchor.json','utf8')),attestor=JSON.parse(await readFile('public/lab/deployment.json','utf8')).auditAttestor;
 const a=await new ContractFactory(anchorArtifact.abi,anchorArtifact.bytecode,signer).deploy(attestor);await a.waitForDeployment();
 manifest={chainId:31337,rpcUrl:'http://127.0.0.1:8546',competition:await c.getAddress(),anchor:await a.getAddress(),config};
 await writeFile('private/local-chain/deployment.json',JSON.stringify(manifest,null,2),{mode:0o600});
}
console.log(JSON.stringify(manifest,null,2));
console.log('Local chain ready. Use scripts/chain-cli.mjs with private/local-chain/deployment.json. RPC is loopback only.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{provider.destroy();await server.close();process.exit(0)});
