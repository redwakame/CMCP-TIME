import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCmcpPinLifecycle} from './cmcp-pin-lifecycle.js';
import {createCmcpDispatchArbiter,cmcpDispatchProgressKey,cmcpDispatchReservedKeys} from './cmcp-dispatch-arbitration.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {loopHash} from './cmcp-local-loop-journal.js';
import {resolveCmcpTimeContext,parseCmcpInstant} from './resolve-cmcp-time-context.js';
import {projectCmcpRuntimeTime,formatCmcpLocalInstant} from './project-cmcp-local-time.js';
import {selectCmcpEventWorkingSet,projectCmcpEventWorkingSet} from './cmcp-event-working-set.js';
import {buildCmcpEventView} from './cmcp-event-lineage.js';
import {createCmcpProactiveHistory} from './cmcp-proactive-history.js';

const copy=value=>structuredClone(value);
const version=read=>loopHash(read.internal?.records??[]);
const unique=pointers=>[...new Map(pointers.map(pointer=>[cmcpSourcePointerKey(pointer),pointer])).values()];
const sourcePairs=sources=>sources.map(item=>[cmcpSourcePointerKey(item.pointer),item.evidenceHash]);
const orderedPairs=pairs=>[...pairs].sort(([a],[b])=>a<b?-1:a>b?1:0);

/** Normal Runtime bridge only: existing focus, catalog, History, controls and common journal remain authoritative. */
export function createCmcpRuntimeDispatch({root,scopeId,timezone,events,core,controlManager,adapter,runWork,delivery,
 clock=()=>new Date().toISOString(),eventContext={},maxProjectionBytes=14000,timeoutMs=90000,onResult=async()=>{}}){
 if(!path.isAbsolute(root)||typeof scopeId!=='string'||!scopeId||!Array.isArray(events)
   ||[core?.status,core?.bufferList,core?.catalog?.list,core?.history?.resolve,core?.ingest,controlManager?.snapshot,
     adapter?.request,runWork,delivery?.present,clock,onResult].some(fn=>typeof fn!=='function')
   ||!Number.isSafeInteger(maxProjectionBytes)||maxProjectionBytes<1)throw Error('runtime_dispatch_dependencies_required');
 const specs=events.map(item=>({...item,event:item.event??{scopeId,eventId:item.eventId}}));
 const now=()=>resolveCmcpTimeContext({now:clock(),timezone});
 const controls=()=>controlManager.snapshot();
 const proactiveHistory=createCmcpProactiveHistory({stores:core.stores,catalog:core.catalog,getControls:controls});
 let closed=false,timer=null,flight=null,generation=0,lastResult=null,lastReason='not_started',scheduledAt=null,activeRoute=null;
 const arms=new Map();
 const stopTimer=()=>{if(timer!==null)clearTimeout(timer);timer=null;scheduledAt=null;};
 async function exactSources(pointers,expectedHashes){
  const catalog=await core.catalog.list(),result=[];
  for(const pointer of unique(pointers)){
   if(pointer.scopeId!==scopeId)throw Error('dispatch_source_scope_mismatch');
   const source=await resolveCmcpHistorySource({provider:core.history,pointer});
   if(source.status!=='found')throw Error('dispatch_source_unavailable');
   const key=cmcpSourcePointerKey(pointer),hash=loopHash(source.evidence),registered=catalog.find(row=>cmcpSourcePointerKey(row.pointer)===key);
   if(!registered||registered.evidenceHash!==hash||expectedHashes&&expectedHashes[key]!==hash)throw Error('dispatch_source_changed_or_unregistered');
   result.push({pointer:copy(pointer),evidence:source.evidence,evidenceHash:hash});
  }
  return result;
 }
 async function currentEvent(eventId){
  const spec=specs.find(item=>item.event.eventId===eventId);if(!spec)throw Error('dispatch_event_outside_scope');
  const state=(await core.status()).events.find(item=>item.key===spec.key);
  if(!state||state.status!=='found')throw Error('dispatch_event_unavailable');
  return {spec,state};
 }
 function assertDialogue(state){
  if(state.dialogue?.status!=='open')throw Error('dispatch_dialogue_'+(state.dialogue?.status??'unknown'));
  if(!state.dialogue.supports?.length)throw Error('dispatch_dialogue_unsupported');
 }
 async function assertPendingCompatible(state,supportedSources,candidatePointers=[]){
  if(!state.pending?.length)return;
  const supportingKeys=new Set([...supportedSources.map(item=>cmcpSourcePointerKey(item.pointer)),...candidatePointers.map(cmcpSourcePointerKey)]);
  const currentAt=parseCmcpInstant(state.lastUserAt),supportedTimes=supportedSources.map(item=>parseCmcpInstant(item.evidence.messageRecordedAt));
  for(const pending of state.pending){
   const processing=pending.processing;
   if(supportingKeys.has(cmcpSourcePointerKey(pending.pointer))||!['committed','unchanged'].includes(processing?.eventProcessing)
      ||processing?.dialogueProcessing!=='pending'||!Array.isArray(processing.remaining)||processing.remaining.length)throw Error('dispatch_source_pending');
   // Only an earlier, formally saved dialogue uncertainty may be unrelated to a
   // newer supported focus. Incomplete facts/conditions and current-source work
   // remain blocking; this check never removes or resolves the old pending work.
   const [old]=await exactSources([pending.pointer]);
   const pendingAt=parseCmcpInstant(old.evidence.messageRecordedAt);
   if(old.evidence.sourceAuthorRole!=='user'||pendingAt>=currentAt||!supportedTimes.some(at=>at>pendingAt&&at<=currentAt))throw Error('dispatch_source_pending');
  }
 }
 async function verifiedDialogueSources(state){
  const supports=state.dialogue?.supports;
  if(!supports?.length)throw Error('dispatch_dialogue_unsupported');
  const expected=Object.fromEntries(supports.map(s=>[cmcpSourcePointerKey(s.pointer),s.evidenceHash]));
  const evidence=await exactSources(supports.map(s=>s.pointer),expected);
  for(const support of supports){const source=evidence.find(item=>cmcpSourcePointerKey(item.pointer)===cmcpSourcePointerKey(support.pointer)).evidence;
   const citation=support.citation,points=[...source.content.body];
   if(source.sourceAuthorRole!=='user'||citation?.unit!=='unicode_code_points'||!Number.isSafeInteger(citation.start)||!Number.isSafeInteger(citation.end)
      ||citation.start<0||citation.end<=citation.start||citation.end>points.length||points.slice(citation.start,citation.end).join('')!==citation.text)throw Error('dispatch_dialogue_source_mismatch');
  }
  return evidence;
 }
 async function verifiedDialogue(state,candidatePointers=[]){
  assertDialogue(state);const evidence=await verifiedDialogueSources(state);
  await assertPendingCompatible(state,evidence,candidatePointers);return evidence;
 }
 async function eventPinSources(spec,state){
  if(state.dialogue?.supports?.length)return (await verifiedDialogueSources(state)).map(source=>source.pointer);
  const read=await core.stores.eventStore(spec.event).readEvent({sourceUpdateIds:[]});
  if(read.status!=='found'||version(read)!==state.eventVersion)throw Error('pin_event_version_changed');
  const view=buildCmcpEventView(spec.event,read.internal.records),frontier=new Set([
   ...view.currentClaims.map(claim=>claim.nodeId),...view.unresolved.flatMap(item=>item.nodeIds)]);
  const nodes=frontier.size?view.knownEvolution.filter(node=>frontier.has(node.nodeId)):view.knownEvolution;
  const pointers=unique(nodes.map(node=>node.source.pointer));
  if(!pointers.length)throw Error('pin_event_sources_unavailable');
  if(pointers.length>64)throw Error('pin_event_sources_need_narrowing');
  await exactSources(pointers);return pointers;
 }
 const pins=createCmcpPinLifecycle({root,scopeId,
  verifyUserAction:async({userAction})=>userAction?.kind==='callable_authorization'&&userAction.authorized===true&&userAction.scopeId===scopeId
    ?{status:'verified',kind:'explicit_callable_authorization',scopeId}:{status:'rejected',code:'pin_explicit_scoped_user_action_required'},
  verifySources:async({sourcePointers,target,progressVersion})=>{
   const sources=await exactSources(sourcePointers);
   if(target.eventId){const {state}=await currentEvent(target.eventId);if(state.eventVersion!==progressVersion)throw Error('pin_event_version_changed');}
   else if(![loopHash(orderedPairs(sourcePairs(sources))),loopHash(sourcePairs(sources))].includes(progressVersion))throw Error('pin_source_version_changed');
   return {status:'verified',hashes:Object.fromEntries(sources.map(item=>[cmcpSourcePointerKey(item.pointer),item.evidenceHash]))};
  }});
 async function collect(){
  const list=await core.bufferList({scopeId,timeContext:now()}),state=await core.status(),result=[];
  for(const entry of [...list.items,...list.retained]){
   if(entry.kind!=='proactive_focus'||!['active','expired'].includes(entry.reason)||entry.generation!==list.generation)continue;
   const current=state.events.find(item=>item.key===entry.eventKey);
   if(!current||current.dialogue?.status!=='open'||!current.expiry||!current.eventVersion)continue;
   if(current.pending?.length){try{await verifiedDialogue(current);}catch{continue;}}
   const pointers=unique(current.dialogue.supports.map(s=>s.pointer));if(!pointers.length)continue;
   const oldKey=loopHash([entry.event,current.eventVersion,current.dialogue.supports.map(s=>({pointer:s.pointer,citation:s.citation}))]);
   if((current.sends??[]).some(send=>send.key===oldKey))continue;
   result.push({route:'buffer',id:'buffer:'+entry.eventKey,eventKey:entry.eventKey,target:{eventId:entry.event.eventId},
    progressVersion:current.eventVersion,sourcePointers:pointers,dueAt:current.expiry,expiresAt:current.expiry,bufferGeneration:entry.generation,
    lastUserAt:current.lastUserAt,sourceHashes:Object.fromEntries(current.dialogue.supports.map(s=>[cmcpSourcePointerKey(s.pointer),s.evidenceHash]))});
  }
  for(const pin of (await pins.list()).pins)if(pin.status==='active')result.push({route:'pin',id:pin.pinId,target:copy(pin.target),
   progressVersion:pin.progressVersion,sourcePointers:copy(pin.sourcePointers),dueAt:pin.dueAt,pinRevision:pin.revision,
   ...(pin.eligibilityPolicy?{eligibilityPolicy:pin.eligibilityPolicy}:{}),
   sourceHashes:copy(pin.sourceValidation.hashes)});
  return result;
 }
 async function validate(candidate){
  try{
   await exactSources(candidate.sourcePointers,candidate.sourceHashes);
   if(candidate.target.eventId){
    const {state}=await currentEvent(candidate.target.eventId);
    if(state.eventVersion!==candidate.progressVersion)return {status:'ineligible',code:'event_version_changed'};
    // Only a newly authorized independent Pin may target already closed history.
    // Legacy Pins retain their original closure boundary; no old eligibility is revived.
    const independent=candidate.route==='pin'&&candidate.eligibilityPolicy==='explicit_independent_v1';
    if(!independent&&state.dialogue?.status==='closed')return {status:'ineligible',code:'event_dialogue_closed'};
    if(!independent&&state.pending?.length){try{await verifiedDialogue(state,candidate.sourcePointers);}catch{return {status:'ineligible',code:'event_source_pending'};}}
    if(candidate.route==='buffer'){
     await verifiedDialogue(state);
     if(state.lastUserAt!==candidate.lastUserAt||state.expiry!==candidate.expiresAt)return {status:'ineligible',code:'focus_activity_changed'};
     const list=await core.bufferList({scopeId,timeContext:now()}),entry=[...list.items,...list.retained].find(item=>item.kind==='proactive_focus'&&item.eventKey===candidate.eventKey);
     if(!entry||entry.generation!==candidate.bufferGeneration||!['active','expired'].includes(entry.reason))return {status:'ineligible',code:'focus_no_longer_current'};
    }
   }
   if(candidate.route==='pin'){
    const pin=(await pins.list()).pins.find(item=>item.pinId===candidate.id);
    if(pin?.status!=='active'||pin.revision!==candidate.pinRevision||pin.eligibilityPolicy!==candidate.eligibilityPolicy)return {status:'ineligible',code:'pin_closed_or_changed'};
   }
   return {status:'eligible',progressVersion:candidate.progressVersion,...(candidate.route==='pin'?{pinRevision:candidate.pinRevision}:{})};
  }catch(error){return {status:'ineligible',code:error.message};}
 }
 async function modelInput(candidate,canContinue){
  const temporal=now(),sources=await exactSources(candidate.sourcePointers,candidate.sourceHashes);
  let compact={kind:'source_only_user_pin',currentClaims:[],unresolved:[],unknownParts:[]},
   dialogue=candidate.route==='pin'&&candidate.eligibilityPolicy==='explicit_independent_v1'
    ?{kind:'explicit_user_pin',status:'active',targetDialogueStatus:'not_linked',originalDiscussionReopened:false,synopsis:null,supports:[]}
    :{kind:'explicit_user_pin',status:'open',synopsis:null,supports:[]};
  if(candidate.target.eventId){
   const {spec,state}=await currentEvent(candidate.target.eventId),store=core.stores.eventStore(spec.event),read=await store.readEvent({sourceUpdateIds:[]});
   if(read.status!=='found'||version(read)!==candidate.progressVersion)throw Error('dispatch_event_changed_before_projection');
   const topology=buildCmcpEventView(spec.event,read.internal.records),keys=new Set(candidate.sourcePointers.map(cmcpSourcePointerKey));
   const selection=selectCmcpEventWorkingSet({view:topology,query:state.dialogue?.synopsis??'',objects:spec.objects,
    anchorNodeIds:topology.knownEvolution.filter(node=>keys.has(cmcpSourcePointerKey(node.source.pointer))).map(node=>node.nodeId),limits:eventContext,timeContext:temporal});
   if(selection.status==='needs_narrowing')throw Error('dispatch_event_projection_needs_narrowing');
   const exact=await store.readEvent({sourceUpdateIds:selection.requiredSourceUpdateIds});
   if(exact.status!=='found'||version(exact)!==candidate.progressVersion)throw Error('dispatch_event_projection_version_changed');
   compact=JSON.parse(projectCmcpEventWorkingSet({view:exact.view,topologyView:topology,selection,timeContext:temporal}).modelContext);
   if(candidate.route==='pin'&&candidate.eligibilityPolicy==='explicit_independent_v1'){
    dialogue={kind:'explicit_user_pin',status:'active',targetDialogueStatus:state.dialogue?.status??'unknown',
     originalDiscussionReopened:false,pendingSourceCount:state.pending?.length??0,synopsis:null,supports:[]};
   }else if(state.dialogue?.status==='open'){
    await verifiedDialogue(state);
    dialogue={kind:'derived_dialogue',status:'open',synopsis:state.dialogue.synopsis,supports:state.dialogue.supports.map((support,index)=>({ref:'d'+(index+1),quote:support.citation.text,sourceAuthorRole:'user'}))};
   }
  }
  const selected=sources.map((source,index)=>({ref:'s'+(index+1),sourceKind:source.evidence.sourceKind,sourceAuthorRole:source.evidence.sourceAuthorRole,
   messageRecordedAt:source.evidence.messageRecordedAt,messageRecordedAtLocal:formatCmcpLocalInstant(source.evidence.messageRecordedAt,timezone),
   eventOccurredAt:source.evidence.eventOccurredAt,content:copy(source.evidence.content)}));
  const input={compact,dialogue,selectedSources:selected,initiation:{kind:'runtime_proactive',route:candidate.route,noNewUserInput:true,
   ...(candidate.route==='pin'&&candidate.eligibilityPolicy==='explicit_independent_v1'?{purpose:'explicit_user_scheduled_pin',originalDiscussionReopened:false}:{})},
   interactionTime:projectCmcpRuntimeTime(resolveCmcpTimeContext({now:temporal.now,timezone,...(candidate.lastUserAt?{lastInteractionAt:candidate.lastUserAt}:{})}))};
  const originalBytes=Buffer.byteLength(JSON.stringify(input));
  if(originalBytes>maxProjectionBytes)throw Error('dispatch_projection_byte_limit');
  await canContinue();
  const eventKey=candidate.target.eventId?specs.find(item=>item.event.eventId===candidate.target.eventId)?.key:null;
  const prior=await proactiveHistory.prepare({eventKey,sources,temporal,valid:canContinue,
    maxProjectionBytes:Math.min(proactiveHistory.limits.maxProjectionBytes,maxProjectionBytes-originalBytes-32)});
  if(!['none','disabled'].includes(prior.model.status))input.priorReplies=prior.model;
  if(Buffer.byteLength(JSON.stringify(input))>maxProjectionBytes)throw Error('dispatch_projection_byte_limit');
  return {input,historyReceipt:prior.receipt};
 }
 const arbiter=createCmcpDispatchArbiter({root,scopeId,getControls:controls,validate,clock:()=>now(),timeoutMs,
  generate:async(candidate,options)=>{
   activeRoute=candidate.route;
   const {input,historyReceipt}=await modelInput(candidate,options.canContinue);await options.canContinue();
   return runWork(async()=>{
    const result=await adapter.request('proactive',input,{signal:options.signal,canAttempt:options.canContinue});
    if(typeof result?.value?.text!=='string'||!result.value.text.trim())throw Error('dispatch_model_not_completed');
    return {text:result.value.text,receivedAt:now().now,projectionBytes:Buffer.byteLength(JSON.stringify(input)),historyReceipt};
   },{kind:'shared_runtime_proactive',route:candidate.route,event:candidate.target.eventId?{scopeId,eventId:candidate.target.eventId}:null,
    eventVersion:candidate.progressVersion,pointer:candidate.sourcePointers[0],sourceRefs:copy(candidate.sourcePointers),progressKey:cmcpDispatchProgressKey(candidate,scopeId),reservation:options.reservation,signal:options.signal});
  },
  deliver:async(result,candidate,{canPresent,reservation})=>{
   await canPresent();await proactiveHistory.verify(result.historyReceipt,{valid:canPresent});const snapshot=await controls();let saved=null;
   if(snapshot.effective.saveAssistant!==false){
    saved=await core.ingest({text:result.text,role:'assistant',pointer:{version:1,providerNamespace:core.history.descriptor.providerNamespace,scopeId,
      sessionId:core.sessionId,itemId:'dispatch-'+reservation.id,revisionId:'r1'},timeContext:{now:result.receivedAt,timezone},messageRecordedAt:result.receivedAt});
    if(saved.status!=='stored'&&saved.status!=='unchanged'&&saved.status!=='registered')throw Error('dispatch_assistant_save_failed');
   }
   await canPresent();await proactiveHistory.verify(result.historyReceipt,{valid:canPresent});const receipt=await delivery.present({kind:'proactive',text:result.text,scopeId,route:candidate.route,at:now().now});
   return {status:receipt?.status??'unknown',channel:'local_console',remoteDelivery:'not_asserted',
    sourcePointer:saved?.pointer??null,storage:saved?'saved':'disabled',receivedAt:result.receivedAt,projectionBytes:result.projectionBytes,
    priorReplyRead:result.historyReceipt};
  }});
 function interrupt(reason='new_user'){
  if(['buffer_clear','buffer_cleared','buffer_disabled'].includes(reason)&&(activeRoute??arbiter.activeRoute())==='pin'){stopTimer();arms.clear();lastReason=reason;return;}
  generation++;stopTimer();arms.clear();arbiter.cancel(reason);lastReason=reason;
 }
 async function evaluate(){
  if(closed||flight)return;const captured=generation;
  flight=(async()=>{
   const candidates=await collect();if(closed||captured!==generation)return;
   const at=now().nowEpochMs,dueTokens=[...arms.entries()].filter(([,entry])=>parseCmcpInstant(entry.dueAt)<=at).map(([,entry])=>entry.token);
   lastResult=await arbiter.evaluate({candidates,armedDueTokens:dueTokens});lastReason=lastResult.reason??lastResult.status;
   for(const [key,entry]of arms)if(parseCmcpInstant(entry.dueAt)<=at)arms.delete(key);
   await onResult(copy(lastResult));
  })().catch(error=>{lastResult={status:'failed',code:error.message};lastReason=error.message;}).finally(()=>{flight=null;activeRoute=null;});
  await flight;
  // A local presentation/unknown outcome never drains a queue of additional candidates.
  if(!closed&&captured===generation&&lastResult?.reason==='do_not_disturb')schedule(now().nowEpochMs+60000,true);
 }
 function schedule(at,reassess=false){stopTimer();scheduledAt=new Date(at).toISOString();timer=setTimeout(()=>{
  timer=null;scheduledAt=null;
  if(reassess)void refresh().catch(error=>{lastResult={status:'failed',code:error.message};lastReason=error.message;});
  else void evaluate();
 },Math.max(1,Math.min(2147483647,at-now().nowEpochMs)));}
 async function refresh(){
  stopTimer();if(closed)return {status:'closed'};const captured=generation,snapshot=await controls(),c=snapshot.effective;
  if(!c.enabled||c.clean||!c.proactive){lastReason='disabled';return {status:'disabled'};}
  const candidates=await collect(),reserved=cmcpDispatchReservedKeys((await arbiter.status()).records,scopeId);
  let next=null;
  for(const candidate of candidates){
   if(candidate.dueAt===null||reserved.has(cmcpDispatchProgressKey(candidate,scopeId))||!c[candidate.route==='buffer'?'buffer':'pins'])continue;
   const due=parseCmcpInstant(candidate.dueAt),at=now().nowEpochMs;
   if(candidate.route==='buffer'){
    if(due<=at)continue; // A restart never manufactures an expired due token.
    const key=cmcpDispatchProgressKey(candidate,scopeId);
    if(!arms.has(key)){const arm=await arbiter.arm(candidate);if(arm.status!=='armed')continue;arms.set(key,arm);}
   }
   next=next===null?Math.max(at,due):Math.min(next,Math.max(at,due));
  }
  if(closed||captured!==generation)return {status:'cancelled'};
  if(next!==null)schedule(next);lastReason=next===null?'no_eligible_scheduled_candidate':'waiting_due';
  return {status:next===null?'idle':'scheduled',at:scheduledAt};
 }
 async function pinCreate({updateId,pinId=randomUUID(),eventKey,sourceIds,dueAt=null,userAction}){
  const effective=(await controls()).effective;if(!effective.pins)throw Error('pins_disabled');
  if((typeof eventKey==='string')===Array.isArray(sourceIds))throw Error('pin_requires_event_or_sources');
  const existingPin=(await pins.list()).pins.find(pin=>pin.pinId===pinId);
  const eligibilityPolicy=existingPin?.eligibilityPolicy??(existingPin?undefined:'explicit_independent_v1');
  let target,sourcePointers,progressVersion;
  if(eventKey){const spec=specs.find(item=>item.key===eventKey);if(!spec)throw Error('pin_event_outside_scope');
   const {state}=await currentEvent(spec.event.eventId);
   target={eventId:spec.event.eventId};
   if(existingPin?.target.eventId===spec.event.eventId){sourcePointers=copy(existingPin.sourcePointers);progressVersion=existingPin.progressVersion;}
   else {sourcePointers=await eventPinSources(spec,state);progressVersion=state.eventVersion;}
  }else{
   let existingSourceCommand=false;
   if(!sourceIds.length||new Set(sourceIds).size!==sourceIds.length)throw Error('pin_source_ids_required');
   const catalog=await core.catalog.list(),entries=sourceIds.map(id=>catalog.find(item=>item.id===id));
   if(entries.some(item=>!item))throw Error('pin_source_outside_catalog');sourcePointers=entries.map(item=>item.pointer);
   const exact=await exactSources(sourcePointers),pairs=orderedPairs(sourcePairs(exact));target={sourceId:sourceIds.length===1?sourceIds[0]:'set-'+loopHash(pairs.map(([pointer])=>pointer))};
   progressVersion=loopHash(pairs);
   // A caller replaying an existing source Pin uses that original command's
   // representation. Preserve legacy fingerprints and presentation order while
   // verifying the same exact set and current evidence hashes.
   const existing=existingPin;
   if(existing&&JSON.stringify([...existing.sourcePointers.map(cmcpSourcePointerKey)].sort())===JSON.stringify(pairs.map(([pointer])=>pointer))
      &&pairs.every(([pointer,hash])=>existing.sourceValidation?.hashes?.[pointer]===hash)){
    target=copy(existing.target);progressVersion=existing.progressVersion;sourcePointers=copy(existing.sourcePointers);existingSourceCommand=true;
   }
   // A source-target Pin can share an event progress identity only with exact,
   // formally registered membership. Similar text/rank/recency never binds it.
   const states=await core.status(),selectedKeys=[...new Set(sourcePointers.map(cmcpSourcePointerKey))].sort();
   const matches=states.events.filter(state=>state.status==='found'&&state.eventVersion&&state.dialogue?.supports?.length
     &&JSON.stringify([...new Set(state.dialogue.supports.map(item=>cmcpSourcePointerKey(item.pointer)))].sort())===JSON.stringify(selectedKeys)
     &&entries.every(entry=>entry.eventScope?.scopeId===scopeId&&entry.eventScope?.eventId===state.event.eventId));
   if(matches.length===1&&!existingSourceCommand){target={eventId:matches[0].event.eventId};progressVersion=matches[0].eventVersion;}
  }
  const result=await pins.create({updateId,pinId,target,sourcePointers,progressVersion,dueAt,userAction,timeContext:now(),
   ...(eligibilityPolicy?{eligibilityPolicy}:{})});await refresh();return result;
 }
 async function pinChange(input){interrupt('pin_changed');const result=await pins.change({...input,timeContext:now()});await refresh();return result;}
 async function status(){return {kind:'cmcp_runtime_dispatch',timerScheduled:timer!==null,scheduledAt,generating:flight!==null,closed,
  reason:lastReason,lastResult:copy(lastResult),arbitration:await arbiter.status(),pins:await pins.list(),modelCalls:0};}
 async function close(){closed=true;interrupt('runtime_closed');arbiter.close();await flight;}
 return Object.freeze({refresh,interrupt,close,status,pinCreate,pinChange,pinList:()=>pins.list()});
}
