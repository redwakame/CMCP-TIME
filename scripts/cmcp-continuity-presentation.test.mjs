import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=file=>import(pathToFileURL(path.join(productRoot,file)).href);
const {createCmcpContinuityPresentation:present}=await load('src/cmcp-guard/cmcp-continuity-presentation.js');
const {projectCmcpReadingContinuity:project}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');
const copy=structuredClone;
test('已撤回理由的唯讀附註只依正式範圍，不改條件或原文',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-presentation');await fs.mkdir(base,{recursive:true});const out=await fs.mkdtemp(path.join(base,'formal-'));
 const scopeId='synthetic-presentation',now='2026-10-08T06:00:00.000Z',timezone='Asia/Taipei';
 const bodies=['我規劃🪟展示架，寬四十公分。原因是通道狹窄。放室內。',
  '寬度改為六十公分，其他條件維持。撤回通道狹窄這個理由，尺寸與室內限制仍保留。'];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-presentation',providerMode:'host',input:{root:path.join(out,'state'),scopeId,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
  receiptRoot:path.join(out,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-presentation-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 const outcomes=[];async function check(name,fn){await t.test(name,async()=>{try{await fn();outcomes.push({name,status:'PASS'});}catch(e){outcomes.push({name,status:'FAIL',error:e.stack});throw e;}});}
 try{
  for(const [i,text]of bodies.entries())await runtime.ingest({role:'user',text,timeContext:{now:new Date(Date.parse(now)-120000+i*60000).toISOString(),timezone}});
  const nav=await runtime.readingNavigate({text:'核對展示架條件與撤回理由。'}),opening=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:16384}});
  const pages=[];for(let i=0;i<64;i++){const page=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  const refs=bodies.map(text=>pages.find(p=>p.reader.text===text).reader.source.ref);
  const proposal={version:5,plans:[{id:'rack',ref:refs[0],quote:bodies[0],topic:'展示用品',aspect:'展示架',temporalUse:'current',reason:{ref:refs[0],quote:'原因是通道狹窄。'},
   orderedChanges:[{kind:'content',ref:refs[1],quote:'寬度改為六十公分，其他條件維持。',edits:[{kind:'replace',quote:'四十公分',replacement:{ref:refs[1],quote:'六十公分'}}]}],
   reasonWithdrawals:[{ref:refs[1],quote:'撤回通道狹窄這個理由',temporalUse:'current',target:'basis'}]}],unknowns:[]};
  const input={reading:opening,previousPages:pages,scopeId,proposal,timeContext:{now,timezone}},formal=project(input),original=copy(formal.projection);
  const calc=(p,extra={})=>present({projection:p,projectionHash:loopHash(p),scopeId,verifiedScopeId:scopeId,...extra});
  const partIndex=original.currentPlans[0].sourceFragments.findIndex(x=>x.citation.text.includes('原因'));
  const reason=original.reasons[0],index=original.currentPlans[0].text.indexOf('原因'),cpIndex=[...original.currentPlans[0].text.slice(0,index)].length;
  await check('正式投影外層附註保留原Hash／版本／全文，Unicode對齊',()=>{
   assert.equal(formal.scopeId,scopeId);assert.equal(formal.presentation.scopeId,scopeId);assert.equal(formal.presentation.projectionHash,formal.projectionHash);
   assert.equal(formal.projectionHash,loopHash(original));assert.equal(formal.presentation.plans[0].textHash,loopHash(original.currentPlans[0].text));
   const a=formal.presentation.plans[0].annotations[0];assert.equal(a.range.text,'原因是通道狹窄。');assert.equal(a.range.start,cpIndex);assert.notEqual(a.range.start,index);
   assert.equal(a.sourceFragmentIndex,partIndex);assert.deepEqual(a.sourceRange,{unit:'unicode_code_points',start:reason.citation.start,end:reason.citation.end});
   assert.equal(original.currentPlans[0].planStatus,'planned');assert.match(original.currentPlans[0].text,/六十公分.*原因是通道狹窄。放室內。/);
  });
  await check('scope與projectionHash錯配拒絕',()=>{
   assert.throws(()=>calc(original,{verifiedScopeId:'other'}),/scope_mismatch/);assert.throws(()=>calc(original,{projectionHash:'0'.repeat(64)}),/projection_hash_mismatch/);
  });
  await check('同文不同ref或不同計畫不標記',()=>{
   const p=copy(original),fragment=p.currentPlans[0].sourceFragments[partIndex],source=p.sources.find(x=>x.ref===fragment.ref);
   fragment.ref='other-ref';p.sources.push({...source,ref:'other-ref'});assert.equal(calc(p).plans.length,0);
   const q=copy(original);q.currentPlans[0].nodeId='other-plan';assert.equal(calc(q).plans.length,0);
  });
  await check('同ref hash、角色或原時間不符拒絕',()=>{
   for(const patch of [{evidenceHash:'0'.repeat(64)},{sourceAuthorRole:'assistant'},{messageRecordedAt:now}]){
    const p=copy(original);Object.assign(p.currentPlans[0].sourceFragments[partIndex],patch);assert.throws(()=>calc(p),/source_binding_mismatch/);
   }
  });
  await check('部分重疊只附註交集，不撤回相鄰條件',()=>{
   const p=copy(original),c=reason.citation,start=c.start+2,text=[...c.text].slice(2).join('');
   p.currentPlans[0].sourceFragments=[{...p.currentPlans[0].sourceFragments[partIndex],citation:{unit:'unicode_code_points',start,end:c.end,text}}];p.currentPlans[0].text=text;
   const a=calc(p).plans[0].annotations[0];assert.equal(a.range.text,text);assert.equal(a.sourceRange.start,start);assert.equal(a.range.start,0);
  });
  await check('新ref重新採納同句不承襲舊撤回',()=>{
   const p=copy(original),part=p.currentPlans[0].sourceFragments[partIndex],source=p.sources.find(x=>x.ref===part.ref);
   part.ref='new-adoption';part.evidenceHash='c'.repeat(64);p.sources.push({...source,ref:part.ref,evidenceHash:part.evidenceHash});
   p.reasons.push({...reason,ref:part.ref,evidenceHash:part.evidenceHash,standing:'not_explicitly_withdrawn'});
   assert.equal(calc(p).plans.length,0);
  });
  await check('單一standing字串不能替代具名撤回關係',()=>{
   const p=copy(original);p.reasonRelations=[];assert.throws(()=>calc(p),/withdrawal_relationship_missing/);
   const q=copy(original);q.reasonRelations[0].targetNodeIds=['other'];assert.throws(()=>calc(q),/withdrawal_relationship_missing/);
  });
  await check('具名change理由同樣只標它的原文交集',()=>{
   const p=copy(original),r=copy(reason);r.binding={kind:'plan_change',nodeId:'rack',changeId:'c0',priorVersion:'before',planVersion:'after'};p.reasons=[];
   p.planChanges=[{id:'c0',targetNodeId:'rack',reason:r}];delete p.reasonRelations[0].targetNodeIds;p.reasonRelations[0].targetChangeIds=['c0'];
   const a=calc(p).plans[0].annotations[0];assert.deepEqual(a.reason,{collection:'planChanges',index:0,changeId:'c0'});
  });
  await check('不刪原文、不推翻其他來源或新增控制／派送資格',()=>{
   const before=JSON.stringify(original);calc(original);assert.equal(JSON.stringify(original),before);
   assert.equal(original.eventMutation,'none');assert.equal(original.proactiveEligible,false);assert.equal(original.validation.executionAuthority,'none');
  });
  await check('v1／v2生成維持舊外層，不冒充有新精確附註',()=>{
   for(const version of [1,2]){
    const old={version,nodes:[{id:'rack',ref:refs[0],quote:bodies[0],text:bodies[0],topic:'展示用品',aspect:'展示架',kind:'user_intent',temporalUse:'current',relation:{kind:'independent',targetNodeIds:[]}}],unknowns:[]};
    const r=project({...input,proposal:old});assert.equal(Object.hasOwn(r,'presentation'),false);assert.equal(Object.hasOwn(r,'scopeId'),false);assert.equal(calc(r.projection).status,'not_available');
   }
  });
  await check('正式Runtime發布與fresh讀回傳相同附註，查看不改Buffer／時間',async()=>{
   const before=await runtime.bufferList(),controls=await runtime.controlsSnapshot();
   const result=await runtime.readingContinuity({ticket:opening.reader.ticket,proposal}),view=await runtime.continuityStatus();
   assert.equal(result.status,'ready');assert.equal(view.sourceVerification,'currently_revalidated');assert.equal(view.scopeId,scopeId);
   assert.deepEqual(view.presentation,result.presentation);assert.deepEqual(view.projection,result.projection);assert.equal(view.projectionHash,result.projectionHash);
   assert.deepEqual((await runtime.bufferList()).items,before.items);assert.deepEqual(await runtime.controlsSnapshot(),controls);
   const again=await runtime.continuityStatus();assert.deepEqual(again.presentation,view.presentation);
   await fs.writeFile(path.join(out,'formal-publication-readback.json'),JSON.stringify({result,view,again,bufferUnchanged:true,controlsUnchanged:true},null,2)+'\n',{flag:'wx'});
  });
  await check('正式撤權在控制仍開啟時不再提供附註或原文',async()=>{
   const before=await runtime.continuityStatus();assert.equal(before.status,'ready');assert.equal(before.presentation.status,'available');
   await runtime.revokeReading({ticket:opening.reader.ticket,reason:'caller_revoked'});const revoked=await runtime.continuityStatus();assert.equal(revoked.status,'unavailable');assert.notEqual(revoked.reason,'controls_disabled');assert.equal(revoked.projection,null);assert.equal(revoked.presentation,undefined);
  });
  await check('OFF／Clean以正式控制原因拒絕，不誤報為有效空註記',async()=>{
   await runtime.configureControls({updateId:'presentation-off',patch:{enabled:false},persist:false});const off=await runtime.continuityStatus();assert.equal(off.status,'unavailable');assert.equal(off.reason,'controls_disabled');assert.equal(off.projection,null);assert.equal(off.presentation,undefined);
   await runtime.configureControls({updateId:'presentation-clean',patch:{enabled:true,clean:true},persist:false});const clean=await runtime.continuityStatus();assert.equal(clean.status,'unavailable');assert.equal(clean.reason,'controls_disabled');assert.equal(clean.presentation,undefined);
  });
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({opening,pages,proposal,formal},null,2)+'\n',{flag:'wx'});
 }finally{await runtime.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify({kind:'continuity_presentation_tests',productRoot,modelCalls:0,semanticVerification:'not_performed',runtimeClosed:true,outcomes},null,2)+'\n',{flag:'wx'});}
});
