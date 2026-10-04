// Synthetic formal evidence and local wire compilation only; zero provider POSTs.
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectCmcpAnswerHistoryLookup} from '../src/cmcp-guard/cmcp-answer-history.js';
import {fitCmcpGeneralAnswerWire} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {createCmcpBoundedProviderAdapter,boundedProviderProtocolHash} from '../src/cmcp-guard/cmcp-bounded-provider-adapter.js';
import {buildCmcpDeepSeekWireRequest} from '../src/cmcp-guard/cmcp-responses-transport.js';
import {DEEPSEEK_LOOP_CONFIG} from '../src/cmcp-guard/cmcp-deepseek-configured-adapter.js';

const timezone='Asia/Taipei',runtimeTime={now:'2026-09-28T01:00:00.000Z',timezone};
const limit=8192,root=path.resolve('logs','recall-wire-fit-smoke-'+randomUUID());
let fetches=0,reprojections=0;
const adapter=createCmcpBoundedProviderAdapter({deepseekKey:'offline-dummy',ledgerRoot:path.join(root,'attempts'),
  manifest:{profile:'history-reactivation-v1',protocolHash:boundedProviderProtocolHash('history-reactivation-v1'),
    taskBudget:{root:path.join(root,'total'),maxPosts:10}},
  fetchImpl:async()=>{fetches++;throw Error('unexpected_provider_post');}});
const baseQuestion='Compare the recorded draft and final instruction for the Archive Hall notice.';
function sourceResult(quoteLength,question){
  const evidence=Array.from({length:8},(_,i)=>({ref:'r'+(i+1),sourceAuthorRole:i%2?'assistant':'user',
    supportRelation:i%2?'related_historical_detail':'requested_detail',
    citation:{unit:'unicode_code_points',start:0,end:quoteLength+10,
      text:`Version ${i+1} `+String.fromCharCode(65+i).repeat(quoteLength)},
    contentKind:'source_excerpt',messageRecordedAt:`2026-09-27T0${i}:00:00.000Z`,eventOccurredAt:null}));
  return {kind:'cmcp_history_query_result',requestId:'synthetic-wire-fit',sourceCollectionKind:'ordinary',status:'complete',
    publication:{status:'verified'},aggregate:{kind:'cmcp_history_aggregate',purpose:'evidence_lookup',question,
      status:'complete_within_frozen_scope',finding:'supported_evidence',evidence,
      coverage:{sourceCount:8,completedSources:8,unavailableSources:0,unread:[],unclassified:[],uncertain:[],
        ambiguousRevisions:[],partialSources:[]}}};
}
function projection(result,maxProjectionBytes){
  const projected=projectCmcpAnswerHistoryLookup({result,timezone,maxProjectionBytes,needBasis:'prior_content_reference'});
  const sourceRefs=(projected.model.context?.evidence??[]).map(row=>row.sourceRef);
  return {context:projected.model,sourceRefs,verify:verified,receipt:{requestId:result.requestId,modelCalls:0,
    projection:projected.measurement,referencedEvidence:sourceRefs}};
}
const verified=async()=>true;
function input(lookup,question){return {question,context:lookup.context,allowedSourceRefs:lookup.sourceRefs,runtimeTime};}
let selected;
for(let quoteLength=200;quoteLength<=900;quoteLength+=10){
  const result=sourceResult(quoteLength,baseQuestion),lookup=projection(result,limit);
  if(lookup.sourceRefs.length<2)continue;
  const bytes=adapter.preflightRequest('recall_answer',input(lookup,baseQuestion)).requestBytes;
  const padding=16389-bytes;
  if(padding>=0&&Buffer.byteLength(baseQuestion)+padding<=4096){selected={quoteLength,padding};break;}
}
assert.ok(selected,'synthetic evidence can exercise the 16 KiB wire boundary');
const question=baseQuestion+'x'.repeat(selected.padding),result=sourceResult(selected.quoteLength,question);
const baseLookup=projection(result,limit);
const lookup={...baseLookup,reproject:maxProjectionBytes=>{reprojections++;return projection(result,maxProjectionBytes);}};
const baseline=adapter.preflightRequest('recall_answer',input(lookup,question));
assert.equal(baseline.requestBytes,16389);
assert.equal(baseline.requestByteLimit,16384);
assert.equal(baseline.fits,false);
const compiled=buildCmcpDeepSeekWireRequest({purpose:'recall_answer',input:input(lookup,question),config:DEEPSEEK_LOOP_CONFIG});
assert.equal(Buffer.byteLength(compiled.body),baseline.requestBytes,'preflight uses the actual compiled wire');
const instructions=JSON.parse(compiled.body).instructions;
assert.match(instructions,/coverage\.readSources\/unreadSources count read\/unread sources/);
assert.match(instructions,/coverage\.answerProjection\.projectedEvidence\/omittedEvidence count excerpts shown\/omitted/);
assert.match(instructions,/Omitted excerpts are not unread; partial may reflect uncertainty with unreadSources=0/);

const limits={maxProjectionBytes:limit};
const near=fitCmcpGeneralAnswerWire({lookup,question:question.slice(0,-5),runtimeTime,limits,
  preflightRequest:adapter.preflightRequest});
assert.equal(near.wirePreflight.requestBytes,16384);
assert.equal(near.wirePreflight.reprojections,0);
assert.deepEqual(near.lookup.sourceRefs,lookup.sourceRefs);
const fitted=fitCmcpGeneralAnswerWire({lookup,question,runtimeTime,limits,
  preflightRequest:adapter.preflightRequest});
assert.ok(fitted.wirePreflight.requestBytes<=16384);
assert.ok(fitted.wirePreflight.reprojections>0);
assert.equal(fitted.lookup.receipt.wirePreflight.requestBytes,fitted.wirePreflight.requestBytes);
assert.equal(fitted.projectionBytes,Buffer.byteLength(JSON.stringify(fitted.lookup.context)));
assert.deepEqual(fitted.answerInput.allowedSourceRefs,fitted.lookup.sourceRefs);
const rows=fitted.lookup.context.context.evidence,coverage=fitted.lookup.context.context.coverage;
assert.ok(rows.some(row=>row.supportRelation==='requested_detail'));
assert.ok(rows.some(row=>row.supportRelation==='related_historical_detail'));
assert.equal(coverage.answerProjection.projectedEvidence,rows.length);
assert.equal(coverage.answerProjection.projectedEvidence+coverage.answerProjection.omittedEvidence,
  coverage.answerProjection.eligibleEvidence);
assert.equal(coverage.answerProjection.omittedDirect+coverage.answerProjection.omittedRelated,
  coverage.answerProjection.omittedEvidence);
for(const row of rows){
  const original=result.aggregate.evidence.find(item=>item.ref===row.sourceRef);
  assert.equal(row.content.text,original.citation.text,'whole exact quotations survive');
  assert.deepEqual(row.range,{unit:'unicode_code_points',start:0,end:original.citation.end});
}
assert.throws(()=>fitCmcpGeneralAnswerWire({lookup,question,runtimeTime,limits,
  preflightRequest:()=>({requestBytes:20000,requestByteLimit:200})}),/general_answer_wire_budget/);
assert.equal(fetches,0);
adapter.dispose();
console.log(JSON.stringify({status:'PASS',productApiPosts:0,nearBytes:near.wirePreflight.requestBytes,
  initialBytes:baseline.requestBytes,fittedBytes:fitted.wirePreflight.requestBytes,reprojections,
  projectedEvidence:rows.length,omittedEvidence:coverage.answerProjection.omittedEvidence}));
