import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {loopHash} from './cmcp-local-loop-journal.js';
import {readCmcpSelectedHistory,activateCmcpHistorySources} from './cmcp-history-reactivation.js';
import {readCmcpBufferBoundary} from './cmcp-buffer-lifecycle.js';
import {formatCmcpLocalInstant} from './project-cmcp-local-time.js';
import {parseCmcpInstant,resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';
import {boundCmcpLocalLocator} from './cmcp-local-candidates.js';
import {CMCP_ANSWER_NO_READ_NEEDS as noReadNeeds,CMCP_ANSWER_READ_NEEDS as readNeeds,
  validateCmcpAnswerHistoryNeedShape as validateNeedShape,validateCmcpAnswerHistoryNeed} from './cmcp-answer-material-need.js';
export {cmcpAnswerHistoryMaterialScope,validateCmcpAnswerHistoryNeed} from './cmcp-answer-material-need.js';

const copy=value=>structuredClone(value),key=cmcpSourcePointerKey,bytes=value=>Buffer.byteLength(JSON.stringify(value));
const sameEvent=(left,right)=>left?.scopeId===right?.scopeId&&left?.eventId===right?.eventId;
const defaults={maxCandidates:6,maxSelectedSources:2,maxCatalogBytes:4096,maxReadBytes:4096,maxProjectionBytes:8192,maxSourceBytes:4096};
export const CMCP_ANSWER_HISTORY_MAX_SELECTED_SOURCES=3;
// A bounded diagnostic explanation, never quoted as source evidence or promoted
// into the answer context. Source-count and byte budgets remain independent.
export const CMCP_ANSWER_HISTORY_REASON_MAX_CODE_POINTS=512;
/** Source count is independent from the unchanged aggregate read/projection byte budgets. */
export function normalizeCmcpAnswerHistoryConfig(value){
  if(value===undefined)return {enabled:false,maxSelectedSources:defaults.maxSelectedSources};
  if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['enabled','maxSelectedSources'].includes(k))
    ||typeof value.enabled!=='boolean')throw Error('invalid_answer_history_configuration');
  const maxSelectedSources=Object.hasOwn(value,'maxSelectedSources')?value.maxSelectedSources:defaults.maxSelectedSources;
  if(!Number.isSafeInteger(maxSelectedSources)||maxSelectedSources<1||maxSelectedSources>CMCP_ANSWER_HISTORY_MAX_SELECTED_SOURCES)throw Error('invalid_answer_history_configuration');
  return {enabled:value.enabled,maxSelectedSources};
}
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const statuses=['none','selected','needs_clarification','needs_source'];
const quoteSchema={anyOf:[{type:'string'},obj({text:{type:'string',minLength:1},withinQuote:{type:'string',minLength:1}})]};

// Only locators are shortened. Candidate identities, roles, times and reply links
// remain fixed; exact-read source bytes and subsequent answer budgets are unchanged.
function fitLocatorCatalog(model,query,maxBytes){
  const beforeBytes=bytes(model),allocation=[];if(beforeBytes<=maxBytes)return {beforeBytes,afterBytes:beforeBytes,allocation};
  const skeleton=copy(model);for(const row of skeleton.candidates)row.sourceHint={text:'',complete:false};
  const remaining=maxBytes-bytes(skeleton),costs=model.candidates.map(row=>bytes(row.sourceHint.text)-2);
  const minimum=64;if(remaining<costs.reduce((sum,n)=>sum+Math.min(n,minimum),0))throw Error('answer_history_catalog_budget');
  let low=minimum,high=Math.max(minimum,...costs);
  while(low<high){const cap=Math.ceil((low+high)/2);if(costs.reduce((sum,n)=>sum+Math.min(n,cap),0)<=remaining)low=cap;else high=cap-1;}
  for(const row of model.candidates){const before=row.sourceHint.text,window=boundCmcpLocalLocator({text:before,query,maxBytes:low+2});
    if(window.shortened){row.sourceHint={text:window.text,complete:false};allocation.push({ref:row.ref,beforeBytes:bytes(before)-2,afterBytes:bytes(window.text)-2,
      relativeLocation:{unit:'unicode_code_points',start:window.start,end:window.end},basis:'existing_lexical_terms_bounded_locator_not_evidence'});}}
  if(bytes(model)>maxBytes)throw Error('answer_history_catalog_budget');
  return {beforeBytes,afterBytes:bytes(model),allocation};
}

/** Request-local IDs authorize no read until the original source binding is checked. */
export function buildCmcpAnswerHistoryBinding(catalog,{requireCurrentNeed=false,fixedNeed}={}){
  if(!catalog||catalog.version!==1||!Array.isArray(catalog.candidates)||catalog.candidates.length>6
    ||!Number.isSafeInteger(catalog.maxSelectedSources)||catalog.maxSelectedSources<1||catalog.maxSelectedSources>CMCP_ANSWER_HISTORY_MAX_SELECTED_SOURCES)throw Error('invalid_answer_history_catalog');
  const refs=catalog.candidates.map(row=>row.ref);
  if(new Set(refs).size!==refs.length||refs.some(ref=>!/^h[1-9]\d*$/.test(ref)))throw Error('invalid_answer_history_catalog');
  const coverage=catalog.coverage;
  if(bytes(catalog)>defaults.maxCatalogBytes||typeof catalog.timeBasis!=='string'||!catalog.timeBasis
    ||coverage?.kind!=='bounded_authorized_event_locators'||coverage.offeredSources!==refs.length
    ||!Number.isSafeInteger(coverage.registeredSources)||coverage.registeredSources<refs.length
    ||coverage.omittedSources!==coverage.registeredSources-refs.length
    ||coverage.unreadRemainders!=='not_assessed'||coverage.locatorVerification!=='catalog_metadata_not_current_exact_read'
    ||coverage.selectionIsNotAnswerSufficiency!==true)throw Error('invalid_answer_history_catalog');
  try{
    // Explicit fixed instant validates the zone without observing a clock or inventing source time.
    resolveCmcpTimeContext({now:'2000-01-01T00:00:00Z',timezone:catalog.timezone});
    for(const row of catalog.candidates){
      if(!['user','assistant'].includes(row.sourceAuthorRole)||!['source_excerpt','derived_summary','unknown'].includes(row.contentKind)
        ||typeof row.sameSession!=='boolean'||typeof row.sourceHint?.text!=='string'||typeof row.sourceHint.complete!=='boolean'
        ||row.replyToUserHint!==undefined&&(row.sourceAuthorRole!=='assistant'||typeof row.replyToUserHint!=='string')
        ||row.replyToRef!==undefined&&(row.sourceAuthorRole!=='assistant'||!catalog.candidates.some(parent=>parent.ref===row.replyToRef&&parent.sourceAuthorRole==='user')))throw Error();
      if(row.messageTime!==null)parseCmcpInstant(row.messageTime);
      if(row.eventOccurredAt!==null)parseCmcpInstant(row.eventOccurredAt);
    }
  }catch{throw Error('invalid_answer_history_catalog');}
  // Share the same fields once; the exact status/ref constraints remain enforced
  // by validateCmcpAnswerHistoryPlan before any selected read.
  const fields={status:{type:'string',enum:statuses},refs:{type:'array',maxItems:refs.length?catalog.maxSelectedSources:0,
    uniqueItems:true,items:refs.length?{type:'string',enum:refs}:{type:'string'}},reason:{type:'string',maxLength:CMCP_ANSWER_HISTORY_REASON_MAX_CODE_POINTS}};
  if(fixedNeed!==undefined){
    const noRead=noReadNeeds.includes(fixedNeed?.basis),unclear=fixedNeed?.basis==='unclear_reference';
    validateNeedShape({status:noRead?'none':unclear?'needs_clarification':'needs_source',need:fixedNeed});
    const selectedFields={...fields,status:{type:'string',enum:noRead?['none']:unclear?['needs_clarification']:statuses.filter(status=>status!=='none')},
      refs:{...fields.refs,maxItems:noRead||unclear?0:fixedNeed.basis==='recorded_fact_lookup'?refs.length:catalog.maxSelectedSources}};
    return {schema:obj(selectedFields),fixedNeed:copy(fixedNeed),instructions:[
      'The current material purpose was interpreted in the preceding input stage and bound to the exact current User source. This stage only chooses supplied locator refs for that fixed purpose; do not output, override or reconsider need.',
      'Bound material purpose: '+fixedNeed.basis+'. '+(noRead?'Return none and refs=[]; matching old wording cannot override the current material restriction.':unclear?
        'Return needs_clarification and refs=[]; the unresolved reference stays unresolved until a new User source clarifies it.':fixedNeed.basis==='recorded_fact_lookup'?
        'Selected refs are navigation hints for a formal bounded record check, not direct evidence or permission to repeat a previous answer. Up to the supplied candidate count may be named; selected needs at least one ref. If these locators do not identify the requested evidence, use needs_source with refs=[]. A previous question, Assistant response or identical wording does not establish the underlying User fact or exhaust History.':
        'Select the original owning the specifically referenced wording, answer or version, within maxSelectedSources. The request that produced a draft is not the Assistant draft. If the owner is absent, use needs_source; if genuinely indistinguishable, needs_clarification. Non-selected statuses use refs=[].'),
      'Catalog excerpts, reply links and times locate sources only; originals are formally read later. Preserve roles and versions, do not invent refs or infer absent history from a bounded catalog.'
    ].join('\n')};
  }
  const schema=requireCurrentNeed?{anyOf:[obj({...fields,status:{type:'string',enum:['none']},refs:{type:'array',maxItems:0,items:{type:'string'}},
    need:obj({basis:{type:'string',enum:noReadNeeds},quote:quoteSchema})}),obj({...fields,status:{type:'string',enum:statuses.filter(status=>status!=='none')},
    need:obj({basis:{type:'string',enum:readNeeds.filter(need=>need!=='recorded_fact_lookup')},quote:quoteSchema})}),
    obj({...fields,status:{type:'string',enum:statuses.filter(status=>status!=='none')},refs:{...fields.refs,maxItems:refs.length},
      need:obj({basis:{type:'string',enum:['recorded_fact_lookup']},quote:quoteSchema})})]}:obj(fields);
  return {schema,instructions:[
    ...(requireCurrentNeed?[
      'First determine what the CURRENT User is asking this answer to use, before inspecting matching locators. answerHistory.need is the single material/read authority. current_input_sufficient means the new input plus ordinary model knowledge is sufficient; event_context_sufficient means the supplied derived event context is sufficient without reading originals; history_excluded means the current User limits this answer to current material. These require status=none and refs=[]. Runtime maps current_input_sufficient/history_excluded to no historical answer context; it does not close the prior discussion. Do not output a separate controlIntent.materials.',
      'Use prior_content_reference to reproduce, compare or edit particular prior wording, an answer or a known source; direct selected reading remains limited to maxSelectedSources. Use recorded_fact_lookup when the question instead asks to establish a historical detail from the records, including whether the User supplied a detail. A previous question or Assistant answer about that detail is a navigation hint, not proof of the underlying User fact or an exhaustive search. recorded_fact_lookup invokes the formal bounded source-check workflow; its selected refs are locators only and may name up to the number of supplied candidates, without increasing original-read, projection or request budgets. Select useful supplied locators, or needs_source with refs=[] if they do not locate the required evidence. Use unclear_reference with needs_clarification for a genuinely unresolved historical reference. need.quote must be the exact current source excerpt expressing that dependency or restriction, never a quote from a candidate, prior answer or derived synopsis. Runtime checks it against source.text; use {text,withinQuote} only to disambiguate repeated exact text. A no-read sufficient choice may use an empty quote.',
      'A generic knowledge question or repetition of an earlier question does not itself request the earlier answer. Matching vocabulary, identical past questions, linked replies and segment membership locate sources only AFTER a current historical dependency is established. Do not select a prior answer merely because it could answer this question. The current User material restriction takes precedence over the existence of relevant History.'
    ]:[]),
    'Independently of Event/dialogue/discussion, answerHistory selects prior originals needed for this answer. Use none if current input/compact suffice; selected with 1..maxSelectedSources supplied hN refs for direct prior-content reading (recorded_fact_lookup uses its separate locator bound); needs_clarification for genuinely indistinguishable sources; needs_source when required evidence is unavailable here. Other statuses require refs=[]; explain missing/ambiguous references in reason.',
    'The bounded catalog is only a locator, not read evidence: its excerpt need not contain the answer. Omission does not prove History absent. Reply/session links help resolve prior-list/item references, but recency alone is not selection. Both User and Assistant originals are eligible; Assistant advice is not a User decision or verified fact. Do not answer, invent refs, rewrite sources or claim unread content was read.',
    'Select the source that actually owns the requested wording and recording time. A User request to draft is not the resulting Assistant draft, even when they share words. For an earlier Assistant sentence or its original time, select that Assistant original itself; a later revision or the User instructions cannot substitute for the earlier answer. For a User statement select the User original. If the required original is absent or indistinguishable, report the appropriate missing or ambiguous source instead of reconstructing it from another author or version.'
  ].join('\n')};
}

/** Compose an explicitly pre-bound material choice with the later locator result.
 * A second need field is rejected, never silently overwritten. */
export function applyCmcpAnswerHistoryFixedNeed(plan,need){
  if(!plan||Object.keys(plan).sort().join(',')!=='reason,refs,status')throw Error('fixed_answer_history_locator_shape');
  const combined={...copy(plan),need:copy(need)};validateNeedShape(combined);return combined;
}

export function validateCmcpAnswerHistoryPlan(plan,prepared){
  const catalog=prepared?.model;buildCmcpAnswerHistoryBinding(catalog);
  // Structural wire validation cannot prove provenance. The Runtime additionally
  // checks locator relations against the saved exact Pointer/hash reply binding.
  if(prepared.internal?.mapping){for(const row of catalog.candidates){const item=prepared.internal.mapping.find(entry=>entry.ref===row.ref);
    if(!item||row.sourceAuthorRole!==item.entry.sourceAuthorRole)throw Error('answer_history_reply_catalog_binding');
    const expected=item.replyBinding?prepared.internal.mapping.find(entry=>key(entry.entry.pointer)===key(item.replyBinding.replyTo)):null;
    if(row.replyToRef!==undefined&&row.replyToRef!==expected?.ref||expected&&(expected.entry.sourceAuthorRole!=='user'||expected.entry.evidenceHash!==item.replyBinding.replyToEvidenceHash
      ||key(item.entry.pointer)!==key(item.replyBinding.pointer)||item.entry.evidenceHash!==item.replyBinding.sourceHash))throw Error('answer_history_reply_catalog_binding');
  }}
  if(!plan||Object.keys(plan).sort().join(',')!==(Object.hasOwn(plan??{},'need')?'need,reason,refs,status':'reason,refs,status')||!statuses.includes(plan.status)||!Array.isArray(plan.refs)
    ||new Set(plan.refs).size!==plan.refs.length||typeof plan.reason!=='string'||[...plan.reason].length>CMCP_ANSWER_HISTORY_REASON_MAX_CODE_POINTS
    ||plan.refs.some(ref=>!catalog.candidates.some(row=>row.ref===ref))
    ||(plan.status==='selected'?plan.refs.length<1||plan.refs.length>(plan.need?.basis==='recorded_fact_lookup'?catalog.candidates.length:catalog.maxSelectedSources):plan.refs.length!==0)
    ||(['needs_source','needs_clarification'].includes(plan.status)&&!plan.reason.trim()))throw Error('invalid_answer_history_plan');
  if(Object.hasOwn(plan,'need'))validateNeedShape(plan);
  return copy(plan);
}

/** Model view of the existing formal reader/aggregate receipt, not a second search result. */
export function projectCmcpAnswerHistoryLookup({result,timezone,maxProjectionBytes}){
  if(!result||!['cmcp_history_query_result','cmcp_history_query_status'].includes(result.kind)||typeof result.requestId!=='string'
    ||!Number.isSafeInteger(maxProjectionBytes)||maxProjectionBytes<1)throw Error('invalid_answer_history_lookup_result');
  resolveCmcpTimeContext({now:'2000-01-01T00:00:00Z',timezone});
  const aggregate=result.aggregate,available=result.publication?.status==='verified'&&aggregate!==null&&aggregate!==undefined;
  if(available&&(aggregate.kind!=='cmcp_history_aggregate'||aggregate.purpose!=='evidence_lookup'
    ||!Array.isArray(aggregate.evidence)||!aggregate.coverage||!Number.isSafeInteger(aggregate.coverage.sourceCount)
    ||aggregate.coverage.sourceCount<0))throw Error('invalid_answer_history_lookup_aggregate');
  const scope={kind:'frozen_registered_authorized_event_sources',otherEvents:'not_checked',
    unregisteredHistory:'not_checked',allHistoryAbsence:'not_established'};
  let model={kind:'answer_history',status:'needs_source',reason:'The further bounded source check did not complete; historical absence is not established.',
    context:null,lookup:{status:result.status,reason:result.reason??null,scope}};
  if(available){
    const coverage=aggregate.coverage,seen=new Set(),evidence=aggregate.evidence.map(row=>{
      if(typeof row.ref!=='string'||seen.has(row.ref)||!['user','assistant','tool'].includes(row.sourceAuthorRole)
        ||row.citation?.unit!=='unicode_code_points'||!Number.isSafeInteger(row.citation.start)||row.citation.start<0
        ||!Number.isSafeInteger(row.citation.end)||row.citation.end<=row.citation.start||typeof row.citation.text!=='string'
        ||[...row.citation.text].length!==row.citation.end-row.citation.start)throw Error('invalid_answer_history_lookup_evidence');
      seen.add(row.ref);if(row.messageRecordedAt!==null)parseCmcpInstant(row.messageRecordedAt);
      if(row.eventOccurredAt!==undefined&&row.eventOccurredAt!==null)parseCmcpInstant(row.eventOccurredAt);
      if(row.contentKind!==undefined&&row.contentKind!==null&&!['source_excerpt','derived_summary'].includes(row.contentKind))throw Error('invalid_answer_history_lookup_content_kind');
      return {sourceRef:row.ref,sourceAuthorRole:row.sourceAuthorRole,messageRecordedAt:row.messageRecordedAt,
        localMessageRecordedAt:formatCmcpLocalInstant(row.messageRecordedAt,timezone),eventOccurredAt:row.eventOccurredAt??null,
        localEventOccurredAt:formatCmcpLocalInstant(row.eventOccurredAt??null,timezone),eventTimeStatus:row.eventOccurredAt===undefined?'not_recorded_in_legacy_receipt':row.eventOccurredAt===null?'unknown':'source_supplied',
        content:{kind:'exact_source_quote',sourceContentKind:row.contentKind??'unknown',text:row.citation.text},range:{unit:row.citation.unit,start:row.citation.start,end:row.citation.end},
        roleBoundary:'Assistant_text_is_not_a_User_decision_or_independently_verified_fact'};
    });
    const checked={...scope,status:aggregate.status,registeredSources:coverage.sourceCount,readSources:coverage.completedSources,
      unavailableSources:coverage.unavailableSources,unreadSources:coverage.unread?.length??null,
      unclassifiedSources:coverage.unclassified?.length??null,uncertainSources:coverage.uncertain?.length??null,
      ambiguousRevisionGroups:coverage.ambiguousRevisions?.length??null,completeWithinFrozenScope:aggregate.status==='complete_within_frozen_scope',
      sourceAvailability:coverage.partialSources?.length?'partial_or_unknown':'as_declared_by_sources',
      semanticVerification:'model_interpretation_after_exact_source_role_quote_checks'};
    model={kind:'answer_history',status:evidence.length?'read':'needs_source',
      reason:evidence.length?'Exact supporting quotations were found; use only the stated checked scope and preserve unresolved coverage.':
        aggregate.status==='complete_within_frozen_scope'?'No support was found within this completely checked registered event collection; other events and unregistered History were not checked.':
          'The bounded check found no confirmed support so far; unread, unavailable or uncertain sources remain. This does not establish absence from History.',
      context:{kind:'bounded_exact_history_lookup',finding:aggregate.finding,coverage:checked,evidence}};
  }
  const attemptedBytes=bytes(model);
  if(attemptedBytes>maxProjectionBytes){
    model={kind:'answer_history',status:'needs_source',reason:'The checked evidence exceeds this answer projection budget; no quotation was truncated or represented as absent.',
      context:null,lookup:{status:'projection_budget_exceeded',scope}};
    if(bytes(model)>maxProjectionBytes)throw Error('answer_history_lookup_projection_budget');
  }
  return {model,measurement:{attemptedBytes,projectedBytes:bytes(model),maxProjectionBytes,omittedWholeProjection:attemptedBytes>maxProjectionBytes}};
}

/** A purpose-specific answer view of an already verified lookup, not a new search
 * or semantic verdict. Derived event questions/dialogue are not read originals.
 * They remain in storage and their normal answer/edit routes are unchanged. */
export function projectCmcpEvidenceLookupAnswerInput(input){
  const history=input?.answerHistory,context=history?.context;
  const recognized=context?.kind==='bounded_exact_history_lookup'
    ||history?.lookup?.scope?.kind==='frozen_registered_authorized_event_sources';
  if(!recognized)return null;
  if(history.kind!=='answer_history'||!['read','needs_source'].includes(history.status)
    ||input.user?.sourceAuthorRole!=='user'||typeof input.user.text!=='string'||!input.user.text.trim())throw Error('invalid_evidence_lookup_answer_input');
  let disposition='check_unavailable';
  if(context){
    const c=context.coverage;
    if(!c||!Array.isArray(context.evidence)||!Number.isSafeInteger(c.registeredSources)||c.registeredSources<0
      ||!Number.isSafeInteger(c.readSources)||c.readSources<0||c.readSources>c.registeredSources
      ||context.evidence.some(row=>!['user','assistant','tool'].includes(row.sourceAuthorRole)
        ||row.content?.kind!=='exact_source_quote'||typeof row.content.text!=='string'||!row.content.text))throw Error('invalid_evidence_lookup_answer_coverage');
    const complete=c.completeWithinFrozenScope===true&&c.status==='complete_within_frozen_scope'
      &&c.readSources===c.registeredSources&&['unavailableSources','unreadSources','unclassifiedSources','uncertainSources','ambiguousRevisionGroups'].every(key=>c[key]===0);
    if(c.completeWithinFrozenScope===true&&!complete)throw Error('inconsistent_evidence_lookup_answer_coverage');
    disposition=context.evidence.length?'report_supplied_support':complete?'report_no_support_within_checked_scope':'report_incomplete_check';
  }
  const selected={answerTask:{kind:'bounded_history_evidence_answer',disposition,
    evidenceBoundary:'exact_lookup_sources_only',scopeBoundary:'registered_authorized_collection_not_entire_History'},
    user:structuredClone(input.user),answerHistory:structuredClone(history)};
  for(const key of ['interactionTime','exchangeTime','modelRequestTime','responsePreferences'])if(input[key]!==undefined)selected[key]=structuredClone(input[key]);
  return selected;
}

/** Thin composition of the existing catalog, exact History reader and Buffer publication. */
export function createCmcpAnswerHistory({stores,catalog,journal,localIndex=null,limits={},timezone,now,valid=async()=>true,lookupMissingHistory=null}){
  limits={...defaults,...limits};
  if(!stores?.history||typeof catalog?.list!=='function'||typeof journal?.read!=='function'||typeof journal?.append!=='function'
    ||typeof now!=='function'||typeof valid!=='function'||lookupMissingHistory!==null&&typeof lookupMissingHistory!=='function'||Object.keys(limits).some(name=>!Object.hasOwn(defaults,name))
    ||Object.values(limits).some(n=>!Number.isSafeInteger(n)||n<1)||limits.maxCandidates>6||limits.maxSelectedSources>CMCP_ANSWER_HISTORY_MAX_SELECTED_SOURCES)throw Error('invalid_answer_history_dependencies');
  const current=()=>resolveCmcpTimeContext({now:now(),timezone});
  const eventVersion=async event=>{const result=await stores.eventStore(event).readEvent({sourceUpdateIds:[]});if(!['found','missing'].includes(result.status))throw Error('answer_history_event_unavailable');return loopHash(result.internal?.records??[]);};
  const exact=async(entry)=>{const found=await resolveCmcpHistorySource({provider:stores.history,pointer:entry.pointer});
    if(found.status!=='found')throw Error('answer_history_source_unavailable');
    const evidence=found.evidence;if(evidence.pointer.scopeId!==stores.scopeId||loopHash(evidence)!==entry.evidenceHash
      ||evidence.sourceAuthorRole!==entry.sourceAuthorRole)throw Error('answer_history_source_changed');return evidence;};
  async function scopeRows(event,eventKey){
    const records=(await journal.read()).map(row=>row.record),associations=new Set(records.filter(row=>row.kind==='source_association'&&sameEvent(row.value.event,event)).map(row=>key(row.value.pointer)));
    const replies=records.filter(row=>row.kind==='assistant_reply_binding'&&row.value.eventKey===eventKey).map(row=>row.value);
    const entries=(await catalog.list()).filter(entry=>entry.pointer.scopeId===stores.scopeId&&['user','assistant'].includes(entry.sourceAuthorRole)
      &&(associations.has(key(entry.pointer))||sameEvent(entry.eventScope,event)||sameEvent(entry.eventLink?.event,event)||(entry.eventLinks??[]).some(link=>sameEvent(link.event,event))));
    return {entries,replies};
  }
  async function prepare({source,event,eventKey,bufferGeneration=0}){
    if(!await valid())throw Error('answer_history_disabled_or_cancelled');
    if(event?.scopeId!==stores.scopeId||source?.pointer?.scopeId!==stores.scopeId||source.sourceAuthorRole!=='user'||typeof eventKey!=='string')throw Error('answer_history_scope');
    if((await readCmcpBufferBoundary(stores)).generation!==bufferGeneration)throw Error('buffer_receipt_stale');
    const sourceHash=loopHash(source),query=await exact({pointer:source.pointer,evidenceHash:sourceHash,sourceAuthorRole:'user'});
    const {entries,replies}=await scopeRows(event,eventKey),entryByKey=new Map(entries.map(entry=>[key(entry.pointer),entry]));
    const available=entries.filter(entry=>key(entry.pointer)!==key(source.pointer)&&
      (entry.sourceAuthorRole!=='assistant'||replies.some(reply=>key(reply.pointer)===key(entry.pointer)&&reply.sourceHash===entry.evidenceHash)));
    const allowedIds=new Set(available.map(entry=>entry.id)),offered=[],byId=new Map(available.map(entry=>[entry.id,entry])),lexical=new Map(),candidateGroups=[];
    let locatorIO={historyResolves:0,sourceBytesMaterialized:0,basis:'persisted_catalog_metadata_only'};
    const add=entry=>{if(entry&&allowedIds.has(entry.id)&&!offered.some(row=>row.id===entry.id)&&offered.length<limits.maxCandidates)offered.push(entry);};
    const linked=replies.filter(reply=>{const assistant=entryByKey.get(key(reply.pointer)),parent=entryByKey.get(key(reply.replyTo));
      return assistant&&parent&&allowedIds.has(assistant.id)&&allowedIds.has(parent.id)&&assistant.sourceAuthorRole==='assistant'&&parent.sourceAuthorRole==='user'
        &&assistant.evidenceHash===reply.sourceHash&&parent.evidenceHash===reply.replyToEvidenceHash;});
    // One observed reply edge, not adjacency, lexical identity or a whole thread.
    // The lexical anchor keeps its rank; its formally bound counterpart shares
    // candidate capacity before the next anchor consumes another independent slot.
    const addGroup=(entry,basis)=>{if(!entry||!allowedIds.has(entry.id))return;
      const members=[entry];for(const reply of linked){if(key(entry.pointer)===key(reply.pointer))members.push(entryByKey.get(key(reply.replyTo)));
        else if(key(entry.pointer)===key(reply.replyTo))members.push(entryByKey.get(key(reply.pointer)));}
      const unique=[...new Map(members.map(row=>[row.id,row])).values()];for(const member of unique)add(member);
      candidateGroups.push({basis,anchorId:entry.id,memberIds:unique.map(row=>row.id),offeredIds:unique.filter(row=>offered.some(item=>item.id===row.id)).map(row=>row.id)});
    };
    // A recent formally bound reply is a locator candidate, never an automatic selection.
    // Reserve room for lexical hits before filling remaining relationship candidates.
    const inSession=linked.filter(reply=>reply.pointer.sessionId===query.pointer.sessionId),recent=(inSession.length?inSession:linked).at(-1);
    if(recent)addGroup(entryByKey.get(key(recent.pointer)),'recent_formal_reply_locator');
    if(localIndex&&available.length){
      const found=await localIndex.search({text:query.content.body,enabled:true,clean:false,allowedSourceIds:[...allowedIds]});
      locatorIO={historyResolves:found.diagnostics?.historyResolves??null,sourceBytesMaterialized:found.diagnostics?.sourceBytesMaterialized??null,
        basis:'existing_bounded_lexical_locator_search_not_formal_read'};
      for(const mapping of found.sourceMap??[])lexical.set(mapping.id,found.candidates.find(item=>item.ref===mapping.ref)?.excerpt);
      for(const mapping of found.sourceMap??[])addGroup(byId.get(mapping.id),'lexical_anchor_with_formal_reply');
    }
    for(const reply of [...linked].reverse())addGroup(entryByKey.get(key(reply.pointer)),'remaining_formal_reply_locator');
    for(const entry of [...available].reverse())add(entry);
    // Formal reply candidates can be outside lexical top-k. Give those already
    // offered IDs the same bounded locator window, not just the stored prefix.
    // Index positions locate it; immutable History supplies the literal text.
    if(typeof localIndex?.locateSources==='function'){
      const ids=offered.filter(entry=>!lexical.has(entry.id)&&entry.sourceHint?.complete!==true).map(entry=>entry.id);
      if(ids.length){
        if(!await valid())throw Error('answer_history_disabled_or_cancelled');
        const located=await localIndex.locateSources({text:query.content.body,sourceIds:ids,maxSources:limits.maxCandidates,
          maxSourceBytes:Math.min(limits.maxSourceBytes,localIndex.limits.maxIndexSourceBytes),maxExcerptCodePoints:localIndex.limits.maxExcerptCodePoints,enabled:true,clean:false});
        for(const item of located.locators)lexical.set(item.id,item.excerpt);
        locatorIO={...locatorIO,historyResolves:(locatorIO.historyResolves??0)+located.diagnostics.historyResolves,
          sourceBytesMaterialized:(locatorIO.sourceBytesMaterialized??0)+located.diagnostics.sourceBytesMaterialized,supplemental:located.diagnostics,
          basis:'bounded_lexical_search_and_offered_source_locators_not_formal_read'};
      }
    }
    const mapping=[],candidates=[],unavailable=[];
    for(const entry of offered){
      if(!await valid())throw Error('answer_history_disabled_or_cancelled');
      const binding=entry.sourceAuthorRole==='assistant'?replies.find(reply=>key(reply.pointer)===key(entry.pointer)&&reply.sourceHash===entry.evidenceHash):null;
      if(binding){const parent=entryByKey.get(key(binding.replyTo));if(!parent||parent.sourceAuthorRole!=='user'||parent.evidenceHash!==binding.replyToEvidenceHash){unavailable.push({pointer:entry.pointer,code:'answer_history_reply_binding_invalid'});continue;}
      }
      const ref='h'+(mapping.length+1),match=lexical.get(entry.id),hint=match??entry.sourceHint;
      const candidate={ref,sourceAuthorRole:entry.sourceAuthorRole,contentKind:hint?.kind??'unknown',
        messageTime:formatCmcpLocalInstant(entry.messageRecordedAt,timezone),eventOccurredAt:entry.eventOccurredAt,
        sameSession:entry.pointer.sessionId===query.pointer.sessionId,sourceHint:{text:hint?.text??'',complete:hint?.complete===true},
        ...(binding?{replyToUserHint:[...(entryByKey.get(key(binding.replyTo)).sourceHint?.text??'')].slice(0,80).join('')}:{})};
      mapping.push({ref,entry:copy(entry),replyBinding:copy(binding)});candidates.push(candidate);
    }
    for(const item of mapping){if(!item.replyBinding)continue;const parent=mapping.find(row=>key(row.entry.pointer)===key(item.replyBinding.replyTo));
      if(parent)candidates.find(row=>row.ref===item.ref).replyToRef=parent.ref;}
    const model={version:1,timezone,timeBasis:'messageTime is recording time with explicit offset, not event occurrence',candidates,maxSelectedSources:limits.maxSelectedSources,coverage:{kind:'bounded_authorized_event_locators',
      registeredSources:available.length,offeredSources:candidates.length,omittedSources:available.length-candidates.length,
      unreadRemainders:'not_assessed',locatorVerification:'catalog_metadata_not_current_exact_read',selectionIsNotAnswerSufficiency:true}};
    const locatorAllocation=fitLocatorCatalog(model,query.content.body,limits.maxCatalogBytes);buildCmcpAnswerHistoryBinding(model);
    if(!await valid()||(await readCmcpBufferBoundary(stores)).generation!==bufferGeneration)throw Error('answer_history_cancelled_or_cleared');
    return {model,internal:{version:1,event:copy(event),eventKey,queryPointer:copy(source.pointer),queryHash:sourceHash,
      queryTime:source.messageRecordedAt,bufferGeneration,mapping,unavailable,locatorIO,locatorAllocation,candidateGroups,limits:copy(limits),catalogHash:loopHash(model),catalogBytes:bytes(model)}};
  }
  async function read({prepared,plan,query,temporal,activeAt=query?.messageRecordedAt,recovery=false,bufferGeneration,
    bufferTtlMs,ttlMs,eventVersion:expectedEventVersion,valid:operationValid=async()=>true,activateBuffer=true}){
    plan=validateCmcpAnswerHistoryPlan(plan,prepared);
    if(plan.need?.basis!=='recorded_fact_lookup'&&plan.refs.length>limits.maxSelectedSources)throw Error('answer_history_selection_limit');
    const basis=prepared.internal;if(!basis||basis.catalogHash!==loopHash(prepared.model)||!query||key(query.pointer)!==key(basis.queryPointer)
      ||loopHash(query)!==basis.queryHash||query.sourceAuthorRole!=='user'||activeAt!==query.messageRecordedAt||bufferGeneration!==basis.bufferGeneration)throw Error('answer_history_query_binding');
    const requestNeed=validateCmcpAnswerHistoryNeed(plan,query.content.body);
    temporal=resolveCmcpTimeContext(temporal);if(temporal.timezone!==timezone||activeAt===null)throw Error('answer_history_time_binding');
    const selected=plan.refs.map(ref=>basis.mapping.find(row=>row.ref===ref));
    if(selected.some(row=>!row))throw Error('answer_history_reference_out_of_scope');
    let lookupVerify=null;
    const version=expectedEventVersion??await eventVersion(basis.event),currentValid=async(skipLookup=false)=>{
      if(!await valid()||!await operationValid()||(await readCmcpBufferBoundary(stores)).generation!==bufferGeneration)return false;
      if(await eventVersion(basis.event)!==version)return false;
      try{await exact({pointer:query.pointer,evidenceHash:basis.queryHash,sourceAuthorRole:'user'});
        const scoped=await scopeRows(basis.event,basis.eventKey);
        for(const item of selected){const entry=scoped.entries.find(row=>key(row.pointer)===key(item.entry.pointer));
          if(!entry||entry.evidenceHash!==item.entry.evidenceHash||entry.sourceAuthorRole!==item.entry.sourceAuthorRole)return false;
          await exact(item.entry);
          if(item.replyBinding){const same=scoped.replies.find(row=>key(row.pointer)===key(item.entry.pointer));if(!same||loopHash(same)!==loopHash(item.replyBinding))return false;
            await exact({pointer:same.replyTo,evidenceHash:same.replyToEvidenceHash,sourceAuthorRole:'user'});}
        }return !skipLookup&&lookupVerify?await lookupVerify()===true:true;
      }catch{return false;}
    };
    if(!await currentValid())throw Error('answer_history_cancelled_or_source_changed');
    const receipt={version:1,queryPointer:copy(query.pointer),queryHash:basis.queryHash,event:basis.event,eventVersion:version,bufferGeneration,
      catalogHash:basis.catalogHash,plan:copy(plan),selected:plan.refs,sourceMap:{},readRanges:[],sourceBytes:0,projectionBytes:0,
      locatorIO:copy(basis.locatorIO),...(requestNeed?{requestNeed}:{}),activeAt,activation:'none',recovery,at:current().now};
    // Selection reasons are unverified model interpretations, not read evidence.
    // Keep the complete raw plan in the receipt; the model-facing reason records
    // only this Runtime disposition, never an inferred author/version/history fact.
    const dispositionReason=plan.status==='needs_source'
      ?'The model requested another source; no prior source was selected. Absence of History is not established.'
      :plan.status==='needs_clarification'
        ?'The model requested clarification; no prior source was selected. This is not a verified claim about History.'
        :'';
    const factLookup=plan.need?.basis==='recorded_fact_lookup'&&plan.status!=='needs_clarification';
    let model={kind:'answer_history',status:factLookup?'needs_source':plan.status,
      reason:factLookup?'A recorded fact requires source checking; selected previous questions or answers do not establish that fact or its absence.':dispositionReason,context:null};
    if((plan.status==='needs_source'||factLookup)&&lookupMissingHistory){
      // The bounded locator result is a request for further evidence, not a
      // declaration that History is absent. Reuse the formal frozen reader and
      // aggregate journal through the caller's same work/grant and User source.
      // The original model plan stays immutable in the receipt.
      const lookup=await lookupMissingHistory({query:copy(query),event:copy(basis.event),eventKey:basis.eventKey,
        temporal:copy(temporal),bufferGeneration,eventVersion:version,recovery,activeAt,valid:()=>currentValid(true)});
      if(!lookup||typeof lookup.verify!=='function')throw Error('answer_history_lookup_verifier_required');
      const projected=projectCmcpAnswerHistoryLookup({result:lookup.result,timezone,maxProjectionBytes:limits.maxProjectionBytes});
      if(!await currentValid()||await lookup.verify()!==true)throw Error('answer_history_lookup_cancelled_or_source_changed');
      lookupVerify=lookup.verify;model=projected.model;
      Object.assign(receipt,{lookup:copy(lookup.result),lookupProjection:projected.measurement,
        readStatus:model.status==='read'?'bounded_lookup_found':'bounded_lookup_incomplete_or_insufficient',
        sourceBytes:lookup.result.aggregate?.coverage?.cumulative?.sourceBytes??0,projectionBytes:bytes(model),
        activation:lookup.result.activation??'none',lookupPurpose:'event_registered_inventory_evidence_lookup_not_all_history',
        ...(factLookup?{lookupTrigger:'explicit_recorded_fact_lookup',locatorRefsNotProof:copy(plan.refs)}:{})});
    }
    if(plan.status==='selected'&&!factLookup){
      // The answer already carries the complete selected-event compact. Reuse the
      // shared exact source projection without duplicating that derived progress;
      // membership and the full Event version remain checked by currentValid.
      const selectedEntries=selected.map((item,index)=>({...item.entry,eventLink:null,projectionRef:'r'+(index+1)}));
      const readResult=await readCmcpSelectedHistory({stores,selected:selectedEntries,temporal,activeAt,contextOnly:true,valid:currentValid,
        limits:{maxSourceBytes:limits.maxReadBytes,maxProjectionBytes:limits.maxProjectionBytes,maxMaterializedSourceBytes:limits.maxSourceBytes}});
      if(readResult.status!=='found'){model={kind:'answer_history',status:'needs_source',reason:readResult.reason??'source_unavailable',context:null};receipt.readStatus=readResult.status;}
      else{
        model={kind:'answer_history',status:'read',reason:'',context:readResult.projected,
          coverage:{kind:'selected_originals_not_exhaustive_fact_check',registeredSources:prepared.model.coverage.registeredSources,
            offeredLocators:prepared.model.coverage.offeredSources,readSources:selected.length,
            unselectedSources:prepared.model.coverage.registeredSources-selected.length,
            absenceFromHistory:'not_established',sourceRolesDoNotConvert:'Assistant_text_is_not_User_confirmation'}};
        Object.assign(receipt,{readStatus:'found',sourceMap:readResult.sourceMap,readRanges:readResult.readRanges,sourceBytes:readResult.sourceBytes,
          materializedSourceBytes:readResult.materializedSourceBytes,projectionBytes:bytes(model),contextProjectionBytes:readResult.projectionBytes});
        // Same context limit as the shared reader. The Runtime wrapper remains
        // measured above and subject to the full wire cap.
        if(bytes(model.context)>limits.maxProjectionBytes)throw Error('answer_history_projection_budget');
        if(!recovery&&activateBuffer){
          const activated=await activateCmcpHistorySources({stores,selected:selected.map(item=>item.entry),query,activeAt,read:readResult,valid:currentValid,
            bufferGeneration,ttlMs,bufferTtlMs,timeContext:temporal});
          receipt.activation='purposeful_current_user_read';receipt.bufferBefore=activated.before.buffer;receipt.bufferAfter=activated.after.buffer;
        }
      }
    }
    if(!await currentValid())throw Error('answer_history_cancelled_or_source_changed');
    await journal.append('answer_history_read',receipt);
    return {model,receipt,verify:currentValid};
  }
  return Object.freeze({prepare,read,limits:copy(limits)});
}
