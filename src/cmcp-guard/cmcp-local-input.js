import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCmcpReactivationStores,createCmcpTemporalSourceCatalog,createCmcpHistoryReactivation,readCmcpHistoryReactivationStatus,readCmcpSelectedHistory,activateCmcpHistorySources} from './cmcp-history-reactivation.js';
import {createCmcpLocalCandidates} from './cmcp-local-candidates.js';
import {normalizeCmcpSourceCatalogConfig} from './cmcp-source-index-segments.js';
import {createCmcpSourceEvidence} from './cmcp-source-evidence.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {buildLoopRequest,validateLoopSchema} from './cmcp-local-loop-protocol.js';
import {createCmcpLocalContinuityLoop} from './cmcp-local-continuity-loop.js';
import {normalizeCmcpContinuityContextLimit,normalizeCmcpSemanticInputLimit} from './project-cmcp-compact-continuity.js';
import {readCmcpLocalLoopStatus} from './cmcp-local-loop-status.js';
import {createLocalLoopJournal,loopHash} from './cmcp-local-loop-journal.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {normalizeLocalLoopObjects} from './cmcp-local-loop-scope.js';
import {normalizeCmcpEvent} from './cmcp-event-lineage.js';
import {resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';
import {createCmcpAssistantTiming,observeCmcpAssistantTime} from './cmcp-assistant-timing.js';
import {projectCmcpRuntimeTime} from './project-cmcp-local-time.js';
import {readCmcpBufferBoundary,withCmcpBufferPublication,cmcpBufferExpiry} from './cmcp-buffer-lifecycle.js';
import {normalizeCmcpReadingLimits,openCmcpReadingCollection,readCmcpReadingPage,readCmcpReadingOutline,validateCmcpReadingPublication} from './cmcp-reading.js';
import {addCmcpReadingProgressLocators,buildCmcpReadingSelectionCatalog,collectCmcpHistoryLookupPointers} from './cmcp-reading-progress-locators.js';
import {createCmcpDiscussionSegments} from './cmcp-discussion-segments.js';
import {createCmcpAutoDiscussion} from './cmcp-auto-discussion.js';
import {createCmcpAnswerHistory,normalizeCmcpAnswerHistoryConfig} from './cmcp-answer-history.js';
import {buildCmcpNaturalTemporalCatalog,refineCmcpNaturalTemporalCatalog,normalizeCmcpNaturalTemporalSelection} from './cmcp-natural-temporal-reading.js';
import {createCmcpInteractionTime} from './cmcp-interaction-time.js';
import {selectCmcpReadingCalendarCollection,selectCmcpReadingAuthorizedCollection} from './cmcp-history-query.js';
import {createCmcpHistoryQueryRuntime} from './cmcp-history-query-runtime.js';
import {createCmcpEphemeralReadingQuery,assertCmcpEphemeralQueryText,resolveCmcpReadingQuery,cmcpReadingQueryKey} from './cmcp-reading-query-authorization.js';

const copy=value=>structuredClone(value);
const jsonBytes=value=>Buffer.byteLength(JSON.stringify(value));
const validReadRange=(range,length)=>range&&typeof range==='object'&&!Array.isArray(range)
  &&Object.keys(range).length===3&&Object.keys(range).every(key=>['unit','start','end'].includes(key))
  &&range.unit==='unicode_code_points'&&Number.isSafeInteger(range.start)&&Number.isSafeInteger(range.end)
  &&range.start>=0&&range.end>range.start&&range.end<=length;
function mergeReadRanges(ranges){
  const merged=[];for(const range of [...ranges].sort((a,b)=>a.start-b.start||a.end-b.end)){
    const last=merged.at(-1);if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);
    else merged.push({unit:'unicode_code_points',start:range.start,end:range.end});
  }return merged;
}
function sourceReadCoverage(entry,ranges){
  const readRanges=mergeReadRanges(ranges),unreadRanges=[];let next=0;
  for(const range of readRanges){if(range.start>next)unreadRanges.push({unit:'unicode_code_points',start:next,end:range.start});next=range.end;}
  if(next<entry.location.end)unreadRanges.push({unit:'unicode_code_points',start:next,end:entry.location.end});
  return {storedContentCodePoints:entry.location.end,readRanges,unreadRanges,completeStoredContent:unreadRanges.length===0,unreadContent:'not_assessed'};
}
/** Shared reference Host input; caller owns this small root/scope. No timer or model on construction/recovery/status. */
export async function createCmcpLocalInput({root,scopeId,events,limits,timezone,loopTiming,bufferTtlMs=loopTiming?.ttlMs,adapter,delivery,
  observe=async()=>{},sessionId=randomUUID(),clock=()=>new Date().toISOString(),catalogDependency,readOnly=false,recallLimits=limits,
  onSourceSaved=async()=>{},onReadingQuery=async()=>{},canContinue=async()=>true,remainingWorkMs=()=>Infinity,storageCapacity,localRetrieval,
  persistentFocus=false,runProactiveWork=async run=>run(),cancelProactiveWork=()=>{},discussionAssociation,answerHistory,naturalReading,verifyLegacyAnswerPreflight=async()=>null,verifyRejectedAnswerCompletion=async()=>null,continuityContextMaxBytes,semanticInputMaxBytes,eventContext=null,controlIntent=false,externalDispatch=false,bindingTimezone=timezone,sourceCatalogConfig}){
  continuityContextMaxBytes=normalizeCmcpContinuityContextLimit(continuityContextMaxBytes,{answerHistory:answerHistory?.enabled===true});
  semanticInputMaxBytes=normalizeCmcpSemanticInputLimit(semanticInputMaxBytes,{answerHistory:answerHistory?.enabled===true});
  if(!path.isAbsolute(root)||!Array.isArray(events)||events.length>4||!limits||!Number.isSafeInteger(limits.maxEntries)
    ||limits.maxEntries<1||limits.maxEntries>12||typeof adapter?.request!=='function'||typeof delivery?.present!=='function'
    ||typeof persistentFocus!=='boolean'||typeof runProactiveWork!=='function'||typeof cancelProactiveWork!=='function')throw Error('explicit_common_input_configuration_required');
  events=events.map(item=>({key:item.key,event:normalizeCmcpEvent({scopeId,eventId:item.eventId}),objects:normalizeLocalLoopObjects(item.objects)}));
  if(events.some(item=>typeof item.key!=='string'||!item.key)||new Set(events.map(item=>item.key)).size!==events.length
    ||new Set(events.map(item=>item.event.eventId)).size!==events.length)throw Error('duplicate_or_invalid_event_scope');
  resolveCmcpTimeContext({now:'2026-01-01T00:00:00Z',timezone});
  if(discussionAssociation!==undefined&&(!discussionAssociation||Object.keys(discussionAssociation).length!==1||typeof discussionAssociation.enabled!=='boolean'))throw Error('invalid_discussion_association_configuration');
  answerHistory=normalizeCmcpAnswerHistoryConfig(answerHistory);
  if(naturalReading!==undefined&&(!naturalReading||Object.keys(naturalReading).length!==1||!Number.isSafeInteger(naturalReading.maxCatalogBytes)
    ||naturalReading.maxCatalogBytes<1||naturalReading.maxCatalogBytes>8192))throw Error('invalid_natural_reading_configuration');
  if(recallLimits?.maxEntries!==limits.maxEntries)throw Error('recall_cannot_change_collection_capacity');
  const capacity=storageCapacity??{maxSources:limits.maxEntries,maxSourceBytes:4096};
  const catalogResources=normalizeCmcpSourceCatalogConfig(sourceCatalogConfig);
  if(!['maxSources','maxSourceBytes'].every(key=>Number.isSafeInteger(capacity[key])&&capacity[key]>0))throw Error('invalid_storage_capacity');
  if(localRetrieval&&(!storageCapacity||localRetrieval.maxStoredSources!==capacity.maxSources
    ||!['maxReadSources','maxReadBytes','maxProjectionBytes'].every(key=>Number.isSafeInteger(localRetrieval[key])&&localRetrieval[key]>0)
    ||localRetrieval.maxReadSources>2||localRetrieval.maxIndexSourceBytes!==capacity.maxSourceBytes))throw Error('invalid_local_read_limits');
  const stores=createCmcpReactivationStores({root,scopeId}),original=stores.history;
  const catalog=catalogDependency??createCmcpTemporalSourceCatalog({stores,maxEntries:capacity.maxSources,maxSegments:catalogResources.maxSegments});
  const journal=createLocalLoopJournal({root:path.join(root,'input-journal'),name:'cmcp-common-input-v1'});
  let features={buffer:true,timeIndex:true,historyRecall:true,answerHistory:true,discussionAssociation:true,saveUser:true,saveAssistant:true};
  const interactionTime=createCmcpInteractionTime({journal,scopeId,timezone,historyProvider:original,legacyCards:async()=>(await catalog.list()).map(entry=>({
    version:1,pointer:entry.pointer,role:entry.sourceAuthorRole,messageRecordedAt:entry.messageRecordedAt??null,eventOccurredAt:entry.eventOccurredAt??null,
    evidenceHash:entry.evidenceHash,basis:'existing_verified_source_catalog'}))});
  const discussions=createCmcpDiscussionSegments({stores,catalog,journal,events,maxSources:capacity.maxSources,maxSourceBytes:capacity.maxSourceBytes,
    now:()=>temporalFor().now,valid:async()=>enabled&&!clean&&await canContinue()});
  const replyAssociations=(discussionAssociation?.enabled||answerHistory?.enabled)?createCmcpAutoDiscussion({discussions,stores,journal,timezone,
    limits:{maxSources:Math.min(64,capacity.maxSources),maxSourceBytes:capacity.maxSourceBytes,maxRecordBytes:65536},
    now:()=>temporalFor().now,valid:async()=>enabled&&!clean&&await canContinue()}):null;
  const automaticDiscussions=discussionAssociation?.enabled?replyAssociations:null;
  const binding={version:1,scopeId,events,limits,timezone:bindingTimezone,loopTiming,...(storageCapacity?{storageCapacity}:{}),...(localRetrieval?{localRetrieval}:{})};
  const rows=await journal.read();
  const revokedReadings=new Map(rows.filter(row=>row.record.kind==='reading_revoked').map(row=>[row.record.value.ticket,row.record.value]));
  const locallyRevokedReadings=new Set(revokedReadings.keys()),revocationFlights=new Map();
  if(rows.length&&JSON.stringify(rows[0].record.value)!==JSON.stringify(binding))throw Error('common_input_root_binding_mismatch');
  if(!rows.length&&!readOnly)await journal.append('binding',binding);
  const boundary=await readCmcpBufferBoundary({root,scopeId});
  let bufferGeneration=boundary.generation,clearedAt=boundary.clearedAt,bufferClearPending=null;
  let activationTtlMs=bufferTtlMs;
  if(activationTtlMs!==undefined&&(!Number.isSafeInteger(activationTtlMs)||activationTtlMs<1))throw Error('invalid_buffer_ttl');
  const eventRoot=item=>path.join(root,'event-focus',loopHash(item.event));
  let enabled=true,clean=false,proactive=false,busy=false,recovered=false,retainedLoop=null,retainedEvent=null,retainedGeneration=null,proactiveInitialized=false,proactivePaused=false;
  // Only a normal, source-validated event submission can select a proactive focus.
  // Existing successful submissions are a compatible read path; recall/ingest rows
  // never select a focus. No history timestamp or focus lifetime is regenerated.
  const lastClearIndex=rows.findLastIndex(row=>row.record.kind==='buffer_clear');
  const selectionRows=rows.slice(lastClearIndex+1).map(row=>row.record).filter(row=>
    (row.value?.bufferGeneration??0)===bufferGeneration&&(row.kind==='focus_selection'||row.kind==='submission'
    &&row.value?.eventKey&&row.value.result?.focus?.supports?.length
    &&(row.value.result.status==='accepted'||row.value.result.focus.status==='closed')));
  const lastSelection=selectionRows.at(-1)?.value;
  let selectedFocus=events.find(item=>item.key===lastSelection?.eventKey)??null;
  const localIndex=localRetrieval?createCmcpLocalCandidates({root:path.join(root,'local-lexical-index'),scopeId,history:original,catalog,limits:localRetrieval,maxSegments:catalogResources.maxSegments}):null;
  const answerHistoryAccess=answerHistory?.enabled?createCmcpAnswerHistory({stores,catalog,journal,localIndex,timezone,
    limits:{maxSelectedSources:answerHistory.maxSelectedSources},now:()=>temporalFor().now,valid:async()=>enabled&&!clean&&features.historyRecall&&features.answerHistory&&await canContinue(),
    lookupMissingHistory:async({query,eventKey})=>{
      const requestId='answer-lookup-'+loopHash([query.pointer,loopHash(query)]);
      const result=await historyQueries.run({requestId,text:query.content.body,purpose:'evidence_lookup',
        readingLimits:{maxSources:capacity.maxSources,maxTotalBytes:131072,maxPageBytes:4096,maxPages:256,maxProjectionBytes:8192},
        batchLimits:{maxBatchSources:8,maxInputBytes:8000,maxBatches:16},
        executionBudget:{maxBatchesPerExecution:2,reserveMs:100000,requestTimeoutMs:90000},
        navigation:{inventory:{eventKey},savedQueryPointer:query.pointer,naturalTime:false}});
      return {result,verify:()=>historyQueries.verify(requestId)};
    }}):null;
  async function note(kind,value){try{await journal.append(kind,value);return true;}catch{return false;}}
  async function register(pointer,{sourceCatalog=catalog,sourceIndex=localIndex}={}){
    try{const result=await sourceCatalog.registerSource({pointer});let index=null;
      if(sourceIndex){try{index=await sourceIndex.indexSource(pointer);}catch(error){if(error.message==='local_index_batch_cancelled')throw error;index={status:'pending',reason:error.message};}
        if(index.status==='pending')await note('local_index_pending',{pointer,...index});}
      return {status:'registered',result,index};}
    catch(error){if(['catalog_batch_cancelled','local_index_batch_cancelled'].includes(error.message))throw error;
      await note('registration_pending',{pointer,code:error.message});return {status:'pending',code:error.message};}
  }
  function scopedHistory(associatedEvent=null){return Object.freeze({...original,async writeEvidence(input){
    if(input?.pointer?.scopeId!==scopeId)throw Error('source_outside_authorized_collection');
    if(input.sourceAuthorRole==='user'&&!features.saveUser||input.sourceAuthorRole==='assistant'&&!features.saveAssistant)throw Error('new_source_save_disabled');
    const result=await original.writeEvidence(input);
    if(!['stored','unchanged'].includes(result.status))return result;
    await onSourceSaved(input);
    if(enabled&&!clean&&features.timeIndex)await interactionTime.record(input);
    // Raw publication is acknowledged independently, even if association/index publication fails.
    if(associatedEvent)await note('source_association',{pointer:result.pointer,event:associatedEvent.event,bufferGeneration});
    const registration=await register(result.pointer);
    return {...result,registration};
  }});}
  const history=scopedHistory();
  stores.history=history;
  async function eventStatus(item){return readCmcpLocalLoopStatus({root:eventRoot(item),historyProvider:original,eventBackend:stores.eventBackend});}
  function applyProactiveControl(){
    if(!retainedLoop)return;
    retainedLoop.setProactive(!externalDispatch&&proactiveInitialized&&enabled&&!clean&&features.buffer&&proactive&&retainedGeneration===bufferGeneration
      &&selectedFocus?.key===retainedEvent?.key);
    if(proactivePaused)retainedLoop.interruptProactive('user_operation');
  }
  async function openLoop(item,{timeContext,retain=false,generation=bufferGeneration}={}){
    if(retain&&retainedLoop&&retainedEvent.key===item.key&&retainedGeneration===generation&&!retainedLoop.isHalted)return retainedLoop;
    if(retainedLoop){await retainedLoop.close();retainedLoop=null;retainedEvent=null;retainedGeneration=null;}
    const hostLog=createLocalLoopJournal({root:path.join(eventRoot(item),'host-log'),name:'local-console-host-v1'});
    const loop=await createCmcpLocalContinuityLoop({root:eventRoot(item),event:item.event,objects:item.objects,timezone,bindingTimezone,...loopTiming,bufferTtlMs:activationTtlMs,continuityContextMaxBytes,semanticInputMaxBytes,eventContext,
      proactive:false,requireEventReview:true,controlIntent,turnIntentStages:true,saveAssistant:()=>features.saveAssistant,historyProvider:scopedHistory(item),eventBackend:stores.eventBackend,sessionId,
      clock:!retain&&timeContext?()=>timeContext.now:clock,sourceObservationClock:clock,
      adapter:{descriptor:adapter.descriptor,request:(...args)=>adapter.request(...args)},delivery,
      runProactiveWork,cancelProactiveWork,bufferValid:()=>generation===bufferGeneration,canContinue,verifyLegacyAnswerPreflight,verifyRejectedAnswerCompletion,
      ...(answerHistoryAccess?{
        prepareAnswerHistory:input=>features.historyRecall&&features.answerHistory?answerHistoryAccess.prepare({...input,event:item.event,eventKey:item.key,bufferGeneration:generation}):null,
        readAnswerHistory:input=>answerHistoryAccess.read({...input,bufferGeneration:generation,bufferTtlMs:activationTtlMs,ttlMs:loopTiming.ttlMs,activateBuffer:features.buffer,
          valid:async()=>enabled&&!clean&&generation===bufferGeneration
            &&(await readCmcpBufferBoundary({root,scopeId})).generation===generation&&await input.valid()})
      }:{}),
      ...(automaticDiscussions?{
        prepareDiscussion:input=>features.discussionAssociation?automaticDiscussions.prepare({...input,eventKey:item.key,bufferGeneration:generation}):null,
        applyDiscussion:async input=>{
          await refreshEvents();
          return withCmcpBufferPublication({root,scopeId},async()=>automaticDiscussions.apply({...input,
            canApply:async()=>generation===bufferGeneration&&(await readCmcpBufferBoundary({root,scopeId})).generation===generation&&await input.canApply()}));
        }
      }:{}),
      ...(replyAssociations?{
        // An exact answer-to-User binding is source provenance. Disabling
        // discussion grouping does not erase the provenance needed for a read.
        onAssistantSaved:async input=>{
          await replyAssociations.recordReply({...input,eventKey:item.key,bufferGeneration:generation});
          await refreshEvents();
          if(!automaticDiscussions||!features.discussionAssociation)return {status:'reply_bound',discussionAssociation:'disabled'};
          return withCmcpBufferPublication({root,scopeId},async()=>automaticDiscussions.attachReplies({userPointer:input.replyTo,eventKey:item.key,bufferGeneration:generation,
            canApply:async()=>generation===bufferGeneration&&(await readCmcpBufferBoundary({root,scopeId})).generation===generation&&await input.canApply()}));
        }
      }:{}),
      observe:async event=>{await hostLog.append('host_event',features.saveAssistant&&features.saveUser?event:{type:event.type,at:event.at,bodyRetention:'disabled'});
        if(event.type==='presented'&&event.kind==='proactive')await refreshEvents();
        await observe(event);}});
    if(retain){retainedLoop=loop;retainedEvent=item;retainedGeneration=generation;applyProactiveControl();}
    return loop;
  }
  async function initializeProactive(){
    if(readOnly||!persistentFocus)return {status:'not_started',modelCalls:0};
    proactiveInitialized=true;
    if(selectedFocus)await openLoop(selectedFocus,{retain:true});
    applyProactiveControl();return {status:retainedLoop?'initialized':'no_confirmed_focus',modelCalls:0};
  }
  function interruptProactive(reason='new_user_input'){
    proactivePaused=true;if(retainedLoop)retainedLoop.interruptProactive(reason);else cancelProactiveWork(reason);
  }
  function resumeProactive(){proactivePaused=false;retainedLoop?.resumeProactive();}
  function waitForProactive(){return retainedLoop?.waitForProactive()??Promise.resolve();}
  async function resumeDiscussion({pointer}){
    if(readOnly||busy)throw Error('runtime_not_writable_or_busy');
    if(!enabled||clean||!automaticDiscussions)throw Error('discussion_recovery_disabled');
    if(pointer?.scopeId!==scopeId)throw Error('resume_source_scope_mismatch');
    const records=(await journal.read()).map(row=>row.record),associations=records.filter(row=>row.kind==='source_association'&&cmcpSourcePointerKey(row.value.pointer)===cmcpSourcePointerKey(pointer));
    const matches=events.filter(item=>associations.some(row=>JSON.stringify(row.value.event)===JSON.stringify(item.event)));
    if(matches.length!==1)throw Error('discussion_recovery_requires_one_existing_association');
    const selected=matches[0],origin=associations[0].value,generation=origin.bufferGeneration??0;
    if(generation!==bufferGeneration)throw Error('discussion_recovery_cleared_source');
    const found=await resolveCmcpHistorySource({provider:history,pointer});
    if(found.status!=='found'||found.evidence.sourceAuthorRole!=='user')throw Error('discussion_recovery_source_unavailable');
    const source=found.evidence,state=await eventStatus(selected),processing=(state.processing??[]).findLast(row=>cmcpSourcePointerKey(row.pointer)===cmcpSourcePointerKey(pointer)),prior=await automaticDiscussions.latest(pointer);
    const marker=processing?.sourceValidation;
    if(!['committed','unchanged'].includes(processing?.eventProcessing)&&!(prior?.sourceVerified&&prior.sourceHash===loopHash(source))
      &&!(marker?.status==='verified'&&marker.sourceAuthorRole==='user'&&marker.evidenceHash===loopHash(source)&&cmcpSourcePointerKey(marker.pointer)===cmcpSourcePointerKey(pointer)))throw Error('discussion_recovery_source_not_validated');
    const read=await stores.eventStore(selected.event).readEvent({sourceUpdateIds:[]});if(!['found','missing'].includes(read.status))throw Error('event_unavailable');
    const eventVersion=loopHash(read.internal?.records??[]),sourceHash=loopHash(source),canApply=async()=>{
      if(!enabled||clean||generation!==bufferGeneration||!await canContinue())return false;
      const current=await stores.eventStore(selected.event).readEvent({sourceUpdateIds:[]}),exact=await resolveCmcpHistorySource({provider:history,pointer});
      return ['found','missing'].includes(current.status)&&loopHash(current.internal?.records??[])===eventVersion&&exact.status==='found'&&loopHash(exact.evidence)===sourceHash;
    };
    busy=true;interruptProactive('discussion_recovery');
    try{
      if(!await canApply())throw Error('discussion_cancelled_or_stale');
      const prepared=await automaticDiscussions.prepare({eventKey:selected.key,source,bufferGeneration:generation});let association=prepared.internal.alreadyAssociated,modelCalls=0;
      if(!association){
        const response=await adapter.request('discussion_recover',{event:selected.event,
          source:{ref:'input',sourceAuthorRole:'user',text:source.content.body,messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt},discussionContext:prepared.model},
          {canAttempt:canApply});modelCalls=1;
        await journal.append('discussion_recovery_proposal',{pointer,eventVersion,sourceHash,proposal:response.value,transport:response.transport??null,bufferGeneration:generation});
        if(!await canApply())throw Error('discussion_cancelled_or_stale');
        association=await withCmcpBufferPublication({root,scopeId},async()=>automaticDiscussions.apply({prepared,source,proposal:response.value?.discussion,eventVersion,
          canApply:async()=>await canApply()&&(await readCmcpBufferBoundary({root,scopeId})).generation===generation}));
      }
      // Existing reply intents are formal generation bindings, not adjacent timestamps.
      // A source missing from History stays unavailable; recovery never creates it.
      const replyIntents=(await createLocalLoopJournal({root:path.join(eventRoot(selected),'focus'),name:'local-focus-v1'}).read()).map(row=>row.record)
        .filter(row=>row.kind==='assistant_reply_planned'&&cmcpSourcePointerKey(row.value.replyTo)===cmcpSourcePointerKey(pointer));
      const unavailableReplies=[];
      for(const {value:reply} of replyIntents){
        const assistant=await resolveCmcpHistorySource({provider:history,pointer:reply.pointer});
        if(assistant.status!=='found'||loopHash(assistant.evidence)!==reply.sourceHash){unavailableReplies.push({pointer:reply.pointer,status:'unavailable'});continue;}
        if(reply.replyToEvidenceHash!==sourceHash||assistant.evidence.sourceAuthorRole!=='assistant'||assistant.evidence.pointer.scopeId!==scopeId)throw Error('reply_binding_source_mismatch');
        if(!await canApply())throw Error('discussion_cancelled_or_stale');
        // Recover the exact association interrupted after durable History save.
        // The formal generated reply intent supplies event/parent identity; time
        // adjacency and similar text are never used as relationship evidence.
        const recorded=(await journal.read()).some(row=>row.record.kind==='source_association'&&cmcpSourcePointerKey(row.record.value.pointer)===cmcpSourcePointerKey(reply.pointer)
          &&JSON.stringify(row.record.value.event)===JSON.stringify(selected.event));
        if(!recorded)await journal.append('source_association',{pointer:reply.pointer,event:selected.event,bufferGeneration:generation,basis:'verified_saved_reply_intent'});
        await register(reply.pointer);
        await automaticDiscussions.recordReply({source:assistant.evidence,replyTo:pointer,replyToEvidenceHash:reply.replyToEvidenceHash,eventKey:selected.key,eventVersion:reply.eventVersion,bufferGeneration:generation});
      }
      await refreshEvents();
      const assistantDiscussion=await withCmcpBufferPublication({root,scopeId},async()=>automaticDiscussions.attachReplies({userPointer:pointer,eventKey:selected.key,bufferGeneration:generation,
        canApply:async()=>await canApply()&&(await readCmcpBufferBoundary({root,scopeId})).generation===generation}));
      const result={status:association.status==='associated'&&!assistantDiscussion.some(row=>row.status==='pending')&&!unavailableReplies.length?'accepted':'pending',recovery:true,recoveryMode:'discussion_only',pointer,
        eventProcessing:processing?.eventProcessing??'pending',eventMutation:'none',dialogueMutation:'none',answerGeneration:'not_requested',discussionAssociation:association,assistantDiscussion,
        unavailableReplies,sourceTime:source.messageRecordedAt,originalUserTime:state.lastUserAt,originalExpiry:state.expiry,focusActivation:'unchanged',modelCalls,replayed:!!prepared.internal.alreadyAssociated};
      await journal.append('discussion_recovery_result',result);return result;
    }finally{busy=false;if(persistentFocus)resumeProactive();}
  }
  async function clearBuffer({scopeId:requestedScope=scopeId}={}){
    if(readOnly)throw Error('read_only_common_input');
    if(requestedScope!==scopeId)throw Error('buffer_scope_mismatch');
    if(bufferClearPending)throw Error('buffer_clear_in_progress');
    const next=bufferGeneration+1;if(!Number.isSafeInteger(next))throw Error('buffer_generation_exhausted');
    // Invalidate immediately. Durable acknowledgement follows the same short
    // publication boundary used by read activation, never a model wait.
    bufferGeneration=next;selectedFocus=null;interruptProactive('buffer_cleared');applyProactiveControl();
    const operation=withCmcpBufferPublication({root,scopeId},async()=>{
      const previous=await readCmcpBufferBoundary({root,scopeId});
      if(previous.generation!==next-1)throw Error('buffer_generation_conflict');
      const at=resolveCmcpTimeContext({now:clock(),timezone}).now;
      await journal.append('buffer_clear',{generation:next,scopeId,clearedAt:at});clearedAt=at;
      return {status:'cleared',scopeId,generation:next,clearedAt:at,historyMutation:'none',eventMutation:'none',modelCalls:0};
    });
    bufferClearPending=operation;
    try{return await operation;}finally{bufferClearPending=null;}
  }
  async function resumeConversation({pointer}){
    if(readOnly||busy)throw Error('runtime_not_writable_or_busy');
    if(!enabled||clean||!await canContinue())throw Error('resume_source_disabled');
    const key=cmcpSourcePointerKey(pointer);
    if(pointer.scopeId!==scopeId)throw Error('resume_source_scope_mismatch');
    const associations=(await journal.read()).map(row=>row.record).filter(row=>row.kind==='source_association'&&cmcpSourcePointerKey(row.value.pointer)===key);
    const matches=events.filter(item=>associations.some(row=>JSON.stringify(row.value.event)===JSON.stringify(item.event)));
    if(matches.length!==1)throw Error('conversation_recovery_requires_one_existing_association');
    const item=matches[0],generation=associations[0].value.bufferGeneration??0;
    if(generation!==bufferGeneration)throw Error('conversation_recovery_cleared_source');
    const exact=await resolveCmcpHistorySource({provider:history,pointer});
    if(exact.status!=='found'||exact.evidence.sourceAuthorRole!=='user')throw Error('conversation_recovery_source_unavailable');
    const sourceHash=loopHash(exact.evidence),before=await eventStatus(item);
    const verified=processing=>['committed','unchanged'].includes(processing?.eventProcessing)
      ||processing?.sourceValidation?.status==='verified'&&processing.sourceValidation.sourceAuthorRole==='user'
        &&processing.sourceValidation.evidenceHash===sourceHash&&cmcpSourcePointerKey(processing.sourceValidation.pointer)===key;
    const stages={};let processing=(before.processing??[]).findLast(row=>cmcpSourcePointerKey(row.pointer)===key);
    if(!verified(processing)){
      // A complete old semantic response can contain a separately valid read
      // plan even when its Event preview was rejected. Revalidate that saved
      // source stage before considering another semantic model operation.
      busy=true;interruptProactive('conversation_source_revalidation');let loop;
      try{loop=await openLoop(item,{generation});stages.source=await loop.validateAnswerRecoverySource(pointer);}
      finally{await loop?.close();busy=false;if(persistentFocus)resumeProactive();}
      processing=((await eventStatus(item)).processing??[]).findLast(row=>cmcpSourcePointerKey(row.pointer)===key);
    }
    if(!verified(processing)){
      stages.event=await api.resumeEventSource({pointer,stage:'event'});
      processing=((await eventStatus(item)).processing??[]).findLast(row=>cmcpSourcePointerKey(row.pointer)===key);
    }else stages.event={status:'already_processed',eventProcessing:processing.eventProcessing,modelCalls:0};
    if(!verified(processing))return {status:'pending',pointer,stages,code:'conversation_source_not_validated',recoveryMode:'conversation'};
    const valid=async()=>enabled&&!clean&&generation===bufferGeneration&&await canContinue();
    if(!await valid())throw Error('conversation_recovery_cancelled_or_stale');
    if(automaticDiscussions)stages.discussion=processing.sourceValidation?.validationScope==='original_user_for_independent_answer'
      ?{status:'pending',code:'independent_answer_does_not_accept_discussion',modelCalls:0}
      :await resumeDiscussion({pointer});
    if(!await valid())throw Error('conversation_recovery_cancelled_or_stale');
    busy=true;interruptProactive('conversation_recovery');let loop;
    try{
      loop=await openLoop(item,{generation});stages.answer=await loop.resumeAnswer(pointer);
      await refreshEvents();
      if(!await valid())throw Error('conversation_recovery_cancelled_or_stale');
      const state=await eventStatus(item),current=(state.processing??[]).findLast(row=>cmcpSourcePointerKey(row.pointer)===key);
      const result={status:['answered','already_completed'].includes(stages.answer.status)&&(!stages.discussion||stages.discussion.status==='accepted')?'accepted':'pending',
        recovery:true,recoveryMode:'conversation',pointer,stages,eventProcessing:current?.eventProcessing??'pending',dialogueProcessing:current?.dialogueProcessing??'pending',
        originalUserTime:before.lastUserAt,originalExpiry:before.expiry,sourceTime:exact.evidence.messageRecordedAt,focusActivation:'unchanged',sourceResaved:false};
      await journal.append('conversation_recovery_result',result);return result;
    }finally{await loop?.close();busy=false;if(persistentFocus)resumeProactive();}
  }
  async function refreshEvents({sourceCatalog=null,valid=null}={}){
    const captured=bufferGeneration;
    valid??=async()=>enabled&&!clean&&captured===bufferGeneration&&await canContinue();
    if(!sourceCatalog&&catalog.withBatch)return catalog.withBatch(scoped=>refreshEvents({sourceCatalog:scoped,valid}),{valid});
    sourceCatalog??=catalog;
    if(!await valid())throw Error('catalog_batch_cancelled');
    const known=(await journal.read()).filter(row=>row.record.kind==='source_association').map(row=>row.record.value);
    const entries=new Map((await sourceCatalog.list()).map(row=>[cmcpSourcePointerKey(row.pointer),row]));
    const failures=[];
    for(const item of events){
      const status=await eventStatus(item);if(status.status==='missing')continue;
      const pointers=new Map(known.filter(row=>JSON.stringify(row.event)===JSON.stringify(item.event)).map(row=>[cmcpSourcePointerKey(row.pointer),row.pointer]));
      for(const row of status.sourceChecks??[])pointers.set(cmcpSourcePointerKey(row.pointer),row.pointer);
      for(const pointer of pointers.values()){
        if(!await valid())throw Error('catalog_batch_cancelled');
        const processing=(status.processing??[]).findLast(row=>cmcpSourcePointerKey(row.pointer)===cmcpSourcePointerKey(pointer));
        const entry=entries.get(cmcpSourcePointerKey(pointer));
        const isLatestUser=status.sourceChecks?.at(-1)&&cmcpSourcePointerKey(status.sourceChecks.at(-1).pointer)===cmcpSourcePointerKey(pointer);
        try{await sourceCatalog.annotate({pointer,event:item.event,dialogue:isLatestUser?status.dialogue:null,
          eventProcessing:processing?.eventProcessing??(entry?.sourceAuthorRole==='user'?'pending':'not_requested'),
          dialogueProcessing:processing?.dialogueProcessing??'not_requested'});}
        catch(error){if(error.message==='catalog_batch_cancelled')throw error;
          failures.push({pointer,code:error.message});await note('annotation_pending',{pointer,code:error.message});}
      }
    }
    return failures;
  }
  async function inventoryPages({cursor=null,maxPages=catalogResources.maxSegments+1}={}){
    if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>1025)throw Error('invalid_registration_recovery_budget');
    if(!original.listPointerPage)return original.listPointers({scopeId,maxRecords:capacity.maxSources});
    const pointers=[],failures=[];let page=null,pages=0,nextCursor=cursor;
    do{page=await original.listPointerPage({scopeId,maxRecords:capacity.maxSources,cursor:nextCursor});pages++;
      pointers.push(...page.pointers);failures.push(...page.failures??[]);nextCursor=page.nextCursor??null;
      if(!['partial','complete'].includes(page.status))break;
    }while(nextCursor&&pages<maxPages);
    return {...page,status:failures.length?'unavailable':page.status==='complete'?'complete':page.status,pointers,failures,pages,nextCursor};
  }
  async function recover(options={}){
    if(readOnly)throw Error('read_only_common_input');
    if(!enabled||clean)return {status:'not_run_disabled',modelCalls:0};
    recovered=true; // One automatic recovery attempt per session; explicit recover remains available.
    const inventory=await inventoryPages(options);
    if(!['complete','partial'].includes(inventory.status))return {status:'pending',inventory,modelCalls:0};
    const pending=[],captured=bufferGeneration,valid=async()=>enabled&&!clean&&captured===bufferGeneration&&await canContinue();
    const reconcile=async sourceCatalog=>{
      const registerAll=async sourceIndex=>{for(const pointer of inventory.pointers){
        if(!await valid())throw Error('catalog_batch_cancelled');
        const result=await register(pointer,{sourceCatalog,sourceIndex});if(result.status==='pending')pending.push({pointer,...result});
      }};
      if(localIndex?.withBatch)await localIndex.withBatch(registerAll,{catalog:sourceCatalog,valid});else await registerAll(localIndex);
      pending.push(...await refreshEvents({sourceCatalog,valid}));
    };
    if(catalog.withBatch)await catalog.withBatch(reconcile,{valid});else await reconcile(catalog);
    recovered=true;
    return {status:pending.length?'pending':inventory.status==='complete'?'complete':'partial',sources:inventory.pointers.length,pending,
      inventory:{status:inventory.status,recordCount:inventory.recordCount,pages:inventory.pages,nextCursor:inventory.nextCursor},modelCalls:0};
  }
  async function status(){
    const inventory=await inventoryPages();
    const sources=await catalog.list(),registered=new Set(sources.map(entry=>cmcpSourcePointerKey(entry.pointer)));
    const registrationRecords=(await journal.read()).filter(row=>row.record.kind==='registration_pending').map(row=>row.record.value);
    const knownPointers=new Map((inventory.pointers??[]).map(pointer=>[cmcpSourcePointerKey(pointer),pointer]));
    for(const row of registrationRecords)if(row.pointer?.scopeId===scopeId)knownPointers.set(cmcpSourcePointerKey(row.pointer),row.pointer);
    const unregistered=[...knownPointers.values()].filter(pointer=>!registered.has(cmcpSourcePointerKey(pointer)));
    const registrationFailures=unregistered.map(pointer=>({pointer,code:registrationRecords.findLast(row=>cmcpSourcePointerKey(row.pointer)===cmcpSourcePointerKey(pointer))?.code??'not_registered'}));
    const eventStates=[],conversationRecoveries=[];for(const item of events){eventStates.push({key:item.key,...await eventStatus(item)});
      const stages=(await createLocalLoopJournal({root:path.join(eventRoot(item),'focus'),name:'local-focus-v1'}).read()).map(row=>row.record);
      eventStates.at(-1).answerHistory={enabled:!!answerHistoryAccess,maxSelectedSources:answerHistory.maxSelectedSources,latestRead:stages.findLast(row=>row.kind==='answer_history_read')?.value??null,
        latestPlan:stages.findLast(row=>row.kind==='preview'&&row.value.answerHistoryPrepared)?.value.answerHistoryPlan??null};
      const requested=new Map(stages.filter(row=>row.kind==='conversation_stage_plan'&&row.value.answerRequested===true
        ||row.kind==='failure'&&row.value.pointer&&row.value.code==='semantic_preview_not_ready').map(row=>[cmcpSourcePointerKey(row.value.pointer),row.value.pointer]));
      for(const [key,pointer]of requested){const result=stages.findLast(row=>row.kind==='answer_result'&&cmcpSourcePointerKey(row.value.pointer)===key);
        if(result?.value.status!=='completed')conversationRecoveries.push({pointer,eventKey:item.key,status:'pending',reason:result?.value.code??'answer_stage_requires_inspection'});}
    }
    const latest=await readCmcpHistoryReactivationStatus({stores,maxEntries:capacity.maxSources,
      timeContext:temporalFor(),ttlMs:loopTiming?.ttlMs});
    const receipts=(await journal.read()).filter(row=>['submission','reactivation','registration_pending','annotation_pending'].includes(row.record.kind)).map(row=>row.record);
    const selectedState=selectedFocus?eventStates.find(item=>item.key===selectedFocus.key):null;
    const qualification=selectedState?{
      dialogueStatus:selectedState.dialogue?.status??'unknown',pendingCount:selectedState.pending?.length??0,
      supportedPointersAvailable:!!selectedState.dialogue?.supports?.length&&selectedState.dialogue.supports.every(support=>
        selectedState.sourceChecks?.some(check=>check.status==='found'&&cmcpSourcePointerKey(check.pointer)===cmcpSourcePointerKey(support.pointer))),
      unexpired:selectedState.expiry!==null&&selectedState.expiry!==undefined&&
        resolveCmcpTimeContext({now:clock(),timezone}).nowEpochMs<resolveCmcpTimeContext({now:selectedState.expiry,timezone}).nowEpochMs,
      lastUserAt:selectedState.lastUserAt,expiry:selectedState.expiry,
      finalEvaluation:'source_hash_event_version_activity_window_and_controls_rechecked_by_executor'
    }:null;
    if(qualification){
      const currentProgress=loopHash([selectedFocus.event,selectedState.eventVersion,
        (selectedState.dialogue?.supports??[]).map(support=>({pointer:support.pointer,citation:support.citation}))]);
      qualification.alreadyAttempted=(selectedState.sends??[]).some(send=>send.key===currentProgress);
      qualification.reason=qualification.pendingCount?'source_pending':qualification.dialogueStatus!=='open'?qualification.dialogueStatus:
        !qualification.supportedPointersAvailable?'source_unavailable':!qualification.unexpired?'expired':
        qualification.alreadyAttempted?'deduplicated':'awaiting_executor_recheck';
      qualification.status=qualification.reason==='awaiting_executor_recheck'?'eligible_for_runtime_recheck':'ineligible';
    }
    return {kind:'incremental_catalog_status',scopeId,registration:{inventoryStatus:inventory.status,inventoryComplete:inventory.status==='complete',
      inventoryRecordCount:inventory.recordCount,inventoryFailures:inventory.failures??[],inventoryNextCursor:inventory.nextCursor??null,
      registered:sources.length,unregistered,failures:registrationFailures,capacity:await catalog.capacity?.()??null,sources},
      events:eventStates,conversationRecoveries,focus:latest.focus,latestRecall:latest.latestRecall,bufferBeforeLastActivation:latest.bufferBeforeLastActivation,controls:{enabled,clean,proactive},receipts,
      proactive:{selectedEventKey:selectedFocus?.key??null,event:selectedFocus?.event??null,executor:retainedLoop?'local_timer':'not_started',
        qualification,
        ...retainedLoop?.proactiveState,
        ...(retainedLoop?{}:{enabled:enabled&&!clean&&proactive,timerScheduled:false,generating:false,eligible:false,
          reason:readOnly?'read_only_status':!enabled||clean||!proactive?'disabled':'no_confirmed_focus'}),
        focus:retainedLoop?.snapshot??selectedState},
      ...(localIndex?{localCandidates:await localIndex.status(),capacity:copy(capacity)}:{}),
      discussionAssociation:automaticDiscussions?await automaticDiscussions.status():{enabled:false,modelCalls:0},modelCalls:0,originalTimesNotRefreshed:true};
  }
  function temporalFor(input){const temporal=resolveCmcpTimeContext(input??{now:clock(),timezone});
    if(temporal.timezone!==timezone)throw Error('input_timezone_mismatch');return temporal;}
  async function bufferList({timeContext,scopeId:requestedScope=scopeId}={}){
    if(requestedScope!==scopeId)throw Error('buffer_scope_mismatch');
    const temporal=temporalFor(timeContext),generation=bufferGeneration;
    const [snapshot,sources,records]=await Promise.all([
      readCmcpHistoryReactivationStatus({stores,maxEntries:capacity.maxSources,timeContext:temporal,ttlMs:loopTiming?.ttlMs}),
      catalog.list(),journal.read()]);
    const byPointer=new Map(sources.map(source=>[cmcpSourcePointerKey(source.pointer),source]));
    const sourceChecks=new Map();
    const sourceTimes=pointers=>Promise.all(pointers.map(async pointer=>{
      const key=cmcpSourcePointerKey(pointer),source=byPointer.get(key);
      if(!sourceChecks.has(key))sourceChecks.set(key,resolveCmcpHistorySource({provider:original,pointer}));
      const found=await sourceChecks.get(key),matched=found.status==='found'&&(!source||source.evidenceHash===loopHash(found.evidence));
      const evidence=matched?found.evidence:null;
      return {pointer:copy(pointer),sourceAuthorRole:evidence?.sourceAuthorRole??source?.sourceAuthorRole??null,
        messageRecordedAt:evidence?.messageRecordedAt??source?.messageRecordedAt??null,eventOccurredAt:evidence?.eventOccurredAt??source?.eventOccurredAt??null,
        resolveStatus:matched?'found':found.status==='found'?'changed':found.status,
        sourceAvailability:evidence?.metadata?.availability??'unknown'};
    }));
    const entries=[];
    for(const entry of snapshot.focus.retainedBuffer??[]){
      const current=(entry.lifecycle?.generation??0)===bufferGeneration&&generation===bufferGeneration;
      const times=await sourceTimes([entry.pointer]),available=times.every(source=>source.resolveStatus==='found');
      const active=current&&entry.lifecycle?.status==='active'&&available;
      entries.push({kind:'recall',sourceRefs:[copy(entry.pointer)],event:copy(entry.eventLink?.event??byPointer.get(cmcpSourcePointerKey(entry.pointer))?.eventScope??null),
        sourceTimes:times,activatedAt:entry.activatedAt,expiry:entry.lifecycle?.expiry??entry.expiry??null,
        active,reason:!current?'cleared':!available?'source_unavailable':entry.lifecycle?.reason??'unknown',proactiveEligible:false,
        proactiveReason:'purposeful_recall_does_not_grant_proactive',generation:entry.lifecycle?.generation??0});
    }
    const eventSelections=new Map();
    for(const {record} of records){const value=record.value;
      if(record.kind==='focus_selection'||record.kind==='submission'&&value?.eventKey&&value.result?.focus?.supports?.length
        &&(value.result.status==='accepted'||value.result.focus.status==='closed'))eventSelections.set(value.eventKey,value);
    }
    for(const item of events){const selected=eventSelections.get(item.key);if(!selected)continue;
      const state=await eventStatus(item),pointers=state.dialogue?.supports?.map(support=>support.pointer)??[];
      const entryGeneration=selected.bufferGeneration??0,current=entryGeneration===bufferGeneration&&generation===bufferGeneration;
      const unexpired=!!state.expiry&&temporal.nowEpochMs<resolveCmcpTimeContext({now:state.expiry,timezone}).nowEpochMs;
      const times=await sourceTimes(pointers),available=!!pointers.length&&times.every(source=>source.resolveStatus==='found');
      const isFocus=selectedFocus?.key===item.key,active=current&&isFocus&&unexpired&&available;
      const reason=!current?'cleared':!isFocus?'not_current_focus':!unexpired?'expired':!available?'source_unavailable':'active';
      const progress=loopHash([item.event,state.eventVersion,(state.dialogue?.supports??[]).map(support=>({pointer:support.pointer,citation:support.citation}))]);
      const proactiveReason=!active?reason:state.pending?.length?'source_pending':state.dialogue?.status!=='open'?(state.dialogue?.status??'unknown'):
        !available?'source_unavailable':(state.sends??[]).some(send=>send.key===progress)?'deduplicated':!enabled||clean||!proactive?'disabled':
        retainedLoop&&retainedEvent?.key===item.key?retainedLoop.proactiveState.reason:'executor_not_running';
      entries.push({kind:'proactive_focus',eventKey:item.key,event:copy(item.event),sourceRefs:copy(pointers),sourceTimes:times,
        context:{kind:'derived_dialogue',status:state.dialogue?.status??'unknown',synopsis:state.dialogue?.synopsis??''},
        activatedAt:state.lastUserAt,expiry:state.expiry??null,active,reason,generation:entryGeneration,
        pendingCount:state.pending?.length??0,proactiveEligible:proactiveReason==='eligible',proactiveReason,
        lastPresentation:copy(state.sends?.at(-1)??null)});
    }
    // A clear may finish during the read-only inspection. Never show its old
    // snapshot as active; the next status can refresh the retained observations.
    if(generation!==bufferGeneration)for(const entry of entries){entry.active=false;entry.reason='cleared';entry.proactiveEligible=false;entry.proactiveReason='cleared';}
    if(!features.buffer)for(const entry of entries){entry.active=false;entry.reason='buffer_disabled';entry.proactiveEligible=false;entry.proactiveReason='buffer_disabled';}
    const items=entries.filter(entry=>entry.active),retained=entries.filter(entry=>!entry.active);
    return {kind:'cmcp_buffer_list',scopeId,generation:bufferGeneration,clearedAt,items,retained,activeCount:items.length,
      evaluatedAt:temporal.now,timezone,modelCalls:0,originalTimesNotRefreshed:true};
  }
  async function ingest({text,role='user',contentKind='source_excerpt',pointer,eventKey=null,timeContext,
    messageRecordedAt,eventOccurredAt=null,availability='partial'}){
    if(readOnly||!await canContinue())throw Error('read_only_or_cancelled_input');
    if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>capacity.maxSourceBytes)throw Error('invalid_source_input_or_storage_byte_limit');
    const selected=eventKey===null?null:events.find(item=>item.key===eventKey);
    if(eventKey!==null&&!selected)throw Error('event_outside_authorized_collection');
    const temporal=temporalFor(timeContext),evidence=createCmcpSourceEvidence({
      pointer:pointer??{version:1,providerNamespace:original.descriptor.providerNamespace,scopeId,sessionId,itemId:randomUUID(),revisionId:'r1'},
      sourceKind:role==='tool'?'tool_result':'message',sourceAuthorRole:role,messageRecordedAt:messageRecordedAt===undefined?temporal.now:messageRecordedAt,
      eventOccurredAt,content:{kind:contentKind,body:text},metadata:{availability}});
    if(evidence.pointer.scopeId!==scopeId)throw Error('source_outside_authorized_collection');
    const result=await history.writeEvidence(evidence);
    if(!['stored','unchanged'].includes(result.status))throw Error('source_history_write_failed');
    if(selected){await note('source_association',{pointer:evidence.pointer,event:selected.event});
      try{await catalog.annotate({pointer:evidence.pointer,event:selected.event,eventProcessing:'pending',dialogueProcessing:'not_requested'});}
      catch(error){await note('annotation_pending',{pointer:evidence.pointer,code:error.message});}}
    await note('raw_source_ingest',{pointer:evidence.pointer,status:result.status,eventProcessing:selected?'pending':'not_requested',
      dialogueProcessing:'not_requested',registration:result.registration?.status});
    return {...result,queryPointer:role==='user'?evidence.pointer:undefined,pointer:evidence.pointer,evidence,
      eventProcessing:selected?'pending':'not_requested',dialogueProcessing:'not_requested',modelCalls:0};
  }
  async function localCandidates({text,timeContext,ticket,representation,savedQueryPointer=null}){
    const generation=bufferGeneration,candidateBufferTtlMs=activationTtlMs;
    if(!localIndex)throw Error('local_retrieval_not_configured');
    if(!enabled||clean||!features.historyRecall)return {host:{question:text,status:'unaugmented',candidates:[],ticket:null},internal:{modelCalls:0,queryPointer:null}};
    if(bufferClearPending)await bufferClearPending;
    if(generation!==bufferGeneration)throw Error('buffer_cleared_during_operation');
    if(representation!==undefined&&representation!=='registered_event_groups')throw Error('invalid_local_candidate_representation');
    if(typeof text!=='string'||Buffer.byteLength(text)>localRetrieval.maxQueryBytes||typeof ticket!=='string')throw Error('invalid_local_candidate_input');
    let temporal=temporalFor(timeContext);const saved=await prepareReadingQuery({text,ticket,temporal,savedQueryPointer});
    temporal=temporalFor({now:saved.queryBinding.queryTime,timezone});
    await note('history_lookup_request',{...saved.queryBinding,ticket});
    const queryId=saved.pointer?loopHash(cmcpSourcePointerKey(saved.pointer)):null,entries=(await catalog.list()).filter(entry=>entry.id!==queryId),ids=entries.map(entry=>entry.id);
    const lookupPointers=collectCmcpHistoryLookupPointers({scopeId,activityRecords:(await journal.read()).map(row=>row.record)});
    const sourceUses=Object.fromEntries(entries.map(entry=>[entry.id,lookupPointers.has(cmcpSourcePointerKey(entry.pointer))?'history_lookup_request':'source_record']));
    if(generation!==bufferGeneration||!await canContinue())throw Error('reactivation_cancelled');
    const result=await localIndex.search({text,enabled,clean,allowedSourceIds:ids,representation,sourceUses});
    if(generation!==bufferGeneration||!await canContinue())throw Error('reactivation_cancelled');
    return {host:{question:text,status:result.status,ticket,candidates:result.candidates,
      coverage:'bounded_lexical_candidates_not_history_exhaustion',requiresSelection:true},
      internal:{...saved.queryBinding,sourceMap:result.sourceMap,bufferGeneration:generation,bufferTtlMs:candidateBufferTtlMs,
        diagnostics:result.diagnostics,sourceProcessing:'not_requested',modelCalls:0}};
  }
  async function localRead({candidateResult,refs,timeContext,answer=false,continuation=null,readHistory=[],queryText}){
    const generation=bufferGeneration;
    if(!localIndex)throw Error('local_retrieval_not_configured');
    if(!enabled||clean||!features.historyRecall)return {host:{question:'',retrieval:{status:'unaugmented',coverage:'none'},context:null},internal:{modelCalls:0}};
    if(bufferClearPending)await bufferClearPending;
    if(generation!==bufferGeneration)throw Error('buffer_cleared_during_operation');
    if(readOnly||!await canContinue())throw Error('read_only_or_cancelled_input');
    if((candidateResult?.internal?.bufferGeneration??0)!==generation)throw Error('buffer_receipt_stale');
    if(!(candidateResult?.internal?.queryPointer||candidateResult?.internal?.queryAuthorization)||candidateResult.host?.status!=='requires_host_selection'||!Array.isArray(refs)
      ||!refs.length||refs.length>localRetrieval.maxReadSources||new Set(refs).size!==refs.length)throw Error('invalid_local_read_selection');
    const selectedMap=refs.map(ref=>candidateResult.internal.sourceMap.find(item=>item.ref===ref));
    if(selectedMap.some(item=>!item))throw Error('local_read_reference_out_of_scope');
    const queryPointer=candidateResult.internal.queryPointer;
    const query=await resolveCmcpReadingQuery({history:original,scopeId,binding:candidateResult.internal});
    if(query.queryAuthorization){
      if(answer||queryText!==undefined){assertCmcpEphemeralQueryText(query.queryAuthorization,queryText??candidateResult.host.question);
        candidateResult=copy(candidateResult);candidateResult.host.question=queryText??candidateResult.host.question;}
    }else if(query.content.kind!=='source_excerpt'||query.content.body!==candidateResult.host.question)throw Error('local_read_query_binding');
    const entries=await catalog.list(),candidateEntries=new Map(candidateResult.internal.sourceMap.map(item=>{
      const entry=entries.find(row=>row.id===item.id);if(!entry||entry.pointer.scopeId!==scopeId
        ||cmcpSourcePointerKey(entry.pointer)!==cmcpSourcePointerKey(item.pointer)||entry.evidenceHash!==item.evidenceHash)throw Error('local_read_source_binding');
      return [cmcpSourcePointerKey(item.pointer),{entry,mapping:item}];
    }));
    if(!Array.isArray(readHistory)||readHistory.length>localRetrieval.maxReadBytes)throw Error('invalid_local_read_history');
    const priorRanges=new Map();let priorSourceBytes=0,priorProjectionBytes=0;
    // Runtime supplies only completed, same-ticket receipts. These checks retain the
    // source/query binding and accounting when the internal callable is composed directly.
    for(const prior of readHistory){
      if(!['context_ready','answered','source_insufficient'].includes(prior?.host?.retrieval?.status)
        ||cmcpReadingQueryKey(prior.internal)!==cmcpReadingQueryKey(candidateResult.internal)
        ||!Array.isArray(prior.internal.readRanges)||!prior.internal.readRanges.length
        ||!Number.isSafeInteger(prior.internal.sourceBytes)||prior.internal.sourceBytes<1
        ||!Number.isSafeInteger(prior.internal.projectionBytes)||prior.internal.projectionBytes!==jsonBytes(prior.host.context))throw Error('invalid_local_read_history');
      let bytes=0;for(const recorded of prior.internal.readRanges){
        const key=cmcpSourcePointerKey(recorded.pointer),known=candidateEntries.get(key);
        if(!known||recorded.status!=='found'||recorded.evidenceHash!==known.entry.evidenceHash
          ||!validReadRange(recorded.location,known.entry.location.end)||!Number.isSafeInteger(recorded.bytes)||recorded.bytes<1
          ||recorded.storedContentCodePoints!==undefined&&recorded.storedContentCodePoints!==known.entry.location.end)throw Error('local_read_history_source_binding');
        bytes+=recorded.bytes;priorRanges.set(key,[...(priorRanges.get(key)??[]),recorded.location]);
      }
      if(bytes!==prior.internal.sourceBytes)throw Error('invalid_local_read_history_accounting');
      priorSourceBytes+=bytes;priorProjectionBytes+=prior.internal.projectionBytes;
    }
    if(priorRanges.size>localRetrieval.maxReadSources||priorSourceBytes>=localRetrieval.maxReadBytes||priorProjectionBytes>=localRetrieval.maxProjectionBytes)throw Error('local_read_cumulative_budget_exhausted');
    if(continuation!==null){
      if(!continuation||typeof continuation!=='object'||Object.keys(continuation).some(key=>!['ref','range'].includes(key))
        ||refs.length!==1||continuation.ref!==refs[0])throw Error('invalid_local_read_continuation');
      const item=selectedMap[0],key=cmcpSourcePointerKey(item.pointer),known=candidateEntries.get(key),ranges=mergeReadRanges(priorRanges.get(key)??[]);
      if(!ranges.length||!validReadRange(continuation.range,known.entry.location.end))throw Error('continuation_requires_previously_read_source');
      const {start,end}=continuation.range;
      const covered=ranges.reduce((total,range)=>total+Math.max(0,Math.min(end,range.end)-Math.max(start,range.start)),0);
      if(!ranges.some(range=>start<=range.end&&end>=range.start)||covered>=end-start)throw Error('continuation_must_extend_adjacent_read_range');
    }
    const selected=selectedMap.map(item=>{
      const entry=entries.find(row=>row.id===item.id);
      if(!entry||entry.pointer.scopeId!==scopeId||cmcpSourcePointerKey(entry.pointer)!==cmcpSourcePointerKey(item.pointer)
        ||entry.evidenceHash!==item.evidenceHash)throw Error('local_read_source_binding');
      const candidate=candidateResult.host.candidates.find(row=>row.ref===item.ref);
      if(!candidate||JSON.stringify(item.range)!==JSON.stringify(candidate.excerpt.location))throw Error('local_read_range_binding');
      return {...entry,readRange:continuation?copy(continuation.range):item.range,projectionRef:'r'+item.ref.slice(1)};});
    const allReadSources=new Set([...priorRanges.keys(),...selected.map(entry=>cmcpSourcePointerKey(entry.pointer))]);
    if(allReadSources.size>localRetrieval.maxReadSources)throw Error('local_read_cumulative_source_budget');
    const temporal=temporalFor(timeContext),activeAt=candidateResult.internal.queryTime;
    if(activeAt===null)throw Error('resume_source_time_unknown');
    const expiry=cmcpBufferExpiry(activeAt,loopTiming?.ttlMs);
    const currentTime=()=>timeContext!==undefined&&!persistentFocus?temporal:temporalFor();
    const valid=async()=>generation===bufferGeneration&&enabled&&!clean&&features.historyRecall&&(!expiry||
      currentTime().nowEpochMs<resolveCmcpTimeContext({now:expiry,timezone}).nowEpochMs)&&await canContinue();
    const read=await readCmcpSelectedHistory({stores,selected,temporal,activeAt,valid,limits:{
      maxSourceBytes:localRetrieval.maxReadBytes-priorSourceBytes,maxProjectionBytes:localRetrieval.maxProjectionBytes-priorProjectionBytes,maxMaterializedSourceBytes:capacity.maxSourceBytes}});
    if(read.status!=='found')return {host:{question:candidateResult.host.question,retrieval:{status:read.status,reason:read.reason},context:null},internal:{...read,modelCalls:0}};
    const ranges=new Map([...priorRanges].map(([key,value])=>[key,[...value]]));
    for(const item of read.readRanges){const key=cmcpSourcePointerKey(item.pointer);ranges.set(key,[...(ranges.get(key)??[]),item.location]);}
    const coverage=[...ranges].map(([key,value])=>{const known=candidateEntries.get(key);return {candidateRef:known.mapping.ref,sourceRef:'r'+known.mapping.ref.slice(1),...sourceReadCoverage(known.entry,value)};});
    read.projected.readProgress={kind:'bounded_same_question_read_progress',readsCount:readHistory.length+1,sourceCount:ranges.size,
      sourceBytes:priorSourceBytes+read.sourceBytes,sources:coverage,historyAbsence:'not_established',answerSufficiency:'not_assessed'};
    read.projectionBytes=jsonBytes(read.projected);
    if(priorProjectionBytes+read.projectionBytes>localRetrieval.maxProjectionBytes)throw Error('local_read_cumulative_projection_budget');
    const cumulative={readsCount:readHistory.length+1,sourceCount:ranges.size,sourceBytes:priorSourceBytes+read.sourceBytes,
      projectionBytes:priorProjectionBytes+read.projectionBytes,remaining:{sources:localRetrieval.maxReadSources-ranges.size,
        sourceBytes:localRetrieval.maxReadBytes-priorSourceBytes-read.sourceBytes,projectionBytes:localRetrieval.maxProjectionBytes-priorProjectionBytes-read.projectionBytes}};
    const alreadyActive=selected.filter(entry=>priorRanges.has(cmcpSourcePointerKey(entry.pointer))).map(entry=>entry.id);
    const {before,after}=await activateCmcpHistorySources({stores,selected,query,activeAt,read,valid,
      bufferGeneration:generation,ttlMs:loopTiming?.ttlMs,bufferTtlMs:candidateResult.internal.bufferTtlMs??loopTiming?.ttlMs,timeContext:temporal,
      skipActivation:!features.buffer||alreadyActive.length===selected.length,skipSourceIds:alreadyActive});
    const result={host:{question:candidateResult.host.question,retrieval:{status:'context_ready',coverage:'selected_sources_only',
      answerSufficiency:'not_assessed',sourceBytes:read.sourceBytes,projectionBytes:read.projectionBytes,cumulative,
      projectionByteBasis:'UTF-8 JSON context including readProgress'},context:read.projected},
      internal:{queryPointer,...(query.queryAuthorization?{queryAuthorization:copy(query.queryAuthorization)}:{}),selected:refs,sourceMap:read.sourceMap,readRanges:read.readRanges,sourceBytes:read.sourceBytes,
        materializedSourceBytes:read.materializedSourceBytes,projectionBytes:read.projectionBytes,eventVersions:read.eventVersions,
        bufferBefore:before.buffer,bufferAfter:after.buffer,activeAt,expiry,bufferGeneration:generation,proactiveEligible:false,modelCalls:0,cumulative,
        readRefs:selectedMap.map(item=>({candidateRef:item.ref,sourceRef:'r'+item.ref.slice(1),pointer:item.pointer})),
        continuation:continuation?copy(continuation):null}};
    if(answer){
      const input={question:result.host.question,context:read.projected},reply=await adapter.request('recall_answer',input,{canAttempt:valid});
      const assistantTiming=createCmcpAssistantTiming(temporal,clock);
      if(!await valid())throw Error('reactivation_cancelled');
      if(!validateLoopSchema(reply.value,buildLoopRequest('recall_answer',input).schema))throw Error('invalid_recall_answer_schema');
      if(!reply.value.sourceRefs.length||reply.value.sourceRefs.some(ref=>!Object.hasOwn(read.sourceMap,ref)))throw Error('answer_reference_out_of_scope');
      const saved=features.saveAssistant?await ingest({text:reply.value.text,role:'assistant',timeContext:temporal,messageRecordedAt:assistantTiming.responseReceivedAt}):null;
      assistantTiming.sourceSaveAcknowledgedAt=saved?observeCmcpAssistantTime(clock,temporal.timezone):null;
      await note('reactivation_answer',{queryPointer,answerPointer:saved?.pointer??null,answer:features.saveAssistant?reply.value:null,transport:reply.transport??null,assistantTiming:copy(assistantTiming)});
      result.host.answer=reply.value.text;result.host.retrieval.status=reply.value.evidenceStatus==='sufficient'?'answered':'source_insufficient';
      result.internal.answerPointer=saved?.pointer??null;result.internal.modelCalls=1;result.internal.assistantTiming=assistantTiming;
      try{
        if(!await valid())throw Error('reactivation_cancelled');
        assistantTiming.presentationStartedAt=observeCmcpAssistantTime(clock,temporal.timezone);
        const presented=await delivery.present({kind:'answer',text:reply.value.text,sourcePointer:saved?.pointer??null,sessionId});
        if(presented?.status!=='presented')throw Error('local_presentation_failed');
        assistantTiming.presentationAcknowledgedAt=observeCmcpAssistantTime(clock,temporal.timezone);
      }finally{await note('assistant_timing',{queryPointer,answerPointer:saved?.pointer??null,assistantTiming:copy(assistantTiming)});}
    }
    await createLocalLoopJournal({root:path.join(root,'focus'),name:'local-focus-v1'}).append('reactivation_outcome',{
      queryPointer,status:result.host.retrieval.status,selected:selected.map(entry=>({sourceId:entry.id,pointer:entry.pointer})),
      readRanges:read.readRanges,sourceBytes:read.sourceBytes,projectionBytes:read.projectionBytes,pendingReason:null});
    if(!await valid())throw Error('reactivation_cancelled');
    return result;
  }
  async function localRecall({text,timeContext,ticket}){
    const generation=bufferGeneration;
    if(bufferClearPending)await bufferClearPending;
    if(generation!==bufferGeneration)throw Error('buffer_cleared_during_operation');
    const candidates=await localCandidates({text,timeContext,ticket});
    if(candidates.host.status!=='requires_host_selection')return {host:{question:text,
      retrieval:{status:candidates.host.status,coverage:'bounded_lexical_candidates',historyAbsence:'not_established'},context:null},internal:candidates.internal};
    const input={question:text,catalog:candidates.host.candidates.map(item=>({ref:item.ref,sourceAuthorRole:item.sourceAuthorRole,
      sourceKind:item.sourceKind,messageRecordedAt:item.messageRecordedAt,eventOccurredAt:item.eventOccurredAt,
      sourceHint:item.excerpt,locatorCompleteness:'bounded_excerpt'})),maxSources:localRetrieval.maxReadSources,
      runtimeTime:projectCmcpRuntimeTime({now:candidates.internal.queryTime,timezone})};
    const temporal=temporalFor(timeContext),expiry=cmcpBufferExpiry(candidates.internal.queryTime,loopTiming?.ttlMs);
    const valid=async()=>generation===bufferGeneration&&enabled&&!clean&&features.historyRecall&&(!expiry||
      (timeContext!==undefined&&!persistentFocus?temporal:temporalFor()).nowEpochMs<resolveCmcpTimeContext({now:expiry,timezone}).nowEpochMs)&&await canContinue();
    const selection=await adapter.request('recall_select',input,{canAttempt:valid});
    if(!await valid())throw Error('reactivation_cancelled');
    if(!validateLoopSchema(selection.value,buildLoopRequest('recall_select',input).schema))throw Error('invalid_selection_schema');
    await note('local_recall_selection',{queryPointer:candidates.internal.queryPointer,raw:features.saveUser?selection.value:null,transport:selection.transport??null});
    if(selection.value.status!=='selected'){
      if(selection.value.refs.length||!selection.value.clarification?.trim())throw Error('invalid_selection_disposition');
      return {host:{question:text,retrieval:{status:selection.value.status,reason:selection.value.clarification,
        coverage:'bounded_lexical_candidates',historyAbsence:'not_established'},context:null},internal:{...candidates.internal,modelCalls:1}};
    }
    if(selection.value.clarification!=='')throw Error('invalid_selection_disposition');
    const result=await localRead({candidateResult:candidates,refs:selection.value.refs,timeContext,answer:true});
    result.internal.modelCalls+=1;return result;
  }
  async function readingRevoked(ticket){return locallyRevokedReadings.has(ticket);}
  async function revokeReading({ticket,reason='caller_revoked'}){
    if(readOnly||typeof ticket!=='string'||!ticket||typeof reason!=='string'||!reason||reason.length>256)throw Error('invalid_reading_revocation');
    const existing=revokedReadings.get(ticket);if(existing)return {status:'revoked',...copy(existing),modelCalls:0};
    if(revocationFlights.has(ticket))return revocationFlights.get(ticket);
    const value={scopeId,ticket,reason,revokedAt:temporalFor().now};
    locallyRevokedReadings.add(ticket);
    const flight=(async()=>{await journal.append('reading_revoked',value);revokedReadings.set(ticket,value);
      return {status:'revoked',...copy(value),modelCalls:0};})();
    revocationFlights.set(ticket,flight);
    try{return await flight;}finally{revocationFlights.delete(ticket);}
  }
  function readingValidity({generation,queryTime,timeContext,temporal,ticket}){
    const expiry=cmcpBufferExpiry(queryTime,loopTiming?.ttlMs);
    return async()=>generation===bufferGeneration&&enabled&&!clean&&features.historyRecall&&!await readingRevoked(ticket)&&(!expiry||
      (timeContext!==undefined&&!persistentFocus?temporal:temporalFor()).nowEpochMs<resolveCmcpTimeContext({now:expiry,timezone}).nowEpochMs)&&await canContinue();
  }
  async function prepareReadingQuery({text,ticket,temporal,savedQueryPointer}){
    if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>(localRetrieval?.maxQueryBytes??4096))throw Error('invalid_temporal_reading_question');
    if(!savedQueryPointer&&!features.saveUser){
      const queryAuthorization=createCmcpEphemeralReadingQuery({scopeId,sessionId,operationId:ticket,text,issuedAt:temporal.now});
      const queryBinding={queryPointer:null,queryAuthorization,queryHash:loopHash(queryAuthorization),queryTime:queryAuthorization.issuedAt};
      await onReadingQuery(queryBinding);return {pointer:null,queryBinding};
    }
    let saved;
    if(savedQueryPointer){const found=await resolveCmcpHistorySource({provider:history,pointer:savedQueryPointer});
      if(found.status!=='found'||found.evidence.sourceAuthorRole!=='user'||found.evidence.pointer.scopeId!==scopeId
        ||found.evidence.content.kind!=='source_excerpt'||found.evidence.content.body!==text||found.evidence.messageRecordedAt===null)throw Error('reading_query_source_binding');
      saved={pointer:found.evidence.pointer,evidence:found.evidence};
    }else saved=await ingest({text,timeContext:temporal});
    return {...saved,queryBinding:{queryPointer:saved.pointer,queryHash:loopHash(saved.evidence),queryTime:saved.evidence.messageRecordedAt}};
  }
  async function readingNavigate({text,ticket,timeContext,savedQueryPointer,navigationResult,selection,queryText}){
    if(!enabled||clean||!features.historyRecall)return {host:{kind:'cmcp_reading_navigation',status:'disabled',modelContext:null},internal:{modelCalls:0}};
    if(readOnly)throw Error('read_only_reading');
    const temporal=temporalFor(timeContext),generation=bufferGeneration;
    if(bufferClearPending)await bufferClearPending;
    if(generation!==bufferGeneration||!await canContinue())throw Error('reading_cancelled');
    let internal,prepared;
    if(navigationResult){
      internal=copy(navigationResult.internal);
      if(internal.queryAuthorization){assertCmcpEphemeralQueryText(internal.queryAuthorization,queryText??internal.question);
        internal.question=queryText??internal.question;internal.prepared.input.question=internal.question;}
      const valid=readingValidity({generation:internal.bufferGeneration,queryTime:internal.queryTime,temporal,ticket:internal.navigationTicket});
      if(!await valid())throw Error('reading_cancelled');
      const request=buildLoopRequest('temporal_read_select',internal.prepared.input);
      if(!validateLoopSchema(selection,request.schema))throw Error('invalid_temporal_selection_schema');
      const chosen=normalizeCmcpNaturalTemporalSelection(selection,internal.prepared);
      if(chosen.status!=='needs_navigation'||!(chosen.eventKey||chosen.eventCandidates?.length===1))throw Error('reading_refinement_requires_one_event');
      prepared=refineCmcpNaturalTemporalCatalog({prepared:internal.prepared,eventKey:chosen.eventKey??chosen.eventCandidates[0],
        question:internal.question,events,segments:internal.declaredSegments,entries:internal.registered,timeContext:resolveCmcpTimeContext({now:internal.queryTime,timezone}),
        maxBytes:naturalReading?.maxCatalogBytes??localRetrieval?.maxCandidateBytes??6000});
      if(prepared.refinement.status!=='locators_ready')return {host:{kind:'cmcp_reading_navigation',status:'needs_narrowing',reason:prepared.refinement.status,modelContext:null},internal};
      internal.prepared=prepared;internal.navigationTicket=ticket;
    }else{
      if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>(localRetrieval?.maxQueryBytes??4096))throw Error('invalid_temporal_reading_question');
      const saved=await prepareReadingQuery({text,ticket,temporal,savedQueryPointer});
      const registered=(await catalog.list()).filter(entry=>!saved.pointer||cmcpSourcePointerKey(entry.pointer)!==cmcpSourcePointerKey(saved.pointer));
      const declared=await discussions.list({timezone});
      prepared=buildCmcpNaturalTemporalCatalog({question:text,events,segments:declared.segments,entries:registered,
        timeContext:resolveCmcpTimeContext({now:saved.queryBinding.queryTime,timezone}),maxBytes:naturalReading?.maxCatalogBytes??localRetrieval?.maxCandidateBytes??6000});
      internal={...saved.queryBinding,question:text,
        bufferGeneration:generation,bufferTtlMs:activationTtlMs,navigationTicket:ticket,prepared,registered,declaredSegments:declared.segments,modelCalls:0};
      await note('history_lookup_request',{...saved.queryBinding,ticket});
    }
    const valid=readingValidity({generation:internal.bufferGeneration,queryTime:internal.queryTime,temporal,ticket:internal.navigationTicket});
    if(!await valid())throw Error('reading_cancelled');
    const request=buildLoopRequest('temporal_read_select',prepared.input);
    return {host:{kind:'cmcp_reading_navigation',status:'requires_host_scope',ticket,question:internal.question,
      ...(internal.queryAuthorization?{queryBinding:{kind:'ephemeral_reading_query',textRetained:false,requiresQueryText:true}}:{}),
      selection:{input:request.input,instructions:request.instructions,schema:request.schema},modelCalls:0,
      coverage:'frozen_authorized_registered_navigation_not_read_evidence',modelContext:null},internal};
  }
  async function readingOpen({text,mode='read',ticket,limits:readingLimits,timeContext,discussion,calendarRange,naturalTime,inventory,savedQueryPointer,navigationResult,selection:hostSelection,queryText}){
    const generation=bufferGeneration,readingBufferTtlMs=activationTtlMs;
    if(!enabled||clean||!features.historyRecall)return {reader:{kind:'cmcp_reading_collection',ticket:null,mode,status:'disabled',collection:null},modelContext:null,internal:{modelCalls:0}};
    if(readOnly||!['read','all'].includes(mode))throw Error('invalid_or_read_only_reading');
    readingLimits=normalizeCmcpReadingLimits(readingLimits);
    if(bufferClearPending)await bufferClearPending;
    if(generation!==bufferGeneration||!await canContinue()||await readingRevoked(ticket))throw Error('reading_cancelled');
    const temporal=temporalFor(timeContext);
    if(navigationResult){
      if([discussion,calendarRange,inventory,savedQueryPointer,naturalTime,text].some(value=>value!==undefined))throw Error('host_reading_uses_frozen_question');
      const internal=copy(navigationResult.internal),prepared=internal.prepared;
      if(internal.queryAuthorization){assertCmcpEphemeralQueryText(internal.queryAuthorization,queryText??internal.question);
        internal.question=queryText??internal.question;prepared.input.question=internal.question;}
      const valid=readingValidity({generation:internal.bufferGeneration,queryTime:internal.queryTime,temporal,ticket:internal.navigationTicket});
      if(generation!==internal.bufferGeneration||!await valid())throw Error('reading_cancelled');
      await resolveCmcpReadingQuery({history,scopeId,binding:internal});
      if(!validateLoopSchema(hostSelection,buildLoopRequest('temporal_read_select',prepared.input).schema))throw Error('invalid_temporal_selection_schema');
      let chosen;try{chosen=normalizeCmcpNaturalTemporalSelection(hostSelection,prepared);}catch(error){
        if(!['ambiguous_local_calendar_boundary','nonexistent_local_calendar_boundary'].includes(error.message))throw error;
        chosen={status:'needs_clarification',reason:error.message};}
      const outputInternal={queryPointer:internal.queryPointer,...(internal.queryAuthorization?{queryAuthorization:copy(internal.queryAuthorization)}:{}),queryHash:internal.queryHash,queryTime:internal.queryTime,
        bufferGeneration:generation,modelCalls:0,rawSelection:copy(hostSelection),navigationTicket:internal.navigationTicket};
      if(chosen.status!=='selected')return {reader:{kind:'cmcp_reading_collection',ticket,mode,status:chosen.status,reason:chosen.reason,collection:null,historyAbsence:'not_established'},modelContext:null,internal:outputInternal};
      let selected;
      if(chosen.kind==='segments')selected=await discussions.selectMany({eventKey:chosen.eventKey,segmentIds:chosen.segmentIds,segmentHashes:chosen.segmentHashes,timezone:chosen.timezone??timezone});
      else if(chosen.kind==='calendar')selected=selectCmcpReadingCalendarCollection({entries:internal.registered,scopeId,ranges:chosen.ranges,
        event:chosen.eventKey===null?null:events.find(event=>event.key===chosen.eventKey)?.event});
      else selected=selectCmcpReadingAuthorizedCollection({entries:internal.registered,scopeId,event:events.find(event=>event.key===chosen.eventKey)?.event});
      if(!await valid())throw Error('reading_cancelled');
      if(selected.status!=='selected')return {reader:{kind:'cmcp_reading_collection',ticket,mode,status:selected.status,reason:selected.reason??'no_source_in_selected_scope',collection:null,historyAbsence:'not_established'},modelContext:null,internal:outputInternal};
      const sourceMap=selected.entries.map((entry,index)=>({ref:'c'+(index+1),id:entry.id,pointer:copy(entry.pointer),evidenceHash:entry.evidenceHash}));
      const result=await openCmcpReadingCollection({stores,catalog,events,candidates:{host:{ticket,question:internal.question},internal:{...outputInternal,sourceMap}},
        selection:{status:'selected',refs:sourceMap.map(row=>row.ref),clarification:''},mode,limits:readingLimits,timeContext:temporal,
        bufferGeneration:generation,ttlMs:loopTiming.ttlMs,bufferTtlMs:internal.bufferTtlMs,valid,scopeDescriptor:selected.descriptor});
      if(!await valid())throw Error('reading_cancelled');Object.assign(result.internal,{modelCalls:0,rawSelection:copy(hostSelection),navigationTicket:internal.navigationTicket});
      return result;
    }
    if(inventory!==undefined){
      if(discussion!==undefined||calendarRange!==undefined||!inventory||Object.keys(inventory).some(key=>key!=='eventKey'))throw Error('invalid_history_inventory_navigation');
      const selectedEvent=inventory.eventKey===undefined?null:events.find(item=>item.key===inventory.eventKey);
      if(inventory.eventKey!==undefined&&!selectedEvent)throw Error('history_inventory_event_outside_scope');
      const saved=await prepareReadingQuery({text,ticket,temporal,savedQueryPointer});
      const internal={...saved.queryBinding,bufferGeneration:generation,modelCalls:0};
      const valid=readingValidity({generation,queryTime:internal.queryTime,timeContext,temporal,ticket});
      const selected=selectCmcpReadingAuthorizedCollection({entries:await catalog.list(),scopeId,event:selectedEvent?.event??null,excludePointers:saved.pointer?[saved.pointer]:[]});
      if(!await valid())throw Error('reading_cancelled');
      if(selected.status!=='selected')return {reader:{kind:'cmcp_reading_collection',ticket,mode,status:selected.status,reason:selected.reason,collection:null,historyAbsence:'not_established'},modelContext:null,internal};
      const sourceMap=selected.entries.map((entry,index)=>({ref:'c'+(index+1),id:entry.id,pointer:copy(entry.pointer),evidenceHash:entry.evidenceHash}));
      const result=await openCmcpReadingCollection({stores,catalog,events,candidates:{host:{ticket,question:text},internal:{...internal,sourceMap}},
        selection:{status:'selected',refs:sourceMap.map(row=>row.ref),clarification:''},mode,limits:readingLimits,timeContext:temporal,
        bufferGeneration:generation,ttlMs:loopTiming.ttlMs,bufferTtlMs:readingBufferTtlMs,valid,scopeDescriptor:selected.descriptor});
      if(!await valid())throw Error('reading_cancelled');return result;
    }
    if(savedQueryPointer!==undefined)throw Error('saved_reading_query_requires_inventory_navigation');
    if(naturalTime!==undefined&&typeof naturalTime!=='boolean')throw Error('invalid_natural_temporal_option');
    const declared=discussion===undefined&&calendarRange===undefined&&naturalTime!==false?await discussions.list({timezone}):null;
    if(discussion===undefined&&calendarRange===undefined&&(naturalTime===true||declared?.segments.length)){
      if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>(localRetrieval?.maxQueryBytes??4096))throw Error('invalid_temporal_reading_question');
      const saved=await prepareReadingQuery({text,ticket,temporal});await note('history_lookup_request',{...saved.queryBinding,ticket});
      const internal={...saved.queryBinding,bufferGeneration:generation,modelCalls:0};
      const valid=readingValidity({generation,queryTime:temporal.now,timeContext,temporal,ticket});
      const registered=await catalog.list(),prepared=buildCmcpNaturalTemporalCatalog({question:text,events,segments:declared?.segments??[],entries:registered,
        timeContext:temporal,maxBytes:naturalReading?.maxCatalogBytes??localRetrieval?.maxCandidateBytes??6000});
      if(!await valid())throw Error('reading_cancelled');
      const reply=await adapter.request('temporal_read_select',prepared.input,{canAttempt:valid});
      if(!await valid())throw Error('reading_cancelled');
      if(!validateLoopSchema(reply.value,buildLoopRequest('temporal_read_select',prepared.input).schema))throw Error('invalid_temporal_selection_schema');
      internal.modelCalls=1;internal.rawSelection=copy(reply.value);internal.selectionInputBytes=jsonBytes(prepared.input);
      await note('natural_temporal_reading_selection',{ticket,...saved.queryBinding,raw:features.saveUser?reply.value:null,transport:reply.transport??null,
        bufferGeneration:generation,eventMap:prepared.eventMap,segmentMap:prepared.segmentMap,inputBytes:internal.selectionInputBytes});
      let chosen;
      try{chosen=normalizeCmcpNaturalTemporalSelection(reply.value,prepared);}catch(error){
        if(!['ambiguous_local_calendar_boundary','nonexistent_local_calendar_boundary'].includes(error.message))throw error;
        chosen={status:'needs_clarification',reason:error.message};
      }
      if(chosen.status==='needs_navigation'&&(chosen.eventKey||chosen.eventCandidates?.length===1)){
        const refined=refineCmcpNaturalTemporalCatalog({prepared,eventKey:chosen.eventKey??chosen.eventCandidates[0],
          question:text,events,segments:declared?.segments??[],entries:registered,timeContext:temporal,
          maxBytes:naturalReading?.maxCatalogBytes??localRetrieval?.maxCandidateBytes??6000});
        if(refined.refinement.status==='locators_ready'){
          if(!await valid())throw Error('reading_cancelled');
          const second=await adapter.request('temporal_read_select',refined.input,{canAttempt:valid});
          if(!await valid())throw Error('reading_cancelled');
          if(!validateLoopSchema(second.value,buildLoopRequest('temporal_read_select',refined.input).schema))throw Error('invalid_temporal_selection_schema');
          internal.modelCalls++;internal.refinedSelection=copy(second.value);internal.refinementInputBytes=jsonBytes(refined.input);
          await note('natural_temporal_reading_refinement',{ticket,...saved.queryBinding,raw:features.saveUser?second.value:null,transport:second.transport??null,
            bufferGeneration:generation,eventMap:refined.eventMap,segmentMap:refined.segmentMap,inputBytes:internal.refinementInputBytes});
          try{chosen=normalizeCmcpNaturalTemporalSelection(second.value,refined);}catch(error){
            if(!['ambiguous_local_calendar_boundary','nonexistent_local_calendar_boundary'].includes(error.message))throw error;
            chosen={status:'needs_clarification',reason:error.message};
          }
        }else chosen={...chosen,reason:refined.refinement.status};
      }
      if(chosen.status!=='selected')return {reader:{kind:'cmcp_reading_collection',ticket,mode,status:chosen.status,reason:chosen.reason,
        collection:null,historyAbsence:'not_established_by_bounded_temporal_lookup'},modelContext:null,internal};
      let selected;
      if(chosen.kind==='segments')selected=await discussions.selectMany({eventKey:chosen.eventKey,segmentIds:chosen.segmentIds,segmentHashes:chosen.segmentHashes,timezone:chosen.timezone??timezone});
      else if(chosen.kind==='calendar'){
        selected=selectCmcpReadingCalendarCollection({entries:registered,scopeId,ranges:chosen.ranges,
          event:chosen.eventKey===null?null:events.find(event=>event.key===chosen.eventKey)?.event,excludePointers:saved.pointer?[saved.pointer]:[]});
      }else{
        const event=events.find(item=>item.key===chosen.eventKey),entries=registered.filter(entry=>{
          const linked=entry.eventScope??entry.eventLink?.event;return linked?.scopeId===event.event.scopeId&&linked?.eventId===event.event.eventId;});
        selected={status:entries.length?'selected':'not_found',entries,descriptor:{kind:'authorized_event_scope',event:copy(event.event),scopeCoverage:'frozen_authorized_event_catalog'}};
      }
      if(!await valid())throw Error('reading_cancelled');
      if(selected.status!=='selected')return {reader:{kind:'cmcp_reading_collection',ticket,mode,status:selected.status,reason:selected.reason??'no_source_in_selected_scope',
        collection:null,historyAbsence:'not_established'},modelContext:null,internal};
      const sourceMap=selected.entries.filter(entry=>!saved.pointer||cmcpSourcePointerKey(entry.pointer)!==cmcpSourcePointerKey(saved.pointer)).map((entry,index)=>({
        ref:'c'+(index+1),id:entry.id,pointer:copy(entry.pointer),evidenceHash:entry.evidenceHash}));
      const result=await openCmcpReadingCollection({stores,catalog,events,candidates:{host:{ticket,question:text},internal:{...internal,sourceMap}},
        selection:{status:'selected',refs:sourceMap.map(item=>item.ref),clarification:''},mode,limits:readingLimits,timeContext:temporal,
        bufferGeneration:generation,ttlMs:loopTiming?.ttlMs,bufferTtlMs:readingBufferTtlMs,valid,scopeDescriptor:selected.descriptor});
      if(!await valid())throw Error('reading_cancelled');Object.assign(result.internal,{modelCalls:internal.modelCalls,rawSelection:copy(reply.value),selectionInputBytes:internal.selectionInputBytes,
        ...(internal.refinedSelection?{refinedSelection:internal.refinedSelection,refinementInputBytes:internal.refinementInputBytes}:{})});
      await note('temporal_reading_scope',{ticket,queryPointer:saved.pointer,scopeDescriptor:selected.descriptor,sourceCount:sourceMap.length,bufferGeneration:generation});return result;
    }
    if(discussion!==undefined||calendarRange!==undefined){
      if(discussion!==undefined&&calendarRange!==undefined)throw Error('conflicting_temporal_reading_scope');
      if(calendarRange?.eventKey!==undefined&&!events.some(item=>item.key===calendarRange.eventKey))throw Error('calendar_event_outside_scope');
      if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>(localRetrieval?.maxQueryBytes??4096))throw Error('invalid_temporal_reading_question');
      const saved=await prepareReadingQuery({text,ticket,temporal});await note('history_lookup_request',{...saved.queryBinding,ticket});
      const internal={...saved.queryBinding,bufferGeneration:generation,modelCalls:0};
      const valid=readingValidity({generation,queryTime:temporal.now,timeContext,temporal,ticket});
      const selected=discussion!==undefined?await discussions.select(discussion):selectCmcpReadingCalendarCollection({entries:await catalog.list(),scopeId,
        ranges:[calendarRange],event:calendarRange.eventKey===undefined?null:events.find(item=>item.key===calendarRange.eventKey)?.event,excludePointers:saved.pointer?[saved.pointer]:[]});
      if(!await valid())throw Error('reading_cancelled');
      if(selected.status!=='selected')return {reader:{kind:'cmcp_reading_collection',ticket,mode,status:selected.status,collection:null,
        reason:selected.reason??'explicit_temporal_scope_not_unique',choices:selected.choices??[],historyAbsence:'not_established'},modelContext:null,internal};
      const sourceMap=selected.entries.filter(entry=>!saved.pointer||cmcpSourcePointerKey(entry.pointer)!==cmcpSourcePointerKey(saved.pointer)).map((entry,index)=>({
        ref:'c'+(index+1),id:entry.id,pointer:copy(entry.pointer),evidenceHash:entry.evidenceHash}));
      if(!sourceMap.length)return {reader:{kind:'cmcp_reading_collection',ticket,mode,status:'not_found',collection:null,reason:'no_prior_source_in_exact_range'},modelContext:null,internal};
      const candidates={host:{ticket,question:text},internal:{...internal,sourceMap}},selection={status:'selected',refs:sourceMap.map(item=>item.ref),clarification:''};
      const result=await openCmcpReadingCollection({stores,catalog,events,candidates,selection,mode,limits:readingLimits,timeContext:temporal,
        bufferGeneration:generation,ttlMs:loopTiming?.ttlMs,bufferTtlMs:readingBufferTtlMs,valid,scopeDescriptor:selected.descriptor});
      if(!await valid())throw Error('reading_cancelled');result.internal.modelCalls=0;
      await note('temporal_reading_scope',{ticket,queryPointer:saved.pointer,scopeDescriptor:selected.descriptor,sourceCount:sourceMap.length,bufferGeneration:generation});return result;
    }
    let candidates=await localCandidates({text,timeContext:temporal,ticket,representation:'registered_event_groups'});
    const internal={...candidates.internal,modelCalls:0};
    if(candidates.host.status!=='requires_host_selection')return {reader:{kind:'cmcp_reading_collection',ticket,mode,status:'not_found',
      reason:candidates.host.status,collection:null,historyAbsence:'not_established_by_bounded_lookup'},modelContext:null,internal};
    const valid=readingValidity({generation,queryTime:internal.queryTime,timeContext,temporal,ticket});
    const activityRecords=(await journal.read()).map(row=>row.record);
    candidates=await addCmcpReadingProgressLocators({stores,catalog,events,candidates,limits:localRetrieval,activityRecords,valid});
    Object.assign(internal,candidates.internal);
    const registered=await catalog.list(),projection=buildCmcpReadingSelectionCatalog({scopeId,events,candidates,entries:registered,
      activityRecords}),selectionCatalog=projection.catalog,readingEventMap=projection.eventMap;
    const selectionCatalogBytes=jsonBytes(selectionCatalog);
    internal.diagnostics.progressLocators.modelCatalogBytes=selectionCatalogBytes;
    internal.diagnostics.progressLocators.modelCatalogByteBasis='UTF-8 JSON input.catalog including eventRef/progress; excludes readingTask/runtimeTime/readingScopes and transport instructions/schema';
    internal.diagnostics.progressLocators.modelLocatorBytes=jsonBytes({catalog:selectionCatalog,eventCoverage:projection.eventCoverage});
    if(internal.diagnostics.progressLocators.modelLocatorBytes>localRetrieval.maxCandidateBytes)throw Error('reading_selection_catalog_byte_limit');
    internal.readingEventMap=copy(readingEventMap);
    const readingScopes=[];
    if(mode==='all'){
      const scopeGroups=new Set();
      for(const item of selectionCatalog){
        const key=item.eventRef===null?'source:'+item.ref:'event:'+item.eventRef;
        if(scopeGroups.has(key))continue;scopeGroups.add(key);
        readingScopes.push({scopeRef:'scope'+(readingScopes.length+1),kind:item.eventRef===null?'source':'event',candidateRefs:[item.ref]});
      }
      internal.readingScopes=copy(readingScopes);
    }
    const input={question:text,catalog:selectionCatalog,maxSources:localRetrieval.maxReadSources,runtimeTime:projectCmcpRuntimeTime(temporal),
      eventCoverage:projection.eventCoverage,
      readingTask:{mode,purpose:'freeze_bounded_reading_collection',scope:'caller_authorized_registered_sources'},
      locatorCoverage:{baseSources:internal.diagnostics.progressLocators.baseCount,additionalSources:internal.diagnostics.progressLocators.additionalCount,
        maxDistinctSources:internal.diagnostics.progressLocators.totalDistinctLimit,omittedSources:internal.diagnostics.progressLocators.omitted.length,
        answerSufficiency:'not_assessed',collectionCompleteness:'not_established'},
      ...(mode==='all'?{readingScopes:copy(readingScopes)}:{})};
    if(!await valid())throw Error('reading_cancelled');
    const selection=await adapter.request('recall_select',input,{canAttempt:valid});
    if(!await valid())throw Error('reading_cancelled');
    if(!validateLoopSchema(selection.value,buildLoopRequest('recall_select',input).schema))throw Error('invalid_selection_schema');
    await note('reading_selection',{ticket,queryPointer:internal.queryPointer,bufferGeneration:generation,readingEventMap,
      ...(mode==='all'?{readingScopes}:{}),raw:selection.value,transport:selection.transport??null});
    internal.rawSelection=copy(selection.value);
    if(selection.value.status!=='selected'){
      // The schema permits an empty explanation for not_found. No selected
      // source is authorized by that status; only clarification needs a question.
      if((mode==='all'?selection.value.scopeRef!=='':selection.value.refs.length>0)
        ||selection.value.status==='needs_clarification'&&!selection.value.clarification.trim())throw Error('invalid_selection_disposition');
      return {reader:{kind:'cmcp_reading_collection',ticket,mode,status:selection.value.status,reason:selection.value.clarification,
        collection:null,historyAbsence:'not_established_by_bounded_lookup'},modelContext:null,internal:{...internal,selection:copy(selection.value),modelCalls:1}};
    }
    if(selection.value.clarification!=='')throw Error('invalid_selection_disposition');
    let anchorSelection=selection.value;
    if(mode==='all'){
      const selectedScope=readingScopes.find(scope=>scope.scopeRef===selection.value.scopeRef);
      if(!selectedScope)throw Error('reading_scope_reference_invalid');
      anchorSelection={status:'selected',refs:copy(selectedScope.candidateRefs),clarification:''};
    }
    const result=await openCmcpReadingCollection({stores,catalog,events,candidates,selection:anchorSelection,mode,limits:readingLimits,
      timeContext:temporal,bufferGeneration:generation,ttlMs:loopTiming?.ttlMs,bufferTtlMs:readingBufferTtlMs,valid});
    if(!await valid())throw Error('reading_cancelled');
    result.internal.readingEventMap=copy(readingEventMap);result.internal.rawSelection=copy(selection.value);
    result.internal.diagnostics=copy(internal.diagnostics);
    if(mode==='all')result.internal.readingScopes=copy(readingScopes);
    result.internal.modelCalls=1;return result;
  }
  async function readingPage({openingResult,reading,previousPages=[],timeContext,project=false,activateBuffer=true}){
    const generation=bufferGeneration;
    if(!enabled||clean||!features.historyRecall)return {reader:{kind:'cmcp_reading_page',ticket:null,status:'disabled',text:null},modelContext:null,internal:{modelCalls:0}};
    if(readOnly)throw Error('read_only_reading');
    if(bufferClearPending)await bufferClearPending;
    const selected=openingResult??reading,temporal=temporalFor(timeContext),manifest=selected?.internal?.manifest;
    if(generation!==bufferGeneration||!manifest||manifest.bufferGeneration!==generation)throw Error('buffer_receipt_stale');
    const valid=readingValidity({generation,queryTime:manifest.queryTime,timeContext,temporal,ticket:manifest.ticket});
    const result=await readCmcpReadingPage({stores,catalog,reading:selected,previousPages,timeContext:temporal,project,
      bufferGeneration:generation,ttlMs:loopTiming?.ttlMs,valid,activateBuffer:features.buffer&&activateBuffer});
    if(!await valid())throw Error('reading_cancelled');
    return result;
  }
  async function readingOutline({openingResult,previousPages=[],timeContext}){
    if(!enabled||clean||!features.historyRecall)return {reader:{kind:'cmcp_reading_outline',status:'disabled'},modelContext:null};
    const temporal=temporalFor(timeContext),manifest=openingResult?.internal?.manifest,generation=bufferGeneration;
    if(!manifest||manifest.bufferGeneration!==generation)throw Error('buffer_receipt_stale');
    const valid=readingValidity({generation,queryTime:manifest.queryTime,timeContext,temporal,ticket:manifest.ticket});
    const result=await readCmcpReadingOutline({stores,catalog,reading:openingResult,previousPages,timeContext:temporal,
      bufferGeneration:generation,ttlMs:loopTiming.ttlMs,valid,activateBuffer:features.buffer});
    result.internal.queryPointer=manifest.queryPointer;if(manifest.queryAuthorization)result.internal.queryAuthorization=copy(manifest.queryAuthorization);return result;
  }
  const historyQueries=createCmcpHistoryQueryRuntime({scopeId,journal,historyProvider:history,readingOpen,readingPage,adapter,remainingWorkMs,
    now:()=>temporalFor().now,valid:async()=>enabled&&!clean&&features.historyRecall&&await canContinue(),
    activateMatches:async({reading,pages,refs})=>{
      if(!features.buffer||!refs.length)return {status:'not_activated',reason:features.buffer?'no_supported_match':'buffer_disabled'};
      const manifest=reading.internal.manifest,generation=manifest.bufferGeneration,temporal=temporalFor();
      const valid=readingValidity({generation,queryTime:manifest.queryTime,temporal,ticket:manifest.ticket});
      const query=await resolveCmcpReadingQuery({history,scopeId,binding:manifest});
      const selected=refs.map(ref=>manifest.sources.find(source=>source.ref===ref));
      if(selected.some(source=>!source))throw Error('aggregate_activation_reference_scope');
      const read={sourceMap:Object.fromEntries(selected.map(source=>[source.ref,source.pointer])),eventVersions:[],
        sourceBytes:pages.filter(page=>refs.includes(page.reader.source?.ref)).reduce((sum,page)=>sum+Buffer.byteLength(page.reader.text??''),0),projectionBytes:0};
      const result=await activateCmcpHistorySources({stores,selected:selected.map(source=>source.entry),query,activeAt:manifest.queryTime,read,valid,
        bufferGeneration:generation,ttlMs:loopTiming.ttlMs,bufferTtlMs:manifest.bufferTtlMs??activationTtlMs,timeContext:temporal});
      return {status:'activated_supported_sources_only',refs,before:result.before.buffer,after:result.after.buffer,proactiveEligible:false};
    },
    validatePublication:({reading,sourceRefs})=>validateCmcpReadingPublication({stores,catalog,reading,sourceRefs,timeContext:temporalFor(),bufferGeneration,
      valid:readingValidity({generation:bufferGeneration,queryTime:reading.internal.manifest.queryTime,temporal:temporalFor(),ticket:reading.reader.ticket})})});
  const api=Object.freeze({history,stores,catalog,sessionId,recover,status,ingest,localCandidates,localRead,localRecall,bufferList,clearBuffer,resumeDiscussion,resumeConversation,
    historyQuery:input=>historyQueries.run(input),resumeHistoryQuery:input=>historyQueries.resume(input),historyQueryStatus:id=>historyQueries.status(id),
    timeCard:options=>interactionTime.project({timeContext:temporalFor(options?.timeContext),excludePointers:options?.excludePointers??[]}),
    readingNavigate,readingOpen,readingPage,readingOutline,readingRevoked,revokeReading,
    async correctDialogueControl({eventKey,...correction}){
      if(readOnly||busy||!enabled||clean)throw Error('dialogue_correction_unavailable');
      const selected=events.find(item=>item.key===eventKey);if(!selected)throw Error('event_outside_authorized_collection');
      interruptProactive('dialogue_correction');const loop=await openLoop(selected);
      try{return await loop.correctDialogueControl(correction);}finally{await loop.close();}
    },
    async linkDiscussionSegment(input){if(readOnly)throw Error('read_only_discussion_link');if(!enabled||clean)return {status:'disabled',modelCalls:0};return discussions.link(input);},
    async discussionSegments(input={}){if(!enabled||clean)return {kind:'cmcp_discussion_segments',status:'disabled',segments:[],modelCalls:0};return discussions.list({timezone,...input});},
    get bufferGeneration(){return bufferGeneration;},
    setBufferTtlMs(value){if(!Number.isSafeInteger(value)||value<1)throw Error('invalid_buffer_ttl');
      activationTtlMs=value;retainedLoop?.setBufferTtlMs(value);},
    initializeProactive,interruptProactive,resumeProactive,waitForProactive,
    async rebuildLocalIndex({sourceIds}){if(readOnly||!localIndex)throw Error('local_index_not_writable');
      if(!enabled||clean)return {status:'not_run_disabled',modelCalls:0};return localIndex.rebuild({sourceIds});},
    setControls(value){if(typeof value.enabled!=='boolean'||typeof value.clean!=='boolean'
      ||value.proactive!==undefined&&typeof value.proactive!=='boolean')throw Error('invalid_controls');
      enabled=value.enabled;clean=value.clean;proactive=value.proactive??proactive;
      features={...features,...Object.fromEntries(Object.entries(value).filter(([key])=>Object.hasOwn(features,key)))};
      if(!enabled||clean||!proactive)cancelProactiveWork('proactive_disabled');applyProactiveControl();},
    async resumeEventSource({pointer,stage='event'}) {
      if(stage==='conversation')return resumeConversation({pointer});
      if(stage==='discussion')return resumeDiscussion({pointer});
      if(!['event','dialogue'].includes(stage))throw Error('invalid_source_recovery_stage');
      if(readOnly||busy)throw Error('runtime_not_writable_or_busy');
      if(!enabled||clean)throw Error('resume_source_disabled');
      if(pointer?.scopeId!==scopeId)throw Error('resume_source_scope_mismatch');
      const known=(await journal.read()).filter(row=>row.record.kind==='source_association'
        &&cmcpSourcePointerKey(row.record.value.pointer)===cmcpSourcePointerKey(pointer));
      const matches=events.filter(item=>known.some(row=>JSON.stringify(row.record.value.event)===JSON.stringify(item.event)));
      if(matches.length!==1)throw Error('event_recovery_requires_one_existing_association');
      const generation=bufferGeneration;busy=true;interruptProactive('source_recovery');let loop;
      try{
        loop=await openLoop(matches[0],{generation});
        const result=stage==='dialogue'?await loop.resumeDialogue(pointer):await loop.resumeSource(pointer);
        const pending=await refreshEvents();
        await note('source_recovery',{stage,eventKey:matches[0].key,pointer,result,registrationPending:pending,bufferGeneration:generation});
        if(generation!==bufferGeneration)throw Error('buffer_cleared_during_operation');
        return {...result,registrationPending:pending};
      }finally{await loop?.close();busy=false;if(persistentFocus)resumeProactive();}
    },
    async submit({text,eventKey=null,recall=false,timeContext,contextOnly=false,savedQueryPointer=null,sourceBufferGeneration=0,sourceBufferTtlMs}){
      const generation=bufferGeneration,submissionBufferTtlMs=savedQueryPointer?(sourceBufferTtlMs??loopTiming?.ttlMs):activationTtlMs;
      if(readOnly)throw Error('read_only_common_input');
      if(busy||typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>4096||typeof recall!=='boolean'||typeof contextOnly!=='boolean'
        ||contextOnly&&!recall)throw Error('invalid_or_busy_common_input');
      if(recall&&eventKey!==null)throw Error('recall_does_not_accept_target_event');
      if(savedQueryPointer&&(!recall||eventKey!==null||savedQueryPointer.scopeId!==scopeId))throw Error('invalid_resume_source_scope');
      if(savedQueryPointer&&sourceBufferGeneration!==generation)throw Error('buffer_receipt_stale');
      const selected=eventKey===null?null:events.find(item=>item.key===eventKey);if(eventKey!==null&&!selected)throw Error('event_outside_authorized_collection');
      const bufferScoped=enabled&&!clean&&!!(selected||recall);
      const temporal=resolveCmcpTimeContext(timeContext??{now:clock(),timezone});if(temporal.timezone!==timezone)throw Error('input_timezone_mismatch');
      if(bufferScoped&&bufferClearPending)await bufferClearPending;
      if(bufferScoped&&generation!==bufferGeneration)throw Error('buffer_cleared_during_operation');
      busy=true;let loop;if(persistentFocus)interruptProactive('new_user_input');
      try{
        if(!features.saveUser&&!(recall&&enabled&&!clean&&features.historyRecall)){
          if(contextOnly)return {status:'unaugmented',modelContext:'',queryPointer:null,selected:[],proactiveEligible:false};
          const reply=await adapter.request('recall_answer',{question:text},{canAttempt:canContinue});
          if(!validateLoopSchema(reply.value,buildLoopRequest('recall_answer',{question:text}).schema)||reply.value.sourceRefs.length)throw Error('invalid_unstored_answer');
          if(!await canContinue())throw Error('operation_cancelled');
          const assistantTiming=createCmcpAssistantTiming(temporal,clock);
          const saved=features.saveAssistant?await ingest({text:reply.value.text,role:'assistant',timeContext:temporal,messageRecordedAt:assistantTiming.responseReceivedAt}):null;
          const presentation=await delivery.present({kind:'answer',text:reply.value.text,sourcePointer:saved?.pointer??null,sessionId});
          if(presentation?.status!=='presented')throw Error('local_presentation_failed');
          return {status:'answered_without_new_user_persistence',answer:reply.value.text,queryPointer:null,answerPointer:saved?.pointer??null,
            modelContext:'',eventProcessing:'not_requested',dialogueProcessing:'not_requested',proactiveEligible:false,assistantTiming};
        }
        // Recovery only on an authorized enhanced operation, never on OFF/Clean or mere status.
        if(enabled&&!clean&&!recovered){const recovery=await recover();if(recovery.status!=='complete')await note('recovery_pending',recovery);}
        if(!enabled||clean||!selected){
          const grant=enabled&&!clean&&features.historyRecall&&recall?(await catalog.list()).filter(entry=>!savedQueryPointer||cmcpSourcePointerKey(entry.pointer)!==cmcpSourcePointerKey(savedQueryPointer)).map(entry=>entry.id):[];
          const component=createCmcpHistoryReactivation({stores,allowedSourceIds:grant,limits:recall?recallLimits:limits,adapter,sessionId,canContinue,clock,
            ttlMs:loopTiming?.ttlMs,bufferTtlMs:submissionBufferTtlMs,continuingClock:persistentFocus||timeContext===undefined,bufferBoundary:{generation,valid:()=>generation===bufferGeneration}});
          component.setControls({enabled:enabled&&features.historyRecall&&recall,clean});
          const queryBinding=!features.saveUser&&!savedQueryPointer?(await prepareReadingQuery({text,ticket:randomUUID(),temporal})).queryBinding:null;
          const result=await component.submit({text,timeContext:temporal,contextOnly,savedQueryPointer,queryBinding,saveAssistant:features.saveAssistant,activateBuffer:features.buffer});
          // New sources were registered through the same wrapped History dependency.
          if(result.answer){try{
            if(bufferScoped&&generation!==bufferGeneration||!await canContinue())throw Error('buffer_cleared_during_operation');
            result.assistantTiming.presentationStartedAt=observeCmcpAssistantTime(clock,temporal.timezone);
            const presented=await delivery.present({kind:'answer',text:result.answer,sourcePointer:result.answerPointer,sessionId});
            if(presented?.status!=='presented')throw Error('local_presentation_failed');
            result.assistantTiming.presentationAcknowledgedAt=observeCmcpAssistantTime(clock,temporal.timezone);
          }finally{await note('assistant_timing',{queryPointer:result.queryPointer,answerPointer:result.answerPointer,assistantTiming:copy(result.assistantTiming)});}}
          await note(recall?'reactivation':'submission',{eventKey:null,bufferGeneration:generation,status:result.status,queryPointer:result.queryPointer,answerPointer:result.answerPointer,
            selected:result.selected,sourceMap:result.sourceMap,sourceBytes:result.sourceBytes,projectionBytes:result.projectionBytes,reason:features.saveUser?result.reason??result.clarification??null:null,
            bufferBefore:result.bufferBefore,bufferAfter:result.bufferAfter,activeAt:result.activeAt});
          if(bufferScoped&&generation!==bufferGeneration)throw Error('buffer_cleared_during_operation');
          return result;
        }
        loop=await openLoop(selected,{timeContext:timeContext?temporal:undefined,retain:persistentFocus,generation});
        if(submissionBufferTtlMs!==undefined)loop.setBufferTtlMs(submissionBufferTtlMs);
        const submission=loop.submit(text,{timeContext:temporal});
        if(activationTtlMs!==undefined)loop.setBufferTtlMs(activationTtlMs);
        const result=await submission;
        if(persistentFocus&&result.focus?.supports?.length&&(result.status==='accepted'||result.focus.status==='closed')){
          // Required durable selection is not a best-effort diagnostic record.
          await withCmcpBufferPublication({root,scopeId},async()=>{
            const published=await readCmcpBufferBoundary({root,scopeId});
            if(generation!==bufferGeneration||published.generation!==generation)throw Error('buffer_cleared_during_operation');
            await journal.append('focus_selection',{eventKey:selected.key,pointer:result.pointer,eventVersion:result.focus.eventVersion,bufferGeneration:generation});
            if(generation!==bufferGeneration)throw Error('buffer_cleared_during_operation');
            selectedFocus=selected;applyProactiveControl();
          });
        }
        const pending=await refreshEvents();await note('submission',{eventKey,result,bufferGeneration:generation,registrationPending:pending});
        if(generation!==bufferGeneration)throw Error('buffer_cleared_during_operation');
        return {...result,bufferGeneration:generation,registrationPending:pending};
      }finally{if(loop&&!persistentFocus)await loop.close();busy=false;if(persistentFocus)resumeProactive();}
    },async close(){interruptProactive('runtime_closed');if(retainedLoop){await retainedLoop.close();retainedLoop=null;retainedEvent=null;}adapter.dispose?.();}
  });
  return api;
}
