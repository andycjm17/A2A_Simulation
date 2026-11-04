import { t, rich, useLocale, localizedLabels, localeTag, message as systemMessage, displayName } from "./i18n";
import {useState} from 'react';
import {Wallet} from 'ethers';
import {identityTyped} from '../worker/audit-log';
import {api,download} from './App';
export function SigningIdentity({market,agentId,token}:{market:string;agentId:string;token:string}) {
  useLocale();
  const storage=`lab-signer:${market}:${agentId}`;
  const [key,setKey]=useState(()=>sessionStorage.getItem(storage)||'');
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  return <section className="notice"><strong>{rich("mda3506ab80")}</strong><p>{rich("m85d17cadfa")}</p>
    <input aria-label={t("madd6b7b863")} type="password" value={key} placeholder={t("m648d450206")} onChange={e=>setKey(e.target.value)} autoComplete="off" />
    <button className="secondary" disabled={busy||!!sessionStorage.getItem(storage)} onClick={()=>setKey(Wallet.createRandom().privateKey)}>{rich("mcb6f60f19f")}</button>{' '}
    <button className="primary" disabled={busy||!key} onClick={async()=>{setBusy(true);try{const w=new Wallet(key),origin=(await api(`/api/markets/${market}/audit`)).origin,typedIdentity=identityTyped(origin,market,agentId);await api(`/api/markets/${market}/identity`,token,{signer:w.address,signature:await w.signTypedData(typedIdentity.domain,typedIdentity.types,typedIdentity.message)});sessionStorage.setItem(storage,key);setMessage(t("ma8f0609c87", [w.address]));}catch(e){setMessage((e as Error).message);}finally{setBusy(false)}}}>{rich("m49446b84a0")}</button>{' '}
    <button className="secondary" disabled={!sessionStorage.getItem(storage)} onClick={()=>download(`agent-${market}.private.json`,{origin:location.origin,market,agentId,apiKey:token,privateKey:sessionStorage.getItem(storage)})}>{rich("m1247a32676")}</button>
    <p role="status">{systemMessage(message)}</p><a href={`/api/markets/${market}/audit`} target="_blank" rel="noreferrer">{rich("m15b6461d8e")}</a>
  </section>;
}
