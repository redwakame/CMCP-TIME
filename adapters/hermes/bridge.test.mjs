import test from 'node:test';
import assert from 'node:assert/strict';
import {createHermesBridge,readerTools,projectReceipt} from './bridge.mjs';

function fixture({authorized=true,fail=null}={}){
  const calls=[],notes=[],readCalls=[];let readClosed=0;
  const loaded={config:{},shared:{projectId:'synthetic-project',pipe:'\\\\.\\pipe\\cmcp-hermes-fixture'},host:{controlAuthFile:'fixture-controller',agentId:'test-hermes',workspace:process.cwd()},scopeId:'synthetic-project'};
  const bridge=createHermesBridge(loaded,{sessionId:'fixture-session',authorized,call:async value=>{calls.push(value);if(value.request.operation===fail)throw Error('fixture_denied');return {epoch:1,joined:true,capture:{status:'captured',sourcePointer:{fixture:true}},sourcePointer:{fixture:true},context:{}};},mcpFactory:async()=>({call:async(name,args)=>{readCalls.push({name,args});return {status:'ok',records:[]};},close:async()=>{readClosed++;}}),note:async(kind,value)=>notes.push({kind,...value})});
  const dispatch=(operation,args={},sessionId='fixture-session')=>bridge.dispatch({sessionId,operation,args});
  const begin=()=>dispatch('begin',{userMessage:'原始要求；不得推論已定案。',turnId:'turn-one',receivedAt:'2026-10-04T00:00:00.123Z'});
  return {calls,notes,readCalls,dispatch,begin,get readClosed(){return readClosed;}};
}
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
test('產品工具不提供寫入／角色偽造入口',()=>{assert.equal(readerTools.some(t=>/save|control|receive|assistant|claim/.test(t.name)),false);assert.ok(readerTools.every(t=>t.inputSchema.additionalProperties===false));});
test('正式工具正文只在明示合成且授權的取證中保留，日常不旁路複製',()=>{const value={result:{text:'合成正式原文'},context:{private:'不留'}};for(const options of [{},{syntheticEvidence:true},{authorized:true}]){const result=projectReceipt('formal_tool',value,options);assert.equal(result.result,undefined);assert.equal(result.context,undefined);assert.equal(result.resultHash.length,64);}const enabled=projectReceipt('formal_tool',value,{syntheticEvidence:true,authorized:true});assert.deepEqual(enabled.result,value.result);assert.equal(enabled.context,undefined);});
