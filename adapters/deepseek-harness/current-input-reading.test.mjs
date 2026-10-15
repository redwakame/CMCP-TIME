// 合成 Runtime／reader 反例；不啟動宿主、不連網、不讀私人原文。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCmcpRuntimeSession} from '../../src/cmcp-guard/cmcp-runtime-session.js';
import {createCmcpReactivationStores} from '../../src/cmcp-guard/cmcp-history-reactivation.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(repo,'logs/tests/current-input'));
await fs.mkdir(base,{recursive:true});
const root=await fs.mkdtemp(path.join(base,'current-input-'));
const limits={maxSources:16,maxTotalBytes:65536,maxPageBytes:2400,maxPages:64,maxProjectionBytes:16384};
const selection={version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''};
const prior='我計畫週六辦讀書聚會，八位參加者；場地同意尚未取得。';
const revision='聚會改在週日，其他條件維持，因為講者週六有事。';
const zone='Asia/Taipei';let sequence=0;
async function fixture(t,{saveUser=true,capacity=16}={}){
 const dir=path.join(root,String(++sequence));await fs.mkdir(dir);
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'current-input-test',providerMode:'host',
  input:{root:path.join(dir,'state'),scopeId:'current-input-scope',events:[],timezone:zone,
   limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},
   storageCapacity:{maxSources:capacity,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
  receiptRoot:path.join(dir,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:dir,sessionId:'fixture-session',hostProvider:{request:async()=>{throw Error('禁止模型呼叫');}}});
 t.after(()=>runtime.close());
 await runtime.ingest({text:prior,role:'user',timeContext:{now:new Date(Date.now()-60000).toISOString(),timezone:zone}});
 if(!saveUser)await runtime.configureControls({updateId:'stop-new-user-save',patch:{saveUser:false}});
 const navigation=await runtime.readingNavigate({text:revision});
 return {runtime,config,navigation,open:options=>runtime.readingOpen({navigationTicket:navigation.host.ticket,mode:'all',selection,limits,...(!saveUser?{queryText:revision}:{}),...options})};
}
test('預設閱讀仍只包含先前來源',async t=>{
 const f=await fixture(t),opened=await f.open({});assert.equal(opened.reader.collection.sourceCount,1);
 const page=await f.runtime.readingPage({ticket:opened.reader.ticket,project:true});assert.equal(page.reader.text,prior);assert.equal(page.reader.coverage.complete,true);
});
test('明示附入當輪正式原文，範圍分列且不重存或刷新時間',async t=>{
 const f=await fixture(t),opened=await f.open({includeCurrentInput:true});
 const descriptor=opened.reader.collection.scopeDescriptor;
 assert.equal(descriptor.kind,'authorized_history_with_current_input');assert.equal(descriptor.historySourceCount,1);
 assert.equal(descriptor.currentInput.ref,'r2');assert.equal(descriptor.currentInput.sourceAuthorRole,'user');
 assert.equal(Object.hasOwn(descriptor.currentInput,'pointer'),false);assert.equal(Object.hasOwn(descriptor.currentInput,'evidenceHash'),false);
 const first=await f.runtime.readingPage({ticket:opened.reader.ticket,project:true}),before=await f.runtime.bufferList();
 const second=await f.runtime.readingPage({ticket:opened.reader.ticket,project:true}),pages=[first,second];
 assert.equal(second.internal.bufferActivated,false);
 assert.deepEqual(pages.map(p=>p.reader.text),[prior,revision]);assert.ok(pages[1].modelContext);
 assert.equal(pages[1].reader.source.messageRecordedAt,descriptor.currentInput.messageRecordedAt);
 assert.deepEqual((await f.runtime.bufferList()).items,before.items);
 const status=await f.runtime.status();assert.equal(status.state.registration.sources.length,2);
 const result=await f.runtime.readingContinuity({ticket:opened.reader.ticket,proposal:{version:2,nodes:[
  {id:'p1',ref:'r1',quote:prior,kind:'user_intent',temporalUse:'current',text:'週六計畫',topic:'聚會',aspect:'day',relation:{kind:'independent',targetNodeIds:[]}},
  {id:'p2',ref:'r2',quote:revision,kind:'user_intent',temporalUse:'current',text:'週日計畫',topic:'聚會',aspect:'day',relation:{kind:'revises',targetNodeIds:['p1']}}
 ],unknowns:[]}});
 assert.equal(result.status,'ready');assert.equal(result.projection.currentPlans.length,1);assert.deepEqual(result.projection.currentClaims,[]);
});
test('不保存的當輪不得由 ephemeral query 冒充來源',async t=>{
 const f=await fixture(t,{saveUser:false});await assert.rejects(f.open({includeCurrentInput:true}),/current_input_not_saved/);
});
test('待登錄的當輪不得附入正式集合',async t=>{
 const f=await fixture(t,{capacity:1});await assert.rejects(f.open({includeCurrentInput:true}),/current_input_unregistered_or_changed/);
});
test('選項須明確布林值及正式 navigation ticket',async t=>{
 const f=await fixture(t);await assert.rejects(f.open({includeCurrentInput:'true'}),/invalid_current_input_reading_option/);
 await assert.rejects(f.runtime.readingOpen({text:revision,mode:'all',inventory:{},limits,includeCurrentInput:true}),/current_input_requires_navigation_ticket/);
});
test('Clean 阻止附入；不清除已保存原文',async t=>{
 const f=await fixture(t);await f.runtime.setControls({clean:true});const result=await f.open({includeCurrentInput:true});assert.equal(result.status??result.reader?.status??result.host?.status,'disabled');
 const stores=createCmcpReactivationStores({root:f.config.input.root,scopeId:f.config.input.scopeId});
 assert.equal((await stores.history.resolve(f.navigation.internal.queryPointer)).status,'found');
});
test('取消票券後不得附入',async t=>{
 const f=await fixture(t);await f.runtime.revokeReading({ticket:f.navigation.host.ticket,reason:'synthetic_cancel'});
 await assert.rejects(f.open({includeCurrentInput:true}),/cancel|revok/);
});
