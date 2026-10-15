import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import test from 'node:test';

const testRepo=fileURLToPath(new URL('../',import.meta.url));
const repo=path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT??testRepo);
const productModule=relative=>import(pathToFileURL(path.join(repo,relative)).href);
const [
  {defaultPlaygroundConfig,playgroundReadingLimits},
  {createCmcpRuntimeSession},
  {describeCmcpProactiveExecution,formatCmcpProactiveDescription},
  {CmcpHarnessBridge}
]=await Promise.all([
  productModule('src/cmcp-guard/cmcp-playground.js'),
  productModule('src/cmcp-guard/cmcp-runtime-session.js'),
  productModule('src/cmcp-guard/cmcp-proactive-description.js'),
  productModule('adapters/deepseek-harness/runtime-bridge.mjs')
]);
const base=path.resolve(process.env.CMCP_PROACTIVE_TEST_ROOT??path.join(testRepo,'logs/public-tests'));
await fs.mkdir(base,{recursive:true});
const root=await fs.mkdtemp(path.join(base,'proactive-description-'));
const evidence={kind:'cmcp_proactive_description_tests',productRoot:repo,clock:'synthetic',productModelCalls:0,networkCalls:0,rows:[]};
async function record(name,run){await test(name,async()=>{const value=await run();evidence.rows.push({name,status:'PASS',...value});});}
async function fixture(name,{proactive=false,readOnly=false,delivery=true}={}){
  const rootDir=path.join(root,name),config=defaultPlaygroundConfig(rootDir,{timezone:'UTC'});
  config.runtimeId='synthetic-proactive-description';config.input.scopeId='synthetic-'+name;
  config.input.events=[];config.providerMode='host';delete config.credentialRef;
  config.controls.proactive=proactive;config.discussionAssociation={enabled:false};
  let now='2032-01-01T00:00:00.000Z';const calls={model:0,delivery:0,credential:0};
  const runtime=await createCmcpRuntimeSession({repoRoot:base,config,readOnly,clock:()=>now,
    readCredential:async()=>{calls.credential++;throw Error('credential_access_forbidden');},
    fetchImpl:async()=>{calls.model++;throw Error('network_forbidden');},
    hostProvider:{request:async()=>{calls.model++;throw Error('model_forbidden');}},
    ...(delivery?{delivery:{present:async()=>{calls.delivery++;throw Error('delivery_denied_by_fixture');}}}:{})});
  return {runtime,config,calls,rootDir,setNow:value=>now=value};
}
async function inventory(dir){const rows=[];async function walk(at){let entries;try{entries=await fs.readdir(at,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const entry of entries){const file=path.join(at,entry.name);if(entry.isDirectory())await walk(file);else if(!entry.name.endsWith('.lock')){
    const data=await fs.readFile(file);rows.push({path:path.relative(dir,file).replaceAll('\\','/'),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}}}
  await walk(dir);return rows.sort((a,b)=>a.path.localeCompare(b.path));}

await record('configuration describes unchanged defaults without claiming live delivery',async()=>{
  const config=defaultPlaygroundConfig(path.join(root,'defaults'),{timezone:'UTC'}),before=structuredClone(config);
  const described=describeCmcpProactiveExecution({loopTiming:config.input.loopTiming,controls:config.controls});
  assert.deepEqual(config,before);assert.equal(config.controls.proactive,false);
  assert.deepEqual(config.input.loopTiming,{ttlMs:600000,inactivityMs:60000,activityWindowMs:600000});
  assert.equal(described.executor.externalDispatch,true);assert.equal(described.executor.retainedLocalInactivityTimerEnabled,false);
  assert.equal(described.executor.liveObserved,false);assert.equal(described.dispatch,null);assert.equal(described.delivery.presentCallbackRegistered,null);
  assert.equal(described.inactivityIsSendDeadline,false);assert.match(formatCmcpProactiveDescription(described),/is not a send deadline/);
  assert.match(formatCmcpProactiveDescription(described,{language:'zh-TW'}),/不代表閒置後必定送出/);
  return {description:described};
});

await record('proactive writable Runtime without delivery remains rejected',async()=>{
  await assert.rejects(fixture('no-delivery',{proactive:true,delivery:false}),/explicit_proactive_delivery_required/);
  const files=await inventory(path.join(root,'no-delivery'));
  assert.equal(files.length,0);return {error:'explicit_proactive_delivery_required',savedFiles:0};
});

await record('empty proactive Runtime stays idle beyond 60 synthetic seconds with zero calls and timers',async()=>{
  const nativeSet=globalThis.setTimeout;let scheduled=0,runtimeFixture;
  globalThis.setTimeout=(...args)=>{scheduled++;return nativeSet(...args);};
  try{runtimeFixture=await fixture('empty-on',{proactive:true});const {runtime,calls,setNow}=runtimeFixture;
    const first=await runtime.status();setNow('2032-01-01T00:01:01.000Z');const later=await runtime.status();
    assert.equal(first.proactiveExecutor.dispatch.reason,'no_eligible_scheduled_candidate');
    assert.equal(later.proactiveExecutor.dispatch.reason,'no_eligible_scheduled_candidate');
    assert.equal(later.proactiveExecutor.dispatch.timerScheduled,false);assert.equal(later.proactiveExecutor.timerScheduled,false);
    assert.equal(later.proactiveExecutor.execution.executor.liveObserved,true);
    assert.equal(later.proactiveExecutor.execution.delivery.presentCallbackRegistered,true);
    assert.equal(later.proactiveExecutor.execution.delivery.successfulDeliveryInferred,false);
    assert.equal(later.proactiveExecutor.execution.configured.inactivityMs,60000);
    assert.equal(later.timeLimits.proactiveTimingMeaning,'retained_local_loop_compatibility_not_runtime_send_deadline');
    assert.deepEqual(calls,{model:0,delivery:0,credential:0});assert.equal(scheduled,0);
    return {before:first.proactiveExecutor.execution,after:later.proactiveExecutor.execution,calls,scheduledTimers:scheduled};
  }finally{await runtimeFixture?.runtime.close();globalThis.setTimeout=nativeSet;}
});

await record('status and format preserve saved sources times controls and files',async()=>{
  const {runtime,calls,rootDir}=await fixture('read-only-observation');
  try{await runtime.ingest({text:'這是隔離合成原文，尚未指定提醒。',role:'user',messageRecordedAt:'2031-12-31T22:00:00.000Z'});
    const initial=await runtime.status(),files=await inventory(rootDir),buffer=await runtime.bufferList();
    for(let index=0;index<3;index++){const status=await runtime.status();formatCmcpProactiveDescription(status.proactiveExecutor.execution);
      assert.deepEqual(status.controlConfiguration,initial.controlConfiguration);assert.deepEqual(status.state.registration,initial.state.registration);
      assert.deepEqual(await runtime.bufferList(),buffer);}
    assert.deepEqual(await inventory(rootDir),files);assert.deepEqual(calls,{model:0,delivery:0,credential:0});
    return {files,registered:initial.state.registration.registered,calls};
  }finally{await runtime.close();}
});

await record('read-only Runtime never labels another writer as observed or stopped',async()=>{
  const {runtime,calls}=await fixture('reader',{readOnly:true,proactive:true,delivery:false});
  try{const status=await runtime.status();assert.equal(status.proactiveExecutor.execution.observation,'read_only_runtime_inspection');
    assert.equal(status.proactiveExecutor.execution.executor.liveObserved,false);assert.equal(status.proactiveExecutor.execution.dispatch,null);
    assert.equal(status.proactiveExecutor.execution.delivery.presentCallbackRegistered,null);assert.deepEqual(calls,{model:0,delivery:0,credential:0});
    return {description:status.proactiveExecutor.execution,calls};
  }finally{await runtime.close();}
});

await record('explicit Pin retains dueAt across status reads and OFF cancels its timer without deleting Pin',async()=>{
  const {runtime,calls,setNow}=await fixture('pin-schedule',{proactive:true});
  try{await runtime.ingest({text:'隔離合成來源，只在明確指定後才能建立 Pin。',role:'user',messageRecordedAt:'2031-12-31T23:00:00.000Z'});
    const state=await runtime.status(),sourceId=state.state.registration.sources[0].id,dueAt='2032-01-01T00:05:00.000Z';
    const pin=await runtime.pinCreate({updateId:'synthetic-create',sourceIds:[sourceId],dueAt,
      userAction:{kind:'callable_authorization',authorized:true,scopeId:state.dataScope.scopeId}});
    const scheduled=await runtime.status();assert.equal(scheduled.proactiveExecutor.execution.dispatch.reason,'waiting_due');
    assert.equal(scheduled.proactiveExecutor.execution.dispatch.timerScheduled,true);
    assert.equal(scheduled.proactiveExecutor.execution.dispatch.scheduledAt,dueAt);
    setNow('2032-01-01T00:01:01.000Z');const after=await runtime.status();
    assert.equal(after.proactiveExecutor.execution.dispatch.scheduledAt,dueAt);assert.equal((await runtime.pinList()).pins[0].dueAt,dueAt);
    await runtime.configureControls({updateId:'synthetic-off',patch:{proactive:false}});
    const off=await runtime.status();assert.equal(off.proactiveExecutor.execution.dispatch.timerScheduled,false);
    assert.equal(off.proactiveExecutor.execution.dispatch.reason,'disabled');assert.equal((await runtime.pinList()).pins[0].status,'active');
    assert.deepEqual(calls,{model:0,delivery:0,credential:0});return {pin,scheduled:scheduled.proactiveExecutor.execution,off:off.proactiveExecutor.execution,calls};
  }finally{await runtime.close();}
});

await record('Harness existing generation guard accepts only explicit Pin destinations',async()=>{
  const bridge=Object.create(CmcpHarnessBridge.prototype);bridge.options={scopeId:'synthetic-host'};let requests=0;
  bridge.host={request:async()=>{requests++;return {status:'synthetic_host_callback'};}};
  bridge.destinations=async()=>new Map([['p1',{scopeId:'synthetic-host',sessionId:'synthetic-session'}]]);
  await assert.rejects(bridge.hostRequest('proactive',{}, {dispatch:{candidate:{route:'buffer',id:'p1'}}}),/harness_requires_explicit_pin_destination/);
  await assert.rejects(bridge.hostRequest('proactive',{}, {dispatch:{candidate:{route:'pin',id:'unknown'}}}),/pin_destination_unavailable/);
  assert.equal(requests,0);return {bufferRejected:true,unknownTargetRejected:true,hostRequests:requests};
});

await record('public status CLI exposes the same explanation in JSON and human output without file changes',async()=>{
  const dataRoot=path.join(root,'public-cli'),config=defaultPlaygroundConfig(dataRoot,{timezone:'UTC'});
  config.input.events=[];config.providerMode='host';delete config.credentialRef;
  await fs.mkdir(dataRoot,{recursive:true});
  await fs.writeFile(path.join(dataRoot,'config.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
  await fs.writeFile(path.join(dataRoot,'playground.json'),JSON.stringify({kind:'cmcp_playground_ui',version:1,
    topics:[{key:null,label:'合成一般對話'}],readingLimits:playgroundReadingLimits},null,2)+'\n',{flag:'wx'});
  const before=await inventory(dataRoot),args=[path.join(repo,'bin/cmcp-time.mjs'),'status','--workspace',base,'--root',path.relative(base,dataRoot)];
  const structured=spawnSync(process.execPath,[...args,'--json'],{encoding:'utf8',timeout:15000});
  assert.equal(structured.status,0,structured.stderr+structured.stdout);const status=JSON.parse(structured.stdout);
  assert.equal(status.proactiveExecutor.execution.configured.inactivityMs,60000);
  assert.equal(status.proactiveExecutor.execution.inactivityIsSendDeadline,false);
  assert.equal(status.proactiveExecutor.execution.observation,'read_only_runtime_inspection');
  const human=spawnSync(process.execPath,args,{encoding:'utf8',timeout:15000});
  assert.equal(human.status,0,human.stderr+human.stdout);assert.match(human.stdout,/is not a send deadline/);
  assert.deepEqual(await inventory(dataRoot),before);
  return {command:'cmcp-time status --workspace <synthetic-root> --root <synthetic-config> [--json]',
    structuredExit:structured.status,humanExit:human.status,structuredStdout:structured.stdout,humanStdout:human.stdout};
});

await record('Harness status separates declared Pin route from an unattached host',async()=>{
  const {runtime,calls}=await fixture('bridge-view',{readOnly:true,delivery:false});
  try{const bridge=Object.create(CmcpHarnessBridge.prototype);
    bridge.options={scopeId:'synthetic-bridge-view'};bridge.turns=new Map();bridge.host=null;bridge.current=null;
    bridge.readOnly=callback=>callback(runtime);bridge.destinations=async()=>new Map();
    bridge.traceObservation=async()=>({kind:'synthetic_trace_not_collected',modelCalls:0});
    const state=await bridge.status();assert.deepEqual(state.proactive.execution.delivery.routes,['pin']);
    assert.equal(state.proactive.execution.delivery.hostAttached,false);
    assert.equal(state.proactive.execution.delivery.targetAvailability,'per_pin_check_required');
    assert.equal(state.proactive.execution.executor.liveObserved,false);assert.equal(state.proactive.liveDispatch,null);
    assert.equal(state.proactive.execution.delivery.successfulDeliveryInferred,false);assert.deepEqual(calls,{model:0,delivery:0,credential:0});
    return {description:state.proactive.execution,calls};
  }finally{await runtime.close();}
});

await fs.writeFile(path.join(root,'result.json'),JSON.stringify({...evidence,root,at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({kind:evidence.kind,root,passed:evidence.rows.length,productModelCalls:0}));
