import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createCmcpReactivationStores,createCmcpHistoryReactivation} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {buildLoopRequest,validateLoopSchema} from '../src/cmcp-guard/cmcp-local-loop-protocol.js';
import {createLocalLoopJournal} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {REACTIVATION_FIXTURE as F,seedCmcpReactivationFixture} from './cmcp-history-reactivation-fixtures.mjs';

const base=path.resolve(process.env.CMCP_GENERAL_ANSWER_NEED_TEST_ROOT??'logs/general-answer-need-smoke');
await fs.mkdir(base,{recursive:true});
const root=path.join(base,'run-'+randomUUID());
await fs.mkdir(root);
const seedRoot=path.join(root,'seed');
await seedCmcpReactivationFixture(seedRoot);
const cases=[];
async function test(name,fn){try{const result=await fn();cases.push({name,status:'PASS',...result});console.log('PASS '+name);}
  catch(error){cases.push({name,status:'FAIL',error:error.message});console.error('FAIL '+name+'\n'+error.stack);}}
async function make(name,{probe,second,lookup,probeTransport,secondTransport,preflightRequest}={}){
  const dir=path.join(root,name);await fs.cp(seedRoot,dir,{recursive:true});
  const stores=createCmcpReactivationStores({root:dir,scopeId:F.scopeId}),calls=[],writes=[];
  const original=stores.history;stores.history={...original,writeEvidence:async input=>{writes.push(input);return original.writeEvidence(input);}};
  const adapter={preflightRequest,async request(purpose,input){calls.push({purpose,input:structuredClone(input)});
    assert.equal(purpose,'recall_answer');return {value:structuredClone(input.probeHistoricalNeed?probe:second),
      transport:structuredClone(input.probeHistoricalNeed?probeTransport??{status:'completed'}:secondTransport??{status:'completed'})};}};
  const component=createCmcpHistoryReactivation({stores,allowedSourceIds:[],limits:F.limits,adapter,onGeneralAnswerNeed:lookup??(async()=>{throw Error('unexpected_lookup');})});
  return {dir,stores,calls,writes,component};
}
async function journal(dir){return (await createLocalLoopJournal({root:path.join(dir,'focus'),name:'local-focus-v1'}).read()).map(row=>row.record);}

await test('probe_schema_separates_answer_from_historical_need',async()=>{
  const request=buildLoopRequest('recall_answer',{question:'請改前次原句',probeHistoricalNeed:true});
  assert.deepEqual(Object.keys(request.schema.properties),['historyNeed','text','sourceRefs']);
  assert.equal(request.instructions.includes('With no context answer the new question normally'),false);
  assert.ok(request.instructions.indexOf('先判定當前問題的材料依賴')<request.instructions.indexOf('Answer naturally.'));
  const ordinary=buildLoopRequest('recall_answer',{question:'目前的新問題'});
  assert.equal(ordinary.instructions.includes('With no context answer the new question normally'),true);
  assert.equal(validateLoopSchema({text:'',sourceRefs:[],historyNeed:{basis:'prior_content_reference',quote:'前次原句'}},request.schema),true);
  assert.equal(validateLoopSchema({text:'猜測的原句',sourceRefs:['r1'],historyNeed:{basis:'prior_content_reference',quote:'前次原句'}},request.schema),false);
  return {modelCalls:0};
});
await test('ordinary_question_uses_one_response_without_lookup',async()=>{
  const ctx=await make('ordinary',{probe:{text:'自然回答。',sourceRefs:[],historyNeed:{basis:'current_input_sufficient',quote:''}}});
  const result=await ctx.component.submit({text:'今天可以聊點別的嗎？',timeContext:F.timeContext,probeHistoricalNeed:true});
  assert.equal(result.status,'answered');assert.equal(result.answer,'自然回答。');assert.equal(result.modelCalls,1);
  assert.deepEqual(ctx.calls.map(call=>call.purpose),['recall_answer']);
  assert.deepEqual(ctx.writes.map(row=>row.sourceAuthorRole),['user','assistant']);
  assert.equal((await ctx.stores.history.resolve(result.queryPointer)).evidence.messageRecordedAt,new Date(F.timeContext.now).toISOString());
  assert.ok((await journal(ctx.dir)).some(row=>row.kind==='general_answer_need_raw'&&row.value.raw?.historyNeed?.basis==='current_input_sufficient'));
  return {modelCalls:1};
});
await test('historical_reference_waits_for_verified_bounded_context',async()=>{
  let lookups=0,verifications=0;const question='請依前次原句改寫第二項。';
  const provisional='我猜先前第二項可以這樣改，但還沒查原文。';
  const ctx=await make('history',{probe:{text:provisional,sourceRefs:[],historyNeed:{basis:'prior_content_reference',quote:'前次原句'}},
    probeTransport:{status:'completed',http:200,responseSha256:'a'.repeat(64),usage:{input_tokens:31,output_tokens:17,total_tokens:48,
      input_tokens_details:{cached_tokens:5},output_tokens_details:{reasoning_tokens:4}},
      outputText:JSON.stringify({text:provisional}),responseBody:provisional,other:{body:provisional}},
    second:{text:'第二項改寫已依前次原句完成。',sourceRefs:['c1'],evidenceStatus:'sufficient'},
    lookup:async({query,text,temporal,need,valid})=>{lookups++;assert.equal(query.content.body,question);
      assert.equal(query.sourceAuthorRole,'user');assert.equal(query.messageRecordedAt,new Date(F.timeContext.now).toISOString());
      assert.equal(text,question);assert.equal(temporal.now,'2026-09-14T07:20:00.000Z');assert.equal(need.basis,'prior_content_reference');
      assert.equal(await valid(),true);return {context:{kind:'answer_history',status:'read',context:{kind:'bounded_exact_history_lookup',
        evidence:[{sourceRef:'c1',sourceAuthorRole:'assistant',content:{kind:'exact_source_quote',text:'原始第二項。'}}]}},
        sourceRefs:['c1'],verify:async()=>{verifications++;return true;},receipt:{kind:'synthetic_test_receipt',sourceBytes:21,modelCalls:0}};}});
  const result=await ctx.component.submit({text:question,timeContext:F.timeContext,probeHistoricalNeed:true});
  assert.equal(result.status,'answered');assert.equal(result.modelCalls,2);assert.equal(lookups,1);assert.ok(verifications>=3);
  assert.deepEqual(ctx.calls.map(call=>!!call.input.context),[false,true]);
  assert.equal(ctx.calls[1].input.runtimeTime.now,new Date(F.timeContext.now).toISOString());
  assert.deepEqual(result.answerSourceRefs,['c1']);assert.deepEqual(ctx.writes.map(row=>row.sourceAuthorRole),['user','assistant']);
  assert.ok((await journal(ctx.dir)).some(row=>row.kind==='general_answer_lookup'&&row.value.needBasis==='prior_content_reference'));
  assert.equal(ctx.writes[1].content.body,'第二項改寫已依前次原句完成。');
  assert.equal(JSON.stringify(result).includes(provisional),false,'provisional wording never reaches the result');
  assert.equal(JSON.stringify(ctx.calls[1].input).includes(provisional),false,'fresh answer input does not reuse provisional text');
  assert.equal(JSON.stringify(await journal(ctx.dir)).includes(provisional),false,'local journal retains only the discard marker');
  const discarded=(await journal(ctx.dir)).find(row=>row.kind==='general_answer_need_raw');
  assert.equal(discarded.value.raw,null,'provisional historical text is not saved in the local journal');
  assert.equal(discarded.value.bodyRetention,'discarded_provisional_historical_text');
  assert.equal(discarded.value.discardedProvisionalText.bytes,Buffer.byteLength(provisional));
  assert.equal(discarded.value.transport.status,'completed');
  assert.equal(discarded.value.transport.http,200);
  assert.equal(discarded.value.transport.responseSha256,'a'.repeat(64));
  assert.equal(discarded.value.transport.usage.total_tokens,48);
  assert.equal(Object.hasOwn(discarded.value.transport,'outputText'),false);
  assert.equal(Object.hasOwn(discarded.value.transport,'responseBody'),false);
  return {modelCalls:2,formalRead:'synthetic_callback_only'};
});
await test('false_quote_and_invalid_source_ref_fail_without_assistant_save',async()=>{
  const wrong=await make('quote',{probe:{text:'',sourceRefs:[],historyNeed:{basis:'prior_content_reference',quote:'不存在的原句'}}});
  await assert.rejects(()=>wrong.component.submit({text:'請改前次原句。',timeContext:F.timeContext,probeHistoricalNeed:true}),/quote|fragment/);
  assert.deepEqual(wrong.writes.map(row=>row.sourceAuthorRole),['user']);
  const bad=await make('bad-ref',{probe:{text:'',sourceRefs:[],historyNeed:{basis:'prior_content_reference',quote:'前次原句'}},
    second:{text:'捏造引用。',sourceRefs:['c9'],evidenceStatus:'sufficient'},lookup:async()=>({context:{kind:'answer_history',status:'read',context:{evidence:[{sourceRef:'c1'}]}},sourceRefs:['c1'],verify:async()=>true,receipt:{kind:'test',modelCalls:0}})});
  await assert.rejects(()=>bad.component.submit({text:'請改前次原句。',timeContext:F.timeContext,probeHistoricalNeed:true}),/source_refs/);
  assert.deepEqual(bad.writes.map(row=>row.sourceAuthorRole),['user']);
  const badProbe=await make('bad-probe-ref',{probe:{text:'未查證的草稿',sourceRefs:['c1'],
    historyNeed:{basis:'prior_content_reference',quote:'前次原句'}}});
  await assert.rejects(()=>badProbe.component.submit({text:'請改前次原句。',timeContext:F.timeContext,probeHistoricalNeed:true}),
    /invalid_general_answer_need_schema|invalid_general_answer_need_disposition/);
  assert.equal(badProbe.calls.length,1,'wrong probe sourceRefs cannot enter the formal lookup or answer');
  assert.deepEqual(badProbe.writes.map(row=>row.sourceAuthorRole),['user']);
  return {modelCalls:3};
});
await test('control_change_during_lookup_blocks_late_second_answer',async()=>{
  let enter,release;const reached=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
  const ctx=await make('cancel',{probe:{text:'先查原文前的暫擬內容。',sourceRefs:[],historyNeed:{basis:'prior_content_reference',quote:'前次原句'}},
    lookup:async()=>{enter();await gate;return {context:{kind:'answer_history',status:'read',context:{evidence:[{sourceRef:'c1'}]}},sourceRefs:['c1'],verify:async()=>true,receipt:{kind:'test',modelCalls:0}};}});
  const pending=ctx.component.submit({text:'請改前次原句。',timeContext:F.timeContext,probeHistoricalNeed:true});
  await reached;ctx.component.setControls({enabled:false,clean:false});release();
  await assert.rejects(pending,/cancelled/);assert.equal(ctx.calls.length,1);
  assert.deepEqual(ctx.writes.map(row=>row.sourceAuthorRole),['user']);
  return {modelCalls:1};
});
await test('assistant_save_off_does_not_store_generated_answer_body',async()=>{
  const ctx=await make('save-off',{probe:{text:'普通回答。',sourceRefs:[],historyNeed:{basis:'current_input_sufficient',quote:''}},
    probeTransport:{status:'completed',outputText:'普通回答。',responseBody:'普通回答。',usage:{input_tokens:7,output_tokens:3,total_tokens:10}}});
  const result=await ctx.component.submit({text:'只回答目前問題。',timeContext:F.timeContext,probeHistoricalNeed:true,saveAssistant:false});
  assert.equal(result.answerPointer,null);assert.deepEqual(ctx.writes.map(row=>row.sourceAuthorRole),['user']);
  assert.ok((await journal(ctx.dir)).some(row=>row.kind==='general_answer_need_raw'&&row.value.raw===null));
  assert.equal(JSON.stringify(await journal(ctx.dir)).includes('普通回答。'),false,'save-off answer is absent from the journal transport too');
  return {modelCalls:1};
});

await test('assistant_save_off_does_not_store_formal_second_answer_transport_body',async()=>{
  const answer='查證後但不保存的最終答覆。';
  const ctx=await make('save-off-formal',{probe:{text:'',sourceRefs:[],historyNeed:{basis:'prior_content_reference',quote:'前次原句'}},
    second:{text:answer,sourceRefs:['c1'],evidenceStatus:'sufficient'},
    secondTransport:{status:'completed',outputText:JSON.stringify({text:answer}),responseBody:answer,usage:{input_tokens:19,output_tokens:8,total_tokens:27}},
    lookup:async()=>({context:{kind:'answer_history',status:'read',context:{evidence:[{sourceRef:'c1'}]}},sourceRefs:['c1'],
      verify:async()=>true,receipt:{kind:'synthetic_test_receipt',sourceBytes:21,modelCalls:0}})});
  const result=await ctx.component.submit({text:'請依前次原句改寫。',timeContext:F.timeContext,probeHistoricalNeed:true,saveAssistant:false});
  assert.equal(result.answer,answer);assert.equal(result.answerPointer,null);
  const rows=await journal(ctx.dir),record=rows.find(row=>row.kind==='general_answer_result_raw');
  assert.equal(JSON.stringify(rows).includes(answer),false);
  assert.equal(record.value.raw,null);
  assert.equal(record.value.transport.status,'completed');
  assert.equal(record.value.transport.usage.total_tokens,27);
  return {modelCalls:2};
});

await test('formal_aggregate_keeps_all_bounded_evidence_and_counts_lookup_calls',async()=>{
  const refs=['c1','c2','c3'];
  const ctx=await make('formal-many',{probe:{text:'',sourceRefs:[],historyNeed:{basis:'prior_content_reference',quote:'前次各版'}}
    ,second:{text:'三個版本的差異。',sourceRefs:refs,evidenceStatus:'sufficient'},
    lookup:async()=>({context:{kind:'answer_history',status:'read',context:{evidence:refs.map(sourceRef=>({sourceRef}))}},
      sourceRefs:refs,verify:async()=>true,receipt:{kind:'synthetic_test_receipt',modelCalls:3}})});
  const result=await ctx.component.submit({text:'請對照前次各版。',timeContext:F.timeContext,probeHistoricalNeed:true});
  assert.equal(result.modelCalls,5);assert.deepEqual(result.answerSourceRefs,refs);
  assert.deepEqual(ctx.calls[1].input.allowedSourceRefs,refs);
  assert.equal(ctx.calls[1].input.context.context.evidence.length,3);
  return {modelCallsFromAdapter:2,simulatedFormalLookupModelCalls:3};
});
await test('wire_overflow_reprojects_same_formal_lookup_before_second_request',async()=>{
  const verify=async()=>true,question='請依前次原句改寫。';
  const view=refs=>({kind:'answer_history',status:'read',context:{kind:'bounded_exact_history_lookup',
    evidence:refs.map(sourceRef=>({sourceRef,content:{kind:'exact_source_quote',text:'完整引文 '+sourceRef}}))}});
  const receipt={requestId:'synthetic-wire',modelCalls:2,projection:{maxProjectionBytes:8000}};
  const projected=refs=>({context:view(refs),sourceRefs:refs,verify,receipt:{...receipt,referencedEvidence:refs}});
  const ctx=await make('wire-overflow',{probe:{text:'',sourceRefs:[],historyNeed:{basis:'prior_content_reference',quote:'前次原句'}},
    second:{text:'依引文改寫。',sourceRefs:['c1'],evidenceStatus:'sufficient'},
    preflightRequest:(purpose,input)=>{assert.equal(purpose,'recall_answer');return {
      requestBytes:input.allowedSourceRefs.length===2?16389:15000,requestByteLimit:16384};},
    lookup:async()=>({...projected(['c1','c2']),reproject:()=>projected(['c1'])})});
  const result=await ctx.component.submit({text:question,timeContext:F.timeContext,probeHistoricalNeed:true});
  assert.equal(result.status,'answered');assert.equal(result.modelCalls,4);
  assert.deepEqual(ctx.calls.map(call=>call.purpose),['recall_answer','recall_answer']);
  assert.deepEqual(ctx.calls[1].input.allowedSourceRefs,['c1']);
  assert.deepEqual(result.lookupReceipt.referencedEvidence,['c1']);
  assert.equal(result.lookupReceipt.wirePreflight.requestBytes,15000);
  assert.equal(result.lookupReceipt.wirePreflight.reprojections,1);
  assert.deepEqual((await journal(ctx.dir)).find(row=>row.kind==='general_answer_lookup').value.projectedSourceRefs,['c1']);
  return {modelCallsFromAdapter:2,simulatedFormalLookupModelCalls:2};
});

await fs.writeFile(path.join(root,'results.json'),JSON.stringify({kind:'offline_general_answer_need_smoke',productApiPosts:0,root,cases},null,2));
console.log(JSON.stringify({passed:cases.filter(row=>row.status==='PASS').length,failed:cases.filter(row=>row.status==='FAIL').length,
  productApiPosts:0,results:path.join(root,'results.json')}));
process.exitCode=cases.some(row=>row.status==='FAIL')?1:0;
