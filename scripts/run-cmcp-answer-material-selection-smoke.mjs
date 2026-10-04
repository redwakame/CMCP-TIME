// 合成原件／替身選取；期待來源只在測試端，零產品API。
import assert from 'node:assert/strict';
import {loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {prepareCmcpAnswerMaterialSelection,selectCmcpAnswerMaterial,buildCmcpAnswerMaterialSelectionRequest} from '../src/cmcp-guard/cmcp-answer-material-selection.js';
import {projectCmcpAnswerHistoryLookup,projectCmcpEvidenceLookupAnswerInput} from '../src/cmcp-guard/cmcp-answer-history.js';
import {validAnswerHistoryProjection} from '../src/cmcp-guard/cmcp-responses-transport.js';
import {buildLoopRequest} from '../src/cmcp-guard/cmcp-local-loop-protocol.js';
const originals=Array.from({length:12},(_,i)=>({ref:'r'+(i+1),sourceAuthorRole:i%2?'assistant':'user',contentKind:'source_excerpt',
  text:i===0?'準備一份館藏借閱規則草稿，館外借閱只對會員開放；這不是已核准規定。':
    i===1?'館藏借閱規則初稿：會員可於週三借閱館外；非會員只能館內閱覽。尚待委員會批准。'+('補充說明：這份文字仍屬提案。'.repeat(45)):
    i===2?'請改剛才那份草稿：借閱日延後至週五，審核改成館長簽署，但非會員仍不能帶出。':
    i===3?'館藏借閱規則修訂：週五起供會員館外借閱，仍須館長簽署。非會員僅限館內，並未核准。':
      '相近但不同主題的運輸安排：週五配送，等待收貨者簽署。'+('此段只屬運輸，不是借閱規則。'.repeat(12))}));
for(const row of originals){row.codePoints=[...row.text].length;row.evidenceHash=loopHash(row.text);}
const evidence=originals.map((row,i)=>({ref:row.ref,sourceAuthorRole:row.sourceAuthorRole,contentKind:row.contentKind,evidenceHash:row.evidenceHash,
  supportRelation:i<2?'related_historical_detail':'requested_detail',messageRecordedAt:new Date(Date.UTC(2026,8,1,0,i)).toISOString(),eventOccurredAt:null,
  citation:{unit:'unicode_code_points',start:0,end:12,text:[...row.text].slice(0,12).join('')}}));
const result={kind:'cmcp_history_query_result',requestId:'synthetic',status:'completed',publication:{status:'verified'},sourceCollectionKind:'ordinary',
  aggregate:{kind:'cmcp_history_aggregate',purpose:'evidence_lookup',question:'比較館藏借閱草稿兩版的改動與保留限制，區分我提出的修改和你的實際文字。',status:'complete_within_frozen_scope',finding:'supported_evidence',evidence,
    coverage:{sourceCount:12,completedSources:12,unavailableSources:0,unread:[],unclassified:[],uncertain:[],ambiguousRevisions:[],partialSources:[]}}};
const verifiedReadSources={kind:'cmcp_verified_read_source_projection',manifestHash:loopHash(originals),sources:originals,
  replyBindings:[{assistantRef:'r2',userRef:'r1'},{assistantRef:'r4',userRef:'r3'}]};
const options={result,verifiedReadSources,needBasis:'prior_content_reference',maxProjectionBytes:8192,timezone:'America/New_York'};
const baseline=projectCmcpAnswerHistoryLookup(options);
const prepared=prepareCmcpAnswerMaterialSelection({...options,projection:baseline.model});
assert.ok(prepared.input);assert.equal(prepared.input.sources.find(row=>row[0]==='r4')[3],'r3');
assert.equal(buildLoopRequest('answer_material_select',prepared.input).schema.properties.refs.maxItems,8);
assert.ok(Buffer.byteLength(JSON.stringify(prepared.input))<=10500);
const chosen={status:'selected',refs:['r1','r2','r3','r4'],reason:'同一草稿的原件及修改'};
let calls=0,records=[];
const journal={read:async()=>records,append:async(kind,value)=>records.push({record:{kind,value}})};
const adapter={request:async(purpose,input,{canAttempt})=>{assert.equal(purpose,'answer_material_select');assert.equal(await canAttempt(),true);calls++;return {value:chosen};}};
const selection=await selectCmcpAnswerMaterial({prepared,adapter,journal,valid:async()=>true});
assert.equal(calls,1);
const projected=projectCmcpAnswerHistoryLookup({...options,materialSelection:selection.plan});
assert.equal(validAnswerHistoryProjection(projected.model),true);
assert.deepEqual(projected.model.context.evidence.map(row=>row.sourceRef),chosen.refs);
for(const row of projected.model.context.evidence){assert.equal(row.content.text,originals.find(source=>source.ref===row.sourceRef).text);assert.equal(row.projectedCoverage,'complete_retained_body');}
assert.equal(projected.model.context.coverage.readSources,12);
assert.equal(projected.model.context.coverage.materialSelection.excludedEvidence,8);
assert.equal(projected.model.context.coverage.answerProjection.omittedEvidence,0);
assert.ok(projected.measurement.projectedBytes<=8192);
assert.equal((await selectCmcpAnswerMaterial({prepared,adapter,journal,valid:async()=>true})).replayed,true);assert.equal(calls,1);
await assert.rejects(selectCmcpAnswerMaterial({prepared,adapter,journal,valid:async()=>false}),/cancelled/);
const changed=structuredClone(prepared);changed.binding.questionHash='changed';
let alive=true;
await assert.rejects(selectCmcpAnswerMaterial({prepared:changed,journal,valid:async()=>alive,adapter:{request:async()=>{alive=false;return {value:chosen};}}}),/cancelled/);
assert.equal(records.length,1);
await assert.rejects(selectCmcpAnswerMaterial({prepared:changed,journal,valid:async()=>true,adapter:{request:async()=>({value:{...chosen,refs:['r999']}})}}),/invalid_answer_material_selection/);
assert.equal(records.length,1);
for(const status of ['needs_clarification','needs_source']){const view=projectCmcpAnswerHistoryLookup({...options,materialSelection:{status,refs:[]}}).model;
  assert.equal(validAnswerHistoryProjection(view),true);assert.equal(view.status,'needs_source');assert.equal(view.context.evidence.length,0);
  assert.equal(view.context.coverage.materialSelection.status,status);
  assert.equal(projectCmcpEvidenceLookupAnswerInput({user:{sourceAuthorRole:'user',text:'合成問題'},answerHistory:view}).answerTask.disposition,'check_unavailable');}
assert.equal(prepareCmcpAnswerMaterialSelection({...options,needBasis:'recorded_fact_lookup',projection:baseline.model}),null);
assert.equal(prepareCmcpAnswerMaterialSelection({...options,result:{...result,aggregate:{...result.aggregate,evidence:evidence.slice(0,4)}},
  projection:projected.model}),null);
const injected=structuredClone(prepared.input);injected.sources[0][3]='r999';assert.throws(()=>buildCmcpAnswerMaterialSelectionRequest(injected),/invalid/);
console.log(JSON.stringify({status:'PASS',checks:24,productApiPosts:0,before:baseline.measurement,after:projected.measurement,
  selected:projected.model.context.evidence.map(row=>({ref:row.sourceRef,role:row.sourceAuthorRole,coverage:row.projectedCoverage})),
  scope:'合成來源、替身選取、重播、取消、非法ID、角色、原文、8192預算與缺來源，不是真模型語義'}));
