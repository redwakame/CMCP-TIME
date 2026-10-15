import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=relative=>import(pathToFileURL(path.join(productRoot,relative)));
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,measureCmcpContinuityProjectionCapacity:measure,CMCP_CONTINUITY_PROJECTION_LIMITS:limits}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {projectContinuityModelView:compact,restoreContinuityModelView:restore}=await load('src/cmcp-guard/cmcp-continuity-model-view.js');
const oldCodec=await load('adapters/continuity-model-view.mjs');
const {projectHarnessToolResult}=await load('adapters/deepseek-harness/runtime-bridge.mjs');
const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/continuity-capacity-c27.json',import.meta.url),'utf8'));
const bytes=value=>Buffer.byteLength(JSON.stringify(value)),sha=value=>createHash('sha256').update(value).digest('hex'),copy=structuredClone;
const envelope=projection=>({kind:'cmcp_continuity_projection',status:'ready',projection});
const checkedSourcePaths=['src/cmcp-guard/cmcp-continuity-projection.js','src/cmcp-guard/cmcp-continuity-model-view.js','src/cmcp-guard/cmcp-runtime-session.js','src/cmcp-guard/cmcp-continuity-plan-patch.js','adapters/continuity-model-view.mjs','adapters/deepseek-harness/runtime-bridge.mjs'];
const checkedSources=await Promise.all(checkedSourcePaths.map(async relative=>({relative,sha256:sha(await fs.readFile(path.join(productRoot,relative)))})));
const outputParent=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-capacity');
await fs.mkdir(outputParent,{recursive:true});
const output=await fs.mkdtemp(path.join(outputParent,'capacity-'));

// 容量只量投影段；正式工具封套與傳輸界另列，不把結構驗證當語意成功。
test('模型投影與展開投影使用兩道有限硬界',async t=>{
 await t.test('舊限制名稱保留相容數值，既有輸入與節點界未放寬',()=>{
  assert.equal(limits.maxProjectionBytes,65536);assert.equal(limits.maxModelProjectionBytes,65536);assert.equal(limits.maxExpandedProjectionBytes,131072);
  assert.equal(limits.maxProposalBytes,24576);assert.equal(limits.maxNodes,24);assert.equal(limits.maxQuoteCodePoints,1024);
  assert.equal(oldCodec.projectContinuityModelView,compact);assert.equal(oldCodec.restoreContinuityModelView,restore);
 });
 await t.test('編碼投影恰為 64 KiB 接受，多一 byte 仍以原錯碼拒絕',()=>{
  const projection={text:''};projection.text='x'.repeat(65536-bytes(projection));assert.equal(bytes(projection),65536);
  assert.equal(measure(projection).modelProjectionBytes,65536);
  const overflow={...projection,text:projection.text+'x'};assert.equal(bytes(overflow),65537);
  assert.throws(()=>measure(overflow),/^Error: continuity_projection_limit$/);
 });
 await t.test('可逆重複資料恰為 128 KiB 接受，多一 byte 由展開硬界拒絕',()=>{
  const row={id:'synthetic-row',text:'x'.repeat(15000),source:{ref:'r1',role:'user',originalTime:'2026-10-10T00:00:00.000Z',version:'v1'}};
  const projection={currentPlans:[row],knownEvolution:Array.from({length:7},()=>copy(row)),capacityPadding:''};
  assert(bytes(projection)<131072);projection.capacityPadding='p'.repeat(131072-bytes(projection));assert.equal(bytes(projection),131072);
  const before=copy(projection),capacity=measure(projection),view=compact(envelope(projection));
  assert.equal(capacity.expandedProjectionBytes,131072);assert(capacity.modelProjectionBytes<65536);assert.equal(capacity.encoding,'exact_object_references');
  assert.deepEqual(restore(view),envelope(projection));assert.deepEqual(projection,before);assert.deepEqual(view.projection.currentPlans,projection.currentPlans);
  const overflow=copy(projection);overflow.capacityPadding+='p';assert.equal(bytes(overflow),131073);
  assert.throws(()=>measure(overflow),/^Error: continuity_projection_expanded_limit$/);
 });
 await t.test('不同角色、時間、版本及引文不因容量編碼合併，無外部引用',()=>{
  const row={id:'synthetic-row',text:'一個必要原文片段'.repeat(40),source:{ref:'r1',role:'user',originalTime:'2026-10-10T00:00:00.000Z',version:'v1'}};
  const changed=[{...copy(row),source:{...row.source,role:'assistant'}},{...copy(row),source:{...row.source,originalTime:'2026-10-10T00:01:00.000Z'}},{...copy(row),source:{...row.source,version:'v2'}},{...copy(row),text:row.text+'另一片段'}];
  const full=envelope({currentPlans:[row],knownEvolution:[copy(row),...changed]}),view=compact(full);assert.deepEqual(restore(view),full);
  for(const [i,value]of changed.entries())assert.notDeepEqual(view.projection.knownEvolution[i+1],{$cmcpExactRef:'/projection/currentPlans/0'});
  const bad=copy(view);bad.projection.knownEvolution[0]={$cmcpExactRef:'file:///outside'};assert.throws(()=>restore(bad),/continuity_model_view_invalid/);
  assert.throws(()=>compact({...full,modelView:{encoding:'pretend'}}),/continuity_model_view_invalid/);
 });
});

test('四個已關閉合成提案經正式 Runtime 保存、閱讀、投影及無損公開結果',async t=>{
 const rows=[];
 for(const [caseIndex,item]of fixture.cases.entries())await t.test(item.id,async()=>{
  assert.equal(sha(JSON.stringify(item.proposal)),item.proposalSha256);
  for(const source of item.sources)assert.equal(sha(source.text),source.bodySha256);
  const area=path.join(output,item.id),scopeId='synthetic-capacity-'+caseIndex,timezone='Asia/Taipei',now='2026-10-11T00:00:00.000Z';
  const config={kind:'cmcp_runtime_config',version:1,runtimeId:scopeId,providerMode:'host',input:{root:path.join(area,'state'),scopeId,events:[],timezone,
   limits:{maxEntries:12,maxCatalogBytes:14000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:14000},storageCapacity:{maxSources:32,maxSourceBytes:8192},
   loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(area,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
  const runtime=await createCmcpRuntimeSession({config,repoRoot:area,sessionId:'synthetic-capacity-session-'+caseIndex,hostProvider:{request:async()=>{throw Error('本測試禁止模型');}}});
  let row={id:item.id,originalSequence:item.originalSequence,priorResult:item.priorResult,proposalSha256:item.proposalSha256,modelCalls:0,semanticVerification:'not_performed'};
  try{
   for(const source of item.sources)await runtime.ingest({role:source.role,text:source.text,timeContext:{now:source.messageRecordedAt,timezone}});
   const nav=await runtime.readingNavigate({text:'核對已選來源的計畫、修訂、理由及原時間。'});
   const reading=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:32,maxTotalBytes:65536,maxPageBytes:4096,maxPages:32,maxProjectionBytes:32768}});
   const pages=[];for(let page=0;page<32;page++){const value=await runtime.readingPage({ticket:reading.reader.ticket,project:true});pages.push(value);if(value.reader.coverage.complete)break;}
   assert(pages.at(-1).reader.coverage.complete);
   for(const source of item.sources){const selected=pages.filter(page=>page.reader.source.ref===source.ref);assert.equal(selected.map(page=>page.reader.text).join(''),source.text);assert.equal(selected[0].reader.source.sourceAuthorRole,source.role);assert.equal(selected[0].reader.source.messageRecordedAt,source.messageRecordedAt);}
   const proposal=copy(item.proposal),before={reading:copy(reading),pages:copy(pages),buffer:(await runtime.bufferList()).items};
   const input=change=>({reading,previousPages:pages,scopeId,proposal:change,timeContext:{now,timezone}});
   const result=await runtime.readingContinuity({ticket:reading.reader.ticket,proposal});
   // 原提案的待核範圍仍保留；容量／來源完整不再冒充修訂範圍已處理。
   assert.equal(result.status,'partial');assert.equal(result.reason,'scope_review_required');assert.equal(result.modelCoverageComplete,true);
   assert.equal(result.projection.planScopeReview.status,'required');assert(result.projection.planScopeReview.unresolvedFindings>0);
   const encoded=compact(result),publicResult=JSON.parse(JSON.stringify(projectHarnessToolResult(result))),restored=restore(publicResult);
   assert.deepEqual(restore(encoded),result);assert.deepEqual(restored,result);assert.deepEqual(proposal,item.proposal);
   assert.deepEqual(result.projectionCapacity,measure(result.projection));assert.equal(result.projectionCapacity.expandedProjectionBytes,bytes(result.projection));
   assert.equal(result.projectionCapacity.modelProjectionBytes,bytes(encoded.projection));assert.equal(result.projectionCapacity.measurementScope,'projection_only');
   assert.equal(result.projectionCapacity.wireEnvelopeLimit,'transport_defined');assert.equal(result.projectionCapacity.lossless,true);
   for(const key of ['sources','currentPlans','currentClaims','reasonBindings','reasonRelations','retentions','runtimeTime','coverage'])assert.deepEqual(encoded.projection[key],result.projection[key]);
   assert.equal(result.projection.validation.executionAuthority,'none');assert.equal(result.projection.activation,'none');assert.equal(result.projection.proactiveEligible,false);
   for(const cited of result.projection.sources){const source=item.sources.find(value=>value.ref===cited.ref);assert(source);assert.equal(cited.sourceAuthorRole,source.role);assert.equal(cited.messageRecordedAt,source.messageRecordedAt);}
   if(item.priorResult==='continuity_projection_limit')assert(bytes(result.projection)>65536);
   assert(bytes(result.projection)<=131072);assert(bytes(encoded.projection)<=65536);
   const state=await runtime.continuityStatus();assert.equal(state.projectionHash,result.projectionHash);assert.deepEqual(state.projectionCapacity,result.projectionCapacity);
   assert.deepEqual((await runtime.bufferList()).items,before.buffer);assert.deepEqual(reading,before.reading);assert.deepEqual(pages,before.pages);
   await fs.writeFile(path.join(area,'formal-reading.json'),JSON.stringify({reading,pages},null,2)+'\n',{flag:'wx'});
   await fs.writeFile(path.join(area,'formal-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
   await fs.writeFile(path.join(area,'model-result.json'),JSON.stringify(publicResult,null,2)+'\n',{flag:'wx'});
   row={...row,status:'PASS',fullProjectionBytes:bytes(result.projection),encodedProjectionBytes:bytes(encoded.projection),completeCoreResultBytes:bytes(result),directRuntimeSerializerBytes:bytes(publicResult),projectionCapacity:result.projectionCapacity,projectionHash:result.projectionHash,sourceCount:result.projection.sources.length};
   if(caseIndex===0){
    assert.throws(()=>project({...input(proposal),scopeId:'not-authorized-scope'}),/invalid_reading_manifest/);
    assert.throws(()=>project({...input(proposal),previousPages:pages.slice(0,-1)}),/continuity_complete_selected_reading_required/);
    const changed=copy(reading);changed.internal.manifest.sources[0].pointer.revisionId='not-the-formal-version';assert.throws(()=>project({...input(proposal),reading:changed}),/invalid_reading_manifest/);
    const missing=copy(proposal);missing.plans[0].ref='outside-reading';assert.throws(()=>project(input(missing)),/continuity_source_outside_reading/);
    // 用沒有 edits 的單一計畫隔離正式引文檢查；改動既有 base 會先被編譯器的 edit 範圍檢查拒絕。
    const falseQuote={version:6,plans:[{id:'absent-quote',ref:item.sources[0].ref,quote:'不在正式原文內的合成片段',topic:'合成引文反例',aspect:'原文',temporalUse:'current'}],unknowns:[]};assert.throws(()=>project(input(falseQuote)),/continuity_quote_absent/);
    const assistant=item.sources.find(source=>source.role==='assistant');assert(assistant);
    // 限短引文，避免先碰到原有節點文字上限而未走到角色守護。
    const badRole={version:6,plans:[{id:'wrong-role',ref:assistant.ref,quote:[...assistant.text].slice(0,80).join(''),topic:'合成角色反例',aspect:'原文',temporalUse:'current'}],unknowns:[]};
    assert.throws(()=>project(input(badRole)),/continuity_source_role_mismatch/);
    row.formalGuards='scope／完整閱讀／版本／來源／精確引文／角色均保持拒絕';
   }
   if(caseIndex===fixture.cases.length-1){
    await runtime.revokeReading({ticket:reading.reader.ticket,reason:'caller_revoked'});assert.equal((await runtime.continuityStatus()).projection,null);
    await runtime.configureControls({updateId:'capacity-off',patch:{enabled:false},persist:false});assert.equal((await runtime.readingContinuity({ticket:reading.reader.ticket,proposal})).status,'disabled');
    await runtime.configureControls({updateId:'capacity-clean',patch:{enabled:true,clean:true},persist:false});assert.equal((await runtime.continuityStatus()).projection,null);
    assert.deepEqual((await runtime.bufferList()).items,before.buffer);row.controls='撤權／OFF／Clean 保持，Buffer 與原時間不刷新';
   }
  }catch(error){row={...row,status:'FAIL',error:error.message};throw error;}
  finally{await runtime.close();row.runtimeClosed=true;rows.push(row);await fs.writeFile(path.join(area,'result.json'),JSON.stringify(row,null,2)+'\n',{flag:'wx'});}
 });
 for(const source of checkedSources)assert.equal(sha(await fs.readFile(path.join(productRoot,source.relative))),source.sha256,'測試期間產品來源不得變動：'+source.relative);
 await fs.writeFile(path.join(output,'results.json'),JSON.stringify({kind:'cmcp_capacity_zero_model_results',productRoot,checkedSources,modelCalls:0,semanticVerification:'not_performed',boundary:'64 KiB 僅編碼後投影段；directRuntimeSerializerBytes 是完整 Runtime 結果經 serializer 的大小，並非宿主公開封套或實際 wire；容量通過不修正或證明原提案語意。',rows},null,2)+'\n',{flag:'wx'});
});
