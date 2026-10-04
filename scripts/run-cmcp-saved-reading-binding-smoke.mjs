// 明示離線替身：只檢查已保存 User 查詢的自然時間閱讀綁定，不呼叫模型 API。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCmcpLocalInput} from '../src/cmcp-guard/cmcp-local-input.js';
import {createCmcpReactivationStores} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {cmcpSourcePointerKey} from '../src/cmcp-guard/cmcp-source-pointer.js';
import {loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';

const repo=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const parent=path.join(repo,'logs','public-tests');
await fs.mkdir(parent,{recursive:true});
const root=await fs.mkdtemp(path.join(parent,'saved-reading-binding-'));
const scopeId='offline-saved-reading-binding',timezone='Asia/Taipei';
const sourceAt='2026-09-23T01:00:00.000Z';
const queryAt='2026-09-23T02:00:00.000Z';
const operationAt='2026-09-23T02:05:00.000Z';
const original='The lantern room opens on Thursday only if the fire inspection passes.';
const question='請讀今天較早保存的燈籠室原句，不要用目前這一句查詢當來源。';
const selected=[];
const adapter={async request(purpose,input){
  assert.equal(purpose,'temporal_read_select');
  selected.push(structuredClone(input));
  assert.equal(input.question,question);
  return {value:{version:2,eventRefs:[],scope:{basis:'message_time',calendarRanges:[{
    fromLocal:'2026-09-23T00:00:00',toLocal:'2026-09-24T00:00:00',timezone}]},clarification:''},transport:{kind:'offline_fixture'}};
}};
const local=await createCmcpLocalInput({root,scopeId,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:4096,maxProjectionBytes:12000},
  loopTiming:{ttlMs:12*60*60*1000,inactivityMs:60000,activityWindowMs:12*60*60*1000},
  storageCapacity:{maxSources:64,maxSourceBytes:4096},adapter,
  delivery:{async present(){throw Error('pure_read_must_not_present_answer');}},clock:()=>operationAt});
const originalStore=createCmcpReactivationStores({root,scopeId}).history;
async function sources(){const listed=await originalStore.listPointers({scopeId,maxRecords:64});
  assert.equal(listed.status,'complete');return listed.pointers;}
const record={kind:'CMCP_SAVED_READING_BINDING_OFFLINE',root,case:'same_saved_user_query_natural_time'};
try{
  const earlier=await local.ingest({text:original,role:'assistant',messageRecordedAt:sourceAt});
  const query=await local.ingest({text:question,role:'user',messageRecordedAt:queryAt});
  const before=await sources();
  assert.equal(before.length,2);
  const opened=await local.readingOpen({text:question,mode:'all',ticket:randomUUID(),naturalTime:true,
    savedQueryPointer:query.pointer,limits:{maxSources:8,maxTotalBytes:10000,maxPageBytes:4096,maxPages:8,maxProjectionBytes:6000}});
  assert.equal(opened.reader.status,'ready',JSON.stringify(opened.reader));
  assert.equal(opened.internal.queryTime,queryAt,'閱讀應保留原 User 查詢時間，不採操作時鐘');
  assert.equal(cmcpSourcePointerKey(opened.internal.queryPointer),cmcpSourcePointerKey(query.pointer));
  assert.equal(opened.internal.queryHash,loopHash(query.evidence));
  assert.equal(opened.reader.collection.sourceCount,1,'目前查詢不得進入自身閱讀集合');
  const only=opened.reader.collection.sources[0];
  assert.equal(cmcpSourcePointerKey(opened.internal.manifest.sources[0].pointer),cmcpSourcePointerKey(earlier.pointer));
  assert.equal(only.sourceAuthorRole,'assistant');
  assert.equal(only.messageRecordedAt,sourceAt);
  assert.equal((await sources()).length,before.length,'已保存查詢重用不得再寫 User 來源');
  assert.equal(selected.length,1,'只需一次自然時間選取');
  assert.equal(selected[0].runtimeTime.now,queryAt,'模型導航的時間基準亦須使用原查詢時間');
  const page=await local.readingPage({openingResult:opened,previousPages:[],project:false});
  assert.equal(page.reader.text,original);
  assert.equal(page.reader.source.sourceAuthorRole,'assistant');
  assert.equal(page.reader.source.messageRecordedAt,sourceAt);
  const callsBefore=selected.length;
  await assert.rejects(local.readingOpen({text:question,mode:'all',ticket:randomUUID(),naturalTime:true,
    savedQueryPointer:{...query.pointer,revisionId:'forged-r2'},limits:{maxSources:8,maxTotalBytes:10000,maxPageBytes:4096,maxPages:8,maxProjectionBytes:6000}}),
    /reading_query_source_binding/);
  await assert.rejects(local.readingOpen({text:question+' changed',mode:'all',ticket:randomUUID(),naturalTime:true,
    savedQueryPointer:query.pointer,limits:{maxSources:8,maxTotalBytes:10000,maxPageBytes:4096,maxPages:8,maxProjectionBytes:6000}}),
    /reading_query_source_binding/);
  await assert.rejects(local.readingOpen({text:original,mode:'all',ticket:randomUUID(),naturalTime:true,
    savedQueryPointer:earlier.pointer,limits:{maxSources:8,maxTotalBytes:10000,maxPageBytes:4096,maxPages:8,maxProjectionBytes:6000}}),
    /reading_query_source_binding/);
  await assert.rejects(local.readingOpen({text:question,mode:'all',ticket:randomUUID(),naturalTime:false,
    savedQueryPointer:query.pointer,limits:{maxSources:8,maxTotalBytes:10000,maxPageBytes:4096,maxPages:8,maxProjectionBytes:6000}}),
    /saved_reading_query_requires_inventory_or_natural_navigation/);
  assert.equal(selected.length,callsBefore,'失效綁定不得送出語義選取');
  assert.equal((await sources()).length,before.length,'拒絕後不得暗中保存另一筆 User');
  Object.assign(record,{status:'PASS',savedQueryPointer:query.pointer,queryTime:opened.internal.queryTime,
    operationClock:operationAt,readSourcePointer:opened.internal.manifest.sources[0].pointer,readRole:only.sourceAuthorRole,readTime:only.messageRecordedAt,
    selectedCalls:selected.length,sourceCountBefore:before.length,sourceCountAfter:(await sources()).length,
    forgedStaleAndRoleRejected:true,exactPageBytes:Buffer.byteLength(page.reader.text)});
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(record));
}catch(error){Object.assign(record,{status:'FAIL',error:error.stack});
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  console.error(JSON.stringify(record));process.exitCode=1;}
finally{await local.close();}
