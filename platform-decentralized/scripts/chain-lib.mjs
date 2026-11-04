import { Contract, JsonRpcProvider, Wallet, AbiCoder, keccak256 } from 'ethers';
import {readFile} from 'node:fs/promises';
export const orderTypes={Order:[{name:'owner',type:'address'},{name:'round',type:'uint256'},{name:'asset',type:'uint256'},{name:'side',type:'uint256'},{name:'price',type:'uint256'},{name:'quantity',type:'uint256'},{name:'nonce',type:'bytes32'},{name:'epoch',type:'uint256'}]};
export const sessionTypes={Session:[{name:'owner',type:'address'},{name:'key',type:'address'},{name:'expires',type:'uint256'},{name:'epoch',type:'uint256'}]};
export const chainDomain=(chainId,address)=>({name:'Agent Exchange Competition',version:'1',chainId,verifyingContract:address});
export async function connect(manifest,keyFile){
 const provider=new JsonRpcProvider(process.env.RPC_URL||manifest.rpcUrl);
 const network=await provider.getNetwork();
 if(![31337n,84532n].includes(network.chainId)||Number(network.chainId)!==manifest.chainId)throw new Error('Only specified local EVM or Base Sepolia testnet permitted');
 const signer=keyFile?new Wallet((await readFile(keyFile,'utf8')).trim(),provider):provider;
 const artifact=JSON.parse(await readFile(new URL('../artifacts/Competition.json',import.meta.url),'utf8'));
 return {provider,signer,contract:new Contract(manifest.competition,artifact.abi,signer)};
}
export async function snapshot(contract){
 const count=Number(await contract.participantCount()),assets=Number(await contract.assetCount());
 const accounts=[];
 for(let i=0;i<count;i++){
  const address=await contract.participants(i),holdings=[];
  for(let a=0;a<assets;a++)holdings.push(Number(await contract.holdings(address,a)));
  accounts.push({address,cash:Number(await contract.cash(address)),holdings});
 }
 const leaderboard=[...accounts].sort((a,b)=>b.cash-a.cash||a.address.localeCompare(b.address));
 let prior=-1,rank=0;leaderboard.forEach((a,i)=>{if(a.cash!==prior)rank=i+1;a.rank=rank;prior=a.cash});
 return {round:Number(await contract.currentRound()),finished:await contract.finished(),rulesHash:await contract.rulesHash(),stateHash:await contract.stateHash(),orders:Number(await contract.orderCount()),accounts,leaderboard};
}
// Independent implementation: no calls to the Worker engine or contract's settlement method.
export function matchIndependent(accounts,orders,assetCount,rulesHash,round){
 const coder=AbiCoder.defaultAbiCoder();
 const tie=o=>BigInt(keccak256(coder.encode(['bytes32','uint256','address'],[rulesHash,round,o.owner])));
 const sort=buy=>(a,b)=>a.price!==b.price?(buy?b.price-a.price:a.price-b.price):(tie(a)<tie(b)?-1:tie(a)>tie(b)?1:a.owner.toLowerCase().localeCompare(b.owner.toLowerCase()));
 const trades=[];
 for(let asset=0;asset<assetCount;asset++){
  const buy=orders.filter(o=>o.asset===asset&&o.side===1).map(o=>({...o,left:o.quantity})).sort(sort(true));
  const sell=orders.filter(o=>o.asset===asset&&o.side===2).map(o=>({...o,left:o.quantity})).sort(sort(false));
  let i=0,j=0;
  while(i<buy.length&&j<sell.length&&buy[i].price>=sell[j].price){
   const b=buy[i],s=sell[j],quantity=Math.min(b.left,s.left),price=Math.floor((b.price+s.price)/2);
   const ba=accounts.get(b.owner.toLowerCase()),sa=accounts.get(s.owner.toLowerCase());
   ba.cash-=price*quantity;sa.cash+=price*quantity;ba.holdings[asset]+=quantity;sa.holdings[asset]-=quantity;
   trades.push({asset,buyer:b.owner,seller:s.owner,price,quantity});b.left-=quantity;s.left-=quantity;if(!b.left)i++;if(!s.left)j++;
  }
 }
 return trades;
}
