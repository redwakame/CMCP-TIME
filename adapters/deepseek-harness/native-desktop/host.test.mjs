// 真實 Bridge／Core、官方介面的離線替身；不啟動 Desktop，不讀憑證或呼叫模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {apply,projectModelInputMetadata} from './host.mjs';
import {CONTINUITY_BEFORE_ANSWER_POLICY,CONTINUITY_POLICY_METADATA,CONTINUITY_READING_CONTRACT,CONTINUITY_READING_CONTRACT_METADATA,CONTINUITY_KIND_RULES,CONTINUITY_PLAN_GRANULARITY_RULES,CONTINUITY_PLAN_ROLE_RULES,CONTINUITY_REASON_BINDING_RULES,CONTINUITY_PLAN_V3_RULES,CONTINUITY_SOURCE_BOUND_ANSWER_RULES,CONTINUITY_ATTRIBUTION_RULES,CONTINUITY_PLAN_SCOPE_REVIEW_RULES,CONTINUITY_EXPLICIT_REASON_SCOPE_RULES,CONTINUITY_TICKET_SCOPE_RULES} from '../../continuity-policy.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const base=process.env.CMCP_TEST_OUTPUT_ROOT?path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT):path.join(repo,'logs/tests/native-host');
await fs.mkdir(base,{recursive:true});
const testRoot=await fs.mkdtemp(path.join(base,'native-host-tests-'));
const fixtures=[];
let networkCalls=0;
const nativeFetch=globalThis.fetch;
globalThis.fetch=async()=>{networkCalls++;throw Error('離線測試禁止網路與模型呼叫');};
const hash=value=>createHash('sha256').update(value).digest('hex');
const nativeMessage=(id,text)=>({id,role:'user',source:{kind:'user'},content:[{type:'text',text}]});
// 合成訊息時間相對本次測試建立；不把舊固定日期跨過正式十二小時期限後仍當成活躍來源。
const now=new Date().toISOString(),userAt=new Date(Date.parse(now)-60000).toISOString();
async function hashes(root){const rows={};
  async function walk(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);if(entry.isDirectory())await walk(file);else rows[path.relative(root,file)]=hash(await fs.readFile(file));
  }}await walk(root);return rows;
}
async function fixture(label,{acceptance=[],forwardConfig=false,initialControls={}}={}){
  const root=path.join(testRoot,label),workspaceRoot=path.join(root,'workspace'),scopeId='synthetic-native-'+label;
  await fs.mkdir(workspaceRoot,{recursive:true});
  const runtimeConfig=path.join(root,'runtime.json'),skillPath=path.join(root,'SKILL.md');
  await fs.writeFile(skillPath,'---\nname: cmcp-continuity\ndescription: 合成離線技能\n---\n保留原角色、原時間、條件與否定。\n',{flag:'wx'});
  const runtime={kind:'cmcp_runtime_config',version:1,runtimeId:scopeId,providerMode:'host',
    input:{root:path.join(root,'state'),scopeId,events:[],timezone:'Asia/Taipei',
      limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},
      storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
    receiptRoot:path.join(root,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},
    controls:{enabled:true,clean:false,proactive:false,pins:false,...initialControls},answerHistory:{enabled:true}};
  await fs.writeFile(runtimeConfig,JSON.stringify(runtime),{flag:'wx'});
  const events=new Map(),tools=new Map([['native-filesystem',{name:'native-filesystem'}]]),effects=[],agents=new Map();
  const observed={nativeCancels:0,guardCalls:0,restrictCalls:0,skillGets:0,skillInvalidations:0,streamCalls:0};
  let skillProvider,command;
  const ctx={
    agents:{get:id=>agents.get(id)},
    on(event,handler){events.set(event,[...(events.get(event)??[]),handler]);return ()=>{};},
    effect(factory){const dispose=factory();if(typeof dispose==='function')effects.push(dispose);return dispose;},
    commands:{register(definition){command=definition;return ()=>{};}},
    tools:{register(definition){tools.set(definition.name,definition);return ()=>tools.delete(definition.name);},
      guard(){observed.guardCalls++;throw Error('不得改動普通 native 工具');}},
    skills:{registerProvider(create){skillProvider=create({signal:new AbortController().signal,invalidate(){observed.skillInvalidations++;}});return ()=>{};},
      async get(name,options){observed.skillGets++;if(ctx.missingSkill)return undefined;
        const offered=(await skillProvider.list(options)).find(item=>item.name===name);return offered?skillProvider.get(offered,options):undefined;}}
  };
  const adapter=apply(ctx,{deploymentRoot:root,runtimeConfig,traceRoot:path.join(root,'trace'),scopeId,
    workspaceRoot:forwardConfig?workspaceRoot.replaceAll('\\','/'):workspaceRoot,skillPath,acceptanceSessionIds:acceptance,
    areaInfo:{id:'synthetic-native',label:'離線原生接點驗收',kind:'synthetic'}});
  const emit=async(event,...args)=>{for(const handler of events.get(event)??[])await handler(...args);await adapter.drain();};
  const actor=async(id,cwd=workspaceRoot)=>{const agent={id,session:{id,header:{cwd}},
    cancel(){observed.nativeCancels++;throw Error('不得取消普通 native 回合');},ctx:{
      tools:{restrict(){observed.restrictCalls++;throw Error('不得限制普通 native 工具');}},
      effect(factory){const dispose=factory();if(typeof dispose==='function')effects.push(dispose);return dispose;}}};
    agents.set(id,agent);await emit('agent/created',{agent});return agent;};
  const runCommand=async(agent,input,signal=new AbortController().signal)=>{
    const response=await command.handler({agent,rawInput:' '+input,signal});return {response,value:JSON.parse(response.text)};};
  const receive=async(agent,id,text,turn,{insert=true}={})=>{const message=nativeMessage(id,text);
    await emit('session/event',agent.session,{type:'agent/inbox/spliced',time:userAt,data:{inserted:[message]}});
    if(insert)await emit('agent/inbox/inserted',{agent,message});await emit('agent/inbox/claimed',{agent,message,turn});return message;};
  const step=async(agent,messages=[],beforeEnter)=>{let nextCalls=0;
    const decision=await events.get('agent/pre-step')[0]({agent,messages,signal:new AbortController().signal},async()=>{nextCalls++;await beforeEnter?.();return {kind:'enter',messages};});
    assert.equal(nextCalls,1);return decision;};
  const assemble=async agent=>{const original={sections:[{name:'native',text:'原生宿主'}],tools:[{name:'native-filesystem'}],contexts:[],variables:{}};
    const value=await events.get('system-prompt/assemble')[0](original,{agent},async()=>original);
    assert.equal(value.tools,original.tools);assert.equal(value.sections[0],original.sections[0]);return value;};
  const finish=async(agent,turn,text,assistantId='assistant-'+turn)=>{
    await emit('session/event',agent.session,{type:'assistant/message',time:now,data:{turn,message:{id:assistantId,role:'assistant',content:[{type:'text',text}]},interrupted:false}});
    await emit('session/event',agent.session,{type:'turn/end',time:now,data:{turn,reason:{kind:'completed'}}});
  };
  const stream=async(agent,messages)=>{const next=async function*(){observed.streamCalls++;yield {kind:'native-stream'};};
    const result=[];for await(const value of events.get('llm/stream')[0]({sessionId:agent.id,provider:'official-native',model:'unchanged-native',messages},next))result.push(value);
    assert.deepEqual(result,[{kind:'native-stream'}]);};
  const useTool=(agent,name,args)=>tools.get(name).execute(args,{agent,signal:new AbortController().signal});
  fixtures.push({label,root,scopeId});
  return {root,workspaceRoot,scopeId,ctx,adapter,observed,tools,provider:skillProvider,actor,emit,runCommand,receive,step,assemble,finish,stream,useTool};
}

test('原生 open 的當輪原文選項只有明示布林可通過，既有預設不變',async()=>{
  const f=await fixture('native-current-input-arguments'),a=await f.actor('a');
  try{
    await f.runCommand(a,'on');await f.receive(a,'user','合成條件修訂。',1);
    const tool=f.tools.get('cmcp_open_history'),selection={navigationTicket:'正式導航',selectionJson:'{}'},calls=[];
    assert.equal(tool.parameters.properties.includeCurrentInput.type,'boolean');assert.equal(tool.parameters.required.includes('includeCurrentInput'),false);
    const original=f.adapter.bridge.tool;f.adapter.bridge.tool=async(...args)=>{calls.push(args);return {status:'opened'};};
    try{
      for(const option of [{},{includeCurrentInput:false},{includeCurrentInput:true}]){const args={...selection,...option};await f.useTool(a,'cmcp_open_history',args);assert.deepEqual(calls.at(-1)[2],args);}
      for(const option of [{includeCurrentInput:'true'},{includeCurrentInput:null},{pointer:'other'}]){const count=calls.length;await assert.rejects(f.useTool(a,'cmcp_open_history',{...selection,...option}),/invalid_tool_arguments/);assert.equal(calls.length,count);}
    }finally{f.adapter.bridge.tool=original;}
    await f.finish(a,1,'合成回覆。');
  }finally{await f.adapter.close();}
});

test('原生 open 錯名提示不接受 ticket alias；更正後沿同一未消耗票券正式閱讀',async()=>{
  const f=await fixture('native-open-argument-recovery'),a=await f.actor('a');
  try{
    const tool=f.tools.get('cmcp_open_history');
    assert.match(tool.description,/navigationTicket.*cmcp_find_history.*ticket/);
    assert.deepEqual(tool.parameters.required,['navigationTicket','selectionJson']);
    assert.equal(tool.parameters.additionalProperties,false);assert.equal(Object.hasOwn(tool.parameters.properties,'ticket'),false);
    await f.runCommand(a,'on');await f.receive(a,'original','合成原案保留一項必要限制。',1);await f.finish(a,1,'合成原答。');
    await f.receive(a,'followup','請正式找回先前原案。',2);
    const navigation=await f.useTool(a,'cmcp_find_history',{}),selectionJson=JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''});
    assert.equal(typeof navigation.ticket,'string');
    const bridgeOriginal=f.adapter.bridge.tool,calls=[];
    f.adapter.bridge.tool=async function(...args){calls.push(args);return bridgeOriginal.apply(this,args);};
    try{
      for(const args of [
        {ticket:navigation.ticket,selectionJson,includeCurrentInput:true},
        {ticket:navigation.ticket,selectionJson},
        {ticket:navigation.ticket,navigationTicket:navigation.ticket,selectionJson},
        {navigationTicket:navigation.ticket,selectionJson,includeCurrentInput:'true'},
        {navigationTicket:navigation.ticket,selectionJson:{version:2}},
        {navigationTicket:navigation.ticket,selectionJson,['SYNTHETIC_UNKNOWN_KEY_DO_NOT_ECHO']:'SYNTHETIC_SECRET_VALUE'}
      ])await assert.rejects(f.useTool(a,'cmcp_open_history',args),error=>{
        assert.equal(error.code,'cmcp_invalid_tool_arguments');assert.match(error.message,/^cmcp_invalid_tool_arguments:/);
        assert.match(error.message,/navigationTicket.*cmcp_find_history.*ticket/);assert.match(error.message,/selectionJson.*JSON/);
        assert.ok(!error.message.includes(navigation.ticket));assert.doesNotMatch(error.message,/SYNTHETIC_UNKNOWN_KEY_DO_NOT_ECHO|SYNTHETIC_SECRET_VALUE/);return true;
      });
      assert.equal(calls.length,0,'被拒形狀不進 Core，不消耗正式導航票券');
      const opened=await f.useTool(a,'cmcp_open_history',{navigationTicket:navigation.ticket,selectionJson});
      assert.equal(opened.kind,'cmcp_reading_collection');assert.equal(calls.length,1);
      const page=await f.useTool(a,'cmcp_read_history',{ticket:opened.ticket});assert.equal(page.kind,'cmcp_reading_page');
      await assert.rejects(f.useTool(a,'cmcp_open_history',{navigationTicket:'synthetic-foreign-ticket',selectionJson}),/navigation_not_owned_by_turn/,'正確形狀不授予其他票券所有權');
      await f.finish(a,2,'合成正式閱讀完成。');await f.runCommand(a,'off');
      await assert.rejects(f.useTool(a,'cmcp_open_history',{navigationTicket:navigation.ticket,selectionJson}),/cmcp_session_not_enabled/,'停用守護保持');
    }finally{f.adapter.bridge.tool=bridgeOriginal;}
  }finally{await f.adapter.close();}
});

test('原生宿主明確使用有限執行期限，不改使用者設定或續期既存工作',async()=>{
  const f=await fixture('explicit-native-host-turn-policy');
  try{
    const configPath=path.join(f.root,'runtime.json'),before=await fs.readFile(configPath),a=await f.actor('a');
    assert.deepEqual(f.adapter.bridge.hostTurnPolicy,{timeoutMs:900000,maxTimeoutMs:1800000});
    await f.runCommand(a,'on');const started=Date.now();await f.receive(a,'policy-input','合成宿主工作期限核對。',1);const received=Date.now();
    const turn=f.adapter.bridge.turns.get(a.id),runtime=await f.adapter.bridge.runtime(a.id),
      work=(await runtime.status()).work.find(item=>item.workId===turn.capture.hostTurn.workId),deadlineAt=work?.deadlineAt;
    assert.ok(Date.parse(deadlineAt)>=started+900000&&Date.parse(deadlineAt)<=received+900000,'正常入口首次 claim 使用十五分鐘期限');
    assert.deepEqual(runtime.hostTurnPolicy,{timeoutMs:900000,maxTimeoutMs:1800000});
    await f.adapter.bridge.claim(a.id,'policy-input',1);
    assert.equal((await runtime.status()).work.find(item=>item.workId===turn.capture.hostTurn.workId).deadlineAt,deadlineAt,'同一工作重讀不延長期限');
    await f.finish(a,1,'合成期限核對原答。');assert.deepEqual(await fs.readFile(configPath),before,'工程政策不得寫入使用者 runtime 設定');
    await fs.writeFile(path.join(f.root,'host-policy-result.json'),JSON.stringify({policy:f.adapter.bridge.hostTurnPolicy,started,received,
      deadlineAt,deadlineNotRenewed:true,userConfigurationUnchanged:true,networkCalls,desktopStarted:false},null,2),{flag:'wx'});
  }finally{await f.adapter.close();}
});

test('未啟用、其他工作區與已排隊舊輸入均不擷取；普通工具與next保留',async()=>{
  const f=await fixture('off-and-scope');
  try{
    const a=await f.actor('a'),foreign=await f.actor('foreign',f.workspaceRoot+'/different'),before=await hashes(f.root);
    await f.receive(a,'before-on','ON 前私人文字不得保存',0);await f.receive(foreign,'foreign-user','其他工作區不得保存',0);
    const decision=await f.step(a,[nativeMessage('native','普通聊天')]);assert.equal(decision.messages.length,1);
    assert.deepEqual(await hashes(f.root),before);
    const denied=await f.runCommand(foreign,'on');assert.equal(denied.response.kind,'error');assert.equal(denied.value.error.code,'cmcp_workspace_mismatch');
    const cancelled=new AbortController();cancelled.abort();assert.equal((await f.runCommand(a,'on',cancelled.signal)).response.kind,'error');
    assert.deepEqual(await hashes(f.root),before);
    assert.equal((await f.runCommand(a,'status')).value.snapshot.registration,undefined);
    await f.runCommand(a,'on');
    await f.emit('agent/inbox/claimed',{agent:a,message:nativeMessage('before-on','ON 前私人文字不得保存'),turn:0});
    assert.equal((await f.runCommand(a,'status')).value.snapshot.registration.registered,0);
    assert.equal((await f.step(a,[])).messages[0].source.kind,'cmcp-source-status');
    assert.ok(f.tools.has('native-filesystem'));assert.equal(f.observed.guardCalls,0);assert.equal(f.observed.restrictCalls,0);assert.equal(f.observed.nativeCancels,0);
  }finally{await f.adapter.close();}
});

test('明確on保存原角色／時間，skills正式get，另一Session需on才有共享原文',async()=>{
  const f=await fixture('on-and-history');
  try{
    const a=await f.actor('a'),b=await f.actor('b');
    assert.deepEqual(await f.provider.list({cwd:f.workspaceRoot,scope:a}),[]);
    assert.equal((await f.runCommand(a,'on')).response.kind,'success');
    const user='RIVER 原稿😀：只有審查通過才移到東側，目前尚未同意。',answer='Assistant 草稿：審查通過才移到東側，這不是 User 已採納。';
    const native=await f.receive(a,'u1',user,1),decision=await f.step(a,[native]);
    assert.equal(f.observed.skillGets,1);const suppliedSkill=decision.messages.find(row=>row.source?.kind==='cmcp-required-skill');
    assert.equal(suppliedSkill.content[0].text,await fs.readFile(path.join(f.root,'SKILL.md'),'utf8'));
    assert.ok(decision.messages.some(row=>row.source?.kind==='cmcp-time-context'));
    for(const message of decision.messages.filter(m=>m.source?.kind==='cmcp-required-skill'))await f.emit('session/event',a.session,{type:'user/message',time:now,data:message});
    await f.step(a,[native]);assert.equal(f.observed.skillGets,1);
    await f.finish(a,1,answer,'a1');
    const stored=(await f.runCommand(a,'status')).value.snapshot;
    assert.equal(stored.registration.registered,2);assert.equal(stored.pins.pins.length,0);
    const source=stored.registration.sources.find(row=>row.pointer.itemId==='harness-user-u1');
    assert.equal(source.pointer.sessionId,'a');assert.equal(source.sourceAuthorRole,'user');assert.equal(source.messageRecordedAt,userAt);
    assert.equal(source.location.end,[...user].length);
    const original={pointer:source.pointer,evidenceHash:source.evidenceHash,start:0,end:source.location.end,maxBytes:8192};
    const returned=(await f.runCommand(a,'original '+JSON.stringify(original))).value.original;
    assert.equal(returned.text,user);assert.equal(returned.sourceAuthorRole,'user');assert.equal(returned.messageRecordedAt,userAt);
    assert.equal((await f.runCommand(b,'status')).value.snapshot.registration,undefined);
    assert.equal((await f.runCommand(b,'original '+JSON.stringify(original))).response.kind,'error');
    assert.equal((await f.runCommand(b,'on')).response.kind,'success');
    assert.equal((await f.runCommand(b,'original '+JSON.stringify(original))).value.original.text,user);
    const request={...original,pointer:{...original.pointer,scopeId:'unrelated'}};
    assert.equal((await f.runCommand(b,'original '+JSON.stringify(request))).value.error.code,'cmcp_original_scope_mismatch');
    const times=stored.registration.sources.map(row=>row.messageRecordedAt);
    await f.runCommand(b,'off');await f.runCommand(b,'on');
    assert.deepEqual((await f.runCommand(b,'status')).value.snapshot.registration.sources.map(row=>row.messageRecordedAt),times);
    assert.ok(f.observed.skillInvalidations>=3);assert.equal(f.observed.nativeCancels,0);
  }finally{await f.adapter.close();}
});

test('官方 system assembly 供給授權協定，查看及普通 step 不自行讀取或假造 User',async()=>{
  const f=await fixture('before-answer-policy'),a=await f.actor('policy-a');
  try{
    await f.runCommand(a,'on');const native=await f.receive(a,'policy-u1','一般新問題，不要求回查。',1);
    const before=await hashes(path.join(f.root,'state')),policy=(await f.assemble(a)).sections.find(row=>row.name==='cmcp:continuity-before-answer'),first=await f.step(a,[native]);
    assert.equal(policy.text,CONTINUITY_BEFORE_ANSWER_POLICY);assert.equal(policy.interpolate,false);
    assert.equal(first.messages.some(row=>row.source?.kind==='cmcp-before-answer-policy'),false);
    const again=await f.step(a,[native]);assert.equal(again.messages.some(row=>row.source?.kind==='cmcp-before-answer-policy'),false);
    assert.deepEqual(await hashes(path.join(f.root,'state')),before,'協定不寫入原文、投影、Buffer 或控制');
    const events=(await fs.readFile(path.join(f.root,'trace/bridge-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(events.filter(row=>row.kind==='formal_read').length,0);assert.equal(events.filter(row=>row.kind==='user_capture').length,1);
    const revision='核可仍未取得，這不是更正前次回報。長期流程只修改一項，其餘維持；本輪請先回答疑問，不另設持續工作。';
    await f.finish(a,1,'普通回答。');await f.receive(a,'policy-u2',revision,2);
    const nextPolicy=(await f.assemble(a)).sections.find(row=>row.name==='cmcp:continuity-before-answer');await f.step(a);
    assert.equal(nextPolicy.text,CONTINUITY_BEFORE_ANSWER_POLICY);assert.ok(!nextPolicy.text.includes(CONTINUITY_READING_CONTRACT),'一般回合只取得短契約，完整修訂規約由成功 open 提供');assert.ok(nextPolicy.text.includes(CONTINUITY_SOURCE_BOUND_ANSWER_RULES),'來源與事實責任保持');
    const afterRevision=(await fs.readFile(path.join(f.root,'trace/bridge-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(afterRevision.filter(row=>row.kind==='formal_read').length,0,'不以暫停或維持字詞自動搜尋');
    await f.runCommand(a,'off');assert.equal((await f.step(a)).messages.length,0);assert.equal((await f.assemble(a)).sections.length,1);
  }finally{await f.adapter.close();}
});

test('正式導航與reader工具保存票券／覆蓋；off期間原文結果不得晚到',async()=>{
  const f=await fixture('formal-tools');
  try{
    const a=await f.actor('a');await f.runCommand(a,'on');
    await f.receive(a,'old-user','Blue Finch：只有安全檢查通過才移到北側。',1);await f.finish(a,1,'草稿仍待安全檢查。');
    await f.receive(a,'query','請回查先前 Blue Finch 的原文條件。',2);
    const nav=await f.useTool(a,'cmcp_find_history',{});assert.equal(nav.kind,'cmcp_reading_navigation');
    const opened=await f.useTool(a,'cmcp_open_history',{navigationTicket:nav.ticket,selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''})});
    assert.equal(opened.kind,'cmcp_reading_collection');
    const contractOutput=JSON.parse(f.tools.get('cmcp_open_history').output.render({},opened)[0].text);
    assert.deepEqual(contractOutput.continuityContract,{...CONTINUITY_READING_CONTRACT_METADATA,text:CONTINUITY_READING_CONTRACT});assert.equal(contractOutput.ticket,opened.ticket);
    await fs.writeFile(path.join(f.root,'layered-contract.json'),JSON.stringify({layer:'正式 Native hook 與 Core，宿主事件替身，零模型',formal:opened,shown:contractOutput},null,2),{flag:'wx'});
    const page=await f.useTool(a,'cmcp_read_history',{ticket:opened.ticket});assert.equal(page.kind,'cmcp_reading_page');
    assert.equal(JSON.parse(f.tools.get('cmcp_read_history').output.render({},page)[0].text).continuityContract,undefined);
    assert.equal(page.source.sourceAuthorRole,'user');assert.equal(Date.parse(page.source.messageRecordedAt),Date.parse(userAt));
    assert.equal(JSON.parse(page.modelContext).content,'Blue Finch：只有安全檢查通過才移到北側。');assert.ok(page.coverage);
    const real=f.adapter.bridge.tool.bind(f.adapter.bridge);let resolve;
    f.adapter.bridge.tool=async()=>new Promise(done=>{resolve=done;});
    const late=f.useTool(a,'cmcp_read_history',{ticket:opened.ticket});await new Promise(done=>setImmediate(done));
    const off=f.runCommand(a,'off');resolve(page);
    await assert.rejects(late,/cmcp_source_authorization_changed/);await off;f.adapter.bridge.tool=real;
    assert.equal(f.observed.nativeCancels,0);
  }finally{await f.adapter.close();}
});

test('接續關係錯誤沿正式工具回傳精確修正資訊；修正不重讀與不放寬角色',async()=>{
  const f=await fixture('continuity-correction');
  try{
    const a=await f.actor('a');await f.runCommand(a,'on');
    const original='合成計畫仍須書面同意。',answer='這是尚未執行的合成草稿。';
    await f.receive(a,'first',original,1);await f.finish(a,1,answer);
    await f.receive(a,'query','請回查合成計畫的狀態與條件。',2);
    const nav=await f.useTool(a,'cmcp_find_history',{});
    const opened=await f.useTool(a,'cmcp_open_history',{navigationTicket:nav.ticket,selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''})});
    const pages=[];for(let n=0;n<8;n++){const page=await f.useTool(a,'cmcp_read_history',{ticket:opened.ticket});pages.push(page);if(page.coverage.complete)break;}
    assert.equal(pages.at(-1).coverage.complete,true);
    const source=pages.find(page=>page.source.sourceAuthorRole==='user'),assistant=pages.find(page=>page.source.sourceAuthorRole==='assistant');
    const typedTool=f.tools.get('cmcp_project_continuity');
    assert.equal(typedTool.parameters.properties.proposal.type,'object');assert.deepEqual(typedTool.parameters.oneOf,[{required:['proposal']},{required:['proposalJson']}]);
    const typed={version:6,plans:[{id:'p',ref:source.source.ref,quote:original,topic:'合成計畫',aspect:'同意',temporalUse:'current'}],unknowns:[]};
    const typedResult=await f.useTool(a,'cmcp_project_continuity',{ticket:opened.ticket,proposal:typed});
    const legacyResult=await f.useTool(a,'cmcp_project_continuity',{ticket:opened.ticket,proposalJson:JSON.stringify(typed)});
    assert.equal(typedResult.status,'ready');assert.equal(legacyResult.status,'ready');
    assert.deepEqual({...typedResult.projection,runtimeTime:undefined},{...legacyResult.projection,runtimeTime:undefined});
    await assert.rejects(f.useTool(a,'cmcp_project_continuity',{ticket:opened.ticket,proposal:typed,proposalJson:JSON.stringify(typed)}),/exactly_one/);
    const node={id:'plan',ref:source.source.ref,quote:original,kind:'user_intent',temporalUse:'current',text:'計畫尚待書面同意。',topic:'合成計畫',aspect:'同意',relation:{kind:'related',targetNodeIds:['missing']}};
    const submit=proposal=>f.useTool(a,'cmcp_project_continuity',{ticket:opened.ticket,proposalJson:JSON.stringify(proposal)});
    const rejected=await submit({nodes:[node],unknowns:[]});
    assert.equal(rejected.status,'rejected');assert.equal(rejected.reason,'continuity_relation_target_missing');
    assert.equal(rejected.correction.issues[0].nodeId,'plan');assert.equal(rejected.correction.issues[0].targetNodeId,'missing');
    assert.equal(rejected.projection,undefined);assert.ok(!JSON.stringify(rejected).includes(original));
    const valid={nodes:[{...node,id:'draft',ref:assistant.source.ref,quote:answer,kind:'assistant_statement',relation:{kind:'related',targetNodeIds:['plan']}},{...node,relation:{kind:'independent',targetNodeIds:[]}}],unknowns:[]};
    const accepted=await submit(valid);assert.equal(accepted.status,'ready');
    assert.deepEqual(accepted.projection.coverage.selectedRoleCounts,{user:1,assistant:1,tool:0,unknown:0});
    valid.nodes[0].kind='user_report';const wrongRole=await submit(valid);assert.equal(wrongRole.status,'rejected');assert.equal(wrongRole.reason,'continuity_source_role_mismatch');assert.equal(wrongRole.projection,undefined);
  }finally{await f.adapter.close();}
});

test('回合中off只停CMCP，晚到原答不追加；普通native回合繼續',async()=>{
  const f=await fixture('off-during-turn');
  try{
    const a=await f.actor('a');await f.runCommand(a,'on');await f.receive(a,'u','回合已開始，但現在停用CMCP。',1);
    const before=(await f.runCommand(a,'status')).value.snapshot.registration.registered;
    await f.runCommand(a,'on');assert.ok(f.adapter.states.get(a.id).binding,'重複on不重置既有CMCP回合');
    const off=await f.runCommand(a,'off');assert.equal(off.value.enabled,false);assert.equal(off.value.snapshot.registration,undefined);
    await f.finish(a,1,'晚到原生答案仍由宿主呈現，不另存CMCP。');
    const decision=await f.step(a,[nativeMessage('plain','普通 native 下一步')]);assert.equal(decision.messages.length,1);
    await f.stream(a,decision.messages);
    await f.runCommand(a,'on');assert.equal((await f.runCommand(a,'status')).value.snapshot.registration.registered,before);
    assert.equal(f.observed.nativeCancels,0);assert.equal(f.observed.streamCalls,1);
  }finally{await f.adapter.close();}
});

test('Skill讀取失敗有公開錯誤與明示來源缺口，next及native stream正常',async()=>{
  const f=await fixture('missing-skill');
  try{
    const a=await f.actor('a');await f.runCommand(a,'on');await f.receive(a,'u','合成測試正常原生聊天。',1);f.ctx.missingSkill=true;
    const decision=await f.step(a,[nativeMessage('native','宿主原始訊息')]);
    assert.equal(decision.messages.length,2);assert.equal(decision.messages.at(-1).source.kind,'cmcp-source-status');
    assert.ok(decision.messages.at(-1).content[0].text.includes('沒有提供有效來源'));
    assert.equal((await f.runCommand(a,'status')).value.lastError.code,'cmcp_required_skill_missing');
    await f.stream(a,decision.messages);assert.equal(f.observed.streamCalls,1);assert.equal(f.observed.nativeCancels,0);
  }finally{await f.adapter.close();}
});

test('來源清冊回傳前撤權時不洩漏晚到選項',async()=>{
  const f=await fixture('control-late-choices');
  try{
    const a=await f.actor('a');await f.runCommand(a,'on');await f.receive(a,'u','合成來源清冊晚到守護。',1);await f.finish(a,1,'合成原答。');
    const original=f.adapter.bridge.status.bind(f.adapter.bridge);let calls=0,release,entered;
    const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
    f.adapter.bridge.status=async()=>{const value=await original();if(++calls===2){entered();await gate;}return value;};
    const pending=f.runCommand(a,'sources');await ready;
    const off=f.runCommand(a,'off');release();
    const late=await pending;await off;
    assert.equal(late.response.kind,'error');assert.equal(late.value.choices,undefined);
    assert.equal(late.value.error.code,'cmcp_source_authorization_changed');
  }finally{await f.adapter.close();}
});

test('所有Session的trace僅metadata；textHash可核對而thinking不保存',async()=>{
  const f=await fixture('trace-boundary',{acceptance:['synthetic']});
  try{
    const a=await f.actor('normal'),synthetic=await f.actor('synthetic');await f.runCommand(a,'on');await f.receive(a,'u','正常測試原文',1);
    const secretMarker='不允許保存的thinking內容';
    const messages=[{id:'wire-visible',role:'assistant',content:[{type:'text',text:'可見模型資料'}, {type:'thinking',text:secretMarker}]}];
    await f.stream(a,messages);await f.finish(a,1,'普通原答');
    const normalFiles=await fs.readdir(path.join(f.root,'trace'));assert.equal(normalFiles.filter(file=>file.startsWith('acceptance-input-')).length,0);
    let trace=await fs.readFile(path.join(f.root,'trace/bridge-events.jsonl'),'utf8');assert.ok(!trace.includes('可見模型資料'));assert.ok(!trace.includes(secretMarker));
    await f.runCommand(synthetic,'on');await f.receive(synthetic,'synthetic-u','合成已授權的原文',2);
    await f.stream(synthetic,[{id:'first',role:'user',content:[{type:'text',text:'前個step不另存'}]}]);await f.stream(synthetic,messages);await f.finish(synthetic,2,'合成原答');
    const files=(await fs.readdir(path.join(f.root,'trace'))).filter(file=>file.startsWith('acceptance-input-'));assert.equal(files.length,0);
    trace=await fs.readFile(path.join(f.root,'trace/bridge-events.jsonl'),'utf8');assert.ok(!trace.includes(secretMarker));assert.ok(!trace.includes('可見模型資料'));
    const modelInputs=trace.trim().split('\n').map(row=>JSON.parse(row)).filter(row=>row.kind==='model_input');
    assert.equal(modelInputs.at(-1).messages[0].textHash,hash('可見模型資料'));
    assert.equal(modelInputs.at(-1).messages[0].textBytes,Buffer.byteLength('可見模型資料'));
    assert.equal(modelInputs.at(-1).bodyRetention,'metadata_only');
    assert.equal(f.observed.nativeCancels,0);
  }finally{await f.adapter.close();}
});

test('未知與非文字content不讀取正文；metadata不冒稱完整wire',()=>{
  const projected=projectModelInputMetadata([{id:'a',role:'assistant',toolCallId:'native-call',content:[{type:'analysis',text:'不要保存'}, {type:'tool-call',input:{private:'不要保存'}}]}]);
  assert.equal(projected[0].textBytes,0);assert.equal(projected[0].textHash,hash(''));assert.equal(projected[0].toolCallId,'native-call');
  assert.ok(!JSON.stringify(projected).includes('不要保存'));
});

test('Windows斜線差異經path.resolve後仍是同一工作區；Skills核對一致且相鄰／相對路徑拒絕',async()=>{
  const f=await fixture('windows-paths',{forwardConfig:true});
  try{
    const native=await f.actor('session-native-backslash'),alternate=await f.actor('session-forward-slash',f.workspaceRoot.replaceAll('\\','/'));
    const first=await f.runCommand(native,'on');assert.equal(first.response.kind,'success');assert.equal(first.value.workspaceRoot,path.resolve(f.workspaceRoot));
    const options={cwd:f.workspaceRoot.replaceAll('\\','/'),scope:native};
    const candidates=await f.provider.list(options);assert.equal(candidates.length,1);
    assert.equal((await f.provider.get(candidates[0],options)).provider,'cmcp-desktop-native');
    assert.equal((await f.runCommand(alternate,'on')).response.kind,'success');
    assert.equal((await f.provider.list({cwd:f.workspaceRoot,scope:alternate})).length,1);
    const other=await f.actor('session-other',f.workspaceRoot+'-another');
    assert.equal((await f.runCommand(other,'on')).value.error.code,'cmcp_workspace_mismatch');
    assert.deepEqual(await f.provider.list({cwd:f.workspaceRoot+'-another',scope:native}),[]);
    const relative=await f.actor('session-relative',path.relative(process.cwd(),f.workspaceRoot));
    assert.equal((await f.runCommand(relative,'on')).value.error.code,'cmcp_workspace_mismatch');
    assert.deepEqual(await f.provider.list({cwd:path.relative(process.cwd(),f.workspaceRoot),scope:native}),[]);
  }finally{await f.adapter.close();}
});

test('兩Session逐一啟用後，B off只撤B；A的有效回合、正式讀取與後續保存繼續',async()=>{
  const f=await fixture('session-off-isolation');
  try{
    const a=await f.actor('session-a'),b=await f.actor('session-b');await f.runCommand(a,'on');await f.runCommand(b,'on');
    const text='A 已授權原文：只有檢查通過才執行。';
    await f.receive(a,'a-before-b-off',text,1);
    const before=await f.runCommand(a,'status'),generation=before.value.snapshot.controlConfiguration.generation;
    const off=await f.runCommand(b,'off');assert.equal(off.value.enabled,false);assert.equal(off.value.snapshot.registration,undefined);
    const after=await f.runCommand(a,'status');assert.equal(after.value.enabled,true);
    assert.equal(after.value.snapshot.controlConfiguration.effective.enabled,true);
    assert.equal(after.value.snapshot.controlConfiguration.generation,generation,'B off不改scope共同控制世代');
    assert.ok(f.adapter.states.get(a.id).binding,'B off不撤A正在進行的CMCP回合');
    await f.finish(a,1,'A 的原生答案繼續保存。');
    const stored=(await f.runCommand(a,'status')).value.snapshot,source=stored.registration.sources.find(row=>row.pointer.itemId==='harness-user-a-before-b-off');
    const original={pointer:source.pointer,evidenceHash:source.evidenceHash,start:0,end:source.location.end,maxBytes:8192};
    assert.equal((await f.runCommand(a,'original '+JSON.stringify(original))).value.original.text,text);
    assert.equal((await f.runCommand(b,'original '+JSON.stringify(original))).value.error.code,'cmcp_session_not_enabled');
    await f.receive(b,'b-after-off','B OFF 之後的原文不得追加。',2);await f.finish(b,2,'B OFF 之後的答案不得追加。');
    assert.equal((await f.runCommand(a,'status')).value.snapshot.registration.registered,2);
    await f.receive(a,'a-after-b-off','A 在 B OFF 後仍繼續保存。',3);await f.finish(a,3,'A 後續原答仍可保存。');
    const final=(await f.runCommand(a,'status')).value.snapshot;assert.equal(final.registration.registered,4);
    assert.ok(final.registration.sources.every(row=>row.pointer.sessionId===a.id));assert.equal(f.observed.nativeCancels,0);
  }finally{await f.adapter.close();}
});

test('修後反例：B加入不解除A的Clean，也不改共用世代與保存／勿擾設定',async()=>{
  const f=await fixture('clean-counterexample-fixed');
  try{
    const a=await f.actor('a'),b=await f.actor('b');await f.runCommand(a,'on');
    await f.receive(a,'source-a','合成原文：A 的草案仍待書面批准。',1);await f.finish(a,1,'合成回覆：尚未取得書面批准。');
    const saved=await f.runCommand(a,'status'),controls=saved.value.snapshot.controlConfiguration;
    const patch={clean:true,saveUser:false,saveAssistant:false,
      doNotDisturb:{enabled:true,timezone:'Asia/Taipei',windows:[{start:'00:00',end:'23:59'}]}};
    await f.adapter.bridge.operate({scopeId:f.scopeId,generation:controls.generation,action:'controls',patch});
    const protectedA=await f.runCommand(a,'status'),protectedState=await hashes(path.join(f.root,'state'));
    const bOn=await f.runCommand(b,'on'),afterA=await f.runCommand(a,'status');
    assert.equal(bOn.response.kind,'success');assert.equal(bOn.value.optedIn,true);assert.equal(bOn.value.enabled,false);
    assert.deepEqual(bOn.value.enhancementBlockedReasons,['shared_clean']);
    assert.deepEqual(afterA.value.snapshot.controlConfiguration,protectedA.value.snapshot.controlConfiguration);
    assert.equal(afterA.value.snapshot.registration,undefined);assert.equal(afterA.value.enabled,false);
    assert.deepEqual(await hashes(path.join(f.root,'state')),protectedState,'加入與狀態讀取不寫入共用狀態');
    const source=saved.value.snapshot.registration.sources[0];
    const original={pointer:source.pointer,evidenceHash:source.evidenceHash,start:0,end:source.location.end,maxBytes:8192};
    assert.equal((await f.runCommand(a,'original '+JSON.stringify(original))).response.kind,'error');
    const bOff=await f.runCommand(b,'off');
    assert.deepEqual(bOff.value.snapshot.controlConfiguration,protectedA.value.snapshot.controlConfiguration);
    assert.equal(f.adapter.states.get(a.id).optedIn,true);
    await fs.writeFile(path.join(f.root,'counterexample-fixed.json'),JSON.stringify({saved,protectedA,bOn,afterA,bOff,
      stateHashesUnchanged:true,networkCalls,desktopStarted:false},null,2),{flag:'wx'});
  }finally{await f.adapter.close();}
});

test('首次加入保留配置預設；共同OFF與已開派送不拒絕Session授權或暗改控制',async()=>{
  for(const initialControls of [{enabled:false,proactive:true,pins:true,saveUser:false},
    {enabled:true,clean:false,proactive:true,pins:true}]){
    const f=await fixture('initial-controls-'+initialControls.enabled,{initialControls});
    try{
      const a=await f.actor('a'),b=await f.actor('b');
      const before=(await f.runCommand(a,'status')).value.snapshot.controlConfiguration;
      assert.equal(before.revision,0);
      const aOn=await f.runCommand(a,'on'),bOn=await f.runCommand(b,'on');
      assert.equal(aOn.response.kind,'success');assert.equal(bOn.response.kind,'success');
      assert.equal(aOn.value.enabled,initialControls.enabled);assert.equal(aOn.value.optedIn,true);
      assert.deepEqual(aOn.value.snapshot.controlConfiguration,before);
      assert.deepEqual(bOn.value.snapshot.controlConfiguration,before);
      assert.deepEqual(aOn.value.enhancementBlockedReasons,initialControls.enabled?[]:['shared_enhancement_off']);
      await f.runCommand(a,'off');assert.equal(f.adapter.states.get(b.id).optedIn,true);
      assert.deepEqual((await f.runCommand(b,'status')).value.snapshot.controlConfiguration,before);
      assert.ok(f.tools.has('native-filesystem'));assert.equal(f.observed.nativeCancels,0);
    }finally{await f.adapter.close();}
  }
});

for(const mode of ['shared-off','shared-clean'])test('共用保護 '+mode+'：Skill不可見、原生next不新增CMCP提示或正文捕捉',async()=>{
  const f=await fixture('shared-protection-'+mode,{initialControls:mode==='shared-off'?{enabled:false}:{clean:true}});
  try{
    const a=await f.actor('a'),on=await f.runCommand(a,'on'),initial=on.value.snapshot.controlConfiguration;
    const offered=await f.provider.list({cwd:f.workspaceRoot,scope:a});
    const message=await f.receive(a,'ordinary','這是一般合成聊天，請只回答本題。',1),decision=await f.step(a,[message]);
    await f.finish(a,1,'一般合成原生回答。');await f.stream(a,decision.messages);
    const state=await f.runCommand(a,'status'),trace=(await fs.readFile(path.join(f.root,'trace','bridge-events.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const evidence={kind:'native_shared_protection_counterexample',mode,optedIn:state.value.optedIn,enabled:state.value.enabled,
      offeredSkillNames:offered.map(row=>row.name),addedContextKinds:decision.messages.slice(1).map(row=>row.source?.kind),
      receivedInputCount:f.adapter.bridge.inputs.size,storedTurnCount:f.adapter.bridge.turns.size,
      cmcpUserCaptures:trace.filter(row=>row.kind==='user_capture').length,cmcpAssistantSaves:trace.filter(row=>row.kind==='assistant_saved').length,
      controlsUnchanged:JSON.stringify(state.value.snapshot.controlConfiguration)===JSON.stringify(initial),
      nativeToolsRetained:f.tools.has('native-filesystem'),nativeStreamCalls:f.observed.streamCalls,networkCalls,desktopStarted:false};
    await fs.writeFile(path.join(f.root,'shared-protection-result.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
    assert.deepEqual(offered,[]);assert.deepEqual(decision.messages,[message]);assert.equal(f.adapter.bridge.inputs.size,0);assert.equal(f.adapter.bridge.turns.size,0);
    assert.equal(evidence.cmcpUserCaptures,0);assert.equal(evidence.cmcpAssistantSaves,0);assert.equal(evidence.controlsUnchanged,true);
    assert.equal(f.tools.has('native-filesystem'),true);assert.equal(f.observed.nativeCancels,0);assert.equal(f.observed.streamCalls,1);
  }finally{await f.adapter.close();}
});

test('明示共用OFF使Skills快取失效；不改既存宿主材料，重新開啟仍保留正式原時間',async()=>{
  const f=await fixture('shared-off-existing-native-history');
  try{
    const a=await f.actor('a');await f.runCommand(a,'on');const native=await f.receive(a,'before','合成原稿：條件尚未確認。',1),decision=await f.step(a,[native]);
    const skill=decision.messages.find(row=>row.source?.kind==='cmcp-required-skill');assert.ok(skill);
    await f.emit('session/event',a.session,{type:'user/message',time:now,data:skill});await f.finish(a,1,'合成原稿仍須確認。');
    const before=await f.runCommand(a,'status'),source=before.value.snapshot.registration.sources.find(row=>row.pointer.itemId==='harness-user-before'),
      invalidations=f.observed.skillInvalidations,receivedCount=f.adapter.bridge.inputs.size;
    await f.runCommand(a,'controls '+JSON.stringify({scopeId:f.scopeId,generation:before.value.snapshot.controlConfiguration.generation,patch:{enabled:false}}));
    assert.ok(f.observed.skillInvalidations>invalidations,'共用控制修改須通知官方Skills重新載入');
    assert.deepEqual(await f.provider.list({cwd:f.workspaceRoot,scope:a}),[]);
    assert.equal(await f.provider.get({name:'cmcp-continuity'},{cwd:f.workspaceRoot,scope:a}),undefined,'已快取候選也不能取得新Skill內容');
    const ordinary=await f.receive(a,'after','OFF後的一般合成問題。',2),existing=[...decision.messages,ordinary],next=await f.step(a,existing);
    assert.deepEqual(next.messages,existing,'不刪除、過濾或改寫官方宿主既存role:user材料');assert.equal(f.adapter.bridge.inputs.size,receivedCount);
    await f.finish(a,2,'OFF後的一般原生回答。');const off=await f.runCommand(a,'status');
    await f.runCommand(a,'controls '+JSON.stringify({scopeId:f.scopeId,generation:off.value.snapshot.controlConfiguration.generation,patch:{enabled:true}}));
    const restored=await f.runCommand(a,'status'),sameSource=restored.value.snapshot.registration.sources.find(row=>row.pointer.itemId===source.pointer.itemId);
    assert.equal(sameSource.evidenceHash,source.evidenceHash);assert.equal(sameSource.messageRecordedAt,source.messageRecordedAt);
    assert.equal(restored.value.snapshot.registration.registered,before.value.snapshot.registration.registered);
  }finally{await f.adapter.close();}
});

test('原生next等待期間切到共用OFF：不新增Skill、時間或錯誤提示',async()=>{
  const f=await fixture('shared-off-during-next');
  try{
    const a=await f.actor('a');await f.runCommand(a,'on');const native=await f.receive(a,'in-flight','合成當輪問題。',1),before=await f.runCommand(a,'status');
    const decision=await f.step(a,[native],async()=>{
      await f.runCommand(a,'controls '+JSON.stringify({scopeId:f.scopeId,generation:before.value.snapshot.controlConfiguration.generation,patch:{enabled:false}}));
    });
    assert.deepEqual(decision.messages,[native]);assert.equal(f.observed.skillGets,0);await f.finish(a,1,'仍由原生宿主回答。');
    const trace=(await fs.readFile(path.join(f.root,'trace','bridge-events.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
    assert.equal(trace.some(row=>row.kind==='skill_loaded'),false);assert.equal(trace.some(row=>row.kind==='assistant_saved'),false);
    assert.equal(f.observed.nativeCancels,0);
  }finally{await f.adapter.close();}
});

test('共用controls需本對話授權、明示scope及當前generation；過時或取消操作不寫入',async()=>{
  const f=await fixture('explicit-shared-controls');
  try{
    const a=await f.actor('a'),b=await f.actor('b');
    const initial=(await f.runCommand(a,'status')).value.snapshot.controlConfiguration;
    const request={scopeId:f.scopeId,generation:initial.generation,patch:{clean:true}};
    assert.equal((await f.runCommand(a,'controls '+JSON.stringify(request))).value.error.code,'cmcp_session_not_enabled');
    await f.runCommand(a,'on');
    assert.equal((await f.runCommand(a,'controls '+JSON.stringify({...request,scopeId:'foreign'}))).value.error.code,'cmcp_explicit_shared_control_required');
    const abort=new AbortController();abort.abort();
    assert.equal((await f.runCommand(a,'controls '+JSON.stringify(request),abort.signal)).value.error.code,'cmcp_command_cancelled');
    const accepted=await f.runCommand(a,'controls '+JSON.stringify(request));
    assert.equal(accepted.response.kind,'success');assert.equal(accepted.value.snapshot.controlConfiguration.effective.clean,true);
    assert.equal(accepted.value.sharedControlScope.scope,'workspace');
    const protectedControls=accepted.value.snapshot.controlConfiguration;
    assert.equal((await f.runCommand(a,'controls '+JSON.stringify({...request,patch:{clean:false}}))).value.error.code,'controls_changed_refresh_required');
    const bOn=await f.runCommand(b,'on');assert.deepEqual(bOn.value.snapshot.controlConfiguration,protectedControls);
    const restored=await f.runCommand(a,'controls '+JSON.stringify({scopeId:f.scopeId,generation:protectedControls.generation,patch:{clean:false}}));
    assert.equal(restored.response.kind,'success');assert.equal(restored.value.enabled,true);
    assert.equal((await f.runCommand(b,'status')).value.enabled,true);
    assert.equal(f.observed.guardCalls,0);assert.equal(f.observed.nativeCancels,0);
    await fs.writeFile(path.join(f.root,'control-results.json'),JSON.stringify({initial,accepted,bOn,restored,networkCalls},null,2),{flag:'wx'});
  }finally{await f.adapter.close();}
});

test('授權競態：等待狀態的舊ON不能覆蓋較新的OFF，後續明確ON仍可生效',async()=>{
  const f=await fixture('authorization-sequence-race'),evidence={kind:'cmcp_session_authorization_race',clock:'本機離線 barrier；不靠隨機重試',phases:[]};
  const originalStatus=f.adapter.bridge.status.bind(f.adapter.bridge);let release=()=>{};
  const barrier=()=>{
    const entered=Promise.withResolvers(),gate=Promise.withResolvers();let armed=true;release=gate.resolve;
    f.adapter.bridge.status=async()=>{const value=await originalStatus();if(armed){armed=false;entered.resolve();await gate.promise;}return value;};
    return {entered:entered.promise,release:gate.resolve};
  };
  try{
    const a=await f.actor('a'),initial=(await f.runCommand(a,'status')).value.snapshot.controlConfiguration;
    const first=barrier(),oldOn=f.runCommand(a,'on');await first.entered;
    const newerOff=f.runCommand(a,'off');assert.equal(f.adapter.states.get(a.id).optedIn,false,'OFF在排隊前立即撤回');
    first.release();const [onResult,offResult]=await Promise.all([oldOn,newerOff]);
    f.adapter.bridge.status=originalStatus;
    const offState=await f.runCommand(a,'status');evidence.phases.push({scenario:'ON等待→OFF→釋放ON',onResult,offResult,offState});
    assert.equal(onResult.value.optedIn,false,'較舊ON回傳不能曾恢復撤銷的授權');
    assert.equal(offState.value.optedIn,false);assert.equal(offState.value.enabled,false);
    assert.deepEqual(offState.value.snapshot.controlConfiguration,initial);
    const second=barrier(),supersededOn=f.runCommand(a,'on');await second.entered;
    const queuedOff=f.runCommand(a,'off'),latestOn=f.runCommand(a,'on');second.release();
    const responses=await Promise.all([supersededOn,queuedOff,latestOn]);f.adapter.bridge.status=originalStatus;
    const final=await f.runCommand(a,'status');evidence.phases.push({scenario:'ON等待→OFF→新ON→釋放舊ON',responses,final});
    assert.equal(responses[2].response.kind,'success');assert.equal(final.value.optedIn,true);assert.equal(final.value.enabled,true);
    assert.deepEqual(final.value.snapshot.controlConfiguration,initial);assert.equal(f.observed.nativeCancels,0);
    evidence.status='PASS';
  }finally{
    release();f.adapter.bridge.status=originalStatus;evidence.networkCalls=networkCalls;evidence.desktopStarted=false;
    await fs.writeFile(path.join(f.root,'authorization-race.json'),JSON.stringify(evidence,null,2),{flag:'wx'});await f.adapter.close();
  }
});

// 最後 metadata note 的 await 不得讓撤權／正式來源異動之後仍回傳 image。
// 測試只在自己的合成正式 History／原件動手，不開 Desktop 或真模型。
function guardTestPng(){
  const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  const crc=bytes=>{let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const head=Buffer.alloc(8),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);head.write(type,4);tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4),data])));return Buffer.concat([head,data,tail]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,20,130,220,20,130,220]))),chunk('IEND',Buffer.alloc(0))]);
}
async function mediaDeliveryFixture(label){
  const f=await fixture(label),a=await f.actor('a');await f.runCommand(a,'on');
  const text='這張工作坊佈置初稿有藍色區塊，場地還須書面同意。',id='media-before';
  await f.receive(a,id,text,1);
  const status=await f.adapter.bridge.status(),source=status.registration.sources.find(row=>row.pointer.itemId==='harness-user-'+id),runtime=await f.adapter.bridge.runtime(a.id);
  const access=await f.adapter.bridge.mediaAccess(runtime,source.pointer,source.evidenceHash,{capture:true,captureProof:{text,receivedAt:userAt}});
  const bytes=guardTestPng(),media=await access.store.capture({parent:access.parent,onGuard:access.onGuard,attachment:{filename:'合成工具守護.png',mimeType:'image/png',bytes}});
  await f.finish(a,1,'合成原答：尚待書面同意。');await f.receive(a,'media-query','請找回剛才工作坊佈置初稿的原圖與原說明。',2);
  const nav=await f.useTool(a,'cmcp_find_history',{}),opened=await f.useTool(a,'cmcp_open_history',{navigationTicket:nav.ticket,selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''})});
  const pages=[];let page;for(let n=0;n<4;n++){const candidate=await f.useTool(a,'cmcp_read_history',{ticket:opened.ticket});pages.push(candidate);if(candidate.source?.sourceAuthorRole==='user'&&candidate.modelContext&&JSON.parse(candidate.modelContext).content===text){page=candidate;break;}}
  await fs.writeFile(path.join(f.root,'media-delivery-formal-reader.json'),JSON.stringify({source,nav,opened,pages},null,2),{flag:'wx'});
  assert.ok(page?.mediaSourceRef,'測試須先經正式 reader 取得這份父原文及 mediaSourceRef，不人工植入 sourceRef');
  f.ctx.attachments={async saveImage(input){assert.deepEqual(input.data,bytes);return {type:'image',id:'synthetic-normalized-image',mediaType:input.mediaType};}};
  return {...f,agent:a,source,media,args:{sourceRef:page.mediaSourceRef,mediaId:media.mediaId}};
}
for(const mode of ['unchanged','session-off','shared-clean','parent-changed'])test('圖片工具最後 note 等待期間 '+mode+'：正式重驗後才交付',async()=>{
  const f=await mediaDeliveryFixture('media-delivery-'+mode),bridge=f.adapter.bridge,realNote=bridge.note.bind(bridge);
  const entered=Promise.withResolvers(),gate=Promise.withResolvers();let blocked=false,returned=false,actualError=null;
  bridge.note=async(...args)=>{const result=await realNote(...args);if(args[1]==='media_model_material'&&!blocked){blocked=true;entered.resolve();await gate.promise;}return result;};
  try{
    const operation=f.useTool(f.agent,'cmcp_read_image',f.args).then(value=>{returned=true;return value;},error=>{actualError=error.message;throw error;});
    // 先安裝拒絕處理，保留所有原始結果，不靠未處理 Promise 或隨機時序達標。
    const outcome=operation.then(value=>({ok:true,value}),error=>({ok:false,error}));
    const first=await Promise.race([entered.promise.then(()=>({entered:true})),outcome.then(result=>({entered:false,result}))]);
    assert.equal(first.entered,true,'正式 image tool 須先取得原件並進入 note barrier；實際：'+(first.result?.error?.message??'提早交付'));
    if(mode==='session-off')await f.runCommand(f.agent,'off');
    if(mode==='shared-clean'){const state=await bridge.status();await bridge.operate({scopeId:f.scopeId,generation:state.controlConfiguration.generation,action:'controls',patch:{clean:true}});}
    if(mode==='parent-changed'){
      const directory=path.join(f.root,'state','history');let file,record;
      for(const name of await fs.readdir(directory)){const target=path.join(directory,name),candidate=JSON.parse(await fs.readFile(target,'utf8'));if(candidate.evidence?.pointer?.itemId===f.source.pointer.itemId){file=target;record=candidate;break;}}
      assert.ok(file);await fs.writeFile(path.join(f.root,'guard-parent-before.json'),await fs.readFile(file),{flag:'wx'});
      record.evidence.content.body='這是來源保存後發生的合成異動，不可當成原說明。';await fs.writeFile(file,JSON.stringify(record));
    }
    gate.resolve();const result=await outcome;
    if(mode==='unchanged'){assert.equal(result.ok,true);assert.equal(result.value.metadata.mediaId,f.media.mediaId);assert.equal(result.value.originalSha256,f.media.sha256);}
    else assert.equal(result.ok,false,'撤權／共用保護／父原件異動之後不可返回可供模型使用的 image');
    assert.equal(f.observed.nativeCancels,0);assert.ok(f.tools.has('native-filesystem'));
  }finally{
    gate.resolve();bridge.note=realNote;
    await fs.writeFile(path.join(f.root,'media-delivery-guard-result.json'),JSON.stringify({mode,clock:'明示 note await barrier',returned,actualError,
      originalMediaId:f.media.mediaId,originalSha256:f.media.sha256,networkCalls,desktopStarted:false,modelsStarted:false},null,2),{flag:'wx'});
    await f.adapter.close();
  }
});

test('過期結算保留失敗並取消原票；同 Session 下一輪及新 Session 不被鎖住',async()=>{
  const f=await fixture('expired-settlement'),a=await f.actor('expired-a');await f.runCommand(a,'on');
  const nativeNow=Date.now;let evidence;
  try{
    await f.receive(a,'expired-input','合成過期來源；失敗答案不可冒稱保存。',1);
    const turn=f.adapter.bridge.turns.get(a.id),runtime=await f.adapter.bridge.runtime(a.id),work=await runtime.progress(turn.capture.hostTurn.workId);
    Date.now=()=>Date.parse(work.deadlineAt)+1;
    await f.finish(a,1,'這份合成晚到答案必須被拒絕。');
    Date.now=nativeNow;
    const failed=f.adapter.states.get(a.id),cancelled=await runtime.progress(turn.capture.hostTurn.workId);
    evidence={originalError:failed.error?.code,bridgeState:turn.state,binding:failed.binding,workState:cancelled.state,cancelRequested:cancelled.cancelRequested};
    assert.equal(evidence.originalError,'host_turn_expired');assert.equal(turn.state,'cancelled');assert.equal(failed.binding,null);
    assert.equal(cancelled.cancelRequested,true);
    assert.ok(!(await f.adapter.bridge.status()).registration.sources.some(row=>row.pointer.itemId==='harness-assistant-assistant-1'));
    await f.receive(a,'next-input','合成下一輪應取得新的正式票。',2);await f.finish(a,2,'合成下一輪正常完成。');
    const b=await f.actor('new-b');await f.runCommand(b,'on');await f.receive(b,'new-session-input','合成新 Session 正常取得來源。',1);
    assert.equal(f.adapter.bridge.turns.get(b.id)?.state,'running');await f.finish(b,1,'合成新 Session 正常完成。');
    evidence.nextTurn='saved';evidence.newSession='saved';
  }finally{Date.now=nativeNow;await fs.writeFile(path.join(f.root,'expired-settlement.json'),JSON.stringify(evidence??{},null,2),{flag:'wx'});await f.adapter.close();}
});

test('結算取消失敗保留原 binding；明示 OFF 可重試同票清理',async()=>{
  const f=await fixture('settlement-cancel-failed'),a=await f.actor('cancel-failed-a');await f.runCommand(a,'on');
  const nativeNow=Date.now,originalCancel=f.adapter.bridge.cancelTurn;
  try{
    await f.receive(a,'failed-cleanup-input','合成取消故障，不可放行其他 Session。',1);
    const bridge=f.adapter.bridge,turn=bridge.turns.get(a.id),runtime=await bridge.runtime(a.id),work=await runtime.progress(turn.capture.hostTurn.workId);
    bridge.cancelTurn=async()=>{throw Error('synthetic_cancel_failed');};Date.now=()=>Date.parse(work.deadlineAt)+1;
    await f.finish(a,1,'合成晚到答案。');Date.now=nativeNow;
    assert.equal(f.adapter.states.get(a.id).error?.code,'host_completion_cleanup_failed');
    assert.equal(turn.state,'running');assert.equal(f.adapter.states.get(a.id).binding?.userMessageId,'failed-cleanup-input');
    await assert.rejects(bridge.runtime('another-session'),/one_active_harness_turn_required/);
    bridge.cancelTurn=originalCancel;const off=await f.runCommand(a,'off');
    assert.equal(off.response.kind,'success');assert.equal(turn.state,'cancelled');assert.equal(f.adapter.states.get(a.id).binding,null);
    assert.equal((await runtime.progress(turn.capture.hostTurn.workId)).cancelRequested,true);
  }finally{Date.now=nativeNow;f.adapter.bridge.cancelTurn=originalCancel;await f.adapter.close();}
});

test('同 turn 每筆已 commit 可見 Assistant 分開保存，保留原 id／時間／回覆，不保存 reasoning 或工具正文',async()=>{
  const f=await fixture('all-committed-assistants'),a=await f.actor('multi-commit-a');await f.runCommand(a,'on');
  const first='合成詳細比對：第一版紅圓，修訂版綠圓；場地仍待確認。',last='上面已列出兩版比對與未確認條件。',firstAt=new Date(Date.parse(now)-10000).toISOString();
  try{
    await f.receive(a,'multi-user','請保留我這次兩版比較的原回答。',1);
    const workId=f.adapter.bridge.turns.get(a.id).capture.hostTurn.workId;
    const firstEvent={type:'assistant/message',time:firstAt,data:{turn:1,step:1,interrupted:false,message:{id:'detail-message',role:'assistant',content:[
      {type:'text',text:first},{type:'reasoning',text:'不應保存的隱藏推理測試字串'},{type:'tool-call',name:'synthetic-tool',text:'不應保存的工具正文測試字串'}]}}};
    await f.emit('session/event',a.session,firstEvent);await f.emit('session/event',a.session,firstEvent);
    assert.equal((await (await f.adapter.bridge.runtime(a.id)).progress(workId)).state,'running');
    await f.emit('session/event',a.session,{type:'assistant/message',time:firstAt,data:{turn:1,step:2,interrupted:false,message:{id:'reasoning-only',role:'assistant',content:[{type:'reasoning',text:'不應建立的純推理来源'}]}}});
    await f.emit('session/event',a.session,{type:'assistant/message',time:firstAt,data:{turn:1,step:2,interrupted:true,message:{id:'interrupted',role:'assistant',content:[{type:'text',text:'不應保存的中斷片段'}]}}});
    await f.emit('session/event',a.session,{type:'tool/result',time:firstAt,data:{turn:1,step:2,message:{id:'tool-body',role:'tool',content:[{type:'text',text:'不應保存的工具結果'}]}}});
    await f.finish(a,1,last,'summary-message');
    const snapshot=await f.adapter.bridge.status(),sources=snapshot.registration.sources.filter(row=>row.pointer.sessionId===a.id&&row.sourceAuthorRole==='assistant');
    assert.equal(sources.length,2);
    for(const [id,text,time]of [['detail-message',first,firstAt],['summary-message',last,now]]){
      const source=sources.find(row=>row.pointer.itemId==='harness-assistant-'+id);assert.ok(source);assert.equal(source.messageRecordedAt,time);
      const original=await f.adapter.bridge.original({pointer:source.pointer,evidenceHash:source.evidenceHash,start:0,end:[...text].length,maxBytes:8192});assert.equal(original.text,text);
    }
    const trace=(await fs.readFile(path.join(f.root,'trace','bridge-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),saved=trace.filter(row=>row.kind==='assistant_saved');
    assert.equal(saved.length,2);assert.ok(saved.every(row=>row.receipt.replyTo.itemId==='harness-user-multi-user'&&row.receipt.formalReply.status==='verified'));
    const runtime=await f.adapter.bridge.runtime(a.id);assert.equal((await runtime.progress(workId)).state,'completed');
    const completed=f.adapter.bridge.turns.get(a.id);
    await assert.rejects(runtime.afterAssistant({text:'終結後不能新增的訊息。',sourceId:'late-message',replyTo:completed.capture.sourcePointer,hostTurn:completed.capture.hostTurn,timeContext:{now,timezone:'Asia/Taipei'},finalizeHostTurn:false}),/host_turn_not_active/);
    await assert.rejects(runtime.afterAssistant({text:'不得繞過票券的訊息。',sourceId:'unbound-message',timeContext:{now,timezone:'Asia/Taipei'},finalizeHostTurn:false}),/invalid_host_assistant_finalization/);
    await fs.writeFile(path.join(f.root,'committed-assistants-result.json'),JSON.stringify({sources:sources.map(({pointer,messageRecordedAt})=>({pointer,messageRecordedAt})),saved,work:await runtime.progress(workId)},null,2),{flag:'wx'});
  }finally{await f.adapter.close();}
});

test('同 turn 追加 User 後，先前已 commit Assistant 保留原回覆對象，新訊息綁新 User',async()=>{
  const f=await fixture('committed-before-next-user'),a=await f.actor('followup-a');await f.runCommand(a,'on');
  try{
    await f.receive(a,'first-user','第一個合成原問題。',1);const oldWork=f.adapter.bridge.turns.get(a.id).capture.hostTurn.workId;
    await f.emit('session/event',a.session,{type:'assistant/message',time:now,data:{turn:1,step:1,message:{id:'first-reply',role:'assistant',content:[{type:'text',text:'第一個問題的已提交回答。'}]}}});
    await f.receive(a,'second-user','同一宿主回合追加的第二個合成問題。',1);await f.finish(a,1,'第二個問題的回答。','second-reply');
    const trace=(await fs.readFile(path.join(f.root,'trace','bridge-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),saved=trace.filter(row=>row.kind==='assistant_saved');
    assert.equal(saved.length,2);assert.equal(saved[0].receipt.replyTo.itemId,'harness-user-first-user');assert.equal(saved[1].receipt.replyTo.itemId,'harness-user-second-user');
    const runtime=await f.adapter.bridge.runtime(a.id);assert.equal((await runtime.progress(oldWork)).cancelRequested,true);
    assert.equal(f.adapter.bridge.turns.get(a.id).state,'saved');
  }finally{await f.adapter.close();}
});

test('已 commit 前綴保留；中途控制變更拒絕下一筆並明示部分保存，不終結為成功',async()=>{
  const f=await fixture('committed-prefix-control-change'),a=await f.actor('partial-a');await f.runCommand(a,'on');
  try{
    await f.receive(a,'partial-user','合成問題；只保留已正式提交的有效回答。',1);
    await f.emit('session/event',a.session,{type:'assistant/message',time:now,data:{turn:1,step:1,message:{id:'saved-prefix',role:'assistant',content:[{type:'text',text:'控制變更前已提交的合成回答。'}]}}});
    const before=await f.adapter.bridge.status();await f.adapter.bridge.operate({scopeId:f.scopeId,generation:before.controlConfiguration.generation,action:'controls',patch:{historyRecall:false}});
    await f.finish(a,1,'這份控制變更後的回答不能晚到保存。','rejected-tail');
    const after=await f.adapter.bridge.status(),turn=after.turns.find(row=>row.sessionId===a.id);
    assert.equal(turn.state,'cancelled');assert.equal(turn.assistantSave.savedMessages,1);assert.equal(turn.assistantSave.failure.code,'host_turn_controls_changed');
    assert.equal(turn.assistantSave.failure.currentMessageOutcome,'unconfirmed');
    assert.ok(after.registration.sources.some(row=>row.pointer.itemId==='harness-assistant-saved-prefix'));
    assert.ok(!after.registration.sources.some(row=>row.pointer.itemId==='harness-assistant-rejected-tail'));
    assert.equal(f.adapter.states.get(a.id).error.code,'host_turn_controls_changed');
  }finally{await f.adapter.close();}
});

for(const phase of ['before-publication','after-publication'])test('Assistant 原文發布與 OFF 的明確先後：'+phase,async()=>{
  const f=await fixture('assistant-off-'+phase),a=await f.actor('publication-a');await f.runCommand(a,'on');
  const realRead=fs.readFile,realLink=fs.link,entered=Promise.withResolvers(),gate=Promise.withResolvers();
  let evidence={phase,boundary:'合成 History 原文 hard-link 發布；可控 await barrier'},armed=false;
  try{
    await f.receive(a,'publication-user','合成原問題，先保存的前綴必須保留。',1);
    await f.emit('session/event',a.session,{type:'assistant/message',time:now,data:{turn:1,message:{id:'authorized-prefix',role:'assistant',content:[{type:'text',text:'OFF 前已保存的合成前綴。'}]}}});
    const historyRoot=path.join(f.root,'state','history');armed=true;
    if(phase==='before-publication')fs.readFile=async(file,...args)=>{
      const value=await realRead(file,...args);
      if(armed&&path.dirname(String(file))===historyRoot&&path.basename(String(file)).startsWith('.pending-')){armed=false;entered.resolve();await gate.promise;}
      return value;
    };
    else fs.link=async(from,to,...args)=>{const value=await realLink(from,to,...args);
      if(armed&&path.dirname(String(to))===historyRoot){armed=false;entered.resolve();await gate.promise;}return value;};
    const committing=f.emit('session/event',a.session,{type:'assistant/message',time:now,data:{turn:1,message:{id:'racing-tail',role:'assistant',content:[{type:'text',text:'與 OFF 競態的合成原回答。'}]}}});
    await entered.promise;const off=f.runCommand(a,'off');
    assert.equal(f.adapter.states.get(a.id).optedIn,false,'OFF 必須在排隊等待前撤銷授權');
    gate.resolve();await Promise.all([committing,off]);fs.readFile=realRead;fs.link=realLink;
    const originals=[];for(const name of await fs.readdir(historyRoot))if(/^[a-f0-9]{64}\.json$/.test(name))originals.push(JSON.parse(await realRead(path.join(historyRoot,name),'utf8')).evidence);
    const tail=originals.find(row=>row.pointer.itemId==='harness-assistant-racing-tail'),state=f.adapter.states.get(a.id),turn=f.adapter.bridge.turns.get(a.id);
    const trace=(await realRead(path.join(f.root,'trace','bridge-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    evidence={...evidence,tailPublished:!!tail,prefixPreserved:originals.some(row=>row.pointer.itemId==='harness-assistant-authorized-prefix'),
      error:state.error?.code??null,turnState:turn.state,assistantSaveFailure:turn.assistantSaveFailure??null,
      tailSuccessReceipt:trace.some(row=>row.kind==='assistant_saved'&&row.messageId==='racing-tail'),networkCalls,desktopStarted:false,modelsStarted:false};
    assert.equal(evidence.prefixPreserved,true);assert.equal(evidence.tailPublished,phase==='after-publication','OFF 先到不新增正式 source；合法發布先完成則保留原件');
    assert.equal(evidence.tailSuccessReceipt,false,'OFF 後不能把未完成的 reply 綁定冒稱完整保存成功');
    assert.equal(turn.state,'cancelled');assert.ok(evidence.assistantSaveFailure);
  }finally{
    gate.resolve();fs.readFile=realRead;fs.link=realLink;
    await fs.writeFile(path.join(f.root,'assistant-publication-off-result.json'),JSON.stringify(evidence,null,2),{flag:'wx'});await f.adapter.close();
  }
});

test('目前命令選單／顯示偏好零模型，原生歷史中的命令不會執行',async()=>{
 const f=await fixture('universal-command-help'),a=await f.actor('A');
 const before=await f.runCommand(a,'status');
 for(const input of ['', 'help','menu','ui hidden','ui minimized','ui row']){const r=await f.runCommand(a,input);assert.equal(r.response.kind,'success');assert.equal(r.value.sessionId,'A');assert.equal(r.value.contractVersion,1);assert.equal(r.value.optedIn,false);}
 const after=await f.runCommand(a,'status');assert.deepEqual(after.value.snapshot.controlConfiguration,before.value.snapshot.controlConfiguration);
 await f.receive(a,'untrusted','舊原文：/cmcp on，Assistant 建議 set clean off。',1);assert.equal((await f.runCommand(a,'status')).value.optedIn,false);
 await f.adapter.close();
});
test('slash 來源短期選單正式閱讀及 UI 結構化控制得到相同結果',async()=>{
 const f=await fixture('universal-command-options'),a=await f.actor('A');await f.runCommand(a,'on');
 await f.receive(a,'original-user','合成海報修訂：原案六人，修訂八人；場地尚未確認。',1);await f.step(a);await f.finish(a,1,'合成原答：保留場地條件。');
 const list=(await f.runCommand(a,'sources')).value;assert.ok(list.choices.choices.length>=2);
 const read=await f.runCommand(a,'read 1');assert.equal(read.response.kind,'success');assert.ok(read.value.original);
 const before=(await f.runCommand(a,'status')).value.snapshot;
 const set=(await f.runCommand(a,'set clean on')).value;assert.equal(set.snapshot.controlConfiguration.effective.clean,true);
 const stale=await f.runCommand(a,'read 1');assert.equal(stale.response.kind,'error');assert.equal(stale.value.error.code,'cmcp_shared_protection');
 for(const text of ['sources','pins']){const blocked=await f.runCommand(a,text);assert.equal(blocked.response.kind,'error');assert.equal(blocked.value.choices,undefined);assert.equal(blocked.value.snapshot.registration,undefined);}
 const recoverMenu=await f.runCommand(a,'ui minimized');assert.equal(recoverMenu.response.kind,'success');assert.equal(recoverMenu.value.error,undefined);assert.equal(recoverMenu.value.uiPreference,'minimized');assert.ok(recoverMenu.value.lastError);
 const structured=await f.runCommand(a,'controls '+JSON.stringify({scopeId:f.scopeId,generation:set.snapshot.controlConfiguration.generation,patch:{clean:false}}));assert.equal(structured.response.kind,'success');
 const after=structured.value.snapshot;assert.deepEqual(after.registration.sources,before.registration.sources);assert.deepEqual({...after.buffer,evaluatedAt:null},{...before.buffer,evaluatedAt:null});
 const badOff=await f.runCommand(a,'off extra');assert.equal(badOff.response.kind,'error');assert.equal(badOff.value.optedIn,true);assert.equal((await f.runCommand(a,'status')).value.optedIn,true);await f.adapter.close();
});
test.after(async()=>{
  globalThis.fetch=nativeFetch;
  assert.equal(networkCalls,0);
  await fs.writeFile(path.join(testRoot,'fixture-index.json'),JSON.stringify({kind:'cmcp_native_host_offline_fixtures',fixtures,
    networkCalls,credentialReferencesConfigured:0,desktopStarted:false,modelsStarted:false,boundary:'官方事件／工具／commands／skills介面的離線替身；不代替真Desktop事件與UI驗收。'},null,2),{flag:'wx'});
  console.log(JSON.stringify({fixtures:testRoot,actualNetworkCalls:networkCalls,credentialReferencesConfigured:0}));
});
