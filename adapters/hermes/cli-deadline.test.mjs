import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter,getEventListeners} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createMcpProject} from '../mcp/config.mjs';
import {configureHermes} from './config.mjs';
import {runHermes} from './cli.mjs';

const out=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??'hermes-deadline-test-results');await fs.mkdir(out,{recursive:true});
const root=await fs.mkdtemp(path.join(out,'deadline-'));
const project=await createMcpProject({root:path.join(root,'project'),projectId:'deadline-synthetic',hosts:['hermes'],port:18980,timezone:'UTC'}),config=path.join(root,'hermes.json');
await configureHermes({output:config,serviceConfig:project.configFile,python:process.execPath,home:path.join(project.projectRoot,'hermes-home'),credentialFile:path.join(root,'no-real-credential'),timeoutSeconds:600});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function clock(){let callback=null,cleared=0,scheduled=0;return {timers:{setTimeout(fn,ms){assert.equal(ms,600000);callback=fn;scheduled++;return 42;},clearTimeout(id){assert.equal(id,42);callback=null;cleared++;}},fire(){assert.ok(callback);callback();},get scheduled(){return scheduled;},get cleared(){return cleared;}};}
function fixture(name,{action='chat',nativeOnly=false,signal}={}){
  const c=clock(),started=deferred(),cancelled=deferred(),frames=[],rows=[],receipt=path.join(root,name+'.jsonl');let child,settled=false;
  const spawnProcess=()=>{
    child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{throw Error('禁止強殺合成子程序');};
    child.stdin=new Writable({write(chunk,_enc,done){const value=JSON.parse(chunk.toString());frames.push(value);if(value.type==='cancel')cancelled.resolve(value);else started.resolve(value);done();}});
    if(action==='probe')queueMicrotask(()=>started.resolve(null));return child;
  };
  const argv=[action,'--config',config,'--receipt',receipt];if(action==='chat')argv.push('--session','synthetic-'+name,nativeOnly?'--native-only':'--authorize-session','--message','合成期限查核，不呼叫模型');
  const pending=runHermes(argv,{emit:v=>rows.push(v),spawnProcess,signal,timers:c.timers,stdout:new PassThrough(),stderr:new PassThrough()}).then(v=>{settled=true;return v;});
  return {pending,c,started,cancelled,frames,rows,receipt,get child(){return child;},get settled(){return settled;}};
}
for(const released of [true,false])test('設定期限送出具名取消，等正式關閉與釋放：'+released,async()=>{
  const previous=process.exitCode;
  try{
    const f=fixture('deadline-'+released),initial=await f.started.promise;f.c.fire();const cancel=await f.cancelled.promise;
    assert.deepEqual(cancel,{type:'cancel',requestId:initial.requestId});assert.equal(f.rows[0].reason,'deadline');assert.equal(f.rows[0].state,'stopping');assert.equal(f.rows[0].releaseConfirmed,false);assert.equal(f.settled,false);
    f.child.stdout.write('晚到文字不等於完成');await Promise.resolve();assert.equal(f.settled,false);
    if(released)await fs.appendFile(f.receipt,JSON.stringify({kind:'closed',state:'released'})+'\n');
    f.child.emit('close',0);const result=await f.pending;
    assert.equal(result.state,released?'stopped':'stopping');assert.equal(result.stopReason,'deadline');assert.equal(result.releaseConfirmed,released);assert.equal(result.stopRequested,true);assert.equal(f.frames.length,2);assert.equal(f.c.cleared,1);assert.equal(process.exitCode,2);
  }finally{process.exitCode=previous;}
});
test('外部取消與期限競合只送一次，保留先到原因',async()=>{
  const previous=process.exitCode,parent=new AbortController(),before=getEventListeners(parent.signal,'abort').length;
  try{
    const f=fixture('parent',{signal:parent.signal});await f.started.promise;parent.abort();await f.cancelled.promise;f.c.fire();
    assert.equal(f.frames.filter(x=>x.type==='cancel').length,1);await fs.appendFile(f.receipt,JSON.stringify({kind:'closed',state:'released'})+'\n');f.child.emit('close',2);const result=await f.pending;
    assert.equal(result.stopReason,'parent_cancel');assert.equal(result.state,'stopped');assert.equal(f.c.cleared,1);assert.equal(getEventListeners(parent.signal,'abort').length,before);
  }finally{process.exitCode=previous;}
});
test('期限先到，之後外部取消不更換原因或重送',async()=>{
  const previous=process.exitCode,parent=new AbortController();
  try{const f=fixture('deadline-first',{signal:parent.signal});await f.started.promise;f.c.fire();await f.cancelled.promise;parent.abort();f.child.emit('close',2);const result=await f.pending;assert.equal(result.stopReason,'deadline');assert.equal(f.frames.length,2);assert.equal(result.state,'stopping');}finally{process.exitCode=previous;}
});
test('正常完成清除期限與 listener，不製造取消',async()=>{
  const parent=new AbortController(),f=fixture('normal',{signal:parent.signal});await f.started.promise;f.child.emit('close',0);const result=await f.pending;
  assert.equal(result.state,'completed');assert.equal(result.stopRequested,false);assert.equal(Object.hasOwn(result,'stopReason'),false);assert.equal(f.frames.length,1);assert.equal(f.c.cleared,1);assert.equal(getEventListeners(parent.signal,'abort').length,0);
});
test('啟動失敗也清除期限與 listener',async()=>{
  const parent=new AbortController(),f=fixture('launch-error',{signal:parent.signal});await f.started.promise;f.child.emit('error',Error('synthetic'));
  await assert.rejects(f.pending,/hermes_python_launch_failed/);assert.equal(f.c.cleared,1);assert.equal(getEventListeners(parent.signal,'abort').length,0);
});
test('probe 不建立模型回合期限，也不接受 chat 取消',async()=>{
  const parent=new AbortController(),f=fixture('probe',{action:'probe',signal:parent.signal});await f.started.promise;parent.abort();f.child.emit('close',0);const result=await f.pending;
  assert.equal(result.action,'probe');assert.equal(result.state,'completed');assert.equal(f.c.scheduled,0);assert.equal(f.c.cleared,0);assert.equal(f.frames.length,0);
});
test('native-only chat 保留相同期限，未取得釋放不冒稱 stopped',async()=>{
  const previous=process.exitCode;
  try{const f=fixture('native',{nativeOnly:true});await f.started.promise;f.c.fire();await f.cancelled.promise;f.child.emit('close',2);const result=await f.pending;assert.equal(result.stopReason,'deadline');assert.equal(result.state,'stopping');assert.equal(result.releaseConfirmed,false);}finally{process.exitCode=previous;}
});
test('呼叫前已取消不啟動宿主或計時器',async()=>{
  const parent=new AbortController();parent.abort();let spawned=false,scheduled=false;
  await assert.rejects(runHermes(['chat','--config',config,'--session','pre-cancel','--authorize-session','--message','合成','--receipt',path.join(root,'pre-cancel.jsonl')],{emit:()=>{},signal:parent.signal,spawnProcess:()=>{spawned=true;},timers:{setTimeout(){scheduled=true;},clearTimeout(){}}}),/hermes_cancelled/);
  assert.equal(spawned,false);assert.equal(scheduled,false);
});
