// Exact local History and Event Store, deterministic model/delivery substitutes. Zero product API calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCmcpLocalContinuityLoop} from '../src/cmcp-guard/cmcp-local-continuity-loop.js';
import {createCmcpSourceEvidence} from '../src/cmcp-guard/cmcp-source-evidence.js';
import {resolveCmcpHistorySource} from '../src/cmcp-guard/cmcp-history-provider.js';
import {createLocalLoopJournal,loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';

const repo=fileURLToPath(new URL('../',import.meta.url));
const publicTests=path.join(repo,'logs/public-tests');
const output=path.resolve(process.env.CMCP_EVENT_REVIEW_GAP_TEST_ROOT??path.join(publicTests,'event-review-gap-'+randomUUID()));
const relative=path.relative(publicTests,output);
assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Use a new candidate-local public test directory.');
await fs.mkdir(output,{recursive:true});
const scopeId='synthetic-review-gap',event={scopeId,eventId:'harbor-exhibition'};
const userText='Revise that Cedar Harbor sign for a later plan: East Pier should open on Sunday after safety clearance. Tuesday was only the first draft, not the current plan. Give me the revised sentence.';
const covered='Revise that Cedar Harbor sign for a later plan: East Pier should open on Sunday after safety clearance. Tuesday was only the first draft, not the current plan.';
const firstSign='East Pier opens Tuesday only if the safety inspection passes.';
const initialText='Please draft a Cedar Harbor sign with the Tuesday safety condition.';
const stopAndRead='Stop following that prior sign draft. What exactly was the earlier sign?';
const at='2026-09-23T07:10:51.749Z';
const cases=[];
async function test(name,fn){try{const result=await fn();cases.push({name,status:'PASS',...result});console.log('PASS '+name);}
  catch(error){cases.push({name,status:'FAIL',error:error.stack});console.error('FAIL '+name+'\n'+error.stack);}}
async function make(name,{plan='selected',review='gap',duringRead=null,explicitStop=false,invalidStop=false,priorUnavailable=false,stagedStop=false}={}){
  const root=path.join(output,name),calls=[],presentations=[];let allowed=true,buffer=true;
  let loop,prior;
  const adapter={descriptor:{mode:'test_stub',providerId:'offline-review-gap',model:'deterministic-fixture',settings:{}},
    async request(purpose,input,{canAttempt}={}){
      calls.push({purpose,input:structuredClone(input)});
      assert.equal(await canAttempt(),true);
      if(purpose==='turn_intent'&&stagedStop){
        assert.equal(input.controlContext.priorFocus.status,'open');
        return {value:{need:{basis:'prior_content_reference',quote:'What exactly was the earlier sign?'},
          dialogue:{status:'closed',synopsis:'The earlier sign draft has been stopped.',
            supports:[{ref:'input',quote:'Stop following that prior sign draft.'}]},
          controlIntent:{materials:'as_needed',dialogueAction:{action:'stop',target:'selected_event',
            supports:[{ref:'input',quote:'Stop following that prior sign draft.'}],
            focusTarget:{kind:'prior_focus',key:input.controlContext.priorFocus.key,wireAction:'stop'}}}},
          transport:{status:'completed',http:200,responseComplete:true}};
      }
      if(purpose==='semantic'&&input.source.text===initialText)return {value:{
        proposal:{status:'proposed',proposals:[{kind:'user_intent',temporalUse:'current',objectId:'harbor-exhibition',aspect:'arrangements',
          text:'The User requests an initial sign draft.',quote:initialText,relation:{kind:'independent',targetNodeIds:[]}}]},
        eventReview:{version:3,segments:[{quote:initialText,targets:['p1','dialogue'],processing:'handled'}]},
        dialogue:{status:'open',synopsis:'Draft a Cedar Harbor sign.',supports:[{ref:'input',quote:initialText}]},
        answerHistory:{status:'none',refs:[],reason:'The current request supplies the draft task.'}
      },transport:{status:'completed',http:200,responseComplete:true}};
      if(purpose==='semantic')return {value:{
        proposal:{status:'proposed',proposals:[{kind:'user_intent',temporalUse:'current',objectId:'harbor-exhibition',aspect:'arrangements',
          text:'The User requests a revised or earlier sign.',quote:explicitStop?'What exactly was the earlier sign?':covered,relation:{kind:'independent',targetNodeIds:[]}}]},
        eventReview:{version:3,segments:[{quote:explicitStop?'What exactly was the earlier sign?':review==='gap'?covered:userText,targets:['p1'],processing:'handled'}]},
        dialogue:explicitStop?{status:'closed',synopsis:'The earlier sign draft has been stopped.',
          supports:[{ref:'input',quote:'Stop following that prior sign draft.'},...(invalidStop?[{ref:'d99',quote:'A nonexistent prior support.'}]:[])]}:
          {status:'unknown',synopsis:'',supports:[]},
        answerHistory:plan==='missing'?null:{status:plan==='invalid'?'selected':plan,refs:plan==='invalid'?['h9']:plan==='selected'?['h1']:[],reason:'The earlier sign owns its wording.'},
        ...(stagedStop?{controlIntent:{materials:'as_needed',dialogueAction:{action:'stop',target:'selected_event',
          supports:[{ref:'input',quote:'Stop following that prior sign draft.'}],
          focusTarget:{kind:'prior_focus',key:input.controlContext.priorFocus.key,wireAction:'stop'}}}}:{})
      },transport:{status:'completed',http:200,responseComplete:true}};
      if(purpose==='answer'){
        assert.equal(input.answerHistory.status,'read');
        assert.equal(input.answerHistory.context.evidence[0].role,'assistant');
        assert.equal(input.answerHistory.context.evidence[0].text,firstSign);
        return {value:{text:'East Pier opens Sunday after safety clearance.'},transport:{status:'completed',http:200,responseComplete:true}};
      }
      throw Error('unexpected_model_purpose_'+purpose);
    }};
  const loopOptions={root,event,objects:[{objectId:'harbor-exhibition',aspects:['arrangements']}],timezone:'UTC',
    ttlMs:43200000,bufferTtlMs:43200000,inactivityMs:60000,activityWindowMs:120000,requireEventReview:true,
    adapter,delivery:{present:async value=>{presentations.push(value);return {status:'presented'};}},
    clock:()=>at,sourceObservationClock:()=>at,canContinue:async()=>allowed,bufferValid:()=>buffer,
    prepareAnswerHistory:async({source})=>({
      model:{version:1,timezone:'UTC',timeBasis:'original_message_time',candidates:[{ref:'h1',sourceAuthorRole:'assistant',contentKind:'source_excerpt',
        messageTime:prior.messageRecordedAt,eventOccurredAt:null,sameSession:true,sourceHint:{text:firstSign,complete:true}}],maxSelectedSources:1,
        coverage:{kind:'bounded_authorized_event_locators',registeredSources:1,offeredSources:1,omittedSources:0,
          unreadRemainders:'not_assessed',locatorVerification:'catalog_metadata_not_current_exact_read',selectionIsNotAnswerSufficiency:true}},
      internal:{queryPointer:source.pointer,queryHash:loopHash(source)}}),
    readAnswerHistory:async({plan:readPlan,query,valid})=>{
      assert.equal(readPlan.status,'selected');assert.equal(query.sourceAuthorRole,'user');
      assert.equal(await valid(),true);
      if(duringRead)await duringRead({setAllowed:value=>allowed=value,setBuffer:value=>buffer=value});
      if(!await valid())throw Error('formal_read_cancelled');
      if(priorUnavailable)throw Error('formal_prior_unavailable');
      const found=await resolveCmcpHistorySource({provider:loop.history,pointer:prior.pointer});
      if(found.status!=='found'||loopHash(found.evidence)!==loopHash(prior))throw Error('formal_prior_unavailable');
      return {model:{kind:'answer_history',status:'read',context:{evidence:[{role:'assistant',text:found.evidence.content.body}]}},
        receipt:{kind:'synthetic_exact_formal_read',sourceMap:{r1:prior.pointer}},verify:async()=>await valid()};
    }};
  loop=await createCmcpLocalContinuityLoop(loopOptions);
  prior=createCmcpSourceEvidence({pointer:{version:1,providerNamespace:'cmcp-local-console-v1',scopeId,sessionId:'prior-session',itemId:'prior-sign',revisionId:'r1'},
    sourceKind:'message',sourceAuthorRole:'assistant',messageRecordedAt:'2026-09-23T07:10:20.775Z',eventOccurredAt:null,
    content:{kind:'source_excerpt',body:firstSign},metadata:{availability:'partial'}});
  await loop.history.writeEvidence(prior);
  const rows=async()=>(await createLocalLoopJournal({root:path.join(root,'focus'),name:'local-focus-v1'}).read()).map(row=>row.record);
  return {get loop(){return loop;},root,calls,presentations,rows,
    submit:(text=userText,answer=true)=>loop.submit(text,{answer,timeContext:{now:at,timezone:'UTC'}}),
    reopen:async options=>{await loop.close();loop=await createCmcpLocalContinuityLoop({...loopOptions,...options,sessionId:randomUUID()});return loop;}};
}

await test('review_gap_keeps_Event_pending_but_reads_original_and_answers',async()=>{
  const f=await make('answer');try{
    const result=await f.submit();assert.equal(result.status,'pending');assert.equal(result.code,'event_review_rejected_independent_answer');
    assert.equal(result.answerGeneration,'completed');assert.deepEqual(f.calls.map(row=>row.purpose),['semantic','answer']);
    assert.equal(f.presentations.length,1);assert.equal(f.loop.snapshot.pending.length,1);
    assert.equal(f.loop.snapshot.processing.at(-1).reviewCode,'event_review_source_gap');
    assert.equal((await f.loop.eventStore.readEvent()).status,'missing');
    const rows=await f.rows();assert.ok(rows.some(row=>row.kind==='event_review_rejected_for_independent_answer'
      &&row.value.reviewCode==='event_review_source_gap'&&row.value.eventMutation==='none'));
    assert.ok(rows.some(row=>row.kind==='answer_history_read'&&row.value.receipt.kind==='synthetic_exact_formal_read'));
    return {productApiPosts:0,formalSourceRole:'assistant',eventMutation:'none',pending:1};
  }finally{await f.loop.close();}
});
await test('review_gap_without_selected_or_valid_history_plan_fails_closed',async()=>{
  for(const plan of ['missing','none','invalid']){
    const f=await make('no-plan-'+plan,{plan});try{
      const result=await f.submit();assert.equal(result.status,'failed');assert.equal(f.presentations.length,0);
      assert.deepEqual(f.calls.map(row=>row.purpose),['semantic']);assert.equal(f.loop.snapshot.pending.length,1);
      assert.equal((await f.loop.eventStore.readEvent()).status,'missing');
    }finally{await f.loop.close();}
  }
  return {productApiPosts:0,negativeCases:3};
});
await test('OFF_or_Clear_during_exact_read_blocks_late_answer',async()=>{
  for(const control of ['OFF','Clear']){
    const f=await make('cancel-'+control,{duringRead:async({setAllowed,setBuffer})=>{
      if(control==='OFF')setAllowed(false);else setBuffer(false);
    }});try{const result=await f.submit();assert.equal(result.status,'failed');assert.equal(f.presentations.length,0);
      assert.deepEqual(f.calls.map(row=>row.purpose),['semantic']);assert.equal((await f.loop.eventStore.readEvent()).status,'missing');
    }finally{await f.loop.close();}
  }
  return {productApiPosts:0,negativeCases:2};
});
await test('unavailable_formal_source_blocks_answer_without_Event_commit',async()=>{
  const f=await make('unavailable-source',{priorUnavailable:true});try{
    const result=await f.submit();assert.equal(result.status,'failed');assert.equal(f.presentations.length,0);
    assert.deepEqual(f.calls.map(row=>row.purpose),['semantic']);assert.equal((await f.loop.eventStore.readEvent()).status,'missing');
    assert.equal(f.loop.snapshot.pending.length,1);return {productApiPosts:0};
  }finally{await f.loop.close();}
});
await test('different_review_error_never_uses_independent_answer_route',async()=>{
  const f=await make('other-review-error',{review:'source_mismatch'});try{
    const result=await f.submit();assert.equal(result.status,'failed');assert.equal(f.presentations.length,0);
    assert.deepEqual(f.calls.map(row=>row.purpose),['semantic']);return {productApiPosts:0};
  }finally{await f.loop.close();}
});
await test('explicit_stop_is_saved_even_when_Event_review_has_a_source_gap',async()=>{
  const f=await make('explicit-stop',{explicitStop:true});try{
    const first=await f.submit(initialText,false);assert.equal(first.status,'accepted');assert.equal(f.loop.snapshot.status,'open');
    const eventBefore=await f.loop.eventStore.readEvent();assert.equal(eventBefore.status,'found');
    const second=await f.submit(stopAndRead);assert.equal(second.status,'pending');assert.equal(second.answerGeneration,'completed');
    assert.equal(f.loop.snapshot.status,'closed','a valid explicit stop must not be lost behind the independent answer route');
    assert.equal(f.loop.snapshot.pending.length,1);assert.equal(f.presentations.length,1);
    assert.equal(f.loop.snapshot.processing.at(-1).dialogueProcessing,'handled');
    assert.equal(f.loop.snapshot.processing.at(-1).eventProcessing,'pending');
    assert.equal(f.loop.snapshot.processing.at(-1).discussionProcessing,'pending');
    assert.equal(loopHash((await f.loop.eventStore.readEvent()).internal.records),loopHash(eventBefore.internal.records));
    const rows=await f.rows();assert.ok(rows.some(row=>row.kind==='dialogue_control'&&row.value.eventProcessing==='pending'));
    await f.reopen();
    assert.equal(f.loop.snapshot.status,'closed');
    assert.equal(f.loop.snapshot.processing.at(-1).dialogueProcessing,'handled');
    assert.equal(f.loop.snapshot.processing.at(-1).eventProcessing,'pending');
    assert.equal(f.loop.snapshot.processing.at(-1).discussionProcessing,'pending');
    return {productApiPosts:0,dialogue:'closed',durableDialogueProcessing:'handled',eventMutation:'none_on_second_turn'};
  }finally{await f.loop.close();}
});
await test('preclosed_turn_intent_is_not_applied_twice_after_Event_review_gap',async()=>{
  const f=await make('preclosed-turn-intent',{explicitStop:true,stagedStop:true});try{
    const first=await f.submit(initialText,false);assert.equal(first.status,'accepted');assert.equal(f.loop.snapshot.status,'open');
    const eventBefore=await f.loop.eventStore.readEvent();assert.equal(eventBefore.status,'found');
    await f.reopen({controlIntent:true,turnIntentStages:true});
    const second=await f.submit(stopAndRead);assert.equal(second.status,'pending');
    assert.equal(second.code,'event_review_rejected_independent_answer');assert.equal(second.answerGeneration,'completed');
    assert.equal(second.dialogueProcessing,'handled');assert.equal(f.loop.snapshot.status,'closed');
    assert.equal(f.loop.snapshot.processing.at(-1).dialogueProcessing,'handled');
    assert.equal(f.loop.snapshot.processing.at(-1).eventProcessing,'pending');
    assert.equal(f.loop.snapshot.processing.at(-1).discussionProcessing,'pending');
    assert.equal(loopHash((await f.loop.eventStore.readEvent()).internal.records),loopHash(eventBefore.internal.records));
    const rows=await f.rows();
    const controls=rows.filter(row=>row.kind==='dialogue_control'
      &&row.value.pointer.itemId===second.pointer.itemId);
    assert.equal(controls.length,1,'a precommitted turn-intent closure must have one control record');
    assert.ok(controls[0].value.turnIntentStageHash);
    await f.reopen({controlIntent:true,turnIntentStages:true});
    assert.equal(f.loop.snapshot.status,'closed');
    assert.equal(f.loop.snapshot.processing.at(-1).dialogueProcessing,'handled');
    assert.equal(f.loop.snapshot.processing.at(-1).eventProcessing,'pending');
    assert.equal(f.loop.snapshot.processing.at(-1).discussionProcessing,'pending');
    return {productApiPosts:0,priorControlRecords:1,durableDialogueProcessing:'handled',eventMutation:'none_on_second_turn'};
  }finally{await f.loop.close();}
});
await test('unsupported_stop_does_not_close_prior_focus_but_exact_answer_can_continue',async()=>{
  const f=await make('invalid-explicit-stop',{explicitStop:true,invalidStop:true});try{
    const first=await f.submit(initialText,false);assert.equal(first.status,'accepted');assert.equal(f.loop.snapshot.status,'open');
    const eventBefore=await f.loop.eventStore.readEvent();
    const second=await f.submit(stopAndRead);assert.equal(second.status,'pending');assert.equal(second.answerGeneration,'completed');
    assert.equal(f.loop.snapshot.status,'open');assert.equal(f.presentations.length,1);
    assert.equal(loopHash((await f.loop.eventStore.readEvent()).internal.records),loopHash(eventBefore.internal.records));
    const rows=await f.rows();assert.ok(rows.some(row=>row.kind==='independent_dialogue_control_rejected'&&row.value.status==='pending'));
    return {productApiPosts:0,dialogue:'open',eventMutation:'none_on_second_turn'};
  }finally{await f.loop.close();}
});
const result={kind:'offline_event_review_gap_answer_smoke',productApiPosts:0,cases};
await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:cases.filter(row=>row.status==='PASS').length,failed:cases.filter(row=>row.status==='FAIL').length,
  productApiPosts:0,results:path.join(output,'results.json')}));
process.exitCode=cases.some(row=>row.status==='FAIL')?1:0;
