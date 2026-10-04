import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const productRoot=process.env.CMCP_PRODUCT_ROOT?path.resolve(process.env.CMCP_PRODUCT_ROOT):fileURLToPath(new URL('../../',import.meta.url));
const {acquireCmcpRecoveryLeases}=await import(pathToFileURL(path.join(productRoot,'src/cmcp-guard/cmcp-recovery-lease.js')).href);
const moduleURL=pathToFileURL(path.join(productRoot,'src/cmcp-guard/cmcp-runtime-session.js')).href;
const {createCmcpRuntimeSession,recoverCmcpRuntimeWork}=await import(moduleURL);

const root=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(process.cwd(),'.cmcp-test-output/project-entry'),'recovery');await fs.mkdir(root,{recursive:true});
test('活躍或無法證明擁有者的鎖不得移存；原件保持不變',async()=>{
  const directory=await fs.mkdtemp(path.join(root,'live-')),file=path.join(directory,'.common-input-writer.lock');await fs.writeFile(file,String(process.pid));
  await assert.rejects(acquireCmcpRecoveryLeases({lockFiles:[file],expectedOwnerPid:process.pid}),/owner_not_confirmed_exited/);assert.equal(await fs.readFile(file,'utf8'),String(process.pid));
  await assert.rejects(acquireCmcpRecoveryLeases({lockFiles:[file],expectedOwnerPid:null}),/owner_not_confirmed_exited/);
});
test('多鎖身分不一致時不部分移存，硬連結別名拒絕',async()=>{
  const directory=await fs.mkdtemp(path.join(root,'mismatch-')),a=path.join(directory,'a/.common-input-writer.lock'),b=path.join(directory,'b/.common-input-writer.lock');await fs.mkdir(path.dirname(a));await fs.mkdir(path.dirname(b));await fs.writeFile(a,'123');await fs.writeFile(b,'456');
  await assert.rejects(acquireCmcpRecoveryLeases({lockFiles:[a,b],expectedOwnerPid:123,processAlive:()=>false}),/owner_not_confirmed_exited/);assert.equal(await fs.readFile(a,'utf8'),'123');assert.equal(await fs.readFile(b,'utf8'),'456');
  const alias=path.join(directory,'linked.lock');await fs.link(a,alias);await assert.rejects(acquireCmcpRecoveryLeases({lockFiles:[a],expectedOwnerPid:123,processAlive:()=>false}),/alias_denied/);
});
test('隔離子程序真正非正常退出後，正式恢復保留原鎖與原文，拒絕舊票券及晚到回答',{timeout:30000},async()=>{
  const directory=await fs.mkdtemp(path.join(root,'crash-')),configFile=path.join(directory,'runtime.json'),receiptFile=path.join(directory,'child-receipt.json');
  const config={kind:'cmcp_runtime_config',version:1,runtimeId:'crash-synthetic',providerMode:'host',input:{root:'state',scopeId:'crash-synthetic',events:[],timezone:'Asia/Taipei',limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:'receipts',sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true},bufferRetention:{hours:12}};await fs.writeFile(configFile,JSON.stringify(config));
  const childSource=`import fs from 'node:fs/promises';import {createCmcpRuntimeSession} from ${JSON.stringify(moduleURL)};
const [configFile,root,receiptFile]=process.argv.slice(1);const config=JSON.parse(await fs.readFile(configFile,'utf8'));const runtime=await createCmcpRuntimeSession({config,repoRoot:root,sessionId:'same-session'});
const first=await runtime.beforeUser({text:'合成原案：週五十點舉行，仍須書面同意。',sourceId:'u1',timeContext:{now:'2026-10-04T01:00:00.000Z',timezone:'Asia/Taipei'},hostTurn:{workId:'completed-turn'}});
const answer=await runtime.afterAssistant({text:'合成草稿保留書面同意條件。',sourceId:'a1',replyTo:first.sourcePointer,hostTurn:first.hostTurn,timeContext:{now:'2026-10-04T01:00:01.000Z',timezone:'Asia/Taipei'}});
const pending=await runtime.beforeUser({text:'改成週六十一點，條件不變。',sourceId:'u2',timeContext:{now:'2026-10-04T01:01:00.000Z',timezone:'Asia/Taipei'},hostTurn:{workId:'interrupted-turn'}});
await fs.writeFile(receiptFile,JSON.stringify({pid:process.pid,first,answer,pending,sources:(await runtime.status()).state.registration.sources}));process.exit(23);`;
  const child=spawn(process.execPath,['--input-type=module','-e',childSource,configFile,directory,receiptFile],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});assert.equal(exit.code,23,stderr);
  const before=JSON.parse(await fs.readFile(receiptFile,'utf8')),lockFile=path.join(directory,'state/.common-input-writer.lock');assert.equal(await fs.readFile(lockFile,'utf8'),String(before.pid));
  await assert.rejects(createCmcpRuntimeSession({config,repoRoot:directory,sessionId:'new-session'}),/EEXIST|writer/);
  const recovery=await recoverCmcpRuntimeWork({config,repoRoot:directory,workId:'interrupted-turn',reason:'synthetic_child_exit_23'});
  assert.equal(recovery.work.state,'interrupted_unknown');assert.equal(recovery.remoteOutcome,'unknown');assert.equal(recovery.modelCalls,0);assert.equal(recovery.preservedLeases.length,1);assert.equal(await fs.readFile(recovery.preservedLeases[0].preservedPath,'utf8'),String(before.pid));
  const runtime=await createCmcpRuntimeSession({config,repoRoot:directory,sessionId:'same-session'});
  try{
    const after=(await runtime.status()).state.registration.sources;assert.deepEqual(after,before.sources);
    for(const source of after){const found=await runtime.readSource({pointer:source.pointer,evidenceHash:source.evidenceHash,start:0,end:source.location.end,maxBytes:4096});assert.equal(found.status,'found');assert.equal(found.sourceAuthorRole,source.sourceAuthorRole);assert.equal(found.messageRecordedAt,source.messageRecordedAt);}
    await assert.rejects(runtime.afterAssistant({text:'不應保存的晚到回答',sourceId:'late',replyTo:before.pending.sourcePointer,hostTurn:before.pending.hostTurn,timeContext:{now:'2026-10-04T01:02:00.000Z',timezone:'Asia/Taipei'}}),/host_turn_not_active|host_turn_owner/);
    assert.equal((await runtime.status()).state.registration.sources.length,before.sources.length);
    await fs.writeFile(path.join(directory,'recovery-result.json'),JSON.stringify({exit,recovery,originalsUnchanged:true,lateAnswerRejected:true},null,2));
  }finally{await runtime.close();}
  const repeated=await recoverCmcpRuntimeWork({config,repoRoot:directory,workId:'interrupted-turn'});assert.equal(repeated.work.state,'interrupted_unknown');assert.equal(repeated.preservedLeases.length,0);
});
