import {readFile,writeFile} from 'node:fs/promises';
import {Wallet,JsonRpcProvider,ContractFactory} from 'ethers';
const rpc=process.env.RPC_URL||'https://sepolia.base.org';
const provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});
try{
 const chain=Number((await provider.getNetwork()).chainId);if(chain!==84532)throw new Error('Base Sepolia only: refusing other networks');
 const wallet=new Wallet((await readFile('private/testnet-deployer.txt','utf8')).trim(),provider);
 const publicManifest=JSON.parse(await readFile('public/lab/deployment.json','utf8'));
 if(publicManifest.status==='deployed')throw new Error('Contracts already recorded. Use existing deployment; no silent redeployment.');
 const balance=await provider.getBalance(wallet.address);
 console.log(JSON.stringify({network:'Base Sepolia',address:wallet.address,balanceWei:balance.toString()}));
 if(balance===0n)throw new Error('Test ETH funding required. No deployment sent.');
 const config=JSON.parse(await readFile(process.env.COMPETITION_CONFIG||'private/testnet-competition.json','utf8'));
 if(!Array.isArray(config.participants)||!Array.isArray(config.settings)||config.settings[0]<=Math.floor(Date.now()/1000)+60)throw new Error('Explicit participants and a future start time are required');
 const txs=[];
 const anchorArtifact=JSON.parse(await readFile('artifacts/AuditAnchor.json','utf8'));
 let anchor=publicManifest.anchor;
 if(!anchor){const c=await new ContractFactory(anchorArtifact.abi,anchorArtifact.bytecode,wallet).deploy(publicManifest.auditAttestor);await c.waitForDeployment();anchor=await c.getAddress();txs.push(c.deploymentTransaction().hash);
  await writeFile('public/lab/deployment.json',JSON.stringify({...publicManifest,anchor,status:'anchor-deployed',transactions:txs},null,2));}
 // Participant roster must be provided explicitly before locking a public competition.
 const artifact=JSON.parse(await readFile('artifacts/Competition.json','utf8'));
 const c=await new ContractFactory(artifact.abi,artifact.bytecode,wallet).deploy(config.participants,config.symbols,config.redemptionPrices,config.settings);
 await c.waitForDeployment();txs.push(c.deploymentTransaction().hash);
 const manifest={...publicManifest,status:'deployed',anchor,competition:await c.getAddress(),chainId:chain,rpcUrl:rpc,transactions:[...(publicManifest.transactions||[]),...txs],config,explorer:'https://sepolia.basescan.org',deployedAt:new Date().toISOString()};
 await writeFile('public/lab/deployment.json',JSON.stringify(manifest,null,2));console.log(JSON.stringify({anchor,competition:manifest.competition,transactions:txs}));
}finally{provider.destroy()}
