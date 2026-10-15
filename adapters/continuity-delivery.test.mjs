import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT??fileURLToPath(new URL('../',import.meta.url)));
const {createContinuityDelivery,continuityDeliveryPage,commitContinuityDeliveryPage,rejectContinuityDeliveryPage,restoreContinuityDelivery,CONTINUITY_PAGE_CHARS,CONTINUITY_COMPOSITION_BYTES}=await import(pathToFileURL(path.join(root,'adapters/continuity-delivery.mjs')));
const {projectContinuityModelView,restoreContinuityModelView}=await import(pathToFileURL(path.join(root,'adapters/continuity-model-view.mjs')));
const {CmcpHarnessBridge}=await import(pathToFileURL(path.join(root,'adapters/deepseek-harness/runtime-bridge.mjs')));
const clone=structuredClone,hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// 合成傳輸／接線 fixture，不聲稱替代 Core 語意或真宿主驗收。
function fixture(){
  const projection={kind:'query_scoped_derived_continuity',version:3,authority:'correctable_host_interpretation_not_world_verification',activation:'none',proactiveEligible:false,
    currentPlans:[],currentClaims:[],reasons:[],unknowns:['尚無外部完成證據'],sources:[],coverage:{modelCoverageComplete:true,historyCompleteness:'not_established'}};
  for(let i=0;i<12;i++)projection.sources.push({ref:`r${i}`,sourceAuthorRole:i%2?'assistant':'user',messageRecordedAt:`2026-02-11T03:04:${String(i).padStart(2,'0')}.006Z`,
    evidenceHash:String(i%10).repeat(64),citation:{unit:'unicode_code_points',text:`第${i}筆原話：保留否定、角色、原時間，不能當成執行授權。`.repeat(250)}});
  projection['來源/時間~對照']={text:'JSON Pointer 必須保留跳脫後的原鍵名。'};
  return {kind:'cmcp_continuity_projection',status:'ready',reason:null,ticket:'synthetic-reading-ticket',projectionHash:hash(projection),projection,modelCalls:0,modelCoverageComplete:true};
}
function publish(delivery,index){return commitContinuityDeliveryPage(delivery,continuityDeliveryPage(delivery,index));}
function allPages(delivery){return delivery.pages.map((_,index)=>publish(delivery,index));}
function bridgeFixture(){
  const original=fixture(),sessionId='synthetic-session',turn={enhanced:true,state:'running',capture:{},text:'只讀合成原件',messageId:'synthetic-message',harnessTurn:1,readings:new Set([original.ticket])};
  const runtime={config:{input:{timezone:'Asia/Taipei'}},continuityStatus:async()=>({status:original.status,ticket:original.ticket,projectionHash:original.projectionHash})};
  const bridge=Object.create(CmcpHarnessBridge.prototype);bridge.turns=new Map([[sessionId,turn]]);
  bridge.enqueue=operation=>operation();bridge.turn=async()=>({turn,runtime});bridge.validate=async()=>{};bridge.note=async()=>{};
  return {original,sessionId,turn,runtime,bridge};
}
async function preparedBridge(){const x=bridgeFixture();x.first=await x.bridge.prepareContinuityDelivery(x.sessionId,x.original);return x;}
function readPage(x,page='1',extra={}){return x.bridge.tool(x.sessionId,'cmcp_read_continuity',{ticket:x.first.ticket,deliveryId:x.first.delivery.id,page,...extra});}

test('準備頁沒有提供副作用；逐頁提交後完整 JSON、原文及雜湊可還原',()=>{
  const original=fixture(),before=clone(original),delivery=createContinuityDelivery(original);assert.ok(delivery.pages.length>=3);
  const prepared=continuityDeliveryPage(delivery,0);assert.equal(prepared.status,'prepared');assert.equal(delivery.provided.size,0);assert.equal(delivery.publications.size,0);
  assert.throws(()=>continuityDeliveryPage(delivery,1),/previous_page_required/);
  const pages=allPages(delivery);
  for(const [index,page] of pages.entries()){
    const json=JSON.stringify(page);assert.equal(page.status,'provided');assert.ok(json.length<=CONTINUITY_PAGE_CHARS);
    assert.ok(Math.ceil(json.length/4)+4<12500);assert.deepEqual(JSON.parse(json),page);assert.equal(page.delivery.complete,index===pages.length-1);
  }
  assert.deepEqual(restoreContinuityDelivery(pages),projectContinuityModelView(original));assert.deepEqual(original,before);
  assert.deepEqual([...delivery.provided],pages.map((_,index)=>index));
});

test('同一完整結果內的精確參照與長 Unicode 字串均不裁切',()=>{
  const original=fixture();original.projection.sources=original.projection.sources.slice(0,2);
  for(const source of original.projection.sources)source.citation.text='原話、角色、時間與否定不可替換。'.repeat(20);
  original.projection.knownEvolution=clone(original.projection.sources);
  original.projection.longText='🧪　原句\n含否定🙂'.repeat(3000);original.projectionHash=hash(original.projection);
  const projected=projectContinuityModelView(original);assert.ok(projected.modelView);
  const delivery=createContinuityDelivery(original),pages=allPages(delivery);
  assert.ok(pages.some(page=>page.sections.some(section=>section.stringPart)));
  assert.deepEqual(restoreContinuityModelView(restoreContinuityDelivery(pages)),original);
  assert.ok(pages.every(page=>JSON.stringify(page).length<=CONTINUITY_PAGE_CHARS));
});

test('按需 partial 續讀提示不代決用途；完整分頁仍保留 partial 與無執行權',()=>{
 const original=fixture();original.status='partial';original.reason='report_scope_review_required';
 const delivery=createContinuityDelivery(original),first=publish(delivery,0);
 assert.equal(first.continuation.operation,'cmcp_read_continuity');assert.match(first.continuation.review,/reportRef/);
 assert.equal(first.continuation.automaticResolution,false);assert.equal(first.continuation.executionAuthority,'none');
 assert.equal(first.projectionStatus,'partial');
 const pages=[first];for(let i=1;i<delivery.pages.length;i++)pages.push(publish(delivery,i));
 assert.equal(pages.at(-1).continuation.operation,null);assert.equal(pages.at(-1).delivery.complete,true);
 assert.equal(pages.at(-1).projectionStatus,'partial');assert.deepEqual(restoreContinuityDelivery(pages),projectContinuityModelView(original));
});

test('拒絕缺頁、異質票券／版本／範圍 metadata 及原文竄改',()=>{
  const pages=allPages(createContinuityDelivery(fixture()));
  assert.throws(()=>restoreContinuityDelivery(pages.slice(0,-1)),/incomplete/);
  for(const field of ['ticket','projectionHash','projectionStatus','projectionReason']){
    const changed=clone(pages);changed[1][field]='foreign';assert.throws(()=>restoreContinuityDelivery(changed),/incomplete/);
  }
  for(const field of ['id','resultHash','resultBytes','resultChars','pageCount']){
    const changed=clone(pages);changed[1].delivery[field]='foreign';assert.throws(()=>restoreContinuityDelivery(changed),/incomplete/);
  }
  const changed=clone(pages);changed[1].sections.push({path:'/tampered',value:true});assert.throws(()=>restoreContinuityDelivery(changed),/hash_mismatch/);
});

test('成功重讀回報最早未提供頁，不跳過尚缺的頁',()=>{
  const delivery=createContinuityDelivery(fixture());publish(delivery,0);publish(delivery,1);
  assert.equal(publish(delivery,0).delivery.nextPage,'2');assert.equal(delivery.provided.size,2);
});

test('外層拒絕僅撤回該次頁面，拒絕成功重讀不撤原成功提供',()=>{
  const delivery=createContinuityDelivery(fixture()),first=publish(delivery,0),next=publish(delivery,1);
  assert.equal(rejectContinuityDeliveryPage(delivery,next),true);assert.deepEqual([...delivery.provided],[0]);
  assert.equal(rejectContinuityDeliveryPage(delivery,next),false);
  const reread=publish(delivery,0);assert.equal(rejectContinuityDeliveryPage(delivery,reread),true);assert.deepEqual([...delivery.provided],[0]);
  assert.equal(rejectContinuityDeliveryPage(delivery,first),true);assert.equal(delivery.provided.size,0);
});

test('同頁晚到拒絕不撤另一成功出口；所有出口拒絕才移除提供紀錄',()=>{
  const delivery=createContinuityDelivery(fixture()),a=publish(delivery,0),b=publish(delivery,0);
  assert.equal(rejectContinuityDeliveryPage(delivery,a),true);assert.deepEqual([...delivery.provided],[0]);
  assert.equal(rejectContinuityDeliveryPage(delivery,b),true);assert.equal(delivery.provided.size,0);
  assert.throws(()=>continuityDeliveryPage(delivery,1),/previous_page_required/);
});

test('提交核對結果、內容與版本；不能重放同次 publicationId',()=>{
  const delivery=createContinuityDelivery(fixture()),prepared=continuityDeliveryPage(delivery,0);
  for(const field of ['ticket','projectionHash','projectionStatus','projectionReason']){
    const changed=clone(prepared);changed[field]='foreign';assert.throws(()=>commitContinuityDeliveryPage(delivery,changed),/publication_invalid/);
  }
  for(const field of ['id','resultHash','resultBytes','resultChars','pageCount']){
    const changed=clone(prepared);changed.delivery[field]='foreign';assert.throws(()=>commitContinuityDeliveryPage(delivery,changed),/publication_invalid/);
  }
  const changed=clone(prepared);changed.sections.push({path:'/injected',value:true});assert.throws(()=>commitContinuityDeliveryPage(delivery,changed),/publication_invalid/);
  const replay=clone(prepared);commitContinuityDeliveryPage(delivery,prepared);
  assert.throws(()=>commitContinuityDeliveryPage(delivery,replay),/publication_invalid/);assert.equal(delivery.publications.size,1);
});

test('短期提供紀錄與完整封套均有界；超限不增加計數',()=>{
  const delivery=createContinuityDelivery(fixture());for(let i=0;i<256;i++)publish(delivery,0);
  assert.throws(()=>publish(delivery,0),/publication_capacity_exceeded/);assert.equal(delivery.publications.size,256);assert.deepEqual([...delivery.provided],[0]);
  const original=fixture();original.largeEnvelope='x'.repeat(1048576);assert.throws(()=>createContinuityDelivery(original),/capacity_exceeded/);
});

test('小結果維持 inline；拒絕結果不轉成可讀成功',()=>{
  const result={kind:'cmcp_continuity_projection',status:'ready',ticket:'small',projection:{version:3,currentPlans:[]}};
  assert.deepEqual(createContinuityDelivery(result),{inline:result});
  const rejected={kind:'cmcp_continuity_projection',status:'rejected',reason:'source_missing',ticket:'rejected'};
  assert.deepEqual(createContinuityDelivery(rejected),{inline:rejected});
});

test('bridge 正式分頁可讀，外層初頁拒絕與末端頁拒絕均可精確回退',async()=>{
  const x=await preparedBridge();assert.equal(x.first.status,'provided');assert.deepEqual([...x.turn.continuityDelivery.provided],[0]);
  const page=await readPage(x);assert.equal(page.delivery.page,1);assert.deepEqual([...x.turn.continuityDelivery.provided],[0,1]);
  assert.equal(await x.bridge.rejectContinuityDeliveryPage(x.sessionId,page),true);assert.deepEqual([...x.turn.continuityDelivery.provided],[0]);
  assert.equal(await x.bridge.rejectContinuityDeliveryPage(x.sessionId,x.first),true);assert.equal(x.turn.continuityDelivery.provided.size,0);
  await assert.rejects(readPage(x),/previous_page_required/);
});

test('bridge 每頁拒絕錯票券／舊 delivery／數字頁碼，且重建撤銷舊頁出口',async()=>{
  const x=await preparedBridge();await assert.rejects(readPage(x,'1',{ticket:'foreign'}),/not_owned_by_turn/);
  await assert.rejects(readPage(x,'1',{deliveryId:'foreign'}),/not_owned_by_turn/);await assert.rejects(readPage(x,1),/arguments_invalid/);
  const first=x.first;await x.bridge.prepareContinuityDelivery(x.sessionId,x.original);
  await assert.rejects(readPage(x),/not_owned_by_turn/);assert.equal(await x.bridge.rejectContinuityDeliveryPage(x.sessionId,first),false);
  assert.deepEqual([...x.turn.continuityDelivery.provided],[0]);
});

test('bridge 來源變版、控制拒絕或正式驗證取消都不增加已提供頁',async()=>{
  for(const state of ['source_changed','controls_disabled','cancelled']){
    const x=await preparedBridge(),cancel=new AbortController();
    x.runtime.continuityStatus=async()=>{
      if(state==='cancelled')cancel.abort();
      return state==='controls_disabled'?{status:'unavailable',reason:state}:{status:'ready',ticket:x.first.ticket,projectionHash:state==='source_changed'?'changed':x.first.projectionHash};
    };
    await assert.rejects(x.bridge.tool(x.sessionId,'cmcp_read_continuity',{ticket:x.first.ticket,deliveryId:x.first.delivery.id,page:'1'},cancel.signal),/source_changed|cancelled/);
    assert.deepEqual([...x.turn.continuityDelivery.provided],[0]);
  }
});

test('bridge 頁已準備後最後 validate／note／signal 失敗，仍未提交提供計數',async()=>{
  for(const boundary of ['validate_before_note','note','validate_after_note','signal_after_note']){
    const x=await preparedBridge(),cancel=new AbortController();let validations=0;
    x.bridge.validate=async()=>{validations++;if(validations===(boundary==='validate_before_note'?2:boundary==='validate_after_note'?3:-1))throw Error('synthetic_guard_failed');};
    x.bridge.note=async()=>{if(boundary==='note')throw Error('synthetic_note_failed');if(boundary==='signal_after_note')cancel.abort();};
    await assert.rejects(x.bridge.tool(x.sessionId,'cmcp_read_continuity',{ticket:x.first.ticket,deliveryId:x.first.delivery.id,page:'1'},cancel.signal),/guard_failed|note_failed|cancelled/);
    assert.deepEqual([...x.turn.continuityDelivery.provided],[0]);assert.equal(x.turn.continuityDelivery.publications.size,1);
  }
});

test('bridge prepare 最後 guard／原投影不一致時不建立提供頁；inline 同樣核對',async()=>{
  const x=bridgeFixture();x.bridge.validate=async()=>{throw Error('synthetic_guard_failed');};
  await assert.rejects(x.bridge.prepareContinuityDelivery(x.sessionId,x.original),/guard_failed/);assert.equal(x.turn.continuityDelivery,null);
  const y=bridgeFixture(),changed=clone(y.original);changed.projection.sources[0].citation.text+='changed';
  await assert.rejects(y.bridge.prepareContinuityDelivery(y.sessionId,changed),/source_changed/);assert.equal(y.turn.continuityDelivery,null);
  const z=bridgeFixture(),small=clone(z.original);small.projection={version:3,currentPlans:[]};small.projectionHash=hash(small.projection);
  z.runtime.continuityStatus=async()=>({status:'ready',ticket:small.ticket,projectionHash:small.projectionHash});z.bridge.validate=async()=>{throw Error('synthetic_guard_failed');};
  await assert.rejects(z.bridge.prepareContinuityDelivery(z.sessionId,small),/guard_failed/);assert.equal(z.turn.continuityDelivery,null);
});

function smallFixture(encoded=false){
  const value=fixture();value.projection.sources=value.projection.sources.slice(0,2);
  for(const source of value.projection.sources)source.citation.text='合成原文：保留來源、角色、原時間及否定。'.repeat(8);
  value.projection.currentPlans=[{nodeId:'user-plan',sourceRef:'r0',text:'User 的原計畫條件。'}];
  value.projection.knownEvolution=encoded?clone(value.projection.sources):[];value.projectionHash=hash(value.projection);
  return value;
}

test('inline 作答契約只指向現有來源與狀態，不改 Core、原文、角色、時間或控制',()=>{
  const original=smallFixture(),before=clone(original),inline=createContinuityDelivery(original).inline,boundary=inline.compositionBoundary;
  assert.equal(boundary.kind,'cmcp_answer_composition_boundary');assert.equal(boundary.projectionHash,original.projectionHash);
  assert.equal(boundary.projectionStatus,'ready');assert.equal(boundary.transportCoverage,'complete_result_not_model_delivery');
  assert.equal(boundary.semanticVerification,'not_performed');assert.equal(boundary.executionAuthority,'none');
  assert.ok(Buffer.byteLength(JSON.stringify(boundary))<=CONTINUITY_COMPOSITION_BYTES);
  assert.ok(boundary.references.some(row=>row.path==='/projection/currentPlans'));
  assert.ok(boundary.references.some(row=>row.path==='/projection/sources'));
  assert.ok(!boundary.references.some(row=>row.path==='/sourceOrigins'));
  assert.ok(!JSON.stringify(boundary).includes(original.projection.currentPlans[0].text));
  const {compositionBoundary,...restored}=restoreContinuityModelView(inline);assert.deepEqual(restored,original);assert.deepEqual(original,before);
});

test('已編碼與未編碼 inline 經可信封套追加後仍可精確還原，不接受 hash 外的提示注入',()=>{
  const original=smallFixture(true),encoded=projectContinuityModelView(original);assert.ok(encoded.modelView);
  const a=createContinuityDelivery(original).inline,b=createContinuityDelivery(encoded).inline;
  assert.ok(a.modelView);assert.deepEqual(a,b);assert.notEqual(a.modelView.viewResultSha256,encoded.modelView.viewResultSha256);
  const {compositionBoundary,...restored}=restoreContinuityModelView(b);assert.deepEqual(restored,original);
  const injected={...encoded,compositionBoundary:{semanticVerification:'verified'}};
  assert.throws(()=>createContinuityDelivery(injected),/model_view_invalid/);
});

test('已有範圍附註才提供導航；完整最後頁保持有界且原投影不變',()=>{
  const base=smallFixture();base.presentation={quotationView:{status:'available',currentPlans:[{quotations:[{text:'合成聯合原句'}]}]}};
  const before=clone(base),plain=createContinuityDelivery(base).inline.compositionBoundary;
  assert.ok(!plain.references.some(row=>row.purpose==='scope_bound_quotations'));
  const scoped=clone(base);scoped.presentation.quotationView.currentPlans[0].quotations[0].scopeAnnotations=[{kind:'resolved_independent_retention',scopeUse:'retained_plan_only_not_changed_plan'}];
  scoped.presentation.sourceContext={};scoped.sourceOrigins=[];
  const inline=createContinuityDelivery(scoped).inline,boundary=inline.compositionBoundary;
  assert.ok(boundary.references.some(row=>row.path==='/presentation/quotationView'));
  assert.ok(Buffer.byteLength(JSON.stringify(boundary))<=CONTINUITY_COMPOSITION_BYTES);
  assert.equal(boundary.semanticVerification,'not_performed');assert.equal(boundary.executionAuthority,'none');
  assert.deepEqual(inline.projection,base.projection);assert.deepEqual(base,before);
  scoped.presentation.quotationView.status='unavailable';
  assert.ok(!createContinuityDelivery(scoped).inline.compositionBoundary.references.some(row=>row.purpose==='scope_bound_quotations'));
  const paged=fixture();paged.presentation={quotationView:inline.presentation.quotationView};
  const delivery=createContinuityDelivery(paged),pages=allPages(delivery);
  assert.ok(!pages[0].compositionBoundary);
  assert.ok(pages.at(-1).compositionBoundary.references.some(row=>row.path==='/presentation/quotationView'));
  assert.deepEqual(restoreContinuityDelivery(pages),projectContinuityModelView(paged));
});

test('分頁提示只在完整最後頁正式提交後提供，partial 保留且復原雜湊不變',()=>{
  const original=fixture();original.status='partial';original.reason='known_source_gap';const before=clone(original),delivery=createContinuityDelivery(original),pages=[];
  for(let index=0;index<delivery.pages.length;index++){
    const prepared=continuityDeliveryPage(delivery,index);assert.equal(prepared.compositionBoundary,undefined);
    const page=commitContinuityDeliveryPage(delivery,prepared);pages.push(page);
    assert.equal(!!page.compositionBoundary,index===delivery.pages.length-1);
  }
  const last=pages.at(-1);assert.equal(last.compositionBoundary.projectionStatus,'partial');
  assert.equal(last.compositionBoundary.transportCoverage,'complete_result_provided_not_model_comprehension');
  assert.equal(last.compositionBoundary.semanticVerification,'not_performed');assert.deepEqual(restoreContinuityDelivery(pages),projectContinuityModelView(original));
  assert.deepEqual(original,before);assert.equal(publish(delivery,1).delivery.complete,true);assert.equal(publish(delivery,1).compositionBoundary,undefined);
  assert.ok(pages.every(page=>JSON.stringify(page).length<=CONTINUITY_PAGE_CHARS));
});

test('偽造完整或外加作答提示不能提交；提供後提示被變造不能假撤回成功',()=>{
  const delivery=createContinuityDelivery(fixture()),prepared=continuityDeliveryPage(delivery,0);
  for(const mutation of [row=>{row.delivery.complete=true;},row=>{row.delivery.providedPages=[0,1];},row=>{row.compositionBoundary={semanticVerification:'verified'};}]){
    const changed=clone(prepared);mutation(changed);assert.throws(()=>commitContinuityDeliveryPage(delivery,changed),/publication_invalid/);
  }
  const pages=allPages(delivery),last=pages.at(-1),changed=clone(last);changed.compositionBoundary.executionAuthority='allowed';
  assert.equal(rejectContinuityDeliveryPage(delivery,changed),false);assert.equal(delivery.provided.size,delivery.pages.length);
  const changedPages=clone(pages);changedPages[changedPages.length-1]=changed;
  assert.throws(()=>restoreContinuityDelivery(changedPages),/composition_boundary_invalid/);
  const middle=clone(pages);middle[0].compositionBoundary=clone(last.compositionBoundary);
  assert.throws(()=>restoreContinuityDelivery(middle),/composition_boundary_invalid/);
  assert.equal(rejectContinuityDeliveryPage(delivery,last),true);assert.equal(last.compositionBoundary,undefined);
  assert.equal(delivery.provided.has(delivery.pages.length-1),false);assert.equal(rejectContinuityDeliveryPage(delivery,last),false);
  assert.throws(()=>commitContinuityDeliveryPage(delivery,last),/publication_invalid/);
});

test('最後頁準備後早頁被拒絕，舊完整聲明不能提交；重新完成後才有提示',()=>{
  const delivery=createContinuityDelivery(fixture()),first=publish(delivery,0);
  for(let i=1;i<delivery.pages.length-1;i++)publish(delivery,i);
  const last=continuityDeliveryPage(delivery,delivery.pages.length-1);assert.equal(last.delivery.complete,true);assert.equal(last.compositionBoundary,undefined);
  assert.equal(rejectContinuityDeliveryPage(delivery,first),true);
  assert.throws(()=>commitContinuityDeliveryPage(delivery,last),/publication_invalid/);assert.equal(delivery.provided.has(delivery.pages.length-1),false);
  publish(delivery,0);const completed=publish(delivery,delivery.pages.length-1);assert.ok(completed.compositionBoundary);
});

test('作答契約容量預留失敗不增加提供或 publication；無 binding／拒絕不產生提示',()=>{
  const delivery=createContinuityDelivery(fixture());for(let i=0;i<delivery.pages.length-1;i++)publish(delivery,i);
  const before=delivery.publications.size;delivery.compositionBoundary.instruction='x'.repeat(CONTINUITY_PAGE_CHARS);
  assert.throws(()=>continuityDeliveryPage(delivery,delivery.pages.length-1),/page_capacity_exceeded/);assert.equal(delivery.publications.size,before);
  assert.equal(delivery.provided.has(delivery.pages.length-1),false);
  const invalid=smallFixture();invalid.projectionHash='unknown';assert.equal(createContinuityDelivery(invalid).inline.compositionBoundary,undefined);
  const rejected={kind:'cmcp_continuity_projection',status:'rejected',ticket:'rejected',projectionHash:'a'.repeat(64),reason:'source_changed'};
  assert.deepEqual(createContinuityDelivery(rejected),{inline:rejected});
});
