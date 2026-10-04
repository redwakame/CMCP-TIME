// 真 Bridge 方法的純記憶體失敗邊界；不建立檔案、Runtime 或模型工作。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {CmcpHarnessBridge,HOST_ASSISTANT_LIMITS} from './runtime-bridge.mjs';

function fixture({validateError,saveError,cancelError,noteError}={}){
  const root=process.cwd(),bridge=new CmcpHarnessBridge({deploymentRoot:root,runtimeConfig:path.join(root,'unused-runtime.json'),traceRoot:path.join(root,'unused-trace'),scopeId:'synthetic-settlement'});
  const turn={sessionId:'a',messageId:'u1',harnessTurn:1,state:'running',enhanced:true,capture:{hostTurn:{kind:'cmcp_host_turn',version:1,workId:'work-a'}}};
  const observed={cancelled:[],notes:[],saved:0};
  const runtime={
    config:{input:{timezone:'Asia/Taipei'}},
    async validateHostTurn(){if(validateError)throw validateError;},
    async afterAssistant(){observed.saved++;if(saveError)throw saveError;return {status:'saved'};},
    async cancelWork(value){if(cancelError)throw cancelError;observed.cancelled.push(value);},
    async refreshDispatch(){},
  };
  bridge.current={sessionId:'a',runtime};bridge.turns.set('a',turn);
  bridge.note=async(...args)=>{if(noteError)throw noteError;observed.notes.push(args);};
  const expected={userMessageId:'u1',harnessTurn:1};
  return {bridge,turn,runtime,observed,expected,complete:()=>bridge.complete('a','a1','synthetic answer',new Date().toISOString(),expected)};
}

for(const stage of ['validation','save'])test('正式 '+stage+' 拒絕保留原錯誤並取消同一票，不冒稱保存',async()=>{
  const original=Error(stage==='validation'?'host_turn_expired':'host_turn_source_changed');
  const f=fixture(stage==='validation'?{validateError:original}:{saveError:original});
  await assert.rejects(f.complete(),error=>error===original);
  assert.equal(f.turn.state,'cancelled');assert.deepEqual(f.observed.cancelled,[{workId:'work-a',reason:'host_completion_failed'}]);
  assert.equal(f.observed.notes.some(([,kind])=>kind==='assistant_saved'),false);
});

test('錯誤結算／取消 binding 不得取消仍有效的真正回合',async()=>{
  const f=fixture(),wrong={userMessageId:'another',harnessTurn:1};
  await assert.rejects(f.bridge.complete('a','a1','synthetic answer',new Date().toISOString(),wrong),/host_completion_turn_mismatch/);
  await assert.rejects(f.bridge.cancel('a','wrong-cancel',wrong),/host_cancel_turn_mismatch/);
  assert.equal(f.turn.state,'running');assert.equal(f.observed.cancelled.length,0);assert.equal(f.observed.saved,0);
});

test('正式取消失敗仍封鎖下一 Session；原錯誤與清理錯誤皆保留且同票可重試',async()=>{
  const original=Error('host_turn_expired'),cleanup=Error('synthetic_cancel_write_failed'),f=fixture({validateError:original,cancelError:cleanup});
  await assert.rejects(f.complete(),error=>error instanceof AggregateError&&error.cause===original&&error.errors[0]===original&&error.errors[1]===cleanup);
  assert.equal(f.turn.state,'running');await assert.rejects(f.bridge.runtime('new-session'),/one_active_harness_turn_required/);
  f.runtime.cancelWork=async value=>f.observed.cancelled.push(value);
  await f.bridge.cancel('a','explicit_retry',f.expected);assert.equal(f.turn.state,'cancelled');
});

test('逐筆 commit 超出數量／總量拒絕整筆並保留前綴；同 id 改時間不可重綁',async()=>{
  const time=new Date().toISOString(),f=fixture();
  for(let n=0;n<HOST_ASSISTANT_LIMITS.maxMessages;n++)await f.bridge.appendAssistant('a','part-'+n,'合成原訊息 '+n,time,f.expected);
  assert.equal(f.turn.state,'running');assert.equal(f.observed.saved,HOST_ASSISTANT_LIMITS.maxMessages);
  await assert.rejects(f.bridge.appendAssistant('a','overflow','這筆不能默默裁切。',time,f.expected),/host_assistant_commit_capacity_exceeded/);
  assert.equal(f.observed.saved,HOST_ASSISTANT_LIMITS.maxMessages);assert.equal(f.turn.state,'cancelled');
  assert.equal(f.turn.assistantSaveFailure.committedMessages,HOST_ASSISTANT_LIMITS.maxMessages);
  const bytes=fixture();await assert.rejects(bytes.bridge.appendAssistant('a','oversized','x'.repeat(HOST_ASSISTANT_LIMITS.maxTotalBytes+1),time,bytes.expected),/host_assistant_commit_capacity_exceeded/);assert.equal(bytes.observed.saved,0);
  const identity=fixture();await identity.bridge.appendAssistant('a','same-id','原內容',time,identity.expected);
  await assert.rejects(identity.bridge.appendAssistant('a','same-id','原內容',new Date(Date.parse(time)+1).toISOString(),identity.expected),/host_assistant_message_identity_conflict/);
  assert.equal(identity.observed.saved,1);assert.equal(identity.turn.state,'cancelled');
});
