import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createSharedHarnessHost,apply} from './host.mjs';

const folder=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(folder,'../../..');
const base=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(repo,'logs/tests/shared-harness'));
const artifacts=path.join(base,new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());
const time='2026-10-03T01:02:03.000Z';
async function fixture(label,{failAppend=false,handedOff=false}={}){
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
    if(operation==='join')return{joined:true,epoch:'broker:1'};if(operation==='claim')return{owner:{hostId:'harness'},epoch:'broker:2'};
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
  return{host,ctx,config,calls,registered,handlers,agent,event,user,start,answer,end,root};
}

test('只處理精確 Session 與 workspace；其他宿主對話維持原路徑',async()=>{
  const f=await fixture('scope');const other={...f.agent,id:'other',session:{id:'other',header:{cwd:f.config.workspaceRoot}}};
  await f.handlers.get('agent/created')({agent:other});const decision={kind:'enter',messages:[{role:'user',content:[]}]};
  assert.equal(await f.handlers.get('agent/pre-step')({agent:other},async()=>decision),decision);assert.equal(f.calls.length,0);await f.host.close();
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
  assert.deepEqual([...f.registered.keys()],['cmcp_find_history','cmcp_open_history','cmcp_read_history','cmcp_reading_progress']);await f.host.close();
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
