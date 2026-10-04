import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createProject,loadProject,listProjects} from './config.mjs';
import {createProjectController} from './controller.mjs';
import {runHarnessTurn} from './harness-driver.mjs';
import {runProjectCli} from './cli.mjs';
import {createOfficialAppServer} from './app-server.mjs';
import {inspectProjectRecovery,recoverProjectWork} from './recovery.mjs';

const testRoot=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(process.cwd(),'.cmcp-test-output/project-entry'));
await fs.mkdir(testRoot,{recursive:true});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function setup(name='second-independent-project'){
  const directory=await fs.mkdtemp(path.join(testRoot,'case-')),projectRoot=path.join(directory,'project'),credential=path.join(directory,'provider-reference.yaml');
  await fs.writeFile(credential,'private-fixture-never-copy');
  const spec={projectId:name,projectRoot,hosts:{codex:{executable:process.execPath},harness:{executable:process.execPath,cli:path.join(directory,'installed-cli.js'),credentials:{path:credential,reference:'EXISTING_PROVIDER_KEY'},route:{provider:'existing-provider',model:'existing-model'}}}};
  const created=await createProject(spec,{protect:async()=>{}});return {...created,spec,directory,loaded:await loadProject(created.configFile)};
}
async function fakeController(options={}){
  const fixture=await setup(),events=[],calls=[];let brokerStops=0,hostCalls=0,hostEnded=false;
  const runner=options.runner??(async({text,onEvent,signal,setNativeResponder})=>{hostCalls++;onEvent({event:'new_session',host:'codex',sessionId:'native-current'});if(options.pending){setNativeResponder?.(value=>calls.push({operation:'native-response',value}));await options.pending.promise;}hostEnded=true;return {releaseConfirmed:true,successful:!signal.aborted,text};});
  const controller=await createProjectController({configFile:fixture.configFile,onEvent:event=>events.push(event),load:options.load??loadProject,startBroker:options.startBroker??(async()=>({close:async()=>{brokerStops++;return {status:'closed'};}})),call:options.call??(async request=>{calls.push(request.request);return {epoch:'epoch-current',owner:null,joined:true,modelCalls:0};}),runners:{codex:runner,harness:runner}});
  return {fixture,controller,events,calls,metrics:()=>({brokerStops,hostCalls,hostEnded})};
}
test('new named project config is independent and does not copy existing provider credentials',async()=>{
  const first=await setup('north-project'),second=await setup('south-project');
  assert.notEqual(first.loaded.shared.pipe,second.loaded.shared.pipe);assert.equal(first.loaded.shared.projectId,'north-project');
  assert.equal(first.loaded.config.hosts.harness.route.model,'existing-model');assert.equal(await fs.readFile(first.spec.hosts.harness.credentials.path,'utf8'),'private-fixture-never-copy');
  const configuration=await fs.readFile(first.configFile,'utf8');assert.equal(configuration.includes('private-fixture-never-copy'),false);assert.equal(configuration.includes('cross-host-'),false);
  await assert.rejects(createProject(first.spec,{protect:async()=>{}}),/project_entry_root_exists/);
  assert.equal((await listProjects(first.directory)).length,1);
});
test('status calls no host and enable joins but does not claim or override shared control',async()=>{
  const f=await fakeController();await f.controller.status();await f.controller.enable('codex');
  assert.equal(f.metrics().hostCalls,0);assert.deepEqual(f.calls.map(row=>row.operation),['status','join']);
  await f.controller.close();assert.deepEqual(f.calls.map(row=>row.operation),['status','join','status','revoke']);assert.equal(f.metrics().brokerStops,1);
});
test('normal text goes unchanged and control uses a joined human Session with current epoch',async()=>{
  const f=await fakeController();await f.controller.enable('harness');const text='正常問題\r\n 保留空白 ';
  assert.equal((await f.controller.ask(text)).text,text);await f.controller.control('sources 1');
  const command=f.calls.find(row=>row.operation==='control');assert.equal(command.args.text,'sources 1');assert.equal(command.epoch,'epoch-current');assert.ok(command.sessionId.startsWith('cmcp-entry-'));await f.controller.close();
});
test('control results arriving after disable are not emitted',async()=>{
  const called=deferred(),result=deferred(),f=await fakeController({call:async({request})=>{if(request.operation==='control'){called.resolve();return result.promise;}return {epoch:'current-epoch',joined:true};}});
  await f.controller.enable('harness');const reading=f.controller.control('sources');reading.catch(()=>{});await called.promise;await f.controller.disable();result.resolve({sources:['late-private-content']});await assert.rejects(reading,/project_entry_stopped/);assert.equal(f.events.some(event=>event.event==='control'),false);
});
test('disable during broker start closes only the newly created owned broker and cannot enable late',async()=>{
  const ready=deferred(),started=deferred();let closeCount=0;const f=await fakeController({startBroker:()=>{started.resolve();return ready.promise;}});const enabling=f.controller.enable('codex');enabling.catch(()=>{});
  await started.promise;const stopping=f.controller.disable();ready.resolve({close:async()=>{closeCount++;}});
  await stopping;await assert.rejects(enabling,/project_entry_stopped/);assert.equal(f.controller.state,'disabled');assert.equal(closeCount,1);assert.equal(f.events.some(event=>event.event==='enabled'),false);
});
test('pending native response goes through unchanged; disable waits and blocks late display',async()=>{
  const gate=deferred();let context;const f=await fakeController({runner:async options=>{context=options;options.onEvent({event:'new_session',sessionId:'native-owned'});options.setNativeResponder(value=>f.calls.push({operation:'native-response',value}));await gate.promise;options.onEvent({event:'answer',text:'late answer'});return {releaseConfirmed:true,successful:false,interrupted:true};}});
  await f.controller.enable('codex');const turn=f.controller.ask('使用者問題');while(!context)await new Promise(resolve=>setImmediate(resolve));
  f.controller.respond({requestId:'original-id',result:{decision:'decline'}});assert.deepEqual(f.calls.at(-1).value.result,{decision:'decline'});
  await f.controller.control('status');assert.equal(f.calls.find(row=>row.operation==='control').sessionId,'native-owned');
  const stopping=f.controller.disable();assert.equal(f.controller.state,'stopping');assert.equal(context.signal.aborted,true);assert.throws(()=>f.controller.ask('晚到問題'),/project_entry_enable_required/);assert.throws(()=>f.controller.respond({requestId:'old',result:{}}),/project_entry_no_native_request/);
  gate.resolve();await stopping;await turn;assert.equal(f.events.some(event=>event.text==='late answer'),false);assert.equal(f.events.some(event=>event.event==='turn_saved'),false);assert.equal(f.controller.state,'disabled');
});
test('unconfirmed release remains stopping and never emits closed or starts another host',async()=>{
  const f=await fakeController({runner:async()=>({releaseConfirmed:false,successful:false})});await f.controller.enable('codex');await assert.rejects(f.controller.ask('問題'),/project_entry_release_unconfirmed/);
  await assert.rejects(f.controller.close(),/project_entry_release_unconfirmed/);assert.equal(f.controller.state,'stopping');assert.equal(f.metrics().brokerStops,0);assert.equal(f.events.some(event=>event.event==='closed'),false);
});
test('compaction is an explicit operation bound to the last successful Codex Session of this enabled project',async()=>{
  const seen=[],f=await fakeController({runner:async options=>{seen.push(options);return {successful:true,releaseConfirmed:true,sessionId:'owned-codex-session'};}});
  await f.controller.enable('codex');assert.throws(()=>f.controller.compact(),/compaction_session_required/);await f.controller.ask('一般合成問題');await f.controller.compact('壓縮後正式回查');
  assert.equal(seen[1].resumeThreadId,'owned-codex-session');assert.equal(seen[1].compactBefore,true);assert.equal(seen[1].text,'壓縮後正式回查');
  await f.controller.disable();await f.controller.enable('codex');assert.throws(()=>f.controller.compact(),/compaction_session_required/);await f.controller.close();
});
test('selection requires disabled state and prompt-file must be in selected workspace',async()=>{
  const f=await fakeController(),second=await setup('other-project');await f.controller.enable('harness');await assert.rejects(f.controller.select(second.configFile),/project_entry_disable_before_select/);
  await assert.rejects(f.controller.askFile(f.fixture.spec.hosts.harness.credentials.path),/project_entry_prompt_outside_workspace/);await f.controller.disable();await f.controller.select(second.configFile);assert.equal(f.controller.project.projectId,'other-project');await f.controller.close();
});
test('occupied broker fails closed without stopping an external owner',async()=>{
  const f=await fakeController({startBroker:async()=>{throw Error('shared_project_pipe_busy');}});await assert.rejects(f.controller.enable('codex'),/shared_project_pipe_busy/);assert.equal(f.controller.state,'disabled');assert.equal(f.metrics().brokerStops,0);await f.controller.close();
});
async function sdkFixture({cancel=false,unsupported=false,otherOwner=false}={}){
  const setupResult=await setup(),config=setupResult.loaded.config,shared=setupResult.loaded.shared,methods=[],events=[],controlCalls=[],abort=new AbortController();let submitted;
  const promptSeen=deferred();
  const spawnProcess=(_exe,args)=>{
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
    let buffer='';child.stdin.on('data',chunk=>{buffer+=chunk;for(let end;(end=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const request=JSON.parse(line);if(!request.method)continue;methods.push(request.method);
      void(async()=>{const overlay=JSON.parse(await fs.readFile(args[args.indexOf('--patch')+1],'utf8')),insert=overlay.find(row=>row.insert).insert,host=insert[0].config,preflight=insert[1].config;const send=value=>child.stdout.write(JSON.stringify(value)+'\n');
        if(request.method==='initialize'){await fs.writeFile(preflight.outputFile,JSON.stringify({credentialConfigured:true,hostCapabilityDependencyReady:true}));send({id:request.id,result:{}});}
        else if(request.method==='session/prompt'){
          submitted=request.params;await fs.appendFile(path.join(host.artifactRoot,'host-events.jsonl'),JSON.stringify({kind:'session_authorized'})+'\n');send({id:request.id,result:{messageId:'native-u'}});promptSeen.resolve();
          if(unsupported){send({id:'native-request',method:'permission/request',params:{}});return;}if(cancel)return;
          send({method:'session.event',params:{sessionId:request.params.sessionId,event:{type:'assistant/message',time:1780000000000,data:{message:{id:'native-a',role:'assistant',content:[{type:'text',text:'可見原答'}]},turn:1,interrupted:false}}}});
          await fs.appendFile(path.join(host.artifactRoot,'host-events.jsonl'),JSON.stringify({kind:'assistant_saved'})+'\n'+JSON.stringify({kind:'turn_saved'})+'\n');send({method:'session.event',params:{sessionId:request.params.sessionId,event:{type:'turn/end',time:1780000000001,data:{turn:1,reason:{kind:'completed'}}}}});
        }else if(request.method==='shutdown'){await fs.appendFile(path.join(host.artifactRoot,'host-events.jsonl'),JSON.stringify({kind:'session_released'})+'\n');send({id:request.id,result:{}});setImmediate(()=>{child.emit('close',0,null);child.stdout.end();child.stderr.end();});}
        else assert.fail('unverified RPC '+request.method);
      })();
    }});return child;
  };
  const call=async({request})=>{controlCalls.push(request);return request.operation==='revoke'?{status:'revoked'}:{epoch:'original-live-epoch',owner:{hostId:'harness',agentId:shared.hosts.harness.agentId,sessionId:otherOwner?'another-writer':'arbitrary-new-session'}};};
  const promise=runHarnessTurn({config,shared,text:'正常SDK輸入\n',signal:abort.signal,onEvent:event=>events.push(event),spawnProcess,call,sessionId:'arbitrary-new-session'});
  await promptSeen.promise;if(cancel)abort.abort();return {result:await promise,methods,events,submitted,controlCalls};
}
test('Harness uses configured route and real SDK method shape; reads visible answer after release',async()=>{
  const f=await sdkFixture();assert.deepEqual(f.methods,['initialize','session/prompt','shutdown']);assert.equal(f.submitted.contentBlocks[0].text,'正常SDK輸入\n');assert.equal(f.result.successful,true);assert.equal(f.result.releaseConfirmed,true);assert.equal(f.events.find(event=>event.event==='answer').text,'可見原答');
});
test('Harness abort requests only official shutdown and does not emit completed or late answers',async()=>{
  const f=await sdkFixture({cancel:true});assert.deepEqual(f.methods,['initialize','session/prompt','shutdown']);assert.equal(f.result.interrupted,true);assert.equal(f.result.successful,false);assert.equal(f.result.releaseConfirmed,true);assert.equal(f.events.some(event=>event.event==='answer'),false);assert.equal(f.result.stopGuard.revokedOwnedSession,true);assert.equal(f.controlCalls.filter(row=>row.operation==='revoke').length,1);assert.equal(f.controlCalls.find(row=>row.operation==='revoke').sessionId,'arbitrary-new-session');
});
test('Harness stop guard never revokes a different writer',async()=>{
  const f=await sdkFixture({cancel:true,otherOwner:true});assert.equal(f.controlCalls.some(row=>row.operation==='revoke'),false);assert.equal(f.result.stopGuard.revokedOwnedSession,false);assert.equal(f.result.successful,false);
});
test('unsupported Harness native requests are exposed without accepting permissions',async()=>{
  const f=await sdkFixture({unsupported:true});assert.equal(f.result.successful,false);assert.equal(f.result.error,'harness_native_request_unsupported');assert.equal(f.events.find(event=>event.event==='native_request').supported,false);
});
test('help imports no host and CLI direct prompt requires no JSON or prompt-file',async()=>{
  let output='';await runProjectCli(['help'],{output:{write:text=>{output+=text;}}});assert.match(output,/project init/);
  const calls=[];const mock={enable:async host=>calls.push(['enable',host]),ask:async text=>calls.push(['ask',text]),close:async()=>calls.push(['close'])};
  await runProjectCli(['ask','--config',path.join(testRoot,'selected-entry.json'),'--host','codex','--prompt','我的一般問題'],{output:{write(){}},makeController:async()=>mock});assert.deepEqual(calls,[['enable','codex'],['ask','我的一般問題'],['close']]);
});
test('recovery inspection is model-free, starts no host, and stale choices cannot mutate work',async()=>{
  const f=await setup('recovery-inspection'),before=await inspectProjectRecovery(f.configFile);assert.deepEqual(before.work,[]);assert.equal(before.modelCalls,0);assert.equal(before.executionRetried,false);
  await assert.rejects(recoverProjectWork({configFile:f.configFile,option:1,snapshot:'old-snapshot'}),/project_recovery_options_changed/);
  await assert.rejects(recoverProjectWork({configFile:f.configFile,option:1,snapshot:before.snapshot}),/project_recovery_option_missing/);
  let output='';await runProjectCli(['recover','--config',f.configFile],{input:new PassThrough(),output:{write:text=>{output+=text;}},makeController:()=>assert.fail('recovery must not start a host')});
  assert.deepEqual(JSON.parse(output),before);assert.deepEqual(await inspectProjectRecovery(f.configFile),before);
});
test('open supports cmcp control alias without a model call',async()=>{
  const input=new PassThrough(),calls=[];input.end('/cmcp help\n/close\n');
  const mock={status:async()=>{},control:async text=>{calls.push(text);return {modelCalls:0};},close:async()=>calls.push('close')};
  await runProjectCli(['open','--config',path.join(testRoot,'selected-entry.json')],{input,output:{write(){}},makeController:async()=>mock});assert.deepEqual(calls,['help','close']);
});
test('CLI creates another project with only root name and routes-from flags',async()=>{
  const first=await setup(),nextRoot=path.join(first.directory,'new-via-flags');let output='';
  await runProjectCli(['init','--root',nextRoot,'--name','new-normal-project','--routes-from',first.configFile],{input:new PassThrough(),output:{write:text=>{output+=text;}}});
  const result=JSON.parse(output),second=await loadProject(result.configFile);assert.equal(result.modelCalls,0);assert.equal(second.config.projectId,'new-normal-project');assert.deepEqual(second.config.hosts,first.loaded.config.hosts);assert.notEqual(second.shared.pipe,first.loaded.shared.pipe);
});
test('noninteractive native permission request stops without sending approval',async()=>{
  const gate=deferred(),events=[];let emit;const mock={enable:async()=>{},ask:async()=>{emit({event:'native_request',method:'item/commandExecution/requestApproval',requestId:'native-id'});await gate.promise;},disable:async()=>{events.push('disable');gate.resolve();},respond:()=>assert.fail('must not approve'),close:async()=>events.push('close')};
  await runProjectCli(['ask','--config',path.join(testRoot,'selected-entry.json'),'--host','codex','--prompt','正常問題'],{input:new PassThrough(),output:{write:text=>events.push(text)},makeController:async({onEvent})=>{emit=onEvent;return mock;}});assert.ok(events.includes('disable'));assert.ok(events.some(event=>typeof event==='string'&&event.includes('native_input_required')));
});
test('official app-server close waits for observed process close',async()=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>assert.fail('should exit normally');
  const server=createOfficialAppServer({executable:process.execPath,cwd:testRoot,spawnProcess:()=>child});let finished=false;
  const closing=server.close().then(value=>{finished=true;return value;});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
  child.emit('exit',0,null);await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);child.emit('close',0,null);assert.equal((await closing).closed,true);
});
