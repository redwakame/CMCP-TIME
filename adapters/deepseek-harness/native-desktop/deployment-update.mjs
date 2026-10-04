import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {replaceExistingFile} from './replace-file.mjs';

const OWNER='cmcp-desktop-native';
const BEGIN='# cmcp-desktop-native registration v1 begin',END='# cmcp-desktop-native registration v1 end';
const HASH=/^[a-f0-9]{64}$/u;
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonicalValue=value=>Array.isArray(value)?value.map(canonicalValue):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalValue(value[key])])):value;
const stable=value=>JSON.stringify(canonicalValue(value));
const seal=body=>({...body,integrity:hash(stable(body))});
const validSeal=record=>{if(!record||typeof record!=='object')return false;const {integrity,...body}=record;return integrity===hash(stable(body));};
const fail=code=>{throw Error(code);};
const equalPath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const hasOwner=text=>/(?:^|\n)[ \t]*(?:-[ \t]*)?id:[ \t]*(?:cmcp-desktop-native|"cmcp-desktop-native"|'cmcp-desktop-native')[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/u.test(text)||text.includes('# cmcp-desktop-native registration');
const encodeFragment=(url,options)=>'\n'+BEGIN+'\n- insert:\n    - id: '+OWNER+'\n      name: '+JSON.stringify(url)+'\n      config: '+JSON.stringify(options)+'\n'+END+'\n';
const inside=(root,target)=>{const rel=path.relative(root,target);return rel!==''&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
function optionsSafe(value){
  if(!value||typeof value!=='object')fail('cmcp_update_options_invalid');
  for(const [key,child] of Object.entries(value)){
    if(/(?:api.?key|password|secret|authorization|credential|access.?token|refresh.?token)|^token$/iu.test(key))fail('cmcp_update_secret_field_refused');
    if(child&&typeof child==='object')optionsSafe(child);
  }
}
// Deliberately recognizes only the standalone block produced by the earlier CMCP
// registration program, including the official YAML writer's quoted line folding.
// It does not evaluate YAML tags, expressions, aliases or unrelated plugin data.
function legacyBlock(text){
  const blocks=[...text.matchAll(/^- insert:[ \t]*\r?\n(?:(?:[ \t]+[^\r\n]*|[ \t]*)\r?\n|[ \t]+[^\r\n]+$)*/gmu)]
    .filter(match=>hasOwner(match[0]));
  if(blocks.length!==1)return null;
  const block=blocks[0],unfolded=block[0].replace(/\\\r?\n[ \t]*/gu,'');
  const match=/^- insert:[ \t]*\r?\n    - id: cmcp-desktop-native[ \t]*\r?\n      name: ("(?:[^"\\]|\\.)*")[ \t]*\r?\n      config: (\{[^\r\n]*\})[ \t]*(?:\r?\n[ \t]*)*$/u.exec(unfolded);
  if(!match)return null;
  let moduleUrl,options;try{moduleUrl=JSON.parse(match[1]);options=JSON.parse(match[2]);}catch{return null;}
  const rest=text.slice(0,block.index)+text.slice(block.index+block[0].length);
  if(hasOwner(rest))return null;
  optionsSafe(options);
  return {fragment:block[0],index:block.index,moduleUrl,options};
}

/** Local fragment transactions. Data roots and existing product files are never removed. */
export function createDeploymentUpdater({io=fs}={}){
  async function canonical(file,kind){
    if(typeof file!=='string'||!path.isAbsolute(file))fail('cmcp_update_absolute_path_required');
    const resolved=path.resolve(file),stat=await io.lstat(resolved),real=await io.realpath(resolved);
    if(stat.isSymbolicLink()||!equalPath(real,resolved)||!(kind==='directory'?stat.isDirectory():stat.isFile()))fail('cmcp_update_path_alias_or_kind');
    if(kind==='file'&&stat.nlink!==1)fail('cmcp_update_hardlink_refused');
    return real;
  }
  async function bytes(file){await canonical(file,'file');const content=await io.readFile(file);if(content.length>2*1024*1024)fail('cmcp_update_metadata_size');return content;}
  async function optional(file){try{return await bytes(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  async function text(file){const content=await bytes(file);if(!Buffer.from(content.toString('utf8')).equals(content))fail('cmcp_update_utf8_required');return content.toString('utf8');}
  async function newParent(file){
    const parent=path.dirname(file);let cursor=parent;
    for(;;){try{await canonical(cursor,'directory');break;}catch(error){if(error.code!=='ENOENT')throw error;const next=path.dirname(cursor);if(next===cursor)throw error;cursor=next;}}
    await io.mkdir(parent,{recursive:true});await canonical(parent,'directory');
  }
  async function context(input){
    const profile=await canonical(input?.profile,'file'),deploymentRoot=await canonical(input?.deploymentRoot,'directory');
    if(path.basename(profile)!=='cordis.patch.yml')fail('cmcp_profile_identity_invalid');
    const receiptPath=path.resolve(input.receiptPath??path.join(deploymentRoot,'.cmcp-registration',hash(profile).slice(0,24)+'.json'));
    if(!inside(deploymentRoot,receiptPath)||equalPath(receiptPath,profile))fail('cmcp_receipt_path_outside_deployment');
    let cursor=path.dirname(receiptPath);for(;;){try{await canonical(cursor,'directory');break;}catch(error){if(error.code!=='ENOENT')throw error;cursor=path.dirname(cursor);}}
    const profileIdentity={path:profile,parent:await canonical(path.dirname(profile),'directory')};
    return {profile,deploymentRoot,receiptPath,profileIdentity,pending:receiptPath+'.pending.json',archive:receiptPath+'.transactions'};
  }
  async function deployment(t){
    const optionsFile=path.join(t.deploymentRoot,'plugin-options.json'),host=path.join(t.deploymentRoot,'product/adapters/deepseek-harness/native-desktop/host.mjs');
    const optionBytes=await bytes(optionsFile),hostBytes=await bytes(host);let options;try{options=JSON.parse(optionBytes);}catch{fail('cmcp_update_options_invalid');}optionsSafe(options);
    if(options.deploymentRoot&&!equalPath(path.resolve(options.deploymentRoot),t.deploymentRoot))fail('cmcp_update_deployment_identity_mismatch');
    if(options.workspaceRoot&&!equalPath(path.resolve(options.workspaceRoot),path.dirname(t.deploymentRoot)))fail('cmcp_update_workspace_identity_mismatch');
    const identity={host:pathToFileURL(await canonical(host,'file')).href,hostSha256:hash(hostBytes),optionsSha256:hash(optionBytes)};
    return {options,identity,sha256:hash(stable(identity))};
  }
  async function readRecord(t){
    const content=await optional(t.receiptPath);if(!content)return null;
    let record;try{record=JSON.parse(content);}catch{fail('cmcp_registration_receipt_invalid');}
    if(!validSeal(record)||record.kind!=='cmcp_desktop_registration'||record.owner!==OWNER||record.version!==1||record.fragmentVersion!==1
      ||stable(record.profileIdentity)!==stable(t.profileIdentity)||record.deploymentRoot!==t.deploymentRoot||typeof record.fragment!=='string'
      ||record.fragmentSha256!==hash(record.fragment)||!record.fragment.startsWith('\n'+BEGIN+'\n')||!record.fragment.endsWith(END+'\n'))fail('cmcp_registration_receipt_mismatch');
    return record;
  }
  function managed(textValue,record){
    if(!record)return false;const i=textValue.indexOf(record.fragment);
    return i>=0&&!hasOwner(textValue.slice(0,i)+textValue.slice(i+record.fragment.length));
  }
  async function inspect(input){
    const t=await context(input),profile=await text(t.profile),record=await readRecord(t),deployed=await deployment(t),pending=await optional(t.pending);
    const legacy=!record||!managed(profile,record)?legacyBlock(profile):null;
    const verified=legacy&&legacy.moduleUrl===deployed.identity.host&&stable(legacy.options)===stable(deployed.options);
    let state=pending?'recovery-required':managed(profile,record)?'registered':hasOwner(profile)?verified?'legacy-confirmed':'conflict':'unregistered';
    return {kind:'cmcp_desktop_update_plan',version:1,state,profile:t.profile,deploymentRoot:t.deploymentRoot,receiptPath:t.receiptPath,
      scopeId:deployed.options.scopeId??null,packageVersion:record?.origin?.packageVersion??null,
      profileSha256:hash(profile),deploymentSha256:deployed.sha256,hostSha256:deployed.identity.hostSha256,optionsSha256:deployed.identity.optionsSha256,
      legacyFragmentSha256:verified?hash(legacy.fragment):null,fragmentSha256:record?.fragmentSha256??null,
      operations:state==='legacy-confirmed'?['adopt']:state==='registered'?['upgrade','disable','unregister']:state==='unregistered'&&record?['enable']:state==='recovery-required'?['recover']:[],
      historyRemoved:false,packageRemoved:false,modelCalls:0};
  }
  function expect(input,profile,deployed){
    if(!HASH.test(input.expectedProfileHash??'')||hash(profile)!==input.expectedProfileHash)fail('cmcp_profile_preimage_mismatch');
    if(!HASH.test(input.expectedDeploymentHash??'')||deployed.sha256!==input.expectedDeploymentHash)fail('cmcp_update_deployment_preimage_mismatch');
  }
  async function lock(t,fn){
    const lockFile=t.profile+'.cmcp-registration.lock';let handle;
    try{handle=await io.open(lockFile,'wx');}catch(error){if(error.code==='EEXIST')fail('cmcp_registration_locked');throw error;}
    try{return await fn();}finally{await handle.close();await io.unlink(lockFile);}
  }
  async function atomic(file,content,expectedBytes){
    await newParent(file);const temp=file+'.'+randomUUID()+'.prepared';
    const handle=await io.open(temp,'wx');try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}
    const current=await optional(file);
    if(expectedBytes===null?current!==null:current===null||hash(current)!==hash(expectedBytes))fail('cmcp_update_file_changed_before_write');
    if(current)await replaceExistingFile(temp,file,{io,expectedHash:hash(current)});else await io.rename(temp,file);
    const after=await bytes(file);if(hash(after)!==hash(content))fail('cmcp_update_file_changed_after_write');
  }
  async function finish(t,transaction){
    await newParent(path.join(t.archive,'placeholder'));
    const complete={kind:'cmcp_desktop_update_result',version:1,operation:transaction.action,id:transaction.id,at:new Date().toISOString(),
      profile:t.profile,deploymentRoot:t.deploymentRoot,profileSha256:hash(await bytes(t.profile)),receiptSha256:(await optional(t.receiptPath))?hash(await bytes(t.receiptPath)):null,
      state:transaction.afterFragment?(transaction.afterReceipt?'registered':'legacy-confirmed'):'unregistered',scopeId:(await deployment(t)).options.scopeId??null,
      packageVersion:transaction.afterReceipt?JSON.parse(transaction.afterReceipt).origin?.packageVersion??null:null,
      transactionPath:path.join(t.archive,transaction.id+'.json'),historyRemoved:false,packageRemoved:false,modelCalls:0};
    await io.writeFile(path.join(t.archive,transaction.id+'.result.json'),JSON.stringify(complete,null,2)+'\n',{flag:'wx'});
    await io.rename(t.pending,complete.transactionPath);return complete;
  }
  async function applyReceipt(t,transaction){
    const before=transaction.beforeReceipt===null?null:Buffer.from(transaction.beforeReceipt),after=transaction.afterReceipt===null?null:Buffer.from(transaction.afterReceipt);
    const current=await optional(t.receiptPath);
    if(after&&current&&hash(current)===hash(after))return;
    if(before===null?current!==null:current===null||hash(current)!==hash(before))fail('cmcp_update_receipt_changed');
    if(after)await atomic(t.receiptPath,after,before);
    else if(current){await newParent(path.join(t.archive,'placeholder'));await io.rename(t.receiptPath,path.join(t.archive,transaction.id+'.retired-receipt.json'));}
  }
  async function transition(t,{action,before,oldFragment,newFragment,beforeRecord,afterRecord,details={}}){
    if(await optional(t.pending))fail('cmcp_update_recovery_required');
    const index=oldFragment?before.indexOf(oldFragment):before.length;
    if(index<0||oldFragment&&before.indexOf(oldFragment,index+oldFragment.length)>=0)fail('cmcp_update_owned_fragment_drift');
    const outside=oldFragment?before.slice(0,index)+before.slice(index+oldFragment.length):before;
    if(hasOwner(outside))fail('cmcp_update_owned_fragment_drift');
    const after=before.slice(0,index)+newFragment+before.slice(index+oldFragment.length);
    const beforeReceipt=await optional(t.receiptPath);
    if(beforeRecord===null?beforeReceipt!==null:!beforeReceipt||hash(beforeReceipt)!==hash(JSON.stringify(beforeRecord,null,2)+'\n')){
      if(beforeRecord===null||!beforeReceipt||stable(JSON.parse(beforeReceipt))!==stable(beforeRecord))fail('cmcp_update_receipt_changed');
    }
    const transaction=seal({kind:'cmcp_desktop_update_transaction',version:1,id:randomUUID(),action,at:new Date().toISOString(),profileIdentity:t.profileIdentity,deploymentRoot:t.deploymentRoot,
      beforeProfileSha256:hash(before),afterProfileSha256:hash(after),outsideSha256:hash(outside),beforeFragment:oldFragment,afterFragment:newFragment,
      beforeReceipt:beforeReceipt?.toString('utf8')??null,afterReceipt:afterRecord?JSON.stringify(afterRecord,null,2)+'\n':null,details});
    await newParent(t.pending);await io.writeFile(t.pending,JSON.stringify(transaction,null,2)+'\n',{flag:'wx'});
    await atomic(t.profile,Buffer.from(after),Buffer.from(before));await applyReceipt(t,transaction);return finish(t,transaction);
  }
  function record(t,before,after,fragment,origin){
    return seal({kind:'cmcp_desktop_registration',version:1,owner:OWNER,fragmentVersion:1,profileIdentity:t.profileIdentity,deploymentRoot:t.deploymentRoot,
      beforeProfileSha256:hash(before),normalizedBeforeSha256:hash(before),afterProfileSha256:hash(after),normalization:null,fragment,fragmentSha256:hash(fragment),origin});
  }
  async function prepare(input,fn){const t=await context(input);return lock(t,async()=>{if(await optional(t.pending))fail('cmcp_update_recovery_required');const before=await text(t.profile),deployed=await deployment(t);expect(input,before,deployed);return fn(t,before,deployed,await readRecord(t));});}
  async function adopt(input){return prepare(input,async(t,before,deployed,existing)=>{
    if(existing||managed(before,existing))fail('cmcp_update_adoption_already_managed');
    const candidate=legacyBlock(before);
    if(!candidate||candidate.moduleUrl!==deployed.identity.host||stable(candidate.options)!==stable(deployed.options))fail('cmcp_update_legacy_identity_unproven');
    if(input.expectedLegacyHash!==hash(candidate.fragment))fail('cmcp_update_legacy_preimage_mismatch');
    const owned=encodeFragment(candidate.moduleUrl,candidate.options),outside=before.replace(candidate.fragment,''),after=before.replace(candidate.fragment,owned);
    const next=record(t,outside,after,owned,{kind:'verified-legacy-adoption',legacyFragmentSha256:hash(candidate.fragment),deploymentSha256:deployed.sha256});
    return transition(t,{action:'adopt',before,oldFragment:candidate.fragment,newFragment:owned,beforeRecord:null,afterRecord:next});
  });}
  async function disable(input){return prepare(input,async(t,before,deployed,current)=>{
    if(!current||!managed(before,current))fail('cmcp_update_managed_registration_required');
    return transition(t,{action:'disable',before,oldFragment:current.fragment,newFragment:'',beforeRecord:current,afterRecord:current});
  });}
  async function enable(input){return prepare(input,async(t,before,deployed,current)=>{
    if(!current||hasOwner(before))fail('cmcp_update_unregistered_receipt_required');
    await currentDeployment(t,current,deployed);
    return transition(t,{action:'enable',before,oldFragment:'',newFragment:current.fragment,beforeRecord:current,afterRecord:current});
  });}
  async function packageIndex(packageRoot,expectedHash){
    const root=await canonical(packageRoot,'directory'),indexBytes=await bytes(path.join(root,'PUBLIC-FILES.json'));
    if(!HASH.test(expectedHash??'')||hash(indexBytes)!==expectedHash)fail('cmcp_update_package_index_mismatch');
    let index;try{index=JSON.parse(indexBytes);}catch{fail('cmcp_update_package_index_invalid');}
    if(index.kind!=='cmcp-time-public-source-allowlist'||!Array.isArray(index.files)||index.files.length<1||index.files.length>1000)fail('cmcp_update_package_index_invalid');
    const entries=[],seen=new Set();let total=0;
    for(const entry of index.files){
      const rel=entry.path;
      if(typeof rel!=='string'||rel==='PUBLIC-FILES.json'||rel.includes('\\')||rel.includes(':')||rel.startsWith('/')||rel.split('/').some(v=>!v||v==='.'||v==='..')||rel.split('/').some(v=>/[. ]$/u.test(v)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(v))||seen.has(rel.toLowerCase())||!HASH.test(entry.sha256??''))fail('cmcp_update_package_path_invalid');
      seen.add(rel.toLowerCase());const absolute=path.resolve(root,...rel.split('/'));if(!inside(root,absolute))fail('cmcp_update_package_path_invalid');
      const content=await bytes(absolute);if(content.length!==entry.bytes||hash(content)!==entry.sha256)fail('cmcp_update_package_member_mismatch');
      total+=content.length;if(total>64*1024*1024)fail('cmcp_update_package_size_limit');entries.push({...entry,content});
    }
    for(const required of ['adapters/deepseek-harness/native-desktop/host.mjs','adapters/deepseek-harness/native-desktop/SKILL.md','package.json'])if(!seen.has(required.toLowerCase()))fail('cmcp_update_package_dependency_missing');
    // Check static relative module dependencies without executing downloaded code.
    // Third-party/built-in host imports retain their independently documented host requirements.
    for(const entry of entries.filter(row=>/\.(?:mjs|js|cjs)$/u.test(row.path))){
      const source=entry.content.toString('utf8');
      for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.[^'"\r\n]+)\1/gu)){
        const relative=path.posix.normalize(path.posix.join(path.posix.dirname(entry.path),match[2]));
        if(relative.startsWith('../')||!seen.has(relative.toLowerCase()))fail('cmcp_update_package_dependency_missing');
      }
    }
    const pkg=JSON.parse(entries.find(v=>v.path==='package.json').content);if(pkg.name!=='@redwakame-skill/cmcp-time'||pkg.version!==index.version)fail('cmcp_update_package_identity_invalid');
    return {root,indexBytes,entries,version:index.version};
  }
  async function stage(t,input){
    const source=await packageIndex(input.packageRoot,input.expectedPackageIndexHash),releaseRoot=path.join(t.deploymentRoot,'.cmcp-releases',input.expectedPackageIndexHash),product=path.join(releaseRoot,'product');
    try{await io.lstat(releaseRoot);fail('cmcp_update_release_target_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
    await newParent(path.join(product,'placeholder'));
    for(const entry of source.entries){const target=path.join(product,...entry.path.split('/'));await newParent(target);await io.writeFile(target,entry.content,{flag:'wx'});}
    await io.writeFile(path.join(product,'PUBLIC-FILES.json'),source.indexBytes,{flag:'wx'});
    await packageIndex(product,input.expectedPackageIndexHash);
    return {product,releaseRoot,packageIndexSha256:input.expectedPackageIndexHash,packageVersion:source.version,files:source.entries.length};
  }
  async function verifyStaged(t,origin){
    if(!inside(t.deploymentRoot,origin.releaseRoot)||!equalPath(path.join(origin.releaseRoot,'product'),origin.product))fail('cmcp_update_release_identity_invalid');
    return packageIndex(origin.product,origin.packageIndexSha256);
  }
  async function currentDeployment(t,current,deployed){
    const staged=current.origin?.packageIndexSha256;
    if(staged)await verifyStaged(t,current.origin);
    const moduleUrl=staged?pathToFileURL(path.join(current.origin.product,'adapters/deepseek-harness/native-desktop/host.mjs')).href:deployed.identity.host;
    const options=staged?{...deployed.options,skillPath:path.join(current.origin.product,'adapters/deepseek-harness/native-desktop/SKILL.md')}:deployed.options;
    if(current.fragment!==encodeFragment(moduleUrl,options))fail('cmcp_update_current_options_drift');
  }
  async function upgrade(input){return prepare(input,async(t,before,deployed,current)=>{
    if(!current||!managed(before,current))fail('cmcp_update_managed_registration_required');
    await currentDeployment(t,current,deployed);
    const staged=await stage(t,input),host=path.join(staged.product,'adapters/deepseek-harness/native-desktop/host.mjs'),options={...deployed.options,skillPath:path.join(staged.product,'adapters/deepseek-harness/native-desktop/SKILL.md')};
    const owned=encodeFragment(pathToFileURL(host).href,options),outside=before.replace(current.fragment,''),after=before.replace(current.fragment,owned);
    const next=record(t,outside,after,owned,{kind:'verified-package-upgrade',...staged,deploymentSha256:deployed.sha256,previousFragmentSha256:current.fragmentSha256});
    return transition(t,{action:'upgrade',before,oldFragment:current.fragment,newFragment:owned,beforeRecord:current,afterRecord:next,details:{...staged}});
  });}
  async function readTransaction(t,file){
    const target=await canonical(file,'file');if(!inside(t.archive,target)&&target!==t.pending)fail('cmcp_update_transaction_outside_scope');
    let tx;try{tx=JSON.parse(await text(target));}catch{fail('cmcp_update_transaction_invalid');}
    if(!validSeal(tx)||tx.kind!=='cmcp_desktop_update_transaction'||tx.version!==1||stable(tx.profileIdentity)!==stable(t.profileIdentity)||tx.deploymentRoot!==t.deploymentRoot||typeof tx.beforeFragment!=='string'||typeof tx.afterFragment!=='string')fail('cmcp_update_transaction_invalid');
    return tx;
  }
  async function rollback(input){return prepare(input,async(t,before,deployed,current)=>{
    const tx=await readTransaction(t,input.transactionPath);
    if(tx.afterReceipt!==null&&stable(JSON.parse(tx.afterReceipt))!==stable(current))fail('cmcp_update_rollback_version_conflict');
    if(tx.afterReceipt===null&&current)fail('cmcp_update_rollback_version_conflict');
    if(tx.afterFragment&&!managed(before,{fragment:tx.afterFragment}))fail('cmcp_update_owned_fragment_drift');
    if(!tx.afterFragment&&hasOwner(before))fail('cmcp_update_owned_fragment_drift');
    const next=tx.beforeReceipt===null?null:JSON.parse(tx.beforeReceipt);
    if(next?.origin?.packageIndexSha256)await verifyStaged(t,next.origin);
    return transition(t,{action:'rollback',before,oldFragment:tx.afterFragment,newFragment:tx.beforeFragment,beforeRecord:current,afterRecord:next,details:{reverses:tx.id}});
  });}
  async function recover(input){
    const t=await context(input);return lock(t,async()=>{
      const tx=await readTransaction(t,t.pending),before=await text(t.profile),deployed=await deployment(t);expect(input,before,deployed);
      if(hash(before)===tx.beforeProfileSha256){
        const current=await optional(t.receiptPath);if(tx.beforeReceipt===null?current!==null:!current||hash(current)!==hash(tx.beforeReceipt))fail('cmcp_update_recovery_conflict');
        await newParent(path.join(t.archive,'placeholder'));const preserved=path.join(t.archive,tx.id+'.aborted.json');await io.rename(t.pending,preserved);
        return {kind:'cmcp_desktop_update_recovery',state:'aborted-before-profile-write',transactionPath:preserved,historyRemoved:false,modelCalls:0};
      }
      // Only finish the exact already-committed profile. A drift is a visible conflict,
      // never an excuse to restore an entire saved profile.
      if(hash(before)!==tx.afterProfileSha256)fail('cmcp_update_recovery_conflict');
      await applyReceipt(t,tx);return finish(t,tx);
    });
  }
  return {inspect,adopt,upgrade,disable,enable,rollback,recover};
}

export const deploymentUpdater=createDeploymentUpdater();
