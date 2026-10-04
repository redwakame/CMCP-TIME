import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadProject,noAlias,within} from './config.mjs';
import {startSharedProjectServer} from '../shared-project/server.mjs';
import {callSharedProject} from '../shared-project/client.mjs';
import {runCodexTurn} from './codex-runner.mjs';
import {runHarnessTurn} from './harness-driver.mjs';

const safe=error=>/^[a-z][a-z0-9_]+$/.test(error?.message??'')?error.message:'project_entry_failed';
export async function createProjectController({configFile,onEvent=()=>{},load=loadProject,startBroker=startSharedProjectServer,call=callSharedProject,runners={codex:runCodexTurn,harness:runHarnessTurn}}){
  let loaded=await load(configFile),state='disabled',generation=0,broker=null,selected=null,opening=null,active=null,stopping=null,nativeResponder=null,closed=false,releaseUnconfirmed=false;
  const observerSession='cmcp-entry-'+randomUUID();
  const joinedObservers=new Set();let lastCodexSession=null;
  const summary=()=>({state,projectId:loaded.config.projectId,projectRoot:loaded.config.projectRoot,configFile:loaded.configFile,host:selected,workspace:selected?loaded.shared.hosts[selected].workspace:null,sessionId:active?.sessionId??null});
  const emit=event=>onEvent({...summary(),...event});
  async function dispatch(operation,args={},identity={}){
    const hostId=identity.hostId??selected??'harness',host=loaded.shared.hosts[hostId];
    return call({connection:{pipe:loaded.shared.pipe,authFile:host.controlAuthFile},role:'controller',request:{projectId:loaded.shared.projectId,hostId,agentId:host.agentId,workspace:host.workspace,sessionId:identity.sessionId??observerSession,requestId:randomUUID(),operation,args,...identity.epoch?{epoch:identity.epoch}:{}}});
  }
  async function status(){let shared=null,error=null;try{shared=await dispatch('status');}catch(caught){error=safe(caught);}const result={...summary(),shared,error,inspectionOnly:true};emit({event:'status',...result});return result;}
  async function enable(host){
    if(closed||state==='stopping'||stopping||opening||active)throw Error('project_entry_busy');if(!['harness','codex'].includes(host))throw Error('project_entry_host_required');
    const epoch=++generation;state='starting';selected=host;
    opening=(async()=>{
      // Revalidate paths and configuration on every activation; no retained session grant.
      if(!broker){const fresh=await load(configFile);if(generation!==epoch)throw Error('project_entry_stopped');loaded=fresh;
        const created=await startBroker({config:loaded.shared});if(generation!==epoch){await created.close();throw Error('project_entry_stopped');}broker=created;}
      if(!joinedObservers.has(host)){await dispatch('join',{}, {hostId:host});joinedObservers.add(host);}
      if(generation!==epoch)throw Error('project_entry_stopped');state='enabled';emit({event:'enabled'});return summary();
    })();
    try{return await opening;}catch(error){if(generation===epoch){if(broker){await broker.close();broker=null;}joinedObservers.clear();state='disabled';selected=null;}throw error;}finally{opening=null;}
  }
  function ask(text,{compact=false}={}){
    if(closed||state!=='enabled'||!broker||active)throw Error('project_entry_enable_required');
    if(typeof text!=='string'||(!compact&&!text.trim())||Buffer.byteLength(text)>524288)throw Error('project_entry_prompt_invalid');
    if(compact&&(selected!=='codex'||!lastCodexSession))throw Error('project_entry_compaction_session_required');
    const epoch=generation,host=selected,abort=new AbortController(),task={abort,sessionId:null,promise:null};active=task;state='running';
    task.promise=(async()=>{
      let receipt,runnerStarted=false;
      try{
        // A valid enabled controller never rewrites shared OFF/Clean to make a prompt run.
        const current=await dispatch('status');if(generation!==epoch||abort.signal.aborted)throw Error('project_entry_stopped');
        runnerStarted=true;receipt=await runners[host]({config:loaded.config,shared:loaded.shared,text,...compact?{compactBefore:true,resumeThreadId:lastCodexSession}:{},signal:abort.signal,setNativeResponder:handler=>{if(active===task)nativeResponder=handler;},onEvent:event=>{
          if(event.event==='new_session')task.sessionId=event.sessionId;
          if(generation!==epoch&&['answer','native_request','new_session','turn_saved'].includes(event.event))return;
          emit(event);
        }});
        if(receipt.releaseConfirmed!==true){releaseUnconfirmed=true;state='stopping';throw Error('project_entry_release_unconfirmed');}
        if(generation!==epoch||abort.signal.aborted)return {...receipt,successful:false,interrupted:true};
        if(receipt.successful!==true)throw Error(receipt.error??'project_entry_turn_failed');if(host==='codex')lastCodexSession=receipt.sessionId;emit({event:compact&&!text.trim()?'compaction_saved':'turn_saved',host,runRoot:receipt.runRoot??receipt.artifactRoot});return receipt;
      }catch(error){if(runnerStarted&&!receipt){releaseUnconfirmed=true;state='stopping';}throw error;
      }finally{if(active===task){active=null;nativeResponder=null;if(state==='running')state='enabled';}}
    })();return task.promise;
  }
  async function askFile(file){
    if(state!=='enabled'||!selected)throw Error('project_entry_enable_required');const epoch=generation,host=selected,full=path.resolve(file);
    if(!within(loaded.shared.hosts[host].workspace,full))throw Error('project_entry_prompt_outside_workspace');await noAlias(full);
    const text=await fs.readFile(full,'utf8');if(epoch!==generation||state!=='enabled'||host!==selected)throw Error('project_entry_stopped');return ask(text);
  }
  function respond(value){if(state!=='running'||!nativeResponder)throw Error('project_entry_no_native_request');if(!value||typeof value.requestId!=='string'||!Object.hasOwn(value,'result')||Object.keys(value).some(key=>!['requestId','result'].includes(key)))throw Error('project_entry_native_response_invalid');nativeResponder(value);}
  async function disable(){
    if(stopping)return stopping;if(closed)return summary();
    ++generation;state='stopping';active?.abort.abort();emit({event:'stopping'});
    stopping=(async()=>{
      if(opening)await opening.catch(()=>{});if(active)await active.promise.catch(()=>{});
      if(releaseUnconfirmed)throw Error('project_entry_release_unconfirmed');
      for(const hostId of joinedObservers){const current=await dispatch('status',{}, {hostId});await dispatch('revoke',{}, {hostId,epoch:current.epoch});joinedObservers.delete(hostId);}
      if(broker){await broker.close();broker=null;}
      state='disabled';selected=null;lastCodexSession=null;emit({event:'disabled',releaseConfirmed:true});return summary();
    })();
    try{return await stopping;}finally{stopping=null;}
  }
  async function close(){if(closed)return summary();await disable();closed=true;state='closed';emit({event:'closed',releaseConfirmed:true});return summary();}
  async function select(file){if(state!=='disabled'||broker||opening||active)throw Error('project_entry_disable_before_select');const next=await load(file);if(state!=='disabled')throw Error('project_entry_stopped');loaded=next;configFile=next.configFile;generation++;emit({event:'selected'});return summary();}
  // Shared control is intentionally supplied by the common controller contract, never parsed as a model tool.
  async function control(text){
    if(typeof text!=='string'||!text.trim())throw Error('project_entry_control_text_required');if(!broker||!selected||['starting','stopping','closed'].includes(state))throw Error('project_entry_enable_required');
    const identity={hostId:selected,sessionId:active?.sessionId??observerSession},epoch=generation,current=await dispatch('status',{},identity);
    if(epoch!==generation||['stopping','closed'].includes(state))throw Error('project_entry_stopped');
    const result=await dispatch('control',{text},{...identity,epoch:current.epoch});
    if(epoch!==generation||['stopping','closed'].includes(state))throw Error('project_entry_stopped');emit({event:'control',result});return result;
  }
  return {status,enable,ask,compact:(text='')=>ask(text,{compact:true}),askFile,respond,disable,close,select,control,get state(){return state;},get active(){return active?.promise??null;},get project(){return summary();}};
}
