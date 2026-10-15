import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {pathToFileURL,fileURLToPath} from 'node:url';
const productRoot=process.env.CMCP_PRODUCT_ROOT?path.resolve(process.env.CMCP_PRODUCT_ROOT):fileURLToPath(new URL('../../',import.meta.url));
const {createOfficialAppServer}=await import(pathToFileURL(path.join(productRoot,'adapters/project-entry/app-server.mjs')).href);
const {runDriver}=await import(pathToFileURL(path.join(productRoot,'adapters/project-entry/codex-driver.mjs')).href);
const {buildHarnessProviderPatch,runHarnessTurn}=await import(pathToFileURL(path.join(productRoot,'adapters/project-entry/harness-driver.mjs')).href);

const root=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(process.cwd(),'.cmcp-test-output/project-entry'),'lifecycle');await fs.mkdir(root,{recursive:true});
test('Groq 使用官方已掛載供應商與獨立憑證參照；舊路線不加登錄',()=>{
  const settings={route:{provider:'groq',model:'openai/gpt-oss-120b'},credentials:{reference:'GROQ_API_KEY'}},before=structuredClone(settings);
  assert.deepEqual(buildHarnessProviderPatch(settings),[{id:'llm-pi-ai',config:{providers:{groq:{apiKeyEnv:'GROQ_API_KEY'}}}}]);assert.deepEqual(settings,before);
  assert.deepEqual(buildHarnessProviderPatch({route:{provider:'deepseek-official'}}),[]);assert.deepEqual(buildHarnessProviderPatch({route:{provider:'another-existing-provider'}}),[]);
  for(const reference of ['DEEPSEEK_API_KEY','literal secret value','https://example.invalid',undefined])assert.throws(()=>buildHarnessProviderPatch({route:settings.route,credentials:{reference}}),/project_entry_groq_credential_reference_required/);
});
test('正常 Harness driver 使用相同供應商 patch，初始化失敗仍正常退出且不送問題',async()=>{
  for(const provider of ['groq','deepseek-official']){
    const directory=await fs.mkdtemp(path.join(root,'harness-provider-')),frames=[];let overlay;
    const settings={executable:process.execPath,cli:path.join(directory,'synthetic-cli.js'),route:{provider,model:provider==='groq'?'openai/gpt-oss-120b':'deepseek-flash'},credentials:{path:path.join(directory,'nonexistent-credentials'),reference:provider==='groq'?'GROQ_API_KEY':'DEEPSEEK_API_KEY'}};
    const config={hosts:{harness:settings},evidenceRoot:path.join(directory,'evidence'),sdkHome:path.join(directory,'sdk'),profileName:'synthetic-sdk',turnDeadlineMs:1000};
    const shared={projectId:'synthetic-sdk',pipe:'synthetic-pipe',hosts:{harness:{agentId:'synthetic-agent',workspace:directory,controlAuthFile:path.join(directory,'controller'),readAuthFile:path.join(directory,'reader')}}};
    const spawnProcess=(_exe,args)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>assert.fail('不得強殺');
      child.stdin.on('data',chunk=>{void(async()=>{const frame=JSON.parse(chunk.toString());frames.push(frame.method);if(frame.method==='initialize'){
        overlay=JSON.parse(await fs.readFile(args[args.indexOf('--patch')+1],'utf8'));child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:frame.id,error:{code:-32602,message:'synthetic_initialize_refusal'}})+'\n');
      }else if(frame.method==='shutdown'){child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:frame.id,result:{}})+'\n');setImmediate(()=>child.emit('close',0,null));}else assert.fail('不得送出問題或新增 RPC');})();});return child;};
    const receipt=await runHarnessTurn({config,shared,text:'不應送出的合成問題',spawnProcess});
    assert.deepEqual(overlay.filter(row=>row.id==='llm-pi-ai'),buildHarnessProviderPatch(settings));
    assert.deepEqual(frames,['initialize','shutdown']);assert.equal(receipt.observedModelRequests,0);assert.equal(receipt.releaseConfirmed,true);assert.equal(receipt.error,'sdk_rpc_failed');
    await assert.rejects(fs.access(settings.credentials.path),{code:'ENOENT'});
  }
});
test('正常關閉逾時明示受阻，不強殺程序；稍後正式退出仍可核對',async()=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>assert.fail('不得強殺');
  const server=createOfficialAppServer({executable:process.execPath,cwd:root,spawnProcess:()=>child,closeTimeoutMs:10});
  await assert.rejects(server.close(),/codex_shared_app_server_close_unconfirmed/);assert.equal(child.stdin.writableEnded,true);
  child.emit('exit',0,null);child.emit('close',0,null);const receipt=await server.close();assert.equal(receipt.closed,true);assert.equal(receipt.forcedOwnedProcessStop,false);
});
async function fixture(mode){
  const directory=await fs.mkdtemp(path.join(root,mode+'-')),workspace=await fs.realpath(directory),events=[],ops=[],requests=[],input=new PassThrough();
  const binding=role=>({kind:'cmcp_codex_shared_binding',version:1,projectId:'lifecycle-synthetic',hostId:'codex',agentId:'native-driver',workspace,role,connection:{pipe:'\\\\.\\pipe\\cmcp-lifecycle-test',authFile:path.join(directory,role+'-auth.json')}});
  const controllerBinding=path.join(directory,'controller-binding.json'),readBinding=path.join(directory,'reader-binding.json');
  await fs.writeFile(controllerBinding,JSON.stringify(binding('controller')));await fs.writeFile(readBinding,JSON.stringify(binding('model_read')));
  const settings={kind:'cmcp_codex_shared_driver',version:1,executable:process.execPath,workspace,controllerBinding,readBinding,ticketFile:path.join(directory,'ticket.json'),evidenceRoot:path.join(directory,'evidence')};
  let turns=0,compactions=0,runRoot;
  const output={write(line){const e=JSON.parse(line);events.push(e);if(e.event==='ready'){runRoot=e.runRoot;input.write('{"command":"claim"}\n');}
    if(e.event==='claimed')input.write(JSON.stringify({command:mode==='crash'?'turn':'compact',...mode==='crash'?{text:'新的合成問題'}:{}})+'\n');
    if(e.event==='compaction_completed'){if(['compact','resume'].includes(mode)&&e.successful)input.write(JSON.stringify({command:'turn',text:'請依正式來源查明較早原稿的條件。'})+'\n');else input.end('{"command":"close"}\n');}
    if(e.event==='turn_completed'||e.event==='command_failed')input.end('{"command":"close"}\n');}};
  const factory=({onNotification:notify,onClosed})=>({notify(){},async close(){return {closed:true,forcedOwnedProcessStop:false,stderrBytes:0,exit:{code:mode==='crash'?17:0}};},async request(method,params){requests.push({method,params});
    if(method==='initialize')return {};if(method==='thread/start'||method==='thread/resume')return {thread:{id:'one-native-session'}};
    if(method==='thread/compact/start'){
      compactions++;setImmediate(()=>{notify('turn/started',{threadId:'one-native-session',turn:{id:'native-compact'}});if(mode!=='missing-item')notify('item/completed',{threadId:'one-native-session',turnId:'native-compact',item:{type:'contextCompaction',id:'compact-item',private:'HIDDEN_REASONING_NOT_RETAINED'}});notify('turn/completed',{threadId:'one-native-session',turn:{id:'native-compact',status:'completed'}});});return {};
    }
    if(method==='turn/start'){
      turns++;setImmediate(()=>{notify('turn/started',{threadId:'one-native-session',turn:{id:'native-turn'}});
        if(mode==='crash'){onClosed({code:17,signal:null});return;}
        notify('item/completed',{threadId:'one-native-session',turnId:'native-turn',completedAtMs:1780000000000,item:{type:'userMessage',id:'u',content:params.input}});
        notify('item/completed',{threadId:'one-native-session',turnId:'native-turn',completedAtMs:1780000001000,item:{type:'agentMessage',id:'a',text:'依原始材料的合成回答。',phase:'final_answer'}});
        notify('turn/completed',{threadId:'one-native-session',turn:{id:'native-turn',status:'completed'}});});return {turn:{id:'native-turn'}};
    }
    if(method==='turn/interrupt')return {};throw Error('unexpected_method');
  }});
  const call=async({request})=>{ops.push(request);if(request.operation==='join')return {epoch:'current:1'};if(request.operation==='status'||request.operation==='claim')return {epoch:'current:1',owner:{hostId:'codex',agentId:'native-driver',sessionId:'one-native-session'}};if(request.operation==='revoke')return {status:'revoked',epoch:'current:2'};return {ok:true};};
  await runDriver({settings,input,output,serverFactory:factory,call,...mode==='resume'?{resumeThreadId:'one-native-session'}:{}});input.end();
  return {events,ops,requests,turns,compactions,runRoot};
}
test('正式壓縮事件與一般原文保存分流，同一 Session 接續且不造 User 訊息',async()=>{
  const f=await fixture('compact');assert.equal(f.compactions,1);assert.equal(f.turns,1);assert.equal(f.requests.filter(x=>x.method==='thread/start').length,1);
  assert.equal(f.events.find(x=>x.event==='compaction_completed').successful,true);assert.equal(f.ops.filter(x=>x.operation==='receive').length,1);assert.equal(f.ops.filter(x=>x.operation==='finish').length,1);
  const files=await fs.readdir(f.runRoot),contents=await Promise.all(files.map(name=>fs.readFile(path.join(f.runRoot,name),'utf8')));assert.equal(contents.some(s=>s.includes('HIDDEN_REASONING')),false);
});
test('只有 RPC 接受與 turn 完成，沒有 contextCompaction 原生事件時不稱壓縮成功',async()=>{
  const f=await fixture('missing-item');assert.equal(f.events.find(x=>x.event==='compaction_completed').successful,false);assert.equal(f.turns,0);assert.equal(f.ops.some(x=>x.operation==='receive'||x.operation==='finish'),false);
});
test('原生程序非正常中斷會撤回該票券，無自動重試或晚到保存',async()=>{
  const f=await fixture('crash');assert.equal(f.events.some(x=>x.event==='native_process_exited'&&x.uncertainExternalOutcome),true);assert.equal(f.turns,1);
  assert.equal(f.ops.filter(x=>x.operation==='revoke').length,1);assert.equal(f.ops.some(x=>x.operation==='finish'||x.operation==='append-assistant'),false);
  const closed=f.events.find(x=>x.event==='driver_closed');assert.equal(closed.successful,false);assert.equal(closed.releaseConfirmed,true);
});
test('壓縮後續問使用正式 thread/resume，保留相同 Session，不自行建立另一個',async()=>{
  const f=await fixture('resume');assert.equal(f.requests.filter(x=>x.method==='thread/start').length,0);assert.equal(f.requests.find(x=>x.method==='thread/resume').params.threadId,'one-native-session');assert.equal(f.events.find(x=>x.event==='compaction_completed').successful,true);assert.equal(f.turns,1);
});
