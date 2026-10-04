// 明示合成 reader 頁、歷史來源與分類替身；不讀私人資料、不呼叫模型。
import assert from 'node:assert/strict';
import {loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {createCmcpSourceEvidence} from '../src/cmcp-guard/cmcp-source-evidence.js';
import {CMCP_HISTORY_CAPABILITIES} from '../src/cmcp-guard/cmcp-history-provider.js';
import {createCmcpHistoryQueryRuntime} from '../src/cmcp-guard/cmcp-history-query-runtime.js';
import {prepareCmcpHistoryAggregateBatch,acceptCmcpHistoryAggregateBatch} from '../src/cmcp-guard/cmcp-history-aggregation.js';

const scopeId='synthetic-reply-projection',ticket='synthetic-reply-ticket',question='比較前後兩稿與我的要求。';
const now='2026-09-28T00:00:00.000Z',roles=['user','assistant','user','assistant'];
const texts=['請草擬通知：上線前須核准，還不是正式決定。','第一稿：核准後才上線，目前仍是計畫。','把審核改為安全審查，其餘條件保留。','修訂稿：安全審查核准後才上線，仍是計畫。'];
const pointer=itemId=>({version:1,providerNamespace:'cmcp-local-console-v1',scopeId,itemId,sessionId:'synthetic-session',revisionId:'r1'});
const query=createCmcpSourceEvidence({pointer:pointer('query'),sourceKind:'message',sourceAuthorRole:'user',messageRecordedAt:now,eventOccurredAt:null,content:{kind:'source_excerpt',body:question}});
const originals=texts.map((body,i)=>createCmcpSourceEvidence({pointer:pointer('s'+i),sourceKind:'message',sourceAuthorRole:roles[i],messageRecordedAt:now,eventOccurredAt:null,content:{kind:'source_excerpt',body}}));
const sources=originals.map((e,i)=>({ref:'r'+(i+1),pointer:e.pointer,evidenceHash:loopHash(e),sourceAuthorRole:e.sourceAuthorRole,sourceKind:'message',contentKind:'source_excerpt',
  messageRecordedAt:now,eventOccurredAt:null,codePoints:[...texts[i]].length,entry:{pointer:e.pointer,evidenceHash:loopHash(e)}}));
const manifest={kind:'cmcp_reading_manifest',version:1,scopeId,ticket,mode:'all',openedAt:now,timezone:'UTC',queryPointer:query.pointer,
  queryHash:loopHash(query),queryTime:now,bufferGeneration:0,expiry:null,limits:{maxSources:4,maxTotalBytes:8192,maxPageBytes:4096,maxPages:4,maxProjectionBytes:8192},
  sources,eventSnapshots:[],scopeCoverage:'frozen_registered_authorized_ordinary_sources',associationCompleteness:'catalog_associations_only'};
const manifestHash=loopHash(manifest),reading={reader:{ticket,manifestHash,status:'ready'},internal:{manifest,manifestHash,queryPointer:query.pointer,queryHash:manifest.queryHash,queryTime:now}};
const pages=[];let progress={sourceIndex:0,offset:0,pages:0,sourceBytes:0,projectionBytes:0,completed:[],unavailable:[],activatedRefs:[]};
for(const [i,source] of sources.entries()){
  const before=structuredClone(progress),range={unit:'unicode_code_points',start:0,end:source.codePoints};
  progress={...progress,sourceIndex:i+1,pages:i+1,sourceBytes:progress.sourceBytes+Buffer.byteLength(texts[i]),completed:[...progress.completed,source.ref]};
  const reader={ticket,pageNumber:i+1,source:{ref:source.ref},text:texts[i],range,sourceAvailability:'available',coverage:{complete:i===3,exhausted:i===3,
    sourceCount:4,completedSources:i+1,completedRefs:[...progress.completed],unavailableSources:0,unavailable:[],unread:sources.slice(i+1).map(x=>({ref:x.ref,start:0,end:x.codePoints})),
    cumulative:{pages:i+1,sourceBytes:progress.sourceBytes,projectionBytes:0},scopeCoverage:manifest.scopeCoverage,associationCompleteness:manifest.associationCompleteness,semanticCompleteness:'not_inferred_from_character_coverage'}};
  const internal={manifestHash,pageNumber:i+1,before,after:structuredClone(progress),bufferGeneration:0,queryPointer:query.pointer,
    readRanges:[{pointer:source.pointer,evidenceHash:source.evidenceHash,location:range}],bufferActivated:false};
  internal.pageHash=loopHash({reader,modelContext:null,internal});pages.push({reader,modelContext:null,internal});
}
const batch=prepareCmcpHistoryAggregateBatch({reading,pages,scopeId,question,purpose:'evidence_lookup',maxBatchSources:4,maxInputBytes:12000});
const classification=acceptCmcpHistoryAggregateBatch({batch,reading,pages,scopeId,value:{rows:sources.map((s,i)=>({ref:s.ref,kind:roles[i]==='user'?'user_intent':'assistant_authored_text',quote:texts[i],evidenceStatus:'supports_requested_detail'}))}});
const values=[{stage:'started',questionHash:loopHash(question),purpose:'evidence_lookup'},{stage:'opened',reading},...pages.map(page=>({stage:'page',page})),
  {stage:'batch_accepted',classification},{stage:'completed',status:'complete',result:{}}];
const records=values.map(value=>({record:{kind:'cmcp_history_query_v1',value:{scopeId,requestId:ticket,recordedAt:now,...value}}}));
const binding=(a,u)=>({version:1,pointer:originals[a].pointer,sourceHash:loopHash(originals[a]),replyTo:originals[u].pointer,
  replyToEvidenceHash:loopHash(originals[u]),eventKey:null,eventVersion:null,bufferGeneration:0,basis:'runtime_observed_answer_to_exact_user_source'});
const expected=[{assistantRef:'r2',userRef:'r1',assistantEvidenceHash:loopHash(originals[1]),userEvidenceHash:loopHash(originals[0]),basis:'runtime_observed_answer_to_exact_user_source'},
  {assistantRef:'r4',userRef:'r3',assistantEvidenceHash:loopHash(originals[3]),userEvidenceHash:loopHash(originals[2]),basis:'runtime_observed_answer_to_exact_user_source'}];
let apiCalls=0,writes=0;
function runtime({getReplyBindings,valid=async()=>true,publication=async()=>({status:'verified'})}={}){
  return createCmcpHistoryQueryRuntime({scopeId,journal:{read:async()=>structuredClone(records),append:async()=>{writes++;throw Error('唯讀操作不得追加');}},
    historyProvider:{descriptor:{providerNamespace:'cmcp-local-console-v1'},capabilities:Object.fromEntries(CMCP_HISTORY_CAPABILITIES.map(k=>[k,true])),
      resolve:async pointer=>({status:'found',pointer,evidence:query})},readingOpen:async()=>{throw Error('不得開新閱讀');},readingPage:async()=>{throw Error('不得讀新頁');},
    adapter:{request:async()=>{apiCalls++;throw Error('不得呼叫模型');}},validatePublication:publication,valid,now:()=>now,...(getReplyBindings?{getReplyBindings}:{})});
}
const cases=[];
async function check(name,bindings,expectedPairs){
  const got=await runtime({getReplyBindings:async()=>bindings}).verifiedReadSources(ticket);
  assert.deepEqual(got.replyBindings,expectedPairs);assert.equal(got.sources.length,4);cases.push({name,status:'PASS'});
}
await check('正式兩對關聯', [binding(1,0),binding(3,2)],expected);
await check('相同Session與時間不建立關聯',[],[]);
await check('Assistant端hash變更不推導',[{...binding(1,0),sourceHash:loopHash('changed')}],[]);
await check('User端hash變更不推導',[{...binding(1,0),replyToEvidenceHash:loopHash('changed')}],[]);
await check('錯誤角色不推導',[binding(0,1)],[]);
await check('跨scope不推導',[{...binding(1,0),replyTo:{...originals[0].pointer,scopeId:'different'}}],[]);
await check('原版本改變不推導',[{...binding(1,0),pointer:{...originals[1].pointer,revisionId:'r2'}}],[]);
await check('兩個有效但衝突的父來源均不推導',[binding(1,0),binding(1,2)],[]);
await check('相同binding重播去重',[binding(1,0),binding(1,0)],[expected[0]]);
const legacy=await runtime().verifiedReadSources(ticket);assert.deepEqual(legacy.replyBindings,[]);cases.push({name:'無新依賴的舊資料相容',status:'PASS'});
for(const name of ['晚到OFF','晚到Clear','晚到取消']){
  let allowed=true,release,entered;const gate=new Promise(resolve=>{release=resolve;}),entry=new Promise(resolve=>{entered=resolve;});
  const pending=runtime({valid:async()=>allowed,getReplyBindings:async()=>{entered();await gate;return [binding(1,0)];}}).verifiedReadSources(ticket);
  await entry;allowed=false;release();await assert.rejects(pending,/history_query_cancelled_or_disabled/);cases.push({name,status:'PASS'});
}
let sourceChanged=false;
await assert.rejects(runtime({getReplyBindings:async()=>{sourceChanged=true;return [binding(1,0)];},publication:async()=>({status:sourceChanged?'source_unavailable':'verified'})}).verifiedReadSources(ticket),/history_query_projection_source_unavailable/);
cases.push({name:'關聯取得後來源變動仍由正式publication阻止',status:'PASS'});
const reopened=await runtime({getReplyBindings:async()=>[binding(1,0),binding(3,2)]}).verifiedReadSources(ticket);assert.deepEqual(reopened.replyBindings,expected);cases.push({name:'新Runtime讀相同journal可重建關聯',status:'PASS'});
assert.equal(apiCalls,0);assert.equal(writes,0);
console.log(JSON.stringify({status:'PASS',checks:cases.length,productApiPosts:apiCalls,journalWrites:writes,cases,
  boundary:'明示合成守護與新Runtime重建；未宣稱真程序重開或真模型語義'},null,2));
