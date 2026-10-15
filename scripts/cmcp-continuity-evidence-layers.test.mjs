import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=file=>import(pathToFileURL(path.join(productRoot,file)));
const {createCmcpContinuityPresentation:present}=await load('src/cmcp-guard/cmcp-continuity-presentation.js');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');
const {projectContinuityModelView:encode,restoreContinuityModelView:restore}=await load('src/cmcp-guard/cmcp-continuity-model-view.js');
const scopeId='synthetic-evidence-layers',copy=structuredClone;
const oldTime='2026-10-01T01:00:00.000Z',newTime='2026-10-02T02:00:00.000Z';
const texts=['開放前須由場地方確認配置。','先暫停，配置改為兩列。','我已完成一張配置草圖。','工具回報：檔案已寫入工作區。'];
// 原文是合成來源；分類與結果測試不得把它改寫成被測模型的答案。
const sources=texts.map((text,index)=>({ref:'r'+index,sourceAuthorRole:index===3?'tool':'user',contentKind:'source_excerpt',
 messageRecordedAt:index===0?oldTime:newTime,eventOccurredAt:null,evidenceHash:loopHash(text)}));
const source=(index)=>({...sources[index],citation:{unit:'unicode_code_points',start:0,end:[...texts[index]].length,text:texts[index]}});
const node=(id,index,kind)=>({nodeId:id,interpretation:{kind,temporalUse:'current',text:texts[index]},supported:true,
 time:{messageRecordedAt:sources[index].messageRecordedAt,eventOccurredAt:null},source:{ref:sources[index].ref,citation:source(index).citation,sourceAuthorRole:sources[index].sourceAuthorRole,contentKind:'source_excerpt'}});
function fixture(){return {kind:'cmcp_continuity_projection',version:3,knownEvolution:[node('gate',0,'user_intent'),node('report',2,'user_report'),node('observation',3,'tool_observation')],
 sources:copy(sources),currentPlans:[{nodeId:'gate',text:texts[1],planStatus:'paused',planVersion:loopHash('revision-2'),sourceFragments:[source(1)],statusSource:source(1)}],
 currentClaims:[{nodeId:'report',text:texts[2]},{nodeId:'observation',text:texts[3]}],unknownParts:[{nodeId:'gate',reason:'event_time_unknown'},{nodeId:'gate',reason:'intent_outcome_not_inferred'}],
 reasons:[],reasonBindings:[],planChanges:[],planBasis:[],reasonRelations:[]};}
const calculate=(projection)=>present({projection,projectionHash:loopHash(projection),scopeId,verifiedScopeId:scopeId});
const unavailable=(p,reason)=>{const result=calculate(p);assert.equal(result.status,'available');assert.equal(result.evidenceLayers.status,'not_available');assert.match(result.evidenceLayers.reason,reason);assert.equal(result.evidenceLayers.currentPlans,null);assert.equal(result.evidenceLayers.currentClaims,null);};
const atPointer=(value,pointer)=>pointer.slice(1).split('/').reduce((v,key)=>v[key],value);

test('計畫、User 回報與工具來源觀察只交叉指向已有證據層級',()=>{
 const p=fixture(),before=JSON.stringify(p),result=calculate(p),layers=result.evidenceLayers;
 assert.equal(layers.status,'available');assert.equal(layers.semanticVerification,'not_performed');assert.equal(layers.executionAuthority,'none');
 assert.equal(layers.currentPlans[0].evidenceLevel,'user_intent_not_outcome_or_execution_permission');
 assert.equal(layers.currentClaims[0].evidenceLevel,'user_report_not_independently_verified');
 assert.equal(layers.currentClaims[1].evidenceLevel,'tool_source_observation_not_beyond_its_evidence');
 assert.equal(layers.projectionHash,loopHash(p));assert.equal(JSON.stringify(p),before);
 assert.deepEqual(result.plans,[]);assert.equal(result.authority,'derived_from_explicit_reason_withdrawal_not_new_condition_change');
 assert.equal(layers.authority,'cross_reference_of_existing_formal_projection_not_new_state_evidence');
 for(const row of [...layers.currentPlans,...layers.currentClaims]){assert.equal(Object.hasOwn(row,'text'),false);assert.equal(Object.hasOwn(row,'completed'),false);}
});
test('計畫原始基底與目前片段／狀態來源時間分開，不拿舊基底代替修訂',()=>{
 const p=fixture(),row=calculate(p).evidenceLayers.currentPlans[0];
 assert.equal(row.source.messageRecordedAt,oldTime);assert.equal(row.currentSourceBindings[0].messageRecordedAt,newTime);assert.equal(row.statusSourceBinding.messageRecordedAt,newTime);
 assert.equal(row.planStatus,'paused');assert.equal(row.planVersion,p.currentPlans[0].planVersion);
 const envelope={projection:p};assert.equal(atPointer(envelope,row.currentViewReference).text,texts[1]);assert.equal(atPointer(envelope,row.nodeReference).interpretation.text,texts[0]);
 for(const binding of [row.source,...row.currentSourceBindings,row.statusSourceBinding]){assert.equal(atPointer(envelope,binding.sourceReference).evidenceHash,binding.evidenceHash);assert.deepEqual(atPointer(envelope,binding.bindingReference).citation.start,binding.range.start);}
});
test('未知標記只逐項引用；意圖不外推未完成，沒有標記不代表全部已知',()=>{
 const p=fixture(),layers=calculate(p).evidenceLayers;
 assert.deepEqual(layers.currentPlans[0].existingLimitations.map(r=>r.reason),['event_time_unknown','intent_outcome_not_inferred']);
 assert.deepEqual(layers.currentClaims[0].existingLimitations,[]);assert.equal(Object.hasOwn(layers.currentClaims[0],'allKnown'),false);
 assert.equal(Object.hasOwn(layers.currentPlans[0],'outcomeStatus'),false);
 for(const row of layers.currentPlans[0].existingLimitations)assert.equal(atPointer({projection:p},row.reference).reason,row.reason);
});
test('重複 nodeId 或 source ref 不挑第一筆，也不顯示成空集合',()=>{
 for(const mutate of [p=>p.knownEvolution.push(copy(p.knownEvolution[0])),p=>p.sources.push(copy(p.sources[0])),p=>p.currentClaims.push(copy(p.currentClaims[0]))]){
  const p=fixture();mutate(p);unavailable(p,/identity_conflict/);
 }
});
test('缺少或未核對節點、錯誤角色與錯誤分類不變成有效層級',()=>{
 const missing=fixture();missing.knownEvolution.shift();unavailable(missing,/node_unavailable/);
 const unsupported=fixture();unsupported.knownEvolution[1].supported=false;unavailable(unsupported,/node_unavailable/);
 const wrongRole=fixture();wrongRole.knownEvolution[1].source.sourceAuthorRole='assistant';unavailable(wrongRole,/kind_role_mismatch/);
 const wrongKind=fixture();wrongKind.knownEvolution[1].interpretation.kind='assistant_statement';unavailable(wrongKind,/kind_role_mismatch/);
});
test('目前回報必須連同一節點正文，不用另一回報的來源背書',()=>{
 const p=fixture();p.currentClaims[0].text='不同內容';unavailable(p,/claim_text_mismatch/);
});
test('來源版本、角色與時間衝突保持不可用，外層撤回理由附註契約保留',()=>{
 const changedTime=fixture();changedTime.knownEvolution[1].time.messageRecordedAt=oldTime;unavailable(changedTime,/source_time_mismatch/);
 const missing=fixture();missing.sources=missing.sources.filter(s=>s.ref!=='r2');unavailable(missing,/source_mismatch/);
 const malformed=fixture();malformed.sources[2].evidenceHash='unverified';unavailable(malformed,/source_mismatch/);
 const conflict=fixture();conflict.knownEvolution[1].source.evidenceHash='0'.repeat(64);unavailable(conflict,/source_mismatch/);
});
test('有界列數或缺少整個集合時不截斷，也不偽裝沒有計畫',()=>{
 const p=fixture();p.currentClaims=Array.from({length:129},(_,i)=>({nodeId:'report-'+i,text:'合成'}));unavailable(p,/row_limit/);
 const absent=fixture();delete absent.unknownParts;unavailable(absent,/collection_unavailable/);
});
test('來源綁定數與附註容量分開限制，整個 crosswalk 不截斷發出',()=>{
 const many=fixture();many.currentPlans[0].sourceFragments=Array.from({length:513},()=>source(1));many.currentPlans[0].text=many.currentPlans[0].sourceFragments.map(x=>x.citation.text).join('');
 unavailable(many,/binding_limit/);
 const large=fixture();large.unknownParts.push({nodeId:'gate',reason:'合成限制'.repeat(17000)});unavailable(large,/metadata_limit/);
});
test('有效空集合可用，但不將缺失集合偽裝有效空集合',()=>{
 const empty=fixture();empty.currentPlans=[];empty.currentClaims=[];const layers=calculate(empty).evidenceLayers;
 assert.equal(layers.status,'available');assert.deepEqual(layers.currentPlans,[]);assert.deepEqual(layers.currentClaims,[]);
 const absent=fixture();delete absent.currentClaims;unavailable(absent,/collection_unavailable/);
});
test('跨可還原 modelView 編碼，正式指標、原文與舊附註仍同源',()=>{
 const p=fixture(),presentation=calculate(p),envelope={kind:'cmcp_continuity_projection',status:'ready',scopeId,projection:p,projectionHash:loopHash(p),presentation};
 const encoded=encode(envelope),restored=restore(encoded);assert.deepEqual(restored,envelope);
 const row=restored.presentation.evidenceLayers.currentClaims[0];assert.equal(atPointer(restored,row.nodeReference).interpretation.kind,'user_report');
 assert.equal(atPointer(restored,row.source.bindingReference).citation.text,texts[2]);assert.deepEqual(calculate(restored.projection),presentation);
});
test('外層 scope/hash 守護未改；舊版投影不假稱有 evidenceLayers',()=>{
 const p=fixture();assert.throws(()=>present({projection:p,projectionHash:loopHash(p),scopeId,verifiedScopeId:'another'}),/scope_mismatch/);
 assert.throws(()=>present({projection:p,projectionHash:'0'.repeat(64),scopeId,verifiedScopeId:scopeId}),/projection_hash_mismatch/);
 p.version=2;const old=calculate(p);assert.equal(old.status,'not_available');assert.equal(Object.hasOwn(old,'evidenceLayers'),false);
});
