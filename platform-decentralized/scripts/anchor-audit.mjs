import {readFile,writeFile} from 'node:fs/promises';
import {Wallet,JsonRpcProvider,Contract,AbiCoder,keccak256,id} from 'ethers';
const [auditFile,manifestFile='public/lab/deployment.json']=process.argv.slice(2);
const bundle=JSON.parse(await readFile(auditFile,'utf8')),manifest=JSON.parse(await readFile(manifestFile,'utf8'));
if(!bundle.entries?.length||!manifest.anchor)throw new Error('Audit entries and deployed anchor required');
const provider=new JsonRpcProvider(process.env.RPC_URL||manifest.rpcUrl);
try{
 const chain=Number((await provider.getNetwork()).chainId);if(chain!==manifest.chainId||![31337,84532].includes(chain))throw new Error('Wrong test chain');
 const payer=new Wallet((await readFile(process.env.GAS_KEY_FILE||'private/testnet-deployer.txt','utf8')).trim(),provider);
 const attestor=new Wallet((await readFile('private/audit-signing-key.txt','utf8')).trim());
 const abi=JSON.parse(await readFile('artifacts/AuditAnchor.json','utf8')).abi;
 const contract=new Contract(manifest.anchor,abi,payer);
 if((await contract.attestor()).toLowerCase()!==attestor.address.toLowerCase())throw new Error('Attestor mismatch');
 const e=bundle.entries.at(-1),market=id(e.origin+':'+e.market);
 const digest=keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','bytes32','uint256','bytes32'],[chain,manifest.anchor,market,e.seq,e.hash]));
 const receipt=await(await contract.anchor(market,e.seq,e.hash,attestor.signingKey.sign(digest).serialized)).wait();
 if(await contract.roots(market,e.seq)!==e.hash)throw new Error('Readback mismatch');
 const result={chainId:chain,contract:manifest.anchor,market,seq:e.seq,root:e.hash,transaction:receipt.hash,block:receipt.blockNumber};
 await writeFile(auditFile+'.anchor.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{provider.destroy()}
