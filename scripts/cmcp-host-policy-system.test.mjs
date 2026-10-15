// 官方 assembly 介面替身與真 Native Bridge／Core；零模型，不啟動 Desktop。
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const productRoot=path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT??sourceRoot);
const load=relative=>import(pathToFileURL(path.join(productRoot,relative)).href);
const {installContinuitySystemPolicy,observeContinuitySystemPolicy,CONTINUITY_SYSTEM_SECTION}=await load('adapters/deepseek-harness/continuity-system-policy.mjs');
const {CONTINUITY_BEFORE_ANSWER_POLICY:policy,CONTINUITY_POLICY_METADATA:metadata,CONTINUITY_ATTRIBUTION_RULES:attribution,CONTINUITY_KIND_RULES:kindRules,CONTINUITY_SOURCE_TIME_RULES:timeRules,CONTINUITY_READING_CONTRACT:readingContract}=await load('adapters/continuity-policy.mjs');
const {apply:nativeApply}=await load('adapters/deepseek-harness/native-desktop/host.mjs');
const {createSharedHarnessHost}=await load('adapters/deepseek-harness/shared-project/host.mjs');
const outputBase=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(sourceRoot,'logs/tests/system-policy'));
await fs.mkdir(outputBase,{recursive:true});
const output=await fs.mkdtemp(path.join(outputBase,'system-policy-'));
const hash=data=>createHash('sha256').update(data).digest('hex');
const observations=[];
let networkCalls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{networkCalls++;throw Error('本測試禁止模型與網路');};
after(async()=>{globalThis.fetch=originalFetch;assert.equal(networkCalls,0);await fs.writeFile(path.join(output,'observations.json'),JSON.stringify({kind:'cmcp_system_policy_zero_model',productRoot,networkCalls,desktopStarted:false,layer:'正式宿主接點與 Native Core，官方 assembly／shared broker 使用介面替身',observations},null,2),{flag:'wx'});});
const baseline=()=>({sections:[{name:'native:identity',text:'原生身分保持。'},{name:'other-skill',text:'其他技能保持。'}],contexts:[{name:'native-context',text:'原生環境'}],tools:[{name:'native-filesystem',parameters:{type:'object'}}],variables:{cwd:'合成工作區'},nativeExtra:{kept:true}});
const assertAdded=(got,original)=>{assert.notEqual(got,original);assert.deepEqual(got.sections.slice(0,-1),original.sections);assert.deepEqual(got.sections.at(-1),{name:CONTINUITY_SYSTEM_SECTION,text:policy,interpolate:false});for(const key of ['contexts','tools','variables','nativeExtra'])assert.equal(got[key],original[key]);assert.equal(got.sections.some(section=>section.complete===true),false);};
function helperFixture({authorize,provide,error}={}){
 const agent={id:'explicit-agent'},state={agent,enabled:true},handlers=new Map(),calls=[];
 const disposer=()=>handlers.delete('system-prompt/assemble');
 const returned=installContinuitySystemPolicy({on(name,handler){handlers.set(name,handler);return disposer;}},{
  resolveAgent:value=>value===agent&&state.enabled?state:null,
  authorized:async(...args)=>{calls.push('authorized');return authorize?authorize(...args):{metadata:{sessionId:agent.id},valid:()=>state.enabled};},
  onProvided:async(...args)=>{calls.push('provided');await provide?.(...args);},
  onError:async(...args)=>{calls.push('error');await error?.(...args);}
 });
 assert.equal(returned,disposer);
 return{agent,state,calls,handlers,returned,run:(original=baseline(),context={agent},next=async()=>original)=>handlers.get('system-prompt/assemble')(original,context,next)};
}
test('assembly 等待原生 waterfall 後只追加固定 system 規約，原生身分／工具／其他技能保持',async()=>{
 const f=helperFixture(),original=baseline(),fromNext=baseline();fromNext.sections.push({name:'later-native',text:'原生後續處理'});
 const actual=await f.run(original,{agent:f.agent},async()=>{assert.deepEqual(f.calls,[]);return fromNext;});
 assertAdded(actual,fromNext);assert.deepEqual(original.sections.map(x=>x.name),['native:identity','other-skill']);assert.deepEqual(f.calls,['authorized','provided']);
 assert.ok(actual.sections.at(-1).text.includes(attribution),'跨宿主作者規約必須到達真正回答前 system 接點，不能只存在未串入的 export 或晚到 open 契約');
 assert.ok(actual.sections.at(-1).text.includes(kindRules),'意圖／回報的通用區分須到達不需歷史閱讀的新計畫回合；不得依賴尚未呼叫的 open 契約');
 assert.ok(actual.sections.at(-1).text.includes(timeRules),'同一來源的角色與時間責任須實際到達回答前接點');
 assert.ok(readingContract.includes(timeRules),'正式閱讀與初始供給必須共用同一時間責任');
 observations.push({case:'assembly_append',policy:metadata,originalSectionsPreserved:true,toolsReferencePreserved:true});f.returned();assert.equal(f.handlers.size,0);
});
test('未接 Agent、同 ID 偽身分及取消回合不查授權、不注入',async()=>{
 const f=helperFixture(),original=baseline(),abort=new AbortController();abort.abort();
 for(const context of [{},{agent:{id:f.agent.id}},{agent:f.agent,signal:abort.signal}])assert.equal(await f.run(original,context),original);
 assert.deepEqual(f.calls,[]);
});
test('正式拒絕、撤權與 await 期間取消均不晚到；未知狀態不當作允許',async()=>{
 for(const mode of ['deny','throw','off-during-proof','off-during-note','abort-during-note','invalid-proof']){
  const controller=new AbortController();let f;
  f=helperFixture({authorize:async()=>{if(mode==='deny')return null;if(mode==='throw')throw Error('formal_authorization_denied');if(mode==='off-during-proof')f.state.enabled=false;return{valid:()=>mode!=='invalid-proof'};},provide:async()=>{if(mode==='off-during-note')f.state.enabled=false;if(mode==='abort-during-note')controller.abort();}});
  const original=baseline();assert.equal(await f.run(original,{agent:f.agent,signal:controller.signal}),original,mode);
 }
});
test('最後 proof.valid 等候期間撤權或取消，即使舊 proof 回傳 true 也不追加',async()=>{
 for(const mode of ['revoke','abort']){
  const controller=new AbortController();let f;
  f=helperFixture({authorize:async()=>({valid:async()=>{await Promise.resolve();if(mode==='revoke')f.state.enabled=false;else controller.abort();return true;}})});
  const original=baseline();assert.equal(await f.run(original,{agent:f.agent,signal:controller.signal}),original,mode);
 }
});
test('同名 section 不覆蓋；錯誤通知失敗也讓普通原生聊天繼續',async()=>{
 let observed;const f=helperFixture({error:async(_state,error)=>{observed=error.message;throw Error('synthetic_note_failure');}}),original=baseline();
 original.sections.push({name:CONTINUITY_SYSTEM_SECTION,text:'其他外掛既有內容'});
 assert.equal(await f.run(original),original);assert.equal(observed,'cmcp_system_policy_section_conflict');assert.equal(original.sections.at(-1).text,'其他外掛既有內容');
 assert.equal(f.calls.includes('provided'),false);
});
test('LLM 位置觀測只承認 system 規約，不把 User／工具資料升成權威或保留其正文',()=>{
 const user={role:'user',source:{kind:'cmcp-before-answer-policy'},content:[{type:'text',text:policy}]};
 assert.equal(observeContinuitySystemPolicy([user,{role:'tool',content:user.content}]).present,false);
 const result=observeContinuitySystemPolicy([user,{role:'system',content:[{type:'text',text:'原生前綴\n'+policy}]}]);
 assert.equal(result.present,true);assert.deepEqual(result.systemMessageIndexes,[1]);assert.equal(result.sha256,hash(policy));assert.ok(!JSON.stringify(result).includes(policy));
});
async function fileHashes(root){const rows={};async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const item=path.join(dir,entry.name);if(entry.isDirectory())await walk(item);else rows[path.relative(root,item).replaceAll('\\','/')]=hash(await fs.readFile(item));}}await walk(root);return rows;}
async function nativeFixture(label){
 const root=path.join(output,label),workspaceRoot=path.join(root,'workspace'),scopeId='synthetic-system-'+label;await fs.mkdir(workspaceRoot,{recursive:true});
 const runtimeConfig=path.join(root,'runtime.json'),skillPath=path.join(root,'SKILL.md');await fs.writeFile(skillPath,'---\nname: cmcp-continuity\ndescription: 合成一般技能\n---\n保留原角色與原時間。\n',{flag:'wx'});
 await fs.writeFile(runtimeConfig,JSON.stringify({kind:'cmcp_runtime_config',version:1,runtimeId:scopeId,providerMode:'host',input:{root:path.join(root,'state'),scopeId,events:[],timezone:'Asia/Taipei',limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(root,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}}),{flag:'wx'});
 const events=new Map(),tools=new Map([['native-filesystem',{name:'native-filesystem'}]]),agents=new Map();let command,provider;
 const ctx={agents:{get:id=>agents.get(id)},on(name,handler){events.set(name,[...(events.get(name)??[]),handler]);return()=>{};},effect(factory){return factory();},commands:{register(value){command=value;return()=>{};}},tools:{register(value){tools.set(value.name,value);return()=>{};},guard(){throw Error('不可改原生工具');}},skills:{registerProvider(create){provider=create({signal:new AbortController().signal,invalidate(){}});return()=>{};},async get(name,options){const item=(await provider.list(options)).find(x=>x.name===name);return item?provider.get(item,options):undefined;}}};
 const adapter=nativeApply(ctx,{deploymentRoot:root,runtimeConfig,traceRoot:path.join(root,'trace'),scopeId,workspaceRoot,skillPath,acceptanceSessionIds:[],areaInfo:{id:'synthetic-system',label:'合成 system 路由驗收',kind:'synthetic'}});
 const emit=async(name,...args)=>{for(const handler of events.get(name)??[])await handler(...args);await adapter.drain();};
 const actor=async(id,cwd=workspaceRoot)=>{const agent={id,session:{id,header:{cwd}},ctx:{effect:factory=>factory(),tools:{restrict(){throw Error('不可限制原生工具');}}}};agents.set(id,agent);await emit('agent/created',{agent});return agent;};
 const cmd=async(agent,input)=>{const response=await command.handler({agent,rawInput:' '+input,signal:new AbortController().signal});return{response,value:JSON.parse(response.text)};};
 const receive=async(agent,id,text)=>{const message={id,role:'user',source:{kind:'user'},content:[{type:'text',text}]},at=new Date(Date.now()-60000).toISOString();await emit('session/event',agent.session,{type:'agent/inbox/spliced',time:at,data:{inserted:[message]}});await emit('agent/inbox/inserted',{agent,message});await emit('agent/inbox/claimed',{agent,message,turn:1});return message;};
 const assembly=(agent,original=baseline(),before=async()=>{})=>events.get('system-prompt/assemble')[0](original,{agent,scope:agent,signal:new AbortController().signal},async()=>{await before();return original;});
 const control=async(agent,patch)=>{const snapshot=(await cmd(agent,'status')).value.snapshot;const changed=await cmd(agent,'controls '+JSON.stringify({scopeId,generation:snapshot.controlConfiguration.generation,patch}));assert.equal(changed.response.kind,'success');return changed;};
 return{root,adapter,events,tools,agents,actor,cmd,receive,assembly,control,emit};
}
test('Native 真 Bridge：逐 Session 明授權後才供 system 規約，不保存成 User 原文、不讀來源、不改時間或 Buffer',async()=>{
 const f=await nativeFixture('native-formal');try{
  const a=await f.actor('a'),b=await f.actor('b'),foreign=await f.actor('foreign',path.join(f.root,'elsewhere')),original=baseline();
  assert.equal(await f.assembly(a,original),original);assert.equal(await f.assembly(foreign,original),original);
  assert.equal((await f.cmd(a,'on')).response.kind,'success');const user=await f.receive(a,'only-user','合成普通聊天；沒有回查要求。');
  const before=await fileHashes(path.join(f.root,'state')),tools=[...f.tools.entries()];
  assertAdded(await f.assembly(a,original),original);assertAdded(await f.assembly(a,original),original);assert.equal(await f.assembly(b,original),original);
  const decision=await f.events.get('agent/pre-step')[0]({agent:a,signal:new AbortController().signal},async()=>({kind:'enter',messages:[user]}));
  assert.equal(decision.messages.some(m=>m.source?.kind==='cmcp-before-answer-policy'),false);assert.equal(decision.messages.some(m=>(m.content??[]).some(x=>x.text===policy)),false);
  assert.deepEqual(await fileHashes(path.join(f.root,'state')),before);assert.deepEqual([...f.tools.entries()],tools);
  const trace=(await fs.readFile(path.join(f.root,'trace/bridge-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(trace.filter(x=>x.kind==='user_capture').length,1);assert.equal(trace.filter(x=>x.kind==='formal_read').length,0);
  const status=(await f.cmd(a,'status')).value.snapshot;assert.equal(status.registration.registered,1);
  observations.push({case:'native_formal',sourceCount:status.registration.registered,formalReads:0,stableStateFiles:before,tools:[...f.tools.keys()]});
 }finally{await f.adapter.close();}
});
test('Native 真共用控制：Clean／共用 OFF 即時阻擋；Session OFF 不解除共用保護且重新加入不能復活舊 binding',async()=>{
 const f=await nativeFixture('native-controls');try{
  const a=await f.actor('a'),original=baseline();await f.cmd(a,'on');await f.receive(a,'control-user','合成待處理條件。');assertAdded(await f.assembly(a,original),original);
  await f.control(a,{clean:true});assert.equal(await f.assembly(a,original),original);await f.control(a,{clean:false});
  await f.control(a,{enabled:false});assert.equal(await f.assembly(a,original),original);await f.control(a,{enabled:true});
  await f.control(a,{clean:true});await f.cmd(a,'off');assert.equal(await f.assembly(a,original),original);await f.cmd(a,'on');
  assert.equal((await f.cmd(a,'status')).value.snapshot.controlConfiguration.effective.clean,true);assert.equal(await f.assembly(a,original),original);
 }finally{await f.adapter.close();}
});
test('Native 原生 next 等候時 OFF，system 規約不得晚到',async()=>{
 const f=await nativeFixture('native-late-off');try{const a=await f.actor('a');await f.cmd(a,'on');await f.receive(a,'late-user','合成取消。');const original=baseline();assert.equal(await f.assembly(a,original,()=>f.cmd(a,'off')),original);}finally{await f.adapter.close();}
});
test('Native 官方 registry 已移除或替換 Agent 時，舊 instance 不能沿用 system 規約授權',async()=>{
 const f=await nativeFixture('native-agent-ownership');try{
  const a=await f.actor('a');await f.cmd(a,'on');await f.receive(a,'owner-user','合成所有權。');const original=baseline();
  f.agents.delete(a.id);assert.equal(await f.assembly(a,original),original,'registry 已移除的舊 instance 不得追加');
  f.agents.set(a.id,{...a});assert.equal(await f.assembly(a,original),original,'相同 ID 的新 instance 不能使舊 instance 恢復授權');
 }finally{await f.adapter.close();}
});
async function sharedFixture(label){
 const root=path.join(output,label);await fs.mkdir(root,{recursive:true});const handlers=new Map(),tools=new Map([['native-filesystem',{name:'native-filesystem'}]]),agents=new Map(),calls=[];let provider;
 const state={controls:{enabled:true,clean:false},epoch:'broker:2',fail:false};
 const config={kind:'cmcp_shared_harness_config',version:1,projectId:'synthetic-project',hostId:'harness',agentId:'official-harness',profileName:'synthetic-sdk',workspaceRoot:root,artifactRoot:path.join(root,'evidence'),skillPath:path.join(productRoot,'adapters/deepseek-harness/shared-project/SKILL.md'),sessionIds:['a'],route:{provider:'synthetic',model:'synthetic'},connection:{pipe:'synthetic-not-started',controlAuthFile:path.join(root,'control-reference.json'),readAuthFile:path.join(root,'read-reference.json')}};
 const ctx={profileContext:{name:config.profileName},get(name){return this[name];},provide(name,value){this[name]=value;},agents:{get:id=>agents.get(id)},on(name,fn){handlers.set(name,fn);return()=>{};},effect:factory=>factory(),tools:{register(value){tools.set(value.name,value);return()=>{};}},skills:{registerProvider(create){provider=create({invalidate(){}});},get:(name,options)=>provider.get({name},options)}};
 const call=async input=>{calls.push(input);const{operation,args}=input.request;
  if(operation==='join')return{joined:true,epoch:'broker:1'};if(operation==='claim')return{epoch:'broker:2',owner:{hostId:'harness'}};
  if(operation==='reader-status'){if(state.fail)throw Error('shared_project_epoch_stale');return{epoch:state.epoch,controls:{...state.controls}};}
  if(['receive','claim-turn'].includes(operation))return{capture:{status:'saved',sourcePointer:{itemId:args.messageId}},context:{kind:'cmcp_host_time_context'}};
  if(operation==='request-context')return{kind:'cmcp_host_time_context',contextId:'context',timeCard:{current:{now:new Date().toISOString()}},userMessageRecordedAt:new Date().toISOString()};
  if(operation==='revoke')return{epoch:'broker:3',revoked:true};return{status:'saved'};};
 const host=createSharedHarnessHost(ctx,config,{call}),agent={id:'a',session:{id:'a',header:{cwd:root}},ctx:{effect:factory=>factory()}};agents.set(agent.id,agent);
 const start=async()=>{await handlers.get('agent/created')({agent});const user={id:'u1',role:'user',source:{kind:'user'},content:[{type:'text',text:'合成正常輸入'}]};handlers.get('session/event')(agent.session,{type:'agent/inbox/spliced',time:new Date().toISOString(),data:{inserted:[user]}});handlers.get('agent/inbox/inserted')({agent,message:user});handlers.get('agent/inbox/claimed')({agent,message:user,turn:1});await host.drain();};
 const assembly=(target=agent,original=baseline(),before=async()=>{})=>handlers.get('system-prompt/assemble')(original,{agent:target,scope:target,signal:new AbortController().signal},async()=>{await before();return original;});
 return{root,config,host,handlers,tools,calls,state,agent,agents,start,assembly};
}
test('Shared 正式 host 接點：assembly 只用 reader-status 與讀取 credential，不查原文、不授權、不改原生工具',async()=>{
 const f=await sharedFixture('shared-read-only');try{await f.start();const start=f.calls.length,original=baseline(),tools=[...f.tools.entries()];assertAdded(await f.assembly(f.agent,original),original);
  const calls=f.calls.slice(start);assert.equal(calls.length,2);assert.ok(calls.every(x=>x.request.operation==='reader-status'&&x.role==='model_read'&&x.connection.authFile===f.config.connection.readAuthFile));
  const decision=await f.handlers.get('agent/pre-step')({agent:f.agent},async()=>({kind:'enter',messages:[]}));assert.equal(decision.messages.some(m=>m.source?.kind==='cmcp-before-answer-policy'),false);
  assert.equal(f.calls.filter(x=>x.request.operation==='receive').length,1);assert.equal(f.calls.some(x=>['find','open','read','continuity','control'].includes(x.request.operation)),false);assert.deepEqual([...f.tools.entries()],tools);
  observations.push({case:'shared_read_only',assemblyOperations:calls.map(x=>({operation:x.request.operation,role:x.role})),nativeToolsPreserved:true});
 }finally{await f.host.close();}
});
test('Shared Clean／OFF、舊 epoch、撤權及同 ID Agent 替換都不追加 system 規約',async()=>{
 const f=await sharedFixture('shared-guards');try{await f.start();const original=baseline();
  for(const controls of [{enabled:false,clean:false},{enabled:true,clean:true},{}]){f.state.controls=controls;assert.equal(await f.assembly(f.agent,original),original);}
  f.state.controls={enabled:true,clean:false};f.state.epoch='broker:99';assert.equal(await f.assembly(f.agent,original),original);f.state.fail=true;assert.equal(await f.assembly(f.agent,original),original);f.state.fail=false;
  f.agents.set(f.agent.id,{...f.agent});assert.equal(await f.assembly(f.agent,original),original);f.agents.set(f.agent.id,f.agent);
  f.host.states.get(f.agent.id).revoked=true;assert.equal(await f.assembly(f.agent,original),original);
 }finally{await f.host.close();}
});
test('Shared 已關閉 host 與未明列 Session 維持原 assembly，沒有新增授權或回查',async()=>{
 const f=await sharedFixture('shared-closed');try{const original=baseline(),other={...f.agent,id:'other',session:{id:'other',header:f.agent.session.header}};await f.handlers.get('agent/created')({agent:other});assert.equal(await f.assembly(other,original),original);assert.equal(f.calls.length,0);await f.start();await f.host.close();const count=f.calls.length;assert.equal(await f.assembly(f.agent,original),original);assert.equal(f.calls.length,count);}finally{await f.host.close();}
});
