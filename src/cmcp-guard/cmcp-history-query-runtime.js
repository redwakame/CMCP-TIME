import {loopHash} from './cmcp-local-loop-journal.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {parseCmcpInstant} from './resolve-cmcp-time-context.js';
import {inspectCmcpReadingProgress} from './cmcp-reading.js';
import {prepareCmcpHistoryAggregateBatch,acceptCmcpHistoryAggregateBatch,summarizeCmcpHistoryAggregate} from './cmcp-history-aggregation.js';
import {resolveCmcpReadingQuery,cmcpReadingQueryKey,assertCmcpEphemeralQueryText} from './cmcp-reading-query-authorization.js';

const copy=value=>structuredClone(value),positive=value=>Number.isSafeInteger(value)&&value>0;
const kind='cmcp_history_query_v1';
const defaultExecutionBudget={maxBatchesPerExecution:2,reserveMs:0,requestTimeoutMs:90000};
function executionBudget(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(defaultExecutionBudget,key)))throw Error('invalid_history_query_execution_budget');
  const result={...defaultExecutionBudget,...value};
  if(!positive(result.maxBatchesPerExecution)||result.maxBatchesPerExecution>16||!Number.isSafeInteger(result.reserveMs)||result.reserveMs<0
    ||!positive(result.requestTimeoutMs)||result.requestTimeoutMs>90000)throw Error('invalid_history_query_execution_budget');
  return result;
}

/**
 * A thin orchestration inside the caller's existing Runtime work and grant.
 * It reuses the injected input journal and reading receipts; it owns no storage,
 * timer, credentials, automatic retry, HTTP client, or parallel worker.
 */
export function createCmcpHistoryQueryRuntime({scopeId,journal,historyProvider,readingOpen,readingPage,adapter,
  validatePublication,valid,now,activateMatches=async()=>({status:'not_requested'}),remainingWorkMs=()=>Infinity}){
  if(typeof scopeId!=='string'||!scopeId||typeof journal?.read!=='function'||typeof journal?.append!=='function'
    ||typeof historyProvider?.resolve!=='function'||typeof readingOpen!=='function'||typeof readingPage!=='function'
    ||typeof adapter?.request!=='function'||typeof validatePublication!=='function'||typeof valid!=='function'||typeof now!=='function'||typeof remainingWorkMs!=='function')throw Error('explicit_history_query_runtime_dependencies_required');
  let running=null,activeRows=null;
  const ensure=async()=>{if(!await valid())throw Error('history_query_cancelled_or_disabled');};
  const stamp=()=>{const instant=now();parseCmcpInstant(instant);return instant;};
  const emit=async(stage,value)=>{
    const payload={scopeId,stage,recordedAt:stamp(),...copy(value)};
    const record=await journal.append(kind,copy(payload));
    // The injected journal contract need not return its stored record.
    if(activeRows&&value.requestId===running)activeRows.push(payload);
    return record;
  };
  function id(value){if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>256)throw Error('invalid_history_query_request_id');return value;}
  async function records(requestId){id(requestId);if(activeRows&&running===requestId)return activeRows;
    return (await (journal.readIncremental?.()??journal.read())).map(row=>row.record??row)
    .filter(row=>row.kind===kind&&row.value.scopeId===scopeId&&row.value.requestId===requestId).map(row=>row.value);}
  function stateOf(rows){
    const started=rows.find(row=>row.stage==='started'),opening=rows.find(row=>row.stage==='opened');
    const pages=rows.filter(row=>row.stage==='page').map(row=>row.page),results=rows.filter(row=>row.stage==='batch_accepted').map(row=>row.classification);
    const terminal=rows.findLast(row=>['completed','stopped'].includes(row.stage));
    const attempts=rows.filter(row=>row.stage==='batch_started'),pending=attempts.filter(row=>!rows.some(result=>['batch_accepted','batch_failed'].includes(result.stage)&&result.batchId===row.batchId));
    return {started,opening:opening?.reading??null,pages,results,terminal,attempts,pending,
      checkpoint:rows.findLast(row=>row.stage==='checkpoint'),activation:rows.findLast(row=>row.stage==='matches_activated'),
      readLimited:rows.some(row=>row.stage==='reading_limit')};
  }
  function publicStatus(requestId,state){
    if(!state.started)return {kind:'cmcp_history_query_status',requestId,status:'not_found',modelCalls:0};
    const coverage=state.opening?.internal?.manifest?inspectCmcpReadingProgress({reading:state.opening,previousPages:state.pages,scopeId}).coverage:null;
    return {kind:'cmcp_history_query_status',requestId,purpose:state.started.purpose,status:state.pending.length?'remote_unknown':state.terminal?.status??state.checkpoint?.status??'in_progress',
      readingTicket:state.opening?.reader?.ticket??null,coverage,acceptedBatches:state.results.length,
      startedBatches:state.attempts.length,pendingBatches:state.pending.map(row=>row.batchId),
      reason:state.terminal?.reason??state.checkpoint?.reason??null,resumable:!state.pending.length&&!state.terminal&&!!state.checkpoint,
      modelCalls:0,observation:'zero_API_no_activity_or_TTL_refresh'};
  }
  function retainQueryResult(value,ephemeral){
    if(!ephemeral)return value;const kept=copy(value);
    if(kept.aggregate)delete kept.aggregate.question;
    if(kept.host){delete kept.host.question;if(kept.host.selection?.input)delete kept.host.selection.input.question;}
    if(kept.internal){delete kept.internal.question;delete kept.internal.rawSelection;delete kept.internal.refinedSelection;
      if(kept.internal.prepared?.input)delete kept.internal.prepared.input.question;
      if(kept.internal.selection)delete kept.internal.selection.clarification;}
    if(kept.reader?.reason)kept.reader.reason='ephemeral_query_detail_not_retained';
    if(kept.host?.reason)kept.host.reason='ephemeral_query_detail_not_retained';
    kept.queryBodyRetention='not_saved_ephemeral_operation';return kept;
  }
  async function restoreQuestion(state,suppliedText,{verifyOnly=false}={}){
    const pointer=state.opening?.internal?.queryPointer,manifest=state.opening?.internal?.manifest;
    if(manifest?.queryAuthorization){
      if(cmcpReadingQueryKey(state.opening.internal)!==cmcpReadingQueryKey(manifest))throw Error('history_query_source_scope');
      const query=await resolveCmcpReadingQuery({history:historyProvider,scopeId,binding:manifest});await ensure();
      if(query.queryAuthorization.questionHash!==state.started.questionHash)throw Error('history_query_question_binding');
      if(verifyOnly)return null;assertCmcpEphemeralQueryText(query.queryAuthorization,suppliedText);return suppliedText;
    }
    if(!manifest||pointer?.scopeId!==scopeId||cmcpSourcePointerKey(pointer)!==cmcpSourcePointerKey(manifest.queryPointer))throw Error('history_query_source_scope');
    const found=await resolveCmcpHistorySource({provider:historyProvider,pointer});await ensure();
    if(found.status!=='found'||found.evidence.sourceAuthorRole!=='user'||found.evidence.content.kind!=='source_excerpt'
      ||loopHash(found.evidence)!==manifest.queryHash||found.evidence.messageRecordedAt!==manifest.queryTime
      ||loopHash(found.evidence.content.body)!==state.started.questionHash)throw Error('history_query_source_unavailable_or_changed');
    return found.evidence.content.body;
  }
  async function execute(requestId,text=null,requestedExecutionBudget,recovery=text===null){
    const budget=executionBudget(requestedExecutionBudget);
    await ensure();let state=stateOf(await records(requestId));
    if(!state.started)throw Error('history_query_not_started');
    if(state.pending.length)return {...publicStatus(requestId,state),reason:'started_batch_has_no_durable_result_no_automatic_retry'};
    if(state.terminal?.stage==='stopped')return publicStatus(requestId,state);
    if(!state.opening){
      // Opening may itself have invoked natural selection. A process crash during
      // it is not proof that the remote request was never made.
      if((await records(requestId)).some(row=>row.stage==='opening_started'))return {...publicStatus(requestId,state),status:'remote_unknown',reason:'opening_has_no_receipt'};
      if(text===null)throw Error('history_query_opening_has_no_saved_source');
      await emit('opening_started',{requestId});await ensure();
      let reading;
      try{reading=await readingOpen({text,mode:'all',ticket:requestId,limits:state.started.readingLimits,naturalTime:true,...state.started.navigation});}
      catch(error){await emit('stopped',{requestId,status:'pending',reason:'reading_open_failed',code:error?.code??error?.message??'unknown'});throw error;}
      await ensure();await emit('opened',{requestId,reading:retainQueryResult(reading,!!reading.internal?.queryAuthorization)});state=stateOf(await records(requestId));
    }
    if(state.opening.reader.status!=='ready'){
      await emit('stopped',{requestId,status:state.opening.reader.status,reason:state.opening.reader.reason??'reading_collection_not_ready'});
      return publicStatus(requestId,stateOf(await records(requestId)));
    }
    text=await restoreQuestion(state,text);
    if(state.terminal?.stage==='completed'){
      const published=await validatePublication({reading:state.opening,pages:state.pages,sourceRefs:state.opening.internal.manifest.sources.map(source=>source.ref)});await ensure();
      return published.status==='verified'?{...copy(state.terminal.result),replayed:true,modelCalls:0}:
        {kind:'cmcp_history_query_result',requestId,status:'source_unavailable',publication:published,modelCalls:0};
    }
    let calls=0,checkpointReason=null;
    await emit('execution_started',{requestId,executionBudget:budget,recovery});
    async function batchCheckpoint(){
      if(calls>=budget.maxBatchesPerExecution)return 'execution_batch_checkpoint';
      const remaining=await remainingWorkMs();
      if(typeof remaining!=='number'||Number.isNaN(remaining)||remaining===-Infinity)throw Error('invalid_history_query_remaining_work_time');
      return remaining<budget.requestTimeoutMs+budget.reserveMs?'execution_deadline_checkpoint':null;
    }
    while(true){
      await ensure();state=stateOf(await records(requestId));
      const batch=prepareCmcpHistoryAggregateBatch({reading:state.opening,pages:state.pages,results:state.results,scopeId,question:text,
        purpose:state.started.purpose,maxBatchSources:state.started.batchLimits.maxBatchSources,maxInputBytes:state.started.batchLimits.maxInputBytes});
      if(['ready','needs_read'].includes(batch.status)){
        if(state.attempts.length>=state.started.batchLimits.maxBatches){await emit('stopped',{requestId,status:'partial',reason:'aggregate_batch_budget_exhausted'});break;}
        checkpointReason=await batchCheckpoint();if(checkpointReason)break;
      }
      if(batch.status==='ready'&&batch.internal.needsMorePagesForBatch&&!state.readLimited){
        const page=await readingPage({openingResult:state.opening,previousPages:state.pages,project:false,activateBuffer:false});await ensure();
        if(page.internal?.budgetExhausted||page.internal?.replayedTerminal){await emit('reading_limit',{requestId,reason:page.reader.reason??'no_more_readable_pages'});continue;}
        if(!page.internal?.pageHash)throw Error('history_query_page_receipt_required');await emit('page',{requestId,page});continue;
      }
      if(batch.status==='ready'){
        if(state.attempts.length>=state.started.batchLimits.maxBatches){await emit('stopped',{requestId,status:'partial',reason:'aggregate_batch_budget_exhausted'});break;}
        const publication=await validatePublication({reading:state.opening,pages:state.pages,sourceRefs:batch.input.sources.map(source=>source.ref)});await ensure();
        if(publication.status!=='verified'){await emit('stopped',{requestId,status:'partial',reason:'batch_source_unavailable',publication});break;}
        checkpointReason=await batchCheckpoint();if(checkpointReason)break;
        const batchId=loopHash([requestId,batch.internal.inputHash]);
        await emit('batch_started',{requestId,batchId,inputHash:batch.internal.inputHash,inputBytes:batch.inputBytes,
          sourceBindings:batch.internal.sourceBindings,manifestHash:batch.internal.manifestHash});
        let reply;
        try{
          await ensure();calls++;reply=await adapter.request('history_aggregate',batch.input,{canAttempt:valid});
          // Preserve a completed raw response before deterministic classification.
          const ephemeral=!!state.opening.internal?.queryAuthorization;
          await emit('batch_raw',{requestId,batchId,value:ephemeral?null:reply.value,transport:reply.transport??null,
            ...(ephemeral?{bodyRetention:'not_saved_ephemeral_operation'}:{})});await ensure();
          const classification=acceptCmcpHistoryAggregateBatch({batch,value:reply.value,reading:state.opening,pages:state.pages,scopeId});
          await emit('batch_accepted',{requestId,batchId,classification});await ensure();
        }catch(error){
          await emit('batch_failed',{requestId,batchId,status:'pending',remoteResult:reply?'received':'unknown',code:error?.code??error?.message??'unknown'});
          await emit('stopped',{requestId,status:'pending',reason:reply?'classification_rejected_or_cancelled':'provider_failed_or_remote_unknown'});break;
        }
        continue;
      }
      if(batch.status==='needs_read'){
        if(state.readLimited){await emit('stopped',{requestId,status:'partial',reason:'reading_budget_exhausted'});break;}
        const page=await readingPage({openingResult:state.opening,previousPages:state.pages,project:false,activateBuffer:false});await ensure();
        if(page.internal?.replayedTerminal)break;
        if(page.internal?.budgetExhausted){await emit('stopped',{requestId,status:'partial',reason:'reading_budget_exhausted'});break;}
        if(!page.internal?.pageHash)throw Error('history_query_page_receipt_required');
        await emit('page',{requestId,page});continue;
      }
      if(batch.status==='budget_exhausted'){await emit('stopped',{requestId,status:'partial',reason:batch.blocked.reason,blocked:batch.blocked});break;}
      break;
    }
    await ensure();state=stateOf(await records(requestId));
    const aggregate=summarizeCmcpHistoryAggregate({reading:state.opening,pages:state.pages,results:state.results,scopeId,question:text,purpose:state.started.purpose});
    const publication=await validatePublication({reading:state.opening,pages:state.pages,sourceRefs:state.pages.filter(page=>page.reader.text!==null).map(page=>page.reader.source.ref).filter((ref,index,refs)=>refs.indexOf(ref)===index)});await ensure();
    const result={kind:'cmcp_history_query_result',requestId,status:publication.status!=='verified'?'source_unavailable':state.terminal?.status??aggregate.status,
      reason:state.terminal?.reason??checkpointReason,aggregate:publication.status==='verified'?aggregate:null,publication,
      readingTicket:state.opening.reader.ticket,modelCalls:calls,acceptedBatches:state.results.length,
      resumable:!!checkpointReason&&publication.status==='verified',resumeRequestId:checkpointReason?requestId:null,
      executionBudget:budget,sourceEvidence:'exact_frozen_reading_pages',activity:'original_query_time_only_no_resume_refresh'};
    if(checkpointReason&&publication.status==='verified')result.status='partial';
    if(!recovery&&publication.status==='verified'&&!state.terminal&&!state.activation){
      const refs=state.started.purpose==='report_count'?aggregate.countedRefs:(aggregate.evidence??[]).map(row=>row.ref);
      result.activation=await activateMatches({reading:state.opening,pages:state.pages,refs});await ensure();
      await emit('matches_activated',{requestId,activation:result.activation,refs});
    }else if(state.activation)result.activation={status:'not_repeated',original:copy(state.activation.activation)};
    if(checkpointReason){
      await emit('checkpoint',{requestId,status:result.status,reason:checkpointReason,result:retainQueryResult(result,!!state.opening.internal?.queryAuthorization)});
    }else if(!state.terminal){
      await emit('completed',{requestId,status:result.status,result:retainQueryResult(result,!!state.opening.internal?.queryAuthorization)});
    }
    await ensure();return result;
  }
  async function guarded(requestId,operation){
    if(running!==null)throw Error('history_query_already_running');running=id(requestId);
    try{
      // One existing Runtime writer owns this execution. Keep its own appended
      // receipts in memory; control/source checks remain live on every boundary.
      // A reopen reloads durable receipts rather than retaining this snapshot.
      activeRows=await records(requestId);return await operation();
    }finally{running=null;activeRows=null;}
  }
  return Object.freeze({
    async run({requestId,text,purpose='report_count',readingLimits,batchLimits={maxBatchSources:4,maxInputBytes:12000,maxBatches:16},navigation={},executionBudget:runBudget}){
      return guarded(requestId,async()=>{
        executionBudget(runBudget);
        await ensure();if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>4096||!['report_count','evidence_lookup'].includes(purpose)
          ||!batchLimits||Object.keys(batchLimits).sort().join(',')!=='maxBatchSources,maxBatches,maxInputBytes'
          ||!Object.values(batchLimits).every(positive)||batchLimits.maxBatchSources>16)throw Error('invalid_history_query_request');
        if(!navigation||typeof navigation!=='object'||Object.keys(navigation).some(key=>!['calendarRange','discussion','naturalTime','inventory','savedQueryPointer'].includes(key)))throw Error('invalid_history_query_navigation');
        const rows=await records(requestId),state=stateOf(rows),descriptor={questionHash:loopHash(text),purpose,readingLimits:copy(readingLimits),batchLimits:copy(batchLimits),navigation:copy(navigation)};
        if(state.started){for(const key of Object.keys(descriptor))if(JSON.stringify(state.started[key])!==JSON.stringify(descriptor[key]))throw Error('history_query_id_conflict');}
        else await emit('started',{requestId,...descriptor});return execute(requestId,text,runBudget,!!state.started);
      });
    },
    resume({requestId,executionBudget:resumeBudget,queryText}){return guarded(requestId,()=>execute(requestId,queryText??null,resumeBudget,true));},
    async verify(requestId){
      await ensure();const state=stateOf(await records(requestId));if(!state.opening?.internal?.manifest)return false;
      await restoreQuestion(state,undefined,{verifyOnly:true});
      const refs=[...new Set(state.results.flatMap(batch=>batch.rows.filter(row=>row.evidenceStatus==='supports_requested_detail'||state.started.purpose==='report_count'&&row.kind==='user_report'&&row.claimMatch==='affirmed').map(row=>row.ref)))];
      const result=await validatePublication({reading:state.opening,pages:state.pages,sourceRefs:refs});
      await ensure();return result.status==='verified';
    },
    async status(requestId){return publicStatus(requestId,stateOf(await records(requestId)));}
  });
}
