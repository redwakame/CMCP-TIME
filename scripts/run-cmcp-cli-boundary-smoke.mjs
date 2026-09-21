import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {configureCmcpInstallation} from '../src/cmcp-guard/cmcp-setup.js';

const testRoot=process.env.CMCP_CLI_BOUNDARY_TEST_ROOT;
assert.ok(testRoot&&path.isAbsolute(testRoot),'Set CMCP_CLI_BOUNDARY_TEST_ROOT to a new explicit synthetic test directory.');
await fs.mkdir(path.dirname(testRoot),{recursive:true});await fs.mkdir(testRoot);
const workspace=path.join(testRoot,'workspace'),other=path.join(testRoot,'unrelated-cwd');
await fs.mkdir(workspace);await fs.mkdir(other);
const packageRoot=fileURLToPath(new URL('../',import.meta.url));
const bin=path.join(packageRoot,'bin/cmcp-time.mjs'),playground=path.join(packageRoot,'scripts/cmcp-playground.mjs');
const context=path.join(packageRoot,'scripts/cmcp-host-context-cli.mjs');
const choices={timezone:'Europe/Berlin',language:'en',scopeId:'synthetic-cli-boundary',owner:{id:'self',label:'Synthetic owner'},people:[],
  saveUser:true,saveAssistant:true,enabled:true,clean:false,proactive:false,attachCodex:false,providerMode:'host',allowPaidCalls:false,
  authorizedBy:'Explicit synthetic CLI boundary test',events:[]};
await configureCmcpInstallation({projectRoot:workspace,packageRoot,root:'local-data/cmcp',hostWorkspace:'host',choices,
  inspect:()=>({node:process.versions.node,nodeSupported:true,codex:{available:false,version:null},modelCalls:0})});
const results=[];
const invoke=(script,args)=>spawnSync(process.execPath,[script,...args],{cwd:other,encoding:'utf8',windowsHide:true,timeout:30000});
const success=result=>{assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr||result.stdout);return result.stdout;};
const rejected=(result,pattern)=>{assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,pattern);};
async function snapshot(directory=workspace){
  const files=[];
  async function visit(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name);if(entry.isDirectory())await visit(file);else files.push({
      path:path.relative(directory,file).replaceAll('\\','/'),sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});
  }}
  await visit(directory);return files.sort((a,b)=>a.path.localeCompare(b.path));
}
async function test(name,action){try{await action();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',error:error.message});}}
async function unchanged(action){const before=await snapshot();await action();assert.deepEqual(await snapshot(),before);}
async function allUnchanged(action){
  const state=async()=>({files:await snapshot(testRoot),entries:(await fs.readdir(testRoot,{recursive:true})).sort()});
  const before=await state();await action();assert.deepEqual(await state(),before);
}
const contextEntries=[{script:bin,prefix:['context']},{script:context,prefix:[]}];
const workspaceArgs=['--workspace',workspace,'--root','local-data/cmcp'];
const grantArgs=['--authorize','synthetic-rejected-grant','--posts','1','--authorized-by','Explicit synthetic boundary test'];
await test('bin_help_version_do_not_access_workspace',async()=>{
  await unchanged(async()=>{assert.match(success(invoke(bin,['--help'])),/CMCP-TIME/);assert.match(success(invoke(bin,['--version'])),/CMCP-TIME/);});
});
await test('context_help_requires_no_workspace_config_grant_or_credential',async()=>{
  await allUnchanged(async()=>{for(const {script,prefix} of contextEntries){
    const output=success(invoke(script,[...prefix,'--help']));
    assert.match(output,/Usage: cmcp-time context/);assert.match(output,/--local-candidates/);
    assert.match(output,/--read-progress/);assert.match(output,/no data writes or model calls/);
  }});
});
await test('context_help_returns_before_resolving_paths_or_running_actions',async()=>{
  await allUnchanged(async()=>{for(const {script,prefix} of contextEntries){
    for(const root of [other,path.join(testRoot,'nonexistent-workspace')]){
      success(invoke(script,[...prefix,'--workspace',root,'--config','missing-config.json','--manifest','missing-manifest.json',
        '--text','Synthetic help must not save this body','--status','--help']));
    }
  }});
});
await test('context_help_keeps_unknown_options_and_positionals_strict',async()=>{
  await allUnchanged(async()=>{for(const {script,prefix} of contextEntries){
    rejected(invoke(script,[...prefix,'--help','--unknown-flag']),/Unknown option/);
    rejected(invoke(script,[...prefix,'--unknown-flag','--help']),/Unknown option/);
    rejected(invoke(script,[...prefix,'--help','unexpected-positional']),/Unexpected argument/);
    rejected(invoke(script,[...prefix,'--help',...grantArgs]),/Unknown option/);
  }});
});
await test('unknown_command_and_argument_rejected_without_mutation',async()=>{
  await unchanged(async()=>{rejected(invoke(bin,['unknown-command']),/unknown_command/);rejected(invoke(bin,['status',...workspaceArgs,'--unknown-flag']),/Unknown option/);});
});
await test('bin_status_cannot_authorize_or_initialize',async()=>{
  await unchanged(async()=>{rejected(invoke(bin,['status',...workspaceArgs,...grantArgs]),/Unknown option/);rejected(invoke(bin,['status',...workspaceArgs,'--init']),/Unknown option/);});
});
await test('direct_playground_status_cannot_authorize',async()=>{
  await unchanged(async()=>rejected(invoke(playground,[...workspaceArgs,'--status',...grantArgs]),/conflicting_playground_actions/));
});
await test('direct_playground_conflicting_actions_are_rejected',async()=>{
  await unchanged(async()=>{rejected(invoke(playground,[...workspaceArgs,'--status','--init']),/conflicting_playground_actions/);
    rejected(invoke(playground,[...workspaceArgs,'--init',...grantArgs]),/conflicting_playground_actions/);});
});
await test('session_is_not_silently_ignored_by_noninteractive_actions',async()=>{
  await unchanged(async()=>{rejected(invoke(playground,[...workspaceArgs,'--status','--session','wrong-action']),/session_requires_interactive_playground/);
    rejected(invoke(playground,[...workspaceArgs,'--init','--session','wrong-action']),/session_requires_interactive_playground/);
    rejected(invoke(playground,[...workspaceArgs,...grantArgs,'--session','wrong-action']),/session_requires_interactive_playground/);});
});
await test('empty_grant_identifier_is_rejected_without_entering_chat',async()=>{
  await unchanged(async()=>rejected(invoke(playground,[...workspaceArgs,'--authorize','']),/explicit_positive_grant_and_authorizer_required/));
});
await test('explicit_authorize_still_works_as_a_separate_action',async()=>{
  const output=JSON.parse(success(invoke(playground,[...workspaceArgs,'--authorize','synthetic-explicit-grant','--posts','2','--authorized-by','Explicit synthetic boundary test'])));
  assert.equal(output.status,'authorized');assert.equal(output.budget.authorization.authorizationId,'synthetic-explicit-grant');
});
await test('status_reopen_preserves_grant_and_all_stored_bytes',async()=>{
  await unchanged(async()=>{for(const script of [bin,playground]){
    const args=script===bin?['status',...workspaceArgs,'--json']:[...workspaceArgs,'--status','--json'];
    const output=JSON.parse(success(invoke(script,args)));assert.equal(output.modelCalls,0);assert.equal(output.readOnly,true);
    assert.equal(output.budget.remaining.deepseek,2);assert.equal(output.budget.authorizationId,'synthetic-explicit-grant');
  }});
});
await test('context_status_and_check_preserve_grant_and_all_stored_bytes',async()=>{
  await allUnchanged(async()=>{for(const {script,prefix} of contextEntries){for(const mode of ['--status','--check']){
    const output=JSON.parse(success(invoke(script,[...prefix,'--workspace',workspace,'--config','local-data/cmcp/config.json',mode])));
    assert.equal(output.modelCalls,0);assert.equal(output.readOnly,true);
    assert.equal(output.budget.remaining.deepseek,2);assert.equal(output.budget.authorizationId,'synthetic-explicit-grant');
  }}});
});
await test('wrong_workspace_does_not_initialize_another_root',async()=>{
  const before=await snapshot(other);rejected(invoke(bin,['status','--workspace',other]),/configuration_missing_run_setup_first/);assert.deepEqual(await snapshot(other),before);
});
const output={kind:'OFFLINE_CLI_ACTION_BOUNDARY',actualNode:process.versions.node,productApiCalls:0,hostModelCalls:0,
  results,passed:results.filter(row=>row.status==='PASS').length,total:results.length};
await fs.writeFile(path.join(testRoot,'results.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(output));if(output.passed!==output.total)process.exitCode=1;
