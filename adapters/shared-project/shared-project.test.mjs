import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createSharedProjectService} from './service.mjs';
import {startSharedProjectServer} from './server.mjs';
import {callSharedProject} from './client.mjs';
import {CmcpHarnessBridge} from '../deepseek-harness/runtime-bridge.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=process.env.CMCP_TEST_OUTPUT_ROOT?path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT):path.resolve(repo,'logs/tests/shared-project');
await fs.mkdir(base,{recursive:true});const run=await fs.mkdtemp(path.join(base,'run-'));
const sha=v=>createHash('sha256').update(v).digest('hex');
const realFetch=globalThis.fetch;let fetches=0;globalThis.fetch=async()=>{fetches++;throw Error('synthetic_test_network_forbidden');};
const resources=new Set();
async function fixture(label,{controls={},factory}={}){
  const root=path.join(run,label);await fs.mkdir(path.join(root,'workspace'),{recursive:true});const workspace=path.join(root,'workspace');
  const runtime={kind:'cmcp_runtime_config',version:1,runtimeId:'shared-synthetic',providerMode:'host',input:{root:path.join(root,'state'),scopeId:'synthetic-shared-project',events:[],timezone:'Asia/Taipei',
    limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:128,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
    receiptRoot:path.join(root,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false,...controls},answerHistory:{enabled:true},
    localRetrieval:{maxStoredSources:128,maxCandidates:8,maxCandidateBytes:12000,maxExcerptCodePoints:420,maxQueryBytes:4096,maxIndexSourceBytes:8192,maxIndexTokens:131072,maxReadSources:2,maxReadBytes:16384,maxProjectionBytes:12000}};
  const runtimeConfig=path.join(root,'runtime.json');await fs.writeFile(runtimeConfig,JSON.stringify(runtime));const hosts={};
  for(const hostId of ['harness','codex']){hosts[hostId]={workspace,agentId:'synthetic-agent',controlAuthFile:path.join(root,hostId+'-controller.credential.json'),readAuthFile:path.join(root,hostId+'-read.credential.json')};
    for(const role of ['controller','model_read'])await fs.writeFile(hosts[hostId][role==='controller'?'controlAuthFile':'readAuthFile'],JSON.stringify({kind:'cmcp_shared_project_credential',version:1,projectId:'synthetic-project',hostId,role,token:sha(label+hostId+role)}));}
  const config={kind:'cmcp_shared_project_config',version:1,projectId:'synthetic-project',projectRoot:root,runtimeConfig,traceRoot:path.join(root,'trace'),pipe:'\\\\.\\pipe\\cmcp-test-'+randomUUID(),lifetimeMs:60000,hosts};
  let bridge;const service=await createSharedProjectService({config,bridgeFactory:options=>{bridge=new CmcpHarnessBridge(options);return factory?factory(bridge):bridge;}});resources.add(service);
  let counter=0;const req=(hostId,sessionId,operation,args={},epoch)=>({projectId:config.projectId,hostId,agentId:hosts[hostId].agentId,workspace,sessionId,operation,args,requestId:'request-'+(++counter),...(epoch?{epoch}:{})});
  const call=(r,role='controller')=>service.dispatch(r,{role,hostId:r.hostId});
  const join=async(hostId='harness',sid='same-native-session')=>{const joined=await call(req(hostId,sid,'join'));return {hostId,sid,epoch:joined.epoch};};
  const claim=async who=>{const v=await call(req(who.hostId,who.sid,'claim',{},who.epoch));who.epoch=v.epoch;return who;};
  const send=(who,op,args={},role='controller')=>call(req(who.hostId,who.sid,op,args,who.epoch),role);
  const begin=async(who,text='合成紙雕展初稿：八位參觀者，場地尚待書面同意。',revisionId='r1')=>{const args={messageId:'same-native-message',revisionId,text,receivedAt:new Date().toISOString()};const receipt=await send(who,'receive',args);await send(who,'claim-turn',{messageId:args.messageId,revisionId,harnessTurn:1});return {receipt,args};};
  const finish=(who,revisionId='r1')=>send(who,'finish',{messageId:'same-native-message',revisionId,text:'合成答覆：保留書面同意條件。',receivedAt:new Date().toISOString(),userMessageId:'same-native-message',userRevisionId:revisionId,harnessTurn:1});
  return {root,config,runtime,service,bridge,req,call,join,claim,send,begin,finish};
}
async function files(root){const result={};async function walk(dir){let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const e of entries){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else result[path.relative(root,p)]=sha(await fs.readFile(p));}}await walk(root);return result;}

test('Bridge metadata callback uses existing receipt and has no source body',async()=>{
  const root=path.join(run,'receipt-callback');await fs.mkdir(root);const seen=[];const bridge=new CmcpHarnessBridge({deploymentRoot:root,runtimeConfig:path.join(root,'unused.json'),traceRoot:path.join(root,'trace'),scopeId:'synthetic',onReceipt:row=>seen.push(row)});
  await bridge.note('session','formal_read',{sourceBindings:[],projectionHash:'a'.repeat(64)});assert.equal(seen.length,1);assert.equal(Object.hasOwn(seen[0],'text'),false);await bridge.close();
});
test('Bridge passes sessionGuard to both User publication and turn admission',async()=>{
  const root=path.join(run,'guard-forward');await fs.mkdir(root);const bridge=new CmcpHarnessBridge({deploymentRoot:root,runtimeConfig:path.join(root,'unused.json'),traceRoot:path.join(root,'trace'),scopeId:'synthetic'}),guard=()=>true,observed=[];
  const runtime={config:{input:{timezone:'UTC'}},controlsSnapshot:async()=>({generation:'g',effective:{enabled:true,clean:false,saveUser:true,saveAssistant:true,historyRecall:true}}),beforeUser:async input=>{observed.push(input.sessionGuard);return {status:'stored',sourcePointer:null};},close:async()=>{}};
  bridge.current={sessionId:'session',runtime};await bridge.receive('session','u','合成輸入',new Date().toISOString(),[],guard);await bridge.claim('session','u',1);assert.deepEqual(observed,[guard,guard]);bridge.turns.clear();await bridge.close();
});
test('unauthorized project, exact workspace, host, role and unknown schema fail closed',async()=>{
  const f=await fixture('unauthorized'),r=f.req('harness','s','join');
  await assert.rejects(f.call({...r,projectId:'private-project'}),/unauthorized_project/);
  await assert.rejects(f.call({...r,workspace:path.join(f.root,'workspace','nested')}),/identity_mismatch/);
  await assert.rejects(f.service.dispatch(r,{hostId:'codex',role:'controller'}),/unauthorized_host/);
  await assert.rejects(f.call(r,'model_read'),/role_forbidden/);await assert.rejects(f.call({...r,rawConfig:{}}),/invalid_schema/);
  assert.equal((await files(path.join(f.root,'state'))).constructor,Object);assert.deepEqual(await files(path.join(f.root,'state')),{});
});
test('join, status, progress visibility and owner claim never clear Clean/OFF',async()=>{
  for(const [label,controls]of [['off',{enabled:false}],['clean',{clean:true}]]){const f=await fixture(label,{controls}),who=await f.join(),before=await files(f.root);
    await assert.rejects(f.claim(who),/controls_disabled/);assert.equal((await f.send(who,'status')).joined,true);assert.deepEqual(await files(f.root),before);}
});
test('same native IDs on two hosts remain separate originals, with formal provenance and source versions',async()=>{
  const f=await fixture('collision'),a=await f.claim(await f.join()),one=await f.begin(a);const firstAnswer=await f.finish(a),b=await f.join('codex');
  const target={hostId:b.hostId,agentId:'synthetic-agent',workspace:f.config.hosts.codex.workspace,sessionId:b.sid};const handoff=f.req(a.hostId,a.sid,'handoff',{target},a.epoch),moved=await f.call(handoff);b.epoch=moved.epoch;
  assert.deepEqual(await f.call(handoff),moved);await assert.rejects(f.send(a,'receive',one.args),/epoch_stale/);
  const two=await f.begin(b,'合成紙雕展修訂：改為十位參觀者，書面同意仍未確認。');const secondAnswer=await f.finish(b);
  assert.notEqual(one.receipt.capture.sourcePointer.sessionId,two.receipt.capture.sourcePointer.sessionId);assert.notEqual(one.receipt.capture.sourcePointer.itemId,two.receipt.capture.sourcePointer.itemId);
  assert.notEqual(firstAnswer.sourcePointer.itemId,secondAnswer.sourcePointer.itemId);assert.notEqual(one.receipt.capture.sourcePointer.itemId,firstAnswer.sourcePointer.itemId);
  assert.equal(two.receipt.origin.origin.hostId,'codex');assert.match(two.receipt.origin.evidenceHash,/^[a-f0-9]{64}$/);
  await assert.rejects(f.send(b,'receive',{...two.args,text:'相同版本不得改正文'}),/source_version_conflict/);
  const revision=await f.send(b,'receive',{...two.args,revisionId:'r2',text:'另存明示修訂版，不能覆寫。'});assert.notEqual(revision.capture.sourcePointer.itemId,two.receipt.capture.sourcePointer.itemId);
});
test('active turn or unclaimed input blocks handoff; queued cancel discards without answer',async()=>{
  const f=await fixture('active-handoff'),a=await f.claim(await f.join()),b=await f.join('codex'),target={hostId:b.hostId,agentId:'synthetic-agent',workspace:f.config.hosts.codex.workspace,sessionId:b.sid};
  await f.begin(a);await assert.rejects(f.send(a,'handoff',{target}),/active_turn/);await f.finish(a);
  await f.send(a,'receive',{messageId:'queued',text:'尚未領取的合成輸入',receivedAt:new Date().toISOString()});await assert.rejects(f.send(a,'handoff',{target}),/active_turn/);
  assert.equal((await f.send(a,'cancel',{userMessageId:'queued',reason:'official_inbox_discarded'})).status,'discarded');assert.ok((await f.send(a,'handoff',{target})).epoch);
});
test('duplicate save request is unchanged and different request contents are rejected',async()=>{
  const f=await fixture('idempotence'),a=await f.claim(await f.join()),input={messageId:'u',text:'合成冪等輸入',receivedAt:new Date().toISOString()},request=f.req(a.hostId,a.sid,'receive',input,a.epoch),first=await f.call(request),before=await files(f.root);
  assert.deepEqual(await f.call(request),first);assert.deepEqual(await files(f.root),before);await assert.rejects(f.call({...request,args:{...input,text:'改寫'}}),/request_conflict/);
  await f.send(a,'claim-turn',{messageId:'u',harnessTurn:1});const completion=f.req(a.hostId,a.sid,'finish',{messageId:'a',text:'合成答',receivedAt:new Date().toISOString(),userMessageId:'u',harnessTurn:1},a.epoch);
  const saved=await f.call(completion),after=await files(f.root);assert.deepEqual(await f.call(completion),saved);assert.deepEqual(await files(f.root),after);
});
test('revoke preempts awaited User publication; no original is written and next owner can claim',async()=>{
  let entered,release;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
  const f=await fixture('revoke-publication',{factory:bridge=>{const original=bridge.receive.bind(bridge);bridge.receive=async(...args)=>{entered();await gate;return original(...args);};return bridge;}}),a=await f.claim(await f.join());
  const pending=f.send(a,'receive',{messageId:'u',text:'撤權後不可出版',receivedAt:new Date().toISOString()});await ready;
  const revoked=f.send(a,'revoke');release();await assert.rejects(pending,/authorization_changed/);await revoked;
  assert.equal((await f.bridge.readOnly(async r=>(await r.status()).state.registration.sources)).length,0);
  const b=await f.claim(await f.join('codex'));assert.ok(b.epoch);await assert.rejects(f.send(a,'claim-turn',{messageId:'u'}),/epoch_stale/);
});
test('revoke cancels formal running ticket and releases owned lock without deleting another lock',async()=>{
  const f=await fixture('revoke-active'),a=await f.claim(await f.join());await f.begin(a);const before=await f.bridge.current.runtime.status();assert.equal(before.work.some(x=>x.state==='running'),true);
  await f.send(a,'revoke');const after=await f.bridge.readOnly(r=>r.status());assert.equal(after.work.some(x=>x.mode==='host_turn'&&x.state==='cancelled'),true);
  assert.equal(await fs.stat(path.join(f.config.projectRoot,'state','.common-input-writer.lock')).then(()=>true,()=>false),false);
});
test('read-only status is zero mutation, provenance journal contains no source body',async()=>{
  const f=await fixture('readonly'),a=await f.claim(await f.join());const original='合成秘密代碼-不應出現在metadata正文副本';await f.begin(a,original);await f.finish(a);
  const before=await files(f.root);await f.send(a,'status');await f.send(a,'status');assert.deepEqual(await files(f.root),before);
  const journal=await fs.readdir(path.join(f.root,'state','input-journal'));let rows=[];for(const name of journal)rows.push(JSON.parse(await fs.readFile(path.join(f.root,'state','input-journal',name),'utf8')));
  const provenance=rows.filter(r=>r.record.kind.startsWith('shared_project_source_'));assert.ok(provenance.length>=4);assert.equal(JSON.stringify(provenance).includes(original),false);
});
test('provenance reload preserves version binding and broker restart invalidates old epoch',async()=>{
  const f=await fixture('restart'),a=await f.claim(await f.join()),one=await f.begin(a);await f.finish(a);await f.service.close();
  const fresh=await createSharedProjectService({config:f.config});resources.add(fresh);const call=(op,args,epoch)=>fresh.dispatch(f.req(a.hostId,a.sid,op,args,epoch),{hostId:a.hostId,role:'controller'}),join=await call('join',{});
  await assert.rejects(call('claim',{},a.epoch),/epoch_stale/);const owner=await call('claim',{},join.epoch);
  await assert.rejects(call('receive',{...one.args,text:'重啟後亦不能改原件'},owner.epoch),/source_version_conflict/);
});
test('named pipe authenticates per-host role; finite close rejects connections and releases lock',async()=>{
  const f=await fixture('ipc');await f.service.close();const server=await startSharedProjectServer({config:f.config});resources.add(server);
  const request=f.req('harness','ipc-session','join'),connection={pipe:server.pipe,authFile:f.config.hosts.harness.controlAuthFile};
  assert.equal((await callSharedProject({connection,role:'controller',request})).joined,true);
  await assert.rejects(callSharedProject({connection:{...connection,authFile:f.config.hosts.harness.readAuthFile},role:'model_read',request}),/role_forbidden/);
  await assert.rejects(callSharedProject({connection,role:'model_read',request}),/credential_binding_mismatch/);await server.close();await assert.rejects(callSharedProject({connection,role:'controller',request}),/ipc_unavailable/);
});
test('formal cross-host find/open/read returns verified origin; progress is zero mutation',async()=>{
  const f=await fixture('formal-reader'),a=await f.claim(await f.join());await f.begin(a);await f.finish(a);const b=await f.join('codex');
  b.epoch=(await f.send(a,'handoff',{target:{hostId:b.hostId,agentId:'synthetic-agent',workspace:f.config.hosts.codex.workspace,sessionId:b.sid}})).epoch;
  await f.begin(b,'請找回紙雕展初稿，八位參觀者及書面同意條件。');
  const navigation=await f.send(b,'find',{},'model_read');assert.ok(navigation.ticket);
  const opened=await f.send(b,'open',{navigationTicket:navigation.ticket,selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''})},'model_read');assert.ok(opened.ticket);
  let matched=false;for(let n=0;n<8;n++){const page=await f.send(b,'read',{ticket:opened.ticket},'model_read');
    if(page.sourceOrigins?.some(row=>row.origin?.hostId==='harness'&&row.verification==='formal_read_binding'))matched=true;
    if(page.coverage?.complete||['complete','complete_with_gaps'].includes(page.status))break;}
  assert.equal(matched,true);const before=await files(f.root);await f.send(b,'progress',{ticket:opened.ticket},'model_read');await f.send(b,'progress',{ticket:opened.ticket},'model_read');assert.deepEqual(await files(f.root),before);
  await assert.rejects(f.send(b,'read',{ticket:'foreign-ticket'},'model_read'),/reading_not_owned_by_turn/);await f.finish(b);
});
test('external writer lock blocks source intent and is never reclaimed',async()=>{
  const f=await fixture('foreign-lock'),a=await f.claim(await f.join());await fs.mkdir(path.join(f.root,'state'),{recursive:true});
  const lock=path.join(f.root,'state','.common-input-writer.lock');await fs.writeFile(lock,'unrelated-writer',{flag:'wx'});const before=await files(f.root);
  await assert.rejects(f.send(a,'receive',{messageId:'u',text:'不可旁路writer',receivedAt:new Date().toISOString()}),/EEXIST/);assert.deepEqual(await files(f.root),before);
  await f.service.close();assert.equal(await fs.readFile(lock,'utf8'),'unrelated-writer');
});
test('runtime config drift and unexpected schema fail closed without changing shared state',async()=>{
  const f=await fixture('config-drift'),a=await f.claim(await f.join());await fs.writeFile(f.config.runtimeConfig,JSON.stringify({...f.runtime,runtimeId:'changed'}));
  await assert.rejects(f.send(a,'receive',{messageId:'u',text:'不可換共享根',receivedAt:new Date().toISOString()}),/runtime_configuration_changed/);assert.deepEqual(await files(path.join(f.root,'state')),{});
  // 通用宿主名稱可登錄，但不能重用另一宿主的 controller／reader 憑證。
  await assert.rejects(createSharedProjectService({config:{...f.config,hosts:{...f.config.hosts,other:f.config.hosts.codex}}}),/credential_files_must_differ/);
  await assert.rejects(createSharedProjectService({config:{...f.config,unexpected:true}}),/invalid_schema/);
});
test('finite configured lifetime closes service without re-enabling or granting a session',async()=>{
  const f=await fixture('finite');await f.service.close();const service=await createSharedProjectService({config:{...f.config,lifetimeMs:1000}});resources.add(service);
  await new Promise(resolve=>setTimeout(resolve,1100));await assert.rejects(service.dispatch(f.req('harness','s','join'),{hostId:'harness',role:'controller'}),/shared_project_closed/);
});
test('failed revocation cleanup blocks rejoin and owner replacement until explicit retry',async()=>{
  let fail=true;const f=await fixture('revoke-failure',{factory:bridge=>{const cancel=bridge.cancel.bind(bridge);bridge.cancel=async(...args)=>{if(fail){fail=false;throw Error('synthetic_cancel_failure');}return cancel(...args);};return bridge;}}),a=await f.claim(await f.join());await f.begin(a);
  await assert.rejects(f.send(a,'revoke'),/synthetic_cancel_failure/);await assert.rejects(f.join(),/revocation_incomplete/);
  const b=await f.join('codex');await assert.rejects(f.claim(b),/owner_required/);await f.send(a,'revoke');assert.ok((await f.claim(await f.join('codex'))).epoch);
});
test('cancel preempts awaited Assistant publication without revoking the owner',async()=>{
  const f=await fixture('cancel-publication'),a=await f.claim(await f.join());await f.begin(a);
  const original=f.bridge.complete.bind(f.bridge);let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  f.bridge.complete=async(...args)=>{entered();await gate;return original(...args);};
  const pending=f.finish(a);await ready;const cancellation=f.send(a,'cancel',{userMessageId:'same-native-message',harnessTurn:1,reason:'official_interrupt'});release();await assert.rejects(pending,/authorization_changed/);await cancellation;
  assert.equal((await f.send(a,'status')).joined,true);const sources=await f.bridge.readOnly(async r=>(await r.status()).state.registration.sources);assert.equal(sources.filter(s=>s.sourceAuthorRole==='assistant').length,0);
});
test('共用正式控制：加入不解除 Clean，模型／重播不得取得新控制授權',async()=>{
 const f=await fixture('universal-controls',{controls:{clean:true}}),a=await f.join();
 const help=await f.send(a,'control',{text:'help'});assert.equal(help.snapshot.controlConfiguration.effective.clean,true);assert.equal(help.menu.scope.scopeId,f.runtime.input.scopeId);
 assert.equal(help.menu.operations.some(r=>r.command==='on / off'),false);assert.ok(help.menu.unsupported.some(r=>r.includes('/disable')));
 await assert.rejects(f.send(a,'control',{text:'set clean off'},'model_read'),/role_forbidden/);
 const r=f.req(a.hostId,a.sid,'control',{text:'set clean off'},a.epoch),changed=await f.call(r);assert.equal(changed.snapshot.controlConfiguration.effective.clean,false);
 await assert.rejects(f.call(r),/command_replayed/);
 const b=await f.join('codex','B');await f.claim(a);await assert.rejects(f.send(b,'control',{text:'set enabled off'}),/owner_required|epoch_stale/);
 await f.send(a,'revoke');await assert.rejects(f.send(a,'control',{text:'status'}),/epoch_stale|not_joined/);
});
test('共用 CLI 選項正式閱讀，查看不改原文／Buffer／Pin與控制',async()=>{
 const f=await fixture('universal-read'),a=await f.claim(await f.join());await f.begin(a);await f.finish(a);
 const before=await f.bridge.status(),list=await f.send(a,'control',{text:'sources'});assert.equal(list.result.choices.length,2);
 const read=await f.send(a,'control',{text:'read 1'});assert.equal(read.result.status,'found');assert.equal(read.result.completeStoredContent,true);
 const after=await f.bridge.status();for(const key of ['registration','pins','controlConfiguration'])assert.deepEqual(after[key],before[key]);assert.deepEqual({...after.buffer,evaluatedAt:null},{...before.buffer,evaluatedAt:null});
 await f.send(a,'control',{text:'set clean on'});await assert.rejects(f.send(a,'control',{text:'read 1'}),/expired|controls_disabled/);
});
test('all synthetic resources close and no network/model call occurred',async()=>{for(const resource of resources)await resource.close();globalThis.fetch=realFetch;assert.equal(fetches,0);});
