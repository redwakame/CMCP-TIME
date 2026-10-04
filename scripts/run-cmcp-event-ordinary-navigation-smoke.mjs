// Synthetic navigation contract regression: no provider, History, or model call.
import assert from 'node:assert/strict';
import {buildCmcpNaturalTemporalCatalog,buildCmcpNaturalTemporalRequest,
 refineCmcpNaturalTemporalCatalog,normalizeCmcpNaturalTemporalSelection} from '../src/cmcp-guard/cmcp-natural-temporal-reading.js';
import {validateLoopSchema} from '../src/cmcp-guard/cmcp-local-loop-protocol.js';
import {resolveCmcpTimeContext} from '../src/cmcp-guard/resolve-cmcp-time-context.js';

const timeContext=resolveCmcpTimeContext({now:'2026-09-27T04:00:00Z',timezone:'Asia/Taipei'});
const offersScope=(schema,basis)=>schema.anyOf.some(branch=>
 (branch.properties.scope.anyOf??[branch.properties.scope]).some(scope=>scope.properties?.basis?.enum?.includes(basis)));
const scopeId='synthetic-navigation',events=[
 {key:'studio',event:{scopeId,eventId:'studio'},objects:[{objectId:'studio-exhibition',aspects:['arrangements','progress']}]},
 {key:'harbor',event:{scopeId,eventId:'harbor'},objects:[{objectId:'harbor-exhibition',aspects:['arrangements','progress']}]}];
function pointer(id){return {version:1,providerNamespace:'synthetic-console',scopeId,itemId:id,sessionId:'synthetic-session',revisionId:'r1'};}
function entry(id,text,role,eventScope=null){
 const excerpt=[...text].slice(0,80).join('');
 return {pointer:pointer(id),eventScope,sourceAuthorRole:role,messageRecordedAt:'2026-09-26T19:00:00Z',
  sourceHint:{kind:'source_excerpt',text:excerpt,purpose:'source_locator_not_complete_evidence',
   location:{unit:'unicode_code_points',start:0,end:[...excerpt].length},complete:[...text].length<81}};
}
const eventEntries=[
 entry('s1','Studio lantern room opens on Thursday if inspection passes.','user',events[0].event),
 entry('h1','Cedar Harbor display east pier opens Tuesday after inspection.','user',events[1].event),
 entry('h2','The Cedar Harbor east pier opens Tuesday after inspection.','assistant',events[1].event)];
function segment(eventKey,id,text){return {eventKey,segmentId:id,segmentHash:id+'-hash',startDate:'2026-09-27',timezone:'Asia/Taipei',
 firstMessageAt:'2026-09-26T19:00:00Z',firstLocal:'2026-09-27T03:00:00+08:00',lastIncludedLocal:'2026-09-27T03:00:00+08:00',
 sourceCount:1,crossesLocalDateBoundary:false,sources:[{pointer:pointer(id),sourceAuthorRole:'user',range:{unit:'unicode_code_points',
  start:0,end:[...text].length,text}}]};}
const segments=[segment('studio','s1',eventEntries[0].sourceHint.text),segment('harbor','h1',eventEntries[1].sourceHint.text)];
const ordinary=Array.from({length:14},(_,i)=>entry('o'+i,i===0?'The Cedar Harbor display comparison note.':
 `Ordinary note ${i}: ${'另一個展示空間的日常安排'.repeat(6)}`,
 i%2?'assistant':'user'));
ordinary.push(entry('o14','For the Harborline Museum audio guide, draft the east gallery opening on Tuesday only if electrical inspection passes.','user'));
ordinary.push(entry('o15','The Harborline Museum east gallery opens Tuesday only if electrical inspection passes.','assistant'));
ordinary.push(entry('o16','Revise Harborline Museum: Sunday after accessibility inspection; Tuesday was the first draft.','user'));
ordinary.push(entry('o17','Harborline Museum revised notice: Sunday after accessibility inspection.','assistant'));
const entries=[...eventEntries,...ordinary],question='Harborline Museum 東側展廳的導覽通知，第一版與後來修訂版各說哪一天開放、各有什麼檢查條件？';
const prepared=buildCmcpNaturalTemporalCatalog({question,events,segments,entries,timeContext,maxBytes:6000});
assert.equal(prepared.input.coverage.navigation,'metadata_first');
assert.ok(prepared.input.ordinaryHistory.sourceHints.some(row=>row.locator?.text.includes('Harborline Museum')));
const navigationSchema=buildCmcpNaturalTemporalRequest(prepared.input).schema;
const schemaAccepts=value=>validateLoopSchema(value,navigationSchema);
const emptyLookup={version:2,eventRefs:[],scope:{basis:'discussion_lookup'},clarification:''};
assert.equal(schemaAccepts(emptyLookup),false,'a discussion lookup cannot omit its event');
assert.throws(()=>normalizeCmcpNaturalTemporalSelection(emptyLookup,prepared),/invalid_temporal_intent_disposition/,
 'the recorded invalid choice remains fail-closed, without choosing an event or ordinary History for the model');
const selectedLookup={version:2,eventRefs:['e1'],scope:{basis:'discussion_lookup'},clarification:''};
assert.equal(schemaAccepts(selectedLookup),true);
assert.equal(normalizeCmcpNaturalTemporalSelection(selectedLookup,prepared).status,'needs_navigation');
assert.equal(schemaAccepts({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''}),true);
assert.equal(schemaAccepts({version:2,eventRefs:['e1'],scope:{basis:'ordinary_history'},clarification:''}),false);
assert.equal(schemaAccepts({version:2,eventRefs:['e1'],scope:{basis:'event'},clarification:''}),true);
assert.equal(schemaAccepts({version:2,eventRefs:[],scope:{basis:'event'},clarification:''}),false);
const unresolved={version:2,eventRefs:['e1','e2'],scope:{basis:'unresolved',disposition:'needs_clarification'},
 clarification:'Two events remain plausible.'};
assert.equal(schemaAccepts(unresolved),true);
assert.equal(normalizeCmcpNaturalTemporalSelection(unresolved,prepared).status,'needs_clarification');
const prematureClarification={version:2,eventRefs:['e1'],scope:{basis:'unresolved',disposition:'needs_clarification'},
 clarification:'Should I search the ordinary conversation?'};
assert.equal(schemaAccepts(prematureClarification),true);
assert.deepEqual(normalizeCmcpNaturalTemporalSelection(prematureClarification,prepared),{
 status:'needs_navigation',reason:'event_ordinary_comparison_not_yet_checked',eventCandidates:['studio'],
 modelDisposition:'needs_clarification',historyAbsence:'not_established'});
assert.equal(normalizeCmcpNaturalTemporalSelection({...prematureClarification,eventRefs:[]},prepared).status,'needs_clarification',
 'without an event candidate Runtime has no event to refine');
assert.equal(schemaAccepts({version:2,eventRefs:[],scope:{basis:'message_time',calendarRanges:[
 {fromLocal:'2026-09-27',toLocal:'2026-09-28',timezone:'Asia/Taipei'}]},clarification:''}),true);
const firstRaw={version:2,eventRefs:['e2'],scope:{basis:'event'},clarification:''};
assert.deepEqual(normalizeCmcpNaturalTemporalSelection(firstRaw,prepared),{status:'needs_navigation',eventKey:'harbor',
 eventCandidates:['harbor'],reason:'event_metadata_requires_ordinary_comparison',historyAbsence:'not_established'});
const refined=refineCmcpNaturalTemporalCatalog({prepared,eventKey:'harbor',question,events,segments,entries,timeContext,maxBytes:6000});
assert.equal(refined.refinement.status,'locators_ready');
const clarifiedComparison=refineCmcpNaturalTemporalCatalog({prepared,eventKey:'studio',question,events,segments,entries,
 timeContext,maxBytes:6000});
assert.equal(clarifiedComparison.refinement.status,'locators_ready');
assert.ok(Buffer.byteLength(JSON.stringify(clarifiedComparison.input))<=6000);
const comparedHints=clarifiedComparison.input.ordinaryHistory.sourceHints.filter(row=>row.locator?.text.includes('Harborline Museum'));
assert.ok(comparedHints.some(row=>row.author==='user'));
assert.ok(comparedHints.some(row=>row.author==='assistant'));
assert.ok(comparedHints.every(row=>row.messageRecordedAt==='2026-09-26T19:00:00Z'),
 'bounded comparison keeps the registered source role and message time');
assert.deepEqual(normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},clarifiedComparison),
 {status:'selected',kind:'ordinary',eventKey:null},'the second model must explicitly choose ordinary History');
assert.equal(normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:['e1'],
 scope:{basis:'unresolved',disposition:'needs_clarification'},clarification:'Still ambiguous.'},clarifiedComparison).status,
 'needs_clarification','genuine ambiguity remains available after bounded comparison');
assert.equal(refined.input.ordinaryHistory.registeredSources,18);
assert.ok(refined.input.ordinaryHistory.sourceHints.some(row=>row.locator?.text.includes('Harborline Museum')));
assert.ok(refined.input.events[0].sourceHints?.some(row=>row.locator?.text.includes('Cedar Harbor'))
 ||refined.input.segments.some(row=>row.locator?.text.includes('Cedar Harbor')));
assert.ok(Buffer.byteLength(JSON.stringify(refined.input))<=6000);
assert.ok(offersScope(buildCmcpNaturalTemporalRequest(refined.input).schema,'ordinary_history'));
assert.deepEqual(normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},refined),
 {status:'selected',kind:'ordinary',eventKey:null});
const wrongSecond=normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:['e1'],scope:{basis:'event'},clarification:''},refined);
assert.equal(wrongSecond.status,'needs_clarification');
assert.equal(wrongSecond.reason,'selected_event_conflicts_with_ordinary_locator');
const rightEventQuestion='The Cedar Harbor display east pier 的第一版說明是什麼？';
const rightEvent=refineCmcpNaturalTemporalCatalog({prepared,eventKey:'harbor',question:rightEventQuestion,events,segments,entries,timeContext,maxBytes:6000});
assert.equal(normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:['e1'],scope:{basis:'event'},clarification:''},rightEvent).kind,'event');
const prefixEventEntries=[eventEntries[0],entry('h1','The Cedar Harborline display east pier opens Tuesday after inspection.','user',events[1].event)];
const prefixSegments=[segments[0],segment('harbor','h1',prefixEventEntries[1].sourceHint.text)];
const prefixEntries=[...prefixEventEntries,...ordinary];
const prefixPrepared=buildCmcpNaturalTemporalCatalog({question:rightEventQuestion,events,segments:prefixSegments,
 entries:prefixEntries,timeContext,maxBytes:6000});
assert.equal(prefixPrepared.input.coverage.navigation,'metadata_first');
const prefixRefined=refineCmcpNaturalTemporalCatalog({prepared:prefixPrepared,eventKey:'harbor',question:rightEventQuestion,
 events,segments:prefixSegments,entries:prefixEntries,timeContext,maxBytes:6000});
assert.equal(prefixRefined.anchorEvidence.eventMatched.length,0);
assert.ok(prefixRefined.anchorEvidence.ordinaryMatched.includes('the cedar harbor'));
const prefixWrong=normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:['e1'],scope:{basis:'event'},clarification:''},prefixRefined);
assert.equal(prefixWrong.status,'needs_clarification');
assert.equal(prefixWrong.reason,'selected_event_conflicts_with_ordinary_locator');
const thirdEventEntries=[eventEntries[0],
 entry('h1','East pier opens Tuesday after inspection.','user',events[1].event),
 entry('h2','The east pier opens Tuesday after inspection.','assistant',events[1].event),
 entry('h3','Cedar Harbor display east pier opens Tuesday after inspection.','user',events[1].event)];
const thirdSegments=[segments[0],segment('harbor','h1',thirdEventEntries[1].sourceHint.text)];
const thirdEntries=[...thirdEventEntries,...ordinary];
const thirdPrepared=buildCmcpNaturalTemporalCatalog({question:rightEventQuestion,events,segments:thirdSegments,
 entries:thirdEntries,timeContext,maxBytes:6000});
assert.equal(thirdPrepared.input.coverage.navigation,'metadata_first');
const thirdRefined=refineCmcpNaturalTemporalCatalog({prepared:thirdPrepared,eventKey:'harbor',question:rightEventQuestion,
 events,segments:thirdSegments,entries:thirdEntries,timeContext,maxBytes:6000});
assert.equal(thirdRefined.refinement.status,'locators_ready');
assert.equal(thirdRefined.anchorEvidence.eventHints,3);
assert.ok(thirdRefined.anchorEvidence.eventMatched.includes('the cedar harbor'));
assert.ok(thirdRefined.input.events[0].sourceHints?.some(row=>row.locator?.text.includes('Cedar Harbor')));
assert.equal(normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:['e1'],scope:{basis:'event'},clarification:''},
 thirdRefined).kind,'event');
const manyEntries=[...entries,...Array.from({length:50},(_,i)=>entry('later'+i,
 `Later ordinary conversation ${i}: ${'另一種展示空間的普通記錄'.repeat(6)}`,i%2?'assistant':'user'))];
const manyPrepared=buildCmcpNaturalTemporalCatalog({question,events,segments,entries:manyEntries,timeContext,maxBytes:6000});
assert.equal(manyPrepared.input.coverage.navigation,'metadata_first');
const manyRefined=refineCmcpNaturalTemporalCatalog({prepared:manyPrepared,eventKey:'harbor',question,events,segments,
 entries:manyEntries,timeContext,maxBytes:6000});
assert.equal(manyRefined.refinement.status,'locators_ready');
assert.equal(manyRefined.input.ordinaryHistory.locatorCoverage,'partial');
assert.ok(!manyRefined.input.ordinaryHistory.sourceHints.some(row=>row.locator?.text.includes('Harborline Museum')));
const missedCompetitor=normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:['e1'],scope:{basis:'event'},clarification:''},manyRefined);
assert.equal(missedCompetitor.status,'needs_clarification');
assert.equal(missedCompetitor.reason,'selected_event_conflicts_with_ordinary_locator');
assert.ok(manyRefined.anchorEvidence.ordinaryMatched.includes('harborline museum'));
const legacyEntries=[...eventEntries,...ordinary.map(({sourceHint,...row})=>row)];
const legacySegments=[...segments,...Array.from({length:16},(_,i)=>({...segments[0],
 segmentId:'extra-studio-'+i,segmentHash:'extra-studio-hash-'+i}))];
function legacyComparison(legacyQuestion){
 const candidate=buildCmcpNaturalTemporalCatalog({question:legacyQuestion,events,segments:legacySegments,
  entries:legacyEntries,timeContext,maxBytes:6000});
 assert.equal(candidate.input.coverage.navigation,'metadata_first');
 const comparison=refineCmcpNaturalTemporalCatalog({prepared:candidate,eventKey:'harbor',question:legacyQuestion,
  events,segments:legacySegments,entries:legacyEntries,timeContext,maxBytes:6000});
 return comparison;
}
const legacyTrue=legacyComparison(rightEventQuestion);
assert.equal(legacyTrue.refinement.status,'locators_ready');
assert.equal(legacyTrue.input.ordinaryHistory.registeredSources,18);
assert.equal(legacyTrue.input.ordinaryHistory.projectedSourceHints,0);
assert.equal(normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:['e1'],scope:{basis:'event'},clarification:''},
 legacyTrue).kind,'event');
const legacyWrong=legacyComparison(question);
assert.equal(legacyWrong.refinement.status,'ordinary_comparison_locators_unavailable');
const calendar=normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:[],scope:{basis:'message_time',calendarRanges:[
 {fromLocal:'2026-09-27',toLocal:'2026-09-28',timezone:'Asia/Taipei'}]},clarification:''},prepared);
assert.equal(calendar.kind,'calendar');
const noOrdinary=buildCmcpNaturalTemporalCatalog({question,events,segments,entries:eventEntries,timeContext,maxBytes:6000});
if(noOrdinary.input.coverage.navigation==='metadata_first'){
 assert.equal(normalizeCmcpNaturalTemporalSelection(firstRaw,noOrdinary).kind,'event');
 assert.equal(normalizeCmcpNaturalTemporalSelection(prematureClarification,noOrdinary).status,'needs_clarification');
}
console.log(JSON.stringify({status:'PASS',cases:37,firstCatalogBytes:Buffer.byteLength(JSON.stringify(prepared.input)),
 refinedCatalogBytes:Buffer.byteLength(JSON.stringify(refined.input)),manyRefinedHints:manyRefined.input.ordinaryHistory.projectedSourceHints,
 legacyEventHints:legacyTrue.anchorEvidence.eventHints,firstStatus:'needs_navigation',refinedStatus:refined.refinement.status,
 modelCalls:0,sourceReads:0}));
