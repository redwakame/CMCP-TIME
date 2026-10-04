import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {createCmcpReactivationStores,createCmcpTemporalSourceCatalog,createCmcpHistoryReactivation,readCmcpHistoryReactivationStatus} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {REACTIVATION_FIXTURE as F,seedCmcpReactivationFixture} from './cmcp-history-reactivation-fixtures.mjs';
import {createCmcpBoundedProviderAdapter,boundedProviderProtocolHash} from '../src/cmcp-guard/cmcp-bounded-provider-adapter.js';
import {createLocalLoopJournal,loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {reserveModelJob} from '../src/cmcp-guard/cmcp-model-job-budget.js';
const root=path.resolve(process.env.CMCP_REACTIVATION_TEST_ROOT??'');assert.ok(path.relative(process.cwd(),root)&&!path.relative(process.cwd(),root).startsWith('..'));await fs.mkdir(root);
const seedRoot=path.join(root,'seed'),seed=await seedCmcpReactivationFixture(seedRoot);let passed=0,failed=0;
const results=[];async function test(name,fn){try{await fn();passed++;results.push({name,status:'PASS'});console.log('PASS '+name);}catch(error){failed++;results.push({name,status:'FAIL',error:error.message});console.error('FAIL '+name+'\n'+error.stack);}}
const ordinary={text:'離線一般回答',sourceRefs:[]},selectedAnswer={text:'已完成；以下引用選定來源。',sourceRefs:['r1'],evidenceStatus:'sufficient'};
async function setup(name,select=()=>({status:'selected',refs:['c1'],clarification:''}),options={}){
 const dir=path.join(root,name);await fs.cp(seedRoot,dir,{recursive:true});
 const stores=createCmcpReactivationStores({root:dir,scopeId:F.scopeId}),reads=[],calls=[];
 const original=stores.history;stores.history={...original,resolve:async pointer=>{reads.push(pointer.itemId);return original.resolve(pointer);}};
 const adapter={async request(purpose,input){calls.push({purpose,input:structuredClone(input)});
  if(purpose==='recall_select'){assert.equal(reads.length,0,'routing must only read index');return {value:await select(input)};}
  return {value:input.context?selectedAnswer:ordinary};}};
 const component=createCmcpHistoryReactivation({stores,allowedSourceIds:seed.allowedSourceIds,limits:{...F.limits,...options},adapter});
 return {stores,component,reads,calls,dir,adapter};
}
const submit=ctx=>ctx.component.submit({text:F.question,timeContext:F.timeContext});
async function snapshot(dir){const out={};async function walk(p){for(const e of await fs.readdir(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())await walk(f);else out[path.relative(dir,f)]=loopHash(await fs.readFile(f,'utf8'));}}await walk(dir);return out;}
await test('catalog_has_two_events_general_chat_times_locations_no_body_or_buffer',async()=>{
 const stores=createCmcpReactivationStores({root:seedRoot,scopeId:F.scopeId}),state=await readCmcpHistoryReactivationStatus({stores,maxEntries:8});
 assert.equal(state.catalog.length,5);assert.equal(state.events.length,2);assert.deepEqual(state.focus.buffer,[]);
 const serialized=JSON.stringify(state.catalog);for(const source of F.sources)assert.ok(!serialized.includes(source.body));
 assert.ok(state.catalog.every(entry=>entry.messageRecordedAt&&entry.location.end>0&&entry.eventOccurredAt===null));
});
await test('natural_query_routes_resolves_activates_only_selected_source_preserving_completed_event',async()=>{
 const ctx=await setup('normal'),before=await snapshot(path.join(ctx.dir,'event')),originalHistory=await snapshot(path.join(ctx.dir,'history'));
 const result=await submit(ctx);assert.equal(result.status,'answered');assert.deepEqual(ctx.reads,['morning-season-plan']);
 assert.deepEqual(result.bufferBefore,[]);assert.equal(result.bufferAfter.length,1);assert.equal(result.proactiveEligible,false);
 assert.equal(result.activeAt,'2026-09-14T07:20:00.000Z');assert.equal(result.sourceBytes,Buffer.byteLength(F.sources[0].body));assert.ok(result.projectionBytes<=8000);
 const projection=JSON.parse(result.modelContext);assert.equal(projection.events[0].currentClaims[0].text,F.assertions.completed);
 assert.equal(projection.evidence[0].time.elapsedSinceMessageMs,21600000);assert.equal(projection.evidence[0].time.eventOccurredAt,null);
 assert.deepEqual(await snapshot(path.join(ctx.dir,'event')),before);
 const afterHistory=await snapshot(path.join(ctx.dir,'history'));for(const [file,hash] of Object.entries(originalHistory))assert.equal(afterHistory[file],hash);
 assert.ok(!JSON.stringify(result.bufferAfter).includes(F.sources[0].body));
 for(const source of F.sources)assert.ok(!JSON.stringify(ctx.calls[0].input).includes(source.body));
 for(const source of F.sources.slice(1))assert.ok(!JSON.stringify(ctx.calls[1].input).includes(source.body));
 assert.ok(!JSON.stringify(ctx.calls[1].input).includes('storage'));assert.ok(!JSON.stringify(ctx.calls[1].input).includes(seed.entries[0].pointer.itemId));
 await fs.writeFile(path.join(root,'normal-evidence.json'),JSON.stringify({result,calls:ctx.calls,reads:ctx.reads},null,2),{flag:'wx'});
});
await test('paraphrases_and_minor_typo_reach_same_semantic_seam_without_literal_router',async()=>{
 for(const [i,text] of ['早上那個節慶活動最後決定怎麼收單？','先前中秋檔期的交付決策是什麼？','中秌銷售那份方案之前怎麼定的？'].entries()){
  const ctx=await setup('rewrite-'+i),r=await ctx.component.submit({text,timeContext:F.timeContext});assert.equal(ctx.calls[0].input.question,text);assert.deepEqual(r.selected,[seed.entries[0].id]);
 }
});
await test('genuinely_ambiguous_no_source_read_no_activation_no_answer_call',async()=>{
 const ctx=await setup('ambiguous',()=>({status:'needs_clarification',refs:[],clarification:'是銷售活動還是網站改版？'}));
 const r=await ctx.component.submit({text:'那個方案後來怎麼定的？',timeContext:F.timeContext});assert.equal(r.status,'needs_clarification');assert.deepEqual(ctx.reads,[]);assert.equal(ctx.calls.length,1);
 assert.deepEqual((await readCmcpHistoryReactivationStatus({stores:ctx.stores,maxEntries:8})).focus.buffer,[]);
});
await test('different_event_and_general_assistant_source_not_turned_into_user_fact',async()=>{
 for(const [name,ref,item,role] of [['other','c2','morning-web-project','user'],['general','c4','chat-reply','assistant']]){
  const ctx=await setup(name,()=>({status:'selected',refs:[ref],clarification:''})),r=await submit(ctx),model=JSON.parse(r.modelContext);
  assert.deepEqual(ctx.reads,[item]);assert.equal(model.evidence[0].source.sourceAuthorRole,role);if(role==='assistant')assert.deepEqual(model.events,[]);
 }
});
await test('disabled_clean_question_only_transport_no_lookup_buffer_change_but_new_sources_preserved',async()=>{
 for(const clean of [false,true]){
  const ctx=await setup('off-'+clean),before=await snapshot(ctx.dir),captured=[];
  const batchRoot=path.join(root,'off-transport-'+clean),manifest={profile:'history-reactivation-v1',protocolHash:boundedProviderProtocolHash('history-reactivation-v1'),taskBudget:{root:path.join(batchRoot,'total'),maxPosts:10}};
  const transport=createCmcpBoundedProviderAdapter({deepseekKey:'offline-dummy',ledgerRoot:path.join(batchRoot,'attempts'),manifest,
   fetchImpl:async(url,init)=>{captured.push(JSON.parse(init.body));return new Response(JSON.stringify({id:'offline',model:'deepseek-flash',status:'completed',usage:{},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(ordinary)}]}]}),{status:200});}});
  const core=createCmcpHistoryReactivation({stores:ctx.stores,allowedSourceIds:seed.allowedSourceIds,limits:F.limits,adapter:transport});core.setControls({enabled:clean,clean});
  const r=await core.submit({text:'今天聊點別的',timeContext:F.timeContext});assert.equal(r.modelContext,'');assert.deepEqual(ctx.reads,[]);
  const after=await snapshot(ctx.dir);for(const [file,hash] of Object.entries(before))assert.equal(after[file],hash);
  const historyPrefix='history'+path.sep;
  assert.equal(Object.keys(after).filter(file=>file.startsWith(historyPrefix)).length,Object.keys(before).filter(file=>file.startsWith(historyPrefix)).length+2);
  const timingRows=(await createLocalLoopJournal({root:path.join(ctx.dir,'focus'),name:'local-focus-v1'}).read()).filter(row=>row.record.kind==='assistant_timing');
  assert.equal(timingRows.length,1);assert.equal(timingRows[0].record.value.answerPointer.itemId,r.answerPointer.itemId);
  assert.deepEqual((await readCmcpHistoryReactivationStatus({stores:ctx.stores,maxEntries:8})).focus.buffer,[]);
  assert.equal((await ctx.stores.history.resolve(r.queryPointer)).evidence.content.body,'今天聊點別的');
  assert.equal((await ctx.stores.history.resolve(r.answerPointer)).evidence.sourceAuthorRole,'assistant');
  assert.deepEqual(JSON.parse(captured[0].input[0].content),{question:'今天聊點別的'});assert.ok(!JSON.stringify(captured[0]).includes(F.sources[0].title));transport.dispose();
 }
});
await test('turning_off_during_selection_prevents_resolution_and_activation',async()=>{
 let release,entered;const ready=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
 const ctx=await setup('cancel',async()=>{entered();await wait;return {status:'selected',refs:['c1'],clarification:''};});
 const pending=submit(ctx);await ready;ctx.component.setControls({enabled:false,clean:false});release();await assert.rejects(pending,/cancelled/);assert.deepEqual(ctx.reads,[]);
 assert.deepEqual((await readCmcpHistoryReactivationStatus({stores:ctx.stores,maxEntries:8})).focus.buffer,[]);
});
await test('unavailable_changed_or_ungranted_source_not_replaced_by_index_summary',async()=>{
 const bad=await setup('bad-ref',()=>({status:'selected',refs:['c99'],clarification:''}));await assert.rejects(submit(bad),/schema|scope/);assert.deepEqual(bad.reads,[]);
 const ctx=await setup('missing');ctx.stores.history.resolve=async pointer=>({status:'missing',pointer});assert.equal((await submit(ctx)).status,'source_unavailable');assert.equal(ctx.calls.length,1);
});
await test('budgets_fail_without_truncating_or_reading_other_sources',async()=>{
 const catalog=await setup('small-index',undefined,{maxCatalogBytes:10});await assert.rejects(submit(catalog),/catalog_projection_budget/);assert.equal(catalog.calls.length,0);
 const source=await setup('small-source',undefined,{maxSourceBytes:10});await assert.rejects(submit(source),/source_budget/);assert.equal(source.calls.length,1);
 const projection=await setup('small-projection',undefined,{maxProjectionBytes:10});await assert.rejects(submit(projection),/oversize/);assert.equal(projection.calls.length,1);
});
await test('reopen_status_and_background_reads_do_not_refresh_or_reopen_completion',async()=>{
 const ctx=await setup('reopen');await submit(ctx);const before=await snapshot(ctx.dir),state=await readCmcpHistoryReactivationStatus({stores:ctx.stores,maxEntries:8});
 const reopened=createCmcpReactivationStores({root:ctx.dir,scopeId:F.scopeId});assert.deepEqual(await readCmcpHistoryReactivationStatus({stores:reopened,maxEntries:8}),state);assert.deepEqual(await snapshot(ctx.dir),before);
 assert.equal(state.events[0].progress.currentClaims[0].text,F.assertions.completed);assert.equal(state.pinMutation,'none');assert.equal(state.focus.proactiveEligible,false);
});
await test('repeated_user_question_refreshes_only_selected_attention_no_duplicate_buffer',async()=>{
 const ctx=await setup('repeat');await submit(ctx);ctx.reads.length=0;
 const r=await ctx.component.submit({text:'交付安排再確認一下',timeContext:{now:'2026-09-14T16:00:00+08:00',timezone:'Asia/Taipei'}});
 assert.equal(r.bufferAfter.length,1);assert.equal(r.bufferAfter[0].activatedAt,'2026-09-14T08:00:00.000Z');assert.equal(JSON.parse(r.modelContext).evidence[0].time.messageRecordedAt,'2026-09-14T01:20:00.000Z');
});
await test('ten_post_budget_cannot_reset_by_phase_provider_or_reopen',async()=>{
 const config={root:path.join(root,'ten-budget'),policy:'history-reactivation-v1',purpose:'offline'};
 for(let i=0;i<10;i++)await reserveModelJob({...config,phase:i<7?'main':'recall',provider:i%2?'deepseek':'groq'});
 await assert.rejects(()=>reserveModelJob({...config,phase:'recall',provider:'deepseek'}),/budget/);
});
await test('catalog_duplicate_conflict_and_wrong_event_scope_do_not_rewrite_sources',async()=>{
 const ctx=await setup('registration'),catalog=createCmcpTemporalSourceCatalog({stores:ctx.stores,maxEntries:8}),entry=seed.entries[0];
 const input={pointer:entry.pointer,title:entry.title,synopsis:entry.synopsis.text,eventLink:entry.eventLink};
 assert.equal((await catalog.register(input)).status,'unchanged');await assert.rejects(()=>catalog.register({...input,synopsis:'不同判讀'}),/conflict/);
 await assert.rejects(()=>catalog.register({...input,eventLink:{...entry.eventLink,event:{scopeId:'outside',eventId:'bad'}}}),/scope/);
});
await fs.writeFile(path.join(root,'summary.json'),JSON.stringify({passed,failed,actualModelPosts:0,semanticFixturesNotModelValidation:true,results},null,2),{flag:'wx'});
console.log(JSON.stringify({passed,failed,actualModelPosts:0}));process.exitCode=failed?1:0;
