import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCmcpRuntimeSession,normalizeCmcpRuntimeConfig} from './cmcp-runtime-session.js';
import {createCmcpReactivationStores} from './cmcp-history-reactivation.js';
import {createLocalLoopJournal,loopHash} from './cmcp-local-loop-journal.js';
import {createCmcpSourcePointer,cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {parseCmcpInstant,resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';
import {formatCmcpLocalInstant} from './project-cmcp-local-time.js';

const copy=value=>structuredClone(value),bytes=value=>Buffer.byteLength(JSON.stringify(value));
const codeFiles=['src/cmcp-guard/cmcp-temporal-observation.js','src/cmcp-guard/cmcp-runtime-session.js',
  'src/cmcp-guard/cmcp-local-input.js','src/cmcp-guard/cmcp-buffer-lifecycle.js','src/cmcp-guard/cmcp-buffer-retention.js',
  'src/cmcp-guard/cmcp-local-continuity-loop.js',
  'src/cmcp-guard/cmcp-history-reactivation.js','src/cmcp-guard/cmcp-reading.js','scripts/cmcp-temporal-observe.mjs'];
const positive=value=>Number.isSafeInteger(value)&&value>0;
const within=(repo,file)=>{const target=path.resolve(repo,file),rel=path.relative(repo,target);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('observation_path_outside_repo');return target;};
function timing({clockGroup='real',syntheticNow,clock,timeContext,now},timezone){
  if(clock!==undefined||timeContext!==undefined||now!==undefined)throw Error('observation_clock_override_not_allowed');
  if(!['real','synthetic'].includes(clockGroup)||clockGroup==='real'&&syntheticNow!==undefined
    ||clockGroup==='synthetic'&&syntheticNow===undefined)throw Error('explicit_observation_clock_group_required');
  if(clockGroup==='synthetic')resolveCmcpTimeContext({now:syntheticNow,timezone});
  return {clockGroup,now:()=>clockGroup==='real'?new Date().toISOString():syntheticNow};
}
function optionsFor(options){
  const {config,binding}=normalizeCmcpRuntimeConfig(options.config,{repoRoot:options.repoRoot});
  const root=within(options.repoRoot,options.observationRoot),time=timing(options,config.input.timezone);
  return {config,binding,root,time,journal:createLocalLoopJournal({root:path.join(root,time.clockGroup),name:'cmcp-temporal-observation-v1'})};
}
function validateTargets(targets,config,binding){
  if(targets?.kind!=='cmcp_temporal_observation_targets'||targets.version!==1||targets.runtimeId!==config.runtimeId
    ||targets.binding!==binding||targets.scopeId!==config.input.scopeId||!Array.isArray(targets.pointers)
    ||!['maxSources','maxSourceBytes','maxRecordBytes'].every(key=>positive(targets.limits?.[key]))
    ||targets.pointers.length>targets.limits.maxSources)throw Error('invalid_observation_targets');
  const pointers=targets.pointers.map(createCmcpSourcePointer);
  if(pointers.some(pointer=>pointer.scopeId!==config.input.scopeId)
    ||new Set(pointers.map(cmcpSourcePointerKey)).size!==pointers.length)throw Error('observation_source_scope_or_duplicate');
  return pointers;
}
async function codeVersion(repo){const files={};for(const file of codeFiles)files[file]=loopHash(await fs.readFile(path.join(repo,file),'utf8'));
  return {kind:'current_file_sha256',files,version:loopHash(files)};}
function slimEvent(row){const view=row.eventProgress;
  return {key:row.key,status:row.status,event:row.event??null,eventVersion:row.eventVersion??null,
    lastUserAt:row.lastUserAt??null,lastRelatedAt:row.lastRelatedAt??null,expiry:row.expiry??null,
    dialogue:row.dialogue?{kind:'derived_dialogue',status:row.dialogue.status,synopsis:row.dialogue.synopsis,
      supports:(row.dialogue.supports??[]).map(s=>({pointer:s.pointer,citation:s.citation?{unit:s.citation.unit,start:s.citation.start,end:s.citation.end}:null}))}:null,
    pending:(row.pending??[]).map(value=>({pointer:value.pointer,status:value.processing?.status??'pending'})),
    interpretation:view?{kind:'derived_event_state',semanticVerification:'not_performed',currentClaims:view.currentClaims,
      unresolved:view.unresolved,unknownParts:view.unknownParts,knownNodeCount:view.knownEvolution?.length??0}:null,
    latestPresentation:row.latestPresentation?{at:row.latestPresentation.observedAt??row.latestPresentation.at??null,
      status:row.latestPresentation.status??row.latestPresentation.type??null}:null};
}
function slimBuffer(list,keys){const selected=row=>row.sourceRefs?.some(pointer=>keys.has(cmcpSourcePointerKey(pointer)));
  const slim=row=>({kind:row.kind,event:row.event??null,sourceRefs:row.sourceRefs,sourceTimes:row.sourceTimes,
    activatedAt:row.activatedAt,expiry:row.expiry,active:row.active,reason:row.reason,generation:row.generation,
    proactiveEligible:row.proactiveEligible,proactiveReason:row.proactiveReason});
  return {generation:list.generation,clearedAt:list.clearedAt,evaluatedAt:list.evaluatedAt,timezone:list.timezone,
    activeCountInScope:list.activeCount,items:list.items.filter(selected).map(slim),retained:list.retained.filter(selected).map(slim),
    selection:'only_entries_supported_by_explicit_target_pointers'};
}

/** Freeze a caller-bounded set of registered Pointers, without copying source bodies. */
export async function registerCmcpTemporalTargets(options){
  const {config,binding,root,time}=optionsFor(options),limits=options.limits;
  if(!limits||!['maxSources','maxSourceBytes','maxRecordBytes'].every(k=>positive(limits[k])))throw Error('explicit_observation_limits_required');
  const eventKeys=options.eventKeys??[];
  if(!Array.isArray(eventKeys)||new Set(eventKeys).size!==eventKeys.length
    ||eventKeys.some(key=>!config.input.events.some(event=>event.key===key)))throw Error('observation_event_scope_invalid');
  const eventIds=new Set(config.input.events.filter(event=>eventKeys.includes(event.key)).map(event=>event.eventId));
  const session=await createCmcpRuntimeSession({config,repoRoot:options.repoRoot,readOnly:true,
    ...(time.clockGroup==='synthetic'?{clock:time.now}:{})});
  let sources;
  try{const status=await session.status();sources=status.state.registration.sources.filter(source=>!eventKeys.length
    ||eventIds.has((source.eventScope??source.eventLink?.event)?.eventId));}
  finally{await session.close();}
  if(sources.length>limits.maxSources)throw Error('observation_targets_exceed_source_limit');
  const targets={kind:'cmcp_temporal_observation_targets',version:1,runtimeId:config.runtimeId,binding,
    scopeId:config.input.scopeId,registeredAt:new Date().toISOString(),eventKeys,selection:'existing_catalog_associations_only',
    pointers:sources.map(source=>source.pointer),limits:copy(limits)};
  validateTargets(targets,config,binding);
  const file=path.join(root,'targets',randomUUID()+'.json');await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,JSON.stringify(targets,null,2),{flag:'wx'});return {file,targets,modelCalls:0};
}

/** Read-only observation, then append evidence outside the Runtime state. No source/activity write. */
export async function observeCmcpTemporalState(options){
  const {config,binding,time,journal}=optionsFor(options),targets=copy(options.targets),pointers=validateTargets(targets,config,binding);
  const wallStartedAt=new Date().toISOString(),observedAtBefore=time.now(),session=options.runtime??await createCmcpRuntimeSession({config,
    repoRoot:options.repoRoot,readOnly:true,sessionId:options.sessionId??randomUUID(),...(time.clockGroup==='synthetic'?{clock:time.now}:{})});
  let status,list;
  try{if(session.binding!==binding)throw Error('observation_runtime_binding_mismatch');
    status=await session.status();list=await session.bufferList({scopeId:config.input.scopeId,
    ...(time.clockGroup==='synthetic'?{timeContext:{now:observedAtBefore,timezone:config.input.timezone}}:{})});}
  finally{if(!options.runtime)await session.close();}
  const stores=createCmcpReactivationStores({root:config.input.root,scopeId:config.input.scopeId}),sources=[];
  let materializedSourceBytes=0;
  for(const pointer of pointers){
    const reply=await resolveCmcpHistorySource({provider:stores.history,pointer});
    const source={pointer,status:reply.status};
    if(reply.status==='found'){
      const evidence=reply.evidence,sourceBytes=Buffer.byteLength(evidence.content.body);materializedSourceBytes+=sourceBytes;
      if(materializedSourceBytes>targets.limits.maxSourceBytes)throw Error('observation_source_bytes_exceeded');
      Object.assign(source,{sourceAuthorRole:evidence.sourceAuthorRole,sourceKind:evidence.sourceKind,contentKind:evidence.content.kind,
        messageRecordedAt:evidence.messageRecordedAt,eventOccurredAt:evidence.eventOccurredAt,
        localMessageRecordedAt:formatCmcpLocalInstant(evidence.messageRecordedAt,config.input.timezone),
        localEventOccurredAt:formatCmcpLocalInstant(evidence.eventOccurredAt,config.input.timezone),
        evidenceHash:loopHash(evidence),sourceBytes,availability:evidence.metadata?.availability??'unknown'});
    }
    sources.push(source);
  }
  const keys=new Set(pointers.map(cmcpSourcePointerKey)),catalog=status.state.registration.sources;
  for(const source of sources){const entry=catalog.find(row=>cmcpSourcePointerKey(row.pointer)===cmcpSourcePointerKey(source.pointer));
    source.event=entry?.eventScope??entry?.eventLink?.event??null;source.registration=entry?.processing??null;}
  const eventIds=new Set(sources.map(source=>source.event?.eventId).filter(Boolean));
  const observedAtAfter=time.now(),version=await codeVersion(options.repoRoot),rows=await journal.read(),targetsHash=loopHash(targets);
  const previous=rows.findLast(row=>row.record.kind==='observation'&&row.record.value.binding===binding&&row.record.value.targetsHash===targetsHash);
  const elapsedMs=previous?parseCmcpInstant(observedAtBefore)-parseCmcpInstant(previous.record.value.observedAtAfter):null;
  const value={kind:'cmcp_temporal_observation',version:1,clockGroup:time.clockGroup,
    observedAtBefore,observedAtAfter,wallStartedAt,wallCompletedAt:new Date().toISOString(),timezone:config.input.timezone,
    localObservedAtBefore:formatCmcpLocalInstant(observedAtBefore,config.input.timezone),
    localObservedAtAfter:formatCmcpLocalInstant(observedAtAfter,config.input.timezone),
    runtimeId:config.runtimeId,binding,scopeId:config.input.scopeId,sessionId:status.sessionId,pid:process.pid,targetsHash,
    relatedWorkId:options.relatedWorkId??null,
    configPathHint:options.configPathHint??null,code:version,
    previous:previous?{sequence:previous.record.sequence,sessionId:previous.record.value.sessionId,pid:previous.record.value.pid,
      elapsedMs,clockRegressed:elapsedMs<0,sameSession:previous.record.value.sessionId===status.sessionId,
      sameProcess:previous.record.value.pid===process.pid,crossedLocalDateBoundary:
        formatCmcpLocalInstant(previous.record.value.observedAtAfter,config.input.timezone).slice(0,10)!==formatCmcpLocalInstant(observedAtBefore,config.input.timezone).slice(0,10)}:null,
    sources,events:status.state.events.filter(row=>eventIds.has(row.event?.eventId)).map(slimEvent),buffer:slimBuffer(list,keys),
    controls:status.controls,timeLimits:{bufferRetention:status.bufferRetention??null,runtime:status.timeLimits??null},
    budget:{authorizationId:status.budget.authorizationId??null,status:status.budget.status,
      used:status.budget.used??null,remaining:status.budget.remaining??null},
    pending:{registration:status.pending.registration.length,model:status.pending.model.length,sourceWork:status.pending.sourceWork.length},
    modelCalls:0,sourceMutation:'none',activityRefresh:'none',readConsistency:'sequential_observation_not_atomic_snapshot',
    bounds:{...targets.limits,requestedSources:pointers.length,materializedSourceBytes,sourceBodiesStored:false,
      statusInventory:'existing_config_bounded_status_path',ioLimit:'selected_body_bytes_not_total_backend_io'},
    verification:{compaction:'NOT_OBSERVED',longTermContinuity:'OBSERVATION_ONLY',
      clockEvidence:time.clockGroup==='real'?'system_observed':'explicit_synthetic_not_live'}};
  if(bytes(value)>targets.limits.maxRecordBytes)throw Error('observation_record_bytes_exceeded');
  const record=await journal.append('observation',value);
  return {sequence:record.sequence,journalRoot:path.join(optionsFor(options).root,time.clockGroup),observation:value,modelCalls:0};
}

function normalizeOperation(value){
  if(!value||!['submit','reading_open'].includes(value.kind)||typeof value.text!=='string'||!value.text.trim())throw Error('invalid_temporal_continuation');
  const allowed=value.kind==='submit'?['kind','text','eventKey','recall']:['kind','text','mode','limits'];
  if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error('continuation_cannot_inject_time_or_source');
  if(value.kind==='reading_open'&&!['read','all'].includes(value.mode))throw Error('invalid_reading_mode');
  if(value.kind==='submit'&&(value.recall!==undefined&&typeof value.recall!=='boolean'
    ||value.eventKey!==undefined&&value.eventKey!==null&&typeof value.eventKey!=='string'))throw Error('invalid_temporal_continuation');
  return copy(value);
}
/** A new User demand, not a replay: observe first, then delegate unchanged to the normal Runtime. */
export async function continueCmcpTemporalOperation(options){
  const operation=normalizeOperation(options.operation),{config,time,journal}=optionsFor(options);
  if(options.runtimeOptions?.clock!==undefined||options.runtimeOptions?.sessionId!==undefined)throw Error('continuation_clock_or_session_override');
  const sessionId=options.runtime?.sessionId??options.sessionId??randomUUID(),workId=randomUUID();
  const receiptLocator=path.relative(options.repoRoot,path.join(config.receiptRoot,'work-'+loopHash(workId)+'.json'));
  const before=await observeCmcpTemporalState({...options,sessionId,relatedWorkId:workId});
  let runtime=options.runtime,result,error;
  try{
    runtime??=await createCmcpRuntimeSession({...(options.runtimeOptions??{}),config,repoRoot:options.repoRoot,sessionId,
      ...(time.clockGroup==='synthetic'?{clock:time.now}:{})});
    const {kind,...input}=operation;
    result=kind==='submit'?await runtime.submit({...input,workId}):await runtime.readingOpen({...input,workId});
    return {status:'operation_completed',semanticStatus:result.reader?.status??result.status??'unknown',workId,receiptLocator,before,result};
  }catch(caught){error=caught;throw caught;}
  finally{
    try{const after=await observeCmcpTemporalState({...options,sessionId,relatedWorkId:workId,...(runtime?{runtime}:{})});
    await journal.append('continuation',{kind:'cmcp_temporal_continuation',clockGroup:time.clockGroup,
      beforeSequence:before.sequence,afterSequence:after.sequence,sessionId,workId,receiptLocator,at:time.now(),
      operation:{kind:operation.kind,textHash:loopHash(operation.text),textBytes:Buffer.byteLength(operation.text),
        ...(operation.kind==='reading_open'?{mode:operation.mode}: {eventKey:operation.eventKey??null,recall:operation.recall??false})},
      status:error?'operation_failed':'operation_completed',semanticStatus:result?.reader?.status??result?.status??'unknown',error:error?.message??null,
      result:result?{kind:result.reader?.kind??null,status:result.reader?.status??result.status??null,ticket:result.reader?.ticket??null}:null,
      authority:'normal_runtime_existing_grant',remoteOutcome:error?'see_formal_runtime_work_and_provider_ledger':'see_formal_receipt'});
    }finally{if(runtime&&!options.runtime)await runtime.close();}
  }
}
