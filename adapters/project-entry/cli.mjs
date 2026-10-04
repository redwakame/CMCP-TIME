import fs from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {createInterface as createPrompt} from 'node:readline/promises';
import {createProject,readJSON,listProjects,loadProject} from './config.mjs';
import {createProjectController} from './controller.mjs';
import {inspectProjectRecovery,recoverProjectWork} from './recovery.mjs';

const HELP=`CMCP 專案入口（不呼叫模型）
project init [--root <新目錄> --name <專案名稱> ...]：未填欄位以互動引導輸入
project list --directory <明示目錄>
project status --config <entry.json>
project recover --config <entry.json>：唯讀列出中斷工作；互動選項以明示操作恢復為中斷狀態，不重送外部工作。
project open --config <entry.json>
project ask --config <entry.json> --host harness|codex [--prompt <文字> | --prompt-file <UTF-8檔案> | --stdin]
open 後直接輸入一般問題；/enable harness、/enable codex、/status、/file <路徑>、/disable、/close、/select <entry.json>、/cmcp <指令>（同 /control）。
Codex 在本次 open 已完成對話後，可用 /compact [接續問題]：沿同一原生 Session 正式壓縮（可能使用模型），再選擇提出新問題；不以新 Session 代替。
原生核准：/approve <requestId> accept|decline；複雜原生回覆亦可 /response <requestId> <result JSON>。
每次 ask 明示啟用一輪；open 啟動時預設停用。新 Session 不回填舊私人聊天。`;
function flags(args){const out={};for(let index=0;index<args.length;index++){const name=args[index];if(!/^--[a-z-]+$/.test(name)||Object.hasOwn(out,name))throw Error('project_entry_cli_arguments');if(name==='--stdin')out[name]=true;else {const value=args[++index];if(value===undefined||value.startsWith('--'))throw Error('project_entry_cli_arguments');out[name]=value;}}return out;}
const safe=error=>/^[a-z][a-z0-9_]+$/.test(error?.message??'')?error.message:'project_entry_failed';
const unquote=value=>value.startsWith('"')&&value.endsWith('"')?value.slice(1,-1):value;
async function wizard(options,{input,output}){
  const known=['--root','--name','--routes-from','--codex-executable','--harness-executable','--harness-cli','--credential-file','--credential-reference','--provider','--model','--reasoning-effort','--timezone'];
  if(Object.keys(options).some(key=>!known.includes(key)))throw Error('project_entry_cli_arguments');
  if(options['--routes-from']){
    const {config}=await loadProject(path.resolve(options['--routes-from'])),h=config.hosts.harness;
    options={'--codex-executable':config.hosts.codex.executable,'--harness-executable':h.executable,'--harness-cli':h.cli,'--credential-file':h.credentials.path,'--credential-reference':h.credentials.reference,'--provider':h.route.provider,'--model':h.route.model,...h.route.reasoningEffort?{'--reasoning-effort':h.route.reasoningEffort}:{},...options};
  }
  let reader=null;const get=async(key,label,optional=false)=>{if(options[key]!==undefined)return options[key];if(!input.isTTY){if(optional)return undefined;throw Error('project_entry_setup_value_required');}reader??=createPrompt({input,output});const value=(await reader.question(label+'：')).trim();if(!value&&!optional)throw Error('project_entry_setup_value_required');return value||undefined;};
  try{
    const projectRoot=await get('--root','新專案資料目錄（絕對路徑，不得已存在）'),projectId=await get('--name','專案名稱');
    const codexExecutable=await get('--codex-executable','現存 Codex App 的 codex 執行檔絕對路徑');
    const executable=await get('--harness-executable','現存官方 Harness 執行檔絕對路徑'),cli=await get('--harness-cli','該 Harness 官方 SDK CLI 絕對路徑');
    const credentialFile=await get('--credential-file','既有 Harness 憑證參照檔絕對路徑（只引用，不複製）'),reference=await get('--credential-reference','既有 credential reference 名稱');
    const provider=await get('--provider','既有 Harness provider 名稱'),model=await get('--model','既有 Harness model 名稱'),reasoningEffort=await get('--reasoning-effort','既有 reasoning effort（可留空）',true),timezone=await get('--timezone','時區（可留空採目前系統時區）',true);
    return {projectId,projectRoot,hosts:{codex:{executable:codexExecutable},harness:{executable,cli,credentials:{path:credentialFile,reference},route:{provider,model,...reasoningEffort?{reasoningEffort}:{}}}},...timezone?{timezone}:{}};
  }finally{reader?.close();}
}
/** Public bin integration point. Importing does not start a host, model or broker. */
export async function runProjectCli(args,{input=process.stdin,output=process.stdout,makeController=createProjectController}={}){
  const emit=value=>output.write((typeof value==='string'?value:JSON.stringify(value,null,2))+'\n');
  const [command='help',...rest]=args;if(command==='help'||command==='--help'){emit(HELP);return;}
  const options=flags(rest);
  if(command==='init'){
    let spec;if(options['--spec']){if(Object.keys(options).length!==1)throw Error('project_entry_cli_arguments');spec=await readJSON(path.resolve(options['--spec']));}else spec=await wizard(options,{input,output});
    emit(await createProject(spec));return;
  }
  if(command==='list'){if(Object.keys(options).join(',')!=='--directory')throw Error('project_entry_cli_arguments');emit(await listProjects(path.resolve(options['--directory'])));return;}
  if(command==='recover'){
    if(!options['--config']||Object.keys(options).some(key=>!['--config','--option','--snapshot'].includes(key)))throw Error('project_entry_cli_arguments');
    const configFile=path.resolve(options['--config']),before=await inspectProjectRecovery(configFile);emit(before);
    let option=options['--option'],snapshot=options['--snapshot'];
    if(option===undefined&&input.isTTY&&before.work.length){const prompt=createPrompt({input,output});try{option=(await prompt.question('輸入要恢復的選項編號；直接 Enter 保持不變：')).trim()||undefined;snapshot=before.snapshot;}finally{prompt.close();}}
    if(option!==undefined){if(!/^\d+$/.test(option))throw Error('project_recovery_selection_required');emit(await recoverProjectWork({configFile,option:Number(option),snapshot}));}
    else if(snapshot!==undefined)throw Error('project_entry_cli_arguments');return;
  }
  if(!['status','open','ask'].includes(command)||!options['--config'])throw Error('project_entry_cli_arguments');
  const allowed=command==='ask'?['--config','--host','--prompt','--prompt-file','--stdin']:['--config'];if(Object.keys(options).some(key=>!allowed.includes(key)))throw Error('project_entry_cli_arguments');
  const native=new Map();let controller,approvalInput=null,nativeTail=Promise.resolve();
  controller=await makeController({configFile:path.resolve(options['--config']),onEvent:event=>{
    if(event.event==='native_request'){
      native.set(event.requestId,event);
      if(command==='ask')nativeTail=nativeTail.then(async()=>{
        if(!input.isTTY||!['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(event.method)){
          emit({event:'native_input_required',requestId:event.requestId,notice:'此單次輸入無可用的原生回覆介面，已停止本輪；請用 project open 明示回覆，未自動核准。'});await controller.disable();return;
        }
        approvalInput??=createPrompt({input,output});const decision=await approvalInput.question('核准此原生請求？輸入 accept 或 decline：');
        if(!['accept','decline'].includes(decision.trim())){await controller.disable();return;}
        controller.respond({requestId:event.requestId,result:{decision:decision.trim()}});
      }).catch(error=>emit({event:'failed',code:safe(error)}));
    }
    emit(event);
  }});
  if(command==='status'){await controller.status();return;}
  if(command==='ask'){
    if(!['codex','harness'].includes(options['--host'])||['--prompt','--prompt-file','--stdin'].filter(key=>Object.hasOwn(options,key)).length!==1)throw Error('project_entry_cli_arguments');
    let text=options['--prompt'];if(options['--stdin']){text='';for await(const chunk of input){text+=chunk;if(Buffer.byteLength(text)>524288)throw Error('project_entry_prompt_invalid');}}
    const signal=()=>{approvalInput?.close();void controller.disable().catch(error=>emit({event:'failed',code:safe(error),state:controller.state}));};
    process.on('SIGINT',signal);process.on('SIGTERM',signal);
    try{await controller.enable(options['--host']);if(options['--prompt-file'])await controller.askFile(path.resolve(options['--prompt-file']));else await controller.ask(text);}finally{approvalInput?.close();try{await controller.close();await nativeTail;}finally{process.off('SIGINT',signal);process.off('SIGTERM',signal);}}return;
  }
  emit(HELP);await controller.status();
  const lines=createInterface({input,output,terminal:!!input.isTTY});let closing=null;
  const stop=()=>closing??=(async()=>{lines.close();await controller.close();})();
  const signal=()=>{void stop().catch(error=>emit({event:'failed',code:safe(error),state:controller.state}));};
  process.on('SIGINT',signal);process.on('SIGTERM',signal);lines.on('SIGINT',signal);
  try{
    for await(const line of lines){
      try{
        if(!line.trim())continue;
        if(!line.startsWith('/')){controller.ask(line).catch(error=>emit({event:'failed',code:safe(error),state:controller.state}));continue;}
        const match=/^\/(\S+)(?:\s+([\s\S]*))?$/.exec(line),name=match?.[1],value=match?.[2]??'';
        if(name==='help')emit(HELP);
        else if(name==='enable')await controller.enable(value);
        else if(name==='status')await controller.status();
        else if(name==='disable')await controller.disable();
        else if(name==='close'){await stop();break;}
        else if(name==='select')await controller.select(path.resolve(unquote(value)));
        else if(name==='compact')controller.compact(value).catch(error=>emit({event:'failed',code:safe(error),state:controller.state}));
        else if(name==='control'||name==='cmcp')emit(await controller.control(value));
        else if(name==='file')controller.askFile(path.resolve(unquote(value))).catch(error=>emit({event:'failed',code:safe(error)}));
        else if(name==='approve'){
          const [requestId,decision,...extra]=value.split(/\s+/),request=native.get(requestId);
          if(extra.length||!['accept','decline'].includes(decision)||!['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(request?.method))throw Error('project_entry_approval_format_required');controller.respond({requestId,result:{decision}});native.delete(requestId);
        }else if(name==='response'){
          const space=value.indexOf(' ');if(space<1)throw Error('project_entry_native_response_invalid');const requestId=value.slice(0,space);controller.respond({requestId,result:JSON.parse(value.slice(space+1))});native.delete(requestId);
        }else throw Error('project_entry_command_invalid');
      }catch(error){emit({event:'failed',code:safe(error),state:controller.state});}
    }
    await stop();
  }finally{process.off('SIGINT',signal);process.off('SIGTERM',signal);lines.close();}
}
