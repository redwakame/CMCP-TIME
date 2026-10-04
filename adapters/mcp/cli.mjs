import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createMcpProject,loadMcpConfig,readJSON,atomicJSON,digest,safeError} from './config.mjs';
import {identityRequest} from './auth.mjs';
import {startMcpService,callManagement} from './server.mjs';
import {startMcpStdio} from './stdio.mjs';
import {callSharedProject} from '../shared-project/client.mjs';

const help={usage:'cmcp-time mcp init|check|start|health|capabilities|control|stop',examples:[
  'mcp init --root <全新專案目錄> --project <專案名稱> --hosts generic,hermes --port 8766',
  'mcp start --config <專案目錄/mcp-service.json>',
  'mcp control --config <設定> --host generic --session <原生Session> --operation enable',
  'mcp control --config <設定> --host generic --session <原生Session> --operation begin --text <本次真實使用者訊息>',
  'mcp control --config <設定> --host generic --session <原生Session> --operation authorize-reader --subject <客戶端身分>',
  'mcp start --transport stdio --binding <受保護binding檔>',
  'mcp control --config <設定> --host generic --session <原生Session> --operation answer --text <宿主實際可見原答>',
  'mcp control --config <設定> --operation revoke-reader --subject <客戶端身分>',
  'mcp stop --config <設定>'
],notice:'CLI 為人類或可信宿主入口；模型只接收 read-only MCP，不能取得 controller／issuer 憑證。模型呼叫為 0。'};
function parse(args){const [command='help',...rest]=args,options={};for(let i=0;i<rest.length;i++){const key=rest[i];if(!/^--[a-z-]+$/.test(key)||Object.hasOwn(options,key.slice(2)))throw Error('mcp_invalid_cli');if(key==='--stdin')options.stdin=true;else{if(i+1>=rest.length||rest[i+1].startsWith('--'))throw Error('mcp_invalid_cli');options[key.slice(2)]=rest[++i];}}return {command,options};}
export async function runMcp(args,{input=process.stdin,output=process.stdout,error=process.stderr}={}){
  const emit=value=>output.write(JSON.stringify(value,null,2)+'\n');
  try{const {command,options:o}=parse(args);if(command==='help'){emit(help);return help;}
    if(command==='init'){if(!o.root||!o.project)throw Error('mcp_root_and_project_required');const result=await createMcpProject({root:o.root,projectId:o.project,hosts:(o.hosts??'generic').split(','),port:Number(o.port??8766),timezone:o.timezone??'UTC'});emit(result);return result;}
    if(command==='start'&&o.transport==='stdio'){if(!o.binding)throw Error('mcp_stdio_binding_required');const service=await startMcpStdio({bindingFile:o.binding,input,output});await service.closed;return {status:'closed'};}
    if(!o.config)throw Error('mcp_config_required');const {config,shared,configFile}=await loadMcpConfig(o.config);
    if(command==='check'){const result={status:'valid',projectId:config.projectId,projectRoot:config.projectRoot,hosts:Object.keys(shared.hosts),http:config.http,resource:config.auth.audience,authorization:'explicit_host_turn_and_read_grant',modelCalls:0};emit(result);return result;}
    if(command==='start'){if(o.transport&&o.transport!=='http')throw Error('mcp_transport_unknown');const service=await startMcpService({configFile});emit({status:'ready',url:service.url,projectId:config.projectId,modelCalls:0});
      const stop=()=>service.close().catch(e=>error.write(safeError(e)+'\n'));process.once('SIGINT',stop);process.once('SIGTERM',stop);try{await service.closed;}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}emit({status:'closed',modelCalls:0});return {status:'closed'};}
    if(['health','capabilities','stop'].includes(command)){let result=await callManagement(config,command);if(command==='stop'){const deadline=Date.now()+15000;while(Date.now()<deadline){const state=await readJSON(config.stateFile).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(state?.status==='closed'&&state.instance===result.instance){result={status:'closed',instance:result.instance,modelCalls:0};break;}await new Promise(r=>setTimeout(r,50));}}emit(result);return result;}
    if(command!=='control')throw Error('mcp_unknown_command');const op=o.operation??'status';
    if(['authorize-reader','revoke-reader'].includes(op)){const result=await callManagement(config,op,op==='revoke-reader'?{subject:o.subject}:{hostId:o.host,sessionId:o.session,subject:o.subject,ttlSeconds:Number(o.ttl??900)});emit(result);return result;}
    const host=shared.hosts[o.host];if(!host||!o.session)throw Error('mcp_host_and_session_required');const binding={hostId:o.host,sessionId:o.session};
    const send=async(operation,payload={})=>{const state=await callSharedProject({connection:{pipe:shared.pipe,authFile:host.controlAuthFile},role:'controller',request:identityRequest(shared,binding,'status')});return callSharedProject({connection:{pipe:shared.pipe,authFile:host.controlAuthFile},role:'controller',request:identityRequest(shared,{...binding,epoch:state.epoch},operation,payload)});};
    let text=o.text;if(o.stdin){if(text!==undefined)throw Error('mcp_ambiguous_input');let bytes=0;const parts=[];for await(const chunk of input){bytes+=Buffer.byteLength(chunk);if(bytes>524288)throw Error('mcp_input_too_large');parts.push(chunk);}text=Buffer.concat(parts.map(v=>Buffer.from(v))).toString('utf8');}
    const activeFile=path.join(config.projectRoot,'private','turn-'+digest([o.host,o.session]).slice(0,32)+'.json');let result;
    if(op==='enable'){await send('join');result=await send('claim');}
    else if(op==='disable')result=await send('revoke');
    else if(op==='begin'){
      const messageId=o['message-id']??randomUUID(),harnessTurn=Date.now(),receivedAt=o.time??new Date().toISOString();
      const received=await send('receive',{messageId,text,receivedAt});const claimed=await send('claim-turn',{messageId,harnessTurn});
      await atomicJSON(activeFile,{hostId:o.host,sessionId:o.session,messageId,harnessTurn,epoch:claimed.epoch});result={received,claimed};
    }else if(['answer','cancel'].includes(op)){
      const turn=await readJSON(activeFile);if(turn.hostId!==o.host||turn.sessionId!==o.session)throw Error('mcp_turn_binding_mismatch');
      const status=await send('status');if(status.epoch!==turn.epoch)throw Error('mcp_turn_authorization_changed');
      result=op==='cancel'?await send('cancel',{userMessageId:turn.messageId,harnessTurn:turn.harnessTurn,reason:'human_cancelled'}):await send('finish',{messageId:o['message-id']??randomUUID(),text,receivedAt:o.time??new Date().toISOString(),userMessageId:turn.messageId,harnessTurn:turn.harnessTurn});
    }else if(op==='command')result=await send('control',{text});
    else if(op==='handoff'){const target=shared.hosts[o['target-host']];if(!target||!o['target-session'])throw Error('mcp_handoff_target_required');result=await send('handoff',{target:{hostId:o['target-host'],agentId:target.agentId,workspace:target.workspace,sessionId:o['target-session']}});}
    else if(['join','claim','status'].includes(op))result=await send(op);else throw Error('mcp_control_operation_unknown');
    emit(result);return result;
  }catch(cause){error.write(safeError(cause)+'\n');throw Error(safeError(cause));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){runMcp(process.argv.slice(2)).catch(()=>{process.exitCode=1;});}
