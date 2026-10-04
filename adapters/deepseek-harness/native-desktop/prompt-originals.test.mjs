// RAM 接納暫存與授權／復原反例；不啟動 Desktop、不讀秘密、不呼叫模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {installPromptOriginalCapture} from './prompt-originals.mjs';

const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489','hex');
const jpeg=Buffer.from([255,216,255,224,0,16,74,70,73,70]);
const image=(data=png,mediaType='image/png',name='合成原圖.png')=>({type:'image',mediaType,data:data.toString('base64'),name});
const request=(id='r1',content=[image()])=>({sessionId:'s1',requestId:id,mode:'queue',content,clientTimeZone:'Asia/Taipei'});
function fixture({prompt=async function(){return {accepted:true};},allowed=true,stamp='epoch1:g1',now=()=>1000,metadata=()=>{}}={}){
  const service={prompt};let guard={allowed,stamp};
  const capture=installPromptOriginalCapture({service,authorized:async id=>id==='s1'?guard:null,recordMetadata:metadata,now});
  return {service,capture,setGuard:value=>{guard=value;},original:prompt};
}

test('原 PNG／JPEG bytes、檔名與 SHA 不被正規化；只取一次且 RAM 釋放',async()=>{
  const f=fixture();const result=await f.service.prompt(request('r1',[image(),image(jpeg,'image/jpeg','修訂.jpeg')]),new AbortController().signal);
  assert.deepEqual(result,{accepted:true});const taken=await f.capture.take('s1','r1');
  assert.equal(taken.status,'available');assert.equal(taken.images.length,2);
  for(const [index,data] of [png,jpeg].entries()){assert.deepEqual(taken.images[index].data,data);assert.equal(taken.images[index].sha256,createHash('sha256').update(data).digest('hex'));assert.equal(taken.images[index].bytes,data.length);}
  assert.equal(taken.images[1].originalName,'修訂.jpeg');assert.equal(f.capture.status().bytes,0);assert.equal((await f.capture.take('s1','r1')).status,'unavailable');f.capture.dispose();
});
test('外 scope／OFF／未知 requestId 不讀正文，保留原生 this／signal／回值',async()=>{
  const signal=new AbortController().signal,calls=[];const service={marker:17,prompt:async function(...args){calls.push({thisValue:this,args});return {accepted:true,receipt:2};}};
  const capture=installPromptOriginalCapture({service,authorized:async()=>null});const req={sessionId:'outside',requestId:'r'};
  Object.defineProperty(req,'content',{get(){throw Error('不可讀未授權正文');}});
  assert.deepEqual(await service.prompt(req,signal),{accepted:true,receipt:2});assert.equal(calls[0].thisValue,service);assert.equal(calls[0].args[1],signal);
  await service.prompt({sessionId:'s1'},signal);assert.equal(calls.length,2);assert.equal(capture.status().requests,0);capture.dispose();
});
test('Clean／停止保存／OFF 的 guard 改變使在途與 take fail closed',async()=>{
  let settle;const f=fixture({prompt:()=>new Promise(resolve=>{settle=resolve;})});const p=f.service.prompt(request());
  await new Promise(resolve=>setImmediate(resolve));f.setGuard({allowed:false,stamp:'epoch2:g2'});settle({accepted:true});await p;
  assert.equal((await f.capture.take('s1','r1')).status,'unavailable');assert.equal(f.capture.status().requests,0);
  f.setGuard({allowed:true,stamp:'epoch3:g3'});const second=f.service.prompt(request('r2'));await new Promise(resolve=>setImmediate(resolve));settle({accepted:true});await second;
  f.setGuard({allowed:true,stamp:'epoch3:g4'});assert.equal((await f.capture.take('s1','r2')).reason,'cmcp_media_capture_authorization_changed');f.capture.dispose();
});
test('原生拒絕、無法保存與 metadata 例外不偽造接納或阻斷正常聊天',async()=>{
  const failure=Error('native validation denied');const denied=fixture({prompt:async()=>{throw failure;}});
  await assert.rejects(denied.service.prompt(request()),error=>error===failure);assert.equal(denied.capture.status().requests,0);denied.capture.dispose();
  const f=fixture({metadata:()=>{throw Error('logger unavailable');}});const malformed=request('bad',[{...image(),data:'not canonical base64'}]);
  assert.deepEqual(await f.service.prompt(malformed),{accepted:true});assert.equal((await f.capture.take('s1','bad')).status,'unavailable');
  await f.service.prompt(request());assert.equal((await f.capture.take('s1','r1')).status,'available');f.capture.dispose();
});
test('同 requestId 重送不能以新圖替換第一次接納的原件',async()=>{
  const f=fixture();await f.service.prompt(request());const changed=request('r1');Object.defineProperty(changed,'content',{get(){throw Error('不可解析重送資料');}});
  await f.service.prompt(changed);const taken=await f.capture.take('s1','r1');assert.deepEqual(taken.images[0].data,png);f.capture.dispose();
});
test('範圍上限與 TTL 有界，超限只停原件暫存不關原生聊天',async()=>{
  let time=1000;const f=fixture({now:()=>time});
  for(let i=0;i<8;i++)await f.service.prompt(request('r'+i));assert.equal(f.capture.status().requests,8);
  assert.deepEqual(await f.service.prompt(request('r8')),{accepted:true});assert.equal((await f.capture.take('s1','r8')).status,'unavailable');
  time+=5*60*1000;assert.equal(f.capture.status().requests,0);assert.equal(f.capture.status().bytes,0);
  await f.service.prompt(request('many',Array.from({length:5},()=>image())));assert.equal((await f.capture.take('s1','many')).status,'unavailable');
  const huge=Buffer.alloc(8*1024*1024+1);png.copy(huge);await f.service.prompt(request('huge',[image(huge)]));assert.equal((await f.capture.take('s1','huge')).status,'unavailable');
  await f.service.prompt(request('mismatch',[image(jpeg)]));assert.equal((await f.capture.take('s1','mismatch')).status,'unavailable');f.capture.dispose();
});
test('上限內的大型原件仍可暫存；metadata 不包含 base64／正文',async()=>{
  const rows=[],data=Buffer.alloc(3*1024*1024,80);png.copy(data);const f=fixture({metadata:row=>rows.push(row)});
  await f.service.prompt(request('large',[image(data)]));const saved=await f.capture.take('s1','large');
  assert.equal(saved.status,'available');assert.equal(saved.images[0].bytes,data.length);assert.deepEqual(saved.images[0].data,data);
  assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]).sort(),['bytes','imageCount','kind','requestId','sessionId'].sort());f.capture.dispose();
});
test('Cordis shadow 取實體、原 descriptor 復原、不搶後裝 wrapper',async()=>{
  class Service{async prompt(){return {accepted:true};}}const real=new Service();const inherited=real.prompt;
  const shadow=new Proxy(real,{get:(target,key)=>key===Symbol.for('cordis.original')?target:Reflect.get(target,key)});
  const capture=installPromptOriginalCapture({service:shadow,authorized:async()=>({allowed:true,stamp:'g1'})});assert.notEqual(real.prompt,inherited);
  assert.deepEqual(capture.dispose(),{restored:true,conflict:false});assert.equal(real.prompt,inherited);assert.equal(Object.hasOwn(real,'prompt'),false);
  const f=fixture();const later=async()=>({accepted:true});f.service.prompt=later;assert.deepEqual(f.capture.dispose(),{restored:false,conflict:true});assert.equal(f.service.prompt,later);
  assert.throws(()=>installPromptOriginalCapture({service:Object.defineProperty({},'prompt',{value:inherited}),authorized:async()=>null}),/not_reversible/u);
});
test('take 等原生接納完成；dispose 在途只撤暫存並安全透傳',async()=>{
  let settle;const f=fixture({prompt:()=>new Promise(resolve=>{settle=resolve;})});const p=f.service.prompt(request());
  await new Promise(resolve=>setImmediate(resolve));const taking=f.capture.take('s1','r1');settle({accepted:true});assert.deepEqual(await p,{accepted:true});assert.equal((await taking).status,'available');
  const second=f.service.prompt(request('r2'));await new Promise(resolve=>setImmediate(resolve));f.capture.dispose();settle({accepted:true});assert.deepEqual(await second,{accepted:true});assert.equal(f.capture.status().requests,0);
});
test('官方同步 inbox emit 與非阻塞 followup 次序不形成 take／prompt 互等', {timeout:2000},async()=>{
  const order=[];let capture,queue=Promise.resolve();
  const service={prompt(input){
    // 模擬已查證的官方同步 inserted 通知：監聽器只排程，不把工作 Promise 回傳給 followup。
    order.push('native_inserted');queue=queue.then(async()=>{
      order.push('take_started');const originals=await capture.take(input.sessionId,input.requestId);
      assert.equal(originals.status,'available');order.push('formal_save_ready');
    });
    order.push('native_accepted');return Promise.resolve({accepted:true});
  }};
  capture=installPromptOriginalCapture({service,authorized:async()=>{
    await Promise.resolve();return {allowed:true,stamp:'epoch1:g1'};
  }});
  assert.deepEqual(await service.prompt(request()),{accepted:true});await queue;
  assert.ok(order.indexOf('native_accepted')<order.indexOf('formal_save_ready'));
  assert.equal(capture.status().requests,0);capture.dispose();
});
