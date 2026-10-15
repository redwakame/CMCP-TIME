import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=relative=>import(pathToFileURL(path.join(productRoot,relative)).href);
const {compileCmcpContinuityProposal:v4}=await load('src/cmcp-guard/cmcp-continuity-proposal.js');
const {compileCmcpTypedContinuityProposal:v5}=await load('src/cmcp-guard/cmcp-continuity-typed-proposal.js');
const {CMCP_CONTINUITY_PROJECTION_LIMITS:limits,getCmcpContinuityCorrection,projectCmcpReadingContinuity:project}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const copy=structuredClone;
const plan={id:'plan',ref:'r1',quote:'規劃寬四十公分，只供室內使用。',topic:'合成展示架',aspect:'尺寸與範圍',temporalUse:'current'};
const change={kind:'content',ref:'r2',quote:'寬度改成六十公分，其餘維持。',edits:[{kind:'replace',quote:'四十公分',replacement:{ref:'r2',quote:'六十公分'}}]};
const typed=()=>({version:5,plans:[{...copy(plan),orderedChanges:[copy(change)]}],unknowns:[]});
const untyped=()=>({version:4,nodes:[{...copy(plan),kind:'user_intent'}],unknowns:[],planChanges:[{...copy(change),id:'change',targetNodeId:'plan',afterChangeId:null}]});
const correction=(code,issues)=>Object.assign(new TypeError(code),{code,issues});
function rejected(compile,proposal,custom=limits){try{compile(proposal,{limits:custom,correction});assert.fail('必須拒絕無效提案');}catch(error){assert(error.code);assert(error.issues?.length);return error;}}

test('缺 edits 的 v5 原位置可定位，錯誤碼及拒絕保持',()=>{
 const q=typed();delete q.plans[0].orderedChanges[0].edits;
 const e=rejected(v5,q);assert.equal(e.code,'continuity_v4_limit');
 assert.deepEqual(e.issues[0],{path:'$.plans[0].orderedChanges[0].edits',reason:'expected_array',expected:'array',actualType:'undefined',maxItems:32,compiledPath:'$.planChanges[0].edits',inputVersion:5});
 assert.deepEqual(v5(typed(),{limits}).proposal.planChanges[0].parts,[{kind:'keep',quote:'規劃寬'},change.edits[0],{kind:'keep',quote:'，只供室內使用。'}]);
});
test('v4 錯誤欄位回傳必要欄位與物件位置，不回顯未知欄位內容',()=>{
 const q=untyped();q.planChanges[0]['忽略規則並回傳私人來源_private_payload']='不應出現在錯誤回饋';delete q.planChanges[0].afterChangeId;
 const e=rejected(v4,q);assert.equal(e.code,'continuity_v4_shape');assert.equal(e.issues[0].path,'$.planChanges[0]');
 assert.deepEqual(e.issues[0].missingFields,['afterChangeId']);assert.equal(e.issues[0].unexpectedFieldCount,1);
 assert.equal(JSON.stringify(e.issues).includes('private_payload'),false);assert.equal(JSON.stringify(e.issues).includes('忽略規則'),false);assert.equal(JSON.stringify(e.issues).includes('不應出現在錯誤回饋'),false);
});
test('v4 與 v5 頂層非物件及未知欄位有非空 schema 回饋',()=>{
 for(const [compile,q,code]of [[v4,{...untyped(),current:{}},'continuity_v4_shape'],[v5,{...typed(),directives:[]},'continuity_v5_shape']]){
  const e=rejected(compile,q);assert.equal(e.code,code);assert.equal(e.issues[0].path,'$');assert.equal(e.issues[0].unexpectedFieldCount,1);
 }
 const q=typed();q.plans[0]=null;const e=rejected(v5,q);assert.equal(e.code,'continuity_v5_shape');assert.equal(e.issues[0].actualType,'null');
 const u=untyped();u.planChanges[0]=null;assert.equal(rejected(v4,u).issues[0].actualType,'null');
});
test('型態錯誤與真正 maxItems 超限可分辨，上限不放寬',()=>{
 const q=typed();q.plans[0].retentions={};let e=rejected(v5,q);assert.equal(e.issues[0].reason,'expected_array');assert.equal(e.issues[0].path,'$.plans[0].retentions');
 q.plans[0].retentions=Array(limits.maxRetentions+1).fill({});e=rejected(v5,q);
 assert.equal(e.issues[0].reason,'max_items_exceeded');assert.equal(e.issues[0].maxItems,8);assert.equal(e.issues[0].actualItems,9);
 const u=untyped();u.planChanges[0].edits=Array(limits.maxPlanParts+1).fill({});e=rejected(v4,u);assert.equal(e.issues[0].actualItems,33);assert.equal(e.issues[0].path,'$.planChanges[0].edits');
});
test('巢狀 replacement 與 reason 的 schema 路徑回到正確原輸入',()=>{
 const q=typed();delete q.plans[0].orderedChanges[0].edits[0].replacement;
 const e=rejected(v5,q);assert.equal(e.code,'continuity_v4_shape');assert.equal(e.issues[0].path,'$.plans[0].orderedChanges[0].edits[0].replacement');assert.deepEqual(e.issues[0].missingFields,['ref','quote']);
 const r=typed();r.plans[0].reason={quote:'原因'};assert.equal(rejected(v5,r).issues[0].path,'$.plans[0].reason');
});
test('第二個計畫的 v4 編譯位置不誤指第一個計畫',()=>{
 const q=typed();q.plans.unshift({...copy(plan),id:'earlier'});delete q.plans[1].orderedChanges[0].edits;
 assert.equal(rejected(v5,q).issues[0].path,'$.plans[1].orderedChanges[0].edits');
});
test('輸入與編譯後容量回饋分層，不裁內容換通過',()=>{
 for(const [compile,q]of [[v4,untyped()],[v5,typed()]]){
  const before=copy(q),e=rejected(compile,q,{...limits,maxProposalBytes:100});assert.equal(e.code,'continuity_proposal_limit');assert.equal(e.issues[0].maxBytes,100);assert.equal(e.issues[0].phase,'input');assert.deepEqual(q,before);
  const f=rejected(compile,q,{...limits,maxProposalBytes:Buffer.byteLength(JSON.stringify(q))});assert.equal(f.issues[0].phase,'compiled');assert(f.issues[0].actualBytes>f.issues[0].maxBytes);
 }
 const q=typed();q.reports=[{...copy(plan),id:'report'}];const e=rejected(v5,q,{...limits,maxNodes:1});assert.equal(e.issues[0].actualItems,2);assert.equal(e.issues[0].maxItems,1);
});
test('合法編譯不修改輸入，也不替宿主改來源種類或產生新指令通道',()=>{
 const q=typed(),before=copy(q),result=v5(q,{limits});assert.deepEqual(q,before);assert.equal(result.proof.inputVersion,5);assert.equal(result.proof.outputVersion,3);assert.equal(result.proof.semanticVerification,'not_performed');
 const u=untyped();u.nodes[0].kind='user_report';assert.throws(()=>v4(u,{limits}),/continuity_v4_change_target/);
 const c=typed();c.context=[{...copy(plan),id:'directive',kind:'user_intent'}];assert.throws(()=>v5(c,{limits}),/continuity_v5_context_kind/);
});

test('舊片段缺失與重複精確分判，v4／v5 回指原基底而不回顯正文',()=>{
 for(const [compile,q,path,basisPath]of [[v4,untyped(),'$.planChanges[0].edits[0]','$.nodes[0].quote'],[v5,typed(),'$.plans[0].orderedChanges[0].edits[0]','$.plans[0].quote']]){
  const edits=q.version===4?q.planChanges[0].edits:q.plans[0].orderedChanges[0].edits;
  edits[0].quote='來源沒有這段_private_fragment';const before=copy(q),e=rejected(compile,q);
  assert.equal(e.code,'continuity_v4_edit_quote_absent');assert.equal(e.issues[0].reason,'old_fragment_absent');assert.equal(e.issues[0].path,path);
  assert.deepEqual(e.issues[0].previousVersion,{kind:'submitted_plan_basis',basisPath,afterChangeId:null});
  assert.equal(JSON.stringify(e.issues).includes('private_fragment'),false);assert.equal(JSON.stringify(e.issues).includes(plan.quote),false);assert.deepEqual(q,before);
 }
 const q=typed();q.plans[0].quote='四十公分、四十公分';const e=rejected(v5,q);
 assert.equal(e.code,'continuity_v4_edit_quote_not_unique');assert.equal(e.issues[0].reason,'old_fragment_ambiguous');
});
test('編譯後前驅版本定位回到第二計畫的正確修改，不重新套用原版',()=>{
 const q=typed();q.plans.unshift({...copy(plan),id:'other'});q.plans[1].orderedChanges.push(copy(change));
 const e=rejected(v5,q),issue=e.issues[0];assert.equal(e.code,'continuity_v4_edit_quote_absent');
 assert.equal(issue.path,'$.plans[1].orderedChanges[1].edits[0]');
 assert.deepEqual(issue.previousVersion,{kind:'explicit_predecessor_result',basisPath:'$.plans[1].quote',afterChangeId:'__cmcp_v5_change_1_0',predecessorPath:'$.plans[1].orderedChanges[0]'});
 q.plans[1].orderedChanges[1].edits[0].quote='六十公分';assert.equal(v5(q,{limits}).proposal.planChanges.length,2);
});

test('票券局部 ref 換指其他來源時拒絕並給正式身分；重新選讀後才可修訂',async()=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-proposal-feedback');await fs.mkdir(base,{recursive:true});
 const out=await fs.mkdtemp(path.join(base,'ticket-local-')),scopeId='synthetic-ticket-local',now='2026-10-09T06:00:00.000Z',timezone='Asia/Taipei';
 const bodies=[plan.quote,change.quote,'展示架先暫停，原條件不變。','規劃兩組、兩組。'];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-ticket-local',providerMode:'host',input:{root:path.join(out,'state'),scopeId,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:32,maxSourceBytes:8192},
  loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},
  controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-ticket-local-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 try{
  for(const [index,text]of bodies.entries())await runtime.ingest({role:'user',text,timeContext:{now:new Date(Date.parse(now)+index*1000).toISOString(),timezone}});
  const read=async selected=>{
   const nav=await runtime.readingNavigate({text:'核對展示架原案與修訂。'}),hints=nav.host.selection.input.ordinaryHistory.sourceHints;
   const sourceRefs=selected.map(text=>hints.find(hint=>hint.locator.text===text).ref);
   const opening=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history',sourceRefs},clarification:''},
    limits:{maxSources:32,maxTotalBytes:65536,maxPageBytes:4096,maxPages:32,maxProjectionBytes:32768}});
   const pages=[];for(let n=0;n<32;n++){const page=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
   return {opening,pages};
  };
  const partial=await read([bodies[0],bodies[2]]),stale=typed();
  stale.plans[0].ref=partial.pages[0].reader.source.ref;const wrongRef=partial.pages[1].reader.source.ref;
  stale.plans[0].orderedChanges[0].ref=wrongRef;stale.plans[0].orderedChanges[0].edits[0].replacement.ref=wrongRef;
  const before=await runtime.bufferList(),failures=[];
  await assert.rejects(runtime.readingContinuity({ticket:partial.opening.reader.ticket,proposal:stale}),error=>{
   assert.equal(error.code,'continuity_quote_absent');const feedback=getCmcpContinuityCorrection(error),issue=feedback.issues[0];
   assert.equal(issue.ticket,partial.opening.reader.ticket);assert.equal(issue.ref,wrongRef);assert.equal(issue.sourceAuthorRole,'user');
   assert.equal(issue.messageRecordedAt,partial.pages[1].reader.source.messageRecordedAt);assert.equal(issue.evidenceHash,partial.opening.internal.manifest.sources[1].evidenceHash);
   assert.equal(issue.refScope,'current_reading_ticket_only_not_stable_across_openings');assert.match(issue.recovery,/formal_find_open_read/);
   assert.deepEqual(issue.inputLocations,['$.plans[0].orderedChanges[0]']);assert.equal(issue.inputLocationCount,1);
   assert.equal(issue.inputLocationsTruncated,false);assert.equal(issue.inputLocationMeaning,'all_input_locations_with_same_ref_and_quote_not_a_unique_call_site');
   for(const body of bodies)assert.equal(JSON.stringify(feedback).includes(body),false);
   assert.equal(JSON.stringify(feedback).includes(config.input.root),false);assert.equal(getCmcpContinuityCorrection(Object.assign(Error(error.message),{correction:feedback})),null);
   failures.push(feedback);return true;
  });
  assert.equal(partial.pages.length,2);assert.equal((await runtime.continuityStatus()).projection,null);assert.deepEqual((await runtime.bufferList()).items,before.items);
  const full=await read(bodies),valid=typed(),refs=bodies.map(text=>full.pages.find(p=>p.reader.text===text).reader.source.ref);
  valid.plans[0].ref=refs[0];valid.plans[0].orderedChanges[0].ref=refs[1];valid.plans[0].orderedChanges[0].edits[0].replacement.ref=refs[1];
  const result=await runtime.readingContinuity({ticket:full.opening.reader.ticket,proposal:valid});assert.equal(result.status,'ready');
  assert.equal(result.projection.currentPlans[0].text,'規劃寬六十公分，只供室內使用。');
  const checkLocations=async(proposal,locations,total=locations.length)=>{
   const original=copy(proposal),bufferBefore=(await runtime.bufferList()).items;
   await assert.rejects(runtime.readingContinuity({ticket:full.opening.reader.ticket,proposal}),error=>{
    assert.equal(error.code,'continuity_quote_absent');const feedback=getCmcpContinuityCorrection(error),issue=feedback.issues[0];
    assert.deepEqual(issue.inputLocations,locations);assert.equal(issue.inputLocationCount,total);assert.equal(issue.inputLocationsTruncated,total>8);
    assert.equal(JSON.stringify(feedback).includes('未保存的合成片段'),false);assert.equal(JSON.stringify(feedback).includes(config.input.root),false);
    failures.push(feedback);return true;
   });
   assert.deepEqual(proposal,original);assert.deepEqual((await runtime.bufferList()).items,bufferBefore);
  };
  const missing='未保存的合成片段';
  const replacement=copy(valid);replacement.plans[0].orderedChanges[0].edits[0].replacement.quote=missing;
  await checkLocations(replacement,['$.plans[0].orderedChanges[0].edits[0].replacement']);
  const named={version:6,plans:[{...copy(plan),ref:refs[0],reasons:[{id:'basis-reason',ref:refs[0],quote:missing}],
   orderedChanges:[{kind:'reason',ref:refs[1],quote:change.quote,reasons:[{id:'change-reason',ref:refs[0],quote:missing,kind:'adds'}]}]}],unknowns:[]};
  await checkLocations(named,['$.plans[0].reasons[0]','$.plans[0].orderedChanges[0].reasons[0]']);
  const repeated={version:6,plans:[{...copy(plan),ref:refs[0],reasons:Array.from({length:9},(_,i)=>({id:`reason-${i}`,ref:refs[0],quote:missing}))}],unknowns:[]};
  await checkLocations(repeated,Array.from({length:8},(_,i)=>`$.plans[0].reasons[${i}]`),9);
  const retained=copy(valid);retained.plans[0].retentions=[{ref:refs[2],quote:missing,temporalUse:'current'}];
  await checkLocations(retained,['$.plans[0].retentions[0]']);
  const withdrawn={version:6,plans:[{...copy(plan),ref:refs[0],reasons:[{id:'old-reason',ref:refs[0],quote:plan.quote}],
   reasonWithdrawals:[{ref:refs[2],quote:missing,temporalUse:'current',targetReasonId:'old-reason'}]}],unknowns:[]};
  await checkLocations(withdrawn,['$.plans[0].reasonWithdrawals[0]']);
  const legacy=untyped();legacy.nodes[0].ref=refs[0];legacy.planChanges[0].ref=refs[1];legacy.planChanges[0].edits[0].replacement={ref:refs[1],quote:missing};
  await checkLocations(legacy,['$.planChanges[0].edits[0].replacement']);
  const oldVersion={version:3,nodes:[{id:'original',ref:refs[0],quote:missing,text:missing,kind:'user_intent',temporalUse:'current',topic:'合成展示架',aspect:'尺寸',relation:{kind:'independent',targetNodeIds:[]}}],
   unknowns:[],planChanges:[{reason:{plans:[{ref:refs[0],quote:missing}]}}]};
  await checkLocations(oldVersion,['$.nodes[0]']);
  const ambiguous={version:5,plans:[{...copy(plan),ref:refs[3],quote:'兩組'}],unknowns:[]};
  await assert.rejects(runtime.readingContinuity({ticket:full.opening.reader.ticket,proposal:ambiguous}),error=>{
   assert.equal(error.code,'continuity_quote_not_unique');const c=getCmcpContinuityCorrection(error);assert.equal(c.issues[0].reason,'quote_ambiguous_in_selected_formal_source');assert.deepEqual(c.issues[0].inputLocations,['$.plans[0]']);failures.push(c);return true;
  });
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({kind:'cmcp_ticket_local_source_feedback',modelCalls:0,partial,full,failures,valid,result},null,2)+'\n',{flag:'wx'});
 }finally{await runtime.close();}
});

test('正式 Runtime 拒絕攜帶非空 issues；同票券一次結構修正可正式保存而不改原時間',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-proposal-feedback');await fs.mkdir(base,{recursive:true});
 const out=await fs.mkdtemp(path.join(base,'formal-')),scopeId='synthetic-proposal-feedback',now='2026-10-09T04:00:00.000Z',timezone='Asia/Taipei';
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-proposal-feedback',providerMode:'host',
  input:{root:path.join(out,'state'),scopeId,events:[],timezone,limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:32,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-feedback-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 try{
  for(const [index,text]of [plan.quote,change.quote].entries())await runtime.ingest({role:'user',text,timeContext:{now:new Date(Date.parse(now)+index*1000).toISOString(),timezone}});
  const nav=await runtime.readingNavigate({text:'核對合成展示架的原案與修改。'});
  const opening=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:32,maxTotalBytes:65536,maxPageBytes:4096,maxPages:32,maxProjectionBytes:32768}});
  const pages=[];for(let n=0;n<32;n++){const page=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  const refs=[plan.quote,change.quote].map(text=>pages.find(page=>page.reader.text===text).reader.source.ref);
  const valid=typed();valid.plans[0].ref=refs[0];valid.plans[0].orderedChanges[0].ref=refs[1];valid.plans[0].orderedChanges[0].edits[0].replacement.ref=refs[1];
  const before=await runtime.bufferList(),failures=[];
  const missing=copy(valid);delete missing.plans[0].orderedChanges[0].edits;
  const malformed=copy(valid);malformed.plans[0].orderedChanges[0].unexpected=true;
  for(const proposal of [missing,malformed]){
   await assert.rejects(runtime.readingContinuity({ticket:opening.reader.ticket,proposal}),error=>{
    const correction=getCmcpContinuityCorrection(error);assert(correction.issues.length>0);assert.equal(correction.version,1);
    failures.push({error:error.message,correction});return true;
   });
  }
  const result=await runtime.readingContinuity({ticket:opening.reader.ticket,proposal:valid});assert.equal(result.status,'ready');assert.equal(result.projection.currentPlans[0].text,'規劃寬六十公分，只供室內使用。');assert.deepEqual((await runtime.bufferList()).items,before.items);
  const absent=copy(valid);absent.plans[0].quote='原始材料沒有這句話';await assert.rejects(runtime.readingContinuity({ticket:opening.reader.ticket,proposal:absent}));
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({kind:'cmcp_proposal_feedback_runtime',productRoot,modelCalls:0,opening,pages,failures,valid,result,bufferUnchanged:true},null,2)+'\n',{flag:'wx'});
 }finally{await runtime.close();}
});

test('票券外 ref 有界正式更正；固定引數定位、原角色時間與拒絕守護保持',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-proposal-feedback');await fs.mkdir(base,{recursive:true});
 const out=await fs.mkdtemp(path.join(base,'outside-ref-')),scopeId='synthetic-outside-ref-feedback',now='2026-10-14T00:00:00.000Z',timezone='Asia/Taipei';
 const bodies=[plan.quote,change.quote,'甲的校對已完成，乙的排版先暫停。'];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:scopeId,providerMode:'host',input:{root:path.join(out,'state'),scopeId,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:32,maxSourceBytes:8192},
  loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:scopeId+'-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 const outcomes=[];
 try{
  for(const [i,text]of bodies.entries())await runtime.ingest({role:'user',text,timeContext:{now:new Date(Date.parse(now)-30000+i*1000).toISOString(),timezone}});
  const nav=await runtime.readingNavigate({text:'核對展示架修訂與校對回報。'}),reading=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',
   selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:32,maxTotalBytes:65536,maxPageBytes:4096,maxPages:32,maxProjectionBytes:32768}}),pages=[];
  const valid=typed(),outside='other-scope-private-ref';
  valid.plans[0].ref='outside';
  await assert.rejects(runtime.readingContinuity({ticket:reading.reader.ticket,proposal:valid}),/continuity_complete_selected_reading_required/);
  for(let i=0;i<32;i++){const page=await runtime.readingPage({ticket:reading.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  const refs=bodies.map(body=>pages.find(p=>p.reader.text===body).reader.source.ref);
  valid.plans[0].ref=refs[0];valid.plans[0].orderedChanges[0].ref=refs[1];valid.plans[0].orderedChanges[0].edits[0].replacement.ref=refs[1];
  const calc=proposal=>project({reading,previousPages:pages,scopeId,proposal,timeContext:{now,timezone}}),before=await runtime.bufferList();
  const reject=(proposal,code,locations)=>{
   const original=copy(proposal);let observed;
   assert.throws(()=>calc(proposal),error=>{
    assert.equal(error.code,code);observed=getCmcpContinuityCorrection(error);const issue=observed.issues[0];
    assert.deepEqual(issue.inputLocations,locations);assert.equal(issue.inputLocationCount,locations.length);
    assert.equal(JSON.stringify(observed).includes(outside),false);assert.equal(JSON.stringify(observed).includes(config.input.root),false);
    assert.equal(getCmcpContinuityCorrection(Object.assign(Error(code),{correction:observed})),null);return true;
   });assert.deepEqual(proposal,original);outcomes.push(observed);return observed.issues[0];
  };
  await t.test('未讀前提不降級；票券外基底不回正文／外scope ref',()=>{
   const q=copy(valid);q.plans[0].ref=outside;
   const issue=reject(q,'continuity_source_outside_reading',['$.plans[0]']);
   assert.equal(issue.ticket,reading.reader.ticket);assert.equal(issue.formalReading,'completed_selected_sources');
   assert.equal(issue.sourceCoverage,'current_reading_ticket_only_not_all_history');assert.equal(issue.legalRefCount,3);assert.equal(issue.legalRefsTruncated,false);
   assert.deepEqual(issue.legalRefs,reading.internal.manifest.sources.map(s=>({ref:s.ref,sourceAuthorRole:s.sourceAuthorRole,messageRecordedAt:s.messageRecordedAt,eventOccurredAt:s.eventOccurredAt,evidenceHash:s.evidenceHash})));
   for(const body of bodies)assert.equal(JSON.stringify(issue).includes(body),false);
   assert.match(issue.recovery,/only_if_a_required_original_is_genuinely_unselected/);assert.match(issue.recovery,/do_not_reopen_the_same_selection/);
  });
  await t.test('同錯引用多位置全部有界列出，不替換或改計畫',()=>{
   const q=copy(valid);q.plans[0].orderedChanges[0].ref=outside;q.plans[0].orderedChanges[0].edits[0].replacement.ref=outside;
   const issue=reject(q,'continuity_source_outside_reading',['$.plans[0].orderedChanges[0]']);assert.equal(issue.inputLocationsTruncated,false);
   const repeated={version:6,plans:[{...copy(plan),ref:refs[0],reasons:Array.from({length:9},(_,i)=>({id:'reason-'+i,ref:outside,quote:plan.quote}))}],unknowns:[]};
   const saved=copy(repeated);let e;try{calc(repeated);}catch(error){e=getCmcpContinuityCorrection(error);}
   assert.equal(e.code,'continuity_source_outside_reading');assert.equal(e.issues[0].inputLocationCount,9);assert.equal(e.issues[0].inputLocations.length,8);assert.equal(e.issues[0].inputLocationsTruncated,true);
   assert.deepEqual(repeated,saved);outcomes.push(e);
  });
  await t.test('reportScopeResolutions 真欄位定位；未知同名物件不被任意掃描',()=>{
   const q={version:6,plans:[{...copy(plan),ref:refs[0],orderedChanges:[{kind:'status',ref:refs[2],quote:'乙的排版先暫停',planStatus:'paused'}]}],
    reports:[{id:'done',ref:refs[2],quote:'甲的校對已完成',topic:plan.topic,aspect:'校對',temporalUse:'current'}],unknowns:[]};
   const partial=calc(q),finding=partial.projection.reportScopeReview.findings[0];assert.equal(partial.status,'partial');
   const resolution={findingId:finding.findingId,kind:'reported_state_in_status_message',reportRef:outside,reportQuote:'甲的校對已完成'};
   q.reportScopeResolutions=[resolution];reject(q,'continuity_source_outside_reading',['$.reportScopeResolutions[0]']);
   q.reportScopeResolutions[0].reportRef=refs[2];q.reportScopeResolutions[0].reportQuote='不存在的回報_private_quote';
   const missing=reject(q,'continuity_quote_absent',['$.reportScopeResolutions[0]']);assert.equal(missing.ref,refs[2]);
   assert.equal(JSON.stringify(outcomes.at(-1)).includes('private_quote'),false);
   q.reportScopeResolutions[0].reportQuote='甲的校對已完成';const result=calc(q);assert.equal(result.status,'ready');
   assert.equal(result.projection.reportScopeReview.semanticVerification,'not_performed');assert.equal(result.projection.reportScopeReview.executionAuthority,'none');
   const legacy={version:3,nodes:[{id:'n',ref:outside,quote:plan.quote,text:plan.quote,kind:'user_intent',temporalUse:'current',topic:plan.topic,aspect:plan.aspect,relation:{kind:'independent',targetNodeIds:[]}}],
    unknowns:[],planChanges:[{reason:{reportScopeResolutions:[{ref:outside,quote:plan.quote}]}}]};
   reject(legacy,'continuity_source_outside_reading',['$.nodes[0]']);
  });
  await t.test('改正合法 ref 後同票券正常投影；Buffer／原時間不改',async()=>{
   const result=await runtime.readingContinuity({ticket:reading.reader.ticket,proposal:valid});assert.equal(result.status,'ready');
   assert.equal(result.projection.currentPlans[0].text,'規劃寬六十公分，只供室內使用。');
   assert.deepEqual((await runtime.bufferList()).items,before.items);assert.deepEqual(result.projection.sources.map(s=>s.messageRecordedAt),reading.internal.manifest.sources.filter(s=>result.projection.sources.some(r=>r.ref===s.ref)).map(s=>s.messageRecordedAt));
  });
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({kind:'cmcp_source_outside_reading_feedback',modelCalls:0,reading,pages,valid,outcomes},null,2)+'\n',{flag:'wx'});
 }finally{await runtime.close();}
});
