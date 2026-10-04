import assert from 'node:assert/strict';
import {buildCmcpNaturalTemporalRequest,normalizeCmcpNaturalTemporalSelection} from '../src/cmcp-guard/cmcp-natural-temporal-reading.js';

// Explicit offline selector contract. This only validates the program's scope
// decision and never reads History or calls a model.
const eventMap=[{ref:'e1',key:'one'},{ref:'e2',key:'two'}];
const input={protocolVersion:2,question:'請看先前普通對話',runtimeTime:{},ordinaryHistory:{registeredSources:2},
  events:[{ref:'e1'},{ref:'e2'}],segments:[],coverage:{navigation:'compact_all_declared_locators'}};
const prepared={eventMap,segmentMap:[],input};
const request=buildCmcpNaturalTemporalRequest(input);
const zeroBranch=request.schema.anyOf.find(branch=>branch.properties.eventRefs.maxItems===0);
assert.ok(zeroBranch.properties.scope.anyOf.some(scope=>scope.properties?.basis?.enum?.includes('ordinary_history')));
assert.match(request.instructions,/ordinary_history uses eventRefs=\[\] and clarification=""/);
assert.deepEqual(zeroBranch.properties.clarification.enum,['']);
const ambiguous=normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:['e1','e2'],
  scope:{basis:'ordinary_history'},clarification:''},prepared);
assert.equal(ambiguous.status,'needs_clarification');
assert.deepEqual(ambiguous.eventCandidates,['one','two']);
const selected=normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},prepared);
assert.deepEqual(selected,{status:'selected',kind:'ordinary',eventKey:null});
assert.throws(()=>normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:[],scope:{basis:'ordinary_history'},
  clarification:'Sources are registered, so read ordinary history.'},prepared),/invalid_ordinary_history_scope/);
const dated=normalizeCmcpNaturalTemporalSelection({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
  {...prepared,input:{...input,question:'只看 2026-09-22 的原文'}});
assert.equal(dated.status,'needs_clarification');
assert.equal(dated.reason,'ordinary_history_conflicts_with_explicit_calendar');
console.log(JSON.stringify({status:'PASS',cases:4,modelCalls:0,sourceReads:0}));
