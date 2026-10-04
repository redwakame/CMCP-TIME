// 明示合成原文及時鐘；正式 History／catalog／reading，零模型、無常駐。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCmcpReactivationStores,createCmcpTemporalSourceCatalog} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {createCmcpSourceEvidence} from '../src/cmcp-guard/cmcp-source-evidence.js';
import {openCmcpReadingCollection,validateCmcpReadingPublication} from '../src/cmcp-guard/cmcp-reading.js';
import {loopHash,createLocalLoopJournal} from '../src/cmcp-guard/cmcp-local-loop-journal.js';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const parent=path.join(project,'logs','public-tests');await fs.mkdir(parent,{recursive:true});
const root=await fs.mkdtemp(path.join(parent,'publication-boundary-'));
const now='2026-09-28T00:00:00.000Z',scopeId='synthetic-publication-boundary',providerNamespace='cmcp-local-console-v1';
const cases=[];
async function fixture(label){
  const stores=createCmcpReactivationStores({root:path.join(root,label),scopeId});
  const catalog=createCmcpTemporalSourceCatalog({stores,maxEntries:8});
  const evidence=(id,role,body,time)=>createCmcpSourceEvidence({pointer:{version:1,providerNamespace,scopeId,sessionId:'synthetic-session',itemId:id,revisionId:'r1'},
    sourceKind:'message',sourceAuthorRole:role,messageRecordedAt:time,eventOccurredAt:null,content:{kind:'source_excerpt',body}});
  const query=evidence('query','user','比較先前原稿與修訂。',now);
  const originals=[evidence('u1','user','請擬原稿：須核准才發布，尚未核准。','2026-09-27T23:50:00.000Z'),
    evidence('a1','assistant','原稿提案：核准後發布。','2026-09-27T23:50:02.000Z'),
    evidence('u2','user','只把核准者改成安全小組，其餘限制保留。','2026-09-27T23:55:00.000Z'),
    evidence('a2','assistant','修訂提案：安全小組核准後發布。','2026-09-27T23:55:02.000Z')];
  for(const source of [query,...originals])await stores.history.writeEvidence(source);
  const entries=[];for(const source of originals)entries.push((await catalog.registerSource({pointer:source.pointer})).entry);
  const refs=entries.map((_,i)=>'r'+(i+1));
  const candidates={host:{ticket:'synthetic-'+label},internal:{queryPointer:query.pointer,queryHash:loopHash(query),queryTime:now,
    sourceMap:entries.map((entry,i)=>({ref:refs[i],id:entry.id,pointer:entry.pointer,evidenceHash:entry.evidenceHash}))}};
  const reading=await openCmcpReadingCollection({stores,catalog,events:[],candidates,selection:{status:'selected',refs},mode:'all',
    limits:{maxSources:8,maxTotalBytes:8192,maxPageBytes:4096,maxPages:8,maxProjectionBytes:8192},timeContext:{now,timezone:'UTC'},
    bufferGeneration:0,ttlMs:3600000,scopeDescriptor:{kind:'authorized_history_inventory'}});
  const invoke=(overrides={})=>validateCmcpReadingPublication({stores,catalog,reading,timeContext:{now,timezone:'UTC'},bufferGeneration:0,sourceRefs:refs,...overrides});
  const clear=()=>createLocalLoopJournal({root:path.join(stores.root,'input-journal'),name:'cmcp-common-input-v1'}).append('buffer_clear',{scopeId,generation:1,clearedAt:'2026-09-28T00:00:01.000Z'});
  const wrap=action=>({...stores,history:{...stores.history,resolve:async pointer=>action(pointer,await stores.history.resolve(pointer))}});
  return {stores,catalog,reading,query,originals,refs,invoke,clear,wrap};
}
async function test(name,run){await run();cases.push({name,status:'PASS'});}
await test('每個正式原件均重讀，保留角色、原時間、版本與完整bytes',async()=>{
  const f=await fixture('all-sources'),reads=[];
  const got=await f.invoke({stores:f.wrap(async(pointer,result)=>{reads.push(pointer.itemId);return result;})});
  assert.equal(got.status,'verified');assert.deepEqual(got.verified,f.refs);assert.deepEqual(reads,['query','u1','a1','u2','a2']);
  assert.equal(got.materializedSourceBytes,f.originals.reduce((sum,e)=>sum+Buffer.byteLength(e.content.body),0));
  for(const [i,e] of f.originals.entries()){
    const source=f.reading.internal.manifest.sources[i];assert.deepEqual(source.pointer,e.pointer);assert.equal(source.evidenceHash,loopHash(e));
    assert.equal(source.sourceAuthorRole,e.sourceAuthorRole);assert.equal(source.messageRecordedAt,e.messageRecordedAt);
    assert.deepEqual((await f.stores.history.resolve(e.pointer)).evidence,e);
  }
});
await test('同Runtime途中取消即停止，後續來源不繼續讀',async()=>{
  const f=await fixture('cancel-mid'),reads=[];let allowed=true;
  await assert.rejects(f.invoke({valid:async()=>allowed,stores:f.wrap(async(pointer,result)=>{reads.push(pointer.itemId);if(pointer.itemId==='a1')allowed=false;return result;})}),/reading_cancelled/);
  assert.deepEqual(reads,['query','u1','a1']);
});
await test('最後來源後另一journal寫入Clear，即使memory有效也在出口拒絕',async()=>{
  const f=await fixture('clear-at-exit');let didClear=false;
  await assert.rejects(f.invoke({valid:async()=>true,stores:f.wrap(async(pointer,result)=>{if(pointer.itemId==='a2'){await f.clear();didClear=true;}return result;})}),/buffer_cleared_during_operation/);
  assert.equal(didClear,true);
});
await test('預先Clear在讀取原文前拒絕',async()=>{
  const f=await fixture('preclear');await f.clear();let reads=0;
  await assert.rejects(f.invoke({stores:f.wrap(async(_,result)=>{reads++;return result;})}),/buffer_cleared_during_operation/);assert.equal(reads,0);
});
await test('票券到期在讀取原文前拒絕',async()=>{
  const f=await fixture('expiry');let reads=0;
  await assert.rejects(f.invoke({timeContext:{now:'2026-09-28T01:00:00.000Z',timezone:'UTC'},stores:f.wrap(async(_,result)=>{reads++;return result;})}),/reading_expired/);assert.equal(reads,0);
});
for(const [label,change] of [['body',e=>({...e,content:{...e.content,body:e.content.body+'（變更）'}})],
  ['role',e=>({...e,sourceAuthorRole:'user'})],['time',e=>({...e,messageRecordedAt:'2026-09-27T23:56:00.000Z'})],
  ['event-time',e=>({...e,eventOccurredAt:'2026-09-27T20:00:00.000Z'})]]){
  await test('來源'+label+'改變不得使用凍結原件',async()=>{
    const f=await fixture('source-'+label);
    const got=await f.invoke({stores:f.wrap(async(pointer,result)=>pointer.itemId==='a1'?{...result,evidence:createCmcpSourceEvidence(change(result.evidence))}:result)});
    assert.equal(got.status,'source_unavailable');assert.deepEqual(got.unavailable,[{ref:'r2',reason:'source_changed'}]);assert.deepEqual(got.verified,['r1','r3','r4']);
  });
}
await test('來源遺失明列unavailable而不標全verified',async()=>{
  const f=await fixture('missing');const got=await f.invoke({stores:f.wrap(async(pointer,result)=>pointer.itemId==='a1'?{status:'missing',pointer}:result)});
  assert.equal(got.status,'source_unavailable');assert.deepEqual(got.unavailable,[{ref:'r2',reason:'source_missing'}]);
});
await test('catalog版本改變在resolve前攔截該來源',async()=>{
  const f=await fixture('catalog-change'),reads=[];
  const got=await f.invoke({catalog:{...f.catalog,list:async()=>(await f.catalog.list()).map((entry,i)=>i===1?{...entry,evidenceHash:loopHash('changed')}:entry)},
    stores:f.wrap(async(pointer,result)=>{reads.push(pointer.itemId);return result;})});
  assert.equal(got.status,'source_unavailable');assert.deepEqual(got.unavailable,[{ref:'r2',reason:'source_index_changed'}]);assert.equal(reads.includes('a1'),false);
});
await test('查詢原文更改使整批失效',async()=>{
  const f=await fixture('query-change');await assert.rejects(f.invoke({stores:f.wrap(async(pointer,result)=>pointer.itemId==='query'?{...result,evidence:createCmcpSourceEvidence({...result.evidence,content:{kind:'source_excerpt',body:'另一個問題'}})}:result)}),/reading_query_unavailable_or_changed/);
});
await test('新Runtime重新讀相同正式資料仍可驗證，不寫History或活化Buffer',async()=>{
  const f=await fixture('reopen'),stores=createCmcpReactivationStores({root:f.stores.root,scopeId}),catalog=createCmcpTemporalSourceCatalog({stores,maxEntries:8});
  const before=await stores.history.listPointers({scopeId,maxRecords:8}),got=await f.invoke({stores,catalog}),after=await stores.history.listPointers({scopeId,maxRecords:8});
  assert.equal(got.status,'verified');assert.deepEqual(after,before);
  await assert.rejects(fs.readdir(path.join(stores.root,'input-journal')),error=>error.code==='ENOENT');
});
const result={status:'PASS',checks:cases.length,productApiPosts:0,hostModelCalls:0,fixtureRoot:path.relative(project,root).replaceAll('\\','/'),
  boundary:'合成時鐘；正式保存／登錄／開啟；來源異動由provider測試替身模擬，未改寫原件；重開為新Runtime非新程序。',cases};
await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
