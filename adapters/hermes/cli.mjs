import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {configureHermes,loadHermesConfig,adapterRoot,officialHermes} from './config.mjs';
import {configureHarnessPeer,runHarnessPeer} from './peer.mjs';

export const hermesHelp=`CMCP Hermes：官方 AIAgent／外掛入口，與原生 Desktop 驗收分列。
configure --service <mcp-service.json> --python <隔離Python> --home <專案內新profile> --credential-file <既有憑證參照檔> --output <新設定檔> [--model deepseek-flash] [--git-bash <可攜bash.exe>]
選配 Groq：加 --provider groq --model <已獲授權模型ID> --credential-reference <獨立憑證參照名稱>；固定官方端點，不讀取或複製其他供應商金鑰。
configure 可加 --read-max-pages 2，明設正式 continuity 分頁一次至多兩頁；省略仍單頁，原生迭代上限不變。
inspect --config <設定檔>
probe --config <設定檔> --receipt <新回執檔>（零模型）
chat --config <設定檔> --session <明確Session> --authorize-session [--message <原始問題> | --stdin] [--receipt <新回執檔>]
chat --config <設定檔> --session <明確Session> --native-only [--message <原始問題> | --stdin]
harness-configure --config <Hermes設定> --executable <官方Harness執行檔> --cli <官方cli.js> --output <新peer設定>
harness-chat --config <peer設定> --authorize-session --synthetic-evidence [--message <原始問題> | --stdin]
只有隔離合成測試可加 --synthetic-evidence 記錄正式可見材料；日常預設僅記中繼資料。
每次 chat 結束會釋放 CMCP writer；新的 Session 不繼承前次授權。原生 History 保留於該 profile。
chat 沿設定的 timeoutSeconds 請求正式取消；必須等程序關閉與釋放回執，才會顯示已停止。
--native-only 不加入 CMCP、不保存其原文；保留 Hermes 原生聊天／工具。一般 Hermes profile 不受本入口影響。
未選 provider 時保留 DeepSeek 預設；Groq 須明示模型及獨立憑證參照。不安裝依賴、不修改全域 HOME／PATH、不推送或發布。`;

function parse(argv){const out={};for(let i=0;i<argv.length;i++){const key=argv[i];if(!key.startsWith('--')||Object.hasOwn(out,key))throw Error('hermes_invalid_option');if(['--authorize-session','--native-only','--stdin','--synthetic-evidence'].includes(key))out[key]=true;else{if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('hermes_option_value_required');out[key]=argv[++i];}}return out;}
const safeError=e=>/^[a-z][a-z0-9_]+$/.test(e?.message??'')?e.message:'hermes_operation_failed';
export async function runHermes(argv,{emit=value=>process.stdout.write(typeof value==='string'?value+'\n':JSON.stringify(value,null,2)+'\n'),stdin=process.stdin,stdout=process.stdout,stderr=process.stderr,signal,spawnProcess=spawn,peerRunner=runHarnessPeer,timers={setTimeout,clearTimeout}}={}){
  const [action='help',...rest]=argv;if(['help','--help','-h'].includes(action)){emit(hermesHelp);return {modelCalls:0};}
  const o=parse(rest);
  if(action==='configure'){
    for(const key of ['--service','--python','--home','--credential-file','--output'])if(!o[key])throw Error('hermes_configuration_fields_required');
    const value=await configureHermes({output:o['--output'],serviceConfig:o['--service'],python:o['--python'],home:o['--home'],credentialFile:o['--credential-file'],gitBash:o['--git-bash'],provider:o['--provider'],credentialRef:o['--credential-reference'],model:o['--model'],readMaxPages:o['--read-max-pages']===undefined?undefined:Number(o['--read-max-pages'])});emit(value);return value;
  }
  if(!o['--config'])throw Error('hermes_config_required');
  if(action==='harness-configure'){for(const key of ['--executable','--cli','--output'])if(!o[key])throw Error('hermes_peer_fields_required');const value=await configureHarnessPeer({hermesConfig:o['--config'],executable:o['--executable'],cli:o['--cli'],output:o['--output']});emit(value);return value;}
  if(action==='harness-chat'){
    if(!o['--authorize-session']||!o['--synthetic-evidence'])throw Error('hermes_peer_synthetic_authorization_required');let input=o['--message'];if(o['--stdin']){if(input!==undefined)throw Error('hermes_ambiguous_input');let value='';for await(const chunk of stdin){value+=chunk;if(Buffer.byteLength(value)>524288)throw Error('hermes_input_capacity');}input=value;}
    if(typeof input!=='string'||!input.trim()||Buffer.byteLength(input)>524288)throw Error('hermes_user_input_required');const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();try{const value=await peerRunner({configFile:o['--config'],text:input,sessionId:o['--session'],signal:controller.signal,onEvent:event=>emit(event)});emit(value);if(value.successful!==true)process.exitCode=2;return value;}finally{process.off('SIGINT',cancel);signal?.removeEventListener('abort',cancel);}
  }
  const loaded=await loadHermesConfig(o['--config']);
  if(action==='inspect'){const value={kind:'cmcp_hermes_inspection',version:1,configFile:loaded.file,projectId:loaded.shared.projectId,scopeId:loaded.scopeId,workspace:loaded.host.workspace,home:loaded.config.home,route:{baseUrl:loaded.config.baseUrl,model:loaded.config.model,...(loaded.config.provider===undefined?{}:{provider:loaded.config.provider})},readingTransport:{operation:'cmcp_read_continuity',readMaxPages:loaded.config.readMaxPages??1,maximum:2},officialHermes,authorization:'每次 chat 明示；尚未加入',modelCalls:0};emit(value);return value;}
  if(!['chat','probe'].includes(action))throw Error('hermes_unknown_action');
  if(action==='chat'&&(!o['--session']||(!o['--authorize-session']&&!o['--native-only'])||(o['--authorize-session']&&o['--native-only'])))throw Error('hermes_explicit_session_authorization_required');
  let text=o['--message'];if(action==='chat'){
    if(o['--stdin']){if(text!==undefined)throw Error('hermes_ambiguous_input');const chunks=[];let bytes=0;for await(const chunk of stdin){bytes+=Buffer.byteLength(chunk);if(bytes>524288)throw Error('hermes_input_capacity');chunks.push(Buffer.from(chunk));}text=Buffer.concat(chunks).toString('utf8');}
    if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>524288)throw Error('hermes_user_input_required');
  }
  const requestId=randomUUID(),receipt=path.resolve(o['--receipt']??path.join(loaded.config.home,'receipts',requestId+'.jsonl'));await fs.mkdir(path.dirname(receipt),{recursive:true});await fs.writeFile(receipt,'',{flag:'wx',mode:0o600});
  const args=[path.join(adapterRoot,'runner.py'),'--config',loaded.file,'--session',o['--session']??'probe','--node',process.execPath,'--receipt',receipt];if(action==='probe')args.push('--probe');else args.push(o['--authorize-session']?'--authorize-session':'--native-only');
  if(o['--synthetic-evidence']){if(!o['--authorize-session'])throw Error('hermes_synthetic_evidence_requires_authorized_cmcp');args.push('--synthetic-evidence');}
  const env={...process.env,HERMES_HOME:loaded.config.home,PYTHONNOUSERSITE:'1',PYTHONIOENCODING:'utf-8',PYTHONPYCACHEPREFIX:path.join(loaded.config.home,'cache','pycache'),TEMP:path.join(loaded.config.home,'temp'),TMP:path.join(loaded.config.home,'temp')};for(const key of Object.keys(env))if(/API_KEY|TOKEN|SECRET|PASSWORD/i.test(key))delete env[key];
  if(loaded.config.gitBash){env.HERMES_GIT_BASH_PATH=loaded.config.gitBash;const gitRoot=path.dirname(path.dirname(loaded.config.gitBash));env.PATH=path.join(gitRoot,'cmd')+path.delimiter+path.join(gitRoot,'usr','bin')+path.delimiter+(env.PATH??env.Path??'');delete env.Path;}
  if(signal?.aborted)throw Error('hermes_cancelled');
  await fs.mkdir(env.TEMP,{recursive:true});const child=spawnProcess(loaded.config.python,args,{cwd:loaded.host.workspace,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stopping=false,stopReason=null,deadlineTimer=null;const cancel=reason=>{if(stopping||action!=='chat')return;stopping=true;stopReason=reason;emit({kind:'cmcp_hermes_stop_requested',state:'stopping',reason,sessionId:o['--session'],timeoutSeconds:loaded.config.timeoutSeconds,releaseConfirmed:false});child.stdin.write(JSON.stringify({type:'cancel',requestId})+'\n');};
  const cancelUser=()=>cancel('user'),cancelParent=()=>cancel('parent_cancel');
  child.stdin.on('error',()=>{});child.stdout.pipe(stdout,{end:false});child.stderr.pipe(stderr,{end:false});if(action==='probe')child.stdin.end();else child.stdin.write(JSON.stringify({text,requestId,workspace:loaded.host.workspace})+'\n');
  process.on('SIGINT',cancelUser);signal?.addEventListener('abort',cancelParent,{once:true});if(signal?.aborted)cancelParent();let exitCode;
  try{exitCode=await new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('hermes_python_launch_failed')));child.once('close',resolve);if(action==='chat'&&!stopping)deadlineTimer=timers.setTimeout(()=>cancel('deadline'),loaded.config.timeoutSeconds*1000);});}finally{if(deadlineTimer!==null)timers.clearTimeout(deadlineTimer);process.off('SIGINT',cancelUser);signal?.removeEventListener('abort',cancelParent);child.stdin.end();}
  let releaseConfirmed=false;if(stopping){try{const rows=(await fs.readFile(receipt,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);releaseConfirmed=rows.some(row=>row.kind==='closed'&&row.state==='released')&&!rows.some(row=>row.kind==='close_pending');}catch{}}
  const result={kind:'cmcp_hermes_command_result',action,projectId:loaded.shared.projectId,scopeId:loaded.scopeId,sessionId:o['--session']??null,receipt,exitCode,state:stopping?(releaseConfirmed?'stopped':'stopping'):exitCode===0?'completed':'failed',stopRequested:stopping,...stopping?{releaseConfirmed,stopReason}:{}};emit(result);if(stopping&&(!releaseConfirmed||stopReason==='deadline'))process.exitCode=2;else if(exitCode!==0&&!stopping)process.exitCode=exitCode??1;return result;
}
