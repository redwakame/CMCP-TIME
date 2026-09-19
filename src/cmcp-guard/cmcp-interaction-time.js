import { cmcpSourcePointerKey } from './cmcp-source-pointer.js';
import { loopHash } from './cmcp-local-loop-journal.js';
import { parseCmcpInstant, resolveCmcpTimeContext } from './resolve-cmcp-time-context.js';
import { formatCmcpLocalInstant, projectCmcpRuntimeTime } from './project-cmcp-local-time.js';
import { resolveCmcpHistorySource } from './cmcp-history-provider.js';

/** Source metadata in the existing input journal; no body, summary, Event or Buffer dependency. */
export function createCmcpInteractionTime({journal,scopeId,timezone,historyProvider,legacyCards=async()=>[]}) {
  if(typeof historyProvider?.resolve!=='function')throw Error('time_card_history_provider_required');
  async function cards() {
    const byPointer=new Map();
    for(const {record} of await journal.read()) if(record.kind==='source_time_card') {
      const card=record.value;
      if(card.pointer.scopeId!==scopeId)throw Error('time_card_scope_mismatch');
      const key=cmcpSourcePointerKey(card.pointer),prior=byPointer.get(key);
      if(prior&&prior.evidenceHash!==card.evidenceHash)throw Error('time_card_revision_conflict');
      byPointer.set(key,card);
    }
    for(const card of await legacyCards()){
      if(card.pointer.scopeId!==scopeId)throw Error('time_card_scope_mismatch');
      if(!byPointer.has(cmcpSourcePointerKey(card.pointer)))byPointer.set(cmcpSourcePointerKey(card.pointer),card);
    }
    return [...byPointer.values()];
  }
  async function record(evidence) {
    if(evidence.pointer.scopeId!==scopeId)throw Error('time_card_scope_mismatch');
    const card={version:1,pointer:evidence.pointer,role:evidence.sourceAuthorRole,
      messageRecordedAt:evidence.messageRecordedAt??null,eventOccurredAt:evidence.eventOccurredAt??null,
      evidenceHash:loopHash(evidence)};
    const prior=(await cards()).find(c=>cmcpSourcePointerKey(c.pointer)===cmcpSourcePointerKey(card.pointer));
    if(prior){if(prior.evidenceHash!==card.evidenceHash)throw Error('time_card_revision_conflict');return {status:'unchanged',card:prior};}
    await journal.append('source_time_card',card);return {status:'registered',card};
  }
  async function project({timeContext,excludePointers=[]}={}) {
    const temporal=resolveCmcpTimeContext(timeContext);
    if(temporal.timezone!==timezone)throw Error('time_card_timezone_mismatch');
    const excluded=new Set(excludePointers.map(cmcpSourcePointerKey));
    const scoped=(await cards()).filter(card=>['user','assistant'].includes(card.role)&&!excluded.has(cmcpSourcePointerKey(card.pointer)));
    const unknownTimeCount=scoped.filter(card=>card.messageRecordedAt===null).length;
    const unknownUserTimeCount=scoped.filter(card=>card.role==='user'&&card.messageRecordedAt===null).length;
    const future=scoped.filter(card=>card.messageRecordedAt!==null&&parseCmcpInstant(card.messageRecordedAt)>temporal.nowEpochMs);
    const futureTimeCount=future.length,futureUserTimeCount=future.filter(card=>card.role==='user').length;
    const eligible=scoped.filter(card=>card.messageRecordedAt!==null&&parseCmcpInstant(card.messageRecordedAt)<=temporal.nowEpochMs);
    // Verify only candidates for the actual projection, never re-read all old bodies.
    // A missing latest source is a chronology gap, not permission to call an older
    // source the previous exchange. Older verified metadata is labelled latestKnown.
    const verified=new Map(),unavailable=new Map();let checks=0,limitReached=false;
    const available=async card=>{
      const key=cmcpSourcePointerKey(card.pointer);if(verified.has(key))return verified.get(key);
      if(checks>=8){limitReached=true;return false;}checks++;
      const result=await resolveCmcpHistorySource({provider:historyProvider,pointer:card.pointer});
      const ok=result.status==='found'&&loopHash(result.evidence)===card.evidenceHash
        &&result.evidence.sourceAuthorRole===card.role&&result.evidence.messageRecordedAt===card.messageRecordedAt;
      verified.set(key,ok);if(!ok)unavailable.set(key,card);return ok;
    };
    const latest=async role=>{const ordered=eligible.filter(c=>!role||c.role===role).sort((a,b)=>parseCmcpInstant(b.messageRecordedAt)-parseCmcpInstant(a.messageRecordedAt));
      let gap=false;for(const card of ordered){if(await available(card))return {card,gap};gap=true;if(limitReached)break;}return {card:null,gap};};
    const exchangeResult=await latest(),userResult=await latest('user'),exchange=exchangeResult.card,user=userResult.card;
    const unavailableSourceCount=unavailable.size,unavailableUserSourceCount=[...unavailable.values()].filter(card=>card.role==='user').length;
    const uncertainExchange=unknownTimeCount+futureTimeCount>0||exchangeResult.gap,uncertainUser=unknownUserTimeCount+futureUserTimeCount>0||userResult.gap;
    const describe=card=>card?{role:card.role,recordedAt:card.messageRecordedAt,
      recordedAtLocal:formatCmcpLocalInstant(card.messageRecordedAt,timezone),
      elapsedMs:temporal.nowEpochMs-parseCmcpInstant(card.messageRecordedAt)}:null;
    return {kind:'cmcp_exchange_time',current:projectCmcpRuntimeTime(temporal),
      // Registration order is not source chronology. A timestamped source cannot
      // be asserted to be the previous exchange while an unorderable source exists.
      previousExchange:uncertainExchange?null:describe(exchange),previousUser:uncertainUser?null:describe(user),
      ...(uncertainExchange||uncertainUser?{ordering:{status:unavailableSourceCount||limitReached?'incomplete_source_availability':futureTimeCount?'incomplete_source_clock_anomaly':'incomplete_unknown_source_time',unknownTimeCount,unknownUserTimeCount,
        ...(unavailableSourceCount||limitReached?{unavailableSourceCount,unavailableUserSourceCount,verificationLimitReached:limitReached}:{}),
        ...(futureTimeCount?{futureTimeCount,futureUserTimeCount,clockAnomaly:'source_recorded_after_current_runtime_instant'}:{})},
        latestKnownExchange:describe(exchange),latestKnownUser:describe(user)}:{}),
      sourceVerification:{checkedCandidates:checks,maxCandidateChecks:8,mode:'exact_pointer_revision_role_time_hash'},
      coverage:'registered_authorized_sources',eventOccurredAt:'not_inferred'};
  }
  return Object.freeze({record,cards,project});
}
