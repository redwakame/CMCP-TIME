// 本單明示合成資料／時鐘／reader；驗證正式頁編排，未呼叫 API。
import assert from 'node:assert/strict';
import {loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {createCmcpSourceEvidence} from '../src/cmcp-guard/cmcp-source-evidence.js';
import {CMCP_HISTORY_CAPABILITIES} from '../src/cmcp-guard/cmcp-history-provider.js';
import {createCmcpHistoryQueryRuntime} from '../src/cmcp-guard/cmcp-history-query-runtime.js';

const scopeId='synthetic-original-navigation',ticket='synthetic-navigation-ticket',question='比較最初通知和後來修訂，保留前提。';
const now='2026-09-28T00:00:00.000Z',roles=['user','assistant','user','assistant'];
const defaults=['初稿週三，須核准，僅為提案。','第一稿：週三核准後才上線，目前仍是計畫。','改週五與安全審查，不可宣称已核准。','修訂稿：週五且安全審查核准後才上線，仍是計畫。'];
const pointer=itemId=>({version:1,providerNamespace:'cmcp-local-console-v1',scopeId,itemId,sessionId:'synthetic-session',revisionId:'r1'});
function fixture(texts=defaults){
  const query=createCmcpSourceEvidence({pointer:pointer('query'),sourceKind:'message',sourceAuthorRole:'user',messageRecordedAt:now,eventOccurredAt:null,content:{kind:'source_excerpt',body:question}});
  const originals=texts.map((body,i)=>createCmcpSourceEvidence({pointer:pointer('s'+i),sourceKind:'message',sourceAuthorRole:roles[i],messageRecordedAt:now,eventOccurredAt:null,content:{kind:'source_excerpt',body}}));
  const sources=originals.map((e,i)=>({ref:'r'+(i+1),pointer:e.pointer,evidenceHash:loopHash(e),sourceAuthorRole:e.sourceAuthorRole,sourceKind:'message',contentKind:'source_excerpt',
    messageRecordedAt:now,eventOccurredAt:null,codePoints:Array.from(texts[i]).length,entry:{pointer:e.pointer,evidenceHash:loopHash(e)}}));
  const limits={maxSources:4,maxTotalBytes:32768,maxPageBytes:4096,maxPages:12,maxProjectionBytes:8192};
  const manifest={kind:'cmcp_reading_manifest',version:1,scopeId,ticket,mode:'all',openedAt:now,timezone:'UTC',queryPointer:query.pointer,
    queryHash:loopHash(query),queryTime:now,bufferGeneration:0,expiry:null,limits,sources,eventSnapshots:[],scopeCoverage:'frozen_registered_authorized_ordinary_sources',associationCompleteness:'catalog_associations_only'};
  const manifestHash=loopHash(manifest),reading={reader:{ticket,manifestHash,status:'ready'},internal:{manifest,manifestHash,queryPointer:query.pointer,queryHash:manifest.queryHash,queryTime:now}};
  const pages=[];let progress={sourceIndex:0,offset:0,pages:0,sourceBytes:0,projectionBytes:0,completed:[],unavailable:[],activatedRefs:[]};
  for(const [i,source] of sources.entries()){
    const chars=Array.from(texts[i]);let offset=0;
    while(offset<chars.length){
      const before=structuredClone(progress),start=offset;let body='',bytes=0;
      while(offset<chars.length&&bytes+Buffer.byteLength(chars[offset])<=limits.maxPageBytes){body+=chars[offset];bytes+=Buffer.byteLength(chars[offset++]);}
      const done=offset===chars.length,range={unit:'unicode_code_points',start,end:offset};
      progress={...progress,sourceIndex:done?i+1:i,offset:done?0:offset,pages:pages.length+1,sourceBytes:progress.sourceBytes+bytes,completed:done?[...progress.completed,source.ref]:progress.completed};
      const reader={ticket,pageNumber:pages.length+1,source:{ref:source.ref},text:body,range,sourceAvailability:'available',coverage:{complete:done&&i===3,exhausted:done&&i===3,
        sourceCount:4,completedSources:progress.completed.length,completedRefs:[...progress.completed],unavailableSources:0,unavailable:[],unread:sources.slice(progress.sourceIndex).map((s,n)=>({ref:s.ref,start:n?0:progress.offset,end:s.codePoints})),
        cumulative:{pages:pages.length+1,sourceBytes:progress.sourceBytes,projectionBytes:0},scopeCoverage:manifest.scopeCoverage,associationCompleteness:manifest.associationCompleteness,semanticCompleteness:'not_inferred_from_character_coverage'}};
      const internal={manifestHash,pageNumber:pages.length+1,before,after:structuredClone(progress),bufferGeneration:0,queryPointer:query.pointer,
        readRanges:[{pointer:source.pointer,evidenceHash:source.evidenceHash,location:range}],bufferActivated:false};
      internal.pageHash=loopHash({reader,modelContext:null,internal});pages.push({reader,modelContext:null,internal});
    }
  }
  const journalRows=[],stats={requests:0,pages:[],activations:[]};let allowed=true,publication='verified',remaining=Infinity,onRead=null,onActivation=null;
  const runtime=()=>createCmcpHistoryQueryRuntime({scopeId,journal:{read:async()=>structuredClone(journalRows),append:async(kind,value)=>{const row={record:{kind,value}};journalRows.push(structuredClone(row));return row;}},
    historyProvider:{descriptor:{providerNamespace:'cmcp-local-console-v1'},capabilities:Object.fromEntries(CMCP_HISTORY_CAPABILITIES.map(k=>[k,true])),resolve:async p=>({status:'found',pointer:p,evidence:query})},
    readingOpen:async()=>structuredClone(reading),readingPage:async({previousPages,project,activateBuffer})=>{assert.equal(project,false);assert.equal(activateBuffer,false);const page=structuredClone(pages[previousPages.length]);stats.pages.push(page.reader.pageNumber);await onRead?.(page);return page;},
    adapter:{request:async(purpose,input)=>{stats.requests++;assert.equal(purpose,'history_aggregate');return {value:{rows:input.sources.map(s=>({ref:s.ref,kind:s.sourceAuthorRole==='user'?'user_report':'assistant_authored_text',quote:s.text,claimMatch:s.sourceAuthorRole==='user'?'affirmed':'not_asserted'}))}};}},
    validatePublication:async()=>({status:publication}),valid:async()=>allowed,now:()=>now,remainingWorkMs:()=>remaining,
    activateMatches:async({refs,reading,operationValid=async()=>true})=>{await onActivation?.();if(!await operationValid()||!allowed)throw Error('activation_cancelled');stats.activations.push({refs,queryTime:reading.internal.manifest.queryTime});return {status:'activated',refs};}});
  const runOptions={requestId:ticket,text:question,purpose:'evidence_lookup',originalMaterialNavigation:true,readingLimits:limits,executionBudget:{maxBatchesPerExecution:1,reserveMs:0,requestTimeoutMs:90000}};
  return {runtime,runOptions,stats,journalRows,manifest,query,setAllowed:value=>{allowed=value;},setPublication:value=>{publication=value;},setRemaining:value=>{remaining=value;},onRead:value=>{onRead=value;},onActivation:value=>{onActivation=value;}};
}
const cases=[];async function test(name,fn){await fn();cases.push({name,status:'PASS'});}
await test('四筆正式頁全讀而不執行 aggregate、不活化候選',async()=>{
  const f=fixture(),q=f.runtime(),result=await q.run(f.runOptions);
  assert.equal(result.modelCalls,0);assert.equal(f.stats.requests,0);assert.equal(f.stats.activations.length,0);assert.deepEqual(f.stats.pages,[1,2,3,4]);
  assert.equal(result.aggregate.navigationOnly,true);assert.equal(result.aggregate.status,'partial');assert.equal(result.aggregate.coverage.complete,true);
  assert.equal(result.aggregate.coverage.unclassified.length,4);assert.equal(result.aggregate.semanticVerification,'not_classified_navigation_only');
  assert.ok(result.aggregate.evidence.every(e=>e.supportRelation==='unclassified_original_material'));assert.equal((await q.verifiedReadSources(ticket)).sources.length,4);assert.equal(await q.verify(ticket),true);
});
await test('只活化已選原件，原queryTime不變，重播不重做',async()=>{
  const f=fixture(),q=f.runtime();await q.run(f.runOptions);
  await q.activateSelectedMaterials(ticket,['r2','r4']);await q.activateSelectedMaterials(ticket,['r2','r4']);
  assert.deepEqual(f.stats.activations,[{refs:['r2','r4'],queryTime:now}]);
  await assert.rejects(q.activateSelectedMaterials(ticket,['r9']),/invalid_selected_material_refs/);
  const replay=await q.run(f.runOptions);assert.equal(replay.replayed,true);assert.equal(replay.modelCalls,0);assert.deepEqual(f.stats.pages,[1,2,3,4]);
});
await test('新Runtime可驗原文但恢復不能補活化',async()=>{
  const f=fixture(),q=f.runtime();await q.run(f.runOptions);const reopened=f.runtime();
  assert.equal((await reopened.verifiedReadSources(ticket)).sources.length,4);assert.equal(await reopened.verify(ticket),true);
  assert.equal((await reopened.activateSelectedMaterials(ticket,['r2'])).reason,'recovery_does_not_refresh_activity');assert.equal(f.stats.activations.length,0);
});
await test('同ID不能在語意分類與原件導航間偷換模式',async()=>{
  const f=fixture(),q=f.runtime();await q.run(f.runOptions);await assert.rejects(q.run({...f.runOptions,originalMaterialNavigation:false}),/history_query_id_conflict/);
  await assert.rejects(fixture().runtime().run({...f.runOptions,purpose:'report_count'}),/invalid_original_material_navigation_mode/);
});
for(const boundary of ['OFF','Clear','取消'])await test(`晚到頁面遇${boundary}不留正式頁、不活化`,async()=>{
  const f=fixture(),q=f.runtime();f.onRead(()=>f.setAllowed(false));await assert.rejects(q.run(f.runOptions),/history_query_cancelled_or_disabled/);
  assert.equal(f.journalRows.filter(r=>r.record.value.stage==='page').length,0);assert.equal(f.stats.activations.length,0);assert.equal(f.stats.requests,0);
});
await test('operationValid只限本次，選後停用不可活化',async()=>{
  const f=fixture(),q=f.runtime();await q.run(f.runOptions);await assert.rejects(q.activateSelectedMaterials(ticket,['r2'],async()=>false),/history_query_cancelled_or_disabled/);assert.equal(f.stats.activations.length,0);
  let enabled=true;f.onActivation(()=>{enabled=false;});await assert.rejects(q.activateSelectedMaterials(ticket,['r2'],async()=>enabled),/activation_cancelled/);
  assert.equal((await q.activateSelectedMaterials(ticket,['r2'])).reason,'selected_material_activation_receipt_pending');assert.equal(f.stats.activations.length,0);
});
await test('來源變動阻止舊投影與選後活化',async()=>{
  const f=fixture(),q=f.runtime();await q.run(f.runOptions);f.setPublication('source_unavailable');
  assert.equal(await q.verify(ticket),false);await assert.rejects(q.verifiedReadSources(ticket),/history_query_projection_source_unavailable/);await assert.rejects(q.activateSelectedMaterials(ticket,['r2']),/history_query_projection_source_unavailable/);assert.equal(f.stats.activations.length,0);
});
await test('有界checkpoint新Runtime續頁沿同manifest與累計，恢復不活化',async()=>{
  const f=fixture(),q=f.runtime();f.onRead(page=>{if(page.reader.pageNumber===2)f.setRemaining(0);});const first=await q.run(f.runOptions);
  assert.equal(first.resumable,true);assert.equal(first.aggregate.coverage.completedSources,2);f.setRemaining(Infinity);f.onRead(null);
  const reopened=f.runtime(),second=await reopened.resume({requestId:ticket,executionBudget:f.runOptions.executionBudget});
  assert.equal(second.aggregate.coverage.completedSources,4);assert.deepEqual(f.stats.pages,[1,2,3,4]);assert.equal(second.aggregate.coverage.cumulative.pages,4);
  assert.equal((await reopened.activateSelectedMaterials(ticket,['r2','r4'])).reason,'recovery_does_not_refresh_activity');assert.equal(f.stats.requests,0);
});
await test('超單件4096 bytes仍正式全讀，僅導航部分且不冒充全文',async()=>{
  const f=fixture([defaults[0],'合成較長原稿。'.repeat(250),defaults[2],defaults[3]]),q=f.runtime(),result=await q.run(f.runOptions),row=result.aggregate.evidence.find(e=>e.ref==='r2');
  assert.equal(result.aggregate.coverage.completedSources,4);assert.equal(result.aggregate.coverage.cumulative.pages,5);assert.equal(row.completeBody,false);assert.ok(Buffer.byteLength(row.citation.text)<=4096);
  assert.deepEqual(result.aggregate.coverage.oversizedMaterialRefs,['r2']);assert.equal((await q.verifiedReadSources(ticket)).sources.some(s=>s.ref==='r2'),false);assert.equal(f.stats.requests,0);
});
await test('未選導航模式的既有報告計數仍走aggregate且保留角色',async()=>{
  const f=fixture(),result=await f.runtime().run({...f.runOptions,purpose:'report_count',originalMaterialNavigation:false});
  assert.equal(f.stats.requests,1);assert.equal(result.aggregate.observedReports,2);assert.deepEqual(result.aggregate.countedRefs,['r1','r3']);assert.equal(result.aggregate.navigationOnly,undefined);
});
console.log(JSON.stringify({status:'PASS',checks:cases.length,productApiPosts:0,cases,boundary:'合成離線reader與新Runtime物件；不冒稱真模型語意或真程序重開'},null,2));
