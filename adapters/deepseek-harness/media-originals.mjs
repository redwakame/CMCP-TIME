// 媒體原件是正式 User History 的附屬材料；本模組不建立第二份對話或自行授權。
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {createCmcpSourcePointer,cmcpSourcePointerKey} from '../../src/cmcp-guard/cmcp-source-pointer.js';

export const MEDIA_ORIGINAL_LIMITS=Object.freeze({maxBytes:8*1024*1024,maxWidth:8192,maxHeight:8192,maxPixels:16*1024*1024,
  maxDecodedBytes:64*1024*1024,mediaPerParent:4,maxRecords:4096,listLimit:128});
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>sha(JSON.stringify(canonical(value)));
const failure=code=>Object.assign(Error(code),{code});
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hashPattern=/^[a-f0-9]{64}$/;
function parentOf(value,scopeId){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==
    'evidenceHash,messageRecordedAt,scopeId,sessionId,sourceAuthorRole,sourcePointer,textHash')throw failure('media_parent_invalid');
  const pointer=createCmcpSourcePointer(value.sourcePointer);
  if(pointer.scopeId!==scopeId||value.scopeId!==scopeId||pointer.sessionId!==value.sessionId||!pointer.revisionId
    ||value.sourceAuthorRole!=='user'||!hashPattern.test(value.evidenceHash)||!hashPattern.test(value.textHash)
    ||typeof value.messageRecordedAt!=='string'||!Number.isFinite(Date.parse(value.messageRecordedAt)))throw failure('media_parent_binding_mismatch');
  return {...value,sourcePointer:{...pointer}};
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
function dimensions(width,height,limits){if(!width||!height||width>limits.maxWidth||height>limits.maxHeight||width*height>limits.maxPixels)throw failure('media_dimensions_exceeded');return {width,height};}
function png(bytes,limits){
  if(bytes.length<57||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw failure('media_png_invalid');
  let at=8,header=null,ended=false,palette=false,idatEnded=false;const compressed=[];
  while(at<bytes.length){
    if(at+12>bytes.length)throw failure('media_png_truncated');const size=bytes.readUInt32BE(at),end=at+12+size;
    if(end>bytes.length)throw failure('media_png_truncated');const type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,end-4);
    if(!/^[A-Za-z]{4}$/.test(type)||crc(bytes.subarray(at+4,end-4))!==bytes.readUInt32BE(end-4))throw failure('media_png_crc_invalid');
    if(!header&&type!=='IHDR')throw failure('media_png_header_missing');
    if(type==='IHDR'){
      if(header||size!==13)throw failure('media_png_header_invalid');const width=data.readUInt32BE(0),height=data.readUInt32BE(4),depth=data[8],color=data[9];
      dimensions(width,height,limits);if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color]??[]).includes(depth)
        ||data[10]!==0||data[11]!==0||data[12]>1)throw failure('media_png_format_invalid');header={width,height,depth,color,interlace:data[12]};
    }else if(type==='PLTE'){if(palette||compressed.length||size<3||size>768||size%3)throw failure('media_png_palette_invalid');palette=true;}
    else if(type==='IDAT'){if(idatEnded||ended)throw failure('media_png_chunk_order');compressed.push(data);}
    else if(type==='IEND'){if(size!==0||!compressed.length||end!==bytes.length)throw failure('media_png_end_invalid');ended=true;}
    else {if(compressed.length)idatEnded=true;if(type[0]===type[0].toUpperCase())throw failure('media_png_unknown_critical_chunk');}
    at=end;
  }
  if(!ended||header.color===3&&!palette)throw failure('media_png_incomplete');
  const channels={0:1,2:3,3:1,4:2,6:4}[header.color],passes=header.interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=passes.map(([x,y,dx,dy])=>{const width=Math.max(0,Math.ceil((header.width-x)/dx)),height=Math.max(0,Math.ceil((header.height-y)/dy));
    return {height:width?height:0,rowBytes:Math.ceil(width*channels*header.depth/8)};});
  const expected=rows.reduce((sum,row)=>sum+row.height*(row.rowBytes+1),0);
  if(expected>limits.maxDecodedBytes)throw failure('media_decoded_capacity_exceeded');let raw;
  try{raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected+1});}catch{throw failure('media_png_data_invalid');}
  if(raw.length!==expected)throw failure('media_png_data_invalid');let cursor=0;
  for(const row of rows)for(let n=0;n<row.height;n++){if(raw[cursor]>4)throw failure('media_png_filter_invalid');cursor+=row.rowBytes+1;}
  return {...dimensions(header.width,header.height,limits),validation:'png_crc_and_decoded_scanlines'};
}
function jpeg(bytes,limits){
  if(bytes.length<12||bytes[0]!==255||bytes[1]!==216)throw failure('media_jpeg_invalid');let at=2,frame=null,scans=0,entropy=false;
  while(at<bytes.length){
    if(entropy){while(at<bytes.length&&bytes[at]!==255)at++;if(at>=bytes.length)break;
      const next=bytes[at+1];if(next===0||next>=208&&next<=215){at+=2;continue;}if(next===255){at++;continue;}entropy=false;}
    if(bytes[at++]!==255)throw failure('media_jpeg_marker_invalid');while(bytes[at]===255)at++;const marker=bytes[at++];
    if(marker===217){if(!frame||!scans||at!==bytes.length)throw failure('media_jpeg_incomplete');return {...frame,validation:'jpeg_structure_only_pixel_decode_by_host'};}
    if(marker===216||marker===0||marker>=208&&marker<=215)throw failure('media_jpeg_marker_invalid');
    if(at+2>bytes.length)throw failure('media_jpeg_truncated');const length=bytes.readUInt16BE(at);if(length<2||at+length>bytes.length)throw failure('media_jpeg_truncated');
    const data=bytes.subarray(at+2,at+length);
    if([192,193,194].includes(marker)){if(frame||data.length<6||![8,12].includes(data[0])||data[5]<1||data[5]>4||data.length!==6+3*data[5])throw failure('media_jpeg_frame_invalid');frame=dimensions(data.readUInt16BE(3),data.readUInt16BE(1),limits);}
    else if(marker>=195&&marker<=207&&![196,200,204].includes(marker))throw failure('media_jpeg_frame_unsupported');
    if(marker===218){if(!frame||data.length<6||data[0]<1||data[0]>4||data.length!==4+2*data[0])throw failure('media_jpeg_scan_invalid');scans++;entropy=true;}
    at+=length;
  }
  throw failure('media_jpeg_incomplete');
}
export function validateCmcpImageBytes(input,mimeType,limits=MEDIA_ORIGINAL_LIMITS){
  if(!Buffer.isBuffer(input)&&!(input instanceof Uint8Array))throw failure('media_bytes_required');const bytes=Buffer.from(input);
  if(bytes.length<1||bytes.length>limits.maxBytes)throw failure('media_capacity_exceeded');
  if(mimeType==='image/png')return png(bytes,limits);if(mimeType==='image/jpeg')return jpeg(bytes,limits);throw failure('media_type_unsupported');
}
async function safeAncestors(full){let current=path.resolve(full);for(;;){try{const stat=await fs.lstat(current);if(stat.isSymbolicLink())throw failure('media_reparse_path_rejected');
    if(current!==full&&!stat.isDirectory())throw failure('media_parent_not_directory');}catch(error){if(error.code!=='ENOENT')throw error;}
    const parent=path.dirname(current);if(parent===current)break;current=parent;}}
async function stableRead(file,maxBytes){
  await safeAncestors(file);const initial=await fs.lstat(file);if(!initial.isFile()||initial.isSymbolicLink()||initial.nlink!==1||initial.size>maxBytes)throw failure('media_file_identity_invalid');
  const handle=await fs.open(file,'r');try{const before=await handle.stat();if(before.dev!==initial.dev||before.ino!==initial.ino||before.size!==initial.size||before.nlink!==1)throw failure('media_file_changed');
    const bytes=Buffer.alloc(before.size);let offset=0;while(offset<bytes.length){const read=await handle.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)throw failure('media_file_changed');offset+=read.bytesRead;}
    const after=await handle.stat(),last=await fs.lstat(file);await safeAncestors(file);
    for(const key of ['dev','ino','size','mtimeMs','ctimeMs','nlink'])if(before[key]!==after[key]||after[key]!==last[key])throw failure('media_file_changed');return bytes;
  }finally{await handle.close();}
}
/** guard 由正式 Runtime／Session 提供；模組不從檔案位置推定來源授權。 */
export function createCmcpMediaOriginals({dataRoot,scopeId,limits={}}){
  if(typeof dataRoot!=='string'||!path.isAbsolute(dataRoot)||typeof scopeId!=='string'||!scopeId.trim())throw failure('media_configuration_invalid');
  const bounded={...MEDIA_ORIGINAL_LIMITS,...limits};for(const [key,value]of Object.entries(bounded))if(!Object.hasOwn(MEDIA_ORIGINAL_LIMITS,key)||!Number.isSafeInteger(value)||value<1||value>MEDIA_ORIGINAL_LIMITS[key])throw failure('media_limit_invalid');
  const root=path.join(dataRoot,'media-originals'),recordsRoot=path.join(root,'records'),blobRoot=path.join(root,'blobs'),availabilityRoot=path.join(root,'availability');
  let serial=Promise.resolve();const enqueue=operation=>{const next=serial.then(operation);serial=next.catch(()=>{});return next;};
  const guard=async(onGuard,expected)=>{if(typeof onGuard!=='function')throw failure('media_guard_required');const value=await onGuard();
    if(value?.allowed!==true||typeof value.stamp!=='string'||!value.stamp||expected!==undefined&&value.stamp!==expected)throw failure('media_controls_or_authorization_changed');return value.stamp;};
  const mkdir=async directory=>{await safeAncestors(directory);await fs.mkdir(directory,{recursive:true});await safeAncestors(directory);};
  const recordFile=id=>{if(typeof id!=='string'||!hashPattern.test(id))throw failure('media_id_invalid');return path.join(recordsRoot,id+'.json');};
  const blobFile=record=>path.join(blobRoot,record.sha256+(record.mimeType==='image/png'?'.png':'.jpg'));
  async function record(id){let value;try{value=JSON.parse((await stableRead(recordFile(id),32768)).toString('utf8'));}catch(error){if(error.code==='ENOENT')throw failure('media_record_missing');throw error;}
    const {mediaId,...body}=value,parent=parentOf(body.parent,scopeId);
    if(mediaId!==id||digest(body)!==id||body.kind!=='cmcp_media_original'||body.version!==1||!hashPattern.test(body.sha256)
      ||!['image/png','image/jpeg'].includes(body.mimeType)||!Number.isSafeInteger(body.bytes)||body.bytes<1||body.bytes>bounded.maxBytes
      ||typeof body.filename!=='string'||!body.filename||Buffer.byteLength(body.filename)>1024||body.filename!==path.basename(body.filename))throw failure('media_record_integrity_failed');return {...value,parent};}
  async function availability(id){try{const value=JSON.parse((await stableRead(path.join(availabilityRoot,id+'.json'),8192)).toString('utf8'));
    if(value.kind!=='cmcp_media_unavailable'||value.mediaId!==id||!['revoked','deleted'].includes(value.state)||value.originalBytesRetained!==true)throw failure('media_availability_invalid');return value;
  }catch(error){if(error.code==='ENOENT')return null;throw error;}}
  async function checkBinding(id,parent){const value=await record(id);if(!same(value.parent,parent))throw failure('media_parent_changed');return value;}
  async function filenames(){try{await safeAncestors(recordsRoot);const entries=await fs.readdir(recordsRoot,{withFileTypes:true});
    if(entries.length>bounded.maxRecords)throw failure('media_catalog_capacity_exceeded');if(entries.some(entry=>!entry.isFile()||!hashPattern.test(entry.name.slice(0,-5))||!entry.name.endsWith('.json')))throw failure('media_catalog_invalid');return entries.map(entry=>entry.name.slice(0,-5)).sort();
  }catch(error){if(error.code==='ENOENT')return [];throw error;}}
  async function writeExclusive(file,bytes){await safeAncestors(file);try{await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});}
    catch(error){if(error.code!=='EEXIST')throw error;if(!(await stableRead(file,bytes.length)).equals(bytes))throw failure('media_existing_content_conflict');}await safeAncestors(file);}
  return Object.freeze({root,limits:Object.freeze(bounded),
    // 明示資料管理授權與一般回查 guard 分開；保留撤權狀態，不使原件再次可讀。
    backupSnapshot({onGuard,dataAuthorization}){return enqueue(async()=>{
      if(dataAuthorization?.kind!=='cmcp_current_user_data_action'||dataAuthorization.purpose!=='export'||dataAuthorization.scopeId!==scopeId||dataAuthorization.confirmed!==true)throw failure('media_data_management_authorization_required');
      const stamp=await guard(onGuard),result=[];
      for(const id of await filenames()){
        const value=await record(id),marker=await availability(id);let bytes;
        try{bytes=await stableRead(blobFile(value),bounded.maxBytes);}catch(error){if(error.code==='ENOENT')throw failure('media_backup_original_missing');throw error;}
        if(bytes.length!==value.bytes||sha(bytes)!==value.sha256)throw failure('media_backup_original_hash_mismatch');
        validateCmcpImageBytes(bytes,value.mimeType,bounded);await guard(onGuard,stamp);
        result.push({record:value,availability:marker,content:bytes});
      }
      await guard(onGuard,stamp);return result;
    });},
    restoreRecord({record:input,availability:marker,content,onGuard,dataAuthorization}){return enqueue(async()=>{
      if(dataAuthorization?.kind!=='cmcp_current_user_data_action'||dataAuthorization.purpose!=='restore'||dataAuthorization.scopeId!==scopeId||dataAuthorization.confirmed!==true)throw failure('media_data_management_authorization_required');
      const stamp=await guard(onGuard),value=structuredClone(input),parent=parentOf(value?.parent,scopeId),{mediaId,...body}=value??{};
      if(!hashPattern.test(mediaId)||digest(body)!==mediaId||body.kind!=='cmcp_media_original'||body.version!==1
        ||!hashPattern.test(body.sha256)||body.originalTime!==parent.messageRecordedAt||!['image/png','image/jpeg'].includes(body.mimeType)
        ||!Number.isSafeInteger(body.bytes)||body.bytes<1||body.bytes>bounded.maxBytes||typeof body.filename!=='string'
        ||!body.filename||body.filename!==path.basename(body.filename)||Buffer.byteLength(body.filename)>1024)throw failure('media_restore_record_invalid');
      const bytes=Buffer.from(content);if(bytes.length!==body.bytes||sha(bytes)!==body.sha256)throw failure('media_restore_hash_mismatch');
      validateCmcpImageBytes(bytes,body.mimeType,bounded);
      if(marker&&(marker.kind!=='cmcp_media_unavailable'||marker.version!==1||marker.mediaId!==mediaId
        ||!['revoked','deleted'].includes(marker.state)||marker.originalBytesRetained!==true))throw failure('media_restore_availability_invalid');
      const ids=await filenames();if(!ids.includes(mediaId)&&ids.length>=bounded.maxRecords)throw failure('media_catalog_capacity_exceeded');
      await guard(onGuard,stamp);await mkdir(blobRoot);await mkdir(recordsRoot);
      // 先保留拒絕標記，再讓原件與清冊可見；還原途中不會短暫放行已撤權媒體。
      if(marker){await mkdir(availabilityRoot);await writeExclusive(path.join(availabilityRoot,mediaId+'.json'),Buffer.from(JSON.stringify(marker)+'\n'));}
      await writeExclusive(blobFile(value),bytes);await guard(onGuard,stamp);
      await writeExclusive(recordFile(mediaId),Buffer.from(JSON.stringify(value)+'\n'));await guard(onGuard,stamp);
      return {status:'restored',mediaId,sha256:value.sha256,availability:marker?.state??'available',executionAuthorization:false,modelCalls:0};
    });},
    capture(input){return enqueue(async()=>{
      const parent=parentOf(input?.parent,scopeId),attachment=input?.attachment,stamp=await guard(input?.onGuard);
      if(!attachment||typeof attachment.filename!=='string'||!attachment.filename||attachment.filename!==path.basename(attachment.filename)
        ||/[\x00-\x1f\x7f]/.test(attachment.filename)||Buffer.byteLength(attachment.filename)>1024)throw failure('media_filename_invalid');
      if(!Buffer.isBuffer(attachment.bytes)&&!(attachment.bytes instanceof Uint8Array))throw failure('media_bytes_required');
      const bytes=Buffer.from(attachment.bytes),image=validateCmcpImageBytes(bytes,attachment.mimeType,bounded),hash=sha(bytes);
      if(attachment.sha256!==undefined&&attachment.sha256!==hash)throw failure('media_expected_hash_mismatch');
      const body={kind:'cmcp_media_original',version:1,parent,filename:attachment.filename,mimeType:attachment.mimeType,bytes:bytes.length,sha256:hash,
        image,originalTime:parent.messageRecordedAt,originalStatus:'stored'};
      const mediaId=digest(body),manifest={mediaId,...body},ids=await filenames();
      if(!ids.includes(mediaId)){
        if(ids.length>=bounded.maxRecords)throw failure('media_catalog_capacity_exceeded');let count=0;
        for(const id of ids){const other=await record(id);if(cmcpSourcePointerKey(other.parent.sourcePointer)===cmcpSourcePointerKey(parent.sourcePointer))count++;}
        if(count>=bounded.mediaPerParent)throw failure('media_parent_capacity_exceeded');
      }
      await guard(input.onGuard,stamp);await mkdir(blobRoot);await mkdir(recordsRoot);const original=blobFile(body);await writeExclusive(original,bytes);
      try{await guard(input.onGuard,stamp);}catch(error){error.unlinkedBlob={sha256:hash,bytes:bytes.length,relativePath:path.relative(dataRoot,original).replaceAll('\\','/')};throw error;}
      await writeExclusive(recordFile(mediaId),Buffer.from(JSON.stringify(manifest)+'\n'));return {...manifest,modelCalls:0,bodyRetention:'parent_history_only'};
    });},
    async list({parent:raw,onGuard,limit=bounded.listLimit}){
      const parent=parentOf(raw,scopeId),stamp=await guard(onGuard);if(!Number.isSafeInteger(limit)||limit<1||limit>bounded.listLimit)throw failure('media_list_limit_invalid');
      const items=[];let total=0;for(const id of await filenames()){const value=await record(id);if(!same(value.parent,parent))continue;total++;
        if(items.length>=limit)continue;let state='available',reason=null;const marker=await availability(id);
        if(marker){state=marker.state;reason=marker.reason;}else try{const bytes=await stableRead(blobFile(value),bounded.maxBytes);if(bytes.length!==value.bytes||sha(bytes)!==value.sha256){state='unavailable';reason='original_hash_mismatch';}}
        catch(error){state='unavailable';reason=error.code==='ENOENT'?'original_missing':error.code??'original_unavailable';}
        items.push({...value,availability:{state,reason,originalBytesRetained:marker?.originalBytesRetained??null}});
      }
      await guard(onGuard,stamp);return {kind:'cmcp_media_original_list',items,total,shown:items.length,truncated:total>items.length,limit,modelCalls:0};
    },
    async read({mediaId,parent:raw,onGuard,encoding='bytes'}){
      const parent=parentOf(raw,scopeId),stamp=await guard(onGuard);if(!['bytes','dataUrl'].includes(encoding))throw failure('media_encoding_invalid');
      const value=await checkBinding(mediaId,parent),marker=await availability(mediaId);if(marker)throw failure('media_original_'+marker.state);
      let bytes;try{bytes=await stableRead(blobFile(value),bounded.maxBytes);}catch(error){if(error.code==='ENOENT')throw failure('media_original_missing');throw error;}
      if(bytes.length!==value.bytes||sha(bytes)!==value.sha256)throw failure('media_original_hash_mismatch');validateCmcpImageBytes(bytes,value.mimeType,bounded);
      if(await availability(mediaId))throw failure('media_original_revoked');await guard(onGuard,stamp);
      return {...value,...(encoding==='bytes'?{content:bytes}:{dataUrl:'data:'+value.mimeType+';base64,'+bytes.toString('base64')}),activation:'none',modelCalls:0};
    },
    setAvailability(input){return enqueue(async()=>{const parent=parentOf(input?.parent,scopeId),stamp=await guard(input?.onGuard),value=await checkBinding(input?.mediaId,parent);
      if(!['revoked','deleted'].includes(input.state)||typeof input.reason!=='string'||!input.reason.trim()||Buffer.byteLength(input.reason)>1024)throw failure('media_availability_request_invalid');
      const marker={kind:'cmcp_media_unavailable',version:1,mediaId:value.mediaId,state:input.state,reason:input.reason,at:new Date().toISOString(),originalBytesRetained:true,
        deletionBoundary:'僅撤回來源可用性，未永久刪除原件。'};await guard(input.onGuard,stamp);await mkdir(availabilityRoot);
      await writeExclusive(path.join(availabilityRoot,value.mediaId+'.json'),Buffer.from(JSON.stringify(marker)+'\n'));return {...marker,modelCalls:0};
    });}
  });
}
