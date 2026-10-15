import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=relative=>import(pathToFileURL(path.join(root,relative)));
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,getCmcpContinuityCorrection}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {CmcpHarnessBridge,projectHarnessToolResult}=await load('adapters/deepseek-harness/runtime-bridge.mjs');
const previous=process.env.CMCP_TEST_REFERENCE_ROOT?(await import(pathToFileURL(path.join(path.resolve(process.env.CMCP_TEST_REFERENCE_ROOT),'src/cmcp-guard/cmcp-continuity-projection.js')))).projectCmcpReadingContinuity:null;
const copy=structuredClone;

// 只驗雙端精確支持及可修正回饋；不同區間的接受不等於自然語意已驗。
test('理由與撤回雙端須可分別核對，同句合法表示及正式責任保持',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-reason-self-binding');await fs.mkdir(base,{recursive:true});
 const out=await fs.mkdtemp(path.join(base,'formal-')),scopeId='synthetic-reason-dual-support',now='2026-10-10T02:00:00.000Z',timezone='Asia/Taipei';
 const texts=[
  '我打算先以木箱收納，原本因為搬運容易採用木箱，但現在撤回這項考量。',
  '我打算先以木箱收納。',
  '現在增加搬運容易的理由，但我同時撤回這個考量。',
  '我原先因防潮採用塑膠盒。',
  '現在撤回防潮這項考量。',
  '我打算先以木箱收納，原本因為搬運容易採用木箱，但現在撤回這項考量。',
  '我計畫用紙本，因設備維修；其他限制照原定。',
  '設備已修好，原本因設備維修而用紙本的理由不再適用；其他理由維持。'
 ];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-reason-dual-support',providerMode:'host',
  input:{root:path.join(out,'state'),scopeId,events:[],timezone,
   limits:{maxEntries:12,maxCatalogBytes:14000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:14000},storageCapacity:{maxSources:64,maxSourceBytes:8192},
   loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-dual-support-session',hostProvider:{request:async()=>{throw Error('本測試禁止模型呼叫');}}});
 const results=[];
 try{
  for(const [i,text]of texts.entries())await runtime.ingest({role:'user',text,timeContext:{now:new Date(Date.parse(now)-600000+i*60000).toISOString(),timezone}});
  const nav=await runtime.readingNavigate({text:'核對收納及記錄計畫理由的正式來源。'});
  const reading=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:16384}});
  const pages=[];for(let i=0;i<64;i++){const page=await runtime.readingPage({ticket:reading.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  assert.equal(pages.at(-1).reader.coverage.complete,true);
  const refs=texts.map((text,i)=>pages.find(p=>p.reader.text===text&&p.reader.source.messageRecordedAt===new Date(Date.parse(now)-600000+i*60000).toISOString()).reader.source.ref);
  const node=(id,i,quote,extra={})=>({id,ref:refs[i],quote,text:quote,kind:'user_intent',temporalUse:'current',topic:'收納',aspect:id,relation:{kind:'independent',targetNodeIds:[]},...extra});
  const input=proposal=>({reading,previousPages:pages,scopeId,proposal,timeContext:{now,timezone}});
  const calc=proposal=>project(input(proposal));
  const basis=({version=3,reason=texts[0],withdraw=texts[0],withdrawSource=0}={})=>({version,nodes:[
   node('base',0,'我打算先以木箱收納',{reason:{ref:refs[0],quote:reason}}),
   node('withdrawal',withdrawSource,withdraw,{temporalUse:'unspecified',...(version===3?{planRole:'evidence'}:{}),relation:{kind:'related',targetNodeIds:['base']}})
  ],unknowns:[],reasonRelations:[{kind:'withdraws',fromNodeId:'withdrawal',targetNodeIds:['base'],ref:refs[withdrawSource],quote:withdraw}]});
  const change=({reason=texts[2],withdraw=texts[2]}={})=>({version:3,nodes:[node('base',1,texts[1]),
   node('withdrawal',2,withdraw,{temporalUse:'unspecified',planRole:'evidence',relation:{kind:'related',targetNodeIds:['base']}})],unknowns:[],
   planChanges:[{id:'new-reason',targetNodeId:'base',afterChangeId:null,kind:'reason',ref:refs[2],quote:texts[2],reason:{kind:'adds',ref:refs[2],quote:reason}}],
   reasonRelations:[{kind:'withdraws',fromNodeId:'withdrawal',targetChangeIds:['new-reason'],ref:refs[2],quote:withdraw}]});
  const assertRejected=proposal=>{
   const before=copy(proposal);let error;try{calc(proposal);}catch(e){error=e;}assert(error);
   assert.equal(error.code,'continuity_reason_distinct_support_required');const c=getCmcpContinuityCorrection(error);
   assert.equal(c.code,error.code);assert(c.issues.length>0&&c.issues.length<=8);assert.equal(c.truncated,false);
   for(const issue of c.issues){assert.equal(issue.semanticVerification,'not_performed');assert.equal(issue.executionAuthority,'none');
    assert.deepEqual(issue.targetReason,issue.withdrawal);assert.match(issue.targetReason.sourceIdentity,/^[a-f0-9]{64}$/);
    assert.equal(issue.targetReason.sourceAuthorRole,'user');assert.equal(issue.targetReason.range.unit,'unicode_code_points');
    assert.deepEqual(Object.keys(issue.targetReason).sort(),['ref','sourceIdentity','evidenceHash','range','sourceAuthorRole','messageRecordedAt','eventOccurredAt'].sort());}
   const raw=JSON.stringify(c);for(const text of texts)assert(!raw.includes(text));assert(Buffer.byteLength(raw)<8192);
   assert.deepEqual(proposal,before);if(previous)assert.equal(previous(input(proposal)).status,'ready');
   results.push({kind:'rejected',input:copy(proposal),correction:c,previous:previous?'ready':'not_requested'});return c;
  };
  const assertAccepted=proposal=>{const before=copy(proposal),result=calc(proposal);assert.equal(result.status,'ready');assert.deepEqual(proposal,before);
   if(result.projection.version>=2)assert.equal(result.projection.validation.executionAuthority,'none');assert.equal(result.projection.proactiveEligible,false);
   if(previous)assert.deepEqual(result,previous(input(proposal)));
   results.push({kind:'ready',input:copy(proposal),result,previous:previous?'byte-equivalent-structure':'not_requested'});return result;};
  const readingBefore=copy(reading),pagesBefore=copy(pages),bufferBefore=await runtime.bufferList();
  await t.test('v2／v3 基底雙端同一正式區間被要求更正，回饋不含原文',()=>{
   for(const version of [2,3]){const c=assertRejected(basis({version}));assert.equal(c.issues[0].targetNodeId,'base');assert.equal(c.issues[0].targetChangeId,undefined);}
   assert.equal(getCmcpContinuityCorrection(Object.assign(Error('偽造'),{code:'continuity_reason_distinct_support_required',issues:[{}]})),null);
  });
  await t.test('變更理由雙端同一區間被要求更正，正式變更識別保持',()=>{
   const c=assertRejected(change());assert.equal(c.issues[0].targetChangeId,'new-reason');assert.equal(c.issues[0].targetNodeId,undefined);
  });
  await t.test('同訊息的不同子句及合法包含在基底／變更兩路都維持',()=>{
   for(const withdraw of ['但現在撤回這項考量',texts[0]])assertAccepted(basis({reason:'原本因為搬運容易採用木箱',withdraw}));
   for(const withdraw of ['但我同時撤回這個考量',texts[2]])assertAccepted(change({reason:'現在增加搬運容易的理由',withdraw}));
  });
  await t.test('不同正式原件即使全文與區間相同，不因字串或座標誤拒',()=>{
   const r=assertAccepted(basis({withdrawSource:5}));assert.notEqual(r.projection.reasons[0].ref,r.projection.reasonRelations[0].ref);
  });
  await t.test('v1／v2／v3 的合法原理由及獨立撤回輸出與前版一致',()=>{
   for(const version of [1,2,3])assertAccepted({version,nodes:[node('base',3,texts[3],{reason:{ref:refs[3],quote:'因防潮'}})],unknowns:[]});
   for(const version of [2,3])assertAccepted({version,nodes:[node('base',3,texts[3],{reason:{ref:refs[3],quote:'因防潮'}}),
    node('withdrawal',4,texts[4],{temporalUse:'unspecified',...(version===3?{planRole:'evidence'}:{}),relation:{kind:'related',targetNodeIds:['base']}})],unknowns:[],
    reasonRelations:[{kind:'withdraws',fromNodeId:'withdrawal',targetNodeIds:['base'],ref:refs[4],quote:texts[4]}]});
  });
  await t.test('非撤回關係不新增雙端限制，不憑引文自動改成撤回',()=>{
   for(const kind of ['adds','prioritizes','accepts_tradeoff','unresolved']){const p=basis();delete p.nodes[1].planRole;p.nodes[1].reason={ref:refs[0],quote:texts[0]};p.reasonRelations[0].kind=kind;
    const r=assertAccepted(p);assert.equal(r.projection.reasons[0].standing,'not_explicitly_withdrawn');}
  });
  await t.test('正式 Runtime v5 先拒失效陳述自綁，再以正確原理由目標更正',async()=>{
   const statement='原本因設備維修而用紙本的理由不再適用';
   const wrong={version:5,plans:[{id:'record',ref:refs[6],quote:texts[6],topic:'記錄',aspect:'方式',temporalUse:'current',
    orderedChanges:[{kind:'reason',ref:refs[7],quote:texts[7],reason:{kind:'adds',ref:refs[7],quote:statement}}],
    reasonWithdrawals:[{ref:refs[7],quote:statement,temporalUse:'current',target:0}]}],unknowns:[]};
   let caught;await assert.rejects(runtime.readingContinuity({ticket:reading.reader.ticket,proposal:wrong}),e=>{caught=e;return e.code==='continuity_reason_distinct_support_required';});
   const c=getCmcpContinuityCorrection(caught);assert.equal(c.issues[0].targetChangeId,'__cmcp_v5_change_0_0');
   const corrected=copy(wrong);delete corrected.plans[0].orderedChanges;corrected.plans[0].reason={ref:refs[6],quote:'因設備維修'};corrected.plans[0].reasonWithdrawals[0].target='basis';
   const result=await runtime.readingContinuity({ticket:reading.reader.ticket,proposal:corrected});assert.equal(result.status,'ready');
   assert.equal(result.projection.reasons[0].citation.text,'因設備維修');assert.equal(result.projection.reasons[0].standing,'withdrawn_by_explicit_user_source');
   assert.equal(result.projection.planChanges.length,0);assert.equal(result.presentation.plans[0].annotations[0].range.text,'因設備維修');
   results.push({kind:'runtime-correction',wrong,correction:c,corrected,result});
  });
  await t.test('讀取與更正不改正式原文、角色、原時間、Buffer 或執行權',async()=>{
   assert.deepEqual(reading,readingBefore);assert.deepEqual(pages,pagesBefore);assert.deepEqual((await runtime.bufferList()).items,bufferBefore.items);
   for(const row of results.filter(r=>r.result)){if(row.result.projection.version>=2)assert.equal(row.result.projection.validation.executionAuthority,'none');assert.equal(row.result.projection.activation,'none');assert.equal(row.result.projection.proactiveEligible,false);}
  });
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({clock:'明示合成時鐘',texts,refs,reading,pages},null,2)+'\n',{flag:'wx'});
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({kind:'reason_distinct_support_regression',modelCalls:0,semanticVerification:'not_performed',results},null,2)+'\n',{flag:'wx'});
 }finally{await runtime.close();}
 await t.test('Harness 正式工具及實際結果投影保留雙端更正，正常重提可通過',async()=>{
  const runtimeConfig=path.join(out,'runtime.json');await fs.writeFile(runtimeConfig,JSON.stringify(config),{flag:'wx'});
  const bridge=new CmcpHarnessBridge({deploymentRoot:out,runtimeConfig,traceRoot:path.join(out,'trace'),scopeId});
  try{
   const sid='synthetic-reason-tool-session';await bridge.begin(sid,'query','核對記錄計畫理由的正式來源。');
   const nav=await bridge.tool(sid,'cmcp_find_history',{});
   const opened=await bridge.tool(sid,'cmcp_open_history',{navigationTicket:nav.ticket,selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''})});
   const pages=[];for(let i=0;i<64;i++){const p=await bridge.tool(sid,'cmcp_read_history',{ticket:opened.ticket});pages.push(p);if(p.coverage.complete)break;}
   assert.equal(pages.at(-1).coverage.complete,true);
   const ref=text=>pages.find(p=>JSON.parse(p.modelContext).content===text).source.ref;
   const originalRef=ref(texts[6]),withdrawalRef=ref(texts[7]),statement='原本因設備維修而用紙本的理由不再適用';
   const wrong={version:5,plans:[{id:'record',ref:originalRef,quote:texts[6],topic:'記錄',aspect:'方式',temporalUse:'current',
    orderedChanges:[{kind:'reason',ref:withdrawalRef,quote:texts[7],reason:{kind:'adds',ref:withdrawalRef,quote:statement}}],
    reasonWithdrawals:[{ref:withdrawalRef,quote:statement,temporalUse:'current',target:0}]}],unknowns:[]};
   const rejected=await bridge.tool(sid,'cmcp_project_continuity',{ticket:opened.ticket,proposalJson:JSON.stringify(wrong)});
   assert.equal(rejected.status,'rejected');assert.equal(rejected.reason,'continuity_reason_distinct_support_required');
   const rendered=JSON.parse(JSON.stringify(projectHarnessToolResult(rejected)));assert.deepEqual(rendered,rejected);
   const issue=rendered.correction.issues[0];assert.equal(issue.targetChangeId,'__cmcp_v5_change_0_0');assert.deepEqual(issue.targetReason,issue.withdrawal);
   assert.equal(rendered.projection,undefined);assert.equal(rendered.modelCalls,0);assert(!JSON.stringify(rendered).includes(statement));
   const corrected=copy(wrong);delete corrected.plans[0].orderedChanges;corrected.plans[0].reason={ref:originalRef,quote:'因設備維修'};corrected.plans[0].reasonWithdrawals[0].target='basis';
   const accepted=await bridge.tool(sid,'cmcp_project_continuity',{ticket:opened.ticket,proposalJson:JSON.stringify(corrected)});
   assert.equal(accepted.status,'ready');assert.equal(accepted.projection.reasons[0].citation.text,'因設備維修');assert.equal(accepted.projection.reasons[0].standing,'withdrawn_by_explicit_user_source');
   await fs.writeFile(path.join(out,'bridge-result.json'),JSON.stringify({layer:'真 Bridge／Core 正式工具，無宿主模型',wrong,rejected,rendered,corrected,accepted,modelCalls:0},null,2)+'\n',{flag:'wx'});
  }finally{await bridge.close();}
 });
});
