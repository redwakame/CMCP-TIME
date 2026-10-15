import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {PassThrough,Writable} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import test from 'node:test';
const packageRoot=path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT??fileURLToPath(new URL('../',import.meta.url)));
const load=rel=>import(pathToFileURL(path.join(packageRoot,rel)).href);
const {runCmcpSetupCli}=await load('scripts/cmcp-setup.mjs');
const {configureCmcpInstallation,inspectCmcpInstallation,inspectCmcpSetupEnvironment}=await load('src/cmcp-guard/cmcp-setup.js');
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const outputRoot=path.resolve(process.env.CMCP_SETUP_MAINTENANCE_ROOT??path.join(packageRoot,'logs/public-tests/setup-maintenance-'+randomUUID()));
await fs.mkdir(outputRoot,{recursive:true});
const choices={timezone:'Asia/Taipei',language:'zh-TW',scopeId:'setup-maintenance-synthetic',owner:{id:'self',label:'合成使用者'},people:[],
 saveUser:true,saveAssistant:true,enabled:true,clean:false,proactive:false,attachCodex:false,providerMode:'host',allowPaidCalls:false,
 authorizedBy:'本單合成初始化驗收',events:[]};
const cli=path.join(packageRoot,'bin/cmcp-time.mjs');
const json=async(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const workspace=async label=>{const dir=path.join(outputRoot,label+'-'+randomUUID());await fs.mkdir(dir);return dir;};
const invoke=(dir,args,input='')=>spawnSync(process.execPath,[cli,...args],{cwd:dir,input,encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,PATH:''}});
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const absent=async file=>assert.rejects(fs.stat(file),{code:'ENOENT'});
const noCodexProbe=options=>inspectCmcpSetupEnvironment({...options,probe(){throw Error('unexpected_codex_probe');}});
async function treeHashes(root){
 const rows=[];
 async function visit(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);
  assert.equal(entry.isSymbolicLink(),false);if(entry.isDirectory())await visit(file);else if(entry.isFile())rows.push([path.relative(root,file),await hash(file)]);}}
 await visit(root);return rows.sort(([a],[b])=>a.localeCompare(b));
}
function terminalStreams(answer){
 const input=new PassThrough();input.isTTY=true;let transcript='';
 const output=new Writable({write(chunk,encoding,done){const text=chunk.toString();transcript+=text;done();if(text.endsWith(': '))setImmediate(()=>answer(text,input));}});
 output.isTTY=false;
 return {input,output,transcript:()=>transcript};
}
function defaultAnswer(prompt){
 if(prompt.endsWith('(yes/no): '))return /configured-provider|shared proactive|do-not-disturb|Customize reading|Clean|Attach the project-local Codex/u.test(prompt)?'no':'yes';
 return '';
}

test('未選 Codex 的環境查核不啟動或要求 Codex',()=>{
 let probes=0;
 const result=inspectCmcpSetupEnvironment({inspectCodex:false,probe(){probes++;throw Error('must_not_probe');}});
 assert.equal(probes,0);assert.equal(result.codex.checked,false);assert.equal(result.codex.available,null);
 assert.equal(result.modelCalls,0);assert.equal(result.authorizationChecked,false);
});

test('真正 CLI 拒絕批次 stdin 與空 stdin，寫入前明示 --answers，沒有 exit 13',async()=>{
 for(const [label,input]of [['batch',Array(23).fill('yes').join('\n')+'\n'],['empty','']]){
  const dir=await workspace(label),result=invoke(dir,['setup','--workspace',dir,'--root','data'],input);
  assert.equal(result.error,undefined);assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/setup_terminal_required/);
  assert.match(result.stderr,/--answers/);assert.doesNotMatch(result.stderr,/unsettled top-level await/);await absent(path.join(dir,'data'));
  await json(path.join(dir,'cli-receipt.json'),{status:result.status,stdout:result.stdout,stderr:result.stderr,inputLines:input.split('\n').filter(Boolean).length});
 }
});

test('非互動 update 保留原設定、控制與安裝原件',async()=>{
 const dir=await workspace('update-non-tty');
 const installed=await configureCmcpInstallation({projectRoot:dir,root:'data',hostWorkspace:'host',choices,inspect:noCodexProbe});
 const files=[installed.configFile,path.join(installed.root,'installation.json'),installed.bindingFile],before=await Promise.all(files.map(hash));
 const result=invoke(dir,['update','--workspace',dir,'--root','data'],'');
 assert.equal(result.status,1);assert.match(result.stderr,/setup_terminal_required/);assert.deepEqual(await Promise.all(files.map(hash)),before);
});

test('明選 Codex 但不可用時寫入前拒絕；不以停用選擇冒充已接線',async()=>{
 const dir=await workspace('codex-required');let probes=0;
 await assert.rejects(configureCmcpInstallation({projectRoot:dir,root:'data',hostWorkspace:'host',choices:{...choices,attachCodex:true},
  inspect:options=>{assert.equal(options.inspectCodex,true);probes++;return {codex:{checked:true,available:false}};}}),/codex_not_available/);
 assert.equal(probes,1);await absent(path.join(dir,'data'));await absent(path.join(dir,'host'));
});

test('互動 stream 逐題完成明確選擇，未選 Codex 仍是 configured/enabled Runtime',async()=>{
 const dir=await workspace('interactive'),emitted=[];
 const streams=terminalStreams((prompt,input)=>input.write(defaultAnswer(prompt)+'\n'));
 await runCmcpSetupCli(['--workspace',dir,'--root','data','--host-workspace','host'],{...streams,emit:value=>emitted.push(value)});
 const installed=await read(path.join(dir,'data/installation.json'));
 assert.equal(installed.state,'disabled');assert.equal(installed.stateScope,'managed_codex_hook_binding');
 assert.equal(installed.layers.configuration.status,'configured');assert.equal(installed.layers.runtime.status,'observed');
 assert.equal(installed.layers.runtime.enabled,true);assert.equal(installed.layers.hostConnection.codex.selected,false);
 assert.equal(installed.environment.codex.checked,false);assert.equal(installed.grantCreated,false);assert.equal(installed.modelCalls,0);
 assert.equal(installed.layers.proactiveExecution.controls.proactive,false);assert.equal(installed.layers.proactiveExecution.inactivityIsSendDeadline,false);
 assert.ok(!emitted.some(value=>typeof value==='string'&&value.startsWith('Codex: codex')));
 await absent(path.join(dir,'host/.codex/hooks.json'));await absent(path.join(dir,'host/.agents'));
 await json(path.join(dir,'interactive-receipt.json'),{level:'stream_terminal_contract_not_physical_terminal',transcript:streams.transcript(),emitted});
});

test('TTY stream 在首題與中途 EOF 均明確失敗，未採用預設同意且無設定寫入',async()=>{
 for(const after of [0,2]){
  const dir=await workspace('eof-'+after);let answers=0;
  const streams=terminalStreams((prompt,input)=>{if(answers++>=after)input.end();else input.write(defaultAnswer(prompt)+'\n');});
  await assert.rejects(runCmcpSetupCli(['--workspace',dir,'--root','data'],{...streams,emit:()=>{}}),/setup_input_closed/);
  await absent(path.join(dir,'data'));await json(path.join(dir,'eof-receipt.json'),{afterAnswers:after,transcript:streams.transcript(),configWritten:false});
 }
});

test('--answers 在空 PATH 的真正 CLI 完成初始化、狀態與非 Codex 正式閱讀',async()=>{
 const dir=await workspace('no-codex-cli');await json(path.join(dir,'answers.json'),choices);
 const setup=invoke(dir,['setup','--workspace',dir,'--root','data','--host-workspace','host','--answers','answers.json']);
 assert.equal(setup.error,undefined);assert.equal(setup.status,0,setup.stderr);assert.doesNotMatch(setup.stdout,/Codex: codex/);
 const installed=await read(path.join(dir,'data/installation.json')),binding=await read(installed.bindingFile);
 assert.equal(binding.kind,'cmcp_codex_binding');assert.equal(binding.enabled,false);assert.equal(installed.environment.codex.checked,false);
 assert.equal(installed.layers.sources.counts.knownSources,0);assert.equal(installed.layers.sources.crossHost.status,'not_assessed');
 const config=await read(installed.configFile),runtime=await createCmcpRuntimeSession({config,repoRoot:dir,
  sessionId:'synthetic-native-producer',readCredential:async()=>{throw Error('no_credentials');},fetchImpl:async()=>{throw Error('no_model');}});
 let saved;
 try{saved=await runtime.beforeUser({text:'合成資料：木盒上層改用夾板，其他未修改的條件維持。',sourceId:'synthetic-native-message'});assert.ok(saved.sourcePointer);}
 finally{await runtime.close();}
 const state=invoke(dir,['setup','--workspace',dir,'--root','data','--status']);assert.equal(state.status,0,state.stderr);
 const status=JSON.parse(state.stdout);assert.equal(status.layers.runtime.enabled,true);assert.equal(status.inspection.environment.codex.checked,false);
 assert.equal(status.layers.sources.counts.originalStored,1);assert.equal(status.layers.sources.counts.registered,1);
 const candidate=invoke(dir,['context','--workspace',dir,'--config',installed.configFile,'--local-candidates','--text','木盒上層改用什麼材料？']);
 assert.equal(candidate.status,0,candidate.stderr);const found=JSON.parse(candidate.stdout);
 await json(path.join(dir,'candidate-output.json'),found);
 const ticket=found.context?.ticket??found.ticket,rows=found.context?.candidates??found.candidates;
 assert.ok(ticket,'正式候選回傳票券');assert.ok(rows?.length,'正式候選非空');
 const original=invoke(dir,['context','--workspace',dir,'--config',installed.configFile,'--local-read',ticket,'--refs',rows[0].ref]);
 assert.equal(original.status,0,original.stderr);const body=JSON.parse(original.stdout);
 assert.match(JSON.stringify(body),/木盒上層改用夾板/);
 await json(path.join(dir,'formal-read-output.json'),body);
 await json(path.join(dir,'cli-receipt.json'),{setup:{status:setup.status,stdout:setup.stdout,stderr:setup.stderr},status,
  source:saved.sourcePointer,localCandidates:found,formalRead:body,productModelCalls:0,codexPath:'empty',level:'real_public_cli_with_synthetic_runtime_ingest'});
});

test('update 與 disable 保留 Runtime、歷史及獨立控制，舊 binding 相容',async()=>{
 const dir=await workspace('compatibility');
 const installed=await configureCmcpInstallation({projectRoot:dir,root:'data',hostWorkspace:'host',choices,inspect:noCodexProbe});
 const config=await read(installed.configFile),runtime=await createCmcpRuntimeSession({config,repoRoot:dir,sessionId:'synthetic-preservation'});
 try{await runtime.beforeUser({text:'保留這份合成正式原文。',sourceId:'keep-1'});}finally{await runtime.close();}
 const updated=await configureCmcpInstallation({projectRoot:dir,root:'data',action:'update',choices:{...choices,clean:true},inspect:noCodexProbe});
 assert.equal(updated.runtimeId,installed.runtimeId);assert.equal(updated.layers.runtime.clean,true);
 assert.equal(updated.layers.sources.counts.knownSources,1);assert.equal(updated.layers.sources.status,'blocked');
 const disabled=await configureCmcpInstallation({projectRoot:dir,root:'data',action:'disable',inspect:noCodexProbe});
 assert.equal(disabled.disabledScope,'managed_codex_hook_binding');assert.equal(disabled.runtimeControlsUnchanged,true);
 assert.equal(disabled.layers.runtime.enabled,true);assert.equal(disabled.layers.runtime.clean,true);assert.equal(disabled.layers.sources.counts.knownSources,1);
 const status=await inspectCmcpInstallation({projectRoot:dir,root:'data'});assert.equal(status.layers.runtime.clean,true);assert.equal(status.inspection.modelCalls,0);
 const before=await treeHashes(installed.root);await inspectCmcpInstallation({projectRoot:dir,root:'data'});assert.deepEqual(await treeHashes(installed.root),before,'查看不改控制、History、原時間或期限');
 await json(path.join(dir,'compatibility-receipt.json'),{updated,disabled,status});
});

test('舊版 Codex manifest 更新為未選用：只撤回自己的 hooks，設定與原件保留',async()=>{
 const dir=await workspace('legacy-attachment'),host=path.join(dir,'host');await fs.mkdir(path.join(host,'.codex'),{recursive:true});
 await json(path.join(host,'.codex/hooks.json'),{hooks:{Stop:[{hooks:[{type:'command',command:'unrelated-synthetic-hook'}]}]}});
 const installed=await configureCmcpInstallation({projectRoot:dir,root:'data',hostWorkspace:'host',choices:{...choices,attachCodex:true},
  inspect:()=>({node:process.versions.node,nodeSupported:true,codex:{checked:true,available:true,version:'declared-fixture'},modelCalls:0})});
 const manifestPath=path.join(installed.root,'installation.json'),legacy=await read(manifestPath);delete legacy.layers;delete legacy.stateScope;
 await fs.writeFile(manifestPath,JSON.stringify(legacy,null,2)+'\n');
 const updated=await configureCmcpInstallation({projectRoot:dir,root:'data',action:'update',choices,inspect:noCodexProbe});
 assert.equal(updated.state,'disabled');assert.equal(updated.environment.codex.checked,false);assert.equal(updated.layers.runtime.enabled,true);
 assert.equal(updated.runtimeId,installed.runtimeId);assert.equal((await read(updated.bindingFile)).enabled,false);
 assert.deepEqual(await read(path.join(host,'.codex/hooks.json')),{hooks:{Stop:[{hooks:[{type:'command',command:'unrelated-synthetic-hook'}]}]}});
 assert.equal(await fs.readFile(path.join(host,'.agents/skills/cmcp-context/SKILL.md'),'utf8').then(Boolean),true);
 await json(path.join(dir,'legacy-update-receipt.json'),{level:'declared_codex_availability_fixture_no_native_codex_call',installed,updated});
});
