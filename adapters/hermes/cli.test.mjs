import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createMcpProject} from '../mcp/config.mjs';
import {configureHermes,loadHermesConfig} from './config.mjs';
import {runHermes} from './cli.mjs';
const out=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??'hermes-cli-test-results');await fs.mkdir(out,{recursive:true});
const root=await fs.mkdtemp(path.join(out,'cli-'));
const project=await createMcpProject({root:path.join(root,'project'),projectId:'cli-synthetic',hosts:['hermes'],port:18978,timezone:'UTC'}),config=path.join(root,'hermes.json');
await configureHermes({output:config,serviceConfig:project.configFile,python:process.execPath,home:path.join(project.projectRoot,'hermes-home'),credentialFile:path.join(root,'not-a-real-credential')});
test('未指定供應商的 v1 設定保留既有 DeepSeek 預設及原生設定',async()=>{
  const {config:value}=await loadHermesConfig(config);
  assert.equal(Object.hasOwn(value,'provider'),false);assert.equal(value.version,1);
  assert.equal(value.baseUrl,'https://api.deepseek.com');assert.equal(value.model,'deepseek-flash');assert.equal(value.credentialRef,'DEEPSEEK_API_KEY');
  const native=JSON.parse(await fs.readFile(path.join(value.home,'config.yaml'),'utf8'));
  assert.deepEqual(native.model,{default:'deepseek-flash',provider:'custom',base_url:'https://api.deepseek.com'});
  assert.equal(native.security.allow_lazy_installs,false);assert.equal(native.memory.memory_enabled,false);
  assert.equal(Object.hasOwn(value,'readMaxPages'),false);
});
test('正常 configure 明設 bounded pages，inspect 回報已選 scalar；非法設定不寫出',async()=>{
 const output=path.join(root,'bounded-pages.json'),home=path.join(project.projectRoot,'bounded-pages-home');
 await runHermes(['configure','--service',project.configFile,'--python',process.execPath,'--home',home,'--credential-file',path.join(root,'unread-reference'),'--output',output,'--read-max-pages','2'],{emit:()=>{}});
 const loaded=await loadHermesConfig(output);assert.equal(loaded.config.readMaxPages,2);
 const inspected=await runHermes(['inspect','--config',output],{emit:()=>{}});assert.deepEqual(inspected.readingTransport,{operation:'cmcp_read_continuity',readMaxPages:2,maximum:2});
 for(const readMaxPages of [0,3,1.5,'2',true,null]){const file=path.join(root,'invalid-batch-'+String(readMaxPages)+'.json');await fs.writeFile(file,JSON.stringify({...loaded.config,readMaxPages}));await assert.rejects(loadHermesConfig(file),/invalid_read_max_pages/);}
 const invalid=path.join(root,'not-written-batch.json');await assert.rejects(configureHermes({output:invalid,serviceConfig:project.configFile,python:process.execPath,home:path.join(project.projectRoot,'not-written-home'),credentialFile:path.join(root,'unread-reference'),readMaxPages:3}),/invalid_read_max_pages/);await assert.rejects(fs.access(invalid),{code:'ENOENT'});
});
test('明示 Groq 的正常 configure 與 inspect 使用獨立參照，零憑證讀取',async()=>{
  const output=path.join(root,'groq.json'),home=path.join(project.projectRoot,'groq-home'),credentialFile=path.join(root,'nonexistent-groq-reference-file');
  const result=await runHermes(['configure','--service',project.configFile,'--python',process.execPath,'--home',home,'--credential-file',credentialFile,'--output',output,'--provider','groq','--model','openai/gpt-oss-120b','--credential-reference','GROQ_API_KEY'],{emit:()=>{}});
  assert.equal(result.modelCalls,0);const {config:value}=await loadHermesConfig(output);
  assert.equal(value.provider,'groq');assert.equal(value.baseUrl,'https://api.groq.com/openai/v1');assert.equal(value.model,'openai/gpt-oss-120b');assert.equal(value.credentialRef,'GROQ_API_KEY');
  await assert.rejects(fs.access(credentialFile),{code:'ENOENT'});
  const native=JSON.parse(await fs.readFile(path.join(home,'config.yaml'),'utf8'));
  assert.deepEqual(native.model,{default:value.model,provider:'custom',base_url:value.baseUrl});
  const inspected=await runHermes(['inspect','--config',output],{emit:()=>{}});
  assert.deepEqual(inspected.route,{baseUrl:value.baseUrl,model:value.model,provider:'groq'});assert.equal(inspected.modelCalls,0);
  const other=path.join(root,'other-groq-model.json');await fs.writeFile(other,JSON.stringify({...value,model:'example/authorized-model-v2'}));
  assert.equal((await loadHermesConfig(other)).config.model,'example/authorized-model-v2');
  const invalid=[{provider:undefined},{provider:null},{provider:'unknown'},{baseUrl:'https://example.invalid/v1'},{credentialRef:'DEEPSEEK_API_KEY'},{credentialRef:'secret value'},{model:'invalid model'}];
  for(let i=0;i<invalid.length;i++){const file=path.join(root,`invalid-route-${i}.json`);await fs.writeFile(file,JSON.stringify({...value,...invalid[i]}));await assert.rejects(loadHermesConfig(file),/hermes_(existing_deepseek_route_required|explicit_groq_route_required|unsupported_provider)/);}
});
test('Groq 未明示模型或獨立憑證參照不能建立半成品設定',async()=>{
  for(const extra of [{provider:'groq',credentialRef:'GROQ_API_KEY'},{provider:'groq',model:'openai/gpt-oss-120b'},{provider:'other'}]){
    const name=`missing-route-${Object.keys(extra).join('-')}`,output=path.join(root,name+'.json'),home=path.join(project.projectRoot,name);
    await assert.rejects(configureHermes({output,serviceConfig:project.configFile,python:process.execPath,home,credentialFile:path.join(root,'absent-reference'),...extra}),/hermes_(explicit_groq_route_required|unsupported_provider)/);
    await assert.rejects(fs.access(output),{code:'ENOENT'});await assert.rejects(fs.access(home),{code:'ENOENT'});
  }
});
for(const released of [true,false])test('取消待正式釋放才顯示 stopped：'+released,async()=>{
  const controller=new AbortController(),rows=[],frames=[],receipt=path.join(root,`cancel-${released}.jsonl`);
  const spawnProcess=(_exe,args)=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.stdin=new Writable({write(chunk,_enc,done){const value=JSON.parse(chunk.toString());frames.push(value);if(value.type==='cancel'){
      void (async()=>{if(released)await fs.appendFile(args[args.indexOf('--receipt')+1],JSON.stringify({kind:'closed',state:'released'})+'\n');child.emit('close',2);})();
    }else queueMicrotask(()=>controller.abort());done();}});return child;
  };
  const before=process.exitCode;const value=await runHermes(['chat','--config',config,'--session','synthetic-cancel','--authorize-session','--message','合成原始問題','--receipt',receipt],{emit:row=>rows.push(row),signal:controller.signal,spawnProcess,stdout:new PassThrough(),stderr:new PassThrough()});process.exitCode=before;
  assert.equal(frames[1].requestId,frames[0].requestId);assert.equal(value.releaseConfirmed,released);assert.equal(value.state,released?'stopped':'stopping');assert.equal(rows[0].state,'stopping');
});
test('未明示驗收資料授權不能啟動 peer，零模型',async()=>{await assert.rejects(runHermes(['harness-chat','--config',config,'--message','合成'],{emit:()=>{}}),/synthetic_authorization_required/);});
test('peer 的宿主失敗不能以成功 exit code 讓後續流程繼續',async()=>{const before=process.exitCode;try{await runHermes(['harness-chat','--config',config,'--authorize-session','--synthetic-evidence','--message','合成'],{emit:()=>{},peerRunner:async()=>({successful:false,error:'synthetic_native_failure'})});assert.equal(process.exitCode,2);}finally{process.exitCode=before;}});
