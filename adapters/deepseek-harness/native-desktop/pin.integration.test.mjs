// 真 Bridge／Core 與原生外掛接線；官方 Ctx／AgentLoop／串流的明示離線替身。
// 合成內容、短真時鐘；不讀官方設定或憑證，不啟動 Desktop，不呼叫網路。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {apply} from './host.mjs';
import {createCmcpRuntimeDispatch} from '../../../src/cmcp-guard/cmcp-runtime-dispatch.js';
import {createCmcpReactivationStores,createCmcpTemporalSourceCatalog} from '../../../src/cmcp-guard/cmcp-history-reactivation.js';
import {createCmcpFeatureControls} from '../../../src/cmcp-guard/cmcp-feature-controls.js';
import {createLocalLoopJournal} from '../../../src/cmcp-guard/cmcp-local-loop-journal.js';
import {createCmcpSourceEvidence} from '../../../src/cmcp-guard/cmcp-source-evidence.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const base=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(repo,'logs/tests/native-pin'));
await fs.mkdir(base,{recursive:true});
const runRoot=await fs.mkdtemp(path.join(base,'native-pin-integration-'));
const fixtures=[],hash=body=>createHash('sha256').update(body).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,limit=6000){const end=Date.now()+limit;while(!await check()){
  if(Date.now()>end)throw Error('離線有界等待逾時：'+label);await sleep(15);}}
const networkFetch=globalThis.fetch;let networkCalls=0;
globalThis.fetch=async()=>{networkCalls++;throw Error('離線 Pin 整合測試禁止網路');};
const textOf=message=>(message.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('');
async function hashes(root){const output={};async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);if(entry.isDirectory())await walk(full);else output[path.relative(root,full).replaceAll('\\','/')]=hash(await fs.readFile(full));}}
  await walk(root);return output;}

async function fixture(label){
  const root=path.join(runRoot,label),workspaceRoot=path.join(root,'workspace'),scopeId='synthetic-native-pin-'+label;
  await fs.mkdir(workspaceRoot,{recursive:true});
  const runtimeConfig=path.join(root,'runtime.json'),skillPath=path.join(root,'SKILL.md'),llmModulePath=path.join(root,'fake-llm-assembler.mjs');
  const runtime={kind:'cmcp_runtime_config',version:1,runtimeId:scopeId,providerMode:'host',
    input:{root:path.join(root,'state'),scopeId,events:[],timezone:'Asia/Taipei',
      limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},
      storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
    receiptRoot:path.join(root,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},
    controls:{enabled:true,clean:false,proactive:false,pins:true},answerHistory:{enabled:true}};
  await fs.writeFile(runtimeConfig,JSON.stringify(runtime),{flag:'wx'});
  await fs.writeFile(skillPath,'---\nname: cmcp-continuity\ndescription: 離線合成 Skill\n---\n原角色與時間不得改寫。\n',{flag:'wx'});
  await fs.writeFile(llmModulePath,`// 僅測試用的文字串流組裝器，不是官方 LLM 實作或模型。\nexport class BlockAssembler { constructor(){this.text='';this.finish={kind:'unknown'};this.usage=null;} push(chunk){if(chunk.type==='text-delta')this.text+=chunk.text;if(chunk.type==='finish')this.finish=chunk.reason;if(chunk.type==='usage')this.usage=chunk.usage;} blocks(){return [{type:'text',text:this.text}];} }\n`,{flag:'wx'});
  const handlers=new Map(),agents=new Map(),tools=new Map([['native-filesystem',{}]]),events=[],requests=[],frames=[],errors=[],operations=[],tasks=[];
  const controls={hold:false,release:null},observed={flushes:0,nativeCancels:0,guardCalls:0,restrictCalls:0};
  let command,provider,adapter,seq=0;
  const emit=async(name,...args)=>{if(name==='session/event')events.push({sessionId:args[0].id,event:structuredClone(args[1])});
    for(const handler of [...(handlers.get(name)??[])])await handler(...args);};
  const ctx={on(name,handler){handlers.set(name,[...(handlers.get(name)??[]),handler]);return ()=>handlers.set(name,(handlers.get(name)??[]).filter(item=>item!==handler));},
    effect(factory){return factory();},commands:{register(value){command=value;return ()=>{};}},
    agents:{get(id){return agents.get(id);}},sessions:{async flush(session){await emit('session/flush',session);observed.flushes++;return {flushed:true};}},
    tools:{register(value){tools.set(value.name,value);return ()=>tools.delete(value.name);},guard(){observed.guardCalls++;throw Error('不能限制原生工具');}},
    skills:{registerProvider(create){provider=create({invalidate(){}});return ()=>{};},async get(name,options){const item=(await provider.list(options)).find(value=>value.name===name);return item?provider.get(item,options):undefined;}}};
  adapter=apply(ctx,{deploymentRoot:root,runtimeConfig,traceRoot:path.join(root,'trace'),workspaceRoot,scopeId,skillPath,llmModulePath,
    areaInfo:{id:label,label:'離線合成 Pin 驗證',kind:'synthetic'}});
  await adapter.pinInitialization;
  const nativeEvent=async(agent,type,data)=>emit('session/event',agent.session,{type,data,time:new Date().toISOString(),seq:++seq});
  const actor=async id=>{
    const agent={id,status:'idle',session:{id,header:{cwd:workspaceRoot}},turn:0,queue:[],controller:null,
      ctx:{effect(factory){return factory();},tools:{restrict(){observed.restrictCalls++;throw Error('不能限制原生工具');}}},
      inbox:{get hasPending(){return agent.queue.length>0;},remove(messageId){agent.queue=agent.queue.filter(message=>message.id!==messageId);}},
      cancel(){observed.nativeCancels++;agent.controller?.abort(Error('offline_agent_cancel'));},
      followup(message){return this.send(message);},send(message){this.queue.push(message);const task=(this.flight??Promise.resolve()).then(()=>run(agent));
        this.flight=task.catch(error=>errors.push({sessionId:id,error:error.message}));tasks.push(this.flight);return message.id;},
      whenIdle(){return this.flight??Promise.resolve();}};
    agents.set(id,agent);await emit('agent/created',{agent});return agent;
  };
  async function run(agent){
    const message=agent.queue.shift();if(!message)return;agent.status='running';agent.controller=new AbortController();const turn=++agent.turn;
    try{
      await nativeEvent(agent,'agent/inbox/spliced',{inserted:[message]});await emit('agent/inbox/inserted',{agent,message});
      await emit('agent/inbox/claimed',{agent,message,turn});await adapter.drain();
      await nativeEvent(agent,'user/message',message);
      let decision={kind:'enter',messages:[message]};for(const hook of handlers.get('agent/pre-step')??[]){const previous=decision;decision=await hook({agent,signal:agent.controller.signal},async()=>previous);}
      const request={sessionId:agent.id,provider:'offline_native_fixture',model:'deterministic_fixture',messages:decision.messages,signal:agent.controller.signal};
      const nativeStream=async function*(){requests.push(structuredClone({...request,signal:undefined}));
        yield {type:'text-delta',index:0,text:'合成原生回覆：'};
        if(controls.hold)await new Promise(resolve=>{controls.release=resolve;});
        yield {type:'text-delta',index:0,text:'請核對原始草稿，尚待書面批准。'};
        yield {type:'finish',reason:{kind:'stop'}};};
      const streams=handlers.get('llm/stream')??[];
      const next=index=>index===streams.length?nativeStream():streams[index](request,()=>next(index+1));
      let body='';for await(const chunk of next(0)){frames.push({sessionId:agent.id,turn,chunk});if(chunk.type==='text-delta')body+=chunk.text;}
      const answer={id:'answer-'+randomUUID(),role:'assistant',content:[{type:'text',text:body}]};
      await nativeEvent(agent,'assistant/message',{turn,message:answer,interrupted:false});
      await nativeEvent(agent,'turn/end',{turn,reason:{kind:'completed'}});await adapter.drain();
    }finally{agent.status='idle';}
  }
  const runCommand=async(agent,operation,payload)=>{
    const input=operation+(payload?' '+JSON.stringify(payload):''),response=await command.handler({agent,rawInput:input,signal:new AbortController().signal});
    const value=JSON.parse(response.text);operations.push({at:new Date().toISOString(),sessionId:agent.id,input,response,value});return {response,value};};
  const success=async(agent,operation,payload)=>{const result=await runCommand(agent,operation,payload);assert.equal(result.response.kind,'success',JSON.stringify(result.value));return result.value;};
  const status=agent=>success(agent,'status');
  const shared=async(agent,patch)=>{const before=await status(agent);return success(agent,'controls',{scopeId,generation:before.snapshot.controlConfiguration.generation,patch});};
  const pin=async(agent,target,sourceIds,dueAt=null)=>{const before=await status(agent);await success(agent,'pin-create',{scopeId,generation:before.snapshot.controlConfiguration.generation,sessionId:target.id,sourceIds,dueAt});
    return (await adapter.bridge.status()).pins.pins.at(-1);};
  const change=async(agent,current,action,dueAt)=>{const before=await status(agent);await success(agent,'pin-change',{scopeId,generation:before.snapshot.controlConfiguration.generation,pinId:current.pinId,expectedRevision:current.revision,change:action,...(dueAt!==undefined?{dueAt}:{})});
    return (await adapter.bridge.status()).pins.pins.find(item=>item.pinId===current.pinId);};
  const seed=async(agent,text='合成原文：草案仍待書面批准。')=>{
    await success(agent,'on');const message={id:'user-'+randomUUID(),role:'user',source:{kind:'user'},content:[{type:'text',text}]};
    agent.followup(message);await agent.whenIdle();assert.equal(errors.length,0,JSON.stringify(errors));
    const full=await adapter.bridge.status();return full.registration.sources.find(item=>item.pointer.itemId==='harness-user-'+message.id);};
  async function close(){controls.hold=false;controls.release?.();await adapter.close();await Promise.all(tasks);
    await fs.writeFile(path.join(root,'evidence.json'),JSON.stringify({label,scopeId,operations,events,requests,frames,errors,observed,
      networkCalls,desktopStarted:false,officialAgentLoop:false,clock:'短真時鐘；來源與回覆均為離線合成資料'},null,2),{flag:'wx'});}
  fixtures.push({label,root,scopeId});
  return {root,scopeId,adapter,actor,runCommand,success,status,shared,pin,change,seed,controls,events,requests,frames,errors,observed,tools,close};
}

test('正常命令建立無時間 Pin、改期、取消及完成；過時 revision 不修改來源',async()=>{
  const f=await fixture('commands');try{
    const a=await f.actor('a'),source=await f.seed(a),before=await f.adapter.bridge.status();
    const pin=await f.pin(a,a,[source.id],null);assert.equal(pin.dueAt,null);assert.equal(pin.status,'active');
    const unscheduled=await f.adapter.bridge.status();assert.equal(unscheduled.controlConfiguration.effective.proactive,false);
    assert.deepEqual(unscheduled.registration,before.registration);
    const {evaluatedAt:beforeEvaluation,...beforeBuffer}=before.buffer,{evaluatedAt:afterEvaluation,...afterBuffer}=unscheduled.buffer;
    assert.deepEqual(afterBuffer,beforeBuffer,'正式來源時間、TTL、內容與generation不變；唯讀評估時間可隨時鐘推進');
    assert.ok(Date.parse(afterEvaluation)>=Date.parse(beforeEvaluation));
    const revised=await f.change(a,pin,'schedule',new Date(Date.now()+60000).toISOString());assert.equal(revised.revision,pin.revision+1);
    const stale=await f.runCommand(a,'pin-change',{scopeId:f.scopeId,generation:unscheduled.controlConfiguration.generation,pinId:pin.pinId,expectedRevision:pin.revision,change:'cancel'});
    assert.equal(stale.response.kind,'error');
    const cancelled=await f.change(a,revised,'cancel');assert.equal(cancelled.status,'cancelled');
    const second=await f.pin(a,a,[source.id],null),completed=await f.change(a,second,'complete');assert.equal(completed.status,'completed');
    assert.equal(f.requests.length,1,'只有正常合成對話，不存在提醒模型回合');assert.ok(f.tools.has('native-filesystem'));
    assert.equal(f.observed.guardCalls,0);assert.equal(f.observed.restrictCalls,0);
  }finally{await f.close();}
});

test('到期使用原生非人類回合；原文、最後User時間不刷新，交付不冒稱已讀或完成',async()=>{
  const f=await fixture('delivery');try{
    const a=await f.actor('a'),source=await f.seed(a),before=await f.adapter.bridge.status();
    const pin=await f.pin(a,a,[source.id],new Date(Date.now()+250).toISOString());
    await f.shared(a,{proactive:true});
    await until(async()=>(await f.adapter.bridge.status()).proactive.liveDispatch?.lastResult?.status==='handed_to_host','正式交付');
    await a.whenIdle();const after=await f.adapter.bridge.status(),result=after.proactive.liveDispatch.lastResult;
    assert.equal(f.requests.length,2);assert.equal(f.requests[1].messages.some(item=>item.source?.kind==='cmcp-pin-dispatch'),true);
    assert.equal(f.requests[1].messages.some(item=>item.source?.kind==='cmcp-source-status'),false,'Pin 自有材料不能誤當成缺少新的 User 輸入');
    assert.ok(f.requests[1].messages.some(item=>textOf(item).includes('合成原文：草案仍待書面批准。')),'正式原文進入合成原生模型輸入');
    assert.equal(f.events.filter(row=>row.event.type==='user/message'&&row.event.data.source?.kind==='user').length,1);
    const preserved=after.registration.sources.find(item=>item.id===source.id);assert.deepEqual(preserved,source);
    const dispatchAnswer=after.registration.sources.find(item=>item.pointer.itemId.startsWith('dispatch-'));
    assert.ok(dispatchAnswer);assert.equal(dispatchAnswer.sourceAuthorRole,'assistant');assert.equal(dispatchAnswer.pointer.sessionId,a.id);
    assert.equal(after.pins.pins.find(item=>item.pinId===pin.pinId).status,'active');
    const historyBefore=before.registration.sources.filter(item=>item.sourceAuthorRole==='user');
    assert.deepEqual(after.registration.sources.filter(item=>item.sourceAuthorRole==='user'),historyBefore);
    assert.equal(after.timeCard.previousUser.recordedAt,before.timeCard.previousUser.recordedAt);
    const trace=(await fs.readFile(path.join(f.root,'trace/bridge-events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    const committed=trace.findLast(item=>item.kind==='pin_host_receipt');
    assert.equal(committed.receipt.hostReceipt.stage,'host_committed');assert.equal(committed.receipt.presentation,'not_observed');
    assert.equal(committed.receipt.userRead,'not_observed');assert.notEqual(result.receipt?.userRead,'read');
    await f.adapter.bridge.current.runtime.refreshDispatch();await sleep(70);assert.equal(f.requests.length,2);
    const stateBefore=await hashes(path.join(f.root,'state'));await f.status(a);await f.status(a);
    await f.success(a,'original',{pointer:source.pointer,evidenceHash:source.evidenceHash,start:0,end:source.location.end,maxBytes:8192});
    assert.deepEqual(await hashes(path.join(f.root,'state')),stateBefore,'檢視與原文讀取不活化或寫入');
    await f.change(a,after.pins.pins.find(item=>item.pinId===pin.pinId),'complete');await f.shared(a,{proactive:false});
  }finally{await f.close();}
});

test('A OFF 不改共用控制、不取消B的獨立Pin；已停用目標不派送',async()=>{
  const f=await fixture('session-isolation');try{
    const a=await f.actor('a'),b=await f.actor('b'),sourceA=await f.seed(a),sourceB=await f.seed(b,'合成原文：另一份草稿待確認。');
    const pinA=await f.pin(a,a,[sourceA.id],new Date(Date.now()+250).toISOString());
    const pinB=await f.pin(b,b,[sourceB.id],new Date(Date.now()+250).toISOString());
    const before=await f.adapter.bridge.status();await f.success(a,'off');const afterOff=await f.adapter.bridge.status();
    assert.deepEqual(afterOff.controlConfiguration,before.controlConfiguration);
    assert.equal(afterOff.pins.pins.find(item=>item.pinId===pinB.pinId).status,'active');
    await f.shared(b,{proactive:true});
    await until(()=>f.requests.some(request=>request.sessionId===b.id&&request.messages.some(message=>message.source?.kind==='cmcp-pin-dispatch')),'B 的合法目標');
    await until(async()=>!(await f.adapter.bridge.current.runtime.dispatchStatus()).generating,'B 交付收束');
    assert.equal(f.requests.some(request=>request.sessionId===a.id&&request.messages.some(message=>message.source?.kind==='cmcp-pin-dispatch')),false);
    const final=await f.adapter.bridge.status();assert.equal(final.pins.pins.find(item=>item.pinId===pinA.pinId).status,'active','對話OFF不刪獨立Pin');
    assert.equal(final.registration.sources.filter(row=>row.sourceAuthorRole==='user').length,2);
    await f.shared(b,{proactive:false});
  }finally{await f.close();}
});

test('共用OFF、Clean及DND於到期前阻擋；B加入不解除保護',async()=>{
  for(const kind of ['enabled','clean','dnd']){
    const f=await fixture('blocked-'+kind);try{
      const a=await f.actor('a'),b=await f.actor('b'),source=await f.seed(a);
      const pin=await f.pin(a,a,[source.id],new Date(Date.now()+180).toISOString());
      const hhmm=value=>new Date(value).toISOString().slice(11,16);
      const patch=kind==='enabled'?{enabled:false,proactive:true}:kind==='clean'?{clean:true,proactive:true}:
        {proactive:true,doNotDisturb:{enabled:true,timezone:'UTC',windows:[{start:hhmm(Date.now()-3600000),end:hhmm(Date.now()+3600000)}]}};
      await f.shared(a,patch);const controls=(await f.adapter.bridge.status()).controlConfiguration;
      await f.success(b,'on');assert.deepEqual((await f.adapter.bridge.status()).controlConfiguration,controls);
      await sleep(Math.max(10,Date.parse(pin.dueAt)-Date.now()+100));
      assert.equal(f.requests.length,1);const current=await f.adapter.bridge.current.runtime.dispatchStatus();
      assert.equal(current.arbitration.records.filter(row=>row.kind==='dispatch_reserved').length,0);
      assert.equal(kind==='dnd'?current.lastResult?.reason:current.reason,kind==='dnd'?'do_not_disturb':'disabled');
    }finally{await f.close();}
  }
});

test('生成中取消Pin，晚到串流不呈現、不保存；原生普通聊天仍可繼續',async()=>{
  const f=await fixture('cancel-late');try{
    const a=await f.actor('a'),source=await f.seed(a),pin=await f.pin(a,a,[source.id],new Date(Date.now()+200).toISOString());
    f.controls.hold=true;await f.shared(a,{proactive:true});await until(()=>f.requests.length===2&&f.controls.release,'合成生成暫停點');
    const initialFrames=f.frames.length,initialSources=(await f.adapter.bridge.status()).registration.registered;
    const cancelled=await f.change(a,pin,'cancel');assert.equal(cancelled.status,'cancelled');
    f.controls.hold=false;f.controls.release();await a.whenIdle();
    await until(async()=>!(await f.adapter.bridge.current.runtime.dispatchStatus()).generating,'取消工作退出');
    assert.equal(f.frames.length,initialFrames);assert.equal((await f.adapter.bridge.status()).registration.registered,initialSources);
    f.errors.splice(0);await f.seed(a,'取消提醒後的普通合成對話。');assert.equal(f.requests.length,3);
    assert.equal(f.requests[2].messages[0].source.kind,'user');assert.equal(f.tools.has('native-filesystem'),true);
    await f.shared(a,{proactive:false});
  }finally{await f.close();}
});

test('Core補充：生成後來源回傳changed，保存與交付皆拒絕且原件保留',async()=>{
  const root=path.join(runRoot,'source-revision-guard'),scopeId='synthetic-source-revision',timezone='UTC';
  const journal=createLocalLoopJournal({root:path.join(root,'input-journal'),name:'cmcp-common-input-v1'});
  await journal.append('binding',{version:1,scopeId,fixture:true});
  const stores=createCmcpReactivationStores({root,scopeId}),catalog=createCmcpTemporalSourceCatalog({stores,maxEntries:16});
  const source=createCmcpSourceEvidence({pointer:{version:1,providerNamespace:'cmcp-local-console-v1',scopeId,sessionId:'source-session',itemId:'source',revisionId:'r1'},
    sourceKind:'message',sourceAuthorRole:'user',messageRecordedAt:new Date().toISOString(),eventOccurredAt:null,
    content:{kind:'source_excerpt',body:'合成原始版本：這份草稿尚未批准。'},metadata:{availability:'partial'}});
  await stores.history.writeEvidence(source);const entry=(await catalog.registerSource({pointer:source.pointer})).entry;
  const manager=createCmcpFeatureControls({root,scopeId,defaults:{proactive:true,pins:true}}),counts={generated:0,saved:0,presented:0};
  const core={sessionId:'source-guard',stores,history:stores.history,catalog,status:async()=>({events:[]}),bufferList:async()=>({generation:0,items:[],retained:[]}),
    ingest:async()=>{counts.saved++;throw Error('來源已失效，不應保存');}};
  const mutation={kind:'synthetic_formal_history_resolution',injectedAt:null,requestedRevisionId:'r1',currentRevisionId:'r2'};
  const dispatch=createCmcpRuntimeDispatch({root,scopeId,timezone,events:[],core,controlManager:manager,dispatchReady:async()=>true,
    runWork:async run=>run(),adapter:{request:async(_purpose,_input,options)=>{await options.canAttempt();counts.generated++;
      const original=core.history.resolve.bind(core.history);mutation.injectedAt=new Date().toISOString();
      core.history={...core.history,resolve:async pointer=>pointer.itemId===source.pointer.itemId?{status:'changed',pointer,
        requestedRevisionId:pointer.revisionId,currentRevisionId:'r2'}:original(pointer)};
      return {value:{text:'合成晚到回覆，來源已異動，不得派送。'}};}},
    delivery:{present:async()=>{counts.presented++;throw Error('來源已失效，不應交付');}}});
  try{
    await dispatch.pinCreate({updateId:'create',pinId:'changed-pin',sourceIds:[entry.id],dueAt:new Date(Date.now()+120).toISOString(),
      userAction:{kind:'callable_authorization',authorized:true,scopeId}});
    await until(async()=>(await dispatch.status()).lastResult?.code==='dispatch_source_unavailable','來源版動守護');
    assert.deepEqual(counts,{generated:1,saved:0,presented:0});assert.equal((await stores.history.resolve(source.pointer)).evidence.content.body,source.content.body);
    await fs.writeFile(path.join(root,'source-change-result.json'),JSON.stringify({counts,mutation,state:await dispatch.status(),source,
      limitation:'僅正式Core的來源changed回傳注入；沒有變更原件，不冒稱Desktop來源已被修改。'},null,2),{flag:'wx'});
    fixtures.push({label:'source-revision-guard',root,scopeId});
  }finally{await dispatch.close();}
});

test.after(async()=>{globalThis.fetch=networkFetch;assert.equal(networkCalls,0);
  await fs.writeFile(path.join(runRoot,'fixture-index.json'),JSON.stringify({fixtures,networkCalls,paidModels:0,desktopStarted:false,
    clock:'短真時鐘到期；訊息與生成回覆皆合成',boundary:'真 Bridge/Core，官方宿主介面與LLM組裝器為明示離線替身；不能代替Desktop畫面、真模型或已讀驗收。'},null,2),{flag:'wx'});
  console.log(JSON.stringify({runRoot,networkCalls,paidModels:0,desktopStarted:false}));});
