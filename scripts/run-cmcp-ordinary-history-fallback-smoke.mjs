// 明示合成來源與語義替身；本檔不讀私有資料、憑證，也不呼叫產品 API。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCmcpLocalInput} from '../src/cmcp-guard/cmcp-local-input.js';
import {createCmcpReactivationStores} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {createLocalLoopJournal,loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {cmcpSourcePointerKey} from '../src/cmcp-guard/cmcp-source-pointer.js';

const repo=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const logs=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(repo,'logs/tests/ordinary-history'));
await fs.mkdir(logs,{recursive:true});
const runRoot=await fs.mkdtemp(path.join(logs,'ordinary-fallback-'));
const stateRoot=path.join(runRoot,'state');
const timezone='Asia/Taipei',scopeId='offline-ordinary-history';
const NOW='2026-09-23T02:00:00.000Z';
const NO_DATE='先前未關聯的展覽對話中，燈籠室最初那句開放條件是什麼？請依原句回答。';
const DATE_ONLY='只看 2026-09-22 當天的原始對話，當天有說燈籠室週四開放的條件嗎？';
const CURRENT_ONLY='請計算 3 加 4。';
const HISTORICAL_CLEAR='請依先前原文查燈籠室的開放條件。';
const TARGET='第十八筆原話：燈籠室週四開放，但只有消防檢查通過才會開門。';
const READING_LIMITS={maxSources:64,maxTotalBytes:131072,maxPageBytes:4096,maxPages:128,maxProjectionBytes:8192};
const control={forceOrdinaryForDate:false,holdCurrentProbe:null,holdHistoricalProbe:null,holdNavigation:null,holdAggregate:null};
const seen={probe:[],navigation:[],aggregate:[],answer:[],presentation:[]};
const copy=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(Error(label)),5000);})]);}finally{clearTimeout(timer);}}
const adapter={async request(purpose,input,options={}){
  if(purpose==='recall_answer'&&input.probeHistoricalNeed===true){
    seen.probe.push(copy(input));
    if(input.question===CURRENT_ONLY){
      if(control.holdCurrentProbe){control.holdCurrentProbe.started.resolve();await control.holdCurrentProbe.release.promise;}
      return {value:{text:'7',sourceRefs:[],historyNeed:{basis:'current_input_sufficient',quote:''}},
        transport:{kind:'explicit_offline_current_answer'}};
    }
    if(input.question===HISTORICAL_CLEAR){
      if(control.holdHistoricalProbe){control.holdHistoricalProbe.started.resolve();await control.holdHistoricalProbe.release.promise;}
      return {value:{text:'',sourceRefs:[],historyNeed:{basis:'recorded_fact_lookup',quote:'先前原文'}},
        transport:{kind:'explicit_offline_historical_need'}};
    }
    const date=input.question===DATE_ONLY,quote=date?'2026-09-22 當天':'先前未關聯的展覽對話';
    assert.ok(input.question.includes(quote));
    return {value:{text:'',sourceRefs:[],historyNeed:{basis:'recorded_fact_lookup',quote}},transport:{kind:'explicit_offline_probe'}};
  }
  if(purpose==='temporal_read_select'){
    if(control.holdNavigation){control.holdNavigation.started.resolve();await control.holdNavigation.release.promise;
      if(!await options.canAttempt?.())throw Error('offline_navigation_attempt_cancelled_by_control');}
    seen.navigation.push(copy(input));
    const date=input.question===DATE_ONLY;
    assert.ok(date||input.question===NO_DATE||input.question===HISTORICAL_CLEAR,'僅限合成歷史問句');
    const scope=date&&!control.forceOrdinaryForDate
      ?{basis:'message_time',calendarRanges:[{fromLocal:'2026-09-22T00:00:00',toLocal:'2026-09-23T00:00:00',timezone}]}
      :{basis:'ordinary_history'};
    return {value:{version:2,eventRefs:[],scope,clarification:''},transport:{kind:'explicit_offline_navigation'}};
  }
  if(purpose==='history_aggregate'){
    if(control.holdAggregate){control.holdAggregate.started.resolve();await control.holdAggregate.release.promise;
      if(!await options.canAttempt?.())throw Error('offline_model_attempt_cancelled_by_control');}
    seen.aggregate.push(copy(input));
    assert.equal(input.purpose,'evidence_lookup');
    const rows=input.sources.map(source=>source.text===TARGET&&source.sourceAuthorRole==='user'
      ?{ref:source.ref,kind:'user_report',quote:TARGET,evidenceStatus:'supports_requested_detail'}
      :{ref:source.ref,kind:'not_relevant',quote:'',evidenceStatus:'does_not_support_requested_detail'});
    return {value:{rows},transport:{kind:'explicit_offline_classification'}};
  }
  if(purpose==='recall_answer'&&input.context?.kind==='answer_history'){
    seen.answer.push(copy(input));
    const evidence=input.context.context?.evidence??[];
    if(input.question===NO_DATE){
      assert.equal(evidence.length,1,'普通歷史須取得第十八筆支持原文');
      assert.equal(evidence[0].content.text,TARGET);
      assert.equal(evidence[0].sourceAuthorRole,'user');
      return {value:{text:TARGET,sourceRefs:[evidence[0].sourceRef],evidenceStatus:'sufficient'},
        transport:{kind:'explicit_offline_answer'}};
    }
    assert.equal(input.question,DATE_ONLY);
    assert.equal(evidence.length,0,'9/22 範圍不得擴到 9/21 支持來源');
    return {value:{text:'已讀本次登錄的 9/22 來源，未見該條件；來源完整性仍有限，不推論其他日期。',
      sourceRefs:[],evidenceStatus:'insufficient'},transport:{kind:'explicit_offline_answer'}};
  }
  throw Error('unexpected_offline_purpose_'+purpose);
}};
const options={root:stateRoot,scopeId,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:4096,maxProjectionBytes:12000},
  loopTiming:{ttlMs:12*60*60*1000,inactivityMs:60000,activityWindowMs:12*60*60*1000},
  storageCapacity:{maxSources:64,maxSourceBytes:4096},answerHistory:{enabled:true},adapter,
  delivery:{async present(message){seen.presentation.push(copy(message));return {status:'presented',channel:'offline_test'};}},
  clock:()=>NOW};
const stores=createCmcpReactivationStores({root:stateRoot,scopeId});
const sourceInventory=async()=>{const listed=await stores.history.listPointers({scopeId,maxRecords:64});
  assert.equal(listed.status,'complete');return listed.pointers;};
const journal=createLocalLoopJournal({root:path.join(stateRoot,'input-journal'),name:'cmcp-common-input-v1'});
async function sourceHashes(){const files=[
  'src/cmcp-guard/cmcp-local-input.js',
  'src/cmcp-guard/cmcp-history-reactivation.js',
  'src/cmcp-guard/cmcp-natural-temporal-reading.js',
  'src/cmcp-guard/cmcp-history-query-runtime.js',
  'src/cmcp-guard/cmcp-local-loop-protocol.js',
  'src/cmcp-guard/cmcp-answer-history.js',
  'scripts/run-cmcp-ordinary-history-fallback-smoke.mjs'];
  return Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await fs.readFile(path.join(repo,file))).digest('hex')])));}
async function opening(requestId){const rows=await journal.read(),row=rows.find(entry=>entry.record.kind==='cmcp_history_query_v1'
  &&entry.record.value.requestId===requestId&&entry.record.value.stage==='opened');
  assert.ok(row,'formal history-query opening receipt');return row.record.value.reading;}
async function completed(requestId){const rows=await journal.read(),row=rows.findLast(entry=>entry.record.kind==='cmcp_history_query_v1'
  &&entry.record.value.requestId===requestId&&entry.record.value.stage==='completed');
  assert.ok(row,'formal aggregate completion receipt');return row.record.value.result;}
const report={kind:'CMCP_ORDINARY_HISTORY_FALLBACK_OFFLINE',runRoot,sourceSet:'22 unassociated original messages; target at source 18',
  tests:[],apiCalls:0};
let local;
try{
  local=await createCmcpLocalInput(options);
  const originals=[];
  for(let i=1;i<=22;i++){
    const isTarget=i===18,role=i%2===0?'user':'assistant';
    const text=isTarget?TARGET:`合成普通對話第 ${String(i).padStart(2,'0')} 筆：這句只描述展示索引 ${i}。`;
    const time=isTarget?'2026-09-21T03:00:00.000Z':`2026-09-22T03:00:${String(i).padStart(2,'0')}.000Z`;
    const saved=await local.ingest({text,role,messageRecordedAt:time});
    originals.push({position:i,pointer:saved.pointer,role,text,messageRecordedAt:time,eventKey:null});
  }
  assert.equal((await sourceInventory()).length,22);
  assert.equal(originals[17].role,'user');
  const first=await local.submit({text:NO_DATE,eventKey:null,recall:false});
  assert.equal(first.status,'answered',JSON.stringify(first));
  assert.equal(first.answer,TARGET);
  const firstReplyBinding=(await journal.read()).map(row=>row.record).find(record=>record.kind==='assistant_reply_binding'
    &&cmcpSourcePointerKey(record.value.pointer)===cmcpSourcePointerKey(first.answerPointer));
  assert.ok(firstReplyBinding,'普通回答必須有持久且精確的 User/Assistant 回覆關聯');
  assert.equal(cmcpSourcePointerKey(firstReplyBinding.value.replyTo),cmcpSourcePointerKey(first.queryPointer));
  assert.equal(firstReplyBinding.value.eventKey,null,'普通回答不得冒充 Event 關聯');
  assert.equal(first.lookupReceipt.status,'partial','正常原文標示 partial，不可冒充完整 History');
  const firstOpening=await opening(first.lookupReceipt.requestId),firstResult=await completed(first.lookupReceipt.requestId);
  assert.equal(firstOpening.internal.manifest.sources.length,22,'普通來源凍結集合不可只是 top-k');
  const targetPosition=firstOpening.internal.manifest.sources.findIndex(source=>
    cmcpSourcePointerKey(source.pointer)===cmcpSourcePointerKey(originals[17].pointer))+1;
  assert.ok(targetPosition>17,'支持來源必須在第十七筆之後才測到分批補讀');
  assert.equal(firstResult.aggregate.finding,'supported_evidence');
  assert.equal(firstResult.aggregate.coverage.complete,true);
  assert.equal(firstResult.aggregate.coverage.completedSources,22);
  assert.equal(firstResult.aggregate.coverage.partialSources.length,22);
  assert.equal(firstResult.acceptedBatches,3,'22 筆以每批至多 8 筆查完');
  assert.equal(firstResult.aggregate.evidence.length,1);
  assert.equal(firstResult.aggregate.evidence[0].sourceAuthorRole,'user');
  assert.equal(firstResult.aggregate.evidence[0].citation.text,TARGET);
  assert.ok(seen.aggregate.length>=3);
  report.tests.push({name:'unassociated_formal_read_after_position_17_with_partial_source_availability',status:'PASS',
    targetPosition,sourceCount:22,acceptedBatches:firstResult.acceptedBatches,
    sourceBytes:firstResult.aggregate.coverage.cumulative?.sourceBytes??null});
  await fs.writeFile(path.join(runRoot,'ordinary-manifest.json'),JSON.stringify(firstOpening.internal.manifest,null,2)+'\n',{flag:'wx'});
  await fs.writeFile(path.join(runRoot,'ordinary-result.json'),JSON.stringify({answer:first,formal:firstResult},null,2)+'\n',{flag:'wx'});

  const second=await local.submit({text:DATE_ONLY,eventKey:null,recall:false});
  assert.equal(second.status,'source_insufficient',JSON.stringify(second));
  const dateOpening=await opening(second.lookupReceipt.requestId),dateResult=await completed(second.lookupReceipt.requestId);
  assert.equal(dateOpening.internal.manifest.scopeDescriptor?.kind,'exact_calendar_union');
  assert.equal(dateOpening.internal.manifest.sources.length,21);
  assert.ok(!dateOpening.internal.manifest.sources.some(source=>
    cmcpSourcePointerKey(source.pointer)===cmcpSourcePointerKey(originals[17].pointer)),
    '9/21 支持來源不可被 9/22 精確查詢吸入');
  assert.equal(dateResult.aggregate.evidence.length,0);
  assert.equal(dateResult.aggregate.coverage.complete,true,'頁面均讀完，與來源完整性分開');
  assert.equal(dateResult.aggregate.coverage.partialSources.length,21);
  assert.equal(dateResult.aggregate.coverage.inventory?.matchedSources,21);
  report.tests.push({name:'explicit_calendar_never_widens_to_previous_day',status:'PASS',
    matchedSources:21,excludedTargetPosition:18,coverage:dateResult.aggregate.coverage});
  await fs.writeFile(path.join(runRoot,'calendar-manifest.json'),JSON.stringify(dateOpening.internal.manifest,null,2)+'\n',{flag:'wx'});
  await fs.writeFile(path.join(runRoot,'calendar-result.json'),JSON.stringify({answer:second,formal:dateResult},null,2)+'\n',{flag:'wx'});
  const countBefore=await sourceInventory();
  await local.close();local=null;
  local=await createCmcpLocalInput({...options,sessionId:randomUUID(),clock:()=>'2026-09-23T02:30:00.000Z'});
  const reopened=await local.readingOpen({text:DATE_ONLY,mode:'all',ticket:randomUUID(),naturalTime:true,
    savedQueryPointer:second.queryPointer,limits:READING_LIMITS});
  assert.equal(reopened.reader.status,'ready');
  assert.equal(reopened.internal.queryTime,NOW);
  assert.equal(reopened.reader.collection.sourceCount,21);
  assert.equal((await sourceInventory()).length,countBefore.length,'重開已保存查詢不得另存 User');
  const persistedReply=(await journal.read()).map(row=>row.record).find(record=>record.kind==='assistant_reply_binding'
    &&cmcpSourcePointerKey(record.value.pointer)===cmcpSourcePointerKey(first.answerPointer));
  assert.deepEqual(persistedReply,firstReplyBinding,'新程序須保留原 User/Assistant 精確回覆關聯');
  report.tests.push({name:'reopen_saved_query_without_user_resave',status:'PASS',
    originalQueryTime:reopened.internal.queryTime,sourceCountBefore:countBefore.length,
    sourceCountAfter:(await sourceInventory()).length});

  control.forceOrdinaryForDate=true;
  const rejected=await local.readingOpen({text:DATE_ONLY,mode:'all',ticket:randomUUID(),naturalTime:true,
    savedQueryPointer:second.queryPointer,limits:READING_LIMITS});
  assert.equal(rejected.reader.status,'needs_clarification');
  assert.equal(rejected.reader.reason,'ordinary_history_conflicts_with_explicit_calendar');
  assert.equal(rejected.reader.collection,null);
  assert.equal((await sourceInventory()).length,countBefore.length);
  report.tests.push({name:'wrong_ordinary_scope_for_explicit_date_fails_closed',status:'PASS',reason:rejected.reader.reason});
  control.forceOrdinaryForDate=false;
  local.setControls({enabled:true,clean:false,saveUser:false});
  const beforeEphemeral=(await sourceInventory()).length;
  const ephemeral=await local.readingOpen({text:NO_DATE,mode:'all',ticket:randomUUID(),naturalTime:true,limits:READING_LIMITS});
  assert.equal(ephemeral.reader.status,'ready');
  assert.equal(ephemeral.internal.queryPointer,null);
  assert.ok(ephemeral.internal.queryAuthorization,'停止保存 User 時需使用當次授權的非持久查詢綁定');
  assert.equal((await sourceInventory()).length,beforeEphemeral,'唯讀查詢不可藉診斷留下新 User');
  report.tests.push({name:'save_user_off_ephemeral_natural_read',status:'PASS',
    sourceCountBefore:beforeEphemeral,sourceCountAfter:(await sourceInventory()).length,
    queryPointer:ephemeral.internal.queryPointer,queryAuthorizationKind:ephemeral.internal.queryAuthorization.kind});
  local.setControls({enabled:true,clean:false,saveUser:true});

  const currentHold={started:deferred(),release:deferred()};control.holdCurrentProbe=currentHold;
  const beforeClear=(await sourceInventory()).length,presentedBefore=seen.presentation.length;
  const currentWork=local.submit({text:CURRENT_ONLY,eventKey:null,recall:false});
  await bounded(currentHold.started.promise,'current_probe_never_started');
  const cleared=await bounded(local.clearBuffer(),'clear_blocked_by_current_probe');
  assert.equal(cleared.status,'cleared');
  currentHold.release.resolve();
  const currentResult=await bounded(currentWork,'current_answer_blocked_after_clear');
  assert.equal(currentResult.status,'answered');
  assert.equal(currentResult.answer,'7');
  assert.equal(seen.presentation.length,presentedBefore+1);
  assert.equal((await sourceInventory()).length,beforeClear+2,'普通 User 與回答仍各保留原來源');
  control.holdCurrentProbe=null;
  report.tests.push({name:'slow_current_only_probe_survives_buffer_clear',status:'PASS',
    bufferGeneration:cleared.generation,answer:currentResult.answer,presented:seen.presentation.length-presentedBefore});

  const historicalHold={started:deferred(),release:deferred()};control.holdHistoricalProbe=historicalHold;
  const navigationBefore=seen.navigation.length,answersBefore=seen.answer.length;
  const historyWork=local.submit({text:HISTORICAL_CLEAR,eventKey:null,recall:false});
  await bounded(historicalHold.started.promise,'historical_probe_never_started');
  const secondClear=await bounded(local.clearBuffer(),'clear_blocked_by_historical_probe');
  historicalHold.release.resolve();
  await assert.rejects(bounded(historyWork,'historical_work_not_cancelled_after_clear'),
    /reactivation_cancelled|general_history_lookup_cancelled|buffer_cleared_during_operation/);
  assert.equal(seen.navigation.length,navigationBefore,'Clear 後不可再啟動舊歷史正式選取');
  assert.equal(seen.answer.length,answersBefore,'Clear 後不可將舊支持材料送入回答');
  control.holdHistoricalProbe=null;
  report.tests.push({name:'slow_historical_probe_clear_blocks_stale_lookup',status:'PASS',
    bufferGeneration:secondClear.generation,navigationCallsAfterClear:seen.navigation.length-navigationBefore});

  const offHold={started:deferred(),release:deferred()};control.holdCurrentProbe=offHold;
  const beforeOff=(await sourceInventory()).length,offPresentedBefore=seen.presentation.length;
  const offWork=local.submit({text:CURRENT_ONLY,eventKey:null,recall:false});
  await bounded(offHold.started.promise,'off_probe_never_started');
  local.setControls({enabled:false,clean:false});
  offHold.release.resolve();
  await assert.rejects(bounded(offWork,'off_probe_was_not_cancelled'),/reactivation_cancelled|operation_cancelled/);
  assert.equal((await sourceInventory()).length,beforeOff+1,'OFF 前已保存的 User 仍保留，晚到 Assistant 不可新增');
  assert.equal(seen.presentation.length,offPresentedBefore,'OFF 後晚到回答不可呈現');
  control.holdCurrentProbe=null;
  report.tests.push({name:'slow_current_only_probe_off_blocks_late_assistant_and_presentation',status:'PASS',
    userSavedBeforeOff:1,assistantSavedAfterOff:0,presentedAfterOff:seen.presentation.length-offPresentedBefore});
  local.setControls({enabled:true,clean:false});
  const offAggregate={started:deferred(),release:deferred()};control.holdAggregate=offAggregate;
  const offAggregateBefore=seen.aggregate.length,offAnswerBefore=seen.answer.length;
  const offLookup=local.submit({text:HISTORICAL_CLEAR,eventKey:null,recall:false});
  await bounded(offAggregate.started.promise,'answer_history_aggregate_never_started');
  local.setControls({enabled:true,clean:false,answerHistory:false});
  offAggregate.release.resolve();
  await assert.rejects(bounded(offLookup,'answer_history_off_did_not_stop_lookup'),/cancelled|disabled/);
  assert.equal(seen.aggregate.length,offAggregateBefore,'answerHistory OFF must block the queued aggregate model attempt');
  assert.equal(seen.answer.length,offAnswerBefore,'answerHistory OFF must block the historical final answer');
  control.holdAggregate=null;
  report.tests.push({name:'answer_history_off_blocks_inflight_aggregate_attempt',status:'PASS',
    aggregateCallsAfterOff:seen.aggregate.length-offAggregateBefore});

  local.setControls({enabled:true,clean:false,answerHistory:true});
  const offNavigation={started:deferred(),release:deferred()};control.holdNavigation=offNavigation;
  const offNavigationBefore=seen.navigation.length;
  const navigationWork=local.submit({text:HISTORICAL_CLEAR,eventKey:null,recall:false});
  await bounded(offNavigation.started.promise,'answer_history_navigation_never_started');
  local.setControls({enabled:true,clean:false,answerHistory:false});
  offNavigation.release.resolve();
  await assert.rejects(bounded(navigationWork,'answer_history_off_did_not_stop_navigation'),/cancelled|disabled/);
  assert.equal(seen.navigation.length,offNavigationBefore,'answerHistory OFF must block the queued navigation model attempt');
  control.holdNavigation=null;
  report.tests.push({name:'answer_history_off_blocks_inflight_navigation_attempt',status:'PASS',
    navigationCallsAfterOff:seen.navigation.length-offNavigationBefore});
  local.setControls({enabled:true,clean:false,answerHistory:true});
  const clearAggregate={started:deferred(),release:deferred()};control.holdAggregate=clearAggregate;
  const clearAggregateBefore=seen.aggregate.length;
  const clearLookup=local.submit({text:HISTORICAL_CLEAR,eventKey:null,recall:false});
  await bounded(clearAggregate.started.promise,'clear_aggregate_never_started');
  const clearedDuringLookup=await bounded(local.clearBuffer(),'clear_blocked_by_aggregate');
  clearAggregate.release.resolve();
  await assert.rejects(bounded(clearLookup,'clear_did_not_stop_aggregate'),/cancelled|disabled/);
  assert.equal(seen.aggregate.length,clearAggregateBefore,'Clear must block the queued aggregate model attempt');
  control.holdAggregate=null;
  report.tests.push({name:'clear_blocks_inflight_aggregate_attempt',status:'PASS',
    generation:clearedDuringLookup.generation,aggregateCallsAfterClear:seen.aggregate.length-clearAggregateBefore});

  local.setControls({enabled:true,clean:false,answerHistory:false});
  const explicitBefore=seen.aggregate.length;
  const explicit=await local.historyQuery({requestId:'offline-independent-history-query',text:NO_DATE,purpose:'evidence_lookup',
    readingLimits:READING_LIMITS,batchLimits:{maxBatchSources:8,maxInputBytes:8000,maxBatches:16},
    executionBudget:{maxBatchesPerExecution:16,reserveMs:0,requestTimeoutMs:90000},
    navigation:{savedQueryPointer:first.queryPointer,naturalTime:true}});
  assert.ok(['partial','complete_within_frozen_scope'].includes(explicit.status));
  assert.ok(seen.aggregate.length>explicitBefore,'independent explicit History query remains enabled');
  report.tests.push({name:'independent_history_query_remains_available_when_answer_history_off',status:'PASS',
    aggregateCalls:seen.aggregate.length-explicitBefore,answerHistory:false});
  local.setControls({enabled:true,clean:false,answerHistory:true});
  const disabledCalls=[];
  const disabled=await createCmcpLocalInput({...options,root:path.join(runRoot,'static-answer-history-disabled'),
    scopeId:'offline-static-answer-history-disabled',answerHistory:{enabled:false},
    adapter:{async request(purpose,input){disabledCalls.push({purpose,probeHistoricalNeed:input.probeHistoricalNeed??false});
      assert.equal(purpose,'recall_answer');assert.notEqual(input.probeHistoricalNeed,true);
      return {value:{text:'7',sourceRefs:[]},transport:{kind:'explicit_offline_static_disabled'}};}},
    delivery:{async present(){return {status:'presented',channel:'offline_test'};}}});
  try{
    const plain=await disabled.submit({text:CURRENT_ONLY,eventKey:null,recall:false});
    assert.equal(plain.answer,'7');
    assert.deepEqual(disabledCalls,[{purpose:'recall_answer',probeHistoricalNeed:false}],
      '靜態關閉 Answer History 不可發起歷史需求 probe 或正式閱讀');
    report.tests.push({name:'static_answer_history_disabled_keeps_plain_answer_route',status:'PASS',calls:disabledCalls});
  }finally{await disabled.close();}
  await fs.writeFile(path.join(runRoot,'source-inventory.json'),JSON.stringify(originals,null,2)+'\n',{flag:'wx'});
  await fs.writeFile(path.join(runRoot,'offline-model-inputs.json'),JSON.stringify(seen,null,2)+'\n',{flag:'wx'});
  report.status='PASS';
  report.modelCalls={probe:seen.probe.length,navigation:seen.navigation.length,aggregate:seen.aggregate.length,
    answer:seen.answer.length,allOffline:true};
  report.sourceHashes=await sourceHashes();
  await fs.writeFile(path.join(runRoot,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:report.status,runRoot,tests:report.tests.map(test=>test.name),
    modelCalls:report.modelCalls,sourceCount:(await sourceInventory()).length}));
}catch(error){report.status='FAIL';report.error=error.stack;
  try{const rows=(await journal.read()).filter(row=>row.record.kind==='cmcp_history_query_v1')
    .map(row=>row.record.value),counts={};for(const row of rows)counts[row.stage]=(counts[row.stage]??0)+1;
    report.diagnostics={stageCounts:counts,lastStages:rows.slice(-4).map(row=>({stage:row.stage,status:row.status,
      reason:row.reason,resultStatus:row.result?.status,acceptedBatches:row.result?.acceptedBatches,
      completedSources:row.result?.aggregate?.coverage?.completedSources,sourceCount:row.result?.aggregate?.coverage?.sourceCount,
      coverage:row.result?.aggregate?.coverage})),
      modelCalls:{probe:seen.probe.length,navigation:seen.navigation.length,aggregate:seen.aggregate.length,answer:seen.answer.length}};
  }catch(diagnosticError){report.diagnosticError=diagnosticError.message;}
  await fs.writeFile(path.join(runRoot,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.error(JSON.stringify({status:'FAIL',runRoot,error:error.stack,diagnostics:report.diagnostics}));process.exitCode=1;
}finally{await local?.close();}
