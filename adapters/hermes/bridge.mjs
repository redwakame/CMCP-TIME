import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {callSharedProject,CONTINUITY_TOOL_DESCRIPTION,OPEN_HISTORY_TOOL_DESCRIPTION,CONTINUITY_TOOL_PARAMETERS,readContinuityProposal} from '../shared-project/client.mjs';
import {projectHarnessTimeContext,projectHarnessToolResult} from '../deepseek-harness/runtime-bridge.mjs';
import {loadHermesConfig,adapterRoot} from './config.mjs';
import {CONTINUITY_BEFORE_ANSWER_POLICY,CONTINUITY_POLICY_METADATA,CONTINUITY_LENGTH_RECOVERY_POLICY,CONTINUITY_EMPTY_LENGTH_RECOVERY_POLICY} from '../continuity-policy.mjs';
import {CONTINUITY_PAGE_PARAMETERS,CONTINUITY_PAGE_DESCRIPTION} from '../continuity-delivery.mjs';
import {projectContinuitySchemaFeedback} from '../continuity-schema-feedback.mjs';

const digest=text=>createHash('sha256').update(text).digest('hex');
const safeError=error=>/^[a-z][a-z0-9_]+$/.test(error?.message??'')?error.message:'hermes_bridge_failed';
export function formalPageChildren(value){
  if(value?.kind!=='cmcp_formal_page_batch')return [value];
  if(value.version!==1||value.operation!=='continuity-page'||!Number.isInteger(value.requestedMaxPages)||value.requestedMaxPages<1||value.requestedMaxPages>2
    ||!Array.isArray(value.pages)||!value.pages.length||value.pages.length>value.requestedMaxPages
    ||value.transportCoverage!=='exact_formal_children_provided_not_model_comprehension')throw Error('hermes_formal_batch_invalid');
  const first=value.pages[0];
  if(!Number.isInteger(first?.delivery?.pageCount)||first.delivery.pageCount<1||first.delivery.pageCount>64||!Number.isInteger(first.delivery.page)
    ||first.delivery.page<0||first.delivery.page>=first.delivery.pageCount)throw Error('hermes_formal_batch_invalid');
  if(value.pages.some((page,i)=>page?.kind!=='cmcp_continuity_delivery_page'||page.status!=='provided'||page.ticket!==value.ticket
    ||page.delivery?.page!==first.delivery?.page+i||['id','resultHash','resultBytes','resultChars','pageCount'].some(k=>page.delivery?.[k]!==first.delivery?.[k])
    ||page.projectionHash!==first.projectionHash||page.projectionStatus!==first.projectionStatus))throw Error('hermes_formal_batch_binding_changed');
  return value.pages;
}
export function projectReceipt(kind,value,{syntheticEvidence=false,authorized=false}={}){
  const projected={...value};for(const key of ['context','result'])if(Object.hasOwn(projected,key)){projected[key+'Hash']=digest(JSON.stringify(projected[key]));if(!(key==='result'&&kind==='formal_tool'&&syntheticEvidence&&authorized))delete projected[key];}return projected;
}
export const readerTools=Object.freeze([
  {name:'cmcp_status',description:'查看目前授權範圍與有效狀態。',properties:{}},
  {name:'cmcp_find_history',description:'取得正式原文導航；導航不等於已閱讀。',properties:{}},
  {name:'cmcp_open_history',description:OPEN_HISTORY_TOOL_DESCRIPTION,properties:{navigationTicket:{type:'string'},selectionJson:{type:'string'},includeCurrentInput:{type:'boolean'}},required:['navigationTicket','selectionJson']},
  {name:'cmcp_read_history',description:'正式逐頁閱讀原文、角色、原時間與版本。',properties:{ticket:{type:'string'}},required:['ticket']},
  {name:'cmcp_reading_progress',description:'核對正式閱讀覆蓋與未讀範圍。',properties:{ticket:{type:'string'}},required:['ticket']},
  {name:'cmcp_project_continuity',description:CONTINUITY_TOOL_DESCRIPTION,properties:CONTINUITY_TOOL_PARAMETERS.properties,required:CONTINUITY_TOOL_PARAMETERS.required,inputSchema:CONTINUITY_TOOL_PARAMETERS},
  {name:'cmcp_read_continuity',description:CONTINUITY_PAGE_DESCRIPTION+' 已明設 readMaxPages=2 時，可一次取得至多兩頁完整正式子頁；maxPages=1 可選單頁。',properties:{...CONTINUITY_PAGE_PARAMETERS.properties,maxPages:{type:'number',minimum:1,maximum:2}},required:CONTINUITY_PAGE_PARAMETERS.required,inputSchema:{...CONTINUITY_PAGE_PARAMETERS,properties:{...CONTINUITY_PAGE_PARAMETERS.properties,maxPages:{type:'integer',minimum:1,maximum:2}}}}
].map(t=>({...t,inputSchema:t.inputSchema??{type:'object',properties:t.properties,required:t.required??[],additionalProperties:false}})));

export function createHermesBridge(loaded,{sessionId,authorized=false,call=callSharedProject,mcpFactory,note=async()=>{},now=()=>new Date().toISOString()}={}){
  if(typeof sessionId!=='string'||!sessionId||sessionId.length>256||/[\x00-\x1f]/.test(sessionId))throw Error('hermes_explicit_session_required');
  const {config,shared,host}=loaded;let joined=false,closed=false,epoch=null,binding=null,reader=null,subject=null,readingStage=null;
  const readMaxPages=config.readMaxPages??1;
  const deliveryProof=page=>{
    const d=page.delivery;
    if(!Number.isInteger(d?.pageCount)||d.pageCount<1||d.pageCount>64||!Number.isInteger(d.page)||d.page<0||d.page>=d.pageCount)throw Error('hermes_delivery_proof_invalid');
    if(!readingStage.deliveryProof||readingStage.deliveryProof.id!==d.id)readingStage.deliveryProof={id:d.id,resultHash:d.resultHash,pageCount:d.pageCount,projectionHash:page.projectionHash,pages:new Map()};
    const proof=readingStage.deliveryProof;
    if(proof.resultHash!==d.resultHash||proof.pageCount!==d.pageCount||proof.projectionHash!==page.projectionHash)throw Error('hermes_delivery_proof_changed');
    proof.pages.set(d.page,digest(JSON.stringify(page)));
    return d.complete===true&&Array.from({length:d.pageCount},(_,i)=>i).every(i=>proof.pages.has(i));
  };
  const complete=value=>{const c=value?.coverage;return c?.complete===true&&c.exhausted===true&&Number.isInteger(c.sourceCount)&&c.sourceCount>0&&c.completedSources===c.sourceCount&&c.unavailableSources===0&&Array.isArray(c.unread)&&c.unread.length===0;};
  const request=async(operation,args={})=>{const value=await call({connection:{pipe:shared.pipe,authFile:host.controlAuthFile},role:'controller',request:{projectId:shared.projectId,hostId:'hermes',agentId:host.agentId,workspace:host.workspace,sessionId,...(epoch?{epoch}:{}),requestId:randomUUID(),operation,args}});if(value?.epoch)epoch=value.epoch;return value;};
  const active=()=>{if(!authorized||closed||!joined||!binding)throw Error('hermes_active_authorized_turn_required');};
  // 描述本回合正式工具回執，不從「讀過」推定必須投影，也不冒充語意核准。
  const completion=()=>({formalReading:readingStage?(readingStage.complete?'completed':'pending'):'not_requested',
    projectionCompletion:readingStage?(readingStage.projected?'completed':readingStage.projectionRequested?'pending':'not_performed'):'not_requested',
    ticket:readingStage?.ticket??null,projectionStatus:readingStage?.projectionStatus??null,
    evidenceLevel:'same_turn_formal_tool_receipts',sourceVersionValidation:'formal_projection_tool_rechecks',semanticAssessment:'not_assessed'});
  const checkReadingStage=async(current,stage)=>{
    const checked=await reader.call('cmcp_reading_progress',{ticket:stage.ticket}),progress=checked?.reader??checked;active();
    if(binding!==current||readingStage!==stage)throw Error('hermes_stage_binding_changed');
    if(progress?.ticket!==stage.ticket||progress.revoked===true||progress.status==='unavailable')throw Error('hermes_formal_reading_unavailable');
    await request('request-context');active();
    if(binding!==current||readingStage!==stage)throw Error('hermes_stage_binding_changed');
    stage.complete=complete(progress);
    return completion();
  };
  const stageContext=value=>'CMCP 本回合正式階段：'+JSON.stringify(value)+'。formalReading=completed 只表示選定來源先前已讀完，不是全歷史覆蓋或原件重新核驗。projectionCompletion=not_performed 表示尚未呼叫投影，不代表回答失敗；pending 表示已嘗試而尚未取得正式投影回執。若本題需要目前狀態／修訂比較，可沿此 ticket 使用 cmcp_project_continuity；普通問題或僅需原文的回答不強制投影。正式工具仍會重驗來源版本；取消、撤權或拒絕不能靠續答越過。';
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
      binding={userMessageId,userRevisionId:'r1',harnessTurn:null,turnId:args.turnId,index:0};readingStage=null;
      const context=await request('request-context');subject='hermes-'+digest([shared.projectId,sessionId,args.turnId].join('\0')).slice(0,40);
      if(!mcpFactory)throw Error('hermes_mcp_transport_unavailable');reader=await mcpFactory({loaded,sessionId,subject});
      const skill=await fs.readFile(path.join(adapterRoot,'SKILL.md'),'utf8'),projected=projectHarnessTimeContext(context,false);
      await note('user_saved',{sessionId,turnId:args.turnId,receivedAt:args.receivedAt,bodyHash:digest(args.userMessage),receipt:capture});
      await note('context_provided',{sessionId,turnId:args.turnId,context:projected,skillHash:digest(skill),beforeAnswerPolicy:CONTINUITY_POLICY_METADATA});
      active();if(binding.turnId!==args.turnId)throw Error('hermes_turn_changed');
      return {context:skill+'\n\n'+JSON.stringify(projected)+'\n\n'+CONTINUITY_BEFORE_ANSWER_POLICY,epoch,scopeId:loaded.scopeId,receipt:claimed};
    }
    if(operation==='recovery-check'){
      active();if(args.turnId!==binding.turnId||Object.keys(args).some(key=>!['turnId','visibleContent'].includes(key))
        ||(args.visibleContent!==undefined&&!['absent','present','unknown'].includes(args.visibleContent)))throw Error('hermes_recovery_binding_mismatch');
      const current=binding,context=await request('request-context');active();
      if(binding!==current||args.turnId!==binding.turnId||!context)throw Error('hermes_recovery_authorization_unavailable');
      const stage=readingStage,formalCompletion=stage?await checkReadingStage(current,stage):completion();
      // 只接受可信宿主 middleware 的可見正文存在狀態；模型工具沒有此操作。
      return {active:true,completion:formalCompletion,context:CONTINUITY_LENGTH_RECOVERY_POLICY+(args.visibleContent==='absent'?'\n'+CONTINUITY_EMPTY_LENGTH_RECOVERY_POLICY:'')+(stage?'\n'+stageContext(formalCompletion):'')};
    }
    if(operation==='stage-check'){
      active();if(args.turnId!==binding.turnId||Object.keys(args).some(key=>key!=='turnId'))throw Error('hermes_stage_binding_mismatch');
      if(!readingStage?.complete||readingStage.projected||readingStage.reminded)return {active:false,reason:'no_pending_formal_stage'};
      const current=binding,stage=readingStage;await request('request-context');active();
      if(binding!==current||readingStage!==stage)throw Error('hermes_stage_binding_changed');
      const formalCompletion=await checkReadingStage(current,stage);
      if(!stage.complete)return {active:false,reason:'formal_reading_not_complete'};
      stage.reminded=true;
      return {active:true,ticket:stage.ticket,completion:formalCompletion,context:stageContext(formalCompletion)};
    }
    if(operation==='budget-check'){
      active();if(args.turnId!==binding.turnId||typeof args.ticket!=='string'||Object.keys(args).some(key=>!['turnId','ticket'].includes(key)))throw Error('hermes_budget_binding_mismatch');
      if(!readingStage?.complete||readingStage.ticket!==args.ticket)return {active:false,reason:'no_matching_completed_reading'};
      const current=binding,stage=readingStage,formalCompletion=await checkReadingStage(current,stage);
      // 沿用正式已讀回執與目前控制；來源版本仍由正式投影重驗，不複製正文或建立授權。
      return {active:stage.complete,completion:formalCompletion};
    }
    if(operation==='tool'){
      active();if(args.turnId!==binding.turnId||!readerTools.some(t=>t.name===args.name))throw Error('hermes_read_tool_forbidden');
      const tool=readerTools.find(t=>t.name===args.name);let values=args.arguments??{};
      if(args.name==='cmcp_project_continuity')readContinuityProposal(values);
      else if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!Object.hasOwn(tool.properties,key))
        ||(tool.required??[]).some(key=>!Object.hasOwn(values,key))||Object.entries(values).some(([key,value])=>typeof value!==tool.properties[key].type))throw Error('hermes_invalid_tool_arguments');
      if(args.name==='cmcp_read_continuity'){
        const maxPages=values.maxPages??readMaxPages;
        if(!Number.isInteger(maxPages)||maxPages<1||maxPages>readMaxPages)throw Error('hermes_invalid_read_max_pages');
        if(maxPages>1||Object.hasOwn(values,'maxPages'))values={...values,maxPages};
      }
      if(readingStage&&values.ticket===readingStage.ticket&&args.name==='cmcp_project_continuity'){
        readingStage.projectionRequested=true;readingStage.projected=false;readingStage.projectionStatus=null;
      }
      if(args.name==='cmcp_project_continuity'){
        const feedback=projectContinuitySchemaFeedback(values);
        if(feedback){const current=binding;await note('input_schema_rejected',{sessionId,turnId:binding.turnId,name:args.name,feedback});
          active();if(binding!==current)throw Error('hermes_tool_binding_changed');return feedback;}
      }
      const current=binding;let value;
      try{value=await reader.call(args.name,values);active();if(binding!==current)throw Error('hermes_tool_binding_changed');formalPageChildren(value);}
      catch(error){if(readingStage&&args.name==='cmcp_read_continuity'&&values.maxPages>1){readingStage.projected=false;readingStage.projectionRequested=true;readingStage.deliveryProof=null;}throw error;}
      try{
      if(args.name==='cmcp_open_history')readingStage=typeof value?.ticket==='string'&&value.status==='ready'?{ticket:value.ticket,complete:false,projected:false,projectionRequested:false,projectionStatus:null,reminded:false}:null;
      else if(readingStage&&values.ticket===readingStage.ticket){
        const formal=value?.reader??value;
        if(['cmcp_read_history','cmcp_reading_progress'].includes(args.name)&&formal?.ticket===readingStage.ticket)readingStage.complete=complete(formal);
        else if(['cmcp_project_continuity','cmcp_read_continuity'].includes(args.name)&&value?.ticket===readingStage.ticket&&['cmcp_continuity_delivery_page','cmcp_formal_page_batch'].includes(value.kind)){
          for(const child of formalPageChildren(value)){
            readingStage.projectionStatus=child.projectionStatus;readingStage.projected=readMaxPages>1?deliveryProof(child):child.delivery?.complete===true;
          }
        }else if(args.name==='cmcp_project_continuity'&&value?.ticket===readingStage.ticket&&value.kind==='cmcp_continuity_projection'){
          readingStage.projectionStatus=['ready','partial','rejected','unavailable'].includes(value.status)?value.status:null;
          if(['ready','partial'].includes(value.status)&&value.projection)readingStage.projected=true;
        }
      }
      const projection=projectHarnessToolResult(value),serialized=JSON.stringify(projection);await note('formal_tool',{sessionId,turnId:binding.turnId,name:args.name,result:projection,resultHash:digest(serialized),resultBytes:Buffer.byteLength(serialized),
        ...(value?.kind==='cmcp_formal_page_batch'?{formalChildren:formalPageChildren(value).map(child=>({ticket:child.ticket,deliveryId:child.delivery.id,page:child.delivery.page,pageCount:child.delivery.pageCount,resultHash:child.delivery.resultHash,childSha256:digest(JSON.stringify(child)),childBytes:Buffer.byteLength(JSON.stringify(child)),provided:child.status==='provided'}))}:{}),
        sourceOrigins:value?.sourceOrigins??null,completedRefs:value?.completedRefs??null});
      if(value?.kind==='cmcp_formal_page_batch'){
        await request('request-context');active();if(binding!==current)throw Error('hermes_tool_binding_changed');
      }
      return projection;
      }catch(error){if(readingStage&&readMaxPages>1&&['cmcp_project_continuity','cmcp_read_continuity'].includes(args.name)){
        readingStage.projected=false;readingStage.projectionRequested=true;readingStage.deliveryProof=null;
      }throw error;}
    }
    if(operation==='assistant'||operation==='finish'){
      active();if(args.turnId!==binding.turnId||typeof args.text!=='string'||!args.text||typeof args.receivedAt!=='string')throw Error('hermes_invalid_assistant_event');
      const current=binding,formalCompletion=completion(),receipt=await request(operation==='finish'?'finish':'append-assistant',{messageId:'hermes-assistant-'+current.turnId+'-'+current.index++,revisionId:'r1',text:args.text,receivedAt:args.receivedAt,userMessageId:current.userMessageId,userRevisionId:'r1',harnessTurn:current.harnessTurn});
      if(!receipt.sourcePointer)throw Error('hermes_assistant_not_saved');
      await note(operation==='finish'?'final_saved':'interim_saved',{sessionId,turnId:current.turnId,receivedAt:args.receivedAt,bodyHash:digest(args.text),receipt,completion:formalCompletion});
      if(operation==='finish'){binding=null;readingStage=null;await reader?.close();reader=null;}return {...receipt,completion:formalCompletion};
    }
    if(operation==='cancel'){
      readingStage=null;
      if(binding){const current=binding;await request('cancel',{userMessageId:current.userMessageId,userRevisionId:'r1',harnessTurn:current.harnessTurn,reason:'hermes_host_cancelled'});binding=null;}
      await reader?.close();reader=null;await note('cancelled',{sessionId});return {state:'cancelled',epoch};
    }
    if(operation==='close'){
      closed=true;readingStage=null;await reader?.close();reader=null;
      if(joined){await request('revoke');joined=false;binding=null;}await note('released',{sessionId,epoch});return {state:'released',joined:false,epoch};
    }
    throw Error('hermes_unknown_host_operation');
  }};
}

/** 保留正式拒絕的安全代碼，讓宿主能修正同一份材料；不回傳原始錯誤正文。 */
export function decodeHermesMcpResult(result){
  if(result?.isError){
    const text=result.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n');
    throw Error(typeof text==='string'&&/^(?:reading|continuity|cmcp|shared_project|mcp|invalid)_[a-z0-9_]{1,96}$/.test(text)?'hermes_reader_'+text:'hermes_mcp_read_rejected');
  }
  if(result?.structuredContent)return result.structuredContent;
  const text=result?.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n');
  try{return JSON.parse(text);}catch{throw Error('hermes_mcp_result_invalid');}
}
export async function realMcpFactory({loaded,sessionId,subject}){
  const {callManagement}=await import('../mcp/server.mjs');
  const grant=await callManagement(loaded.service,'authorize-reader',{hostId:'hermes',sessionId,subject,ttlSeconds:Math.min(3600,loaded.config.timeoutSeconds+60)});
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client=new Client({name:'cmcp-hermes-host-reader',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.resolve(adapterRoot,'../mcp/stdio.mjs'),'--binding',grant.bindingFile],stderr:'pipe'});
  await client.connect(transport);
  return {async call(name,args){return decodeHermesMcpResult(await client.callTool({name,arguments:args}));},async close(){await client.close();await callManagement(loaded.service,'revoke-reader',{subject});}};
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
