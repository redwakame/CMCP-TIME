// 合成原文、正式投影與 fetch 替身；不讀憑證、不呼叫任何外部 API。
// 驗證條件式回答設定沿共用授權、wire 預檢及取消／不保存邊界。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCmcpBoundedProviderAdapter,boundedProviderProtocolHash,CMCP_HISTORY_ANSWER_PROFILE} from '../src/cmcp-guard/cmcp-bounded-provider-adapter.js';
import {authorizeRuntimeBudget,readRuntimeBudget} from '../src/cmcp-guard/cmcp-model-job-budget.js';
import {createLocalLoopJournal,loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {projectCmcpAnswerHistoryLookup} from '../src/cmcp-guard/cmcp-answer-history.js';
import {buildLoopRequest,validateLoopSchema,decodeLoopResponse} from '../src/cmcp-guard/cmcp-local-loop-protocol.js';

const base=path.resolve(process.env.CMCP_HISTORY_PROFILE_TEST_ROOT??'logs/history-answer-profile-smoke');
const root=path.join(base,'run-'+randomUUID());await fs.mkdir(root,{recursive:true});
const startedAt=new Date().toISOString(),cases=[];
async function test(name,fn){try{const evidence=await fn();cases.push({name,status:'PASS',...evidence});console.log('PASS '+name);}
  catch(error){cases.push({name,status:'FAIL',error:error.message});console.error('FAIL '+name+'\n'+error.stack);}}
const text='合成原文：只能在核可後公開；未核可的版本維持內部使用。';
const raw={kind:'cmcp_history_query_result',requestId:'synthetic-profile-fixture',sourceCollectionKind:'ordinary',status:'complete',
  publication:{status:'verified'},aggregate:{kind:'cmcp_history_aggregate',purpose:'evidence_lookup',question:'比較先前版本。',
    status:'complete_within_frozen_scope',finding:'supported_evidence',evidence:[{ref:'r1',sourceAuthorRole:'assistant',
      supportRelation:'requested_detail',citation:{unit:'unicode_code_points',start:0,end:[...text].length,text},
      contentKind:'source_excerpt',messageRecordedAt:'2026-09-27T08:00:00.000Z',eventOccurredAt:null}],
    coverage:{sourceCount:1,completedSources:1,unavailableSources:0,unread:[],unclassified:[],uncertain:[],ambiguousRevisions:[],partialSources:[]}}};
const projection=projectCmcpAnswerHistoryLookup({result:raw,timezone:'UTC',maxProjectionBytes:8192,needBasis:'prior_content_reference'});
const formal={question:'比較先前版本。',context:projection.model,allowedSourceRefs:['r1'],runtimeTime:{now:'2026-09-27T09:00:00.000Z',timezone:'UTC'}};
const ordinary={question:'說明本次一般問題。'};
const probe={question:'請改前次原稿。',probeHistoricalNeed:true};
const answer={text:'合成回答：這是先前 Assistant 的限制文字，不是 User 已核可的證據。',sourceRefs:['r1'],evidenceStatus:'sufficient'};
const ordinaryAnswer={text:'本次一般回答。',sourceRefs:[]};
const probeAnswer={historyNeed:{basis:'prior_content_reference',quote:'前次原稿'},text:'',sourceRefs:[]};
const navigation={kind:'cmcp_answer_material_navigation',question:'先前原稿是哪份？',maxSelectedSources:8,
  columns:['ref','role','recordedAt','replyToRef','locatorText','complete'],roleCodes:{u:'user',a:'assistant',t:'tool'},
  sources:[['r1','a','2026-09-27T08:00:00.000Z',null,text,true]]};
const finalReply=(value,chat=false)=>new Response(JSON.stringify(chat?
  {object:'chat.completion',model:'deepseek-flash',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}],usage:{}}:
  {id:'synthetic',model:'deepseek-flash',status:'completed',usage:{},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}]}),{status:200});
async function environment(name,limit=4,options={}){
  const dir=path.join(root,name),binding=loopHash(['合成設定測試',name]),authorizationId='synthetic-history-profile';
  const auth={root:path.join(dir,'budget'),binding,sessionId:'synthetic-session-1',expectedAuthorizationId:authorizationId};
  await authorizeRuntimeBudget({...auth,authorizationId,limits:{deepseek:limit,codex:0},authorizedBy:'離線測試替身，非付費授權'});
  const ledgerRoot=path.join(dir,'attempts'),captured=[];
  let value=answer;
  const fetchImpl=async(url,init)=>{captured.push({url,body:init.body});return finalReply(value,options.wireFormat==='deepseek_chat');};
  const adapter=createCmcpBoundedProviderAdapter({deepseekKey:'synthetic-not-a-secret',ledgerRoot,runtimeAuthorization:auth,
    answerHistory:true,fetchImpl,...options});
  return {dir,auth,ledgerRoot,adapter,captured,fetchImpl,setReply:next=>value=next};
}
const rows=async dir=>(await createLocalLoopJournal({root:path.join(dir,'attempts'),name:'cmcp-local-loop-attempts-v1'}).read()).map(row=>row.record);
const routeRows=async dir=>(await createLocalLoopJournal({root:path.join(dir,'provider-route'),name:'cmcp-bounded-provider-v1'}).read()).map(row=>row.record);
function wireSettings(capture,reasoning,output){const body=JSON.parse(capture.body);assert.equal(body.reasoning.effort,reasoning);assert.equal(body.max_output_tokens,output);return body;}

await test('正式歷史回答長度有界擴充且一般回答與來源欄位仍受原限制',async()=>{
  const request=buildLoopRequest('recall_answer',formal),schema=request.schema;
  assert.equal(schema.properties.text.maxLength,4096);
  for(const count of [2401,2613,4096]){
    const value={...answer,text:'文'.repeat(count)};assert.equal(validateLoopSchema(value,schema),true);
    assert.deepEqual(decodeLoopResponse(value,'recall_answer',schema,request.responseMapping),value);
  }
  const unicode={...answer,text:'🧪'.repeat(4096)};
  assert.equal(unicode.text.length,8192);assert.equal(validateLoopSchema(unicode,schema),true,'按 Unicode 碼點而非 UTF-16 單位核對');
  for(const value of [{...answer,text:'文'.repeat(4097)},{...answer,text:'🧪'.repeat(4097)},
    {...answer,sourceRefs:['r999']},{...answer,sourceRefs:['r1','r1']},{...answer,extraField:'不接受額外欄位'},
    {...answer,evidenceStatus:'invented'}]){
    assert.equal(validateLoopSchema(value,schema),false);assert.throws(()=>decodeLoopResponse(value,'recall_answer',schema,request.responseMapping),/invalid_proposal_schema/);
  }
  const ordinarySchema=buildLoopRequest('recall_answer',ordinary).schema;
  const probeSchema=buildLoopRequest('recall_answer',probe).schema;
  const olderContextSchema=buildLoopRequest('recall_answer',{question:'依既有上下文回答。',context:{kind:'cmcp_host_context'}}).schema;
  for(const [candidate,base] of [[ordinarySchema,ordinaryAnswer],
    [probeSchema,{...ordinaryAnswer,historyNeed:{basis:'current_input_sufficient',quote:''}}],
    [olderContextSchema,answer]]){
    assert.equal(candidate.properties.text.maxLength,1600);
    assert.equal(validateLoopSchema({...base,text:'字'.repeat(1600)},candidate),true);
    assert.equal(validateLoopSchema({...base,text:'字'.repeat(1601)},candidate),false);
  }
  return {simulatedPosts:0,formalCodePointLimit:4096,otherCodePointLimit:1600};
});

await test('正式原文回答預檢與真正送出一致且只呼叫一次',async()=>{
  const c=await environment('formal',1);const before=await readRuntimeBudget(c.auth),pre=c.adapter.preflightRequest('recall_answer',formal);
  assert.deepEqual(await readRuntimeBudget(c.auth),before,'預檢不可預留額度');assert.equal(c.captured.length,0);
  const result=await c.adapter.request('recall_answer',formal);assert.deepEqual(result.value,answer);assert.equal(c.captured.length,1);
  const body=wireSettings(c.captured[0],'low',CMCP_HISTORY_ANSWER_PROFILE.maxOutputTokens);assert.equal(Buffer.byteLength(c.captured[0].body),pre.requestBytes);
  assert.equal(pre.requestByteLimit,16384);assert.equal(pre.fits,true);assert.deepEqual(JSON.parse(body.input[0].content),formal);
  const recorded=await rows(c.dir);assert.equal(recorded.filter(row=>row.kind==='started').length,1);
  const start=recorded.find(row=>row.kind==='started').value,end=recorded.find(row=>row.kind==='result').value;
  assert.equal(start.requestBody,c.captured[0].body);assert.equal(start.requestSha256,loopHash(c.captured[0].body));
  assert.equal(end.reasoning,'low');assert.equal(end.status,'completed');assert.equal((await readRuntimeBudget(c.auth)).used.deepseek,1);
  c.adapter.dispose();return {simulatedPosts:1,requestBytes:pre.requestBytes,requestByteLimit:pre.requestByteLimit};
});

await test('一般回答與需求判讀維持原設定且與正式回答共用重開額度',async()=>{
  const c=await environment('shared-budget',3);
  for(const [input,reply,reasoning,output] of [[formal,answer,'low',CMCP_HISTORY_ANSWER_PROFILE.maxOutputTokens],[ordinary,ordinaryAnswer,'none',1200],[probe,probeAnswer,'none',1200]]){
    c.setReply(reply);const pre=c.adapter.preflightRequest('recall_answer',input);await c.adapter.request('recall_answer',input);
    wireSettings(c.captured.at(-1),reasoning,output);assert.equal(pre.requestBytes,Buffer.byteLength(c.captured.at(-1).body));
  }
  c.adapter.dispose();const reopened=createCmcpBoundedProviderAdapter({deepseekKey:'synthetic-not-a-secret',ledgerRoot:c.ledgerRoot,
    runtimeAuthorization:{...c.auth,sessionId:'synthetic-session-2'},answerHistory:true,fetchImpl:c.fetchImpl});
  await assert.rejects(()=>reopened.request('recall_answer',formal),/runtime_budget_exhausted/);
  assert.equal(c.captured.length,3);assert.equal((await readRuntimeBudget(c.auth)).used.deepseek,3);
  assert.deepEqual((await rows(c.dir)).filter(row=>row.kind==='result').map(row=>row.value.reasoning),['low','none','none']);
  reopened.dispose();return {simulatedPosts:3,budgetAfterReopen:3};
});

await test('來源選取與沒有可讀原文的回答不啟用額外推理',async()=>{
  const c=await environment('selector-and-unavailable',3);c.setReply({status:'selected',refs:['r1'],reason:'合成選取。'});
  await c.adapter.request('answer_material_select',navigation);wireSettings(c.captured.at(-1),'none',1200);
  for(const context of [{kind:'answer_history',status:'needs_source',context:null},{kind:'answer_history',status:'read',context:{evidence:[]}}]){
    c.setReply({text:'目前供應的原文不足。',sourceRefs:[],evidenceStatus:'insufficient'});
    await c.adapter.request('recall_answer',{question:'先前原稿是什麼？',context,allowedSourceRefs:[]});wireSettings(c.captured.at(-1),'none',1200);
  }
  c.adapter.dispose();return {simulatedPosts:3};
});

await test('停用此選配或未開啟原文容量時不改變原設定',async()=>{
  for(const [name,options] of [['reasoning-none',{historyAnswerReasoning:'none'}],['history-disabled',{answerHistory:false}]]){
    const c=await environment(name,1,options);assert.equal(c.adapter.descriptor.settings.historyAnswerProfile,null);
    await c.adapter.request('recall_answer',formal);wireSettings(c.captured[0],'none',1200);c.adapter.dispose();
  }return {simulatedPosts:2};
});

await test('既有實驗設定與Chat傳輸維持原上限和不推理',async()=>{
  const dir=path.join(root,'legacy'),captured=[];const manifest={profile:'history-reactivation-v1',
    protocolHash:boundedProviderProtocolHash('history-reactivation-v1'),taskBudget:{root:path.join(dir,'total'),maxPosts:10}};
  const legacy=createCmcpBoundedProviderAdapter({deepseekKey:'synthetic-not-a-secret',ledgerRoot:path.join(dir,'attempts'),manifest,
    fetchImpl:async(url,init)=>{captured.push({url,body:init.body});return finalReply(answer);}});
  assert.equal(legacy.descriptor.settings.historyAnswerProfile,null);await legacy.request('recall_answer',formal);wireSettings(captured[0],'none',1200);legacy.dispose();
  const c=await environment('chat',1,{wireFormat:'deepseek_chat'}),pre=c.adapter.preflightRequest('recall_answer',formal);
  await c.adapter.request('recall_answer',formal);const body=JSON.parse(c.captured[0].body);
  assert.equal(c.captured[0].url,'https://api.deepseek.com/chat/completions');assert.deepEqual(body.thinking,{type:'disabled'});
  assert.equal(body.max_tokens,1200);assert.equal(body.reasoning,undefined);assert.equal(Buffer.byteLength(c.captured[0].body),pre.requestBytes);
  assert.equal((await rows(c.dir)).find(row=>row.kind==='result').value.reasoning,'none');c.adapter.dispose();return {simulatedPosts:2};
});

await test('取消前不送出且晚到結果不能回到呼叫端',async()=>{
  const c=await environment('cancel-before',2);const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(()=>c.adapter.request('recall_answer',formal,{signal:cancelled.signal}),/request_cancelled/);
  assert.equal(c.captured.length,0);assert.equal((await readRuntimeBudget(c.auth)).used.deepseek,0);c.adapter.dispose();
  const late=await environment('cancel-late',1),controller=new AbortController();let entered,release;
  const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  late.adapter.dispose();let calls=0;const adapter=createCmcpBoundedProviderAdapter({deepseekKey:'synthetic-not-a-secret',
    ledgerRoot:late.ledgerRoot,runtimeAuthorization:late.auth,answerHistory:true,fetchImpl:async()=>{calls++;entered();await gate;return finalReply(answer);}});
  const pending=adapter.request('recall_answer',formal,{signal:controller.signal});const rejection=assert.rejects(pending,/request_cancelled/);
  await ready;controller.abort();release();await rejection;assert.equal(calls,1);
  assert.equal((await readRuntimeBudget(late.auth)).used.deepseek,1,'已嘗試不得退還額度');
  assert.equal((await routeRows(late.dir)).filter(row=>row.kind==='logical_result').at(-1).value.status,'cancelled');
  adapter.dispose();return {simulatedPosts:1,preCancelledPosts:0};
});

await test('原文回覆完成後控制失效仍擋住呈現',async()=>{
  const c=await environment('late-control',1);c.adapter.dispose();let current=true,calls=0;
  const adapter=createCmcpBoundedProviderAdapter({deepseekKey:'synthetic-not-a-secret',ledgerRoot:c.ledgerRoot,
    runtimeAuthorization:c.auth,answerHistory:true,fetchImpl:async()=>{calls++;current=false;return finalReply(answer);}});
  await assert.rejects(()=>adapter.request('recall_answer',formal,{canAttempt:async()=>current}),/stale_after_provider_attempt/);
  assert.equal(calls,1);const result=(await rows(c.dir)).find(row=>row.kind==='result').value;
  assert.equal(result.remoteOutcome,'completed');assert.equal(result.status,'failed');assert.equal(result.code,'stale_after_provider_attempt');
  adapter.dispose();return {simulatedPosts:1,remoteCompletedButWithheld:true};
});

await test('不保存正文時只保留核對與用量欄位',async()=>{
  const c=await environment('no-retention',1),result=await c.adapter.request('recall_answer',formal,{persistBodies:false});
  assert.deepEqual(result.value,answer);assert.equal(result.transport.outputText,null);assert.equal(c.captured.length,1);
  const ledger=await rows(c.dir),serialized=JSON.stringify([...ledger,...await routeRows(c.dir)]);
  assert.equal(serialized.includes(text),false);assert.equal(serialized.includes(answer.text),false);
  const start=ledger.find(row=>row.kind==='started').value,end=ledger.find(row=>row.kind==='result').value;
  assert.equal(start.requestBody,null);assert.equal(end.responseBody,null);assert.equal(end.outputText,null);
  assert.equal(end.bodyRetention,'disabled_by_source_control');assert.equal(end.reasoning,'low');assert.equal(end.status,'completed');
  assert.equal(typeof start.requestSha256,'string');c.adapter.dispose();return {simulatedPosts:1,bodyStored:false};
});

await test('超出原wire限制仍拒絕且不消耗額度',async()=>{
  const c=await environment('wire-overflow',1),input={...formal,question:'很長的合成問題。'.repeat(2000)};
  const pre=c.adapter.preflightRequest('recall_answer',input);assert.equal(pre.requestByteLimit,16384);assert.equal(pre.fits,false);
  await assert.rejects(()=>c.adapter.request('recall_answer',input),/request_body_budget/);assert.equal(c.captured.length,0);
  assert.equal((await readRuntimeBudget(c.auth)).used.deepseek,0);c.adapter.dispose();return {simulatedPosts:0,requestBytes:pre.requestBytes};
});

await test('只有推理且輸出到限不得冒充完整回答或自動重試',async()=>{
  const c=await environment('incomplete-reasoning',2);c.adapter.dispose();let calls=0;
  const adapter=createCmcpBoundedProviderAdapter({deepseekKey:'synthetic-not-a-secret',ledgerRoot:c.ledgerRoot,
    runtimeAuthorization:c.auth,answerHistory:true,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({
      id:'synthetic-incomplete',model:'deepseek-flash',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},
      usage:{output_tokens:CMCP_HISTORY_ANSWER_PROFILE.maxOutputTokens,
        output_tokens_details:{reasoning_tokens:CMCP_HISTORY_ANSWER_PROFILE.maxOutputTokens}},
      output:[{type:'reasoning'}]}),{status:200});}});
  await assert.rejects(()=>adapter.request('recall_answer',formal),/incomplete_budget_or_transport/);
  assert.equal(calls,1);assert.equal((await readRuntimeBudget(c.auth)).used.deepseek,1);
  const result=(await rows(c.dir)).find(row=>row.kind==='result').value;
  assert.equal(result.http,200);assert.equal(result.status,'failed');assert.equal(result.outputText,null);
  assert.equal(result.code,'incomplete_budget_or_transport');assert.equal(result.remoteOutcome,'unknown');
  assert.equal(result.usage.output_tokens,CMCP_HISTORY_ANSWER_PROFILE.maxOutputTokens);
  adapter.dispose();return {simulatedPosts:1,syntheticIncomplete:true};
});

await test('非法推理設定明確拒絕且不建立模型請求',async()=>{
  let calls=0;for(const historyAnswerReasoning of ['high','max','',null,0,true,{}]){
    assert.throws(()=>createCmcpBoundedProviderAdapter({deepseekKey:'synthetic-not-a-secret',ledgerRoot:path.join(root,'invalid'),
      runtimeAuthorization:{root:path.join(root,'invalid-budget'),binding:loopHash('invalid'),sessionId:'synthetic'},answerHistory:true,
      historyAnswerReasoning,fetchImpl:async()=>{calls++;throw Error('不應呼叫');}}),/invalid_history_answer_reasoning/);
  }assert.equal(calls,0);return {simulatedPosts:0};
});

const result={kind:'offline_history_answer_profile_smoke',syntheticFixtures:true,fetchSubstitute:true,productApiPosts:0,
  testedProfile:CMCP_HISTORY_ANSWER_PROFILE,
  startedAt,endedAt:new Date().toISOString(),passed:cases.filter(row=>row.status==='PASS').length,
  failed:cases.filter(row=>row.status==='FAIL').length,cases};
await fs.writeFile(path.join(root,'results.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({passed:result.passed,failed:result.failed,productApiPosts:0,results:path.join(root,'results.json')}));
process.exitCode=result.failed?1:0;
