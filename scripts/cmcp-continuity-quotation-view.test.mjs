import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=file=>import(pathToFileURL(path.join(productRoot,file)).href);
const {createCmcpQuotationView:view,CMCP_QUOTATION_VIEW_LIMITS:limits}=await load('src/cmcp-guard/cmcp-continuity-quotation-view.js');
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');
const copy=structuredClone;
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;

// 只測來源／範圍參照機制；沒有模型答案、正式宿主成功或新執行授權。
function scopedFixture(){
 const original='兩件採用透明保護層。',later='上件維持原色；下件仍採用透明保護層。';
 const source=(ref,text,time)=>({ref,sourceAuthorRole:'user',messageRecordedAt:time,eventOccurredAt:null,evidenceHash:loopHash('source:'+text)});
 const a=source('a',original,'2026-10-13T00:00:00.000Z'),b=source('b',later,'2026-10-13T00:01:00.000Z');
 const fragment=(s,text,body)=>{const start=[...body.slice(0,body.indexOf(text))].length;return{...s,citation:{unit:'unicode_code_points',start,end:start+[...text].length,text}};};
 const prior=fragment(a,original,original),replacement=fragment(b,'上件維持原色',later),evidence=fragment(b,'下件仍採用透明保護層',later);
 const version=fragments=>loopHash({fragments,planStatus:'planned',statusSource:null});
 const plan=(nodeId,fragments,changeId)=>({nodeId,text:fragments.map(f=>f.citation.text).join(''),sourceFragments:fragments,planStatus:'planned',statusSource:null,planVersion:version(fragments),changeId});
 const currentPlans=[plan('upper',[replacement],'patch'),plan('lower',[prior],null)];
 const node=(nodeId,value)=>({nodeId,supported:true,interpretation:{kind:'user_intent',temporalUse:'current'},source:copy(value),time:{messageRecordedAt:value.messageRecordedAt,eventOccurredAt:null}});
 const sourceRange={ref:a.ref,pointer:{version:1,providerNamespace:'synthetic',scopeId:'synthetic-scope',itemId:'original',sessionId:'synthetic-session',revisionId:'v1'},
  evidenceHash:a.evidenceHash,range:{unit:'unicode_code_points',start:0,end:[...original].length}};
 const binding={source:sourceRange,retainedPlan:{nodeId:'lower',planVersion:currentPlans[1].planVersion},changedPlan:{nodeId:'upper',planVersion:currentPlans[0].planVersion,changeId:'patch'}};
 const finding={...binding,findingId:loopHash(ordered(binding)),nodeId:'lower',targetNodeId:'upper',changeId:'patch',ref:a.ref,sourceRef:a.ref,
  sourceEvidenceHash:a.evidenceHash,range:copy(sourceRange.range),resolutionStatus:'source_bound_host_declaration'};
 const resolution={findingId:finding.findingId,kind:'independent_retention',retentionByNodeId:'retain',evidence:copy(evidence),
  authority:'source_bound_host_declared_independence_not_semantic_verification',semanticVerification:'not_performed',executionAuthority:'none'};
 return {version:3,currentPlans,sources:[a,b],knownEvolution:[node('upper',prior),node('lower',prior),node('retain',evidence)],
  retentions:[{...copy(evidence),byNodeId:'retain',targetNodeIds:['lower']}],planChanges:[{id:'patch',targetNodeId:'upper',afterChangeId:null,kind:'content',
   source:fragment(b,later,later),priorVersion:version([prior]),planVersion:currentPlans[0].planVersion,
   parts:[{kind:'replace',priorSourceFragments:[copy(prior)],replacementSourceFragments:[copy(replacement)]}]}],
  planScopeReview:{kind:'cmcp_plan_scope_review',version:2,status:'addressed_by_source_bound_host_resolution',sourceBindingVerification:'validated',
   semanticVerification:'not_performed',findings:[finding],resolutions:[resolution],totalFindings:1,unresolvedFindings:0,maxFindings:8,truncated:false}};
}

test('已核獨立保留只在實際聯合引文交集旁提供範圍參照',async t=>{
 const original=scopedFixture(),calc=p=>view({projection:p,projectionHash:loopHash(p)});
 const rebind=p=>{const f=p.planScopeReview.findings[0];f.findingId=loopHash(ordered({source:f.source,retainedPlan:f.retainedPlan,changedPlan:f.changedPlan}));p.planScopeReview.resolutions[0].findingId=f.findingId;};
 await t.test('機械連接既有 finding／resolution／retention，原引文與原投影不改',()=>{
  const before=JSON.stringify(original),q=calc(original);assert.equal(q.status,'available');
  const quote=q.currentPlans[1].quotations[0],annotation=quote.scopeAnnotations[0];
  assert.equal(quote.text,original.currentPlans[1].sourceFragments[0].citation.text);
  assert.equal(annotation.scopeUse,'retained_plan_only_not_changed_plan');assert.equal(annotation.retainedPlan.nodeId,'lower');assert.equal(annotation.changedPlan.nodeId,'upper');
  assert.deepEqual(annotation.sharedSource.range,original.planScopeReview.findings[0].range);
  assert.equal(annotation.reviewFindingReference,'/projection/planScopeReview/findings/0');assert.equal(annotation.evidenceReference,'/projection/planScopeReview/resolutions/0/evidence');
  assert.equal(annotation.retentionReference,'/projection/retentions/0');assert.equal(annotation.semanticVerification,'not_performed');assert.equal(annotation.executionAuthority,'none');
  assert.equal(q.currentPlans[0].quotations[0].scopeAnnotations,undefined);assert.equal(JSON.stringify(original),before);
 });
 await t.test('未解或無相關修改不加附註，不自動解除 pending',()=>{
  const p=copy(original);p.planScopeReview.resolutions=[];p.planScopeReview.status='required';p.planScopeReview.unresolvedFindings=1;
  p.planScopeReview.findings[0].resolutionStatus='pending';const pending=calc(p);assert.equal(pending.status,'available');
  assert(pending.currentPlans.every(plan=>plan.quotations.every(q=>q.scopeAnnotations===undefined)));
  const noReview=copy(p);delete noReview.planScopeReview;const plain=calc(noReview);
  // 是兩份不同投影，原hash必須不同；除各自正確身分外，引文視圖逐值不變。
  assert.equal(plain.projectionHash,loopHash(noReview));assert.equal(pending.projectionHash,loopHash(p));
  const {projectionHash:plainHash,...plainView}=plain,{projectionHash:pendingHash,...pendingView}=pending;
  assert.notEqual(plainHash,pendingHash);assert.deepEqual(plainView,pendingView);
 });
 await t.test('偽造宣告、版本／目標／鏈漂移，不因外層Hash重算而取得附註',()=>{
  for(const mutate of [p=>p.planScopeReview.sourceBindingVerification='claimed',p=>p.planScopeReview.findings[0].findingId='0'.repeat(64),
   p=>{p.planScopeReview.findings[0].retainedPlan.planVersion='0'.repeat(64);rebind(p);},
   p=>{p.planScopeReview.findings[0].changedPlan.nodeId='lower';rebind(p);},p=>p.planChanges[0].targetNodeId='another',
   p=>p.planScopeReview.findings[0].resolutionStatus='pending']){
   const p=copy(original);mutate(p);const q=calc(p);assert.equal(q.status,'unavailable');assert.equal(q.currentPlans,null);
  }
 });
 await t.test('精確範圍須為真實變動片段與保留quotation交集，不能縮改範圍造scope',()=>{
  const p=copy(original);p.planScopeReview.findings[0].source.range.start++;p.planScopeReview.findings[0].range.start++;rebind(p);
  assert.equal(calc(p).reason,'continuity_quotation_scope_overlap_mismatch');
  const identical=copy(original);identical.planChanges[0].parts[0].replacementSourceFragments=copy(identical.planChanges[0].parts[0].priorSourceFragments);
  assert.equal(calc(identical).reason,'continuity_quotation_scope_overlap_mismatch');
 });
 await t.test('明示保留須是目前User節點且同target／同原evidence，未知fail closed',()=>{
  for(const mutate of [p=>p.planScopeReview.resolutions[0].evidence.citation.text='下件改採有色保護層',
   p=>p.planScopeReview.resolutions[0].retentionByNodeId='upper',p=>p.retentions[0].targetNodeIds=['upper'],
   p=>p.knownEvolution.find(n=>n.nodeId==='retain').interpretation.temporalUse='historical',
   p=>delete p.planScopeReview.resolutions[0].evidence]){
   const p=copy(original);mutate(p);assert.equal(calc(p).status,'unavailable');
  }
 });
});

test('正式逐字引文視圖只呈現同源片段，不改原文、時間或控制',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-quotation-view');await fs.mkdir(base,{recursive:true});
 const out=await fs.mkdtemp(path.join(base,'formal-')),scopeId='synthetic-quotation-view',now='2026-10-13T00:00:00.000Z',timezone='Asia/Taipei';
 const bodies=['我要製作🧩紙板模型，底座八公分。標示放左側，因為右側要留給量尺。',
  '底座改成十公分。其他沒改的條件維持；請整理修改內容。'];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-quotation-view',providerMode:'host',input:{root:path.join(out,'state'),scopeId,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
  receiptRoot:path.join(out,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-quotation-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 const results=[];async function check(name,fn){await t.test(name,async()=>{try{await fn();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',error:error.stack});throw error;}});}
 try{
  for(const [index,text]of bodies.entries())await runtime.ingest({role:'user',text,timeContext:{now:new Date(Date.parse(now)-120000+index*60000).toISOString(),timezone}});
  const nav=await runtime.readingNavigate({text:'核對紙板模型的修訂與保留條件。'});
  const opening=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:16384}});
  const pages=[];for(let i=0;i<64;i++){const page=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  const refs=bodies.map(text=>pages.find(page=>page.reader.text===text).reader.source.ref);
  const proposal={version:6,plans:[{id:'model',ref:refs[0],quote:bodies[0],topic:'手作物件',aspect:'紙板模型',temporalUse:'current',
   reasons:[{id:'space',ref:refs[0],quote:'因為右側要留給量尺。'}],
   orderedChanges:[{kind:'content',ref:refs[1],quote:'底座改成十公分。',edits:[{kind:'replace',quote:'八公分',replacement:{ref:refs[1],quote:'十公分'}}]}],
   retentions:[{ref:refs[1],quote:'其他沒改的條件維持',temporalUse:'current'}]}],unknowns:[]};
  const before=await runtime.bufferList(),controls=await runtime.controlsSnapshot();
  const formal=await runtime.readingContinuity({ticket:opening.reader.ticket,proposal}),original=copy(formal.projection);
  const calc=projection=>view({projection,projectionHash:loopHash(projection)});
  const updateVersion=plan=>{plan.text=plan.sourceFragments.map(x=>x.citation.text).join('');plan.planVersion=loopHash({fragments:plan.sourceFragments,planStatus:plan.planStatus,statusSource:plan.statusSource});};
  await check('正式Runtime的保留引文逐字與原頁對上，Unicode範圍／原時間正確',()=>{
   assert.equal(formal.status,'ready');const q=formal.presentation.quotationView;assert.equal(q.status,'available');
   const r=q.retentions[0].quotation;assert.equal(r.text,'其他沒改的條件維持');assert.equal(r.ref,refs[1]);assert.equal(r.sourceAuthorRole,'user');
   assert.equal(r.messageRecordedAt,original.sources.find(x=>x.ref===refs[1]).messageRecordedAt);assert.equal(Date.parse(r.messageRecordedAt),Date.parse('2026-10-12T23:59:00.000Z'));
   assert.equal([...bodies[1]].slice(r.range.start,r.range.end).join(''),r.text);
   assert.equal(r.evidenceHash,original.sources.find(x=>x.ref===refs[1]).evidenceHash);
   assert.equal(q.retentions[0].targetPlans[0].planVersion,original.currentPlans[0].planVersion);
   const fragments=q.currentPlans[0].quotations;assert.ok(new Set(fragments.map(x=>x.ref)).size>1);
   for(const item of fragments)assert.equal([...bodies[refs.indexOf(item.ref)]].slice(item.range.start,item.range.end).join(''),item.text);
   assert.equal(q.currentPlans[0].currentTextUse,'assembled_formal_fragments_not_a_single_user_quote');assert.equal(Object.hasOwn(q.currentPlans[0],'text'),false);
  });
  await check('同長度改造引文不能靠形狀或重算外層Hash通過',()=>{
   const p=copy(original);p.retentions[0].citation.text=p.retentions[0].citation.text.replace('維持','放棄');
   assert.equal(calc(p).reason,'continuity_quotation_exact_source_quote_mismatch');
   const q=copy(original);q.currentPlans[0].sourceFragments[0].citation.text=q.currentPlans[0].sourceFragments[0].citation.text.replace('紙板','木板');updateVersion(q.currentPlans[0]);
   assert.equal(calc(q).reason,'continuity_quotation_exact_source_quote_mismatch');
  });
  await check('角色／原時間／Hash／引用漂移皆不提供部分新視圖',()=>{
   for(const patch of [{sourceAuthorRole:'assistant'},{messageRecordedAt:now},{evidenceHash:'0'.repeat(64)},{ref:'missing-ref'}]){
    const p=copy(original);Object.assign(p.retentions[0],patch);const q=calc(p);assert.equal(q.status,'unavailable');assert.equal(q.currentPlans,null);assert.equal(q.retentions,null);
   }
   const p=copy(original);const node=p.knownEvolution.find(x=>x.nodeId===p.retentions[0].byNodeId);node.time.messageRecordedAt=now;
   assert.equal(calc(p).reason,'continuity_quotation_anchor_time_mismatch');
  });
  await check('變版或範圍不符拒絕；不是只比片段長度',()=>{
   const p=copy(original);p.currentPlans[0].planVersion='0'.repeat(64);assert.equal(calc(p).reason,'continuity_quotation_plan_version_mismatch');
   const q=copy(original);q.retentions[0].citation.start++;q.retentions[0].citation.end++;assert.equal(calc(q).reason,'continuity_quotation_exact_source_quote_mismatch');
   assert.equal(view({projection:original,projectionHash:'0'.repeat(64)}).reason,'continuity_quotation_projection_hash_mismatch');
  });
  await check('空集合如實可用；缺欄與過量整體unavailable，不截短或改原件',()=>{
   const empty=copy(original);empty.currentPlans=[];empty.retentions=[];const e=calc(empty);assert.equal(e.status,'available');assert.deepEqual(e.currentPlans,[]);assert.deepEqual(e.retentions,[]);
   const missing=copy(original);delete missing.retentions;assert.equal(calc(missing).status,'unavailable');
   const tooMany=copy(original);tooMany.currentPlans=Array.from({length:limits.maxPlans+1},(_,i)=>({...copy(original.currentPlans[0]),nodeId:'p'+i}));assert.equal(calc(tooMany).reason,'continuity_quotation_plan_limit');
   const amplified=copy(original);amplified.currentPlans[0].sourceFragments=Array.from({length:180},()=>copy(original.currentPlans[0].sourceFragments[0]));updateVersion(amplified.currentPlans[0]);
   const raw=JSON.stringify(amplified),v=calc(amplified);assert.equal(v.status,'unavailable');assert.equal(v.reason,'continuity_quotation_bytes_limit');assert.equal(v.currentPlans,null);assert.equal(JSON.stringify(amplified),raw);
  });
  await check('完整投影／理由與正式讀回保持；查看零模型與零控制／時間副作用',async()=>{
   assert.equal(formal.projectionHash,loopHash(original));assert.equal(original.reasonBindings[0].standing,'not_explicitly_withdrawn');
   const beforeText=JSON.stringify(original);calc(original);assert.equal(JSON.stringify(original),beforeText);
   const readback=await runtime.continuityStatus();assert.deepEqual(readback.presentation.quotationView,formal.presentation.quotationView);assert.deepEqual(readback.projection,original);
   assert.deepEqual((await runtime.bufferList()).items,before.items);assert.deepEqual(await runtime.controlsSnapshot(),controls);
   await fs.writeFile(path.join(out,'formal-quotation-readback.json'),JSON.stringify({bodies,opening,pages,proposal,formal,readback,modelCalls:0},null,2)+'\n',{flag:'wx'});
  });
  await check('正式撤權／OFF／Clean後不洩出引文視圖',async()=>{
   await runtime.revokeReading({ticket:opening.reader.ticket,reason:'caller_revoked'});const revoked=await runtime.continuityStatus();assert.equal(revoked.status,'unavailable');assert.equal(revoked.presentation,undefined);
   await runtime.configureControls({updateId:'quotation-off',patch:{enabled:false},persist:false});const off=await runtime.continuityStatus();assert.equal(off.status,'unavailable');assert.equal(off.presentation,undefined);
   await runtime.configureControls({updateId:'quotation-clean',patch:{enabled:true,clean:true},persist:false});const clean=await runtime.continuityStatus();assert.equal(clean.status,'unavailable');assert.equal(clean.presentation,undefined);
  });
 }finally{await runtime.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify({kind:'continuity_quotation_view_tests',productRoot,modelCalls:0,semanticVerification:'not_performed',runtimeClosed:true,results},null,2)+'\n',{flag:'wx'});}
});
