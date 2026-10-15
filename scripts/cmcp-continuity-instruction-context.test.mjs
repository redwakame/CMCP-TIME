import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const product=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=file=>import(pathToFileURL(path.join(product,file)).href),copy=structuredClone;
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,CMCP_CONTINUITY_PROJECTION_LIMITS:limits}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {compileCmcpTypedContinuityProposal:compileTyped}=await load('src/cmcp-guard/cmcp-continuity-typed-proposal.js');
const {normalizeCmcpEventUpdate:normalize}=await load('src/cmcp-guard/cmcp-event-lineage.js');
const {continuityToolSchema}=await load('adapters/continuity-input.mjs');
const {projectContinuityModelView:compact,restoreContinuityModelView:restore}=await load('adapters/continuity-model-view.mjs');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');

test('正式 User 指令來源與引文聲音；不進事實或計畫、不取得授權',async t=>{
 const parent=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-instruction-context');await fs.mkdir(parent,{recursive:true});
 const out=await fs.mkdtemp(path.join(parent,'formal-')),scope='synthetic-instruction-context',now='2026-10-12T00:00:00.000Z',timezone='Asia/Taipei';
 const bodies=['我計畫排版入口告示，字型尚未決定。','入口告示排版先暫停。','沒有提到的不要再安排。','你前面提的建議我還沒決定。','這是尚未採用的 Assistant 建議。','告示草稿已寫完，入口告示排版先暫停。'];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:scope,providerMode:'host',input:{root:path.join(out,'state'),scopeId:scope,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:32,maxSourceBytes:8192},
  loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},
  controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:scope+'-session',hostProvider:{request:async()=>{throw Error('本測試禁止模型');}}});
 const outcomes=[];
 const check=(name,fn)=>t.test(name,async()=>{try{await fn();outcomes.push({name,status:'PASS'});}catch(e){outcomes.push({name,status:'FAIL',error:e.message});throw e;}});
 try{
  for(const [i,text]of bodies.entries())await runtime.ingest({role:i===4?'assistant':'user',text,timeContext:{now:new Date(Date.parse(now)-300000+i*60000).toISOString(),timezone}});
  const navigation=await runtime.readingNavigate({text:'核對計畫暫停、一般工作限制與尚未決定的回報。'});
  const reading=await runtime.readingOpen({navigationTicket:navigation.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:32,maxTotalBytes:32768,maxPageBytes:4096,maxPages:32,maxProjectionBytes:32768}}),pages=[];
  for(let i=0;i<32;i++){const p=await runtime.readingPage({ticket:reading.reader.ticket,project:true});pages.push(p);if(p.reader.coverage.complete)break;}
  assert(pages.at(-1).reader.coverage.complete);
  const refs=bodies.map(text=>pages.find(p=>p.reader.text===text).reader.source.ref);
  const common=(i,id)=>({id,ref:refs[i],quote:bodies[i],topic:'入口告示',aspect:'排版',temporalUse:'current'});
  const input=q=>({reading,previousPages:pages,scopeId:scope,proposal:q,timeContext:{now,timezone}}),calc=q=>project(input(q));
  const build=()=>({version:6,plans:[{...common(0,'p'),orderedChanges:[{kind:'status',ref:refs[1],quote:bodies[1],planStatus:'paused'}]}],
   reports:[{...common(3,'r'),aspect:'建議採用狀態'}],context:[{...common(2,'i'),aspect:'工作範圍',kind:'user_instruction'}],unknowns:[]});
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({config,bodies,refs,reading,pages},null,2)+'\n',{flag:'wx'});
  await check('v6 正式指令保留原引文與角色；暫停仍走既有計畫變更',()=>{
   const q=build();assert(continuityToolSchema.safeParse({ticket:reading.reader.ticket,proposal:q}).success);
   const r=calc(q),node=r.projection.knownEvolution.find(n=>n.nodeId==='i');assert.equal(r.status,'ready');
   assert.equal(node.interpretation.kind,'user_instruction');assert.equal(node.interpretation.text,bodies[2]);assert.equal(node.source.sourceAuthorRole,'user');
   assert.equal(r.projection.currentPlans.length,1);assert.equal(r.projection.currentPlans[0].planStatus,'paused');
   assert.equal(r.projection.currentPlans[0].statusSource.citation.text,bodies[1]);assert.equal(r.projection.currentPlans[0].textUse,'source_bound_plan_not_external_outcome');
   assert.deepEqual(r.projection.currentClaims.map(n=>n.nodeId),['r']);assert.equal(r.projection.proactiveEligible,false);
   assert.equal(r.projection.validation.executionAuthority,'none');assert.equal(r.projection.eventMutation,'none');
   assert(r.projection.unknownParts.some(n=>n.nodeId==='i'&&n.reason==='instruction_not_fact_plan_or_execution_permission'));
   outcomes.push({name:'正式 v6 完整輸出',result:r});
  });
  await check('單獨指令不建立計畫、回報或派送',()=>{
   const q=build();q.plans=[];q.reports=[];const r=calc(q);assert.deepEqual(r.projection.currentClaims,[]);assert.deepEqual(r.projection.currentPlans,[]);
   assert.equal(r.projection.activation,'none');assert.equal(r.projection.proactiveEligible,false);
  });
  await check('真正混句的已做回報與現在暫停各自保留，不整句拒絕或降未知',()=>{
   const q=build();q.plans[0].orderedChanges=[{kind:'status',ref:refs[5],quote:bodies[5],planStatus:'paused'}];
   q.reports=[{...common(5,'mixed-report'),quote:'告示草稿已寫完',aspect:'草稿完成回報'}];
   const pending=calc(q),finding=pending.projection.reportScopeReview.findings[0];assert.equal(pending.status,'partial');
   q.reportScopeResolutions=[{findingId:finding.findingId,kind:'reported_state_in_status_clause',reportRef:refs[5],reportQuote:'告示草稿已寫完'}];
   const r=calc(q),claim=r.projection.currentClaims[0];assert.equal(r.status,'ready');assert.deepEqual(r.projection.unknowns,[]);
   assert.equal(claim.text,'告示草稿已寫完');assert.equal(claim.source.ref,refs[5]);assert.equal(claim.source.sourceAuthorRole,'user');
   assert.equal(claim.textUse,'quoted_source_voice_not_current_speaker');assert.equal(r.projection.currentPlans[0].planStatus,'paused');
   assert.equal(r.projection.currentPlans[0].statusSource.ref,refs[5]);assert.equal(r.projection.currentPlans[0].statusSource.citation.text,bodies[5]);
   assert.equal(r.projection.reportScopeReview.semanticVerification,'not_performed');assert.equal(r.projection.validation.executionAuthority,'none');
   outcomes.push({name:'合法混句完整前後原件',pending,result:r});
  });
  await check('Assistant 不得被宣告成 User 指令',()=>{
   const q=build();q.context[0]={...common(4,'i'),kind:'user_instruction'};assert.throws(()=>calc(q),/continuity_source_role_mismatch/);
  });
  await check('指令不得 supersedes 事實、revises 計畫或帶 planStatus',()=>{
   for(const [kind,target]of [['supersedes','r'],['revises','p']]){const q=build();q.context[0].relation={kind,targetNodeIds:[target]};assert.throws(()=>calc(q),/invalid_state_relation|invalid_plan_relation/);}
   const q=build();q.context[0].planStatus='paused';assert.equal(continuityToolSchema.safeParse({ticket:reading.reader.ticket,proposal:q}).success,false);
   assert.throws(()=>calc(q),/continuity_v6_shape/);
  });
  await check('正式 ref／原文／scope 核對不因新型別放寬',()=>{
   const absent=build();absent.context[0].ref='outside';assert.throws(()=>calc(absent),/continuity_source_outside_reading/);
   const mismatch=build();mismatch.context[0].quote='這不是原句';assert.throws(()=>calc(mismatch),/continuity_quote_absent/);
   assert.throws(()=>project({...input(build()),scopeId:'other-scope'}));
  });
  await check('v1–5 舊輸入與普通 Event 不接受新指令型別',()=>{
   const q=build();q.version=5;assert.throws(()=>compileTyped(q,{limits}),/continuity_v5_context_kind/);
   const compiled=compileTyped(build(),{limits}).proposal;
   for(const version of [1,2,3]){const old={version,nodes:[copy(compiled.nodes.find(n=>n.id==='i'))],unknowns:[]};assert.throws(()=>calc(old),/invalid_event_interpretation/);}
   const old4={version:4,nodes:[copy(compiled.nodes.find(n=>n.id==='i'))],unknowns:[]};assert.throws(()=>calc(old4),/invalid_event_interpretation/);
   const node=calc(build()).projection.knownEvolution.find(n=>n.nodeId==='i');
   const event={version:2,updateId:'i',source:{pointer:node.source.pointer??reading.internal.manifest.sources.find(s=>s.ref===refs[2]).pointer,citation:node.source.citation},
    interpretation:node.interpretation,action:{type:'add_node',objectId:'入口告示',aspect:'工作範圍',relation:{kind:'independent',targetNodeIds:[]}}};
   assert.throws(()=>normalize(event,{allowPlanContract:true}),/invalid_event_interpretation/);
   assert.throws(()=>normalize({...event,version:1},{allowUserInstruction:true}),/invalid_event_interpretation/);
  });
  await check('currentClaims 原話旁是已核 User 聲音、原時間與 Pointer/hash，不猜指涉',()=>{
   const p=calc(build()).projection,row=p.currentClaims[0],formal=reading.internal.manifest.sources.find(s=>s.ref===refs[3]);
   assert.equal(row.text,bodies[3]);assert.equal(row.textUse,'quoted_source_voice_not_current_speaker');
   assert.equal(row.source.ref,formal.ref);assert.equal(row.source.sourceAuthorRole,'user');assert.equal(row.source.evidenceHash,formal.evidenceHash);
   assert.deepEqual(row.source.pointer,formal.pointer);assert.deepEqual(row.originalTime,{messageRecordedAt:formal.messageRecordedAt,eventOccurredAt:formal.eventOccurredAt});
   assert.equal(row.source.citation.text,bodies[3]);assert.equal(Object.hasOwn(row,'addressee'),false);assert.equal(Object.hasOwn(row.source,'addressee'),false);
  });
  await check('v3 自訂解釋不是引文，不加錯誤原說話者標籤',()=>{
   const q={version:3,nodes:[{...common(3,'r'),kind:'user_report',text:'User 表示尚未決定。',relation:{kind:'independent',targetNodeIds:[]}}],unknowns:[]};
   const row=calc(q).projection.currentClaims[0];assert.equal(row.text,q.nodes[0].text);assert.equal(row.textUse,'host_interpretation_not_source_quote');
   assert.equal(row.source.citation.text,bodies[3]);
  });
  await check('舊 v1/v2 主視圖不重寫；來源仍沿原 knownEvolution',()=>{
   for(const version of [1,2]){const q={version,nodes:[{...common(3,'r'),kind:'user_report',text:bodies[3],relation:{kind:'independent',targetNodeIds:[]}}],unknowns:[]};
    const row=calc(q).projection.currentClaims[0];assert.deepEqual(row,{objectId:'入口告示',aspect:'排版',nodeId:'r',text:bodies[3]});}
  });
  await check('無損模型封套保留同層來源標記與完整指令',()=>{
   const r=calc(build());assert.deepEqual(restore(compact(r)),r);assert.equal(loopHash(restore(compact(r)).projection),r.projectionHash);
  });
  await check('正式 publication、查看不刷新時間／Buffer／Pin或共用控制',async()=>{
   const before={controls:await runtime.controlsSnapshot(),buffer:await runtime.bufferList(),pins:await runtime.pinList()};
   const r=await runtime.readingContinuity({ticket:reading.reader.ticket,proposal:build()});assert.equal(r.status,'ready');
   const after={controls:await runtime.controlsSnapshot(),buffer:await runtime.bufferList(),pins:await runtime.pinList()};
   // evaluatedAt 是此刻查看的時鐘，非原時間／TTL；其餘完整狀態必須保持。
   const persistent=value=>({...value,buffer:{...value.buffer,evaluatedAt:'view_clock'}});assert.deepEqual(persistent(after),persistent(before));
  });
  await check('Clean／OFF 正式控制仍阻擋新型別投影',async()=>{
   await runtime.configureControls({updateId:'instruction-clean',patch:{clean:true}});assert.equal((await runtime.readingContinuity({ticket:reading.reader.ticket,proposal:build()})).status,'disabled');
   await runtime.configureControls({updateId:'instruction-off',patch:{clean:false,enabled:false}});assert.equal((await runtime.readingContinuity({ticket:reading.reader.ticket,proposal:build()})).status,'disabled');
  });
 }finally{await runtime.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify({kind:'cmcp_instruction_context_zero_model_results',version:1,product,modelCalls:0,runtimeClosed:true,semanticVerification:'not_performed',outcomes},null,2)+'\n',{flag:'wx'});}
});
