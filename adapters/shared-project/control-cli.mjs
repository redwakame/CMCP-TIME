import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {callSharedProject} from './client.mjs';
// 這是使用者控制入口；模型僅持 model_read 角色，不能透過它改授權或交接。
const [configFile,hostId,sessionId,operation='status',targetHost,targetSession]=process.argv.slice(2);
if(!configFile||!['harness','codex'].includes(hostId)||!sessionId||!['status','join','claim','revoke','handoff'].includes(operation))throw Error('用法：設定 host Session status|join|claim|revoke|handoff [目標host 目標Session]');
const config=JSON.parse(await fs.readFile(configFile,'utf8')),host=config.hosts[hostId];
const connection={pipe:config.pipe,authFile:host.controlAuthFile},identity={projectId:config.projectId,hostId,agentId:host.agentId,workspace:path.resolve(host.workspace),sessionId};
const call=(op,args={},epoch)=>callSharedProject({connection,role:'controller',request:{...identity,requestId:randomUUID(),operation:op,args,...(epoch?{epoch}:{})}});
const current=await call('status');let result=current;
if(operation==='handoff'){
 const next=config.hosts[targetHost];if(!next||!targetSession)throw Error('須指定已加入的目標 host 與 Session');
 result=await call('handoff',{target:{hostId:targetHost,agentId:next.agentId,workspace:path.resolve(next.workspace),sessionId:targetSession}},current.epoch);
}else if(operation!=='status')result=await call(operation,{},current.epoch);
console.log(JSON.stringify({at:new Date().toISOString(),hostId,sessionId,projectId:config.projectId,workspace:host.workspace,operation,result},null,2));
