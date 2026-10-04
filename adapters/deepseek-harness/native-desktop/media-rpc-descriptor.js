// 官方 Gateway 的專屬唯讀 RPC 契約；不依賴 Node，也不經 Session 指令紀錄。
export const MEDIA_RPC_PACKAGE='cmcp-desktop-native-media';
export const MEDIA_RPC_SERVICE='cmcpMediaOriginals';
export const MEDIA_RPC_NAMESPACE=MEDIA_RPC_SERVICE;
export const MEDIA_RPC_METHOD='read';
export const MEDIA_RPC_MAX_BYTES=8*1024*1024;
const ID_BYTES=1024,MAX_METADATA_BYTES=128*1024,encoder=new TextEncoder();
const fail=()=>{throw new TypeError('cmcp_media_rpc_contract_invalid');};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,allowed,required=allowed)=>{
  if(!plain(value)||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!allowed.includes(key))
    ||required.some(key=>!Object.hasOwn(value,key)))fail();
  for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))if(!Object.hasOwn(descriptor,'value'))fail();
};
const identity=value=>{
  if(typeof value!=='string'||!value.trim()||/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ||encoder.encode(value).length>ID_BYTES)fail();
  for(const character of value){const code=character.codePointAt(0);if(code>=0xd800&&code<=0xdfff)fail();}
  return value;
};
export function parseMediaRpcRequest(value){
  exact(value,['sessionId','pointer','evidenceHash','mediaId']);
  identity(value.sessionId);identity(value.mediaId);
  if(typeof value.evidenceHash!=='string'||!/^[a-f0-9]{64}$/u.test(value.evidenceHash))fail();
  exact(value.pointer,['version','providerNamespace','scopeId','itemId','sessionId','revisionId','partId'],['version','providerNamespace','scopeId','itemId']);
  if(value.pointer.version!==1)fail();
  for(const key of Object.keys(value.pointer))if(key!=='version')identity(value.pointer[key]);
  return value;
}
function jsonMetadata(value,depth=0,budget={nodes:0,bytes:0}){
  if(depth>12||++budget.nodes>4096)fail();
  if(typeof value==='string'){budget.bytes+=encoder.encode(value).length;if(budget.bytes>MAX_METADATA_BYTES)fail();return;}
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))fail();return;}
  if(Array.isArray(value)){
    if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||key!=='length'&&!/^(0|[1-9][0-9]*)$/u.test(key))
      ||Object.keys(value).length!==value.length)fail();
    for(const part of value)jsonMetadata(part,depth+1,budget);return;
  }
  if(!plain(value))fail();
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string'||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'))fail();
    jsonMetadata(key,depth+1,budget);jsonMetadata(value[key],depth+1,budget);
  }
}
function boundedDataUrl(value){
  if(typeof value!=='string'||value.length>Math.ceil(MEDIA_RPC_MAX_BYTES/3)*4+32)fail();
  const prefix=/^data:image\/(png|jpeg);base64,/u.exec(value);if(!prefix)fail();
  const encoded=value.slice(prefix[0].length);
  if(!encoded.length||encoded.length%4!==0||/[^A-Za-z0-9+/=]/u.test(encoded)||!/^[^=]*(?:==|=)?$/u.test(encoded))fail();
  const padding=encoded.endsWith('==')?2:encoded.endsWith('=')?1:0;
  if(encoded.length/4*3-padding>MEDIA_RPC_MAX_BYTES)fail();
  return value;
}
export function parseMediaRpcResponse(value){
  exact(value,['kind','operation','enabled','sessionId','workspaceRoot','scopeId','optedIn','mediaOriginal','error'],['kind','operation','enabled','sessionId']);
  if(value.kind!=='cmcp_desktop_response'||value.operation!=='media-read'||typeof value.enabled!=='boolean')fail();
  identity(value.sessionId);
  if(value.error!==undefined){
    if(value.mediaOriginal!==undefined)fail();
    const {error,...metadata}=value;jsonMetadata(metadata);jsonMetadata(error);return value;
  }
  if(value.enabled!==true)fail();
  exact(value.mediaOriginal,['metadata','dataUrl','modelCalls']);
  if(value.mediaOriginal.modelCalls!==0)fail();
  boundedDataUrl(value.mediaOriginal.dataUrl);
  const {mediaOriginal,...metadata}=value;
  jsonMetadata({...metadata,mediaOriginal:{metadata:mediaOriginal.metadata,modelCalls:0}});
  return value;
}
// Gateway 使用 create().parse() 驗證嚴格 JSON 邊界；本手寫契約沒有冒充產生器產物。
export const MEDIA_RPC_DESCRIPTOR=Object.freeze({
  id:MEDIA_RPC_PACKAGE+'#'+MEDIA_RPC_NAMESPACE+'/'+MEDIA_RPC_METHOD,
  service:MEDIA_RPC_SERVICE,namespace:MEDIA_RPC_NAMESPACE,method:MEDIA_RPC_METHOD,
  invocation:Object.freeze({kind:'direct'}),
  parameters:Object.freeze([Object.freeze({name:'request',wire:'request',source:'json',
    codec:Object.freeze({mode:'strict',typeSymbol:MEDIA_RPC_PACKAGE+'#MediaReadRequest',create:()=>({parse:parseMediaRpcRequest})})})]),
  cancellation:Object.freeze({parameter:'signal'}),
  result:Object.freeze({mode:'strict',typeSymbol:MEDIA_RPC_PACKAGE+'#MediaReadResponse',create:()=>({parse:parseMediaRpcResponse}),
    encode:parseMediaRpcResponse,decode:parseMediaRpcResponse})
});
