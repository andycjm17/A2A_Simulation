import { Wallet, randomBytes, hexlify } from 'ethers';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
await mkdir('private',{recursive:true,mode:0o700});
await chmod('private',0o700);
async function get(name,create){try{return (await readFile('private/'+name,'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;const v=create();await writeFile('private/'+name,v+'\n',{mode:0o600,flag:'wx'});return v;}}
const admin=await get('admin-token.txt',()=>hexlify(randomBytes(32)).slice(2));
const audit=await get('audit-signing-key.txt',()=>Wallet.createRandom().privateKey);
const deploy=await get('testnet-deployer.txt',()=>Wallet.createRandom().privateKey);
await writeFile('.dev.vars',`ADMIN_TOKEN=${admin}\nAUDIT_SIGNING_KEY=${audit}\nDEV_ORIGIN=http://127.0.0.1:5174\n`,{mode:0o600});
const addresses={testnetDeployer:new Wallet(deploy).address,auditAttestor:new Wallet(audit).address,network:'Base Sepolia',chainId:84532,status:'awaiting-testnet-funding'};
await mkdir('public/lab',{recursive:true});
await writeFile('public/lab/deployment.json',JSON.stringify(addresses,null,2)+'\n');
console.log(JSON.stringify(addresses,null,2));
