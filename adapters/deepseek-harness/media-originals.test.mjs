// 合成媒體原件與正式父來源契約的離線測試；不讀私人附件、不呼叫網路或模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createCmcpMediaOriginals,validateCmcpImageBytes} from './media-originals.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(repo,'logs/tests/media-originals'));
await fs.mkdir(base,{recursive:true});const runRoot=await fs.mkdtemp(path.join(base,'run-'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes){let n=0xffffffff;for(const byte of bytes)n=table[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function chunk(type,data){const head=Buffer.alloc(8),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);head.write(type,4);tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4),data])));return Buffer.concat([head,data,tail]);}
function png(color=[255,20,30]){const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,...color,...color]))),chunk('IEND',Buffer.alloc(0))]);}
const parent=(item='user-one',revisionId='r1')=>({sourcePointer:{version:1,providerNamespace:'synthetic-history',scopeId:'synthetic-media',sessionId:'source-session',itemId:item,revisionId},
  evidenceHash:sha('正式父證據 '+item+' '+revisionId),sourceAuthorRole:'user',scopeId:'synthetic-media',sessionId:'source-session',messageRecordedAt:'2026-10-02T01:23:45.123Z',textHash:sha('原始說明 '+item)});
const allowed=async()=>({allowed:true,stamp:'enabled-saveUser-scope-r1'});
const original={filename:'修訂圖.png',mimeType:'image/png',bytes:png()};
async function fixture(name,limits){const dataRoot=path.join(runRoot,name);await fs.mkdir(dataRoot,{recursive:true});return {dataRoot,store:createCmcpMediaOriginals({dataRoot,scopeId:'synthetic-media',limits})};}
const blob=(dataRoot,result)=>path.join(dataRoot,'media-originals','blobs',result.sha256+'.png');
const capture=(store,p=parent(),attachment=original,onGuard=allowed)=>store.capture({parent:p,attachment,onGuard});
const read=(store,result,p=parent(),onGuard=allowed)=>store.read({mediaId:result.mediaId,parent:p,onGuard});
async function snapshot(root){const out={};async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);
  if(entry.isDirectory())await walk(full);else if(entry.isFile())out[path.relative(root,full).replaceAll('\\','/')]=sha(await fs.readFile(full));}}await walk(root);return out;}

test('兩張相似修訂原件跨新 service 仍保留不同父版本、bytes、hash 與原時間',async()=>{
  const {dataRoot,store}=await fixture('versions');const first=await capture(store),p2=parent('user-two'),second=await capture(store,p2,{...original,bytes:png([10,40,230])});
  const reopened=createCmcpMediaOriginals({dataRoot,scopeId:'synthetic-media'});
  assert.notEqual(first.mediaId,second.mediaId);assert.notEqual(first.sha256,second.sha256);
  for(const [saved,p,input]of [[first,parent(),original.bytes],[second,p2,png([10,40,230])]]){const found=await read(reopened,saved,p);assert.deepEqual(found.content,input);assert.equal(found.bytes,input.length);assert.equal(found.sha256,sha(input));assert.equal(found.originalTime,p.messageRecordedAt);assert.equal(found.parent.sourceAuthorRole,'user');}
  const metadata=await fs.readFile(path.join(dataRoot,'media-originals','records',first.mediaId+'.json'),'utf8');assert.ok(!metadata.includes(original.bytes.toString('base64')));assert.ok(!metadata.includes('原始說明'));assert.equal(first.bodyRetention,'parent_history_only');
});
test('相同 User 與附件重送冪等且不覆寫原件',async()=>{const {dataRoot,store}=await fixture('idempotent');const first=await capture(store),before=await snapshot(dataRoot),second=await capture(store);assert.equal(first.mediaId,second.mediaId);assert.deepEqual(await snapshot(dataRoot),before);});
test('OFF、Clean、停止保存或未授權 guard 均在寫入前拒絕',async()=>{for(const kind of ['OFF','Clean','saveUserfalse','unauthorized']){const {dataRoot,store}=await fixture(kind);
  await assert.rejects(capture(store,parent(),original,async()=>({allowed:false,stamp:kind})),/media_controls_or_authorization_changed/);assert.deepEqual(await fs.readdir(dataRoot),[]);}});
test('blob 寫後 guard 變更拒絕 manifest 並明示未關聯原件',async()=>{const {dataRoot,store}=await fixture('mid-flight');let calls=0;
  await assert.rejects(capture(store,parent(),original,async()=>({allowed:true,stamp:++calls===3?'changed':'initial'})),error=>{assert.equal(error.code,'media_controls_or_authorization_changed');assert.equal(error.unlinkedBlob.sha256,sha(original.bytes));return true;});
  assert.deepEqual(await fs.readdir(path.join(dataRoot,'media-originals','records')),[]);assert.deepEqual(await fs.readFile(path.join(dataRoot,'media-originals','blobs',sha(original.bytes)+'.png')),original.bytes);
});
test('父 pointer、revision、evidenceHash、角色、scope、Session、時間或說明變更不讀回',async()=>{const {store}=await fixture('parent-change'),saved=await capture(store);
  const changes=[p=>{p.sourcePointer.revisionId='r2';},p=>{p.evidenceHash=sha('changed');},p=>{p.sourceAuthorRole='assistant';},p=>{p.scopeId='other';},p=>{p.sessionId='new-session';},p=>{p.messageRecordedAt='2026-10-03T00:00:00Z';},p=>{p.textHash=sha('new-description');}];
  for(const change of changes){const p=parent();change(p);await assert.rejects(read(store,saved,p),/media_parent/);}
});
test('讀取 guard 在讀前及讀後重驗，變更不回傳 bytes',async()=>{const {store}=await fixture('read-control'),saved=await capture(store);let calls=0;
  await assert.rejects(read(store,saved,parent(),async()=>({allowed:true,stamp:++calls===1?'before':'after'})),/media_controls_or_authorization_changed/);
  await assert.rejects(read(store,saved,parent(),async()=>({allowed:false,stamp:'OFF'})),/media_controls_or_authorization_changed/);
});
test('原件缺失與 hash 損毀均 fail closed，清冊分開顯示原因',async()=>{
  const missing=await fixture('missing'),m=await capture(missing.store);await fs.rename(blob(missing.dataRoot,m),blob(missing.dataRoot,m)+'.preserved');await assert.rejects(read(missing.store,m),/media_original_missing/);
  assert.equal((await missing.store.list({parent:parent(),onGuard:allowed})).items[0].availability.reason,'original_missing');
  const tamper=await fixture('tamper'),t=await capture(tamper.store);await fs.writeFile(blob(tamper.dataRoot,t),png([0,1,2]));await assert.rejects(read(tamper.store,t),/media_original_hash_mismatch/);
  assert.equal((await tamper.store.list({parent:parent(),onGuard:allowed})).items[0].availability.reason,'original_hash_mismatch');
});
test('metadata 改寫不能沿原 mediaId 冒充有效原件',async()=>{const {dataRoot,store}=await fixture('metadata-tamper'),saved=await capture(store),file=path.join(dataRoot,'media-originals','records',saved.mediaId+'.json');
  const value=JSON.parse(await fs.readFile(file,'utf8'));value.filename='偽造.png';await fs.writeFile(file,JSON.stringify(value));await assert.rejects(read(store,saved),/media_record_integrity_failed/);
});
test('撤權與邏輯刪除使原件不可讀，不永久刪除 bytes',async()=>{for(const state of ['revoked','deleted']){const {dataRoot,store}=await fixture('availability-'+state),saved=await capture(store);
  const receipt=await store.setAvailability({mediaId:saved.mediaId,parent:parent(),onGuard:allowed,state,reason:'合成控制驗證'});assert.equal(receipt.originalBytesRetained,true);
  await assert.rejects(read(store,saved),new RegExp('media_original_'+state));assert.deepEqual(await fs.readFile(blob(dataRoot,saved)),original.bytes);
  assert.equal((await store.list({parent:parent(),onGuard:allowed})).items[0].availability.state,state);
}});
test('symlink 原件拒絕，不跟隨至範圍外',async t=>{
  const {dataRoot,store}=await fixture('symlink-blob'),saved=await capture(store),originalPath=blob(dataRoot,saved),preserved=originalPath+'.preserved';await fs.rename(originalPath,preserved);
  try{await fs.symlink(preserved,originalPath,'file');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('目前一般權限不能建立合成 symlink；未提權。');return;}throw error;}
  await assert.rejects(read(store,saved),/media_reparse_path_rejected/);
});
test('junction 祖先拒絕，不向範圍外寫入或跟隨',async()=>{
  const external=path.join(runRoot,'symlink-external');await fs.mkdir(external);const root2=path.join(runRoot,'symlink-root');await fs.symlink(external,root2,'junction');
  const other=createCmcpMediaOriginals({dataRoot:root2,scopeId:'synthetic-media'});await assert.rejects(capture(other),/media_reparse_path_rejected/);assert.deepEqual(await fs.readdir(external),[]);
});
test('有額外 hardlink 的原件不放寬唯一檔案身分',async()=>{const {dataRoot,store}=await fixture('hardlink'),saved=await capture(store);await fs.link(blob(dataRoot,saved),blob(dataRoot,saved)+'.alias');await assert.rejects(read(store,saved),/media_file_identity_invalid/);});
test('PNG 簽章、CRC、解壓資料、MIME 及容量錯誤拒絕',async()=>{
  assert.throws(()=>validateCmcpImageBytes(Buffer.from('not an image'),'image/png'),/media_png_invalid/);
  const damaged=Buffer.from(png());damaged[40]^=1;assert.throws(()=>validateCmcpImageBytes(damaged,'image/png'),/media_png_crc_invalid/);
  const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  const wrong=Buffer.concat([png().subarray(0,8),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,1]))),chunk('IEND',Buffer.alloc(0))]);assert.throws(()=>validateCmcpImageBytes(wrong,'image/png'),/media_png_data_invalid/);
  assert.throws(()=>validateCmcpImageBytes(png(),'image/jpeg'),/media_jpeg_invalid/);assert.throws(()=>validateCmcpImageBytes(png(),'image/webp'),/media_type_unsupported/);
  const {store}=await fixture('size',{maxBytes:32});await assert.rejects(capture(store),/media_capacity_exceeded/);
});
test('檔名路徑、父資料缺欄、非 User 與不相符 expected hash 不保存',async()=>{const {dataRoot,store}=await fixture('invalid-input');
  await assert.rejects(capture(store,parent(),{...original,filename:'../escape.png'}),/media_filename_invalid/);
  await assert.rejects(capture(store,{...parent(),sourceAuthorRole:'assistant'}),/media_parent_binding_mismatch/);
  const noText=parent();delete noText.textHash;await assert.rejects(capture(store,noText),/media_parent_invalid/);
  await assert.rejects(capture(store,parent(),{...original,sha256:sha('wrong')}),/media_expected_hash_mismatch/);assert.deepEqual(await fs.readdir(dataRoot),[]);
  await assert.rejects(capture(store,parent(),{...original,bytes:original.bytes.toString('base64')}),/media_bytes_required/);
});
test('清冊有界數量、分母與 truncated；父來源附件容量不覆寫',async()=>{const {store}=await fixture('limits',{mediaPerParent:2});await capture(store);await capture(store,parent(),{...original,filename:'較新.png',bytes:png([30,40,50])});
  const result=await store.list({parent:parent(),onGuard:allowed,limit:1});assert.equal(result.total,2);assert.equal(result.shown,1);assert.equal(result.truncated,true);assert.equal(result.limit,1);
  await assert.rejects(capture(store,parent(),{...original,filename:'第三張.png',bytes:png([31,41,51])}),/media_parent_capacity_exceeded/);
  await assert.rejects(store.list({parent:parent(),onGuard:allowed,limit:129}),/media_list_limit_invalid/);
});
test('查看、data URL 預覽及清冊不改原件、父原時間或任一檔案內容',async()=>{const {dataRoot,store}=await fixture('read-only'),saved=await capture(store),before=await snapshot(dataRoot);
  for(let n=0;n<3;n++){const list=await store.list({parent:parent(),onGuard:allowed}),preview=await store.read({mediaId:saved.mediaId,parent:parent(),onGuard:allowed,encoding:'dataUrl'});
    assert.equal(list.items[0].originalTime,parent().messageRecordedAt);assert.equal(preview.dataUrl,'data:image/png;base64,'+original.bytes.toString('base64'));assert.equal(preview.modelCalls,0);assert.equal(preview.activation,'none');}
  assert.deepEqual(await snapshot(dataRoot),before);
});
test('不同父來源不能從他案 mediaId 讀到圖；Guard 不可省略',async()=>{const {store}=await fixture('wrong-case'),saved=await capture(store);await assert.rejects(read(store,saved,parent('another')),/media_parent_changed/);
  await assert.rejects(store.read({mediaId:saved.mediaId,parent:parent()}),/media_guard_required/);
});

test.after(async()=>{await fs.writeFile(path.join(runRoot,'fixture-index.json'),JSON.stringify({kind:'cmcp_media_synthetic_test_run',runRoot,at:new Date().toISOString(),networkCalls:0,modelCalls:0,
  retention:'保留所有合成測試原件、損毀及缺件前像；未執行刪除。'},null,2)+'\n',{flag:'wx'});});
