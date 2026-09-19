import path from 'node:path';
import {createLocalLoopJournal} from './cmcp-local-loop-journal.js';
import {createCmcpFileHistoryBackend as files} from './cmcp-file-history-backend.js';
import {createCmcpLocalHistoryProvider} from './cmcp-local-history-provider.js';
import {createCmcpEventLineageStore} from './cmcp-event-lineage-store.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';

/** No model, clock update, Runtime construction, lock, append or directory creation. */
export async function readCmcpLocalLoopStatus({root,proactiveState=null,historyProvider,eventBackend}) {
  if(!path.isAbsolute(root))throw Error('absolute_root_required');
  const rows=(await createLocalLoopJournal({root:path.join(root,'focus'),name:'local-focus-v1'}).read()).map(row=>row.record);
  if(!rows.length)return {status:'missing',root};
  const binding=rows[0].value,focus=rows.findLast(row=>row.kind==='state')?.value;
  if(rows[0].kind!=='binding')throw Error('invalid_focus_binding');
  const history=historyProvider===undefined?createCmcpLocalHistoryProvider({providerNamespace:binding.providerNamespace,backend:files({root:path.join(root,'history')})}):historyProvider;
  const event=await createCmcpEventLineageStore({event:binding.event,historyProvider:history,backend:eventBackend===undefined?files({root:path.join(root,'event')}):eventBackend}).readEvent();
  const host=(await createLocalLoopJournal({root:path.join(root,'host-log'),name:'local-console-host-v1'}).read()).map(row=>row.record.value);
  const control=host.findLast(row=>['started','proactive_control','stopped'].includes(row.type));
  const corrections=new Map(rows.filter(row=>row.kind==='dialogue_control_correction').map(row=>[row.value.updateId,row.value]));
  // A durable state receipt also covers interruption after state publication but
  // before the separate audit append. Status never repairs or rewrites either.
  if(focus?.lastControlCorrection)corrections.set(focus.lastControlCorrection.updateId,focus.lastControlCorrection);
  const controlCorrections=[...corrections.values()].map(value=>({status:'amended',updateId:value.updateId,
    sourcePointer:value.sourcePointer,sourceHash:value.sourceHash,replacedControlSequence:value.replacedControlSequence,
    reason:value.reason,at:value.at,sourceTime:value.sourceTime,appliesToCurrent:value.appliesToCurrent,
    activation:value.activation,proactive:value.proactive,originalEvidence:'preserved_in_append_only_journal'}));
  const sourceChecks=[];
  for(const pointer of focus?.sourceRefs??[]){
    const source=await resolveCmcpHistorySource({provider:history,pointer});
    sourceChecks.push({pointer,status:source.status,...(source.status==='found'?{sourceAuthorRole:source.evidence.sourceAuthorRole,
      messageRecordedAt:source.evidence.messageRecordedAt,eventOccurredAt:source.evidence.eventOccurredAt}: {})});
  }
  return {kind:'local_continuity_status',status:event.status==='unavailable'?'unavailable':'found',event:binding.event,
    eventProgress:event.view,eventReadStatus:event.status,eventDiagnostics:event.diagnostics??[],
    dialogue:focus?{status:focus.status,synopsis:focus.synopsis,supports:focus.supports}:null,
    pending:(focus?.pending??[]).map(pointer=>({pointer,processing:(focus.processing??[]).findLast(row=>cmcpSourcePointerKey(row.pointer)===cmcpSourcePointerKey(pointer))??null})),
    processing:focus?.processing??[],lastUserAt:focus?.lastUserAt??null,lastRelatedAt:focus?.lastRelatedAt??null,
    expiry:focus?.expiry??null,eventVersion:focus?.eventVersion??null,timezone:binding.timezone,
    proactive:{currentProcess:proactiveState,lastObserved:control?{type:control.type,sessionId:control.sessionId,at:control.observedAt,
      enabled:control.type==='stopped'?false:control.proactive}:null,
      observation:proactiveState?'current_process':'journal_observation_only_not_a_live_process_probe'},
    latestPresentation:host.findLast(row=>row.type==='presented')??focus?.sends?.findLast(row=>row.status==='presented')??null,
    sends:focus?.sends??[],sourceChecks,controlCorrections};
}
