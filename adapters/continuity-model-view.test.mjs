import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT??fileURLToPath(new URL('../',import.meta.url)));
const {projectContinuityModelView:project,restoreContinuityModelView:restore}=await import(pathToFileURL(path.join(root,'adapters/continuity-model-view.mjs')));
const {projectHarnessToolResult,CmcpHarnessBridge}=await import(pathToFileURL(path.join(root,'adapters/deepseek-harness/runtime-bridge.mjs')));
const clone=structuredClone,hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(){
 const text='只整理已列出的樣本，尚未授權其他項目；保留原時間。'.repeat(18);
 const source={ref:'r1',sourceAuthorRole:'user',messageRecordedAt:'2026-02-11T03:04:05.006Z',eventOccurredAt:null,evidenceHash:'a'.repeat(64),citation:{unit:'unicode_code_points',start:0,end:[...text].length,text}};
 const row={nodeId:'p1',objectId:'合成整理',aspect:'範圍',text,planStatus:'planned',planVersion:'p-v1',changeId:null,sourceFragments:[source]};
 const reason={nodeId:'p1',text:'避免誤把未授權工作算成完成。',source:clone(source),binding:{kind:'plan_basis',nodeId:'p1',basisVersion:'p-v1'}};
 return {kind:'cmcp_continuity_projection',status:'ready',reason:null,ticket:'t1',projectionHash:'full-core-hash',modelCoverageComplete:true,modelCalls:0,
  projection:{kind:'query_scoped_derived_continuity',version:3,authority:'correctable_host_interpretation_not_world_verification',semanticVerification:'not_performed',activation:'none',proactiveEligible:false,
   currentPlans:[row],currentClaims:[],reasons:[reason],reasonRelations:[],unknowns:['核准日期未提供'],unknownParts:[],unresolved:[],unresolvedPlans:[],retentions:[],
   planCoverage:{scope:'proposed_source_bound_plan_bases_only',historyCompleteness:'not_established'},reasonCoverage:{omissionMeaning:'not_provided_does_not_mean_no_reason'},
   sources:[clone(source)],coverage:{modelCoverageComplete:true,historyCompleteness:'not_established',uncitedReadSources:['r2']},runtimeTime:{now:'2026-02-13T02:00:00Z'},
   knownEvolution:[{nodeId:'p1',source:clone(source),interpretation:{kind:'user_intent',text},reason:clone(reason)}],
   planBasis:[{nodeId:'p1',baseVersion:'p-v1',source:clone(source),candidates:[clone(row)]}],
   planChanges:[{id:'change1',source:clone(source),reasonStatus:'provided',reason:clone(reason),textBefore:text}],planEvidence:[]}};
}
test('去重可逆且主要狀態／理由／來源／時間／覆蓋完整直出，不改輸入',()=>{
 const original=fixture(),before=clone(original),view=project(original);
 assert.ok(view.modelView);assert.ok(Buffer.byteLength(JSON.stringify(view))<Buffer.byteLength(JSON.stringify(original)));
 assert.deepEqual(original,before);assert.deepEqual(restore(view),original);
 for(const key of Object.keys(original.projection).filter(key=>!['knownEvolution','planBasis','planChanges','planEvidence'].includes(key)))assert.deepEqual(view.projection[key],original.projection[key]);
 assert.equal(view.projectionHash,original.projectionHash);assert.equal(view.projection.version,3);
 assert.ok(view.modelView.instruction.includes('not missing, unknown, withdrawn'));
});
test('不同原文／角色／原時間／版本／理由／覆蓋不得因相似而合併',()=>{
 const original=fixture();original.projection.planBasis[0].candidates[0].text+='仍是提案';
 original.projection.planChanges[0].source.sourceAuthorRole='assistant';
 original.projection.planChanges[0].source.messageRecordedAt='2026-02-12T03:04:05.006Z';
 original.projection.planChanges[0].source.evidenceHash='b'.repeat(64);
 original.projection.planChanges[0].reason.binding.basisVersion='older-version';
 original.status='partial';original.modelCoverageComplete=false;original.projection.coverage.modelCoverageComplete=false;
 const restored=restore(project(original));assert.deepEqual(restored,original);
 assert.notDeepEqual(restored.projection.planBasis[0].candidates[0],restored.projection.currentPlans[0]);
 assert.equal(restored.projection.planChanges[0].source.sourceAuthorRole,'assistant');
});

test('適用範圍查證綁定精確去重，主要狀態與用途 finding 仍直接呈現',()=>{
 const original=fixture(),source=clone(original.projection.sources[0]);
 original.projection.currentPlans[0].applicability={scopeId:'scope-a',scopeLabel:'合成範圍',scopedPlanBindingHash:'b'.repeat(64)};
 original.projection.reportScopeReview={status:'required',findings:[{findingId:'c'.repeat(64),report:{source:clone(source)},requiredResolutionKind:'reported_state_in_status_message'}]};
 original.projection.scopedPlanBindings=[{nodeId:'p1',scopeId:'scope-a',scopeSource:clone(source),conditionSource:clone(source),executionAuthority:'none'},
  {nodeId:'p2',scopeId:'scope-b',scopeSource:{...clone(source),evidenceHash:'d'.repeat(64)},conditionSource:clone(source),executionAuthority:'none'}];
 const view=project(original);
 assert.deepEqual(restore(view),original);
 for(const field of ['currentPlans','currentClaims','sources','runtimeTime','coverage','reportScopeReview'])assert.deepEqual(view.projection[field],original.projection[field]);
 assert(view.projection.scopedPlanBindings[0].scopeSource.$cmcpExactRef);
 assert.notDeepEqual(view.projection.scopedPlanBindings[1].scopeSource,view.projection.scopedPlanBindings[0].scopeSource);
 assert.equal(view.projection.scopedPlanBindings[0].executionAuthority,'none');
 assert.ok(JSON.stringify(view).length<JSON.stringify(original).length);
});
test('保留競爭分支、取消／暫停與未知；不生成授權',()=>{
 const original=fixture(),paused=clone(original.projection.currentPlans[0]);paused.planStatus='paused';paused.planVersion='p-v2';
 original.projection.currentPlans=[];original.projection.planBasis[0].candidates.push(paused);
 original.projection.unresolvedPlans=[{nodeId:'p1',reason:'competing_explicit_plan_change_branches',candidates:clone(original.projection.planBasis[0].candidates)}];
 original.projection.planChanges[0].planStatus='cancelled';
 const view=project(original);assert.deepEqual(view.projection.unresolvedPlans,original.projection.unresolvedPlans);assert.deepEqual(restore(view),original);
 assert.equal(view.projection.activation,'none');assert.equal(view.projection.proactiveEligible,false);
});
test('v4編譯metadata與v3投影經正常Harness projector保留且可逆',()=>{
 const original=fixture();original.inputVersion=4;original.compilation={version:1,inputVersion:4,outputVersion:3,interpretation:'not_verified',nodes:2};
 const view=projectHarnessToolResult(original);assert.deepEqual(view.compilation,original.compilation);assert.equal(view.inputVersion,4);assert.deepEqual(restore(view),original);
 const rendered=projectHarnessToolResult(JSON.parse(JSON.stringify(projectHarnessToolResult(view))));
 assert.deepEqual(rendered,view);assert.equal(JSON.stringify(rendered),JSON.stringify(view));assert.deepEqual(restore(rendered),original);
 assert.equal(rendered.modelView.sourceResultSha256,hash(original));assert.equal(rendered.projectionHash,'full-core-hash');
});
test('正式工具白名單保留編譯回執而不洩漏internal；呈現重投影仍一次還原',async()=>{
 const original=fixture();original.inputVersion=4;original.compilation={kind:'thin_contract_compilation',version:1,sourceBound:true};
 const runtime={config:{input:{timezone:'Asia/Taipei'}},readingContinuity:async()=>({...clone(original),internal:{privateQuery:'不應進模型結果'}})};
 const fixtureBridge={enqueue:operation=>operation(),turn:async()=>({turn:{text:'合成查閱',enhanced:true,capture:{},readings:new Set(['t1'])},runtime}),validate:async()=>{},note:async()=>{}};
 const full=await CmcpHarnessBridge.prototype.tool.call(fixtureBridge,'synthetic-session','cmcp_project_continuity',{ticket:'t1',proposalJson:'{}'});
 assert.deepEqual(full,original);assert.equal(full.internal,undefined);
 const received=projectHarnessToolResult(full),rendered=JSON.parse(JSON.stringify(projectHarnessToolResult(received)));
 assert.deepEqual(restore(rendered),full);assert.equal(rendered.inputVersion,4);
});
test('既有正式閱讀頁／導航的協定折疊路徑不受接續view干擾',()=>{
 const nav={kind:'cmcp_reading_navigation',question:'q',selection:{input:{question:'q'}}};
 assert.deepEqual(projectHarnessToolResult(nav),{kind:'cmcp_reading_navigation',selection:nav.selection});
 const page={kind:'cmcp_reading_page',ticket:'t1',source:{ref:'r1',sourceAuthorRole:'user',messageRecordedAt:'2026-02-11T03:04:05.006Z'},coverage:{complete:true},runtimeTime:{now:'2026-02-13T02:00:00Z'},originalText:'uncut',modelContext:JSON.stringify({kind:'cmcp_reading_page_context',sourceRef:'r1',source:{sourceAuthorRole:'user'},time:{},content:'原話不可裁切',runtimeTime:{now:'2026-02-13T02:00:00Z'}})};
 const viewed=projectHarnessToolResult(page);assert.equal(viewed.modelContext.content,'原話不可裁切');assert.ok(viewed.pageProtocol);assert.equal(viewed.modelView,undefined);
});
test('沒有收益、拒絕或非投影結果保持原值，不把錯誤轉成完成',()=>{
 for(const original of [{kind:'other',text:'一般聊天'}, {kind:'cmcp_continuity_projection',status:'rejected',correction:{code:'source_missing'}},
  {kind:'cmcp_continuity_projection',status:'ready',projection:{version:3,currentPlans:[],planBasis:[]}}])assert.equal(project(original),original);
});
test('引文含Unicode、重複空白及JSON Pointer跳脫仍逐字還原',()=>{
 const original=fixture(),text='🧪　 A  A\n\t尾段'.repeat(80);
 original.projection.currentPlans[0].sourceFragments[0].citation.text=text;
 original.projection['來源/時間~對照']={citation:clone(original.projection.currentPlans[0].sourceFragments[0].citation)};
 original.projection.planChanges.push(clone(original.projection['來源/時間~對照']));
 const view=project(original);assert.deepEqual(restore(view),original);assert.ok(JSON.stringify(view).includes('$cmcpExactRef'));
});
test('原件自有保留欄位、非JSON資料、負零及稀疏陣列保守不轉換',()=>{
 for(const value of [{$cmcpExactRef:'/arbitrary'},undefined,NaN,-0,Array(2)]){const original=fixture();original.projection.extra=value;assert.equal(project(original),original);}
});
test('內容或hash遭改動不得還原為正式原投影',()=>{
 const view=project(fixture());view.projection.currentPlans[0].planStatus='completed';assert.throws(()=>restore(view),/continuity_model_view_invalid/);
});
test('偽造外部／不存在／循環參照即拒絕；不存取任意路徑',()=>{
 for(const pointer of ['/outside','/projection/missing','/projection/planBasis/0']){
  const view=project(fixture());view.projection.planBasis[0]={$cmcpExactRef:pointer};
  const {modelView,...body}=view;modelView.viewResultSha256=hash(body);
  assert.throws(()=>restore(view),/continuity_model_view_reference_(invalid|missing|cycle)/);
 }
});
