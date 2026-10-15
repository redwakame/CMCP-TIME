import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createHermesBridge,readerTools,projectReceipt,decodeHermesMcpResult,formalPageChildren} from './bridge.mjs';
import {CONTINUITY_BEFORE_ANSWER_POLICY,CONTINUITY_POLICY_METADATA,CONTINUITY_READING_CONTRACT,CONTINUITY_READING_CONTRACT_METADATA,CONTINUITY_KIND_RULES,CONTINUITY_PLAN_GRANULARITY_RULES,CONTINUITY_PLAN_ROLE_RULES,CONTINUITY_REASON_BINDING_RULES,CONTINUITY_PLAN_V3_RULES,CONTINUITY_SOURCE_BOUND_ANSWER_RULES,CONTINUITY_ATTRIBUTION_RULES,CONTINUITY_PLAN_SCOPE_REVIEW_RULES,CONTINUITY_EXPLICIT_REASON_SCOPE_RULES,CONTINUITY_TICKET_SCOPE_RULES} from '../continuity-policy.mjs';

function fixture({authorized=true,fail=null,readResults={},readMaxPages,beforeNote=async()=>{}}={}){
  const calls=[],notes=[],readCalls=[];let readClosed=0;
  const loaded={config:readMaxPages===undefined?{}:{readMaxPages},shared:{projectId:'synthetic-project',pipe:'\\\\.\\pipe\\cmcp-hermes-fixture'},host:{controlAuthFile:'fixture-controller',agentId:'test-hermes',workspace:process.cwd()},scopeId:'synthetic-project'};
  const bridge=createHermesBridge(loaded,{sessionId:'fixture-session',authorized,call:async value=>{calls.push(value);if(value.request.operation===fail)throw Error('fixture_denied');return {epoch:1,joined:true,capture:{status:'captured',sourcePointer:{fixture:true}},sourcePointer:{fixture:true},context:{}};},mcpFactory:async()=>({call:async(name,args)=>{readCalls.push({name,args});return structuredClone(typeof readResults[name]==='function'?await readResults[name](args):readResults[name]??{status:'ok',records:[]});},close:async()=>{readClosed++;}}),note:async(kind,value)=>{await beforeNote(kind);notes.push({kind,...value});}});
  const dispatch=(operation,args={},sessionId='fixture-session')=>bridge.dispatch({sessionId,operation,args});
  const begin=()=>dispatch('begin',{userMessage:'原始要求；不得推論已定案。',turnId:'turn-one',receivedAt:'2026-10-04T00:00:00.123Z'});
  return {calls,notes,readCalls,dispatch,begin,get readClosed(){return readClosed;}};
}

const schemaArgs=()=>({ticket:'formal-ticket',proposal:{version:6,plans:[{id:'p',ref:'r1',quote:'我打算製作模型。',topic:'模型',aspect:'計畫',temporalUse:'current',orderedChanges:[{kind:'content',quote:'改成另一種尺寸。',edits:[{quote:'模型',kind:'replace',replacement:{ref:'r2',quote:'模型'}}]}]}],unknowns:[]}});
const completeReading={ticket:'formal-ticket',coverage:{complete:true,exhausted:true,sourceCount:1,completedSources:1,unavailableSources:0,unread:[]}};
const deliveryChild=(page,complete=page===3)=>({kind:'cmcp_continuity_delivery_page',status:'provided',ticket:'formal-ticket',projectionStatus:'ready',projectionHash:'a'.repeat(64),
 delivery:{id:'delivery',page,pageCount:4,complete,nextPage:complete?null:String(page+1),resultHash:'b'.repeat(64),resultBytes:90000,resultChars:85000},sections:[{path:'/original',value:'完整原文與原時間'}]});
const deliveryBatch=pages=>({kind:'cmcp_formal_page_batch',version:1,operation:'continuity-page',ticket:'formal-ticket',requestedMaxPages:2,pages,stopReason:'max_pages',transportCoverage:'exact_formal_children_provided_not_model_comprehension'});
test('明設兩頁只傳 transport 選項，stage completion 需要本回合實收所有子頁',async()=>{
 const f=fixture({readMaxPages:2,readResults:{cmcp_open_history:{status:'ready',ticket:'formal-ticket'},cmcp_read_history:completeReading,
  cmcp_reading_progress:completeReading,cmcp_project_continuity:deliveryChild(0),cmcp_read_continuity:args=>deliveryBatch(Array.from({length:Math.min(2,4-Number(args.page))},(_,i)=>deliveryChild(Number(args.page)+i)))}});
 try{await schemaBegin(f);await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_project_continuity',arguments:{ticket:'formal-ticket',proposalJson:'{"version":1,"nodes":[],"unknowns":[]}'}});
  const batch=await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_read_continuity',arguments:{ticket:'formal-ticket',deliveryId:'delivery',page:'1'}});
  assert.equal(f.readCalls.at(-1).args.maxPages,2);assert.deepEqual(batch.pages,[deliveryChild(1),deliveryChild(2)]);assert.equal(f.notes.at(-1).formalChildren.length,2);
  await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_read_continuity',arguments:{ticket:'formal-ticket',deliveryId:'delivery',page:'3'}});
  const result=await f.dispatch('finish',{turnId:'turn-one',text:'合成原答。',receivedAt:'2026-10-04T00:00:04.123Z'});assert.equal(result.completion.projectionCompletion,'completed');
 }finally{await f.dispatch('close');}
});
test('batch 拒絕後 progress complete 不能補造 acquisition，晚到末頁亦不能掩蓋缺頁',async()=>{
 let failed=false;const f=fixture({readMaxPages:2,readResults:{cmcp_open_history:{status:'ready',ticket:'formal-ticket'},cmcp_read_history:completeReading,
  cmcp_reading_progress:completeReading,cmcp_project_continuity:deliveryChild(0),cmcp_read_continuity:()=>{if(!failed){failed=true;throw Error('mcp_request_cancelled');}return deliveryBatch([deliveryChild(3)]);}}});
 try{await schemaBegin(f);await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_project_continuity',arguments:{ticket:'formal-ticket',proposalJson:'{"version":1,"nodes":[],"unknowns":[]}'}});
  await assert.rejects(f.dispatch('tool',{turnId:'turn-one',name:'cmcp_read_continuity',arguments:{ticket:'formal-ticket',deliveryId:'delivery',page:'1'}}),/cancelled/);
  await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_reading_progress',arguments:{ticket:'formal-ticket'}});
  await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_read_continuity',arguments:{ticket:'formal-ticket',deliveryId:'delivery',page:'3'}});
  const result=await f.dispatch('finish',{turnId:'turn-one',text:'缺頁仍未核對完成。',receivedAt:'2026-10-04T00:00:04.123Z'});assert.equal(result.completion.projectionCompletion,'pending');
 }finally{await f.dispatch('close');}
});
test('舊設定單頁；明示非法批次、換票與不連續子頁均拒絕',async()=>{
 const f=fixture({readResults:{cmcp_read_continuity:deliveryChild(1)}});try{await f.begin();const args={ticket:'formal-ticket',deliveryId:'delivery',page:'1'};
  await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_read_continuity',arguments:args});assert.deepEqual(f.readCalls.at(-1).args,args);
  for(const maxPages of [2,3,1.5,'2',true])await assert.rejects(f.dispatch('tool',{turnId:'turn-one',name:'cmcp_read_continuity',arguments:{...args,maxPages}}),/invalid/);
 }finally{await f.dispatch('close');}
 assert.throws(()=>formalPageChildren(deliveryBatch([deliveryChild(1),deliveryChild(3)])),/binding_changed/);
 const other=deliveryChild(2);other.ticket='other';assert.throws(()=>formalPageChildren(deliveryBatch([deliveryChild(1),other])),/binding_changed/);
});
test('最後 batch 之 note 拒絕亦清 proof，不能保存為 acquired complete',async()=>{
 let count=0;const f=fixture({readMaxPages:2,beforeNote:async kind=>{if(kind==='formal_tool'&&++count===5)throw Error('synthetic_note_rejected');},
  readResults:{cmcp_open_history:{status:'ready',ticket:'formal-ticket'},cmcp_read_history:completeReading,cmcp_reading_progress:completeReading,
   cmcp_project_continuity:deliveryChild(0),cmcp_read_continuity:args=>deliveryBatch(Array.from({length:Math.min(2,4-Number(args.page))},(_,i)=>deliveryChild(Number(args.page)+i)))}});
 try{await schemaBegin(f);await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_project_continuity',arguments:{ticket:'formal-ticket',proposalJson:'{"version":1,"nodes":[],"unknowns":[]}'}});
  await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_read_continuity',arguments:{ticket:'formal-ticket',deliveryId:'delivery',page:'1'}});
  await assert.rejects(f.dispatch('tool',{turnId:'turn-one',name:'cmcp_read_continuity',arguments:{ticket:'formal-ticket',deliveryId:'delivery',page:'3'}}),/note_rejected/);
  const result=await f.dispatch('finish',{turnId:'turn-one',text:'最後派送證據不可用。',receivedAt:'2026-10-04T00:00:04.123Z'});assert.equal(result.completion.projectionCompletion,'pending');
 }finally{await f.dispatch('close');}
});
const schemaFixture=()=>fixture({readResults:{cmcp_open_history:{status:'ready',ticket:'formal-ticket'},cmcp_read_history:completeReading,cmcp_project_continuity:{kind:'cmcp_continuity_projection',status:'ready',ticket:'formal-ticket',projection:{}}}});
async function schemaBegin(f){await f.begin();await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_open_history',arguments:{navigationTicket:'nav',selectionJson:'{}'}});await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_read_history',arguments:{ticket:'formal-ticket'}});}
test('Hermes schema 拒絕只給安全欄位且不送 MCP；最後失敗不能套先前成功',async()=>{
 const f=schemaFixture();try{
  await schemaBegin(f);const good=schemaArgs();good.proposal.plans[0].orderedChanges[0].ref='r2';
  await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_project_continuity',arguments:good});
  const beforeCalls=f.calls.length,beforeReads=f.readCalls.length;
  const rejected=await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_project_continuity',arguments:schemaArgs()});
  assert.equal(rejected.sourceRead,false);assert.equal(rejected.inputSchemaValidated,false);assert.equal(rejected.formalProjection,false);
  assert.deepEqual(rejected.correction.issues[0].path,['proposal','plans',0,'orderedChanges',0,'ref']);assert.equal(f.calls.length,beforeCalls);assert.equal(f.readCalls.length,beforeReads);
  const finished=await f.dispatch('finish',{turnId:'turn-one',text:'尚未取得合法修訂投影。',receivedAt:'2026-10-04T00:00:03.123Z'});
  assert.equal(finished.completion.projectionCompletion,'pending');assert.equal(finished.completion.projectionStatus,null);
 }finally{await f.dispatch('close');}
});
test('schema 校正仍走正式 reader，來源拒絕與舊 proposalJson 不能被回饋升格成功',async()=>{
 const f=schemaFixture();try{
  await schemaBegin(f);await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_project_continuity',arguments:schemaArgs()});
  const good=schemaArgs();good.proposal.plans[0].orderedChanges[0].ref='r2';await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_project_continuity',arguments:good});assert.deepEqual(f.readCalls.at(-1).args,good);
  const finished=await f.dispatch('finish',{turnId:'turn-one',text:'合成原答。',receivedAt:'2026-10-04T00:00:03.123Z'});assert.equal(finished.completion.projectionCompletion,'completed');
 }finally{await f.dispatch('close');}
 const rejected={kind:'cmcp_continuity_projection',status:'unavailable',reason:'cmcp_source_authorization_changed',projection:null};
 const g=fixture({readResults:{cmcp_project_continuity:rejected}});try{
  await g.begin();for(const version of [1,2,3,4,5,6]){const value={ticket:'t',proposalJson:JSON.stringify({version,nodes:[],unknowns:[]})};const response=await g.dispatch('tool',{turnId:'turn-one',name:'cmcp_project_continuity',arguments:value});assert.equal(response.status,'unavailable');assert.equal(response.reason,rejected.reason);assert.deepEqual(g.readCalls.at(-1).args,value);}
 }finally{await g.dispatch('close');}
});
test('未授權／錯回合／取消後仍先拒絕，不提供 schema 回饋或新增來源讀取',async()=>{
 const tool={turnId:'turn-one',name:'cmcp_project_continuity',arguments:schemaArgs()},f=fixture({authorized:false});await assert.rejects(f.dispatch('tool',tool),/active_authorized/);assert.equal(f.notes.length,0);
 const g=fixture();try{await g.begin();await assert.rejects(g.dispatch('tool',{...tool,turnId:'other'}),/forbidden/);await g.dispatch('cancel');const count=g.notes.length;await assert.rejects(g.dispatch('tool',tool),/active_authorized/);assert.equal(g.notes.length,count);assert.equal(g.readCalls.length,0);}finally{await g.dispatch('close');}
});
test('schema 回饋記錄期間取消，晚到回饋不跨回合返回',async()=>{
 let release,started;const waiting=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
 const f=fixture({beforeNote:async kind=>{if(kind==='input_schema_rejected'){started();await waiting;}}});
 try{await f.begin();const work=f.dispatch('tool',{turnId:'turn-one',name:'cmcp_project_continuity',arguments:schemaArgs()});await entered;await f.dispatch('cancel');release();await assert.rejects(work,/active_authorized/);assert.equal(f.readCalls.length,0);}finally{release();await f.dispatch('close');}
});

test('MCP 拒絕保留可修正的安全原因，不能把原始錯誤正文或失敗資料當成功',()=>{
  for(const code of ['reading_navigation_already_consumed','continuity_reading_incomplete','cmcp_source_authorization_changed']){
    assert.throws(()=>decodeHermesMcpResult({isError:true,content:[{type:'text',text:code}],structuredContent:{status:'ready'}}),new RegExp('^Error: hermes_reader_'+code+'$'));
  }
  for(const text of ['C:/private/secret','token=private','reading_failed:internal-id','x'.repeat(64),'x'.repeat(256),'error\nprivate']){
    assert.throws(()=>decodeHermesMcpResult({isError:true,content:[{type:'text',text}]}),/^Error: hermes_mcp_read_rejected$/);
  }
  const correction={status:'rejected',correction:{code:'invalid_state_relation'}};
  assert.deepEqual(decodeHermesMcpResult({structuredContent:correction}),correction);
  assert.deepEqual(decodeHermesMcpResult({content:[{type:'text',text:'{"status":"page"}'}]}),{status:'page'});
});
test('原始 User 與可見 Assistant 沿正式控制路徑保存，保留時間與回覆綁定',async()=>{
  const f=fixture();await f.begin();await f.dispatch('assistant',{turnId:'turn-one',text:'先查來源。',receivedAt:'2026-10-04T00:00:01.123Z'});await f.dispatch('finish',{turnId:'turn-one',text:'正式回答。',receivedAt:'2026-10-04T00:00:02.123Z'});await f.dispatch('close');
  assert.deepEqual(f.calls.map(x=>x.request.operation),['join','claim','receive','claim-turn','request-context','append-assistant','finish','revoke']);
  const receive=f.calls[2].request,finish=f.calls[6].request;assert.equal(receive.hostId,'hermes');assert.equal(receive.args.receivedAt,'2026-10-04T00:00:00.123Z');assert.equal(finish.args.userMessageId,receive.args.messageId);assert.equal(finish.args.text,'正式回答。');assert.equal(f.readClosed,1);
});
test('未授權不寫入，也不暗改 Clean 或主動等共用控制',async()=>{const f=fixture({authorized:false});await assert.rejects(f.begin(),/not_authorized/);assert.equal(f.calls.length,0);assert.equal((await f.dispatch('inspect')).enabled,false);});
test('其他 Session 被拒絕',async()=>{const f=fixture();await assert.rejects(f.dispatch('inspect',{},'other'),/session_mismatch/);assert.equal(f.calls.length,0);});
test('只有正式唯讀工具可經模型路徑執行',async()=>{const f=fixture();await f.begin();await assert.rejects(f.dispatch('tool',{turnId:'turn-one',name:'control'}),/forbidden/);await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_find_history',arguments:{}});assert.equal(f.readCalls.length,1);assert.equal(f.calls.some(x=>x.request.operation==='control'),false);});
test('取消後晚到回答不能保存；不刪 History',async()=>{const f=fixture();await f.begin();await f.dispatch('cancel');await assert.rejects(f.dispatch('finish',{turnId:'turn-one',text:'晚到',receivedAt:'2026-10-04T00:00:02.123Z'}),/active_authorized/);assert.equal(f.calls.filter(x=>x.request.operation==='cancel').length,1);assert.equal(f.readClosed,1);});
test('拒絕不屬於本輪的回覆與重複 begin',async()=>{const f=fixture();await f.begin();await assert.rejects(f.begin(),/already_active/);await assert.rejects(f.dispatch('finish',{turnId:'other',text:'錯答',receivedAt:'2026-10-04T00:00:02.123Z'}),/invalid_assistant/);});
test('共用保護拒絕 claim 時撤回本 Session；不寫入放寬設定',async()=>{const f=fixture({fail:'claim'});await assert.rejects(f.begin(),/fixture_denied/);assert.deepEqual(f.calls.map(x=>x.request.operation),['join','claim','revoke']);});
test('close 必須拿到 revoke 結果，不能假裝釋放成功',async()=>{const f=fixture({fail:'revoke'});await f.begin();await assert.rejects(f.dispatch('close'),/fixture_denied/);assert.equal((await f.dispatch('inspect')).enabled,false);});
test('查看狀態零模型且零正式變更',async()=>{const f=fixture();for(let i=0;i<3;i++)await f.dispatch('inspect');assert.equal(f.calls.length,0);assert.equal(f.readCalls.length,0);});
test('產品工具不提供寫入／角色偽造入口',()=>{assert.equal(readerTools.some(t=>/save|control|receive|assistant|claim|recovery/.test(t.name)),false);assert.ok(readerTools.every(t=>t.inputSchema.additionalProperties===false));});
test('正式工具正文只在明示合成且授權的取證中保留，日常不旁路複製',()=>{const value={result:{text:'合成正式原文'},context:{private:'不留'}};for(const options of [{},{syntheticEvidence:true},{authorized:true}]){const result=projectReceipt('formal_tool',value,options);assert.equal(result.result,undefined);assert.equal(result.context,undefined);assert.equal(result.resultHash.length,64);}const enabled=projectReceipt('formal_tool',value,{syntheticEvidence:true,authorized:true});assert.deepEqual(enabled.result,value.result);assert.equal(enabled.context,undefined);});

test('Hermes open 當輪原文選項保持明示、選配與嚴格型別',async()=>{
  const f=fixture();await f.begin();const selection={navigationTicket:'正式導航',selectionJson:'{}'},tool=readerTools.find(t=>t.name==='cmcp_open_history');
  assert.equal(tool.inputSchema.properties.includeCurrentInput.type,'boolean');assert.equal(tool.inputSchema.required.includes('includeCurrentInput'),false);
  for(const option of [{},{includeCurrentInput:false},{includeCurrentInput:true}]){const args={...selection,...option};await f.dispatch('tool',{turnId:'turn-one',name:tool.name,arguments:args});assert.deepEqual(f.readCalls.at(-1).args,args);}
  for(const option of [{includeCurrentInput:'true'},{includeCurrentInput:null},{pointer:'other'}]){const count=f.readCalls.length;await assert.rejects(f.dispatch('tool',{turnId:'turn-one',name:tool.name,arguments:{...selection,...option}}),/invalid_tool_arguments/);assert.equal(f.readCalls.length,count);}
  await f.dispatch('cancel');await f.dispatch('close');
});

test('每次正式 begin 同源供給回答前協定；不變造原文、不自動讀取或改共用控制',async()=>{
  const f=fixture(),first=await f.begin();
  const skill=await fs.readFile(new URL('./SKILL.md',import.meta.url),'utf8');
  assert.ok(first.context.startsWith(skill+'\n\n'),'實際供給目前載入的 Skill 原文');
  assert.equal(f.notes.find(row=>row.kind==='context_provided').skillHash,createHash('sha256').update(skill).digest('hex'),'載入材料的雜湊可與正式回執核對');
  assert.equal(first.context.split(CONTINUITY_BEFORE_ANSWER_POLICY).length-1,1);
  assert.deepEqual(f.notes.find(row=>row.kind==='context_provided').beforeAnswerPolicy,CONTINUITY_POLICY_METADATA);
  assert.equal(f.calls.find(row=>row.request.operation==='receive').request.args.text,'原始要求；不得推論已定案。');
  assert.equal(f.readCalls.length,0);assert.equal(f.calls.some(row=>row.request.operation==='control'),false);
  await f.dispatch('finish',{turnId:'turn-one',text:'普通原答。',receivedAt:'2026-10-04T00:00:02.123Z'});
  const revision='核可仍未取得，這不是更正前次回報。長期流程只修改一項，其餘維持；本輪請先回答疑問，不另設持續工作。';
  const second=await f.dispatch('begin',{userMessage:revision,turnId:'turn-two',receivedAt:'2026-10-04T00:01:00.123Z'});
  assert.equal(second.context.split(CONTINUITY_BEFORE_ANSWER_POLICY).length-1,1);assert.equal(f.readCalls.length,0);
  const suppliedPolicy=second.context.slice(second.context.indexOf(CONTINUITY_BEFORE_ANSWER_POLICY),second.context.indexOf(CONTINUITY_BEFORE_ANSWER_POLICY)+CONTINUITY_BEFORE_ANSWER_POLICY.length);
  assert.equal(suppliedPolicy,CONTINUITY_BEFORE_ANSWER_POLICY);assert.ok(!first.context.includes(CONTINUITY_READING_CONTRACT));assert.ok(!second.context.includes(CONTINUITY_READING_CONTRACT));assert.ok(suppliedPolicy.includes(CONTINUITY_SOURCE_BOUND_ANSWER_RULES));
  assert.equal(f.notes.filter(row=>row.kind==='context_provided').at(-1).beforeAnswerPolicy.version,CONTINUITY_POLICY_METADATA.version);
  assert.equal(f.calls.filter(row=>row.request.operation==='receive').at(-1).request.args.text,revision);
  await f.dispatch('cancel');await f.dispatch('close');await assert.rejects(f.begin(),/not_authorized/);
});

test('length 私有續行查核只讀正式回合，不建立 grant、保存、閱讀或控制',async()=>{
  const f=fixture();await f.begin();const beforeNotes=f.notes.length,beforeRead=f.readCalls.length,before=f.calls.length;
  const result=await f.dispatch('recovery-check',{turnId:'turn-one'});
  assert.equal(result.active,true);assert.match(result.context,/普通問題或全新計畫仍直接回答/);
  assert.deepEqual(f.calls.slice(before).map(x=>x.request.operation),['request-context']);
  assert.equal(f.notes.length,beforeNotes);assert.equal(f.readCalls.length,beforeRead);
  await assert.rejects(f.dispatch('recovery-check',{turnId:'other'}),/binding_mismatch/);
  await assert.rejects(f.dispatch('recovery-check',{turnId:'turn-one',text:'假指令'}),/binding_mismatch/);
  await f.dispatch('cancel');await assert.rejects(f.dispatch('recovery-check',{turnId:'turn-one'}),/active_authorized/);await f.dispatch('close');
});

test('length 查核的正式 owner 或授權失效不能當成功',async()=>{
  const f=fixture();await f.begin();
  const g=fixture({fail:'request-context'});await assert.rejects(g.begin(),/fixture_denied/);
  await f.dispatch('close');await assert.rejects(f.dispatch('recovery-check',{turnId:'turn-one'}),/active_authorized/);
});

test('Hermes 正式 open 結果提供完整契約，初始與每頁不重複，取消後拒絕',async()=>{
 const formal={kind:'cmcp_reading_collection',status:'ready',ticket:'formal-ticket',manifestHash:'a'.repeat(64),collection:{sources:[{ref:'r1'}]},readSources:0};
 const f=fixture({readResults:{cmcp_open_history:formal,cmcp_read_history:{kind:'cmcp_reading_page',ticket:formal.ticket,status:'complete'}}});
 try{
  const initial=await f.begin();assert.ok(!initial.context.includes(CONTINUITY_READING_CONTRACT));
  const args={turnId:'turn-one',name:'cmcp_open_history',arguments:{navigationTicket:'nav',selectionJson:'{}'}},result=await f.dispatch('tool',args);
  assert.deepEqual(result.continuityContract,{...CONTINUITY_READING_CONTRACT_METADATA,text:CONTINUITY_READING_CONTRACT});assert.equal(result.ticket,formal.ticket);
  if(process.env.CMCP_TEST_OUTPUT_ROOT){await fs.mkdir(process.env.CMCP_TEST_OUTPUT_ROOT,{recursive:true});await fs.writeFile(process.env.CMCP_TEST_OUTPUT_ROOT+'/hermes-layered-contract.json',JSON.stringify({layer:'正式 Hermes bridge，MCP 合成替身，零模型',initial,formal,result},null,2),{flag:'wx'});}
  assert.deepEqual(f.notes.filter(row=>row.kind==='formal_tool').at(-1).result,result);
  const page=await f.dispatch('tool',{turnId:'turn-one',name:'cmcp_read_history',arguments:{ticket:formal.ticket}});assert.equal(page.continuityContract,undefined);
  await f.dispatch('cancel');const before=f.readCalls.length;await assert.rejects(f.dispatch('tool',args),/active_authorized/);assert.equal(f.readCalls.length,before);
 }finally{await f.dispatch('close');}
});
