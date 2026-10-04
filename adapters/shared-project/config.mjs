import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeCmcpRuntimeConfig} from '../../src/cmcp-guard/cmcp-runtime-session.js';
import {validatePipe,validHostId} from './client.mjs';

export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const copy=value=>structuredClone(value);
export function record(value,allowed,required=allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))throw Error('shared_project_invalid_schema');}
export function opaque(value){if(typeof value!=='string'||!value||Buffer.byteLength(value)>1024||/[\x00-\x1f\x7f]/.test(value)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))throw Error('shared_project_invalid_id');return value;}
export function qualifiedSession(config,identity){return 'shared-session-'+hash([config.projectId,identity.hostId,identity.agentId,identity.sessionId]);}
export function sourceIdentity(config,identity,args,role){
  const origin={projectId:config.projectId,hostId:identity.hostId,agentId:identity.agentId,sessionId:opaque(identity.sessionId),messageId:opaque(args.messageId),revisionId:opaque(args.revisionId??'r1'),role};
  const messageId='shared-message-'+hash(origin);return {origin,messageId,sessionId:qualifiedSession(config,identity)};
}
async function inside(root,value,{exists=true}={}){
  if(typeof value!=='string'||!path.isAbsolute(value))throw Error('shared_project_absolute_path_required');
  const full=path.resolve(value),rel=path.relative(root,full);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('shared_project_path_outside_root');
  let actual;
  try{actual=await fs.realpath(full);}catch(error){if(exists||error.code!=='ENOENT')throw error;let parent=path.dirname(full),suffix=path.basename(full);
    while(true){try{actual=path.join(await fs.realpath(parent),suffix);break;}catch(next){if(next.code!=='ENOENT')throw next;suffix=path.join(path.basename(parent),suffix);parent=path.dirname(parent);}}}
  const realRel=path.relative(root,actual);if(!realRel||realRel.startsWith('..')||path.isAbsolute(realRel))throw Error('shared_project_path_outside_root');return actual;
}
export async function normalizeSharedProjectConfig(input){
  record(input,['kind','version','projectId','projectRoot','runtimeConfig','traceRoot','pipe','lifetimeMs','hosts','hostTurnPolicy'],['kind','version','projectId','projectRoot','runtimeConfig','traceRoot','pipe','lifetimeMs','hosts']);
  if(input.kind!=='cmcp_shared_project_config'||input.version!==1||!Number.isSafeInteger(input.lifetimeMs)||input.lifetimeMs<1000||input.lifetimeMs>43200000)throw Error('shared_project_invalid_config');
  opaque(input.projectId);validatePipe(input.pipe);
  if(typeof input.projectRoot!=='string'||!path.isAbsolute(input.projectRoot))throw Error('shared_project_absolute_path_required');
  const projectRoot=await fs.realpath(input.projectRoot);record(input.hosts,Object.keys(input.hosts??{}));const hostIds=Object.keys(input.hosts);if(!hostIds.length||hostIds.length>16||hostIds.some(id=>!validHostId(id)))throw Error('shared_project_invalid_hosts');const hosts={};
  if(process.platform!=='win32'&&!input.pipe.startsWith('\\\\.\\pipe\\'))await inside(projectRoot,input.pipe,{exists:false});
  for(const hostId of hostIds){const h=input.hosts[hostId];record(h,['workspace','agentId','controlAuthFile','readAuthFile']);opaque(h.agentId);
    if(typeof h.workspace!=='string'||!path.isAbsolute(h.workspace))throw Error('shared_project_absolute_path_required');
    const workspace=await fs.realpath(h.workspace),relative=path.relative(projectRoot,workspace);if(relative.startsWith('..')||path.isAbsolute(relative)||path.resolve(h.workspace)!==workspace)throw Error('shared_project_workspace_mismatch');
    hosts[hostId]={workspace,agentId:h.agentId,controlAuthFile:await inside(projectRoot,h.controlAuthFile),readAuthFile:await inside(projectRoot,h.readAuthFile)};}
  const files=Object.values(hosts).flatMap(h=>[h.controlAuthFile,h.readAuthFile]);if(new Set(files).size!==2*hostIds.length)throw Error('shared_project_credential_files_must_differ');
  const runtimeConfig=await inside(projectRoot,input.runtimeConfig),traceRoot=await inside(projectRoot,input.traceRoot,{exists:false});
  const rawRuntime=JSON.parse(await fs.readFile(runtimeConfig,'utf8')),{config:runtime}=normalizeCmcpRuntimeConfig(rawRuntime,{repoRoot:projectRoot});
  if(runtime.providerMode!=='host')throw Error('shared_project_host_provider_required');
  await inside(projectRoot,runtime.input.root,{exists:false});await inside(projectRoot,runtime.receiptRoot,{exists:false});
  return {...copy(input),projectRoot,runtimeConfig,traceRoot,hosts,scopeId:runtime.input.scopeId,stateRoot:runtime.input.root,runtimeConfigHash:hash(rawRuntime)};
}
