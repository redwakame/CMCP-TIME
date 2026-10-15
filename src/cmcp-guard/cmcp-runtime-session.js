import {CMCP_EVENT_WORKING_SET_DEFAULTS} from './cmcp-event-working-set.js';
import {normalizeCmcpAnswerHistoryConfig} from './cmcp-answer-history.js';
import {resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';
import {projectCmcpRuntimeTime} from './project-cmcp-local-time.js';
import {normalizeCmcpResponsePreferences} from './cmcp-local-loop-protocol.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCmcpLocalInput} from './cmcp-local-input.js';
import {hasCmcpContinuityPreview} from './cmcp-continuity-projection.js';
import {projectCmcpStorageStatus} from './cmcp-storage-status.js';
import {createCmcpContinuityPresentation} from './cmcp-continuity-presentation.js';
import {createCmcpRuntimeDispatch} from './cmcp-runtime-dispatch.js';
import {describeCmcpProactiveExecution} from './cmcp-proactive-description.js';
import {readCmcpDispatchObservation} from './cmcp-dispatch-arbitration.js';
import {createCmcpPinLifecycle} from './cmcp-pin-lifecycle.js';
import {getCmcpHostContext} from './cmcp-host-context.js';
import {createCmcpBoundedProviderAdapter,readCmcpRuntimeProviderWork,finalizeCmcpInterruptedProviderWork,CMCP_RUNTIME_REQUEST_LIMITS} from './cmcp-bounded-provider-adapter.js';
import {readCmcpProtectedCredential} from './cmcp-protected-credential.js';
import {authorizeRuntimeBudget,readRuntimeBudget} from './cmcp-model-job-budget.js';
import {loopHash,createLocalLoopJournal} from './cmcp-local-loop-journal.js';
import {DEEPSEEK_LOOP_CONFIG} from './cmcp-deepseek-configured-adapter.js';
import {createCmcpRuntimeWorkJournal,isCmcpProcessAlive} from './cmcp-runtime-work.js';
import {acquireCmcpRecoveryLeases} from './cmcp-recovery-lease.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {parseCmcpInstant} from './resolve-cmcp-time-context.js';
import {inspectCmcpReadingProgress} from './cmcp-reading.js';
import {normalizeCmcpBufferRetention} from './cmcp-buffer-retention.js';
import {CMCP_CONTINUITY_CONTEXT_LIMITS} from './project-cmcp-compact-continuity.js';
import {createCmcpFeatureControls,normalizeCmcpFeatureControlPatch,cmcpDoNotDisturbActive} from './cmcp-feature-controls.js';
import {cmcpReadingQueryKey,resolveCmcpReadingQuery,validateCmcpEphemeralReadingQuery,assertCmcpEphemeralQueryText} from './cmcp-reading-query-authorization.js';
import {normalizeCmcpSourceCatalogConfig} from './cmcp-source-index-segments.js';
import {readCmcpBufferBoundary,withCmcpBufferPublication} from './cmcp-buffer-lifecycle.js';
import {readCmcpSelectedHistory} from './cmcp-history-reactivation.js';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
/** 宿主回合的有限期限；一般操作及主動派送不使用此政策。 */
export function normalizeCmcpHostTurnPolicy(value){
  if(value===undefined)return Object.freeze({timeoutMs:240000,maxTimeoutMs:300000});
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join(',')!=='maxTimeoutMs,timeoutMs'
    ||!Number.isSafeInteger(value.timeoutMs)||!Number.isSafeInteger(value.maxTimeoutMs)
    ||value.timeoutMs<=0||value.timeoutMs>value.maxTimeoutMs||value.maxTimeoutMs>1800000)throw Error('invalid_host_turn_policy');
  return Object.freeze({timeoutMs:value.timeoutMs,maxTimeoutMs:value.maxTimeoutMs});
}
export function normalizeCmcpRuntimeConfig(value,{repoRoot}){
  if(value?.kind!=='cmcp_runtime_config'||value.version!==1||typeof value.runtimeId!=='string'||!value.runtimeId.trim()
    ||!path.isAbsolute(repoRoot)||!value.input||!value.controls
    ||!['enabled','clean','proactive'].every(k=>typeof value.controls[k]==='boolean'))throw Error('invalid_runtime_configuration');
  const within=v=>{if(typeof v!=='string'||!v)throw Error('runtime_path_required');const p=path.resolve(repoRoot,v),r=path.relative(repoRoot,p);
    if(!r||r.startsWith('..')||path.isAbsolute(r))throw Error('runtime_path_outside_repo');return p;};
  const config=structuredClone(value);config.input.root=within(config.input.root);
  normalizeCmcpFeatureControlPatch(config.controls);
  // Derivative storage resources do not grant source access, change model/read
  // budgets, or invalidate an existing authorization binding.
  if(config.sourceCatalog!==undefined)config.sourceCatalog=normalizeCmcpSourceCatalogConfig(config.sourceCatalog);
  // Operational wire dialect for the same configured provider and logical schemas.
  // It does not create another data scope, grant, conversation or automatic fallback.
  if(config.deepseekTransport!==undefined&&!['responses','deepseek_chat'].includes(config.deepseekTransport))throw Error('invalid_deepseek_transport');
  if(config.deepseekStream!==undefined&&typeof config.deepseekStream!=='boolean'
    ||config.deepseekStream===true&&config.deepseekTransport==='deepseek_chat')throw Error('invalid_deepseek_stream');
  if(config.providerMode!==undefined&&!['host','configured'].includes(config.providerMode))throw Error('invalid_runtime_provider_mode');
  config.receiptRoot=within(config.receiptRoot);config.credentialRef=config.providerMode==='host'&&config.credentialRef===undefined?null:within(config.credentialRef);
  for(const limits of [config.input.limits,config.recallLimits??config.input.limits]){
    if(!limits||!['maxEntries','maxCatalogBytes','maxSources','maxSourceBytes','maxProjectionBytes'].every(k=>Number.isSafeInteger(limits[k])&&limits[k]>0)
      ||limits.maxEntries>12||limits.maxSources>2)throw Error('invalid_runtime_capacity');
  }
  if(config.input.storageCapacity!==undefined&&(!config.input.storageCapacity
    ||!['maxSources','maxSourceBytes'].every(k=>Number.isSafeInteger(config.input.storageCapacity[k])&&config.input.storageCapacity[k]>0)))throw Error('invalid_runtime_storage_capacity');
  if(config.localRetrieval!==undefined&&(!config.localRetrieval
    ||!['maxStoredSources','maxCandidates','maxCandidateBytes','maxExcerptCodePoints','maxQueryBytes','maxIndexSourceBytes','maxIndexTokens',
      'maxReadSources','maxReadBytes','maxProjectionBytes'].every(k=>Number.isSafeInteger(config.localRetrieval[k])&&config.localRetrieval[k]>0)
    ||config.localRetrieval.maxReadSources>2))throw Error('invalid_runtime_local_retrieval_limits');
  if(!config.input.loopTiming||!['ttlMs','inactivityMs','activityWindowMs'].every(k=>Number.isSafeInteger(config.input.loopTiming[k])&&config.input.loopTiming[k]>0)
    ||config.input.loopTiming.inactivityMs>2147483647||config.input.loopTiming.activityWindowMs>2147483647)throw Error('invalid_runtime_timing');
  if(typeof config.sourceAuthorization?.saveUser!=='boolean'||typeof config.sourceAuthorization?.saveAssistant!=='boolean')throw Error('explicit_source_authorization_required');
  if(config.discussionAssociation!==undefined&&(!config.discussionAssociation||Object.keys(config.discussionAssociation).length!==1||typeof config.discussionAssociation.enabled!=='boolean'))throw Error('invalid_discussion_association_configuration');
  if(config.answerHistory!==undefined)config.answerHistory=normalizeCmcpAnswerHistoryConfig(config.answerHistory);
  if(config.naturalReading!==undefined&&(!config.naturalReading||Object.keys(config.naturalReading).length!==1
    ||!Number.isSafeInteger(config.naturalReading.maxCatalogBytes)||config.naturalReading.maxCatalogBytes<1||config.naturalReading.maxCatalogBytes>8192))throw Error('invalid_natural_reading_configuration');
  if(config.responsePreferences!==undefined)config.responsePreferences=normalizeCmcpResponsePreferences(config.responsePreferences);
  if(config.eventContext!==undefined&&(!config.eventContext||Array.isArray(config.eventContext)||Object.keys(config.eventContext).some(k=>!Object.hasOwn(CMCP_EVENT_WORKING_SET_DEFAULTS,k))
    ||Object.values(config.eventContext).some(n=>!Number.isSafeInteger(n)||n<1)
    ||(config.eventContext.maxNodes??12)>64||(config.eventContext.maxAnchors??3)>(config.eventContext.maxNodes??12)
    ||(config.eventContext.maxContextBytes??10000)>24576||(config.eventContext.maxQueryBytes??4096)>16384))throw Error('invalid_event_context_configuration');
  const bufferRetention=normalizeCmcpBufferRetention(config.bufferRetention);
  // Semantic configuration binding only: no source-code hash, Session ID or process lifetime.
  const binding=loopHash(canonical({runtimeId:config.runtimeId,input:config.input,recallLimits:config.recallLimits??config.input.limits,
    ...(config.localRetrieval===undefined?{}:{localRetrieval:config.localRetrieval}),
    sourceAuthorization:config.sourceAuthorization,provider:DEEPSEEK_LOOP_CONFIG.providerId,endpoint:DEEPSEEK_LOOP_CONFIG.endpoint,model:DEEPSEEK_LOOP_CONFIG.model}));
  return {config:freeze(config),bufferRetention,binding,budgetRoot:path.join(config.input.root,'runtime-budget'),ledgerRoot:path.join(config.input.root,'runtime-provider','attempts')};
}
export async function loadCmcpRuntimeConfig(file,{repoRoot}){
  const target=path.resolve(repoRoot,file),rel=path.relative(repoRoot,target);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('runtime_path_outside_repo');
  return normalizeCmcpRuntimeConfig(JSON.parse(await fs.readFile(target,'utf8')),{repoRoot});
}

// Explicit callable dependency for an isolated data root sharing an existing grant.
// This is not a persistent configuration option or a source of new authorization.
async function resolveRuntimeBudgetDependency(normalized,dependency,repoRoot){
  if(dependency===undefined)return {budgetRoot:normalized.budgetRoot,ledgerRoot:normalized.ledgerRoot,budgetBinding:normalized.binding,ownerRoot:null,expectedAuthorizationId:undefined};
  if(!dependency||Array.isArray(dependency)||Object.keys(dependency).sort().join(',')!=='config,expectedAuthorizationId'
    ||typeof dependency.expectedAuthorizationId!=='string'||!dependency.expectedAuthorizationId.trim())throw Error('invalid_runtime_budget_dependency');
  const owner=normalizeCmcpRuntimeConfig(dependency.config,{repoRoot});
  if(owner.config.input.scopeId!==normalized.config.input.scopeId)throw Error('runtime_budget_dependency_scope_mismatch');
  const overlaps=(a,b)=>{const relative=path.relative(a,b);return relative===''||!relative.startsWith('..')&&!path.isAbsolute(relative);};
  if([owner.config.input.root,owner.config.receiptRoot].some(a=>[normalized.config.input.root,normalized.config.receiptRoot].some(b=>overlaps(a,b)||overlaps(b,a))))throw Error('runtime_budget_dependency_requires_distinct_data_root');
  // Reject path aliases/reparse escapes before opening either writer lease.
  const realRepo=await fs.realpath(repoRoot);
  for(const location of [owner.config.input.root,normalized.config.input.root,owner.budgetRoot,owner.ledgerRoot,normalized.config.receiptRoot]){
    let ancestor=location;
    for(;;){try{const actual=await fs.realpath(ancestor),relative=path.relative(realRepo,actual);
      if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('runtime_budget_dependency_path_outside_repo');break;
    }catch(error){if(error.code!=='ENOENT')throw error;const next=path.dirname(ancestor);if(next===ancestor)throw error;ancestor=next;}}
  }
  const budget=await readRuntimeBudget({root:owner.budgetRoot,binding:owner.binding});
  if(budget.authorizationId!==dependency.expectedAuthorizationId)throw Error('runtime_expected_authorization_changed');
  return {budgetRoot:owner.budgetRoot,ledgerRoot:owner.ledgerRoot,budgetBinding:owner.binding,ownerRoot:owner.config.input.root,expectedAuthorizationId:dependency.expectedAuthorizationId};
}

/** Shared normal-operation lifecycle over LocalInput. One writer, no model or recovery on open/status. */
export async function createCmcpRuntimeSession({config:raw,repoRoot,readOnly=false,controls,delivery,observe=async()=>{},
  readCredential=readCmcpProtectedCredential,fetchImpl=fetch,clock,sessionId=randomUUID(),budgetDependency,hostProvider,hostTurnPolicy,dispatchReady=async()=>true}){
  if(typeof dispatchReady!=='function')throw Error('dispatch_ready_callback_required');
  const normalized=normalizeCmcpRuntimeConfig(raw,{repoRoot});
  const {config,bufferRetention:configuredRetention,binding}=normalized;
  if(hostTurnPolicy!==undefined&&config.providerMode!=='host')throw Error('host_turn_policy_requires_host_provider');
  const effectiveHostTurnPolicy=normalizeCmcpHostTurnPolicy(hostTurnPolicy);
  const {budgetRoot,ledgerRoot,budgetBinding,ownerRoot:budgetOwnerRoot,expectedAuthorizationId}=await resolveRuntimeBudgetDependency(normalized,budgetDependency,repoRoot);
  const answerHistoryEnabled=config.answerHistory?.enabled===true;
  const eventContext={...CMCP_EVENT_WORKING_SET_DEFAULTS,...config.eventContext};
  const continuityContextMaxBytes=answerHistoryEnabled?CMCP_CONTINUITY_CONTEXT_LIMITS.answerHistoryBytes:CMCP_CONTINUITY_CONTEXT_LIMITS.normalBytes;
  const semanticInputMaxBytes=answerHistoryEnabled?CMCP_CONTINUITY_CONTEXT_LIMITS.answerHistorySemanticInputBytes:CMCP_CONTINUITY_CONTEXT_LIMITS.normalSemanticInputBytes;
  let bufferRetention=configuredRetention;
  const inputJournal=createLocalLoopJournal({root:path.join(config.input.root,'input-journal'),name:'cmcp-common-input-v1'});
  const readOnlyPins=createCmcpPinLifecycle({root:config.input.root,scopeId:config.input.scopeId,
    verifyUserAction:async()=>({status:'rejected'}),verifySources:async()=>({status:'rejected'})});
  let sourceAuthorization={...config.sourceAuthorization},requiresReopen=false;
  const startupRecords=await inputJournal.read();
  const priorBudgetBinding=startupRecords.find(row=>row.record.kind==='runtime_budget_dependency')?.record.value;
  const budgetAttachment=budgetOwnerRoot?{version:1,scopeId:config.input.scopeId,dataBinding:binding,budgetRoot,ledgerRoot,budgetBinding,ownerRoot:budgetOwnerRoot}:null;
  if(priorBudgetBinding&&(!budgetAttachment||loopHash(priorBudgetBinding)!==loopHash(budgetAttachment)))throw Error('runtime_budget_dependency_required_or_changed');
  for(const {record} of startupRecords)if(record.kind==='source_authorization'){
    if(record.value.scopeId!==config.input.scopeId)throw Error('source_authorization_scope_mismatch');
    sourceAuthorization={...sourceAuthorization,...record.value.patch};}
  // Grant and preferences are separate: neither a persisted setting nor a temporary
  // Session override may restore saving after the corresponding grant was revoked.
  const constrainControls=snapshot=>({...snapshot,effective:{...snapshot.effective,
    saveUser:snapshot.effective.saveUser&&sourceAuthorization.saveUser,
    saveAssistant:snapshot.effective.saveAssistant&&sourceAuthorization.saveAssistant}});
  const controlManager=createCmcpFeatureControls({root:config.input.root,scopeId:config.input.scopeId,
    defaults:{saveUser:config.sourceAuthorization.saveUser,saveAssistant:config.sourceAuthorization.saveAssistant,
      answerHistory:config.answerHistory?.enabled===true,discussionAssociation:config.discussionAssociation?.enabled===true,
      bufferRetentionHours:configuredRetention.hours,...config.controls},sessionOverrides:controls??{}});
  let controlSnapshot=constrainControls(await controlManager.snapshot());
  const effective={...controlSnapshot.effective};
  const runtimeTimezone=effective.timezone??config.input.timezone;
  bufferRetention=normalizeCmcpBufferRetention({hours:effective.bufferRetentionHours});
  if(!['enabled','clean','proactive'].every(k=>typeof effective[k]==='boolean'))throw Error('invalid_runtime_controls');
  if(!readOnly&&effective.proactive&&typeof delivery?.present!=='function')throw Error('explicit_proactive_delivery_required');
  let core,adapter,dispatcher,lock,budgetOwnerLock,closed=false,busy=false,active=null,foregroundAdmission=false,clearFlight=null,controlFlight=Promise.resolve(),hostCompletionFlight=null;
  const ownedHostTurns=new Set();let hostTurnAdmissions=0;
  const timeControlStamp=()=>loopHash(['enabled','clean','timeIndex','timezone'].map(key=>[key,effective[key],controlSnapshot.featureRevisions[key]??0]));
  const timeProjectionAllowed=()=>!closed&&effective.enabled&&!effective.clean&&effective.timeIndex!==false&&!requiresReopen;
  async function currentTimeCard(options={}){
    await controlFlight;if(!timeProjectionAllowed())return null;
    const stamp=timeControlStamp(),card=await core.timeCard(options);
    return timeProjectionAllowed()&&stamp===timeControlStamp()?card:null;
  }
  const works=createCmcpRuntimeWorkJournal({root:config.input.root,binding});
  const lockFile=path.join(config.input.root,'.common-input-writer.lock');
  const budgetOwnerLockFile=budgetOwnerRoot?path.join(budgetOwnerRoot,'.common-input-writer.lock'):null;
  const authorization=Object.freeze({root:budgetRoot,binding:budgetBinding,sessionId,...(expectedAuthorizationId?{expectedAuthorizationId}:{})});
  async function assertExpectedBudget(){
    const budget=await readRuntimeBudget(authorization);
    if(expectedAuthorizationId!==undefined&&budget.authorizationId!==expectedAuthorizationId)throw Error('runtime_expected_authorization_changed');
    return budget;
  }
  const proxy={descriptor:{mode:'model',providerId:'bounded-deepseek',model:DEEPSEEK_LOOP_CONFIG.model,settings:{reasoning:DEEPSEEK_LOOP_CONFIG.reasoning}},
    async request(purpose,input,options={}){
      if(readOnly||closed)throw Error('runtime_not_writable');
      const viaHost=config.providerMode==='host';
      if(viaHost&&(purpose!=='proactive'||typeof hostProvider?.request!=='function'))throw Error('host_model_request_requires_host_bridge');
      if(!viaHost){const budget=await assertExpectedBudget();if(!budget.canCall.deepseek)throw Error(budget.reason??'runtime_budget_exhausted');}
      if(!viaHost&&!adapter){let key;try{key=await readCredential(config.credentialRef,'deepseek',{workspace:repoRoot});adapter=createCmcpBoundedProviderAdapter({deepseekKey:key,ledgerRoot,runtimeAuthorization:authorization,fetchImpl,wireFormat:config.deepseekTransport??'responses',stream:config.deepseekStream??false,answerHistory:answerHistoryEnabled});}
        finally{key=undefined;}}
      const valid=async()=>{if(!viaHost)await assertExpectedBudget();return await canContinue()&&await (options.canAttempt??(async()=>true))();};
      // Request observation is distinct from the saved User instant and the
      // operation's shared temporal context. It never refreshes activity/TTL.
      const requestTime={now:clock?clock():new Date().toISOString(),timezone:runtimeTimezone};
      // Foreground work answers its bound User input (including an explicit
      // recovery of that input). A proactive work's binding is historical
      // evidence, not a newly received User: keep it in the exchange chronology.
      const excludedCurrentInput=active?.mode!=='proactive'&&active?.sourcePointer?[active.sourcePointer]:[];
      const timeStamp=timeControlStamp(),exchangeTime=await currentTimeCard({timeContext:requestTime,excludePointers:excludedCurrentInput});
      const projected={...input,...(exchangeTime?{
        exchangeTime,
        modelRequestTime:projectCmcpRuntimeTime(resolveCmcpTimeContext(requestTime))}:{}),
        ...(['answer','recall_answer','proactive'].includes(purpose)&&(config.responsePreferences||effective.language)?{responsePreferences:{...config.responsePreferences,...(effective.language?{language:effective.language}:{})}}:{})};
      // 宿主模式只接受明確注入的主動接點；其模型授權與累計由既有受控 proxy 負責。
      const requestSignals=[options.signal,active?.controller.signal].filter(Boolean);
      return (viaHost?hostProvider:adapter).request(purpose,projected,{...options,canAttempt:async()=>await valid()&&(!exchangeTime||timeProjectionAllowed()&&timeStamp===timeControlStamp()),signal:requestSignals.length?AbortSignal.any(requestSignals):undefined,
        persistBodies:effective.saveUser&&effective.saveAssistant,
        deadlineAt:active?.deadlineAt,workContext:active?{workId:active.id,sourceVersion:active.sourceVersion??null}:undefined});
    },dispose(){adapter?.dispose();}};
  try{
    // Scope/binding validation precedes model access; a missing grant does not authorize a request.
    await assertExpectedBudget();
    if(!readOnly&&budgetOwnerLockFile){
      // The ordinary owner's existing writer lease also serializes its provider
      // route/attempt journals with this caller; never reclaim an unknown lease.
      try{budgetOwnerLock=await fs.open(budgetOwnerLockFile,'wx');}catch(error){if(error.code==='EEXIST')throw Error('runtime_budget_owner_writer_busy');throw error;}
      await budgetOwnerLock.writeFile(String(process.pid));await budgetOwnerLock.sync();
    }
    if(!readOnly){await fs.mkdir(config.input.root,{recursive:true});lock=await fs.open(lockFile,'wx');await lock.writeFile(String(process.pid));await lock.sync();}
    core=await createCmcpLocalInput({...config.input,sourceCatalogConfig:config.sourceCatalog,timezone:runtimeTimezone,bindingTimezone:config.input.timezone,continuityContextMaxBytes,semanticInputMaxBytes,eventContext,bufferTtlMs:bufferRetention.ttlMs,recallLimits:config.recallLimits,localRetrieval:config.localRetrieval,readOnly,adapter:proxy,sessionId,...(clock?{clock}:{}),observe,canContinue,
      remainingWorkMs:()=>active?Math.max(0,parseCmcpInstant(active.deadlineAt)-Date.now()):Infinity,
      persistentFocus:true,externalDispatch:true,controlIntent:true,runProactiveWork,cancelProactiveWork,discussionAssociation:config.discussionAssociation,answerHistory:config.answerHistory,naturalReading:config.naturalReading,
      verifyLegacyAnswerPreflight:async({pointer,evidenceHash,code})=>{
        if(!['compact_budget_exceeded','invalid_answer_history_projection_for_capacity'].includes(code))return null;
        const matching=(await works.list()).filter(work=>work.source?.evidenceHash===evidenceHash
          &&cmcpSourcePointerKey(work.source.pointer)===cmcpSourcePointerKey(pointer));
        const failures=[],failedReceipts=[];
        for(const work of matching){
          if(work.cancelRequested)continue;
          if(work.state==='failed'&&work.terminal?.reason===code){failures.push(work);continue;}
          // A normal operation may return {status:'failed'} and still complete
          // its outer execution. Require its exact, formally bound receipt;
          // completed execution alone does not prove an answer failed preflight.
          if(code!=='invalid_answer_history_projection_for_capacity'||work.state!=='completed')continue;
          const expected=path.join(config.receiptRoot,'work-'+loopHash(work.workId)+'.json');
          if(work.terminal?.receiptPath!==expected)continue;
          let raw,saved;try{raw=await fs.readFile(expected,'utf8');saved=JSON.parse(raw);}catch{continue;}
          if(saved.runtimeId!==config.runtimeId||saved.binding!==binding||saved.workId!==work.workId
            ||saved.sessionId!==work.sessionId||saved.mode!==work.mode||saved.result?.status!=='failed'||saved.result.code!==code)continue;
          failures.push(work);failedReceipts.push({workId:work.workId,path:expected,sha256:loopHash(raw),executionState:'completed',answerResult:'failed'});
        }
        if(!failures.length)return null;
        const ids=new Set(matching.map(work=>work.workId)),provider=await readCmcpRuntimeProviderWork({ledgerRoot,runtimeAuthorization:authorization});
        const attempts=(await createLocalLoopJournal({root:ledgerRoot,name:'cmcp-local-loop-attempts-v1'}).read()).map(row=>row.record)
          .filter(row=>row.kind==='started'&&row.value.purpose==='answer').map(row=>row.value);
        const couldMatch=(record,context=record.workContext??record)=>context.sourceVersion===evidenceHash||ids.has(context.workId)
          ||(!context.sourceVersion&&!context.workId&&failures.some(work=>record.startedAt>=work.at&&record.startedAt<=work.terminal.at));
        const answerRoutes=provider.filter(work=>work.purpose==='answer'&&couldMatch(work));
        if(attempts.some(row=>couldMatch(row)))return null;
        if(code==='compact_budget_exceeded'&&answerRoutes.length)return null;
        if(code==='invalid_answer_history_projection_for_capacity'){
          // This validator runs before transport attempt publication and fetch.
          // Require the actual bounded-adapter route to be terminally failed on
          // this exact source/work; unknown, foreign or unfinished routes block.
          const failedIds=new Set(failures.map(work=>work.workId));
          if(!answerRoutes.length||answerRoutes.some(work=>!failedIds.has(work.workId)||work.sourceVersion!==evidenceHash
            ||work.status!=='failed'||work.code!==code||work.attempt!==null||work.transportStatus!==null))return null;
        }
        return {status:'verified_not_started',basis:answerRoutes.length?'exact_failed_local_transport_preflight_and_absent_answer_attempt':'failed_runtime_work_and_absent_answer_route_and_attempt',workIds:failures.map(work=>work.workId),
          evidenceHash,answerLogicalStarts:answerRoutes.length,answerTransportStarts:0,...(failedReceipts.length?{failedReceipts}:{}),observedAt:new Date().toISOString()};
      },
      verifyRejectedAnswerCompletion:async({pointer,evidenceHash,code})=>{
        const allowed=new Set(['invalid_json','invalid_proposal_schema']);if(!allowed.has(code))return null;
        const matching=(await works.list()).filter(work=>work.source?.evidenceHash===evidenceHash
          &&cmcpSourcePointerKey(work.source.pointer)===cmcpSourcePointerKey(pointer));
        const ids=new Set(matching.map(work=>work.workId));
        const provider=(await readCmcpRuntimeProviderWork({ledgerRoot,runtimeAuthorization:authorization}))
          .filter(work=>work.purpose==='answer'&&(work.sourceVersion===evidenceHash||ids.has(work.workId)));
        if(!provider.length)return null;
        const records=(await createLocalLoopJournal({root:ledgerRoot,name:'cmcp-local-loop-attempts-v1'}).read()).map(row=>row.record),verified=[];
        const relatedStarts=records.filter(row=>row.kind==='started'&&row.value.purpose==='answer'
          &&(row.value.workContext?.sourceVersion===evidenceHash||ids.has(row.value.workContext?.workId)));
        if(relatedStarts.some(row=>!provider.some(item=>item.attempt===row.value.attempt&&item.logicalId===row.value.workContext?.logicalId
          &&item.workId===row.value.workContext?.workId)))return null;
        for(const item of provider){
          const work=matching.find(work=>work.workId===item.workId);
          if(!work||item.sourceVersion!==evidenceHash||!['completed','failed'].includes(work.state)||work.cancelRequested
            ||item.status!=='failed'||item.remoteOutcome!=='completed'||!allowed.has(item.code)||!item.attempt)return null;
          const start=records.find(row=>row.kind==='started'&&row.value.attempt===item.attempt)?.value,
            result=records.find(row=>row.kind==='result'&&row.value.attempt===item.attempt)?.value;
          if(start?.purpose!=='answer'||start.freezeId!=='runtime:'+authorization.binding||start.workContext?.workId!==work.workId||start.workContext?.sourceVersion!==evidenceHash
            ||start.workContext?.logicalId!==item.logicalId||result?.purpose!=='answer'||result.workContext?.workId!==work.workId||result.workContext?.sourceVersion!==evidenceHash
            ||result.workContext?.logicalId!==item.logicalId||result.status!=='failed'||!allowed.has(result.code)||result.code!==item.code
            ||result.http!==200||result.responseComplete!==true||result.fetchStarted!==true||result.remoteOutcome!=='completed'
            ||typeof result.responseBody!=='string'||result.responseSha256!==loopHash(result.responseBody))return null;
          let envelope;try{envelope=JSON.parse(result.responseBody);}catch{return null;}
          if(envelope.status!=='completed'||typeof envelope.id!=='string'||envelope.id!==result.responseId||envelope.model!==result.model
            ||!Array.isArray(envelope.output)||envelope.output.length!==1||envelope.output[0].type!=='message'||envelope.output[0].role!=='assistant'
            ||!Array.isArray(envelope.output[0].content)||envelope.output[0].content.length!==1||envelope.output[0].content[0].type!=='output_text'
            ||envelope.output[0].content[0].text!==result.outputText)return null;
          verified.push({workId:work.workId,logicalId:item.logicalId,attempt:item.attempt,code:result.code,responseId:result.responseId,
            responseSha256:result.responseSha256,usage:result.usage??null,remoteOutcome:'completed',budgetAlreadyConsumed:true});
        }
        if(verified.at(-1)?.code!==code)return null;
        return {status:'verified_completed_format_rejected',basis:'exact_runtime_source_work_route_complete_response',pointer,evidenceHash,
          attempts:verified,budgetRefunded:false,newModelWorkRequiresExplicitResume:true,observedAt:new Date().toISOString()};
      },
      onSourceSaved:async evidence=>{if(active&&evidence.sourceAuthorRole==='user'){
        const source={pointer:evidence.pointer,evidenceHash:loopHash(evidence)};await works.bindSource(active.id,source);active.sourceVersion=source.evidenceHash;active.sourcePointer=evidence.pointer;}},
      onReadingQuery:async queryBinding=>{if(!active)throw Error('reading_query_requires_active_work');
        validateCmcpEphemeralReadingQuery(queryBinding.queryAuthorization,config.input.scopeId);
        await works.bindQuery(active.id,queryBinding);active.queryBinding=structuredClone(queryBinding);},
      delivery:delivery??{async present(){throw Error('explicit_delivery_required');}}});
    if(!readOnly&&budgetAttachment&&!priorBudgetBinding)await inputJournal.append('runtime_budget_dependency',budgetAttachment);
    core.setControls(effective);
    if(!readOnly&&controls){
      const changed=Object.fromEntries(Object.entries(controls).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(controlSnapshot.persistent[key])));
      if(Object.keys(changed).length){controlSnapshot=constrainControls(await controlManager.update({updateId:randomUUID(),patch:changed,persist:false,
        timeContext:{now:clock?clock():new Date().toISOString(),timezone:runtimeTimezone}}));Object.assign(effective,controlSnapshot.effective);core.setControls(effective);}
    }
    if(!readOnly)dispatcher=createCmcpRuntimeDispatch({root:config.input.root,scopeId:config.input.scopeId,timezone:runtimeTimezone,
      events:config.input.events,core,controlManager:{snapshot:async()=>constrainControls(await controlManager.snapshot())},adapter:proxy,runWork:runProactiveWork,
      delivery:delivery??{async present(){throw Error('explicit_delivery_required');}},clock:clock??(()=>new Date().toISOString()),eventContext,dispatchReady:proactiveReady});
  }catch(error){adapter?.dispose();try{if(lock){await lock.close();await fs.unlink(lockFile);}}finally{if(budgetOwnerLock){await budgetOwnerLock.close();await fs.unlink(budgetOwnerLockFile);}}throw error;}
  async function status(){
    await controlFlight;
    if(closed)throw Error('runtime_closed');
    const state=await core.status(),budget=await readRuntimeBudget(authorization);
    const providerWork=await readCmcpRuntimeProviderWork({ledgerRoot,runtimeAuthorization:authorization});
    const executionWork=await works.list();
    const lastRead=executionWork.filter(w=>['local_read','local_answer','local_recall'].includes(w.mode)&&w.state==='completed'&&w.terminal?.receiptPath)
      .sort((a,b)=>parseCmcpInstant(b.terminal.at)-parseCmcpInstant(a.terminal.at))[0];
    let localReadProgress=null;
    if(lastRead){const saved=JSON.parse(await fs.readFile(lastRead.terminal.receiptPath,'utf8'));
      if(saved.binding!==binding||saved.workId!==lastRead.workId)throw Error('local_read_receipt_mismatch');
      localReadProgress={workId:lastRead.workId,ticket:saved.ticket??null,status:saved.result?.host?.retrieval??null,
        ranges:saved.result?.host?.context?.readProgress??saved.result?.internal?.readRanges??null,
        cumulative:saved.result?.internal?.cumulative??null};}
    const statusControls=constrainControls(await controlManager.snapshot());
    const storageStatus=await projectCmcpStorageStatus({scopeId:config.input.scopeId,registration:state.registration,
      controls:statusControls.effective,requiresReopen,resolveSource:pointer=>resolveCmcpHistorySource({provider:core.history,pointer})});
    if((await controlManager.snapshot()).generation!==statusControls.generation)throw Error('status_controls_changed_refresh_required');
    const dispatchStatus=dispatcher?await dispatcher.status():null;
    return {kind:'cmcp_runtime_status',runtimeId:config.runtimeId,sessionId,pid:process.pid,readOnly,modelCalls:0,storageStatus,
      dataScope:{root:config.input.root,scopeId:config.input.scopeId,eventKeys:config.input.events.map(e=>e.key)},
      ...(budgetAttachment?{budgetDependency:{...budgetAttachment,expectedAuthorizationId,active:budget.authorizationId===expectedAuthorizationId}}:{}),
      controls:{...effective},controlConfiguration:statusControls,sourceAuthorization:{...sourceAuthorization},runtimeTimezone,requiresReopen,budget,pins:await readOnlyPins.list(),
      dispatchObservation:{...await readCmcpDispatchObservation({root:config.input.root,scopeId:config.input.scopeId}),
        doNotDisturbActive:cmcpDoNotDisturbActive(effective,{now:clock?clock():new Date().toISOString(),timezone:runtimeTimezone})},
      bufferRetention:{...bufferRetention},
      timeLimits:{bufferNewActivationMs:bufferRetention.ttlMs,legacyMissingExpiryMs:config.input.loopTiming.ttlMs,
        readingTicketMs:config.input.loopTiming.ttlMs,proactiveInactivityMs:config.input.loopTiming.inactivityMs,
        proactiveActivityWindowMs:config.input.loopTiming.activityWindowMs,historyRetention:'not_controlled_by_buffer',
        proactiveTimingMeaning:'retained_local_loop_compatibility_not_runtime_send_deadline'},
      providerTransport:config.deepseekTransport??'responses',providerStream:config.deepseekStream??false,
      providerRequestBodyLimits:{...CMCP_RUNTIME_REQUEST_LIMITS,...(answerHistoryEnabled?{
        semanticAnswerHistoryBytes:CMCP_RUNTIME_REQUEST_LIMITS.optedInSemanticAnswerHistoryBytes,
        answerHistoryBytes:CMCP_RUNTIME_REQUEST_LIMITS.optedInAnswerHistoryBytes,
        answerHistoryAppliesTo:'opted_in_normal_answer_with_validated_answer_history_projection'}:{})},
      capacity:{maxEvents:4,...config.input.limits,recallLimits:config.recallLimits??config.input.limits,continuityContextMaxBytes,semanticInputMaxBytes,
        eventContext:{...eventContext,selection:'query_and_source_anchors_not_entire_event'},answerHistory:normalizeCmcpAnswerHistoryConfig(config.answerHistory),naturalReading:{maxCatalogBytes:config.naturalReading?.maxCatalogBytes??config.localRetrieval?.maxCandidateBytes??6000},
        ...(config.input.storageCapacity===undefined?{}:{storageCapacity:config.input.storageCapacity}),
        sourceCatalog:state.registration.capacity,
        ...(config.localRetrieval===undefined?{}:{localRetrieval:config.localRetrieval})},
      pending:{registration:state.registration.unregistered,event:state.events.map(e=>({key:e.key,pending:e.pending??[]})),conversation:state.conversationRecoveries,
        ...(config.localRetrieval?{localIndex:state.localCandidates.pendingSourceIds,
          catalogInterpretation:state.registration.sources.filter(row=>row.processing?.event==='pending'||row.processing?.dialogue==='pending')
            .map(row=>({sourceId:row.id,processing:row.processing}))}:{}),
        model:providerWork.filter(r=>r.status==='in_progress').map(r=>r.logicalId),
        sourceWork:executionWork.filter(r=>r.source&&r.sourceProcessing==='pending').map(r=>({workId:r.workId,source:r.source,state:r.state}))},
      work:executionWork,providerWork,state,localReadProgress,discussionAssociation:state.discussionAssociation,
      proactiveExecutor:{...state.proactive,...(dispatchStatus?{dispatch:dispatchStatus}:{}),
        execution:describeCmcpProactiveExecution({loopTiming:config.input.loopTiming,controls:statusControls.effective,
          observation:'runtime',readOnly,dispatch:dispatchStatus,deliveryPresent:typeof delivery?.present==='function'}),workId:active?.mode==='proactive'?active.id:null,
        workRunning:active?.mode==='proactive',readOnly}};
  }
  function cancelProactiveWork(reason){
    if(active?.mode==='proactive'){
      if(['buffer_clear','buffer_cleared','buffer_disabled'].includes(reason)&&!active.bufferDependent)return;
      active.cancelReason??=reason;active.controller.abort();}
  }
  async function proactiveReady(candidate){
    const available=()=>!readOnly&&!closed&&!busy&&!foregroundAdmission&&!hostCompletionFlight&&!hostTurnAdmissions&&!requiresReopen;
    if(!available())return false;
    // 原生模型回合跨越 beforeUser 與 afterAssistant；期間不讓主動工作取得相同 writer。
    for(const workId of ownedHostTurns){const work=await works.read(workId);
      if(work?.mode==='host_turn'&&work.state==='running'&&!work.cancelRequested&&parseCmcpInstant(work.deadlineAt)>Date.now())return false;
    }
    return await dispatchReady(candidate)===true&&available();
  }
  async function runProactiveWork(run,context){
    if(!await proactiveReady()||!effective.enabled||effective.clean||!effective.proactive)return {status:'ineligible'};
    // Same work/receipt/authorization lifecycle as foreground calls, with no new User source.
    const {signal,...proactiveContext}=context;
    return submit({proactiveContext,signal},run);
  }
  async function canContinue(){const current=active;if(!current)return !closed;const w=await works.read(current.id);
    return active===current&&!closed&&!current.controller.signal.aborted
      &&(!current.bufferDependent||current.bufferGeneration===core.bufferGeneration)
      &&(!current.readingTicket||!await core.readingRevoked(current.readingTicket))
      &&(!current.navigationTicket||!await core.readingRevoked(current.navigationTicket))
      &&(!current.navigationControlStamp||current.navigationControlStamp===workControlStamp('local_reading_navigation'))
      &&(current.mode!=='local_event_resume'||effective.enabled&&!effective.clean)
      &&(!current.controlStamp||current.controlStamp===workControlStamp(current.mode))
      &&Date.now()<parseCmcpInstant(current.deadlineAt)&&(w?.state==='running'
        ||current.mode==='local_reading_continuity'&&current.finalizing===true&&w?.state==='completed'
        ||current.mode==='local_reading_continuity'&&current.correctionFinalizing===true&&w?.state==='failed');}
  const bufferNow=()=>parseCmcpInstant(clock?clock():new Date().toISOString());
  function workControlStamp(mode,snapshot=controlSnapshot){
    const keys=['enabled','clean'];
    if(['local_read','local_answer','local_recall','local_candidates','local_reading_navigation','local_reading_open','local_reading_page','local_reading_outline','local_reading_continuity','local_history_query','local_history_query_resume','context_only'].includes(mode))keys.push('historyRecall','readingLimits');
    if(mode==='local_reading_continuity')keys.push('answerHistory','saveUser','saveAssistant','timezone');
    if(mode==='standalone'||mode==='local_event_resume')keys.push('saveUser','saveAssistant','answerHistory','discussionAssociation');
    if(mode==='host_turn')keys.push('historyRecall','answerHistory','discussionAssociation','saveUser','saveAssistant','readingLimits','buffer','timeIndex','timezone');
    return loopHash([...keys.map(key=>[key,snapshot.featureRevisions[key]??0]),...(mode==='local_reading_continuity'?[['sourceAuthorization',sourceAuthorization]]:[])]);
  }
  async function hostTurnState(){
    const snapshot=constrainControls(await controlManager.snapshot());
    const grants=(await inputJournal.readIncremental()).filter(row=>row.record.kind==='source_authorization');
    return {snapshot,controlStamp:workControlStamp('host_turn',snapshot),sourceAuthorizationStamp:loopHash(grants.map(row=>row.sha256)),
      boundary:await readCmcpBufferBoundary({root:config.input.root,scopeId:config.input.scopeId})};
  }
  async function checkHostTurn(ticket,{replyTo,allowCompleted=false}={}){
    if(closed||ticket?.kind!=='cmcp_host_turn'||ticket.version!==1||typeof ticket.workId!=='string')throw Error('invalid_host_turn');
    const work=await works.read(ticket.workId);
    if(!work||work.mode!=='host_turn'||work.sessionId!==sessionId||work.cancelRequested
      ||!(work.state==='running'||allowCompleted&&work.state==='completed'))throw Error('host_turn_not_active');
    if(Date.now()>=parseCmcpInstant(work.deadlineAt))throw Error('host_turn_expired');
    if(replyTo!==undefined&&(!replyTo||!work.nativeUserPointer
      ||cmcpSourcePointerKey(replyTo)!==cmcpSourcePointerKey(work.nativeUserPointer)))throw Error('host_turn_reply_mismatch');
    if(work.source){const found=await resolveCmcpHistorySource({provider:core.history,pointer:work.source.pointer});
      if(found.status!=='found'||found.evidence.sourceAuthorRole!=='user'||loopHash(found.evidence)!==work.source.evidenceHash)throw Error('host_turn_source_changed');}
    const current=await hostTurnState();
    if(work.controlStamp!==current.controlStamp||work.controlStamp!==workControlStamp('host_turn')
      ||work.sourceAuthorizationStamp!==current.sourceAuthorizationStamp||requiresReopen)throw Error('host_turn_controls_changed');
    if(work.bufferDependent&&(work.bufferGeneration!==current.boundary.generation||work.bufferGeneration!==core.bufferGeneration
      ||!current.snapshot.effective.enabled||current.snapshot.effective.clean||!current.snapshot.effective.historyRecall
      ||!effective.enabled||effective.clean||!effective.historyRecall))throw Error('host_turn_context_stale');
    const latest=await works.read(ticket.workId);
    if(closed||latest.cancelRequested||!(latest.state==='running'||allowCompleted&&latest.state==='completed'))throw Error('host_turn_not_active');
    if(Date.now()>=parseCmcpInstant(work.deadlineAt))throw Error('host_turn_expired');
    return latest;
  }
  async function assertBufferReceipt(work,result){
    const dependent=work.bufferDependent??(work.mode==='proactive'||work.mode==='context_only'
      ||work.mode.startsWith('local_')&&work.mode!=='local_ingest'||!!result?.focus||!!result?.bufferAfter);
    if(!dependent)return;
    const originalStamp=work.controlStamp??workControlStamp(work.mode,{featureRevisions:{}});
    if(originalStamp!==workControlStamp(work.mode))throw Error('context_control_revision_changed');
    if(work.readingTicket&&await core.readingRevoked(work.readingTicket))throw Error('reading_revoked');
    if(work.navigationTicket&&await core.readingRevoked(work.navigationTicket))throw Error('reading_revoked');
    // A completed receipt is still a context exit, not an exemption from controls.
    if(!effective.enabled||effective.clean||effective.historyRecall===false&&['local_read','local_answer','local_recall','local_candidates','local_reading_navigation','local_reading_open','local_reading_page','local_reading_outline','local_reading_continuity','local_history_query','local_history_query_resume','context_only'].includes(work.mode))throw Error('buffer_context_disabled');
    if(work.mode==='local_reading_continuity'&&!effective.answerHistory)throw Error('continuity_disabled');
    if((work.bufferGeneration??0)!==core.bufferGeneration)throw Error('buffer_receipt_stale');
    let queryTime=null;
    if(work.queryBinding){await resolveCmcpReadingQuery({history:core.history,scopeId:config.input.scopeId,binding:work.queryBinding});queryTime=work.queryBinding.queryTime;}
    if(work.source?.pointer){
      const found=await resolveCmcpHistorySource({provider:core.history,pointer:work.source.pointer});
      if(found.status!=='found'||found.evidence.messageRecordedAt===null
        ||parseCmcpInstant(found.evidence.messageRecordedAt)+config.input.loopTiming.ttlMs<=bufferNow())throw Error('buffer_receipt_stale');
      queryTime=found.evidence.messageRecordedAt;
    }
    // Source verification can yield. Revoke is the last awaited check; the other
    // controls are checked synchronously afterwards, immediately before return.
    if(work.readingTicket&&await core.readingRevoked(work.readingTicket))throw Error('reading_revoked');
    if(!effective.enabled||effective.clean)throw Error('buffer_context_disabled');
    if((work.bufferGeneration??0)!==core.bufferGeneration
      ||queryTime!==null&&parseCmcpInstant(queryTime)+config.input.loopTiming.ttlMs<=bufferNow())throw Error('buffer_receipt_stale');
  }
  async function assertRetainedReadSources(work,result){
    if(work.mode==='local_reading_continuity'){await assertContinuityReceipt(work,result);return;}
    if(!['local_reading_page','local_reading_outline','local_read','local_answer','local_recall'].includes(work.mode))return;
    const ranges=[...(result.internal?.readRanges??[]),...(result.internal?.pages??[]).flatMap(page=>page.internal?.readRanges??[])];
    const hasBody=!!(result.reader?.text||result.modelContext||result.host?.context||result.reader?.outline?.some(row=>row.locator||row.summary));
    if(hasBody&&!ranges.length)throw Error('cached_read_source_proof_unavailable');
    const checked=new Map();
    for(const range of ranges){
      if(range.pointer?.scopeId!==config.input.scopeId||typeof range.evidenceHash!=='string')throw Error('cached_read_source_proof_unavailable');
      const key=cmcpSourcePointerKey(range.pointer);
      if(checked.has(key)){if(checked.get(key)!==range.evidenceHash)throw Error('cached_read_source_proof_conflict');continue;}
      const current=await resolveCmcpHistorySource({provider:core.history,pointer:range.pointer});
      if(current.status!=='found'||loopHash(current.evidence)!==range.evidenceHash)throw Error('cached_read_source_unavailable');
      checked.set(key,range.evidenceHash);
    }
    // Exact source reads can yield; current controls still govern the old receipt.
    await assertBufferReceipt(work,result);
  }
  const readingExit=result=>{
    // The console may show an original page. A Host receives only metadata and an
    // explicitly requested bounded projection, never the human page implicitly.
    const reader=result.reader??{},metadata={};
    for(const key of ['kind','ticket','status','mode','reason','collection','limits','readSources','source','range','coverage','runtimeTime',
      'outline','outlineCoverage','presentation','scope','eventProgress','sourceAvailability','pageNumber','pageBoundary','originalText','modelProjection','revoked','unresolved']){
      if(reader[key]!==undefined)metadata[key]=reader[key];
    }
    if(reader.projection)metadata.projection=Object.fromEntries(['status','bytes','requiredBytes'].filter(k=>reader.projection[k]!==undefined).map(k=>[k,reader.projection[k]]));
    return {...result,host:{...metadata,modelContext:result.modelContext??null}};
  };
  const readingDisabled=()=>readingExit({reader:{kind:'cmcp_reading_collection',status:'disabled',reason:'controls_disabled'},modelContext:null});
  async function loadReadingNavigation(ticket){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticket??''))throw Error('invalid_reading_navigation_ticket');
    const work=await works.read(ticket),file=path.join(config.receiptRoot,'work-'+loopHash(ticket)+'.json');
    if(work?.mode!=='local_reading_navigation'||work.state!=='completed'||work.terminal?.receiptPath!==file)throw Error('reading_navigation_not_completed_here');
    await assertBufferReceipt(work);
    const saved=JSON.parse(await fs.readFile(file,'utf8'));
    if(saved.runtimeId!==config.runtimeId||saved.binding!==binding||saved.workId!==ticket||saved.mode!=='local_reading_navigation'
      ||saved.result?.host?.ticket!==ticket||!saved.result?.internal?.prepared||!(work.source||work.queryBinding)
      ||cmcpReadingQueryKey(saved.result.internal)!==cmcpReadingQueryKey(work.queryBinding??{queryPointer:work.source.pointer}))throw Error('reading_navigation_receipt_mismatch');
    await assertBufferReceipt(work);return {work,result:freeze(structuredClone(saved.result))};
  }
  async function loadReading(ticket,{allowUnresolved=false}={}){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticket??''))throw Error('invalid_reading_ticket');
    const openingWork=await works.read(ticket),expected=path.join(config.receiptRoot,'work-'+loopHash(ticket)+'.json');
    if(openingWork?.mode!=='local_reading_open'||openingWork.state!=='completed'||openingWork.terminal?.receiptPath!==expected)throw Error('reading_open_not_completed_here');
    await assertBufferReceipt(openingWork);
    const saved=JSON.parse(await fs.readFile(expected,'utf8'));
    if(saved.runtimeId!==config.runtimeId||saved.binding!==binding||saved.workId!==ticket||saved.mode!=='local_reading_open'
      ||saved.result?.reader?.ticket!==ticket)throw Error('reading_receipt_mismatch');
    const openingResult=freeze(structuredClone(saved.result)),previousPages=[],unresolved=[],terminalObservations=[];
    if(!(openingWork.source||openingWork.queryBinding)||cmcpReadingQueryKey(openingResult.internal)!==cmcpReadingQueryKey(openingWork.queryBinding??{queryPointer:openingWork.source.pointer}))throw Error('reading_source_binding_mismatch');
    for(const row of (await works.list()).filter(w=>['local_reading_page','local_reading_outline'].includes(w.mode)&&w.readingTicket===ticket)){
      const file=path.join(config.receiptRoot,'work-'+loopHash(row.workId)+'.json');
      if(row.state!=='completed'||row.terminal?.receiptPath!==file){unresolved.push({workId:row.workId,state:row.state});continue;}
      const receipt=JSON.parse(await fs.readFile(file,'utf8'));
      if(receipt.runtimeId!==config.runtimeId||receipt.binding!==binding||receipt.workId!==row.workId||receipt.ticket!==ticket
        ||!['local_reading_page','local_reading_outline'].includes(receipt.mode)||receipt.result?.internal?.manifestHash!==openingResult.internal?.manifestHash
        ||cmcpReadingQueryKey(receipt.result?.internal)!==cmcpReadingQueryKey(openingWork.queryBinding??{queryPointer:openingWork.source.pointer}))throw Error('reading_page_receipt_mismatch');
      if(receipt.mode==='local_reading_outline'){
        for(const page of receipt.result.internal.pages??[])if(!previousPages.some(prior=>prior.internal.pageHash===page.internal.pageHash))previousPages.push(freeze(structuredClone(page)));
      }else if(receipt.result.internal.pageHash)previousPages.push(freeze(structuredClone(receipt.result)));
      else if(!(receipt.result.internal.replayedTerminal||receipt.result.internal.budgetExhausted)
        ||receipt.result.reader?.text!==null||receipt.result.modelContext!==null)throw Error('reading_terminal_receipt_mismatch');
      else terminalObservations.push({at:row.terminal.at,result:receipt.result});
    }
    if(unresolved.length&&!allowUnresolved)throw Error('reading_page_outcome_unresolved');
    previousPages.sort((a,b)=>a.internal.pageNumber-b.internal.pageNumber);
    const terminalResult=terminalObservations.filter(row=>row.result.reader.pageNumber===previousPages.length)
      .sort((a,b)=>parseCmcpInstant(a.at)-parseCmcpInstant(b.at)).at(-1)?.result??null;
    return {openingWork,openingResult,previousPages,unresolved,terminalResult};
  }
  async function readingStatus(ticket){
    if(closed)throw Error('runtime_closed');
    if(!effective.enabled||effective.clean)return readingDisabled();
    // Status never replays a page body or invokes a provider. Control failures are
    // reported without exposing the frozen contents from a now-invalid ticket.
    try{const {openingResult,previousPages,unresolved,terminalResult}=await loadReading(ticket,{allowUnresolved:true});
      const coverage=openingResult.reader.status==='ready'?inspectCmcpReadingProgress({reading:openingResult,previousPages,scopeId:config.input.scopeId}).coverage:null;
      await assertBufferReceipt((await works.read(ticket)),openingResult);
      return readingExit({reader:{kind:'cmcp_reading_progress',ticket,status:unresolved.length?'outcome_unresolved':terminalResult?.reader.status??previousPages.at(-1)?.reader.status??openingResult.reader.status,
        reason:terminalResult?.reader.reason??null,limits:openingResult.reader.limits,collection:openingResult.reader.collection,coverage,unresolved,revoked:false},modelContext:null});
    }catch(error){if(['reading_revoked','buffer_receipt_stale','buffer_context_disabled'].includes(error.message))return readingExit({reader:{kind:'cmcp_reading_progress',ticket,status:'unavailable',reason:error.message,revoked:error.message==='reading_revoked'},modelContext:null});throw error;}
  }
  async function continuityAuthority(work){
    if(closed||requiresReopen)return false;
    const snapshot=constrainControls(await controlManager.snapshot()),current=snapshot.effective;
    return current.enabled&&!current.clean&&current.historyRecall&&current.answerHistory
      &&work.controlStamp===workControlStamp('local_reading_continuity',snapshot)&&await canContinue();
  }
  async function assertContinuityReceipt(work,retained){
    const publicationPath=path.join(config.receiptRoot,'continuity-publication-'+loopHash(work.workId)+'.json');
    try{await fs.access(path.join(config.receiptRoot,'continuity-rejected-'+loopHash(work.workId)+'.json'));throw Error('continuity_publication_rejected');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    let publication;try{publication=JSON.parse(await fs.readFile(publicationPath,'utf8'));}catch{throw Error('continuity_publication_unconfirmed');}
    if(publication.status!=='ready'||publication.binding!==binding||publication.workId!==work.workId||publication.sessionId!==work.sessionId
      ||publication.ticket!==work.readingTicket||publication.projectionHash!==retained.projectionHash)throw Error('continuity_publication_receipt_mismatch');
    await assertBufferReceipt(work,retained);
    if(!await continuityAuthority(work))throw Error('continuity_control_changed');
    const reading=await loadReading(work.readingTicket);
    await core.validateReadingContinuity({openingResult:reading.openingResult,previousPages:reading.previousPages,result:retained,
      operationValid:()=>continuityAuthority(work)});
    await assertBufferReceipt(work,retained);
    if(!await continuityAuthority(work))throw Error('continuity_control_changed');
    return reading;
  }
  async function continuityStatus({projectWide=false}={}){
    if(closed)throw Error('runtime_closed');
    if(typeof projectWide!=='boolean'||projectWide&&!readOnly)throw Error('continuity_project_view_requires_readonly_runtime');
    const observation={observationScope:projectWide?'project':'session',observationSession:sessionId,originalSession:null};
    const empty=(status,reason)=>({kind:'cmcp_continuity_status',status,reason,...observation,projection:null,modelCalls:0});
    if(!effective.enabled||effective.clean||!effective.historyRecall||!effective.answerHistory)return empty('unavailable','controls_disabled');
    // 專案查閱只由可信 controller 的唯讀 Runtime 使用；不接手原 Session 的執行權。
    const work=(await works.list()).filter(row=>row.mode==='local_reading_continuity'&&(projectWide||row.sessionId===sessionId&&row.state==='completed'))
      .sort((a,b)=>parseCmcpInstant(a.terminal?.at??a.at)-parseCmcpInstant(b.terminal?.at??b.at)).at(-1);
    if(!work)return empty('not_found',projectWide?'no_projection_for_current_project':'no_projection_for_current_session');
    observation.originalSession=work.sessionId;
    // 最新工作未完成、取消或失敗時，不退回較早成功結果冒稱最新現況。
    if(work.state!=='completed')return empty('unavailable','latest_projection_not_completed');
    try{
      const expected=path.join(config.receiptRoot,'work-'+loopHash(work.workId)+'.json');
      if(work.terminal.receiptPath!==expected)throw Error('continuity_receipt_mismatch');
      const receipt=JSON.parse(await fs.readFile(expected,'utf8'));
      if(receipt.runtimeId!==config.runtimeId||receipt.binding!==binding||receipt.workId!==work.workId||receipt.sessionId!==work.sessionId
        ||receipt.mode!=='local_reading_continuity'||receipt.ticket!==work.readingTicket)throw Error('continuity_receipt_mismatch');
      if(receipt.result?.replayable===false)return empty('not_retained','disabled_by_source_control');
      const reading=await assertContinuityReceipt(work,receipt.result);
      const sourceLinks=receipt.result.projection.sources.map(citation=>{
        const source=reading.openingResult.internal.manifest.sources.find(item=>item.ref===citation.ref);
        if(!source||source.evidenceHash!==citation.evidenceHash)throw Error('continuity_source_link_mismatch');
        return {ref:source.ref,pointer:structuredClone(source.pointer),evidenceHash:source.evidenceHash,
          location:{unit:'unicode_code_points',start:0,end:source.codePoints},sourceAuthorRole:source.sourceAuthorRole,messageRecordedAt:source.messageRecordedAt};
      });
      return {kind:'cmcp_continuity_status',status:receipt.result.status,reason:receipt.result.reason,modelCoverageComplete:receipt.result.modelCoverageComplete,
        ...observation,ticket:work.readingTicket,projection:receipt.result.projection,
        projectionHash:receipt.result.projectionHash,bodyRetention:'retained',sourceVerification:'currently_revalidated',sourceLinks,modelCalls:0,
        ...(receipt.result.projectionCapacity?{projectionCapacity:structuredClone(receipt.result.projectionCapacity)}:{}),
        ...(receipt.result.projection.version===3?{scopeId:config.input.scopeId,presentation:createCmcpContinuityPresentation({projection:receipt.result.projection,
          projectionHash:receipt.result.projectionHash,scopeId:config.input.scopeId,verifiedScopeId:reading.openingResult.internal.manifest.scopeId,
          ...(receipt.result.presentation?.sourceContext?{reading:reading.openingResult,previousPages:reading.previousPages}:{}),
          ...(receipt.result.presentation?.sourceUseReviewDelivery?{sourceUseReviewDelivery:receipt.result.presentation.sourceUseReviewDelivery}:{})})}:{})};
    }catch(error){return empty('unavailable',/^[a-z][a-z0-9_:]*$/.test(error.message)?error.message:'continuity_revalidation_failed');}
  }
  async function submit(input,proactiveTask=null,bufferGeneration=core.bufferGeneration,publicationGuard=()=>true){
    const operationBufferTtlMs=bufferRetention.ttlMs;
    if(clearFlight)await clearFlight;
    const bufferDependent=!!proactiveTask&&input.proactiveContext?.route!=='pin'||['candidates','read','recall','reading_navigation','reading_open','reading_page','reading_outline','reading_continuity','history_query','history_query_resume'].includes(input.localOperation)
      ||input.recall===true||input.contextOnly===true||input.eventKey!=null;
    if(bufferDependent&&bufferGeneration!==core.bufferGeneration)throw Error('buffer_receipt_stale');
    if(!proactiveTask&&!readOnly&&!closed){
      dispatcher?.interrupt('new_user_operation');
      core.interruptProactive('new_user_operation');
      const pending=active?.mode==='proactive'?active.completed:null;
      cancelProactiveWork('new_user_operation');
      if(pending)await pending;
      await core.waitForProactive();
    }
    if(readOnly||closed||busy)throw Error('runtime_not_writable_or_busy');
    const {workId=randomUUID(),deadlineMs=240000,deadlineAt:explicitDeadline,signal,...rawOperation}=input;
    const operation=freeze(structuredClone(rawOperation));
    if(operation.sourceBufferGeneration!==undefined)throw Error('source_generation_must_come_from_runtime_work');
    if(operation.sourceBufferTtlMs!==undefined)throw Error('source_retention_must_come_from_runtime_work');
    if(operation.queryAuthorization!==undefined||operation.queryBinding!==undefined)throw Error('query_authorization_must_come_from_runtime_work');
    if(operation.localOperation!==undefined&&!['ingest','candidates','read','recall','reading_navigation','reading_open','reading_page','reading_outline','reading_continuity','history_query','history_query_resume','event_resume','discussion_link'].includes(operation.localOperation))throw Error('invalid_local_operation');
    if(operation.localOperation==='ingest'&&((operation.role??'user')==='user'&&!effective.saveUser||operation.role==='assistant'&&!effective.saveAssistant)){
      return {status:'not_saved',reason:'new_source_save_disabled',sourcePointer:null,pointer:null,modelCalls:0};}
    if(['history_query','history_query_resume'].includes(operation.localOperation)&&(!effective.enabled||effective.clean||!effective.historyRecall))return {status:'disabled',modelCalls:0};
    if(operation.localOperation==='discussion_link'&&(!effective.enabled||effective.clean||!effective.discussionAssociation))return {status:'disabled',modelCalls:0};
    if(['reading_navigation','reading_open','reading_page','reading_outline','reading_continuity'].includes(operation.localOperation)&&['openingResult','previousPages','manifest','sourceBufferGeneration','navigationResult'].some(k=>operation[k]!==undefined))throw Error('reading_state_must_come_from_runtime_receipt');
    if(operation.localOperation==='reading_continuity'&&Object.keys(operation).some(key=>!['localOperation','ticket','proposal'].includes(key)))throw Error('continuity_uses_frozen_reading');
    if(operation.localOperation==='reading_continuity'&&(!effective.enabled||effective.clean||!effective.historyRecall||!effective.answerHistory))return {kind:'cmcp_continuity_projection',status:'disabled',projection:null,modelCalls:0};
    if(['reading_navigation','reading_open','reading_page','reading_outline'].includes(operation.localOperation)&&(!effective.enabled||effective.clean||!effective.historyRecall))return readingDisabled();
    if(operation.selection!==undefined&&(!operation.navigationTicket||!['reading_navigation','reading_open'].includes(operation.localOperation)))throw Error('host_selection_requires_navigation_ticket');
    if(operation.localOperation==='reading_page'&&operation.project!==undefined&&typeof operation.project!=='boolean')throw Error('explicit_reading_projection_control');
    if(operation.localOperation==='reading_page'&&['text','limits','mode'].some(k=>operation[k]!==undefined))throw Error('reading_page_uses_frozen_question_and_limits');
    if(['reading_navigation','reading_open'].includes(operation.localOperation)&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workId))throw Error('invalid_reading_ticket');
    if(['candidates','recall'].includes(operation.localOperation)&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workId))throw Error('local_candidate_ticket_must_be_uuid');
    if(operation.localOperation==='read'&&(operation.candidateResult!==undefined||operation.readHistory!==undefined))throw Error('candidate_result_must_come_from_runtime_receipt');
    if(['candidates','read','recall'].includes(operation.localOperation)&&(!effective.enabled||effective.clean)){
      // Controls precede ticket lookup, source resolution, new User save and work creation.
      return operation.localOperation==='candidates'
        ?core.localCandidates({...operation,ticket:workId}):operation.localOperation==='recall'?core.localRecall({...operation,ticket:workId}):core.localRead({candidateResult:null,refs:[]});
    }
    if(operation.savedQueryPointer&&(!effective.enabled||effective.clean))throw Error('resume_source_disabled');
    if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>300000)throw Error('invalid_work_deadline');
    const deadlineAt=explicitDeadline??new Date(Date.now()+deadlineMs).toISOString();const remaining=parseCmcpInstant(deadlineAt)-Date.now();
    if(remaining<=0||remaining>300000)throw Error('invalid_work_deadline');
    const inputHash=loopHash(operation),prior=await works.read(workId);
    if(prior){if(prior.inputHash!==inputHash)throw Error('work_input_conflict');
      if(prior.state==='completed'&&prior.terminal.receiptPath){const receipt=JSON.parse(await fs.readFile(prior.terminal.receiptPath,'utf8'));
        await assertBufferReceipt(prior,receipt.result);if(receipt.result.replayable===false)throw Error('result_body_not_retained');
        await assertRetainedReadSources(prior,receipt.result);return receipt.result;}
      throw Error('work_already_started_use_progress_or_explicit_resume');}
    let source=null,candidateResult=null,readHistory=[],sourceBufferGeneration=null,sourceBufferTtlMs=null,reading=null,navigation=null,queryBinding=null;
    if(['history_query','history_query_resume'].includes(operation.localOperation)){
      const requestId=operation.requestId??workId,queryStatus=await core.historyQueryStatus(requestId);
      if(queryStatus.status!=='not_found'){
        const previousWorks=await works.list();let origin=previousWorks.find(row=>row.mode==='local_history_query'&&row.historyQueryRequestId===requestId);
        // Compatibility: old normal query receipts include the exact request ID.
        // A scrubbed/missing old mapping is not evidence of current authority.
        if(!origin)for(const row of previousWorks.filter(row=>row.mode==='local_history_query'&&row.terminal?.receiptPath)){
          const receipt=JSON.parse(await fs.readFile(row.terminal.receiptPath,'utf8'));
          if(receipt.runtimeId===config.runtimeId&&receipt.binding===binding&&receipt.workId===row.workId&&receipt.result?.requestId===requestId){origin=row;break;}}
        if(!origin)throw Error('history_query_original_work_authority_unavailable');
        await assertBufferReceipt(origin);source=origin.source;queryBinding=origin.queryBinding;sourceBufferTtlMs=origin.bufferTtlMs;
      }
    }
    if(operation.navigationTicket!==undefined){
      if(!['reading_navigation','reading_open'].includes(operation.localOperation)||operation.text!==undefined||operation.savedQueryPointer!==undefined)throw Error('host_reading_reuses_saved_question');
      navigation=await loadReadingNavigation(operation.navigationTicket);source=navigation.work.source;
      queryBinding=navigation.work.queryBinding;
      if(queryBinding)assertCmcpEphemeralQueryText(queryBinding.queryAuthorization,operation.queryText);
      sourceBufferTtlMs=navigation.result.internal.bufferTtlMs;
      const consumed=(await works.list()).find(work=>work.navigationTicket===operation.navigationTicket);
      if(consumed)throw Error('reading_navigation_already_consumed:'+consumed.workId);
    }
    if(['reading_page','reading_outline','reading_continuity'].includes(operation.localOperation)){
      reading=await loadReading(operation.ticket);source=reading.openingWork.source;queryBinding=reading.openingWork.queryBinding;
    }
    if(proactiveTask){
      const pointer=operation.proactiveContext?.pointer;
      const resolved=await resolveCmcpHistorySource({provider:core.history,pointer});
      if(resolved.status!=='found'||operation.proactiveContext?.route!=='pin'&&resolved.evidence.sourceAuthorRole!=='user'||pointer.scopeId!==config.input.scopeId)throw Error('proactive_source_unavailable_or_mismatch');
      source={pointer,evidenceHash:loopHash(resolved.evidence)};
    }
    if(operation.localOperation==='read'){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operation.ticket??''))throw Error('invalid_local_candidate_ticket');
      if(!Array.isArray(operation.refs)||operation.refs.length<1||operation.refs.length>(config.localRetrieval?.maxReadSources??2)
        ||operation.refs.some(ref=>typeof ref!=='string'||!/^c[1-9]\d*$/.test(ref))||new Set(operation.refs).size!==operation.refs.length)throw Error('invalid_local_read_refs');
      if(operation.answer!==undefined&&typeof operation.answer!=='boolean')throw Error('invalid_local_answer_control');
      const candidateWork=await works.read(operation.ticket),expectedPath=path.join(config.receiptRoot,'work-'+loopHash(operation.ticket)+'.json');
      if(candidateWork?.state!=='completed'||candidateWork.mode!=='local_candidates'||candidateWork.terminal?.receiptPath!==expectedPath)throw Error('local_candidate_work_not_completed_here');
      await assertBufferReceipt(candidateWork);
      const receipt=JSON.parse(await fs.readFile(expectedPath,'utf8'));
      if(receipt.runtimeId!==config.runtimeId||receipt.binding!==binding||receipt.workId!==operation.ticket||receipt.mode!=='local_candidates'
        ||receipt.localStage!=='candidates'||receipt.result?.host?.ticket!==operation.ticket)throw Error('local_candidate_receipt_mismatch');
      candidateResult=freeze(structuredClone(receipt.result));
      const candidateBinding=candidateWork.queryBinding??(candidateWork.source?{queryPointer:candidateWork.source.pointer}:null);
      if(!candidateBinding||cmcpReadingQueryKey(candidateResult.internal)!==cmcpReadingQueryKey(candidateBinding))throw Error('local_candidate_source_binding_mismatch');
      const offered=new Set(candidateResult.host.candidates?.map(row=>row.ref));
      if(operation.refs.some(ref=>!offered.has(ref)))throw Error('local_read_ref_outside_candidates');
      source=candidateWork.source;queryBinding=candidateWork.queryBinding;
      // Same question/ticket shares all read exposure, including across processes. An
      // uncertain prior read cannot silently start a fresh allowance. Legacy receipts
      // are matched by their exact question Pointer, never by equal question text.
      const priorReads=(await works.list()).filter(row=>['local_read','local_answer'].includes(row.mode)&&
        (row.readTicket===operation.ticket||row.readTicket===undefined&&row.source&&source&&
          cmcpSourcePointerKey(row.source.pointer)===cmcpSourcePointerKey(source.pointer)));
      for(const row of priorReads){
        const priorPath=path.join(config.receiptRoot,'work-'+loopHash(row.workId)+'.json');
        if(row.state!=='completed'||row.terminal?.receiptPath!==priorPath)throw Error('local_read_prior_outcome_unresolved');
        const saved=JSON.parse(await fs.readFile(priorPath,'utf8'));
        if(saved.runtimeId!==config.runtimeId||saved.binding!==binding||saved.workId!==row.workId||saved.localStage!=='read'
          ||saved.ticket!==undefined&&saved.ticket!==operation.ticket)throw Error('local_read_receipt_mismatch');
        if(cmcpReadingQueryKey(saved.result?.internal)!==cmcpReadingQueryKey(candidateBinding))throw Error('local_read_receipt_source_mismatch');
        readHistory.push(freeze(structuredClone(saved.result)));
      }
    }
    if(operation.localOperation==='event_resume'){
      if(!effective.enabled||effective.clean)throw Error('resume_source_disabled');
      const found=await resolveCmcpHistorySource({provider:core.history,pointer:operation.pointer});
      if(found.status!=='found'||found.evidence.sourceAuthorRole!=='user'||found.evidence.pointer.scopeId!==config.input.scopeId)throw Error('resume_source_unavailable_or_mismatch');
      source={pointer:found.evidence.pointer,evidenceHash:loopHash(found.evidence)};
    }
    if(operation.savedQueryPointer){const found=await resolveCmcpHistorySource({provider:core.history,pointer:operation.savedQueryPointer});
      if(found.status!=='found'||found.evidence.sourceAuthorRole!=='user'||found.evidence.content.body!==operation.text||found.evidence.pointer.scopeId!==config.input.scopeId)throw Error('resume_source_unavailable_or_mismatch');
      source={pointer:found.evidence.pointer,evidenceHash:loopHash(found.evidence)};
      const original=(await works.list()).find(w=>w.source&&cmcpSourcePointerKey(w.source.pointer)===cmcpSourcePointerKey(operation.savedQueryPointer));
      await assertBufferReceipt(original??{mode:'context_only',bufferDependent:true,bufferGeneration:0,source});
      sourceBufferGeneration=original?.bufferGeneration??0;
      sourceBufferTtlMs=original?.bufferTtlMs??config.input.loopTiming.ttlMs;}
    // Admission can wait for source/receipt validation. Recheck before taking the
    // sole active slot so a concurrent operation cannot replace its controller.
    if(closed||busy)throw Error('runtime_not_writable_or_busy');
    if(bufferDependent&&bufferGeneration!==core.bufferGeneration)throw Error('buffer_receipt_stale');
    busy=true;const started=performance.now();
    active={id:workId,deadlineAt,controller:new AbortController(),sourceVersion:source?.evidenceHash,sourcePointer:source?.pointer,queryBinding,bufferGeneration,bufferDependent};
    if(navigation){active.navigationTicket=operation.navigationTicket;active.navigationControlStamp=navigation.work.controlStamp;}
    if(['reading_navigation','reading_open','reading_page','reading_outline','reading_continuity'].includes(operation.localOperation))active.readingTicket=['reading_navigation','reading_open'].includes(operation.localOperation)?workId:operation.ticket;
    let timer,poll,done,finalizing=false;const completed=new Promise(r=>done=r);active.completed=completed;
    const controller=active.controller,abort=()=>controller.abort();
    const mode=proactiveTask?'proactive':operation.localOperation?operation.localOperation==='read'&&operation.answer===true?'local_answer':'local_'+operation.localOperation:
      operation.contextOnly?'context_only':'standalone';
    active.mode=mode;
    active.controlStamp=workControlStamp(mode);
    try{
      await works.start(workId,{sessionId,deadlineAt,inputHash,mode,source,bufferGeneration,bufferDependent,
        ...(queryBinding?{queryBinding}:{}),
        controlStamp:active.controlStamp,
        ...(['history_query','history_query_resume'].includes(operation.localOperation)?{historyQueryRequestId:operation.requestId??workId}:{}),
        bufferTtlMs:sourceBufferTtlMs??operationBufferTtlMs,
        ...(active.readingTicket?{readingTicket:active.readingTicket}:{}),
        ...(active.navigationTicket?{navigationTicket:active.navigationTicket}:{}),
        ...(operation.localOperation==='read'?{readTicket:operation.ticket}: {})});
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      timer=setTimeout(abort,Math.max(1,parseCmcpInstant(deadlineAt)-Date.now()));
      poll=setInterval(()=>{canContinue().then(ok=>{if(!ok&&!finalizing)abort();}).catch(()=>{if(!finalizing)abort();});},100);
      if(!await canContinue())throw Error('work_cancelled_or_expired');
      const result=operation.localOperation==='history_query'?await core.historyQuery({...operation,requestId:operation.requestId??workId}):
        operation.localOperation==='history_query_resume'?await core.resumeHistoryQuery({requestId:operation.requestId,executionBudget:operation.executionBudget,queryText:operation.queryText}):
        operation.localOperation==='discussion_link'?await core.linkDiscussionSegment(operation.declaration):operation.localOperation==='event_resume'?await core.resumeEventSource(operation):operation.localOperation==='reading_navigation'?await core.readingNavigate({...operation,ticket:workId,...(navigation?{navigationResult:navigation.result}:{})}):operation.localOperation==='reading_open'?readingExit(await core.readingOpen({...operation,ticket:workId,...(navigation?{navigationResult:navigation.result}:{})})):
        operation.localOperation==='reading_outline'?readingExit(await core.readingOutline({openingResult:reading.openingResult,previousPages:reading.previousPages})):
        operation.localOperation==='reading_page'?readingExit(await core.readingPage({openingResult:reading.openingResult,previousPages:reading.previousPages,project:operation.project===true})):
        operation.localOperation==='reading_continuity'?await core.readingContinuity({openingResult:reading.openingResult,previousPages:reading.previousPages,proposal:operation.proposal,
          operationValid:()=>continuityAuthority({controlStamp:active.controlStamp})}):
        proactiveTask?await proactiveTask():operation.localOperation==='ingest'?await core.ingest({...operation,
          operationValid:async()=>publicationGuard()===true,publicationGuard}):operation.localOperation==='candidates'
        ?await core.localCandidates({...operation,ticket:workId}):operation.localOperation==='read'
          ?await core.localRead({candidateResult,refs:operation.refs,timeContext:operation.timeContext,answer:operation.answer===true,
            continuation:operation.continuation??null,readHistory,queryText:operation.queryText})
          :operation.localOperation==='recall'?await core.localRecall({...operation,ticket:workId}):await core.submit({...operation,
            ...(sourceBufferGeneration===null?{}:{sourceBufferGeneration,sourceBufferTtlMs})});
      if(!await canContinue())throw Error('work_cancelled_or_expired');
      await fs.mkdir(config.receiptRoot,{recursive:true});
      const receipt={runtimeId:config.runtimeId,sessionId,pid:process.pid,at:new Date().toISOString(),elapsedMs:performance.now()-started,
        workId,binding,mode,...(['candidates','read'].includes(operation.localOperation)?{localStage:operation.localOperation}:{}),
        ...(proactiveTask?{proactiveContext:operation.proactiveContext}:{}),
        ...(operation.localOperation==='read'?{ticket:operation.ticket,selectedRefs:operation.refs,continuation:operation.continuation??null}:{}),result};
      if(active.readingTicket)receipt.ticket=active.readingTicket;
      const receiptPath=path.join(config.receiptRoot,'work-'+loopHash(workId)+'.json');
      // Saving new Assistant messages and replaying authorized source data are
      // separate controls. A pure read receipt contains no new answer: retain it
      // only when its question is already a verified, saved User source. This
      // preserves pagination/navigation across processes without journaling a
      // new unsaved question or an Assistant answer via a diagnostic back door.
      const pureReadingMode=['local_candidates','local_read','local_reading_navigation','local_reading_open','local_reading_page','local_reading_outline'].includes(mode);
      let retainAuthorizedRead=false;
      if(pureReadingMode&&result.internal?.queryPointer&&active.sourcePointer){
        const query=await resolveCmcpHistorySource({provider:core.history,pointer:active.sourcePointer});
        retainAuthorizedRead=query.status==='found'&&query.evidence.sourceAuthorRole==='user'
          &&query.evidence.pointer.scopeId===config.input.scopeId&&loopHash(query.evidence)===active.sourceVersion
          &&cmcpSourcePointerKey(result.internal.queryPointer)===cmcpSourcePointerKey(active.sourcePointer)
          &&(result.internal.queryHash===undefined||result.internal.queryHash===active.sourceVersion);
      }
      if(pureReadingMode&&active.queryBinding&&result.internal?.queryAuthorization){
        await resolveCmcpReadingQuery({history:core.history,scopeId:config.input.scopeId,binding:active.queryBinding});
        retainAuthorizedRead=cmcpReadingQueryKey(result.internal)===cmcpReadingQueryKey(active.queryBinding);
      }
      if(!await canContinue())throw Error('work_cancelled_or_expired');
      if(operation.localOperation==='reading_continuity'){
        result.bodyRetention=effective.saveUser&&effective.saveAssistant?'retained':'not_retained';
        result.replayable=result.bodyRetention==='retained';
      }
      let retainedReceipt=effective.saveUser&&effective.saveAssistant||retainAuthorizedRead?receipt:{...receipt,result:{status:result.status,
        queryPointer:result.queryPointer??null,answerPointer:result.answerPointer??null,bodyRetention:'disabled_by_source_control',
        replayable:false,assistantTiming:result.assistantTiming??null}};
      if(operation.localOperation==='reading_continuity'&&!result.replayable)retainedReceipt={...receipt,result:{kind:result.kind,status:result.status,ticket:result.ticket,
        bodyRetention:'not_retained',replayable:false,projectionHash:result.projectionHash,modelCalls:0}};
      if(retainAuthorizedRead&&active.queryBinding){
        retainedReceipt=structuredClone(receipt);const stored=retainedReceipt.result;
        // The frozen source metadata remains available; the unsaved new question
        // and free-form model navigation prose stay only in this call's memory.
        if(stored.host){delete stored.host.question;if(stored.host.selection?.input)delete stored.host.selection.input.question;}
        if(stored.internal){delete stored.internal.question;if(stored.internal.prepared?.input)delete stored.internal.prepared.input.question;
          delete stored.internal.rawSelection;delete stored.internal.refinedSelection;
          if(stored.internal.selection)delete stored.internal.selection.clarification;}
        if(stored.reader?.reason)stored.reader.reason='ephemeral_query_detail_not_retained';
        if(stored.host?.reason)stored.host.reason='ephemeral_query_detail_not_retained';
        stored.queryBodyRetention='not_saved_ephemeral_operation';
      }
      await fs.writeFile(receiptPath,JSON.stringify(retainedReceipt,null,2),{flag:'wx'});
      const transports=await readCmcpRuntimeProviderWork({ledgerRoot,runtimeAuthorization:authorization});
      const sourceProcessing=proactiveTask?'not_requested':['pending','failed'].includes(result.status)||result.eventProcessing==='pending'||result.dialogueProcessing==='pending'?'pending':
        operation.localOperation?(result.internal?.sourceProcessing??'not_requested'):'completed';
      // A completed journal state must not make our own polling callback cancel success.
      // User cancellation, deadline and Buffer generation still have independent checks.
      if(operation.localOperation==='reading_continuity'&&!await canContinue())throw Error('work_cancelled_or_expired');
      finalizing=true;if(operation.localOperation==='reading_continuity')active.finalizing=true;clearInterval(poll);
      const finished=await works.finish(workId,{state:'completed',sourceProcessing,remoteOutcome:transports.some(w=>w.workId===workId&&w.remoteOutcome==='completed')?'completed':'not_requested',receiptPath});
      if(active.readingTicket&&await core.readingRevoked(active.readingTicket))throw Error('reading_revoked');
      if(finished.state!=='completed'||controller.signal.aborted)throw Error('work_cancelled_or_expired');
      if(bufferDependent&&bufferGeneration!==core.bufferGeneration)throw Error('buffer_receipt_stale');
      if(active.readingTicket&&(!effective.enabled||effective.clean))throw Error('buffer_context_disabled');
      const readingTime=reading?.openingResult.internal.queryTime??result.internal?.queryTime;
      if(active.readingTicket&&readingTime!==undefined&&parseCmcpInstant(readingTime)+config.input.loopTiming.ttlMs<=bufferNow())throw Error('buffer_receipt_stale');
      if(operation.localOperation==='reading_continuity'){
        await core.validateReadingContinuity({openingResult:reading.openingResult,previousPages:reading.previousPages,result,
          operationValid:async()=>publicationGuard()===true&&await continuityAuthority({controlStamp:active.controlStamp})});
        // This operational receipt is metadata only. A completed work alone is
        // never authority to replay a projection whose final exit was rejected.
        await fs.writeFile(path.join(config.receiptRoot,'continuity-publication-'+loopHash(workId)+'.json'),JSON.stringify({
          kind:'cmcp_continuity_publication',status:'ready',binding,workId,sessionId,ticket:operation.ticket,projectionHash:result.projectionHash}),{flag:'wx'});
        if(controller.signal.aborted||publicationGuard()!==true||bufferGeneration!==core.bufferGeneration
          ||active.controlStamp!==workControlStamp('local_reading_continuity')||Date.now()>=parseCmcpInstant(deadlineAt))throw Error('continuity_publication_cancelled');
      }
      return result;
    }catch(error){const failedState=active.controller.signal.aborted?'cancelled':'failed';
      const previewExit=operation.localOperation==='reading_continuity'&&hasCmcpContinuityPreview(error);
      // 有正文的拒絕回饋同樣需要最後來源／取消查證；僅此失敗工作暫留查證出口。
      if(previewExit){active.correctionFinalizing=true;finalizing=true;clearInterval(poll);}else controller.abort(error.message);
      if(operation.localOperation==='reading_continuity'){
        await fs.mkdir(config.receiptRoot,{recursive:true});
        await fs.writeFile(path.join(config.receiptRoot,'continuity-rejected-'+loopHash(workId)+'.json'),JSON.stringify({
          kind:'cmcp_continuity_publication',status:'rejected',binding,workId,sessionId,ticket:operation.ticket,
          reason:/^[a-z][a-z0-9_:]*$/.test(error.message)?error.message:'continuity_exit_failed'}),{flag:'wx'}).catch(writeError=>{if(writeError.code!=='EEXIST')throw writeError;});
      }
      await works.finish(workId,{state:failedState,reason:active.cancelReason??error.message,
      sourceProcessing:proactiveTask?'not_requested':'pending',remoteOutcome:'unknown',receiptPath:null});
      if(previewExit){
        try{await core.validateReadingContinuityCorrection({openingResult:reading.openingResult,previousPages:reading.previousPages,error,
          operationValid:async()=>publicationGuard()===true&&await continuityAuthority({controlStamp:active.controlStamp})});}
        catch(blocked){error=blocked;}
        controller.abort(error.message);
      }
      throw error;
    }finally{clearTimeout(timer);clearInterval(poll);signal?.removeEventListener('abort',abort);busy=false;active=null;done();
      if(!proactiveTask&&!closed)core.resumeProactive();}
  }
  const foreground=async (input,publicationGuard=()=>true)=>{
    await controlFlight;
    if(requiresReopen)throw Error('configuration_requires_reopen');
    const bufferGeneration=core.bufferGeneration;
    if(clearFlight)await clearFlight;
    if(foregroundAdmission)throw Error('runtime_not_writable_or_busy');
    foregroundAdmission=true;
    try{return await submit(input,null,bufferGeneration,publicationGuard);}finally{foregroundAdmission=false;if(!readOnly&&!closed){core.resumeProactive();await dispatcher?.refresh();}}
  };
  const result={sessionId,config,binding,authorization,hostTurnPolicy:effectiveHostTurnPolicy,status,submit:foreground,
    controlsSnapshot:async()=>constrainControls(await controlManager.snapshot()),
    async authorizeSources({updateId,patch,authorizedBy}){
      if(readOnly||closed)throw Error('source_authorization_requires_writable_runtime');
      if(typeof updateId!=='string'||!updateId||typeof authorizedBy!=='string'||!authorizedBy.trim()||!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length||Object.keys(patch).some(k=>!['saveUser','saveAssistant'].includes(k))||Object.values(patch).some(v=>typeof v!=='boolean'))throw Error('explicit_source_authorization_required');
      const records=await inputJournal.read();
      if(records.some(row=>row.record.kind==='source_authorization'&&row.record.value.scopeId!==config.input.scopeId))throw Error('source_authorization_scope_mismatch');
      const prior=records.find(row=>row.record.kind==='source_authorization'&&row.record.value.updateId===updateId);
      if(prior&&loopHash(prior.record.value.patch)!==loopHash(patch))throw Error('source_authorization_conflict');
      if(!prior)await inputJournal.append('source_authorization',{updateId,scopeId:config.input.scopeId,patch,authorizedBy,at:new Date().toISOString()});
      // Replaying an old authorization ID is not a new grant: preserve all later
      // revocations in journal order instead of applying the old patch again.
      sourceAuthorization={...config.sourceAuthorization};
      for(const {record} of await inputJournal.read())if(record.kind==='source_authorization'){
        if(record.value.scopeId!==config.input.scopeId)throw Error('source_authorization_scope_mismatch');
        sourceAuthorization={...sourceAuthorization,...record.value.patch};}
      controlSnapshot=constrainControls(await controlManager.snapshot());Object.assign(effective,controlSnapshot.effective);core.setControls(effective);
      // 先通過正式驗證與保存，再使執行中的模型失效；等待既有工作收束，不重設 writer。
      const pending=active?.completed,hostPending=hostCompletionFlight;
      if(active){active.cancelReason='source_authorization_changed';active.controller.abort('source_authorization_changed');}
      dispatcher?.interrupt('source_authorization_changed');
      if(pending)await pending;if(hostPending)await hostPending.catch(()=>{});
      await dispatcher?.waitForIdle();await dispatcher?.refresh();
      return {status:prior?'unchanged':'authorized',sourceAuthorization:{...sourceAuthorization},modelCalls:0};
    },
    correctDialogueControl:input=>core.correctDialogueControl(input),
    async configureControls({updateId,patch,persist=true,timeContext}){
      if(readOnly||closed)throw Error('runtime_not_writable');
      if(patch.saveUser===true&&!sourceAuthorization.saveUser||patch.saveAssistant===true&&!sourceAuthorization.saveAssistant)throw Error('source_save_not_authorized');
      const next=constrainControls(await controlManager.update({updateId,patch,persist,timeContext:timeContext??{now:clock?clock():new Date().toISOString(),timezone:config.input.timezone}}));
      controlSnapshot=next;Object.assign(effective,next.effective);core.setControls(effective);
      if(Object.hasOwn(patch,'timezone')&&(effective.timezone??config.input.timezone)!==runtimeTimezone)requiresReopen=true;
      if(Object.hasOwn(patch,'bufferRetentionHours')){bufferRetention=normalizeCmcpBufferRetention({hours:effective.bufferRetentionHours});core.setBufferTtlMs(bufferRetention.ttlMs);}
      if(active&&Object.keys(patch).some(key=>['enabled','clean','historyRecall','answerHistory','discussionAssociation','saveUser','saveAssistant'].includes(key))){
        active.cancelReason='controls_changed';active.controller.abort();}
      dispatcher?.interrupt(Object.keys(patch).length===1&&patch.buffer===false?'buffer_disabled':'controls_changed');
      await dispatcher?.refresh();
      return {...next,requiresReopen};
    },
    async timeCard(options={}){if(closed)throw Error('runtime_closed');return currentTimeCard(options);},
    async validateMediaParent({pointer,evidenceHash,messageRecordedAt,textHash,forCapture=false}){
      if(pointer?.scopeId!==config.input.scopeId||typeof evidenceHash!=='string'||!/^[a-f0-9]{64}$/.test(evidenceHash)
        ||typeof textHash!=='string'||!/^[a-f0-9]{64}$/.test(textHash)||typeof messageRecordedAt!=='string'
        ||typeof forCapture!=='boolean')throw Error('media_parent_binding_invalid');
      await controlFlight;
      const snapshot=()=>result.controlsSnapshot(),initial=await snapshot(),stamp=loopHash(initial);
      const allowed=value=>value.enabled&&!value.clean&&(forCapture?value.saveUser:value.historyRecall&&value.answerHistory);
      const valid=async()=>{const current=await snapshot();return !closed&&!requiresReopen&&allowed(current.effective)&&loopHash(current)===stamp;};
      if(!await valid())throw Error('media_parent_controls_changed');
      const entry=(await core.catalog.list()).find(row=>cmcpSourcePointerKey(row.pointer)===cmcpSourcePointerKey(pointer));
      if(!entry||entry.evidenceHash!==evidenceHash||entry.sourceAuthorRole!=='user')throw Error('media_parent_binding_mismatch');
      // 正式 provider 的精確來源核驗，只回傳 metadata；寫入授權不要求開啟舊原文回查。
      const found=await resolveCmcpHistorySource({provider:core.history,pointer:entry.pointer});
      if(found.status!=='found'||loopHash(found.evidence)!==evidenceHash||found.evidence.sourceAuthorRole!=='user'
        ||found.evidence.messageRecordedAt!==messageRecordedAt||loopHash(found.evidence.content.body)!==textHash)throw Error('media_parent_source_unavailable_or_changed');
      if(!await valid())throw Error('media_parent_controls_changed');
      return {kind:'cmcp_media_parent_validation',status:'valid',sourcePointer:entry.pointer,evidenceHash,messageRecordedAt,textHash,modelCalls:0};
    },
    async readSource({pointer,evidenceHash,start=0,end,maxBytes=4096}){
      if(pointer?.scopeId!==config.input.scopeId)throw Error('source_read_scope_mismatch');
      if(typeof evidenceHash!=='string'||!/^[a-f0-9]{64}$/.test(evidenceHash)
        ||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end-start>8192
        ||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>8192)throw Error('invalid_source_read_request');
      await controlFlight;
      const keys=['enabled','clean','historyRecall','answerHistory','readingLimits','timezone'];
      const stamp=snapshot=>loopHash(keys.map(key=>[key,snapshot.effective[key],snapshot.featureRevisions[key]??0]));
      const initial=await controlManager.snapshot();
      const allowed=value=>value.enabled&&!value.clean&&value.historyRecall&&value.answerHistory;
      const valid=async()=>{const current=await controlManager.snapshot();
        return !closed&&!requiresReopen&&allowed(effective)&&allowed(current.effective)&&stamp(initial)===stamp(current);};
      if(!await valid())throw Error('source_read_disabled_or_controls_changed');
      const entry=(await core.catalog.list()).find(row=>cmcpSourcePointerKey(row.pointer)===cmcpSourcePointerKey(pointer));
      if(!entry||entry.evidenceHash!==evidenceHash)throw Error('source_read_binding_mismatch');
      // 使用既有正式範圍 reader；不新增 User、工作、閱讀活動或 Buffer 活化。
      const read=await readCmcpSelectedHistory({stores:core.stores,selected:[{id:entry.id,pointer:entry.pointer,evidenceHash,
        readRange:{unit:'unicode_code_points',start,end}}],temporal:resolveCmcpTimeContext({now:clock?clock():new Date().toISOString(),timezone:runtimeTimezone}),
        limits:{maxSourceBytes:Math.min(maxBytes,effective.readingLimits?.maxReadBytes??maxBytes,effective.readingLimits?.pageBytes??maxBytes),
          maxMaterializedSourceBytes:config.input.storageCapacity?.maxSourceBytes??4096,
          maxProjectionBytes:Math.min(maxBytes+8192,effective.readingLimits?.maxProjectionBytes??(maxBytes+8192))},
        contextOnly:true,valid});
      if(!await valid())throw Error('source_read_disabled_or_controls_changed');
      if(read.status!=='found')return {kind:'cmcp_source_read',status:'source_unavailable',reason:read.reason,modelCalls:0};
      const current=await resolveCmcpHistorySource({provider:core.history,pointer:entry.pointer});
      if(current.status!=='found'||loopHash(current.evidence)!==evidenceHash)throw Error('source_read_binding_mismatch');
      if(!await valid())throw Error('source_read_disabled_or_controls_changed');
      const source=current.evidence,range=read.readRanges[0];
      return {kind:'cmcp_source_read',status:'found',sourcePointer:source.pointer,evidenceHash,sourceAuthorRole:source.sourceAuthorRole,
        sourceKind:source.sourceKind,contentKind:source.content.kind,messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt,
        range:range.location,text:read.projected.evidence[0].content,bytes:range.bytes,storedContentCodePoints:range.storedContentCodePoints,
        completeStoredContent:range.completeStoredContent,activation:'none',modelCalls:0};
    },
    async beforeUser({text,sourceId,timeContext,hostTurn,sessionGuard=()=>true}){
      if(readOnly||closed)throw Error('runtime_not_writable');
      if(typeof sessionGuard!=='function')throw Error('invalid_host_session_guard');
      const checkSession=()=>{if(sessionGuard()!==true)throw Error('cmcp_source_authorization_changed');};
      checkSession();
      if(hostTurn!==undefined)hostTurnAdmissions++;
      try{
      const pointer=sourceId?{version:1,providerNamespace:core.history.descriptor.providerNamespace,scopeId:config.input.scopeId,sessionId,itemId:sourceId,revisionId:'r1'}:undefined;
      let turn,turnInputHash,initialTurnState;
      if(hostTurn!==undefined){
        if(!pointer||!hostTurn||typeof hostTurn!=='object'||typeof hostTurn.workId!=='string'
          ||Object.keys(hostTurn).some(key=>!['workId','deadlineAt','bufferDependent'].includes(key))
          ||hostTurn.bufferDependent!==undefined&&typeof hostTurn.bufferDependent!=='boolean')throw Error('invalid_host_turn_request');
        turnInputHash=loopHash({sourceId,queryHash:loopHash(text),bufferDependent:hostTurn.bufferDependent??true});
        turn=await works.read(hostTurn.workId);
        if(turn&&(turn.mode!=='host_turn'||turn.sessionId!==sessionId||turn.inputHash!==turnInputHash))throw Error('host_turn_input_conflict');
        if(!turn){
          const deadlineAt=hostTurn.deadlineAt??new Date(Date.now()+effectiveHostTurnPolicy.timeoutMs).toISOString(),remaining=parseCmcpInstant(deadlineAt)-Date.now();
          if(remaining<=0||remaining>effectiveHostTurnPolicy.maxTimeoutMs)throw Error('invalid_work_deadline');
          initialTurnState={...await hostTurnState(),deadlineAt};
        }
      }
      const finishCapture=async capture=>{
        checkSession();
        // 原生身分與原文保存分開；停止保存仍可綁定 Host 回合。
        capture={...capture,nativeSourcePointer:pointer??null};
        if(hostTurn===undefined)return capture;
        const ticket={kind:'cmcp_host_turn',version:1,workId:hostTurn.workId};
        if(!turn){
          const found=capture.sourcePointer?await resolveCmcpHistorySource({provider:core.history,pointer:capture.sourcePointer}):null;
          checkSession();
          if(found&&found.status!=='found')throw Error('host_turn_source_unavailable');
          turn=await works.start(hostTurn.workId,{sessionId,mode:'host_turn',inputHash:turnInputHash,deadlineAt:initialTurnState.deadlineAt,
            hostTurnPolicy:effectiveHostTurnPolicy,
            source:found?{pointer:found.evidence.pointer,evidenceHash:loopHash(found.evidence)}:null,nativeUserPointer:pointer,
            bufferDependent:hostTurn.bufferDependent??true,bufferGeneration:initialTurnState.boundary.generation,
            controlStamp:initialTurnState.controlStamp,sourceAuthorizationStamp:initialTurnState.sourceAuthorizationStamp});
        }
        ownedHostTurns.add(hostTurn.workId);
        await checkHostTurn(ticket,{allowCompleted:true});
        checkSession();
        return {...capture,hostTurn:ticket};
      };
      const timeStamp=timeControlStamp(),card=await result.timeCard({timeContext,excludePointers:pointer?[pointer]:[]});
      checkSession();
      const retainedCard=()=>timeProjectionAllowed()&&timeStamp===timeControlStamp()?card:null;
      if(!sourceAuthorization.saveUser||effective.saveUser===false)return await finishCapture({status:'not_saved',timeCard:retainedCard(),sourcePointer:null});
      if(pointer){const prior=await resolveCmcpHistorySource({provider:core.history,pointer});if(prior.status==='found'){
        if(prior.evidence.sourceAuthorRole!=='user'||prior.evidence.content.body!==text)throw Error('host_source_identity_conflict');
        return await finishCapture({status:'unchanged',timeCard:retainedCard(),sourcePointer:pointer});}}
      // 對話撤權沿既有原文發布守護生效，不只在排入工作前檢查一次。
      const saved=await foreground({text,role:'user',pointer,timeContext,localOperation:'ingest'},sessionGuard);
      return await finishCapture({status:saved.status,timeCard:retainedCard(),sourcePointer:saved.pointer});
      }finally{if(hostTurn!==undefined)hostTurnAdmissions--;}
    },
    async validateHostTurn(hostTurn){
      const work=await checkHostTurn(hostTurn,{allowCompleted:true});
      return {kind:'cmcp_host_turn_validation',status:'valid',workId:work.workId,state:work.state,modelCalls:0};
    },
    async afterAssistant({text,sourceId,replyTo,timeContext,hostTurn,finalizeHostTurn=true,sessionGuard=()=>true}){
      if(readOnly||closed)throw Error('runtime_not_writable');
      if(typeof finalizeHostTurn!=='boolean'||!finalizeHostTurn&&!hostTurn)throw Error('invalid_host_assistant_finalization');
      if(typeof sessionGuard!=='function')throw Error('invalid_host_session_guard');
      const validateTurn=async()=>{
        if(sessionGuard()!==true)throw Error('cmcp_source_authorization_changed');
        const work=await checkHostTurn(hostTurn,{replyTo:replyTo??null,allowCompleted:finalizeHostTurn});
        if(sessionGuard()!==true)throw Error('cmcp_source_authorization_changed');return work;
      };
      const publish=async()=>{
        const turn=hostTurn?await validateTurn():null;
        if(hostTurn&&!sourceId)throw Error('host_turn_assistant_identity_required');
        if(!sourceAuthorization.saveAssistant||effective.saveAssistant===false){
          if(turn&&finalizeHostTurn)await works.finish(turn.workId,{state:'completed',sourceProcessing:'not_requested',remoteOutcome:'host_observed',receiptPath:null,hostReply:{sourcePointer:null,bodyRetention:'disabled'}});
          return {status:'not_saved',sourcePointer:null,...(hostTurn?{hostTurn}: {})};
        }
        let replyBinding='none';
        if(replyTo){if(replyTo.scopeId!==config.input.scopeId||replyTo.sessionId!==sessionId)throw Error('assistant_reply_scope_mismatch');
          const found=await resolveCmcpHistorySource({provider:core.history,pointer:replyTo});
          if(found.status==='found'&&found.evidence.sourceAuthorRole!=='user')throw Error('assistant_reply_role_mismatch');
          if(found.status!=='found'&&effective.saveUser!==false)throw Error('assistant_reply_source_unavailable');
          replyBinding=found.status==='found'?'verified_user_source':'native_identity_only_user_body_not_saved';
          if(found.status==='found')replyTo=found.evidence.pointer;}
        const pointer=sourceId?{version:1,providerNamespace:core.history.descriptor.providerNamespace,scopeId:config.input.scopeId,sessionId,itemId:sourceId,revisionId:'r1'}:undefined;
        if(turn?.state==='completed'&&(!turn.terminal.hostReply?.sourcePointer
          ||cmcpSourcePointerKey(turn.terminal.hostReply.sourcePointer)!==cmcpSourcePointerKey(pointer)))throw Error('host_turn_answer_identity_conflict');
        let saved;
        if(pointer){const prior=await resolveCmcpHistorySource({provider:core.history,pointer});if(prior.status==='found'){
          if(prior.evidence.sourceAuthorRole!=='assistant'||prior.evidence.content.body!==text)throw Error('host_source_identity_conflict');
          saved={status:'unchanged',pointer:prior.evidence.pointer,evidence:prior.evidence};}}
        if(hostTurn)await validateTurn();
        // 受守護的 Host 回合已持有 Runtime 發布邊界，沿用 Core 保存，避免巢狀前景工作。
        try{saved??=await (hostTurn?core.ingest({text,role:'assistant',pointer,timeContext,
          operationValid:async()=>{await validateTurn();return true;},publicationGuard:sessionGuard}):result.ingest({text,role:'assistant',pointer,timeContext}));}
        catch(error){if(hostTurn)await validateTurn();throw error;}
        if(hostTurn)await validateTurn();
        let formalReply=null;
        if(replyBinding==='verified_user_source')formalReply=await core.recordHostReply({pointer:saved.pointer,replyTo});
        if(replyTo){
          const binding={pointer:saved.pointer,replyTo,evidenceHash:loopHash(saved.evidence),messageRecordedAt:saved.evidence.messageRecordedAt,replyBinding};
          const prior=(await inputJournal.read()).find(row=>row.record.kind==='host_reply_binding'
            &&cmcpSourcePointerKey(row.record.value.pointer)===cmcpSourcePointerKey(saved.pointer))?.record.value;
          if(prior&&loopHash(prior)!==loopHash(binding))throw Error('host_reply_binding_conflict');
          if(!prior)await inputJournal.append('host_reply_binding',binding);
        }
        if(hostTurn)await validateTurn();
        if(hostTurn&&finalizeHostTurn){
          const finished=await works.finish(turn.workId,{state:'completed',sourceProcessing:'not_requested',remoteOutcome:'host_observed',receiptPath:null,
            hostReply:{sourcePointer:saved.pointer,evidenceHash:loopHash(saved.evidence),replyTo:replyTo??null}});
          if(finished.state!=='completed')throw Error('host_turn_not_active');
          await validateTurn();
        }
        return {status:saved.status,sourcePointer:saved.pointer,replyTo:replyTo??null,replyBinding,
          formalReply:formalReply?{status:'verified',sourceHash:formalReply.sourceHash,replyToEvidenceHash:formalReply.replyToEvidenceHash}:null,
          ...(hostTurn?{hostTurn}: {})};
      };
      if(!hostTurn)return publish();
      await controlFlight;
      if(busy||foregroundAdmission||hostCompletionFlight)throw Error('runtime_not_writable_or_busy');
      busy=true;foregroundAdmission=true;
      hostCompletionFlight=withCmcpBufferPublication({root:config.input.root,scopeId:config.input.scopeId},publish);
      try{return await hostCompletionFlight;}finally{hostCompletionFlight=null;busy=false;foregroundAdmission=false;}
    },
    setBufferRetention(value){
      if(readOnly||closed||busy||foregroundAdmission)throw Error('buffer_retention_change_requires_idle_runtime');
      const next=normalizeCmcpBufferRetention(value);
      core.setBufferTtlMs(next.ttlMs);bufferRetention=Object.freeze({...next,source:'session_override'});
      return {kind:'cmcp_buffer_retention',...bufferRetention,persistent:false,modelCalls:0};
    },
    bufferList(options={}){if(closed)throw Error('runtime_closed');
      if(options.scopeId!==undefined&&options.scopeId!==config.input.scopeId)throw Error('buffer_scope_mismatch');return core.bufferList(options);},
    clearBuffer(options={}){
      if(readOnly||closed)throw Error('runtime_not_writable');
      if(options.scopeId!==undefined&&options.scopeId!==config.input.scopeId)throw Error('buffer_scope_mismatch');
      if(clearFlight)return clearFlight;
      // Clear only interrupts the current operation that depends on Buffer context.
      // Unrelated ingest/ordinary unaugmented work and raw pending sources remain intact.
      if(active?.bufferDependent){active.cancelReason='buffer_cleared';active.controller.abort();}
      dispatcher?.interrupt('buffer_clear');
      const operation=core.clearBuffer(options);
      clearFlight=Promise.resolve(operation).finally(async()=>{clearFlight=null;await dispatcher?.refresh();});return clearFlight;
    },
    pinList:()=>readOnlyPins.list(),
    pinCreate:input=>{if(!dispatcher)throw Error('runtime_not_writable');return dispatcher.pinCreate(input);},
    pinChange:input=>{if(!dispatcher)throw Error('runtime_not_writable');return dispatcher.pinChange(input);},
    ingest:input=>foreground({...input,localOperation:'ingest'}),
    async localCandidates({sourceId,...input}){
      if(sourceId!==undefined){
        if(!effective.enabled||effective.clean||!effective.historyRecall)return foreground({...input,localOperation:'candidates'});
        const matches=(await core.catalog.list()).filter(row=>row.pointer.scopeId===config.input.scopeId&&row.pointer.itemId===sourceId&&row.sourceAuthorRole==='user');
        if(matches.length!==1)throw Error('host_query_source_missing_or_ambiguous');
        input.savedQueryPointer=matches[0].pointer;
      }
      return foreground({...input,localOperation:'candidates'});
    },
    localRead:input=>foreground({...input,localOperation:'read'}),
    localRecall:input=>foreground({...input,localOperation:'recall'}),
    async readingNavigate({sourceId,...input}){
      if(sourceId!==undefined){
        if(!effective.enabled||effective.clean||!effective.historyRecall)return foreground({...input,localOperation:'reading_navigation'});
        const matches=(await core.catalog.list()).filter(row=>row.pointer.scopeId===config.input.scopeId&&row.pointer.itemId===sourceId&&row.sourceAuthorRole==='user');
        if(matches.length!==1)throw Error('host_query_source_missing_or_ambiguous');input.savedQueryPointer=matches[0].pointer;
      }
      return foreground({...input,localOperation:'reading_navigation'});
    },
    readingOpen:input=>foreground({...input,limits:applyReadingControls(input.limits),localOperation:'reading_open'}),
    readingPage:input=>foreground({...input,localOperation:'reading_page'}),
    readingOutline:input=>foreground({...input,localOperation:'reading_outline'}),
    readingContinuity:input=>foreground({...input,localOperation:'reading_continuity'}),
    continuityStatus,
    historyQuery:input=>foreground({...input,readingLimits:applyReadingControls(input.readingLimits),localOperation:'history_query'}),
    resumeHistoryQuery:input=>foreground({...input,localOperation:'history_query_resume'}),
    historyQueryStatus:id=>core.historyQueryStatus(id),
    linkDiscussionSegment:declaration=>foreground({localOperation:'discussion_link',declaration}),
    discussionSegments:options=>{if(closed)throw Error('runtime_closed');return core.discussionSegments(options);},
    readingStatus,
    async revokeReading({ticket,reason='caller_revoked'}){
      if(readOnly||closed)throw Error('runtime_not_writable');
      const work=await works.read(ticket);
      if(!['local_reading_open','local_reading_navigation'].includes(work?.mode))throw Error('reading_open_not_found_here');
      if(active?.readingTicket===ticket){active.cancelReason='reading_revoked';active.controller.abort();}
      await core.revokeReading({ticket,reason});
      return readingExit({reader:{kind:'cmcp_reading_progress',ticket,status:'revoked',revoked:true},modelContext:null});
    },
    progress:workId=>works.read(workId),
    cancelWork:({workId,reason})=>works.cancel(workId,reason),
    refreshDispatch:()=>dispatcher?.refresh()??{status:'read_only',modelCalls:0},
    dispatchStatus:()=>dispatcher?.status()??null,
    recoverWork:({workId,reason})=>recoverCmcpRuntimeWork({config,repoRoot,workId,reason}),
    async resumeSource(pointer,options={}){
      if(options.stage!==undefined&&!['event','dialogue','discussion','conversation'].includes(options.stage))throw Error('invalid_source_recovery_stage');
      if(!effective.enabled||effective.clean)throw Error('resume_source_disabled');
      if(pointer?.scopeId!==config.input.scopeId)throw Error('resume_source_scope_mismatch');
      const found=await resolveCmcpHistorySource({provider:core.history,pointer});
      if(found.status!=='found'||found.evidence.sourceAuthorRole!=='user'||found.evidence.content.kind!=='source_excerpt')throw Error('resume_source_unavailable_or_role');
      const associations=(await createLocalLoopJournal({root:path.join(config.input.root,'input-journal'),name:'cmcp-common-input-v1'}).read()).filter(r=>r.record.kind==='source_association');
      if(associations.some(r=>cmcpSourcePointerKey(r.record.value.pointer)===cmcpSourcePointerKey(pointer))){
        if(options.contextOnly)throw Error('event_recovery_has_no_model_context');
        return foreground({...options,localOperation:'event_resume',pointer});
      }
      if(['dialogue','discussion','conversation'].includes(options.stage))throw Error('recovery_requires_event_association');
      return foreground({...options,text:found.evidence.content.body,recall:true,eventKey:null,savedQueryPointer:pointer});},
    resumeDialogue:(pointer,options={})=>result.resumeSource(pointer,{...options,stage:'dialogue'}),
    resumeDiscussion:(pointer,options={})=>result.resumeSource(pointer,{...options,stage:'discussion'}),
    resumeConversation:(pointer,options={})=>result.resumeSource(pointer,{...options,stage:'conversation'}),
    async recover(options={}){if(closed||readOnly||busy||active||foregroundAdmission||hostCompletionFlight)throw Error('runtime_not_writable_or_busy');busy=true;try{return await core.recover(options);}finally{busy=false;}},
    setControls(next){if(closed)throw Error('runtime_closed');const updated={...effective,...Object.fromEntries(Object.entries(next).filter(([key])=>['enabled','clean','proactive'].includes(key)))};
      if(!['enabled','clean','proactive'].every(key=>typeof updated[key]==='boolean'))throw Error('invalid_runtime_controls');
      if(!readOnly&&updated.proactive&&typeof delivery?.present!=='function')throw Error('explicit_proactive_delivery_required');
      core.setControls(updated);Object.assign(effective,updated);
      dispatcher?.interrupt('legacy_session_controls_changed');
      if(active){active.cancelReason='controls_changed';active.controller.abort();}
      const patch=Object.fromEntries(['enabled','clean','proactive'].filter(key=>Object.hasOwn(next,key)).map(key=>[key,updated[key]]));
      controlFlight=controlFlight.then(()=>result.configureControls({updateId:randomUUID(),patch,persist:false}));
      // Legacy callers may omit await: subsequent work/status/close is fenced.
      controlFlight.catch(()=>{});return controlFlight;},
    async context({text,timeContext,...options}){return getCmcpHostContext({runtime:{submit:input=>foreground({...input,...options})},text,timeContext});},
    async resumeContext(pointer,options={}){if(!effective.enabled||effective.clean)throw Error('resume_source_disabled');
      const found=await resolveCmcpHistorySource({provider:core.history,pointer});
      if(found.status!=='found')throw Error('resume_source_unavailable');
      return getCmcpHostContext({runtime:{submit:input=>result.resumeSource(pointer,{...options,contextOnly:true,timeContext:input.timeContext})},
        text:found.evidence.content.body,timeContext:options.timeContext});},
    async close(){if(closed)return;await controlFlight;closed=true;core.interruptProactive('runtime_closed');dispatcher?.interrupt('runtime_closed');
      if(hostCompletionFlight)await hostCompletionFlight.catch(()=>{});
      for(const workId of ownedHostTurns){const work=await works.read(workId);if(work?.state==='running'||work?.state==='cancelling'){
        await works.cancel(workId,'runtime_closed');await works.finish(workId,{state:'cancelled',sourceProcessing:'not_requested',remoteOutcome:'unknown',receiptPath:null});}}
      if(clearFlight)await clearFlight;
      if(active){const current=active,pending=current.completed;current.controller.abort();await works.cancel(current.id,'runtime_closed');await pending;}
      await core.waitForProactive();
      await dispatcher?.close();
      try{await core.close();adapter?.dispose();if(lock){await lock.close();await fs.unlink(lockFile);lock=undefined;}}
      finally{if(budgetOwnerLock){await budgetOwnerLock.close();await fs.unlink(budgetOwnerLockFile);budgetOwnerLock=undefined;}}}
  };
  function applyReadingControls(limits){
    const configured=effective.readingLimits;if(!configured)return limits;
    const mapping={maxSources:'maxSources',maxReadBytes:'maxTotalBytes',maxProjectionBytes:'maxProjectionBytes',pageBytes:'maxPageBytes'};
    return Object.fromEntries(Object.entries(limits??{}).map(([key,value])=>{
      const control=Object.keys(mapping).find(name=>mapping[name]===key);
      return [key,control&&configured[control]!==undefined?Math.min(value,configured[control]):value];}));
  }
  await dispatcher?.refresh();
  return Object.freeze(result);
}

export async function cancelCmcpRuntimeWork({config:raw,repoRoot,workId,reason}){
  const {config,binding}=normalizeCmcpRuntimeConfig(raw,{repoRoot});return createCmcpRuntimeWorkJournal({root:config.input.root,binding}).cancel(workId,reason);
}
export async function recoverCmcpRuntimeWork({config:raw,repoRoot,workId,logicalId,reason='owner_process_exited',budgetDependency}){
  const normalized=normalizeCmcpRuntimeConfig(raw,{repoRoot}),{config,binding}=normalized;
  const {budgetRoot,ledgerRoot,budgetBinding,ownerRoot:budgetOwnerRoot,expectedAuthorizationId}=await resolveRuntimeBudgetDependency(normalized,budgetDependency,repoRoot);
  const attachment=(await createLocalLoopJournal({root:path.join(config.input.root,'input-journal'),name:'cmcp-common-input-v1'}).read()).find(row=>row.record.kind==='runtime_budget_dependency')?.record.value;
  if(attachment&&(!budgetOwnerRoot||attachment.dataBinding!==binding||attachment.budgetBinding!==budgetBinding||attachment.ownerRoot!==budgetOwnerRoot))throw Error('runtime_budget_dependency_required_or_changed');
  const works=createCmcpRuntimeWorkJournal({root:config.input.root,binding}),authorization={root:budgetRoot,binding:budgetBinding,...(expectedAuthorizationId?{expectedAuthorizationId}:{})};
  const provider=await readCmcpRuntimeProviderWork({ledgerRoot,runtimeAuthorization:authorization});
  const recovered=[];
  const work=workId?await works.read(workId):null;
  if(workId&&!work)throw Error('work_not_found');
  if(work&&isCmcpProcessAlive(work.ownerPid))throw Error('work_owner_still_alive');
  const selected=provider.filter(r=>workId?r.workId===workId:r.logicalId===logicalId);
  if(!work&&!selected.length)throw Error('provider_work_not_found');
  if(budgetOwnerRoot&&!work)throw Error('shared_budget_recovery_requires_bound_work');
  // Serialize formal recovery with normal writers using their existing lease.
  const lockFiles=[...(budgetOwnerRoot?[path.join(budgetOwnerRoot,'.common-input-writer.lock')]:[]),path.join(config.input.root,'.common-input-writer.lock')];
  const leases=await acquireCmcpRecoveryLeases({lockFiles,expectedOwnerPid:work?.ownerPid??provider.find(r=>r.logicalId===logicalId)?.pid,
    onPreserved:row=>createLocalLoopJournal({root:path.join(config.input.root,'runtime-recovery'),name:'cmcp-runtime-recovery-v1'}).append('ended_owner_lease_preserved',
      {...row,workId:workId??null,logicalId:logicalId??null,recoveredByPid:process.pid,reason,sourceProcessing:'pending'})});
  try{
    for(const row of selected)recovered.push(await finalizeCmcpInterruptedProviderWork({ledgerRoot,runtimeAuthorization:authorization,logicalId:row.logicalId,reason}));
    const terminal=work?await works.recover(workId,reason):null;
    return {status:'recovered',work:terminal,provider:recovered,preservedLeases:leases.preserved,modelCalls:0,sourceProcessing:'pending',remoteOutcome:'unknown',budgetRefunded:false};
  }finally{await leases.release();}
}

/** Explicit caller action only. Never called by open, resume, status, helpers or model requests. */
export async function authorizeCmcpRuntime({config,repoRoot,authorizationId,limits,authorizedBy}){
  const session=await createCmcpRuntimeSession({config,repoRoot,readOnly:true});
  try{return await authorizeRuntimeBudget({...session.authorization,authorizationId,limits,authorizedBy});}
  finally{await session.close();}
}
