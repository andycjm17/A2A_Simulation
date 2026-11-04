import { cloneElement, Fragment, isValidElement, type ReactNode } from 'react';
import catalog from './messages.json';
const entries=catalog as Record<string,{en:string;zh:string}>;
// Keep source-language lookup for historical server messages; the product UI is English only.
const byText=new Map(Object.values(entries).flatMap(v=>[[v.zh,v],[v.en,v]] as const));
export const localeTag=()=> 'en-US';
export const useLocale=()=> 'en';
if(typeof document!=='undefined'){
 document.documentElement.lang='en-US';
 document.title='Agent Exchange | Duke Blockchain Club';
 document.querySelector('meta[name="description"]')?.setAttribute('content','Duke Blockchain Club Agent Exchange. Connect your Agent through MCP or API, trade simulated assets, and follow the live leaderboard.');
 // Retire old locale links and browser preferences without affecting account storage.
 const url=new URL(location.href);
 if(url.searchParams.has('lang')){url.searchParams.delete('lang');history.replaceState(null,'',url);}
 try{localStorage.removeItem('a2a-language')}catch{}
}
function template(key:string){return (entries[key]??byText.get(key))?.en??key}
export function t(key:string,values:unknown[]=[]){return template(key).replace(/\{(\d+)\}/g,(_,i)=>String(values[Number(i)]??''))}
export function rich(key:string,values:ReactNode[]=[]):ReactNode {
  return template(key).split(/(\{\d+\})/g).map((part,i)=>{
    const match=part.match(/^\{(\d+)\}$/);const value=match?values[Number(match[1])]:part;
    return <Fragment key={i}>{isValidElement(value)?cloneElement(value):value}</Fragment>;
  });
}
export function localizedLabels<T extends Record<string,string>>(labels:T):T {
  return new Proxy(labels,{get:(target,key)=>typeof key==='string' && Object.hasOwn(target,key)?t(target[key]):Reflect.get(target,key)});
}
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const templates=Object.values(entries).filter(v=>/\{\d+\}/.test(v.zh)).flatMap(v=>(['zh','en'] as const).map(locale=>{
  const ids:number[]=[];const parts=v[locale].split(/(\{\d+\})/g);
  const pattern=parts.map(p=>/^\{\d+\}$/.test(p)?(ids.push(Number(p.slice(1,-1))),'(.*?)'):escape(p)).join('');
  return {v,ids,re:new RegExp('^'+pattern+'$','s')};
}));
export function message(text:string){
  const exact=byText.get(text);if(exact)return exact.en;
  for(const {v,ids,re} of templates){const m=text.match(re);if(m){const values:string[]=[];ids.forEach((id,i)=>values[id]=m[i+1]);return v.en.replace(/\{(\d+)\}/g,(_,i)=>values[Number(i)]??'')}}
  return text;
}
export function displayName(name:string){
  return ({'Luma ETF（模拟）':'Luma ETF (simulated)','Vela ETF（模拟）':'Vela ETF (simulated)','基本面庄家':'Fundamental market maker'} as Record<string,string>)[name]??name;
}
const news:Record<string,string>={
 '客户需求增长':'Customer demand rises','研发取得突破':'Research breakthrough','运营成本下降':'Operating costs fall','收入表现超预期':'Revenue exceeds expectations',
 '企业客户签约增长':'Enterprise signings rise','新模型评测取得突破':'New model benchmark breakthrough','算力成本下降':'Compute costs fall','开发者使用量超预期':'Developer usage exceeds expectations',
 '项目交付出现延期':'Project delivery delayed','供应链趋紧':'Supply chain tightens','订单增速放缓':'Order growth slows','运营可靠性承压':'Operational reliability under pressure',
 '产品交付出现延期':'Product delivery delayed','算力供应趋紧':'Compute supply tightens','企业订单增速放缓':'Enterprise order growth slows','服务可靠性承压':'Service reliability under pressure',
 '模拟 ETF 净申购增加':'Simulated ETF net subscriptions rise','模拟市场流动性改善':'Simulated market liquidity improves','模拟链上活跃度上升':'Simulated on-chain activity rises','模拟托管成本下降':'Simulated custody costs fall',
 '模拟 ETF 净赎回增加':'Simulated ETF net redemptions rise','模拟市场流动性收紧':'Simulated market liquidity tightens','模拟链上拥堵加剧':'Simulated on-chain congestion rises','模拟托管成本上升':'Simulated custody costs rise'
};
export function newsHeadline(text:string){const split=text.lastIndexOf('：');if(split<0)return text;return displayName(text.slice(0,split))+': '+(news[text.slice(split+1)]??text.slice(split+1))}
const errors:Record<string,string>={
 UNAUTHORIZED:'Your credential is missing, invalid, or expired. Reconnect with the correct key.',FORBIDDEN:'This action requires a valid organizer credential.',NOT_FOUND:'Competition or account not found.',EXISTS:'This competition ID is already in use.',
 VALIDATION_ERROR:'Check the input format and allowed values.',REGISTRATION_CLOSED:'Registration is closed.',MARKET_FULL:'This competition is full.',NAME_RESERVED:'This name is reserved for the system market maker.',NAME_TAKEN:'This Agent name is already registered.',
 BAD_STATE:'This action is unavailable in the current competition state.',NOT_ENOUGH_AGENTS:'Register enough Agents before starting.',INVALID_INSTRUMENTS:'Check instrument names, unique symbols, prices, and icons.',INVALID_BALANCES:'Check the starting cash and holdings.',INVALID_CONFIG:'Check the competition settings.',
 INVITE_REQUIRED:'An organizer invite is required.',INVALID_INVITE:'The invite is invalid or already used.',INVITE_LIMIT:'The invite limit has been reached.',
 IDEMPOTENCY_CONFLICT:'This requestId was already used with different parameters. Read your receipt before retrying.',ALREADY_DECIDED:'A decision has already been accepted for this instrument and round.',WRONG_ROUND:'The round has changed. Refresh the market state.',ORDER_WINDOW_CLOSED:'The order window is closed.',MARKET_NOT_RUNNING:'This competition is not accepting orders.',
 INVALID_SYMBOL:'Use a symbol from this competition’s instruments.',INVALID_SIDE:'Choose BUY, SELL, or PASS.',INVALID_NUMBER:'Prices and quantities must be safe integers.',INVALID_PRICE:'Price must be 100 to 20000 cents.',INVALID_QUANTITY:'Quantity must be 1 to 10 units.',INVALID_PASS:'PASS requires zero price and quantity.',INSUFFICIENT_CASH:'Insufficient available cash.',INSUFFICIENT_DAT:'Insufficient holdings for this sell order.',
 RATE_LIMITED:'Too many requests. Wait and try again.',INTERNAL_ERROR:'The service is temporarily unavailable. Retry with the same requestId.',STATE_CHANGED:'The market state changed. Refresh before saving.',
 SIGNATURE_REQUIRED:'Bind a signing identity and sign the order locally.',INVALID_SIGNATURE:'The identity or order signature is invalid.',UNBOUND_AGENTS:'All Agents must bind a signing identity before the start.',IDENTITY_LOCKED:'This signing identity is already bound and cannot be replaced.',SIGNER_USED:'This signing address is already bound to another Agent.',LOCKED:'Signing identities are locked after the start.',AUDIT_DISABLED:'Signed audit is not enabled for this competition.',AUDIT_NOT_CONFIGURED:'The audit signer is not configured.',
 ADMIN_NOT_CONFIGURED:'The admin credential is not configured.',ORIGIN_REJECTED:'This request origin is not allowed.',BODY_TOO_LARGE:'The request exceeds the size limit.',INVALID_JSON:'Invalid JSON request.',CONTENT_TYPE:'Use application/json.',METHOD_NOT_ALLOWED:'This HTTP method is not supported.'
};
export function apiError(error:{code?:string;message?:string}|undefined,status:number){
  const translated=message(error?.message||'');if(translated&&!/[\p{Script=Han}]/u.test(translated))return translated;
  return (errors[error?.code||'']||'The request could not be completed.')+` (${error?.code||status})`;
}

const systemMarketNames:Record<string,string>={
  "Crypto ETF 模拟交易": "Crypto ETF simulation",
  "Crypto ETF 验收": "Crypto ETF acceptance test",
  "Luma / Vela · 签名审计练习场": "Luma / Vela · Signed audit practice",
  "签名审计验收": "Signed audit verification",
  "自定义标的 · 模拟市场": "Custom assets · Simulated market",
  "自定义标的 · 系统验收演示": "Custom assets · Acceptance demo",
  "OpenAI × Anthropic · 随机新闻与庄家": "OpenAI × Anthropic · News and market maker",
  "模拟新闻与庄家 · 系统验收演示": "Simulated news and market maker · Acceptance demo",
  "OpenAI × Anthropic · 双标的练习赛": "OpenAI × Anthropic · Two-asset practice",
  "系统验收 · OpenAI / Anthropic 双标的": "Acceptance test · OpenAI / Anthropic",
  "MCP × API · 线上撮合验收": "MCP × API · Live matching verification",
  "验收测试 · 50 Agents · 30 轮": "Acceptance test · 50 Agents · 30 rounds",
  "开放练习场 · 带上你的 Agent": "Open practice · Bring your Agent",
  "负载验收 · 100 Agents": "Load test · 100 Agents",
  "负载验收 · 50 Agents": "Load test · 50 Agents"
};
export const displayMarketName=(name:string)=>systemMarketNames[name]??name;
