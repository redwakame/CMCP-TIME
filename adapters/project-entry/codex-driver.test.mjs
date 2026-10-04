import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PassThrough} from 'node:stream';
import {runDriver} from './codex-driver.mjs';

const fixtures=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(process.cwd(),'.cmcp-test-output/project-entry'),'codex-driver');await fs.mkdir(fixtures,{recursive:true});
test('official-route simulation awaits admission, passes normal approval, preserves capabilities and records only public evidence',{timeout:10000},async()=>{
  const fixture=await fs.mkdtemp(path.join(fixtures,'route-')),workspace=await fs.realpath(fixture);
  const makeBinding=role=>({kind:'cmcp_codex_shared_binding',version:1,projectId:'synthetic-project',hostId:'codex',agentId:'configured-client',workspace,role,connection:{pipe:'\\\\.\\pipe\\cmcp-synthetic-driver',authFile:path.join(fixture,role+'.json')}});
  const control=path.join(fixture,'controller-binding.json'),reader=path.join(fixture,'read-binding.json');await fs.writeFile(control,JSON.stringify(makeBinding('controller')));await fs.writeFile(reader,JSON.stringify(makeBinding('model_read')));
  const settings={kind:'cmcp_codex_shared_driver',version:1,executable:process.execPath,workspace,controllerBinding:control,readBinding:reader,ticketFile:path.join(fixture,'ticket.json'),evidenceRoot:path.join(fixture,'evidence')};
  const input=new PassThrough(),emitted=[],calls=[];let turnRequest,threadRequest,closed=false,nativeAnswered=false,runRoot;
  const output={write(line){const row=JSON.parse(line);emitted.push(row);if(row.event==='ready'){runRoot=row.runRoot;input.write(JSON.stringify({command:'claim'})+'\n');}
    if(row.event==='claimed')input.write(JSON.stringify({command:'turn',text:'synthetic current request'})+'\n');
    if(row.event==='native_request'){nativeAnswered=true;input.write(JSON.stringify({command:'native-response',requestId:row.requestId,result:{decision:'accept'}})+'\n');}
    if(row.event==='turn_completed')input.end(JSON.stringify({command:'close'})+'\n');}};
  const factory=({onNotification,onRequest})=>({notify(){},async close(){closed=true;return {closed:true,stderrBytes:0,exit:{code:0}};},async request(method,params){
    if(method==='initialize')return {userAgent:'synthetic official-route fixture'};
    if(method==='thread/start'){threadRequest=params;return {thread:{id:'official-fresh-session'},model:'preserved',modelProvider:'preserved',approvalPolicy:'on-request',sandbox:{type:'workspaceWrite'}};}
    if(method==='turn/start'){
      turnRequest=params;
      setImmediate(async()=>{
        const base={threadId:'official-fresh-session',turnId:'official-turn',completedAtMs:1780000000000};
        onNotification('turn/started',{threadId:base.threadId,turn:{id:base.turnId,startedAt:1780000000}});
        onNotification('item/completed',{...base,item:{type:'userMessage',id:'u',content:params.input}});
        onNotification('item/completed',{...base,item:{type:'reasoning',content:['HIDDEN_SENTINEL_MUST_NOT_APPEAR']}});
        const approval=await onRequest('item/commandExecution/requestApproval',{threadId:base.threadId,turnId:base.turnId,itemId:'command',command:'echo synthetic',cwd:workspace});assert.deepEqual(approval,{decision:'accept'});
        const result=await onRequest('item/tool/call',{threadId:base.threadId,turnId:base.turnId,callId:'cmcp-call',namespace:null,tool:'cmcp_find_history',arguments:{}});assert.equal(result.success,true);
        onNotification('item/completed',{...base,item:{type:'agentMessage',id:'a1',text:'visible commentary',phase:'commentary',delivery:null}});
        onNotification('item/completed',{...base,completedAtMs:1780000001000,item:{type:'agentMessage',id:'a2',text:'visible final',phase:'final_answer',delivery:null}});
        onNotification('thread/tokenUsage/updated',{threadId:base.threadId,turnId:base.turnId,tokenUsage:{total:{inputTokens:10,outputTokens:5,reasoningOutputTokens:2,untrusted:'HIDDEN_SENTINEL_MUST_NOT_APPEAR'},last:{totalTokens:15},modelContextWindow:100}});
        onNotification('turn/completed',{threadId:base.threadId,turn:{id:base.turnId,status:'completed',startedAt:1780000000,completedAt:1780000001,durationMs:1000,items:[{type:'reasoning',content:['HIDDEN_SENTINEL_MUST_NOT_APPEAR']}]}});
      });return {turn:{id:'official-turn'}};
    }
    throw Error('unexpected_method');
  }});
  const call=async value=>{calls.push(value);const op=value.request.operation;
    if(op==='join')return {joined:true,epoch:'epoch:1'};if(op==='claim')return {owner:{hostId:'codex',agentId:'configured-client',sessionId:'official-fresh-session'},epoch:'epoch:2'};
    if(op==='status')return {owner:{hostId:'codex',agentId:'configured-client',sessionId:'official-fresh-session'},epoch:'epoch:2'};
    if(op==='receive')await new Promise(resolve=>setTimeout(resolve,20));return {ok:true};};
  await runDriver({settings,input,output,serverFactory:factory,call});
  assert.equal(closed,true);assert.equal(nativeAnswered,true);assert.equal(Object.hasOwn(threadRequest,'approvalPolicy'),false);assert.equal(Object.hasOwn(threadRequest,'sandbox'),false);assert.equal(Object.hasOwn(threadRequest,'model'),false);
  assert.equal(turnRequest.input[0].text,'synthetic current request');
  assert.deepEqual(calls.map(x=>x.request.operation),['join','status','claim','status','receive','claim-turn','find','append-assistant','append-assistant','finish','revoke']);
  assert.equal(calls.find(x=>x.request.operation==='find').role,'model_read');
  const rows=await Promise.all((await fs.readdir(runRoot)).map(name=>fs.readFile(path.join(runRoot,name),'utf8')));assert.equal(rows.some(row=>row.includes('HIDDEN_SENTINEL')),false);
  assert.equal(rows.filter(row=>JSON.parse(row).kind==='codex_shared_token_usage').length,1);
  assert.equal(emitted.some(row=>row.event==='failed'||row.event==='command_failed'),false);
});

test('explicit claim refreshes a prejoined epoch after another host releases ownership',{timeout:10000},async()=>{
  const fixture=await fs.mkdtemp(path.join(fixtures,'claim-epoch-')),workspace=await fs.realpath(fixture);
  const binding=role=>({kind:'cmcp_codex_shared_binding',version:1,projectId:'synthetic-project',hostId:'codex',agentId:'configured-client',workspace,role,connection:{pipe:'\\\\.\\pipe\\cmcp-synthetic-claim',authFile:path.join(fixture,role+'.json')}});
  const controllerBinding=path.join(fixture,'controller-binding.json'),readBinding=path.join(fixture,'read-binding.json');
  await fs.writeFile(controllerBinding,JSON.stringify(binding('controller')));await fs.writeFile(readBinding,JSON.stringify(binding('model_read')));
  const settings={kind:'cmcp_codex_shared_driver',version:1,executable:process.execPath,workspace,controllerBinding,readBinding,ticketFile:path.join(fixture,'ticket.json'),evidenceRoot:path.join(fixture,'evidence')};
  const input=new PassThrough(),events=[],calls=[];
  const output={write(line){const value=JSON.parse(line);events.push(value);if(value.event==='ready')input.write(JSON.stringify({command:'claim'})+'\n');if(value.event==='claimed'||value.event==='command_failed')input.end(JSON.stringify({command:'close'})+'\n');}};
  const serverFactory=()=>({notify(){},async close(){return {closed:true,stderrBytes:0,exit:{code:0}};},async request(method){if(method==='initialize')return {};if(method==='thread/start')return {thread:{id:'fresh-native-session'}};assert.fail('No turn or model request is authorized in this fixture');}});
  const call=async value=>{calls.push(value.request);switch(value.request.operation){
    case 'join':return {joined:true,epoch:'broker-instance:0'};
    case 'status':return {epoch:'broker-instance:4',owner:null,joined:true};
    case 'claim':if(value.request.epoch!=='broker-instance:4')throw Error('shared_project_epoch_stale');return {epoch:'broker-instance:5',owner:{hostId:'codex',agentId:'configured-client',sessionId:'fresh-native-session'}};
    case 'revoke':assert.equal(value.request.epoch,'broker-instance:5');return {status:'revoked',epoch:'broker-instance:6',owner:null};
    default:assert.fail('Only explicit ownership commands are authorized');
  }};
  await runDriver({settings,input,output,serverFactory,call});
  assert.equal(events.some(row=>row.event==='claimed'),true,'Explicit claim must use the current status epoch, not the stale join epoch');
  assert.deepEqual(calls.map(row=>row.operation),['join','status','claim','revoke']);
  assert.equal(calls.find(row=>row.operation==='claim').epoch,'broker-instance:4');
  assert.equal(JSON.parse(await fs.readFile(settings.ticketFile,'utf8')).epoch,'broker-instance:5');
});

for(const command of ['close','interrupt'])test(`${command} interrupts the active native turn before queued completion and revokes only its ticket`,{timeout:10000},async()=>{
  const fixture=await fs.mkdtemp(path.join(fixtures,command+'-')),workspace=await fs.realpath(fixture);
  const binding=role=>({kind:'cmcp_codex_shared_binding',version:1,projectId:'synthetic-project',hostId:'codex',agentId:'configured-client',workspace,role,connection:{pipe:'\\\\.\\pipe\\cmcp-synthetic-stop',authFile:path.join(fixture,role+'.json')}});
  const controllerBinding=path.join(fixture,'controller-binding.json'),readBinding=path.join(fixture,'read-binding.json');
  await fs.writeFile(controllerBinding,JSON.stringify(binding('controller')));await fs.writeFile(readBinding,JSON.stringify(binding('model_read')));
  const settings={kind:'cmcp_codex_shared_driver',version:1,executable:process.execPath,workspace,controllerBinding,readBinding,ticketFile:path.join(fixture,'ticket.json'),evidenceRoot:path.join(fixture,'evidence')};
  const input=new PassThrough(),events=[],order=[],requests=[];let runRoot,notify,nativeRejected=false,completedSent=false;
  const output={write(line){const row=JSON.parse(line);events.push(row);
    if(row.event==='ready'){runRoot=row.runRoot;input.write(JSON.stringify({command:'claim'})+'\n');}
    if(row.event==='claimed')input.write(JSON.stringify({command:'turn',text:'synthetic pending turn'})+'\n');
    if(row.event==='native_request')input.write(JSON.stringify({command})+'\n');
    if(row.event==='turn_completed'&&command==='interrupt')input.write(JSON.stringify({command:'close'})+'\n');
  }};
  const serverFactory=({onNotification,onRequest})=>{notify=onNotification;return {notify(){},async close(){assert.equal(completedSent,true,'Close must wait for official turn/completed');order.push('server-close');return {closed:true,stderrBytes:0,exit:{code:0}};},async request(method,params){
    requests.push({method,params});
    if(method==='initialize')return {};
    if(method==='thread/start')return {thread:{id:'owned-fresh-thread'}};
    if(method==='turn/start'){
      setImmediate(async()=>{
        const base={threadId:'owned-fresh-thread',turnId:'owned-turn',completedAtMs:1780000000000};
        notify('turn/started',{threadId:base.threadId,turn:{id:base.turnId}});
        notify('item/completed',{...base,item:{type:'userMessage',id:'u',content:params.input}});
        try{await onRequest(command==='close'?'item/commandExecution/requestApproval':'item/tool/requestUserInput',{...base,itemId:'native-wait'});assert.fail('A pending native request must be cancelled');}catch(error){assert.equal(error.message,'codex_shared_turn_interrupted');nativeRejected=true;order.push('native-rejected');}
      });
      return {turn:{id:'owned-turn'}};
    }
    if(method==='turn/interrupt'){
      assert.deepEqual(params,{threadId:'owned-fresh-thread',turnId:'owned-turn'});order.push('interrupt');
      notify('item/completed',{threadId:'owned-fresh-thread',turnId:'owned-turn',completedAtMs:1780000000010,item:{type:'agentMessage',id:'late-assistant',text:'must not save after stop',phase:'final_answer'}});
      setTimeout(()=>{completedSent=true;order.push('official-completed');notify('turn/completed',{threadId:'owned-fresh-thread',turn:{id:'owned-turn',status:command==='close'?'interrupted':'failed',error:command==='interrupt'?{message:JSON.stringify({status:400,error:{type:'invalid_request_error',message:'RAW_PRIVATE_SENTINEL'}})}:null}});},20);
      return {};
    }
    assert.fail('Unexpected native method '+method);
  }};};
  const call=async({request})=>{order.push(request.operation);
    if(request.operation==='join')return {epoch:'broker:1'};
    if(request.operation==='status')return {epoch:'broker:1',owner:{hostId:'codex',agentId:'configured-client',sessionId:'owned-fresh-thread'}};
    if(request.operation==='claim')return {epoch:'broker:1',owner:{hostId:'codex',agentId:'configured-client',sessionId:'owned-fresh-thread'}};
    if(request.operation==='cancel')return {status:'cancelled'};
    if(request.operation==='revoke'){assert.equal(request.epoch,'broker:1');assert.equal(request.sessionId,'owned-fresh-thread');return {status:'revoked'};}
    return {ok:true};
  };
  await runDriver({settings,input,output,serverFactory,call});input.end();
  assert.equal(nativeRejected,true);assert.equal(requests.filter(row=>row.method==='turn/interrupt').length,1);
  assert.equal(order.includes('finish'),false);assert.equal(order.includes('append-assistant'),false);assert.equal(order.includes('receive'),false);
  assert.ok(order.indexOf('revoke')<order.indexOf('official-completed'));assert.equal(order.filter(value=>value==='revoke').length,1);assert.ok(order.indexOf('server-close')>order.indexOf('official-completed'));
  assert.deepEqual(order.filter(value=>value==='status'),['status','status'],'Cleanup must not refresh the epoch');
  const completed=events.find(row=>row.event==='turn_completed');assert.equal(completed.successful,false);assert.equal(completed.interrupted,true);
  if(command==='interrupt')assert.deepEqual(completed.error,{code:'invalid_request_error',status:400});
  const saved=await Promise.all((await fs.readdir(runRoot)).map(name=>fs.readFile(path.join(runRoot,name),'utf8')));
  assert.equal(saved.some(text=>text.includes('RAW_PRIVATE_SENTINEL')),false);
  assert.equal(saved.map(JSON.parse).find(row=>row.kind==='codex_shared_driver_closed').successful,false);
});
