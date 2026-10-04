import assert from 'node:assert/strict';
import {summarizeCmcpAttempt,summarizeCmcpRecordedRequest,projectCmcpEvidenceTrace,
  projectCmcpHistoryQueryEvidence} from './cmcp-evidence-trace.mjs';

const requestBody=JSON.stringify({model:'synthetic',input:[{role:'user',content:JSON.stringify({
  question:'A revised question',exchangeTime:{current:{now:'2026-09-23T00:00:00.000Z',timezone:'Asia/Taipei'}},
  answerHistory:{sources:[{ref:'a1',role:'assistant',text:'Private source text'}]}
})}]});
const request=summarizeCmcpRecordedRequest(requestBody);
assert.equal(request.status,'recorded');
assert.deepEqual(request.inputKeys,['question','exchangeTime','answerHistory']);
assert.equal(typeof request.materialBytes.answerHistory,'number');
assert.equal(JSON.stringify(request).includes('Private source text'),false);
const exactRequest=summarizeCmcpRecordedRequest(JSON.stringify({input:[{role:'user',content:JSON.stringify({
  kind:'recall_answer',context:{kind:'answer_history',context:{kind:'bounded_exact_history_lookup',
    evidence:[{sourceRef:'r1',text:'Private history text'},{sourceRef:'r2',text:'Another private text'}],
    coverage:{status:'partial',registeredSources:4,readSources:4,completeWithinFrozenScope:false}}}
})}]}));
assert.equal(exactRequest.lookupEvidence.status,'recorded');
assert.deepEqual(exactRequest.lookupEvidence.aliases,['r1','r2']);
assert.equal(JSON.stringify(exactRequest).includes('Private history text'),false);

const start={attempt:17,purpose:'answer',startedAt:'2026-09-23T00:00:00.000Z',freezeId:'runtime:grant-binding',
  workContext:{workId:'synthetic-work',logicalId:'synthetic-logical'},requestBody,requestBytes:Buffer.byteLength(requestBody),
  requestSha256:'synthetic-hash',bodyRetention:'enabled'};
const noResult=summarizeCmcpAttempt(start,null);
assert.equal(noResult.actualInputEvidence,'fetch_status_unknown');
assert.equal(noResult.modelInput.status,'restricted_to_metadata');
assert.equal(JSON.stringify(noResult).includes('Private source text'),false);
const notFetched=summarizeCmcpAttempt(start,{attempt:17,purpose:'answer',workContext:{workId:'synthetic-work'},
  status:'failed',fetchStarted:false,responseComplete:false});
assert.equal(notFetched.actualInputEvidence,'not_submitted_to_fetch');
const fetched=summarizeCmcpAttempt(start,{attempt:17,purpose:'answer',workContext:{workId:'synthetic-work'},
  status:'completed',fetchStarted:true,responseComplete:true,remoteOutcome:'completed',usage:{total_tokens:8},
  responseBody:'Private reply',outputText:'Private reply',bodyRetention:'enabled'},
  {allowBodyInspection:true});
assert.equal(fetched.actualInputEvidence,'fetch_started_complete_response');
assert.equal(fetched.modelInput.status,'recorded');
assert.equal(JSON.stringify(fetched).includes('Private reply'),false);
assert.throws(()=>summarizeCmcpAttempt(start,{attempt:17,purpose:'answer',workContext:{workId:'other-work'}}),
  /trace_attempt_result_binding_mismatch/);

const status={binding:'work-binding',authorizationBinding:'grant-binding',
  controls:{enabled:true,clean:false,historyRecall:true,saveUser:true,saveAssistant:true},
  registration:{inventoryStatus:'complete',inventoryComplete:true,registered:1,unregistered:[]}};
const work={workId:'synthetic-work',binding:'work-binding',mode:'local_candidates',state:'completed',sessionId:'session-1',
  at:'2026-09-23T00:00:00.000Z',terminal:{at:'2026-09-23T00:00:01.000Z',remoteOutcome:'completed'}};
const receipt={sha256:'receipt-hash',value:{mode:'local_candidates',at:'2026-09-23T00:00:01.000Z',result:{
  host:{status:'candidates',candidates:[{ref:'c1'}],coverage:'bounded'},internal:{diagnostics:{}}}}};
const rows=[{kind:'started',value:start},{kind:'started',value:{attempt:18,purpose:'answer',freezeId:'runtime:grant-binding'}},
  {kind:'result',value:{attempt:17,purpose:'answer',workContext:{workId:'synthetic-work'},
  fetchStarted:true,responseComplete:true,status:'completed',remoteOutcome:'completed'}}];
const projected=projectCmcpEvidenceTrace({status,work,receipt,attemptRows:rows,sourceChecks:[{ref:'c1',historyStatus:'found'}]});
assert.equal(projected.attemptsStarted,1);
assert.equal(projected.fetchStartedCount,1);
assert.equal(projected.unattributedLedgerStarts.count,1);
assert.equal(projected.unattributedLedgerStarts.relationToThisWork,'unknown_do_not_infer_from_time');
assert.deepEqual(projected.candidates.refs,['c1']);
assert.equal(projected.sources[0].historyStatus,'found');
assert.equal(JSON.stringify(projected).includes('Private source text'),false);
assert.throws(()=>projectCmcpEvidenceTrace({status,work,receipt,attemptRows:rows,attemptNumber:18}),
  /trace_attempt_not_bound_to_work/);

const off=projectCmcpEvidenceTrace({status:{...status,controls:{...status.controls,enabled:false}},work,receipt,
  attemptRows:rows,sourceChecks:[{ref:'c1',historyStatus:'found'}]});
assert.equal(off.sourceInspection.status,'disabled_by_current_controls');
assert.deepEqual(off.sources,[]);
assert.equal(off.candidates,undefined);
assert.throws(()=>projectCmcpEvidenceTrace({status:{...status,controls:{...status.controls,clean:true}},work,receipt,
  attemptRows:rows,showBodies:true}),/trace_body_access_disabled_by_current_controls/);
const stale=projectCmcpEvidenceTrace({status:{...status,bufferGeneration:2},
  work:{...work,bufferDependent:true,bufferGeneration:1},receipt,attemptRows:rows,
  sourceChecks:[{ref:'c1',historyStatus:'found'}]});
assert.equal(stale.workAccess,'stale_after_buffer_clear');
assert.equal(stale.sourceInspection.checked,0);
assert.deepEqual(stale.sources,[]);
assert.throws(()=>projectCmcpEvidenceTrace({status:{...status,bufferGeneration:2},
  work:{...work,bufferDependent:true,bufferGeneration:1},receipt,attemptRows:rows,showBodies:true}),
  /trace_body_access_disabled_by_current_controls/);
assert.throws(()=>projectCmcpEvidenceTrace({status,work:{...work,binding:'other'},receipt,attemptRows:rows}),
  /trace_work_binding_mismatch/);

const lookupReceipt={requestId:'synthetic-query',status:'partial'};
const noRows=projectCmcpHistoryQueryEvidence({lookupReceipt,scopeId:'synthetic-scope'});
assert.equal(noRows.status,'no_exact_request_journal_rows');
const notOpened=projectCmcpHistoryQueryEvidence({lookupReceipt,scopeId:'synthetic-scope',rows:[{
  stage:'started',scopeId:'synthetic-scope',requestId:'synthetic-query',purpose:'report_count'}]});
assert.equal(notOpened.status,'not_opened');
assert.throws(()=>projectCmcpHistoryQueryEvidence({lookupReceipt,scopeId:'synthetic-scope',rows:[{
  stage:'started',scopeId:'other-scope',requestId:'synthetic-query'}]}),/trace_history_query_scope_mismatch/);
const standalone={...work,mode:'standalone'},lookupWorkReceipt={...receipt,value:{...receipt.value,
  mode:'standalone',result:{lookupReceipt,status:'answered'}}};
const restricted=projectCmcpEvidenceTrace({status:{...status,controls:{...status.controls,historyRecall:false}},
  work:standalone,receipt:lookupWorkReceipt,attemptRows:rows});
assert.equal(restricted.historyQuery.status,'restricted_by_current_controls');
assert.equal(restricted.historyQuery.frozen,undefined);

process.stdout.write('cmcp-evidence-trace smoke PASS\n');
