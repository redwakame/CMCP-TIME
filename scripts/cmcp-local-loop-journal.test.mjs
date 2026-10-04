import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCmcpFileHistoryBackend } from '../src/cmcp-guard/cmcp-file-history-backend.js';

// 僅使用合成日誌；不呼叫模型，不移除原件。前像可由環境變數指定。
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modulePath=process.env.CMCP_JOURNAL_UNDER_TEST
  ??path.join(repo,'src/cmcp-guard/cmcp-local-loop-journal.js');
const {createLocalLoopJournal,loopHash}=await import(pathToFileURL(modulePath));
const base=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(repo,'logs/tests/local-loop-journal'));
await fs.mkdir(base,{recursive:true});
const runRoot=await fs.mkdtemp(path.join(base,'run-'));
const observations=[];
globalThis.fetch=async()=>{throw Error('此離線驗證禁止網路與模型呼叫');};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const record=(name,value='合成資料')=>({name,sequence:0,previous:null,kind:'test',value});
const serialized=entry=>JSON.stringify({record:entry,sha256:loopHash(entry)});
const keyFor=name=>loopHash([name,0]);
const stats=row=>Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs','nlink'].map(key=>[key,String(row[key])]));
const fullSignature=row=>['dev','ino','size','mtimeNs','ctimeNs'].map(key=>String(row[key])).join(':');
async function fixture(name){
  const root=path.join(runRoot,name);await fs.mkdir(root,{recursive:true});
  return {name,root,journal:createLocalLoopJournal({root,name}),backend:createCmcpFileHistoryBackend({root}),target:path.join(root,keyFor(name)+'.json')};
}
test.after(async()=>{
  await fs.writeFile(path.join(runRoot,'observations.json'),JSON.stringify({modulePath,syntheticOnly:true,modelCalls:0,observations},null,2));
  console.log('合成原件：'+runRoot);
});

test('同程序不同 journal instance 的讀取須等候發布完成，不讀取仍待釋放的 link',async()=>{
  const f=await fixture('same-process'),entered=deferred(),release=deferred(),original=fs.unlink;
  const second=createLocalLoopJournal({root:f.root,name:f.name});let observed=false,publishing,reading;
  fs.unlink=async target=>{
    if(path.dirname(String(target))===f.root&&path.basename(String(target)).startsWith('.pending-')){
      entered.resolve();await release.promise;
    }
    return original(target);
  };
  try{
    publishing=f.journal.append('test',{text:'合成發布'});await entered.promise;
    reading=second.readIncremental().then(rows=>{observed=true;return rows;});
    await delay(25);
    const readCompletedBeforePublication=observed;
    release.resolve();const [entry,rows]=await Promise.all([publishing,reading]);
    observations.push({case:'same-process',readCompletedBeforePublication,rows:rows.length});
    assert.equal(readCompletedBeforePublication,false,'正式 append 尚未完成前，不應讓其他 instance 的快照穿越發布窗口');
    assert.equal(rows.length,1);assert.deepEqual(rows[0].record,entry);
  }finally{release.resolve();await Promise.allSettled([publishing,reading]);fs.unlink=original;}
});

test('新 row 的正常 link 釋放 ctime 變更可有限穩定重讀，正文及 chain 不變',async()=>{
  const f=await fixture('cross-process-publication'),entered=deferred(),release=deferred();
  const originalUnlink=fs.unlink,originalStat=fs.stat;let publishing,before,after,first=true,statCalls=0;
  fs.unlink=async target=>{
    if(path.dirname(String(target))===f.root&&path.basename(String(target)).startsWith('.pending-')){
      entered.resolve();await release.promise;
    }
    return originalUnlink(target);
  };
  try{
    // 直接使用正式 backend 模擬另一個程序，不經本程序 journal queue。
    publishing=f.backend.create(keyFor(f.name),serialized(record(f.name)));await entered.promise;
    fs.stat=async(target,options)=>{
      const value=await originalStat(target,options);
      if(path.resolve(String(target))===f.target&&options?.bigint){
        statCalls++;
        if(first){first=false;before=value;await delay(15);release.resolve();await publishing;after=await originalStat(target,options);}
      }
      return value;
    };
    let rows,error;
    try{rows=await f.journal.readIncremental();}catch(caught){error=caught;}
    observations.push({case:'cross-process-publication',before:stats(before),after:stats(after),statCalls,error:error?.message??null,rows:rows?.length??null});
    assert.equal(before.nlink,2n);assert.equal(after.nlink,1n);
    assert.notEqual(before.ctimeNs,after.ctimeNs,'試驗須實際跨過檔案系統時間刻度');
    assert.equal(before.dev,after.dev);assert.equal(before.ino,after.ino);assert.equal(before.size,after.size);assert.equal(before.mtimeNs,after.mtimeNs);
    assert.ifError(error);assert.equal(rows.length,1);assert.deepEqual(rows[0].record,record(f.name));
    assert.equal(statCalls,3,'一次初讀加一次穩定重讀；不可無限重試');
    assert.deepEqual(await f.journal.read(),rows);
  }finally{release.resolve();await Promise.allSettled([publishing]);fs.stat=originalStat;fs.unlink=originalUnlink;}
});

async function injectedRead(name,{mutateAfter,secondContent,unstableFinal=false}){
  const f=await fixture(name),entry=record(f.name);await f.backend.create(keyFor(f.name),serialized(entry));
  const originalStat=fs.stat,originalRead=fs.readFile,actual=await fs.stat(f.target,{bigint:true});let reads=0,statCalls=0;
  const before={...actual,nlink:2n},after={...actual,nlink:1n,ctimeNs:actual.ctimeNs+1n};mutateAfter?.(after);
  fs.stat=async(target,options)=>{
    if(path.resolve(String(target))===f.target&&options?.bigint){statCalls++;return statCalls===1?before:{...after,ctimeNs:after.ctimeNs+(unstableFinal&&statCalls>=3?1n:0n)};}
    return originalStat(target,options);
  };
  fs.readFile=async(target,options)=>{
    const value=await originalRead(target,options);
    if(path.resolve(String(target))===f.target){reads++;if(reads===2&&secondContent)return secondContent(f.name);}
    return value;
  };
  // Stats 是正式 fs.Stats instance 的欄位副本；保留必要型別查核。
  before.isFile=()=>true;after.isFile=()=>true;
  try{
    let error;try{await f.journal.readIncremental();}catch(caught){error=caught;}
    observations.push({case:name,statCalls,reads,error:error?.message??null,injectedMetadata:true});
    assert.ok(error,'異常資料不可被 publication 穩定重讀接受');
    assert.equal(error.message,'loop_journal_changed_during_read');
    return {reads,statCalls};
  }finally{fs.stat=originalStat;fs.readFile=originalRead;}
}

test('inode、size、mtime 改變均拒絕，不當成 ctime-only 正常釋放',async()=>{
  for(const field of ['ino','size','mtimeNs']){
    const result=await injectedRead('reject-'+field,{mutateAfter:row=>{row[field]+=1n;}});
    assert.equal(result.reads,1,'身分或寫入狀態改變時不可重讀放行');
  }
});

test('沒有 link 2→1 前提的 ctime 變更拒絕',async()=>{
  const result=await injectedRead('reject-unrelated-ctime',{mutateAfter:row=>{row.nlink=2n;}});
  assert.equal(result.reads,1);
});

test('有限重讀仍不穩定或正文 hash 不同均拒絕',async()=>{
  const unstable=await injectedRead('reject-unstable',{unstableFinal:true});assert.equal(unstable.reads,2);assert.equal(unstable.statCalls,3);
  const changed=await injectedRead('reject-content',{secondContent:name=>serialized(record(name,'另一筆合成資料'))});assert.equal(changed.reads,2);
});

test('已觀察 row 被合法外觀內容替換仍拒絕，chain 與格式核對保留',async()=>{
  const f=await fixture('old-row');await f.journal.append('test','第一筆合成');await f.journal.readIncremental();
  await fs.writeFile(f.target,serialized(record(f.name,'替換後的不同合成內容')));
  await assert.rejects(f.journal.readIncremental(),{message:'loop_journal_record_replaced'});
  const invalid=await fixture('invalid-chain');
  await invalid.backend.create(keyFor(invalid.name),serialized({...record(invalid.name),previous:'不合法的前項'}));
  await assert.rejects(invalid.journal.readIncremental(),{message:'loop_journal_chain_invalid'});
  const corrupt=await fixture('invalid-hash');
  await corrupt.backend.create(keyFor(corrupt.name),JSON.stringify({record:record(corrupt.name),sha256:'0'.repeat(64)}));
  await assert.rejects(corrupt.journal.readIncremental(),{message:'loop_journal_invalid'});
  observations.push({case:'immutable-and-chain',replacementRejected:true,brokenChainRejected:true,invalidHashRejected:true});
});
