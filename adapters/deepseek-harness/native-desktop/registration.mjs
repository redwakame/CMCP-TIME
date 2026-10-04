import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {replaceExistingFile} from './replace-file.mjs';

const OWNER='cmcp-desktop-native',VERSION=1;
const BEGIN='# cmcp-desktop-native registration v1 begin',END='# cmcp-desktop-native registration v1 end';
const digest=value=>createHash('sha256').update(value).digest('hex');
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const stable=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])):value);
const fail=code=>{throw Error(code);};
const stamp=record=>digest(stable(record));
const ownId=/(?:^|\n)[ \t]*(?:-[ \t]*)?id:[ \t]*(?:cmcp-desktop-native|"cmcp-desktop-native"|'cmcp-desktop-native')[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/u;
const ownsText=text=>ownId.test(text)||text.includes('# cmcp-desktop-native registration');
const meaningful=text=>text.split(/\r?\n/u).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
function normalize(text){
  const lines=meaningful(text);
  if(lines.length===1&&lines[0]==='[]'){
    const match=/^[ \t]*\[\][ \t]*\r?$/mu.exec(text),offset=match.index+match[0].indexOf('[]');
    return {text:text.slice(0,offset)+text.slice(offset+2),normalization:{offset,removed:'[]'}};
  }
  if(lines.length&&!lines[0].startsWith('- '))fail('cmcp_profile_patch_sequence_required');
  return {text,normalization:null};
}
function assertOptions(options){
  if(!options||typeof options!=='object'||Array.isArray(options))fail('cmcp_plugin_options_invalid');
  function visit(value){if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
    if(/(?:api.?key|password|secret|authorization|credential|access.?token|refresh.?token)|^token$/iu.test(key))fail('cmcp_registration_secret_field_refused');visit(child);
  }}visit(options);
}
const fragment=(moduleUrl,options)=>'\n'+BEGIN+'\n- insert:\n    - id: '+OWNER+'\n      name: '+JSON.stringify(moduleUrl)+'\n      config: '+JSON.stringify(options)+'\n'+END+'\n';

/** Owns one exact plugin fragment. It never restores a whole profile or edits History. */
export function createRegistrationManager({io=fs}={}){
  async function canonical(file,kind){
    if(typeof file!=='string'||!path.isAbsolute(file))fail('cmcp_explicit_absolute_path_required');
    const resolved=path.resolve(file),stat=await io.lstat(resolved);
    if(stat.isSymbolicLink()||!(kind==='directory'?stat.isDirectory():stat.isFile()))fail('cmcp_registration_path_kind_invalid');
    const real=await io.realpath(resolved);
    if(!samePath(resolved,real))fail('cmcp_registration_path_alias_refused');
    return real;
  }
  async function target(input){
    const profile=await canonical(input?.profile,'file'),deploymentRoot=await canonical(input?.deploymentRoot,'directory');
    if(path.basename(profile)!=='cordis.patch.yml')fail('cmcp_profile_identity_invalid');
    const parent=await canonical(path.dirname(profile),'directory');
    const receiptPath=input.receiptPath??path.join(deploymentRoot,'.cmcp-registration',digest(profile).slice(0,24)+'.json');
    const relative=path.relative(deploymentRoot,path.resolve(receiptPath));
    if(!path.isAbsolute(receiptPath)||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep)||samePath(path.resolve(receiptPath),profile))fail('cmcp_receipt_path_outside_deployment');
    let ancestor=path.dirname(path.resolve(receiptPath));
    for(;;){try{await canonical(ancestor,'directory');break;}catch(error){if(error.code!=='ENOENT')throw error;const next=path.dirname(ancestor);if(next===ancestor)throw error;ancestor=next;}}
    return {profile,deploymentRoot,receiptPath:path.resolve(receiptPath),profileIdentity:{path:profile,parent}};
  }
  async function snapshot(profile){
    const real=await canonical(profile,'file'),stat=await io.stat(real),bytes=await io.readFile(real);
    if(bytes.length>1024*1024||!Buffer.from(bytes.toString('utf8'),'utf8').equals(bytes))fail('cmcp_profile_encoding_or_size_invalid');
    return {bytes,text:bytes.toString('utf8'),sha256:digest(bytes),identity:[stat.dev,stat.ino,stat.size,stat.mtimeMs],mode:stat.mode};
  }
  async function receipt(target){
    try{await io.lstat(target.receiptPath+'.pending.json');fail('cmcp_update_recovery_required');}catch(error){if(error.code!=='ENOENT')throw error;}
    let bytes;try{await canonical(target.receiptPath,'file');bytes=await io.readFile(target.receiptPath);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    let record;try{record=JSON.parse(bytes);}catch{fail('cmcp_registration_receipt_invalid');}
    if(!record||typeof record!=='object'||Array.isArray(record))fail('cmcp_registration_receipt_invalid');
    const {integrity,...body}=record;
    if(integrity!==stamp(body)||record.kind!=='cmcp_desktop_registration'||record.version!==VERSION||record.fragmentVersion!==VERSION||record.owner!==OWNER
      ||stable(record.profileIdentity)!==stable(target.profileIdentity)||record.deploymentRoot!==target.deploymentRoot
      ||typeof record.fragment!=='string'||record.fragmentSha256!==digest(record.fragment)||!record.fragment.startsWith('\n'+BEGIN+'\n')||!record.fragment.endsWith(END+'\n')
      ||!(/^[a-f0-9]{64}$/u.test(record.beforeProfileSha256??''))||!(/^[a-f0-9]{64}$/u.test(record.normalizedBeforeSha256??''))||!(/^[a-f0-9]{64}$/u.test(record.afterProfileSha256??''))
      ||record.normalization!==null&&(!Number.isSafeInteger(record.normalization?.offset)||record.normalization.offset<0||record.normalization.removed!=='[]'))fail('cmcp_registration_receipt_mismatch');
    return record;
  }
  function position(text,record){
    if(!record)return ownsText(text)?'conflict':'unregistered';
    const index=text.indexOf(record.fragment);
    if(index<0)return ownsText(text)?'conflict':'unregistered';
    const rest=text.slice(0,index)+text.slice(index+record.fragment.length);
    return ownsText(rest)?'conflict':'registered';
  }
  const summary=(t,s,record,state,changed=false)=>({kind:'cmcp_desktop_registration_status',version:VERSION,state,changed,profile:t.profile,deploymentRoot:t.deploymentRoot,receiptPath:t.receiptPath,profileSha256:s.sha256,fragmentVersion:record?.fragmentVersion??null,fragmentSha256:record?.fragmentSha256??null,historyRemoved:false,packageRemoved:false,modelCalls:0});
  async function status(input){const t=await target(input),s=await snapshot(t.profile),record=await receipt(t);return summary(t,s,record,position(s.text,record));}
  async function withLock(t,work){
    const lockPath=t.profile+'.cmcp-registration.lock';let lock;
    try{lock=await io.open(lockPath,'wx');}catch(error){if(error.code==='EEXIST')fail('cmcp_registration_locked');throw error;}
    try{return await work();}finally{await lock.close();await io.unlink(lockPath);}
  }
  async function commit(t,before,after){
    const temporary=t.profile+'.cmcp-'+randomUUID()+'.tmp';let written=false,failure=null;
    try{
      const file=await io.open(temporary,'wx',before.mode);try{await file.writeFile(after);await file.sync();}finally{await file.close();}
      // Re-read the exact identity and preimage immediately before same-directory atomic replacement.
      const rechecked=await snapshot(t.profile);
      if(rechecked.sha256!==before.sha256||stable(rechecked.identity)!==stable(before.identity))fail('cmcp_profile_changed_before_write');
      await replaceExistingFile(temporary,t.profile,{io,expectedHash:before.sha256});written=true;
      const verified=await snapshot(t.profile);if(verified.sha256!==digest(after))fail('cmcp_profile_changed_after_write');return verified;
    }catch(error){failure=error;throw error;}
    finally{if(!written){
      // 失敗前像與準備檔保留，不以永久刪除掩蓋中斷。
      let prepared=null;try{const value=await io.readFile(temporary);prepared={bytes:value.length,sha256:digest(value)};}catch{}
      const code=/^[a-z][a-z0-9_]+$/u.test(failure?.message??'')?failure.message:/^[A-Z_]+$/u.test(failure?.code??'')?failure.code:'cmcp_registration_commit_failed';
      await io.writeFile(temporary+'.failure.json',JSON.stringify({kind:'cmcp_registration_failed_prepare',version:1,at:new Date().toISOString(),profile:t.profile,temporary,expectedProfileSha256:before.sha256,prepared,code,committed:false,removed:false},null,2)+'\n',{flag:'wx'}).catch(()=>{});
    }}
  }
  function expected(input,before){if(!/^[a-f0-9]{64}$/u.test(input.expectedProfileHash??'')||input.expectedProfileHash!==before.sha256)fail('cmcp_profile_preimage_mismatch');}
  async function register(input){
    const t=await target(input);return withLock(t,async()=>{
      const before=await snapshot(t.profile);expected(input,before);let record=await receipt(t);const state=position(before.text,record);
      if(state==='conflict')fail('cmcp_owned_registration_drift');
      const host=await canonical(path.join(t.deploymentRoot,'product/adapters/deepseek-harness/native-desktop/host.mjs'),'file');
      const optionsFile=await canonical(path.join(t.deploymentRoot,'plugin-options.json'),'file');
      const options=JSON.parse(await io.readFile(optionsFile,'utf8'));assertOptions(options);
      const owned=fragment(pathToFileURL(host).href,options);
      if(record&&record.fragment!==owned)fail('cmcp_registration_options_changed');
      if(state==='registered')return summary(t,before,record,state);
      const normalized=normalize(before.text),after=Buffer.from(normalized.text+owned);
      if(record&&!record.normalization&&normalized.normalization)fail('cmcp_registration_profile_baseline_changed');
      if(!record){
        const body={kind:'cmcp_desktop_registration',version:VERSION,owner:OWNER,fragmentVersion:VERSION,profileIdentity:t.profileIdentity,deploymentRoot:t.deploymentRoot,
          beforeProfileSha256:before.sha256,normalizedBeforeSha256:digest(normalized.text),afterProfileSha256:digest(after),normalization:normalized.normalization,fragment:owned,fragmentSha256:digest(owned)};
        record={...body,integrity:stamp(body)};
        await io.mkdir(path.dirname(t.receiptPath),{recursive:true});await canonical(path.dirname(t.receiptPath),'directory');
        const file=await io.open(t.receiptPath,'wx');try{await file.writeFile(JSON.stringify(record,null,2)+'\n');await file.sync();}finally{await file.close();}
      }
      const verified=await commit(t,before,after);return summary(t,verified,record,'registered',true);
    });
  }
  async function unregister(input){
    const t=await target(input);return withLock(t,async()=>{
      const before=await snapshot(t.profile);expected(input,before);const record=await receipt(t),state=position(before.text,record);
      if(state==='conflict'||state==='registered'&&!record)fail('cmcp_owned_registration_drift');
      if(state==='unregistered')return summary(t,before,record,state);
      let text=before.text.replace(record.fragment,'');
      if(record.normalization){
        if(digest(text)===record.normalizedBeforeSha256)text=text.slice(0,record.normalization.offset)+record.normalization.removed+text.slice(record.normalization.offset);
        else if(meaningful(text).length===0)text+='\n[]\n';
      }
      const verified=await commit(t,before,Buffer.from(text));return summary(t,verified,record,'unregistered',true);
    });
  }
  return {status,register,unregister};
}
const manager=createRegistrationManager();
export const status=manager.status;
export const register=manager.register;
export const unregister=manager.unregister;

/** Thin local CLI; intentionally has no implicit profile, deployment or installation action. */
export async function runRegistrationCli(args,write=line=>console.log(line)){
  const [requestedAction,...rest]=args,action=requestedAction==='update'?'upgrade':requestedAction;const updateActions=['inspect','adopt','upgrade','disable','enable','rollback','recover'];
  if(['help','--help'].includes(action)){
    if(rest.length)fail('cmcp_registration_arguments_invalid');
    const value={kind:'cmcp_desktop_registration_help',version:1,modelCalls:0,operations:{
      prepare:'在既有工作區建立新的 cmcp-desktop-native；先驗完整來源索引，不修改 profile 或授權 Session。',
      inspect:'唯讀辨識現有登錄、scope 與當前 profile／部署／舊片段雜湊。',
      status:'唯讀檢查 v1 自有 marker；舊無 marker 改用 inspect。',
      register:'在明示部署上追加新登錄；不接管未知同名項目。',
      adopt:'將已證明同源的舊獨立登錄轉成自有 marker；需三項前像雜湊。',
      upgrade:'驗證新套件 PUBLIC-FILES 後放入 .cmcp-releases，再只切換本套件登錄；update 為同義命令。',
      disable:'撤回本套件登錄，保留回執、部署、原文與媒體；作用範圍是這份 Desktop profile。',
      enable:'核對既有回執與部署後重新登錄；不恢復 Session 授權或主動開關。',
      unregister:'撤回完整自有 marker；保留套件、資料、其他外掛與使用者後加設定。',
      rollback:'用指定 transaction 還原上一個自有片段，保留其他設定；同欄位漂移拒絕。',
      recover:'中斷後只完成精確已提交狀態或保留並中止未提交準備；漂移需先查證。'
    },arguments:{prepare:'--workspace <既有工作區絕對路徑> --scope <明示範圍> --timezone <IANA 時區> --llm-module <官方 dsh-llm/lib/index.js 絕對路徑> --save-user yes|no --save-assistant yes|no',
      all:'prepare 以外的操作：--profile <cordis.patch.yml 絕對路徑> --deployment-root <部署絕對路徑>',
      writes:'--expected-profile-hash <inspect/status 回傳值>',lifecycleWrites:'--expected-deployment-hash <inspect 回傳值>',
      adopt:'--expected-legacy-hash <inspect 回傳值>',upgrade:'--package-root <解開或安裝後的套件根> --expected-package-index-hash <PUBLIC-FILES.json SHA-256>',
      rollback:'--transaction <前次操作回傳的 transactionPath>',optional:'--receipt <部署內的明示回執路徑>'},
      precautions:['修改登錄前先確認沒有使用者工作，正常退出 Desktop；完成後以原入口重新開啟。','本命令不強殺、重裝、刪 History、呼叫模型或接管未知登錄。','Windows 使用系統 PowerShell 的 File.Replace 保留既有 ACL；不提高權限。','登錄狀態是磁碟設定；不代表已開啟的 Desktop 即時載入或卸載。']};
    write(JSON.stringify(value,null,2));return value;
  }
  if(action==='prepare'){
    const names={'--workspace':'workspace','--scope':'scope','--timezone':'timezone','--llm-module':'llmModule','--save-user':'saveUser','--save-assistant':'saveAssistant'},input={};
    for(let i=0;i<rest.length;i+=2){const key=names[rest[i]],value=rest[i+1];if(!key||!value||value.startsWith('--')||Object.hasOwn(input,key))fail('cmcp_prepare_arguments_invalid');input[key]=value;}
    for(const key of ['saveUser','saveAssistant']){if(!['yes','no'].includes(input[key]))fail('cmcp_prepare_save_choice_required');input[key]=input[key]==='yes';}
    const value=await (await import('./prepare.mjs')).prepareDesktop(input);write(JSON.stringify(value));return value;
  }
  if(!['status','register','unregister',...updateActions].includes(action))fail('cmcp_registration_action_required');
  const names={'--profile':'profile','--deployment-root':'deploymentRoot','--expected-profile-hash':'expectedProfileHash','--receipt':'receiptPath',
    '--expected-deployment-hash':'expectedDeploymentHash','--expected-legacy-hash':'expectedLegacyHash','--package-root':'packageRoot','--expected-package-index-hash':'expectedPackageIndexHash','--transaction':'transactionPath'},input={};
  for(let i=0;i<rest.length;i+=2){const key=names[rest[i]],value=rest[i+1];if(!key||!value||value.startsWith('--')||Object.hasOwn(input,key))fail('cmcp_registration_arguments_invalid');input[key]=value;}
  const executor=updateActions.includes(action)?(await import('./deployment-update.mjs')).deploymentUpdater:manager;
  const value=await executor[action](input);write(JSON.stringify(value));return value;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{await runRegistrationCli(process.argv.slice(2));}catch(error){console.error(JSON.stringify({status:'ERROR',code:/^[a-z][a-z0-9_]+$/u.test(error.message??'')?error.message:/^[A-Z_]+$/u.test(error.code??'')?error.code:'cmcp_registration_failed'}));process.exitCode=1;}
}
