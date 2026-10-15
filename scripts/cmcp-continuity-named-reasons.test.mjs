import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=p=>import(pathToFileURL(path.join(productRoot,p)));
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,getCmcpContinuityCorrection,CMCP_CONTINUITY_PROJECTION_LIMITS:limits}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {compileCmcpTypedContinuityProposal:compile}=await load('src/cmcp-guard/cmcp-continuity-typed-proposal.js');
const {createCmcpContinuityPresentation:presentation}=await load('src/cmcp-guard/cmcp-continuity-presentation.js');
const {projectContinuityModelView:compact,restoreContinuityModelView:restore}=await load('adapters/continuity-model-view.mjs');
const {CmcpHarnessBridge,projectHarnessToolResult}=await load('adapters/deepseek-harness/runtime-bridge.mjs');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');
const prior=process.env.CMCP_TEST_REFERENCE_ROOT?(await import(pathToFileURL(path.join(process.env.CMCP_TEST_REFERENCE_ROOT,'src/cmcp-guard/cmcp-continuity-projection.js')))).projectCmcpReadingContinuity:null;
const copy=structuredClone;

// 驗正式支持與理由個別效力；合法結構不等於模型已正確判讀自然語意。
test('v6 同一計畫多個具名理由，明示撤回與舊版責任相容',async t=>{
 const parent=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-named-reasons');await fs.mkdir(parent,{recursive:true});
 const out=await fs.mkdtemp(path.join(parent,'formal-')),scopeId='synthetic-named-reasons',now='2026-10-10T07:00:00.000Z',timezone='Asia/Taipei';
 const reason1='原因一是避免網路中斷時無法取用',reason2='原因二是避免既有備份被誤改';
 const bodies=[
  '我計畫把資料保留為一份離線唯讀備份，放在檔案櫃。'+reason1+'；'+reason2+'。',
  '現在只撤回避免網路中斷這項理由，避免誤改的顧慮仍在，其他條件維持。',
  '補充先前同一個決定的理由：保留查核時可逐筆比對的依據。',
  '這次增加避免重做的考量，並優先讓交接更方便；沒有更改備份的位置與狀態。',
  '現在撤回避免重做這項理由，沒有撤回交接的優先。',
  '先暫停備份計畫，既有草稿仍保留。',
  '我建議做兩份備份，這只是建議，不是使用者決定。',
  '備份改放在保管箱，其他條件維持。',
  '另外計畫整理工具盒，理由是減少找工具的時間。'
 ];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-named-reasons',providerMode:'host',input:{root:path.join(out,'state'),scopeId,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:14000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:14000},storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-named-reasons-session',hostProvider:{request:async()=>{throw Error('本測試禁止模型');}}});
 const outcomes=[];
 try{
  for(const [i,text]of bodies.entries())await runtime.ingest({role:i===6?'assistant':'user',text,timeContext:{now:new Date(Date.parse(now)-1200000+i*60000).toISOString(),timezone}});
  const nav=await runtime.readingNavigate({text:'核對同一份備份決定的原理由、新增理由、撤回與保留。'});
  const reading=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:32768}});
  const pages=[];for(let i=0;i<64;i++){const p=await runtime.readingPage({ticket:reading.reader.ticket,project:true});pages.push(p);if(p.reader.coverage.complete)break;}
  assert(pages.at(-1).reader.coverage.complete);const refs=bodies.map(body=>pages.find(p=>p.reader.text===body).reader.source.ref);
  const plan={id:'backup',ref:refs[0],quote:bodies[0],topic:'資料保護',aspect:'同一份備份',temporalUse:'current',reasons:[{id:'network',ref:refs[0],quote:reason1},{id:'misedit',ref:refs[0],quote:reason2}]};
  const withdrawal={ref:refs[1],quote:'現在只撤回避免網路中斷這項理由',temporalUse:'current',targetReasonId:'network'};
  const change={kind:'reason',ref:refs[3],quote:bodies[3],reasons:[{id:'redo',ref:refs[3],quote:'增加避免重做的考量',kind:'adds'},{id:'handover',ref:refs[3],quote:'優先讓交接更方便',kind:'prioritizes'}]};
  const build=(extra={})=>({version:6,plans:[{...copy(plan),reasonWithdrawals:[copy(withdrawal)]}],unknowns:[],...copy(extra)});
  const input=proposal=>({reading,previousPages:pages,scopeId,proposal,timeContext:{now,timezone}}),calc=q=>project(input(q));
  const plain=(q,custom=limits)=>compile(q,{limits:custom});
  const before={reading:copy(reading),pages:copy(pages),buffer:(await runtime.bufferList()).items};
  const check=async(name,fn)=>t.test(name,async()=>{try{await fn();outcomes.push({name,status:'PASS'});}catch(e){outcomes.push({name,status:'FAIL',error:e.message});throw e;}});
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({bodies,refs,reading,pages},null,2)+'\n',{flag:'wx'});
  await check('多理由不拆計畫、不生成另一條決策線，只撤具名理由',()=>{
   const q=build(),original=copy(q),c=plain(q),r=calc(q),p=r.projection;
   assert.deepEqual(q,original);assert.equal(r.inputVersion,6);assert.equal(c.proposal.nodes.filter(n=>n.planRole!=='evidence').length,1);
   assert.equal(p.currentPlans.length,1);assert.equal(p.planChanges.length,0);assert.equal(p.reasonBindings.length,2);assert.equal(p.reasons.length,0);
   assert.deepEqual(p.reasonBindings.map(v=>v.standing),['withdrawn_by_explicit_user_source','not_explicitly_withdrawn']);
   assert.equal(p.reasonCoverage.bindingReasonsProvided,2);assert.equal(p.planBasis[0].reasonStatus,'provided_by_binding');
   for(const row of p.reasonBindings){assert.equal(row.binding.nodeId,'backup');assert.equal(row.binding.basisVersion,p.planBasis[0].baseVersion);assert.match(row.reasonVersion,/^[a-f0-9]{64}$/);}
   const a=r.presentation.plans[0].annotations;assert.equal(a.length,1);assert.equal(a[0].range.text,reason1);assert.deepEqual(a[0].reason,{collection:'reasonBindings',index:0,reasonId:'network'});
   assert.deepEqual(p.planEvidence[0].uses[0].targetReasonIds,['network']);assert.equal(p.planEvidence[0].uses[0].targetNodeId,'backup');
   outcomes.push({name:'完整具名理由結果',result:r});
  });
  await check('同計畫跨正式原件補充理由，不偽造成新增計畫或修改時間',()=>{
   const q=build();q.plans[0].reasons.push({id:'audit',ref:refs[2],quote:'保留查核時可逐筆比對的依據'});
   const p=calc(q).projection;assert.equal(p.currentPlans.length,1);assert.equal(p.planChanges.length,0);assert.equal(p.reasonBindings.length,3);
   assert.equal(p.reasonBindings[2].messageRecordedAt,reading.internal.manifest.sources.find(s=>s.ref===refs[2]).messageRecordedAt);
   assert.notEqual(p.reasonBindings[2].messageRecordedAt,p.reasonBindings[0].messageRecordedAt);assert.equal(p.reasonBindings[2].binding.basisVersion,p.planBasis[0].baseVersion);
  });
  await check('同一明示變更多理由可分別撤回，原基底理由不被連帶撤回',()=>{
   const q=build();q.plans[0].orderedChanges=[copy(change)];q.plans[0].reasonWithdrawals=[{ref:refs[4],quote:'現在撤回避免重做這項理由',temporalUse:'current',targetReasonId:'redo'}];
   const r=calc(q),p=r.projection;assert.equal(p.planChanges.length,1);assert.equal(p.planChanges[0].reason,null);assert.equal(p.planChanges[0].reasonStatus,'provided_by_binding');
   assert.deepEqual(p.reasonBindings.map(v=>v.standing),['not_explicitly_withdrawn','not_explicitly_withdrawn','withdrawn_by_explicit_user_source','not_explicitly_withdrawn']);
   for(const b of p.reasonBindings.slice(2)){assert.equal(b.binding.kind,'plan_change');assert.equal(b.binding.changeId,p.planChanges[0].id);assert.equal(b.binding.planVersion,p.planChanges[0].planVersion);}
   assert.equal(p.currentPlans[0].text,bodies[0]);assert.equal(p.currentPlans[0].planStatus,'planned');
   assert.deepEqual(p.planEvidence[0].uses[0].targetReasonIds,['redo']);assert.equal(p.planEvidence[0].targetNodeIds[0],'backup');
   outcomes.push({name:'明示變更的理由結果',result:r});
  });
  await check('局部修改、暫停與保留不自動撤理由，版本與證據 owner 保持',()=>{
   const q=build();q.plans[0].orderedChanges=[{kind:'content',ref:refs[7],quote:bodies[7],edits:[{kind:'replace',quote:'檔案櫃',replacement:{ref:refs[7],quote:'保管箱'}}]},{kind:'status',ref:refs[5],quote:bodies[5],planStatus:'paused'}];
   q.plans[0].retentions=[{ref:refs[7],quote:'其他條件維持',temporalUse:'current'}];
   const p=calc(q).projection;assert.equal(p.currentPlans[0].planStatus,'paused');assert(p.currentPlans[0].text.includes('保管箱'));assert(p.currentPlans[0].text.includes(reason2));
   assert.notEqual(p.reasonBindings[0].binding.basisVersion,p.currentPlans[0].planVersion);assert.equal(p.reasonBindings[1].standing,'not_explicitly_withdrawn');
  });
  await check('v6 理由 ID 全提案唯一，具名目標限同計畫既有理由',()=>{
   const q=build();q.plans[0].reasons.push(copy(q.plans[0].reasons[0]));assert.throws(()=>plain(q),/continuity_v6_reason_id_collision/);
   const cross=build();cross.plans.push({id:'tools',ref:refs[8],quote:bodies[8],topic:'其他工作',aspect:'工具盒',temporalUse:'current',reasons:[{id:'tools-reason',ref:refs[8],quote:'減少找工具的時間'}]});cross.plans[0].reasonWithdrawals[0].targetReasonId='tools-reason';assert.throws(()=>plain(cross),/continuity_v6_reason_withdrawal_target/);
   const changed=build();changed.plans[0].orderedChanges=[copy(change)];changed.plans[0].orderedChanges[0].reasons[0].id='network';assert.throws(()=>plain(changed),/continuity_v6_reason_id_collision/);
   const absent=build();absent.plans[0].reasonWithdrawals[0].targetReasonId='absent';assert.throws(()=>plain(absent),/continuity_v6_reason_withdrawal_target/);
  });
  await check('來源角色、來源完整、change 理由同原句來源仍須正式核對',()=>{
   const q=build();q.plans[0].reasons[0]={id:'network',ref:refs[6],quote:bodies[6]};assert.throws(()=>calc(q),/continuity_user_reason_requires_user_source/);
   const absent=build();absent.plans[0].reasons[0].ref='missing';assert.throws(()=>calc(absent),/continuity_source_outside_reading/);
   const changed=build();changed.plans[0].orderedChanges=[copy(change)];changed.plans[0].orderedChanges[0].reasons[0].ref=refs[0];changed.plans[0].orderedChanges[0].reasons[0].quote=reason1;assert.throws(()=>calc(changed),/continuity_plan_change_reason_source_mismatch/);
   assert.throws(()=>project({...input(build()),previousPages:pages.slice(0,-1)}),/continuity_complete_selected_reading_required/);
   assert.throws(()=>project({...input(build()),scopeId:'other'}),/invalid_reading_manifest/);
   const altered=copy(reading);altered.internal.manifest.sources[0].pointer.revisionId='new-version';assert.throws(()=>project({...input(build()),reading:altered}),/invalid_reading_manifest/);
  });
  await check('兩端同一正式支持仍拒絕，correction 指明理由與 owner 而不回顯正文',()=>{
   for(const useChange of [false,true]){
    const q=build();if(useChange)q.plans[0].orderedChanges=[copy(change)];const target=useChange?change.reasons[0]:plan.reasons[0];
    q.plans[0].reasonWithdrawals=[{ref:target.ref,quote:target.quote,temporalUse:'current',targetReasonId:target.id}];
    let error;try{calc(q);}catch(e){error=e;}assert.equal(error.code,'continuity_reason_distinct_support_required');const correction=getCmcpContinuityCorrection(error);
    assert.equal(correction.issues[0].targetReasonId,target.id);assert.equal(correction.issues[0].targetNodeId,'backup');assert.deepEqual(correction.issues[0].targetReason,correction.issues[0].withdrawal);assert(!JSON.stringify(correction).includes(target.quote));
   }
  });
  await check('新輸入不能夾帶舊單值、執行權或偽造版本；compiled v3 不能直入免驗',()=>{
   const q=build();q.plans[0].reason={ref:refs[0],quote:reason1};assert.throws(()=>calc(q),/continuity_v6_shape/);
   for(const patch of [{basisVersion:'fake'},{enabled:true},{role:'user'},{messageRecordedAt:now}]){const v=build();Object.assign(v.plans[0].reasons[0],patch);assert.throws(()=>calc(v),/continuity_v6_shape/);}
   assert.throws(()=>calc(plain(build()).proposal),/invalid_continuity_proposal_shape/);
   const empty=build();empty.plans[0].orderedChanges=[{kind:'reason',ref:refs[3],quote:bodies[3],reasons:[]}];assert.throws(()=>calc(empty),/continuity_plan_change_reason_required/);
  });
  await check('理由總量、文字、封套上限沿原有界容量，未知不能自動填理由',()=>{
   const q=build();q.plans[0].reasons=Array.from({length:25},(_,i)=>({id:'r'+i,ref:refs[0],quote:reason1}));assert.throws(()=>plain(q),/continuity_v6_limit/);
   const total=build();total.plans[0].reasons=Array.from({length:13},(_,i)=>({id:'b'+i,ref:refs[0],quote:reason1}));total.plans[0].orderedChanges=[{...change,reasons:Array.from({length:12},(_,i)=>({id:'c'+i,ref:refs[3],quote:'增加避免重做的考量'}))}];total.plans[0].reasonWithdrawals=[];assert.throws(()=>plain(total),/continuity_proposal_limit/);
   assert.throws(()=>plain(build(),{...limits,maxProposalBytes:64}),/continuity_proposal_limit/);
   const noReasons=build({plans:[{...plan,reasons:[],reasonWithdrawals:[]}],unknowns:['是否有其他理由未知']});assert.equal(calc(noReasons).projection.reasonBindings.length,0);
  });
  await check('compact 與 Harness 真序列化精確還原，新理由不誤併或漏列',()=>{
   const q=build();q.plans[0].orderedChanges=[copy(change)];const original=calc(q),model=compact(original),rendered=JSON.parse(JSON.stringify(projectHarnessToolResult(original)));
   assert.deepEqual(restore(model),original);const publicResult=restore(rendered);assert.equal(publicResult.projectionHash,original.projectionHash);assert.deepEqual(publicResult.projection.reasonBindings,original.projection.reasonBindings);
   assert.equal(publicResult.projection.reasonBindings.length,4);assert.equal(new Set(publicResult.projection.reasonBindings.map(r=>r.reasonVersion)).size,4);
  });
  await check('呈現附註核 basis／change 版本與具名關係，不把相鄰理由一併撤回',()=>{
   const good=calc(build());for(const patch of ['version','relation']){const p=copy(good.projection);if(patch==='version')p.reasonBindings[0].binding.basisVersion='fake';else p.reasonRelations[0].targetReasonIds=['misedit'];
    assert.throws(()=>presentation({projection:p,projectionHash:loopHash(p),scopeId,verifiedScopeId:scopeId}),/continuity_presentation_(basis_version_mismatch|withdrawal_relationship_missing)/);}
  });
  await check('v1–v5 合法原輸出逐物件對照凍結 c24，無新增理由欄位',()=>{
   const basic={id:'old',ref:refs[0],quote:bodies[0],text:bodies[0],kind:'user_intent',temporalUse:'current',topic:'資料保護',aspect:'備份',relation:{kind:'independent',targetNodeIds:[]},reason:{ref:refs[0],quote:reason2}};
   for(const version of [1,2,3,4,5]){let q;if(version<4)q={version,nodes:[copy(basic)],unknowns:[]};else if(version===4){const {text,relation,...n}=basic;q={version,nodes:[n],unknowns:[]};}else{const {kind,text,relation,...n}=basic;q={version,plans:[n],unknowns:[]};}
    const r=calc(q);assert(!Object.hasOwn(r.projection,'reasonBindings'));if(prior)assert.deepEqual(r,prior(input(q)));}
  });
  await check('正式 Runtime 保存新投影與來源連結，錯綁拒絕不覆蓋上一結果',async()=>{
   const q=build(),good=await runtime.readingContinuity({ticket:reading.reader.ticket,proposal:q});assert.equal(good.status,'ready');const state=await runtime.continuityStatus();assert.equal(state.projectionHash,good.projectionHash);
   for(const r of good.projection.reasonBindings)assert(state.sourceLinks.some(link=>link.ref===r.ref));
   const bad=build();bad.plans[0].reasonWithdrawals[0]={...withdrawal,ref:refs[0],quote:reason1};await assert.rejects(runtime.readingContinuity({ticket:reading.reader.ticket,proposal:bad}),/continuity_reason_distinct_support_required/);
   assert.equal((await runtime.continuityStatus()).projectionHash,good.projectionHash);assert.deepEqual((await runtime.bufferList()).items,before.buffer);assert.deepEqual(reading,before.reading);assert.deepEqual(pages,before.pages);
   assert.equal(good.projection.validation.executionAuthority,'none');assert.equal(good.projection.activation,'none');assert.equal(good.projection.proactiveEligible,false);
   await fs.writeFile(path.join(out,'runtime-publication.json'),JSON.stringify({good,state},null,2)+'\n',{flag:'wx'});
  });
  await check('撤權、OFF、Clean 不因 v6 恢復來源或保留假 ready',async()=>{
   await runtime.revokeReading({ticket:reading.reader.ticket,reason:'caller_revoked'});assert.equal((await runtime.continuityStatus()).projection,null);
   await runtime.configureControls({updateId:'named-off',patch:{enabled:false},persist:false});assert.equal((await runtime.readingContinuity({ticket:reading.reader.ticket,proposal:build()})).status,'disabled');
   await runtime.configureControls({updateId:'named-clean',patch:{enabled:true,clean:true},persist:false});assert.equal((await runtime.continuityStatus()).projection,null);
   assert.deepEqual((await runtime.bufferList()).items,before.buffer);
  });
 }finally{await runtime.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify({kind:'cmcp_named_reasons_zero_model_results',productRoot,modelCalls:0,semanticVerification:'not_performed',runtimeClosed:true,outcomes},null,2)+'\n',{flag:'wx'});}
 await t.test('Bridge 正式工具與狀態讀回保留具名理由、來源入口及可修正拒絕',async()=>{
  const runtimeConfig=path.join(out,'runtime.json');await fs.writeFile(runtimeConfig,JSON.stringify(config),{flag:'wx'});
  const bridge=new CmcpHarnessBridge({deploymentRoot:out,runtimeConfig,traceRoot:path.join(out,'trace'),scopeId});
  try{
   const sid='synthetic-named-reasons-bridge';await bridge.begin(sid,'query','核對同一個備份計畫的兩項原理由與具名撤回。');
   const nav=await bridge.tool(sid,'cmcp_find_history',{}),opened=await bridge.tool(sid,'cmcp_open_history',{navigationTicket:nav.ticket,selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''})});
   const pages=[];for(let i=0;i<64;i++){const page=await bridge.tool(sid,'cmcp_read_history',{ticket:opened.ticket});pages.push(page);if(page.coverage.complete)break;}assert(pages.at(-1).coverage.complete);
   const ref=text=>pages.find(page=>JSON.parse(page.modelContext).content===text).source.ref;
   const q={version:6,plans:[{id:'backup',ref:ref(bodies[0]),quote:bodies[0],topic:'資料保護',aspect:'同一份備份',temporalUse:'current',
    reasons:[{id:'network',ref:ref(bodies[0]),quote:reason1},{id:'misedit',ref:ref(bodies[0]),quote:reason2},{id:'audit',ref:ref(bodies[2]),quote:'保留查核時可逐筆比對的依據'}],
    reasonWithdrawals:[{ref:ref(bodies[1]),quote:'現在只撤回避免網路中斷這項理由',temporalUse:'current',targetReasonId:'network'}]}],unknowns:[]};
   const accepted=await bridge.tool(sid,'cmcp_project_continuity',{ticket:opened.ticket,proposalJson:JSON.stringify(q)});assert.equal(accepted.status,'ready');
   const rendered=restore(JSON.parse(JSON.stringify(projectHarnessToolResult(accepted))));assert.deepEqual(rendered.projection.reasonBindings,accepted.projection.reasonBindings);
   const state=await bridge.continuityStatus(sid);assert.equal(state.projectionHash,accepted.projectionHash);
   for(const reason of accepted.projection.reasonBindings)assert(state.sourceLinks.some(link=>link.ref===reason.ref));
   const wrong=copy(q);wrong.plans[0].reasonWithdrawals[0]={...wrong.plans[0].reasonWithdrawals[0],ref:ref(bodies[0]),quote:reason1};
   const rejected=await bridge.tool(sid,'cmcp_project_continuity',{ticket:opened.ticket,proposalJson:JSON.stringify(wrong)}),publicRejection=JSON.parse(JSON.stringify(projectHarnessToolResult(rejected)));
   assert.equal(publicRejection.status,'rejected');assert.equal(publicRejection.reason,'continuity_reason_distinct_support_required');assert.equal(publicRejection.correction.issues[0].targetReasonId,'network');
   assert.equal(publicRejection.correction.issues[0].targetNodeId,'backup');assert(!JSON.stringify(publicRejection).includes(reason1));assert.equal((await bridge.continuityStatus(sid)).projectionHash,accepted.projectionHash);
   await fs.writeFile(path.join(out,'bridge-publication.json'),JSON.stringify({layer:'正式 Bridge／Core 工具，無宿主模型',q,accepted,rendered,state,rejected,publicRejection,modelCalls:0},null,2)+'\n',{flag:'wx'});
  }finally{await bridge.close();}
 });
});
