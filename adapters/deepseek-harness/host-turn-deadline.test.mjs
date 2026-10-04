// 合成資料與明示時鐘推進；不等待真實期限、不啟動宿主、不呼叫模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {CmcpHarnessBridge} from './runtime-bridge.mjs';
import {createCmcpRuntimeSession,normalizeCmcpHostTurnPolicy} from '../../src/cmcp-guard/cmcp-runtime-session.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(repo,'logs/tests/host-turn-deadline'));
await fs.mkdir(base,{recursive:true});
const runRoot=await fs.mkdtemp(path.join(base,'run-')),open=new Set(),cases=[];
const policy={timeoutMs:900000,maxTimeoutMs:1800000};
const originalNow=Date.now,originalFetch=globalThis.fetch;
let wall=originalNow(),networkCalls=0;
let originalTime,answerTime;
const text='這是合成工作坊初稿，八人共用四套工具；場地仍待書面同意。';
const sha=value=>createHash('sha256').update(value).digest('hex');
globalThis.fetch=async()=>{networkCalls++;throw Error('期限離線驗收不得呼叫網路');};
function useClock(){wall=originalNow();Date.now=()=>wall;
  // 每個案例的來源時間由同一次可控時鐘推導，避免固定日期跨過正式十二小時 TTL。
  originalTime=new Date(wall-60000).toISOString();answerTime=new Date(wall+358000).toISOString();return wall;}
async function fixture(label,{bridgePolicy=policy,runtimePolicy=policy,direct=false}={}){
  const root=path.join(runRoot,label),scopeId='synthetic-host-deadline-'+label;
  await fs.mkdir(root,{recursive:true});
  const config={kind:'cmcp_runtime_config',version:1,runtimeId:scopeId,providerMode:'host',
    input:{root:path.join(root,'state'),scopeId,events:[],timezone:'Asia/Taipei',
      limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},
      storageCapacity:{maxSources:64,maxSourceBytes:8192},
      loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
    receiptRoot:path.join(root,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},
    controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
  if(direct){const runtime=await createCmcpRuntimeSession({config,repoRoot:root,sessionId:'synthetic-session',
    ...(runtimePolicy?{hostTurnPolicy:runtimePolicy}:{}),clock:()=>originalTime,
    fetchImpl:globalThis.fetch,readCredential:async()=>{throw Error('期限離線驗收不得讀憑證');}});
    open.add(runtime);return {root,config,runtime};}
  const runtimeConfig=path.join(root,'runtime.json');await fs.writeFile(runtimeConfig,JSON.stringify(config),{flag:'wx'});
  const bridge=new CmcpHarnessBridge({deploymentRoot:root,runtimeConfig,traceRoot:path.join(root,'trace'),scopeId,
    ...(bridgePolicy?{hostTurnPolicy:bridgePolicy}:{})});open.add(bridge);return {root,config,bridge};
}
async function close(value){await value.close();open.delete(value);}
async function capture(runtime,workId='synthetic-work',deadlineAt){return runtime.beforeUser({text,sourceId:'synthetic-user',
  timeContext:{now:originalTime,timezone:'Asia/Taipei'},hostTurn:{workId,...(deadlineAt?{deadlineAt}:{})}});}
async function reply(runtime,captured){return runtime.afterAssistant({text:'合成原答：保留場地書面同意的條件。',sourceId:'synthetic-answer',
  replyTo:captured.sourcePointer,hostTurn:captured.hostTurn,timeContext:{now:answerTime,timezone:'Asia/Taipei'}});}
async function registration(runtime,pointer){return (await runtime.status()).state.registration.sources.find(row=>row.pointer.itemId===pointer.itemId);}
async function guardedRead(runtime,captured){await runtime.validateHostTurn(captured.hostTurn);const source=await registration(runtime,captured.sourcePointer);
  return runtime.readSource({pointer:captured.sourcePointer,evidenceHash:source.evidenceHash,end:[...text].length,maxBytes:4096});}
async function check(name,body){return test(name,{concurrency:false},async()=>{
  useClock();try{await body();cases.push({name,status:'PASS'});}catch(error){cases.push({name,status:'FAIL',error:error.stack});throw error;}
  finally{Date.now=originalNow;}});}

await check('宿主政策嚴格有限、不可變；未設定維持一般期限',async()=>{
  assert.deepEqual(normalizeCmcpHostTurnPolicy(),{timeoutMs:240000,maxTimeoutMs:300000});
  assert.deepEqual(normalizeCmcpHostTurnPolicy(policy),policy);
  assert.ok(Object.isFrozen(normalizeCmcpHostTurnPolicy(policy)));
  for(const invalid of [null,{},[],{timeoutMs:0,maxTimeoutMs:1800000},{timeoutMs:1800001,maxTimeoutMs:1800000},
    {timeoutMs:900000,maxTimeoutMs:1800001},{timeoutMs:Infinity,maxTimeoutMs:1800000},
    {timeoutMs:NaN,maxTimeoutMs:1800000},{timeoutMs:1.5,maxTimeoutMs:1800000},
    {...policy,renew:true}])assert.throws(()=>normalizeCmcpHostTurnPolicy(invalid),/invalid_host_turn_policy/);
  const f=await fixture('provider-scope',{direct:true});await close(f.runtime);
  const configured={...f.config,providerMode:'configured',credentialRef:path.join(f.root,'unused-credential.json')};
  await assert.rejects(createCmcpRuntimeSession({config:configured,repoRoot:f.root,hostTurnPolicy:policy}),/host_turn_policy_requires_host_provider/);
});

await check('明確宿主政策在第358秒可正式閱讀及完成；原時間與Buffer TTL不刷新',async()=>{
  const started=wall,f=await fixture('native-read-complete');
  await f.bridge.receive('synthetic-session','user',text,originalTime);
  const captured=(await f.bridge.claim('synthetic-session','user',1)).capture;
  const runtime=await f.bridge.runtime('synthetic-session'),work=await runtime.progress(captured.hostTurn.workId);
  assert.equal(Date.parse(work.deadlineAt),started+900000);assert.deepEqual(work.hostTurnPolicy,policy);
  const before=await registration(runtime,captured.sourcePointer),bufferBefore=await runtime.bufferList({timeContext:{now:originalTime,timezone:'Asia/Taipei'}});
  wall=started+358000;
  const navigation=await f.bridge.tool('synthetic-session','cmcp_find_history',{});assert.ok(navigation.ticket);
  const read=await guardedRead(runtime,captured);assert.equal(read.text,text);assert.equal(read.messageRecordedAt,originalTime);
  assert.equal(read.evidenceHash,before.evidenceHash);assert.equal(read.activation,'none');
  assert.deepEqual(await registration(runtime,captured.sourcePointer),before);
  assert.deepEqual((await runtime.bufferList({timeContext:{now:originalTime,timezone:'Asia/Taipei'}})).items,bufferBefore.items);
  const receipt=await f.bridge.complete('synthetic-session','answer','合成原答：八人共用四套工具，場地仍待書面同意。',answerTime,{userMessageId:'user',harnessTurn:1});
  assert.equal(receipt.formalReply.status,'verified');assert.equal((await runtime.progress(work.workId)).state,'completed');
  assert.equal((await runtime.progress(work.workId)).deadlineAt,work.deadlineAt);
  assert.deepEqual(await registration(runtime,captured.sourcePointer),before);await close(f.bridge);
});

await check('同一票券重取不延長期限；固定截止後不能以新deadline復活',async()=>{
  const started=wall,f=await fixture('no-renew',{direct:true}),first=await capture(f.runtime);
  const initial=await f.runtime.progress(first.hostTurn.workId);wall=started+358000;
  const again=await capture(f.runtime,'synthetic-work',new Date(wall+900000).toISOString());
  assert.deepEqual(again.hostTurn,first.hostTurn);assert.equal((await f.runtime.progress(first.hostTurn.workId)).deadlineAt,initial.deadlineAt);
  wall=started+900000;
  await assert.rejects(f.runtime.validateHostTurn(first.hostTurn),/host_turn_expired/);
  await assert.rejects(capture(f.runtime,'synthetic-work',new Date(wall+900000).toISOString()),/host_turn_expired/);
  await assert.rejects(reply(f.runtime,first),/host_turn_expired/);
  assert.equal((await f.runtime.progress(first.hostTurn.workId)).deadlineAt,initial.deadlineAt);await close(f.runtime);
});

await check('三十分鐘硬上限與一般Runtime／Bridge五分鐘上限分離',async()=>{
  const native=await fixture('native-bound',{direct:true});
  await assert.rejects(capture(native.runtime,'over-max',new Date(wall+1800001).toISOString()),/invalid_work_deadline/);
  const maximum=await capture(native.runtime,'exact-max',new Date(wall+1800000).toISOString());assert.ok(maximum.hostTurn);await close(native.runtime);
  const ordinary=await fixture('ordinary-runtime',{direct:true,runtimePolicy:null});
  assert.deepEqual(ordinary.runtime.hostTurnPolicy,{timeoutMs:240000,maxTimeoutMs:300000});
  await assert.rejects(capture(ordinary.runtime,'over-old-max',new Date(wall+300001).toISOString()),/invalid_work_deadline/);
  const standard=await capture(ordinary.runtime,'default-old');assert.equal(Date.parse((await ordinary.runtime.progress(standard.hostTurn.workId)).deadlineAt)-wall,240000);
  await assert.rejects(ordinary.runtime.submit({workId:'standalone-bound',localOperation:'ingest',text:'合成一般操作',deadlineMs:300001}),/invalid_work_deadline/);
  await close(ordinary.runtime);
  const started=wall,legacy=await fixture('ordinary-bridge',{bridgePolicy:null});
  const legacyCaptured=(await legacy.bridge.begin('synthetic-session','user',text,originalTime)).capture;
  const runtime=await legacy.bridge.runtime('synthetic-session');assert.equal(Date.parse((await runtime.progress(legacyCaptured.hostTurn.workId)).deadlineAt)-started,300000);
  wall=started+300000;await assert.rejects(legacy.bridge.validate('synthetic-session'),/host_turn_expired/);await close(legacy.bridge);
});

await check('取消、OFF、Clean與撤權仍拒絕舊票；不因期限放寬而重新授權',async()=>{
  for(const action of ['cancel','OFF','Clean','revoke']){
    const f=await fixture('guard-'+action,{direct:true}),captured=await capture(f.runtime);wall+=358000;
    const sourceBefore=await registration(f.runtime,captured.sourcePointer),deadline=(await f.runtime.progress(captured.hostTurn.workId)).deadlineAt;
    if(action==='cancel')await f.runtime.cancelWork({workId:captured.hostTurn.workId,reason:'本單合成取消'});
    else if(action==='revoke')await f.runtime.authorizeSources({updateId:'revoke',patch:{saveAssistant:false},authorizedBy:'本單合成驗收'});
    else await f.runtime.configureControls({updateId:action,patch:action==='OFF'?{enabled:false}:{clean:true}});
    await assert.rejects(f.runtime.validateHostTurn(captured.hostTurn),/host_turn_(not_active|controls_changed|context_stale)/);
    await assert.rejects(reply(f.runtime,captured),/host_turn_(not_active|controls_changed|context_stale)/);
    assert.equal((await f.runtime.progress(captured.hostTurn.workId)).deadlineAt,deadline);
    const sources=(await f.runtime.status()).state.registration.sources;assert.equal(sources.length,1);
    assert.equal(sources[0].messageRecordedAt,sourceBefore.messageRecordedAt);await close(f.runtime);
  }
});

await check('正式原件版本異動故障仍拒絕；保留合成前像及故障原件',async()=>{
  const f=await fixture('source-version',{direct:true}),captured=await capture(f.runtime);wall+=358000;
  const directory=path.join(f.config.input.root,'history');let target,record;
  for(const name of await fs.readdir(directory)){const file=path.join(directory,name),value=JSON.parse(await fs.readFile(file,'utf8'));
    if(value.evidence?.pointer?.itemId===captured.sourcePointer.itemId){target=file;record=value;break;}}
  assert.ok(target);await fs.copyFile(target,target+'.synthetic-preserved-before');
  record.evidence.pointer.revisionId='r2';record.evidenceSha256=sha(JSON.stringify(record.evidence));
  await fs.writeFile(target,JSON.stringify(record));
  await assert.rejects(f.runtime.validateHostTurn(captured.hostTurn),/host_turn_source_changed/);
  await assert.rejects(reply(f.runtime,captured),/host_turn_source_changed/);await close(f.runtime);
});

await check('native Bridge取消／close立即終止工作，不等待十五分鐘',async()=>{
  const f=await fixture('cancel-close'),first=(await f.bridge.begin('synthetic-session','first',text,originalTime)).capture;
  const runtime=await f.bridge.runtime('synthetic-session');await f.bridge.cancel('synthetic-session','本單合成取消');
  assert.equal((await runtime.progress(first.hostTurn.workId)).cancelRequested,true);
  await assert.rejects(runtime.validateHostTurn(first.hostTurn),/host_turn_not_active/);
  const second=(await f.bridge.begin('synthetic-session','second','這是另一輪合成來源。',originalTime)).capture;
  await close(f.bridge);assert.equal((await runtime.progress(second.hostTurn.workId)).state,'cancelled');
});

test.after(async()=>{
  Date.now=originalNow;for(const value of open)await close(value);globalThis.fetch=originalFetch;assert.equal(networkCalls,0);
  const files=['src/cmcp-guard/cmcp-runtime-session.js','adapters/deepseek-harness/runtime-bridge.mjs','adapters/deepseek-harness/host-turn-deadline.test.mjs'];
  const sourceHashes=Object.fromEntries(await Promise.all(files.map(async file=>[file,sha(await fs.readFile(path.join(repo,file)))])));
  await fs.writeFile(path.join(runRoot,'run-index.json'),JSON.stringify({kind:'cmcp_host_turn_deadline_offline',at:new Date().toISOString(),runRoot,
    cases,sourceHashes,clockBoundary:'僅明示推進執行期限的Date.now；正式User／Assistant原時間另外明示，未等待真時鐘。',
    modelCalls:0,networkCalls,providerWire:'NOT_RUN'},null,2)+'\n',{flag:'wx'});
  process.stdout.write('本單離線證據：'+runRoot+'\n');
});
