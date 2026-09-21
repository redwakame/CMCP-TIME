import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {configureCmcpInstallation} from '../src/cmcp-guard/cmcp-setup.js';
import {createCmcpRuntimeSession} from '../src/cmcp-guard/cmcp-runtime-session.js';
import {createCmcpReactivationStores,createCmcpTemporalSourceCatalog} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {resolveCmcpHistorySource} from '../src/cmcp-guard/cmcp-history-provider.js';

// The caller owns this synthetic test location. Never use system Temp or npm's cache.
const packageRoot=await fs.realpath(fileURLToPath(new URL('../',import.meta.url)));
const root=process.env.CMCP_NPM_SETUP_TEST_ROOT;
assert.ok(root&&path.isAbsolute(root),'Set CMCP_NPM_SETUP_TEST_ROOT to a new explicit synthetic test directory.');
await fs.mkdir(path.dirname(root),{recursive:true});await fs.mkdir(root);
const workspace=path.join(root,'authorized workspace'),unrelatedCwd=path.join(root,'other cwd');
await fs.mkdir(workspace);await fs.mkdir(unrelatedCwd);
const results=[];
const run=async(name,action)=>{try{await action();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',error:error.message});}};
const choices={timezone:'Europe/Berlin',language:'en',scopeId:'synthetic-npm-installation',owner:{id:'self',label:'Synthetic owner'},people:[],
 saveUser:true,saveAssistant:true,enabled:true,clean:false,proactive:false,attachCodex:true,providerMode:'host',allowPaidCalls:false,
 authorizedBy:'Explicit synthetic npm setup test',events:[]};
const inspect=()=>({node:process.versions.node,nodeSupported:true,codex:{available:true,version:'declared-offline-probe'},modelCalls:0,adminRequired:false});
const invoke=(script,args=[],input)=>spawnSync(process.execPath,[script,...args],{cwd:unrelatedCwd,input,encoding:'utf8',windowsHide:true,timeout:30000});
const check=result=>{assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
let installed,helper,config,beforeCard,preservedSources;
async function readSources(){
 const stores=createCmcpReactivationStores({root:config.input.root,scopeId:config.input.scopeId});
 const catalog=createCmcpTemporalSourceCatalog({stores,maxEntries:config.input.storageCapacity.maxSources,maxSegments:config.sourceCatalog.maxSegments});
 return Promise.all((await catalog.list()).map(({pointer})=>resolveCmcpHistorySource({provider:stores.history,pointer})));
}
async function assertSourcesPreserved(){
 const now=await readSources();for(const source of preservedSources){
  const found=now.find(row=>JSON.stringify(row.pointer)===JSON.stringify(source.pointer));assert.deepEqual(found,source);
 }
}
await run('separate_workspace_owns_data_and_hooks_assets_remain_in_package',async()=>{
 installed=await configureCmcpInstallation({projectRoot:workspace,packageRoot,root:'data',hostWorkspace:'host',choices,inspect});
 assert.equal(installed.projectRoot,await fs.realpath(workspace));assert.equal(installed.packageRoot,packageRoot);
 config=JSON.parse(await fs.readFile(installed.configFile));assert.ok(config.input.root.startsWith(workspace+path.sep));assert.equal(config.providerMode,'host');
 assert.equal(config.credentialRef,undefined);assert.equal(installed.grantCreated,false);
 const binding=JSON.parse(await fs.readFile(installed.bindingFile));assert.equal(binding.projectRoot,workspace);assert.equal(binding.packageRoot,packageRoot);
 const hooks=JSON.parse(await fs.readFile(path.join(installed.hostWorkspace,'.codex/hooks.json')));
 assert.match(hooks.hooks.UserPromptSubmit[0].hooks[0].command,/--workspace/);
 assert.ok(hooks.hooks.UserPromptSubmit[0].hooks[0].command.includes(packageRoot));
 helper=path.join(installed.hostWorkspace,'.agents/skills/cmcp-context/scripts/recall.mjs');
 const loader=await fs.readFile(helper,'utf8');assert.match(loader,/runCmcpHostContextCli/);assert.match(loader,/managed_workspace_override_forbidden/);
});
await run('installed_helper_runs_from_unrelated_cwd_and_refuses_workspace_override',async()=>{
 assert.equal(check(invoke(helper,['--config',installed.configFile,'--status'])).modelCalls,0);
 const wrong=invoke(helper,['--workspace',packageRoot,'--config',installed.configFile,'--status']);
 assert.notEqual(wrong.status,0);assert.match(wrong.stderr,/managed_workspace_override_forbidden/);
 const outside=invoke(helper,['--config',path.join(packageRoot,'package.json'),'--status']);assert.notEqual(outside.status,0);
});
await run('actual_hook_child_saves_user_assistant_in_workspace_and_preserves_time',async()=>{
 const script=path.join(packageRoot,'scripts/cmcp-codex-hook.mjs');
 const base={session_id:'synthetic-npm-session',turn_id:'synthetic-npm-turn',cwd:installed.hostWorkspace};
 const args=['--workspace',workspace,'--binding',installed.bindingFile];
 const user=check(invoke(script,args,JSON.stringify({...base,hook_event_name:'UserPromptSubmit',prompt:'Synthetic npm setup preserves original text.'})));
 assert.equal(user.continue,true);assert.ok(user.hookSpecificOutput.additionalContext);
 assert.equal(check(invoke(script,args,JSON.stringify({...base,hook_event_name:'Stop',last_assistant_message:'Synthetic original Assistant response.'}))).continue,true);
 const runtime=await createCmcpRuntimeSession({config,repoRoot:workspace,readOnly:true});
 try{beforeCard=await runtime.timeCard();assert.equal(beforeCard.previousUser.role,'user');assert.equal(beforeCard.previousExchange.role,'assistant');}finally{await runtime.close();}
 preservedSources=await readSources();assert.equal(preservedSources.length,2);
 assert.ok(preservedSources.some(row=>row.status==='found'&&row.evidence.sourceAuthorRole==='user'&&row.evidence.content.body==='Synthetic npm setup preserves original text.'));
 assert.ok(preservedSources.some(row=>row.status==='found'&&row.evidence.sourceAuthorRole==='assistant'&&row.evidence.content.body==='Synthetic original Assistant response.'));
});
await run('package_binding_mismatch_rejected_before_hook_input',async()=>{
 const wrong=JSON.parse(await fs.readFile(installed.bindingFile));wrong.packageRoot=unrelatedCwd;
 const file=path.join(installed.root,'wrong-binding.json');await fs.writeFile(file,JSON.stringify(wrong));
 const result=invoke(path.join(packageRoot,'scripts/cmcp-codex-hook.mjs'),['--workspace',workspace,'--binding',file],'{}');
 assert.notEqual(result.status,0);assert.match(result.stderr,/hook_binding_package_mismatch/);
});
await run('managed_request_helper_uses_workspace_for_request_and_receipts',async()=>{
 const file=path.join(installed.root,'operation.json'),workId=randomUUID();
 await fs.writeFile(file,JSON.stringify({kind:'cmcp_host_operation',version:1,stage:'candidates',config:installed.configFile,workId,
  question:'Which synthetic npm text was saved?',deadlineAt:new Date(Date.now()+30000).toISOString(),
  lifecycleFile:path.join(installed.root,'operation.jsonl'),traceRoot:path.join(installed.root,'operation-trace')}));
 check(invoke(helper,['--request',file]));
 const completed=JSON.parse(await fs.readFile(path.join(installed.root,'operation-trace/result.json')));
 assert.equal(completed.workId,workId);assert.equal(completed.exitCode,0);assert.ok(completed.receipt);
});
await run('update_preserves_runtime_identity_saved_sources_and_user_time',async()=>{
 // Take the observation after the preceding authorized candidate question.
 let runtime=await createCmcpRuntimeSession({config,repoRoot:workspace,readOnly:true});
 try{beforeCard=await runtime.timeCard();}finally{await runtime.close();}
 const updated=await configureCmcpInstallation({projectRoot:workspace,packageRoot,root:installed.root,action:'update',choices,inspect});
 assert.equal(updated.runtimeId,installed.runtimeId);assert.deepEqual(JSON.parse(await fs.readFile(updated.configFile)),config);
 await assertSourcesPreserved();
 runtime=await createCmcpRuntimeSession({config,repoRoot:workspace,readOnly:true});
 try{const after=await runtime.timeCard();assert.equal(after.previousUser.recordedAt,beforeCard.previousUser.recordedAt);assert.equal(after.previousExchange.recordedAt,beforeCard.previousExchange.recordedAt);
  assert.equal((await runtime.status()).budget.remaining.deepseek,0);}finally{await runtime.close();}
 const hooks=JSON.parse(await fs.readFile(path.join(installed.hostWorkspace,'.codex/hooks.json')));assert.equal(hooks.hooks.UserPromptSubmit.length,1);
});
await run('owned_skill_conflict_and_outside_workspace_still_rejected',async()=>{
 const foreign=path.join(workspace,'foreign-host/.agents/skills/cmcp-context');await fs.mkdir(foreign,{recursive:true});
 await fs.writeFile(path.join(foreign,'SKILL.md'),'Unowned skill');
 await assert.rejects(configureCmcpInstallation({projectRoot:workspace,packageRoot,root:'foreign-data',hostWorkspace:'foreign-host',choices,inspect}),/not_owned/);
 assert.equal(await fs.readFile(path.join(foreign,'SKILL.md'),'utf8'),'Unowned skill');
 await assert.rejects(configureCmcpInstallation({projectRoot:workspace,packageRoot,root:unrelatedCwd,hostWorkspace:'host',choices,inspect}),/outside_repo/);
});
await run('temporary_npx_assets_cannot_create_persistent_hook_attachment',async()=>{
 const npxAssets=path.join(root,'_npx/synthetic-package');await fs.mkdir(npxAssets,{recursive:true});
 await assert.rejects(configureCmcpInstallation({projectRoot:workspace,packageRoot:npxAssets,root:'npx-data',hostWorkspace:'npx-host',choices,inspect}),/persistent_install_required/);
 await assert.rejects(fs.stat(path.join(workspace,'npx-data')),error=>error.code==='ENOENT');
});
await run('disable_uninstall_preserve_sources_and_unrelated_hooks',async()=>{
 const hookFile=path.join(installed.hostWorkspace,'.codex/hooks.json'),hooks=JSON.parse(await fs.readFile(hookFile));
 hooks.hooks.Stop.push({hooks:[{type:'command',command:'synthetic-unrelated-command'}]});await fs.writeFile(hookFile,JSON.stringify(hooks));
 await configureCmcpInstallation({projectRoot:workspace,packageRoot,root:installed.root,action:'disable',inspect});
 assert.equal(JSON.parse(await fs.readFile(installed.bindingFile)).enabled,false);
 assert.equal(check(invoke(helper,['--config',installed.configFile,'--status'])).modelCalls,0);
 await configureCmcpInstallation({projectRoot:workspace,packageRoot,root:installed.root,action:'uninstall',inspect});
 await assertSourcesPreserved();
 await assert.rejects(fs.stat(helper),error=>error.code==='ENOENT');
 const remaining=JSON.parse(await fs.readFile(hookFile));assert.equal(remaining.hooks.Stop[0].hooks[0].command,'synthetic-unrelated-command');
 const runtime=await createCmcpRuntimeSession({config,repoRoot:workspace,readOnly:true});
 try{const after=await runtime.timeCard();assert.equal(after.previousUser.recordedAt,beforeCard.previousUser.recordedAt);assert.equal(after.previousExchange.recordedAt,beforeCard.previousExchange.recordedAt);}finally{await runtime.close();}
});
const output={kind:'OFFLINE_NPM_SETUP_BOUNDARY',packageVersion:JSON.parse(await fs.readFile(path.join(packageRoot,'package.json'))).version,
 actualNode:process.versions.node,hostEnvironmentProbe:'declared fixture; no Host model process',productApiCalls:0,results,
 passed:results.filter(row=>row.status==='PASS').length,total:results.length};
await fs.writeFile(path.join(root,'results.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(output));if(output.passed!==output.total)process.exitCode=1;
