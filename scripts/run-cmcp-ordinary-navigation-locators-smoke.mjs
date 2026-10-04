// Synthetic catalog-only regression. No History resolution, provider, or Host call.
import assert from 'node:assert/strict';
import {buildCmcpNaturalTemporalCatalog,buildCmcpNaturalTemporalRequest,
 normalizeCmcpNaturalTemporalSelection} from '../src/cmcp-guard/cmcp-natural-temporal-reading.js';
import {resolveCmcpTimeContext} from '../src/cmcp-guard/resolve-cmcp-time-context.js';

const zone='Asia/Taipei',timeContext=resolveCmcpTimeContext({now:'2026-09-25T22:11:06.925Z',timezone:zone});
const studio={scopeId:'offline-navigation',eventId:'studio'},harbor={scopeId:'offline-navigation',eventId:'harbor'};
const events=[{key:'studio',event:studio,objects:[{objectId:'studio-display',aspects:['arrangements']}]},
 {key:'harbor',event:harbor,objects:[{objectId:'harbor-display',aspects:['arrangements']}]}];
const segments=[{eventKey:'studio',segmentId:'studio-discussion',segmentHash:'studio-hash',startDate:'2026-09-23',timezone:zone,
 firstMessageAt:'2026-09-22T22:28:11.722Z',firstLocal:'2026-09-23T06:28:11.722+08:00',
 lastIncludedLocal:'2026-09-23T06:28:49.473+08:00',sourceCount:2,crossesLocalDateBoundary:false,sources:[]},
 {eventKey:'harbor',segmentId:'harbor-discussion',segmentHash:'harbor-hash',startDate:'2026-09-23',timezone:zone,
 firstMessageAt:'2026-09-22T23:10:17.364Z',firstLocal:'2026-09-23T07:10:17.364+08:00',
 lastIncludedLocal:'2026-09-23T07:10:20.775+08:00',sourceCount:2,crossesLocalDateBoundary:false,sources:[]}];
function entry(text,role,time,eventScope=null){
 const points=[...text],excerpt=points.slice(0,80).join('');
 return {eventScope,sourceAuthorRole:role,messageRecordedAt:time,sourceHint:{kind:'source_excerpt',text:excerpt,
  purpose:'source_locator_not_complete_evidence',location:{unit:'unicode_code_points',start:0,end:[...excerpt].length},
  complete:points.length<=80}};
}
const entries=[
 entry('For the studio display, the lantern room opens Thursday after inspection.','user','2026-09-22T22:28:11.722Z',studio),
 entry('The lantern room opens Thursday after inspection.','assistant','2026-09-22T22:28:15.067Z',studio),
 entry('For the harbor display, the east pier opens Tuesday after inspection.','user','2026-09-22T23:10:17.364Z',harbor),
 entry('First Meridian Annex note: archive desk opens Wednesday after permit approval.','user','2026-09-25T22:10:32.901Z'),
 entry('The archive desk opens Wednesday after permit approval.','assistant','2026-09-25T22:10:34.597Z')];
const question='Update that Meridian Annex note for the later version: Friday after permit approval, not Wednesday.';
const full=buildCmcpNaturalTemporalCatalog({question,events,segments,entries,timeContext,maxBytes:8192});
assert.equal(full.input.ordinaryHistory.registeredSources,2);
assert.equal(full.input.ordinaryHistory.projectedSourceHints,2);
assert.equal(full.input.ordinaryHistory.locatorCoverage,'all_registered_source_hints');
assert.deepEqual(full.input.ordinaryHistory.sourceHints.map(row=>row.author),['user','assistant']);
assert.match(full.input.ordinaryHistory.sourceHints[0].locator.text,/Meridian Annex/);
assert.equal(full.input.ordinaryHistory.sourceHints[0].locator.location.unit,'unicode_code_points');
assert.equal(full.input.coverage.historyCompleteness,'not_established');
assert.ok(full.input.events.every(event=>event.sourceHints.every(row=>!row.locator?.text.includes('Meridian Annex'))));
const ordinarySchema=buildCmcpNaturalTemporalRequest(full.input).schema;
assert.ok(ordinarySchema.anyOf.some(branch=>(branch.properties.scope.anyOf??[branch.properties.scope])
 .some(scope=>scope.properties?.basis?.enum?.includes('ordinary_history'))));
assert.deepEqual(normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},full),
 {status:'selected',kind:'ordinary',eventKey:null});
assert.deepEqual(normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:['e1'],scope:{basis:'event'},clarification:''},full),
 {status:'selected',kind:'event',eventKey:'studio'});
const legacy=buildCmcpNaturalTemporalCatalog({question,events,segments,entries:[...entries,
 {sourceAuthorRole:'user',messageRecordedAt:'2026-09-25T22:10:35.000Z'}],timeContext,maxBytes:8192});
assert.equal(legacy.input.ordinaryHistory.registeredSources,3);
assert.equal(legacy.input.ordinaryHistory.availableSourceHints,2);
assert.equal(legacy.input.ordinaryHistory.locatorCoverage,'partial');
const eight=[...entries];for(let i=0;i<6;i++)eight.push(entry(`Meridian Annex registered note ${i}: ${'b'.repeat(55)}`,
 i%2?'assistant':'user',`2026-09-25T22:09:${String(i).padStart(2,'0')}.000Z`));
const boundedEight=buildCmcpNaturalTemporalCatalog({question,events,segments,entries:eight,timeContext,maxBytes:6000});
assert.equal(boundedEight.input.ordinaryHistory.registeredSources,8);
assert.equal(boundedEight.input.ordinaryHistory.projectedSourceHints,8);
assert.equal(boundedEight.input.ordinaryHistory.locatorCoverage,'all_registered_source_hints');
assert.ok(Buffer.byteLength(JSON.stringify(boundedEight.input))<=6000);
const compactEight=buildCmcpNaturalTemporalCatalog({question,events,segments,entries:eight,timeContext,maxBytes:5000});
assert.equal(compactEight.input.coverage.navigation,'compact_all_declared_locators');
assert.equal(compactEight.input.ordinaryHistory.projectedSourceHints,8);
assert.ok(Buffer.byteLength(JSON.stringify(compactEight.input))<=5000);
assert.equal(compactEight.navigation.fullCatalogBytes,Buffer.byteLength(JSON.stringify(boundedEight.input)));

const many=[...entries];for(let i=0;i<60;i++)many.push(entry(`Ordinary registered ${i}: ${'a'.repeat(75)} ${i}`,
 i%2?'assistant':'user',`2026-09-24T00:${String(i).padStart(2,'0')}:00.000Z`));
const maxBytes=3600,partial=buildCmcpNaturalTemporalCatalog({question,events,segments,entries:many,timeContext,maxBytes});
const partialBytes=Buffer.byteLength(JSON.stringify(partial.input));
assert.ok(partialBytes<=maxBytes);
assert.equal(partial.input.ordinaryHistory.registeredSources,62);
assert.equal(partial.input.ordinaryHistory.availableSourceHints,62);
assert.equal(partial.input.ordinaryHistory.locatorCoverage,'partial');
assert.ok(partial.input.ordinaryHistory.projectedSourceHints>0);
assert.ok(partial.input.ordinaryHistory.projectedSourceHints<62);
assert.equal(partial.input.ordinaryHistory.sourceHints.length,partial.input.ordinaryHistory.projectedSourceHints);
assert.equal(partial.input.coverage.historyCompleteness,'not_established');
assert.ok(buildCmcpNaturalTemporalRequest(partial.input).schema.anyOf.some(branch=>
 (branch.properties.scope.anyOf??[branch.properties.scope]).some(scope=>scope.properties?.basis?.enum?.includes('ordinary_history'))));
assert.equal(normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},partial).kind,'ordinary');
const largeEntries=Array.from({length:16384},(_,i)=>entry(`Registered ordinary source ${i}: ${'c'.repeat(48)}`,
 i%2?'assistant':'user',null));
const large=buildCmcpNaturalTemporalCatalog({question,events,segments,entries:largeEntries,timeContext,maxBytes});
assert.equal(large.input.ordinaryHistory.registeredSources,16384);
assert.equal(large.input.ordinaryHistory.availableSourceHints,16384);
assert.equal(large.input.ordinaryHistory.locatorCoverage,'partial');
assert.ok(large.input.ordinaryHistory.projectedSourceHints<=64);
assert.ok(Buffer.byteLength(JSON.stringify(large.input))<=maxBytes);
assert.ok(large.navigation.fullCatalogBytes>maxBytes);

const dated=buildCmcpNaturalTemporalCatalog({question:'Only original messages from 2026-09-23',events,segments,entries,timeContext,maxBytes:8192});
const calendar=normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:[],scope:{basis:'message_time',calendarRanges:[
 {fromLocal:'2026-09-23',toLocal:'2026-09-24',timezone:zone}]},clarification:''},dated);
assert.equal(calendar.kind,'calendar');
assert.equal(calendar.eventKey,null);
assert.equal(normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},dated).reason,
 'ordinary_history_conflicts_with_explicit_calendar');

console.log(JSON.stringify({status:'PASS',cases:8,fullBytes:Buffer.byteLength(JSON.stringify(full.input)),eightBytes:Buffer.byteLength(JSON.stringify(boundedEight.input)),compactEightBytes:Buffer.byteLength(JSON.stringify(compactEight.input)),partialBytes,
 maxBytes,partialHints:partial.input.ordinaryHistory.projectedSourceHints,registered:partial.input.ordinaryHistory.registeredSources,
 largeRegistered:large.input.ordinaryHistory.registeredSources,largeProjected:large.input.ordinaryHistory.projectedSourceHints,
 modelCalls:0,sourceReads:0}));
