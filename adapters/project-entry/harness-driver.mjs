import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {productRoot,writeNewJSON,noAlias} from './config.mjs';
import {callSharedProject} from '../shared-project/client.mjs';

const safe=error=>/^[a-z][a-z0-9_]+$/.test(error?.message??'')?error.message:'project_entry_harness_failed';
const textOf=message=>(message?.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('');
/** The installed SDK exposes initialize, session/prompt and shutdown. No invented cancel/approval RPC. */
export async function runHarnessTurn({config,shared,text,signal,onEvent=()=>{},spawnProcess=spawn,call=callSharedProject,sessionId='cmcp-session-'+randomUUID()}){
  const check=()=>{if(signal?.aborted)throw Error('project_entry_stopped');};check();
  const settings=config.hosts.harness,artifactRoot=path.join(config.evidenceRoot,'harness-'+randomUUID());await noAlias(artifactRoot);await fs.mkdir(artifactRoot,{recursive:true});await fs.mkdir(config.sdkHome,{recursive:true});check();
  const folder=path.join(productRoot,'adapters/deepseek-harness/shared-project'),host={kind:'cmcp_shared_harness_config',version:1,projectId:shared.projectId,hostId:'harness',agentId:shared.hosts.harness.agentId,profileName:config.profileName,workspaceRoot:shared.hosts.harness.workspace,artifactRoot,skillPath:path.join(folder,'SKILL.md'),sessionIds:[sessionId],route:settings.route,connection:{pipe:shared.pipe,controlAuthFile:shared.hosts.harness.controlAuthFile,readAuthFile:shared.hosts.harness.readAuthFile}};
  const preflightFile=path.join(artifactRoot,'credential-reference.json'),overlayPath=path.join(artifactRoot,'sdk-overlay.json');
  await writeNewJSON(overlayPath,[{id:'credentials',config:{path:settings.credentials.path,watch:false}},{id:'deepseek-account',disabled:true},{id:'llm-deepseek-account',disabled:true},{id:'sdk-jsonrpc-server',config:{maxTokensAsSuccess:false}},{insert:[{id:'cmcp-shared-harness',name:path.join(folder,'host.mjs'),config:host},{id:'cmcp-project-entry-preflight',name:path.join(productRoot,'adapters/project-entry/harness-preflight.mjs'),config:{outputFile:preflightFile,credentialRef:settings.credentials.reference}}]}]);
  const exists=await fs.access(path.join(config.sdkHome,'profiles',config.profileName,'package.json')).then(()=>true,()=>false);check();
  const args=['--expose-internals',settings.cli,'--profile',config.profileName,...exists?[]:['--from-default-profile','sdk'],'--patch',overlayPath];
  const child=spawnProcess(settings.executable,args,{cwd:host.workspaceRoot,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:config.sdkHome,DSH_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['pipe','pipe','pipe']});
  let counter=0,buffer='',exitResult=null,stderrBytes=0,tail=Promise.resolve(),turnEnd=null,shutdownTask=null,promptAttempted=false,protocolFailure=null,stopTask=null,stopFailure=null,stopRevoked=false;
  const stderrHash=createHash('sha256'),pending=new Map(),visible=[];
  const append=(file,row)=>{tail=tail.then(()=>fs.appendFile(path.join(artifactRoot,file),JSON.stringify(row)+'\n'));};
  const rejectPending=code=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error(code));}pending.clear();};
  const exited=new Promise(resolve=>{child.once('error',error=>{exitResult={code:null,error:error.code??'spawn_failed'};rejectPending('sdk_process_exited');resolve(exitResult);});child.once('close',(code,signal)=>{exitResult??={code,signal};rejectPending('sdk_process_exited');resolve(exitResult);});});
  child.stdin.on('error',()=>{});child.stderr.on('data',bytes=>{stderrBytes+=bytes.length;stderrHash.update(bytes);});child.stdout.setEncoding('utf8');
  const rpc=(method,params={},timeoutMs=30000)=>new Promise((resolve,reject)=>{if(exitResult)return reject(Error('sdk_process_exited'));const id=++counter,timer=setTimeout(()=>{pending.delete(id);reject(Error('sdk_rpc_timeout'));},timeoutMs);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  const shutdown=()=>shutdownTask??=(async()=>{if(exitResult)return;await rpc('shutdown',{},30000);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('sdk_process_close_unconfirmed')),30000);exited.then(value=>{clearTimeout(timer);resolve(value);});});})();
  const revokeOwned=async()=>{
    if(stopRevoked)return;
    const request={projectId:shared.projectId,hostId:'harness',agentId:host.agentId,workspace:host.workspaceRoot,sessionId};
    const send=(operation,epoch)=>call({connection:{pipe:shared.pipe,authFile:host.connection.controlAuthFile},role:'controller',request:{...request,requestId:randomUUID(),operation,args:{},...epoch?{epoch}:{}}});
    const status=await send('status');
    // This is the controller's current stop action, never a refresh of the host's old ticket.
    if(status.owner?.hostId!=='harness'||status.owner?.agentId!==host.agentId||status.owner?.sessionId!==sessionId)return;
    const result=await send('revoke',status.epoch);if(result.status!=='revoked')throw Error('sdk_stop_revoke_unconfirmed');stopRevoked=true;
  };
  const abort=()=>{stopTask??=(async()=>{try{await revokeOwned();}catch(error){stopFailure=safe(error);}finally{await shutdown();}})();void stopTask.catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.stdout.on('data',chunk=>{
    buffer+=chunk;if(Buffer.byteLength(buffer)>16*1024*1024){protocolFailure='sdk_frame_capacity_exceeded';rejectPending(protocolFailure);abort();return;}
    for(let newline;(newline=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;let frame;
      try{frame=JSON.parse(line);}catch{protocolFailure='sdk_stdout_not_jsonrpc';rejectPending(protocolFailure);abort();continue;}
      if(frame.id!==undefined&&frame.method){protocolFailure='harness_native_request_unsupported';onEvent({event:'native_request',host:'harness',method:frame.method,supported:false,notice:'目前官方 SDK 未提供原生核准回傳；未自動授權。'});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:frame.id,error:{code:-32601,message:protocolFailure}})+'\n');abort();continue;}
      if(frame.id!==undefined&&pending.has(frame.id)){const request=pending.get(frame.id);pending.delete(frame.id);clearTimeout(request.timer);frame.error?request.reject(Error('sdk_rpc_failed')):request.resolve(frame.result);continue;}
      if(frame.method!=='session.event'||frame.params?.sessionId!==sessionId)continue;
      const event=frame.params.event;if(event?.type==='assistant/message'&&event.data?.message?.role==='assistant'){
        const text=textOf(event.data.message);if(text.trim()){const row={sessionId,eventId:event.id??null,seq:event.seq??null,time:event.time,type:event.type,turn:event.data.turn,interrupted:!!event.data.interrupted,message:{id:event.data.message.id,role:'assistant',content:[{type:'text',text}]}};visible.push(row);append('visible-events.jsonl',row);}
      }else if(event?.type==='user/message'&&event.data?.source?.kind==='user')append('visible-events.jsonl',{sessionId,time:event.time,type:event.type,message:{id:event.data.id,role:'user',content:[{type:'text',text:textOf(event.data)}]}});
      else if(event?.type==='turn/end'){turnEnd={sessionId,time:event.time,turn:event.data.turn,reason:event.data.reason?.kind};append('lifecycle.jsonl',turnEnd);}
    }
  });
  let error=null,hostEvents=[];const receipt={kind:'cmcp_project_harness_turn',version:1,startedAt:new Date().toISOString(),sessionId,workspace:host.workspaceRoot,route:settings.route,artifactRoot,desktopProfileModified:false,credentialValuesExported:false};
  onEvent({event:'new_session',host:'harness',sessionId,workspace:host.workspaceRoot,runRoot:artifactRoot});
  try{
    await rpc('initialize',{cwd:host.workspaceRoot,...settings.route});check();
    const preflight=JSON.parse(await fs.readFile(preflightFile,'utf8'));if(!preflight.credentialConfigured||!preflight.hostCapabilityDependencyReady)throw Error('sdk_preflight_failed');check();
    promptAttempted=true;receipt.admission=await rpc('session/prompt',{sessionId,contentBlocks:[{type:'text',text}]});if(signal?.aborted)await revokeOwned();check();
    const deadline=Date.now()+config.turnDeadlineMs;
    while(!turnEnd){check();if(protocolFailure)throw Error(protocolFailure);if(exitResult)throw Error('sdk_process_exited');if(Date.now()>deadline)throw Error('sdk_turn_deadline_exceeded');await new Promise(resolve=>setTimeout(resolve,50));}
    if(turnEnd.reason!=='completed')throw Error('sdk_turn_not_completed');
  }catch(caught){error=safe(caught);}
  finally{
    try{if(stopTask)await stopTask;await shutdown();}catch(caught){error??=safe(caught);child.stdin.end();}
    signal?.removeEventListener('abort',abort);await tail;
    try{hostEvents=(await fs.readFile(path.join(artifactRoot,'host-events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(caught){if(promptAttempted)error??='sdk_host_receipt_missing';}
    const answers=visible.filter(row=>!row.interrupted),saved=hostEvents.filter(row=>row.kind==='assistant_saved');
    const released=hostEvents.some(row=>['session_released','session_handoff_confirmed'].includes(row.kind));
    receipt.releaseConfirmed=exitResult?.code===0&&(!promptAttempted||released);receipt.turnSaved=hostEvents.some(row=>row.kind==='turn_saved');
    receipt.visibleAssistantMessages=answers.length;receipt.savedAssistantMessages=saved.length;
    receipt.observedModelRequests=hostEvents.filter(row=>row.kind==='model_request_metadata').length;receipt.modelRequestObservation='host_events_not_http_count';
    receipt.interrupted=!!signal?.aborted;receipt.exit=exitResult;receipt.stderr={bytes:stderrBytes,sha256:stderrHash.digest('hex'),retained:false};receipt.finishedAt=new Date().toISOString();
    receipt.stopGuard={revokedOwnedSession:stopRevoked,error:stopFailure};
    if(protocolFailure)error??=protocolFailure;if(!receipt.releaseConfirmed)error??='sdk_release_unconfirmed';
    if(!receipt.interrupted&&(!receipt.turnSaved||!answers.length||saved.length!==answers.length||hostEvents.some(row=>row.kind==='operation_failed')))error??='sdk_save_unconfirmed';
    receipt.error=error;receipt.successful=!error&&!receipt.interrupted;
    await writeNewJSON(path.join(artifactRoot,'receipt.json'),receipt);onEvent({event:'host_closed',host:'harness',sessionId,releaseConfirmed:receipt.releaseConfirmed,successful:receipt.successful,runRoot:artifactRoot});
    if(receipt.successful)for(const answer of answers)onEvent({event:'answer',host:'harness',sessionId,messageId:answer.message.id,receivedAt:answer.time,text:textOf(answer.message)});
  }
  return receipt;
}
