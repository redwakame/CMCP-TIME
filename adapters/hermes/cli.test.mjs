import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createMcpProject} from '../mcp/config.mjs';
import {configureHermes} from './config.mjs';
import {runHermes} from './cli.mjs';
const out=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??'hermes-cli-test-results');await fs.mkdir(out,{recursive:true});
const root=await fs.mkdtemp(path.join(out,'cli-'));
const project=await createMcpProject({root:path.join(root,'project'),projectId:'cli-synthetic',hosts:['hermes'],port:18978,timezone:'UTC'}),config=path.join(root,'hermes.json');
await configureHermes({output:config,serviceConfig:project.configFile,python:process.execPath,home:path.join(project.projectRoot,'hermes-home'),credentialFile:path.join(root,'not-a-real-credential')});
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
