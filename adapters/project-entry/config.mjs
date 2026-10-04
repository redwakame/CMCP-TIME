import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeSharedProjectConfig} from '../shared-project/config.mjs';

export const productRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const readJSON=file=>fs.readFile(file,'utf8').then(JSON.parse);
export const writeNewJSON=(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
export const within=(root,file)=>{const relative=path.relative(path.resolve(root),path.resolve(file));return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);};
export const fail=code=>{throw Error(code);};
export function shape(value,allowed,required=allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail('project_entry_invalid_config');}
export async function noAlias(file){
  if(typeof file!=='string'||!path.isAbsolute(file))fail('project_entry_absolute_path_required');
  for(let current=path.resolve(file);;current=path.dirname(current)){
    const stat=await fs.lstat(current).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
    if(stat?.isSymbolicLink())fail('project_entry_path_alias_denied');if(current===path.dirname(current))return;
  }
}
function string(value){if(typeof value!=='string'||!value.trim()||value.length>1024||/[\x00-\x1f]/.test(value))fail('project_entry_invalid_config');return value;}
function absolute(value){string(value);if(!path.isAbsolute(value))fail('project_entry_absolute_path_required');return path.resolve(value);}
export function validateRoutes(hosts){
  shape(hosts,['codex','harness']);shape(hosts.codex,['executable']);absolute(hosts.codex.executable);
  const h=hosts.harness;shape(h,['executable','cli','credentials','route']);absolute(h.executable);absolute(h.cli);
  shape(h.credentials,['path','reference']);absolute(h.credentials.path);if(!/^[A-Z][A-Z0-9_]+$/.test(h.credentials.reference))fail('project_entry_invalid_credential_reference');
  shape(h.route,['provider','model','reasoningEffort'],['provider','model']);string(h.route.provider);string(h.route.model);if(h.route.reasoningEffort!==undefined)string(h.route.reasoningEffort);
  return structuredClone(hosts);
}
async function protectPrivate(directory){
  await fs.chmod(directory,0o700);
  if(process.platform==='win32'){
    const sid=execFileSync('powershell.exe',['-NoProfile','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',windowsHide:true}).trim();
    if(!/^S-1-\d+(?:-\d+)+$/.test(sid))fail('project_entry_sid_unavailable');
    execFileSync('icacls.exe',[directory,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],{stdio:'pipe',windowsHide:true});
  }
}
/** Explicit creation only. Existing roots and provider credential bytes are never replaced or copied. */
export async function createProject(spec,{protect=protectPrivate}={}){
  shape(spec,['projectId','projectRoot','hosts','timezone','lifetimeMs','turnDeadlineMs'],['projectId','projectRoot','hosts']);
  const projectId=string(spec.projectId),projectRoot=absolute(spec.projectRoot),hosts=validateRoutes(spec.hosts);
  await noAlias(projectRoot);if(await fs.lstat(projectRoot).catch(error=>error.code==='ENOENT'?null:Promise.reject(error)))fail('project_entry_root_exists');
  const lifetimeMs=spec.lifetimeMs??7200000,turnDeadlineMs=spec.turnDeadlineMs??900000;
  if(!Number.isSafeInteger(lifetimeMs)||lifetimeMs<1000||lifetimeMs>43200000||!Number.isSafeInteger(turnDeadlineMs)||turnDeadlineMs<1000||turnDeadlineMs>1800000)fail('project_entry_invalid_deadline');
  const timezone=spec.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone;try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{fail('project_entry_invalid_timezone');}
  // mkdir is the exclusive claim. No catch-and-overwrite or deletion after partial setup.
  await fs.mkdir(path.dirname(projectRoot),{recursive:true});await fs.mkdir(projectRoot);
  const privateRoot=path.join(projectRoot,'private');await fs.mkdir(privateRoot);await protect(privateRoot);
  const sharedHosts={};
  for(const hostId of ['harness','codex']){
    const workspace=path.join(projectRoot,'workspaces',hostId);await fs.mkdir(workspace,{recursive:true});
    const controlAuthFile=path.join(privateRoot,hostId+'-controller.json'),readAuthFile=path.join(privateRoot,hostId+'-reader.json');
    for(const [role,file] of [['controller',controlAuthFile],['model_read',readAuthFile]])await writeNewJSON(file,{kind:'cmcp_shared_project_credential',version:1,projectId,hostId,role,token:randomBytes(32).toString('hex')});
    sharedHosts[hostId]={workspace,agentId:'cmcp-'+hostId+'-project',controlAuthFile,readAuthFile};
  }
  const pipe='\\\\.\\pipe\\cmcp-'+createHash('sha256').update(projectRoot+'\0'+projectId).digest('hex').slice(0,40);
  const runtimeConfig=path.join(projectRoot,'runtime.json'),sharedConfig=path.join(projectRoot,'shared-project.json');
  await writeNewJSON(runtimeConfig,{kind:'cmcp_runtime_config',version:1,runtimeId:projectId,providerMode:'host',input:{root:'state/history',scopeId:projectId,events:[],timezone,limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:'state/receipts',sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true},bufferRetention:{hours:12},discussionAssociation:{enabled:true}});
  const shared={kind:'cmcp_shared_project_config',version:1,projectId,projectRoot,runtimeConfig,traceRoot:path.join(projectRoot,'state/trace'),pipe,lifetimeMs,hosts:sharedHosts,hostTurnPolicy:{timeoutMs:turnDeadlineMs,maxTimeoutMs:1800000}};await writeNewJSON(sharedConfig,shared);
  const config={kind:'cmcp_project_entry',version:1,projectId,projectRoot,sharedConfig,evidenceRoot:path.join(projectRoot,'observations'),sdkHome:path.join(projectRoot,'sdk-home'),profileName:'cmcp-'+createHash('sha256').update(projectRoot).digest('hex').slice(0,24),turnDeadlineMs,hosts};
  await writeNewJSON(path.join(projectRoot,'entry.json'),config);
  const skill=path.join(projectRoot,'workspaces/codex/.agents/skills/cmcp-shared-history/SKILL.md');await fs.mkdir(path.dirname(skill),{recursive:true});await fs.writeFile(skill,await fs.readFile(path.join(productRoot,'adapters/codex/shared-project/skills/cmcp-shared-history/SKILL.md')),{flag:'wx'});
  return {configFile:path.join(projectRoot,'entry.json'),projectId,projectRoot,workspaces:Object.fromEntries(Object.entries(sharedHosts).map(([host,value])=>[host,value.workspace])),providerCredentialCopied:false,modelCalls:0};
}
export async function loadProject(configFile){
  configFile=absolute(configFile);await noAlias(configFile);const config=await readJSON(configFile);
  shape(config,['kind','version','projectId','projectRoot','sharedConfig','evidenceRoot','sdkHome','profileName','turnDeadlineMs','hosts']);
  if(config.kind!=='cmcp_project_entry'||config.version!==1||!Number.isSafeInteger(config.turnDeadlineMs)||config.turnDeadlineMs<1000||config.turnDeadlineMs>1800000)fail('project_entry_invalid_config');
  string(config.projectId);absolute(config.projectRoot);if(await fs.realpath(config.projectRoot)!==path.resolve(config.projectRoot))fail('project_entry_root_mismatch');
  for(const key of ['sharedConfig','evidenceRoot','sdkHome']){absolute(config[key]);if(!within(config.projectRoot,config[key]))fail('project_entry_path_outside_project');await noAlias(config[key]);}
  if(!/^[a-z0-9][a-z0-9-]{2,79}$/.test(config.profileName))fail('project_entry_invalid_profile');validateRoutes(config.hosts);
  const shared=await readJSON(config.sharedConfig),normalized=await normalizeSharedProjectConfig(shared);
  if(normalized.projectId!==config.projectId||normalized.projectRoot!==config.projectRoot)fail('project_entry_shared_binding_mismatch');
  return {config,shared,configFile};
}
/** Explicit directory only; no global registry or home-directory discovery. */
export async function listProjects(directory){
  await noAlias(absolute(directory));const entries=await fs.readdir(directory,{withFileTypes:true}),projects=[];
  for(const entry of entries){if(!entry.isDirectory()||entry.isSymbolicLink())continue;const file=path.join(directory,entry.name,'entry.json');
    try{const {config}=await loadProject(file);projects.push({projectId:config.projectId,projectRoot:config.projectRoot,configFile:file});}catch(error){if(error.code!=='ENOENT')projects.push({projectRoot:path.join(directory,entry.name),available:false});}}
  return projects;
}
