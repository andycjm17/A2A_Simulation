import { ClubBrand } from "./ClubBrand";
import { t, rich, useLocale, localizedLabels, localeTag, message, displayName, displayMarketName } from "./i18n";
import {useEffect,useState} from 'react';
import './lab.css';
export default function Lab(){
  useLocale();
 const [manifest,setManifest]=useState<any>(null),[markets,setMarkets]=useState<any[]>([]),[report,setReport]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{Promise.all([fetch('/lab/deployment.json').then(r=>r.json()),fetch('/api/markets').then(r=>r.json()),fetch('/lab/verification.json').then(r=>r.ok?r.json():null)]).then(([d,m,r])=>{setManifest(d);setMarkets((m as {markets:any[]}).markets);setReport(r)}).catch(e=>setError(e.message))},[]);
 return <div className="lab"><header><ClubBrand /><span>{rich("m2033bb1066")}</span><a href="/?view=admin">{rich("m154ef355b8")}</a></header>
 <main><p className="eyebrow">DECENTRALIZATION LAB</p><h1>{rich("m366aa48381")}</h1><p className="lead">{rich("m4341aec3cb")}</p>
 {error&&<p role="alert">{error}</p>}
 <div className="lab-grid"><section><span className="lab-tag">{rich("mab52e2f21a")}</span><h2>{rich("m9a81f6afda")}</h2><p>{rich("m7943996775")}</p><p><strong>{rich("m40d82eac68")}</strong>{manifest?.status==='deployed'?t("m31fc23fd8b"):t("mcb435badf4")}</p><p>{rich("mad0521afc2")}</p></section>
 <section><span className="lab-tag">{rich("m38a74737eb")}</span><h2>{rich("m63f5580f9c")}</h2><p>{rich("m8098d12948")}</p><p><strong>{rich("m9a1191328a")}</strong>{report?t("mf79720974e"):t("mfdb27e526b")}{localeTag()==='en-US'?'. ':'。'}{manifest?.status==='deployed'?t("mcf39bcb8f4"):t("m63781c2c1a")}</p><p>{rich("m34cd74f150")}</p></section></div>
 <section><h2>{rich("me6921d570c")}</h2>{report?<><p>{rich("m95fed55446", [report.checks?.length ?? 0, report.simulation?.agents, report.simulation?.rounds])}</p><p>{rich("m792ee890c4")}</p><div className="lab-results">{report.checks?.map((c:any)=><span key={c.name}>✓ {message(c.name)}</span>)}</div><a href="/lab/verification.json">{rich("m5d2aeb367d")}</a></>:<p>{rich("me450f39656")}</p>}</section>
 <section><h2>{rich("m9d2fb81e13")}</h2><div className="lab-markets">{markets.length?markets.map(m=><article key={m.id}><strong>{displayMarketName(m.name)}</strong><div><a href={`/?market=${m.id}`}>{rich("m13d314dd87")}</a><a href={`/api/markets/${m.id}/audit`} target="_blank" rel="noreferrer">{rich("md67c1f383c")}</a></div></article>):<p>{rich("m2fd4afe37b")}</p>}</div></section>
 <section><h2>{rich("mb976f11352")}</h2><p>{manifest?.network} · Chain ID {manifest?.chainId}</p><p>{rich("m98ed082565")}</p><code className="wrap">{manifest?.testnetDeployer||t("m465c03b272")}</code><p>{rich("md7e3e3f1a8")}</p><p>{rich("ma8a188e802", [<code className="wrap">{manifest?.auditAttestor}</code>])}</p></section>
 <section><h2>{rich("m12d66724ce")}</h2><p>{rich("m2ec65fba2d")}</p><pre>{`npx tsx scripts/signed-agent.ts agent.private.json\nnpx tsx scripts/verify-audit.ts audit.json TRUSTED_ATTESTOR\nnode scripts/chain-cli.mjs snapshot deployment.json\nnode scripts/chain-cli.mjs submit deployment.json order.json KEY_FILE\nnode scripts/chain-cli.mjs settle deployment.json KEY_FILE`}</pre><p>{rich("m334f8b5108")}</p><a href="/lab/contracts/Competition.sol">{rich("ma17d5c2e2b")}</a> · <a href="/lab/contracts/Competition.json">{rich("m39cb5d4175")}</a> · <a href="/lab/contracts/AuditAnchor.sol">{rich("mabb35dd529")}</a></section>
 </main><footer>{rich("m708f7510a9")}</footer></div>
}
