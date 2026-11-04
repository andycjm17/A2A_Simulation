import {readFile} from 'node:fs/promises';
import {connect,snapshot,orderTypes,chainDomain} from './chain-lib.mjs';
const [action,file,arg,keyFile]=process.argv.slice(2);
if(!action||!file)throw new Error('Usage: snapshot MANIFEST | submit MANIFEST ORDER_JSON KEY_FILE | settle MANIFEST KEY_FILE');
const manifest=JSON.parse(await readFile(file,'utf8'));
const {contract,signer,provider}=await connect(manifest,action==='submit'?keyFile:action==='settle'?arg:undefined);
try{
 if(action==='snapshot')console.log(JSON.stringify(await snapshot(contract),null,2));
 else if(action==='settle'){const tx=await contract.settle();console.log(JSON.stringify({transaction:tx.hash,receipt:(await tx.wait()).status}));}
 else if(action==='submit'){
  const input=JSON.parse(await readFile(arg,'utf8'));const order=input.order||input;
  const signature=input.signature||await signer.signTypedData(chainDomain(manifest.chainId,manifest.competition),orderTypes,order);
  const tx=await contract.submit(order,signature);console.log(JSON.stringify({transaction:tx.hash,receipt:(await tx.wait()).status}));
 }else throw new Error('Unknown action');
}finally{provider.destroy()}
