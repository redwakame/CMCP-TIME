// 真 Bridge／Core 原件整合；只用本單合成資料，不啟動宿主、不呼叫網路／模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {CmcpHarnessBridge} from './runtime-bridge.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(repo,'logs/tests/media-bridge'));
await fs.mkdir(base,{recursive:true});const runRoot=await fs.mkdtemp(path.join(base,'run-')),open=new Set();
const originalFetch=globalThis.fetch;let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('媒體離線整合測試禁止網路');};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes){let n=0xffffffff;for(const byte of bytes)n=table[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function chunk(type,data){const head=Buffer.alloc(8),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);head.write(type,4);tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4),data])));return Buffer.concat([head,data,tail]);}
function png(color=[40,150,220]){const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,...color,...color]))),chunk('IEND',Buffer.alloc(0))]);}
async function fixture(label){const root=path.join(runRoot,label),scopeId='synthetic-media-bridge-'+label;await fs.mkdir(root,{recursive:true});
  const config={kind:'cmcp_runtime_config',version:1,runtimeId:scopeId,providerMode:'host',
    input:{root:path.join(root,'state'),scopeId,events:[],timezone:'Asia/Taipei',limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},
      storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
    receiptRoot:path.join(root,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
  const runtimeConfig=path.join(root,'runtime.json');await fs.writeFile(runtimeConfig,JSON.stringify(config),{flag:'wx'});
  const options={deploymentRoot:root,runtimeConfig,traceRoot:path.join(root,'trace'),scopeId};const create=()=>{const bridge=new CmcpHarnessBridge(options);open.add(bridge);return bridge;};
  return {root,scopeId,create,bridge:create()};}
async function close(bridge){await bridge.close();open.delete(bridge);}
const image={filename:'原始構圖.png',mimeType:'image/png',bytes:png()};
async function submit(bridge,messageId,text,attachment=image,time='2026-10-02T02:00:00.123Z',sessionId='synthetic-source-session'){
  const received=await bridge.receive(sessionId,messageId,text,time,attachment?[attachment]:[],()=>true);
  await bridge.claim(sessionId,messageId);const receipt=await bridge.complete(sessionId,'reply-'+messageId,'合成宿主原答：保留條件，不當成已定案。','2026-10-02T02:00:01.234Z');
  const status=await bridge.status(),source=status.registration.sources.find(row=>row.pointer.itemId==='harness-user-'+messageId);
  assert.ok(source,'正式 User 清冊應有來源');return {received,receipt,source};
}
async function patch(fixture,patch){const state=await fixture.bridge.status();await fixture.bridge.operate({scopeId:fixture.scopeId,generation:state.controlConfiguration.generation,action:'controls',patch});}
async function mediaFiles(root){const directory=path.join(root,'state','media-originals');try{const out={};for(const kind of ['blobs','records']){const folder=path.join(directory,kind);for(const name of await fs.readdir(folder))out[kind+'/'+name]=sha(await fs.readFile(path.join(folder,name)));}return out;}catch(error){if(error.code==='ENOENT')return {};throw error;}}

test('真保存兩輪後關閉／新 Bridge，以正式父原文取回兩張相似原件與不同原時間',async()=>{
  const fixtureValue=await fixture('cross-new-bridge'),first=await submit(fixtureValue.bridge,'first','這是佈置初稿，圖中藍色區塊；場地還沒確認，不要當成已定案。');
  const secondBytes=png([220,130,40]),second=await submit(fixtureValue.bridge,'second','後來修訂同一份佈置，換成橘色區塊；場地仍待書面同意。',{...image,bytes:secondBytes},'2026-10-02T02:10:00.456Z');
  await close(fixtureValue.bridge);const newBridge=fixtureValue.create();fixtureValue.bridge=newBridge;
  const ids=[];for(const [row,bytes,time]of [[first.source,image.bytes,'2026-10-02T02:00:00.123Z'],[second.source,secondBytes,'2026-10-02T02:10:00.456Z']]){
    const listed=await newBridge.mediaList({pointer:row.pointer,evidenceHash:row.evidenceHash},()=>true);assert.equal(listed.total,1);assert.equal(listed.source.sourceAuthorRole,'user');assert.equal(listed.source.messageRecordedAt,time);
    const media=listed.items[0];ids.push(media.mediaId);const read=await newBridge.mediaRead({pointer:row.pointer,evidenceHash:row.evidenceHash,mediaId:media.mediaId},()=>true);
    assert.equal(read.dataUrl,'data:image/png;base64,'+bytes.toString('base64'));assert.equal(read.metadata.sha256,sha(bytes));assert.equal(read.metadata.parent.messageRecordedAt,time);
  }
  assert.notEqual(ids[0],ids[1]);const trace=await fs.readFile(path.join(fixtureValue.root,'trace','bridge-events.jsonl'),'utf8');assert.ok(!trace.includes(image.bytes.toString('base64')));assert.ok(!trace.includes(secondBytes.toString('base64')));
  await close(newBridge);
});
test('共用 OFF／Clean 正式阻擋圖片讀取，不刪保存原件',async()=>{for(const [label,control]of [['OFF',{enabled:false}],['Clean',{clean:true}]]){
  const f=await fixture('read-'+label),saved=await submit(f.bridge,'first','這是合成構圖原件與伴隨說明。'),listed=await f.bridge.mediaList(saved.source),before=await mediaFiles(f.root);
  await patch(f,control);await assert.rejects(f.bridge.mediaRead({...saved.source,mediaId:listed.items[0].mediaId}),/media_parent_not_authorized|source_read_disabled/);
  assert.deepEqual(await mediaFiles(f.root),before);await close(f.bridge);
}});
test('未授權 Session 不能取得 preview；拒絕不改原件或來源時間',async()=>{const f=await fixture('session-off'),saved=await submit(f.bridge,'first','正式附圖合成原話。'),listed=await f.bridge.mediaList(saved.source),before=await mediaFiles(f.root);
  await assert.rejects(f.bridge.mediaRead({...saved.source,mediaId:listed.items[0].mediaId},()=>false),/media_controls_or_authorization_changed/);assert.deepEqual(await mediaFiles(f.root),before);await close(f.bridge);
});
test('合法 Pointer JSON 欄位重新排序仍指向相同正式原件',async()=>{const f=await fixture('pointer-order'),saved=await submit(f.bridge,'first','這是來源身分順序測試的合成圖。');
  const pointer=Object.fromEntries(Object.entries(saved.source.pointer).reverse()),listed=await f.bridge.mediaList({pointer,evidenceHash:saved.source.evidenceHash});assert.equal(listed.total,1);
  await close(f.bridge);
});
test('saveUser=false 不保存新圖，原生文字回合仍可正常完成',async()=>{const f=await fixture('save-off');await patch(f,{saveUser:false});
  const received=await f.bridge.receive('synthetic-save-off','new','合成停止保存區的新輸入。','2026-10-02T03:00:00Z',[image]);assert.equal(received.capture.sourcePointer,null);
  await f.bridge.claim('synthetic-save-off','new');await f.bridge.complete('synthetic-save-off','reply','合成宿主仍能正常回答。');assert.deepEqual(await mediaFiles(f.root),{});await close(f.bridge);
});
test('關閉回查不等於停止新 User 圖片保存；新圖片與正常回答仍須保存',async()=>{for(const [label,control]of [['historyRecall',{historyRecall:false}],['answerHistory',{answerHistory:false}]]){
  const f=await fixture('save-without-'+label);await patch(f,control);
  const received=await f.bridge.receive('synthetic-capture-only','new','目前只停止回查，仍授權保存我主動提交的圖與原說明。','2026-10-02T04:00:00Z',[image]);
  assert.ok(received.capture.sourcePointer);await f.bridge.claim('synthetic-capture-only','new');const answer=await f.bridge.complete('synthetic-capture-only','reply','合成正常宿主回答。');assert.ok(answer.sourcePointer);
  assert.equal(Object.keys(await mediaFiles(f.root)).filter(name=>name.startsWith('records/')).length,1);await close(f.bridge);
}});
test('新 User captureProof 文字必須符合正式父原文，而不只相同時間',async()=>{
  const f=await fixture('capture-proof'),saved=await submit(f.bridge,'first','真正的當次圖片原說明。'),runtime=await f.bridge.runtime('synthetic-source-session');
  await assert.rejects(f.bridge.mediaAccess(runtime,saved.source.pointer,saved.source.evidenceHash,{capture:true,captureProof:{text:'這是另外造假的文字。',receivedAt:'2026-10-02T02:00:00.123Z'}}),/media_.*proof|media_.*binding|media_.*source/);
  await close(f.bridge);
});
test('保存 guard 末端重驗真正父原件；父已缺失不發布新的媒體關聯',async()=>{
  const f=await fixture('capture-parent-missing'),text='這是即將做合成父缺失測試的正式原說明。',saved=await submit(f.bridge,'first',text),runtime=await f.bridge.runtime('synthetic-source-session');
  const access=await f.bridge.mediaAccess(runtime,saved.source.pointer,saved.source.evidenceHash,{capture:true,captureProof:{text,receivedAt:'2026-10-02T02:00:00.123Z'}});
  const directory=path.join(f.root,'state','history');let file;
  for(const name of await fs.readdir(directory)){const target=path.join(directory,name),record=JSON.parse(await fs.readFile(target,'utf8'));if(record.evidence?.pointer?.itemId===saved.source.pointer.itemId)file=target;}
  assert.ok(file);await fs.rename(file,file+'.preserved-synthetic-before');const before=await mediaFiles(f.root);
  await assert.rejects(access.store.capture({parent:access.parent,onGuard:access.onGuard,attachment:{...image,filename:'不能當成有效的新圖.png',bytes:png([1,2,3])}}),/media_.*source|media_.*parent|media_controls_or_authorization_changed|source_.*missing/);
  assert.deepEqual(await mediaFiles(f.root),before);await close(f.bridge);
});
test('圖片讀取不活化 Buffer、刷新原時間或新增模型工作',async()=>{const f=await fixture('readonly'),saved=await submit(f.bridge,'first','這是只有讀取的合成圖片說明。'),listed=await f.bridge.mediaList(saved.source),before=await f.bridge.status(),files=await mediaFiles(f.root);
  for(let n=0;n<2;n++){await f.bridge.mediaList(saved.source);await f.bridge.mediaRead({...saved.source,mediaId:listed.items[0].mediaId});}
  const after=await f.bridge.status(),stableBuffer=({evaluatedAt,...state})=>state;
  assert.deepEqual(after.registration.sources,before.registration.sources);assert.deepEqual(stableBuffer(after.buffer),stableBuffer(before.buffer));assert.deepEqual(after.pins,before.pins);assert.deepEqual(await mediaFiles(f.root),files);await close(f.bridge);
});
test('正式 reader 的不同 ticket 同名 r1 不錯綁兩張原件；未正式讀取參照拒絕',async()=>{
  const f=await fixture('formal-reader-ref-binding');
  const first=await submit(f.bridge,'first','第一份合成展台配置，場地仍待書面確認。');
  const secondBytes=png([210,160,10]);
  const second=await submit(f.bridge,'second','後來修訂合成展台配置，場地仍待書面確認。',{...image,bytes:secondBytes},'2026-10-02T02:10:00.456Z');
  const querySession='synthetic-fresh-query';
  await f.bridge.begin(querySession,'query','請找回展台最初與修訂的原圖，確認是哪次保存。');
  await assert.rejects(f.bridge.mediaTool(querySession,'cmcp_list_images',{sourceRef:'r1'}),/media_requires_formal_read_source/);
  const pages=[];
  for(const saved of [first,second]){
    const nav=await f.bridge.tool(querySession,'cmcp_find_history',{});
    const hint=nav.selection.input.ordinaryHistory.sourceHints.find(row=>row.author==='user'&&row.messageRecordedAt===saved.source.messageRecordedAt);
    assert.ok(hint,'只選正式導航已公告的來源，不人工植入內部 Pointer');
    const opened=await f.bridge.tool(querySession,'cmcp_open_history',{navigationTicket:nav.ticket,
      selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history',sourceRefs:[hint.ref]},clarification:''})});
    const page=await f.bridge.tool(querySession,'cmcp_read_history',{ticket:opened.ticket});
    assert.equal(page.source.ref,'r1');assert.ok(page.mediaSourceRef);assert.equal(page.source.pointer,undefined);
    pages.push(page);
  }
  assert.notEqual(pages[0].mediaSourceRef,pages[1].mediaSourceRef);
  const formalTrace=(await fs.readFile(path.join(f.root,'trace','bridge-events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.kind==='formal_read'&&row.tool==='cmcp_read_history');
  for(const [index,saved]of [first,second].entries()){
    const trace=formalTrace.find(row=>row.ticket===pages[index].ticket);
    assert.equal(trace.mediaSourceRef,pages[index].mediaSourceRef);
    assert.deepEqual(trace.sourceBindings,[{ref:'r1',pointer:saved.source.pointer,evidenceHash:saved.source.evidenceHash}]);
    assert.equal(trace.source.pointer,undefined);
    assert.equal(trace.text,undefined);
  }
  for(const [index,bytes]of [[0,image.bytes],[1,secondBytes]]){
    const listed=await f.bridge.mediaTool(querySession,'cmcp_list_images',{sourceRef:pages[index].mediaSourceRef});
    const read=await f.bridge.mediaTool(querySession,'cmcp_read_image',{sourceRef:pages[index].mediaSourceRef,mediaId:listed.items[0].mediaId});
    assert.equal(read.sha256,sha(bytes));assert.deepEqual(read.content,bytes);
  }
  await fs.writeFile(path.join(f.root,'formal-reader-binding.json'),JSON.stringify({pages,modelCalls:0,networkCalls},null,2)+'\n',{flag:'wx'});
  await close(f.bridge);
});
test.after(async()=>{for(const bridge of open)await bridge.close();globalThis.fetch=originalFetch;assert.equal(networkCalls,0);await fs.writeFile(path.join(runRoot,'run-index.json'),JSON.stringify({kind:'cmcp_media_bridge_synthetic_test',runRoot,modelCalls:0,networkCalls,at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});});
