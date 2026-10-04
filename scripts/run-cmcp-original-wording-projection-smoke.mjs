import assert from 'node:assert/strict';
import {projectCmcpAnswerHistoryLookup,projectCmcpEvidenceLookupAnswerInput} from '../src/cmcp-guard/cmcp-answer-history.js';
import {validAnswerHistoryProjection} from '../src/cmcp-guard/cmcp-responses-transport.js';

const quote=(ref,contentKind,text)=>({ref,sourceAuthorRole:'assistant',messageRecordedAt:'2026-09-22T12:00:00.000Z',
  eventOccurredAt:null,contentKind,citation:{unit:'unicode_code_points',start:0,end:[...text].length,text}});
const result=evidence=>({kind:'cmcp_history_query_result',requestId:'bounded-query-1',status:'partial',
  publication:{status:'verified'},aggregate:{kind:'cmcp_history_aggregate',purpose:'evidence_lookup',status:'partial',
    finding:'supported_evidence',evidence,coverage:{sourceCount:evidence.length,completedSources:evidence.length,
      unavailableSources:0,unread:[],unclassified:[],uncertain:[],ambiguousRevisions:[],partialSources:[]}}});
const project=evidence=>projectCmcpAnswerHistoryLookup({result:result(evidence),timezone:'Asia/Taipei',
  maxProjectionBytes:8192,needBasis:'prior_content_reference'}).model;

const derived=project([quote('r1','derived_summary','A synopsis of the draft')]);
assert.equal(derived.status,'needs_source');
assert.equal(derived.context.finding,'original_source_not_confirmed');
assert.deepEqual(derived.context.evidence,[]);
assert.equal(derived.context.coverage.originalSourceEvidence.excludedNonOriginalQuotes,1);
assert.equal(validAnswerHistoryProjection(derived),true);
const answerView=projectCmcpEvidenceLookupAnswerInput({user:{sourceAuthorRole:'user',text:'Repeat the old wording'},answerHistory:derived});
assert.equal(answerView.answerTask.disposition,'report_incomplete_check');

const exact=project([quote('r1','derived_summary','A synopsis of the draft'),
  quote('r2','source_excerpt','The lantern room opens on Thursday only if the fire inspection passes.')]);
assert.equal(exact.status,'read');
assert.deepEqual(exact.context.evidence.map(row=>row.sourceRef),['r2']);
assert.equal(exact.context.coverage.originalSourceEvidence.excludedNonOriginalQuotes,1);
assert.equal(validAnswerHistoryProjection(exact),true);
assert.equal(JSON.stringify(exact).includes('A synopsis of the draft'),false);

const falseFact=projectCmcpAnswerHistoryLookup({result:result([quote('r1','derived_summary','The User approved the launch.')]),
  timezone:'Asia/Taipei',maxProjectionBytes:8192,needBasis:'recorded_fact_lookup'}).model;
assert.equal(falseFact.status,'needs_source');
assert.deepEqual(falseFact.context.evidence,[]);
assert.equal(validAnswerHistoryProjection(falseFact),true);
const derivedText='The User approved the launch. A later summary repeats this claim.';
const derivedWithBinding={...quote('r1','derived_summary','The User approved the launch.'),evidenceHash:'synthetic-derived-evidence-hash'};
const completeDerived={kind:'cmcp_verified_read_source_projection',manifestHash:'synthetic-manifest',sources:[{
  ref:'r1',evidenceHash:derivedWithBinding.evidenceHash,sourceAuthorRole:'assistant',contentKind:'derived_summary',
  codePoints:[...derivedText].length,text:derivedText}]};
const eventOriginal=projectCmcpAnswerHistoryLookup({result:result([derivedWithBinding]),timezone:'Asia/Taipei',
  maxProjectionBytes:8192,needBasis:'prior_content_reference',verifiedReadSources:completeDerived}).model;
assert.equal(eventOriginal.status,'needs_source');
assert.deepEqual(eventOriginal.context.evidence,[],
  'a fully read derived summary does not become original wording in an event answer');
assert.equal(validAnswerHistoryProjection(eventOriginal),true);
const legacyDerived=projectCmcpAnswerHistoryLookup({result:result([derivedWithBinding]),timezone:'Asia/Taipei',
  maxProjectionBytes:8192,verifiedReadSources:completeDerived}).model;
assert.equal(legacyDerived.context.evidence[0].content.text,'The User approved the launch.');
assert.equal(legacyDerived.context.evidence[0].projectedCoverage,'exact_quote_only',
  'a derived synopsis stays a locator even on a legacy no-needBasis route');
assert.equal(validAnswerHistoryProjection(legacyDerived),true);

const ordinaryResult={...result([quote('r1','source_excerpt','We could consider Saturday, but nothing is approved.')]),
  sourceCollectionKind:'ordinary'};
const ordinary=projectCmcpAnswerHistoryLookup({result:ordinaryResult,timezone:'Asia/Taipei',
  maxProjectionBytes:8192,needBasis:'recorded_fact_lookup'}).model;
assert.equal(ordinary.context.coverage.kind,'frozen_registered_authorized_ordinary_sources');
assert.equal(validAnswerHistoryProjection(ordinary),true);
const timeBounded=projectCmcpAnswerHistoryLookup({result:{...ordinaryResult,sourceCollectionKind:'event_or_time_bounded'},
  timezone:'Asia/Taipei',maxProjectionBytes:8192,needBasis:'recorded_fact_lookup'}).model;
assert.equal(timeBounded.context.coverage.kind,'frozen_registered_authorized_sources');
assert.equal(validAnswerHistoryProjection(timeBounded),true);

console.log(JSON.stringify({status:'PASS',checks:11,productApiPosts:0,
  boundary:'derived_quote_is_locator_not_original_wording_or_fact; exact_source_excerpt_is_available'}));
