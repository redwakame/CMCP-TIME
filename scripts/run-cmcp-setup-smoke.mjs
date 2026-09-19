import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {configureCmcpInstallation,normalizeCmcpSetupChoices,inspectCmcpSetupEnvironment} from '../src/cmcp-guard/cmcp-setup.js';
import {handleCmcpCodexHook} from '../src/cmcp-guard/cmcp-codex-hooks.js';
import {createCmcpRuntimeSession} from '../src/cmcp-guard/cmcp-runtime-session.js';
import {runCmcpSetupCli} from './cmcp-setup.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url)),allowed=path.join(repo,'logs/public-tests'),root=path.resolve(process.env.CMCP_SETUP_TEST_ROOT??path.join(allowed,'setup-'+randomUUID()));
const relative=path.relative(allowed,root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Tests require a new candidate-local logs/public-tests directory.');
await fs.mkdir(path.dirname(root),{recursive:true});await fs.mkdir(root);const results=[];
const run=async(name,test)=>{try{await test();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',error:error.stack});}};
const choices={timezone:'Europe/Berlin',scopeId:'synthetic-private',owner:{id:'self',label:'Synthetic owner'},people:[],saveUser:true,saveAssistant:true,
 enabled:true,clean:false,proactive:false,attachCodex:true,providerMode:'host',allowPaidCalls:false,authorizedBy:'offline synthetic setup acceptance'};
const inspect=()=>({node:process.versions.node,nodeSupported:true,codex:{available:true,version:'offline-probe'},modelCalls:0,adminRequired:false});
let installed;
await run('explicit_authorization_validation_and_no_admin',async()=>{
 assert.throws(()=>normalizeCmcpSetupChoices({...choices,saveUser:undefined}),/explicit_setup_choice/);
 assert.throws(()=>normalizeCmcpSetupChoices({...choices,proactive:true}),/consent/);
 assert.throws(()=>normalizeCmcpSetupChoices({...choices,allowPaidCalls:true}),/consent/);
 assert.throws(()=>normalizeCmcpSetupChoices({...choices,providerMode:'configured',allowPaidCalls:false}),/explicit_paid_consent/);
 assert.throws(()=>normalizeCmcpSetupChoices({...choices,timezone:'Invalid/Zone'}),/timezone/);
 for(const hours of [5,49,NaN])assert.throws(()=>normalizeCmcpSetupChoices({...choices,bufferHours:hours}),/hours/);
 for(const hours of [6,12,48])assert.equal(normalizeCmcpSetupChoices({...choices,bufferHours:hours}).bufferHours,hours);
 assert.throws(()=>inspectCmcpSetupEnvironment({nodeVersion:'16.0.0'}),/node_18/);
});
await run('clean_project_setup_creates_generic_config_skill_hooks_without_grant',async()=>{
 const host=path.join(root,'clean host');await fs.mkdir(path.join(host,'.codex'),{recursive:true});
 await fs.writeFile(path.join(host,'.codex/hooks.json'),JSON.stringify({description:'unrelated',hooks:{Stop:[{hooks:[{type:'command',command:'unrelated-command'}]}]}}));
 installed=await configureCmcpInstallation({projectRoot:repo,root:path.join(root,'data'),hostWorkspace:host,choices,inspect});
 assert.equal(installed.grantCreated,false);assert.equal(installed.environment.adminRequired,false);assert.equal(installed.modelCalls,0);
 const config=JSON.parse(await fs.readFile(installed.configFile));assert.deepEqual(config.input.events,[]);assert.equal(config.responsePreferences.language,'en');
 assert.equal(config.input.timezone,'Europe/Berlin');assert.equal(config.controls.proactive,false);assert.equal(config.bufferRetention.hours,12);
 const hooks=JSON.parse(await fs.readFile(path.join(host,'.codex/hooks.json')));assert.equal(hooks.hooks.Stop[0].hooks[0].command,'unrelated-command');
 assert.ok(hooks.hooks.UserPromptSubmit.length);assert.ok(hooks.hooks.SessionStart.some(row=>row.matcher==='compact'));
 await assert.rejects(fs.stat(path.join(root,'data/state/runtime-budget')),e=>e.code==='ENOENT');
});
await run('update_preserves_data_and_unrelated_hooks_without_duplicates',async()=>{
 await fs.mkdir(path.join(installed.root,'state'),{recursive:true});await fs.writeFile(path.join(installed.root,'state/source-fixture.txt'),'synthetic retained');
 const updated=await configureCmcpInstallation({projectRoot:repo,root:installed.root,hostWorkspace:installed.hostWorkspace,choices:{...choices,language:'ja'},action:'update',inspect});
 assert.equal(updated.runtimeId,installed.runtimeId);const hooks=JSON.parse(await fs.readFile(path.join(installed.hostWorkspace,'.codex/hooks.json')));
 assert.equal(hooks.hooks.UserPromptSubmit.length,1);assert.equal(hooks.hooks.Stop.length,2);
 assert.equal(await fs.readFile(path.join(installed.root,'state/source-fixture.txt'),'utf8'),'synthetic retained');
});
await run('disable_uninstall_detach_owned_hooks_and_keep_data',async()=>{
 const disabled=await configureCmcpInstallation({projectRoot:repo,root:installed.root,action:'disable',inspect});
 assert.equal(disabled.disabledScope,'managed_codex_hook_binding');assert.equal(disabled.runtimeControlsUnchanged,true);assert.equal(disabled.manualSkill,'remains_available');
 const hooks=JSON.parse(await fs.readFile(path.join(installed.hostWorkspace,'.codex/hooks.json')));assert.ok(!hooks.hooks.UserPromptSubmit);assert.equal(hooks.hooks.Stop[0].hooks[0].command,'unrelated-command');
 assert.equal(JSON.parse(await fs.readFile(installed.bindingFile)).enabled,false);
 await configureCmcpInstallation({projectRoot:repo,root:installed.root,action:'uninstall',inspect});
 await assert.rejects(fs.stat(path.join(installed.hostWorkspace,'.agents/skills/cmcp-context/SKILL.md')),e=>e.code==='ENOENT');
 assert.equal(await fs.readFile(path.join(installed.root,'state/source-fixture.txt'),'utf8'),'synthetic retained');
});
await run('update_expands_explicit_save_consent_and_timezone_via_journal_not_old_binding',async()=>{
 const initial=await configureCmcpInstallation({projectRoot:repo,root:path.join(root,'consent-data'),hostWorkspace:path.join(root,'consent-host'),
  choices:{...choices,saveUser:false,saveAssistant:false},inspect});
 const before=JSON.parse(await fs.readFile(initial.configFile));
 await configureCmcpInstallation({projectRoot:repo,root:initial.root,action:'update',choices:{...choices,timezone:'Pacific/Auckland',language:'en'},inspect});
 const config=JSON.parse(await fs.readFile(initial.configFile));assert.deepEqual(config.input,before.input);assert.deepEqual(config.sourceAuthorization,before.sourceAuthorization);
 const runtime=await createCmcpRuntimeSession({config,repoRoot:repo,sessionId:'setup-consent-check',controls:{proactive:false},readCredential:async()=>{throw Error('credential access forbidden');}});
 try{
  const controls=await runtime.controlsSnapshot();assert.equal(controls.effective.timezone,'Pacific/Auckland');assert.equal(controls.effective.saveUser,true);
  const receipt=await runtime.beforeUser({text:'A newly authorized synthetic source.',sourceId:'consent-1'});assert.ok(receipt.sourcePointer);
 }finally{await runtime.close();}
 const out=spawnSync(process.execPath,[path.join(initial.hostWorkspace,'.agents/skills/cmcp-context/scripts/recall.mjs'),'--config',initial.configFile,'--status'],{encoding:'utf8',windowsHide:true,cwd:initial.hostWorkspace});
 assert.equal(out.status,0,out.stderr);assert.ok(JSON.parse(out.stdout));
 const request=path.join(initial.root,'candidate-request.json');await fs.writeFile(request,JSON.stringify({kind:'cmcp_host_operation',version:1,stage:'candidates',config:initial.configFile,
  question:'Which synthetic source is newly authorized?',workId:randomUUID(),deadlineAt:new Date(Date.now()+30000).toISOString(),
  lifecycleFile:path.join(initial.root,'candidate-lifecycle.jsonl'),traceRoot:path.join(initial.root,'candidate-trace')}));
 const operation=spawnSync(process.execPath,[path.join(initial.hostWorkspace,'.agents/skills/cmcp-context/scripts/recall.mjs'),'--request',request],{encoding:'utf8',windowsHide:true,cwd:initial.hostWorkspace});
 assert.equal(operation.status,0,operation.stderr);assert.ok(JSON.parse(operation.stdout));
});
await run('foreign_or_modified_skill_and_outside_paths_fail_closed',async()=>{
 const host=path.join(root,'foreign');await fs.mkdir(path.join(host,'.agents/skills/cmcp-context'),{recursive:true});await fs.writeFile(path.join(host,'.agents/skills/cmcp-context/SKILL.md'),'foreign content');
 await assert.rejects(configureCmcpInstallation({projectRoot:repo,root:path.join(root,'foreign-data'),hostWorkspace:host,choices,inspect}),/not_owned/);
 assert.equal(await fs.readFile(path.join(host,'.agents/skills/cmcp-context/SKILL.md'),'utf8'),'foreign content');
 await assert.rejects(configureCmcpInstallation({projectRoot:repo,root:path.dirname(repo),hostWorkspace:host,choices,inspect}),/outside_repo/);
});
const binding={kind:'cmcp_codex_binding',version:1,projectRoot:repo,hostWorkspace:root,enabled:true,maxInputBytes:65536,authorization:{scopeId:'hook-scope'}};
const config={input:{scopeId:'hook-scope',timezone:'America/New_York'}};
const event={hook_event_name:'UserPromptSubmit',session_id:'native-session',turn_id:'turn-1',cwd:root,prompt:'Synthetic question',transcript_path:'MUST_NOT_READ'};
let calls=[],closed=0;
const factory=async options=>{calls.push({stage:'factory',options});return {beforeUser:async input=>{calls.push({stage:'user',input});return {timeCard:{now:'2026-09-18T00:00:00Z',elapsedSinceUserMs:82800000}};},
 afterAssistant:async input=>calls.push({stage:'assistant',input}),timeCard:async input=>{calls.push({stage:'compact',input});return {lastUserAt:'2026-09-17T01:00:00Z'};},close:async()=>{closed++;}};};
await run('official_prompt_hook_injects_only_bounded_time_and_stable_identity',async()=>{
 const a=await handleCmcpCodexHook({event,binding,config,runtimeFactory:factory,clock:()=> '2026-09-18T00:00:00Z'});
 await handleCmcpCodexHook({event,binding,config,runtimeFactory:factory,clock:()=> '2026-09-18T00:00:01Z'});
 assert.match(a.hookSpecificOutput.additionalContext,/82800000/);assert.ok(!a.hookSpecificOutput.additionalContext.includes('Synthetic question'));
 const users=calls.filter(row=>row.stage==='user');assert.deepEqual(users[0].input.pointer,users[1].input.pointer);
 assert.equal(users[0].input.pointer.sessionId,'native-session');assert.equal(users[0].input.timeContext.timezone,'America/New_York');
 assert.ok(!JSON.stringify(calls).includes('MUST_NOT_READ'));assert.equal(closed,2);
});
await run('assistant_and_compaction_use_separate_runtime_methods_no_new_user',async()=>{
 calls=[];await handleCmcpCodexHook({event:{...event,hook_event_name:'Stop',last_assistant_message:'Original answer'},binding,config,runtimeFactory:factory});
 const assistant=calls.find(row=>row.stage==='assistant').input;assert.equal(assistant.text,'Original answer');assert.notEqual(assistant.pointer.itemId,assistant.replyTo.itemId);
 await handleCmcpCodexHook({event:{...event,hook_event_name:'Stop',last_assistant_message:'A distinct final answer after a Host continuation'},binding,config,runtimeFactory:factory});
 const later=calls.filter(row=>row.stage==='assistant')[1].input;assert.notEqual(later.pointer.itemId,assistant.pointer.itemId);assert.deepEqual(later.replyTo,assistant.replyTo);
 calls=[];const compact=await handleCmcpCodexHook({event:{...event,hook_event_name:'SessionStart',source:'compact'},binding,config,runtimeFactory:factory});
 assert.equal(compact.hookSpecificOutput.hookEventName,'SessionStart');assert.ok(!calls.some(row=>row.stage==='user'));assert.equal(calls[0].options.readOnly,true);
});
await run('disabled_wrong_scope_missing_identity_and_over_budget_rejected',async()=>{
 calls=[];assert.deepEqual(await handleCmcpCodexHook({event,binding:{...binding,enabled:false},config,runtimeFactory:factory}),{continue:true});assert.equal(calls.length,0);
 await assert.rejects(handleCmcpCodexHook({event:{...event,cwd:path.dirname(root)},binding,config,runtimeFactory:factory}),/scope_mismatch/);
 await assert.rejects(handleCmcpCodexHook({event:{...event,turn_id:null},binding,config,runtimeFactory:factory}),/turn_id/);
 await assert.rejects(handleCmcpCodexHook({event:{...event,prompt:'x'.repeat(65537)},binding,config,runtimeFactory:factory}),/too_large/);
});
await run('time_index_off_can_reuse_saved_source_but_clean_exposes_no_card_or_identity',async()=>{
 const sourceFactory=effective=>async()=>({controlsSnapshot:async()=>({effective}),beforeUser:async()=>({timeCard:null,sourcePointer:{itemId:'opaque-current-source'}}),close:async()=>{}});
 const value=await handleCmcpCodexHook({event,binding,config,runtimeFactory:sourceFactory({enabled:true,clean:false,timeIndex:false})});
 const data=JSON.parse(value.hookSpecificOutput.additionalContext.split('\n').at(-1));assert.equal(data.sourceId,'opaque-current-source');assert.equal(data.timeCard,null);
 assert.deepEqual(await handleCmcpCodexHook({event,binding,config,runtimeFactory:sourceFactory({enabled:true,clean:true,timeIndex:false})}),{continue:true});
});
await run('real_node_cli_help_and_actual_installer_probe_zero_model',async()=>{
 const out=spawnSync(process.execPath,[path.join(repo,'scripts/cmcp-setup.mjs'),'--help'],{encoding:'utf8',windowsHide:true,cwd:root});assert.equal(out.status,0,out.stderr);assert.match(out.stdout,/no model calls/);
 const env=inspectCmcpSetupEnvironment();assert.equal(env.nodeSupported,true);assert.equal(env.modelCalls,0);assert.equal(env.authorizationChecked,false);
 await fs.writeFile(path.join(root,'real-environment.json'),JSON.stringify(env,null,2));
});
await run('interactive_update_keeps_custom_scope_events_and_Skill_identity_without_retyping_IDs',async()=>{
 // The interactive test must run without a Codex executable. Other setup tests
 // above verify Skill/hook installation using a declared environment probe;
 // the actual local Codex capability is recorded separately, never simulated.
 const initial=await configureCmcpInstallation({projectRoot:repo,root:path.join(root,'interactive-data'),hostWorkspace:path.join(root,'interactive-host'),
  choices:{...choices,attachCodex:false,scopeId:'custom-not-default',skillName:'cmcp-interactive-custom',language:'ja',bufferHours:24,
   events:[{key:'synthetic',eventId:'synthetic-event',objects:[{objectId:'delivery',aspects:['progress']}]}]},inspect});
 const before=JSON.parse(await fs.readFile(initial.configFile,'utf8')),questions=[];
 await runCmcpSetupCli(['--root',initial.root,'--update'],{emit:()=>{},ask:async q=>{questions.push(q);
  return q.endsWith('(yes/no): ')?(/paid|configured-provider|automatic local proactive|do-not-disturb|Customize reading|Clean|Attach the project-local Codex/i.test(q)?'no':'yes'):'';}});
 const after=JSON.parse(await fs.readFile(initial.configFile,'utf8')),manifest=JSON.parse(await fs.readFile(path.join(initial.root,'installation.json'),'utf8'));
 assert.deepEqual(after.input,before.input);assert.equal(manifest.choices.scopeId,'custom-not-default');
 assert.equal(manifest.choices.skillName,'cmcp-interactive-custom');assert.equal(manifest.choices.language,'ja');assert.equal(manifest.choices.bufferHours,24);
 assert.ok(!questions.some(q=>q.startsWith('Private continuation scope ID')));assert.ok(questions.some(q=>q.startsWith('Use Clean mode')));
});
await fs.writeFile(path.join(root,'results.json'),JSON.stringify({kind:'OFFLINE_NO_MODEL_REQUESTS',results},null,2),{flag:'wx'});
console.log(JSON.stringify({passed:results.filter(r=>r.status==='PASS').length,total:results.length,root,results}));if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
