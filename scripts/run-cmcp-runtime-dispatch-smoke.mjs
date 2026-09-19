// Formal local History/catalog/journals plus synthetic event state and model/delivery substitutes. Zero model calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCmcpRuntimeDispatch} from '../src/cmcp-guard/cmcp-runtime-dispatch.js';
import {createCmcpReactivationStores,createCmcpTemporalSourceCatalog} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {createCmcpFeatureControls} from '../src/cmcp-guard/cmcp-feature-controls.js';
import {createLocalLoopJournal,loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {buildCmcpEventView} from '../src/cmcp-guard/cmcp-event-lineage.js';
import {createCmcpSourceEvidence} from '../src/cmcp-guard/cmcp-source-evidence.js';
import {createCmcpPinLifecycle} from '../src/cmcp-guard/cmcp-pin-lifecycle.js';
import {cmcpSourcePointerKey} from '../src/cmcp-guard/cmcp-source-pointer.js';
import {cmcpDispatchProgressKey} from '../src/cmcp-guard/cmcp-dispatch-arbitration.js';
const repo=fileURLToPath(new URL('../',import.meta.url)),allowed=path.join(repo,'logs/public-tests'),root=path.resolve(process.env.CMCP_RUNTIME_DISPATCH_TEST_ROOT??path.join(allowed,'runtime-dispatch-'+randomUUID()));
const relative=path.relative(allowed,root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Tests require a new candidate-local logs/public-tests directory.');await fs.mkdir(path.dirname(root),{recursive:true});await fs.mkdir(root);
const results=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<120;i++){if(await check())return;await sleep(20);}throw Error('offline_timer_wait_exceeded');}
async function test(name,run){try{await run();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',error:error.stack});}}
async function fixture(name,{buffer=false,slow=false,fixedNow=null,dueAt=null,timeoutMs=90000}={}){
 const dir=path.join(root,name),scopeId='synthetic-dispatch',event={scopeId,eventId:'synthetic-event'},timezone='UTC';
 const journal=createLocalLoopJournal({root:path.join(dir,'input-journal'),name:'cmcp-common-input-v1'});await journal.append('binding',{version:1,scopeId,fixture:true});
 const stores=createCmcpReactivationStores({root:dir,scopeId}),catalog=createCmcpTemporalSourceCatalog({stores,maxEntries:16});
 const clock=()=>typeof fixedNow==='function'?fixedNow():fixedNow??new Date().toISOString();
 const text='The review is unfinished and I want to continue it.',at=clock();
 const source=createCmcpSourceEvidence({pointer:{version:1,providerNamespace:'cmcp-local-console-v1',scopeId,sessionId:'offline-session',itemId:'user-1',revisionId:'r1'},
 sourceKind:'message',sourceAuthorRole:'user',messageRecordedAt:at,eventOccurredAt:null,content:{kind:'source_excerpt',body:text},metadata:{availability:'partial'}});
 await stores.history.writeEvidence(source);const entry=(await catalog.registerSource({pointer:source.pointer})).entry;
 const due=dueAt??new Date(Date.now()+500).toISOString(),state={key:'e',status:'found',event,eventVersion:loopHash([]),lastUserAt:at,expiry:due,pending:[],sends:[],
  dialogue:{status:'open',synopsis:'Continue the unfinished review.',supports:[{pointer:source.pointer,evidenceHash:loopHash(source),citation:{unit:'unicode_code_points',start:0,end:[...text].length,text}}]}};
 const counts={generated:0,presented:0,saved:0,runWork:0};let release,delayed=slow?new Promise(r=>release=r):null,lastInput=null;
 const manager=createCmcpFeatureControls({root:dir,scopeId});let update=0;
 const change=patch=>manager.update({updateId:'change-'+(++update),patch,timeContext:{now:clock(),timezone}});
 const core={sessionId:'offline-session',history:stores.history,catalog,
  stores:{...stores,eventStore:()=>({readEvent:async()=>({status:'found',view:buildCmcpEventView(event,[]),internal:{records:[],checks:[]}})})},
  status:async()=>({events:[structuredClone(state)]}),
  bufferList:async()=>{const expired=Date.parse(clock())>=Date.parse(due),item={kind:'proactive_focus',eventKey:'e',event,generation:0,reason:expired?'expired':'active'};
   return {generation:0,items:buffer&&!expired?[item]:[],retained:buffer&&expired?[item]:[]};},
  ingest:async input=>{counts.saved++;const evidence={pointer:input.pointer,sourceKind:'message',sourceAuthorRole:input.role,messageRecordedAt:input.messageRecordedAt,
   eventOccurredAt:null,content:{kind:'source_excerpt',body:input.text}};const result=await stores.history.writeEvidence(evidence);await catalog.registerSource({pointer:input.pointer});return {...result,pointer:input.pointer};}};
 const options={root:dir,scopeId,timezone,clock,timeoutMs,events:[{key:'e',event,objects:[{objectId:'review',aspects:['progress']}]}],core,controlManager:manager,
  adapter:{request:async(purpose,input,{canAttempt})=>{await canAttempt();counts.generated++;lastInput=input;if(delayed)await delayed;return {value:{text:'A synthetic bounded continuation.'}};}},
  runWork:async run=>{counts.runWork++;return run();},delivery:{present:async()=>{counts.presented++;return {status:'presented'};}}};
 const make=()=>createCmcpRuntimeDispatch(options),dispatch=make();
 const action={kind:'callable_authorization',authorized:true,scopeId};
 return {dir,journal,source,entry,state,counts,change,dispatch,make,due,action,scopeId,core,options,setNow:value=>{fixedNow=value;},release:()=>release?.(),lastInput:()=>lastInput,
  pin:async(extra={})=>dispatch.pinCreate({updateId:'create-p1',pinId:'p1',sourceIds:[entry.id],dueAt:due,userAction:action,...extra})};
}
await test('OFF_and_no_schedule_zero_generation_status_zero_API',async()=>{
 const f=await fixture('off');try{await f.pin({dueAt:null});await sleep(40);assert.equal((await f.dispatch.status()).timerScheduled,false);await f.change({proactive:true});await f.dispatch.refresh();await sleep(40);assert.equal(f.counts.generated,0);}finally{await f.dispatch.close();}
});
await test('real_timer_source_pin_generate_save_present_once_then_reopen_deduplicates',async()=>{
 const f=await fixture('pin');try{await f.change({proactive:true});await f.pin();await until(async()=>(await f.dispatch.status()).lastResult?.status==='presented');const status=await f.dispatch.status();assert.equal(status.lastResult.status,'presented');
 assert.equal(f.counts.saved,1);assert.equal(f.counts.runWork,1);assert.equal(f.lastInput().selectedSources[0].content.body,f.source.content.body);assert.equal(f.lastInput().selectedSources[0].eventOccurredAt,null);
 await f.dispatch.refresh();await sleep(50);assert.equal(f.counts.generated,1);}finally{await f.dispatch.close();}
 const next=f.make();try{await next.refresh();await sleep(40);assert.equal(f.counts.generated,1);assert.equal((await next.pinList()).pins[0].status,'active');}finally{await next.close();}
});
await test('buffer_due_token_and_same_event_pin_share_durable_progress_key',async()=>{
 const f=await fixture('both',{buffer:true});try{await f.change({proactive:true});await f.pin({sourceIds:undefined,eventKey:'e'});await until(()=>f.counts.presented===1);await f.dispatch.refresh();await sleep(50);
 assert.equal(f.counts.generated,1);assert.equal((await f.dispatch.status()).arbitration.records.filter(row=>row.kind==='dispatch_reserved').length,1);}finally{await f.dispatch.close();}
});
await test('source_Pin_exact_formal_focus_membership_uses_shared_event_identity',async()=>{
 const f=await fixture('source-event',{buffer:true});try{
  const list=f.core.catalog.list;f.core.catalog={...f.core.catalog,list:async()=>(await list()).map(row=>({...row,eventScope:f.state.event}))};
  // The dispatcher's injected core reference stays identical; only the offline catalog fixture gains a verified association.
  await f.change({proactive:true});const created=await f.pin();assert.deepEqual(created.pin.target,{eventId:f.state.event.eventId});
  await until(()=>f.counts.presented===1);await f.dispatch.refresh();await sleep(40);assert.equal(f.counts.generated,1);
 }finally{await f.dispatch.close();}
});
await test('new_User_cancels_slow_generation_late_result_cannot_present',async()=>{
 const f=await fixture('cancel',{slow:true});try{await f.change({proactive:true});await f.pin();await until(()=>f.counts.generated===1);f.dispatch.interrupt('new_user');f.release();await until(async()=>!(await f.dispatch.status()).generating);
 assert.equal(f.counts.presented,0);assert.equal(f.counts.saved,0);}finally{f.release();await f.dispatch.close();}
});
await test('Clear_during_Pin_generation_does_not_cancel_independent_Pin',async()=>{
 const f=await fixture('clear-pin',{slow:true});try{await f.change({proactive:true});await f.pin();await until(()=>f.counts.generated===1);
 await f.journal.append('buffer_clear',{scopeId:f.scopeId,generation:1,clearedAt:new Date().toISOString()});f.dispatch.interrupt('buffer_clear');f.release();await until(()=>f.counts.presented===1);
 assert.equal((await f.dispatch.pinList()).pins[0].status,'active');}finally{f.release();await f.dispatch.close();}
});
await test('explicit_complete_stops_slow_Pin_and_save_OFF_does_not_store_body',async()=>{
 const f=await fixture('complete',{slow:true});try{await f.change({proactive:true,saveAssistant:false});await f.pin();await until(()=>f.counts.generated===1);
 await f.dispatch.pinChange({updateId:'done',pinId:'p1',expectedRevision:1,action:'complete',userAction:f.action});f.release();await until(async()=>!(await f.dispatch.status()).generating);
 assert.equal(f.counts.presented,0);assert.equal(f.counts.saved,0);assert.equal((await f.dispatch.pinList()).pins[0].status,'completed');}finally{f.release();await f.dispatch.close();}
 const g=await fixture('save-off');try{await g.change({proactive:true,saveAssistant:false});await g.pin();await until(async()=>(await g.dispatch.status()).lastResult?.status==='presented');assert.equal(g.counts.saved,0);assert.equal((await g.dispatch.status()).lastResult.receipt.storage,'disabled');}finally{await g.dispatch.close();}
});
await test('wrong_scope_unknown_source_and_changed_dialogue_fail_closed',async()=>{
 const f=await fixture('guards',{buffer:true});try{
 await assert.rejects(f.pin({userAction:{...f.action,scopeId:'other'}}),/explicit_scoped_user_action/);await assert.rejects(f.pin({sourceIds:['unknown']}),/outside_catalog/);
 f.state.dialogue.status='closed';f.state.dialogue.supports[0].citation.text='not the saved source';await assert.rejects(f.pin({sourceIds:undefined,eventKey:'e'}),/dialogue_source_mismatch/);
 await f.change({proactive:true});await f.dispatch.refresh();await sleep(50);assert.equal(f.counts.generated,0);}finally{await f.dispatch.close();}
});

await test('DND_ending_before_Buffer_due_retains_a_reassessment_timer',async()=>{
 const f=await fixture('dnd-future',{buffer:true,fixedNow:'2026-09-18T03:30:00Z',dueAt:'2026-09-18T05:00:00Z'});try{
 await f.change({proactive:true,doNotDisturb:{enabled:true,timezone:'UTC',windows:[{start:'03:00',end:'04:00'}]}});
 await f.dispatch.refresh();assert.equal(f.counts.generated,0);assert.equal((await f.dispatch.status()).timerScheduled,true,'valid future Buffer lost timer solely because DND is active now');
 }finally{await f.dispatch.close();}
});

await test('DND_ending_less_than_one_minute_before_due_still_checks_and_presents_once',async()=>{
 const start=performance.now(),epoch=Date.parse('2026-09-18T00:00:59.750Z');
 const f=await fixture('dnd-imminent-end',{buffer:true,fixedNow:()=>new Date(epoch+performance.now()-start).toISOString(),dueAt:'2026-09-18T00:01:00.500Z'});
 try{await f.change({proactive:true,doNotDisturb:{enabled:true,timezone:'UTC',windows:[{start:'00:00',end:'00:01'}]}});
 await f.dispatch.refresh();await until(()=>f.counts.presented===1);assert.equal(f.counts.generated,1);
 }finally{await f.dispatch.close();}
});

await test('DND_covering_Buffer_due_blocks_and_does_not_extend_expired_candidate',async()=>{
 const start=performance.now(),epoch=Date.parse('2026-09-18T00:00:00.000Z');
 const f=await fixture('dnd-at-due',{buffer:true,fixedNow:()=>new Date(epoch+performance.now()-start).toISOString(),dueAt:'2026-09-18T00:00:00.500Z'});
 try{await f.change({proactive:true,doNotDisturb:{enabled:true,timezone:'UTC',windows:[{start:'00:00',end:'00:01'}]}});
 await f.dispatch.refresh();await until(async()=>(await f.dispatch.status()).lastResult?.reason==='do_not_disturb');assert.equal(f.counts.generated,0);
 await f.change({doNotDisturb:{enabled:false,timezone:'UTC',windows:[]}});await f.dispatch.refresh();await sleep(50);
 assert.equal(f.counts.generated,0);assert.equal((await f.dispatch.status()).timerScheduled,false);assert.equal(f.state.expiry,f.due);
 }finally{await f.dispatch.close();}
});

await test('Clear_during_Pin_source_validation_before_generation_does_not_cancel_Pin',async()=>{
 const f=await fixture('clear-pin-validation');let releaseValidation,entered=false,hold;
 try{await f.change({proactive:true});await f.pin();
 const original=f.core.history.resolve.bind(f.core.history);f.core.history={...f.core.history,resolve:async pointer=>{
 const reserved=(await f.journal.read()).some(row=>row.record.kind==='dispatch_reserved');
 if(reserved&&!entered){entered=true;hold=new Promise(resolve=>releaseValidation=resolve);await hold;}return original(pointer);}};
 await until(()=>entered);await f.journal.append('buffer_clear',{scopeId:f.scopeId,generation:1,clearedAt:new Date().toISOString()});
 f.dispatch.interrupt('buffer_clear');releaseValidation();await until(async()=>!(await f.dispatch.status()).generating);
 assert.equal(f.counts.generated,1);assert.equal(f.counts.presented,1);
 }finally{releaseValidation?.();await f.dispatch.close();}
});

await test('new_control_between_generation_and_save_prevents_save_and_presentation',async()=>{
 const f=await fixture('late-control',{slow:true});try{await f.change({proactive:true});await f.pin();await until(()=>f.counts.generated===1);
 await f.change({proactive:false});f.release();await until(async()=>!(await f.dispatch.status()).generating);
 assert.equal(f.counts.saved,0);assert.equal(f.counts.presented,0);
 }finally{f.release();await f.dispatch.close();}
});

await test('control_change_during_Assistant_save_prevents_local_presentation',async()=>{
 const f=await fixture('save-race');try{const original=f.core.ingest;f.core.ingest=async input=>{const result=await original(input);await f.change({proactive:false});return result;};
 await f.change({proactive:true});await f.pin();await until(async()=>(await f.dispatch.status()).lastResult!==null);
 assert.equal(f.counts.saved,1);assert.equal(f.counts.presented,0);assert.equal((await f.dispatch.status()).lastResult.status,'presentation_unknown');
 }finally{await f.dispatch.close();}
});

await test('generation_deadline_does_not_publish_late_result_or_retry_progress',async()=>{
 // Test-only clock and timer control. Keep the 30ms deadline and every safety
 // assertion, but do not require filesystem validation to finish in real 30ms.
 // Other cases above/below continue to exercise real Node timers.
 const start=Date.parse('2026-01-01T10:00:00.000Z');let virtual=start,nextId=0;
 const f=await fixture('deadline',{slow:true,timeoutMs:30,fixedNow:new Date(start).toISOString(),dueAt:new Date(start).toISOString()});
 const nativeSet=globalThis.setTimeout,nativeClear=globalThis.clearTimeout,pending=new Map();
 const realPause=ms=>new Promise(resolve=>nativeSet(resolve,ms));
 function pump(){
  // Fire only already-due callbacks. Async dispatch work is allowed to settle
  // via realPause; virtual time advances only when explicitly requested below.
  for(const [handle,job]of [...pending])if(job.at<=virtual){pending.delete(handle);job.callback(...job.args);}
 }
 async function waitFor(check){
  for(let i=0;i<500;i++){pump();if(await check())return;await realPause(10);}
  throw Error('controlled_deadline_condition_not_reached');
 }
 globalThis.setTimeout=(callback,delay=0,...args)=>{
  assert.equal(typeof callback,'function');
  const handle={id:++nextId,ref(){return this;},unref(){return this;},hasRef(){return false;}};
  pending.set(handle,{at:virtual+Math.max(0,Number(delay)||0),callback,args});return handle;
 };
 globalThis.clearTimeout=handle=>{if(!pending.delete(handle))nativeClear(handle);};
 try{
  await f.change({proactive:true});await f.pin();
  // The normal scheduler arms a minimum 1ms wake-up even when already due.
  virtual=start+1;f.setNow(new Date(virtual).toISOString());pump();
  await waitFor(()=>f.counts.generated===1);
  assert.equal(f.counts.saved,0);assert.equal(f.counts.presented,0);
  assert.ok([...pending.values()].some(job=>job.at===virtual+30),'30ms deadline must be armed');
  virtual+=31;f.setNow(new Date(virtual).toISOString());pump();
  await waitFor(async()=>!(await f.dispatch.status()).generating);
  f.release();await realPause(30);
  assert.equal(f.counts.saved,0);assert.equal(f.counts.presented,0);
  await f.dispatch.refresh();pump();await realPause(30);
  assert.equal(f.counts.generated,1,'same progress must not be retried');
  assert.equal(f.counts.saved,0);assert.equal(f.counts.presented,0);
 }finally{
  f.release();
  try{await f.dispatch.close();}finally{pending.clear();globalThis.setTimeout=nativeSet;globalThis.clearTimeout=nativeClear;}
 }
});
async function addPending(f,{current=false,eventProcessing='committed',remaining=[],secondsBefore=60}={}){
 let source=f.source;
 if(!current){source=createCmcpSourceEvidence({...f.source,pointer:{...f.source.pointer,itemId:'older-pending'},
  messageRecordedAt:new Date(Date.parse(f.source.messageRecordedAt)-secondsBefore*1000).toISOString(),
  content:{kind:'source_excerpt',body:'An earlier discussion with uncertain continuation.'}});
  await f.core.history.writeEvidence(source);await f.core.catalog.registerSource({pointer:source.pointer});}
 f.state.pending.push({pointer:source.pointer,processing:{pointer:source.pointer,eventProcessing,dialogueProcessing:'pending',remaining}});
 return structuredClone(f.state.pending);
}
await test('old_committed_dialogue_pending_outside_new_supported_focus_does_not_block_or_disappear',async()=>{
 const f=await fixture('old-dialogue-pending',{buffer:true});try{
 const before=await addPending(f);await f.change({proactive:true});await f.dispatch.refresh();
 await until(async()=>(await f.dispatch.status()).lastResult?.status==='presented');
 assert.equal(f.counts.generated,1);assert.deepEqual(f.state.pending,before);assert.equal(f.state.dialogue.status,'open');
 }finally{await f.dispatch.close();}
});
await test('current_supported_source_pending_uncommitted_facts_and_remaining_conditions_still_block',async()=>{
 for(const [name,options]of [['same',{current:true}],['facts',{eventProcessing:'pending'}],['conditions',{remaining:[{reason:'unhandled_condition'}]}],['later',{secondsBefore:-60}]]){
 const f=await fixture('blocked-pending-'+name,{buffer:true});try{
 const before=await addPending(f,options);await f.change({proactive:true});const result=await f.dispatch.refresh();
 assert.equal(result.status,'idle',name);assert.equal((await f.dispatch.status()).timerScheduled,false,name);
 // Pending still blocks Buffer; a new explicit independent Pin is a separate user authorization.
 assert.equal(f.counts.generated,0,name);assert.deepEqual(f.state.pending,before,name);
 }finally{await f.dispatch.close();}}
});
async function secondSource(f,revisionId='r1'){
 const source=createCmcpSourceEvidence({...f.source,pointer:{...f.source.pointer,itemId:'second-source',revisionId},
  content:{kind:'source_excerpt',body:'A second exact authorized source for this Pin.'}});
 await f.core.history.writeEvidence(source);const entry=(await f.core.catalog.registerSource({pointer:source.pointer})).entry;return {source,entry};
}
await test('source_set_order_does_not_create_second_model_or_presentation_but_revision_remains_distinct',async()=>{
 const f=await fixture('pin-set-order');try{
 const second=await secondSource(f);await f.change({proactive:true});
 const first=await f.pin({sourceIds:[f.entry.id,second.entry.id]});await until(()=>f.counts.presented===1);
 const reverse=await f.dispatch.pinCreate({updateId:'reverse-new',pinId:'reverse',sourceIds:[second.entry.id,f.entry.id],dueAt:new Date().toISOString(),userAction:f.action});
 assert.deepEqual(first.pin.target,reverse.pin.target);assert.equal(first.pin.progressVersion,reverse.pin.progressVersion);
 assert.deepEqual(reverse.pin.sourcePointers,[second.source.pointer,f.source.pointer],'canonical identity changed presentation order');
 await sleep(70);assert.equal(f.counts.generated,1);assert.equal(f.counts.presented,1);
 const revised=await secondSource(f,'r2');await f.dispatch.pinCreate({updateId:'revision-new',pinId:'revision',sourceIds:[f.entry.id,revised.entry.id],dueAt:new Date().toISOString(),userAction:f.action});
 await until(()=>f.counts.presented===2);assert.equal(f.counts.generated,2);
 }finally{await f.dispatch.close();}
});
await test('legacy_ordered_Pin_and_reservation_remain_deduplicated_after_reopen_and_reverse_order',async()=>{
 const f=await fixture('pin-legacy-order'),second=await secondSource(f),sourcePointers=[f.source.pointer,second.source.pointer];
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 const hashes=Object.fromEntries([[cmcpSourcePointerKey(f.source.pointer),loopHash(f.source)],[cmcpSourcePointerKey(second.source.pointer),loopHash(second.source)]]);
 const target={sourceId:'set-'+loopHash([f.entry.id,second.entry.id])},progressVersion=loopHash(sourcePointers.map(pointer=>[cmcpSourcePointerKey(pointer),hashes[cmcpSourcePointerKey(pointer)]]));
 const oldPins=createCmcpPinLifecycle({root:f.dir,scopeId:f.scopeId,verifyUserAction:async()=>({status:'verified',fixture:'legacy_explicit_action'}),
  verifySources:async()=>({status:'verified',hashes})});
 try{
  await oldPins.create({updateId:'legacy-create',pinId:'old',target,sourcePointers,progressVersion,dueAt:f.due,userAction:f.action,timeContext:{now:new Date().toISOString(),timezone:'UTC'}});
  const candidate={route:'pin',id:'old',target,sourcePointers,progressVersion,dueAt:f.due,pinRevision:1,sourceHashes:hashes};
  const legacyKey=loopHash(canonical([f.scopeId,target,progressVersion,sourcePointers.map(cmcpSourcePointerKey).sort()]));
  const value={version:1,scopeId:f.scopeId,id:'synthetic-legacy-reservation',key:legacyKey,candidate,at:new Date().toISOString(),
   deadlineAt:new Date(Date.now()+90000).toISOString(),status:'reserved'};
  await f.journal.append('dispatch_reserved',value);await f.journal.append('dispatch_result',{version:1,scopeId:f.scopeId,id:value.id,key:legacyKey,status:'presented',at:value.at,
   receipt:{status:'presented',fixture:'explicit_legacy_compatibility_record_not_live_model'}});
  assert.notEqual(cmcpDispatchProgressKey(candidate,f.scopeId),legacyKey);await f.change({proactive:true});
 }finally{await f.dispatch.close();}
 const reopened=f.make();try{
  const replay=await reopened.pinCreate({updateId:'legacy-create',pinId:'old',sourceIds:[f.entry.id,second.entry.id],dueAt:f.due,userAction:f.action});
  assert.equal(replay.status,'already_saved');assert.deepEqual(replay.pin.target,target);
  await reopened.pinCreate({updateId:'new-reverse',pinId:'new',sourceIds:[second.entry.id,f.entry.id],dueAt:new Date().toISOString(),userAction:f.action});
  await sleep(70);assert.equal(f.counts.generated,0);assert.equal(f.counts.presented,0);
  const records=(await f.journal.read()).map(row=>row.record),old=records.find(row=>row.kind==='dispatch_reserved');
  assert.equal(old.value.key,loopHash(canonical([f.scopeId,target,progressVersion,sourcePointers.map(cmcpSourcePointerKey).sort()])));
  assert.deepEqual(old.value.candidate.sourcePointers,sourcePointers);assert.equal(records.filter(row=>row.kind==='dispatch_reserved').length,1);
 }finally{await reopened.close();}
});
await test('existing_source_Pin_create_replay_preserves_identity_after_event_association_is_added',async()=>{
 const f=await fixture('pin-source-replay-event');try{
 const original=await f.pin({dueAt:null});assert.deepEqual(original.pin.target,{sourceId:f.entry.id});
 const list=f.core.catalog.list;f.core.catalog={...f.core.catalog,list:async()=>(await list()).map(row=>({...row,eventScope:f.state.event}))};
 const replay=await f.pin({dueAt:null});assert.equal(replay.status,'already_saved');assert.deepEqual(replay.pin.target,original.pin.target);
 const distinct=await f.pin({updateId:'new-event-associated',pinId:'new-event-associated',dueAt:null});
 assert.deepEqual(distinct.pin.target,{eventId:f.state.event.eventId});assert.equal(f.counts.generated,0);
 }finally{await f.dispatch.close();}
});
await test('new_explicit_event_Pin_can_target_closed_history_without_reopening_Event_or_Buffer',async()=>{
 const f=await fixture('pin-closed-new',{buffer:true});try{f.state.dialogue.status='closed';const before=structuredClone(f.state);
 await f.change({proactive:true});const created=await f.pin({sourceIds:undefined,eventKey:'e'});
 assert.equal(created.pin.eligibilityPolicy,'explicit_independent_v1');await until(()=>f.counts.presented===1);
 assert.equal(f.lastInput().dialogue.targetDialogueStatus,'closed');assert.equal(f.lastInput().dialogue.originalDiscussionReopened,false);
 assert.deepEqual(f.state,before);assert.equal((await f.dispatch.status()).arbitration.records.filter(r=>r.kind==='dispatch_reserved').length,1);
 }finally{await f.dispatch.close();}
});
await test('legacy_closed_event_Pin_remains_ineligible_when_new_explicit_Pin_is_allowed',async()=>{
 const f=await fixture('pin-closed-legacy');try{const old=createCmcpPinLifecycle({root:f.dir,scopeId:f.scopeId,
 verifyUserAction:async()=>({status:'verified',fixture:'legacy'}),verifySources:async()=>({status:'verified',hashes:{[cmcpSourcePointerKey(f.source.pointer)]:loopHash(f.source)}})});
 await old.create({updateId:'legacy-create',pinId:'legacy',target:{eventId:f.state.event.eventId},sourcePointers:[f.source.pointer],progressVersion:f.state.eventVersion,dueAt:f.due,userAction:f.action,timeContext:{now:new Date().toISOString(),timezone:'UTC'}});
 f.state.dialogue.status='closed';await f.change({proactive:true});await f.dispatch.refresh();await sleep(560);assert.equal(f.counts.generated,0);
 const replay=await f.dispatch.pinCreate({updateId:'legacy-create',pinId:'legacy',eventKey:'e',dueAt:f.due,userAction:f.action});
 assert.equal(replay.status,'already_saved');assert.equal(replay.pin.eligibilityPolicy,undefined);assert.equal(f.counts.generated,0);
 await f.dispatch.pinChange({updateId:'legacy-schedule',pinId:'legacy',expectedRevision:1,action:'schedule',dueAt:new Date().toISOString(),userAction:f.action});await sleep(40);assert.equal(f.counts.generated,0);
 assert.equal((await f.dispatch.pinList()).pins.find(p=>p.pinId==='legacy').eligibilityPolicy,undefined);
 await f.dispatch.pinCreate({updateId:'new-independent',pinId:'independent',eventKey:'e',dueAt:new Date().toISOString(),userAction:f.action});
 await until(()=>f.counts.presented===1);assert.equal((await f.dispatch.pinList()).pins.find(p=>p.pinId==='legacy').eligibilityPolicy,undefined);
 }finally{await f.dispatch.close();}
});
await test('new_closed_event_Pin_cancel_or_version_change_still_blocks_late_presentation',async()=>{
 for(const kind of ['cancel','version']){const f=await fixture('closed-late-'+kind,{slow:true});try{f.state.dialogue.status='closed';await f.change({proactive:true});await f.pin({sourceIds:undefined,eventKey:'e'});
 await until(()=>f.counts.generated===1);if(kind==='cancel')await f.dispatch.pinChange({updateId:'cancel-new',pinId:'p1',expectedRevision:1,action:'cancel',userAction:f.action});else f.state.eventVersion='changed-version';
 f.release();await until(async()=>!(await f.dispatch.status()).generating);assert.equal(f.counts.presented,0);assert.equal(f.counts.saved,0);
 }finally{f.release();await f.dispatch.close();}}
});
await test('new_event_Pin_uses_formally_committed_completed_fact_when_no_dialogue_support_exists',async()=>{
 const f=await fixture('pin-completed-no-dialogue');try{
 const stores=createCmcpReactivationStores({root:f.dir,scopeId:f.scopeId}),store=stores.eventStore(f.state.event);
 const source=createCmcpSourceEvidence({...f.source,pointer:{...f.source.pointer,itemId:'completed-report'},content:{kind:'source_excerpt',body:'The independent review is complete.'}});
 await stores.history.writeEvidence(source);await f.core.catalog.registerSource({pointer:source.pointer});
 const command={version:1,updateId:'formal-completed',source:{pointer:source.pointer,citation:{unit:'unicode_code_points',start:0,end:[...source.content.body].length,text:source.content.body}},
 interpretation:{kind:'user_report',temporalUse:'current',text:'The review is complete.'},action:{type:'add_node',objectId:'review',aspect:'progress',relation:{kind:'independent',targetNodeIds:[]}}};
 assert.equal((await store.applyUpdate(command)).status,'stored');const read=await store.readEvent();f.state.eventVersion=loopHash(read.internal.records);
 f.state.dialogue={status:'unknown',supports:[]};f.core.stores={...f.core.stores,eventStore:()=>store};const before=structuredClone(f.state),recordsBefore=structuredClone(read.internal.records);
 await f.change({proactive:true});const created=await f.pin({sourceIds:undefined,eventKey:'e'});assert.deepEqual(created.pin.sourcePointers,[source.pointer]);
 await until(()=>f.counts.presented===1);assert.deepEqual(f.state,before);assert.deepEqual((await store.readEvent()).internal.records,recordsBefore);
 assert.equal(f.lastInput().dialogue.targetDialogueStatus,'unknown');assert.match(JSON.stringify(f.lastInput().compact),/review is complete/);
 }finally{await f.dispatch.close();}
});
await test('new_source_Pin_with_exact_closed_event_membership_is_independent_and_deduplicates_event_Pin',async()=>{
 const f=await fixture('pin-closed-source-associated');try{f.state.dialogue.status='closed';const list=f.core.catalog.list;
 f.core.catalog={...f.core.catalog,list:async()=>(await list()).map(row=>({...row,eventScope:f.state.event}))};await f.change({proactive:true});
 const sourcePin=await f.pin();assert.equal(sourcePin.pin.eligibilityPolicy,'explicit_independent_v1');assert.equal(sourcePin.pin.target.eventId,f.state.event.eventId);
 await until(()=>f.counts.presented===1);await f.dispatch.pinCreate({updateId:'same-event',pinId:'same-event',eventKey:'e',dueAt:new Date().toISOString(),userAction:f.action});
 await sleep(60);assert.equal(f.counts.generated,1);assert.equal(f.state.dialogue.status,'closed');
 }finally{await f.dispatch.close();}
});
await test('converted_source_to_event_Pin_replay_preserves_original_version_after_Event_changes',async()=>{
 const f=await fixture('pin-source-event-version-replay');try{const list=f.core.catalog.list;
 f.core.catalog={...f.core.catalog,list:async()=>(await list()).map(row=>({...row,eventScope:f.state.event}))};
 const original=await f.pin({dueAt:null});assert.equal(original.pin.target.eventId,f.state.event.eventId);f.state.eventVersion='new-event-version';
 const replay=await f.pin({dueAt:null});assert.equal(replay.status,'already_saved');assert.deepEqual(replay.pin,original.pin);
 assert.equal((await f.dispatch.pinList()).pins.length,1);assert.equal(f.counts.generated,0);
 }finally{await f.dispatch.close();}
});
await test('new_Pin_and_existing_due_Pin_reject_deleted_missing_denied_or_changed_original_sources',async()=>{
 for(const failure of ['deleted','missing','permission_denied','unavailable','changed']){
  const f=await fixture('source-loss-'+failure);let blocked=false;
  try{const original=f.core.history.resolve.bind(f.core.history);f.core.history={...f.core.history,resolve:async pointer=>blocked
    ?{status:failure,pointer,...(failure==='changed'?{requestedRevisionId:pointer.revisionId??null,currentRevisionId:'replacement-r2'}:{})}:original(pointer)};
   blocked=true;await assert.rejects(f.pin(),/dispatch_source_unavailable/);assert.equal((await f.dispatch.pinList()).pins.length,0);
   blocked=false;await f.pin();blocked=true;await f.change({proactive:true});await f.dispatch.refresh();
   await until(async()=>(await f.dispatch.status()).lastResult!==null);assert.equal(f.counts.generated,0);assert.equal(f.counts.presented,0);
   assert.equal((await f.dispatch.pinList()).pins[0].status,'active','historical Pin lifecycle is retained, not silently cancelled by a read failure');
   assert.ok(JSON.stringify((await f.dispatch.status()).lastResult).includes('dispatch_source_unavailable'));
  }finally{await f.dispatch.close();}
 }
});
await test('source_deleted_during_generation_prevents_new_body_save_and_presentation',async()=>{
 const f=await fixture('source-deleted-late',{slow:true});let blocked=false;
 try{const original=f.core.history.resolve.bind(f.core.history);f.core.history={...f.core.history,resolve:async pointer=>blocked?{status:'deleted',pointer}:original(pointer)};
  await f.change({proactive:true});await f.pin();await until(()=>f.counts.generated===1);blocked=true;f.release();
  await until(async()=>!(await f.dispatch.status()).generating);assert.equal(f.counts.generated,1);assert.equal(f.counts.saved,0);assert.equal(f.counts.presented,0);
  assert.ok(JSON.stringify((await f.dispatch.status()).lastResult).includes('dispatch_source_unavailable'));
 }finally{f.release();await f.dispatch.close();}
});
await fs.writeFile(path.join(root,'results.json'),JSON.stringify({kind:'OFFLINE_FORMAL_STORAGE_SYNTHETIC_MODEL_AND_FOCUS',results,modelCalls:0},null,2));
console.log(JSON.stringify({root,passed:results.filter(row=>row.status==='PASS').length,total:results.length,results}));if(results.some(row=>row.status!=='PASS'))process.exitCode=1;
