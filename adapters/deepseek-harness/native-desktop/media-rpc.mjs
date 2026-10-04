import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {MEDIA_RPC_PACKAGE,MEDIA_RPC_SERVICE,MEDIA_RPC_NAMESPACE,MEDIA_RPC_DESCRIPTOR,
  parseMediaRpcRequest,parseMediaRpcResponse} from './media-rpc-descriptor.js';

const checkSignal=signal=>{if(signal?.aborted)throw Error('cmcp_media_rpc_cancelled');};
const moduleUrl=value=>{
  if(typeof value!=='string'||!value)throw Error('cmcp_media_rpc_protocol_required');
  if(value.startsWith('file:'))return new URL(value).href;
  if(!path.isAbsolute(value))throw Error('cmcp_media_rpc_protocol_required');
  return pathToFileURL(value).href;
};

/**
 * 在官方 Cordis 子 fiber 註冊可撤回的唯讀服務；不開伺服器、不寫 journal。
 * read 必須自行核對 Session／workspace／epoch／共用控制與正式原件閱讀。
 * importProtocol 僅供離線相依替身；正式部署不傳入，使用指定官方模組。
 */
export async function installMediaRpc({ctx,protocolModulePath,read,importProtocol=specifier=>import(specifier)}){
  if(!ctx||typeof ctx.plugin!=='function'||typeof read!=='function')throw Error('cmcp_media_rpc_context_required');
  const protocol=await importProtocol(moduleUrl(protocolModulePath));
  if(typeof protocol?.TypertRemoteService!=='function')throw Error('cmcp_media_rpc_protocol_unavailable');
  let active=true,service;
  const abort=new AbortController();
  class MediaOriginalsService extends protocol.TypertRemoteService {
    constructor(child){super(child,MEDIA_RPC_SERVICE,{namespace:MEDIA_RPC_NAMESPACE});}
    async read(request,signal){
      const checked=parseMediaRpcRequest(request);
      checkSignal(signal);if(!active)throw Error('cmcp_media_rpc_unloaded');
      const combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
      const value=await read(checked,combined);
      checkSignal(combined);if(!active)throw Error('cmcp_media_rpc_unloaded');
      const response=parseMediaRpcResponse(value);
      if(response.sessionId!==checked.sessionId)throw Error('cmcp_media_rpc_session_mismatch');
      return response;
    }
  }
  const fiber=ctx.plugin({name:'cmcp-media-originals-rpc',inject:['typert'],apply(child){
    if(typeof child.typert?.register!=='function')throw Error('cmcp_media_rpc_registry_unavailable');
    service=new MediaOriginalsService(child);
    child.typert.register({package:MEDIA_RPC_PACKAGE,face:'host',model:{services:[{
      key:MEDIA_RPC_SERVICE,exportName:'MediaOriginalsService',description:'CMCP 正式原件的有界暫態唯讀預覽。',
      members:[{kind:'method',name:'read',signature:'read(request: MediaReadRequest, signal: AbortSignal): Promise<MediaReadResponse>',
        summary:'每次沿目前 Session 與正式來源授權取得原件；不寫入 Session 指令紀錄。'}]
    }],events:[],objects:[]},
      schemas:[],invocations:[MEDIA_RPC_DESCRIPTOR]});
  }});
  try{await fiber;if(!service)throw Error('cmcp_media_rpc_service_unavailable');}
  catch(error){active=false;abort.abort();await fiber.dispose();throw error;}
  let disposal;
  return function dispose(){
    if(!disposal){active=false;abort.abort();disposal=Promise.resolve().then(()=>fiber.dispose());}
    return disposal;
  };
}
