import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const product=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=file=>import(pathToFileURL(path.join(product,file)).href),copy=structuredClone;
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,validateCmcpContinuityPublication:publish}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {continuityToolSchema}=await load('adapters/continuity-input.mjs');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');

test('修改範圍保留完整來源；獨立保留依票券、版本及正式 User retention 核對',async t=>{
 const root=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-scope-resolution');await fs.mkdir(root,{recursive:true});
 const out=await fs.mkdtemp(path.join(root,'formal-')),scope='synthetic-scope-resolution',now='2026-10-11T00:00:00.000Z',timezone='Asia/Taipei';
 const bodies=['甲與乙是各自獨立的安排，原定都是週一。','只把甲改成週二，乙維持週一。','這是 Assistant 的建議，不是 User 的保留決定。'];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:scope,providerMode:'host',input:{root:path.join(out,'state'),scopeId:scope,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:32,maxSourceBytes:8192},
  loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:scope+'-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 try{
  for(const [i,text]of bodies.entries())await runtime.ingest({role:i===2?'assistant':'user',text,timeContext:{now:new Date(Date.parse(now)-600000+i*60000).toISOString(),timezone}});
  const navigation=await runtime.readingNavigate({text:'核對原定安排與後來的局部修改。'});
  const open=()=>runtime.readingOpen({navigationTicket:navigation.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:32,maxTotalBytes:32768,maxPageBytes:4096,maxPages:32,maxProjectionBytes:32768}});
  const opening=await open(),pages=[];for(let i=0;i<32;i++){const page=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  const refs=bodies.map(text=>pages.find(page=>page.reader.text===text).reader.source.ref);
  const input=q=>({reading:opening,previousPages:pages,scopeId:scope,proposal:q,timeContext:{now,timezone}}),calc=q=>project(input(q));
  const plan=(id,extra={})=>({id,ref:refs[0],quote:'週一',topic:'安排',aspect:id,temporalUse:'current',...extra});
  const build=()=>({version:6,plans:[plan('a',{orderedChanges:[{kind:'content',ref:refs[1],quote:bodies[1],edits:[{kind:'replace',quote:'週一',replacement:{ref:refs[1],quote:'週二'}}]}]}),
   plan('b',{retentions:[{ref:refs[1],quote:'乙維持週一',temporalUse:'current'}]})],unknowns:[]});
  const resolution=q=>{const f=calc(q).projection.planScopeReview.findings[0];return {findingId:f.findingId,kind:'independent_retention',source:copy(f.source),
   retainedPlan:copy(f.retainedPlan),changedPlan:copy(f.changedPlan),evidence:{ref:refs[1],quote:'乙維持週一'}};};
  const resolved=()=>{const q=build();q.scopeResolutions=[resolution(q)];return q;};
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({config,opening,pages,refs,bodies},null,2)+'\n',{flag:'wx'});
  await t.test('未處理 finding 為 partial，來源模型材料仍完整，原計畫及原時間保留',()=>{
   const result=calc(build()),p=result.projection;assert.equal(result.status,'partial');assert.equal(result.reason,'scope_review_required');assert.equal(result.modelCoverageComplete,true);
   assert.deepEqual(result.readinessReasons,['scope_review_required']);assert.deepEqual(p.currentPlans.map(row=>row.text),['週二','週一']);assert.deepEqual(p.unknowns,[]);
   assert.equal(p.planScopeReview.unresolvedFindings,1);const f=p.planScopeReview.findings[0];assert.equal(f.source.pointer.scopeId,scope);assert.match(f.findingId,/^[a-f0-9]{64}$/);
   assert.equal(p.currentPlans[1].sourceFragments[0].messageRecordedAt,new Date(Date.parse(now)-600000).toISOString());assert.equal(p.validation.executionAuthority,'none');
  });
  await t.test('同案寬基底補齊精確修改可消除 finding，未改條件不由引文自動改寫',()=>{
   const q=build();q.plans[1].orderedChanges=copy(q.plans[0].orderedChanges);delete q.plans[1].retentions;
   const result=calc(q);assert.equal(result.status,'ready');assert.equal(result.projection.planScopeReview.status,'no_overlap_detected');assert.deepEqual(result.projection.currentPlans.map(row=>row.text),['週二','週二']);
  });
  await t.test('正式 User 明示獨立保留可綁定，機械 ready 不升格成語意或執行通過',()=>{
   const q=resolved();assert.equal(continuityToolSchema.safeParse({ticket:opening.reader.ticket,proposal:q}).success,true);
   const result=calc(q),r=result.projection.planScopeReview;assert.equal(result.status,'ready');assert.equal(r.unresolvedFindings,0);assert.equal(r.status,'addressed_by_source_bound_host_resolution');
   assert.equal(r.semanticVerification,'not_performed');assert.equal(r.resolutions[0].semanticVerification,'not_performed');assert.equal(r.resolutions[0].executionAuthority,'none');assert.deepEqual(result.projection.currentPlans.map(row=>row.text),['週二','週一']);
  });
  await t.test('JSON 成員順序無關，不將同一正式 Pointer 誤拒絕',()=>{
   const q=resolved(),r=q.scopeResolutions[0];r.source.pointer=Object.fromEntries(Object.entries(r.source.pointer).reverse());r.source.range={end:r.source.range.end,start:r.source.range.start,unit:r.source.range.unit};
   r.retainedPlan={planVersion:r.retainedPlan.planVersion,nodeId:r.retainedPlan.nodeId};assert.equal(calc(q).status,'ready');
  });
  for(const [name,mutate]of [
   ['finding ID',r=>{r.findingId='0'.repeat(64);}],['Pointer scope',r=>{r.source.pointer.scopeId='another-scope';}],['Pointer revision',r=>{r.source.pointer.revisionId='another-revision';}],
   ['來源 hash',r=>{r.source.evidenceHash='0'.repeat(64);}],['Unicode range',r=>{r.source.range.end++;}],['保留版本',r=>{r.retainedPlan.planVersion='0'.repeat(64);}],
   ['修改版本',r=>{r.changedPlan.planVersion='0'.repeat(64);}],['修改 ID',r=>{r.changedPlan.changeId='another-change';}],['來源 ref',r=>{r.source.ref=refs[1];}],
   ['目標反置',r=>{const id=r.retainedPlan.nodeId;r.retainedPlan.nodeId=r.changedPlan.nodeId;r.changedPlan.nodeId=id;}]
  ])await t.test(name+' 不符拒絕，不接受舊回執重播',()=>{const q=resolved();mutate(q.scopeResolutions[0]);assert.throws(()=>calc(q),/continuity_scope_resolution_binding/);});
  await t.test('提案變動使目前 planVersion 不同，即使來源相同也拒絕舊宣告',()=>{const q=resolved();q.plans[1].planStatus='paused';assert.throws(()=>calc(q),/continuity_scope_resolution_binding/);});
  await t.test('重複 resolution、布林 ack 及不支援 kind 拒絕',()=>{
   const q=resolved();q.scopeResolutions.push(copy(q.scopeResolutions[0]));assert.throws(()=>calc(q),/continuity_scope_resolution_binding/);
   for(const value of [true,{ack:true}]){const p=build();p.scopeResolutions=[value];assert.throws(()=>calc(p),/continuity_plan_change_shape/);}
   const p=resolved();p.scopeResolutions[0].kind='ack';assert.throws(()=>calc(p),/continuity_scope_resolution_binding/);
  });
  await t.test('未宣告正式 retention 或非 current 不得 ack 過關',()=>{
   const q=resolved();delete q.plans[1].retentions;assert.throws(()=>calc(q),/continuity_scope_resolution_retention_required/);
   const p=resolved();p.plans[1].retentions[0].temporalUse='historical';assert.throws(()=>calc(p),/continuity_scope_resolution_retention_required/);
  });
  await t.test('Assistant、缺原話、未正式讀取引文皆 fail closed',()=>{
   const q=resolved();q.scopeResolutions[0].evidence={ref:refs[2],quote:bodies[2]};assert.throws(()=>calc(q),/continuity_scope_resolution_user_source_required/);
   const p=resolved();p.scopeResolutions[0].evidence.quote='不存在的明示保留';assert.throws(()=>calc(p),/continuity_quote_absent/);
   const s=resolved();s.scopeResolutions[0].evidence.ref='outside';assert.throws(()=>calc(s),/continuity_source_outside_reading/);
  });
  await t.test('重引被改原區間即使填 retention 仍拒絕',()=>{
   const q=build();q.plans[1].retentions=[{ref:refs[0],quote:'週一',temporalUse:'current'}];q.scopeResolutions=[resolution(q)];q.scopeResolutions[0].evidence={ref:refs[0],quote:'週一'};
   assert.throws(()=>calc(q),/continuity_scope_resolution_distinct_support_required/);
  });
  await t.test('超過八筆仍保持 pending／truncated，不能以已列八筆冒充全處理',()=>{
   const q=build();q.plans=[q.plans[0],...Array.from({length:10},(_,i)=>plan('b'+i,i<8?{retentions:[{ref:refs[1],quote:'乙維持週一',temporalUse:'current'}]}:{}))];
   const review=calc(q).projection.planScopeReview;assert.equal(review.totalFindings,10);assert.equal(review.truncated,true);
   q.scopeResolutions=review.findings.map(f=>({findingId:f.findingId,kind:'independent_retention',source:copy(f.source),retainedPlan:copy(f.retainedPlan),changedPlan:copy(f.changedPlan),evidence:{ref:refs[1],quote:'乙維持週一'}}));
   const result=calc(q);assert.equal(result.status,'partial');assert.equal(result.projection.planScopeReview.unresolvedFindings,2);assert.equal(result.projection.planScopeReview.truncated,true);
  });
  await t.test('publication 同步部分狀態；把 pending 改成 ready 即拒絕',async()=>{
   const result=calc(build());assert.equal((await runtime.readingContinuity({ticket:opening.reader.ticket,proposal:build()})).status,'partial');
   assert.equal((await runtime.continuityStatus()).reason,'scope_review_required');
   await assert.rejects(publish({stores:{scopeId:scope},reading:opening,previousPages:pages,result:{...result,status:'ready',reason:null},timeContext:{now,timezone}}),/continuity_projection_binding_changed/);
   const accepted=await runtime.readingContinuity({ticket:opening.reader.ticket,proposal:resolved()});assert.equal(accepted.status,'ready');assert.equal((await runtime.continuityStatus()).status,'ready');
  });
  await t.test('來源覆蓋不足與 scope pending 原因同時保留，不用其中一層遮另一層',async()=>{
   const secondNavigation=await runtime.readingNavigate({text:'再核對原定安排與後來的局部修改。'});
   const second=await runtime.readingOpen({navigationTicket:secondNavigation.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:32,maxTotalBytes:32768,maxPageBytes:4096,maxPages:32,maxProjectionBytes:32768}}),sPages=[];
   for(let i=0;i<32;i++){const expected=second.internal.manifest.sources[i];const p=await runtime.readingPage({ticket:second.reader.ticket,project:expected?.sourceAuthorRole!=='assistant'});sPages.push(p);if(p.reader.coverage.complete)break;}
   const sRefs=bodies.map(text=>sPages.find(page=>page.reader.text===text).reader.source.ref),q=build();
   for(const plan of q.plans){plan.ref=sRefs[0];for(const c of plan.orderedChanges??[]){c.ref=sRefs[1];for(const edit of c.edits)edit.replacement.ref=sRefs[1];}for(const r of plan.retentions??[])r.ref=sRefs[1];}
   const r=project({reading:second,previousPages:sPages,scopeId:scope,proposal:q,timeContext:{now,timezone}});
   assert.equal(r.modelCoverageComplete,false);assert.equal(r.status,'partial');assert.deepEqual(r.readinessReasons,['model_material_incomplete','scope_review_required']);
  });
  await t.test('查看不改原文時間、Buffer TTL 或 controls；Clean/OFF 守護仍有效',async()=>{
   const before=await runtime.bufferList(),beforeHash=loopHash(before.items);calc(resolved());await runtime.continuityStatus();assert.equal(loopHash((await runtime.bufferList()).items),beforeHash);
   await runtime.configureControls({updateId:'scope-resolution-clean',patch:{clean:true}});assert.equal((await runtime.continuityStatus()).projection,null);
   await runtime.configureControls({updateId:'scope-resolution-clean-off',patch:{clean:false}});assert.equal((await runtime.continuityStatus()).status,'unavailable');
   await runtime.configureControls({updateId:'scope-resolution-off',patch:{enabled:false}});assert.equal((await runtime.readingContinuity({ticket:opening.reader.ticket,proposal:resolved()})).status,'disabled');
  });
 }finally{await runtime.close();}
});
