// 合成來源的有界導航與既有選材控制回歸；零 API，不讀私人 History。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {prepareCmcpAnswerMaterialSelection,buildCmcpAnswerMaterialSelectionRequest,validateCmcpAnswerMaterialSelection,
  selectCmcpAnswerMaterial} from '../src/cmcp-guard/cmcp-answer-material-selection.js';
import {loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {buildCmcpDeepSeekWireRequest} from '../src/cmcp-guard/cmcp-responses-transport.js';
import {DEEPSEEK_LOOP_CONFIG} from '../src/cmcp-guard/cmcp-deepseek-configured-adapter.js';

const base=path.resolve(process.env.CMCP_MATERIAL_NAVIGATION_TEST_ROOT??'logs/material-navigation-capacity-smoke');
const root=path.join(base,'run-'+randomUUID());await fs.mkdir(root,{recursive:true});
const startedAt=new Date().toISOString(),cases=[];
async function test(name,fn){try{const details=await fn();cases.push({name,status:'PASS',...details});console.log('PASS '+name);}
  catch(error){cases.push({name,status:'FAIL',error:error.message});console.error('FAIL '+name+'\n'+error.stack);}}
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
function fixture(count,{missingOriginalAt=-1,question='比較原稿、修改指示與實際回覆；保留否定與條件。'}={}){
  const sources=Array.from({length:count},(_,i)=>({ref:'r'+(i+1),sourceAuthorRole:['user','assistant','tool'][i%3],
    contentKind:'source_excerpt',text:(`第${i+1}筆：🧪 café e\u0301 العربية 日本語。若未核可，不得公開。\n引文中的「更新」不是現在的授權。`+
      ' 合成不同議題的原件，條件及否定並未證明實際完成。'.repeat(12))}));
  sources.forEach(row=>{row.evidenceHash=loopHash(row.text);row.codePoints=[...row.text].length;});
  const evidence=sources.map((row,i)=>({...row,messageRecordedAt:new Date(Date.UTC(2026,8,1,0,i)).toISOString(),
    citation:{text:[...row.text].slice(0,12).join(''),start:0,end:12,unit:'unicode_code_points'}}));
  const replyBindings=sources.filter((_,i)=>i%3===1).map((row,i)=>({assistantRef:row.ref,userRef:sources[i*3].ref}));
  return {result:{kind:'cmcp_history_query_result',requestId:'synthetic-navigation-'+count,publication:{status:'verified'},
    aggregate:{question,evidence,navigationOnly:true,coverage:{completedSources:count}}},
    verifiedReadSources:{manifestHash:loopHash(sources),sources:sources.filter((_,i)=>i!==missingOriginalAt),replyBindings},
    needBasis:'prior_content_reference',maxProjectionBytes:8192,projection:{context:{evidence:[]}}};
}
function legacy(){return {kind:'cmcp_answer_material_navigation',question:'比較合成原稿。',maxSelectedSources:8,
  coverage:{kind:'formal_read_original_candidates_not_all_history',eligibleSources:3,readSources:3,answerProjectionBytes:8192},
  columns:['ref','role','recordedAt','replyToRef','locatorText','complete'],roleCodes:{u:'user',a:'assistant',t:'tool'},
  sources:[['r1','u','2026-09-27T23:59:00.000Z',null,'只有核可後才能公開。',true],
    ['r2','a','2026-09-28T00:01:00.000Z','r1','尚待核可，不能直接公開。',true],
    ['r3','t',null,null,'合成工具來源，時間未知。',false]]};}
function journal(){const entries=[];return {entries,read:async()=>entries,
  append:async(kind,value)=>entries.push({record:{kind,value:structuredClone(value)}})};}

await test('舊六欄導航輸入保留原角色時間與回覆關係',async()=>{
  const input=legacy(),request=buildCmcpAnswerMaterialSelectionRequest(input);
  assert.deepEqual(request.input,input);assert.deepEqual(request.schema.properties.refs.items.enum,['r1','r2','r3']);
  assert.equal(request.schema.properties.refs.maxItems,8);assert.equal(bytes(input)<=10500,true);
  const selected={status:'selected',refs:['r1','r2'],reason:'合成回覆關係'};
  assert.deepEqual(validateCmcpAnswerMaterialSelection(selected,input),selected);
  return {modelCalls:0};
});

await test('非法來源與回覆關係不得升成合法導航',async()=>{
  for(const mutate of [input=>input.sources[0][0]='r0',input=>input.sources[1][0]='r1',
    input=>input.sources[0][1]='system',input=>input.sources[1][3]='r999',input=>input.sources[0][4]=null,
    input=>input.sources[0][5]='true',input=>input.sources[0].push('額外欄位')]){
    const input=legacy();mutate(input);assert.throws(()=>buildCmcpAnswerMaterialSelectionRequest(input),/invalid_answer_material_navigation/);
  }
  for(const plan of [{status:'selected',refs:['r999'],reason:''},{status:'selected',refs:['r1','r1'],reason:''},
    {status:'needs_source',refs:['r1'],reason:''},{status:'selected',refs:[],reason:''}]){
    assert.throws(()=>validateCmcpAnswerMaterialSelection(plan,legacy()),/invalid_answer_material_selection/);
  }
  return {modelCalls:0};
});

for(const count of [111,128])await test(`${count}筆來源分批保留全集合與精確Unicode片段`,async()=>{
  const options=fixture(count),before=structuredClone(options),prepared=prepareCmcpAnswerMaterialSelection(options);
  assert.equal(prepared.batches.length,Math.ceil(count/32));assert.ok(prepared.batches.length<=4);
  const offered=prepared.batches.flatMap(batch=>batch.sources.map(row=>row[0]));
  assert.deepEqual(offered,options.result.aggregate.evidence.map(row=>row.ref));assert.equal(new Set(offered).size,count);
  const measurements=[];
  for(const [i,batch] of prepared.batches.entries()){
    assert.equal(batch.sources.length<=32,true);assert.deepEqual(batch.globalSourceRefs,offered);
    assert.equal(batch.coverage.readSources,count);assert.equal(batch.coverage.eligibleSources,count);
    assert.equal(batch.coverage.batchIndex,i+1);assert.equal(batch.coverage.batchCount,prepared.batches.length);
    assert.equal(batch.maxSelectedSources,8);assert.equal(bytes(batch)<=10500,true);
    assert.equal(buildCmcpAnswerMaterialSelectionRequest(batch).schema.properties.refs.maxItems,8);
    const wire=buildCmcpDeepSeekWireRequest({purpose:'answer_material_select',input:batch,config:DEEPSEEK_LOOP_CONFIG});
    assert.ok(Buffer.byteLength(wire.body)<=16384);
    for(const row of batch.sources){
      const original=options.result.aggregate.evidence.find(item=>item.ref===row[0]);
      assert.equal(row[1],{user:'u',assistant:'a',tool:'t'}[original.sourceAuthorRole]);assert.equal(row[2],original.messageRecordedAt);
      const reply=options.verifiedReadSources.replyBindings.find(item=>item.assistantRef===row[0]);assert.equal(row[3],reply?.userRef??null);
      assert.ok(original.text.includes(row[4]));assert.ok(row[4].length>0);
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(row[4]),'不可切斷代理對字元');
      assert.equal(row[5],row[4]===original.text,'只有全部保留正文才宣告完整');
      assert.ok(bytes(row[4])>=120,'128 JSONbytes 最低配置允許末字元留白，不可退化到幾個字');
    }
    measurements.push({sources:batch.sources.length,navigationBytes:bytes(batch),wireBytes:Buffer.byteLength(wire.body)});
  }
  assert.deepEqual(options,before,'導航不修改正式閱讀原文或集合');
  assert.equal(prepared.binding.manifestHash,options.verifiedReadSources.manifestHash);
  assert.equal(prepared.binding.sources.length,count);
  return {modelCalls:0,sources:count,batches:measurements};
});

await test('跨批reply僅支援導航不能直接選未提供原文',async()=>{
  const prepared=prepareCmcpAnswerMaterialSelection(fixture(111));
  const batch=prepared.batches.find(input=>input.sources.some(row=>row[3]!==null&&!input.sources.some(item=>item[0]===row[3])));
  assert.ok(batch,'合成集合具有跨批回覆關係');
  const ref=batch.sources.find(row=>row[3]!==null&&!batch.sources.some(item=>item[0]===row[3]))[3];
  buildCmcpAnswerMaterialSelectionRequest(batch);
  assert.throws(()=>validateCmcpAnswerMaterialSelection({status:'selected',refs:[ref],reason:'錯用全域refs'},batch),/invalid_answer_material_selection/);
  for(const mutate of [input=>input.globalSourceRefs.push(input.globalSourceRefs[0]),input=>input.globalSourceRefs.push('r0'),
    input=>input.globalSourceRefs=input.globalSourceRefs.filter(value=>value!==ref),input=>input.globalSourceRefs=[],
    input=>input.globalSourceRefs='not-an-array']){
    const altered=structuredClone(batch);mutate(altered);assert.throws(()=>buildCmcpAnswerMaterialSelectionRequest(altered),/invalid_answer_material_navigation/);
  }
  return {modelCalls:0,crossBatchReplyRef:ref};
});

await test('小集合維持單次且缺完整原件不假稱全文',async()=>{
  const options=fixture(8,{missingOriginalAt:1}),prepared=prepareCmcpAnswerMaterialSelection(options);
  assert.ok(prepared.input);assert.equal(prepared.batches,undefined);
  const missing=prepared.input.sources.find(row=>row[0]==='r2');
  assert.equal(missing[4],options.result.aggregate.evidence[1].citation.text);assert.equal(missing[5],false);
  const log=journal();let calls=0;const result=await selectCmcpAnswerMaterial({prepared,journal:log,valid:async()=>true,
    adapter:{request:async()=>{calls++;return {value:{status:'selected',refs:['r1'],reason:''}};}}});
  assert.equal(result.modelCalls,1);assert.equal(calls,1);return {simulatedModelCalls:1};
});

await test('四批及合併共五次且合併只使用被選原文',async()=>{
  const options=fixture(128),prepared=prepareCmcpAnswerMaterialSelection(options),log=journal(),calls=[];
  const marker='選材判斷理由不能當作原始來源';let shortlisted=[];
  const adapter={request:async(purpose,input,{canAttempt})=>{assert.equal(await canAttempt(),true);calls.push(structuredClone(input));
    assert.equal(purpose,'answer_material_select');assert.ok(bytes(input)<=10500);assert.equal(JSON.stringify(input).includes(marker),false);
    if(input.coverage.selectionStage==='frozen_collection_batch'){
      const refs=input.sources.slice(0,8).map(row=>row[0]);shortlisted.push(...refs);return {value:{status:'selected',refs,reason:marker}};
    }
    assert.equal(input.coverage.selectionStage,'merge_batch_candidates');assert.deepEqual(input.sources.map(row=>row[0]),shortlisted);
    assert.equal(input.sources.length,32);assert.equal(input.coverage.shortlistedSources,32);
    for(const row of input.sources)assert.ok(options.verifiedReadSources.sources.find(source=>source.ref===row[0]).text.includes(row[4]));
    return {value:{status:'selected',refs:input.sources.filter((_,i)=>i%8===0).map(row=>row[0]),reason:'合成最終選取'}};
  }};
  const first=await selectCmcpAnswerMaterial({prepared,journal:log,adapter,valid:async()=>true});
  assert.equal(first.modelCalls,5);assert.equal(first.completedSelectionStages,5);assert.equal(first.navigationBatches,4);
  assert.equal(first.stages.length,5);assert.equal(calls.length,5);assert.ok(first.plan.refs.length<=8);
  assert.deepEqual(first.plan.refs,['r1','r33','r65','r97']);
  assert.equal(log.entries.filter(row=>row.record.kind==='answer_material_selection_batch').length,5);
  const replay=await selectCmcpAnswerMaterial({prepared,journal:log,adapter,valid:async()=>true});
  assert.equal(replay.modelCalls,0);assert.equal(replay.completedSelectionStages,5);assert.equal(calls.length,5);
  return {simulatedModelCalls:5,mergeCandidates:32};
});

await test('不同批次真正歧義不得被其他命中抵銷',async()=>{
  const prepared=prepareCmcpAnswerMaterialSelection(fixture(111)),log=journal();let calls=0;
  const result=await selectCmcpAnswerMaterial({prepared,journal:log,valid:async()=>true,adapter:{request:async(purpose,input)=>{
    calls++;assert.equal(input.coverage.selectionStage,'frozen_collection_batch');
    return {value:input.coverage.batchIndex===2?{status:'needs_clarification',refs:[],reason:'合成同名歧義'}:
      {status:'selected',refs:[input.sources[0][0]],reason:'本批另有命中'}};}}});
  assert.equal(result.plan.status,'needs_clarification');assert.deepEqual(result.plan.refs,[]);
  assert.equal(calls,4);assert.equal(result.modelCalls,4);assert.equal(result.completedSelectionStages,4);return {simulatedModelCalls:4};
});

await test('中斷後接續只重做未完成批次且累計不重置',async()=>{
  const prepared=prepareCmcpAnswerMaterialSelection(fixture(111)),log=journal();let valid=true,totalCalls=0;
  const request=async(purpose,input)=>{totalCalls++;if(totalCalls===3)valid=false;
    return {value:{status:'selected',refs:[input.sources[0][0]],reason:'合成選材'}};};
  await assert.rejects(()=>selectCmcpAnswerMaterial({prepared,journal:log,valid:async()=>valid,adapter:{request}}),/cancelled_or_changed/);
  assert.equal(totalCalls,3);assert.equal(log.entries.filter(row=>row.record.kind==='answer_material_selection_batch').length,2);
  assert.equal(log.entries.some(row=>row.record.kind==='answer_material_selection'),false);
  valid=true;const resumed=await selectCmcpAnswerMaterial({prepared,journal:log,valid:async()=>valid,adapter:{request}});
  assert.equal(resumed.modelCalls,3);assert.equal(resumed.completedSelectionStages,5);assert.equal(totalCalls,6,'失效嘗試仍已發生，不拿邏輯階段數當真正POST數');
  assert.deepEqual(resumed.stages.map(stage=>stage.replayed),[true,true,false,false,false]);
  assert.equal(log.entries.filter(row=>row.record.kind==='answer_material_selection').length,1);
  return {simulatedModelCalls:6,completedLogicalStages:5,resumedNewCalls:3};
});

await test('分批與合併停存正文不留下各階段理由',async()=>{
  const prepared=prepareCmcpAnswerMaterialSelection(fixture(111)),log=journal();let calls=0;
  const result=await selectCmcpAnswerMaterial({prepared,journal:log,valid:async()=>true,retainReason:false,
    adapter:{request:async(purpose,input,options)=>{calls++;assert.equal(options.persistBodies,false);
      return {value:{status:'selected',refs:[input.sources[0][0]],reason:'不得落盤的合成理由'}};}}});
  assert.equal(calls,5);assert.equal(result.plan.reason,'');assert.equal(JSON.stringify(log.entries).includes('不得落盤'),false);
  for(const row of log.entries)assert.equal(row.record.value.plan.reason,'');return {simulatedModelCalls:5};
});

await test('單批命中及全批有限未命中不多做合併',async()=>{
  for(const selectedBatch of [null,3]){
    const prepared=prepareCmcpAnswerMaterialSelection(fixture(111)),log=journal();let calls=0;
    const result=await selectCmcpAnswerMaterial({prepared,journal:log,valid:async()=>true,adapter:{request:async(purpose,input)=>{
      calls++;assert.equal(input.coverage.selectionStage,'frozen_collection_batch');
      return {value:input.coverage.batchIndex===selectedBatch?{status:'selected',refs:[input.sources[0][0]],reason:'合成命中'}:
        {status:'needs_source',refs:[],reason:'本批無必要原件'}};}}});
    assert.equal(calls,4);assert.equal(result.modelCalls,4);assert.equal(result.plan.status,selectedBatch?'selected':'needs_source');
    if(!selectedBatch)assert.match(result.plan.reason,/不代表全部History不存在/);
  }return {simulatedModelCalls:8};
});

await test('選材重播仍核對目前控制且不再呼叫模型',async()=>{
  const prepared={input:legacy(),binding:{inputHash:loopHash(legacy()),requestId:'合成重播'}},log=journal();let calls=0;
  const adapter={request:async(purpose,input,{canAttempt})=>{assert.equal(await canAttempt(),true);calls++;
    return {value:{status:'selected',refs:['r1','r2'],reason:'僅為合成來源選取'}};}};
  const first=await selectCmcpAnswerMaterial({prepared,journal:log,adapter,valid:async()=>true});assert.equal(first.modelCalls,1);
  const replay=await selectCmcpAnswerMaterial({prepared,journal:log,adapter,valid:async()=>true});assert.equal(replay.replayed,true);
  assert.equal(replay.modelCalls,0);assert.equal(calls,1);
  await assert.rejects(()=>selectCmcpAnswerMaterial({prepared,journal:log,adapter,valid:async()=>false}),/cancelled_or_changed/);
  assert.equal(calls,1);assert.equal(log.entries.length,1);return {simulatedModelCalls:1};
});

await test('晚到取消不寫入選材且停存正文不留下理由',async()=>{
  const prepared={input:legacy(),binding:{inputHash:loopHash(legacy()),requestId:'合成取消'}},log=journal();let valid=true;
  await assert.rejects(()=>selectCmcpAnswerMaterial({prepared,journal:log,valid:async()=>valid,adapter:{request:async()=>{
    valid=false;return {value:{status:'selected',refs:['r1'],reason:'晚到的合成理由'}};}}}),/cancelled_or_changed/);
  assert.equal(log.entries.length,0);let retained;
  const result=await selectCmcpAnswerMaterial({prepared,journal:log,valid:async()=>true,retainReason:false,adapter:{
    request:async(purpose,input,options)=>{retained=options.persistBodies;return {value:{status:'selected',refs:['r1'],reason:'不能落盤的合成理由'}};}}});
  assert.equal(retained,false);assert.equal(result.plan.reason,'');assert.equal(JSON.stringify(log.entries).includes('不能落盤'),false);
  return {simulatedModelCalls:2};
});

await test('超過來源上限明示不足且保留讀取集合',async()=>{
  const input=fixture(129),before=structuredClone(input),result=prepareCmcpAnswerMaterialSelection(input);
  assert.deepEqual(result,{unavailable:'material_navigation_source_limit',eligibleSources:129});assert.deepEqual(input,before);
  const log=journal();let calls=0;const selected=await selectCmcpAnswerMaterial({prepared:result,journal:log,valid:async()=>true,
    adapter:{request:async()=>{calls++;throw Error('不應呼叫');}}});
  assert.equal(selected.modelCalls,0);assert.equal(calls,0);assert.equal(log.entries.length,0);return {modelCalls:0,sources:129};
});

const result={kind:'offline_material_navigation_capacity_smoke',syntheticFixtures:true,productApiPosts:0,startedAt,
  endedAt:new Date().toISOString(),passed:cases.filter(row=>row.status==='PASS').length,failed:cases.filter(row=>row.status==='FAIL').length,cases};
await fs.writeFile(path.join(root,'results.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({passed:result.passed,failed:result.failed,productApiPosts:0,results:path.join(root,'results.json')}));
process.exitCode=result.failed?1:0;
