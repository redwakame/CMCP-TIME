import test from 'node:test';
import assert from 'node:assert/strict';
import {installMediaRpc} from './media-rpc.mjs';
import {MEDIA_RPC_PACKAGE,MEDIA_RPC_SERVICE,MEDIA_RPC_DESCRIPTOR,MEDIA_RPC_MAX_BYTES,
  parseMediaRpcRequest,parseMediaRpcResponse} from './media-rpc-descriptor.js';
const pointer={version:1,providerNamespace:'test-originals',scopeId:'scope-A',itemId:'message-A',sessionId:'source-session',revisionId:'r1'};
const request=()=>({sessionId:'viewer-session',pointer:{...pointer},evidenceHash:'a'.repeat(64),mediaId:'image-A'});
const response=()=>({kind:'cmcp_desktop_response',operation:'media-read',enabled:true,sessionId:'viewer-session',
  mediaOriginal:{metadata:{mediaId:'image-A',bytes:8,sha256:'b'.repeat(64),sourcePointer:{...pointer}},dataUrl:'data:image/png;base64,iVBORw0KGgo=',modelCalls:0}});
// 只作注入替身的識別 URL；不讀取或建立這個檔案，也不載入官方安裝。
const protocolModulePath=new URL('./synthetic-protocol-fixture.mjs',import.meta.url).href;
function harness({registerFails=false}={}){
  const services=new Map(),registrations=new Map(),calls=[],cleanups=[];
  class TypertRemoteService {
    constructor(ctx,name,{namespace}){this.ctx=ctx;this.name=name;this.typertRemote={service:this,serviceKey:name,namespace};
      if(services.has(name))throw Error('duplicate service');services.set(name,this);cleanups.push(()=>services.delete(name));}
  }
  const child={typert:{register(contribution){calls.push({kind:'register',contribution});
    if(registerFails||registrations.has(contribution.package))throw Error('registry failure');
    assert.equal(contribution.face,'host');const descriptor=contribution.invocations[0];
    assert.equal(descriptor.parameters[0].codec.mode,'strict');assert.equal(typeof descriptor.result.create,'function');
    registrations.set(contribution.package,descriptor);cleanups.push(()=>registrations.delete(contribution.package));}}};
  let disposals=0;
  const ctx={plugin(definition){calls.push({kind:'plugin',name:definition.name,inject:definition.inject});
    const ready=Promise.resolve().then(()=>definition.apply(child));ready.dispose=async()=>{if(!disposals++)for(const cleanup of cleanups.reverse())cleanup();};return ready;}};
  const importProtocol=async specifier=>{calls.push({kind:'import',specifier});return {TypertRemoteService};};
  return {ctx,importProtocol,services,registrations,calls,get disposals(){return disposals;}};
}
test('專屬官方 Service 與嚴格 descriptor；原件不經 commands 或 journal',async()=>{
  const h=harness(),seen=[];const dispose=await installMediaRpc({...h,protocolModulePath,read:async(input,signal)=>{seen.push({input,signal});return response();}});
  const service=h.services.get(MEDIA_RPC_SERVICE),descriptor=h.registrations.get(MEDIA_RPC_PACKAGE);
  assert.equal(service.typertRemote.service,service);assert.equal(service.typertRemote.namespace,MEDIA_RPC_SERVICE);
  assert.equal(descriptor,MEDIA_RPC_DESCRIPTOR);assert.equal(descriptor.invocation.kind,'direct');assert.equal(descriptor.cancellation.parameter,'signal');
  const input=request(),signal=new AbortController().signal;
  const value=await service.read(descriptor.parameters[0].codec.create().parse(input),signal);
  assert.equal(value.mediaOriginal.dataUrl,response().mediaOriginal.dataUrl);assert.equal(seen[0].input,input);assert.ok(seen[0].signal instanceof AbortSignal);
  assert.equal(new URL(h.calls[0].specifier).protocol,'file:');assert.equal(h.calls[0].specifier,protocolModulePath);
  assert.deepEqual(h.calls.map(x=>x.kind),['import','plugin','register']);
  await dispose();await dispose();assert.equal(h.disposals,1);assert.equal(h.services.size,0);assert.equal(h.registrations.size,0);
});
test('來源版本／hash／範圍 request 邊界完整且不接受任意 path',()=>{
  assert.equal(parseMediaRpcRequest(request()).sessionId,'viewer-session');
  for(const bad of [{...request(),path:'C:/private'},{...request(),evidenceHash:'bad'},
    {...request(),pointer:{...pointer,version:2}},{...request(),pointer:{...pointer,unknown:'x'}},
    {...request(),sessionId:'\0'},{...request(),mediaId:'x'.repeat(1025)},
    {...request(),pointer:{...pointer,scopeId:'\ud800'}}])assert.throws(()=>parseMediaRpcRequest(bad));
  const getter=request();Object.defineProperty(getter,'mediaId',{get(){throw Error('不得讀取 accessor');},enumerable:true});
  assert.throws(()=>parseMediaRpcRequest(getter),/cmcp_media_rpc_contract_invalid/);
});
test('預覽 bounded PNG/JPEG JSON；拒絕超量／其他媒體／模型工作與 body 混入',()=>{
  assert.equal(parseMediaRpcResponse(response()).mediaOriginal.modelCalls,0);
  const jpg=response();jpg.mediaOriginal.dataUrl='data:image/jpeg;base64,/9j/2Q==';assert.equal(parseMediaRpcResponse(jpg),jpg);
  for(const url of ['https://remote/private.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,ab=c',
    'data:image/png;base64,'+Buffer.alloc(MEDIA_RPC_MAX_BYTES+1).toString('base64')]){
    const bad=response();bad.mediaOriginal.dataUrl=url;assert.throws(()=>parseMediaRpcResponse(bad));
  }
  for(const mutate of [value=>{value.mediaOriginal.modelCalls=1;},value=>{value.mediaOriginal.requestBody='private';},
    value=>{value.mediaOriginal.metadata.fullText='x'.repeat(128*1024+1);},value=>{value.mediaOriginal.metadata.loop=value;}]){
    const bad=response();mutate(bad);assert.throws(()=>parseMediaRpcResponse(bad));
  }
  assert.throws(()=>parseMediaRpcResponse({...response(),sessionId:'\0'}));
});
test('guard callback 每次執行；撤權／取消／解除登錄不返回晚到原件',async()=>{
  const h=harness();let release,calls=0;
  const dispose=await installMediaRpc({...h,protocolModulePath,read:async()=>{calls++;return await new Promise(resolve=>{release=resolve;});}});
  const service=h.services.get(MEDIA_RPC_SERVICE),controller=new AbortController();
  const pending=service.read(request(),controller.signal);controller.abort();release(response());
  await assert.rejects(pending,/cmcp_media_rpc_cancelled/);assert.equal(calls,1);
  const late=service.read(request());await dispose();release(response());await assert.rejects(late,/cmcp_media_rpc_cancelled/);
  await assert.rejects(service.read(request()),/cmcp_media_rpc_unloaded/);assert.equal(calls,2);
});
test('錯誤與跨 Session 回覆 fail closed；不更改模型／原生服務',async()=>{
  const h=harness();let bad=false;const dispose=await installMediaRpc({...h,protocolModulePath,read:async()=>{
    if(bad)throw Error('formal_media_not_authorized');const value=response();value.sessionId='different-session';return value;}});
  const service=h.services.get(MEDIA_RPC_SERVICE);
  await assert.rejects(service.read(request()),/cmcp_media_rpc_session_mismatch/);bad=true;
  await assert.rejects(service.read(request()),/formal_media_not_authorized/);await dispose();
  const broken=harness({registerFails:true});await assert.rejects(installMediaRpc({...broken,protocolModulePath,read:async()=>response()}),/registry failure/);
  assert.equal(broken.services.size,0);assert.equal(broken.disposals,1);
});
test('未取得官方協定或可靠子 fiber 時不安裝',async()=>{
  await assert.rejects(installMediaRpc({ctx:{},protocolModulePath,read:async()=>response()}),/cmcp_media_rpc_context_required/);
  const h=harness();await assert.rejects(installMediaRpc({...h,protocolModulePath:'relative.mjs',read:async()=>response()}),/cmcp_media_rpc_protocol_required/);
  await assert.rejects(installMediaRpc({...h,protocolModulePath,read:async()=>response(),importProtocol:async()=>({})}),/cmcp_media_rpc_protocol_unavailable/);
  assert.equal(h.services.size,0);assert.equal(h.registrations.size,0);
});
