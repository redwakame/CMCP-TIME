import {loopHash} from './cmcp-local-loop-journal.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {buildCmcpEventView} from './cmcp-event-lineage.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {parseCmcpInstant} from './resolve-cmcp-time-context.js';

const copy=value=>structuredClone(value),bytes=value=>Buffer.byteLength(JSON.stringify(value));
const eventFor=entry=>entry.eventScope??entry.eventLink?.event??null;
const eventKey=event=>JSON.stringify([event.scopeId,event.eventId]);
const pointerKey=pointer=>cmcpSourcePointerKey(pointer);

/** Processing and lookup provenance describe saved work, never semantic truth or ranking. */
export function projectCmcpSourceProcessing(entry){
  return {event:entry.processing?.event??'unknown',dialogue:entry.processing?.dialogue??'unknown'};
}
export function projectCmcpEventProcessingCoverage({entries,event,sourceRefs=[]}){
  const related=entries.filter(entry=>eventFor(entry)&&eventKey(eventFor(entry))===eventKey(event));
  const pending=related.filter(entry=>entry.processing?.event==='pending');
  return {registeredSources:related.length,pendingSources:pending.length,
    pendingSourceRefs:sourceRefs.filter(source=>pending.some(entry=>pointerKey(entry.pointer)===pointerKey(source.pointer))).map(source=>source.ref),
    committedSources:related.filter(entry=>entry.processing?.event==='committed').length,
    unknownProcessingSources:related.filter(entry=>entry.processing?.event===undefined||entry.processing.event==='unknown').length,
    savedStateCoverage:pending.length?'excludes_pending_sources':'registered_processing_only',uniqueCurrentState:'not_established'};
}
export function collectCmcpHistoryLookupPointers({scopeId,activityRecords=[]}){
  const lookupPointers=new Set();
  for(const record of activityRecords){
    if(!['history_lookup_request','reading_selection','local_recall_selection','reactivation'].includes(record.kind))continue;
    const pointer=record.value?.queryPointer;if(pointer?.scopeId===scopeId)lookupPointers.add(pointerKey(pointer));
  }
  return lookupPointers;
}
export function buildCmcpReadingSelectionCatalog({scopeId,events,candidates,entries,activityRecords=[]}){
  const eventMap=[],lookupPointers=collectCmcpHistoryLookupPointers({scopeId,activityRecords});
  const catalog=candidates.host.candidates.map(item=>{
    const mapped=candidates.internal.sourceMap.find(source=>source.ref===item.ref),entry=mapped&&entries.find(source=>source.id===mapped.id);
    if(!entry||entry.pointer.scopeId!==scopeId||pointerKey(entry.pointer)!==pointerKey(mapped.pointer)||entry.evidenceHash!==mapped.evidenceHash
      ||entry.sourceAuthorRole!==item.sourceAuthorRole||entry.sourceKind!==item.sourceKind
      ||entry.messageRecordedAt!==item.messageRecordedAt||entry.eventOccurredAt!==item.eventOccurredAt)
      throw Error('reading_reference_out_of_scope');
    const event=eventFor(entry);let eventRef=null;
    if(event){
      if(event.scopeId!==scopeId||!events.some(allowed=>eventKey(allowed.event??allowed)===eventKey(event)))throw Error('reading_event_outside_authorized_scope');
      let alias=eventMap.find(value=>eventKey(value.event)===eventKey(event));
      if(!alias){alias={eventRef:'e'+(eventMap.length+1),event:copy(event)};eventMap.push(alias);}eventRef=alias.eventRef;
    }
    const {purpose:fixedPurpose,...sourceHint}=item.excerpt;
    const progress=item.progress?{positions:copy(item.progress.positions),aspects:copy(item.progress.aspects),relationKinds:copy(item.progress.relationKinds)}:null;
    return {ref:item.ref,sourceAuthorRole:item.sourceAuthorRole,sourceKind:item.sourceKind,messageRecordedAt:item.messageRecordedAt,
      eventOccurredAt:item.eventOccurredAt,sourceHint:copy(sourceHint),eventRef,
      sourceProcessing:projectCmcpSourceProcessing(entry),sourceUse:lookupPointers.has(pointerKey(entry.pointer))?'history_lookup_request':'source_record',
      ...(progress?{progress}:{})};
  });
  const eventCoverage=eventMap.map(({eventRef,event})=>({eventRef,...projectCmcpEventProcessingCoverage({entries,event,sourceRefs:candidates.internal.sourceMap})}));
  return {catalog,eventMap,eventCoverage};
}

/** Bounded navigation over already authorized event relations, not semantic ranking.
 * Base lexical candidates remain intact. A global (not per-event) extra source cap
 * reuses maxCandidates independently from the smaller formal read source limit.
 * Repeated fixed safety descriptions stay in shared instructions, not every row.
 * Earliest registered message time is not the beginning of the real event. Saved
 * current/unresolved positions are interpretations, not proof of semantic truth.
 * Additional sources are still only locators: no read receipt, Buffer or state writes.
 */
export async function addCmcpReadingProgressLocators({stores,catalog,events,candidates,limits,activityRecords=[],valid=async()=>true}){
  for(const key of ['maxCandidates','maxReadSources','maxCandidateBytes','maxExcerptCodePoints','maxIndexSourceBytes'])
    if(!Number.isSafeInteger(limits?.[key])||limits[key]<1)throw Error('explicit_reading_progress_limits_required');
  if(!candidates?.host||!Array.isArray(candidates.host.candidates)||!Array.isArray(candidates.internal?.sourceMap))throw Error('invalid_reading_progress_candidates');
  const output=copy(candidates),base=output.host.candidates,mapping=output.internal.sourceMap,baseCount=base.length;
  if(baseCount>limits.maxCandidates||bytes(base)>limits.maxCandidateBytes)throw Error('reading_progress_base_budget');
  const diagnostics={kind:'bounded_saved_event_source_locators',baseCount,baseLimit:limits.maxCandidates,
    additionalLimit:limits.maxCandidates,totalDistinctLimit:limits.maxCandidates*2,byteLimit:limits.maxCandidateBytes,
    additionalCount:0,historyResolves:0,materializedSourceBytes:0,considered:0,omitted:[],eventVersions:[],timePositions:[],
    selectionRequired:true,answerSufficiency:'not_assessed',collectionCompleteness:'not_established',semanticVerification:'not_performed',
    policy:'base_lexical_then_event_round_robin_earliest_explicit_current_other_current_unresolved'};
  if(!await valid())throw Error('reading_cancelled');
  const entries=await catalog.list(),entryById=new Map(entries.map(entry=>[entry.id,entry])),represented=[];
  for(const source of mapping){const entry=entryById.get(source.id);
    if(!entry||entry.pointer.scopeId!==stores.scopeId||pointerKey(entry.pointer)!==pointerKey(source.pointer)||entry.evidenceHash!==source.evidenceHash)
      throw Error('reading_progress_source_binding');
    const event=eventFor(entry);if(!event)continue;
    if(event.scopeId!==stores.scopeId||!events.some(item=>eventKey(item.event??item)===eventKey(event)))throw Error('reading_progress_event_scope');
    if(!represented.some(item=>eventKey(item)===eventKey(event)))represented.push(event);
  }
  const representedKeys=new Set(mapping.map(source=>pointerKey(source.pointer))),pools=[];
  for(const event of represented){
    if(!await valid())throw Error('reading_cancelled');
    const snapshot=await stores.eventStore(event).readEvent({sourceUpdateIds:[]});
    if(!['found','missing'].includes(snapshot.status))diagnostics.omitted.push({event:eventKey(event),reason:'event_unavailable'});
    const records=snapshot.status==='found'?snapshot.internal.records:[],structural=buildCmcpEventView(event,records),current=new Set(structural.currentClaims.map(item=>item.nodeId)),
      unresolved=new Set(structural.unresolved.flatMap(item=>item.nodeIds)),pool=new Map();
    if(snapshot.status==='found')diagnostics.eventVersions.push({event:copy(event),version:loopHash(records)});
    function add(pointer,recordId,position,node){
      const key=pointerKey(pointer);if(representedKeys.has(key))return;
      const entry=entries.find(item=>pointerKey(item.pointer)===key);
      if(!entry||!eventFor(entry)||eventKey(eventFor(entry))!==eventKey(event)||entry.pointer.scopeId!==stores.scopeId){
        diagnostics.omitted.push({event:eventKey(event),reason:'event_source_outside_authorized_catalog'});return;
      }
      if(!pool.has(key))pool.set(key,{entry,event,records,recordIds:new Set(),positions:new Set(),aspects:new Set(),relations:new Set()});
      const row=pool.get(key);row.positions.add(position);
      if(position==='saved_relation_correction'&&current.has(node.nodeId))row.currentCorrection=true;
      if(recordId!==null){row.recordIds.add(recordId);row.aspects.add(node.aspect);row.relations.add(node.effectiveRelation.relation.kind);}
    }
    // Time navigation also applies to registered pending sources without Event
    // nodes. Unknown times do not become now, and equal instants keep catalog order.
    let earliest=null,earliestInstant=null,knownTimes=0,unknownTimes=0;
    for(const entry of entries){if(entry.pointer.scopeId!==stores.scopeId||!eventFor(entry)||eventKey(eventFor(entry))!==eventKey(event))continue;
      let instant;try{instant=parseCmcpInstant(entry.messageRecordedAt);}catch{unknownTimes++;continue;}knownTimes++;
      if(earliest===null||instant<earliestInstant){earliest=entry;earliestInstant=instant;}}
    diagnostics.timePositions.push({event:copy(event),knownMessageTimes:knownTimes,unknownMessageTimes:unknownTimes,
      earliestSourceId:earliest?.id??null,basis:'parseable_message_time_in_authorized_registered_event',eventFactTime:'not_inferred'});
    if(earliest)add(earliest.pointer,null,'earliest_registered_message',null);
    for(const node of structural.knownEvolution){
      const position=current.has(node.nodeId)?'saved_current_claim':unresolved.has(node.nodeId)?'saved_unresolved_branch':null;
      if(!position)continue;
      add(node.source.pointer,node.nodeId,position,node);
      // Relation corrections can have another source. Retain their provenance rather
      // than replacing it with the original node's source or hiding a live branch.
      for(const update of node.effectiveRelation.sourceUpdates)if(update.updateId!==node.nodeId)
        add(update.source.pointer,update.updateId,'saved_relation_correction',node);
    }
    // Navigation categories are structural positions, not semantic truth or a
    // recency/role score. A newer unrelated source never becomes a current claim.
    const category=row=>row.positions.has('earliest_registered_message')?0:
      row.currentCorrection||row.positions.has('saved_current_claim')&&row.relations.has('supersedes')?1:
      row.positions.has('saved_current_claim')?2:3;
    pools.push([...pool.values()].sort((a,b)=>category(a)-category(b)));
  }
  // Round-robin existing event order; neither author role nor latest timestamp wins.
  const pending=[];for(let round=0;pools.some(pool=>round<pool.length);round++)for(const pool of pools)if(pool[round])pending.push(pool[round]);
  diagnostics.considered=pending.length;
  for(const item of pending){
    if(!await valid())throw Error('reading_cancelled');
    const id=item.entry.id;
    if(diagnostics.historyResolves>=limits.maxCandidates){diagnostics.omitted.push({id,reason:'progress_locator_count_limit'});continue;}
    diagnostics.historyResolves++;
    const found=await resolveCmcpHistorySource({provider:stores.history,pointer:item.entry.pointer});
    if(found.status!=='found'){diagnostics.omitted.push({id,reason:'source_'+found.status});continue;}
    const evidence=found.evidence,materialized=Buffer.byteLength(evidence.content.body);diagnostics.materializedSourceBytes+=materialized;
    if(loopHash(evidence)!==item.entry.evidenceHash){diagnostics.omitted.push({id,reason:'source_changed'});continue;}
    if(materialized>limits.maxIndexSourceBytes){diagnostics.omitted.push({id,reason:'progress_source_byte_limit'});continue;}
    // Reuse the Event Store's exact role/scope/citation/snapshot verifier, with a
    // one-source cache so other event sources cannot cause unbounded History reads.
    const cached={descriptor:stores.history.descriptor,capabilities:stores.history.capabilities,
      async resolve(pointer){return pointerKey(pointer)===pointerKey(evidence.pointer)?found:{status:'unavailable',pointer};}};
    if(item.recordIds.size){const checked=await stores.eventStore(item.event,cached).readEvent({sourceUpdateIds:[...item.recordIds]});
      if(checked.status!=='found'||[...item.recordIds].some(id=>{
        const at=checked.internal.records.findIndex(record=>record.command.updateId===id);return at<0||!checked.internal.checks[at]?.supported;
      })){diagnostics.omitted.push({id,reason:'event_source_support_unverified'});continue;}}
    const ranges=item.records.filter(record=>item.recordIds.has(record.command.updateId)).map(record=>record.command.source.citation),
      points=[...evidence.content.body],start=ranges.length?Math.min(...ranges.map(range=>range.start)):0,end=Math.min(points.length,start+limits.maxExcerptCodePoints),
      range={unit:'unicode_code_points',start,end},ref='c'+(base.length+1),candidate={ref,sourceAuthorRole:evidence.sourceAuthorRole,sourceKind:evidence.sourceKind,
        messageRecordedAt:evidence.messageRecordedAt,eventOccurredAt:evidence.eventOccurredAt,availability:evidence.metadata?.availability??'unknown',eventAssociated:true,
        excerpt:{kind:evidence.content.kind,text:points.slice(start,end).join(''),purpose:'locator_excerpt_requires_explicit_read',location:range,complete:start===0&&end===points.length},
        progress:{kind:'derived_saved_event_position',positions:[...item.positions],aspects:[...item.aspects],relationKinds:[...item.relations],
          sourceSupport:'verified_for_this_locator',otherSourceSupport:'not_established_here',semanticVerification:'not_performed',
          ...(item.positions.has('earliest_registered_message')?{timePositionBasis:'parseable_message_time_in_authorized_registered_event',
            eventFactTime:'not_inferred',eventProcessing:item.entry.processing?.event??'unknown'}:{})}};
    const source={ref,id,pointer:copy(evidence.pointer),evidenceHash:item.entry.evidenceHash,range},projected=buildCmcpReadingSelectionCatalog({scopeId:stores.scopeId,events,entries,activityRecords,
      candidates:{host:{candidates:[...base,candidate]},internal:{sourceMap:[...mapping,source]}}});
    if(bytes({catalog:projected.catalog,eventCoverage:projected.eventCoverage})>limits.maxCandidateBytes){diagnostics.omitted.push({id,reason:'shared_candidate_byte_limit'});continue;}
    base.push(candidate);mapping.push(source);diagnostics.additionalCount++;
  }
  if(!await valid())throw Error('reading_cancelled');
  const projected=buildCmcpReadingSelectionCatalog({scopeId:stores.scopeId,events,entries,candidates:output,activityRecords});
  diagnostics.totalDistinctCount=base.length;diagnostics.internalCandidateBytes=bytes(base);
  diagnostics.candidateBytes=bytes({catalog:projected.catalog,eventCoverage:projected.eventCoverage});diagnostics.complete=diagnostics.omitted.length===0;
  output.internal.diagnostics={...output.internal.diagnostics,progressLocators:diagnostics};
  return output;
}
