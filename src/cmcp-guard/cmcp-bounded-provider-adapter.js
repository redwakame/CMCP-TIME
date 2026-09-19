import path from "node:path";
import { createLocalLoopJournal, loopHash } from "./cmcp-local-loop-journal.js";
import { createCmcpResponsesTransport } from "./cmcp-responses-transport.js";
import { DEEPSEEK_LOOP_CONFIG } from "./cmcp-deepseek-configured-adapter.js";
import { LOOP_INSTRUCTIONS, LOOP_SCHEMAS, LOOP_EVENT_REVIEW_PROTOCOL,CMCP_LOOP_PURPOSES } from "./cmcp-local-loop-protocol.js";
import {readRuntimeBudget} from './cmcp-model-job-budget.js';

// Measured normal-operation schema/context overhead; this does not enlarge source,
// event-context, output-token, deadline or durable grant limits.
export const CMCP_RUNTIME_REQUEST_LIMITS = Object.freeze({defaultBytes:DEEPSEEK_LOOP_CONFIG.maxRequestBytes,
  answerBytes:24576,answerAppliesTo:'normal_answer',semanticDiscussionBytes:32768,semanticDiscussionAppliesTo:'normal_semantic_with_validated_discussion_context',
  semanticAnswerHistoryBytes:40960,semanticAnswerHistoryAppliesTo:'normal_semantic_with_validated_discussion_and_answer_history',
  optedInSemanticAnswerHistoryBytes:49152,optedInAnswerHistoryBytes:40960});

// Current authorization: DeepSeek only. Legacy profile names retain their bounded purposes, not retired providers.
export const BOUNDED_PROVIDER_CONFIG = Object.freeze({ version: 1, maxPosts: 8, maxLogicalCalls: 6,
  purposeLimits: { semantic: 3, answer: 2, proactive: 1 }, availabilityHttp: [],
  primary: { ...DEEPSEEK_LOOP_CONFIG, maxCalls: 8 }, backup:null });
export const HISTORY_REACTIVATION_PROVIDER_CONFIG = Object.freeze({...BOUNDED_PROVIDER_CONFIG,maxPosts:10,maxLogicalCalls:8,
  purposeLimits:{...BOUNDED_PROVIDER_CONFIG.purposeLimits,recall_select:1,recall_answer:1},
  primary:{...BOUNDED_PROVIDER_CONFIG.primary,maxCalls:10},backup:null});
export const INCREMENTAL_CATALOG_PROVIDER_CONFIG = Object.freeze({...HISTORY_REACTIVATION_PROVIDER_CONFIG,maxLogicalCalls:7,
  purposeLimits:{semantic:2,answer:2,recall_select:1,recall_answer:2}});
export const HOST_CONTEXT_PROVIDER_CONFIG = Object.freeze({...BOUNDED_PROVIDER_CONFIG,maxPosts:5,maxLogicalCalls:5,
  purposeLimits:{recall_select:1,recall_answer:3,answer:1},primary:{...BOUNDED_PROVIDER_CONFIG.primary,maxCalls:5}});
export const HOST_INTEGRATION_PROVIDER_CONFIG = Object.freeze({...HOST_CONTEXT_PROVIDER_CONFIG,maxPosts:4,maxLogicalCalls:4,
  purposeLimits:{recall_select:3,recall_answer:1},primary:{...HOST_CONTEXT_PROVIDER_CONFIG.primary,maxCalls:4}});
const configFor=profile=>profile==='host-integration-v1'?HOST_INTEGRATION_PROVIDER_CONFIG:profile==='host-context-v1'?HOST_CONTEXT_PROVIDER_CONFIG:profile==='incremental-catalog-v1'?INCREMENTAL_CATALOG_PROVIDER_CONFIG:profile==='history-reactivation-v1'?HISTORY_REACTIVATION_PROVIDER_CONFIG:BOUNDED_PROVIDER_CONFIG;
export const boundedProviderProtocolHash = (profile) => loopHash({ instructions: LOOP_INSTRUCTIONS, schemas: LOOP_SCHEMAS,
  eventReview:LOOP_EVENT_REVIEW_PROTOCOL, config: configFor(profile) });

const routeJournal=ledgerRoot=>createLocalLoopJournal({root:path.join(ledgerRoot,'../provider-route'),name:'cmcp-bounded-provider-v1'});
const attemptJournal=ledgerRoot=>createLocalLoopJournal({root:ledgerRoot,name:'cmcp-local-loop-attempts-v1'});
function ownerState(pid){
  if(!Number.isSafeInteger(pid)||pid<=0)return 'unknown';
  try{process.kill(pid,0);return 'running';}catch(error){if(error.code==='ESRCH')return 'exited';return 'unknown';}
}
/** Zero-model inspection, including legacy starts with no PID/work context. Never repairs or grants quota. */
export async function readCmcpRuntimeProviderWork({ledgerRoot,runtimeAuthorization}){
  if(!runtimeAuthorization?.binding)throw Error('runtime_authorization_binding_required');
  const freezeId='runtime:'+runtimeAuthorization.binding;
  const records=(await routeJournal(ledgerRoot).read()).map(r=>r.record),attempts=(await attemptJournal(ledgerRoot).read()).map(r=>r.record);
  const starts=records.filter(r=>r.kind==='logical_started');
  if(starts.some(r=>r.value.freezeId!==freezeId))throw Error('route_manifest_mismatch');
  return starts.map((row,index)=>{
    const start=row.value,end=records.find(r=>r.kind==='logical_result'&&r.value.logicalId===start.logicalId)?.value;
    const next=starts[index+1]?.value;
    const candidates=attempts.filter(r=>r.kind==='started'&&r.value.freezeId===freezeId&&r.value.purpose===start.purpose&&
      (r.value.workContext?.logicalId===start.logicalId||!r.value.workContext?.logicalId&&r.value.startedAt>=start.startedAt&&(!next||r.value.startedAt<next.startedAt)));
    const candidate=candidates.length===1?candidates[0].value:null,pid=start.pid??candidate?.pid??null;
    const transportResult=candidate?attempts.find(r=>r.kind==='result'&&r.value.attempt===candidate.attempt)?.value:null;
    return {logicalId:start.logicalId,purpose:start.purpose,pid,owner:ownerState(pid),sessionId:start.sessionId??null,
      workId:start.workContext?.workId??candidate?.workContext?.workId??null,
      sourceVersion:start.workContext?.sourceVersion??candidate?.workContext?.sourceVersion??null,
      deadlineAt:start.deadlineAt??candidate?.deadlineAt??null,startedAt:start.startedAt,
      status:end?.status??'in_progress',code:end?.code??null,remoteOutcome:end?.remoteOutcome??transportResult?.remoteOutcome??'unknown',
      attempt:candidate?.attempt??null,transportStatus:transportResult?.status??(candidate?'started':null),
      sourceProcessing:end?.sourceProcessing??(end?.status==='completed'?'not_determined_by_transport':'pending'),endedAt:end?.endedAt??null};
  });
}

/** Explicit caller-owned single-writer recovery. PID must be demonstrably gone; no history mutation or refund. */
export async function finalizeCmcpInterruptedProviderWork({ledgerRoot,runtimeAuthorization,logicalId,reason='owner_process_exited'}){
  if(!Number.isSafeInteger(logicalId)||logicalId<1||!['owner_process_exited','host_finished_before_tool','user_cancelled'].includes(reason))throw Error('invalid_provider_finalization');
  const work=(await readCmcpRuntimeProviderWork({ledgerRoot,runtimeAuthorization})).find(w=>w.logicalId===logicalId);
  if(!work)throw Error('logical_work_not_found');
  if(work.status!=='in_progress')return {status:'already_terminal',work};
  if(work.owner!=='exited')throw Error('logical_work_owner_not_confirmed_exited');
  const endedAt=new Date().toISOString();
  if(work.attempt!==null&&work.transportStatus==='started')await attemptJournal(ledgerRoot).append('result',{
    attempt:work.attempt,purpose:work.purpose,startedAt:work.startedAt,endedAt,status:'interrupted',code:reason,
    responseBody:null,responseSha256:null,http:null,remoteOutcome:'unknown',sourceProcessing:'pending',
    evidence:'explicit_orphan_finalization_no_remote_result',ownerPid:work.pid,recoveredByPid:process.pid});
  await routeJournal(ledgerRoot).append('logical_result',{logicalId,purpose:work.purpose,status:'interrupted',code:reason,
    endedAt,remoteOutcome:'unknown',sourceProcessing:'pending',ownerPid:work.pid,recoveredByPid:process.pid,
    workContext:{workId:work.workId,sourceVersion:work.sourceVersion},recovery:'explicit_owner_exit_verified'});
  return {status:'finalized',work:(await readCmcpRuntimeProviderWork({ledgerRoot,runtimeAuthorization})).find(w=>w.logicalId===logicalId)};
}

/** Single writer, one batch, same input and validation; no fallback for semantic/schema failures. */
export function createCmcpBoundedProviderAdapter({ deepseekKey, ledgerRoot, manifest, runtimeAuthorization, fetchImpl = fetch, wireFormat = 'responses', stream = false,answerHistory=false }) {
  const operating=runtimeAuthorization!==undefined;
  if(typeof answerHistory!=='boolean'||answerHistory&&!operating)throw Error('answer_history_capacity_requires_normal_runtime');
  if(operating&&manifest!==undefined)throw Error('runtime_and_experiment_are_exclusive');
  if(!['responses','deepseek_chat'].includes(wireFormat)||!operating&&wireFormat!=='responses')throw Error('explicit_runtime_wire_format_required');
  // Normal operation has one durable caller grant, not per-task purpose quotas. Every attempt is still reserved before fetch.
  const config=operating?{maxPosts:Number.MAX_SAFE_INTEGER,maxLogicalCalls:Number.MAX_SAFE_INTEGER,
    purposeLimits:Object.fromEntries(CMCP_LOOP_PURPOSES.map(k=>[k,Number.MAX_SAFE_INTEGER])),primary:{...DEEPSEEK_LOOP_CONFIG,
      semanticDiscussionMaxRequestBytes:CMCP_RUNTIME_REQUEST_LIMITS.semanticDiscussionBytes,
      semanticAnswerHistoryMaxRequestBytes:answerHistory?CMCP_RUNTIME_REQUEST_LIMITS.optedInSemanticAnswerHistoryBytes:CMCP_RUNTIME_REQUEST_LIMITS.semanticAnswerHistoryBytes,
      ...(answerHistory?{answerHistoryCapacity:true,answerHistoryMaxRequestBytes:CMCP_RUNTIME_REQUEST_LIMITS.optedInAnswerHistoryBytes}:{}),
      answerMaxRequestBytes:CMCP_RUNTIME_REQUEST_LIMITS.answerBytes,answerOutputMode:'plain_text',jsonFraming:'single_json_fence',maxCalls:Number.MAX_SAFE_INTEGER}}:configFor(manifest?.profile);
  const narrowIntegration=manifest?.profile==='host-integration-v1'&&Number.isSafeInteger(manifest?.taskBudget?.maxPosts)
    &&manifest.taskBudget.maxPosts>0&&manifest.taskBudget.maxPosts<=config.maxPosts;
  if(manifest?.profile==='host-integration-v1'&&!narrowIntegration)throw Error('invalid_task_budget');
  if (!operating&&(manifest?.protocolHash !== boundedProviderProtocolHash(manifest?.profile) || !([7,8].includes(manifest?.taskBudget?.maxPosts)
    ||['history-reactivation-v1','incremental-catalog-v1'].includes(manifest?.profile)&&manifest?.taskBudget?.maxPosts===10
    ||manifest?.profile==='host-context-v1'&&manifest?.taskBudget?.maxPosts===5
    ||narrowIntegration))) throw Error("frozen_route_mismatch");
  const route = routeJournal(ledgerRoot);
  const shared = { ledgerRoot, manifest, runtimeAuthorization, expectedProtocolHash: boundedProviderProtocolHash(manifest?.profile),
    ledgerName: "cmcp-local-loop-attempts-v1", purposeLimits: Object.fromEntries(Object.keys(config.purposeLimits).map(key=>[key,config.maxPosts])), fetchImpl,wireFormat };
  const primary = createCmcpResponsesTransport({ ...shared, apiKey: deepseekKey, config: config.primary, stream });
  deepseekKey = undefined;
  const freezeId = operating?'runtime:'+runtimeAuthorization.binding:loopHash(manifest);
  let busy = false, disposed = false;
  return Object.freeze({
    descriptor: { mode: "model", providerId: "bounded-deepseek", model: config.primary.model,
      settings: { reasoning:config.primary.reasoning, fallback:null, maxAttemptsPerRequest: 1,
        ...(operating?{requestBodyLimits:CMCP_RUNTIME_REQUEST_LIMITS,answerOutputMode:config.primary.answerOutputMode,jsonFraming:config.primary.jsonFraming}:{}),...(wireFormat==='deepseek_chat'?{wireFormat}:{}) } },
    dispose() { disposed = true; primary.dispose(); },
    async request(purpose, input, { canAttempt = async () => true, signal, deadlineAt, workContext,persistBodies=true } = {}) {
      if (busy || disposed || !Object.hasOwn(config.purposeLimits, purpose)) throw Error("adapter_unavailable");
      busy = true;
      let logicalId;
      try {
        if(operating){const budget=await readRuntimeBudget(runtimeAuthorization);if(!budget.canCall.deepseek)throw Error(budget.reason??'runtime_budget_exhausted');}
        const rows = (await route.read()).map(row => row.record);
        const starts = rows.filter(row => row.kind === "logical_started");
        if (starts.some(row => row.value.freezeId !== freezeId)) throw Error("route_manifest_mismatch");
        const snapshot = structuredClone(input),inputSha256=loopHash(snapshot);
        // Experiments retain the original frozen-batch gate. Normal mode blocks dependent/same work, not unrelated requests.
        const unfinished=starts.filter(row=>!rows.some(done=>done.kind==='logical_result'&&done.value.logicalId===row.value.logicalId));
        if(unfinished.some(row=>!operating||row.value.inputSha256===inputSha256||
          workContext?.workId&&row.value.workContext?.workId===workContext.workId||
          workContext?.sourceVersion&&row.value.workContext?.sourceVersion===workContext.sourceVersion))throw Error('unfinished_logical_request');
        if (starts.length >= config.maxLogicalCalls || starts.filter(row => row.value.purpose === purpose).length >= config.purposeLimits[purpose]) throw Error("logical_budget_exhausted");
        logicalId = starts.length + 1;
        const selected = "deepseek";
        const boundContext={...workContext,logicalId};
        await route.append("logical_started", { logicalId, purpose, freezeId, inputSha256, selected, startedAt: new Date().toISOString(),
          ...(operating?{pid:process.pid,sessionId:runtimeAuthorization.sessionId,workContext:boundContext,deadlineAt:deadlineAt??null}:{}) });
        async function invoke(provider, leg) {
          if (!await canAttempt()) throw Error("stale_before_provider_attempt");
          await route.append("provider_attempt", { logicalId, leg, provider: provider.descriptor.providerId, at: new Date().toISOString() });
          return provider.request(purpose, snapshot, { canAttempt,signal,deadlineAt,workContext:boundContext,persistBodies });
        }
        const result = await invoke(primary, selected);
        if(signal?.aborted||!await canAttempt())throw Error('stale_after_provider_attempt');
        await route.append("logical_result", { logicalId, purpose, status: "completed", transport: result.transport,remoteOutcome:result.transport.remoteOutcome,
          ...(operating?{workContext:boundContext}:{}),endedAt: new Date().toISOString() });
        return result;
      } catch (error) {
        if (logicalId) await route.append("logical_result", { logicalId, purpose,
          status:error.message==='request_cancelled'?'cancelled':error.message==='request_deadline_exceeded'?'deadline_exceeded':'failed', code: error.message,
          remoteOutcome:error.remoteOutcome??'unknown',sourceProcessing:'pending',...(operating?{workContext:workContext??null}:{}),
          http: error.http ?? null, provider: error.provider ?? null, endedAt: new Date().toISOString() });
        // Preserve the HTTP failure above; obsolete work must not halt the newer User generation.
        if(logicalId && !error.message.startsWith('stale_') && !['request_cancelled','request_deadline_exceeded'].includes(error.message)
          && !await canAttempt())throw Object.assign(Error('stale_after_provider_attempt'),{causeCode:error.message});
        throw error;
      } finally { busy = false; }
    }
  });
}
