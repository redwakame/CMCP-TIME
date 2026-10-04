import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {callSharedProject} from '../shared-project/client.mjs';
import {projectHarnessTimeContext,projectHarnessToolResult} from '../deepseek-harness/runtime-bridge.mjs';
import {loadHermesConfig,adapterRoot} from './config.mjs';

const digest=text=>createHash('sha256').update(text).digest('hex');
const safeError=error=>/^[a-z][a-z0-9_]+$/.test(error?.message??'')?error.message:'hermes_bridge_failed';
export function projectReceipt(kind,value,{syntheticEvidence=false,authorized=false}={}){
  const projected={...value};for(const key of ['context','result'])if(Object.hasOwn(projected,key)){projected[key+'Hash']=digest(JSON.stringify(projected[key]));if(!(key==='result'&&kind==='formal_tool'&&syntheticEvidence&&authorized))delete projected[key];}return projected;
}
export const readerTools=Object.freeze([
  {name:'cmcp_status',description:'查看目前授權範圍與有效狀態。',properties:{}},
  {name:'cmcp_find_history',description:'取得正式原文導航；導航不等於已閱讀。',properties:{}},
  {name:'cmcp_open_history',description:'選取正式來源並取得閱讀票券。',properties:{navigationTicket:{type:'string'},selectionJson:{type:'string'}},required:['navigationTicket','selectionJson']},
  {name:'cmcp_read_history',description:'正式逐頁閱讀原文、角色、原時間與版本。',properties:{ticket:{type:'string'}},required:['ticket']},
  {name:'cmcp_reading_progress',description:'核對正式閱讀覆蓋與未讀範圍。',properties:{ticket:{type:'string'}},required:['ticket']}
].map(t=>({...t,inputSchema:{type:'object',properties:t.properties,required:t.required??[],additionalProperties:false}})));

export function createHermesBridge(loaded,{sessionId,authorized=false,call=callSharedProject,mcpFactory,note=async()=>{},now=()=>new Date().toISOString()}={}){
  if(typeof sessionId!=='string'||!sessionId||sessionId.length>256||/[\x00-\x1f]/.test(sessionId))throw Error('hermes_explicit_session_required');
  const {config,shared,host}=loaded;let joined=false,closed=false,epoch=null,binding=null,reader=null,subject=null;
  const request=async(operation,args={})=>{const value=await call({connection:{pipe:shared.pipe,authFile:host.controlAuthFile},role:'controller',request:{projectId:shared.projectId,hostId:'hermes',agentId:host.agentId,workspace:host.workspace,sessionId,...(epoch?{epoch}:{}),requestId:randomUUID(),operation,args}});if(value?.epoch)epoch=value.epoch;return value;};
  const active=()=>{if(!authorized||closed||!joined||!binding)throw Error('hermes_active_authorized_turn_required');};
  return {async dispatch(message){
    if(!message||typeof message!=='object'||message.sessionId!==sessionId)throw Error('hermes_session_mismatch');
    const {operation,args={}}=message;
    if(operation==='inspect')return {projectId:shared.projectId,scopeId:loaded.scopeId,sessionId,enabled:authorized&&!closed,joined,activeTurn:!!binding,epoch,tools:readerTools};
    if(operation==='begin'){
      if(!authorized||closed)throw Error('hermes_session_not_authorized');if(binding)throw Error('hermes_turn_already_active');
      if(typeof args.userMessage!=='string'||!args.userMessage.trim()||Buffer.byteLength(args.userMessage)>524288||typeof args.turnId!=='string'||!args.turnId||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(args.receivedAt??''))throw Error('hermes_invalid_user_event');
      if(!joined){const value=await request('join');joined=value.joined===true;if(!joined)throw Error('hermes_join_failed');try{await request('claim');}catch(error){await request('revoke').catch(()=>{});joined=false;throw error;}}
      const userMessageId='hermes-user-'+args.turnId,capture=await request('receive',{messageId:userMessageId,revisionId:'r1',text:args.userMessage,receivedAt:args.receivedAt});
      if(!capture.capture?.sourcePointer)throw Error('hermes_capture_not_saved');
      // Hermes 的原生 turnId 是不透明字串；既有數字 harnessTurn 留空，不能冒充宿主編號。
      const claimed=await request('claim-turn',{messageId:userMessageId,revisionId:'r1',harnessTurn:null});
      binding={userMessageId,userRevisionId:'r1',harnessTurn:null,turnId:args.turnId,index:0};
      const context=await request('request-context');subject='hermes-'+digest([shared.projectId,sessionId,args.turnId].join('\0')).slice(0,40);
      if(!mcpFactory)throw Error('hermes_mcp_transport_unavailable');reader=await mcpFactory({loaded,sessionId,subject});
      const skill=await fs.readFile(path.join(adapterRoot,'SKILL.md'),'utf8'),projected=projectHarnessTimeContext(context,false);
      await note('user_saved',{sessionId,turnId:args.turnId,receivedAt:args.receivedAt,bodyHash:digest(args.userMessage),receipt:capture});
      await note('context_provided',{sessionId,turnId:args.turnId,context:projected,skillHash:digest(skill)});
      return {context:skill+'\n\n'+JSON.stringify(projected),epoch,scopeId:loaded.scopeId,receipt:claimed};
    }
    if(operation==='tool'){
      active();if(args.turnId!==binding.turnId||!readerTools.some(t=>t.name===args.name))throw Error('hermes_read_tool_forbidden');
      const value=await reader.call(args.name,args.arguments??{});active();
      const projection=projectHarnessToolResult(value),serialized=JSON.stringify(projection);await note('formal_tool',{sessionId,turnId:binding.turnId,name:args.name,result:projection,resultHash:digest(serialized),resultBytes:Buffer.byteLength(serialized),sourceOrigins:value?.sourceOrigins??null,completedRefs:value?.completedRefs??null});return projection;
    }
    if(operation==='assistant'||operation==='finish'){
      active();if(args.turnId!==binding.turnId||typeof args.text!=='string'||!args.text||typeof args.receivedAt!=='string')throw Error('hermes_invalid_assistant_event');
      const current=binding,receipt=await request(operation==='finish'?'finish':'append-assistant',{messageId:'hermes-assistant-'+current.turnId+'-'+current.index++,revisionId:'r1',text:args.text,receivedAt:args.receivedAt,userMessageId:current.userMessageId,userRevisionId:'r1',harnessTurn:current.harnessTurn});
      if(!receipt.sourcePointer)throw Error('hermes_assistant_not_saved');
      await note(operation==='finish'?'final_saved':'interim_saved',{sessionId,turnId:current.turnId,receivedAt:args.receivedAt,bodyHash:digest(args.text),receipt});
      if(operation==='finish'){binding=null;await reader?.close();reader=null;}return receipt;
    }
    if(operation==='cancel'){
      if(binding){const current=binding;await request('cancel',{userMessageId:current.userMessageId,userRevisionId:'r1',harnessTurn:current.harnessTurn,reason:'hermes_host_cancelled'});binding=null;}
      await reader?.close();reader=null;await note('cancelled',{sessionId});return {state:'cancelled',epoch};
    }
    if(operation==='close'){
      closed=true;await reader?.close();reader=null;
      if(joined){await request('revoke');joined=false;binding=null;}await note('released',{sessionId,epoch});return {state:'released',joined:false,epoch};
    }
    throw Error('hermes_unknown_host_operation');
  }};
}

export async function realMcpFactory({loaded,sessionId,subject}){
  const {callManagement}=await import('../mcp/server.mjs');
  const grant=await callManagement(loaded.service,'authorize-reader',{hostId:'hermes',sessionId,subject,ttlSeconds:Math.min(3600,loaded.config.timeoutSeconds+60)});
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client=new Client({name:'cmcp-hermes-host-reader',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.resolve(adapterRoot,'../mcp/stdio.mjs'),'--binding',grant.bindingFile],stderr:'pipe'});
  await client.connect(transport);
  return {async call(name,args){const result=await client.callTool({name,arguments:args});if(result.isError)throw Error('hermes_mcp_read_rejected');if(result.structuredContent)return result.structuredContent;const text=result.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n');try{return JSON.parse(text);}catch{throw Error('hermes_mcp_result_invalid');}},async close(){await client.close();await callManagement(loaded.service,'revoke-reader',{subject});}};
}
export async function runBridge(argv=process.argv.slice(2)){
  const values={};for(let i=0;i<argv.length;i+=2)values[argv[i]]=argv[i+1];
  const loaded=await loadHermesConfig(values['--config']),sessionId=values['--session'];
  const note=async(kind,value)=>{const projected=projectReceipt(kind,value,{syntheticEvidence:values['--synthetic-evidence']==='true',authorized:values['--authorized']==='true'});
    const dir=path.join(loaded.config.home,'cmcp-receipts');await fs.mkdir(dir,{recursive:true});await fs.appendFile(path.join(dir,digest(sessionId)+'.jsonl'),JSON.stringify({at:new Date().toISOString(),kind,...projected})+'\n');};
  const bridge=createHermesBridge(loaded,{sessionId,authorized:values['--authorized']==='true',mcpFactory:realMcpFactory,note});
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){let id=null;try{if(Buffer.byteLength(line)>1048576)throw Error('hermes_ipc_capacity');const value=JSON.parse(line);id=value.id;const result=await bridge.dispatch(value);process.stdout.write(JSON.stringify({id,ok:true,result})+'\n');}catch(error){process.stdout.write(JSON.stringify({id,ok:false,error:safeError(error)})+'\n');}}
  try{await bridge.dispatch({sessionId,operation:'close'});}catch(error){process.stderr.write(safeError(error)+'\n');process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runBridge();
