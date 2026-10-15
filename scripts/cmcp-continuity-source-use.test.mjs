import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=rel=>import(pathToFileURL(path.join(productRoot,rel)).href),copy=structuredClone,bytes=value=>Buffer.byteLength(JSON.stringify(value));
const {reviewCmcpContentSourceUses:review}=await load('src/cmcp-guard/cmcp-continuity-plan-patch.js');
const {projectCmcpReadingContinuity:project,attachCmcpContentSourceUseReview:attach,measureCmcpContinuityProjectionCapacity:measure}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {projectContinuityModelView:compact,restoreContinuityModelView:restore}=await load('src/cmcp-guard/cmcp-continuity-model-view.js');
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');
const {createCmcpContinuityPresentation:createPresentation}=await load('src/cmcp-guard/cmcp-continuity-presentation.js');
const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/continuity-source-use-c47-reconstructed.json',import.meta.url),'utf8'));
const recorded=fixture.recordedFormalResult,original=recorded.projection.planChanges.find(change=>change.kind==='content');
const sourcePointer=ref=>ref==='r3'?fixture.sources.find(source=>source.bodyHash==='e06faf5ee9b2713d9cfdeed33f6427e4d0983360710bd9ba63c83680b312c838').pointer:null;
const sourceIdentity=ref=>sourcePointer(ref)?JSON.stringify(sourcePointer(ref)):null;
const calc=(changes=[copy(original)],extra={})=>review({plans:{planChanges:changes},retentions:[],reasonBindings:[],nodes:[],sourceIdentity,sourcePointer,...extra});
const intervals=rows=>rows.map(({start,end,text})=>({start,end,text}));

// 這是已保存 formal result 的重建 fixture；沒有原 proposal args，不稱原參數 replay 或語意通過。
test('C47 來源用途重建：替換效果差集、原話片段與上下文分層',async t=>{
 await t.test('第一份只改一段，較正確重建新增另一效果；對象、連接詞與標點仍透明',()=>{
  const first=calc(),corrected=copy(original);
  corrected.parts=[{kind:'replace',replacementSourceFragments:fixture.correctedObservedFragments.filter(fragment=>fragment.ref==='r3')}];
  const later=calc([corrected]);
  assert.deepEqual(intervals(first.findings[0].unusedEffectRanges),[
   {start:5,end:18,text:'只把上層隔板改用夾板，而且'},{start:25,end:26,text:'；'}]);
  assert.deepEqual(intervals(later.findings[0].unusedEffectRanges),[
   {start:5,end:9,text:'只把上層'},{start:15,end:18,text:'，而且'},{start:25,end:26,text:'；'}]);
  for(const value of [first,later]){
   assert.equal(value.status,'source_use_check_cues');assert.equal(value.semanticVerification,'not_performed');
   assert.equal(value.executionAuthority,'none');assert.equal(value.findings[0].source.range.start,5);
   assert.equal(value.findings[0].source.messageRecordedAt,original.source.messageRecordedAt);
   assert.equal(value.findings[0].sourceReference,'/projection/planChanges/0/source');
   assert.equal(value.resolved,undefined);assert.equal(value.semanticCompleteness,undefined);
  }
 });
 await t.test('理由／保留可說明同來源用途，不能變成替換效果或 ACK 消除提示',()=>{
  const source={...copy(original.source),citation:{unit:'unicode_code_points',start:5,end:18,text:'只把上層隔板改用夾板，而且'}};
  const reason={...source,reasonId:'context-reason',standing:'not_explicitly_withdrawn',binding:{kind:'plan_change',nodeId:original.targetNodeId,
   changeId:original.id,priorVersion:original.priorVersion,planVersion:original.planVersion}};
  const retention={...source,byNodeId:'retention-source',targetNodeIds:[original.targetNodeId]};
  const nodes=[{id:'retention-source',kind:'user_intent',temporalUse:'current'}];
  const result=calc(undefined,{reasonBindings:[reason],retentions:[retention],nodes});
  assert.deepEqual(result.findings[0].effectRanges,[{unit:'unicode_code_points',start:18,end:25}]);
  assert.equal(result.findings[0].contextualUses.length,2);
  assert.deepEqual(intervals(result.findings[0].unallocatedRanges),[{start:25,end:26,text:'；'}]);
  assert.deepEqual(result.findings[0].unusedEffectRanges,calc().findings[0].unusedEffectRanges);
  assert.equal(result.status,'source_use_check_cues');
  const copiedSource={...reason,citation:copy(original.source.citation)};
  const copied=calc(undefined,{reasonBindings:[copiedSource],planEvidence:[{uses:[{kind:'plan_change',source:copy(original.source)}]}],ack:true});
  assert.equal(copied.findings[0].unusedEffectRanges.length,2);assert.equal(copied.resolved,undefined);
 });
 await t.test('另一來源、hash、角色、時間、目標或版本不能覆蓋本 content 引文',()=>{
  const reason={...copy(original.source),reasonId:'other',standing:'not_explicitly_withdrawn',binding:{kind:'plan_change',nodeId:original.targetNodeId,
   changeId:original.id,priorVersion:original.priorVersion,planVersion:original.planVersion}};
  for(const altered of [{ref:'r-other'},{evidenceHash:'0'.repeat(64)},{sourceAuthorRole:'assistant'},
   {messageRecordedAt:'2026-10-13T20:17:53.049Z'},{binding:{...reason.binding,nodeId:'another-plan'}},
   {binding:{...reason.binding,planVersion:'1'.repeat(64)}},{standing:'withdrawn_by_explicit_user_source'}]){
   const result=calc(undefined,{reasonBindings:[{...copy(reason),...altered}]});
   assert.deepEqual(result.findings[0].contextualUses,[]);assert.deepEqual(result.findings[0].unallocatedRanges,calc().findings[0].unallocatedRanges);
  }
  const invalid=copy(original);invalid.source.sourceAuthorRole='assistant';assert.throws(()=>calc([invalid]),/continuity_source_use_binding_invalid/);
 });
 await t.test('status／reason 不作 content 覆蓋；withdraw 合法保留整段待核而不硬拒絕',()=>{
  assert.equal(calc([{...copy(original),kind:'status'}]).contentChanges,0);
  assert.equal(calc([{...copy(original),kind:'reason'}]).findings.length,0);
  const withdrawal={...copy(original),parts:[{kind:'withdraw',replacementSourceFragments:[]}]};
  assert.deepEqual(intervals(calc([withdrawal]).findings[0].unusedEffectRanges),[{start:5,end:26,text:original.source.citation.text}]);
 });
 await t.test('只核宣告區間、保持 Unicode code point，有限回饋不冒稱零缺口',()=>{
  const unicode=copy(original);unicode.source.citation={unit:'unicode_code_points',start:40,end:44,text:'🪟改成藍'};
  unicode.parts=[{kind:'replace',replacementSourceFragments:[{...copy(unicode.source),citation:{unit:'unicode_code_points',start:43,end:44,text:'藍'}}]}];
  assert.deepEqual(intervals(calc([unicode]).findings[0].unusedEffectRanges),[{start:40,end:43,text:'🪟改成'}]);
  const limited=calc(Array.from({length:24},(_,i)=>({...copy(original),id:'content-'+i})));
  assert.equal(limited.totalFindings,24);assert(limited.truncated);assert(limited.omittedFindings>0);assert(bytes(limited)<=limited.maxReviewBytes);
  assert.throws(()=>calc(Array.from({length:25},()=>copy(original))),/continuity_source_use_limit/);
 });
});

test('實際保存 C47 完整投影與父材料的容量測量，另列於機制重建',()=>{
 assert.equal(loopHash(recorded.projection),fixture.recordedProjectionHash,'保存投影須仍是原逐值資料，包含原時間字串');
 const before=copy(recorded),cue=review({plans:recorded.projection,retentions:recorded.projection.retentions,
  reasonBindings:recorded.projection.reasonBindings,nodes:[],sourceIdentity,sourcePointer});
 const added=attach(recorded.projection,cue);
 assert.equal(added.delivery.status,'provided','必要 C47 完整材料須真的容納提示，不能用 optional omission 代替接縫驗證');
 assert(added.projectionCapacity.expandedProjectionBytes<=131072);assert(added.projectionCapacity.modelProjectionBytes<=65536);
 const capacityReconstruction={...copy(recorded),projection:added.projection};
 const modelView=compact(capacityReconstruction);assert.deepEqual(restore(modelView),capacityReconstruction);
 assert.deepEqual(capacityReconstruction.presentation,before.presentation,'父來源與完整 presentation 不裁切');
 assert.deepEqual(recorded,before);assert.deepEqual(added.projectionCapacity,measure(added.projection));
 assert.equal(cue.semanticVerification,'not_performed');
});

test('可選提示容量不足明示，原 64/128 KiB 界限與完整材料保持',()=>{
 const exact={version:3,reasonBindings:[],padding:''};exact.padding='x'.repeat(65536-bytes(exact));assert.equal(bytes(exact),65536);
 const cue=calc(),fallback=attach(exact,cue);
 assert.equal(fallback.delivery.status,'not_evaluated_due_capacity');assert.equal(fallback.delivery.reason,'continuity_projection_limit');
 assert.equal(fallback.projection,exact);assert.equal(fallback.projection.sourceUseReview,undefined);assert.equal(fallback.delivery.semanticVerification,'not_performed');
 assert.equal(fallback.projectionCapacity.modelProjectionBytes,65536);
 assert.throws(()=>attach({...exact,padding:exact.padding+'x'},cue),/continuity_projection_limit/);
});

test('presentation generator 核對固定提示 metadata，不接受額外 ACK 或矛盾容量標記',()=>{
 const added=attach(recorded.projection,calc());
 const input={projection:added.projection,projectionHash:loopHash(added.projection),scopeId:recorded.scopeId,verifiedScopeId:recorded.scopeId,
  sourceUseReviewDelivery:added.delivery};
 assert.deepEqual(createPresentation(input).sourceUseReviewDelivery,added.delivery);
 assert.throws(()=>createPresentation({...input,sourceUseReviewDelivery:{...added.delivery,ack:true}}),/source_use_delivery_binding/);
 assert.throws(()=>createPresentation({...input,sourceUseReviewDelivery:{status:'not_evaluated_due_capacity',reason:'continuity_projection_limit'}}),/source_use_delivery_capacity/);
});

test('v6 正式入口重建可提供提示，legacy 與原精確範圍守護保持',async t=>{
 const output=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-source-use');await fs.mkdir(output,{recursive:true});
 const out=await fs.mkdtemp(path.join(output,'formal-')),now=new Date().toISOString(),scope='synthetic-source-use-reconstruction';
 const runtime=await createCmcpRuntimeSession({repoRoot:out,sessionId:'source-use-session',hostProvider:{request:async()=>{throw Error('禁止模型');}},
  config:{kind:'cmcp_runtime_config',version:1,runtimeId:'source-use-reconstruction',providerMode:'host',receiptRoot:path.join(out,'receipts'),
   input:{root:path.join(out,'state'),scopeId:scope,events:[],timezone:'Asia/Taipei',limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},
    storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
   sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}}});
 try{
  for(const source of fixture.sources)await runtime.ingest({role:'user',text:source.body,timeContext:{now:source.messageRecordedAt,timezone:'Asia/Taipei'}});
  const navigation=await runtime.readingNavigate({text:'查證已保存方案與明示修改。'});
  const opening=await runtime.readingOpen({navigationTicket:navigation.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:16384}});
  const pages=[];for(let i=0;i<64;i++){const page=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  const refs=fixture.sources.map(source=>pages.find(page=>page.reader.text===source.body).reader.source.ref),basis=recorded.projection.planBasis[0].source.citation.text;
  const proposal={version:6,plans:[{id:'upper',ref:refs[0],quote:basis,topic:'書櫃上層',aspect:'材質與上漆',temporalUse:'current',
   orderedChanges:[{kind:'content',ref:refs[1],quote:original.source.citation.text,edits:[{quote:'兩邊都先刷透明漆',kind:'replace',replacement:{ref:refs[1],quote:'這部分先不上漆'}}]}]}],unknowns:[]};
  const input=q=>({reading:opening,previousPages:pages,scopeId:scope,proposal:q,timeContext:{now,timezone:'Asia/Taipei'}});
  await t.test('正式 v6 currentPlans 旁有實算提示；ready 仍不是語意通過',()=>{
   const result=project(input(proposal));assert.equal(result.status,'ready');assert.equal(result.presentation.sourceUseReviewDelivery.status,'provided');
   assert.equal(result.projection.sourceUseReview.findings[0].unusedEffectRanges[0].text,'只把上層隔板改用夾板，而且');
   assert.equal(result.projection.validation.semantics,'not_performed');assert.equal(result.projection.eventMutation,'none');assert.equal(result.projection.sourceAssociationMutation,'none');
   assert.deepEqual(result.projectionCapacity,measure(result.projection));
   const forged={...copy(proposal),sourceUseReviewDelivery:{status:'provided'}};assert.throws(()=>project(input(forged)),'提示出口不是模型可提交的 ACK 欄位');
  });
  await t.test('重建兩段替換仍允許對象、連接詞、標點留在提示，不設全字元門檻',()=>{
   const corrected=copy(proposal);corrected.plans[0].orderedChanges[0].edits.unshift({quote:'隔板先用實木',kind:'replace',replacement:{ref:refs[1],quote:'隔板改用夾板'}});
   const result=project(input(corrected));assert.equal(result.status,'ready');assert.match(result.projection.currentPlans[0].text,/隔板改用夾板/);
   assert.deepEqual(intervals(result.projection.sourceUseReview.findings[0].unusedEffectRanges),[
    {start:5,end:9,text:'只把上層'},{start:15,end:18,text:'，而且'},{start:25,end:26,text:'；'}]);
  });
  await t.test('legacy v5 的表示與接受結果沒有新提示或新義務',()=>{
   const result=project(input({...copy(proposal),version:5}));assert.equal(result.status,'ready');
   assert.equal(result.projection.sourceUseReview,undefined);assert.equal(result.presentation.sourceUseReviewDelivery,undefined);
  });
  await t.test('舊片段缺失、跨來源 replacement、scope 與正式頁材料核對仍拒絕',()=>{
   const absent=copy(proposal);absent.plans[0].orderedChanges[0].edits[0].quote='不存在的舊片段';
   assert.throws(()=>project(input(absent)),/continuity_v4_edit_quote_absent/);
   const crossed=copy(proposal);crossed.plans[0].orderedChanges[0].edits[0].replacement={ref:refs[0],quote:'抽屜沿用舊面板'};
   assert.throws(()=>project(input(crossed)),/continuity_plan_replacement_source_mismatch/);
   assert.throws(()=>project({...input(proposal),scopeId:'another-scope'}));
   const corrupted=copy(pages);corrupted[0].modelContext='{}';assert.throws(()=>project({...input(proposal),previousPages:corrupted}),/reading_page_chain_mismatch/);
  });
  await fs.writeFile(path.join(out,'reconstruction-evidence.json'),JSON.stringify({kind:fixture.kind,reconstruction:fixture.reconstruction,
   modelCalls:0,semanticVerification:'not_performed',result:project(input(proposal))},null,2)+'\n',{flag:'wx'});
 }finally{await runtime.close();}
});
