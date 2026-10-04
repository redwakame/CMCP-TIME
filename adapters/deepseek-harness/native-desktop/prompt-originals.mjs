// 原生附件接納前的暫存接點：只保留已授權 PNG／JPEG 原 bytes，不改官方附件流程。
// 暫存只在 RAM；正式保存由 User 的 rpcId／messageId 與 CMCP Pointer 綁定後執行。
import {createHash} from 'node:crypto';

const ORIGINAL=Symbol.for('cordis.original');
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
const MAX_BYTES=8*1024*1024,MAX_IMAGES=4,MAX_REQUESTS=8,TTL_MS=5*60*1000;
const unavailable=reason=>({status:'unavailable',reason,images:[]});
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=512;
const sameStamp=(left,right)=>typeof left==='string'&&left.length>0&&left===right;

/**
 * 必須以正式 scope／ON／saveUser 判斷的 authorized(sessionId) 回傳
 * {allowed:true, stamp:<授權 epoch 與控制 generation 的穩定字串>}。
 * OFF、Clean 或停止保存必須令 allowed=false 或 stamp 改變。
 * 這是版本限定、可拔出的 service method 包覆，不是官方公開的原件保存 hook。
 */
export function installPromptOriginalCapture({service,authorized,recordMetadata=()=>{},now=()=>Date.now()}){
  const target=service?.[ORIGINAL]??service;
  if(!target||typeof target.prompt!=='function'||typeof authorized!=='function')throw Error('cmcp_media_prompt_contract_unavailable');
  const before=Object.getOwnPropertyDescriptor(target,'prompt'),original=target.prompt;
  if(before&&!before.configurable)throw Error('cmcp_media_prompt_not_reversible');
  const entries=new Map();let active=true;
  const key=(sessionId,requestId)=>JSON.stringify([sessionId,requestId]);
  const release=entry=>{for(const image of entry.images??[])image.data.fill(0);entry.images=[];};
  const notify=row=>{try{const result=recordMetadata(row);if(result?.catch)void result.catch(()=>{});}catch{}};
  const remove=(entry,reason)=>{if(entries.get(entry.key)===entry)entries.delete(entry.key);release(entry);entry.reason=reason;};
  const sweep=()=>{const at=now();for(const entry of entries.values())if(at-entry.startedAt>=TTL_MS)remove(entry,'cmcp_media_capture_expired');};
  const permission=async sessionId=>{try{const guard=await authorized(sessionId);return guard?.allowed===true&&typeof guard.stamp==='string'&&guard.stamp.length>0?guard:null;}catch{return null;}};
  const decode=request=>{
    if(!Array.isArray(request.content))return unavailable('cmcp_media_prompt_content_invalid');
    const parts=request.content.filter(part=>part?.type==='image');
    if(!parts.length)return unavailable('cmcp_media_prompt_has_no_image');
    if(parts.length>MAX_IMAGES)return unavailable('cmcp_media_capture_image_limit');
    const images=[];let total=0;
    const reject=reason=>{release({images});return unavailable(reason);};
    for(const part of parts){
      if(!['image/png','image/jpeg'].includes(part.mediaType))return reject('cmcp_media_capture_type_unsupported');
      const encoded=part.data;
      if(typeof encoded!=='string'||!encoded.length||encoded.length>Math.ceil(MAX_BYTES/3)*4)return reject('cmcp_media_capture_byte_limit');
      // 線性字元檢查，避免大型合法 base64 在重複群組正規式耗盡呼叫堆疊。
      if(encoded.length%4!==0||/[^A-Za-z0-9+/=]/u.test(encoded)||!/^[^=]*(?:==|=)?$/u.test(encoded))return reject('cmcp_media_capture_encoding_invalid');
      const data=Buffer.from(encoded,'base64');
      if(data.toString('base64')!==encoded){data.fill(0);return reject('cmcp_media_capture_encoding_invalid');}
      total+=data.length;
      if(!data.length||data.length>MAX_BYTES||total>MAX_BYTES){data.fill(0);return reject('cmcp_media_capture_byte_limit');}
      const signature=part.mediaType==='image/png'?data.subarray(0,8).equals(PNG):data.length>=3&&data[0]===255&&data[1]===216&&data[2]===255;
      if(!signature){data.fill(0);return reject('cmcp_media_capture_type_mismatch');}
      if(part.name!==undefined&&(typeof part.name!=='string'||Buffer.byteLength(part.name)>4096)){data.fill(0);return reject('cmcp_media_capture_name_invalid');}
      images.push({originalName:part.name??null,mediaType:part.mediaType,bytes:data.length,
        sha256:createHash('sha256').update(data).digest('hex'),data});
    }
    return {status:'available',images};
  };
  async function cmcpPromptOriginals(...args){
    const [request,signal]=args;
    // 未授權與範圍外完全透傳，不碰 request.content／part.data。
    if(!active||!validId(request?.sessionId)||!validId(request?.requestId)||signal?.aborted)return Reflect.apply(original,this,args);
    const guard=await permission(request.sessionId);
    if(!active||!guard||signal?.aborted)return Reflect.apply(original,this,args);
    sweep();const entryKey=key(request.sessionId,request.requestId);
    // 原生 requestId 有去重契約；重送不得以另一張圖覆蓋第一次暫存。
    if(entries.has(entryKey))return Reflect.apply(original,this,args);
    let captured;try{captured=decode(request);}catch{captured=unavailable('cmcp_media_capture_failed');}
    if(captured.status!=='available'){
      if(captured.reason!=='cmcp_media_prompt_has_no_image')notify({kind:'cmcp_media_capture_unavailable',sessionId:request.sessionId,requestId:request.requestId,reason:captured.reason});
      return Reflect.apply(original,this,args);
    }
    if(entries.size>=MAX_REQUESTS){release(captured);notify({kind:'cmcp_media_capture_unavailable',sessionId:request.sessionId,requestId:request.requestId,reason:'cmcp_media_capture_request_limit'});return Reflect.apply(original,this,args);}
    let settle;const settled=new Promise(resolve=>{settle=resolve;});
    const entry={key:entryKey,sessionId:request.sessionId,requestId:request.requestId,stamp:guard.stamp,startedAt:now(),images:captured.images,settled,accepted:false,reason:null};
    entries.set(entryKey,entry);
    try{
      const result=await Reflect.apply(original,this,args);
      const current=await permission(request.sessionId);
      if(result?.accepted!==true||!active||signal?.aborted||!current||!sameStamp(entry.stamp,current.stamp)||entries.get(entryKey)!==entry){remove(entry,'cmcp_media_capture_authorization_changed');}
      else{entry.accepted=true;notify({kind:'cmcp_media_capture_ready',sessionId:entry.sessionId,requestId:entry.requestId,imageCount:entry.images.length,bytes:entry.images.reduce((sum,image)=>sum+image.bytes,0)});}
      return result;
    }catch(error){remove(entry,'cmcp_media_prompt_not_accepted');throw error;}
    finally{settle();}
  }
  Object.defineProperty(target,'prompt',{value:cmcpPromptOriginals,writable:before?.writable??true,enumerable:before?.enumerable??false,configurable:true});
  return {
    async take(sessionId,requestId){
      if(!validId(sessionId)||!validId(requestId))return unavailable('cmcp_media_capture_identity_missing');
      sweep();const entryKey=key(sessionId,requestId),entry=entries.get(entryKey);
      if(!entry)return unavailable(active?'cmcp_media_capture_not_found':'cmcp_media_capture_detached');
      await entry.settled;
      const current=await permission(sessionId);
      if(!active||!entry.accepted||entries.get(entryKey)!==entry||!current||!sameStamp(entry.stamp,current.stamp)||now()-entry.startedAt>=TTL_MS){remove(entry,entry.reason??'cmcp_media_capture_authorization_changed');return unavailable(entry.reason);}
      entries.delete(entryKey);const images=entry.images;entry.images=[];
      return {status:'available',sessionId,requestId,images};
    },
    clear(sessionId){for(const entry of entries.values())if(sessionId===undefined||entry.sessionId===sessionId)remove(entry,'cmcp_media_capture_cleared');},
    status(){sweep();return {active,requests:entries.size,bytes:[...entries.values()].reduce((sum,entry)=>sum+entry.images.reduce((n,image)=>n+image.bytes,0),0),limits:{maxBytes:MAX_BYTES,maxImages:MAX_IMAGES,maxRequests:MAX_REQUESTS,ttlMs:TTL_MS},storage:'RAM'};},
    dispose(){active=false;for(const entry of entries.values())remove(entry,'cmcp_media_capture_detached');
      const current=Object.getOwnPropertyDescriptor(target,'prompt');
      if(current?.value!==cmcpPromptOriginals)return {restored:false,conflict:true};
      if(before)Object.defineProperty(target,'prompt',before);else Reflect.deleteProperty(target,'prompt');
      return {restored:true,conflict:false};
    }
  };
}
