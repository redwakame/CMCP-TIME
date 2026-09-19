import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {validateLoopSchema} from '../src/cmcp-guard/cmcp-local-loop-protocol.js';
import {loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {codexHostPermissionsOverride} from './cmcp-codex-host-permissions.mjs';

/** Metadata-only lookup; never read/decrypt credential bytes when building a Host grant. */
export async function cmcpNativeCredentialReadGrant({repoRoot,referencePath}){
  const repo=path.resolve(repoRoot),reference=path.resolve(referencePath),privateRoot=path.join(repo,'.cmcp/private/credentials');
  if(reference!==path.join(repo,'.cmcp/deepseek-credential.json'))throw Error('project_credential_reference_required');
  const referenceStat=await fs.lstat(reference);if(referenceStat.isSymbolicLink()||!referenceStat.isFile())throw Error('regular_credential_reference_required');
  const data=JSON.parse(await fs.readFile(reference,'utf8'));
  if(data.version!==1||data.provider!=='deepseek'||data.protection!=='Windows_DPAPI_CurrentUser'||typeof data.path!=='string'||!path.isAbsolute(data.path))throw Error('invalid_credential_reference');
  const target=path.resolve(data.path),relative=path.relative(privateRoot,target);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('project_private_credential_required');
  let cursor=target;
  for(;;){const info=await fs.lstat(cursor);if(info.isSymbolicLink())throw Error('credential_reparse_path_rejected');
    if(cursor===target&&!info.isFile())throw Error('credential_ciphertext_file_required');
    const next=path.dirname(cursor);if(next===cursor)break;cursor=next;}
  return [target,'read'];
}

/** Shared CLI settings. Full access is an explicit launcher choice, never a Core default. */
export function cmcpNativeHostLaunch({root,temp,executionMode,grants,model,outputSchema}){
  if(!['sandbox','full-access'].includes(executionMode))throw Error('explicit_execution_mode_required');
  if(process.env.CMCP_HOST_TRIAL_WORKER)throw Error('recursive_native_job_rejected');
  const fullAccess=executionMode==='full-access',q=p=>JSON.stringify(p.replaceAll('\\','/'));
  const disabled=['apps','browser_use','browser_use_external','computer_use','hooks','image_generation','in_app_browser','memories',
    'multi_agent','multi_agent_v2','plugins','remote_plugin','recommended_plugins','shell_snapshot','skill_search','skill_mcp_dependency_install','sleep_tool','tool_suggest','view_image','workspace_dependencies','goals','unbounded_connection_retries'];
  const overrides=['model_reasoning_effort="low"','project_doc_max_bytes=0','project_doc_fallback_filenames=[]','skills.bundled.enabled=false',
    'features.skip_host_skill_discovery=false','skills.include_instructions=true','features.code_mode=true','features.code_mode_host=true','mcp_servers={}','notify=[]','developer_instructions=""','web_search="disabled"','include_apps_instructions=false',
    ...(fullAccess?[]:['default_permissions="cmcp_host_trial"','windows.sandbox="unelevated"','approval_policy="never"']),'history.persistence="none"',
    'check_for_update_on_startup=false','tool_output_token_limit=6000','log_dir='+q(path.join(root,'native-logs')),
    ...disabled.map(f=>'features.'+f+'=false'),...(fullAccess?[]:[codexHostPermissionsOverride(grants)])];
  const args=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--json','--color','never','--model',model,
    ...(fullAccess?['--dangerously-bypass-approvals-and-sandbox']:[]),'--output-schema',outputSchema,...overrides.flatMap(v=>['-c',v]),'-'];
  // PowerShell command discovery requires PATHEXT. Omitting it breaks a trusted
  // native hook before Node starts, even while explicit-executable probes pass.
  const env={};for(const name of ['SystemRoot','WINDIR','COMSPEC','PATH','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','USERNAME','USERDOMAIN','HOMEDRIVE','HOMEPATH','ProgramFiles','PSModulePath'])if(process.env[name])env[name]=process.env[name];
  env.TEMP=env.TMP=env.TMPDIR=temp;env.CMCP_HOST_TRIAL_WORKER='1';
  return {args,overrides,env};
}

export function unfinishedCmcpHostCommands(events){
  const active=new Map();
  for(const event of events){
    if(event.item?.type!=='command_execution')continue;
    if(event.type==='item.started')active.set(event.item.id,event.item);
    if(event.type==='item.completed')active.delete(event.item.id);
  }
  return [...active.values()];
}

function inspectOwnedHelper(pid,workId){
  if(!Number.isSafeInteger(pid)||pid<=0||!/^[-a-z0-9]+$/i.test(workId))return {status:'invalid_identity'};
  if(process.platform!=='win32')return {status:'unsupported_process_identity'};
  const code=`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){[pscustomobject]@{present=$true;command=$p.CommandLine}|ConvertTo-Json -Compress}else{'{"present":false}'}`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,encoding:'utf8',timeout:1500});
  if(result.status!==0)return {status:'process_identity_unknown'};
  try{const data=JSON.parse(result.stdout);return !data.present?{status:'absent'}:
    {status:typeof data.command==='string'&&data.command.includes(workId)&&data.command.includes('recall.mjs')?'owned':'identity_mismatch'};}
  catch{return {status:'process_identity_unknown'};}
}

/** Only close the helper identified by this invocation's immutable start evidence.
 * Runtime cancellation/abandonment is appended through its public controls. No source is resubmitted.
 */
export async function finishCmcpOwnedHostHelper({lifecycleFile,workId,deadlineAt,cancelWork,recoverWork,
  inspect=inspectOwnedHelper,kill=pid=>spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:1500}),
  pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  let records;try{const lines=(await fs.readFile(lifecycleFile,'utf8')).trim().split('\n').filter(Boolean);records=[];
    for(let i=0;i<lines.length;i++){try{records.push(JSON.parse(lines[i]));}catch(error){if(i!==lines.length-1)throw error;}}
  }
  catch(error){return {status:'unknown',reason:'helper_start_evidence_unavailable',code:error.code??error.message};}
  const started=records.find(row=>row.kind==='started');
  if(started?.workId!==workId||!Number.isSafeInteger(started.pid))return {status:'unknown',reason:'helper_start_identity_mismatch'};
  const terminal=records.findLast(row=>row.workId===workId&&(row.kind==='completed'||row.kind==='finished'));
  if(terminal)return {status:'finished',workId,pid:started.pid,terminal};
  const cancellation=await cancelWork({workId,reason:'host_finished_before_tool'});
  let identity=inspect(started.pid,workId),forced=false;
  const graceEnd=Math.min(Date.parse(deadlineAt)-1800,Date.now()+1200);
  while(identity.status==='owned'&&Date.now()<graceEnd){await pause(100);identity=inspect(started.pid,workId);}
  if(identity.status==='owned'&&Date.now()<Date.parse(deadlineAt)-1600){kill(started.pid);forced=true;await pause(50);identity=inspect(started.pid,workId);}
  const recovery=identity.status==='absent'?await recoverWork({workId,reason:'owner_process_exited'}):null;
  return {status:identity.status==='absent'?'closed':'unknown',workId,pid:started.pid,cancellation,recovery,forced,
    processStatus:identity.status,remoteResult:'unknown_unless_transport_result_recorded'};
}

/** Caller reserves its existing budget first. No retry or provider/credential access here.
 * onHostExit closes only this launcher's owned helper through the Runtime control API.
 * A late receipt cannot supply missing native tool output or turn an early final into success.
 */
export async function runCmcpNativeHostProcess({root,cli,args,cwd,env,input,start,model,reasoning='low',schema,timeoutMs=90000,maxRawBytes=131072,maxFinalBytes=16384,onHostExit,signal}){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>300000)throw Error('host_total_deadline_invalid');
  const write=(name,value)=>fs.writeFile(path.join(root,name),typeof value==='string'?value:JSON.stringify(value,null,2),{flag:'wx'});
  await write('codex-stdout.jsonl','');await write('codex-stderr.txt','');
  let raw='',stderr='',capped=false,timer,stopReason=null,spawnError=null,evidenceError=null,exitSignal=null,spawnedEvidence=Promise.resolve();
  const startedAt=new Date().toISOString(),deadlineAt=new Date(Date.now()+timeoutMs).toISOString();
  await write('native-before-spawn.json',{startedAt,deadlineAt,cwd,executable:cli,argv:args,start,
    evidenceScope:'launcher直接建立的程序；不代表模型內部shell工具參數或OS隔離'});
  const parseEvents=()=>raw.trim().split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return {type:'unparsed'};}});
  const errorRecord=error=>({code:error.code??null,message:error.message,syscall:error.syscall??null,path:error.path??null});
  let child;
  try{child=spawn(cli,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});}
  catch(error){spawnError=errorRecord(error);const native={start,startedAt,deadlineAt,endedAt:new Date().toISOString(),pid:null,exitCode:null,exitSignal:null,spawnError,evidenceError,
    capped:false,stopReason:'spawn_failed',threadId:null,usage:null,schema:false,finalWithinCap:false,rawHash:loopHash(raw),stderrHash:loopHash(stderr)};
    await write('codex-result.json',native);return {events:[],native};}
  const stop=reason=>{stopReason??=reason;capped ||= reason==='output_cap';
    if(child.pid&&child.exitCode===null&&child.signalCode===null){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:2000});else child.kill('SIGTERM');}};
  const collect=field=>data=>{try{appendFileSync(path.join(root,field==='raw'?'codex-stdout.jsonl':'codex-stderr.txt'),data);
    if(field==='raw')raw+=data;else stderr+=data;if(Buffer.byteLength(raw)+Buffer.byteLength(stderr)>maxRawBytes)stop('output_cap');}
    catch(error){evidenceError??=errorRecord(error);stop('evidence_write_failed');}};
  child.once('spawn',()=>{spawnedEvidence=write('native-spawned.json',{at:new Date().toISOString(),pid:child.pid,start}).catch(error=>{evidenceError=errorRecord(error);stop('evidence_write_failed');});});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',collect('raw'));child.stderr.on('data',collect('stderr'));
  const cancel=()=>stop('cancelled');signal?.addEventListener('abort',cancel,{once:true});
  child.stdin.on('error',()=>{});child.stdin.end(input);
  if(signal?.aborted)cancel();
  // Reserve a bounded cleanup interval inside the total deadline, not an extension of it.
  const cleanupMs=Math.min(5000,Math.floor(timeoutMs/4));timer=setTimeout(()=>stop('deadline'),timeoutMs-cleanupMs);
  const exitCode=await new Promise(resolve=>{child.once('error',error=>{spawnError=errorRecord(error);stopReason??='spawn_failed';resolve(null);});child.once('exit',(code,signal)=>{exitSignal=signal;resolve(code);});});
  await spawnedEvidence;
  const eventsAtExit=parseEvents(),unfinishedAtExit=unfinishedCmcpHostCommands(eventsAtExit);
  let helperCleanup=null;
  if(onHostExit){
    const remaining=Math.max(0,Date.parse(deadlineAt)-Date.now());let cleanupTimer;
    helperCleanup=await Promise.race([
      Promise.resolve().then(()=>onHostExit({pid:child.pid,exitCode,stopReason,unfinishedCommands:unfinishedAtExit,deadlineAt})).catch(error=>({status:'failed',reason:error.message})),
      new Promise(resolve=>{cleanupTimer=setTimeout(()=>resolve({status:'unknown',reason:'helper_cleanup_deadline'}),remaining);})
    ]);clearTimeout(cleanupTimer);
  }
  // Native exit may leave inherited stdout open in a descendant. Never wait forever for close.
  await new Promise(resolve=>setImmediate(resolve));
  clearTimeout(timer);signal?.removeEventListener('abort',cancel);
  child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
  const events=parseEvents();
  const final=events.findLast(e=>e.type==='item.completed'&&e.item?.type==='agent_message')?.item.text??null;let value;try{value=JSON.parse(final);}catch{}
  const native={start,startedAt,deadlineAt,pid:child.pid??null,exitCode,exitSignal,spawnError,evidenceError,capped,stopReason,unfinishedCommands:unfinishedAtExit,helperCleanup,
    endedAt:new Date().toISOString(),threadId:events.find(e=>e.type==='thread.started')?.thread_id??null,
    requestedModel:model,requestedReasoning:reasoning,actualModel:'unknown_unless_emitted',actualReasoning:'unknown_unless_emitted',internalRetries:'unknown_unless_emitted',
    usage:events.findLast(e=>e.type==='turn.completed')?.usage??null,final,value,schema:value?validateLoopSchema(value,schema):false,
    finalWithinCap:final!==null&&Buffer.byteLength(final)<=maxFinalBytes,rawHash:loopHash(raw),stderrHash:loopHash(stderr)};
  await write('codex-result.json',native);return {events,native};
}
