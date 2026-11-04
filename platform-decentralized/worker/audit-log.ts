import { SigningKey, computeAddress, keccak256, toUtf8Bytes, recoverAddress, verifyTypedData } from 'ethers';
import { ensure, type State, type Decision } from './engine';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value)
    .filter(([,v]) => v !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export const digest = (v: unknown) => keccak256(toUtf8Bytes(canonical(v)));
export const ZERO = '0x' + '00'.repeat(32);
export function identityTyped(origin: string, market: string, agentId: string) {
  return { domain: { name: 'Agent Exchange Audit', version: '1', salt: digest(origin) },
    types: { Identity: [{name:'market',type:'string'},{name:'agentId',type:'string'}] },
    message: { market, agentId } };
}
export function decisionTyped(origin: string, market: string, agentId: string, d: Decision) {
  return { domain: identityTyped(origin,market,agentId).domain,
    types: { Decision: [
      {name:'market',type:'string'},{name:'agentId',type:'string'},
      {name:'round',type:'uint256'},{name:'symbol',type:'string'},
      {name:'side',type:'string'},{name:'price',type:'uint256'},
      {name:'quantity',type:'uint256'},{name:'requestId',type:'string'},
      {name:'note',type:'string'}] },
    message: {market,agentId,...d,symbol:d.symbol ?? 'DAT',note:d.note ?? ''} };
}
export function checkSignature(typed: ReturnType<typeof identityTyped> | ReturnType<typeof decisionTyped>, signature: string, signer: string) {
  let valid = false;
  try { valid = verifyTypedData(typed.domain,typed.types,typed.message,signature).toLowerCase() === signer.toLowerCase(); } catch { /* rejected below */ }
  ensure(valid,'INVALID_SIGNATURE','订单或身份签名无效',401);
}
export function ledger(s: State) {
  const { seed, path, assets, news, agents, ...rest } = s;
  return { ...rest, agents:agents.map(({keyHash,...a})=>a),
    path:path.slice(0,s.status==='finished' ? undefined : s.round),
    assets: assets && Object.fromEntries(Object.entries(assets).map(([k,a]) => [k,{
      ...a,path:a.path.slice(0,s.status==='finished' ? undefined : s.round)}])),
    news: news?.filter(n=>s.status==='finished'||n.round<=s.round) };
}
export type LogOperation = { type: string; data?: any };
export type LogEntry = {
  seq:number; market:string; origin:string; at:number; previous:string;
  operation:LogOperation; stateHash:string; hash:string; signature:string; attestor:string;
};
export function makeEntry(s: State, origin: string, privateKey: string, prior: LogEntry | undefined, operation: LogOperation, at:number): LogEntry {
  const record = {seq:(prior?.seq ?? 0)+1,market:s.config.id,origin,at,previous:prior?.hash ?? ZERO,operation,stateHash:digest(ledger(s))};
  const hash=digest(record), key=new SigningKey(privateKey);
  return {...record,hash,signature:key.sign(hash).serialized,attestor:computeAddress(key.publicKey)};
}
export function verifyEntry(e:LogEntry, previous:string, seq:number, attestor:string) {
  const {hash,signature,attestor:claimed,...record}=e;
  if(e.seq!==seq || e.previous!==previous || digest(record)!==hash || claimed.toLowerCase()!==attestor.toLowerCase()
    || recoverAddress(hash,signature).toLowerCase()!==attestor.toLowerCase()) throw new Error(`Invalid audit entry ${seq}`);
}
