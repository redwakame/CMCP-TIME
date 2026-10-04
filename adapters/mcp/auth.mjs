import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {importSPKI,importPKCS8,jwtVerify,SignJWT} from 'jose';
import {readJSON,atomicJSON,digest} from './config.mjs';
import {callSharedProject} from '../shared-project/client.mjs';

export const identityRequest=(shared,grant,operation,args={})=>({projectId:shared.projectId,hostId:grant.hostId,agentId:shared.hosts[grant.hostId]?.agentId,workspace:shared.hosts[grant.hostId]?.workspace,sessionId:grant.sessionId,epoch:grant.epoch,operation,args,requestId:randomUUID()});
export async function grantState(config){const value=await readJSON(config.authorizationFile);if(value?.kind!=='cmcp_mcp_read_grants'||value.version!==1||!Array.isArray(value.grants)||value.grants.length>256||!Array.isArray(value.revokedTokenIds))throw Error('mcp_authorization_invalid');return value;}
export async function resolveGrant(config,subject){const value=await grantState(config),grant=value.grants.find(g=>g.subject===subject);if(!grant||grant.state!=='active'||grant.projectId!==config.projectId||!Number.isFinite(grant.expiresAt)||grant.expiresAt<=Date.now())throw Error('mcp_read_grant_unavailable');return {grant,stamp:digest(grant),revokedTokenIds:value.revokedTokenIds};}
export async function createJwtVerifier(config){const pem=await fs.readFile(config.auth.publicKeyFile,'utf8'),key=await importSPKI(pem,'RS256');return async token=>{
  if(typeof token!=='string'||token.length>8192)throw Error('mcp_invalid_token');let payload;
  try{({payload}=await jwtVerify(token,key,{issuer:config.auth.issuer,audience:config.auth.audience,algorithms:['RS256'],requiredClaims:['exp','iat','jti','sub'],maxTokenAge:'1h',clockTolerance:0}));}catch{throw Error('mcp_invalid_token');}
  if(payload.aud!==config.auth.audience)throw Error('mcp_audience_mismatch');
  if(typeof payload.sub!=='string'||typeof payload.jti!=='string'||typeof payload.scope!=='string'||!payload.scope.split(' ').includes('cmcp:read'))throw Error('mcp_scope_forbidden');
  const resolved=await resolveGrant(config,payload.sub);if(payload.grantStamp!==resolved.stamp||payload.projectId!==config.projectId)throw Error('mcp_token_grant_mismatch');if(resolved.revokedTokenIds.includes(payload.jti))throw Error('mcp_token_revoked');return {...resolved,subject:payload.sub,jti:payload.jti,expiresAt:payload.exp*1000};
};}
export async function authorizeReader({config,shared,hostId,sessionId,subject,ttlSeconds=900}){
  if(!shared.hosts[hostId]||typeof sessionId!=='string'||!sessionId||typeof subject!=='string'||!subject||subject.length>128||!Number.isSafeInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>3600)throw Error('mcp_invalid_reader_binding');
  const identity={hostId,sessionId},status=await callSharedProject({connection:{pipe:shared.pipe,authFile:shared.hosts[hostId].controlAuthFile},role:'controller',request:identityRequest(shared,identity,'status')});
  if(!status.joined||!status.activeTurn||status.owner?.hostId!==hostId||status.owner?.sessionId!==sessionId||status.owner?.agentId!==shared.hosts[hostId].agentId)throw Error('mcp_active_authorized_host_turn_required');
  const value=await grantState(config),grant={subject,projectId:config.projectId,hostId,sessionId,epoch:status.epoch,activeTurnId:status.activeTurnId,expiresAt:Date.now()+ttlSeconds*1000,state:'active',generation:randomUUID()};
  const existing=value.grants.findIndex(g=>g.subject===subject);if(existing>=0)value.grants[existing]=grant;else{if(value.grants.length>=256)throw Error('mcp_grant_capacity');value.grants.push(grant);}await atomicJSON(config.authorizationFile,value);
  const key=await importPKCS8(await fs.readFile(path.join(config.projectRoot,'private/issuer-private.pem'),'utf8'),'RS256');const token=await new SignJWT({scope:'cmcp:read',grantStamp:digest(grant),projectId:config.projectId}).setProtectedHeader({alg:'RS256',typ:'JWT'}).setSubject(subject).setIssuer(config.auth.issuer).setAudience(config.auth.audience).setIssuedAt().setExpirationTime(Math.floor(grant.expiresAt/1000)).setJti(randomUUID()).sign(key);
  const name=digest(subject).slice(0,24)+'-'+grant.generation,tokenFile=path.join(config.projectRoot,'private',name+'.token'),bindingFile=path.join(config.projectRoot,'private',name+'.binding.json');
  await fs.writeFile(tokenFile,token,{flag:'wx',mode:0o600});await fs.writeFile(bindingFile,JSON.stringify({kind:'cmcp_mcp_stdio_binding',version:1,configFile:path.join(config.projectRoot,'mcp-service.json'),subject,grantStamp:digest(grant)},null,2)+'\n',{flag:'wx',mode:0o600});
  return {subject,hostId,sessionId,expiresAt:new Date(grant.expiresAt).toISOString(),tokenFile,bindingFile,modelCalls:0};
}
export async function revokeReader(config,subject){const state=await grantState(config),grant=state.grants.find(g=>g.subject===subject);if(!grant)throw Error('mcp_read_grant_unavailable');grant.state='revoked';grant.generation=randomUUID();await atomicJSON(config.authorizationFile,state);return {status:'revoked',subject,modelCalls:0};}
