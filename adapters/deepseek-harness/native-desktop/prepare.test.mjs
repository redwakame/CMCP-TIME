import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const testProduct=fileURLToPath(new URL('../../../',import.meta.url));
const product=process.env.CMCP_PRODUCT_ROOT?path.resolve(process.env.CMCP_PRODUCT_ROOT):testProduct;
const {createDesktopPreparer}=await import(pathToFileURL(path.join(product,'adapters/deepseek-harness/native-desktop/prepare.mjs')).href);
const {runRegistrationCli}=await import(pathToFileURL(path.join(product,'adapters/deepseek-harness/native-desktop/registration.mjs')).href);
const testRoot=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(testProduct,'logs/tests/desktop-prepare'));
await fs.mkdir(testRoot,{recursive:true});
const hash=value=>createHash('sha256').update(value).digest('hex');
const NATIVE='adapters/deepseek-harness/native-desktop';
async function fixture(){
  const root=await fs.mkdtemp(path.join(testRoot,'prepare-')),packageRoot=path.join(root,'source'),workspace=path.join(root,'workspace');
  const llmModule=path.join(root,'official/node_modules/@deepseek-ai/dsh-llm/lib/index.js');
  await fs.mkdir(path.dirname(llmModule),{recursive:true});await fs.writeFile(llmModule,'throw Error("must not be loaded");\n');await fs.mkdir(workspace);
  const files={'package.json':JSON.stringify({name:'@redwakame-skill/cmcp-time',version:'0.1.0',type:'module'}),[NATIVE+'/host.mjs']:'import "./dep.mjs";\n',[NATIVE+'/dep.mjs']:'export const synthetic = true;\n',[NATIVE+'/client.js']:'// synthetic client\n',[NATIVE+'/SKILL.md']:'# 合成 Skill\n'};
  const index={kind:'cmcp-time-public-source-allowlist',version:'0.1.0',files:[]};
  for(const [relative,content] of Object.entries(files)){const dest=path.join(packageRoot,relative);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,content);index.files.push({path:relative,bytes:Buffer.byteLength(content),sha256:hash(content)});}
  const indexPath=path.join(packageRoot,'PUBLIC-FILES.json');await fs.writeFile(indexPath,JSON.stringify(index));
  const profile=path.join(root,'cordis.patch.yml');await fs.writeFile(profile,'# synthetic unrelated profile\n');
  return {root,packageRoot,index,indexPath,workspace,llmModule,profile,deployment:path.join(workspace,'cmcp-desktop-native'),input:{workspace,scope:'synthetic-scope',timezone:'Asia/Taipei',llmModule,saveUser:true,saveAssistant:false}};
}
async function noDeployment(f){await assert.rejects(fs.lstat(f.deployment),{code:'ENOENT'});}
test('新部署完整核對索引及保存選擇；profile、模型與 Session 未啟用',async()=>{
  const f=await fixture(),profile=await fs.readFile(f.profile),result=await createDesktopPreparer({packageRoot:f.packageRoot}).prepare(f.input);
  assert.equal(result.state,'prepared-not-registered');assert.equal(result.scopeId,f.input.scope);assert.equal(result.profileChanged,false);assert.equal(result.modelCalls,0);assert.equal(result.sessionAuthorized,false);
  assert.equal(result.module.loadState,'host_load_not_verified');assert.equal(result.productFiles,f.index.files.length+1);
  for(const item of f.index.files)assert.equal(hash(await fs.readFile(path.join(f.deployment,'product',item.path))),item.sha256);
  assert.deepEqual(await fs.readFile(f.profile),profile);
  const config=JSON.parse(await fs.readFile(path.join(f.deployment,'runtime-config.json'))),options=JSON.parse(await fs.readFile(path.join(f.deployment,'plugin-options.json')));
  assert.deepEqual(config.sourceAuthorization,{saveUser:true,saveAssistant:false});assert.deepEqual(config.input.events,[]);assert.equal(config.input.scopeId,f.input.scope);assert.equal(config.input.timezone,'Asia/Taipei');
  assert.deepEqual(config.controls,{enabled:true,clean:false,proactive:false,pins:false});assert.equal(config.input.loopTiming.ttlMs,43200000);
  assert.deepEqual(options.acceptanceSessionIds,[]);assert.equal(options.llmModulePath,f.llmModule);assert.equal(options.workspaceRoot,f.workspace);
  await assert.rejects(fs.stat(path.join(f.deployment,'state')),{code:'ENOENT'});
});
test('重複 prepare 拒絕，既有目錄與前次設定逐位元保留',async()=>{
  const f=await fixture(),manager=createDesktopPreparer({packageRoot:f.packageRoot});await manager.prepare({...f.input,saveUser:false,saveAssistant:true});
  const file=path.join(f.deployment,'runtime-config.json'),before=await fs.readFile(file);
  assert.deepEqual(JSON.parse(before).sourceAuthorization,{saveUser:false,saveAssistant:true});
  await assert.rejects(manager.prepare(f.input),/cmcp_prepare_target_exists/);assert.deepEqual(await fs.readFile(file),before);
});
test('壞雜湊、依賴缺件與索引逃逸均在目的地建立前拒絕',async()=>{
  for(const mode of ['hash','missing','escape']){
    const f=await fixture();
    if(mode==='hash')await fs.appendFile(path.join(f.packageRoot,NATIVE,'client.js'),'changed');
    if(mode==='missing')f.index.files=f.index.files.filter(v=>!v.path.endsWith('/dep.mjs'));
    if(mode==='escape')f.index.files[0].path='../outside';
    if(mode!=='hash')await fs.writeFile(f.indexPath,JSON.stringify(f.index));
    await assert.rejects(createDesktopPreparer({packageRoot:f.packageRoot}).prepare(f.input),/cmcp_prepare_(?:member_mismatch|dependency_missing|index_path_invalid)/);await noDeployment(f);
  }
});
test('工作區 alias、來源祖先 alias 與 hardlink 拒絕，不跟隨寫入',async()=>{
  const f=await fixture(),alias=path.join(f.root,'workspace-alias');await fs.symlink(f.workspace,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(createDesktopPreparer({packageRoot:f.packageRoot}).prepare({...f.input,workspace:alias}),/path_alias_refused/);await noDeployment(f);
  const sourceAlias=path.join(f.root,'source-alias');await fs.symlink(f.packageRoot,sourceAlias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(createDesktopPreparer({packageRoot:sourceAlias}).prepare(f.input),/path_alias_refused/);await noDeployment(f);
  await fs.link(path.join(f.packageRoot,NATIVE,'client.js'),path.join(f.root,'client-hardlink.js'));
  await assert.rejects(createDesktopPreparer({packageRoot:f.packageRoot}).prepare(f.input),/hardlink_refused/);await noDeployment(f);
});
test('asar 虛擬路徑只驗實體 archive 與精確官方 suffix，不聲稱載入',async()=>{
  const f=await fixture(),archive=path.join(f.root,'resources/app.asar');await fs.mkdir(path.dirname(archive));await fs.writeFile(archive,'synthetic archive; not an installed app');
  const virtual=path.join(archive,'dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js'),manager=createDesktopPreparer({packageRoot:f.packageRoot});
  await assert.rejects(manager.prepare({...f.input,llmModule:path.join(archive,'untrusted/index.js')}),/llm_module_invalid/);await noDeployment(f);
  const result=await manager.prepare({...f.input,llmModule:virtual});assert.equal(result.module.kind,'desktop-asar-module');assert.equal(result.module.archive,archive);assert.equal(result.module.loadState,'host_load_not_verified');
});
test('時區、scope、保存選擇及多餘參數拒絕，不更動工作區',async()=>{
  const f=await fixture(),manager=createDesktopPreparer({packageRoot:f.packageRoot});
  for(const patch of [{timezone:'Not/AZone'},{scope:''},{saveUser:'yes'},{profile:f.profile}]){await assert.rejects(manager.prepare({...f.input,...patch}),/cmcp_prepare_/);await noDeployment(f);}
});
test('寫入失敗保留部分部署，不寫成功回執、不清除或覆蓋重試',async()=>{
  const f=await fixture(),io={...fs,writeFile:async(file,...args)=>{
    if(file===path.join(f.deployment,'plugin-options.json'))throw Object.assign(Error('synthetic write failure'),{code:'EIO'});
    return fs.writeFile(file,...args);
  }};
  await assert.rejects(createDesktopPreparer({packageRoot:f.packageRoot,io}).prepare(f.input),{code:'EIO'});
  const preserved=await fs.readFile(path.join(f.deployment,'runtime-config.json'));
  await assert.rejects(fs.lstat(path.join(f.deployment,'prepare-receipt.json')),{code:'ENOENT'});
  await assert.rejects(createDesktopPreparer({packageRoot:f.packageRoot}).prepare(f.input),/cmcp_prepare_target_exists/);
  assert.deepEqual(await fs.readFile(path.join(f.deployment,'runtime-config.json')),preserved);
});
test('CLI help 公開 prepare，參數與核准選擇 fail closed',async()=>{
  const help=await runRegistrationCli(['help'],()=>{});assert.ok(help.operations.prepare);assert.match(help.arguments.prepare,/--save-user yes\|no/);
  for(const args of [['prepare'],['prepare','--save-user','true','--save-assistant','yes'],['prepare','--workspace','one','--workspace','two']])await assert.rejects(runRegistrationCli(args,()=>{}),/cmcp_prepare_/);
});
