// 正常 general 回查的核驗組合測試：正式保存／reader／取消與來源守護；模型完全使用本機替身。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createCmcpLocalInput} from '../src/cmcp-guard/cmcp-local-input.js';
import {createCmcpReactivationStores,createCmcpTemporalSourceCatalog} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {createLocalLoopJournal} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
const repo=fileURLToPath(new URL('../',import.meta.url));
const base=path.resolve(process.env.CMCP_MATERIAL_VERIFIER_TEST_ROOT??path.join(repo,'logs/tests/material-verifier'));
const out=path.join(base,'run-'+randomUUID());await fs.mkdir(out,{recursive:true});
const now='2026-09-28T06:00:00.000Z',timezone='UTC',question='請比較前次原稿與修訂，分清我保留的限制與你的兩份草稿。';
const bodies=['請擬場館公告：週三開放，但須先獲消防核准；不能承諾提前開門。',
 '初稿：場館將在週三開放，前提是已獲消防核准。我們不承諾提前開門。',
 '請將原稿改成週五；消防核准與不承諾提前開門的限制都保留。',
 '修訂稿：場館預定週五開放，但必須先獲消防核准；不承諾提前開門。',
 '另一個倉庫週五送貨，等待收貨人簽收。','這是倉庫送貨安排，和場館開放不同。',
 '午餐想吃湯麵。','可以搭配蔬菜。'];
const cases=[];
const hashes=async()=>Object.fromEntries(await Promise.all(['src/cmcp-guard/cmcp-local-input.js',
 'src/cmcp-guard/cmcp-answer-material-selection.js','src/cmcp-guard/cmcp-history-query-runtime.js',
 'src/cmcp-guard/cmcp-reading.js','scripts/run-cmcp-material-verifier-composition-smoke.mjs'].map(async file=>[
 file,createHash('sha256').update(await fs.readFile(path.join(repo,file))).digest('hex')])));
const before=await hashes();
async function run(mode){
 const root=path.join(out,mode),scopeId='synthetic-material-verifier-'+mode;
 const stores=createCmcpReactivationStores({root,scopeId}),originalCatalog=createCmcpTemporalSourceCatalog({stores,maxEntries:32});
 let listCalls=0,corruptCatalog=false,local;const observed={purposes:[],selectionChecks:[],finalAnswers:0,presented:0};
 const catalog={...originalCatalog,list:async()=>{listCalls++;const entries=await originalCatalog.list();
  return corruptCatalog?entries.map((entry,index)=>index===0?{...entry,evidenceHash:'0'.repeat(64)}:entry):entries;}};
 const adapter={async request(purpose,input,options={}){
  observed.purposes.push(purpose);
  if(purpose==='recall_answer'&&input.probeHistoricalNeed)return {value:{text:'',sourceRefs:[],
   historyNeed:{basis:'prior_content_reference',quote:'前次原稿與修訂'}}};
  if(purpose==='temporal_read_select')return {value:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''}};
  if(purpose==='answer_material_select'){
   assert.equal(input.sources.length,8,'正式凍結集合包含全部八份已保存原文');
   for(let index=0;index<4;index++){
    const start=listCalls;assert.equal(await options.canAttempt(),true);
    observed.selectionChecks.push({callback:index+1,catalogListDelta:listCalls-start});
   }
   if(mode==='clear')await local.clearBuffer();
   if(mode==='source-change')corruptCatalog=true; // 明示 fixture 的目錄版本改變；不是手改真實 History。
   return {value:{status:'selected',refs:input.sources.slice(0,4).map(row=>row[0]),reason:'合成語義選取替身'}};
  }
  if(purpose==='recall_answer'&&input.context?.kind==='answer_history'){
   observed.finalAnswers++;
   const evidence=input.context.context.evidence;
   assert.deepEqual(evidence.map(row=>row.content.text),bodies.slice(0,4));
   assert.deepEqual(evidence.map(row=>row.sourceAuthorRole),['user','assistant','user','assistant']);
   return {value:{text:'已依四份合成原文比較：開放日更改，核准與不提前開門限制保留。',
    sourceRefs:evidence.map(row=>row.sourceRef),evidenceStatus:'sufficient'}};
  }
  throw Error('unexpected_model_task_'+purpose);
 }};
 local=await createCmcpLocalInput({root,scopeId,events:[],timezone,clock:()=>now,adapter,catalogDependency:catalog,
  limits:{maxEntries:12,maxCatalogBytes:7000,maxSources:2,maxSourceBytes:4096,maxProjectionBytes:8192},
  storageCapacity:{maxSources:32,maxSourceBytes:4096},answerHistory:{enabled:true},
  loopTiming:{ttlMs:43200000,inactivityMs:60000,activityWindowMs:43200000},
  delivery:{async present(){observed.presented++;return {status:'presented',channel:'synthetic'};}}});
 try{
  for(const [index,text] of bodies.entries())await local.ingest({text,role:index%2?'assistant':'user',
   messageRecordedAt:new Date(Date.parse(now)-60000+index*1000).toISOString()});
  let answer=null,error=null;
  try{answer=await local.submit({text:question});}catch(value){error=value.message;}
  assert.equal(observed.selectionChecks.length,4,'實際進入正常 general 選材分支');
  assert.deepEqual(observed.selectionChecks.map(row=>row.catalogListDelta),[1,1,1,1],
   '每一個 canAttempt 仍正式核驗來源，但不能巢狀重複做第二次 publication');
  const journal=createLocalLoopJournal({root:path.join(root,'input-journal'),name:'cmcp-common-input-v1'});
  const records=(await journal.read()).map(row=>row.record);
  const finalSelection=records.filter(row=>row.kind==='answer_material_selection');
  const inventory=await stores.history.listPointers({scopeId,maxRecords:32});
  if(mode==='normal'){
   assert.equal(error,null);assert.equal(answer.status,'answered');assert.ok(answer.answerPointer);
   assert.equal(observed.finalAnswers,1);assert.equal(observed.presented,1);assert.equal(finalSelection.length,1);
   const saved=await stores.history.resolve(answer.answerPointer);assert.equal(saved.evidence.content.body,answer.answer);
   assert.equal(inventory.pointers.length,10,'八原件＋本次 User＋正式 Assistant');
  }else{
   assert.match(error??'',/cancelled|changed|cleared/);assert.equal(answer,null);
   assert.equal(observed.finalAnswers,0);assert.equal(observed.presented,0);assert.equal(finalSelection.length,0);
   assert.equal(inventory.pointers.length,9,'取消／來源異動保留原件與本次 User，不保存晚到 Assistant');
   if(mode==='clear')assert.equal(local.bufferGeneration,1);
  }
  await fs.writeFile(path.join(root,'observed.json'),JSON.stringify({mode,error,answer,observed,finalSelectionCount:finalSelection.length,
   sourceCount:inventory.pointers.length,bufferGeneration:local.bufferGeneration},null,2)+'\n');
  return {mode,status:'PASS',error,selectionChecks:observed.selectionChecks,finalAnswers:observed.finalAnswers,
   sourceCount:inventory.pointers.length,productApiPosts:0};
 }finally{await local.close();}
}
for(const mode of ['normal','clear','source-change']){
 try{const result=await run(mode);cases.push(result);console.log(JSON.stringify(result));}
 catch(error){cases.push({mode,status:'FAIL',error:error.message,stack:error.stack});console.error(error.stack);}
}
const after=await hashes();
const result={kind:'正常回查核驗組合相連離線測試',at:new Date().toISOString(),productApiPosts:0,cases,versionBefore:before,versionAfter:after,
 limitations:'語義用明示替身；PASS 僅涵蓋正式保存、讀取、核驗組合與取消，不代替真模型語義。source-change 以注入目錄版本異動驗 current publication 守護。'};
await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({results:path.join(out,'results.json'),passed:cases.filter(row=>row.status==='PASS').length,failed:cases.filter(row=>row.status==='FAIL').length}));
process.exitCode=cases.some(row=>row.status==='FAIL')||JSON.stringify(before)!==JSON.stringify(after)?1:0;
