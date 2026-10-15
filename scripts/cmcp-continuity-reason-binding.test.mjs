import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const {createCmcpRuntimeSession}=await import(pathToFileURL(path.join(productRoot,'src/cmcp-guard/cmcp-runtime-session.js')).href);
const {projectCmcpReadingContinuity:project,getCmcpContinuityCorrection}=await import(pathToFileURL(path.join(productRoot,'src/cmcp-guard/cmcp-continuity-projection.js')).href);

// 只驗正式來源綁定及結構守護；不宣稱這些機械斷言能代替宿主語意驗收。
test('v3 原版理由、變更理由與具名更正分開',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-reason-binding');await fs.mkdir(base,{recursive:true});
 const out=await fs.mkdtemp(path.join(base,'formal-')),now='2026-10-08T04:00:00.000Z',timezone='Asia/Taipei',scopeId='synthetic-reason-binding';
 const texts=[
  '我計畫用窄木架整理模型，木架高六十公分。選窄木架是因為走道較窄。',
  '我建議加裝輪子，只是提案，尚未採用。',
  '木架高度改成八十公分，因為可用空間變多；其他條件維持。',
  '木架先暫停製作，原因是等待材料到貨。',
  '這次更重視容納量，原先走道限制仍在。',
  '明確撤回原先走道較窄這個理由，已改用另一間房間。',
  '我回報標籤已寫完，木架尚未製作。',
  '另一件事：運送箱仍在規劃，尚未選定材質。'
 ];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-reason',providerMode:'host',
  input:{root:path.join(out,'state'),scopeId,events:[],timezone,
   limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:64,maxSourceBytes:8192},
   loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-reason-session',hostProvider:{request:async()=>{throw Error('本測試禁止模型呼叫');}}});
 try{
  for(const [i,text]of texts.entries())await runtime.ingest({role:i===1?'assistant':'user',text,timeContext:{now:new Date(Date.parse(now)-600000+i*60000).toISOString(),timezone}});
  const navigation=await runtime.readingNavigate({text:'核對木架的原方案、修改與理由。'});
  const opening=await runtime.readingOpen({navigationTicket:navigation.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:16384}});
  const pages=[];for(let i=0;i<64;i++){const p=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(p);if(p.reader.coverage.complete)break;}
  const refs=texts.map(text=>pages.find(p=>p.reader.text===text).reader.source.ref);
  const node=(id,i,quote,extra={})=>({id,ref:refs[i],quote,kind:'user_intent',temporalUse:'current',topic:'木架規劃',aspect:id,relation:{kind:'independent',targetNodeIds:[]},...extra});
  const original=node('shelf',0,'我計畫用窄木架整理模型，木架高六十公分。',{reason:{ref:refs[0],quote:'選窄木架是因為走道較窄。'}});
  const changed={id:'height',targetNodeId:'shelf',afterChangeId:null,kind:'content',ref:refs[2],quote:texts[2],
   parts:[{kind:'keep',quote:'我計畫用窄木架整理模型，木架高'},{kind:'replace',quote:'六十公分',replacement:{ref:refs[2],quote:'八十公分'}},{kind:'keep',quote:'。'}]};
  const pause={id:'pause',targetNodeId:'shelf',afterChangeId:'height',kind:'status',ref:refs[3],quote:'木架先暫停製作',planStatus:'paused'};
  const prioritizer=node('priority',4,'這次更重視容納量',{temporalUse:'unspecified',reason:{ref:refs[4],quote:'這次更重視容納量'}});
  const relation={kind:'prioritizes',fromNodeId:'priority',targetNodeIds:['shelf'],ref:refs[4],quote:texts[4]};
  const input=proposal=>({reading:opening,previousPages:pages,scopeId,proposal,timeContext:{now,timezone}});
  const calc=(changes=[],extra={})=>project(input({version:3,nodes:[structuredClone(original)],unknowns:[],planChanges:structuredClone(changes),...extra}));
  const getError=fn=>{let error;try{fn();}catch(e){error=e;}assert(error);return error;};
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({opening,pages,original,changed,pause,prioritizer,relation},null,2)+'\n',{flag:'wx'});
  await t.test('原理由固定於原版，不隨目前條件或暫停狀態改綁',()=>{
   const before=calc().projection,after=calc([changed,pause]).projection;
   assert.deepEqual(after.reasons,before.reasons);assert.equal(after.reasons[0].binding.kind,'plan_basis');
   assert.equal(after.reasons[0].binding.basisVersion,after.planBasis[0].baseVersion);
   assert.notEqual(after.reasons[0].binding.basisVersion,after.currentPlans[0].planVersion);
   assert.equal(after.reasons[0].binding.source.citation.text,original.quote);
   assert.match(after.currentPlans[0].text,/八十公分/);assert.equal(after.currentPlans[0].planStatus,'paused');
  });
  await t.test('變更理由引用自己的正式 User 原句及前後版本，下一變更不繼承',()=>{
   const p=calc([{...changed,reason:{ref:refs[2],quote:'因為可用空間變多'}},pause]).projection;
   const change=p.planChanges.find(x=>x.id==='height'),status=p.planChanges.find(x=>x.id==='pause');
   assert.equal(change.reasonStatus,'provided');assert.equal(change.reason.citation.text,'因為可用空間變多');
   assert.deepEqual(change.reason.binding,{kind:'plan_change',nodeId:'shelf',changeId:'height',priorVersion:change.priorVersion,planVersion:change.planVersion});
   assert.equal(status.reasonStatus,'not_provided');assert.equal(status.reason,null);
   assert.equal(p.reasonCoverage.changeReasonsProvided,1);assert.equal(p.reasons[0].ref,refs[0]);
  });
  await t.test('狀態理由可位於同則 User 的其他精確片段，不必把理由混進條件',()=>{
   const p=calc([changed,{...pause,reason:{ref:refs[3],quote:'原因是等待材料到貨。'}}]).projection;
   assert.equal(p.planChanges.find(x=>x.id==='pause').reason.citation.text,'原因是等待材料到貨。');
   assert(!p.currentPlans[0].text.includes('等待材料'));assert.equal(p.currentPlans[0].planStatus,'paused');
  });
  await t.test('未填理由明示未提供，ready 不升格語意完成或證明不存在',()=>{
   const n=structuredClone(original);delete n.reason;const r=calc([changed],{nodes:[n]});
   assert.equal(r.status,'ready');assert.deepEqual(r.projection.reasons,[]);assert.equal(r.projection.planBasis[0].reasonStatus,'not_provided');
   assert.equal(r.projection.planChanges[0].reason,null);assert.equal(r.projection.reasonCoverage.nodeReasonsProvided,0);
   assert.equal(r.projection.reasonCoverage.interpretationCompleteness,'not_established');
   assert.equal(r.projection.reasonCoverage.omissionMeaning,'not_provided_does_not_mean_no_reason');
  });
  await t.test('別則 User 與 Assistant 文字都不能成為這次變更原因',()=>{
   for(const i of [0,1,4]){
    const error=getError(()=>calc([{...changed,reason:{ref:refs[i],quote:texts[i]}}]));
    assert.equal(error.message,'continuity_plan_change_reason_source_mismatch');
    assert.equal(getCmcpContinuityCorrection(error).issues[0].changeId,'height');
   }
  });
  await t.test('原因仍需正式來源及精確引文，不能任意附自由文字',()=>{
   assert.throws(()=>calc([{...changed,reason:{ref:refs[2],quote:'我自創的新理由'}}]),/continuity_quote_absent/);
   assert.throws(()=>calc([{...changed,reason:{ref:'unknown',quote:'不存在'}}]),/continuity_source_outside_reading/);
   assert.throws(()=>calc([{...changed,reason:{ref:refs[2],quote:texts[2],text:'自由改寫'}}]),/continuity_plan_change_shape/);
  });
  await t.test('目標缺附件與起點缺附件分別指出具名節點，不能以刪關係當修正',()=>{
   const noOld=structuredClone(original),noNew=structuredClone(prioritizer);delete noOld.reason;delete noNew.reason;
   const targetError=getError(()=>calc([],{nodes:[noOld,prioritizer],reasonRelations:[relation]}));
   const target=getCmcpContinuityCorrection(targetError).issues;
   assert.equal(target.length,1);assert.equal(target[0].reason,'target_node_reason_missing');assert.equal(target[0].targetNodeId,'shelf');
   const fromError=getError(()=>calc([],{nodes:[original,noNew],reasonRelations:[relation]}));
   const from=getCmcpContinuityCorrection(fromError).issues;
   assert.equal(from.length,1);assert.equal(from[0].reason,'from_node_reason_missing');assert.equal(from[0].nodeId,'priority');
   assert.equal(calc([],{nodes:[original,prioritizer],reasonRelations:[relation]}).projection.reasonRelations.length,1);
  });
  await t.test('提案理由不能被 User 理由關係升格，錯誤具名指出來源角色',()=>{
   const suggestion=node('suggestion',1,texts[1],{kind:'assistant_suggestion',text:texts[1],temporalUse:'unspecified',reason:{ref:refs[1],quote:texts[1]}});
   const error=getError(()=>calc([],{nodes:[original,suggestion,prioritizer],reasonRelations:[{...relation,targetNodeIds:['suggestion']}]}));
   const issue=getCmcpContinuityCorrection(error).issues[0];assert.equal(issue.targetNodeId,'suggestion');assert.equal(issue.reason,'target_reason_requires_user_source');
  });
  await t.test('新增／優先／接受取捨仍不自動撤回原理由，明示撤回只改站位',()=>{
   for(const kind of ['adds','prioritizes','accepts_tradeoff','unresolved']){
    const p=calc([changed],{nodes:[original,prioritizer],reasonRelations:[{...relation,kind}]}).projection;
    assert.equal(p.reasons.find(x=>x.nodeId==='shelf').standing,'not_explicitly_withdrawn');
    assert.equal(p.reasons.find(x=>x.nodeId==='shelf').binding.basisVersion,p.planBasis.find(x=>x.nodeId==='shelf').baseVersion);
   }
   const withdrawer=node('withdrawal',5,texts[5],{temporalUse:'unspecified'});
   const p=calc([changed],{nodes:[original,withdrawer],reasonRelations:[{kind:'withdraws',fromNodeId:'withdrawal',targetNodeIds:['shelf'],ref:refs[5],quote:texts[5]}]}).projection;
   assert.equal(p.reasons[0].standing,'withdrawn_by_explicit_user_source');assert.equal(p.reasons[0].binding.source.citation.text,original.quote);
  });
  await t.test('理由關係仍不能借別則 User 取得新關係授權',()=>{
   assert.throws(()=>calc([],{nodes:[original,prioritizer],reasonRelations:[{...relation,ref:refs[5],quote:texts[5]}]}),/continuity_scoped_user_source_required/);
  });
  await t.test('非計畫回報理由綁定原節點，不偽稱是計畫版本',()=>{
   const report=node('report',6,texts[6],{kind:'user_report',text:texts[6],reason:{ref:refs[6],quote:'木架尚未製作'}});
   const p=calc([],{nodes:[original,report]}).projection,r=p.reasons.find(x=>x.nodeId==='report');
   assert.equal(r.binding.kind,'source_node');assert.equal(r.binding.source.ref,refs[6]);assert.equal(p.currentClaims.length,1);
  });
  await t.test('衍生查證不新增授權、事實、時間、TTL 或派送工作',async()=>{
   const before=await runtime.bufferList();const result=calc([{...changed,reason:{ref:refs[2],quote:'因為可用空間變多'}}]);
   assert.deepEqual(result.projection.currentClaims,[]);assert.equal(result.projection.activation,'none');assert.equal(result.projection.proactiveEligible,false);
   assert.equal(result.projection.validation.executionAuthority,'none');assert.equal(result.modelCalls,0);
   assert.deepEqual((await runtime.bufferList()).items,before.items);
  });
  await t.test('v1／v2 既有理由結果及錯誤契約保持，新增欄位只在 v3',()=>{
   for(const version of [1,2]){
    const result=project(input({version,nodes:[{...original,text:original.quote}],unknowns:[]})).projection;
    assert.equal(result.reasons[0].binding,undefined);assert.equal(result.reasonCoverage,undefined);assert.equal(result.planChanges,undefined);
   }
   const n=structuredClone(prioritizer);delete n.reason;
   const error=getError(()=>project(input({version:2,nodes:[{...original,text:original.quote},{...n,text:n.quote}],unknowns:[],reasonRelations:[relation]})));
   assert.equal(error.message,'continuity_reason_target_missing');assert.equal(getCmcpContinuityCorrection(error),null);
  });
  await fs.writeFile(path.join(out,'final-projection.json'),JSON.stringify(calc([{...changed,reason:{ref:refs[2],quote:'因為可用空間變多'}},pause],{nodes:[original,prioritizer],reasonRelations:[relation]}),null,2)+'\n',{flag:'wx'});
 }finally{await runtime.close();}
});
