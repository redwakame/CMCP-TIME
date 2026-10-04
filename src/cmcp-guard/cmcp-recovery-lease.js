import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {isCmcpProcessAlive} from './cmcp-runtime-work.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function noAlias(file){
  for(let current=path.resolve(file);;current=path.dirname(current)){
    const stat=await fs.lstat(current).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
    if(stat?.isSymbolicLink()||stat?.isFile()&&stat.nlink!==1)throw Error('recovery_path_alias_denied');
    if(current===path.dirname(current))break;
  }
}
const identity=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
async function inspect(file){
  await noAlias(file);let stat;try{stat=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!stat.isFile()||stat.size>64)throw Error('writer_lock_identity_invalid');const bytes=await fs.readFile(file);
  const after=await fs.lstat(file);if(identity(stat)!==identity(after))throw Error('writer_lock_changed');
  return {identity:identity(stat),bytes,sha256:hash(bytes),ownerPid:Number(bytes.toString('utf8'))};
}
/** 正式恢復保存已退出擁有者的原鎖；不刪鎖、不接管活躍程序、不重做外部請求。 */
export async function acquireCmcpRecoveryLeases({lockFiles,expectedOwnerPid,onPreserved=async()=>{},processAlive=isCmcpProcessAlive}){
  if(!Array.isArray(lockFiles)||!lockFiles.length||new Set(lockFiles).size!==lockFiles.length||lockFiles.some(file=>!path.isAbsolute(file)||path.basename(file)!=='.common-input-writer.lock'))throw Error('recovery_lock_set_invalid');
  if(!Number.isSafeInteger(expectedOwnerPid)||expectedOwnerPid<1)throw Error('writer_lock_owner_not_confirmed_exited');
  if(processAlive(expectedOwnerPid))throw Error('writer_lock_owner_not_confirmed_exited');
  const guards=[],leases=[],preserved=[];
  const release=async()=>{for(const row of [...leases.splice(0).reverse(),...guards.splice(0).reverse()]){
    const owned=await row.handle.stat(),current=await fs.lstat(row.file).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));await row.handle.close();
    if(!current||current.dev!==owned.dev||current.ino!==owned.ino)throw Error('recovery_owned_lease_changed');await fs.unlink(row.file);
  }};
  try{
    for(const file of [...lockFiles].sort()){
      await noAlias(file);await fs.mkdir(path.dirname(file),{recursive:true});
      const guard=path.join(path.dirname(file),'.common-input-recovery.lock');let handle;
      try{handle=await fs.open(guard,'wx');}catch(error){if(error.code==='EEXIST')throw Error('writer_recovery_busy');throw error;}
      guards.push({file:guard,handle});await handle.writeFile(String(process.pid));await handle.sync();
    }
    const candidates=await Promise.all(lockFiles.map(inspect));
    if(candidates.some(row=>row&&row.ownerPid!==expectedOwnerPid)||processAlive(expectedOwnerPid))throw Error('writer_lock_owner_not_confirmed_exited');
    for(let index=0;index<lockFiles.length;index++){
      const file=lockFiles[index],prior=candidates[index];if(!prior)continue;
      const current=await inspect(file);if(!current||current.identity!==prior.identity||current.sha256!==prior.sha256||processAlive(expectedOwnerPid))throw Error('writer_lock_changed');
      const directory=path.join(path.dirname(file),'runtime-recovery','preserved-leases');await noAlias(directory);await fs.mkdir(directory,{recursive:true});
      const target=path.join(directory,randomUUID()+'-'+expectedOwnerPid+'.lock');
      await fs.rename(file,target);const moved=await inspect(target);
      if(!moved||moved.sha256!==prior.sha256||moved.ownerPid!==expectedOwnerPid)throw Error('writer_lock_preservation_mismatch');
      const row={originalPath:file,preservedPath:target,ownerPid:expectedOwnerPid,bytes:prior.bytes.length,sha256:prior.sha256,at:new Date().toISOString()};preserved.push(row);await onPreserved(row);
    }
    for(const file of lockFiles){const handle=await fs.open(file,'wx');leases.push({file,handle});await handle.writeFile(String(process.pid));await handle.sync();}
    return {preserved,release};
  }catch(error){await release();throw error;}
}
