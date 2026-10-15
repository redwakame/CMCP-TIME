import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=p=>import(pathToFileURL(path.join(productRoot,p)));
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,getCmcpContinuityCorrection:feedback}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {reviewCmcpReasonSpans:reviewSpans}=await load('src/cmcp-guard/cmcp-continuity-plan-patch.js');
const {CmcpHarnessBridge,projectHarnessToolResult}=await load('adapters/deepseek-harness/runtime-bridge.mjs');
const {projectContinuityModelView:compact,restoreContinuityModelView:restore}=await load('adapters/continuity-model-view.mjs');
const copy=structuredClone;

// 核對來源／表示責任，沒有自然語意裁決器，也不把核對提示當自動撤回。
test('理由片段核對與精確修正：正式 Runtime／Bridge 的零模型反例',async t=>{
 const parent=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-reason-scope');await fs.mkdir(parent,{recursive:true});
 const out=await fs.mkdtemp(path.join(parent,'formal-')),scopeId='synthetic-reason-scope',now='2026-10-11T00:00:00.000Z',timezone='Asia/Taipei';
 const reason='避免斷電時無法查閱',priority='優先讓交接更方便';
 const bodies=[
  '🪟 計畫做一份紙本索引，只供內部查閱；原因是'+reason+'。',
  '紙本改成電子索引，原先避免斷電的顧慮仍然存在；其他條件維持。',
  '現在明確撤回避免斷電這項理由；只供內部查閱的條件仍維持。',
  '改成電子索引，原因改記為方便攜帶；新增理由是'+priority+'。',
  '建議另印兩份，尚未獲得使用者採納。',
  '還沒決定是否採用另外兩份的建議。',
  '🪟 計畫做一份紙本索引，只供內部查閱；原因是'+reason+'。',
  '暫停索引計畫，既有內容先保留。',
  '取消索引計畫。',
  '改成電子索引，原因仍是'+reason+'。',
  '只移除理由段落，但顧慮仍在，不代表撤回理由。'
 ];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-reason-scope',providerMode:'host',input:{root:path.join(out,'state'),scopeId,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:14000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:14000},storageCapacity:{maxSources:64,maxSourceBytes:8192},
  loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},
  controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-reason-scope-session',hostProvider:{request:async()=>{throw Error('本測試禁止模型');}}});
 const outcomes=[];let refs,reading,pages;
 const check=async(name,fn)=>t.test(name,async()=>{try{await fn();outcomes.push({name,status:'PASS'});}catch(e){outcomes.push({name,status:'FAIL',error:e.message});throw e;}});
 const make=()=>({version:6,plans:[{id:'index',ref:refs[0],quote:bodies[0],topic:'資料查閱',aspect:'索引方案',temporalUse:'current',reasons:[{id:'outage',ref:refs[0],quote:reason}]}],unknowns:[]});
 const withdrawnText=()=>{const q=make();q.plans[0].orderedChanges=[{kind:'content',ref:refs[10],quote:bodies[10],edits:[{kind:'withdraw',quote:reason}]}];return q;};
 const input=q=>({reading,previousPages:pages,scopeId,proposal:q,timeContext:{now,timezone}}),calc=q=>project(input(q));
 const changedReason=()=>({kind:'content',ref:refs[3],quote:bodies[3],edits:[{kind:'replace',quote:reason,replacement:{ref:refs[3],quote:'方便攜帶'}}],reasons:[{id:'handover',ref:refs[3],quote:priority,kind:'prioritizes'}]});
 try{
  for(const [i,text]of bodies.entries())await runtime.ingest({role:i===4?'assistant':'user',text,timeContext:{now:new Date(Date.parse(now)-1200000+i*60000).toISOString(),timezone}});
  const nav=await runtime.readingNavigate({text:'核對索引的局部修訂、理由、未採納提案與原說明。'});
  reading=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:32768}});
  pages=[];for(let i=0;i<64;i++){const page=await runtime.readingPage({ticket:reading.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}assert(pages.at(-1).reader.coverage.complete);
  refs=bodies.map((body,i)=>pages.find(page=>page.reader.text===body&&JSON.parse(page.modelContext).time.messageRecordedAt===new Date(Date.parse(now)-1200000+i*60000).toISOString()).reader.source.ref);
  const bufferBefore=(await runtime.bufferList()).items;
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({bodies,refs,reading,pages},null,2)+'\n',{flag:'wx'});
  await check('合法內容修改仍可 ready，理由待核不自動撤回或擴充未知',()=>{
   const q=withdrawnText(),before=copy(q),result=calc(q),p=result.projection,r=p.reasonScopeReview;
   assert.equal(result.status,'ready');assert.equal(r.status,'required');assert.equal(r.findings.length,1);assert.equal(p.reasonBindings[0].standing,'not_explicitly_withdrawn');
   assert.deepEqual(p.reasonRelations,[]);assert.deepEqual(p.unknowns,[]);assert.equal(p.currentPlans[0].text,bodies[0].replace(reason,''));assert.deepEqual(q,before);
   const f=r.findings[0];assert.equal(f.reasonId,'outage');assert.equal(f.nodeId,'index');assert.equal(f.sourceRef,refs[0]);assert.equal(f.changeRef,refs[10]);
   assert.equal(f.range.start,[...bodies[0].slice(0,bodies[0].indexOf(reason))].length);assert.equal(f.range.end,f.range.start+[...reason].length);
   assert.equal(f.reasonVersion,p.reasonBindings[0].reasonVersion);assert.equal(f.reasonBinding.basisVersion,p.planBasis[0].baseVersion);
   assert.equal(r.semanticVerification,'not_performed');assert.equal(r.completeness,'not_established');assert.equal(p.validation.executionAuthority,'none');
   assert(!JSON.stringify(r).includes(reason));assert(!JSON.stringify(r).includes(out));outcomes.push({name:'合法保留的完整結果',result});
  });
  await check('同一片段具名明示撤回後待核變 addressed，其他理由保持',()=>{
   const q=withdrawnText();q.plans[0].reasons.push({id:'inside',ref:refs[0],quote:'只供內部查閱'});
   q.plans[0].reasonWithdrawals=[{ref:refs[2],quote:'現在明確撤回避免斷電這項理由',temporalUse:'current',targetReasonId:'outage'}];
   const p=calc(q).projection,r=p.reasonScopeReview;assert.equal(r.status,'addressed_by_named_withdrawal');assert.equal(r.unresolvedFindings,0);assert.equal(r.findings[0].requiresReview,false);
   assert.deepEqual(r.findings[0].namedWithdrawalRefs,[refs[2]]);assert.equal(p.reasonBindings[0].standing,'withdrawn_by_explicit_user_source');assert.equal(p.reasonBindings[1].standing,'not_explicitly_withdrawn');
   outcomes.push({name:'具名撤回結果',projection:p});
  });
  await check('參數局部修改不碰理由，明說其餘維持不額外變 unknown',()=>{
   const q=make();q.plans[0].orderedChanges=[{kind:'content',ref:refs[1],quote:bodies[1],edits:[{kind:'replace',quote:'紙本',replacement:{ref:refs[1],quote:'電子'}}]}];q.plans[0].retentions=[{ref:refs[1],quote:'其他條件維持',temporalUse:'current'}];
   const p=calc(q).projection;assert.equal(p.reasonScopeReview.status,'no_overlap_detected');assert.equal(p.reasonBindings[0].standing,'not_explicitly_withdrawn');assert(p.currentPlans[0].text.includes(reason));assert.deepEqual(p.unknowns,[]);
  });
  await check('整段替換的精確共同前後綴不當成理由變動',()=>{
   const q=make();q.plans[0].quote='紙本索引，只供內部查閱；原因是'+reason;q.plans[0].orderedChanges=[{kind:'content',ref:refs[9],quote:bodies[9],edits:[{kind:'replace',quote:q.plans[0].quote,replacement:{ref:refs[9],quote:'電子索引，原因仍是'+reason}}]}];
   const p=calc(q).projection;assert.equal(p.reasonScopeReview.status,'no_overlap_detected');assert.equal(p.reasonBindings[0].standing,'not_explicitly_withdrawn');
  });
  await check('同文字不同正式來源不混為同一理由片段',()=>{
   const q=withdrawnText();q.plans[0].reasons[0].ref=refs[6];const p=calc(q).projection;assert.equal(p.reasonScopeReview.status,'no_overlap_detected');assert.equal(p.reasonBindings[0].ref,refs[6]);
  });
  await check('沒有提交的理由不補造；no_overlap 不能宣稱完整',()=>{
   const q=withdrawnText();q.plans[0].reasons=[];const p=calc(q).projection;assert.deepEqual(p.reasonBindings,[]);assert.equal(p.reasonScopeReview.status,'no_overlap_detected');assert.equal(p.reasonScopeReview.completeness,'not_established');
  });
  await check('新 change 的理由不回溯誤判自己的先前修改',()=>{
   const q=make();q.plans[0].orderedChanges=[changedReason()];const p=calc(q).projection;assert.equal(p.reasonBindings.length,2);
   assert.deepEqual(p.reasonScopeReview.findings.map(f=>f.reasonId),['outage']);assert.equal(p.reasonBindings[1].kind,'prioritizes');assert.equal(p.reasonBindings[1].binding.kind,'plan_change');
  });
  await check('相同正式來源但較晚才明示補入的理由，不回溯套用先前內容修改',()=>{
   const q=withdrawnText();q.plans[0].orderedChanges.push({kind:'reason',ref:refs[0],quote:bodies[0],reasons:[{id:'later',ref:refs[0],quote:reason,kind:'adds'}]});
   const p=calc(q).projection;assert.equal(p.reasonBindings[1].binding.kind,'plan_change');assert.deepEqual(p.reasonScopeReview.findings.map(f=>f.reasonId),['outage']);
   assert.equal(p.reasonBindings[1].standing,'not_explicitly_withdrawn');
  });
  await check('已綁 change 的理由遇到真正後繼內容修改，核對正確 owner 版本',()=>{
   const q=withdrawnText();q.plans[0].reasons=[];q.plans[0].orderedChanges.unshift({kind:'reason',ref:refs[0],quote:bodies[0],reasons:[{id:'earlier',ref:refs[0],quote:reason,kind:'adds'}]});
   const p=calc(q).projection,r=p.reasonScopeReview;assert.equal(r.status,'required');assert.equal(r.findings[0].reasonId,'earlier');
   assert.equal(r.findings[0].reasonBinding.kind,'plan_change');assert.equal(r.findings[0].reasonBinding.changeId,p.planChanges[0].id);
   assert.equal(r.findings[0].changeId,p.planChanges[1].id);assert.equal(r.findings[0].reasonBinding.planVersion,p.planChanges[0].planVersion);
  });
  await check('暫停保留理由待核，取消不當作仍有效的目前條件',()=>{
   for(const [index,planStatus,expected]of [[7,'paused','required'],[8,'cancelled','no_overlap_detected']]){
    const q=withdrawnText();q.plans[0].orderedChanges.push({kind:'status',ref:refs[index],quote:bodies[index],planStatus});const p=calc(q).projection;
    assert.equal(p.currentPlans[0].planStatus,planStatus);assert.equal(p.reasonScopeReview.status,expected);assert.equal(p.reasonBindings[0].standing,'not_explicitly_withdrawn');
   }
  });
  await check('純邊界：owner／basis／change 版本及正式身分都須相符',()=>{
   const p=calc(withdrawnText()).projection;
   const makeArgs=()=>({plans:{currentPlans:copy(p.currentPlans),planBasis:copy(p.planBasis),planChanges:copy(p.planChanges)},reasonBindings:copy(p.reasonBindings),reasonRelations:[],sourceIdentity:ref=>ref});
   for(const mutate of [
    x=>{x.reasonBindings[0].binding.nodeId='other';},x=>{x.reasonBindings[0].binding.basisVersion='other-version';},
    x=>{x.reasonBindings[0].evidenceHash='other-hash';},x=>{x.reasonBindings[0].ref='other-scope-same-local-id';},
    x=>{x.sourceIdentity=()=>null;},x=>{x.reasonBindings[0].citation.start+=100;x.reasonBindings[0].citation.end+=100;}
   ]){const x=makeArgs();mutate(x);assert.equal(reviewSpans(x).totalFindings,0);}
   const x=makeArgs();x.reasonBindings[0].binding={kind:'plan_change',nodeId:'index',changeId:x.plans.planChanges[0].id,priorVersion:'other',planVersion:x.plans.planChanges[0].planVersion};assert.equal(reviewSpans(x).totalFindings,0);
   // 片段重新沿同一來源保留時，較早的文字修改不能冒稱目前尚有撤回衝突。
   const restored=makeArgs();restored.plans.currentPlans[0].sourceFragments.push(copy(restored.plans.planChanges[0].parts.find(part=>part.kind==='withdraw').priorSourceFragments[0]));
   assert.equal(reviewSpans(restored).totalFindings,0);
  });
  await check('八筆上限與截斷明示，不因超量改 standing 或丟理由',()=>{
   const q=withdrawnText();q.plans[0].reasons=Array.from({length:10},(_,i)=>({id:'distinct-'+i,ref:refs[0],quote:reason}));
   const p=calc(q).projection,r=p.reasonScopeReview;assert.equal(p.reasonBindings.length,10);assert.equal(r.findings.length,8);assert.equal(r.totalFindings,10);assert.equal(r.unresolvedFindings,10);assert.equal(r.truncated,true);assert(p.reasonBindings.every(v=>v.standing==='not_explicitly_withdrawn'));
  });
  await check('v5／v6 理由 kind 錯誤回到原欄位，保留枚舉而不回顯未知內容',()=>{
   for(const version of [5,6]){const q=make();q.version=version;q.plans[0].orderedChanges=[changedReason()];
    if(version===5){q.plans[0].reason={ref:refs[0],quote:reason};delete q.plans[0].reasons;const c=q.plans[0].orderedChanges[0];c.reason={ref:refs[3],quote:priority,kind:'PRIVATE_INVALID'};delete c.reasons;}
    else q.plans[0].orderedChanges[0].reasons[0].kind='PRIVATE_INVALID';
    let error;try{calc(q);}catch(e){error=e;}assert.equal(error.code,`continuity_v${version}_reason_kind`);const c=feedback(error),issue=c.issues[0];
    assert.equal(issue.path,version===5?'$.plans[0].orderedChanges[0].reason.kind':'$.plans[0].orderedChanges[0].reasons[0].kind');assert.deepEqual(issue.allowedKinds,['adds','prioritizes','accepts_tradeoff']);
    assert(!JSON.stringify(c).includes('PRIVATE_INVALID'));assert(!JSON.stringify(c).includes(priority));outcomes.push({name:`v${version} 原位置 kind 修正`,correction:c});
   }
  });
  await check('v5／v6 錯放角色仍拒絕，精確指出行與正式角色，不替宿主重新分類',()=>{
   for(const version of [5,6]){const q=make();q.version=version;if(version===5)delete q.plans[0].reasons;
    q.suggestions=[{id:'not-decided',ref:refs[5],quote:bodies[5],topic:'資料查閱',aspect:'採用狀態',temporalUse:'current'}];
    const before=copy(q);let error;try{calc(q);}catch(e){error=e;}assert.equal(error.code,'continuity_source_role_mismatch');const c=feedback(error),issue=c.issues[0];
    assert.equal(issue.path,'$.suggestions[0]');assert.equal(issue.nodeId,'not-decided');assert.equal(issue.ref,refs[5]);assert.equal(issue.actualRole,'user');assert.equal(issue.expectedRole,'assistant');assert.equal(issue.declaredKind,'assistant_suggestion');
    assert.deepEqual(q,before);assert(!JSON.stringify(c).includes(bodies[5]));outcomes.push({name:`v${version} 正式角色修正`,correction:c});
   }
  });
  await check('正式 source／version／scope／完整閱讀仍先拒絕',()=>{
   assert.throws(()=>project({...input(withdrawnText()),scopeId:'different-scope'}),/invalid_reading_manifest/);
   const altered=copy(reading);altered.internal.manifest.sources[0].pointer.revisionId='forged';assert.throws(()=>project({...input(withdrawnText()),reading:altered}),/invalid_reading_manifest/);
   assert.throws(()=>project({...input(withdrawnText()),previousPages:pages.slice(0,-1)}),/continuity_complete_selected_reading_required/);
  });
  await check('v1–v4 非法 kind 不藉角色 correction 回顯正文或物件',()=>{
   for(const version of [1,2,3,4])for(const kind of ['PRIVATE_KIND',{PRIVATE_KIND:'PRIVATE_BODY'},'constructor']){
    const node={id:'bad-kind',ref:refs[5],quote:bodies[5],text:bodies[5],topic:'資料查閱',aspect:'採用狀態',temporalUse:'current',kind};
    if(version<4)node.relation={kind:'independent',targetNodeIds:[]};else delete node.text;
    let error;try{calc({version,nodes:[node],unknowns:[]});}catch(e){error=e;}
    assert.equal(error?.code,'continuity_source_role_mismatch');const c=feedback(error);assert.equal(c.issues[0].declaredKind,null);assert.equal(c.issues[0].expectedRole,null);
    assert(!JSON.stringify(c).includes('PRIVATE_KIND'));assert(!JSON.stringify(c).includes('PRIVATE_BODY'));assert(!JSON.stringify(c).includes(bodies[5]));
   }
  });
  await check('公開 compact 可精確還原新提示，沒有改掉原理由與原時間',()=>{
   const original=calc(withdrawnText()),publicResult=restore(JSON.parse(JSON.stringify(projectHarnessToolResult(original))));assert.deepEqual(restore(compact(original)),original);
   assert.deepEqual(publicResult.projection.reasonScopeReview,original.projection.reasonScopeReview);assert.deepEqual(publicResult.projection.reasonBindings,original.projection.reasonBindings);
  });
  await check('正式發布拒絕不覆蓋上一 ready；查看不動 Buffer 原期限與原時間',async()=>{
   const accepted=await runtime.readingContinuity({ticket:reading.reader.ticket,proposal:withdrawnText()});assert.equal(accepted.status,'ready');const hash=accepted.projectionHash;
   const q=make();q.suggestions=[{id:'wrong',ref:refs[5],quote:bodies[5],topic:'資料查閱',aspect:'採用',temporalUse:'current'}];
   await assert.rejects(runtime.readingContinuity({ticket:reading.reader.ticket,proposal:q}),error=>error.code==='continuity_source_role_mismatch'&&feedback(error)?.issues[0].path==='$.suggestions[0]');
   assert.equal((await runtime.continuityStatus()).projectionHash,hash);assert.deepEqual((await runtime.bufferList()).items,bufferBefore);assert.equal(accepted.projection.activation,'none');assert.equal(accepted.projection.proactiveEligible,false);
  });
 }finally{await runtime.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify({kind:'cmcp_reason_scope_zero_model_results',productRoot,modelCalls:0,semanticVerification:'not_performed',runtimeClosed:true,outcomes},null,2)+'\n',{flag:'wx'});}
 await t.test('正式 Bridge 公開更正保留拒絕與上一結果，不由模型取得控制',async()=>{
  const runtimeConfig=path.join(out,'runtime.json');await fs.writeFile(runtimeConfig,JSON.stringify(config),{flag:'wx'});
  const bridge=new CmcpHarnessBridge({deploymentRoot:out,runtimeConfig,traceRoot:path.join(out,'trace'),scopeId});
  try{
   const sid='synthetic-reason-scope-bridge';await bridge.begin(sid,'query','核對索引原案與修訂理由。');
   const nav=await bridge.tool(sid,'cmcp_find_history',{}),opened=await bridge.tool(sid,'cmcp_open_history',{navigationTicket:nav.ticket,selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''})});
   const pp=[];for(let i=0;i<64;i++){const p=await bridge.tool(sid,'cmcp_read_history',{ticket:opened.ticket});pp.push(p);if(p.coverage.complete)break;}assert(pp.at(-1).coverage.complete);
   const ref=i=>pp.find(p=>JSON.parse(p.modelContext).content===bodies[i]).source.ref;
   const q={version:6,plans:[{id:'index',ref:ref(0),quote:bodies[0],topic:'資料查閱',aspect:'索引方案',temporalUse:'current',reasons:[{id:'outage',ref:ref(0),quote:reason}],
    orderedChanges:[{kind:'content',ref:ref(10),quote:bodies[10],edits:[{kind:'withdraw',quote:reason}]}]}],unknowns:[]};
   const good=await bridge.tool(sid,'cmcp_project_continuity',{ticket:opened.ticket,proposalJson:JSON.stringify(q)});assert.equal(good.status,'ready');assert.equal(good.projection.reasonScopeReview.status,'required');
   const bad=copy(q);bad.suggestions=[{id:'wrong',ref:ref(5),quote:bodies[5],topic:'資料查閱',aspect:'採用狀態',temporalUse:'current'}];
   const rejected=await bridge.tool(sid,'cmcp_project_continuity',{ticket:opened.ticket,proposalJson:JSON.stringify(bad)}),publicRejection=JSON.parse(JSON.stringify(projectHarnessToolResult(rejected)));
   assert.equal(publicRejection.status,'rejected');assert.equal(publicRejection.reason,'continuity_source_role_mismatch');assert.equal(publicRejection.correction.issues[0].path,'$.suggestions[0]');assert.equal(publicRejection.correction.issues[0].actualRole,'user');
   assert(!JSON.stringify(publicRejection).includes(bodies[5]));assert.equal((await bridge.continuityStatus(sid)).projectionHash,good.projectionHash);
   const rendered=restore(JSON.parse(JSON.stringify(projectHarnessToolResult(good))));assert.deepEqual(rendered.projection.reasonScopeReview,good.projection.reasonScopeReview);
   await fs.writeFile(path.join(out,'bridge-publication.json'),JSON.stringify({layer:'正式 Bridge／Core 工具，無宿主模型',modelCalls:0,good,rejected,publicRejection,rendered},null,2)+'\n',{flag:'wx'});
  }finally{await bridge.close();}
 });
});
