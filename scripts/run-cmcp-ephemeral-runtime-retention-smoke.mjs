// Explicit synthetic normal Runtime/fetch fixture. No credential, network, or paid model.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCmcpRuntimeSession,authorizeCmcpRuntime} from '../src/cmcp-guard/cmcp-runtime-session.js';
import {createCmcpReactivationStores} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {createLocalLoopJournal} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {normalizeCmcpNaturalTemporalSelection} from '../src/cmcp-guard/cmcp-natural-temporal-reading.js';

const repo=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const base=path.join(repo,'logs','public-tests');
await fs.mkdir(base,{recursive:true});
const root=await fs.mkdtemp(path.join(base,'ephemeral-runtime-retention-'));
const state=path.join(root,'state'),scopeId='synthetic-ephemeral-retention';
const question='請依先前的藍筆安排原文回答，並說明條件。';
const sourceText='展場的藍筆安排：僅在安全檢查通過後才移到東側。';
const answerText='原文條件是安全檢查通過後才移到東側。';
const config={kind:'cmcp_runtime_config',version:1,runtimeId:'ephemeral-retention-smoke',
  input:{root:state,scopeId,events:[],timezone:'Asia/Taipei',
    limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:4096,maxProjectionBytes:12000},
    storageCapacity:{maxSources:64,maxSourceBytes:4096},
    loopTiming:{ttlMs:43200000,inactivityMs:60000,activityWindowMs:43200000}},
  receiptRoot:path.join(root,'receipts'),credentialRef:path.join(root,'unused-credential'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},
  controls:{enabled:true,clean:false,proactive:false},answerHistory:{enabled:true}};
const seen=[];
const fakeFetch=async(endpoint,request)=>{
  assert.equal(endpoint,'https://api.deepseek.com/responses');
  const wire=JSON.parse(request.body),purpose=wire.text?.format?.name?.replace(/^cmcp_/u,'')??'answer';
  const input=JSON.parse(wire.input[0].content);
  seen.push({purpose,requestBytes:Buffer.byteLength(request.body),input});
  let value;
  if(purpose==='recall_answer'&&input.probeHistoricalNeed===true)
    value={text:'',sourceRefs:[],historyNeed:{basis:'recorded_fact_lookup',quote:'先前的藍筆安排'}};
  else if(purpose==='temporal_read_select')
    value={version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''};
  else if(purpose==='history_aggregate')
    value={rows:input.sources.map(source=>({ref:source.ref,kind:'user_report',quote:sourceText,evidenceStatus:'supports_requested_detail'}))};
  else if(purpose==='recall_answer'&&input.context?.kind==='answer_history'){
    const evidence=input.context.context?.evidence??[];
    assert.equal(evidence.length,1);
    assert.equal(evidence[0].content.text,sourceText);
    value={text:answerText,sourceRefs:[evidence[0].sourceRef],evidenceStatus:'sufficient'};
  }else throw Error('unexpected_fake_fetch_purpose_'+purpose);
  return Response.json({id:'synthetic-'+seen.length,status:'completed',model:wire.model,
    output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}],
    usage:{input_tokens:11,output_tokens:7,total_tokens:18}});
};
const sha=async file=>createHash('sha256').update(await fs.readFile(path.join(repo,file))).digest('hex');
const files=['src/cmcp-guard/cmcp-runtime-session.js','src/cmcp-guard/cmcp-local-input.js',
  'src/cmcp-guard/cmcp-history-query-runtime.js','src/cmcp-guard/cmcp-responses-transport.js',
  'src/cmcp-guard/cmcp-natural-temporal-reading.js','scripts/run-cmcp-ephemeral-runtime-retention-smoke.mjs'];
const result={kind:'CMCP_SYNTHETIC_EPHEMERAL_RUNTIME_RETENTION',root,status:'FAIL',actualNetworkCalls:0,
  sourceHashes:Object.fromEntries(await Promise.all(files.map(async file=>[file,await sha(file)])))};
let runtime;
try{
  await authorizeCmcpRuntime({config,repoRoot:repo,authorizationId:'synthetic-retention-'+randomUUID(),
    limits:{deepseek:8,codex:0},authorizedBy:'Synthetic controlled fetch test; no paid request'});
  runtime=await createCmcpRuntimeSession({config,repoRoot:repo,readCredential:async()=> 'synthetic-only-not-real-key',
    fetchImpl:fakeFetch,delivery:{present:async()=>({status:'presented',channel:'synthetic_fixture'})},
    clock:()=> '2026-09-23T05:00:00.000Z'});
  const seeded=await runtime.ingest({text:sourceText,role:'user',messageRecordedAt:'2026-09-22T05:00:00.000Z'});
  assert.ok(seeded.pointer);
  await runtime.configureControls({updateId:'synthetic-save-disabled',patch:{saveUser:false,saveAssistant:false},persist:true});
  const history=createCmcpReactivationStores({root:state,scopeId}).history;
  const before=await history.listPointers({scopeId,maxRecords:16});
  assert.equal(before.pointers.length,1);
  const answered=await runtime.submit({text:question,eventKey:null,recall:false});
  assert.equal(answered.status,'answered',JSON.stringify(answered));
  assert.equal(answered.answer,answerText);
  const after=await history.listPointers({scopeId,maxRecords:16});
  assert.equal(after.pointers.length,1,'saveUser=false must not persist current User or Assistant');
  const attempts=await createLocalLoopJournal({root:path.join(state,'runtime-provider','attempts'),
    name:'cmcp-local-loop-attempts-v1'}).read();
  const retainedAttempts=attempts.map(row=>row.record);
  const started=retainedAttempts.filter(row=>row.kind==='started');
  const finished=retainedAttempts.filter(row=>row.kind==='result');
  assert.equal(started.length,seen.length);
  assert.ok(started.length>=3);
  for(const record of started){assert.equal(record.value.requestBody,null);assert.equal(record.value.bodyRetention,'disabled_by_source_control');}
  for(const record of finished){assert.equal(record.value.responseBody,null);assert.equal(record.value.outputText,null);assert.equal(record.value.bodyRetention,'disabled_by_source_control');}
  const attemptJSON=JSON.stringify(retainedAttempts);
  assert.ok(!attemptJSON.includes(question),'provider attempt journal retained unsaved query');
  assert.ok(!attemptJSON.includes(answerText),'provider attempt journal retained unsaved reply');
  const inputRows=(await createLocalLoopJournal({root:path.join(state,'input-journal'),
    name:'cmcp-common-input-v1'}).read()).map(row=>row.record);
  const historyRows=inputRows.filter(row=>row.kind==='cmcp_history_query_v1');
  assert.ok(historyRows.length>0);
  const historyJSON=JSON.stringify(historyRows);
  assert.ok(!historyJSON.includes(question),'history-query journal retained unsaved query');
  assert.ok(!historyJSON.includes(answerText),'history-query journal retained unsaved reply');
  const raw=historyRows.filter(row=>row.value.stage==='batch_raw');
  assert.ok(raw.length>0);
  for(const row of raw){assert.equal(row.value.value,null);assert.equal(row.value.bodyRetention,'not_saved_ephemeral_operation');}
  const twoEvents=normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:['e1','e2'],
    scope:{basis:'ordinary_history'},clarification:''},{eventMap:[{ref:'e1',key:'one'},{ref:'e2',key:'two'}],
      segmentMap:[],input:{question:'請問兩個相近專案當時的差異？',ordinaryHistory:{registeredSources:1}}});
  assert.equal(twoEvents.status,'needs_clarification');
  assert.equal(twoEvents.reason,'multiple_plausible_events');
  result.status='PASS';result.tests=['normal_runtime_save_off_no_new_history','provider_attempt_bodies_not_retained',
    'ephemeral_formal_history_query_no_current_question_or_answer','two_event_ordinary_selection_fails_closed'];
  result.providerPurposes=seen.map(row=>row.purpose);result.attemptStarted=started.length;
  result.attemptResult=finished.length;result.historyQueryStages=historyRows.map(row=>row.value.stage);
  result.historySourceCount={before:before.pointers.length,after:after.pointers.length};
  result.answerStatus=answered.status;result.lookupStatus=answered.lookupReceipt?.status??null;
  await fs.writeFile(path.join(root,'synthetic-requests.json'),JSON.stringify(seen,null,2)+'\n',{flag:'wx'});
  await fs.writeFile(path.join(root,'synthetic-result.json'),JSON.stringify({answered,historyRows,attempts:retainedAttempts},null,2)+'\n',{flag:'wx'});
}catch(error){result.error=error.stack;}
finally{await runtime?.close();await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({status:result.status,root,tests:result.tests??[],providerPurposes:result.providerPurposes??[],error:result.error??null}));
if(result.status!=='PASS')process.exitCode=1;
