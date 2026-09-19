import {selectCmcpEventWorkingSet,projectCmcpEventWorkingSet} from './cmcp-event-working-set.js';
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createCmcpFileHistoryBackend as files } from "./cmcp-file-history-backend.js";
import { createCmcpLocalHistoryProvider } from "./cmcp-local-history-provider.js";
import { createCmcpSourceEvidence } from "./cmcp-source-evidence.js";
import { createCmcpEventLineageStore } from "./cmcp-event-lineage-store.js";
import { createCmcpSemanticProviderBridge } from "./cmcp-semantic-provider-bridge.js";
import { createCmcpSemanticIntake } from "./cmcp-semantic-intake.js";
import { projectCmcpCompactAnswerContinuity,normalizeCmcpContinuityContextLimit,normalizeCmcpSemanticInputLimit } from "./project-cmcp-compact-continuity.js";
import { resolveCmcpHistorySource } from "./cmcp-history-provider.js";
import { resolveCmcpTimeContext, parseCmcpInstant } from "./resolve-cmcp-time-context.js";
import { observeCmcpAssistantTime } from "./cmcp-assistant-timing.js";
import { projectCmcpRuntimeTime, formatCmcpLocalInstant } from "./project-cmcp-local-time.js";
import { normalizeCmcpEvent, buildCmcpEventView } from "./cmcp-event-lineage.js";
import { validateCmcpSourceIdentity, cmcpSourcePointerKey } from "./cmcp-source-pointer.js";
import { createLocalLoopJournal, loopHash } from "./cmcp-local-loop-journal.js";
import { normalizeLocalLoopObjects } from "./cmcp-local-loop-scope.js";
import { validateEventContentReview, CMCP_MAX_SEMANTIC_PROPOSALS } from "./cmcp-event-content-review.js";
import { locateCmcpSourceFragment } from './cmcp-source-citations.js';
import { CMCP_DIALOGUE_SYNOPSIS_MAX_CODE_POINTS, projectCmcpDialogueSynopsis } from './cmcp-dialogue-source-binding.js';
import {validateCmcpAnswerHistoryPlan,cmcpAnswerHistoryMaterialScope} from './cmcp-answer-history.js';
import {buildCmcpDialogueControlContext,validateCmcpDialogueControlIntent,cmcpDialogueStateKey,planCmcpDialogueControlCorrection} from './cmcp-dialogue-control-intent.js';

const clone = value => JSON.parse(JSON.stringify(value));
const versionOf = read => loopHash(read.internal?.records ?? []);
const positive = value => Number.isSafeInteger(value) && value > 0;
function citationFor(body, quote) {
  if(quote&&typeof quote==='object'){
    if(Object.keys(quote).sort().join(',')!=='text,withinQuote')throw Error('dialogue_quote_required');
    return {...locateCmcpSourceFragment(body,quote),withinQuote:quote.withinQuote};
  }
  if (typeof quote !== "string" || !quote.length) throw Error("dialogue_quote_required");
  const points = [...body], query = [...quote], found = [];
  for (let index = 0; index <= points.length - query.length; index++) {
    if (query.every((point, offset) => points[index + offset] === point)) found.push(index);
    if (found.length > 1) break;
  }
  if (found.length !== 1) throw Error("dialogue_quote_not_unique");
  return { unit: "unicode_code_points", start: found[0], end: found[0] + query.length, text: quote };
}

/** Reference Host orchestration: one selected event, one writer, one cancellable timer. */
export async function createCmcpLocalContinuityLoop({ root, event: inputEvent, objects, timezone, bindingTimezone=timezone,ttlMs, bufferTtlMs = ttlMs,
  inactivityMs, activityWindowMs, proactive = false, requireEventReview = false, adapter, delivery,
  clock = () => new Date().toISOString(), sourceObservationClock = clock, observe = async () => {}, sessionId = randomUUID(), historyProvider, eventBackend,
  runProactiveWork = async run => run(), cancelProactiveWork = () => {}, bufferValid = () => true, canContinue = async () => true,
  prepareDiscussion = null, applyDiscussion = null, onAssistantSaved = null, prepareAnswerHistory = null, readAnswerHistory = null, verifyLegacyAnswerPreflight=async()=>null,verifyRejectedAnswerCompletion=async()=>null,continuityContextMaxBytes,semanticInputMaxBytes,eventContext = null,
  controlIntent=false,turnIntentStages=false,saveAssistant=true }) {
  continuityContextMaxBytes=normalizeCmcpContinuityContextLimit(continuityContextMaxBytes,{answerHistory:typeof prepareAnswerHistory==='function'&&typeof readAnswerHistory==='function'});
  semanticInputMaxBytes=normalizeCmcpSemanticInputLimit(semanticInputMaxBytes,{answerHistory:typeof prepareAnswerHistory==='function'&&typeof readAnswerHistory==='function'});
  const event = normalizeCmcpEvent(inputEvent);
  if (!path.isAbsolute(root) || !positive(ttlMs) || !positive(bufferTtlMs) || !positive(inactivityMs) || !positive(activityWindowMs)
    || activityWindowMs > 2147483647 || inactivityMs > 2147483647 || typeof proactive !== "boolean" || typeof requireEventReview !== 'boolean'
    || typeof adapter?.request !== "function" || typeof delivery?.present !== "function" || typeof sourceObservationClock !== "function"
    || typeof runProactiveWork !== 'function' || typeof cancelProactiveWork !== 'function' || typeof bufferValid !== 'function'
    ||typeof controlIntent!=='boolean'||!['boolean','function'].includes(typeof saveAssistant)
    || typeof canContinue !== 'function'||typeof verifyLegacyAnswerPreflight!=='function'||typeof verifyRejectedAnswerCompletion!=='function'||(prepareDiscussion!==null&&typeof prepareDiscussion!=='function')
    ||(prepareAnswerHistory!==null&&typeof prepareAnswerHistory!=='function')||(readAnswerHistory!==null&&typeof readAnswerHistory!=='function')||!!prepareAnswerHistory!==!!readAnswerHistory
    ||(applyDiscussion!==null&&typeof applyDiscussion!=='function')||(onAssistantSaved!==null&&typeof onAssistantSaved!=='function')||!!prepareDiscussion!==!!applyDiscussion) throw Error("explicit_loop_configuration_required");
  objects = normalizeLocalLoopObjects(objects);
  const now = () => resolveCmcpTimeContext({ now: clock(), timezone });
  const started = now(), windowEnd = started.nowEpochMs + activityWindowMs;
  if (!Number.isSafeInteger(started.nowEpochMs + bufferTtlMs) || !Number.isFinite(new Date(started.nowEpochMs + bufferTtlMs).getTime())) throw Error("invalid_expiry_range");
  let activationTtlMs = bufferTtlMs;
  const storedTimezone=resolveCmcpTimeContext({now:started.now,timezone:bindingTimezone}).timezone;
  const binding = { event, objects, timezone: storedTimezone, ttlMs, providerNamespace: "cmcp-local-console-v1" };
  const journal = createLocalLoopJournal({ root: path.join(root, "focus"), name: "local-focus-v1" });
  const priorRows = await journal.read();
  if (priorRows.length && JSON.stringify(priorRows[0].record.value) !== JSON.stringify(binding)) throw Error("focus_root_scope_configuration_mismatch");
  if (!priorRows.length) await journal.append("binding", binding);
  let state = priorRows.filter(row => row.record.kind === "state").at(-1)?.record.value ?? {
    kind: "derived_focus_continuity", event, status: "unknown", synopsis: "", supports: [], pending: [],
    lastUserAt: null, lastRelatedAt: null, expiry: null, eventVersion: null, sourceRefs: [], sends: []
  };
  if(historyProvider!==undefined&&(!historyProvider||typeof historyProvider.resolve!=='function'||typeof historyProvider.writeEvidence!=='function'
    ||historyProvider.descriptor?.providerNamespace!==binding.providerNamespace))throw Error('invalid_explicit_loop_history');
  const history = historyProvider === undefined ? createCmcpLocalHistoryProvider({ providerNamespace: binding.providerNamespace,
    backend: files({ root: path.join(root, "history") }) }) : historyProvider;
  const eventStore = createCmcpEventLineageStore({ event, historyProvider: history, backend: eventBackend===undefined?files({ root: path.join(root, "event") }):eventBackend });
  let enabled = proactive, stopped = false, halted = false, paused = false, epoch = 0, users = 0, timer = null, flight = null;
  let writes = Promise.resolve(), userQueue = Promise.resolve(), answerContext = null, userGeneration = 0;
  const mutate = (change, valid = null) => {
    const operation = writes.then(async () => {
      const updated = clone(state); change(updated);
      if (valid && !await valid()) throw Error('work_cancelled_or_expired');
      await journal.append("state", updated); state = updated;
    });
    writes = operation.catch(() => {}); return operation;
  };
  const emit = (type, details = {}) => observe({ type, sessionId, pid: process.pid, observedAt: now().now, ...details });
  const savesAssistant=()=>{const enabled=typeof saveAssistant==='function'?saveAssistant():saveAssistant;if(typeof enabled!=='boolean')throw Error('invalid_assistant_save_control');return enabled;};
  async function readEvent({sourceUpdateIds}={}) {
    const topologyOnly=eventContext&&sourceUpdateIds===undefined;
    const result = await eventStore.readEvent(topologyOnly?{sourceUpdateIds:[]}:
      sourceUpdateIds===undefined?undefined:{sourceUpdateIds});
    if (result.status === "missing") return { status: "missing", view: buildCmcpEventView(event, []), internal: { records: [], checks: [] } };
    if (result.status !== "found") throw Error("event_unavailable");
    // Saved topology describes candidate relations, not verified evidence. A
    // working-set projection always re-enters exact source reads below.
    return topologyOnly?{...result,view:buildCmcpEventView(event,result.internal.records),sourceVerification:'saved_topology_only'}:result;
  }
  function workingSet(read,timeContext,query,sourcePointers=[]) {
    if(!eventContext)return null;
    const keys=new Set(sourcePointers.map(cmcpSourcePointerKey));
    const anchorNodeIds=read.view.knownEvolution.filter(node=>keys.has(cmcpSourcePointerKey(node.source.pointer))).map(node=>node.nodeId);
    return selectCmcpEventWorkingSet({view:read.view,query,objects,anchorNodeIds,limits:eventContext,timeContext});
  }
  async function compact(read, timeContext, query='', sourcePointers=[]) {
    if(eventContext){
      const selection=workingSet(read,timeContext,query,sourcePointers);
      const expectedVersion=versionOf(read),required=selection.requiredSourceUpdateIds;
      const supported=current=>versionOf(current)===expectedVersion&&required.every(id=>{
        const index=current.internal.records.findIndex(record=>record.command.updateId===id);
        return index>=0&&current.internal.checks[index]?.supported===true;
      });
      const exact=await readEvent({sourceUpdateIds:required});
      if(!supported(exact))throw Error('working_set_source_unverified_or_changed');
      const projection=projectCmcpEventWorkingSet({view:exact.view,topologyView:read.view,selection,timeContext});
      return {model:JSON.parse(projection.modelContext),selection,verify:async()=>supported(await readEvent({sourceUpdateIds:required}))};
    }
    if (!read.view.knownEvolution.length) return {model:{ kind: "derived_event_view", event, currentClaims: [], unresolved: [], unknownParts: [], runtimeTime: projectCmcpRuntimeTime(timeContext) },verify:async()=>true};
    const output = projectCmcpCompactAnswerContinuity({ enabled: true, view: read.view,
      relatedNodeIds: read.view.knownEvolution.map(node => node.nodeId), timeContext, limits: { maxBytes: continuityContextMaxBytes } });
    if (!output.modelContext) throw Error("compact_budget_exceeded");
    return {model:JSON.parse(output.modelContext),verify:async()=>{
      const current=await readEvent();return versionOf(current)===versionOf(read)&&current.internal.checks.every(check=>check.supported);
    }};
  }
  async function resolveSupport(support) {
    const resolved = await resolveCmcpHistorySource({ provider: history, pointer: support.pointer });
    if (resolved.status !== "found" || resolved.evidence.pointer.scopeId !== event.scopeId
      || resolved.evidence.sourceAuthorRole !== "user" || loopHash(resolved.evidence) !== support.evidenceHash
      || JSON.stringify(citationFor(resolved.evidence.content.body, Object.hasOwn(support.citation,'withinQuote')
        ?{text:support.citation.text,withinQuote:support.citation.withinQuote}:support.citation.text)) !== JSON.stringify(support.citation)) {
      throw Error("focus_source_unavailable_or_changed");
    }
    return resolved.evidence;
  }
  async function priorDialogue(snapshot) {
    const refs = {}, times = {};
    for (const [index, support] of snapshot.supports.entries()) {
      const evidence = await resolveSupport(support), ref = "d" + (index + 1); refs[ref] = support;
      times[ref] = { messageRecordedAt: evidence.messageRecordedAt,
        messageRecordedAtLocal: formatCmcpLocalInstant(evidence.messageRecordedAt, timezone), eventOccurredAt: evidence.eventOccurredAt,
        eventOccurredAtLocal: formatCmcpLocalInstant(evidence.eventOccurredAt, timezone) };
    }
    return { refs, model: { kind: "derived_dialogue", status: snapshot.status, ...projectCmcpDialogueSynopsis(snapshot.synopsis),
      timezone, supports: Object.entries(refs).map(([ref, support]) => ({ ref, quote: support.citation.text, sourceAuthorRole: "user", ...times[ref] })) } };
  }
  async function validateDialogue(dialogue, source, prior) {
    if (!dialogue || !["open", "closed", "unknown"].includes(dialogue.status) || typeof dialogue.synopsis !== "string"
      || [...dialogue.synopsis].length > CMCP_DIALOGUE_SYNOPSIS_MAX_CODE_POINTS || !Array.isArray(dialogue.supports) || dialogue.supports.length > 4) throw Error("invalid_dialogue");
    if (dialogue.status !== "unknown" && (!dialogue.synopsis.trim() || !dialogue.supports.some(item => item.ref === "input"))) throw Error("dialogue_current_source_required");
    const supports = [];
    for (const item of dialogue.supports) {
      const evidence = item.ref === "input" ? source : prior.refs[item.ref] ? await resolveSupport(prior.refs[item.ref]) : null;
      if (!evidence || evidence.sourceAuthorRole !== "user" || evidence.pointer.scopeId !== event.scopeId) throw Error("dialogue_reference_out_of_scope");
      const priorCitation=item.ref!=='input'?prior.refs[item.ref]?.citation:null;
      const exactQuote=typeof item.quote==='string'&&item.quote===priorCitation?.text&&Object.hasOwn(priorCitation,'withinQuote')
        ?{text:item.quote,withinQuote:priorCitation.withinQuote}:item.quote;
      supports.push({ pointer: evidence.pointer, citation: citationFor(evidence.content.body, exactQuote), evidenceHash: loopHash(evidence) });
      await resolveSupport(supports.at(-1));
    }
    return { status: dialogue.status, synopsis: dialogue.synopsis, supports };
  }
  async function saveMessage(text, role, observedAt, replyContext=null) {
    const evidence = createCmcpSourceEvidence({ pointer: { version: 1, providerNamespace: binding.providerNamespace, scopeId: event.scopeId,
      sessionId, itemId: randomUUID(), revisionId: "r1" }, sourceKind: "message", sourceAuthorRole: role,
      messageRecordedAt: observedAt, eventOccurredAt: null, content: { kind: "source_excerpt", body: text }, metadata: { availability: "partial" } });
    // A durable intent binds the exact generated source before publication. A
    // recovery must still read both exact sources; this is not proof of delivery.
    if(replyContext)await journal.append('assistant_reply_planned',{pointer:evidence.pointer,sourceHash:loopHash(evidence),replyTo:replyContext.pointer,
      replyToEvidenceHash:replyContext.evidenceHash,eventVersion:replyContext.eventVersion,kind:'answer'});
    const result = await history.writeEvidence(evidence);
    if (result.status !== "stored") throw Error("history_write_failed");
    return evidence;
  }
  async function present(kind, text, canPresent = () => true, replyContext=null) {
    const receivedAt=observeCmcpAssistantTime(sourceObservationClock, timezone),storageEnabled=savesAssistant();
    const source = storageEnabled?await saveMessage(text, "assistant", receivedAt,replyContext):null;
    if(source&&replyContext&&onAssistantSaved)await onAssistantSaved({source,replyTo:replyContext.pointer,replyToEvidenceHash:replyContext.evidenceHash,
      eventVersion:replyContext.eventVersion,canApply:async()=>await canContinue()&&canPresent()});
    if (!await canContinue() || !await canPresent()) throw Error("stale_before_presentation");
    try {
      if(replyContext)await journal.append(source?'assistant_presentation_started':'assistant_unsaved_presentation_started',{pointer:source?.pointer??null,replyTo:replyContext.pointer,kind});
      const result = await delivery.present({ kind, text, sourcePointer: source?.pointer??null, sessionId });
      if (result?.status !== "presented") throw Error("local_presentation_failed");
      if(replyContext)await journal.append(source?'assistant_presentation_result':'assistant_unsaved_presentation_result',{pointer:source?.pointer??null,replyTo:replyContext.pointer,status:'presented',...(source?{result}:{})});
      await emit("presented", source?{ kind, text, pointer: source.pointer, result }:{kind,pointer:null,storage:'disabled',status:'presented',receivedAt});
      return { pointer: source?.pointer??null, at: now().now, receivedAt,storage:source?'saved':'disabled',result:source?result:{status:'presented'} };
    } catch (error) {if(replyContext)await journal.append(source?'assistant_presentation_result':'assistant_unsaved_presentation_result',{pointer:source?.pointer??null,replyTo:replyContext.pointer,status:'unknown'}); error.presentationUncertain = true; throw error; }
  }
  function timeWithPrior(current, lastUserAt) {
    return resolveCmcpTimeContext({ now: current, timezone, ...(lastUserAt === null ? {} : { lastInteractionAt: lastUserAt }) });
  }
  async function answerCurrent() {
    if (!answerContext || stopped || halted) throw Error("no_pending_answer");
    if (!bufferValid()) throw Error('buffer_generation_changed');
    const input = answerContext; answerContext = null;
    const read = await readEvent();
    const guardUserAt=Object.hasOwn(input,'guardUserAt')?input.guardUserAt:input.receivedAt;
    if (versionOf(read) !== input.eventVersion || state.lastUserAt !== guardUserAt) throw Error("answer_context_changed");
    const planMaterials=cmcpAnswerHistoryMaterialScope(input.answerHistoryPlan);
    if(planMaterials&&input.materials&&planMaterials!==input.materials)throw Error('answer_material_scope_conflict');
    const excludesHistory=(planMaterials??input.materials)==='current_question_only';
    const visible = excludesHistory?null:await priorDialogue(state);
    const canProceed = async () => {
      const verified = await readEvent(); if(!excludesHistory)await priorDialogue(state);
      const exact=input.source?await resolveCmcpHistorySource({provider:history,pointer:input.source.pointer}):null;
      return await canContinue()&&(!input.source||exact.status==='found'&&exact.evidence.sourceAuthorRole==='user'&&loopHash(exact.evidence)===input.source.evidenceHash)
        &&bufferValid() && !stopped && !halted && userGeneration === input.generation && state.lastUserAt === guardUserAt
        && (input.recovery||input.focusIndependent||now().nowEpochMs < parseCmcpInstant(state.expiry)) && versionOf(verified) === input.eventVersion;
    };
    let answerInput,historyRead=null,compactRead=null;
    const canAttempt=async()=>await canProceed()&&(!historyRead||await historyRead.verify())&&(!compactRead||await compactRead.verify());
    try{
      if(readAnswerHistory&&input.answerHistoryPrepared&&!excludesHistory){
        if(!await canProceed())throw Error('answer_history_cancelled');
        const exact=await resolveCmcpHistorySource({provider:history,pointer:input.source.pointer});
        if(exact.status!=='found'||loopHash(exact.evidence)!==input.source.evidenceHash)throw Error('answer_history_query_changed');
        historyRead=await readAnswerHistory({prepared:input.answerHistoryPrepared,plan:input.answerHistoryPlan,query:exact.evidence,
          temporal:input.temporal,activeAt:input.receivedAt,recovery:!!input.recovery,valid:canProceed});
        await journal.append('answer_history_read',{pointer:input.source.pointer,evidenceHash:input.source.evidenceHash,
          eventVersion:input.eventVersion,recovery:!!input.recovery,receipt:historyRead.receipt,at:now().now});
        if(!await canAttempt())throw Error('answer_history_cancelled');
      }
      compactRead=excludesHistory?null:await compact(read,input.temporal,input.text,[...(input.source?[input.source.pointer]:[]),...Object.values(historyRead?.receipt?.sourceMap??{})]);
      answerInput={ ...(excludesHistory?{materials:{scope:'current_question_only',historicalContext:'not_supplied'}}:{compact: compactRead.model, dialogue: visible.model}),
      user: { text: input.text, sourceAuthorRole: "user", messageRecordedAt: input.receivedAt,
        messageRecordedAtLocal: formatCmcpLocalInstant(input.receivedAt, timezone), eventOccurredAt: null }, interactionTime: projectCmcpRuntimeTime(input.temporal),
      ...(historyRead?{answerHistory:historyRead.model}:{}) };
    }catch(error){await journal.append('answer_preflight_result',{pointer:input.source.pointer,status:'failed',stage:'input_build',code:error.message,
      remoteOutcome:'not_started',at:now().now,evidenceHash:input.source.evidenceHash,eventVersion:input.eventVersion,recovery:!!input.recovery});throw error;}
    await journal.append('answer_started',{pointer:input.source.pointer,evidenceHash:input.source.evidenceHash,eventVersion:input.eventVersion,recovery:!!input.recovery,at:now().now});
    try{const result = await adapter.request("answer", answerInput, { canAttempt });
    if (!await canAttempt()) throw Error("stale_before_presentation");
    const presentation=await present("answer", result.value.text, canAttempt,input.source);
    await journal.append('answer_result',{pointer:input.source.pointer,status:'completed',answerPointer:presentation.pointer,presentation:'presented',storage:presentation.storage,receivedAt:presentation.receivedAt,recovery:!!input.recovery});
    return { status: "answered",answerPointer:presentation.pointer,presentation:'presented',storage:presentation.storage };
    }catch(error){await journal.append('answer_result',{pointer:input.source.pointer,status:'failed',code:error.message,presentation:error.presentationUncertain?'unknown':'not_confirmed',remoteOutcome:error.remoteOutcome??'unknown',recovery:!!input.recovery});throw error;}
  }
  async function validateAnswerRecoverySource(pointer){
    if(stopped||users||!bufferValid()||!await canContinue())throw Error('answer_recovery_source_controls');
    const key=cmcpSourcePointerKey(pointer);
    if(pointer.scopeId!==event.scopeId||!state.sourceRefs.some(p=>cmcpSourcePointerKey(p)===key))throw Error('answer_recovery_source_outside_event');
    const exact=await resolveCmcpHistorySource({provider:history,pointer});
    if(exact.status!=='found'||exact.evidence.sourceAuthorRole!=='user'||exact.evidence.content.kind!=='source_excerpt'||exact.evidence.messageRecordedAt===null)
      throw Error('answer_recovery_source_unavailable');
    const hash=loopHash(exact.evidence),processing=(state.processing??[]).findLast(row=>cmcpSourcePointerKey(row.pointer)===key),marker=processing?.sourceValidation;
    if(['committed','unchanged'].includes(processing?.eventProcessing)||marker?.status==='verified'&&marker.sourceAuthorRole==='user'
      &&marker.evidenceHash===hash&&cmcpSourcePointerKey(marker.pointer)===key)return {status:'already_verified',modelCalls:0};
    const records=(await journal.read()).map(row=>row.record),matches=row=>row.value.pointer&&cmcpSourcePointerKey(row.value.pointer)===key;
    const plan=records.findLast(row=>row.kind==='conversation_stage_plan'&&matches(row));
    const previous=records.findLast(row=>row.kind==='preview'&&matches(row)&&row.value.answerHistoryPrepared)?.value;
    if(!readAnswerHistory||plan?.value.answerRequested!==true||plan.value.evidenceHash!==hash||!previous||previous.before!==previous.afterPreview
      ||previous.preview?.status==='ready'||previous.transport?.status!=='completed'||previous.transport.http!==200||previous.transport.responseComplete!==true
      ||!previous.answerHistoryPlan||previous.answerHistoryPrepared.internal?.queryHash!==hash
      ||cmcpSourcePointerKey(previous.answerHistoryPrepared.internal.queryPointer)!==key)
      return {status:'not_available',code:'rejected_preview_answer_evidence_incomplete',modelCalls:0};
    validateCmcpAnswerHistoryPlan(previous.answerHistoryPlan,previous.answerHistoryPrepared);
    const version=versionOf(await readEvent()),lastUserAt=state.lastUserAt;
    const valid=async()=>{
      if(stopped||users||!bufferValid()||!await canContinue()||state.lastUserAt!==lastUserAt||versionOf(await readEvent())!==version)return false;
      const source=await resolveCmcpHistorySource({provider:history,pointer});
      return source.status==='found'&&source.evidence.sourceAuthorRole==='user'&&loopHash(source.evidence)===hash;
    };
    const sourceValidation={status:'verified',sourceAuthorRole:'user',pointer:clone(pointer),evidenceHash:hash,eventVersion:version,
      validationScope:'original_user_for_independent_answer'};
    await mutate(draft=>{
      draft.processing??=[];draft.processing.push({...clone(processing??{}),pointer:clone(pointer),eventProcessing:processing?.eventProcessing??'pending',
        dialogueProcessing:processing?.dialogueProcessing??'pending',sourceValidation,semanticVerification:'not_performed',
        code:'rejected_preview_answer_source_revalidated',previewCode:previous.preview?.code??null});
    },valid);
    await journal.append('answer_recovery_source_revalidated',{pointer,sourceValidation,basis:'saved_complete_transport_rejected_preview_and_independent_read_plan',
      previewCode:previous.preview?.code??null,eventMutation:'none',dialogueMutation:'none',focusActivation:'unchanged',modelCalls:0});
    return {status:'verified',sourceValidation,eventMutation:'none',dialogueMutation:'none',focusActivation:'unchanged',modelCalls:0};
  }
  async function processUser(text, answer, receivedAt, generation, capturedBufferTtlMs, savedSource = null) {
    answerContext = null;
    // A completed transport is not a continuing authorization to publish its result.
    // Recheck after awaited validation, including inside the original store commit.
    const canCommit = async () => await canContinue() && bufferValid() && !stopped && !halted && userGeneration === generation;
    const requireActive = async () => { if (!await canCommit()) throw Error('work_cancelled_or_expired'); };
    let closureSaved = false, eventProcessing = 'pending';
    const previous = clone(state), temporal = timeWithPrior(savedSource ? now().now : receivedAt, previous.lastUserAt);
    const source = savedSource ?? await saveMessage(text, "user", receivedAt);
    if(!savedSource)await journal.append('conversation_stage_plan',{version:1,pointer:source.pointer,evidenceHash:loopHash(source),answerRequested:answer,at:now().now});
    // Raw text survives even if semantic transport or validation fails.
    if (!savedSource) await mutate(draft => {
      // A saved User is scope activity, not yet authorization to renew this focus.
      // Legacy protocols retain their old admission; targeted control applies
      // focus activation only after its independent source validation below.
      if(!controlIntent){draft.lastUserAt = receivedAt; draft.expiry = new Date(parseCmcpInstant(receivedAt) + capturedBufferTtlMs).toISOString();}
      draft.pending.push(source.pointer); draft.sourceRefs.push(source.pointer);
    });
    await emit(savedSource ? "source_recovery_started" : "user_saved", { pointer: source.pointer, text, temporal, priorExpiry: previous.expiry });
    try {
      if (flight) await flight;
      if (stopped || halted) throw Error("runtime_stopped_or_halted");
      if (!bufferValid()) throw Error('buffer_generation_changed');
      let prior = await priorDialogue(previous);
      const read = await readEvent();
      const selectedWorkingSet=workingSet(read,temporal,text);
      const scope = selectedWorkingSet?.scope??{ objects, nodeIds: read.view.knownEvolution.map(node => node.nodeId),
        relatedNodeIds: read.view.knownEvolution.map(node => node.nodeId) };
      let dialogue, transport, eventReview, rawProposal, discussionProposal, answerHistoryPlan,independentAnswerHistory,rawControl,confirmedControl;
      const discussionPrepared=prepareDiscussion?await prepareDiscussion({source,recovery:!!savedSource}):null;
      const answerHistoryPrepared=prepareAnswerHistory?await prepareAnswerHistory({source,recovery:!!savedSource}):null;
      await requireActive();
      let turnIntentStage=null;
      const stageRows=savedSource&&turnIntentStages?(await journal.read()).map(row=>row.record):[];
      const originalStage=stageRows.findLast(row=>row.kind==='turn_intent_decision'&&row.value.sourceHash===loopHash(source)
        &&cmcpSourcePointerKey(row.value.pointer)===cmcpSourcePointerKey(source.pointer))?.value;
      if(turnIntentStages&&controlIntent&&(originalStage||previous.supports.length||answerHistoryPrepared?.model?.candidates?.length)){
        if(originalStage){
          const {stageHash,...unsigned}=originalStage;
          if(stageHash!==loopHash(unsigned))throw Error('turn_intent_stage_changed');
          prior=clone(originalStage.prior);
          await validateDialogue(originalStage.value.dialogue,source,prior);
          validateCmcpDialogueControlIntent(originalStage.value.controlIntent,{source,event,dialogue:originalStage.value.dialogue,
            prior:originalStage.previous,historicalTarget:true});
          turnIntentStage=originalStage;
          await journal.append('turn_intent_reused',{pointer:source.pointer,sourceHash:loopHash(source),stageHash,at:now().now,focusActivation:'unchanged'});
        }else{
          const result=await adapter.request('turn_intent',{source:{ref:'input',sourceKind:source.sourceKind,
            sourceAuthorRole:source.sourceAuthorRole,contentKind:source.content.kind,messageRecordedAt:source.messageRecordedAt,
            eventOccurredAt:source.eventOccurredAt,text:source.content.body},priorDialogue:prior.model,
            controlContext:buildCmcpDialogueControlContext(event,previous),interactionTime:projectCmcpRuntimeTime(temporal)},
            {canAttempt:async()=>await canCommit()&&versionOf(await readEvent())===versionOf(read)});
          await requireActive();
          if(versionOf(await readEvent())!==versionOf(read))throw Error('turn_intent_event_changed');
          await validateDialogue(result.value.dialogue,source,prior);
          validateCmcpDialogueControlIntent(result.value.controlIntent,{source,event,dialogue:result.value.dialogue,prior:previous});
          const priorFocus=Object.fromEntries(['status','synopsis','supports','lastUserAt','lastRelatedAt','expiry','eventVersion']
            .map(key=>[key,clone(previous[key])]));
          const record={version:1,pointer:source.pointer,sourceHash:loopHash(source),eventVersion:versionOf(read),previous:priorFocus,prior,
            value:result.value,transport:result.transport??null,at:now().now};
          turnIntentStage={...record,stageHash:loopHash(record)};
          await journal.append('turn_intent_decision',turnIntentStage);
        }
        // A valid stop is independent from unfinished Event interpretation.
        const closed=await validateDialogue(turnIntentStage.value.dialogue,source,prior);
        const control=validateCmcpDialogueControlIntent(turnIntentStage.value.controlIntent,{source,event,
          dialogue:turnIntentStage.value.dialogue,prior:turnIntentStage.previous,historicalTarget:!!savedSource});
        if(!savedSource&&closed.status==='closed'&&control.apply){
          await mutate(draft=>Object.assign(draft,closed,{lastRelatedAt:receivedAt,lastUserAt:receivedAt,
            expiry:new Date(parseCmcpInstant(receivedAt)+capturedBufferTtlMs).toISOString(),lastControlInterpretation:{...control,at:now().now}}),canCommit);
          closureSaved=true;
          await journal.append('dialogue_control',{pointer:source.pointer,dialogue:closed,eventProcessing:'pending',turnIntentStageHash:turnIntentStage.stageHash});
          await emit('dialogue_closed',{pointer:source.pointer,eventProcessing:'pending',focus:clone(state)});
        }
      }
      const bridge = createCmcpSemanticProviderBridge({ authorized: true, descriptor: adapter.descriptor,inputEncoding:'node_aliases',
        budget: { maxCalls: 1, maxInputBytes: semanticInputMaxBytes, maxOutputBytes: 16384, maxOutputTokens: 1200 },
        invoke: async request => {
          let raw;try{raw = await adapter.request("semantic", { ...JSON.parse(request.messages[1].content),
            priorDialogue: prior.model, interactionTime: projectCmcpRuntimeTime(temporal), ...(requireEventReview?{eventReviewRequired:true}:{}),
            ...(controlIntent?{controlContext:buildCmcpDialogueControlContext(event,previous)}:{}),
            ...(turnIntentStage?{turnIntent:{version:1,stageHash:turnIntentStage.stageHash,...turnIntentStage.value}}:{}),
            ...(discussionPrepared?.model?{discussionContext:discussionPrepared.model}:{}),
            ...(answerHistoryPrepared?.model?{answerHistoryCatalog:answerHistoryPrepared.model}:{}) }, { canAttempt: async () => {
              const verified = await readEvent();
              return bufferValid() && !stopped && !halted && userGeneration === generation
                && (savedSource||controlIntent ? state.lastUserAt === (closureSaved?receivedAt:previous.lastUserAt) : state.lastUserAt === receivedAt && now().nowEpochMs < parseCmcpInstant(state.expiry))
                && versionOf(verified) === versionOf(read);
            } });}catch(error){
              if(error.message==='invalid_proposal_schema'&&error.independentAnswerHistory?.kind==='independent_answer_history_after_invalid_semantic'
                &&answerHistoryPrepared&&readAnswerHistory){
                independentAnswerHistory=error.independentAnswerHistory;
                answerHistoryPlan=validateCmcpAnswerHistoryPlan(independentAnswerHistory.plan,answerHistoryPrepared);transport=error.transport;
              }
              throw error;
            }
          dialogue = raw.value.dialogue; transport = raw.transport; eventReview = raw.value.eventReview; rawProposal = raw.value.proposal;discussionProposal=raw.value.discussion;answerHistoryPlan=raw.value.answerHistory;rawControl=raw.value.controlIntent;
          // Fixed lossless wrapper mapping; no inferred/default fields or semantic edits.
          return { outputText: JSON.stringify(raw.value.proposal) };
        } });
      const intake = createCmcpSemanticIntake({ historyProvider: history, eventStore, semanticProvider: bridge,
        limits: { maxSourceBytes: 4096, maxContextBytes: continuityContextMaxBytes, maxProposals: CMCP_MAX_SEMANTIC_PROPOSALS }, allowEmptyEvent: true, allowNoEventChange: true,allowPendingConversation:requireEventReview,eventWorkingSet:selectedWorkingSet });
      const before = versionOf(read), preview = await intake.preview({ pointer: source.pointer, scope, timeContext: temporal });
      const afterPreview = versionOf(await readEvent());
      await journal.append("preview", { pointer: source.pointer, before, afterPreview, preview, dialogue, eventReview, transport,recovery:!!savedSource,
        ...(turnIntentStage?{turnIntentStageHash:turnIntentStage.stageHash}:{}),
        ...(controlIntent?{controlIntent:rawControl??null}:{}),
        ...(selectedWorkingSet?{workingSet:selectedWorkingSet}:{}),
        ...(discussionPrepared?{discussionPrepared,discussionProposal:discussionProposal??null}:{}),
        ...(answerHistoryPrepared?{answerHistoryPrepared,answerHistoryPlan:answerHistoryPlan??null}:{}) });
      await emit("preview", { status: preview.status, code: preview.code ?? null, unchanged: before === afterPreview });
      await requireActive();
      let confirmedDialogue;
      const checkedDialogue=async()=>{
        const result=await validateDialogue(dialogue,source,prior);
        if(controlIntent)confirmedControl=validateCmcpDialogueControlIntent(rawControl,{source,event,dialogue,
          prior:turnIntentStage?.previous??previous,historicalTarget:!!savedSource&&!!turnIntentStage});
        return result;
      };
      const applyDialogue=(draft,confirmed,version)=>{
        if(!controlIntent||confirmedControl?.apply){Object.assign(draft,confirmed,{eventVersion:version,lastRelatedAt:receivedAt});
          if(controlIntent){draft.lastUserAt=receivedAt;draft.expiry=new Date(parseCmcpInstant(receivedAt)+capturedBufferTtlMs).toISOString();}}
        else {
          // This source is a real new User interaction, but does not renew the unrelated old focus.
          for(const key of ['status','synopsis','supports','lastUserAt','lastRelatedAt','expiry'])draft[key]=clone(previous[key]);
          draft.eventVersion=version;
        }
        if(controlIntent)draft.lastControlInterpretation={...confirmedControl,at:now().now};
      };
      const acceptExplicitClosure=async()=>{
        confirmedDialogue=await checkedDialogue();
        if(confirmedDialogue.status==='closed'&&(!controlIntent||confirmedControl.apply)&&(!savedSource||previous.lastUserAt===receivedAt)){
          await mutate(draft=>Object.assign(draft,confirmedDialogue,{lastRelatedAt:receivedAt,
            ...(!savedSource&&controlIntent?{lastUserAt:receivedAt,expiry:new Date(parseCmcpInstant(receivedAt)+capturedBufferTtlMs).toISOString()}:{})}),canCommit);
          closureSaved=true;
          await journal.append('dialogue_control',{pointer:source.pointer,dialogue:confirmedDialogue,eventProcessing:'pending'});
          await emit('dialogue_closed',{pointer:source.pointer,eventProcessing:'pending',focus:clone(state)});
        }
      };
      if(!independentAnswerHistory&&preview.status!=='ready'&&!preview.sourceValidation
        &&answerHistoryPrepared&&readAnswerHistory&&answerHistoryPlan&&rawProposal
        &&transport?.status==='completed'&&transport.http===200&&transport.responseComplete===true){
        // A rejected Event interpretation is not permission to commit it. A
        // separately valid read intent can still serve this verified User task.
        answerHistoryPlan=validateCmcpAnswerHistoryPlan(answerHistoryPlan,answerHistoryPrepared);
        independentAnswerHistory={kind:'independent_answer_history_after_rejected_preview',version:1,plan:answerHistoryPlan,
          semanticSchema:'passed',previewStatus:preview.status,previewCode:preview.code,invalidComponents:['proposal'],
          eventProcessing:'pending',dialogueProcessing:'pending',discussionProcessing:'pending'};
        // Preserve the existing independently supported stop policy. Other
        // failed semantic components neither open nor close a discussion.
        if(requireEventReview&&dialogue?.status==='closed'){
          try{await acceptExplicitClosure();}catch(error){await journal.append('independent_dialogue_control_rejected',{
            pointer:source.pointer,status:'pending',code:error.message,previewCode:preview.code});}
        }
      }
      if(independentAnswerHistory){
        // No invalid proposal/review/control reaches commit. Reading and answering
        // the original User request have their own exact source/control boundary.
        const exact=await resolveCmcpHistorySource({provider:history,pointer:source.pointer});
        if(before!==afterPreview||versionOf(await readEvent())!==before||exact.status!=='found'
          ||exact.evidence.sourceAuthorRole!=='user'||exact.evidence.content.kind!=='source_excerpt'
          ||exact.evidence.pointer.scopeId!==event.scopeId||cmcpSourcePointerKey(exact.evidence.pointer)!==cmcpSourcePointerKey(source.pointer)
          ||loopHash(exact.evidence)!==loopHash(source))throw Error('independent_answer_source_unverified_or_changed');
        validateCmcpAnswerHistoryPlan(answerHistoryPlan,answerHistoryPrepared);
        const sourceValidation={status:'verified',sourceAuthorRole:'user',pointer:source.pointer,evidenceHash:loopHash(source),eventVersion:before,
          validationScope:'original_user_for_independent_answer'};
        const canAnswer=async()=>await canCommit()&&versionOf(await readEvent())===before;
        const code=independentAnswerHistory.semanticSchema==='passed'?'semantic_preview_rejected_independent_answer':'semantic_schema_invalid_independent_answer';
        const dialogueProcessing=closureSaved?'handled':'pending';
        await mutate(draft=>{
          draft.processing??=[];draft.processing.push({pointer:source.pointer,eventProcessing:'pending',dialogueProcessing,discussionProcessing:'pending',
            code,sourceValidation,semanticVerification:'not_performed',invalidComponents:independentAnswerHistory.invalidComponents,
            ...(independentAnswerHistory.previewCode?{previewCode:independentAnswerHistory.previewCode}:{})});
        },canAnswer);
        const receipt={status:'pending',code,pointer:source.pointer,eventProcessing:'pending',dialogueProcessing,discussionProcessing:'pending',
          eventMutation:'none',sourceValidation,independentAnswerHistory,focus:clone(state),temporal};
        await journal.append('independent_answer_history_ready',{...receipt,answerHistoryPrepared,answerHistoryPlan,recovery:!!savedSource});
        if(savedSource)return {...receipt,recovery:true,answerGeneration:'not_requested',focusActivation:'unchanged'};
        answerContext={text,receivedAt,guardUserAt:state.lastUserAt,focusIndependent:true,temporal,eventVersion:before,generation,answerHistoryPrepared,answerHistoryPlan,
          source:{pointer:source.pointer,evidenceHash:loopHash(source),eventVersion:before}};
        if(answer){await answerCurrent();receipt.answerGeneration='completed';}else receipt.answerGeneration='not_requested';
        return receipt;
      }
      // Closure has its own formal source validation; event work remains pending until separately accepted.
      if(requireEventReview && dialogue){
        await acceptExplicitClosure();
      }
      if (!bufferValid()) throw Error('buffer_generation_changed');
      const verifiedSource=preview.sourceValidation;
      if(preview.status!=='ready'&&before===afterPreview&&verifiedSource?.status==='verified'
        &&verifiedSource.sourceAuthorRole==='user'&&cmcpSourcePointerKey(verifiedSource.pointer)===cmcpSourcePointerKey(source.pointer)
        &&verifiedSource.evidenceHash===loopHash(source)&&verifiedSource.eventVersion===before){
        confirmedDialogue??=await checkedDialogue();
        // Legal abstention is distinct from invalid evidence. Review/source/role
        // failures still throw; a pending proposal is never used as event truth.
        const checked=requireEventReview?validateEventContentReview(eventReview,rawProposal,source,dialogue):null;
        await resolveSupport({pointer:source.pointer,evidenceHash:loopHash(source),citation:citationFor(source.content.body,source.content.body)});
        await requireActive();if(versionOf(await readEvent())!==before)throw Error('pending_answer_event_changed');
        const canAnswer=async()=>await canCommit()&&versionOf(await readEvent())===before;
        await mutate(draft=>{
          if(!savedSource)applyDialogue(draft,closureSaved||checked?.dialogueReady||controlIntent?confirmedDialogue:{status:'unknown',synopsis:'',supports:[]},before);
          draft.processing??=[];draft.processing.push({pointer:source.pointer,eventProcessing:'pending',dialogueProcessing:controlIntent?confirmedControl.processing:checked?.dialogueReady?'handled':'pending',
            code:preview.code,sourceValidation:verifiedSource,remaining:checked?.remaining??[],semanticVerification:'not_performed'});
        },canAnswer);
        const discussionAssociation=discussionPrepared?await applyDiscussion({prepared:discussionPrepared,source,proposal:discussionProposal,eventVersion:before,canApply:canAnswer}):null;
        const receipt={status:'pending',code:preview.code,eventProcessing:'pending',dialogueProcessing:checked?.dialogueReady?'handled':'pending',pointer:source.pointer,
          focus:clone(state),temporal,eventMutation:'none',sourceValidation:verifiedSource,...(discussionAssociation?{discussionAssociation}:{})};
        await journal.append('conversation_pending_event',{...receipt,proposal:rawProposal});
        if(savedSource)return {...receipt,recovery:true,answerGeneration:'not_requested',focusActivation:'unchanged'};
        answerContext={text,receivedAt,guardUserAt:state.lastUserAt,focusIndependent:controlIntent&&!confirmedControl?.apply,materials:confirmedControl?.materials,temporal,eventVersion:before,generation,answerHistoryPrepared,answerHistoryPlan,source:{pointer:source.pointer,evidenceHash:loopHash(source),eventVersion:before}};
        if(answer){await answerCurrent();receipt.answerGeneration='completed';}else receipt.answerGeneration='not_requested';
        return receipt;
      }
      if (before !== afterPreview || preview.status !== "ready") throw Error("semantic_preview_not_ready");
      confirmedDialogue ??= await checkedDialogue();
      let checked;
      if(requireEventReview){
        checked=validateEventContentReview(eventReview,rawProposal,source,dialogue);
        await journal.append('event_review',{pointer:source.pointer,review:checked});
        if(checked.eventReady===false&&preview.eventMutation!=='none')throw Error('event_interpretation_pending');
      }
      // A formally verified no-change ticket does not require an open dialogue.
      // Its source/targets remain guarded by intake; unknown/closed dialogue does
      // not become open merely because this User still receives an answer.
      if(!controlIntent&&!requireEventReview&&preview.eventMutation==='none'&&(previous.status!=='open'||!previous.supports.length||!['open','closed'].includes(confirmedDialogue.status)))throw Error('no_change_requires_supported_dialogue');
      // Explicit application through the original issued ticket, never a reconstructed decision.
      if (!bufferValid()) throw Error('buffer_generation_changed');
      const commit = await intake.commit(preview,{canCommit});
      await journal.append("commit", { pointer: source.pointer, commit });
      if (!["committed", "unchanged"].includes(commit.status)) throw Error("semantic_commit_failed");
      eventProcessing = commit.status;
      const committed = await readEvent();
      const processingComplete=!requireEventReview || (controlIntent?checked.eventReady&&!checked.remaining.length&&confirmedControl.processing==='handled':checked.status==='complete'&&confirmedDialogue.status!=='unknown');
      await mutate(draft => {
        // Recovery completes original source work, never creates fresh focus/TTL or reopens dialogue.
        if (!savedSource) applyDialogue(draft,confirmedDialogue,versionOf(committed));
        if(processingComplete)draft.pending = draft.pending.filter(pointer => cmcpSourcePointerKey(pointer) !== cmcpSourcePointerKey(source.pointer));
        if(requireEventReview){
          draft.processing ??= [];
          draft.processing.push({pointer:source.pointer,eventProcessing:commit.status,dialogueProcessing:processingComplete?'handled':'pending',
            sourceAlignment:checked.sourceAlignment??checked.sourceCoverage,semanticVerification:'not_performed',remaining:checked.remaining??[]});
        }
      },canCommit);
      await emit("committed", { pointer: source.pointer, commit, eventMutation: preview.eventMutation ?? "updates",
        focus: clone(state), view: committed.view });
      const discussionAssociation=discussionPrepared?await applyDiscussion({prepared:discussionPrepared,source,proposal:discussionProposal,
        eventVersion:versionOf(committed),canApply:async()=>await canCommit()&&versionOf(await readEvent())===versionOf(committed)}):null;
      if (savedSource) return {status: processingComplete ? "accepted" : "pending", eventProcessing: commit.status,
        dialogueProcessing: processingComplete ? "handled" : "pending", pointer: source.pointer, recovery: true,
        sourceTime: source.messageRecordedAt, originalUserTime: state.lastUserAt, originalExpiry: state.expiry,
        focusActivation: "unchanged", eventVersion: versionOf(committed), internal: {sourceProcessing: processingComplete ? "completed" : "pending"},
        ...(discussionAssociation?{discussionAssociation}:{})};
      answerContext = { text, receivedAt, guardUserAt:state.lastUserAt,focusIndependent:controlIntent&&!confirmedControl?.apply,materials:confirmedControl?.materials,temporal, eventVersion: state.eventVersion, generation,answerHistoryPrepared,answerHistoryPlan,
        source:{pointer:source.pointer,evidenceHash:loopHash(source),eventVersion:versionOf(committed)} };
      if (answer) await answerCurrent();
      return { status: processingComplete?"accepted":"pending", ...(processingComplete?{}:{code:'dialogue_processing_pending',eventProcessing:commit.status}), pointer: source.pointer, focus: clone(state), temporal,
        ...(discussionAssociation?{discussionAssociation}:{}) };
    } catch (error) {
      if(requireEventReview)await mutate(draft=>{
        draft.processing ??= [];
        const priorProcessing=draft.processing.findLast(row=>cmcpSourcePointerKey(row.pointer)===cmcpSourcePointerKey(source.pointer));
        draft.processing.push({pointer:source.pointer,eventProcessing,dialogueProcessing:closureSaved?'handled':'pending',
          code:error.message,semanticVerification:'not_performed',...(priorProcessing?.sourceValidation?{sourceValidation:priorProcessing.sourceValidation}:{})});
      });
      if(closureSaved){
        await journal.append('event_pending',{pointer:source.pointer,code:error.message,dialogueStatus:'closed',at:now().now});
        await emit('event_pending',{pointer:source.pointer,code:error.message,dialogueStatus:'closed',pending:clone(state.pending)});
        return {status:'pending',code:error.message,dialogueStatus:'closed',eventProcessing,pointer:source.pointer,focus:clone(state),temporal};
      }
      halted = true; cancelTimer();
      await journal.append("failure", { pointer: source.pointer, code: error.message, at: now().now });
      await emit("failure", { code: error.message, pending: clone(state.pending) });
      return { status: "failed", code: error.message };
    }
  }
  async function recoverDialogue(source, generation, previous, originalProcessing) {
    const pointer=source.pointer,key=cmcpSourcePointerKey(pointer),sourceHash=loopHash(source),originalProcessingHash=loopHash(originalProcessing);
    const read=await readEvent(),eventVersion=versionOf(read),temporal=timeWithPrior(now().now,previous.lastUserAt);
    const sourceUpdateIds=read.internal.records.filter(record=>cmcpSourcePointerKey(record.command.source.pointer)===key).map(record=>record.command.updateId);
    const eventSourceSupported=current=>{
      const indexes=current.internal.records.flatMap((record,index)=>cmcpSourcePointerKey(record.command.source.pointer)===key?[index]:[]);
      return (originalProcessing.eventProcessing!=='committed'||indexes.length>0)
        &&indexes.every(index=>current.internal.checks[index]?.supported&&current.internal.records[index].sourceSnapshot.evidenceSha256===sourceHash);
    };
    const canRecover=async()=>{
      if(!await canContinue()||!bufferValid()||stopped||halted||userGeneration!==generation
        ||state.lastUserAt!==previous.lastUserAt||state.expiry!==previous.expiry
        ||!state.pending.some(p=>cmcpSourcePointerKey(p)===key))return false;
      const latest=(state.processing??[]).findLast(p=>cmcpSourcePointerKey(p.pointer)===key);
      if(!latest||loopHash(latest)!==originalProcessingHash)return false;
      const exact=await resolveCmcpHistorySource({provider:history,pointer});
      if(exact.status!=='found'||loopHash(exact.evidence)!==sourceHash)return false;
      const current=await readEvent(eventContext?{sourceUpdateIds}:{});return versionOf(current)===eventVersion&&eventSourceSupported(current);
    };
    const requireActive=async()=>{if(!await canRecover())throw Error('dialogue_recovery_stale_or_cancelled');};
    try {
      await requireActive();
      const prior=await priorDialogue(previous);
      const result=await adapter.request('dialogue_recover',{
        operation:'existing_source_dialogue_recovery',event,
        source:{ref:'input',sourceAuthorRole:source.sourceAuthorRole,contentKind:source.content.kind,text:source.content.body,
          messageRecordedAt:source.messageRecordedAt,messageRecordedAtLocal:formatCmcpLocalInstant(source.messageRecordedAt,timezone),
          eventOccurredAt:source.eventOccurredAt,eventOccurredAtLocal:formatCmcpLocalInstant(source.eventOccurredAt,timezone)},
        priorDialogue:prior.model,interactionTime:projectCmcpRuntimeTime(temporal),
        ...(controlIntent?{controlContext:buildCmcpDialogueControlContext(event,previous)}:{}),
        sourceProcessing:{event:originalProcessing.eventProcessing,dialogue:'pending',semanticVerification:'not_performed'}
      },{canAttempt:canRecover});
      await journal.append('dialogue_recovery_proposal',{pointer,eventVersion,sourceHash,dialogue:result.value.dialogue,transport:result.transport??null,
        ...(controlIntent?{controlIntent:result.value.controlIntent??null}:{})});
      const confirmed=await validateDialogue(result.value.dialogue,source,prior);
      const checkedControl=controlIntent?validateCmcpDialogueControlIntent(result.value.controlIntent,{source,event,dialogue:result.value.dialogue,prior:previous}):null;
      // A fresh dialogue interpretation cannot silently resolve unrelated remaining event work.
      const remaining=originalProcessing.remaining??[];
      const supportedRemaining=remaining.every(segment=>segment.targets?.length===1&&segment.targets[0]==='dialogue'
        &&confirmed.supports.some(support=>cmcpSourcePointerKey(support.pointer)===key
          &&support.citation.start<=segment.start&&support.citation.end>=segment.end));
      const handled=(controlIntent?checkedControl.processing==='handled':confirmed.status!=='unknown')&&supportedRemaining;
      const controlApplicable=handled&&confirmed.status==='closed'&&previous.sourceRefs.at(-1)
        &&cmcpSourcePointerKey(previous.sourceRefs.at(-1))===key
        &&(controlIntent?checkedControl.apply:previous.lastUserAt===source.messageRecordedAt);
      await requireActive();
      await emit('dialogue_recovery_validated',{pointer,dialogueStatus:confirmed.status,handled,eventVersion});
      await mutate(draft=>{
        // Resolving old interpretation is not renewed User interest. Never reopen focus,
        // restore cleared Buffer, extend expiry, or replace event progress here.
        if(controlApplicable){
          Object.assign(draft,confirmed);
          if(controlIntent)draft.lastControlInterpretation={...checkedControl,at:temporal.now,recovery:true};
        }
        draft.processing??=[];
        draft.processing.push({...clone(originalProcessing),pointer,dialogueProcessing:handled?'handled':'pending',
          code:handled?null:confirmed.status==='unknown'?'dialogue_processing_unknown':'dialogue_remaining_source_not_supported',
          dialogueRecovery:{kind:'derived_dialogue_interpretation',...confirmed,recoveredAt:temporal.now,
            eventVersion,sourceHash,focusActivation:'unchanged',controlApplied:!!controlApplicable},
          remaining:handled?[]:remaining,semanticVerification:'not_performed'});
        if(handled)draft.pending=draft.pending.filter(p=>cmcpSourcePointerKey(p)!==key);
      },canRecover);
      const receipt={status:handled?'accepted':'pending',eventProcessing:originalProcessing.eventProcessing,
        dialogueProcessing:handled?'handled':'pending',dialogueStatus:confirmed.status,
        ...(handled?{}:{code:confirmed.status==='unknown'?'dialogue_processing_unknown':'dialogue_remaining_source_not_supported'}),
        pointer,recovery:true,recoveryMode:'dialogue_only',sourceTime:source.messageRecordedAt,
        originalUserTime:state.lastUserAt,originalExpiry:state.expiry,focusActivation:'unchanged',eventVersion,
        controlApplied:!!controlApplicable,internal:{sourceProcessing:handled?'completed':'pending'}};
      await journal.append('dialogue_recovery_result',receipt);await emit('dialogue_recovered',receipt);return receipt;
    } catch(error) {
      await journal.append('dialogue_recovery_failure',{pointer,code:error.message,eventVersion,sourceHash,at:now().now});
      return {status:'failed',code:error.message,pointer,recovery:true,recoveryMode:'dialogue_only',
        eventProcessing:originalProcessing.eventProcessing,dialogueProcessing:'pending',internal:{sourceProcessing:'pending'}};
    }
  }
  async function resumeDialogue(pointer) {
    if(stopped||users)throw Error('recovery_runtime_not_idle');
    const key=cmcpSourcePointerKey(pointer);
    if(pointer.scopeId!==event.scopeId||!state.pending.some(p=>cmcpSourcePointerKey(p)===key)
      ||!state.sourceRefs.some(p=>cmcpSourcePointerKey(p)===key))throw Error('event_source_not_pending_here');
    const processing=(state.processing??[]).findLast(p=>cmcpSourcePointerKey(p.pointer)===key);
    if(!['committed','unchanged'].includes(processing?.eventProcessing)||processing.dialogueProcessing!=='pending')throw Error('dialogue_only_recovery_requires_committed_event');
    const exact=await resolveCmcpHistorySource({provider:history,pointer});
    if(exact.status!=='found'||exact.evidence.sourceAuthorRole!=='user'||exact.evidence.content.kind!=='source_excerpt'
      ||exact.evidence.messageRecordedAt===null)throw Error('event_recovery_source_unavailable');
    parseCmcpInstant(exact.evidence.messageRecordedAt);
    const generation=++userGeneration,previous=clone(state);users++;epoch++;cancelTimer();cancelProactiveWork('dialogue_recovery');halted=false;
    const task=userQueue.then(async()=>{if(flight)await flight;return recoverDialogue(exact.evidence,generation,previous,processing);});
    userQueue=task.catch(()=>{});try{return await task;}finally{users--;schedule();}
  }
  async function correctDialogueControl({updateId,pointer,expectedStateKey,authorization,reason}){
    if(stopped||users||!controlIntent||!bufferValid()||!await canContinue())throw Error('dialogue_correction_runtime_controls');
    if(typeof updateId!=='string'||!updateId||typeof reason!=='string'||!reason.trim()
      ||authorization?.kind!=='user_authorized_correction'||typeof authorization.reference!=='string'||!authorization.reference)throw Error('explicit_dialogue_correction_authorization_required');
    const key=cmcpSourcePointerKey(pointer),records=(await journal.read()).map(row=>row.record);
    const completedState=state.lastControlCorrection?.updateId===updateId?state.lastControlCorrection:null;
    const priorCorrection=records.find(row=>row.kind==='dialogue_control_correction'&&row.value.updateId===updateId)
      ??(completedState?{value:completedState}:null);
    if(priorCorrection){
      if(cmcpSourcePointerKey(priorCorrection.value.sourcePointer)!==key||priorCorrection.value.expectedStateKey!==expectedStateKey||priorCorrection.value.reason!==reason)throw Error('dialogue_correction_id_conflict');
      return {status:'already_corrected',...clone(priorCorrection.value),modelCalls:0};
    }
    const resolved=await resolveCmcpHistorySource({provider:history,pointer});
    if(pointer.scopeId!==event.scopeId||resolved.status!=='found'||resolved.evidence.sourceAuthorRole!=='user'
      ||resolved.evidence.content.kind!=='source_excerpt')throw Error('dialogue_correction_source_unavailable');
    const original=clone(state),plan=planCmcpDialogueControlCorrection({records,source:resolved.evidence,event,current:state,expectedStateKey});
    for(const support of plan.restored.supports)await resolveSupport(support);
    const currentVersion=versionOf(await readEvent());
    const valid=async()=>await canContinue()&&bufferValid()&&!stopped&&cmcpDialogueStateKey(state)===expectedStateKey
      &&state.lastUserAt===original.lastUserAt&&state.expiry===original.expiry&&versionOf(await readEvent())===currentVersion;
    if(!await valid())throw Error('dialogue_correction_stale');
    users++;epoch++;cancelTimer();cancelProactiveWork('dialogue_control_correction');
    try{
      const receipt={...plan,updateId,authorization:clone(authorization),reason,at:now().now,
        sourceTime:resolved.evidence.messageRecordedAt,originalUserTime:original.lastUserAt,originalExpiry:original.expiry,
        eventVersion:currentVersion,activation:plan.appliesToCurrent?'restored_recorded_prior_activation':'current_unchanged',proactive:'not_restarted'};
      // The correction records the actual historical state, never a caller-supplied desired state.
      await mutate(draft=>{if(plan.appliesToCurrent)Object.assign(draft,clone(plan.restored));draft.lastControlCorrection=clone(receipt);},valid);
      await journal.append('dialogue_control_correction',receipt);return {status:'corrected',...receipt,modelCalls:0};
    }finally{users--;}
  }
  function cancelTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function eligibilityReason(snapshot, at) {
    if (!bufferValid()) return 'buffer_cleared';
    if (stopped) return 'stopped'; if (halted) return 'halted'; if (!enabled) return 'disabled';
    if (paused || users) return 'user_operation'; if (snapshot.pending.length) return 'source_pending';
    if (snapshot.status !== 'open') return snapshot.status === 'closed' ? 'closed' : 'unknown_dialogue';
    if (!snapshot.supports.length || !snapshot.expiry || !snapshot.lastUserAt || !snapshot.eventVersion) return 'no_supported_focus';
    if (at.nowEpochMs < started.nowEpochMs || at.nowEpochMs >= windowEnd) return 'outside_activity_window';
    if (at.nowEpochMs >= parseCmcpInstant(snapshot.expiry)) return 'expired';
    if (at.nowEpochMs - parseCmcpInstant(snapshot.lastUserAt) < inactivityMs) return 'waiting_inactivity';
    return null;
  }
  const eligible = (snapshot, at) => eligibilityReason(snapshot, at) === null;
  const progressKey = snapshot => loopHash([event, snapshot.eventVersion,
    snapshot.supports.map(support => ({ pointer: support.pointer, citation: support.citation }))]);
  async function evaluate() {
    const snapshot = clone(state), at = now(), capturedEpoch = epoch;
    if (!eligible(snapshot, at)) return { status: "ineligible" };
    const key = progressKey(snapshot);
    if (snapshot.sends.some(send => send.key === key)) return { status: "deduplicated" };
    return runProactiveWork(async () => {
    let reserved = false;
    try {
      const dialogue = await priorDialogue(snapshot), read = await readEvent();
      if (versionOf(read) !== snapshot.eventVersion || !eventContext&&read.internal.checks.some(check => !check.supported)) throw Error("focus_event_unsupported_or_changed");
      const compactRead=await compact(read,at,snapshot.synopsis,snapshot.supports.map(s=>s.pointer));
      if (epoch !== capturedEpoch || !eligible(state, now())) return { status: "cancelled" };
      // Reservation precedes model generation; a crash cannot make an ambiguous attempt repeat on restart.
      await mutate(draft => draft.sends.push({ key, status: "reserved", at: at.now, sessionId })); reserved = true;
      if (epoch !== capturedEpoch || !eligible(state, now())) throw Error("stale_before_generation");
      const canAttempt = async () => {
        const verified = await readEvent();
        await priorDialogue(snapshot);
        return epoch === capturedEpoch && eligible(state, now()) && versionOf(verified) === snapshot.eventVersion
          && (eventContext||verified.internal.checks.every(check => check.supported))&&await compactRead.verify()
          && state.eventVersion === snapshot.eventVersion && state.lastUserAt === snapshot.lastUserAt;
      };
      const result = await adapter.request("proactive", { compact: compactRead.model, dialogue: dialogue.model,
        interactionTime: projectCmcpRuntimeTime(timeWithPrior(at.now, snapshot.lastUserAt)) }, { canAttempt });
      const verified = await readEvent();
      await priorDialogue(snapshot);
      if (epoch !== capturedEpoch || !eligible(state, now()) || versionOf(verified) !== snapshot.eventVersion||!await compactRead.verify()
        || state.eventVersion !== snapshot.eventVersion || state.lastUserAt !== snapshot.lastUserAt) throw Error("stale_before_presentation");
      const presented = await present("proactive", result.value.text, async () => epoch === capturedEpoch
        && eligible(state, now()) && state.eventVersion === snapshot.eventVersion && state.lastUserAt === snapshot.lastUserAt&&await compactRead.verify());
      await mutate(draft => Object.assign(draft.sends.find(send => send.key === key), { status: "presented", ...presented }));
      return { status: "presented" };
    } catch (error) {
      const status = error.presentationUncertain ? "presentation_unknown" : "not_presented";
      if (reserved) await mutate(draft => Object.assign(draft.sends.find(send => send.key === key), { status, code: error.message }));
      await journal.append("evaluation", { key, status, code: error.message, at: now().now });
      // Cancellation is an expected lifecycle outcome, not a permanent failure of
      // the next User operation. The reservation still forbids ambiguous resends.
      if (epoch === capturedEpoch && !error.message.startsWith("stale_")) { halted = true; cancelTimer(); await emit("failure", { code: error.message }); }
      return { status, code: error.message };
    }
    }, { event: clone(event), eventVersion: snapshot.eventVersion, pointer: clone(snapshot.supports.at(-1).pointer),
      sourceRefs: snapshot.supports.map(support => clone(support.pointer)), lastUserAt: snapshot.lastUserAt, progressKey: key });
  }
  function runEvaluation() {
    if (flight) return flight;
    const evaluationEpoch = epoch;
    flight = evaluate().catch(error => {
      if (epoch !== evaluationEpoch || stopped || !enabled) return { status: 'cancelled', code: error.message };
      throw error;
    }).finally(() => { flight = null; schedule(); });
    return flight;
  }
  function schedule() {
    cancelTimer();
    if (!bufferValid() || stopped || halted || paused || !enabled || users || state.status !== "open" || !state.lastUserAt || state.pending.length) return;
    const at = now();
    if (at.nowEpochMs >= windowEnd || !state.expiry || at.nowEpochMs >= parseCmcpInstant(state.expiry)
      || state.sends.some(send => send.key === progressKey(state))) return;
    const delay = Math.max(1, Math.min(inactivityMs, parseCmcpInstant(state.lastUserAt) + inactivityMs - at.nowEpochMs));
    timer = setTimeout(() => { timer = null; runEvaluation().catch(async error => {
      halted = true; cancelTimer(); await emit("failure", { code: error.message });
    }); }, delay);
  }
  await emit("started", { event, focus: clone(state), proactive: enabled, activityWindow: { start: started.now, end: new Date(windowEnd).toISOString() } });
  schedule();
  return Object.freeze({
    history, eventStore, sessionId,
    get snapshot() { return clone(state); },
    get isHalted() { return halted; },
    get proactiveState() {
      const reason = eligibilityReason(state, now()), deduplicated = state.supports.length && state.sends.some(send => send.key === progressKey(state));
      return { enabled, stopped, halted, paused, sessionId, timerScheduled: timer !== null, generating: flight !== null,
        eligible: !reason && !deduplicated, reason: reason ?? (deduplicated ? 'deduplicated' : 'eligible'),
        activityWindowEnd: new Date(windowEnd).toISOString(), latestSend: clone(state.sends.at(-1) ?? null) };
    },
    answerLatest() {
      users++; cancelTimer();
      const task = userQueue.then(answerCurrent).catch(async error => {
        halted = true; cancelTimer(); await journal.append("failure", { code: error.message, at: now().now });
        await emit("failure", { code: error.message }); return { status: "failed", code: error.message };
      });
      userQueue = task.catch(() => {});
      return task.finally(() => { users--; schedule(); });
    },
    setProactive(value) {
      if (typeof value !== "boolean") throw Error("invalid_proactive_control");
      enabled = value; epoch++; cancelTimer(); if (!value) cancelProactiveWork('proactive_disabled'); schedule();
    },
    setBufferTtlMs(value) {
      if (!positive(value)) throw Error('invalid_buffer_ttl');
      activationTtlMs = value;
    },
    interruptProactive(reason = 'new_user_input') { paused = true; epoch++; cancelTimer(); cancelProactiveWork(reason); },
    resumeProactive() { paused = false; schedule(); },
    waitForProactive() { return flight ?? Promise.resolve(); },
    submit(text, { answer = true, timeContext } = {}) {
      if (typeof text !== "string" || !text.trim() || typeof answer !== "boolean" || stopped) throw Error("invalid_user_input");
      const temporal = timeContext === undefined ? now() : resolveCmcpTimeContext(timeContext);
      if (temporal.timezone !== timezone) throw Error('input_timezone_mismatch');
      const receivedAt = temporal.now, generation = ++userGeneration; epoch++; users++; cancelTimer(); cancelProactiveWork('new_user_input');
      const capturedBufferTtlMs = activationTtlMs;
      const task = userQueue.then(() => processUser(text, answer, receivedAt, generation, capturedBufferTtlMs));
      userQueue = task.catch(() => {});
      return task.finally(() => { users--; schedule(); });
    },
    async resumeSource(pointer) {
      if (stopped || users) throw Error('recovery_runtime_not_idle');
      cmcpSourcePointerKey(pointer);
      if (pointer.scopeId !== event.scopeId || !state.pending.some(p => cmcpSourcePointerKey(p) === cmcpSourcePointerKey(pointer))
        || !state.sourceRefs.some(p => cmcpSourcePointerKey(p) === cmcpSourcePointerKey(pointer))) throw Error('event_source_not_pending_here');
      const last = (state.processing ?? []).findLast(p => cmcpSourcePointerKey(p.pointer) === cmcpSourcePointerKey(pointer));
      if (['committed','unchanged'].includes(last?.eventProcessing)) throw Error('event_already_processed_dialogue_pending');
      const found = await resolveCmcpHistorySource({provider: history, pointer});
      if (found.status !== 'found' || found.evidence.sourceAuthorRole !== 'user' || found.evidence.content.kind !== 'source_excerpt'
        || found.evidence.messageRecordedAt === null) throw Error('event_recovery_source_unavailable');
      parseCmcpInstant(found.evidence.messageRecordedAt);
      const source = found.evidence, generation = ++userGeneration;
      users++; epoch++; cancelTimer(); cancelProactiveWork('source_recovery'); halted = false;
      const task = userQueue.then(() => processUser(source.content.body, false, source.messageRecordedAt, generation, activationTtlMs, source));
      userQueue = task.catch(() => {});
      try { return await task; } finally { users--; schedule(); }
    },
    async resumeAnswer(pointer) {
      if(stopped||users)throw Error('recovery_runtime_not_idle');
      const key=cmcpSourcePointerKey(pointer);
      if(pointer.scopeId!==event.scopeId||!state.sourceRefs.some(p=>cmcpSourcePointerKey(p)===key))throw Error('answer_recovery_source_outside_event');
      if(!bufferValid()||!await canContinue())throw Error('work_cancelled_or_expired');
      const found=await resolveCmcpHistorySource({provider:history,pointer});
      if(found.status!=='found'||found.evidence.sourceAuthorRole!=='user'||found.evidence.content.kind!=='source_excerpt'||found.evidence.messageRecordedAt===null)throw Error('answer_recovery_source_unavailable');
      const source=found.evidence,hash=loopHash(source),rows=(await journal.read()).map(row=>row.record);
      const matches=row=>row.value.pointer&&cmcpSourcePointerKey(row.value.pointer)===key;
      const plans=rows.filter(row=>row.kind==='assistant_reply_planned'&&cmcpSourcePointerKey(row.value.replyTo)===key);
      if(plans.length){
        const saved=[];for(const {value:plan} of plans){
          const reply=await resolveCmcpHistorySource({provider:history,pointer:plan.pointer});
          if(plan.replyToEvidenceHash!==hash||reply.status!=='found'||reply.evidence.sourceAuthorRole!=='assistant'||loopHash(reply.evidence)!==plan.sourceHash)
            return {status:'pending',code:'answer_publication_unconfirmed',answerGeneration:'not_repeated',presentation:'unknown',pointer};
          const presentation=rows.findLast(row=>row.kind==='assistant_presentation_result'&&cmcpSourcePointerKey(row.value.pointer)===cmcpSourcePointerKey(plan.pointer));
          saved.push({pointer:plan.pointer,presentation:presentation?.value.status??'unknown'});
        }
        return {status:saved.every(row=>row.presentation==='presented')?'already_completed':'pending',code:saved.every(row=>row.presentation==='presented')?null:'answer_presentation_unknown',
          answerGeneration:'already_saved',presentation:saved.every(row=>row.presentation==='presented')?'presented':'unknown',saved,pointer,modelCalls:0};
      }
      const attempts=rows.filter(row=>row.kind==='answer_started'&&matches(row));
      const lastAnswer=rows.findLast(row=>row.kind==='answer_result'&&matches(row));
      if(lastAnswer?.value.status==='completed'&&lastAnswer.value.storage==='disabled'
        &&rows.some(row=>row.kind==='assistant_unsaved_presentation_result'&&row.value.replyTo
          &&cmcpSourcePointerKey(row.value.replyTo)===key&&row.value.status==='presented'))return {
            status:'already_completed',answerGeneration:'already_presented_without_storage',presentation:'presented',storage:'disabled',pointer,modelCalls:0};
      // Known local preflights are recoverable only when the Runtime verifies
      // the exact failed work and durable absence of an answer POST. An error
      // name alone never proves that remote processing did not occur.
      const legacyCandidate=attempts.length>0&&lastAnswer?.value.status==='failed'
        &&['compact_budget_exceeded','invalid_answer_history_projection_for_capacity'].includes(lastAnswer.value.code)
        &&rows.lastIndexOf(lastAnswer)>rows.lastIndexOf(attempts.at(-1));
      const preflightEvidence=legacyCandidate?await verifyLegacyAnswerPreflight({pointer,evidenceHash:hash,code:lastAnswer.value.code}):null;
      const knownLegacyPreflight=preflightEvidence?.status==='verified_not_started';
      const presentationEvidence=rows.some(row=>['assistant_presentation_started','assistant_presentation_result'].includes(row.kind)&&row.value.replyTo&&cmcpSourcePointerKey(row.value.replyTo)===key);
      const rejectedCandidate=attempts.length>0&&!presentationEvidence&&lastAnswer?.value.status==='failed'
        &&lastAnswer.value.remoteOutcome==='completed'&&['invalid_json','invalid_proposal_schema'].includes(lastAnswer.value.code)
        &&lastAnswer.value.presentation==='not_confirmed'&&rows.lastIndexOf(lastAnswer)>rows.lastIndexOf(attempts.at(-1));
      const rejectedCompletionEvidence=rejectedCandidate?await verifyRejectedAnswerCompletion({pointer,evidenceHash:hash,code:lastAnswer.value.code}):null;
      const knownRejectedCompletion=rejectedCompletionEvidence?.status==='verified_completed_format_rejected';
      if(presentationEvidence||attempts.length&&!knownLegacyPreflight&&!knownRejectedCompletion)return {status:'pending',code:'answer_remote_or_publication_unknown',answerGeneration:'not_repeated',presentation:'unknown',pointer,modelCalls:0};
      const stage=rows.findLast(row=>row.kind==='conversation_stage_plan'&&matches(row));
      const legacyFailure=rows.find(row=>row.kind==='failure'&&matches(row)&&row.value.code==='semantic_preview_not_ready');
      const legacyPreview=rows.find(row=>row.kind==='preview'&&matches(row)&&row.value.preview?.status!=='ready'&&row.value.recovery!==true);
      const legacyReady=rows.some(row=>row.kind==='preview'&&matches(row)&&row.value.preview?.status==='ready'&&row.value.recovery!==true);
      const basis=knownRejectedCompletion?'explicit_resume_after_verified_format_rejection':knownLegacyPreflight?
        lastAnswer.value.code==='compact_budget_exceeded'?'legacy_compact_preflight_before_adapter':'verified_answer_transport_preflight':stage?.value.answerRequested===true&&stage.value.evidenceHash===hash?'recorded_stage_not_started':!stage&&legacyFailure&&legacyPreview&&!legacyReady?'legacy_failure_before_answer':null;
      if(!basis)return {status:'pending',code:stage?.value.answerRequested===false?'answer_not_requested':'answer_stage_unknown',answerGeneration:'not_repeated',pointer,modelCalls:0};
      await validateAnswerRecoverySource(pointer);
      const processing=(state.processing??[]).findLast(row=>cmcpSourcePointerKey(row.pointer)===key);
      const marker=processing?.sourceValidation;
      if(!['committed','unchanged'].includes(processing?.eventProcessing)&&!(marker?.status==='verified'&&marker.sourceAuthorRole==='user'&&marker.evidenceHash===hash&&cmcpSourcePointerKey(marker.pointer)===key))
        return {status:'pending',code:'answer_source_not_validated',answerGeneration:'not_repeated',pointer,modelCalls:0};
      const read=await readEvent(),eventVersion=versionOf(read),generation=++userGeneration,originalUserTime=state.lastUserAt,originalExpiry=state.expiry;
      users++;epoch++;cancelTimer();cancelProactiveWork('answer_recovery');halted=false;
      // A later Event-only recovery is not a replacement request for this
      // answer. Bind its locator aliases, plan and material intent to the
      // original answer stage, not the newest preview for the same source.
      // Existing journals already record this boundary before any answer POST.
      const answerStageIndex=attempts.length?rows.indexOf(attempts[0]):rows.length;
      const answerStageRows=rows.slice(0,answerStageIndex);
      const historyPreview=answerStageRows.findLast(row=>row.kind==='preview'&&matches(row)&&row.value.answerHistoryPrepared);
      const controlPreview=controlIntent?answerStageRows.findLast(row=>row.kind==='preview'&&matches(row)&&row.value.controlIntent):null;
      // Answer-only recovery never applies a historical control or renews its target.
      const recoveredControl=controlPreview?validateCmcpDialogueControlIntent(controlPreview.value.controlIntent,{source,event,dialogue:controlPreview.value.dialogue,historicalTarget:true}):null;
      answerContext={...(historyPreview?{answerHistoryPrepared:historyPreview.value.answerHistoryPrepared,answerHistoryPlan:historyPreview.value.answerHistoryPlan}:{}),text:source.content.body,receivedAt:source.messageRecordedAt,guardUserAt:originalUserTime,temporal:timeWithPrior(now().now,originalUserTime),
        ...(recoveredControl?{materials:recoveredControl.materials,focusIndependent:!recoveredControl.apply}:{}),
        eventVersion,generation,recovery:true,source:{pointer,evidenceHash:hash,eventVersion}};
      await journal.append('answer_recovery_basis',{pointer,basis,evidenceHash:hash,eventVersion,originalUserTime,originalExpiry,
        answerStageBinding:{answerStartedIndex:attempts.length?answerStageIndex:null,previewIndex:historyPreview?rows.indexOf(historyPreview):null,
          preparedHash:historyPreview?loopHash(historyPreview.value.answerHistoryPrepared):null,planHash:historyPreview?.value.answerHistoryPlan?loopHash(historyPreview.value.answerHistoryPlan):null},
        ...(preflightEvidence?{preflightEvidence}:{}),
        ...(rejectedCompletionEvidence?{rejectedCompletionEvidence,newChargePossible:true}:{})});
      const task=userQueue.then(answerCurrent);userQueue=task.catch(()=>{});
      try{return {...await task,recovery:true,recoveryMode:'answer_only',originalUserTime,originalExpiry,focusActivation:'unchanged',modelCalls:1,
        ...(rejectedCompletionEvidence?{recoveryBasis:basis,previousRejectedAttempts:rejectedCompletionEvidence.attempts,budgetRefunded:false,newModelWork:true}:{})};}
      finally{users--;schedule();}
    },
    resumeDialogue,
    correctDialogueControl,
    validateAnswerRecoverySource,
    // Host timer uses this same path. Tests can inject a clock and inspect the deterministic boundary.
    evaluateIdle: runEvaluation,
    async close() {
      stopped = true; enabled = false; epoch++; cancelTimer(); cancelProactiveWork('runtime_closed');
      await userQueue; if (flight) await flight; await writes;
      adapter.dispose?.(); await emit("stopped", { focus: clone(state), halted });
    }
  });
}
