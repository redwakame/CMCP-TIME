// 明示合成來源與聚合替身；不讀私人資料，不呼叫產品 API。
import assert from 'node:assert/strict';
import {loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {projectCmcpAnswerHistoryLookup,projectCmcpEvidenceLookupAnswerInput} from '../src/cmcp-guard/cmcp-answer-history.js';
import {validAnswerHistoryProjection} from '../src/cmcp-guard/cmcp-responses-transport.js';
import {buildCmcpHistoryAggregateRequest,prepareCmcpHistoryAggregateBatch,
  acceptCmcpHistoryAggregateBatch,summarizeCmcpHistoryAggregate,
  projectCmcpHistoryAggregateReadSources} from '../src/cmcp-guard/cmcp-history-aggregation.js';

const scopeId='synthetic-related-history',ticket='related-history-ticket',timezone='Asia/Taipei';
const question='Update the Orchard Gate note: open Friday after approval; Wednesday was the earlier draft, not the final plan.';
const texts=[
  'Draft a visitor note: the Orchard Gate desk opens on Wednesday only if the permit is approved.',
  'Here is the revised visitor note:\n\n**Orchard Gate — Opening**\nThe desk opens on Wednesday only if the permit is approved. This is the first draft, not a final approved schedule.\n\nI can shorten this for a sign if you want.'+('"\n'.repeat(280)),
  'Update the Orchard Gate note: the desk opens on Friday after permit approval. Wednesday was the initial draft, not the final plan.',
  'The Orchard Gate comparison appendix begins here. '+('This long source contains contextual draft analysis, not a separately approved opening. '.repeat(52))
];
const times=['2026-09-23T01:00:00.000Z','2026-09-23T01:00:02.000Z','2026-09-23T02:00:00.000Z','2026-09-23T02:00:01.000Z'];
const roles=['user','assistant','user','user'];
const pointer=index=>({version:1,providerNamespace:'cmcp-local-console-v1',scopeId,
  itemId:'synthetic-'+(index+1),sessionId:'synthetic-session',revisionId:'r1'});
const sources=texts.map((text,index)=>({ref:'r'+(index+1),pointer:pointer(index),evidenceHash:loopHash(['evidence',text,index]),
  sourceAuthorRole:roles[index],sourceKind:'message',contentKind:'source_excerpt',messageRecordedAt:times[index],eventOccurredAt:null,
  codePoints:[...text].length,entry:{pointer:pointer(index),evidenceHash:loopHash(['evidence',text,index])}}));
// 合成單頁須能承載大於4096的反例；這是fixture的閱讀上限，不是產品設定。
const limits={maxSources:4,maxTotalBytes:8192,maxPageBytes:8192,maxPages:4,maxProjectionBytes:8192};
const queryPointer={version:1,providerNamespace:'cmcp-local-console-v1',scopeId,itemId:'synthetic-query',sessionId:'synthetic-session',revisionId:'r1'};
const manifest={kind:'cmcp_reading_manifest',version:1,scopeId,ticket,mode:'all',openedAt:'2026-09-23T02:01:00.000Z',timezone,
  queryPointer,queryHash:loopHash(question),queryTime:'2026-09-23T02:00:05.000Z',bufferGeneration:0,expiry:null,
  limits,sources,eventSnapshots:[],scopeCoverage:'frozen_registered_authorized_ordinary_sources',associationCompleteness:'catalog_associations_only'};
const manifestHash=loopHash(manifest),reading={reader:{ticket,manifestHash},internal:{manifest,manifestHash,queryPointer,
  queryHash:manifest.queryHash,queryTime:manifest.queryTime}};
const coverage=progress=>({complete:progress.sourceIndex===sources.length,exhausted:progress.sourceIndex===sources.length,
  sourceCount:sources.length,completedSources:progress.completed.length,completedRefs:[...progress.completed],unavailableSources:0,unavailable:[],
  unread:sources.slice(progress.sourceIndex).map(source=>({ref:source.ref,start:0,end:source.codePoints})),
  cumulative:{pages:progress.pages,sourceBytes:progress.sourceBytes,projectionBytes:0},
  scopeCoverage:manifest.scopeCoverage,associationCompleteness:manifest.associationCompleteness,
  semanticCompleteness:'not_inferred_from_character_coverage'});
const pages=[];let progress={sourceIndex:0,offset:0,pages:0,sourceBytes:0,projectionBytes:0,completed:[],unavailable:[],activatedRefs:[]};
for(const [index,source] of sources.entries()){
  const before=structuredClone(progress),range={unit:'unicode_code_points',start:0,end:source.codePoints};
  progress={...progress,sourceIndex:index+1,pages:index+1,sourceBytes:progress.sourceBytes+Buffer.byteLength(texts[index]),
    completed:[...progress.completed,source.ref]};
  const reader={ticket,pageNumber:index+1,source:{ref:source.ref},text:texts[index],range,sourceAvailability:'available',coverage:coverage(progress)};
  const internal={manifestHash,pageNumber:index+1,before,after:structuredClone(progress),bufferGeneration:0,queryPointer,
    readRanges:[{pointer:source.pointer,evidenceHash:source.evidenceHash,location:range}],bufferActivated:false};
  internal.pageHash=loopHash({reader,modelContext:null,internal});pages.push({reader,modelContext:null,internal});
}
const batch=prepareCmcpHistoryAggregateBatch({reading,pages,scopeId,question,purpose:'evidence_lookup',maxBatchSources:4,maxInputBytes:12000});
assert.equal(batch.status,'ready');assert.deepEqual(batch.input.sources.map(row=>row.text),texts);
const protocol=buildCmcpHistoryAggregateRequest(batch.input);
assert.ok(protocol.schema.properties.rows.items.properties.evidenceStatus.enum.includes('supports_related_historical_detail'));
assert.ok(protocol.schema.properties.rows.items.properties.evidenceStatus.enum.includes('not_relevant'));
assert.ok(protocol.schema.properties.rows.items.properties.kind.enum.includes('assistant_authored_text'));
assert.ok(protocol.instructions.includes('different named subject'));
assert.ok(protocol.instructions.includes('Assistant original is direct evidence of its own wording'));
const reportCountProtocol=buildCmcpHistoryAggregateRequest({...batch.input,purpose:'report_count'});
assert.equal(Object.hasOwn(reportCountProtocol.schema.properties.rows.items.properties,'evidenceStatus'),false,
  'the non-support alias is evidence_lookup-only');
const rows=[
  {ref:'r1',kind:'user_intent',quote:texts[0],evidenceStatus:'supports_related_historical_detail'},
  {ref:'r2',kind:'assistant_authored_text',quote:'Here is the revised visitor note:',evidenceStatus:'supports_related_historical_detail'},
  {ref:'r3',kind:'user_intent',quote:texts[2],evidenceStatus:'supports_requested_detail'},
  {ref:'r4',kind:'not_relevant',quote:'',evidenceStatus:'does_not_support_requested_detail'}
];
const accept=value=>acceptCmcpHistoryAggregateBatch({batch,value:{rows:value},reading,pages,scopeId});
const noQuote=accept([{...rows[0],quote:''},...rows.slice(1)]);
assert.deepEqual(noQuote.rejectedRows,[{ref:'r1',reason:'aggregate_quote_required'}]);
assert.equal(noQuote.rows.some(row=>row.ref==='r1'),false);
const invalidQuotes=[{...rows[0],quote:'Wednesday was already final'},
  {...rows[1],quote:'"'},...rows.slice(2)];
const partialClassification=accept(invalidQuotes);
assert.deepEqual(partialClassification.rejectedRows,[
  {ref:'r1',reason:'aggregate_quote_absent_exact'},
  {ref:'r2',reason:'aggregate_quote_not_unique_exact'}]);
assert.deepEqual(partialClassification.rows.map(row=>row.ref),['r3','r4'],
  'invalid quotes cannot discard an unrelated verified source or become support');
assert.deepEqual(partialClassification.raw,{rows:invalidQuotes},'the original provider response remains available for audit');
assert.equal(partialClassification.resultHash,loopHash(Object.fromEntries(Object.entries(partialClassification)
  .filter(([key])=>key!=='resultHash'))));
const afterPartial=prepareCmcpHistoryAggregateBatch({reading,pages,results:[partialClassification],scopeId,question,
  purpose:'evidence_lookup',maxBatchSources:4,maxInputBytes:12000});
assert.equal(afterPartial.status,'no_retriable_read_sources','rejected rows cannot trigger an automatic repeat model call');
const partialSummary=summarizeCmcpHistoryAggregate({reading,pages,results:[partialClassification],scopeId,question,
  purpose:'evidence_lookup'});
assert.equal(partialSummary.status,'partial');
assert.deepEqual(partialSummary.coverage.unclassified,['r1','r2']);
assert.deepEqual(partialSummary.coverage.rejectedClassifications,partialClassification.rejectedRows);
assert.deepEqual(partialSummary.evidence.map(row=>row.ref),['r3']);
assert.equal(partialSummary.finding,'supported_evidence');
assert.throws(()=>accept([rows[0],{...rows[1],kind:'user_intent'},...rows.slice(2)]),/aggregate_role_mismatch/);
assert.throws(()=>accept([{...rows[0],kind:'assistant_authored_text'},...rows.slice(1)]),/aggregate_role_mismatch/);
assert.throws(()=>accept([{...rows[0],kind:'not_relevant'},...rows.slice(1)]),/aggregate_support_kind_inconsistent/);
const classification=accept(rows);
const summarize=result=>summarizeCmcpHistoryAggregate({reading,pages,results:[result],scopeId,question,purpose:'evidence_lookup'});
const direct=summarize(classification);
assert.equal(direct.status,'complete_within_frozen_scope');assert.equal(direct.finding,'supported_evidence');
assert.deepEqual(direct.evidence.map(row=>[row.ref,row.supportRelation,row.sourceAuthorRole]),[
  ['r1','related_historical_detail','user'],['r2','related_historical_detail','assistant'],['r3','requested_detail','user']]);
const aliasRows=rows.map(row=>row.ref==='r4'?{...row,kind:'user_intent',
  quote:'The Orchard Gate comparison appendix begins here.',evidenceStatus:'not_relevant'}:row);
const aliasMissingQuote=accept(aliasRows.map(row=>row.ref==='r4'?{...row,quote:''}:row));
assert.deepEqual(aliasMissingQuote.rejectedRows,[{ref:'r4',reason:'aggregate_quote_required'}]);
assert.throws(()=>accept(aliasRows.map(row=>row.ref==='r4'?{...row,kind:'assistant_authored_text'}:row)),/aggregate_role_mismatch/);
const aliasClassification=accept(aliasRows),aliasSummary=summarize(aliasClassification);
assert.equal(aliasClassification.rows.find(row=>row.ref==='r4').evidenceStatus,'not_relevant',
  'the model label is retained, not silently coerced');
assert.deepEqual(aliasSummary.evidence.map(row=>row.ref),direct.evidence.map(row=>row.ref),
  'an unrelated source cannot enter supporting evidence through the alias');
assert.deepEqual(aliasSummary.coverage.unclassified,[]);
assert.equal(projectCmcpHistoryAggregateReadSources({reading,pages,results:[aliasClassification],scopeId})
  .sources.some(row=>row.ref==='r4'),false);
const lookup=(aggregate,verifiedReadSources=null,maxProjectionBytes=8192)=>projectCmcpAnswerHistoryLookup({result:{kind:'cmcp_history_query_result',requestId:'synthetic-query',
  status:aggregate.status,publication:{status:'verified'},sourceCollectionKind:'ordinary',aggregate},timezone,
  needBasis:'prior_content_reference',verifiedReadSources,maxProjectionBytes}).model;
const readSources=projectCmcpHistoryAggregateReadSources({reading,pages,results:[classification],scopeId});
assert.ok(Buffer.byteLength(texts[1])<=1024&&Buffer.byteLength(JSON.stringify(texts[1]))>1024,
  'legal raw source crosses the JSON-escaped byte boundary');
assert.equal(readSources.sources.find(row=>row.ref==='r2').text,texts[1]);
assert.equal(direct.evidence.find(row=>row.ref==='r2').citation.text,'Here is the revised visitor note:',
  'the model classification quote stays unchanged in the durable aggregate');
const projected=lookup(direct,readSources);assert.equal(projected.status,'read');assert.equal(validAnswerHistoryProjection(projected),true);
const priorProjectionShape=structuredClone(projected);
delete priorProjectionShape.context.coverage.answerProjection.omittedDirect;
delete priorProjectionShape.context.coverage.answerProjection.omittedRelated;
priorProjectionShape.context.coverage.answerProjection.selection='direct_support_then_recent_source';
assert.equal(validAnswerHistoryProjection(priorProjectionShape),true,'existing answer projection receipts remain admissible');
assert.equal(projected.context.evidence.find(row=>row.sourceRef==='r2').content.text,texts[1],
  'a short fully read supporting Assistant message reaches the answer verbatim');
assert.equal(projected.context.evidence.find(row=>row.sourceRef==='r2').projectedCoverage,'complete_retained_body');
assert.equal(projected.context.evidence.find(row=>row.sourceRef==='r2').range.end,[...texts[1]].length);
assert.deepEqual(projected.context.evidence.map(row=>row.supportRelation),[
  'related_historical_detail','related_historical_detail','requested_detail']);
assert.equal(projected.context.evidence[1].sourceAuthorRole,'assistant');
assert.equal(projectCmcpEvidenceLookupAnswerInput({user:{sourceAuthorRole:'user',text:question},answerHistory:projected}).answerTask.disposition,
  'report_supplied_support');
const assistantOriginalClass=accept(rows.map(row=>row.ref==='r2'?{...row,evidenceStatus:'supports_requested_detail'}:
  row.ref==='r3'?{ref:'r3',kind:'not_relevant',quote:'',evidenceStatus:'does_not_support_requested_detail'}:row));
const assistantOriginalOnly=summarize(assistantOriginalClass);
const assistantOriginalProjection=lookup(assistantOriginalOnly,projectCmcpHistoryAggregateReadSources({reading,pages,
  results:[assistantOriginalClass],scopeId}));
assert.equal(assistantOriginalProjection.context.evidence.find(row=>row.sourceRef==='r2').sourceAuthorRole,'assistant');
assert.equal(assistantOriginalProjection.context.evidence.find(row=>row.sourceRef==='r2').content.text,texts[1]);
assert.equal(projectCmcpEvidenceLookupAnswerInput({user:{sourceAuthorRole:'user',text:question},answerHistory:assistantOriginalProjection}).answerTask.disposition,
  'report_supplied_support','Assistant original can directly support a question about prior Assistant text');
const relatedOnly=summarize(accept(rows.map(row=>row.ref==='r3'?{ref:'r3',kind:'not_relevant',quote:'',
  evidenceStatus:'does_not_support_requested_detail'}:row)));
assert.equal(relatedOnly.finding,'related_historical_context_only');
const relatedProjection=lookup(relatedOnly);assert.equal(validAnswerHistoryProjection(relatedProjection),true);
assert.deepEqual(relatedProjection.context.evidence.map(row=>row.sourceRef),['r1','r2']);
assert.equal(projectCmcpEvidenceLookupAnswerInput({user:{sourceAuthorRole:'user',text:question},answerHistory:relatedProjection}).answerTask.disposition,
  'report_related_context_only');
assert.equal(JSON.stringify(relatedProjection).includes(texts[3]),false,'unrelated source remains outside answer');
const largeRows=rows.map(row=>row.ref==='r4'?{ref:'r4',kind:'user_intent',quote:'The Orchard Gate comparison appendix begins here.',
  evidenceStatus:'supports_related_historical_detail'}:row);
const largeClass=accept(largeRows),large=summarize(largeClass);
const largeReadSources=projectCmcpHistoryAggregateReadSources({reading,pages,results:[largeClass],scopeId});
assert.equal(largeReadSources.sources.some(row=>row.ref==='r4'),false,'large source is not materialized into answer projection');
const largeProjected=lookup(large,largeReadSources);
assert.equal(largeProjected.context.evidence.find(row=>row.sourceRef==='r4').content.text,
  'The Orchard Gate comparison appendix begins here.','large supporting source remains an exact excerpt');
assert.equal(largeProjected.context.evidence.find(row=>row.sourceRef==='r4').projectedCoverage,'exact_quote_only');
assert.equal(JSON.stringify(largeProjected).includes(texts[3]),false,'no large-source body leaks into projection');
assert.equal(validAnswerHistoryProjection(largeProjected),true);
const tampered=structuredClone(readSources);tampered.sources.find(row=>row.ref==='r2').text='A fabricated rewrite.';
assert.throws(()=>lookup(direct,tampered),/invalid_answer_history_verified_read_sources/);
const legacy=structuredClone(direct);for(const row of legacy.evidence)delete row.evidenceHash;
assert.equal(lookup(legacy,readSources).context.evidence.find(row=>row.sourceRef==='r2').content.text,
  'Here is the revised visitor note:','legacy aggregate receipts retain their original citation');
assert.equal(lookup(legacy,readSources).context.evidence.find(row=>row.sourceRef==='r2').projectedCoverage,'exact_quote_only');
const baseline=lookup(direct);
const tight=lookup(direct,readSources,Buffer.byteLength(JSON.stringify(baseline)));
assert.equal(tight.context.evidence.find(row=>row.sourceRef==='r2').content.text,'Here is the revised visitor note:',
  'a tight existing projection budget keeps the exact citation, never a truncated full message');
assert.equal(tight.context.evidence.find(row=>row.sourceRef==='r2').projectedCoverage,'exact_quote_only');
const crowded=structuredClone(direct);
for(let index=5;index<=13;index++){
  const recentPair=index>=10,source=recentPair?direct.evidence[index%2?1:2]:direct.evidence[index%3];
  crowded.evidence.push({...structuredClone(source),ref:'r'+index,
    ...(recentPair?{supportRelation:'requested_detail'}:{}),
    messageRecordedAt:`2026-09-23T03:${String(index).padStart(2,'0')}:00.000Z`});
}
crowded.coverage={...crowded.coverage,sourceCount:13,completedSources:13};
const bounded=lookup(crowded,null,4096);
assert.equal(validAnswerHistoryProjection(bounded),true);
assert.ok(bounded.context.coverage.answerProjection.omittedEvidence>0);
assert.equal(bounded.context.coverage.answerProjection.projectedEvidence,bounded.context.evidence.length);
assert.ok(bounded.context.evidence.some(row=>row.sourceRef==='r1'&&row.supportRelation==='related_historical_detail'),
  'an older contrasted source survives alongside newer direct support');
assert.deepEqual(['r11','r12','r13'].map(ref=>bounded.context.evidence.find(row=>row.sourceRef===ref)?.sourceAuthorRole),
  ['assistant','user','assistant'],'recent User requests and Assistant originals survive a crowded bounded view');
assert.equal(bounded.context.coverage.answerProjection.omittedDirect+bounded.context.coverage.answerProjection.omittedRelated,
  bounded.context.coverage.answerProjection.omittedEvidence);
assert.equal(projectCmcpEvidenceLookupAnswerInput({user:{sourceAuthorRole:'user',text:question},answerHistory:bounded}).answerTask.disposition,
  'report_incomplete_check','a partially projected support set cannot certify a full comparison');
const crowdedReadSources={kind:'cmcp_verified_read_source_projection',sources:crowded.evidence.map(row=>({ref:row.ref,
  evidenceHash:row.evidenceHash,sourceAuthorRole:row.sourceAuthorRole,contentKind:row.contentKind,
  codePoints:[...row.citation.text].length,text:row.citation.text}))};
const boundedWithReadSources=lookup(crowded,crowdedReadSources,4096);
assert.equal(validAnswerHistoryProjection(boundedWithReadSources),true);
assert.equal(boundedWithReadSources.context.coverage.answerProjection.omittedEvidence,
  bounded.context.coverage.answerProjection.omittedEvidence,'omitted formally read sources are not promoted into answer input');
const noProjectedDirect=structuredClone(bounded);
noProjectedDirect.context.evidence=noProjectedDirect.context.evidence.filter(row=>row.supportRelation!=='requested_detail');
noProjectedDirect.context.coverage.answerProjection.projectedEvidence=noProjectedDirect.context.evidence.length;
noProjectedDirect.context.coverage.answerProjection.omittedEvidence=noProjectedDirect.context.coverage.answerProjection.eligibleEvidence-noProjectedDirect.context.evidence.length;
noProjectedDirect.context.coverage.answerProjection.omittedDirect+=bounded.context.evidence.filter(row=>row.supportRelation==='requested_detail').length;
assert.equal(projectCmcpEvidenceLookupAnswerInput({user:{sourceAuthorRole:'user',text:question},answerHistory:noProjectedDirect}).answerTask.disposition,
  'report_incomplete_check','omitted direct support cannot become a checked-scope absence claim');
const seven=structuredClone(direct);
for(let index=4;index<=7;index++)seven.evidence.push({...structuredClone(direct.evidence[2]),ref:'r'+index,
  messageRecordedAt:`2026-09-23T03:${String(index).padStart(2,'0')}:00.000Z`});
seven.coverage={...seven.coverage,sourceCount:7,completedSources:7};
const sevenBounded=lookup(seven,null,2000);
assert.equal(validAnswerHistoryProjection(sevenBounded),true);
assert.ok(sevenBounded.context.coverage.answerProjection.omittedEvidence>0);
assert.equal(sevenBounded.context.coverage.completeWithinFrozenScope,true,
  'formal source completion is distinct from the subset supplied to this answer');
assert.equal(projectCmcpEvidenceLookupAnswerInput({user:{sourceAuthorRole:'user',text:question},answerHistory:sevenBounded}).answerTask.disposition,
  'report_incomplete_check','a direct-only projection cannot pretend the contrasted version was supplied');
if(!sevenBounded.context.evidence.some(row=>row.sourceRef==='r1'))
  assert.ok(sevenBounded.context.coverage.answerProjection.omittedRelated>0,
    'a missing contrasted source is explicitly visible when the answer cap cannot fit it');
const derivedOnlyDirect=structuredClone(direct);derivedOnlyDirect.evidence.find(row=>row.ref==='r3').contentKind='derived_summary';
const filtered=lookup(derivedOnlyDirect);assert.equal(filtered.context.finding,'related_historical_context_only');
assert.deepEqual(filtered.context.evidence.map(row=>row.sourceRef),['r1','r2']);
assert.equal(validAnswerHistoryProjection(filtered),true);
// A completed formal read can still have false-positive support labels for a
// different named subject. The answer projection must keep the current named
// subject's verified originals and their complete bodies ahead of those quotes.
const namedQuestion='請查證 Nacre Build System 的部署說明初稿與修訂稿，以及 Assistant 的 legacy endpoint 兩行原文。';
const targetBodies=new Map([
  ['r42','Nacre Build System deployment note, first User request: describe the legacy endpoint and initial staging route.'],
  ['r43','Nacre Build System first Assistant draft:\nLegacy endpoint line one: /api/legacy-v1\nThis is a draft, not an approved rollout.'],
  ['r44','Please revise the note we just drafted: correct the rollout wording and include the second legacy endpoint.'],
  ['r45','Nacre Build System revised Assistant draft:\nLegacy endpoint line one: /api/legacy-v1\nLegacy endpoint line two: /api/legacy-v2\n'+
    'The second line belongs to this revised Assistant original. '.repeat(7)]
]);
const falseSupportRefs=['r19','r20','r21','r22','r23','r24','r25'];
const falseBodies=new Map(falseSupportRefs.map((ref,index)=>[ref,
  `Harborline Museum support note ${index+1}: the audio guide and gallery permit remain under review. `+
  'This is a separate named subject with no deployment instructions. '.repeat(8)]));
const anaphoricBody='The earlier deployment note kept /api/legacy-v1 as a draft; its project name was implicit in this follow-up.';
const allBodies=new Map([...falseBodies,['r26',anaphoricBody],...targetBodies]);
const namedEvidence=[...allBodies].map(([ref,body],index)=>{
  const quote=[...body].slice(0,falseBodies.has(ref)?420:ref==='r45'?66:80).join('');
  return {ref,sourceAuthorRole:ref==='r43'||ref==='r45'?'assistant':'user',
    supportRelation:ref==='r26'||ref==='r44'?'related_historical_detail':'requested_detail',
    citation:{unit:'unicode_code_points',start:0,end:[...quote].length,text:quote},contentKind:'source_excerpt',
    evidenceHash:loopHash(['named-subject-source',ref,body]),
    messageRecordedAt:`2026-09-${ref==='r26'?'22':falseBodies.has(ref)?'24':'23'}T${String(index).padStart(2,'0')}:00:00.000Z`,eventOccurredAt:null};
});
const namedAggregate={...structuredClone(direct),question:namedQuestion,evidence:namedEvidence,
  coverage:{...structuredClone(direct.coverage),sourceCount:45,completedSources:45}};
const namedReadSources={kind:'cmcp_verified_read_source_projection',sources:namedEvidence.map(row=>({
  ref:row.ref,evidenceHash:row.evidenceHash,sourceAuthorRole:row.sourceAuthorRole,
  contentKind:'source_excerpt',codePoints:[...allBodies.get(row.ref)].length,text:allBodies.get(row.ref)}))};
const namedProjected=lookup(namedAggregate,namedReadSources);
assert.equal(validAnswerHistoryProjection(namedProjected),true);
assert.ok(Buffer.byteLength(JSON.stringify(namedProjected))<=8192);
assert.deepEqual([...targetBodies.keys()].filter(ref=>!namedProjected.context.evidence.some(row=>row.sourceRef===ref)),[],
  'both User requests and Assistant drafts survive the answer cap when a revision is anaphoric');
const revisedUser=namedProjected.context.evidence.find(row=>row.sourceRef==='r44');
assert.equal(revisedUser.sourceAuthorRole,'user');
assert.equal(revisedUser.supportRelation,'related_historical_detail');
assert.equal(revisedUser.content.text,targetBodies.get('r44'));
assert.equal(revisedUser.projectedCoverage,'complete_retained_body');
const revisedAssistant=namedProjected.context.evidence.find(row=>row.sourceRef==='r45');
assert.equal(revisedAssistant.content.text,targetBodies.get('r45'),'the second Assistant legacy-endpoint line survives verbatim');
assert.equal(revisedAssistant.projectedCoverage,'complete_retained_body');
assert.equal(revisedAssistant.sourceAuthorRole,'assistant');
assert.equal(revisedAssistant.messageRecordedAt,namedEvidence.find(row=>row.ref==='r45').messageRecordedAt);
const olderAnaphoric=namedProjected.context.evidence.find(row=>row.sourceRef==='r26');
assert.equal(olderAnaphoric?.supportRelation,'related_historical_detail',
  'the older same-subject related source remains a representative under answer pressure');
assert.equal(olderAnaphoric?.sourceAuthorRole,'user');
assert.equal(olderAnaphoric?.messageRecordedAt,namedEvidence.find(row=>row.ref==='r26').messageRecordedAt);
assert.equal(allBodies.get('r26').includes('Nacre Build System'),false,'the anaphoric original omits the named subject');
assert.equal(namedProjected.context.coverage.readSources,45,'the formal read count remains independent from answer projection');
assert.ok(namedProjected.context.coverage.answerProjection.omittedEvidence>0);
assert.equal(namedProjected.context.coverage.answerProjection.omittedDirect+namedProjected.context.coverage.answerProjection.omittedRelated,
  namedProjected.context.coverage.answerProjection.omittedEvidence);
assert.equal(projectCmcpEvidenceLookupAnswerInput({user:{sourceAuthorRole:'user',text:namedQuestion},answerHistory:namedProjected}).answerTask.disposition,
  'report_incomplete_check','omitted classifier support is never treated as absent from the formal read');
console.log(JSON.stringify({status:'PASS',checks:58,sourceCount:4,readPages:pages.length,productApiPosts:0,
  aliasNonSupportRetained:true,
  namedSubjectProjection:{refs:namedProjected.context.evidence.map(row=>row.sourceRef),
    r45Coverage:revisedAssistant.projectedCoverage,omitted:namedProjected.context.coverage.answerProjection.omittedEvidence},
  sevenSourceProjection:{refs:sevenBounded.context.evidence.map(row=>row.sourceRef),
    omittedDirect:sevenBounded.context.coverage.answerProjection.omittedDirect,
    omittedRelated:sevenBounded.context.coverage.answerProjection.omittedRelated,
    disposition:projectCmcpEvidenceLookupAnswerInput({user:{sourceAuthorRole:'user',text:question},answerHistory:sevenBounded}).answerTask.disposition},
  boundary:'related_original_and_assistant_text_preserve_separate_roles_and_are_not_final_decisions; complete_small_source_only_within_existing_projection_budget'}));
