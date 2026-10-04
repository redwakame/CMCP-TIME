import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

/** Own one official stdio process. Never log raw wire, stderr, credentials or reasoning. */
export function createOfficialAppServer({executable,cwd,onNotification=async()=>{},onRequest=async()=>{throw Error('codex_shared_server_request_unhandled');},onClosed=()=>{},spawnProcess=spawn,closeTimeoutMs=30000}) {
  const child=spawnProcess(executable,['--no-daemon','app-server','--stdio'],{cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let counter=0,closed=false,stderrBytes=0,exitInfo=null,protocolFailure=null; const pending=new Map();
  const exited=new Promise(resolve=>child.once('close',(code,signal)=>{exitInfo={code,signal};resolve(exitInfo);onClosed(exitInfo);}));
  const send=value=>{if(closed)throw Error('codex_shared_app_server_closed');child.stdin.write(JSON.stringify(value)+'\n');};
  const rejectAll=()=>{closed=true;for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(Error('codex_shared_app_server_closed'));}pending.clear();};
  child.on('error',rejectAll); child.on('exit',rejectAll);
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;});
  child.stdin.on('error',()=>{});
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
  lines.on('line',line=>{
    if(Buffer.byteLength(line)>16*1024*1024){protocolFailure='codex_shared_frame_capacity_exceeded';rejectAll();child.stdin.end();onClosed({code:null,signal:null,error:protocolFailure,exitObserved:false});return;}
    let frame;try{frame=JSON.parse(line);}catch{return;}
    if(frame.id!==undefined && frame.method){
      Promise.resolve().then(()=>onRequest(frame.method,frame.params)).then(result=>send({id:frame.id,result}),()=>send({id:frame.id,error:{code:-32000,message:'codex_shared_request_denied'}})).catch(()=>{});return;
    }
    if(frame.id!==undefined){const entry=pending.get(frame.id);if(!entry)return;pending.delete(frame.id);clearTimeout(entry.timer);frame.error?entry.reject(Error('codex_shared_rpc_failed')):entry.resolve(frame.result);return;}
    if(frame.method)Promise.resolve().then(()=>onNotification(frame.method,frame.params)).catch(()=>{});
  });
  return {
    request(method,params,timeoutMs=30000){return new Promise((resolve,reject)=>{const requestId=++counter;const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('codex_shared_rpc_timeout'));},timeoutMs);pending.set(requestId,{resolve,reject,timer});try{send({id:requestId,method,params});}catch(error){pending.delete(requestId);clearTimeout(timer);reject(error);}});},
    notify(method,params){send({method,params});},
    async close(){
      if(!child.stdin.writableEnded)child.stdin.end();
      const waitExit=timeout=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('codex_shared_app_server_close_unconfirmed')),timeout);exited.then(value=>{clearTimeout(timer);resolve(value);},reject);});
      if(!exitInfo)await waitExit(closeTimeoutMs);
      lines.close();return {closed:true,stderrBytes,forcedOwnedProcessStop:false,exit:exitInfo,protocolFailure};
    }
  };
}
