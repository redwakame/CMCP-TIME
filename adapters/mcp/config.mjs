import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash,generateKeyPairSync} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {noAlias,writeNewJSON} from '../project-entry/config.mjs';
import {normalizeSharedProjectConfig,record,opaque} from '../shared-project/config.mjs';
import {validHostId,validatePipe} from '../shared-project/client.mjs';

export const readJSON=file=>fs.readFile(file,'utf8').then(JSON.parse);
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const safeError=e=>/^[a-z][a-z0-9_]{1,110}$/.test(e?.message)?e.message:'mcp_operation_failed';
export async function protect(directory){
  await fs.chmod(directory,0o700);
  if(process.platform==='win32'){
    const sid=execFileSync('powershell.exe',['-NoProfile','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',windowsHide:true}).trim();
    if(!/^S-1-\d+(?:-\d+)+$/.test(sid))throw Error('mcp_sid_unavailable');
    execFileSync('icacls.exe',[directory,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],{stdio:'pipe',windowsHide:true});
  }
}
export async function atomicJSON(file,value){const temp=file+'.'+randomBytes(8).toString('hex')+'.pending';await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await fs.rename(temp,file);}
export async function createMcpProject({root,projectId,hosts=['generic'],port=8766,timezone='UTC'},{protectDirectory=protect}={}){
  root=path.resolve(root);opaque(projectId);if(!Array.isArray(hosts)||!hosts.length||hosts.length>16||hosts.some(x=>!validHostId(x))||new Set(hosts).size!==hosts.length)throw Error('mcp_invalid_hosts');
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('mcp_invalid_port');new Intl.DateTimeFormat('en',{timeZone:timezone});await noAlias(root);
  await fs.mkdir(path.dirname(root),{recursive:true});await fs.mkdir(root);const privateRoot=path.join(root,'private');await fs.mkdir(privateRoot);await protectDirectory(privateRoot);
  const id=digest(root+'\0'+projectId).slice(0,32),pipe=process.platform==='win32'?'\\\\.\\pipe\\cmcp-'+id:path.join(privateRoot,'cmcp-broker.sock');validatePipe(pipe);
  const managementPipe=process.platform==='win32'?'\\\\.\\pipe\\cmcp-manage-'+id:path.join(privateRoot,'cmcp-manage.sock');validatePipe(managementPipe);
  const sharedHosts={};for(const hostId of hosts){const workspace=path.join(root,'workspaces',hostId);await fs.mkdir(workspace,{recursive:true});
    const controlAuthFile=path.join(privateRoot,hostId+'-controller.json'),readAuthFile=path.join(privateRoot,hostId+'-reader.json');
    for(const [role,file]of [['controller',controlAuthFile],['model_read',readAuthFile]])await writeNewJSON(file,{kind:'cmcp_shared_project_credential',version:1,projectId,hostId,role,token:randomBytes(32).toString('hex')});
    sharedHosts[hostId]={workspace,agentId:'cmcp-'+hostId,controlAuthFile,readAuthFile};}
  const runtimeConfig=path.join(root,'runtime.json'),sharedConfig=path.join(root,'shared-project.json');
  await writeNewJSON(runtimeConfig,{kind:'cmcp_runtime_config',version:1,runtimeId:projectId,providerMode:'host',input:{root:'state/history',scopeId:projectId,events:[],timezone,
    limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:128,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
    receiptRoot:'state/receipts',sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true},bufferRetention:{hours:12},discussionAssociation:{enabled:true}});
  await writeNewJSON(sharedConfig,{kind:'cmcp_shared_project_config',version:1,projectId,projectRoot:root,runtimeConfig,traceRoot:path.join(root,'state/trace'),pipe,lifetimeMs:43200000,hosts:sharedHosts,hostTurnPolicy:{timeoutMs:900000,maxTimeoutMs:1800000}});
  const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  await fs.writeFile(path.join(privateRoot,'issuer-private.pem'),keys.privateKey,{flag:'wx',mode:0o600});await fs.writeFile(path.join(privateRoot,'issuer-public.pem'),keys.publicKey,{flag:'wx',mode:0o600});
  await writeNewJSON(path.join(privateRoot,'read-grants.json'),{kind:'cmcp_mcp_read_grants',version:1,grants:[],revokedTokenIds:[]});
  await writeNewJSON(path.join(privateRoot,'management.json'),{token:randomBytes(32).toString('hex')});
  const config={kind:'cmcp_mcp_service',version:1,projectId,projectRoot:root,sharedConfig,managementPipe,managementAuthFile:path.join(privateRoot,'management.json'),stateFile:path.join(privateRoot,'service-state.json'),
    authorizationFile:path.join(privateRoot,'read-grants.json'),auth:{issuer:'urn:cmcp:local-issuer:'+id,audience:'http://127.0.0.1:'+port+'/mcp',publicKeyFile:path.join(privateRoot,'issuer-public.pem')},
    http:{host:'127.0.0.1',port,remote:false,allowedHosts:['127.0.0.1:'+port,'localhost:'+port],allowedOrigins:[],trustedProxy:false},limits:{requestBytes:65536,responseBytes:1048576,timeoutMs:15000,maxSessions:32,idleMs:300000}};
  const configFile=path.join(root,'mcp-service.json');await writeNewJSON(configFile,config);
  return {configFile,projectId,projectRoot:root,hosts,defaultAuthorization:'未加入；須由可信宿主或人類控制明確加入',modelCalls:0};
}
export async function loadMcpConfig(configFile){
  configFile=path.resolve(configFile);await noAlias(configFile);const config=await readJSON(configFile);
  record(config,['kind','version','projectId','projectRoot','sharedConfig','managementPipe','managementAuthFile','stateFile','authorizationFile','auth','http','limits']);
  if(config.kind!=='cmcp_mcp_service'||config.version!==1)throw Error('mcp_invalid_config');opaque(config.projectId);await noAlias(config.projectRoot);
  const root=await fs.realpath(config.projectRoot);if(root!==path.resolve(config.projectRoot))throw Error('mcp_project_alias_denied');
  record(config.auth,['issuer','audience','publicKeyFile']);record(config.http,['host','port','remote','allowedHosts','allowedOrigins','trustedProxy']);record(config.limits,['requestBytes','responseBytes','timeoutMs','maxSessions','idleMs']);
  for(const file of [config.sharedConfig,config.managementAuthFile,config.stateFile,config.authorizationFile,config.auth.publicKeyFile]){if(!path.isAbsolute(file))throw Error('mcp_absolute_path_required');const rel=path.relative(root,file);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('mcp_path_outside_project');await noAlias(file);}
  validatePipe(config.managementPipe);const shared=await normalizeSharedProjectConfig(await readJSON(config.sharedConfig));if(shared.projectId!==config.projectId||shared.projectRoot!==root)throw Error('mcp_project_binding_mismatch');
  if(!['127.0.0.1','::1'].includes(config.http.host)||!Number.isSafeInteger(config.http.port)||config.http.port<1||config.http.port>65535)throw Error('mcp_loopback_binding_required');
  for(const name of ['allowedHosts','allowedOrigins'])if(!Array.isArray(config.http[name])||config.http[name].length>32||config.http[name].some(x=>typeof x!=='string'||!x||x.length>2048))throw Error('mcp_invalid_http_allowlist');
  if(!config.http.allowedHosts.length)throw Error('mcp_host_allowlist_required');const audience=new URL(config.auth.audience);opaque(config.auth.issuer);
  if(audience.pathname!=='/mcp'||audience.search||audience.hash||audience.username||audience.password)throw Error('mcp_invalid_resource');
  if(config.http.remote===true){if(audience.protocol!=='https:'||config.http.trustedProxy!==true)throw Error('mcp_remote_tls_proxy_required');}
  else if(config.http.remote!==false||config.http.trustedProxy!==false||audience.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(audience.hostname))throw Error('mcp_invalid_local_resource');
  for(const [key,min,max]of [['requestBytes',1024,1048576],['responseBytes',1024,4194304],['timeoutMs',10,120000],['maxSessions',1,128],['idleMs',100,1800000]])if(!Number.isSafeInteger(config.limits[key])||config.limits[key]<min||config.limits[key]>max)throw Error('mcp_invalid_limits');
  return {config,shared,configFile};
}
