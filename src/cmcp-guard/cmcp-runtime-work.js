import fs from 'node:fs/promises';
import path from 'node:path';
import {createLocalLoopJournal,loopHash} from './cmcp-local-loop-journal.js';

export const isCmcpProcessAlive=pid=>{if(!Number.isSafeInteger(pid)||pid<1)throw Error('invalid_owner_pid');try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
const terminal=new Set(['completed','failed','cancelled','interrupted_unknown']);
/** Small execution receipts over the existing journal publisher; never marks source interpretation complete. */
export function createCmcpRuntimeWorkJournal({root,binding}){
  const base=path.join(root,'runtime-work');
  const directory=id=>{if(typeof id!=='string'||!id.trim()||id.length>160)throw Error('invalid_work_id');return path.join(base,loopHash(id));};
  const journal=id=>createLocalLoopJournal({root:path.join(directory(id),'events'),name:'cmcp-runtime-work-v1'});
  async function read(id){const rows=(await journal(id).read()).map(r=>r.record);if(!rows.length)return null;
    if(rows[0].kind!=='started'||rows[0].value.workId!==id||rows.some(r=>r.value.binding!==binding))throw Error('work_binding_mismatch');
    const initial=rows[0].value,last=rows.findLast(r=>r.kind==='terminal'),cancel=rows.find(r=>r.kind==='cancel_requested');
    return {...initial,state:last?.value.state??(cancel?'cancelling':'running'),source:rows.findLast(r=>r.kind==='source_bound')?.value.source??initial.source??null,
      queryBinding:rows.findLast(r=>r.kind==='query_bound')?.value.queryBinding??initial.queryBinding??null,
      cancelRequested:!!cancel,terminal:last?.value??null,sourceProcessing:last?.value.sourceProcessing??(initial.mode==='proactive'?'not_requested':'pending')};}
  async function mutate(id,fn){const dir=directory(id);await fs.mkdir(dir,{recursive:true});const lockPath=path.join(dir,'.transition.lock');let handle;
    const until=Date.now()+3000;while(!handle){try{handle=await fs.open(lockPath,'wx');}catch(e){if(e.code!=='EEXIST'||Date.now()>=until)throw e;await new Promise(r=>setTimeout(r,10));}}
    try{return await fn(await read(id),journal(id));}finally{await handle.close();await fs.unlink(lockPath);}}
  const value=(id,extra)=>({workId:id,binding,at:new Date().toISOString(),...extra});
  return Object.freeze({read,
    async list(){let entries;try{entries=await fs.readdir(base,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}const result=[];
      for(const entry of entries.filter(e=>e.isDirectory())){const j=createLocalLoopJournal({root:path.join(base,entry.name,'events'),name:'cmcp-runtime-work-v1'});const rows=await j.read();if(rows.length)result.push(await read(rows[0].record.value.workId));}return result;},
    async start(id,details){return mutate(id,async(existing,j)=>{if(existing)throw Error('work_id_already_exists');await j.append('started',value(id,{...details,ownerPid:process.pid}));return read(id);});},
    async bindSource(id,source){return mutate(id,async(w,j)=>{if(!w||w.state==='completed')throw Error('work_not_active');
      if(w.source&&JSON.stringify(w.source)!==JSON.stringify(source))throw Error('work_source_changed');if(!w.source)await j.append('source_bound',value(id,{source}));return read(id);});},
    async bindQuery(id,queryBinding){return mutate(id,async(w,j)=>{if(!w||w.state==='completed'||w.source)throw Error('work_query_not_active');
      if(w.queryBinding&&JSON.stringify(w.queryBinding)!==JSON.stringify(queryBinding))throw Error('work_query_changed');
      if(!w.queryBinding)await j.append('query_bound',value(id,{queryBinding}));return read(id);});},
    async cancel(id,reason='caller_cancelled'){return mutate(id,async(w,j)=>{if(!w)throw Error('work_not_found');if(terminal.has(w.state)||w.cancelRequested)return w;
      await j.append('cancel_requested',value(id,{reason,remoteOutcome:'unknown'}));return read(id);});},
    async finish(id,details){return mutate(id,async(w,j)=>{if(!w)throw Error('work_not_found');if(terminal.has(w.state))return w;
      if(!terminal.has(details.state))throw Error('invalid_work_terminal_state');
      const state=w.cancelRequested?'cancelled':details.state;
      await j.append('terminal',value(id,{...details,state,...(state==='cancelled'?{sourceProcessing:w.mode==='proactive'?'not_requested':'pending',remoteOutcome:'unknown',receiptPath:null}: {})}));return read(id);});},
    async recover(id,reason='owner_exited'){return mutate(id,async(w,j)=>{if(!w)throw Error('work_not_found');if(terminal.has(w.state))return w;
      if(isCmcpProcessAlive(w.ownerPid))throw Error('work_owner_still_alive');
      await j.append('terminal',value(id,{state:'interrupted_unknown',reason,remoteOutcome:'unknown',sourceProcessing:w.mode==='proactive'?'not_requested':'pending',receiptPath:null}));return read(id);});}
  });
}
