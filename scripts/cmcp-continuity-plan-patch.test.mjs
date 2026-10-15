import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
// 可用同一份斷言核對來源樹或另一位置的實包安裝；不改安裝內容。
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const {createCmcpRuntimeSession}=await import(pathToFileURL(path.join(productRoot,'src/cmcp-guard/cmcp-runtime-session.js')).href);
const {projectCmcpReadingContinuity:project,getCmcpContinuityCorrection}=await import(pathToFileURL(path.join(productRoot,'src/cmcp-guard/cmcp-continuity-projection.js')).href);

// 測試只建本機合成來源；輸出保留，不刪原件或暫存。真宿主語意另驗。
test('v3 計畫來源基底、稀疏修改及獨立狀態',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-plan-patch');await fs.mkdir(base,{recursive:true});
 const out=await fs.mkdtemp(path.join(base,'formal-')),now='2026-10-08T01:00:00.000Z',zone='Asia/Taipei',scope='synthetic-v3-plan';
 const bodies=[
  '我計畫整理工坊設備。\n寬度六十公分，深藍，僅室內使用。  \n🪟 兩組，兩組。\n這些只是規劃，尚未施工。',
  '我建議加裝輪子，僅為提案。',
  '寬度改成八十公分，其他條件維持。',
  '設備部分先暫停，文字標示仍照原計畫。',
  '設備恢復規劃，還沒有實際動工。',
  '撤回深藍這個條件，其他條件維持。',
  '我回報文字標示已完成，設備尚未開始。',
  '還有一個可能：改成九十公分；八十公分也保留，尚未選定。',
  '原先只想過加裝輪子，現在是否採用仍不確定。'
 ];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-v3',providerMode:'host',
  input:{root:path.join(out,'state'),scopeId:scope,events:[],timezone:zone,
   limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:64,maxSourceBytes:8192},
   loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-v3-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 let opening,pages,refs;
 try{
  for(const [index,body]of bodies.entries())await runtime.ingest({role:index===1?'assistant':'user',text:body,
   timeContext:{now:new Date(Date.parse(now)-600000+index*60000).toISOString(),timezone:zone}});
  const navigation=await runtime.readingNavigate({text:'請查證工坊設備的規劃、修改與狀態。'});
  opening=await runtime.readingOpen({navigationTicket:navigation.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:16384}});
  pages=[];for(let i=0;i<64;i++){const page=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  refs=bodies.map(body=>pages.find(page=>page.reader.text===body).reader.source.ref);
  const basis='寬度六十公分，深藍，僅室內使用。  \n🪟 兩組，兩組。';
  const node=(id,ref,quote,extra={})=>({id,ref,quote,kind:'user_intent',temporalUse:'current',topic:'工坊設備',aspect:id,relation:{kind:'independent',targetNodeIds:[]},...extra});
  const proposal={version:3,nodes:[node('equipment',refs[0],basis),node('labels',refs[0],'我計畫整理工坊設備。')],unknowns:[]};
  const input=q=>({reading:opening,previousPages:pages,scopeId:scope,proposal:q,timeContext:{now,timezone:zone}});
  const status={id:'pause',targetNodeId:'equipment',afterChangeId:null,kind:'status',ref:refs[3],quote:'設備部分先暫停',planStatus:'paused'};
  const revision={id:'width',targetNodeId:'equipment',afterChangeId:null,kind:'content',ref:refs[2],quote:'寬度改成八十公分，其他條件維持。',
   parts:[{quote:'寬度六十公分',kind:'replace',replacement:{ref:refs[2],quote:'八十公分'}},{quote:'，深藍，僅室內使用。  \n🪟 兩組，兩組。',kind:'keep'}]};
  const calc=(changes=[],extra={})=>project(input({...structuredClone(proposal),planChanges:structuredClone(changes),...extra}));
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({opening,pages,proposal},null,2)+'\n',{flag:'wx'});
  await t.test('省略意圖 text 使用正式引文，意圖不進事實回報',()=>{
   const p=calc().projection;assert.equal(p.version,3);assert.equal(p.currentPlans[0].text,basis);assert.deepEqual(p.currentClaims,[]);
   assert.equal(p.currentPlans[0].sourceFragments[0].citation.text,basis);assert.equal(p.validation.semantics,'not_performed');
  });
  await t.test('部分暫停保留全部條件、空白、重複字及原時間，另一項計畫不變',()=>{
   const before=calc().projection,after=calc([status]).projection;
   assert.equal(after.currentPlans[0].text,basis);assert.equal(after.currentPlans[0].planStatus,'paused');
   assert.deepEqual(after.currentPlans[0].sourceFragments,before.currentPlans[0].sourceFragments);
   assert.deepEqual(after.currentPlans[1],before.currentPlans[1]);assert.equal(after.planChanges[0].effect,'status_only_conditions_preserved');
  });
  await t.test('稀疏修改保留未改條件，回執由 Core 算 Unicode 範圍',()=>{
   const p=calc([revision]).projection;assert.equal(p.currentPlans[0].text,'八十公分，深藍，僅室內使用。  \n🪟 兩組，兩組。');
   assert.equal(p.currentPlans[0].sourceFragments[0].ref,refs[2]);assert.equal(p.currentPlans[0].sourceFragments[1].ref,refs[0]);
   assert.equal(p.planChanges[0].parts[0].end,6);assert.equal(p.planChanges[0].parts[1].end,[...basis].length);
  });
  await t.test('明示修改鏈與陣列順序無關，修改後暫停仍保留條件',()=>{
   const second={...status,afterChangeId:'width'},forward=calc([revision,second]).projection,reverse=calc([second,revision]).projection;
   assert.deepEqual(reverse.currentPlans,forward.currentPlans);assert.equal(reverse.currentPlans[0].planStatus,'paused');
   assert.equal(reverse.currentPlans[0].text,'八十公分，深藍，僅室內使用。  \n🪟 兩組，兩組。');
  });
  await t.test('未明示接續的同目標改動保留競爭，不用順序選一個',()=>{
   const p=calc([revision,status]).projection;assert(!p.currentPlans.some(x=>x.nodeId==='equipment'));
   const u=p.unresolvedPlans.find(x=>x.reason==='competing_explicit_plan_change_branches');assert.equal(u.candidates.length,2);
  });
  await t.test('撤回只有明示範圍，不自行取消整案或撤回其他條件',()=>{
   const withdrawal={id:'colour',targetNodeId:'equipment',afterChangeId:null,kind:'content',ref:refs[5],quote:bodies[5],
    parts:[{quote:'寬度六十公分，',kind:'keep'},{quote:'深藍',kind:'withdraw'},{quote:'，僅室內使用。  \n🪟 兩組，兩組。',kind:'keep'}]};
   const p=calc([withdrawal]).projection;assert.equal(p.currentPlans[0].text,'寬度六十公分，，僅室內使用。  \n🪟 兩組，兩組。');
   assert.equal(p.currentPlans[0].planStatus,'planned');assert.equal(p.currentPlans[0].textAuthority,'concatenated_formal_fragments_not_a_new_user_message');
  });
  await t.test('真正未定舊意圖仍 unspecified，不強迫成目前計畫',()=>{
   const p=calc([],{nodes:[...proposal.nodes,node('possible',refs[8],bodies[8],{temporalUse:'unspecified'})]}).projection;
   assert(!p.currentPlans.some(x=>x.nodeId==='possible'));assert.equal(p.planBasis.find(x=>x.nodeId==='possible').currentEligibility,'not_established_as_current');
   const pending=p.unresolvedPlans.find(x=>x.nodeIds.includes('possible'));assert.equal(pending.reason,'plan_currentness_not_established');
   assert.deepEqual(pending.candidateSource,{collection:'planBasis',key:'nodeId'});assert.equal(pending.candidates,undefined);
   const candidate=p.planBasis.find(x=>x.nodeId===pending.nodeIds[0]).candidates[0];
   assert.equal(candidate.text,bodies[8]);assert.equal(candidate.sourceFragments[0].ref,refs[8]);
   assert.deepEqual(p.planCoverage.unestablishedCurrentBasisNodeIds,['possible']);
  });
  await t.test('全部 unspecified 有修訂仍明示未確立；正式 current 基底才呈現目前修訂與原時間',()=>{
   const statusAfterRevision={...status,afterChangeId:revision.id};
   const nodes=proposal.nodes.map(n=>({...n,temporalUse:'unspecified'}));
   const value=calc([revision,statusAfterRevision],{nodes});
   assert.equal(value.status,'ready','ready 仍僅表示已讀材料與結構，不表示目前計畫成立');
   assert.deepEqual(value.projection.currentPlans,[]);
   assert.equal(value.projection.unresolvedPlans.length,1);
   assert.deepEqual(value.projection.unresolvedPlans[0].nodeIds,nodes.map(n=>n.id));
   assert.deepEqual(value.projection.planCoverage.selectedCurrentBasisNodeIds,[]);
   assert.equal(value.projection.planCoverage.unestablishedCurrentBasisNodeIds.length,nodes.length);
   const pending=value.projection.unresolvedPlans.find(n=>n.nodeIds.includes('equipment'));
   assert.equal(pending.candidateSource.collection,'planBasis');
   const candidate=value.projection.planBasis.find(n=>n.nodeId==='equipment').candidates[0];
   assert.equal(candidate.planStatus,'paused');assert.match(candidate.text,/八十公分/);
   const established=calc([revision,statusAfterRevision]).projection;
   assert.equal(established.currentPlans.find(n=>n.nodeId==='equipment').planStatus,'paused');
   assert.deepEqual(established.currentPlans.find(n=>n.nodeId==='equipment').sourceFragments,candidate.sourceFragments);
   assert.deepEqual(established.currentPlans.find(n=>n.nodeId==='equipment').statusSource,candidate.statusSource);
   assert.deepEqual(established.planCoverage.unestablishedCurrentBasisNodeIds,[]);
  });
  await t.test('完成回報與待執行計畫分列，部分完成不完成整案',()=>{
   const p=calc([],{nodes:[...proposal.nodes,node('report',refs[6],'我回報文字標示已完成',{kind:'user_report',text:'我回報文字標示已完成'})]}).projection;
   assert.equal(p.currentClaims.length,1);assert.equal(p.currentPlans.length,2);assert(p.currentPlans.every(x=>x.planStatus==='planned'));
  });
  await t.test('historical 與整節點退休皆回明確更正，不讓未改條件消失',()=>{
   for(const extra of [{temporalUse:'historical'},{relation:{kind:'revises',targetNodeIds:['labels']}}]){
    let error;try{calc([],{nodes:[{...proposal.nodes[0],...extra}]});}catch(e){error=e;}assert(getCmcpContinuityCorrection(error));
   }
  });
  await t.test('自由 text 增添未採用條件會拒絕，不能借合法 User quote 偷渡',()=>{
   assert.throws(()=>calc([],{nodes:[{...proposal.nodes[0],text:basis+'加裝輪子'}]}),/continuity_plan_text_not_source/);
  });
  await t.test('少片段、重疊／重複片段、空白正規化皆不能冒充完整範圍',()=>{
   for(const parts of [revision.parts.slice(0,1),[revision.parts[0],revision.parts[0],revision.parts[1]],[{quote:basis.replace('  \n','\n'),kind:'keep'}]]){
    assert.throws(()=>calc([{...revision,parts}]),/continuity_plan_scope_incomplete/);
   }
  });
  await t.test('Assistant 修改、替代來源／quote 不在同次 User 修改內會拒絕',()=>{
   assert.throws(()=>calc([{...status,ref:refs[1],quote:bodies[1]}]),/continuity_plan_change_user_source_required/);
   const q=structuredClone(revision);q.parts[0].replacement={ref:refs[7],quote:'九十公分'};
   assert.throws(()=>calc([q]),/continuity_plan_replacement_source_mismatch/);
  });
  await t.test('缺目標、跨目標前驅、自我循環與重複修改 ID 皆拒絕',()=>{
   assert.throws(()=>calc([{...status,targetNodeId:'missing'}]),/continuity_plan_change_target/);
   assert.throws(()=>calc([{...status,afterChangeId:'pause'}]),/continuity_plan_change_cycle/);
   assert.throws(()=>calc([status,{...status}]),/continuity_duplicate_plan_change/);
   assert.throws(()=>calc([revision,{...status,targetNodeId:'labels',afterChangeId:'width'}]),/continuity_plan_change_predecessor_target/);
  });
  await t.test('唯讀投影不改 Buffer、History 或時間',async()=>{
   const before=await runtime.bufferList();await runtime.readingContinuity({ticket:opening.reader.ticket,proposal:{...proposal,planChanges:[status]}});
   assert.deepEqual((await runtime.bufferList()).items,before.items);
  });
  await t.test('同正式頁的 v2 既有提案仍可用，未套用 v3 稀疏限制',()=>{
   const q={version:2,nodes:[{...proposal.nodes[0],text:'這是自由文字解釋',temporalUse:'historical'}],unknowns:[]};
   const p=project(input(q)).projection;assert.equal(p.version,2);assert.equal(p.planChanges,undefined);assert.deepEqual(p.currentPlans,[]);
  });
  await t.test('v3 不放寬 scope、正式頁鏈、quote 或來源版本材料核對',()=>{
   assert.throws(()=>project({...input(proposal),scopeId:'another-scope'}),/invalid_reading_manifest/);
   const bad=structuredClone(pages);bad[0].modelContext=null;
   assert.throws(()=>project({...input(proposal),previousPages:bad}),/reading_page_chain_mismatch/);
   const missing={...status,ref:'not-in-selected-reading'};
   assert.throws(()=>calc([missing]),/continuity_source_outside_reading/);
   assert.throws(()=>calc([{...status,quote:'這不是任何原句'}]),/continuity_quote_absent/);
  });
  await t.test('狀態與內容修改均不暗撤理由，理由站位仍需明示來源關係',()=>{
   const q={...proposal,nodes:[{...proposal.nodes[0],reason:{ref:refs[0],quote:'這些只是規劃，尚未施工。'}},proposal.nodes[1]]};
   const before=calc([] ,q).projection,after=calc([status],q).projection;
   assert.deepEqual(before.reasons,after.reasons);assert.equal(after.reasons[0].standing,'not_explicitly_withdrawn');
  });
  await t.test('v3 投影仍受 Clean／OFF 保護，保護解除不復活舊閱讀票',async()=>{
   await runtime.configureControls({updateId:'v3-test-clean-on',patch:{clean:true}});
   assert.equal((await runtime.continuityStatus()).projection,null);
   await runtime.configureControls({updateId:'v3-test-clean-off',patch:{clean:false}});
   assert.equal((await runtime.continuityStatus()).status,'unavailable');
   await runtime.configureControls({updateId:'v3-test-off',patch:{enabled:false}});
   assert.equal((await runtime.readingContinuity({ticket:opening.reader.ticket,proposal:{...proposal,planChanges:[status]}})).status,'disabled');
  });
 }finally{await runtime.close();}
});
