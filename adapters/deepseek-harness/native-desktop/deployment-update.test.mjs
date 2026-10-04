import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const moduleRoot=process.env.CMCP_PRODUCT_ROOT?pathToFileURL(path.join(path.resolve(process.env.CMCP_PRODUCT_ROOT),'adapters/deepseek-harness/native-desktop/')):new URL('./',import.meta.url);
const {createDeploymentUpdater}=await import(new URL('deployment-update.mjs',moduleRoot));
const {createRegistrationManager,runRegistrationCli}=await import(new URL('registration.mjs',moduleRoot));
const updater=createDeploymentUpdater(),registration=createRegistrationManager();
const testRoot=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??'.cmcp-deployment-update-tests');await fs.mkdir(testRoot,{recursive:true});
const hash=value=>createHash('sha256').update(value).digest('hex');
const other='# 合成設定\r\n- id: unrelated-native-plugin\r\n  config:\r\n    enabled: true\r\n';
async function fixture({folded=false}={}){
  const root=await fs.mkdtemp(path.join(testRoot,'upgrade-')),workspace=path.join(root,'workspace'),deploymentRoot=path.join(workspace,'cmcp-desktop-native'),profile=path.join(root,'profile','cordis.patch.yml');
  const host=path.join(deploymentRoot,'product/adapters/deepseek-harness/native-desktop/host.mjs');await fs.mkdir(path.dirname(host),{recursive:true});await fs.mkdir(path.dirname(profile),{recursive:true});
  const options={workspaceRoot:workspace,deploymentRoot,scopeId:'合成範圍',runtimeConfig:path.join(deploymentRoot,'runtime-config.json'),traceRoot:path.join(deploymentRoot,'state','trace'),skillPath:path.join(path.dirname(host),'SKILL.md'),acceptanceSessionIds:[]};
  await fs.writeFile(host,'export const name="cmcp-desktop-native";\n');await fs.writeFile(options.skillPath,'# 合成 Skill\n');await fs.writeFile(path.join(deploymentRoot,'plugin-options.json'),JSON.stringify(options));
  const encoded=JSON.stringify(pathToFileURL(host).href),name=folded?encoded.slice(0,40)+'\\\r\n        '+encoded.slice(40):encoded;
  const legacy='- insert:\r\n    - id: cmcp-desktop-native\r\n      name: '+name+'\r\n      config: '+JSON.stringify(options)+'\r\n';
  await fs.writeFile(profile,other+legacy);const protectedFiles=[];
  for(const [rel,value] of Object.entries({'state/history/source.txt':'原文與角色，不可變更','state/media/original.jpg':'合成媒體原件','state/buffer.json':'{"expiresAt":"2026-10-04T03:00:00Z"}','state/pins.json':'{"status":"cancelled","time":"2026-10-01T02:00:00Z"}','runtime-config.json':'{"input":{"root":"state/history"},"controls":{"clean":true,"pins":false}}'})){
    const file=path.join(deploymentRoot,rel);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value);protectedFiles.push({file,sha256:hash(value)});
  }
  return {root,workspace,profile,deploymentRoot,host,options,legacy,protectedFiles};
}
const request=async(f,extra={},manager=updater)=>{const plan=await manager.inspect(f);return {...f,expectedProfileHash:plan.profileSha256,expectedDeploymentHash:plan.deploymentSha256,expectedLegacyHash:plan.legacyFragmentSha256,...extra};};
const act=async(action,f,extra={},manager=updater)=>manager[action](await request(f,extra,manager));
async function assertProtected(f){for(const row of f.protectedFiles)assert.equal(hash(await fs.readFile(row.file)),row.sha256,row.file);}
async function packageFixture(f,modifyIndex){
  const root=await fs.mkdtemp(path.join(f.root,'package-'));
  const contents={'package.json':JSON.stringify({name:'@redwakame-skill/cmcp-time',version:'0.1.0-rc.3',type:'module'}),'adapters/deepseek-harness/native-desktop/host.mjs':'export const name="cmcp-desktop-native"; export const revision="candidate";\n','adapters/deepseek-harness/native-desktop/SKILL.md':'# 更新後合成 Skill\n','NOTICE':'保留上游聲明\n'};
  const files=[];for(const [rel,content] of Object.entries(contents)){const file=path.join(root,rel);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);files.push({path:rel,bytes:Buffer.byteLength(content),sha256:hash(content)});}
  const index={kind:'cmcp-time-public-source-allowlist',version:'0.1.0-rc.3',files};modifyIndex?.(index);
  const text=JSON.stringify(index);await fs.writeFile(path.join(root,'PUBLIC-FILES.json'),text);
  return {packageRoot:root,expectedPackageIndexHash:hash(text)};
}

test('舊無 marker 反例保留；嚴格辨識官方折行格式與明示部署身分',async()=>{
  const f=await fixture({folded:true}),before=await fs.readFile(f.profile);
  assert.equal((await registration.status(f)).state,'conflict');await assert.rejects(registration.register({...f,expectedProfileHash:hash(before)}),/owned_registration_drift/);
  const plan=await updater.inspect(f);assert.equal(plan.state,'legacy-confirmed');assert.equal(plan.legacyFragmentSha256,hash(f.legacy));assert.equal(plan.modelCalls,0);
  assert.deepEqual(await fs.readFile(f.profile),before);await assertProtected(f);
});

test('舊登錄轉換、更新、停用、重啟用、解除及反向還原保留資料與他人設定',async()=>{
  const f=await fixture({folded:true}),before=await fs.readFile(f.profile),oldHost=await fs.readFile(f.host);
  const adoption=await act('adopt',f);assert.equal((await updater.inspect(f)).state,'registered');assert.equal((await registration.status(f)).state,'registered');
  const pkg=await packageFixture(f),upgrade=await act('upgrade',f,pkg),tx=JSON.parse(await fs.readFile(upgrade.transactionPath));
  const installed=tx.details.product;assert.equal(hash(await fs.readFile(path.join(installed,'PUBLIC-FILES.json'))),pkg.expectedPackageIndexHash);
  assert.match(await fs.readFile(f.profile,'utf8'),/\.cmcp-releases/);assert.deepEqual(await fs.readFile(f.host),oldHost);
  const userAdded='\n- id: later-native-plugin\n  config: {keep: true}\n';await fs.appendFile(f.profile,userAdded);
  const disabled=await act('disable',f);assert.equal((await updater.inspect(f)).state,'unregistered');assert.ok(!(await fs.readFile(f.profile,'utf8')).includes('id: cmcp-desktop-native'));
  await act('enable',f);assert.equal((await updater.inspect(f)).state,'registered');await assertProtected(f);
  await act('rollback',f,{transactionPath:upgrade.transactionPath});assert.ok(!(await fs.readFile(f.profile,'utf8')).includes('.cmcp-releases'));assert.ok((await fs.readFile(f.profile,'utf8')).includes(userAdded));
  await act('rollback',f,{transactionPath:adoption.transactionPath});assert.equal((await updater.inspect(f)).state,'legacy-confirmed');
  assert.equal((await fs.readFile(f.profile,'utf8')).replace(f.legacy,''),before.toString().replace(f.legacy,'')+userAdded);await assertProtected(f);
  assert.ok((await fs.stat(disabled.transactionPath)).isFile());assert.ok((await fs.stat(installed)).isDirectory());
});

test('接管需要 profile、legacy 與部署三項當前雜湊，拒絕猜測與漂移',async()=>{
  for(const field of ['expectedProfileHash','expectedDeploymentHash','expectedLegacyHash']){
    const f=await fixture(),args=await request(f),before=await fs.readFile(f.profile);args[field]='0'.repeat(64);await assert.rejects(updater.adopt(args),/mismatch/);assert.deepEqual(await fs.readFile(f.profile),before);
  }
  const f=await fixture(),before=await fs.readFile(f.profile);await fs.appendFile(f.host,'// 本機漂移\n');
  const old=await request(f);await fs.appendFile(f.host,'// 核對後再次漂移\n');await assert.rejects(updater.adopt(old),/deployment_preimage_mismatch/);assert.deepEqual(await fs.readFile(f.profile),before);
});

test('同名未知模組、不同 config、混合 insert、重複登錄和 YAML 表達式均不接管',async()=>{
  const variants=[(text)=>text.replace('name: "file:', 'name: "unknown:'),(text)=>text.replace('"scopeId":"合成範圍"','"scopeId":"別的範圍"'),
    text=>text+'    - id: unrelated\n      name: native\n',text=>text+'- insert:\n    - id: cmcp-desktop-native\n      name: unknown\n',text=>text.replace('config: {','config: !!js {')];
  for(const mutate of variants){const f=await fixture();await fs.writeFile(f.profile,mutate(await fs.readFile(f.profile,'utf8')));const before=await fs.readFile(f.profile);assert.equal((await updater.inspect(f)).state,'conflict');await assert.rejects(act('adopt',f),/legacy_identity_unproven/);assert.deepEqual(await fs.readFile(f.profile),before);}
});

test('本套件欄位遭外部改動時更新與停用均拒絕，不覆蓋 profile',async()=>{
  const f=await fixture();await act('adopt',f);await fs.writeFile(f.profile,(await fs.readFile(f.profile,'utf8')).replace('"scopeId":"合成範圍"','"scopeId":"使用者變更"'));
  const before=await fs.readFile(f.profile);await assert.rejects(act('disable',f),/managed_registration_required/);await assert.rejects(act('upgrade',f,await packageFixture(f)),/managed_registration_required/);assert.deepEqual(await fs.readFile(f.profile),before);
});

test('安裝包缺件、hash 錯誤、穿越、大小寫別名與保留路徑拒絕',async()=>{
  const variants=[index=>index.files[0].sha256='0'.repeat(64),index=>index.files[0].path='../outside.json',index=>index.files.push({...index.files[0],path:'PACKAGE.JSON'}),index=>index.files[0].path='NUL',index=>index.files=index.files.filter(row=>!row.path.endsWith('SKILL.md'))];
  for(const mutate of variants){const f=await fixture();await act('adopt',f);const before=await fs.readFile(f.profile),pkg=await packageFixture(f,mutate);await assert.rejects(act('upgrade',f,pkg),/package_(?:member_mismatch|path_invalid|dependency_missing)/);assert.deepEqual(await fs.readFile(f.profile),before);await assertProtected(f);}
});

test('安裝包 symbolic alias 與 receipt 跨範圍都拒絕',async()=>{
  const f=await fixture();await act('adopt',f);const pkg=await packageFixture(f),source=path.join(pkg.packageRoot,'adapters'),alias=path.join(pkg.packageRoot,'alias-adapters');
  await fs.rename(source,alias);await fs.symlink(alias,source,process.platform==='win32'?'junction':'dir');await assert.rejects(act('upgrade',f,pkg),/path_alias_or_kind/);assert.ok((await fs.stat(alias)).isDirectory());
  await assert.rejects(updater.inspect({...f,receiptPath:path.join(f.root,'outside.json')}),/receipt_path_outside_deployment/);
});

test('靜態相對模組缺件不能被合法索引雜湊掩蓋',async()=>{
  const f=await fixture();await act('adopt',f);const pkg=await packageFixture(f),host=path.join(pkg.packageRoot,'adapters/deepseek-harness/native-desktop/host.mjs');
  const content='import "./missing-dependency.mjs";\n';await fs.writeFile(host,content);const index=JSON.parse(await fs.readFile(path.join(pkg.packageRoot,'PUBLIC-FILES.json')));
  Object.assign(index.files.find(row=>row.path.endsWith('host.mjs')),{bytes:Buffer.byteLength(content),sha256:hash(content)});const updated=JSON.stringify(index);await fs.writeFile(path.join(pkg.packageRoot,'PUBLIC-FILES.json'),updated);
  const before=await fs.readFile(f.profile);await assert.rejects(act('upgrade',f,{...pkg,expectedPackageIndexHash:hash(updated)}),/package_dependency_missing/);assert.deepEqual(await fs.readFile(f.profile),before);
});

test('升級半途寫入失敗保留失敗副本，不改目前登錄與原件',async()=>{
  const f=await fixture();await act('adopt',f);const pkg=await packageFixture(f),before=await fs.readFile(f.profile);let copied=0;
  const manager=createDeploymentUpdater({io:{...fs,writeFile:async(file,...args)=>{if(file.includes('.cmcp-releases')&&++copied===2)throw Object.assign(Error('合成容量不足'),{code:'ENOSPC'});return fs.writeFile(file,...args);}}});
  await assert.rejects(act('upgrade',f,pkg,manager),{code:'ENOSPC'});assert.deepEqual(await fs.readFile(f.profile),before);await assertProtected(f);
  const release=path.join(f.deploymentRoot,'.cmcp-releases',pkg.expectedPackageIndexHash);assert.ok((await fs.stat(release)).isDirectory());await assert.rejects(act('upgrade',f,pkg),/release_target_exists/);
});

test('profile 已提交但 receipt 中斷時明示 recovery-required，正式舊入口也拒絕',async()=>{
  const f=await fixture();let failed=false;
  const manager=createDeploymentUpdater({io:{...fs,rename:async(from,to)=>{if(to.includes('.cmcp-registration')&&to.endsWith('.json')&&!failed){failed=true;throw Object.assign(Error('合成中斷'),{code:'EIO'});}return fs.rename(from,to);}}});
  await assert.rejects(act('adopt',f,{},manager),{code:'EIO'});assert.equal((await updater.inspect(f)).state,'recovery-required');await assert.rejects(registration.status(f),/recovery_required/);
  await act('recover',f);assert.equal((await updater.inspect(f)).state,'registered');await assertProtected(f);
});

test('準備完成但 profile 未寫入時可安全中止準備，保留回執',async()=>{
  const f=await fixture(),before=await fs.readFile(f.profile);let failed=false;
  const manager=createDeploymentUpdater({io:{...fs,rename:async(from,to)=>{if(to===f.profile&&!failed){failed=true;throw Object.assign(Error('合成權限失敗'),{code:'EACCES'});}return fs.rename(from,to);}}});
  await assert.rejects(act('adopt',f,{},manager),{code:'EACCES'});const recovered=await act('recover',f);assert.equal(recovered.state,'aborted-before-profile-write');assert.deepEqual(await fs.readFile(f.profile),before);assert.ok((await fs.stat(recovered.transactionPath)).isFile());await act('adopt',f);await assertProtected(f);
});

test('中斷後外部又改 profile 時不自動回復整份舊設定',async()=>{
  const f=await fixture();const manager=createDeploymentUpdater({io:{...fs,rename:async(from,to)=>{if(to===f.profile)throw Object.assign(Error('合成中斷'),{code:'EIO'});return fs.rename(from,to);}}});
  await assert.rejects(act('adopt',f,{},manager));await fs.appendFile(f.profile,'# 使用者在中斷後新增\n');const before=await fs.readFile(f.profile);
  await assert.rejects(act('recover',f),/recovery_conflict/);assert.deepEqual(await fs.readFile(f.profile),before);assert.equal((await updater.inspect(f)).state,'recovery-required');
});

test('解除不刪登錄回執或套件；重複更新及撤回舊版本拒絕',async()=>{
  const f=await fixture(),adopted=await act('adopt',f),pkg=await packageFixture(f);await act('upgrade',f,pkg);const before=await fs.readFile(f.profile);
  await assert.rejects(act('upgrade',f,pkg),/release_target_exists/);await assert.rejects(act('rollback',f,{transactionPath:adopted.transactionPath}),/rollback_version_conflict/);assert.deepEqual(await fs.readFile(f.profile),before);
  await registration.unregister({...f,expectedProfileHash:(await registration.status(f)).profileSha256});assert.equal((await updater.inspect(f)).state,'unregistered');await act('enable',f);await assertProtected(f);
});

test('重啟用驗 stage 全部檔案，不能接受已被改動的更新模組',async()=>{
  const f=await fixture();await act('adopt',f);const upgrade=await act('upgrade',f,await packageFixture(f)),tx=JSON.parse(await fs.readFile(upgrade.transactionPath));await act('disable',f);
  await fs.appendFile(path.join(tx.details.product,'NOTICE'),'外部變更');const before=await fs.readFile(f.profile);await assert.rejects(act('enable',f),/package_member_mismatch/);assert.deepEqual(await fs.readFile(f.profile),before);
});

test('使用者改 plugin-options 範圍後不藉更新或重新啟用暗自套用',async()=>{
  const f=await fixture();await act('adopt',f);const pkg=await packageFixture(f);
  await fs.writeFile(path.join(f.deploymentRoot,'plugin-options.json'),JSON.stringify({...f.options,scopeId:'使用者新範圍'}));const before=await fs.readFile(f.profile);
  await assert.rejects(act('upgrade',f,pkg),/current_options_drift/);assert.deepEqual(await fs.readFile(f.profile),before);
  await act('disable',f);const disabled=await fs.readFile(f.profile);await assert.rejects(act('enable',f),/current_options_drift/);assert.deepEqual(await fs.readFile(f.profile),disabled);
});

test('公開 CLI 可從 inspect 核對後接管，輸出不含其他設定或原文',async()=>{
  const f=await fixture(),out=[],base=['--profile',f.profile,'--deployment-root',f.deploymentRoot];
  const plan=await runRegistrationCli(['inspect',...base],line=>out.push(line));
  await runRegistrationCli(['adopt',...base,'--expected-profile-hash',plan.profileSha256,'--expected-deployment-hash',plan.deploymentSha256,'--expected-legacy-hash',plan.legacyFragmentSha256],line=>out.push(line));
  assert.ok(out.every(line=>!line.includes('unrelated-native-plugin')&&!line.includes('原文與角色')));assert.equal((await updater.inspect(f)).state,'registered');
});
