import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=file=>import(pathToFileURL(path.join(productRoot,file)).href);
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,validateCmcpContinuityPublication:validate}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {createCmcpContinuitySourceContext:context}=await load('src/cmcp-guard/cmcp-continuity-source-context.js');
const {createCmcpContinuityPresentation:present}=await load('src/cmcp-guard/cmcp-continuity-presentation.js');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');
const {formatCmcpLocalInstant}=await load('src/cmcp-guard/project-cmcp-local-time.js');
const {createContinuityDelivery,continuityDeliveryPage,commitContinuityDeliveryPage,restoreContinuityDelivery}=await load('adapters/continuity-delivery.mjs');
const {restoreContinuityModelView}=await load('adapters/continuity-model-view.mjs');
const copy=structuredClone;

test('十三筆近界原文不因本地時間顯示而失去完整覆蓋',async()=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-source-context');await fs.mkdir(base,{recursive:true});const out=await fs.mkdtemp(path.join(base,'near-capacity-'));
 const now='2026-10-13T01:00:00.000Z',timezone='Asia/Taipei',scopeId='synthetic-source-time-capacity';
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-source-time-capacity',providerMode:'host',input:{root:path.join(out,'state'),scopeId,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:40000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:24000},storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
  receiptRoot:path.join(out,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-source-time-capacity-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 try{
  const bodies=Array.from({length:13},(_,i)=>'合成來源 '+String(i+1).padStart(2,'0')+'：'+ '甲'.repeat(250));
  for(const [i,text]of bodies.entries())await runtime.ingest({role:'user',text,timeContext:{now:new Date(Date.parse(now)-1200000+i*60000).toISOString(),timezone}});
  const nav=await runtime.readingNavigate({text:'核對合成來源的完整原文與時間。'}),opening=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:64,maxTotalBytes:30000,maxPageBytes:4096,maxPages:64,maxProjectionBytes:40000}});
  const pages=[];for(let i=0;i<64;i++){const page=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  const refs=bodies.map(body=>pages.find(page=>page.reader.text===body).reader.source.ref),proposal={version:6,plans:bodies.map((body,i)=>({id:'source-'+i,ref:refs[i],quote:body.slice(0,10),topic:'合成覆蓋',aspect:'來源-'+i,temporalUse:'current'})),unknowns:[]};
  const formal=project({reading:opening,previousPages:pages,scopeId,proposal,timeContext:{now,timezone}}),view=formal.presentation.sourceContext;
  const legacyMessages=formal.projection.sources.map(source=>({ref:source.ref,sourceAuthorRole:source.sourceAuthorRole,messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt,evidenceHash:source.evidenceHash,
   range:{unit:'unicode_code_points',start:0,end:[...bodies[refs.indexOf(source.ref)]].length},text:bodies[refs.indexOf(source.ref)],textHash:loopHash(bodies[refs.indexOf(source.ref)]),textUse:'complete_formally_read_original_message_not_selected_quote'}));
  const metrics={sourceCount:13,oldMessageBytes:Buffer.byteLength(JSON.stringify(legacyMessages)),contextLimit:view.limits.maxContextBytes,
   newMessageStatus:view.originalMessages.status,newMessageBytes:view.originalMessages.messages?Buffer.byteLength(JSON.stringify(view.originalMessages.messages)):null,metadataStatus:view.metadata.status,metadataBytes:view.metadata.sources?Buffer.byteLength(JSON.stringify(view.metadata.sources)):null};
  await fs.writeFile(path.join(out,'capacity-result.json'),JSON.stringify(metrics,null,2)+'\n');
  assert.ok(metrics.oldMessageBytes<=metrics.contextLimit);assert.ok(metrics.oldMessageBytes>metrics.contextLimit-1600);
  assert.equal(view.originalMessages.status,'available');assert.equal(view.metadata.status,'available');assert.equal(view.originalMessages.messages.length,13);assert.equal(view.metadata.sources.length,13);
  for(const message of view.originalMessages.messages){const original=legacyMessages.find(row=>row.ref===message.ref);for(const [key,value]of Object.entries(original))assert.deepEqual(message[key],value);}
 }finally{await runtime.close();}
});

test('正式來源完整度與選取引文分開，有界且無副作用',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-source-context');await fs.mkdir(base,{recursive:true});const out=await fs.mkdtemp(path.join(base,'formal-'));
 const now='2026-10-13T01:00:00.000Z',timezone='Asia/Taipei',scopeId='synthetic-source-context';
 const bodies=['規劃🪟展示架寬四十公分，只放室內。因為通道狹窄。','寬度改為六十公分，其他條件維持；場地仍未確認。','長文開頭：'+ '甲'.repeat(2000)];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-source-context',providerMode:'host',input:{root:path.join(out,'state'),scopeId,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:20000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:24000},storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
  receiptRoot:path.join(out,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-source-context-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 const outcomes=[];const check=async(name,fn)=>t.test(name,async()=>{await fn();outcomes.push({name,status:'PASS'});});
 try{
  for(const [i,text]of bodies.entries())await runtime.ingest({role:'user',text,timeContext:{now:new Date(Date.parse(now)-180000+i*60000).toISOString(),timezone}});
  const nav=await runtime.readingNavigate({text:'核對展示架目前來源。'}),opening=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:64,maxTotalBytes:20000,maxPageBytes:4096,maxPages:64,maxProjectionBytes:24000}});
  const pages=[];for(let i=0;i<64;i++){const p=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(p);if(p.reader.coverage.complete)break;}
  const refs=bodies.map(body=>pages.find(page=>body.startsWith(page.reader.text)).reader.source.ref);
  const proposal={version:6,plans:[{id:'rack',ref:refs[0],quote:bodies[0],topic:'展示用品',aspect:'架子',temporalUse:'current',orderedChanges:[{kind:'content',ref:refs[1],quote:'寬度改為六十公分',edits:[{kind:'replace',quote:'四十公分',replacement:{ref:refs[1],quote:'六十公分'}}]}],retentions:[{ref:refs[1],quote:'其他',temporalUse:'current'}]}],unknowns:[]};
  const args={reading:opening,previousPages:pages,scopeId,proposal,timeContext:{now,timezone}},formal=project(args),before=JSON.stringify({opening,pages,proposal});
  const recalc=p=>context({projection:p,projectionHash:loopHash(p),scopeId,reading:opening,previousPages:pages});
  await check('短引文不是來源截斷；全文與Unicode完整範圍、原時間/hash一致且按ref去重',()=>{
   const view=formal.presentation.sourceContext;assert.equal(view.metadata.status,'available');assert.equal(view.originalMessages.status,'available');
   assert.equal(view.metadata.sources.length,2);assert.equal(view.originalMessages.messages.length,2);
   const row=view.metadata.sources.find(x=>x.ref===refs[1]),body=view.originalMessages.messages.find(x=>x.ref===refs[1]);
   assert.deepEqual(row.originalMessageRange,{unit:'unicode_code_points',start:0,end:[...bodies[1]].length});assert.equal(row.formalRead.complete,true);assert.equal(row.formalToolMaterial.complete,true);
   assert.equal(body.text,bodies[1]);assert.equal(body.evidenceHash,row.evidenceHash);assert.equal(body.messageRecordedAt,row.messageRecordedAt);assert.equal(body.sourceAuthorRole,'user');
   assert.equal(formal.presentation.quotationView.retentions[0].quotation.text,'其他');assert.equal(view.actualModelConsumption,'not_observed');
   assert.equal(view.semanticVerification,'not_performed');assert.equal(view.executionAuthority,'none');assert.equal(formal.projectionHash,loopHash(formal.projection));assert.equal(JSON.stringify({opening,pages,proposal}),before);
  });
  await check('同ref角色／時間／hash與票券漂移不附假全文；未送reader的舊投影為unknown',()=>{
   for(const patch of [{sourceAuthorRole:'assistant'},{messageRecordedAt:now},{evidenceHash:'0'.repeat(64)}]){const p=copy(formal.projection);Object.assign(p.sources[0],patch);assert.equal(recalc(p).metadata.status,'unavailable');}
   const wrong=copy(formal.projection);wrong.manifestHash='0'.repeat(64);assert.equal(recalc(wrong).metadata.status,'unavailable');
   const old=present({projection:formal.projection,projectionHash:formal.projectionHash,scopeId,verifiedScopeId:scopeId});assert.equal(old.sourceContext.metadata.status,'unknown');assert.equal(old.sourceContext.originalMessages.messages,null);
  });
  await check('完整原文旁的時間值同源一致，跨日與非整點時區保留同一瞬間',()=>{
   const display=formal.presentation.sourceContext;assert.equal(display.localTimeDisplay.status,'available');assert.equal(display.localTimeDisplay.timezone,'Asia/Taipei');
   for(const metadata of display.metadata.sources){
    const message=display.originalMessages.messages.find(row=>row.ref===metadata.ref);assert.equal(message.messageRecordedAt,metadata.messageRecordedAt);assert.equal(message.sourceAuthorRole,metadata.sourceAuthorRole);assert.equal(message.evidenceHash,metadata.evidenceHash);
    assert.equal(Date.parse(metadata.localMessageRecordedAt),Date.parse(message.messageRecordedAt));assert.equal(Object.hasOwn(message,'localMessageRecordedAt'),false);
    assert.equal(message.eventOccurredAt,null);assert.equal(metadata.localEventOccurredAt,null);
   }
   const atZone=timezone=>{const p=copy(formal.projection);p.runtimeTime.timezone=timezone;return recalc(p);};
   assert.equal(atZone('America/New_York').metadata.sources.find(row=>row.ref===refs[0]).localMessageRecordedAt,'2026-10-12T20:57:00.000-04:00');
   assert.equal(atZone('Asia/Kathmandu').metadata.sources.find(row=>row.ref===refs[0]).localMessageRecordedAt,'2026-10-13T06:42:00.000+05:45');
   assert.equal(formatCmcpLocalInstant('2026-11-01T05:59:59.000Z','America/New_York'),'2026-11-01T01:59:59.000-04:00');
   assert.equal(formatCmcpLocalInstant('2026-11-01T06:00:00.000Z','America/New_York'),'2026-11-01T01:00:00.000-05:00');
   assert.equal(JSON.stringify({opening,pages,proposal}),before);assert.equal(formal.projectionHash,loopHash(formal.projection));
  });
  await check('未知或錯誤正式時區不猜值；錯誤原時間仍拒絕，不把訊息時間補為事件時間',()=>{
   const absent=copy(formal.projection);delete absent.runtimeTime.timezone;const unknown=recalc(absent);
   assert.equal(unknown.localTimeDisplay.status,'unknown');assert.equal(unknown.localTimeDisplay.reason,'projection_timezone_not_supplied');
   assert.equal(unknown.originalMessages.status,'available');assert.ok(unknown.metadata.sources.every(row=>row.localMessageRecordedAt===null&&row.localEventOccurredAt===null));
   for(const patch of [{timezone:'Not/A_Zone'},{now:'2026-02-30T01:00:00.000Z'}]){
    const invalid=copy(formal.projection);Object.assign(invalid.runtimeTime,patch);const view=recalc(invalid);
    assert.equal(view.localTimeDisplay.status,'unavailable');assert.equal(view.localTimeDisplay.reason,'invalid_projection_time_context');
    assert.equal(view.originalMessages.status,'available');assert.ok(view.metadata.sources.every(row=>row.localMessageRecordedAt===null));
    assert.deepEqual(view.originalMessages.messages.map(row=>[row.ref,row.messageRecordedAt,row.text,row.evidenceHash]),unknown.originalMessages.messages.map(row=>[row.ref,row.messageRecordedAt,row.text,row.evidenceHash]));
   }
   const badSource=copy(formal.projection);badSource.sources[0].messageRecordedAt='2026-02-30T01:00:00.000Z';assert.equal(recalc(badSource).originalMessages.status,'unavailable');
   assert.throws(()=>formatCmcpLocalInstant('2026-02-30T01:00:00.000Z',timezone),/invalid_time_context/);
  });
  await check('新時間值沿相同有界封套完整還原；超來源容量仍明示拒絕',()=>{
   const delivery=createContinuityDelivery(formal);let restored;
   if(delivery.inline)restored=restoreContinuityModelView(delivery.inline);
   else{const all=[];for(let i=0;i<delivery.pages.length;i++)all.push(commitContinuityDeliveryPage(delivery,continuityDeliveryPage(delivery,i)));restored=restoreContinuityModelView(restoreContinuityDelivery(all));}
   assert.deepEqual(restored.presentation.sourceContext,formal.presentation.sourceContext);assert.deepEqual(restored.projection,formal.projection);
   assert.equal(restored.projectionHash,formal.projectionHash);assert.equal(restored.presentation.sourceContext.semanticVerification,'not_performed');assert.equal(restored.presentation.sourceContext.executionAuthority,'none');
   const limits=formal.presentation.sourceContext.limits;assert.deepEqual(limits,{maxSources:64,maxRanges:256,maxMetadataBytes:16384,maxSourceBytes:4096,maxContextBytes:16384});
   assert.ok(Buffer.byteLength(JSON.stringify(formal.presentation.sourceContext.metadata.sources))<=limits.maxMetadataBytes);
   assert.ok(Buffer.byteLength(JSON.stringify(formal.presentation.sourceContext.originalMessages.messages))<=limits.maxContextBytes);
   const excessive=copy(formal.projection);excessive.sources=Array.from({length:limits.maxSources+1},()=>copy(excessive.sources[0]));const closed=recalc(excessive);
   assert.equal(closed.metadata.status,'unavailable');assert.equal(closed.metadata.reason,'continuity_source_context_source_limit');assert.equal(closed.originalMessages.messages,null);assert.equal(closed.originalMessages.truncated,false);
  });
  await check('原件頁篡改拒絕；長原文整個上下文unavailable但完整度metadata仍可查',()=>{
   const altered=copy(pages);altered[0].reader.text+='錯';const bad=context({projection:formal.projection,projectionHash:formal.projectionHash,scopeId,reading:opening,previousPages:altered});assert.equal(bad.originalMessages.status,'unavailable');assert.equal(bad.originalMessages.messages,null);
   const large=project({...args,proposal:{version:6,plans:[{id:'long',ref:refs[2],quote:'長文開頭',topic:'長文',aspect:'內容',temporalUse:'current'}],unknowns:[]}}).presentation.sourceContext;
   assert.equal(large.metadata.status,'available');assert.equal(large.metadata.sources[0].formalRead.complete,true);assert.equal(large.originalMessages.status,'unavailable');assert.equal(large.originalMessages.messages,null);assert.equal(large.originalMessages.truncated,false);
  });
  await check('正式發布與狀態重讀一致，不改Buffer/時間/控制；新附註篡改仍拒絕',async()=>{
   const buffer=await runtime.bufferList(),controls=await runtime.controlsSnapshot();
   const result=await runtime.readingContinuity({ticket:opening.reader.ticket,proposal}),view=await runtime.continuityStatus();
   assert.equal(view.status,'ready');assert.deepEqual(view.presentation.sourceContext,result.presentation.sourceContext);assert.deepEqual((await runtime.bufferList()).items,buffer.items);assert.deepEqual(await runtime.controlsSnapshot(),controls);
   const changed=copy(formal);changed.presentation.sourceContext.originalMessages.messages[0].text+='錯';
   await assert.rejects(validate({stores:{scopeId},catalog:null,reading:opening,previousPages:pages,result:changed,timeContext:{now,timezone}}),/source_context_binding_changed/);
   const wrongTime=copy(formal);wrongTime.presentation.sourceContext.metadata.sources[0].localMessageRecordedAt='2026-10-13T09:57:00.000+08:00';
   await assert.rejects(validate({stores:{scopeId},catalog:null,reading:opening,previousPages:pages,result:wrongTime,timeContext:{now,timezone}}),/source_context_binding_changed/);
   await fs.writeFile(path.join(out,'formal-context-readback.json'),JSON.stringify({result,view,bufferUnchanged:true,controlsUnchanged:true},null,2)+'\n');
  });
  await check('正式reader讀完但工具材料未全投影時，新上下文不繞過既有材料預算',async()=>{
   const firstLong=pages.findIndex(page=>page.reader.source.ref===refs[2]);assert.ok(firstLong>=0);
   const budget=pages.slice(0,firstLong+1).reduce((sum,page)=>sum+Buffer.byteLength(page.modelContext),0);
   const nav2=await runtime.readingNavigate({text:'只核長文的正式材料覆蓋。'}),opening2=await runtime.readingOpen({navigationTicket:nav2.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:64,maxTotalBytes:20000,maxPageBytes:4096,maxPages:64,maxProjectionBytes:budget}});
   const pages2=[];for(let i=0;i<64;i++){const page=await runtime.readingPage({ticket:opening2.reader.ticket,project:true});pages2.push(page);if(page.reader.coverage.complete)break;}
   const ref=pages2.find(page=>page.reader.text.startsWith('長文開頭')).reader.source.ref;
   const partial=project({...args,reading:opening2,previousPages:pages2,proposal:{version:6,plans:[{id:'long',ref,quote:'長文開頭',topic:'長文',aspect:'內容',temporalUse:'current'}],unknowns:[]}});
   assert.equal(partial.status,'partial');const view=partial.presentation.sourceContext;
   assert.equal(view.metadata.sources[0].formalRead.complete,true);assert.equal(view.metadata.sources[0].formalToolMaterial.complete,false);
   assert.equal(view.originalMessages.status,'unavailable');assert.equal(view.originalMessages.messages,null);assert.equal(view.originalMessages.unavailableSources[0].reason,'formal_tool_material_incomplete');
  });
  await check('撤權／OFF／Clean不從新視圖旁路讀原文',async()=>{
   await runtime.revokeReading({ticket:opening.reader.ticket,reason:'caller_revoked'});const revoked=await runtime.continuityStatus();assert.equal(revoked.status,'unavailable');assert.equal(revoked.presentation,undefined);
   await runtime.configureControls({updateId:'source-context-off',patch:{enabled:false},persist:false});assert.equal((await runtime.continuityStatus()).reason,'controls_disabled');
   await runtime.configureControls({updateId:'source-context-clean',patch:{enabled:true,clean:true},persist:false});assert.equal((await runtime.continuityStatus()).reason,'controls_disabled');
  });
 }finally{await runtime.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify({outcomes,closed:true,modelCalls:0},null,2)+'\n');}
});
