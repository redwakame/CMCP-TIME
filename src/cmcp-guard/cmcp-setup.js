import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {defaultPlaygroundConfig,playgroundReadingLimits,playgroundPath} from './cmcp-playground.js';
import {normalizeCmcpRuntimeConfig,createCmcpRuntimeSession} from './cmcp-runtime-session.js';
import {CMCP_FEATURE_CONTROL_DEFAULTS,normalizeCmcpFeatureControlPatch} from './cmcp-feature-controls.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const exists=async file=>fs.access(file).then(()=>true,()=>false);
const bool=(value,name)=>{if(typeof value!=='boolean')throw Error('explicit_setup_choice_required:'+name);return value;};
const str=(value,name)=>{if(typeof value!=='string'||!value.trim()||value.length>256||/[\x00-\x1f]/u.test(value))throw Error('invalid_setup_'+name);return value.trim();};
const within=async(root,value)=>playgroundPath(root,value);

/** Inspection never authenticates, installs, opens a model thread or reads credentials. */
export function inspectCmcpSetupEnvironment({nodeVersion=process.versions.node,probe=spawnSync}={}){
  const major=Number(nodeVersion.split('.')[0]);
  if(!Number.isSafeInteger(major)||major<18)throw Error('node_18_or_newer_required');
  const command=process.platform==='win32'?'cmd.exe':'codex';
  const args=process.platform==='win32'?['/d','/s','/c','codex.cmd --version']:['--version'];
  const result=probe(command,args,{encoding:'utf8',windowsHide:true,timeout:5000});
  const version=/codex-cli\s+([^\s]+)/.exec(result.stdout??'')?.[1]??null;
  return {node:nodeVersion,nodeSupported:true,codex:{available:result.status===0&&version!==null,version},
    authorizationChecked:false,modelCalls:0,adminRequired:false};
}

export function normalizeCmcpSetupChoices(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('explicit_setup_choices_required');
  const timezone=str(value.timezone,'timezone');
  try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format(0);}catch{throw Error('invalid_setup_timezone');}
  const language=value.language===undefined?'en':str(value.language,'language');
  const skillName=value.skillName??'cmcp-context';
  if(typeof skillName!=='string'||!/^cmcp-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skillName)||skillName.length>64)throw Error('invalid_setup_skill_name');
  const bufferHours=value.bufferHours??12;
  if(!Number.isFinite(bufferHours)||bufferHours<6||bufferHours>48)throw Error('invalid_setup_buffer_hours');
  const people=value.people??[];
  if(!Array.isArray(people)||people.length>32||people.some(p=>!p||typeof p.id!=='string'||typeof p.label!=='string')
    ||new Set(people.map(p=>p.id)).size!==people.length)throw Error('invalid_setup_people');
  const providerMode=value.providerMode??'host';
  if(!['host','configured'].includes(providerMode))throw Error('invalid_setup_provider_mode');
  const result={timezone,language,skillName,bufferHours,providerMode,scopeId:str(value.scopeId,'scope'),
    owner:{id:str(value.owner?.id,'owner_id'),label:str(value.owner?.label,'owner_label')},
    people:people.map(p=>({id:str(p.id,'person_id'),label:str(p.label,'person_label')})),
    saveUser:bool(value.saveUser,'saveUser'),saveAssistant:bool(value.saveAssistant,'saveAssistant'),
    enabled:bool(value.enabled,'enabled'),clean:bool(value.clean,'clean'),proactive:bool(value.proactive,'proactive'),
    attachCodex:bool(value.attachCodex,'attachCodex'),allowPaidCalls:bool(value.allowPaidCalls,'allowPaidCalls'),
    authorizedBy:str(value.authorizedBy,'authorization'),events:value.events??[]};
  if(result.proactive&&!value.proactiveConsent)throw Error('explicit_proactive_consent_required');
  if(result.allowPaidCalls&&!value.paidConsent)throw Error('explicit_paid_consent_required');
  if(result.providerMode==='configured'&&!result.allowPaidCalls)throw Error('configured_provider_requires_explicit_paid_consent_use_host_to_disable');
  if(!Array.isArray(result.events)||result.events.length>4)throw Error('invalid_setup_event_scope');
  result.featureControls={...structuredClone(CMCP_FEATURE_CONTROL_DEFAULTS),...normalizeCmcpFeatureControlPatch(value.featureControls??{}),
    enabled:result.enabled,clean:result.clean,saveUser:result.saveUser,saveAssistant:result.saveAssistant,proactive:result.proactive,
    bufferRetentionHours:result.bufferHours,timezone:result.timezone,language:result.language};
  return result;
}

function hookEntries(command){
  const handler={type:'command',command,commandWindows:command,timeout:30,statusMessage:'CMCP authorized time and source continuity',additionalContextLimit:1200};
  const {additionalContextLimit,...stop}=handler;
  return {UserPromptSubmit:[{hooks:[handler]}],Stop:[{hooks:[stop]}],SessionStart:[{matcher:'compact',hooks:[handler]}]};
}
function removeManagedHooks(document,commands){
  const output=structuredClone(document);
  for(const [event,groups]of Object.entries(output.hooks??{})){
    if(!Array.isArray(groups))throw Error('invalid_existing_hook_groups');
    output.hooks[event]=groups.map(group=>({...group,hooks:group.hooks.filter(h=>!commands.includes(h.command))})).filter(group=>group.hooks.length);
    if(!output.hooks[event].length)delete output.hooks[event];
  }
  return output;
}

/** One project-local setup transaction. Raw History and grant ledgers are never copied/reset/deleted. */
export async function configureCmcpInstallation({projectRoot,root,hostWorkspace,choices,action='setup',inspect=inspectCmcpSetupEnvironment}){
  if(!['setup','update','disable','uninstall'].includes(action))throw Error('invalid_setup_action');
  projectRoot=await fs.realpath(projectRoot);root=await within(projectRoot,root);
  const manifestFile=path.join(root,'installation.json'),previous=await exists(manifestFile)?JSON.parse(await fs.readFile(manifestFile,'utf8')):null;
  if(previous&&(previous.kind!=='cmcp_installation'||previous.version!==1||previous.projectRoot!==projectRoot))throw Error('installation_identity_mismatch');
  if(!previous&&action!=='setup')throw Error('installation_not_found');
  if(previous&&action==='setup')throw Error('installation_exists_use_update');
  const selected=choices?normalizeCmcpSetupChoices(choices):previous?.choices;
  if(!selected)throw Error('explicit_setup_choices_required');
  hostWorkspace=await within(projectRoot,hostWorkspace??previous?.hostWorkspace);
  if(previous&&(previous.hostWorkspace!==hostWorkspace||previous.choices.scopeId!==selected.scopeId))throw Error('installation_scope_or_workspace_change_requires_new_root');
  if(previous&&(previous.choices.skillName??'cmcp-context')!==(selected.skillName??'cmcp-context'))throw Error('installation_skill_name_change_requires_new_root');
  if(previous&&JSON.stringify(previous.choices.events)!==JSON.stringify(selected.events))throw Error('installation_event_scope_change_requires_new_root');
  const environment=inspect();
  if(['setup','update'].includes(action)&&selected.attachCodex&&!environment.codex.available)throw Error('codex_not_available');
  await fs.mkdir(root,{recursive:true});await fs.mkdir(hostWorkspace,{recursive:true});
  const configFile=path.join(root,'config.json'),profileFile=path.join(root,'playground.json'),bindingFile=path.join(root,'host-binding.json');
  const hookFile=path.join(hostWorkspace,'.codex','hooks.json'),skillDir=path.join(hostWorkspace,'.agents','skills',selected.skillName??'cmcp-context');
  const ownedSkillFiles=[path.join(skillDir,'SKILL.md'),path.join(skillDir,'scripts','recall.mjs')];
  for(const file of [configFile,profileFile,bindingFile,hookFile,...ownedSkillFiles])await within(projectRoot,file);
  const backup=path.join(root,'setup-history',new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());
  await fs.mkdir(backup,{recursive:true});
  const mutations=[];
  async function write(file,content){
    await within(projectRoot,file);const old=await fs.readFile(file).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
    if(old&&old.equals(Buffer.from(content)))return;
    if(old)await fs.writeFile(path.join(backup,digest(file)+'.before'),old,{flag:'wx'});
    await fs.mkdir(path.dirname(file),{recursive:true});
    const temp=file+'.cmcp-'+randomUUID();await fs.writeFile(temp,content,{flag:'wx'});await fs.rename(temp,file);
    mutations.push({file,priorHash:old?digest(old):null,hash:digest(content)});
  }
  const oldHooks=await exists(hookFile)?JSON.parse(await fs.readFile(hookFile,'utf8')):{hooks:{}};
  if(!oldHooks||typeof oldHooks!=='object'||Array.isArray(oldHooks)||oldHooks.hooks&&typeof oldHooks.hooks!=='object')throw Error('invalid_existing_hooks');
  const hooks=removeManagedHooks(oldHooks,previous?.managedCommands??[]);
  const installing=['setup','update'].includes(action)&&selected.attachCodex;
  const script=path.join(projectRoot,'scripts','cmcp-codex-hook.mjs');
  if(/["\r\n]/u.test(script+bindingFile))throw Error('unsupported_hook_command_path');
  const command=`node "${script}" --binding "${bindingFile}"`;
  if(installing){
    for(const [event,groups]of Object.entries(hookEntries(command)))(hooks.hooks[event]??=[]).push(...groups);
    for(const file of ownedSkillFiles){if(await exists(file)){
      const known=previous?.managedFiles?.find(row=>row.file===file),current=digest(await fs.readFile(file));
      if(!known||known.hash!==current)throw Error('existing_skill_not_owned_or_modified');
    }}
  }
  if(action==='uninstall')for(const row of previous.managedFiles??[]){
    if(ownedSkillFiles.includes(row.file)&&await exists(row.file)&&digest(await fs.readFile(row.file))!==row.hash)throw Error('modified_skill_retained_uninstall_conflict');
  }
  if(['setup','update'].includes(action)){
    let config=await exists(configFile)?JSON.parse(await fs.readFile(configFile,'utf8')):defaultPlaygroundConfig(root,{timezone:selected.timezone});
    if(!previous&&await exists(configFile))throw Error('existing_config_requires_explicit_import');
    config={...config,runtimeId:previous?.runtimeId??'cmcp-'+randomUUID(),providerMode:selected.providerMode,
      ...(!previous?{input:{...config.input,scopeId:selected.scopeId,events:selected.events,timezone:selected.timezone},
        controls:{...selected.featureControls},sourceAuthorization:{saveUser:selected.saveUser,saveAssistant:selected.saveAssistant},
        responsePreferences:{language:selected.language},bufferRetention:{hours:selected.bufferHours}}:{})};
    if(selected.providerMode==='host')delete config.credentialRef;
    else config.credentialRef??='.cmcp/deepseek-credential.json';
    normalizeCmcpRuntimeConfig(config,{repoRoot:projectRoot});
    await write(configFile,json(config));
    const session=await createCmcpRuntimeSession({config,repoRoot:projectRoot,controls:{proactive:false},
      readCredential:async()=>{throw Error('setup_never_reads_credentials');},fetchImpl:async()=>{throw Error('setup_never_calls_models');}});
    try{
      await session.authorizeSources({updateId:'setup-consent-'+randomUUID(),patch:{saveUser:selected.saveUser,saveAssistant:selected.saveAssistant},authorizedBy:selected.authorizedBy});
      await session.configureControls({updateId:'setup-'+randomUUID(),patch:selected.featureControls,persist:true});
    }finally{await session.close();}
    if(!await exists(profileFile))await write(profileFile,json({kind:'cmcp_playground_ui',version:1,topics:[{key:null,label:'General conversation'},...selected.events.map(e=>({key:e.key,label:e.label??e.key}))],readingLimits:playgroundReadingLimits}));
    const binding={kind:'cmcp_codex_binding',version:1,projectRoot,runtimeConfig:configFile,hostWorkspace,enabled:installing,
      authorization:{scopeId:selected.scopeId,authorizedBy:selected.authorizedBy},maxInputBytes:65536};
    await write(bindingFile,json(binding));
    if(installing){
      const skill=await fs.readFile(path.join(projectRoot,'.agents/skills/cmcp-context/SKILL.md'),'utf8');
      await write(ownedSkillFiles[0],skill.replace(/^name: cmcp-context$/m,'name: '+(selected.skillName??'cmcp-context')).replace('../../../docs/read-operations-v0.1.md',path.join(projectRoot,'docs/read-operations-v0.1.md').replaceAll('\\','/'))+`\nInstalled Runtime configuration: \`${configFile}\`.\nInstalled helper: \`${ownedSkillFiles[1]}\`.\n`);
      await write(ownedSkillFiles[1],`import ${JSON.stringify(pathToFileURL(path.join(projectRoot,'.agents/skills/cmcp-context/scripts/recall.mjs')).href)};\n`);
    }
    previous&&(previous.runtimeId=config.runtimeId);
  }else{
    if(await exists(bindingFile)){const binding=JSON.parse(await fs.readFile(bindingFile,'utf8'));await write(bindingFile,json({...binding,enabled:false}));}
    // Uninstall detaches only unchanged managed Skill files; user data and configuration remain.
    if(action==='uninstall')for(const row of previous.managedFiles??[]){
      if(!ownedSkillFiles.includes(row.file))continue;
      if(await exists(row.file)){
        if(digest(await fs.readFile(row.file))!==row.hash)throw Error('modified_skill_retained_uninstall_conflict');
        await fs.copyFile(row.file,path.join(backup,digest(row.file)+'.before'));await fs.unlink(row.file);mutations.push({file:row.file,removed:true});
      }
    }
  }
  if(installing||previous?.managedCommands?.length)await write(hookFile,json(hooks));
  const config=JSON.parse(await fs.readFile(configFile,'utf8'));
  const managedFiles=installing?await Promise.all(ownedSkillFiles.map(async file=>({file,hash:digest(await fs.readFile(file))}))):previous?.managedFiles??[];
  const result={kind:'cmcp_installation',version:1,projectRoot,root,hostWorkspace,runtimeId:config.runtimeId,choices:selected,
    state:installing?'enabled':action==='uninstall'?'uninstalled':'disabled',managedCommands:installing?[command]:[],managedFiles,
    environment,updatedAt:new Date().toISOString(),configFile,profileFile,bindingFile,backup,
    grantCreated:false,paidAuthorization:'separate_finite_runtime_grant_required',dataPreserved:true,modelCalls:0};
  if(action==='disable'||action==='uninstall')Object.assign(result,{disabledScope:'managed_codex_hook_binding',runtimeControlsUnchanged:true,
    manualSkill:action==='uninstall'?'removed_if_unchanged':'remains_available',grantPreserved:true});
  await write(manifestFile,json(result));await fs.writeFile(path.join(backup,'changes.json'),json(mutations),{flag:'wx'});
  return result;
}

export async function inspectCmcpInstallation({projectRoot,root}){
  root=await within(projectRoot,root);const saved=JSON.parse(await fs.readFile(path.join(root,'installation.json'),'utf8'));
  return {...saved,inspection:{modelCalls:0,mutated:false,environment:inspectCmcpSetupEnvironment()}};
}
