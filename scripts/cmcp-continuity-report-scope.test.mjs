import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const product=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=file=>import(pathToFileURL(path.join(product,file)).href),copy=structuredClone;
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,validateCmcpContinuityPublication:publish,getCmcpContinuityCorrection:feedback,CMCP_CONTINUITY_PROJECTION_LIMITS:limits}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {compileCmcpTypedContinuityProposal:compileTyped}=await load('src/cmcp-guard/cmcp-continuity-typed-proposal.js');
const {continuityToolSchema,CONTINUITY_TOOL_PARAMETERS}=await load('adapters/continuity-input.mjs');
const {restoreContinuityModelView:restore,projectContinuityModelView:compact}=await load('adapters/continuity-model-view.mjs');
const {reviewCmcpReportScope:reviewScope}=await load('src/cmcp-guard/cmcp-continuity-report-scope.js');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');

test('回報與狀態引文用途：正式來源範圍、明示解決及既有控制',async t=>{
 const root=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-report-scope');await fs.mkdir(root,{recursive:true});
 const out=await fs.mkdtemp(path.join(root,'formal-')),scope='synthetic-report-scope',now='2026-10-12T00:00:00.000Z',timezone='Asia/Taipei';
 const bodies=[
  '🪟 計畫製作一份路線索引，檔案只留室內電腦。',
  '索引排版先暫停，等管理員確認文字再繼續。',
  '因甲的校對已完成，乙的排版先暫停。',
  '甲的校對已完成。',
  '索引排版先暫停，等管理員確認文字再繼續。',
  '這是 Assistant 的建議，並未獲得採納。',
  '索引排版已重新安排，其他條件不變。',
  '索引排版先暫停，等管理員確認文字再繼續。這次只整理說明。'
 ];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:scope,providerMode:'host',input:{root:path.join(out,'state'),scopeId:scope,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:32,maxSourceBytes:8192},
  loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:scope+'-session',hostProvider:{request:async()=>{throw Error('本測試禁止模型');}}});
 const outcomes=[];
 const check=(name,fn)=>t.test(name,async()=>{try{await fn();outcomes.push({name,status:'PASS'});}catch(e){outcomes.push({name,status:'FAIL',error:e.message});throw e;}});
 try{
  for(const [i,text]of bodies.entries())await runtime.ingest({role:i===5?'assistant':'user',text,timeContext:{now:new Date(Date.parse(now)-600000+i*60000).toISOString(),timezone}});
  const navigation=await runtime.readingNavigate({text:'核對索引的暫停指示與明示完成回報。'});
  const reading=await runtime.readingOpen({navigationTicket:navigation.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:32,maxTotalBytes:32768,maxPageBytes:4096,maxPages:32,maxProjectionBytes:32768}}),pages=[];
  for(let i=0;i<32;i++){const page=await runtime.readingPage({ticket:reading.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  assert(pages.at(-1).reader.coverage.complete);
  const refs=bodies.map((text,i)=>pages.find(page=>page.reader.text===text&&JSON.parse(page.modelContext).time.messageRecordedAt===new Date(Date.parse(now)-600000+i*60000).toISOString()).reader.source.ref);
  const input=q=>({reading,previousPages:pages,scopeId:scope,proposal:q,timeContext:{now,timezone}}),calc=q=>project(input(q));
  const report=(ref,quote,id='report')=>({id,ref,quote,topic:'索引作業',aspect:'明說現況',temporalUse:'current'});
  const build=(mixed=false)=>({version:6,plans:[{id:'plan',ref:refs[0],quote:bodies[0],topic:'索引作業',aspect:'排版',temporalUse:'current',
   orderedChanges:[{kind:'status',ref:refs[mixed?2:1],quote:bodies[mixed?2:1],planStatus:'paused'}]}],
   reports:[report(refs[mixed?2:1],mixed?'甲的校對已完成':'等管理員確認文字再繼續')],unknowns:[]});
  const resolved=()=>{const q=build(true),f=calc(q).projection.reportScopeReview.findings[0];q.reportScopeResolutions=[{findingId:f.findingId,kind:'reported_state_in_status_clause',reportRef:refs[2],reportQuote:'甲的校對已完成'}];return q;};
  const sibling=()=>{const q=build(true);q.plans[0].orderedChanges[0].quote='乙的排版先暫停';return q;};
  const resolvedSibling=()=>{const q=sibling(),f=calc(q).projection.reportScopeReview.findings[0];q.reportScopeResolutions=[{findingId:f.findingId,kind:'reported_state_in_status_message',reportRef:refs[2],reportQuote:'甲的校對已完成'}];return q;};
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({config,reading,pages,refs,bodies},null,2)+'\n',{flag:'wx'});
  await check('結構同形的前提誤列標 partial，完整回報與暫停條件保留且不代判型別',()=>{
   const q=build(),before=copy(q),result=calc(q),review=result.projection.reportScopeReview;
   assert.equal(result.status,'partial');assert.equal(result.reason,'report_scope_review_required');assert.equal(result.modelCoverageComplete,true);
   assert.equal(review.totalFindings,1);assert.equal(review.unresolvedFindings,1);assert.equal(review.semanticVerification,'not_performed');
   assert.equal(result.projection.currentClaims[0].text,'等管理員確認文字再繼續');assert.equal(result.projection.currentPlans[0].statusSource.citation.text,bodies[1]);
   assert.equal(review.findings[0].reportInputPath,'$.reports[0]');assert.deepEqual(review.findings[0].statusInputPaths,['$.plans[0].orderedChanges[0]']);
   assert.deepEqual(q,before);assert.deepEqual(result.projection.unknowns,[]);outcomes.push({name:'待覆核完整結果',result});
  });
  await check('誤列由宿主移除 report，完整計畫前提仍在；Core 不自動改寫',()=>{
   const q=build();q.reports=[];const result=calc(q);assert.equal(result.status,'ready');assert.deepEqual(result.projection.currentClaims,[]);
   assert.equal(result.projection.currentPlans[0].statusSource.citation.text,bodies[1]);assert.equal(result.projection.reportScopeReview.status,'no_overlap_detected');
  });
  await check('合法混句需具名逐字回報子句，明示解決後 ready 仍不是語意已驗',()=>{
   const q=resolved();assert(continuityToolSchema.safeParse({ticket:reading.reader.ticket,proposal:q}).success);
   assert(CONTINUITY_TOOL_PARAMETERS.properties.proposal.properties.reportScopeResolutions);
   const result=calc(q),review=result.projection.reportScopeReview;assert.equal(result.status,'ready');assert.equal(review.unresolvedFindings,0);
   assert.equal(review.resolutions[0].reportClause.quote,'甲的校對已完成');assert.equal(review.semanticVerification,'not_performed');
   assert.equal(review.resolutions[0].executionAuthority,'none');assert.equal(result.projection.currentClaims[0].text,'甲的校對已完成');
   outcomes.push({name:'合法混句解決完整結果',result});
  });
  await check('v3／v4／v5 保留原契約，不新增沒有解決入口的 partial',()=>{
   const q=build(true),v3=compileTyped({...q,version:5},{limits}).proposal;
   for(const legacy of [{...copy(q),version:5},copy(v3),{...copy(v3),version:4}]){
    const r=calc(legacy);assert.equal(r.status,'ready');assert.equal(r.projection.reportScopeReview.status,'not_evaluated_legacy_input');
    assert.equal(r.projection.currentClaims[0].text,'甲的校對已完成');
   }
  });
  await check('原 report 較寬可精確指出其內回報子句，不改現有原文',()=>{
   const q=build(true);q.reports[0].quote=bodies[2];const f=calc(q).projection.reportScopeReview.findings[0];
   q.reportScopeResolutions=[{findingId:f.findingId,kind:'reported_state_in_status_clause',reportRef:refs[2],reportQuote:'甲的校對已完成'}];
   const r=calc(q);assert.equal(r.status,'ready');assert.equal(r.projection.currentClaims[0].text,bodies[2]);assert.equal(r.projection.reportScopeReview.resolutions[0].reportClause.quote,'甲的校對已完成');
  });
  await check('純 ACK、重複解決及舊 finding 不可通過',()=>{
   for(const mutate of [q=>{q.reportScopeResolutions=[{ack:true}];},q=>{q.reportScopeResolutions.push(copy(q.reportScopeResolutions[0]));},q=>{q.reportScopeResolutions[0].findingId='0'.repeat(64);},q=>{q.reportScopeResolutions[0].kind='ack';}]){
    const q=resolved();mutate(q);assert.throws(()=>calc(q),/continuity_report_scope_resolution_binding/);
   }
  });
  await check('不同 ref、Assistant、範圍外及不存在的回報片段拒絕',()=>{
   for(const [ref,quote,error]of [[refs[3],'甲的校對已完成',/continuity_report_scope_resolution_source/],[refs[5],bodies[5],/continuity_report_scope_resolution_source/],
    [refs[2],'乙的排版先暫停',/continuity_report_scope_resolution_source/],['outside','甲的校對已完成',/continuity_source_outside_reading/],[refs[2],'查無此句',/continuity_quote_absent/]]){
    const q=resolved();q.reportScopeResolutions[0].reportRef=ref;q.reportScopeResolutions[0].reportQuote=quote;assert.throws(()=>calc(q),error);
   }
  });
  await check('相同文字不同正式來源不產生用途 finding',()=>{
   const q=build();q.reports[0].ref=refs[4];const r=calc(q);assert.equal(r.status,'ready');assert.equal(r.projection.reportScopeReview.totalFindings,0);
  });
  await check('無包含的同訊息不同引文只列用途覆核，不推衝突；無status或不同訊息保持',()=>{
   const q=sibling(),r=calc(q),review=r.projection.reportScopeReview;assert.equal(r.status,'partial');assert.equal(r.reason,'report_scope_review_required');assert.equal(review.totalFindings,1);
   assert.equal(review.findings[0].reason,'current_report_quote_in_same_status_change_message');assert.equal(review.semanticVerification,'not_performed');assert.equal(review.executionAuthority,'none');
   assert.equal(review.findings[0].reportInputPath,'$.reports[0]');assert.deepEqual(review.findings[0].statusInputPaths,['$.plans[0].orderedChanges[0]']);
   assert.ok(review.findings[0].report.source.range.end<=review.findings[0].statusChanges[0].source.range.start);
   q.plans[0].orderedChanges=[];assert.equal(calc(q).status,'ready');
   const other=sibling();other.reports[0]=report(refs[3],'甲的校對已完成');assert.equal(calc(other).status,'ready');assert.equal(calc(other).projection.reportScopeReview.totalFindings,0);
   outcomes.push({name:'同訊息不同引文待用途覆核',result:r});
  });
  await check('真正完成回報的同訊息子句可精確明示解決，仍非語意或執行權',()=>{
   const q=resolvedSibling();assert(continuityToolSchema.safeParse({ticket:reading.reader.ticket,proposal:q}).success);
   const result=calc(q),review=result.projection.reportScopeReview;assert.equal(result.status,'ready');assert.equal(review.unresolvedFindings,0);
   assert.equal(review.resolutions[0].kind,'reported_state_in_status_message');assert.equal(review.resolutions[0].reportClause.quote,q.reports[0].quote);
   assert.deepEqual(review.resolutions[0].reportClause.range,review.findings[0].report.source.range);assert.equal(review.semanticVerification,'not_performed');assert.equal(review.executionAuthority,'none');
   assert.equal(result.projection.currentClaims[0].text,'甲的校對已完成');outcomes.push({name:'同訊息真正回報明示解決',result});
  });
  await check('一般工作指令從誤列回報回到context，完整計畫／暫停條件不丟失',()=>{
   const q=build();q.plans[0].orderedChanges[0]={kind:'status',ref:refs[7],quote:bodies[1],planStatus:'paused'};
   q.reports=[report(refs[7],'這次只整理說明')];assert.equal(calc(q).status,'partial');
   q.context=[{...q.reports[0],id:'scope-instruction',kind:'user_instruction'}];q.reports=[];const fixed=calc(q);
   assert.equal(fixed.status,'ready');assert.deepEqual(fixed.projection.currentClaims,[]);assert.equal(fixed.projection.currentPlans[0].statusSource.citation.text,bodies[1]);
   assert.equal(fixed.projection.currentPlans[0].planStatus,'paused');assert.equal(fixed.projection.currentPlans[0].text,bodies[0]);
   assert.equal(fixed.projection.knownEvolution.find(row=>row.nodeId==='scope-instruction').interpretation.kind,'user_instruction');
   assert.equal(fixed.projection.eventMutation,'none');assert.equal(fixed.projection.proactiveEligible,false);outcomes.push({name:'誤列指令正式更正',result:fixed});
  });
  await check('新舊kind不可互用，same-message解決不能縮句、換ref或加入ACK',()=>{
   const contained=resolved();contained.reportScopeResolutions[0].kind='reported_state_in_status_message';assert.throws(()=>calc(contained),/continuity_report_scope_resolution_binding/);
   const message=resolvedSibling();message.reportScopeResolutions[0].kind='reported_state_in_status_clause';assert.throws(()=>calc(message),/continuity_report_scope_resolution_binding/);
   for(const mutate of [q=>{q.reportScopeResolutions[0].reportQuote='校對已完成';},q=>{q.reportScopeResolutions[0].reportRef=refs[3];},q=>{q.reportScopeResolutions[0].ack=true;}]){
    const q=resolvedSibling();mutate(q);assert.throws(()=>calc(q),/continuity_report_scope_resolution_source|continuity_report_scope_resolution_binding/);
   }
   const both=build(true);both.plans[0].orderedChanges.push({kind:'status',ref:refs[2],quote:'乙的排版先暫停',planStatus:'paused'});
   const result=calc(both);assert.equal(result.projection.reportScopeReview.findings[0].reason,'current_report_quote_contained_in_status_change_support');
   assert.equal(result.projection.reportScopeReview.findings[0].statusChanges.length,1);
  });
  await check('目前 finding 與拒絕回饋提供契約，不代填回報用途或解除守護',()=>{
   const pending=calc(sibling()).projection.reportScopeReview.findings[0];
   assert.equal(pending.requiredResolutionKind,'reported_state_in_status_message');
   const q=resolvedSibling();q.reportScopeResolutions[0].kind='reported_state_in_status_clause';
   let correction;try{calc(q);}catch(error){correction=feedback(error);}
   const issue=correction.issues[0];assert.equal(issue.reason,'resolution_kind_does_not_match_finding_reason');
   assert.equal(issue.resolutionContract.reportRef,refs[2]);assert.equal(issue.resolutionContract.expectedKind,pending.requiredResolutionKind);
   assert.equal(issue.resolutionContract.reportRefMeaning,'formal_reading_source_ref_not_report_node_id');
   assert.deepEqual(issue.resolutionContract.allowedFields,['findingId','kind','reportRef','reportQuote']);
   assert.equal(issue.resolutionContract.autoResolved,false);assert.equal(issue.resolutionContract.reportQuote,undefined);
   assert.equal(calc(sibling()).status,'partial');
  });
  await check('同hash但不同正式item／revision／scope不建立same-message用途關聯',()=>{
   const q=sibling(),p=calc(q).projection,node=p.knownEvolution.find(row=>row.nodeId==='report'),original=reading.internal.manifest.sources.find(row=>row.ref===refs[2]);
   for(const mutate of [pointer=>{pointer.itemId='same-hash-other-item';},pointer=>{pointer.revisionId='other-revision';},pointer=>{pointer.scopeId='other-scope';}]){
    const other=copy(original);other.ref='alternate-report';mutate(other.pointer);const sourceMap=new Map([[original.ref,original],[other.ref,other]]);
    const review=reviewScope({proposal:{nodes:[{...q.reports[0],ref:other.ref,kind:'user_report'}]},view:{currentClaims:p.currentClaims},plans:{planChanges:p.planChanges},limits,resolutions:[],correction:code=>Error(code),
     support:ref=>({...node.source,ref,evidenceHash:sourceMap.get(ref).evidenceHash,messageRecordedAt:sourceMap.get(ref).messageRecordedAt,eventOccurredAt:sourceMap.get(ref).eventOccurredAt}),
     sourceIdentity:ref=>{const row=sourceMap.get(ref);return loopHash({pointer:row.pointer,evidenceHash:row.evidenceHash});}});
    assert.equal(review.totalFindings,0);assert.equal(review.semanticVerification,'not_performed');
   }
  });
  await check('same-message多status仍一report一群，十群有界且不能以部分解決冒充ready',()=>{
   const q=sibling();q.plans[0].orderedChanges.push({...copy(q.plans[0].orderedChanges[0]),planStatus:'cancelled'});
   const grouped=calc(q).projection.reportScopeReview;assert.equal(grouped.totalFindings,1);assert.equal(grouped.findings[0].statusChanges.length,2);
   q.reports=Array.from({length:10},(_,i)=>({...report(refs[2],'甲的校對已完成','sibling-'+i),aspect:'獨立用途-'+i}));const review=calc(q).projection.reportScopeReview;
   assert.equal(review.totalFindings,10);assert.equal(review.maxFindings,limits.maxNodes);assert.equal(review.truncated,false);assert.ok(review.findings.every(row=>row.statusChanges.length===2));
   q.reportScopeResolutions=review.findings.slice(0,8).map(row=>({findingId:row.findingId,kind:'reported_state_in_status_message',reportRef:refs[2],reportQuote:'甲的校對已完成'}));
   const partial=calc(q);assert.equal(partial.status,'partial');assert.equal(partial.projection.reportScopeReview.unresolvedFindings,2);
   q.reportScopeResolutions=review.findings.map(row=>({findingId:row.findingId,kind:'reported_state_in_status_message',reportRef:refs[2],reportQuote:'甲的校對已完成'}));assert.equal(calc(q).status,'ready');
  });
  await check('planStatus／引文／report 身分改變會改 finding，不能重播舊解決',()=>{
   for(const mutate of [q=>{q.plans[0].orderedChanges[0].planStatus='cancelled';},q=>{q.plans[0].orderedChanges[0].quote='甲的校對已完成，乙的排版先暫停';},q=>{q.reports[0].id='new-report';}]){
    const q=resolved();mutate(q);assert.throws(()=>calc(q),/continuity_report_scope_resolution_binding/);
   }
  });
  await check('正式來源與錯誤 scope 不混用，讀取前提保持',()=>{
   const base=resolved(),original=calc(build(true)).projection.reportScopeReview.findings[0].findingId;
   // 正式 manifest 的受驗來源不同時必須得到不同 finding；不偽造讀取回執。
   const sameText=build();const first=calc(sameText).projection.reportScopeReview.findings[0].findingId;
   sameText.plans[0].orderedChanges[0].ref=refs[4];sameText.reports[0].ref=refs[4];assert.notEqual(calc(sameText).projection.reportScopeReview.findings[0].findingId,first);
   assert.match(original,/^[a-f0-9]{64}$/);assert.throws(()=>project({...input(base),scopeId:'wrong-scope'}));
  });
  await check('finding 的來源身分改 scope／revision／hash，原解決必失效',()=>{
   const q=resolved(),p=calc(q).projection,manifest=reading.internal.manifest,node=p.knownEvolution.find(row=>row.nodeId==='report');
   const make=()=>{const sources=copy(manifest.sources),sourceMap=new Map(sources.map(row=>[row.ref,row]));
    return {sources,args:{proposal:{nodes:[{...q.reports[0],kind:'user_report'}]},view:{currentClaims:p.currentClaims},plans:{planChanges:p.planChanges},
     limits,resolutions:q.reportScopeResolutions,correction:code=>Error(code),
     support:ref=>{const s=sourceMap.get(ref);return {...node.source,ref,evidenceHash:s.evidenceHash,messageRecordedAt:s.messageRecordedAt,eventOccurredAt:s.eventOccurredAt};},
     sourceIdentity:ref=>{const s=sourceMap.get(ref);return loopHash({pointer:Object.fromEntries(Object.entries(s.pointer).sort(([a],[b])=>a.localeCompare(b))),evidenceHash:s.evidenceHash});}}};};
   assert.equal(reviewScope(make().args).status,'addressed_by_source_bound_host_resolution');
   for(const mutate of [s=>{s.pointer.scopeId='other-scope';},s=>{s.pointer.revisionId='r-other';},s=>{s.pointer.itemId='other-same-text';}]){
    const f=make();mutate(f.sources.find(s=>s.ref===refs[2]));assert.throws(()=>reviewScope(f.args),/continuity_report_scope_resolution_binding/);
   }
   const f=make();f.sources.find(s=>s.ref===refs[2]).evidenceHash='0'.repeat(64);assert.throws(()=>reviewScope(f.args),/continuity_report_scope_resolution_binding/);
  });
  await check('沿既有 node 上限完整列出十個回報群，八個解決不冒充全部，十個可收斂',()=>{
   const q=build(true);q.reports=Array.from({length:10},(_,i)=>({...report(refs[2],'甲的校對已完成','r'+i),aspect:'獨立用途-'+i}));const review=calc(q).projection.reportScopeReview;
   assert.equal(review.totalFindings,10);assert.equal(review.findings.length,10);assert.equal(review.truncated,false);assert.equal(review.maxFindings,limits.maxNodes);
   q.reportScopeResolutions=review.findings.slice(0,8).map(f=>({findingId:f.findingId,kind:'reported_state_in_status_clause',reportRef:refs[2],reportQuote:'甲的校對已完成'}));
   const r=calc(q);assert.equal(r.status,'partial');assert.equal(r.projection.reportScopeReview.unresolvedFindings,2);
   q.reportScopeResolutions=review.findings.map(f=>({findingId:f.findingId,kind:'reported_state_in_status_clause',reportRef:refs[2],reportQuote:'甲的校對已完成'}));
   assert.equal(calc(q).status,'ready');assert(continuityToolSchema.safeParse({ticket:reading.reader.ticket,proposal:q}).success);
  });
  await check('同一回報被多個狀態引文包含只列一群，任何狀態版本改變使舊解決失效',()=>{
   const q=build(true);q.plans[0].orderedChanges.push({...copy(q.plans[0].orderedChanges[0]),planStatus:'cancelled'});
   const r=calc(q).projection.reportScopeReview;assert.equal(r.totalFindings,1);assert.equal(r.findings[0].statusChanges.length,2);
   q.reportScopeResolutions=[{findingId:r.findings[0].findingId,kind:'reported_state_in_status_clause',reportRef:refs[2],reportQuote:'甲的校對已完成'}];
   assert.equal(calc(q).status,'ready');q.plans[0].orderedChanges[0].planStatus='planned';assert.throws(()=>calc(q),/continuity_report_scope_resolution_binding/);
  });
  await check('正式 Runtime 回讀 partial／ready，序列化與還原保持完整用途證據',async()=>{
   const partial=await runtime.readingContinuity({ticket:reading.reader.ticket,proposal:build()});assert.equal(partial.status,'partial');
   assert.equal((await runtime.continuityStatus()).reason,'report_scope_review_required');
   const ready=await runtime.readingContinuity({ticket:reading.reader.ticket,proposal:resolved()});assert.equal(ready.status,'ready');
   assert.deepEqual(restore(compact(ready)),ready);outcomes.push({name:'正式 Runtime 與無損出口',partial,ready});
  });
  await check('publication 不接受把 pending 外殼改成 ready；取消仍拒絕',async()=>{
   const result=calc(build()),args={stores:{scopeId:scope},reading,previousPages:pages,result,timeContext:{now,timezone},bufferGeneration:reading.internal.manifest.bufferGeneration};
   await assert.rejects(publish({...args,result:{...result,status:'ready',reason:null}}),/continuity_projection_binding_changed/);
   await assert.rejects(publish({...args,valid:async()=>false}),/reading_cancelled|continuity_publication_cancelled/);
   await assert.rejects(publish({...args,result:calc(resolved()),valid:async()=>false}),/reading_cancelled|continuity_publication_cancelled/);
   const siblingResult=calc(sibling());await assert.rejects(publish({...args,result:{...siblingResult,status:'ready',reason:null}}),/continuity_projection_binding_changed/);
   await assert.rejects(publish({...args,result:calc(resolvedSibling()),valid:async()=>false}),/reading_cancelled|continuity_publication_cancelled/);
  });
  await check('查看不刷新來源時間、Buffer 或資格；Clean／OFF 沿原控制拒絕',async()=>{
   const before=await runtime.bufferList();calc(resolved());await runtime.continuityStatus();assert.deepEqual((await runtime.bufferList()).items,before.items);
   await runtime.configureControls({updateId:'report-clean',patch:{clean:true}});assert.equal((await runtime.continuityStatus()).projection,null);
   await runtime.configureControls({updateId:'report-clean-off',patch:{clean:false}});assert.equal((await runtime.continuityStatus()).status,'unavailable');
   await runtime.configureControls({updateId:'report-off',patch:{enabled:false}});assert.equal((await runtime.readingContinuity({ticket:reading.reader.ticket,proposal:build()})).status,'disabled');
  });
 }finally{await runtime.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify({kind:'cmcp_report_scope_zero_model_results',product,modelCalls:0,runtimeClosed:true,semanticVerification:'not_performed',outcomes},null,2)+'\n',{flag:'wx'});}
});
