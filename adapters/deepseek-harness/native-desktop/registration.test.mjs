import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const moduleUrl=process.env.CMCP_PRODUCT_ROOT?pathToFileURL(path.join(path.resolve(process.env.CMCP_PRODUCT_ROOT),'adapters/deepseek-harness/native-desktop/registration.mjs')):new URL('./registration.mjs',import.meta.url);
const {status,register,unregister,createRegistrationManager,runRegistrationCli}=await import(moduleUrl.href);
const testRoot=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??'.cmcp-registration-tests');await fs.mkdir(testRoot,{recursive:true});
const original='# synthetic profile\r\n- insert:\r\n    - id: other-plugin\r\n      enabled: true\r\n';
async function fixture(text=original){
  const root=await fs.mkdtemp(path.join(testRoot,'profile-')),deploymentRoot=path.join(root,'deployment'),profile=path.join(root,'profile','cordis.patch.yml');
  const native=path.join(deploymentRoot,'product/adapters/deepseek-harness/native-desktop');await fs.mkdir(native,{recursive:true});await fs.mkdir(path.dirname(profile),{recursive:true});
  await fs.writeFile(profile,text);await fs.writeFile(path.join(native,'host.mjs'),'// synthetic package; never executed\n');
  await fs.writeFile(path.join(deploymentRoot,'plugin-options.json'),JSON.stringify({workspaceRoot:root,scopeId:'scope-A',runtimeConfig:path.join(deploymentRoot,'runtime.json')}));
  const history=path.join(deploymentRoot,'History.fixture');await fs.writeFile(history,'preserve original History\n');
  return {root,profile,deploymentRoot,history,native};
}
const run=async(action,f,manager={status,register,unregister})=>manager[action]({...f,expectedProfileHash:(await manager.status(f)).profileSha256});
test('register/unregister preserve exact preimage, History and package; duplicate operations are idempotent',async()=>{
  const f=await fixture(),before=await fs.readFile(f.profile),history=await fs.readFile(f.history),host=await fs.readFile(path.join(f.native,'host.mjs'));
  const first=await run('register',f);assert.equal(first.state,'registered');assert.equal(first.changed,true);assert.equal(first.modelCalls,0);
  const registered=await fs.readFile(f.profile);assert.equal((await run('register',f)).changed,false);assert.deepEqual(await fs.readFile(f.profile),registered);
  assert.equal((await run('unregister',f)).state,'unregistered');assert.deepEqual(await fs.readFile(f.profile),before);assert.equal((await run('unregister',f)).changed,false);
  assert.deepEqual(await fs.readFile(f.history),history);assert.deepEqual(await fs.readFile(path.join(f.native,'host.mjs')),host);
  const record=JSON.parse(await fs.readFile(first.receiptPath,'utf8'));assert.ok(!JSON.stringify(record).includes('other-plugin'));assert.equal(record.profileIdentity.path,f.profile);assert.equal(record.fragmentVersion,1);
});
test('unregister and reregister retain later unrelated plugin and user edits byte-for-byte',async()=>{
  const f=await fixture();await run('register',f);const extra='\n# user added later\n- insert:\n    - id: later-plugin\n      setting: keep\n';
  await fs.writeFile(f.profile,(await fs.readFile(f.profile,'utf8')).replace('enabled: true','enabled: false')+extra);
  const expected=original.replace('enabled: true','enabled: false')+extra;await run('unregister',f);assert.equal(await fs.readFile(f.profile,'utf8'),expected);
  await run('register',f);await run('unregister',f);assert.equal(await fs.readFile(f.profile,'utf8'),expected);
});
test('same-field drift, unmanaged legacy entry and unexpected fragment version refuse without mutation',async()=>{
  for(const replacement of [text=>text.replace('"scopeId":"scope-A"','"scopeId":"changed"'),text=>text.replace('registration v1 begin','registration v2 begin')]){
    const f=await fixture();await run('register',f);await fs.writeFile(f.profile,replacement(await fs.readFile(f.profile,'utf8')));const changed=await fs.readFile(f.profile);
    assert.equal((await status(f)).state,'conflict');await assert.rejects(run('unregister',f),/owned_registration_drift/);assert.deepEqual(await fs.readFile(f.profile),changed);
  }
  const legacy=await fixture('- insert:\n    - id: cmcp-desktop-native\n      name: legacy\n');await assert.rejects(run('register',legacy),/owned_registration_drift/);assert.equal((await status(legacy)).state,'conflict');
});
test('expected preimage and receipt identity/integrity/version reject stale or altered authority',async()=>{
  const f=await fixture(),stale=(await status(f)).profileSha256;await fs.appendFile(f.profile,'# external change\n');const before=await fs.readFile(f.profile);
  await assert.rejects(register({...f,expectedProfileHash:stale}),/preimage_mismatch/);await assert.rejects(register(f),/preimage_mismatch/);assert.deepEqual(await fs.readFile(f.profile),before);
  const live=await run('register',f),bytes=await fs.readFile(live.receiptPath),record=JSON.parse(bytes);
  for(const mutate of [r=>r.beforeProfileSha256='0'.repeat(64),r=>r.profileIdentity.path+='-other',r=>r.fragmentVersion=2]){
    const copy=structuredClone(record);mutate(copy);await fs.writeFile(live.receiptPath,JSON.stringify(copy));await assert.rejects(status(f),/receipt_mismatch/);
  }
  await fs.writeFile(live.receiptPath,bytes);assert.equal((await status(f)).state,'registered');
});
test('second read rejects an external edit before replacement and preserves failed temporary evidence',async()=>{
  const f=await fixture();let reads=0;const foreign=original+'# concurrent user edit\n';
  const io={...fs,readFile:async(file,...args)=>{if(file===f.profile&&++reads===2)await fs.writeFile(f.profile,foreign);return fs.readFile(file,...args);}};
  const before=(await status(f)).profileSha256;const manager=createRegistrationManager({io});await assert.rejects(manager.register({...f,expectedProfileHash:before}),/changed_before_write/);
  assert.equal(await fs.readFile(f.profile,'utf8'),foreign);assert.equal((await status(f)).state,'unregistered');
  const retained=await fs.readdir(path.dirname(f.profile));assert.equal(retained.filter(name=>name.endsWith('.tmp')).length,1);assert.equal(retained.filter(name=>name.endsWith('.failure.json')).length,1);assert.ok(!retained.some(name=>name.endsWith('.lock')));
  // A prepared receipt surviving an interrupted write can be safely reused; no blind whole-file rollback.
  await run('register',f);await run('unregister',f);assert.equal(await fs.readFile(f.profile,'utf8'),foreign);
});
test('empty sequence roundtrip is exact and subsequent unrelated list entries stay valid',async()=>{
  const text='# empty official patch\r\n[]\r\n',f=await fixture(text);await run('register',f);await run('unregister',f);assert.equal(await fs.readFile(f.profile,'utf8'),text);
  await run('register',f);await fs.appendFile(f.profile,'- insert:\n    - id: later\n');await run('unregister',f);
  const after=await fs.readFile(f.profile,'utf8');assert.ok(after.includes('id: later'));assert.ok(!after.includes('[]'));assert.ok(!after.includes('cmcp-desktop-native'));
});
test('paths, own options and concurrent manager lock are explicit and fail closed',async()=>{
  const f=await fixture();await assert.rejects(status({...f,profile:'cordis.patch.yml'}),/absolute_path_required/);await assert.rejects(status({...f,receiptPath:path.join(f.root,'outside.json')}),/outside_deployment/);
  const outside=path.join(f.root,'outside-receipts'),alias=path.join(f.deploymentRoot,'alias');await fs.mkdir(outside);await fs.symlink(outside,alias,process.platform==='win32'?'junction':'dir');
  try{await assert.rejects(status({...f,receiptPath:path.join(alias,'receipt.json')}),/path_(?:kind_invalid|alias_refused)/);assert.deepEqual(await fs.readdir(outside),[]);}finally{await fs.unlink(alias);}
  await fs.writeFile(f.profile+'.cmcp-registration.lock','other owner');await assert.rejects(run('register',f),/registration_locked/);assert.equal(await fs.readFile(f.profile+'.cmcp-registration.lock','utf8'),'other owner');await fs.unlink(f.profile+'.cmcp-registration.lock');
  const options=path.join(f.deploymentRoot,'plugin-options.json'),saved=await fs.readFile(options);await fs.writeFile(options,JSON.stringify({apiKey:'synthetic-not-a-real-key'}));await assert.rejects(run('register',f),/secret_field_refused/);assert.equal(await fs.readFile(f.profile,'utf8'),original);await fs.writeFile(options,saved);
  await run('register',f);await fs.writeFile(options,JSON.stringify({scopeId:'new-scope'}));await assert.rejects(run('register',f),/options_changed/);await run('unregister',f);assert.equal(await fs.readFile(f.profile,'utf8'),original);
});
test('thin CLI has no defaults, outputs only metadata and supports the unpacked product module',async()=>{
  const f=await fixture(),output=[];await assert.rejects(runRegistrationCli([],v=>output.push(v)),/action_required/);
  const help=await runRegistrationCli(['help'],v=>output.push(v));assert.ok(help.operations.adopt);assert.ok(help.operations.upgrade);assert.ok(help.operations.recover);
  const inspected=await runRegistrationCli(['status','--profile',f.profile,'--deployment-root',f.deploymentRoot],v=>output.push(v));
  await runRegistrationCli(['register','--profile',f.profile,'--deployment-root',f.deploymentRoot,'--expected-profile-hash',inspected.profileSha256],v=>output.push(v));
  assert.equal((await status(f)).state,'registered');assert.ok(output.every(line=>!line.includes('config:')&&!line.includes('other-plugin')));
  await assert.rejects(runRegistrationCli(['status','--profile',f.profile,'--profile',f.profile]),/arguments_invalid/);
});
