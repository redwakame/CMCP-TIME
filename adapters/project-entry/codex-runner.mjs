import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {runDriver} from './codex-driver.mjs';
import {writeNewJSON,noAlias} from './config.mjs';

export async function runCodexTurn({config,shared,text,signal,onEvent=()=>{},setNativeResponder=()=>{},driver=runDriver,resumeThreadId,compactBefore=false}){
  if(signal.aborted)return {successful:false,releaseConfirmed:true,interrupted:true};
  const runRoot=path.join(config.evidenceRoot,'codex-'+randomUUID());await noAlias(runRoot);await fs.mkdir(runRoot,{recursive:true});
  const files={};for(const role of ['controller','model_read']){const file=path.join(runRoot,role+'-binding.json');files[role]=file;const host=shared.hosts.codex;await writeNewJSON(file,{kind:'cmcp_codex_shared_binding',version:1,projectId:shared.projectId,hostId:'codex',agentId:host.agentId,workspace:host.workspace,role,connection:{pipe:shared.pipe,authFile:role==='controller'?host.controlAuthFile:host.readAuthFile}});}
  if(signal.aborted)return {successful:false,releaseConfirmed:true,interrupted:true};
  const settings={kind:'cmcp_codex_shared_driver',version:1,executable:config.hosts.codex.executable,workspace:shared.hosts.codex.workspace,controllerBinding:files.controller,readBinding:files.model_read,ticketFile:path.join(runRoot,'ticket.json'),evidenceRoot:runRoot};
  const input=new PassThrough();let completed=null,compaction=null,closed=null,error=null,sessionId=null,closing=false;
  const send=value=>{if(!input.writableEnded)input.write(JSON.stringify(value)+'\n');};
  const stop=()=>{closing=true;if(!input.writableEnded)input.end(JSON.stringify({command:'close'})+'\n');};
  signal.addEventListener('abort',stop,{once:true});setNativeResponder(({requestId,result})=>{if(signal.aborted||closing)throw Error('project_entry_stopping');send({command:'native-response',requestId,result});});
  const output={write(line){const event=JSON.parse(line);
    if(event.event==='ready'){sessionId=event.threadId;onEvent({event:'new_session',host:'codex',sessionId,workspace:settings.workspace,runRoot:event.runRoot});if(signal.aborted)stop();else send({command:'claim'});}
    if(event.event==='claimed'){if(signal.aborted)stop();else send(compactBefore?{command:'compact'}:{command:'turn',text});}
    if(event.event==='compaction_completed'){compaction=event;onEvent({...event,host:'codex',sessionId});if(!event.successful){error='project_entry_compaction_unconfirmed';stop();}else if(text.trim())send({command:'turn',text});else stop();}
    if(event.event==='turn_completed'){completed=event;stop();}
    if(['command_failed','failed'].includes(event.event)){error=event.code;stop();}
    if(event.event==='driver_closed')closed=event;
    if(['answer','native_request'].includes(event.event)&&!signal.aborted)onEvent(event);
  }};
  try{if(signal.aborted)stop();await driver({settings,input,output,signal,turnDeadlineMs:config.turnDeadlineMs,resumeThreadId});}
  catch(caught){error=/^[a-z0-9_]+$/.test(caught.message)?caught.message:'project_entry_codex_failed';}
  finally{signal.removeEventListener('abort',stop);setNativeResponder(null);input.destroy();}
  const receipt={kind:'cmcp_project_codex_turn',sessionId,runRoot,successful:!signal.aborted&&!error&&(compactBefore&&!text.trim()?compaction?.successful===true:completed?.successful===true)&&(!compactBefore||compaction?.successful===true)&&closed?.successful===true,compaction:compactBefore?compaction:null,releaseConfirmed:closed?.releaseConfirmed===true||closed?.releaseRequired===false,interrupted:signal.aborted,error};
  await writeNewJSON(path.join(runRoot,'receipt.json'),receipt);onEvent({event:'host_closed',host:'codex',...receipt});return receipt;
}
