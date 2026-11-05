import { createState, addAgent, start, pause, resume, submit, advance, reconfigureInstruments, setInitialBalances, retainHoldings, setSchedule, setMakerPolicy, publicState, type State } from './engine';
import { ZERO, digest, ledger, verifyEntry, checkSignature, identityTyped, decisionTyped, type LogEntry } from './audit-log';
export async function verifyAudit(bundle:any, expectedAttestor:string, expectedHead?:string) {
  const entries:LogEntry[]=bundle.entries;
  if(!entries?.length || !bundle.reveal?.seed) throw new Error('Finished competition and seed reveal required for full replay');
  let previous=ZERO, state:State|undefined;
  const identities=new Map<string,string>();
  for (const [i,e] of entries.entries()) {
    verifyEntry(e,previous,i+1,expectedAttestor);
    if(e.origin!==bundle.origin || e.market!==entries[0].market) throw new Error('Domain mismatch');
    const p=e.operation.data;
    if(i===0) {
      if(e.operation.type!=='create') throw new Error('Missing genesis');
      state=await createState(p.config,bundle.reveal.seed,p.createdAt);
      if(state.commitment!==p.commitment) throw new Error('Seed commitment mismatch');
    } else {
      if(!state) throw new Error('Missing state');
      switch(e.operation.type) {
        case 'join':addAgent(state,{...p,keyHash:'0'.repeat(64)},e.at);break;
        case 'identity':
          checkSignature(identityTyped(e.origin,e.market,p.agentId),p.signature,p.signer);
          if(identities.has(p.agentId) || [...identities.values()].includes(p.signer.toLowerCase())) throw new Error('Identity rebind');
          identities.set(p.agentId,p.signer.toLowerCase());break;
        case 'start':
          if(identities.size!==state.agents.filter(a=>!a.system).length) throw new Error('Missing identity');
          start(state,e.at);break;
        case 'pause':pause(state,e.at);break;
        case 'resume':resume(state,e.at);break;
        case 'advance':advance(state,e.at);break;
        case 'decision':
          checkSignature(decisionTyped(e.origin,e.market,p.agentId,p.decision),p.signature,identities.get(p.agentId)||'');
          submit(state,p.agentId,p.decision,e.at);break;
        case 'instruments':await reconfigureInstruments(state,p,e.at);break;
        case 'initial-balances':setInitialBalances(state,p,e.at);break;
        case 'schedule':await setSchedule(state,p,e.at);break;
        case 'maker-policy':setMakerPolicy(state,e.at);break;
        case 'retain-holdings':retainHoldings(state,e.at);break;
        case 'rotate':break; // Authentication secrets never affect matching or the public ledger.
        default:throw new Error(`Unknown operation ${e.operation.type}`);
      }
    }
    if(digest(ledger(state!))!==e.stateHash) throw new Error(`State mismatch at ${e.seq}`);
    previous=e.hash;
  }
  if(expectedHead && previous!==expectedHead) throw new Error('Receipt/anchor head mismatch');
  if(state!.status!=='finished' || digest(bundle.state)!==digest(ledger(state!))) throw new Error('Final ledger mismatch');
  return {verified:true,entries:entries.length,head:previous,attestor:expectedAttestor,
    leaderboard:publicState(state!,state!.finishedAt!).leaderboard,chainAnchorVerified:false};
}
