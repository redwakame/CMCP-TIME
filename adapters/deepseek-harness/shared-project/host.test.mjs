import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createSharedHarnessHost,apply} from './host.mjs';
import {CONTINUITY_BEFORE_ANSWER_POLICY,CONTINUITY_POLICY_METADATA,CONTINUITY_READING_CONTRACT,CONTINUITY_READING_CONTRACT_METADATA,CONTINUITY_KIND_RULES,CONTINUITY_PLAN_GRANULARITY_RULES,CONTINUITY_PLAN_ROLE_RULES,CONTINUITY_REASON_BINDING_RULES,CONTINUITY_PLAN_V3_RULES,CONTINUITY_SOURCE_BOUND_ANSWER_RULES,CONTINUITY_ATTRIBUTION_RULES,CONTINUITY_PLAN_SCOPE_REVIEW_RULES,CONTINUITY_EXPLICIT_REASON_SCOPE_RULES,CONTINUITY_TICKET_SCOPE_RULES} from '../../continuity-policy.mjs';

const folder=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(folder,'../../..');
const base=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(repo,'logs/tests/shared-harness'));
const artifacts=path.join(base,new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());
const time='2026-10-03T01:02:03.000Z';
async function fixture(label,{failAppend=false,handedOff=false,toolResults={}}={}){
  const root=path.join(artifacts,label),handlers=new Map(),registered=new Map(),agents=new Map(),calls=[],effects=[];
  await fs.mkdir(root,{recursive:true});let skillProvider;
  const config={kind:'cmcp_shared_harness_config',version:1,projectId:'synthetic-project',hostId:'harness',agentId:'official-harness',profileName:'synthetic-sdk',
    workspaceRoot:root,artifactRoot:path.join(root,'evidence'),skillPath:path.join(folder,'SKILL.md'),sessionIds:['synthetic-session'],route:{provider:'p',model:'m'},
    connection:{pipe:'synthetic-pipe',controlAuthFile:path.join(root,'control-reference.json'),readAuthFile:path.join(root,'read-reference.json')}};
  const ctx={profileContext:{name:'synthetic-sdk'},get(name){return this[name];},provide(name,value){this[name]=value;},agents:{get:id=>agents.get(id)},
    on(name,handler){handlers.set(name,handler);},effect(factory){const dispose=factory();if(typeof dispose==='function')effects.push(dispose);},
    tools:{register(tool){registered.set(tool.name,tool);return()=>{};}},
    skills:{registerProvider(factory){skillProvider=factory({invalidate(){}});},async get(name,options){return skillProvider.get({name},options);}}};
  const call=async input=>{calls.push(input);const {operation,args}=input.request;
    if(Object.hasOwn(toolResults,operation))return structuredClone(toolResults[operation]);
    if(operation==='join')return{joined:true,epoch:'broker:1'};if(operation==='claim')return{owner:{hostId:'harness'},epoch:'broker:2'};
    if(operation==='reader-status')return{controls:{enabled:true,clean:false},epoch:'broker:2'};
    if(operation==='receive'||operation==='claim-turn')return{capture:{status:'saved',sourcePointer:{itemId:args.messageId}},context:{kind:'cmcp_host_time_context'}};
    if(operation==='request-context')return{kind:'cmcp_host_time_context',contextId:'context',timeCard:{current:{now:time}},userMessageRecordedAt:time};
    if(operation==='append-assistant'&&failAppend&&args.messageId==='a2')throw Error('synthetic_append_failed');
    if(operation==='revoke'&&handedOff)throw Error('shared_project_epoch_stale');
    if(operation==='status')return{epoch:'broker:3',owner:{hostId:'codex',agentId:'official-codex',sessionId:'next-session'}};
    if(operation==='revoke')return{epoch:'broker:3',revoked:true};return{status:'saved'};};
  const host=createSharedHarnessHost(ctx,config,{call});
  const agent={id:'synthetic-session',session:{id:'synthetic-session',header:{cwd:root}},ctx:{effect(factory){effects.push(factory());}}};agents.set(agent.id,agent);
  const event=(type,data,eventTime=time)=>handlers.get('session/event')(agent.session,{type,data,time:eventTime});
  const user={id:'u1',role:'user',source:{kind:'user'},content:[{type:'text',text:'合成 User 原文'}]};
  const start=async()=>{await handlers.get('agent/created')({agent});event('agent/inbox/spliced',{inserted:[user]});handlers.get('agent/inbox/inserted')({agent,message:user});handlers.get('agent/inbox/claimed')({agent,message:user,turn:1});};
  const answer=(id,text='合成 Assistant 原文')=>event('assistant/message',{turn:1,message:{id,role:'assistant',content:[{type:'thinking',text:'不應保存的推理'},{type:'text',text}]}});
  const end=()=>event('turn/end',{turn:1,reason:{kind:'completed'}});
  const assemble=async()=>{const original={sections:[{name:'native',text:'原生宿主'}],tools:[{name:'native-tool'}],contexts:[],variables:{}};
    const value=await handlers.get('system-prompt/assemble')(original,{agent},async()=>original);
    assert.equal(value.tools,original.tools);assert.equal(value.sections[0],original.sections[0]);return value;};
  return{host,ctx,config,calls,registered,handlers,agent,event,user,start,answer,end,root,assemble};
}

test('只處理精確 Session 與 workspace；其他宿主對話維持原路徑',async()=>{
  const f=await fixture('scope');const other={...f.agent,id:'other',session:{id:'other',header:{cwd:f.config.workspaceRoot}}};
  await f.handlers.get('agent/created')({agent:other});const decision={kind:'enter',messages:[{role:'user',content:[]}]};
  assert.equal(await f.handlers.get('agent/pre-step')({agent:other},async()=>decision),decision);assert.equal(f.calls.length,0);await f.host.close();
});
test('投影正式工具登錄可機讀物件；兩種表示走同一 read 路由，雙輸入拒絕',async()=>{
 const f=await fixture('typed-continuity-input');await f.start();await f.host.drain();
 try{const tool=f.registered.get('cmcp_project_continuity'),proposal={version:6,plans:[],unknowns:[]};
  assert.equal(tool.parameters.properties.proposal.type,'object');assert.equal(tool.parameters.properties.proposal.properties.version.const,6);
  assert.deepEqual(tool.parameters.oneOf,[{required:['proposal']},{required:['proposalJson']}]);
  for(const args of [{ticket:'t',proposal},{ticket:'t',proposalJson:JSON.stringify(proposal)}]){
   await tool.execute(args,{agent:f.agent});const call=f.calls.at(-1);assert.equal(call.role,'model_read');assert.equal(call.request.operation,'continuity');assert.deepEqual(call.request.args,args);
  }
  const count=f.calls.length;await assert.rejects(tool.execute({ticket:'t',proposal,proposalJson:'{}'},{agent:f.agent}),/exactly_one/);assert.equal(f.calls.length,count);
 }finally{await f.host.close();}
});
test('正式建立先 join/claim；正式 skill 讀取與模型工具只用 read credential',async()=>{
  const f=await fixture('capabilities');await f.start();await f.host.drain();
  assert.deepEqual(f.calls.slice(0,2).map(row=>row.request.operation),['join','claim']);
  const decision=await f.handlers.get('agent/pre-step')({agent:f.agent},async()=>({kind:'enter',messages:[]}));
  assert.equal(decision.messages[0].source.kind,'cmcp-required-skill');assert.equal(decision.messages[1].source.kind,'cmcp-time-context');
  const tool=f.registered.get('cmcp_find_history'),result=await tool.execute({}, {agent:f.agent});
  const trace=(await fs.readFile(path.join(f.config.artifactRoot,'host-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const evidence=trace.filter(row=>row.kind==='formal_tool');assert.equal(evidence.length,1);
  const rendered=tool.output.render({},result)[0].text;
  assert.equal(JSON.stringify(evidence[0].projectedResult),rendered);
  assert.equal(evidence[0].projectionHash,createHash('sha256').update(rendered).digest('hex'));
  assert.equal(evidence[0].projectionBytes,Buffer.byteLength(rendered));
  const read=f.calls.find(row=>row.request.operation==='find');assert.equal(read.role,'model_read');assert.equal(read.connection.authFile,f.config.connection.readAuthFile);
  assert.deepEqual([...f.registered.keys()],['cmcp_find_history','cmcp_open_history','cmcp_read_history','cmcp_reading_progress','cmcp_project_continuity','cmcp_read_continuity']);await f.host.close();
});
test('open 當輪原文只接受明示布林選項，保留預設與嚴格模型引數',async()=>{
  const f=await fixture('current-input-arguments');await f.start();await f.host.drain();
  const tool=f.registered.get('cmcp_open_history'),selection={navigationTicket:'正式導航',selectionJson:'{}'};
  assert.equal(tool.parameters.properties.includeCurrentInput.type,'boolean');assert.equal(tool.parameters.required.includes('includeCurrentInput'),false);
  for(const option of [{},{includeCurrentInput:false},{includeCurrentInput:true}]){const args={...selection,...option};await tool.execute(args,{agent:f.agent});assert.deepEqual(f.calls.at(-1).request.args,args);}
  for(const option of [{includeCurrentInput:'true'},{includeCurrentInput:null},{pointer:'other'}]){const count=f.calls.length;await assert.rejects(tool.execute({...selection,...option},{agent:f.agent}),/invalid_tool_arguments/);assert.equal(f.calls.length,count);}
  await f.host.close();
});

test('open 錯把 find.ticket 當引數名時提供固定安全映射，拒絕後可依原契約修正',async()=>{
  const f=await fixture('open-argument-recovery');
  try{
    const tool=f.registered.get('cmcp_open_history');
    assert.deepEqual(tool.parameters.required,['navigationTicket','selectionJson']);
    assert.equal(tool.parameters.additionalProperties,false);
    assert.equal(Object.hasOwn(tool.parameters.properties,'ticket'),false);
    assert.match(tool.description,/navigationTicket.*cmcp_find_history.*ticket/);
    await assert.rejects(tool.execute({ticket:'not-authorized',selectionJson:'{}'},{agent:f.agent}),/^Error: shared_harness_session_not_authorized$/);
    await f.start();await f.host.drain();
    const marker='SYNTHETIC_VALUE_MUST_NOT_BE_ECHOED',selectionJson='{"version":2,"eventRefs":[],"scope":{"basis":"ordinary_history"},"clarification":""}';
    for(const args of [
      {ticket:marker,selectionJson,includeCurrentInput:true},
      {ticket:marker,selectionJson},
      {ticket:marker,navigationTicket:marker,selectionJson},
      {navigationTicket:marker,selectionJson,includeCurrentInput:'true'},
      {navigationTicket:marker,selectionJson:{version:2}},
      {navigationTicket:marker,selectionJson,['SYNTHETIC_UNKNOWN_KEY_DO_NOT_ECHO']:marker}
    ]){
      const count=f.calls.length;
      await assert.rejects(tool.execute(args,{agent:f.agent}),error=>{
        assert.equal(error.code,'shared_harness_invalid_tool_arguments');
        assert.match(error.message,/^shared_harness_invalid_tool_arguments:/);
        assert.match(error.message,/navigationTicket.*cmcp_find_history.*ticket/);
        assert.match(error.message,/selectionJson.*JSON/);assert.match(error.message,/includeCurrentInput.*布林/);
        assert.doesNotMatch(error.message,/SYNTHETIC_VALUE_MUST_NOT_BE_ECHOED|SYNTHETIC_UNKNOWN_KEY_DO_NOT_ECHO/);return true;
      });
      assert.equal(f.calls.length,count,'錯誤形狀不進共享服務、不取得新 scope 或消耗票券');
    }
    const corrected={navigationTicket:'synthetic-navigation',selectionJson,includeCurrentInput:true};
    await tool.execute(corrected,{agent:f.agent});
    assert.deepEqual(f.calls.at(-1).request.args,corrected);assert.equal(f.calls.at(-1).request.operation,'open');assert.equal(f.calls.at(-1).role,'model_read');
    await assert.rejects(f.registered.get('cmcp_read_history').execute({unexpected:marker},{agent:f.agent}),error=>error.message==='shared_harness_invalid_tool_arguments','其他工具錯誤訊息保持原樣');
  }finally{await f.host.close();}
});

test('同一 turn 多則已提交答案保留 ID/原時間；排隊尚未 claim 也只終結一次',async()=>{
  const f=await fixture('multi');await f.start();f.answer('a1','第一則原答');f.answer('a2','第二則原答');f.end();await f.host.drain();
  const saved=f.calls.filter(row=>row.request.operation==='append-assistant');assert.equal(saved.length,2);
  assert.deepEqual(saved.map(row=>row.request.args.messageId),['a1','a2']);assert.deepEqual(saved.map(row=>row.request.args.text),['第一則原答','第二則原答']);
  assert.ok(saved.every(row=>row.request.args.receivedAt===time&&row.request.args.userMessageId==='u1'));
  assert.equal(f.calls.filter(row=>row.request.operation==='finish').length,1);assert.equal(f.calls.find(row=>row.request.operation==='receive').request.args.receivedAt,time);await f.host.close();
});
test('重複提交冪等；reasoning、工具正文、stream 與 interrupted 不保存',async()=>{
  const f=await fixture('visible');await f.start();f.answer('a1');f.answer('a1');
  f.event('assistant/message',{turn:1,message:{id:'thinking',role:'assistant',content:[{type:'thinking',text:'不保存'}]}});
  f.event('assistant/message',{turn:1,interrupted:true,message:{id:'interrupted',role:'assistant',content:[{type:'text',text:'不保存'}]}});
  f.event('tool/result',{message:{id:'tool',role:'tool',content:[{type:'text',text:'不保存'}]}});f.event('assistant/stream',{text:'不保存'});f.end();await f.host.drain();
  assert.equal(f.calls.filter(row=>row.request.operation==='append-assistant').length,1);await f.host.close();
});
test('第二則保存失敗保留第一則且明確取消，不能回報完整保存',async()=>{
  const f=await fixture('partial',{failAppend:true});await f.start();f.answer('a1');f.answer('a2');f.end();await f.host.drain();
  assert.equal(f.calls.filter(row=>row.request.operation==='finish').length,0);assert.ok(f.calls.some(row=>row.request.operation==='cancel'));
  const trace=await fs.readFile(path.join(f.config.artifactRoot,'host-events.jsonl'),'utf8');assert.match(trace,/operation_failed/);assert.doesNotMatch(trace,/turn_saved/);await f.host.close();
});
test('同 ID 不同原答拒絕，後續 turn/end 不能掩蓋衝突',async()=>{
  const f=await fixture('identity');await f.start();f.answer('a1','原件');f.answer('a1','不同正文');f.end();await f.host.drain();
  assert.equal(f.calls.filter(row=>row.request.operation==='finish').length,0);assert.equal(f.calls.filter(row=>row.request.operation==='append-assistant').length,1);await f.host.close();
});
test('原始 User 時間缺失明確失敗；正常關閉仍撤權釋放',async()=>{
  const f=await fixture('timestamp');await f.handlers.get('agent/created')({agent:f.agent});f.handlers.get('agent/inbox/inserted')({agent:f.agent,message:f.user});await f.host.drain();
  assert.equal(f.calls.filter(row=>row.request.operation==='receive').length,0);await f.host.close();assert.equal(f.calls.at(-1).request.operation,'revoke');
});
test('handoff 後舊 SDK 只確認失去 owner，不以新 epoch 撤權或搶回',async()=>{
  const f=await fixture('handoff',{handedOff:true});await f.start();f.answer('a1');f.end();await f.host.drain();await f.host.close();
  const operations=f.calls.map(row=>row.request.operation);assert.deepEqual(operations.slice(-2),['revoke','status']);assert.equal(operations.filter(operation=>operation==='claim').length,1);
  const trace=await fs.readFile(path.join(f.config.artifactRoot,'host-events.jsonl'),'utf8');assert.match(trace,/session_handoff_confirmed/);assert.doesNotMatch(trace,/session_released/);
});
test('官方 Cordis 非同步 apply 只回傳可接受的空值',async()=>{
  const f=await fixture('official-apply');assert.equal(await apply(f.ctx,f.config),undefined);await f.host.close();
});
test('丟棄排隊 B 只丟棄 B，不取消正在回答的 A',async()=>{
  const f=await fixture('discard-identity');await f.start();await f.host.drain();
  const queued={id:'u2',role:'user',source:{kind:'user'},content:[{type:'text',text:'排隊 B'}]};
  f.event('agent/inbox/spliced',{inserted:[queued]});f.handlers.get('agent/inbox/inserted')({agent:f.agent,message:queued});await f.host.drain();
  f.handlers.get('agent/inbox/discarded')({agent:f.agent,message:queued});await f.host.drain();
  assert.equal(f.calls.find(row=>row.request.operation==='cancel').request.args.userMessageId,'u2');
  assert.equal(f.host.states.get(f.agent.id).binding.userMessageId,'u1');await f.host.close();
});
test('文字限定 User 拒絕非 text block，不默默捨棄未知附件',async()=>{
  const f=await fixture('nontext');await f.handlers.get('agent/created')({agent:f.agent});
  const user={...f.user,content:[...f.user.content,{type:'file',name:'synthetic-only.txt'}]};
  f.event('agent/inbox/spliced',{inserted:[user]});f.handlers.get('agent/inbox/inserted')({agent:f.agent,message:user});await f.host.drain();
  assert.equal(f.calls.filter(row=>row.request.operation==='receive').length,0);await f.host.close();
});

test('合成正式工具證據達容量時明確拒絕，不默默裁切或新增讀取',async()=>{
  const f=await fixture('tool-capacity');await f.start();await f.host.drain();f.host.states.get(f.agent.id).toolResults=128;
  await assert.rejects(f.registered.get('cmcp_find_history').execute({}, {agent:f.agent}),/shared_harness_tool_evidence_capacity_exceeded/);
  assert.equal(f.calls.filter(row=>row.request.operation==='find').length,0);await f.host.close();
});

test('正式工具回執無法保存時阻擋下一模型步驟，不把缺頁當已取得',async()=>{
  const f=await fixture('tool-evidence-failed');await f.start();await f.host.drain();
  const prior=f.config.artifactRoot+'-before',block=f.config.artifactRoot+'-synthetic-block';
  await fs.rename(f.config.artifactRoot,prior);await fs.writeFile(f.config.artifactRoot,'合成取證阻塞',{flag:'wx'});
  try{
    await assert.rejects(f.registered.get('cmcp_find_history').execute({}, {agent:f.agent}));
    assert.equal(f.host.states.get(f.agent.id).error,'shared_harness_formal_tool_evidence_failed');
    const count=f.calls.filter(row=>row.request.operation==='request-context').length;
    await assert.rejects(f.handlers.get('agent/pre-step')({agent:f.agent},async()=>({kind:'enter',messages:[]})),/formal_tool_evidence_failed/);
    assert.equal(f.calls.filter(row=>row.request.operation==='request-context').length,count);
  }finally{await fs.rename(f.config.artifactRoot,block);await fs.rename(prior,f.config.artifactRoot);await f.host.close();}
});

test('取證等待期間取消、撤權或換回合，不把晚到正式結果交給模型',async t=>{
  for(const mode of ['abort','revoke','turn']){
    const f=await fixture('late-tool-'+mode);await f.start();await f.host.drain();
    const controller=new AbortController(),state=f.host.states.get(f.agent.id),append=fs.appendFile;
    t.mock.method(fs,'appendFile',async(...args)=>{
      const value=await append(...args);
      if(String(args[1]).includes('"kind":"formal_tool"')){
        if(mode==='abort')controller.abort();
        else if(mode==='revoke')state.revoked=true;
        else state.binding={...state.binding,harnessTurn:2};
      }
      return value;
    });
    try{
      await assert.rejects(f.registered.get('cmcp_find_history').execute({}, {agent:f.agent,signal:controller.signal}),/shared_harness_cancelled|shared_harness_authorization_changed/);
      assert.equal(state.error,'shared_harness_formal_tool_delivery_failed');
      const before=f.calls.length;
      await assert.rejects(f.registered.get('cmcp_find_history').execute({}, {agent:f.agent}),/not_authorized|delivery_failed/);
      assert.equal(f.calls.length,before,'缺頁後不追加來源請求');
    }finally{t.mock.restoreAll();await f.host.close();}
  }
});

test('官方 system assembly 供給共用協定，普通問題不自動讀取或保存為 User',async()=>{
  const f=await fixture('before-answer-once');await f.start();await f.host.drain();
  const enter=()=>f.handlers.get('agent/pre-step')({agent:f.agent},async()=>({kind:'enter',messages:[]}));
  const assembly=await f.assemble(),policy=assembly.sections.find(row=>row.name==='cmcp:continuity-before-answer');
  assert.equal(policy.text,CONTINUITY_BEFORE_ANSWER_POLICY);assert.equal(policy.interpolate,false);
  const first=await enter();assert.equal(first.messages.some(row=>row.source?.kind==='cmcp-before-answer-policy'),false);
  const second=await enter();assert.equal(second.messages.some(row=>row.source?.kind==='cmcp-before-answer-policy'),false);
  assert.equal(f.calls.filter(row=>row.request.operation==='receive').length,1,'宿主協定不能保存成 User 原文');
  assert.equal(f.calls.some(row=>['find','open','read','continuity'].includes(row.request.operation)),false,'不依每輪注入而自動搜尋或產生投影');
  f.answer('a1');f.end();await f.host.drain();
  const revision='核可仍未取得，這不是更正前次回報。長期流程只修改一項，其餘維持；本輪請先回答疑問，不另設持續工作。';
  const user={...f.user,id:'u2',content:[{type:'text',text:revision}]};
  f.event('agent/inbox/spliced',{inserted:[user]});f.handlers.get('agent/inbox/inserted')({agent:f.agent,message:user});f.handlers.get('agent/inbox/claimed')({agent:f.agent,message:user,turn:2});await f.host.drain();
  const nextPolicy=(await f.assemble()).sections.find(row=>row.name==='cmcp:continuity-before-answer');await enter();
  assert.equal(nextPolicy.text,CONTINUITY_BEFORE_ANSWER_POLICY);assert.ok(!nextPolicy.text.includes(CONTINUITY_READING_CONTRACT),'一般回合只取得短契約，完整修訂規約由成功 open 提供');assert.ok(nextPolicy.text.includes(CONTINUITY_SOURCE_BOUND_ANSWER_RULES),'來源與事實責任保持');
  assert.equal(f.calls.filter(row=>row.request.operation==='receive').at(-1).request.args.text,revision,'新規則不能變造當輪 User 原文');
  assert.equal(f.calls.some(row=>['find','open','read','continuity','control'].includes(row.request.operation)),false,'接點不依字詞自動查詢或取得控制權');
  await f.host.close();const closed=await enter();assert.equal(closed.messages.length,0);assert.equal((await f.assemble()).sections.length,1);
});

test('原生 next 等候時撤權或取消，協定不晚到也不啟動正式閱讀',async()=>{
  for(const mode of ['revoke','abort']){
    const f=await fixture('policy-'+mode);await f.start();await f.host.drain();const controller=new AbortController(),decision={kind:'enter',messages:[]};
    const value=await f.handlers.get('agent/pre-step')({agent:f.agent,signal:controller.signal},async()=>{if(mode==='revoke')f.host.states.get(f.agent.id).revoked=true;else controller.abort();return decision;});
    assert.equal(value,decision);assert.equal(f.calls.some(row=>row.request.operation==='request-context'),false);await f.host.close();
  }
});

test('Shared Harness 正式 open 模型輸出提供完整契約，其他步驟與撤權不供給',async()=>{
  const formal={kind:'cmcp_reading_collection',status:'ready',ticket:'formal-ticket',manifestHash:'a'.repeat(64),collection:{sources:[{ref:'r1'}]},readSources:0};
  const f=await fixture('reading-contract',{toolResults:{open:formal,read:{kind:'cmcp_reading_page',status:'complete',ticket:formal.ticket}}});
  try{
    await f.start();await f.host.drain();
    const initial=await f.handlers.get('agent/pre-step')({agent:f.agent},async()=>({kind:'enter',messages:[]}));
    assert.ok(!initial.messages.flatMap(m=>m.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').includes(CONTINUITY_READING_CONTRACT));
    const tool=f.registered.get('cmcp_open_history'),args={navigationTicket:'nav',selectionJson:'{}'},raw=await tool.execute(args,{agent:f.agent});
    assert.deepEqual(raw,formal);const shown=JSON.parse(tool.output.render(args,raw)[0].text);
    assert.deepEqual(shown.continuityContract,{...CONTINUITY_READING_CONTRACT_METADATA,text:CONTINUITY_READING_CONTRACT});assert.equal(shown.ticket,formal.ticket);
    await fs.writeFile(path.join(f.root,'layered-contract.json'),JSON.stringify({layer:'正式 Shared Harness hook，broker 合成替身，零模型',initial,formal,shown},null,2),{flag:'wx'});
    const trace=(await fs.readFile(path.join(f.config.artifactRoot,'host-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(trace.filter(row=>row.kind==='formal_tool').at(-1).projectedResult,shown);
    const read=f.registered.get('cmcp_read_history'),page=await read.execute({ticket:formal.ticket},{agent:f.agent});
    assert.equal(JSON.parse(read.output.render({},page)[0].text).continuityContract,undefined);
    f.host.states.get(f.agent.id).revoked=true;const before=f.calls.length;await assert.rejects(tool.execute(args,{agent:f.agent}));assert.equal(f.calls.length,before);
  }finally{await f.host.close();}
});
