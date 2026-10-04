import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {createCodexSharedAdapter,makeTicket,readTool,validateBinding,dynamicTools} from './adapter.mjs';
import {runReadCli} from './read-cli.mjs';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const fixtures=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(repo,'logs/tests/codex-shared'));
await fs.mkdir(fixtures,{recursive:true});
const workspace=await fs.realpath(await fs.mkdtemp(path.join(fixtures,'adapter-')));
const controller={kind:'cmcp_codex_shared_binding',version:1,projectId:'synthetic-project',hostId:'codex',agentId:'configured-client',workspace,role:'controller',connection:{pipe:'\\\\.\\pipe\\cmcp-synthetic-test',authFile:path.join(workspace,'controller.json')}};
const reader={...controller,role:'model_read',connection:{...controller.connection,authFile:path.join(workspace,'read.json')}};
const ticket=makeTicket(controller,'synthetic-session','opaque-epoch:1');
const user=(changes={})=>({threadId:ticket.sessionId,turnId:'turn-1',completedAtMs:1780000000000,item:{type:'userMessage',id:'official-user-id',content:[{type:'text',text:'保留原始問題\n含換行。'}]},...changes});
const answer=(changes={})=>({threadId:ticket.sessionId,turnId:'turn-1',completedAtMs:1780000001000,item:{type:'agentMessage',id:'official-assistant-id',text:'原始回答\n不改寫。',phase:'final_answer',delivery:null},...changes});
const completed=(status='completed')=>({threadId:ticket.sessionId,turn:{id:'turn-1',status}});
async function setup(extra={}){const calls=[],evidence=[];const adapter=await createCodexSharedAdapter({binding:controller,readBinding:reader,ticket,call:async value=>{calls.push(value);return {ok:true,context:{kind:'cmcp_host_time_context'}};},onEvidence:async value=>evidence.push(value),...extra});return {adapter,calls,evidence};}

test('official User admission precedes every visible assistant and final settlement',async()=>{
  const {adapter,calls,evidence}=await setup();await adapter.handleItemCompleted(user());
  await adapter.handleItemCompleted(answer({item:{...answer().item,id:'visible-comment',phase:'commentary',text:'前段可見文字'}}));
  await adapter.handleItemCompleted(answer());await adapter.handleTurnCompleted(completed());
  assert.deepEqual(calls.map(x=>x.request.operation),['receive','claim-turn','append-assistant','append-assistant','finish']);
  assert.equal(calls[0].request.args.text,user().item.content[0].text);assert.equal(calls[4].request.args.text,answer().item.text);
  assert.equal(calls[4].request.args.userMessageId,'official-user-id');assert.equal(calls[4].request.args.receivedAt,'2026-05-28T20:26:41.000Z');
  assert.equal(evidence.at(-1).coverage,'official_completed_agent_messages');
});
test('ignores reasoning without reading its content or recording evidence',async()=>{
  const {adapter,calls,evidence}=await setup();const item={type:'reasoning',get content(){throw Error('must_not_read');}};
  assert.deepEqual(await adapter.handleItemCompleted({...user(),item}),{ignored:true});assert.equal(calls.length,0);assert.equal(evidence.length,0);
});
test('model read is queued behind pending admission and uses only read credential',async()=>{
  const calls=[];let release;const barrier=new Promise(resolve=>{release=resolve;});
  const {adapter}=await setup({call:async value=>{calls.push(value);if(value.request.operation==='receive')await barrier;return {ok:true};}});
  const admission=adapter.handleItemCompleted(user());const read=adapter.tool({threadId:ticket.sessionId,turnId:'turn-1',callId:'call-1',namespace:null,tool:'cmcp_find_history',arguments:{}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);release();await Promise.all([admission,read]);
  assert.deepEqual(calls.map(x=>x.request.operation),['receive','claim-turn','find']);assert.equal(calls[2].role,'model_read');assert.equal(calls[2].connection.authFile,reader.connection.authFile);
});
test('wrong session and absent User admission never call broker',async()=>{
  const {adapter,calls}=await setup();await assert.rejects(adapter.handleItemCompleted(user({threadId:'another-session'})),/session_mismatch/);
  await assert.rejects(adapter.handleItemCompleted(answer()),/user_not_admitted/);assert.equal(calls.length,0);
});
test('same official item with changed body rejects; exact retry preserves requestId and time',async()=>{
  const {adapter,calls}=await setup();await adapter.handleItemCompleted(user());await adapter.handleItemCompleted(answer());await adapter.handleItemCompleted(answer());
  assert.deepEqual(calls[2].request,calls[3].request);
  await assert.rejects(adapter.handleItemCompleted(answer({item:{...answer().item,text:'changed'}})),/item_identity_conflict/);
});

test('local visible-message conflict latches failure; completed cancels and preserves committed prefix',async()=>{
  const {adapter,calls,evidence}=await setup();await adapter.handleItemCompleted(user());await adapter.handleItemCompleted(answer());
  await assert.rejects(adapter.handleItemCompleted(answer({item:{...answer().item,text:'changed'}})),/item_identity_conflict/);
  await adapter.handleTurnCompleted(completed());
  assert.deepEqual(calls.map(x=>x.request.operation),['receive','claim-turn','append-assistant','cancel']);
  assert.equal(calls.at(-1).request.args.userMessageId,'official-user-id');assert.equal(calls.at(-1).request.args.reason,'codex_partial_assistant_save');
  assert.equal(evidence.filter(x=>x.kind==='codex_shared_assistant_committed').length,1);assert.equal(evidence.some(x=>x.kind==='codex_shared_turn_finished'),false);
  assert.equal(evidence.at(-1).partial,true);assert.equal(evidence.at(-1).failureCode,'codex_shared_item_identity_conflict');
});

for(const [label,makeBad,error]of [
  ['missing_time',()=>answer({completedAtMs:null}),/missing_event_time/],
  ['invalid_text',()=>answer({item:{...answer().item,id:'invalid-text',text:''}}),/invalid_text/],
  ['async_delivery',()=>answer({item:{...answer().item,id:'async',delivery:'async'}}),/async_delivery_unsupported/],
  ['broker_failure',()=>answer({item:{...answer().item,id:'broker-rejected'}}),/synthetic_append_failure/]
])test('visible failure '+label+' cannot resume appending or finish a partial turn',async()=>{
  const calls=[],evidence=[];const {adapter}=await setup({call:async value=>{calls.push(value);if(value.request.args.messageId==='broker-rejected')throw Error('synthetic_append_failure');return {status:'stored'};},onEvidence:async row=>evidence.push(row)});
  await adapter.handleItemCompleted(user());await adapter.handleItemCompleted(answer());await assert.rejects(adapter.handleItemCompleted(makeBad()),error);
  const before=calls.length;await assert.rejects(adapter.handleItemCompleted(answer({item:{...answer().item,id:'later',text:'晚到可見文字'}})),/partial_assistant_save/);assert.equal(calls.length,before);
  await adapter.handleTurnCompleted(completed());assert.equal(calls.at(-1).request.operation,'cancel');assert.equal(calls.some(x=>x.request.operation==='finish'),false);assert.equal(evidence.at(-1).partial,true);
});

test('partial cancellation failure remains latched; retry cancels and next normal turn can finish',async()=>{
  const calls=[];let cancelFails=true;const {adapter}=await setup({call:async value=>{calls.push(value);if(value.request.operation==='cancel'&&cancelFails){cancelFails=false;throw Error('synthetic_cancel_failure');}return {status:'stored'};}});
  await adapter.handleItemCompleted(user());await adapter.handleItemCompleted(answer());await assert.rejects(adapter.handleItemCompleted(answer({item:{...answer().item,text:'conflict'}})),/identity_conflict/);
  await assert.rejects(adapter.handleTurnCompleted(completed()),/synthetic_cancel_failure/);await adapter.handleTurnCompleted(completed());assert.equal(calls.some(x=>x.request.operation==='finish'),false);
  await adapter.handleItemCompleted(user({turnId:'turn-2',item:{...user().item,id:'user-2'}}));
  await adapter.handleItemCompleted(answer({turnId:'turn-2',item:{...answer().item,id:'answer-2'}}));await adapter.handleTurnCompleted({threadId:ticket.sessionId,turn:{id:'turn-2',status:'completed'}});
  assert.equal(calls.at(-1).request.operation,'finish');assert.equal(calls.at(-1).request.args.userMessageId,'user-2');
});

test('an unrelated turn rejection does not poison the active turn',async()=>{
  const {adapter,calls}=await setup();await adapter.handleItemCompleted(user());await adapter.handleItemCompleted(answer());
  await assert.rejects(adapter.handleItemCompleted(answer({turnId:'other-turn'})),/user_not_admitted/);await adapter.handleTurnCompleted(completed());assert.equal(calls.at(-1).request.operation,'finish');
});

test('legacy Stop cannot bypass a failed visible-message latch',async()=>{
  const {adapter,calls,evidence}=await setup();await adapter.handleItemCompleted(user());await adapter.handleItemCompleted(answer());
  await assert.rejects(adapter.handleItemCompleted(answer({item:{...answer().item,text:'conflict'}})),/identity_conflict/);
  await adapter.handleHook({cwd:workspace,session_id:ticket.sessionId,turn_id:'turn-1',hook_event_name:'Stop',last_assistant_message:'新的最後短答'},{receivedAt:'2026-10-03T00:00:01.000Z'});
  assert.equal(calls.at(-1).request.operation,'cancel');assert.equal(calls.some(x=>x.request.operation==='finish'),false);assert.equal(evidence.at(-1).partial,true);
});

test('legacy Stop invalid time is latched before a later Stop can finish',async()=>{
  const {adapter,calls,evidence}=await setup(),common={cwd:workspace,session_id:ticket.sessionId,turn_id:'hook-turn'};
  await adapter.handleHook({...common,hook_event_name:'UserPromptSubmit',prompt:'official prompt'},{receivedAt:'2026-10-03T00:00:00.000Z'});
  await assert.rejects(adapter.handleHook({...common,hook_event_name:'Stop',last_assistant_message:'原可見文字'},{receivedAt:'invalid-time'}),/missing_event_time/);
  await adapter.handleHook({...common,hook_event_name:'Stop',last_assistant_message:'後來重試文字'},{receivedAt:'2026-10-03T00:00:01.000Z'});
  assert.equal(calls.at(-1).request.operation,'cancel');assert.equal(calls.some(x=>x.request.operation==='finish'),false);assert.equal(evidence.at(-1).failureCode,'codex_shared_missing_event_time');
});
test('incomplete turn cancels without falsely reporting final saved',async()=>{
  const {adapter,calls,evidence}=await setup();await adapter.handleItemCompleted(user());await adapter.handleItemCompleted(answer());await adapter.handleTurnCompleted(completed('interrupted'));
  assert.equal(calls.at(-1).request.operation,'cancel');assert.equal(evidence.at(-1).kind,'codex_shared_turn_cancelled');
});
test('completed turn without visible answer cancels and does not invent answer',async()=>{
  const {adapter,calls}=await setup();await adapter.handleItemCompleted(user());await adapter.handleTurnCompleted(completed());assert.equal(calls.at(-1).request.args.reason,'codex_no_visible_assistant');
});
test('bound workspace rejects child scope and unknown configuration keys',async()=>{
  await fs.mkdir(path.join(workspace,'child'));const {adapter,calls}=await setup();
  await assert.rejects(adapter.handleHook({hook_event_name:'UserPromptSubmit',cwd:path.join(workspace,'child'),session_id:ticket.sessionId,turn_id:'t',prompt:'x'}),/workspace_mismatch/);assert.equal(calls.length,0);
  await assert.rejects(validateBinding({...controller,config:'override'},'controller'),/invalid_schema/);
});
test('read args cannot carry controls, config, identity or role',async()=>{
  for(const args of [{epoch:'other'},{config:'other'},{role:'controller'},{sessionId:'other'}])await assert.rejects(readTool({binding:reader,ticket,operation:'find',args,call:()=>assert.fail()}),/invalid_schema/);
  await assert.rejects(readTool({binding:reader,ticket,operation:'handoff',args:{},call:()=>assert.fail()}),/operation_denied/);
  await assert.rejects(readTool({binding:reader,ticket:{...ticket,enabled:false},operation:'find',args:{},call:()=>assert.fail()}),/session_not_enabled/);
});
test('stale broker epoch error remains fatal and no synthetic success is returned',async()=>{
  const {adapter}=await setup({call:async()=>{throw Error('shared_project_epoch_stale');}});await assert.rejects(adapter.handleItemCompleted(user()),/shared_project_epoch_stale/);
});
test('Hook Stop saves only last_assistant_message with explicit weaker coverage',async()=>{
  const {adapter,calls,evidence}=await setup();const common={cwd:workspace,session_id:ticket.sessionId,turn_id:'hook-turn'};
  await adapter.handleHook({...common,hook_event_name:'UserPromptSubmit',prompt:'official prompt'},{receivedAt:'2026-10-03T00:00:00.000Z'});
  await adapter.handleHook({...common,hook_event_name:'Stop',last_assistant_message:'official final only'},{receivedAt:'2026-10-03T00:00:01.000Z'});
  assert.deepEqual(calls.map(x=>x.request.operation),['receive','claim-turn','finish']);assert.equal(evidence.at(-1).coverage,'Stop_last_assistant_message_only');
});
test('CLI rejects config flags before loading any binding',async()=>{
  let error='';const code=await runReadCli({bindingFile:'missing',ticketFile:'missing',argv:['find','--config','other'],stdin:Readable.from([]),stdout:{write:()=>assert.fail()},stderr:{write:value=>{error+=value;}}});assert.equal(code,1);assert.equal(error,'codex_shared_read_usage\n');
});
test('dynamic tool surface contains only the four formal read functions',()=>{
  assert.equal(dynamicTools.length,4);for(const tool of dynamicTools){assert.equal(tool.type,'function');assert.equal(tool.inputSchema.additionalProperties,false);}
});
