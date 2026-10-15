import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT??fileURLToPath(new URL('../',import.meta.url)));
const {projectContinuityModelView:project,restoreContinuityModelView:restore,CMCP_CONTINUITY_MODEL_VIEW_LIMITS:limits}
 =await import(pathToFileURL(path.join(root,'src/cmcp-guard/cmcp-continuity-model-view.js')));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const ref=pointer=>({$cmcpExactRef:pointer});
function encoded(body,original=body){
 return {...body,modelView:{version:1,encoding:'exact_object_references',referenceKey:'$cmcpExactRef',referenceRoot:'this_tool_result',
  sourceResultSha256:hash(original),viewResultSha256:hash(body)}};
}
function dag(){
 const body={kind:'cmcp_continuity_projection',status:'ready',projection:{leaf:{text:'合成'.repeat(128)},knownEvolution:[]}};
 const original=structuredClone(body);let prior=structuredClone(body.projection.leaf);
 for(let i=0;i<8;i++){
  const pointer=i===0?'/projection/leaf':`/projection/knownEvolution/${i-1}`;
  body.projection.knownEvolution.push([ref(pointer),ref(pointer)]);
  prior=[prior,structuredClone(prior)];original.projection.knownEvolution.push(prior);
 }
 return {body,original};
}
function normal(){
 const source={ref:'r1',citation:{start:0,end:200,text:'合成'.repeat(100)},sourceAuthorRole:'user',
  evidenceHash:'a'.repeat(64),messageRecordedAt:'2026-10-11T00:00:00.000Z'};
 return {kind:'cmcp_continuity_projection',status:'ready',projectionHash:'formal-full-hash',
  projection:{currentPlans:[{source}],knownEvolution:[{source:structuredClone(source)},{source:structuredClone(source)}]},
  readerIdentity:{hostId:'synthetic-reader'},sourceOrigins:[{ref:'r1',hostId:'synthetic-source'}]};
}

test('還原容量分層明示且不超過既有傳輸界',()=>{
 assert.equal(limits.maxEnvelopeBytes,1048576);assert.equal(limits.maxExpandedProjectionBytes,131072);
 assert.equal(limits.maxDepth,64);assert.equal(limits.maxVisitedNodes,65536);
});
test('小型 DAG 的完整雜湊合法，仍不得展開超過正式投影界',()=>{
 const {body,original}=dag(),view=encoded(body,original),before=structuredClone(view);
 assert(bytes(view)<4096);assert(bytes(original.projection)>limits.maxExpandedProjectionBytes);
 assert(bytes(original)<limits.maxEnvelopeBytes);
 assert.throws(()=>restore(view),/continuity_model_view_expanded_limit/);
 assert.throws(()=>project(view),/continuity_model_view_expanded_limit/);
 assert.deepEqual(view,before);
});
test('不信偽造的還原雜湊或容量 metadata，先拒絕展開超限',()=>{
 const {body,original}=dag(),view=encoded(body,original);
 view.modelView.sourceResultSha256='0'.repeat(64);view.modelView.expandedProjectionBytes=1;
 assert.throws(()=>restore(view),/continuity_model_view_expanded_limit/);
});
test('正常有來源封套重複呈現與序列化仍同源，編碼後加欄位則拒絕',()=>{
 const original=normal(),before=structuredClone(original),view=project(original);
 assert(view.modelView);assert.deepEqual(restore(view),original);assert.deepEqual(original,before);
 for(let i=0;i<3;i++)assert.deepEqual(project(JSON.parse(JSON.stringify(view))),view);
 assert.equal(view.projectionHash,original.projectionHash);
 assert.deepEqual(view.sourceOrigins,original.sourceOrigins);assert.deepEqual(view.readerIdentity,original.readerIdentity);
 assert.throws(()=>project({...view,extraOrigin:{hostId:'not-in-original'}}),/continuity_model_view_invalid/);
 const wrong=structuredClone(view);wrong.modelView.sourceResultSha256='0'.repeat(64);
 assert.throws(()=>restore(wrong),/continuity_model_view_restore_mismatch/);
});
test('過深輸入及過多走訪節點先拒絕，不等 JavaScript 堆疊耗盡',()=>{
 let nested={};for(let i=0;i<limits.maxDepth+2;i++)nested={next:nested};
 assert.throws(()=>restore(encoded({projection:nested})),/continuity_model_view_work_limit/);
 const many={projection:{},extra:Array(limits.maxVisitedNodes+1).fill(0)};
 assert(bytes(many)<limits.maxEnvelopeBytes);
 assert.throws(()=>restore(encoded(many)),/continuity_model_view_work_limit/);
});
test('輸入封套超過一 MiB 即拒絕，metadata 不能繞過',()=>{
 const view=encoded({projection:{},extra:'a'.repeat(limits.maxEnvelopeBytes)});
 assert.throws(()=>restore(view),/continuity_model_view_expanded_limit/);
});
test('投影本身未超限但其他欄位參照展開超過完整封套界也拒絕',()=>{
 const body={projection:{payload:{text:'a'.repeat(64000)}},copies:Array.from({length:17},()=>ref('/projection/payload'))};
 const original={projection:structuredClone(body.projection),copies:Array.from({length:17},()=>structuredClone(body.projection.payload))};
 assert(bytes(original.projection)<limits.maxExpandedProjectionBytes);assert(bytes(original)>limits.maxEnvelopeBytes);
 assert(bytes(body)<limits.maxExpandedProjectionBytes);
 assert.throws(()=>restore(encoded(body,original)),/continuity_model_view_expanded_limit/);
});
