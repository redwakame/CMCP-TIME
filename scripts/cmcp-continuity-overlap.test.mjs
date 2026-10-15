import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=p=>import(pathToFileURL(path.join(productRoot,p)));
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,getCmcpContinuityCorrection:correction,CMCP_CONTINUITY_PROJECTION_LIMITS:limits}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {compileCmcpTypedContinuityProposal:compile5}=await load('src/cmcp-guard/cmcp-continuity-typed-proposal.js');
const copy=structuredClone;

test('正式來源重疊基底提供具名核對線索；不自動裁決作用對象',async t=>{
 const root=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-overlap');await fs.mkdir(root,{recursive:true});
 const out=await fs.mkdtemp(path.join(root,'formal-')),scope='synthetic-overlap',now='2026-10-09T00:00:00.000Z',timezone='Asia/Taipei';
 const bodies=['🪟 第一批二十件，寬六十公分，深藍，只在室內使用。','改成十二件，寬八十公分，淺綠；其他條件維持。',
  '先暫停，等授權回覆再談。','取消這項計畫。','撤回深藍這個條件。','寬六十公分，再確認不變。','🪟 第一批二十件，寬六十公分，深藍，只在室內使用。',
  'A 和 B 都安排週一。','只把 A 改週二。','A 改週二，B 維持週一。'];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-overlap',providerMode:'host',
  input:{root:path.join(out,'state'),scopeId:scope,events:[],timezone,
   limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:64,maxSourceBytes:8192},
   loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},
  controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-overlap-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 try{
  for(const [i,body]of bodies.entries())await runtime.ingest({role:'user',text:body,timeContext:{now:new Date(Date.parse(now)-600000+i*60000).toISOString(),timezone}});
  const navigation=await runtime.readingNavigate({text:'正式核對第一批規劃、尺寸、顏色及修訂。'});
  const opening=await runtime.readingOpen({navigationTicket:navigation.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:32768}});
  const pages=[];for(let i=0;i<64;i++){const p=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(p);if(p.reader.coverage.complete)break;}
  const refs=bodies.map((body,i)=>pages.find(p=>p.reader.text===body&&p.modelContext&&JSON.parse(p.modelContext).time.messageRecordedAt===new Date(Date.parse(now)-600000+i*60000).toISOString()).reader.source.ref);
  const input=q=>({reading:opening,previousPages:pages,scopeId:scope,proposal:q,timeContext:{now,timezone}}),calc=q=>project(input(q));
  const plan=(id,quote,extra={})=>({id,ref:refs[0],quote,topic:'設備試行',aspect:id,temporalUse:'current',...extra});
  const edit=(quote,replacement)=>({kind:'replace',quote,replacement:{ref:refs[1],quote:replacement}});
  const change=edits=>({kind:'content',ref:refs[1],quote:bodies[1],edits});
  const build=()=>({version:5,plans:[plan('batch',bodies[0],{orderedChanges:[change([edit('二十件','十二件')])]}),
   plan('width','寬六十公分',{orderedChanges:[change([edit('六十公分','八十公分')])]}),
   plan('colour','深藍',{orderedChanges:[change([edit('深藍','淺綠')])]})],unknowns:[]});
  const review=q=>{const result=calc(q),c=result.projection.planScopeReview;assert.equal(result.status,'partial');assert.equal(result.reason,'scope_review_required');assert.equal(result.modelCoverageComplete,true);
   assert.equal(c.status,'required');assert.equal(c.semanticVerification,'not_performed');assert(c.findings.length);
   assert(c.findings.every(x=>x.range.unit==='unicode_code_points'));return c;};
  const noOverlap=q=>{const result=calc(q),c=result.projection.planScopeReview;assert.equal(result.status,'ready');
   assert.equal(c.status,'no_overlap_detected');assert.equal(c.semanticVerification,'not_performed');assert.deepEqual(c.findings,[]);return result;};
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({opening,pages,refs,bodies},null,2)+'\n',{flag:'wx'});
  await t.test('v5 明示修改與另一 current 舊保留段重疊，partial 與完整來源覆蓋分列',()=>{
   const q=build(),c=review(q);assert(c.findings.some(x=>x.nodeId==='batch'&&x.targetNodeId==='width'));
   const issue=c.findings.find(x=>x.targetNodeId==='width');assert.equal(issue.range.start,[...bodies[0].slice(0,bodies[0].indexOf('六'))].length);assert.equal(issue.range.end,issue.range.start+1);
   assert(!JSON.stringify(c).includes('🪟'));assert(!JSON.stringify(c).includes('C:\\'));assert(!JSON.stringify(c).includes('寬六十'));assert.deepEqual(q,build());
  });
  await t.test('v3 同一來源核對線索，不必只靠 v5 編譯器',()=>{review(compile5(build(),{limits}).proposal);});
  await t.test('v4 同一來源核對線索，不以入口版本遺漏',()=>{
   const q=build(),v4={version:4,nodes:q.plans.map(({orderedChanges,...p})=>({...p,kind:'user_intent'})),planChanges:q.plans.flatMap(p=>(p.orderedChanges??[]).map((c,i)=>({...c,id:p.id+'-'+i,targetNodeId:p.id,afterChangeId:null}))),unknowns:[]};review(v4);
  });
  await t.test('宿主明示一致修正重疊基底後可用，未改限制與原時間保留',()=>{
   const q=build();q.plans[0].orderedChanges[0].edits.push(edit('六十公分','八十公分'),edit('深藍','淺綠'));
   const p=noOverlap(q).projection;assert(p.currentPlans[0].text.includes('十二件，寬八十公分，淺綠，只在室內使用'));assert.equal(p.validation.executionAuthority,'none');
   assert(p.currentPlans[0].sourceFragments.some(f=>f.ref===refs[0]&&f.citation.text.includes('只在室內使用')));
   assert.equal(p.currentPlans[0].sourceFragments[0].messageRecordedAt,new Date(Date.parse(now)-600000).toISOString());
  });
  await t.test('拆成實際面向的精確原句可用，不需要丟失未改條件',()=>{
   const q=build();q.plans[0].quote='第一批二十件';q.plans.push(plan('location','只在室內使用'));
   const p=noOverlap(q).projection;assert.deepEqual(p.currentPlans.map(x=>x.text),['第一批十二件','寬八十公分','淺綠','只在室內使用']);
  });
  await t.test('沒有修改的重疊不自動成衝突',()=>{const q=build();for(const p of q.plans)delete p.orderedChanges;noOverlap(q);});
  await t.test('不同 topic 仍核對同一正式來源區間，但不自動合案或傳播修改',()=>{
   const q=build();q.plans[0].topic='另一件設備';const original=copy(q),p=calc(q).projection,c=review(q);
   assert(c.findings.some(x=>x.nodeId==='batch'&&x.targetNodeId==='width'&&x.sameProposedObject===false));
   assert.equal(p.currentPlans[0].text,'🪟 第一批十二件，寬六十公分，深藍，只在室內使用。');
   assert.equal(p.currentPlans[1].text,'寬八十公分');assert.deepEqual(p.unknowns,[]);assert.deepEqual(q,original);
  });
  await t.test('相同文字但不同正式 Pointer 不混成同一來源',()=>{const q=build();q.plans[0].ref=refs[6];noOverlap(q);});
  await t.test('保留精確未改共同後綴不誤拒絕',()=>{
   const q={version:5,plans:[plan('width','寬六十公分',{orderedChanges:[change([edit('六十公分','八十公分')])]}),plan('unit','公分')],unknowns:[]};noOverlap(q);
  });
  await t.test('相同文字的明示再確認不當作內容變更',()=>{
   const q=build();q.plans=q.plans.slice(0,2);delete q.plans[0].orderedChanges;
   q.plans[1].orderedChanges=[{kind:'content',ref:refs[5],quote:bodies[5],edits:[{kind:'replace',quote:'六十公分',replacement:{ref:refs[5],quote:'六十公分'}}]}];noOverlap(q);
  });
  await t.test('withdraw 的原片段仍在另一 current 仍需核對作用範圍',()=>{
   const q=build();q.plans=q.plans.filter(p=>p.id!=='width');delete q.plans[0].orderedChanges;
   q.plans[1].orderedChanges=[{kind:'content',ref:refs[4],quote:bodies[4],edits:[{kind:'withdraw',quote:'深藍'}]}];review(q);
  });
  await t.test('修改後暫停仍保留目前條件，paused 仍列來源核對疑點',()=>{const q=build();for(const p of q.plans)p.orderedChanges.push({kind:'status',ref:refs[2],quote:bodies[2],planStatus:'paused'});review(q);});
  await t.test('cancelled 不是仍有效條件，不強制跨計畫恢復',()=>{const q=build();q.plans[0].orderedChanges.push({kind:'status',ref:refs[3],quote:bodies[3],planStatus:'cancelled'});noOverlap(q);});
  await t.test('未確立基底明示 unresolved，不假定它是另一 current',()=>{const q=build();q.plans[0].temporalUse='unspecified';const p=calc(q).projection;assert.equal(p.currentPlans.length,2);assert(p.unresolvedPlans.some(x=>x.nodeIds.includes('batch')));});
  await t.test('原來源引文及 scope／reader 守護先行，不因新更正而放寬',()=>{
   const q=build();q.plans[0].quote='不存在的原句';delete q.plans[0].orderedChanges;assert.throws(()=>calc(q),/continuity_quote_absent/);
   assert.throws(()=>project({...input(build()),scopeId:'another-scope'}),/invalid_reading_manifest/);
   const altered=copy(opening);altered.internal.manifest.sources[0].pointer.revisionId='forged-revision';assert.throws(()=>project({...input(build()),reading:altered}),/invalid_reading_manifest/);
  });
  await t.test('疑點回傳最多八筆且明示未列完；不把截斷當成已處理',()=>{
   const q={version:5,plans:[plan('colour','深藍',{orderedChanges:[change([edit('深藍','淺綠')])]}),
    ...Array.from({length:10},(_,i)=>plan('retained-'+i,'深藍'))],unknowns:[]};
   const p=calc(q).projection,c=review(q);assert.equal(c.totalFindings,10);assert.equal(c.findings.length,8);
   assert.equal(c.maxFindings,8);assert.equal(c.truncated,true);assert.equal(p.currentPlans.length,11);assert.deepEqual(p.unknowns,[]);
  });
  await t.test('零模型純投影不更改 Buffer 原時間與內容',async()=>{
   const before=await runtime.bufferList();review(build());assert.deepEqual((await runtime.bufferList()).items,before.items);
  });
  for(const index of [8,9])await t.test(index===8?'只改 A 不得推定共用週一的 B 也修改':'明說 B 維持仍不得因共用原句擅自拒絕',()=>{
   const q={version:5,plans:[plan('activity-a','週一',{ref:refs[7],topic:'活動安排',aspect:'A',orderedChanges:[{kind:'content',ref:refs[index],quote:bodies[index],edits:[{kind:'replace',quote:'週一',replacement:{ref:refs[index],quote:'週二'}}]}]}),
    plan('activity-b','週一',{ref:refs[7],topic:index===9?'獨立活動 B':'活動安排',aspect:'B',...(index===9?{retentions:[{ref:refs[9],quote:'B 維持週一',temporalUse:'current'}]}:{})})],unknowns:[]};
   const p=calc(q).projection;review(q);assert.deepEqual(p.currentPlans.map(x=>x.text),['週二','週一']);assert.deepEqual(p.unknowns,[]);assert(p.planScopeReview.findings.some(f=>f.nodeId==='activity-b'&&f.targetNodeId==='activity-a'));
  });
 }finally{await runtime.close();}
});
