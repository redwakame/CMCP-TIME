import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createCmcpRuntimeSession,loadCmcpRuntimeConfig} from '../src/cmcp-guard/cmcp-runtime-session.js';
import {createLocalLoopJournal,loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {createCmcpReactivationStores} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {resolveCmcpHistorySource} from '../src/cmcp-guard/cmcp-history-provider.js';
import {cmcpSourcePointerKey} from '../src/cmcp-guard/cmcp-source-pointer.js';
import {cmcpProjectRoot,resolveCmcpWorkspaceRoot} from '../src/cmcp-guard/cmcp-project-paths.js';
import {readCmcpBufferBoundary} from '../src/cmcp-guard/cmcp-buffer-lifecycle.js';
import {inspectCmcpReadingProgress} from '../src/cmcp-guard/cmcp-reading.js';

const MAX_SOURCE_CHECKS=8;
const MAX_MANIFEST_DISPLAY=16;
const copy=value=>value===undefined?undefined:structuredClone(value);
const controlsAllowHistory=controls=>controls?.enabled===true&&controls.clean===false&&controls.historyRecall===true;
const controlsAllowBodies=controls=>controlsAllowHistory(controls)&&controls.saveUser===true&&controls.saveAssistant===true;

function boundedSources(work,receipt,historyQueryRows=[]){
  const sources=[];
  const add=(ref,pointer,evidenceHash)=>{if(pointer&&typeof pointer==='object')sources.push({ref,pointer,evidenceHash:evidenceHash??null});};
  add('work_source',work?.source?.pointer,work?.source?.evidenceHash);
  add('query',work?.queryBinding?.queryPointer,work?.queryBinding?.queryHash);
  const opened=historyQueryRows.find(row=>row.stage==='opened')?.reading;
  const lookupSources=opened?.internal?.manifest?.sources??[],referenced=new Set(receipt?.result?.lookupReceipt?.referencedEvidence??[]);
  for(const row of lookupSources.filter(row=>referenced.has(row.ref)))add('history_query:'+row.ref,row.pointer,row.evidenceHash);
  for(const row of lookupSources.filter(row=>!referenced.has(row.ref)))add('history_query:'+row.ref,row.pointer,row.evidenceHash);
  const result=receipt?.result;
  add('result',result?.pointer);
  add('query',result?.queryPointer??result?.internal?.queryPointer,result?.internal?.queryHash);
  add('assistant',result?.answerPointer??result?.internal?.answerPointer);
  for(const row of result?.internal?.readRanges??[])add('read_range',row.pointer,row.evidenceHash);
  const map=result?.internal?.sourceMap;
  if(Array.isArray(map))for(const row of map)add(row.ref,row.pointer,row.evidenceHash);
  else if(map&&typeof map==='object')for(const [ref,row] of Object.entries(map))add(ref,row?.pointer??row,row?.evidenceHash);
  for(const row of result?.internal?.manifest?.sources??[])add(row.ref,row.pointer,row.evidenceHash);
  for(const row of result?.internal?.reading?.internal?.manifest?.sources??[])add(row.ref,row.pointer,row.evidenceHash);
  const unique=new Map();
  for(const row of sources){let key;try{key=cmcpSourcePointerKey(row.pointer);}catch{continue;}
    if(!unique.has(key))unique.set(key,row);
    else if(!unique.get(key).evidenceHash&&row.evidenceHash)unique.set(key,row);
  }
  return [...unique.values()];
}

export function summarizeCmcpRecordedRequest(body){
  if(typeof body!=='string')return {status:'not_retained'};
  try{
    const wire=JSON.parse(body),messages=wire.input??wire.messages;
    const content=Array.isArray(messages)?messages.find(row=>row.role==='user')?.content:null;
    const input=typeof content==='string'?JSON.parse(content):null;
    if(!input||typeof input!=='object'||Array.isArray(input))return {status:'unrecognized_wire_input'};
    const lookup=[input.answerHistory,input.context].find(row=>row?.kind==='answer_history');
    const exact=lookup?.context?.kind==='bounded_exact_history_lookup'?lookup.context:null;
    return {status:'recorded',inputKeys:Object.keys(input),materialBytes:Object.fromEntries(Object.entries(input)
      .map(([key,value])=>[key,Buffer.byteLength(JSON.stringify(value))])),
      exchangeTime:copy(input.exchangeTime??null),modelRequestTime:copy(input.modelRequestTime??null),
      lookupEvidence:{status:exact?'recorded':'not_in_recorded_input',aliases:exact?.evidence?.map(row=>row.sourceRef)??[],
        coverage:exact?.coverage?{status:exact.coverage.status??null,registeredSources:exact.coverage.registeredSources??null,
          readSources:exact.coverage.readSources??null,completeWithinFrozenScope:exact.coverage.completeWithinFrozenScope===true}:null},
      aggregateSourceRefs:input.kind==='cmcp_history_aggregate_batch'&&Array.isArray(input.sources)?input.sources.map(row=>row.ref):[]};
  }catch{return {status:'unparseable_recorded_wire'};}
}

export function summarizeCmcpAttempt(start,result,{showBodies=false,allowBodyInspection=false}={}){
  if(!start||!Number.isSafeInteger(start.attempt))throw Error('invalid_trace_attempt');
  const matched=result?.attempt===start.attempt&&result?.purpose===start.purpose
    &&(!result.workContext?.workId||result.workContext.workId===start.workContext?.workId);
  if(result&&!matched)throw Error('trace_attempt_result_binding_mismatch');
  const fetched=result?.fetchStarted===true;
  const bodyRetained=start.bodyRetention!=='disabled_by_source_control'&&typeof start.requestBody==='string';
  const responseRetained=result?.bodyRetention!=='disabled_by_source_control'&&typeof result?.responseBody==='string';
  const summary={attempt:start.attempt,purpose:start.purpose,logicalId:start.workContext?.logicalId??null,
    startedAt:start.startedAt,endedAt:result?.endedAt??null,requestBytes:start.requestBytes??null,
    requestSha256:start.requestSha256??null,requestByteLimit:start.requestByteLimit??null,
    endpoint:start.endpoint??null,requestBodyState:bodyRetained?'retained':'not_retained',
    transport:{status:result?.status??'in_progress',fetchStarted:result?.fetchStarted??null,
      responseComplete:result?.responseComplete??null,remoteOutcome:result?.remoteOutcome??'unknown',
      http:result?.http??null},responseSha256:result?.responseSha256??null,
    responseBodyState:responseRetained?'retained':'not_retained',usage:copy(result?.usage??null),
    actualInputEvidence:fetched?(result?.responseComplete===true?'fetch_started_complete_response':'fetch_started_remote_outcome_unconfirmed'):
      result?'not_submitted_to_fetch':'fetch_status_unknown'};
  if(allowBodyInspection&&bodyRetained)summary.modelInput=summarizeCmcpRecordedRequest(start.requestBody);
  else summary.modelInput={status:allowBodyInspection?'not_retained':'restricted_to_metadata'};
  if(showBodies){
    if(!allowBodyInspection)throw Error('trace_body_access_disabled_by_current_controls');
    summary.requestBody=bodyRetained?start.requestBody:null;
    summary.responseBody=responseRetained?result.responseBody:null;
    summary.outputText=typeof result?.outputText==='string'?result.outputText:null;
    summary.responseHashBasis=result?.responseHashBasis??null;
  }
  return summary;
}

/** Project one exact existing history-query request, never infer a scope from nearby work. */
export function projectCmcpHistoryQueryEvidence({lookupReceipt,rows=[],sourceChecks=[],attempts=[],scopeId}){
  const requestId=lookupReceipt?.requestId;
  if(typeof requestId!=='string'||!requestId||requestId.length>256)throw Error('trace_history_query_request_id_invalid');
  if(rows.some(row=>row.scopeId!==scopeId||row.requestId!==requestId))throw Error('trace_history_query_scope_mismatch');
  const stages=Object.fromEntries([...new Set(rows.map(row=>row.stage))].map(stage=>[stage,rows.filter(row=>row.stage===stage).length]));
  const base={requestId,lookupReceiptStatus:lookupReceipt.status??null,journalStages:stages};
  if(!rows.length)return {...base,status:'no_exact_request_journal_rows',scopeCompleteness:'unknown'};
  const started=rows.filter(row=>row.stage==='started'),openings=rows.filter(row=>row.stage==='opened');
  if(started.length!==1||openings.length>1)throw Error('trace_history_query_stage_conflict');
  if(!openings.length)return {...base,status:'not_opened',scopeCompleteness:'unknown'};
  const reading=openings[0].reading,manifest=reading?.internal?.manifest,manifestHash=reading?.internal?.manifestHash;
  if(!manifest||manifest.kind!=='cmcp_reading_manifest'||manifest.scopeId!==scopeId||manifest.ticket!==requestId
    ||loopHash(manifest)!==manifestHash||reading.reader?.manifestHash!==manifestHash
    ||lookupReceipt.readingTicket!==requestId||lookupReceipt.queryHash!==manifest.queryHash
    ||cmcpSourcePointerKey(lookupReceipt.queryPointer)!==cmcpSourcePointerKey(manifest.queryPointer))
    throw Error('trace_history_query_manifest_binding_mismatch');
  const allSources=manifest.sources??[];
  if(!Array.isArray(allSources)||new Set(allSources.map(source=>source.ref)).size!==allSources.length
    ||allSources.some(source=>source.pointer?.scopeId!==scopeId||typeof source.evidenceHash!=='string'))
    throw Error('trace_history_query_manifest_sources_invalid');
  const references=lookupReceipt.referencedEvidence??[];
  if(!Array.isArray(references)||references.some(ref=>!allSources.some(source=>source.ref===ref)))
    throw Error('trace_history_query_reference_out_of_scope');
  const pages=rows.filter(row=>row.stage==='page').map(row=>row.page);
  const progress=inspectCmcpReadingProgress({reading,previousPages:pages,scopeId}),coverage=progress.coverage;
  const accepted=rows.filter(row=>row.stage==='batch_accepted').map(row=>row.classification);
  const classified=[];
  for(const batch of accepted){
    if(batch?.manifestHash!==manifestHash||typeof batch.resultHash!=='string'||!Array.isArray(batch.rows))
      throw Error('trace_history_query_classification_binding_mismatch');
    const {resultHash,...basis}=batch;
    if(loopHash(basis)!==resultHash)throw Error('trace_history_query_classification_hash_mismatch');
    for(const row of batch.rows){
      const source=allSources.find(item=>item.ref===row.ref);
      if(!source||source.sourceAuthorRole!==row.sourceAuthorRole||source.evidenceHash!==row.evidenceHash)
        throw Error('trace_history_query_classified_source_mismatch');
      classified.push({ref:row.ref,role:row.sourceAuthorRole,kind:row.kind,
        evidenceStatus:row.evidenceStatus??null,claimMatch:row.claimMatch??null,
        citedRange:row.citation?{unit:row.citation.unit,start:row.citation.start,end:row.citation.end}:null});
    }
  }
  const checks=new Map(sourceChecks.map(row=>[cmcpSourcePointerKey(row.pointer),row]));
  const selected=new Set(references),prioritized=[...allSources.filter(row=>selected.has(row.ref)),...allSources.filter(row=>!selected.has(row.ref))];
  const visible=prioritized.slice(0,MAX_MANIFEST_DISPLAY).map(source=>{
    const check=checks.get(cmcpSourcePointerKey(source.pointer));
    return {ref:source.ref,pointer:source.pointer,role:source.sourceAuthorRole,
      messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt,
      evidenceHash:source.evidenceHash,currentHistory:check?{status:check.historyStatus,
        hashMatchesFrozen:check.actualEvidenceHash===source.evidenceHash,
        roleMatchesFrozen:check.role===source.sourceAuthorRole,
        recordedTimeMatchesFrozen:check.messageRecordedAt===source.messageRecordedAt,
        catalog:check.registered}: {status:'not_checked_eight_source_limit'}};
  });
  const checkedCount=allSources.filter(source=>checks.has(cmcpSourcePointerKey(source.pointer))).length;
  const terminals=rows.filter(row=>['completed','checkpoint'].includes(row.stage)),terminal=terminals.at(-1)??null;
  const answerInputs=attempts.filter(row=>['answer','recall_answer'].includes(row.purpose)).map(row=>({
    attempt:row.attempt,purpose:row.purpose,recordedRequestStatus:row.modelInput?.status??'unknown',
    lookupEvidence:row.modelInput?.lookupEvidence??{status:'unknown',aliases:[]},
    fetchStarted:row.transport.fetchStarted,responseComplete:row.transport.responseComplete,
    transportStatus:row.transport.status}));
  const lastAnswer=answerInputs.at(-1),expected=[...new Set(references)].sort(),actual=lastAnswer?.lookupEvidence?.aliases;
  const aliasMatch=lastAnswer?.recordedRequestStatus==='recorded'&&lastAnswer.lookupEvidence.status==='recorded'
    &&lastAnswer.fetchStarted===true&&lastAnswer.responseComplete===true&&Array.isArray(actual)
    ?JSON.stringify([...new Set(actual)].sort())===JSON.stringify(expected)?'exact_alias_set_in_completed_transport':'alias_set_mismatch'
    :'not_established_from_retained_final_request';
  return {...base,status:'frozen_manifest_and_page_chain_verified',purpose:started[0].purpose,
    frozen:{manifestHash,scopeKind:manifest.scopeDescriptor?.kind??null,
      queryTime:copy(manifest.queryTime??null),openedAt:manifest.openedAt??null,timezone:manifest.timezone??null,
      sourceCount:allSources.length,
      displayedSources:visible.length,undisplayedSources:allSources.length-visible.length,
      checkedCurrentSources:checkedCount,uncheckedCurrentSources:allSources.length-checkedCount,sources:visible},
    reading:{status:reading.reader.status,pages:pages.map(page=>({pageNumber:page.reader?.pageNumber??null,
      ref:page.reader?.source?.ref??null,status:page.reader?.status??null,range:copy(page.reader?.range??null),
      sourceAvailability:page.reader?.sourceAvailability??null,textBytes:typeof page.reader?.text==='string'?Buffer.byteLength(page.reader.text):null})),
      coverage:{complete:coverage.complete,exhausted:coverage.exhausted,sourceCount:coverage.sourceCount,
        completedRefs:copy(coverage.completedRefs),unread:copy(coverage.unread),
        unavailable:copy(coverage.unavailable),cumulative:copy(coverage.cumulative),
        associationCompleteness:coverage.associationCompleteness}},
    classification:{acceptedBatches:accepted.length,rows:classified,
      interpretationBoundary:'model_classification_with_exact_source_quote_binding_not_independent_truth'},
    terminal:terminal?{stage:terminal.stage,status:terminal.status??terminal.result?.status??null,
      aggregateStatus:terminal.result?.aggregate?.status??null,
      publicationStatus:terminal.result?.publication?.status??null,
      receiptStatusMatches:terminal.result?.status===lookupReceipt.status}:null,
    referencedEvidenceAliases:copy(references),finalAnswerInputs:answerInputs,finalAnswerAliasMatch:aliasMatch,
    completeness:'reading_coverage_and_aggregate_status_are_separate'};
}

export function projectCmcpEvidenceTrace({status,work,receipt,attemptRows=[],historyQueryRows=[],sourceChecks=[],
  scopeId=null,showBodies=false,attemptNumber=null}){
  if(!work||typeof work.workId!=='string')throw Error('trace_work_not_found');
  if(work.binding!==status.binding)throw Error('trace_work_binding_mismatch');
  const staleAfterClear=work.bufferDependent===true&&(!Number.isSafeInteger(status.bufferGeneration)
    ||work.bufferGeneration!==status.bufferGeneration);
  const enabled=controlsAllowHistory(status.controls)&&!staleAfterClear,
    bodyAccess=controlsAllowBodies(status.controls)&&!staleAfterClear;
  if(showBodies&&!bodyAccess)throw Error('trace_body_access_disabled_by_current_controls');
  const starts=attemptRows.filter(row=>row.kind==='started'&&row.value?.workContext?.workId===work.workId
    &&row.value.freezeId==='runtime:'+status.authorizationBinding).map(row=>row.value).sort((a,b)=>a.attempt-b.attempt);
  const unboundLedgerStarts=attemptRows.filter(row=>row.kind==='started'&&row.value?.freezeId==='runtime:'+status.authorizationBinding
    &&typeof row.value?.workContext?.workId!=='string').length;
  if(starts.some((row,index)=>starts.findIndex(item=>item.attempt===row.attempt)!==index))throw Error('trace_duplicate_attempt');
  if(attemptNumber!==null&&!starts.some(row=>row.attempt===attemptNumber))throw Error('trace_attempt_not_bound_to_work');
  const results=attemptRows.filter(row=>row.kind==='result').map(row=>row.value);
  const discarded=attemptRows.filter(row=>row.kind==='result_discarded').map(row=>row.value);
  const attempts=starts.filter(start=>attemptNumber===null||start.attempt===attemptNumber).map(start=>{
    const matches=results.filter(row=>row.attempt===start.attempt&&row.purpose===start.purpose);
    if(matches.length>1)throw Error('trace_duplicate_attempt_result');
    const output=summarizeCmcpAttempt(start,matches[0]??null,{showBodies,allowBodyInspection:bodyAccess});
    const postResult=discarded.filter(row=>row.attempt===start.attempt&&row.purpose===start.purpose);
    if(postResult.length>1)throw Error('trace_duplicate_discard_record');
    output.applicability=postResult.length?{status:'discarded_after_transport',code:postResult[0].code??null}:
      {status:matches.length?'no_discard_record':'unknown_without_terminal_result'};
    return output;
  });
  // An explicit --attempt narrows displayed bodies, not the metadata check of the final work-bound answer.
  const queryAttemptSummaries=attemptNumber===null?attempts:starts.map(start=>{
    const matches=results.filter(row=>row.attempt===start.attempt&&row.purpose===start.purpose);
    if(matches.length>1)throw Error('trace_duplicate_attempt_result');
    return summarizeCmcpAttempt(start,matches[0]??null,{allowBodyInspection:bodyAccess});
  });
  const mode=work.mode,output={kind:'cmcp_evidence_trace',workId:work.workId,mode,state:work.state,
    sessionId:work.sessionId??null,startedAt:work.at??null,endedAt:work.terminal?.at??null,
    sourceProcessing:work.sourceProcessing??null,remoteOutcome:work.terminal?.remoteOutcome??'unknown',
    controls:{enabled:status.controls.enabled,clean:status.controls.clean,historyRecall:status.controls.historyRecall,
      saveUser:status.controls.saveUser,saveAssistant:status.controls.saveAssistant},
    workAccess:staleAfterClear?'stale_after_buffer_clear':enabled?'current_controls_allow_exact_check':'restricted_by_current_controls',
    registration:{inventoryStatus:status.registration.inventoryStatus,
      inventoryComplete:status.registration.inventoryComplete,registered:status.registration.registered,
      unregisteredCount:status.registration.unregistered.length},
    linkedWork:{candidateTicket:work.readTicket??receipt?.value?.ticket??null,
      readingTicket:work.readingTicket??receipt?.value?.readingTicket??null},
    receipt:receipt?{status:'verified',sha256:receipt.sha256,mode:receipt.value.mode,at:receipt.value.at,
      resultStatus:receipt.value.result?.status??receipt.value.result?.host?.retrieval?.status??receipt.value.result?.reader?.status??null}:
      {status:work.state==='completed'?'missing_or_unavailable':'no_completed_receipt'},
    attempts,attemptCoverage:starts.length===0?'no_exact_work_bound_attempts_in_default_ledger':'exact_work_id_only',
    unattributedLedgerStarts:{count:unboundLedgerStarts,relationToThisWork:'unknown_do_not_infer_from_time'},
    sources:enabled?sourceChecks:[],sourceInspection:enabled?{status:'bounded_exact_check',checked:sourceChecks.length,
      referencedPointerCount:boundedSources(work,receipt?.value,historyQueryRows).length,maxChecks:MAX_SOURCE_CHECKS}:
      {status:staleAfterClear?'stale_after_buffer_clear':'disabled_by_current_controls',checked:0},attemptsStarted:attempts.length,
    fetchStartedCount:attempts.filter(row=>row.transport.fetchStarted===true).length,
    providerWork:(status.providerWork??[]).filter(row=>row.workId===work.workId).map(row=>({logicalId:row.logicalId,
      purpose:row.purpose,status:row.status,code:row.code??null,remoteOutcome:row.remoteOutcome??'unknown',
      attempt:row.attempt??null,transportStatus:row.transportStatus??null,startedAt:row.startedAt??null,endedAt:row.endedAt??null}))};
  if(receipt&&enabled){
    const value=receipt.value.result;
    if(value?.lookupReceipt?.requestId)output.historyQuery=projectCmcpHistoryQueryEvidence({
      lookupReceipt:value.lookupReceipt,rows:historyQueryRows,sourceChecks,attempts:queryAttemptSummaries,scopeId});
    if(mode==='local_candidates')output.candidates={status:value?.host?.status??null,
      refs:(value?.host?.candidates??[]).map(row=>row.ref),coverage:value?.host?.coverage??null,
      diagnostics:copy(value?.internal?.diagnostics??null)};
    if(['local_read','local_answer','local_recall'].includes(mode))output.read={selectedRefs:copy(receipt.value.selectedRefs??value?.internal?.selected??[]),
      status:value?.host?.retrieval?.status??null,readRanges:copy(value?.internal?.readRanges??[]),
      cumulative:copy(value?.internal?.cumulative??value?.host?.retrieval?.cumulative??null),
      contextBytes:value?.host?.retrieval?.projectionBytes??null,answerPointer:copy(value?.internal?.answerPointer??null)};
    if(mode==='local_reading_open')output.reading={status:value?.reader?.status??null,mode:value?.reader?.mode??null,
      sourceCount:value?.reader?.collection?.sourceCount??null,scope:copy(value?.reader?.collection?.scopeDescriptor??null),
      manifestHash:value?.internal?.manifestHash??null,queryTime:value?.internal?.queryTime??null};
    if(['local_reading_page','local_reading_outline'].includes(mode))output.reading={status:value?.reader?.status??null,
      pageNumber:value?.reader?.pageNumber??null,range:copy(value?.reader?.range??null),
      coverage:copy(value?.reader?.coverage??null),materializedSourceBytes:value?.internal?.materializedSourceBytes??null,
      source:value?.reader?.source?{ref:value.reader.source.ref,role:value.reader.source.sourceAuthorRole,
        messageRecordedAt:value.reader.source.messageRecordedAt,eventOccurredAt:value.reader.source.eventOccurredAt}:null,
      projectedToModel:value?.modelContext!==null};
    if(['standalone','local_event_resume'].includes(mode))output.outcome={status:value?.status??null,
      queryPointer:copy(value?.queryPointer??null),answerPointer:copy(value?.answerPointer??null),
      eventProcessing:value?.eventProcessing??null,dialogueProcessing:value?.dialogueProcessing??null,
      assistantTiming:copy(value?.assistantTiming??null)};
  }
  if(receipt&&!enabled&&receipt.value.result?.lookupReceipt?.requestId)output.historyQuery={
    status:'restricted_by_current_controls',requestId:receipt.value.result.lookupReceipt.requestId};
  return output;
}

export async function readCmcpEvidenceTrace({configFile,workId,showBodies=false,attemptNumber=null,repoRoot=cmcpProjectRoot}={}){
  if(typeof configFile!=='string'||!configFile||typeof workId!=='string'||!workId||workId.length>160
    ||attemptNumber!==null&&(!Number.isSafeInteger(attemptNumber)||attemptNumber<1)
    ||showBodies&&attemptNumber===null)throw Error('trace_requires_config_work_id_and_bounded_body_attempt');
  const normalized=await loadCmcpRuntimeConfig(configFile,{repoRoot});
  const session=await createCmcpRuntimeSession({config:normalized.config,repoRoot,readOnly:true});
  try{
    const [full,work,boundary]=await Promise.all([session.status(),session.progress(workId),
      readCmcpBufferBoundary({root:normalized.config.input.root,scopeId:normalized.config.input.scopeId})]);
    if(!work)throw Error('trace_work_not_found');
    const controls=full.controls,binding=session.binding,receiptPath=path.join(normalized.config.receiptRoot,'work-'+loopHash(workId)+'.json');
    let receipt=null;
    if(work.state==='completed'){
      if(work.terminal?.receiptPath!==receiptPath)throw Error('trace_receipt_path_mismatch');
      const raw=await fs.readFile(receiptPath,'utf8'),value=JSON.parse(raw);
      if(value.binding!==binding||value.runtimeId!==normalized.config.runtimeId||value.workId!==workId
        ||value.mode!==work.mode||value.sessionId!==work.sessionId)throw Error('trace_receipt_binding_mismatch');
      receipt={value,sha256:loopHash(raw)};
    }
    const ledgerRoot=path.join(path.dirname(session.authorization.root),'runtime-provider','attempts');
    const attemptRows=(await createLocalLoopJournal({root:ledgerRoot,name:'cmcp-local-loop-attempts-v1'}).read()).map(row=>row.record);
    let sourceChecks=[],historyQueryRows=[];
    if(controlsAllowHistory(controls)&&!(work.bufferDependent===true&&work.bufferGeneration!==boundary.generation)){
      const requestId=receipt?.value?.result?.lookupReceipt?.requestId;
      if(requestId){
        const inputJournal=await createLocalLoopJournal({root:path.join(normalized.config.input.root,'input-journal'),
          name:'cmcp-common-input-v1'}).read();
        historyQueryRows=inputJournal.map(row=>row.record).filter(row=>row.kind==='cmcp_history_query_v1'
          &&row.value?.scopeId===normalized.config.input.scopeId&&row.value?.requestId===requestId)
          .map(row=>row.value);
        // Validate the frozen ticket, manifest, page chain and accepted batch before using its pointers for live checks.
        projectCmcpHistoryQueryEvidence({lookupReceipt:receipt.value.result.lookupReceipt,
          rows:historyQueryRows,scopeId:normalized.config.input.scopeId});
      }
      const catalog=full.state?.registration?.sources??[],unregistered=full.state?.registration?.unregistered??[],
        sources=boundedSources(work,receipt?.value,historyQueryRows),provider=createCmcpReactivationStores({root:normalized.config.input.root,
          scopeId:normalized.config.input.scopeId}).history;
      for(const source of sources.slice(0,MAX_SOURCE_CHECKS)){
        if(source.pointer.scopeId!==normalized.config.input.scopeId)throw Error('trace_source_scope_mismatch');
        const key=cmcpSourcePointerKey(source.pointer),registered=catalog.find(row=>cmcpSourcePointerKey(row.pointer)===key),
          pending=unregistered.some(pointer=>cmcpSourcePointerKey(pointer)===key),found=await resolveCmcpHistorySource({provider,pointer:source.pointer});
        const actualHash=found.status==='found'?loopHash(found.evidence):null;
        sourceChecks.push({ref:source.ref,pointer:source.pointer,historyStatus:found.status,
          actualEvidenceHash:actualHash,
          evidenceHashMatches:actualHash&&source.evidenceHash?actualHash===source.evidenceHash:null,
          registered:registered?(actualHash===null?'registered_source_unavailable':registered.evidenceHash===actualHash?'verified_current':'registered_but_source_changed'):
            pending?'registration_pending':full.state.registration.inventoryComplete?'not_registered_in_complete_inventory':'inventory_incomplete',
          role:found.status==='found'?found.evidence.sourceAuthorRole:null,
          messageRecordedAt:found.status==='found'?found.evidence.messageRecordedAt:null,
          eventOccurredAt:found.status==='found'?found.evidence.eventOccurredAt:null,
          revisionId:source.pointer.revisionId??null});
      }
    }
    return projectCmcpEvidenceTrace({status:{binding,authorizationBinding:session.authorization.binding,controls,
      bufferGeneration:boundary.generation,
      registration:full.state.registration,providerWork:full.providerWork},work,receipt,attemptRows,
      historyQueryRows,sourceChecks,scopeId:normalized.config.input.scopeId,showBodies,attemptNumber});
  }finally{await session.close();}
}

async function main(){
  const {values}=parseArgs({options:{workspace:{type:'string'},config:{type:'string'},'work-id':{type:'string'},'include-bodies':{type:'boolean'},attempt:{type:'string'},help:{type:'boolean'}}});
  if(values.help){process.stdout.write('Usage: node scripts/cmcp-evidence-trace.mjs [--workspace <persistent-workspace>] --config <workspace-local-config> --work-id <exact-work-id> [--attempt N --include-bodies]\n');return;}
  const attempt=values.attempt===undefined?null:Number(values.attempt);
  const result=await readCmcpEvidenceTrace({configFile:values.config,workId:values['work-id'],
    showBodies:values['include-bodies']===true,attemptNumber:attempt,repoRoot:resolveCmcpWorkspaceRoot(values.workspace)});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

if(process.argv[1]&&path.resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase())
  main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
