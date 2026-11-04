import solc from 'solc';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const sources=Object.fromEntries(['Competition','AuditAnchor'].map(n=>[n+'.sol',{content:readFileSync('contracts/'+n+'.sol','utf8')}]));
const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}}),{
  import:p=>{try{return {contents:readFileSync('node_modules/'+p,'utf8')}}catch{return {error:'Import not found'}}}
}));
for(const e of out.errors||[])if(e.severity==='error')throw new Error(e.formattedMessage);
mkdirSync('artifacts',{recursive:true});mkdirSync('public/lab/contracts',{recursive:true});
for(const name of ['Competition','AuditAnchor']){
 const c=out.contracts[name+'.sol'][name];const artifact={contractName:name,compiler:solc.version(),abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,runtimeBytes:c.evm.deployedBytecode.object.length/2};
 writeFileSync('artifacts/'+name+'.json',JSON.stringify(artifact,null,2));
 writeFileSync('public/lab/contracts/'+name+'.json',JSON.stringify(artifact));
 writeFileSync('public/lab/contracts/'+name+'.sol',sources[name+'.sol'].content);
 console.log(name+': '+artifact.runtimeBytes+' runtime bytes');
}
