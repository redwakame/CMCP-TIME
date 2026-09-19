import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {spawn,spawnSync} from 'node:child_process';
import {loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {cancelCmcpRuntimeWork,recoverCmcpRuntimeWork} from '../src/cmcp-guard/cmcp-runtime-session.js';
import {finishCmcpOwnedHostHelper} from './cmcp-native-host-process.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url)),helper=fileURLToPath(new URL('../.agents/skills/cmcp-context/scripts/recall.mjs',import.meta.url));
const within=value=>{if(typeof value!=='string'||!value)throw Error('operation_repo_path_required');const target=path.resolve(repo,value),relative=path.relative(repo,target);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('operation_path_outside_repo');return target;};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/** 短命令的固定傳參；不讀 History／Event，也不直接呼叫模型。 */
export async function prepareCmcpHostOperation(argv){
  const {values:a}=parseArgs({args:argv,options:{request:{type:'string'},'local-read':{type:'string'},refs:{type:'string'},
    'continue-ref':{type:'string'},'range-start':{type:'string'},'range-end':{type:'string'}}});
  const requestFile=within(a.request),raw=await fs.readFile(requestFile,'utf8'),request=JSON.parse(raw);
  const allowed=new Set(['kind','version','stage','config','workId','candidateWorkId','lifecycleFile','deadlineAt','traceRoot','question','sourceId']);
  if(request.kind!=='cmcp_host_operation'||request.version!==1||!['candidates','read','continuation'].includes(request.stage)
    ||Object.keys(request).some(key=>!allowed.has(key))||!uuid(request.workId))throw Error('invalid_host_operation');
  const deadline=Date.parse(request.deadlineAt),remaining=deadline-Date.now();
  if(!Number.isFinite(deadline)||remaining<=0||remaining>300000)throw Error('invalid_host_operation_deadline');
  const configFile=within(request.config),lifecycleFile=within(request.lifecycleFile),traceRoot=within(request.traceRoot),args=[helper,'--config',configFile];
  if(request.stage==='candidates'){
    if(typeof request.question!=='string'||!request.question.trim()||Object.keys(a).some(key=>key!=='request')||request.candidateWorkId!==undefined)throw Error('invalid_candidate_operation');
    args.push('--local-candidates','--text',request.question);
    if(request.sourceId!==undefined){if(typeof request.sourceId!=='string'||!request.sourceId.trim())throw Error('invalid_candidate_source_id');args.push('--source-id',request.sourceId);}
  }else{
    if(!uuid(request.candidateWorkId)||a['local-read']!==request.candidateWorkId||request.question!==undefined||request.sourceId!==undefined||typeof a.refs!=='string'
      ||!/^c[1-9]\d*(?:,c[1-9]\d*)?$/.test(a.refs)||new Set(a.refs.split(',')).size!==a.refs.split(',').length)throw Error('invalid_read_operation');
    args.push('--local-read',a['local-read'],'--refs',a.refs);
    if(request.stage==='continuation'){
      if(a['continue-ref']!==a.refs||a.refs.includes(',')||!['range-start','range-end'].every(key=>/^(?:0|[1-9]\d*)$/.test(a[key]??'')&&Number.isSafeInteger(Number(a[key])))
        ||Number(a['range-end'])<=Number(a['range-start']))throw Error('invalid_continuation_operation');
      args.push('--continue-ref',a['continue-ref'],'--range-start',a['range-start'],'--range-end',a['range-end']);
    }else if(['continue-ref','range-start','range-end'].some(key=>a[key]!==undefined))throw Error('continuation_requires_own_operation');
  }
  args.push('--work-id',request.workId,'--lifecycle-file',lifecycleFile,'--deadline-at',request.deadlineAt);
  return {request,requestFile,requestHash:loopHash(raw),configFile,lifecycleFile,traceRoot,cwd:repo,executable:process.execPath,args};
}

/** 只控制由本 wrapper 建立的 Node helper；tool 在 wrapper 啟動前失敗仍不在此觀測範圍。 */
export async function runCmcpHostOperation(argv=process.argv.slice(2)){
  const operation=await prepareCmcpHostOperation(argv),{request,traceRoot,lifecycleFile}=operation;
  await fs.mkdir(traceRoot);const write=(name,value)=>fs.writeFile(path.join(traceRoot,name),typeof value==='string'?value:JSON.stringify(value,null,2),{flag:'wx'});
  await write('before-spawn.json',{kind:'cmcp_owned_helper_spawn',at:new Date().toISOString(),wrapperPid:process.pid,wrapperCwd:process.cwd(),
    requestFile:operation.requestFile,requestHash:operation.requestHash,cwd:operation.cwd,executable:operation.executable,argv:operation.args,
    workId:request.workId,stage:request.stage,deadlineAt:request.deadlineAt,scope:'helper程序邊界；不代表Host工具層參數已可見'});
  await write('stdout.txt','');await write('stderr.txt','');
  let child,error=null,stopReason=null,rawBytes=0,timer,spawnEvidence=Promise.resolve();
  const stop=reason=>{stopReason??=reason;if(child?.pid&&child.exitCode===null&&child.signalCode===null){
    if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:1500});else child.kill('SIGTERM');}};
  const cancel=()=>stop('cancelled');process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  const brokenOutput=e=>{error??={code:e.code??null,message:e.message};stop('output_pipe_failed');};
  process.stdout.on('error',brokenOutput);process.stderr.on('error',brokenOutput);
  let exitCode=null,signal=null,cleanup=null;
  try{
    child=spawn(operation.executable,operation.args,{cwd:operation.cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const collect=(name,target)=>chunk=>{try{appendFileSync(path.join(traceRoot,name),chunk);rawBytes+=chunk.length;target.write(chunk);if(rawBytes>131072)stop('output_cap');}
      catch(e){error??={code:e.code??null,message:e.message};stop('evidence_write_failed');}};
    child.stdout.on('data',collect('stdout.txt',process.stdout));child.stderr.on('data',collect('stderr.txt',process.stderr));
    child.once('spawn',()=>{spawnEvidence=write('spawned.json',{at:new Date().toISOString(),pid:child.pid,workId:request.workId}).catch(e=>{error={message:e.message};stop('evidence_write_failed');});});
    timer=setTimeout(()=>stop('deadline'),Math.max(1,Date.parse(request.deadlineAt)-Date.now()-3000));
    await new Promise(resolve=>{child.once('error',e=>{error={code:e.code??null,message:e.message,syscall:e.syscall??null,path:e.path??null};});
      child.once('close',(code,exitSignal)=>{exitCode=code;signal=exitSignal;resolve();});});
    if(stopReason){const config=JSON.parse(await fs.readFile(operation.configFile,'utf8'));
      cleanup=await finishCmcpOwnedHostHelper({lifecycleFile,workId:request.workId,deadlineAt:request.deadlineAt,
        cancelWork:args=>cancelCmcpRuntimeWork({config,repoRoot:repo,...args}),recoverWork:args=>recoverCmcpRuntimeWork({config,repoRoot:repo,...args})}).catch(e=>({status:'unknown',reason:e.message}));}
  }catch(e){error??={code:e.code??null,message:e.message,syscall:e.syscall??null,path:e.path??null};stop('wrapper_error');
  }finally{
    clearTimeout(timer);process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
    process.stdout.removeListener('error',brokenOutput);process.stderr.removeListener('error',brokenOutput);
    await spawnEvidence;
    let lifecycle=[];try{lifecycle=(await fs.readFile(lifecycleFile,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')error??={code:e.code??null,message:e.message};}
    const completed=lifecycle.findLast(row=>row.kind==='completed'&&row.workId===request.workId);
    let receipt=null;try{if(completed?.receiptPath){const text=await fs.readFile(within(completed.receiptPath),'utf8'),value=JSON.parse(text);
      if(value.workId!==request.workId)throw Error('operation_receipt_work_mismatch');receipt={path:completed.receiptPath,sha256:loopHash(text),workId:value.workId,localStage:value.localStage};}}
    catch(e){error??={code:e.code??null,message:e.message};}
    await write('result.json',{at:new Date().toISOString(),pid:child?.pid??null,workId:request.workId,stage:request.stage,exitCode,signal,error,stopReason,cleanup,
      receiptPath:completed?.receiptPath??null,receipt,helperLifecycle:lifecycle,rawBytes,remoteOutcome:'本地讀回未要求模型；不是Host工具層或遠端費用證明'});
  }
  if(exitCode!==0||error||stopReason)process.exitCode=1;
  return {exitCode,error,stopReason,traceRoot};
}
