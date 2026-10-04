import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {CmcpHarnessBridge,projectHarnessToolResult,projectHarnessTimeContext,within} from '../runtime-bridge.mjs';
import {createPinHost} from '../pin-host.mjs';
import {installPromptOriginalCapture} from './prompt-originals.mjs';
import {installMediaRpc} from './media-rpc.mjs';
import {createControlOptions,controlMenu,CONTROL_CONTRACT_VERSION} from '../../control/contract.mjs';

export const name='cmcp-desktop-native';
export const inject=['agents','tools','sessions','skills','commands','llm','attachments','sessionController','typert'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const textOf=message=>(message?.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('');
const key=(sessionId,messageId)=>JSON.stringify([sessionId,messageId]);
const codeOf=error=>/^[a-z][a-z0-9_]+$/u.test(error?.message??'')?error.message:'cmcp_operation_failed';
const checkSignal=signal=>{if(signal?.aborted)throw Error('cmcp_command_cancelled');};
const object=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const string={type:'string'};

/** 只觀測可見文字的雜湊與大小；不複製正文，也不讀取 reasoning／thinking 內容。 */
export function projectModelInputMetadata(messages){
  return messages.map(message=>{const text=textOf(message);return {id:message.id,role:message.role,
    sourceKind:message.source?.kind??null,textHash:sha(text),textBytes:Buffer.byteLength(text),
    images:(message.content??[]).filter(b=>b.type==='image').map(b=>({attachment:b.attachment??null})),
    ...(typeof message.toolCallId==='string'?{toolCallId:message.toolCallId}:{})};});
}

/** 官方 Desktop 增量接點。普通 Agent／工具／模型保留宿主自己的生命週期。 */
export function apply(ctx,config){
  if(!config||typeof config.workspaceRoot!=='string'||!path.isAbsolute(config.workspaceRoot)
    ||typeof config.scopeId!=='string'||!config.scopeId)throw Error('cmcp_explicit_workspace_scope_required');
  if(config.acceptanceSessionIds!==undefined&&(!Array.isArray(config.acceptanceSessionIds)
    ||config.acceptanceSessionIds.some(id=>typeof id!=='string'||!id)))throw Error('cmcp_explicit_acceptance_sessions_required');
  if(config.dispatchSessionIds!==undefined&&(!Array.isArray(config.dispatchSessionIds)
    ||config.dispatchSessionIds.some(id=>typeof id!=='string'||!id)))throw Error('cmcp_explicit_dispatch_sessions_required');
  const workspaceRoot=path.resolve(config.workspaceRoot);
  const sameWorkspace=value=>typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===workspaceRoot;
  const root=path.resolve(config.deploymentRoot),skillPath=within(root,path.resolve(root,config.skillPath));
  const bridge=new CmcpHarnessBridge({...config,deploymentRoot:root,
    runtimeConfig:within(root,path.resolve(root,config.runtimeConfig)),traceRoot:within(root,path.resolve(root,config.traceRoot)),
    hostTurnPolicy:{timeoutMs:900000,maxTimeoutMs:1800000}});
  const states=new Map(),queues=new Map(),receivedTimes=new Map(),publishedContexts=new Set(),publishedProtocols=new Set();
  let stopping=false,invalidateSkills=()=>{},pinHost=null,pinReady=false,pinError=null;
  const matches=agent=>agent?.id===agent?.session?.id&&sameWorkspace(agent.session.header?.cwd);
  const stateFor=agent=>{if(!matches(agent))return null;let state=states.get(agent.id);
    if(!state){state={agent,optedIn:false,epoch:0,authorizationSequence:0,binding:null,received:new Map(),finals:new Map(),skillPublished:false,error:null,controlOptions:createControlOptions()};states.set(agent.id,state);}
    return state;};
  const active=state=>!stopping&&!!state?.optedIn&&matches(state.agent);
  const liveState=id=>{const state=states.get(id);return active(state)&&ctx.agents?.get?.(id)===state.agent?state:null;};
  let promptOriginals=null,mediaCaptureError=null;
  try{promptOriginals=ctx.sessionController?installPromptOriginalCapture({service:ctx.sessionController,
    authorized:async sessionId=>{const state=liveState(sessionId);if(!state)return {allowed:false,stamp:'unauthorized'};
      const epoch=state.epoch,full=await bridge.status(),c=full.controlConfiguration.effective;
      return {allowed:!!liveState(sessionId)&&state.epoch===epoch&&c.enabled&&!c.clean&&c.saveUser,
        stamp:sha(JSON.stringify([sessionId,epoch,full.controlConfiguration.generation]))};},
    recordMetadata:row=>bridge.note(row.sessionId,'image_admission_metadata',row)
  }):null;}catch(error){mediaCaptureError=codeOf(error);}
  let mediaRpcDispose=null,mediaRpcReady=false,mediaRpcError=null;
  const mediaRpcInitialization=ctx.typert&&typeof config.llmModulePath==='string'?(async()=>{
    try{mediaRpcDispose=await installMediaRpc({ctx,
      protocolModulePath:path.resolve(path.dirname(config.llmModulePath),'../../dsh-typert-protocol/lib/index.js'),
      read:async(request,signal)=>{
        checkSignal(signal);const state=liveState(request.sessionId);if(!state)throw Error('cmcp_session_not_enabled');
        if(request.pointer.scopeId!==config.scopeId)throw Error('cmcp_source_scope_mismatch');
        const epoch=state.epoch,guard=()=>!signal?.aborted&&liveState(request.sessionId)===state&&state.epoch===epoch;
        const mediaOriginal=await bridge.mediaRead(request,guard);
        checkSignal(signal);if(!guard())throw Error('cmcp_source_authorization_changed');
        return {kind:'cmcp_desktop_response',operation:'media-read',enabled:true,sessionId:request.sessionId,mediaOriginal};
      }});mediaRpcReady=true;
    }catch(error){mediaRpcError=codeOf(error);}
  })():Promise.resolve();
  const dispatchAllowed=id=>config.dispatchSessionIds===undefined||config.dispatchSessionIds.includes(id);
  const targetGuard=(state,epoch)=>liveState(state.agent.id)===state&&state.epoch===epoch&&dispatchAllowed(state.agent.id);
  const pinEpochs=new Map();
  // 原生路線的模組先以零模型初始化核對；未取得接點時只阻擋 Pin，不破壞普通聊天。
  const pinInitialization=typeof config.llmModulePath==='string'?(async()=>{
    pinHost=createPinHost({ctx,llmModulePath:config.llmModulePath,
      resolveAgent:target=>{const state=liveState(target.sessionId);
        if(target.scopeId!==config.scopeId||!state||!dispatchAllowed(target.sessionId))throw Error('cmcp_pin_target_not_authorized');
        return {agent:state.agent,scopeId:config.scopeId};},
      record:row=>{if(row.kind==='pin_host_cancelled')for(const [token,binding]of pinEpochs)
        if(binding.reservationId===row.reservationId){binding.detach();pinEpochs.delete(token);}
        return bridge.note(row.sessionId,row.kind,row);}});
    try{await pinHost.initialize();pinReady=true;}catch(error){pinError=codeOf(error);}
  })():Promise.resolve();
  bridge.attachHost({
    hasSession:id=>!!liveState(id)&&dispatchAllowed(id),
    sessions:()=>[...states.values()].filter(active).map(state=>({id:state.agent.id,label:state.agent.id})),
    ready:()=>pinReady&&!stopping&&![...states.values()].some(state=>active(state)
      &&(state.agent.status!=='idle'||state.agent.inbox.hasPending||pinHost.isPinTurn(state.agent.id))),
    async request(purpose,input,options){await pinInitialization;
      if(!pinReady)throw Error(pinError??'cmcp_pin_host_not_configured');
      const state=liveState(options.dispatch?.target?.sessionId);if(!state||!dispatchAllowed(state.agent.id))throw Error('cmcp_pin_target_not_authorized');
      const epoch=state.epoch,canAttempt=async()=>targetGuard(state,epoch)&&await options.canAttempt();
      const generated=await pinHost.request(purpose,input,{...options,canAttempt});
      if(!targetGuard(state,epoch)||await options.canAttempt()===false||options.signal?.aborted)throw Error('cmcp_pin_target_authorization_changed');
      const token=generated.hostDelivery.token,remove=()=>{const binding=pinEpochs.get(token);binding?.detach();pinEpochs.delete(token);};
      options.signal?.addEventListener('abort',remove,{once:true});
      pinEpochs.set(token,{state,epoch,reservationId:options.dispatch.reservation.id,detach:()=>options.signal?.removeEventListener('abort',remove)});return generated;},
    async present(input){const binding=pinEpochs.get(input.hostDelivery?.token);if(!binding)throw Error('cmcp_pin_delivery_authorization_missing');
      try{return await pinHost.present({...input,canPresent:async()=>targetGuard(binding.state,binding.epoch)&&await input.canPresent()});}
      finally{binding.detach();pinEpochs.delete(input.hostDelivery.token);}}
  });
  const report=async(state,error)=>{const code=codeOf(error);if(state)state.error={code,at:new Date().toISOString()};
    if(state?.everEnabled)await bridge.note(state.agent.id,'cmcp_native_error',{code}).catch(()=>{});};
  // 對話加入與共用控制分離；只有兩層都允許，才取得本輪正文或提供 CMCP 材料。
  // 查核失敗時保留介面錯誤 metadata，普通宿主直接繼續，不注入失敗提示正文。
  const enhancementStamp=async state=>{
    if(!active(state))return null;const epoch=state.epoch;
    try{const controls=(await bridge.status()).controlConfiguration;
      return active(state)&&state.epoch===epoch&&controls.effective.enabled&&!controls.effective.clean
        ?{epoch,generation:controls.generation}:null;
    }catch(error){await report(state,error);return null;}
  };
  const stampValid=async(state,stamp)=>{const current=await enhancementStamp(state);
    return !!stamp&&!!current&&current.epoch===stamp.epoch&&current.generation===stamp.generation;};
  const queue=(state,operation)=>{const next=(queues.get(state.agent.id)??Promise.resolve()).then(operation);
    queues.set(state.agent.id,next.catch(error=>report(state,error)));return next;};
  const schedule=(state,operation)=>{void queue(state,operation).catch(()=>{});};
  const drain=async()=>{await Promise.all(queues.values());};
  const attachLifecycle=state=>{if(state.cleanupRegistered)return;state.cleanupRegistered=true;
    state.agent.ctx.effect(()=>async()=>{state.optedIn=false;state.epoch++;pinHost?.cancel({sessionId:state.agent.id,reason:'cmcp_session_unloaded'});invalidateSkills();await queues.get(state.agent.id);
      await bridge.releaseSession(state.agent.id);states.delete(state.agent.id);},'cmcp-native.session-runtime');};
  const status=async(state,operation='status',extra={})=>{
    const full=await bridge.status(),enabled=active(state)&&full.controlConfiguration.effective.enabled&&!full.controlConfiguration.effective.clean;
    const enhancementBlockedReasons=[...(!active(state)?['session_not_enabled']:[]),
      ...(!full.controlConfiguration.effective.enabled?['shared_enhancement_off']:[]),
      ...(full.controlConfiguration.effective.clean?['shared_clean']:[])];
    // 未獲此 Session 的授權時，只提供控制 metadata，不輸出其他 Session 的來源材料。
    const snapshot=enabled?full:{kind:full.kind,modelCalls:0,scopeId:full.scopeId,
      controlConfiguration:full.controlConfiguration,sourceAuthorization:full.sourceAuthorization};
    return {kind:'cmcp_desktop_response',contractVersion:CONTROL_CONTRACT_VERSION,operation,enabled,optedIn:!!state?.optedIn,sessionId:state?.agent.id??null,workspaceRoot,scopeId:config.scopeId,
      sessionAuthorization:{scope:'session',sessionId:state?.agent.id??null,optedIn:!!state?.optedIn},
      sharedControlScope:{scope:'workspace',scopeId:config.scopeId},enhancementBlockedReasons,
      saveScope:'只保存此工作區中，逐一明確啟用的 Session 之後提交的 User／Assistant 文字與獲授權 PNG／JPEG 原件；不匯入其他既有對話。',
      mediaCapture:promptOriginals?.status()??{available:false,reason:mediaCaptureError??'official_prompt_hook_unavailable'},
      mediaPreview:{ready:mediaRpcReady,error:mediaRpcError},
      destinations:enabled?[...states.values()].filter(active).map(s=>({scopeId:config.scopeId,sessionId:s.agent.id,label:s.agent.id,
        available:!!liveState(s.agent.id)&&dispatchAllowed(s.agent.id),optedIn:true})):[],
      pinHost:{ready:pinReady,error:pinError,configured:typeof config.llmModulePath==='string',
        dispatchSessionIds:config.dispatchSessionIds??null,...pinHost?.status()},
      snapshot,...(state?.error?{lastError:state.error}:{}),...extra};
  };
  const result=(kind,value)=>({kind,text:JSON.stringify(value)});
  const command=async({agent,rawInput='',signal})=>{
    const state=stateFor(agent),input=rawInput.trim();let parsed=/^(\S+)(?:\s+([\s\S]*))?$/u.exec(input),operation=parsed?.[1]||'help';
    try{
      checkSignal(signal);if(!state)throw Error('cmcp_workspace_mismatch');
      if(['on','off'].includes(operation)&&parsed?.[2])throw Error('cmcp_unexpected_arguments');
      attachLifecycle(state);
      const authorizationSequence=['on','off'].includes(operation)?++state.authorizationSequence:null;
      if(operation==='off'){state.optedIn=false;state.epoch++;state.skillPublished=false;
        state.controlOptions.clear();
        promptOriginals?.clear(agent.id);
        pinHost?.cancel({sessionId:agent.id,reason:'cmcp_session_off'});invalidateSkills();}
      return await queue(state,async()=>{
        checkSignal(signal);
        const currentSnapshot=await bridge.status(),controlContext={scopeId:config.scopeId,sessionId:agent.id,capabilities:{ui:true,pinCreate:pinReady,pinChange:pinReady}};
        if(['sources','time','buffer','pins','read','original','media-list','pin','pin-time','pin-cancel','pin-complete'].includes(operation)&&!active(state))throw Error('cmcp_session_not_enabled');
        if(['sources','time','buffer','pins','read','original','media-list','pin','pin-time','pin-cancel','pin-complete'].includes(operation)
          &&(!currentSnapshot.controlConfiguration.effective.enabled||currentSnapshot.controlConfiguration.effective.clean))throw Error('cmcp_shared_protection');
        const prepared=state.controlOptions.resolve(input,currentSnapshot,controlContext);operation=prepared.operation;
        parsed=[input,operation,prepared.payload?JSON.stringify(prepared.payload):undefined];
        if(['help','menu'].includes(operation))return result('success',await status(state,operation,{menu:controlMenu(controlContext)}));
        if(operation==='ui')return result('success',await status(state,operation,{uiPreference:prepared.uiPreference}));
        if(['sources','pins','buffer','time'].includes(operation)){
          const final=await status(state,operation);checkSignal(signal);
          if(!final.enabled||final.snapshot.controlConfiguration.generation!==currentSnapshot.controlConfiguration.generation){
            state.controlOptions.clear();throw Error('cmcp_source_authorization_changed');
          }
          return result('success',{...final,...(prepared.choices?{choices:prepared.choices}:{})});
        }
        if(operation==='clear-buffer'){
          if(!active(state))throw Error('cmcp_session_not_enabled');checkSignal(signal);
          const controlResult=await bridge.operate({...prepared.payload,action:'clearBuffer'});
          return result('success',await status(state,operation,{controlResult}));
        }
        if(operation==='retry-registration'){
          if(!active(state))throw Error('cmcp_session_not_enabled');
          const epoch=state.epoch,guard=()=>active(state)&&state.epoch===epoch&&!signal?.aborted;
          checkSignal(signal);
          const recoveryResult=await bridge.operate({...prepared.payload,action:'recover',sessionGuard:guard});
          checkSignal(signal);if(!guard())throw Error('cmcp_source_authorization_changed');
          return result('success',await status(state,operation,{recoveryResult}));
        }
        if(operation==='on'||operation==='off'){
          if(operation==='off'){state.optedIn=false;state.epoch++;state.skillPublished=false;
            pinHost?.cancel({sessionId:agent.id,reason:'cmcp_session_off'});invalidateSkills();}
          const before=await bridge.status();checkSignal(signal);
          if(operation==='on'&&authorizationSequence!==state.authorizationSequence)throw Error('cmcp_session_authorization_superseded');
          if(operation==='on'&&active(state)){
            await bridge.note(agent.id,'explicit_UI_command',{operation,binding:{scopeId:config.scopeId,sessionId:agent.id,activationEpoch:state.epoch},status:'already_enabled'});
            return result('success',await status(state,operation));
          }
          if(state.binding)await bridge.cancel(agent.id,operation==='off'?'cmcp_session_off':'cmcp_session_reconfigured',state.binding);
          state.binding=null;
          // 加入／退出只改本對話授權。初始預設由 Runtime 設定提供，既存共用控制不因加入而重設。
          checkSignal(signal);
          if(operation==='on'&&authorizationSequence!==state.authorizationSequence)throw Error('cmcp_session_authorization_superseded');
          if(operation==='on'){state.optedIn=true;state.everEnabled=true;state.epoch++;state.skillPublished=false;state.error=null;invalidateSkills();}
          state.received.clear();state.finals.clear();
          await bridge.note(agent.id,'explicit_UI_command',{operation,workspaceRoot,
            binding:{scopeId:config.scopeId,sessionId:agent.id,activationEpoch:state.epoch},
            saveUser:before.controlConfiguration.effective.saveUser,saveAssistant:before.controlConfiguration.effective.saveAssistant});
          if(operation==='on')await bridge.sessionAvailable(agent.id);
          return result('success',await status(state,operation));
        }
        if(operation==='pin-create'||operation==='pin-change'){
          if(!active(state))throw Error('cmcp_session_not_enabled');
          if(!parsed?.[2])throw Error('cmcp_explicit_pin_request_required');
          const request=JSON.parse(parsed[2]),allowed=operation==='pin-create'?['scopeId','generation','sessionId','sourceIds','dueAt']:['scopeId','generation','pinId','expectedRevision','change','dueAt'];
          if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!allowed.includes(k))
            ||request.scopeId!==config.scopeId||typeof request.generation!=='string')throw Error('cmcp_explicit_pin_request_required');
          if(operation==='pin-create'){
            if(!liveState(request.sessionId)||!dispatchAllowed(request.sessionId)||!Array.isArray(request.sourceIds)||!request.sourceIds.length
              ||request.sourceIds.some(id=>typeof id!=='string'||!id)||new Set(request.sourceIds).size!==request.sourceIds.length
              ||!Object.hasOwn(request,'dueAt'))throw Error('cmcp_explicit_pin_source_and_target_required');
          }else{
            const destination=(await bridge.destinations()).get(request.pinId);
            if(!destination||destination.scopeId!==config.scopeId||destination.sessionId!==agent.id
              ||!Number.isSafeInteger(request.expectedRevision)||!['schedule','cancel','complete'].includes(request.change))throw Error('cmcp_pin_target_mismatch');
          }
          const epoch=state.epoch;checkSignal(signal);
          const pinResult=await bridge.operate({...request,action:operation==='pin-create'?'pinCreate':'pinChange'});
          if(!active(state)||state.epoch!==epoch)throw Error('cmcp_source_authorization_changed');
          state.error=null;await bridge.note(agent.id,'explicit_UI_command',{operation,pinId:pinResult.result?.pin?.pinId??request.pinId??null,
            sourceIds:request.sourceIds??null,targetSessionId:request.sessionId??agent.id,change:request.change??null});
          return result('success',await status(state,operation,{pinResult}));
        }
        if(operation==='controls'){
          if(!active(state))throw Error('cmcp_session_not_enabled');
          if(!parsed?.[2])throw Error('cmcp_shared_control_request_required');
          const request=JSON.parse(parsed[2]);
          if(!request||typeof request!=='object'||Array.isArray(request)
            ||Object.keys(request).some(k=>!['scopeId','generation','patch'].includes(k))
            ||request.scopeId!==config.scopeId||typeof request.generation!=='string'
            ||!request.patch||typeof request.patch!=='object'||Array.isArray(request.patch)||!Object.keys(request.patch).length)
            throw Error('cmcp_explicit_shared_control_required');
          checkSignal(signal);
          const controlResult=await bridge.operate({...request,action:'controls'});state.error=null;invalidateSkills();
          await bridge.note(agent.id,'explicit_UI_command',{operation,workspaceRoot,scopeId:config.scopeId,
            generationBefore:request.generation,generationAfter:controlResult.controls.generation,patch:request.patch});
          return result('success',await status(state,operation,{controlResult}));
        }
        if(operation==='media-list'){
          if(!active(state))throw Error('cmcp_session_not_enabled');
          const input=JSON.parse(parsed?.[2]??'null'),allowed=['pointer','evidenceHash'];
          if(!input||Object.keys(input).some(k=>!allowed.includes(k))||input.pointer?.scopeId!==config.scopeId)throw Error('cmcp_media_request_invalid');
          const epoch=state.epoch,guard=()=>active(state)&&state.epoch===epoch;checkSignal(signal);
          const media=await bridge.mediaList(input,guard);checkSignal(signal);
          if(!guard())throw Error('cmcp_source_authorization_changed');
          return result('success',{kind:'cmcp_desktop_response',operation,enabled:true,sessionId:agent.id,
            mediaList:media});
        }
        if(operation==='original'){
          if(!active(state))throw Error('cmcp_session_not_enabled');
          if(!parsed?.[2])throw Error('cmcp_original_request_required');
          const source=JSON.parse(parsed[2]);
          if(source?.pointer?.scopeId!==config.scopeId)throw Error('cmcp_original_scope_mismatch');
          const epoch=state.epoch;checkSignal(signal);const original=await bridge.original(source);checkSignal(signal);
          if(!active(state)||state.epoch!==epoch)throw Error('cmcp_source_authorization_changed');
          return result('success',await status(state,operation,{original}));
        }
        return result('success',await status(state));
      });
    }catch(error){await report(state,error);
      // 操作失敗後仍沿正式唯讀入口顯示目前控制；無法讀回才明示未知，不把失敗當成已停用或空集合。
      if(state)try{return result('error',await status(state,operation,{error:{code:codeOf(error)}}));}catch{}
      return result('error',{kind:'cmcp_desktop_response',contractVersion:CONTROL_CONTRACT_VERSION,sessionId:state?.agent.id??null,operation,enabled:null,optedIn:!!state?.optedIn,
        workspaceRoot,scopeId:config.scopeId,snapshot:null,error:{code:codeOf(error)},saveScope:'尚未確認有效來源或保存結果。'});}
  };
  ctx.commands.register({name:'cmcp',description:'CMCP 本對話授權、正式狀態及明示工作區共用控制。',
    input:{hint:'help|on|off|sources|read|buffer|pins|set|dnd|ui'},handler:command});

  const candidate={name:'cmcp-continuity',description:'沿獲授權的原文、角色、版本與原時間接續對話。',
    invocation:{modelInvocable:true,userInvocable:true},provider:'cmcp-desktop-native',source:'workspace',
    resourceBase:{kind:'directory',path:path.dirname(skillPath)},rank:250,locator:pathToFileURL(skillPath)};
  const skillAllowed=async options=>sameWorkspace(options?.cwd)&&!!await enhancementStamp(states.get(options?.scope?.id));
  const provider={name:candidate.provider,
    async list(options){checkSignal(options?.signal);return await skillAllowed(options)?[candidate]:[];},
    async get(offered,options){checkSignal(options?.signal);if(!sameWorkspace(options?.cwd)||offered.name!==candidate.name)return undefined;
      const state=states.get(options?.scope?.id),stamp=await enhancementStamp(state);if(!stamp)return undefined;
      const content=await fs.readFile(skillPath,'utf8');checkSignal(options?.signal);if(!await stampValid(state,stamp))return undefined;
      return {name:candidate.name,description:candidate.description,invocation:candidate.invocation,provider:candidate.provider,
        source:candidate.source,resourceBase:candidate.resourceBase,content};}};
  ctx.skills.registerProvider(control=>{invalidateSkills=control.invalidate;return provider;});
  const toolNames=['cmcp_find_history','cmcp_open_history','cmcp_read_history'];
  const tools=[
    {name:toolNames[0],description:'取得已授權歷史的有界導航與選取協定；導航不是已讀原文。',parameters:object()},
    {name:toolNames[1],description:'依正式導航協定凍結必要來源集合，再沿正式 reader 分頁閱讀。',parameters:object({navigationTicket:string,selectionJson:string},['navigationTicket','selectionJson'])},
    {name:toolNames[2],description:'正式閱讀集合的下一頁，保留原角色、時間、版本與覆蓋。',parameters:object({ticket:string},['ticket'])}
  ];
  for(const tool of tools)ctx.effect(()=>ctx.tools.register({...tool,
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(projectHarnessToolResult(value,publishedProtocols))}]},
    async execute(args,exec){const state=stateFor(exec.agent);if(!active(state))throw Error('cmcp_session_not_enabled');
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(tool.parameters.properties,k))
        ||tool.parameters.required.some(k=>typeof args[k]!=='string'))throw Error('cmcp_invalid_tool_arguments');
      const epoch=state.epoch;checkSignal(exec.signal);await queues.get(exec.agent.id);
      if(!active(state)||state.epoch!==epoch)throw Error('cmcp_source_authorization_changed');
      try{const value=await bridge.tool(exec.agent.id,tool.name,args,exec.signal);checkSignal(exec.signal);
        if(!active(state)||state.epoch!==epoch)throw Error('cmcp_source_authorization_changed');return value;
      }catch(error){await report(state,error);throw error;}}}));

  for(const tool of [
    {name:'cmcp_list_images',description:'先正式讀取 User 原文頁，使用該頁回傳的 mediaSourceRef 作為 sourceRef，再列出來源圖片原件與原時間；描述不代替圖片。',parameters:object({sourceRef:string},['sourceRef'])},
    {name:'cmcp_read_image',description:'使用正式原文頁回傳的 mediaSourceRef 作為 sourceRef，依媒體身分核對圖片原件，沿官方附件接點提供給目前模型；不能把文字說明冒稱看圖。',parameters:object({sourceRef:string,mediaId:string},['sourceRef','mediaId'])}
  ])ctx.effect(()=>ctx.tools.register({...tool,
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[
      {type:'text',text:JSON.stringify({...value,image:undefined})},...(value.image?[{type:'image',attachment:value.image}]:[])]},
    async execute(args,exec){const state=stateFor(exec.agent);if(!active(state))throw Error('cmcp_session_not_enabled');
      if(!args||Object.keys(args).some(k=>!Object.hasOwn(tool.parameters.properties,k))||tool.parameters.required.some(k=>typeof args[k]!=='string'))throw Error('cmcp_invalid_tool_arguments');
      const epoch=state.epoch,guard=()=>active(state)&&state.epoch===epoch&&!exec.signal?.aborted;
      await queues.get(exec.agent.id);if(!guard())throw Error('cmcp_source_authorization_changed');
      try{const value=await bridge.mediaTool(exec.agent.id,tool.name,args,guard);if(!guard())throw Error('cmcp_source_authorization_changed');
        if(tool.name==='cmcp_list_images')return value;
        const {content,...metadata}=value;
        const image=await ctx.attachments.saveImage({data:content,mediaType:metadata.mimeType,name:metadata.filename});
        // 這是材料準備事件；journal 等待之後才作最終來源／控制核驗。
        // 不把準備完成冒稱模型已取得，也不在最後核驗後再等待 journal。
        await bridge.note(exec.agent.id,'media_model_material',{mediaId:metadata.mediaId,sourcePointer:metadata.parent.sourcePointer,
          originalSha256:metadata.sha256,image,status:'prepared_pending_final_validation'});
        await bridge.validate(exec.agent.id);
        const verified=await bridge.mediaTool(exec.agent.id,tool.name,args,guard);
        if(verified.mediaId!==metadata.mediaId||verified.sha256!==metadata.sha256)throw Error('cmcp_media_source_changed');
        if(!guard())throw Error('cmcp_source_authorization_changed');
        return {metadata,image,originalSha256:metadata.sha256,derivation:'official_normalized_model_image',modelCalls:0};
      }catch(error){await report(state,error);throw error;}}
  }));
  ctx.on('agent/created',({agent})=>{const state=stateFor(agent);if(state)attachLifecycle(state);});
  ctx.on('agent/inbox/inserted',({agent,message})=>{const state=stateFor(agent);if(!active(state)||message.source?.kind!=='user')return;
    const epoch=state.epoch,receivedAt=receivedTimes.get(key(agent.id,message.id))??new Date().toISOString();
    schedule(state,async()=>{if(!active(state)||state.epoch!==epoch||!await enhancementStamp(state))return;
      const images=(message.content??[]).filter(b=>b.type==='image'),captured=images.length?await promptOriginals?.take(agent.id,message.source.rpcId):null;
      if(images.length&&captured?.status!=='available')await report(state,Error('cmcp_image_original_unavailable'));
      const attachments=(captured?.images??[]).map((image,index)=>({filename:image.originalName,mimeType:image.mediaType,bytes:image.data,hostRef:images[index]?.attachment??null}));
      try{const result=await bridge.receive(agent.id,message.id,textOf(message),receivedAt,attachments,()=>active(state)&&state.epoch===epoch);
        if(active(state)&&state.epoch===epoch&&result.capture?.status!=='disabled')state.received.set(message.id,{epoch,receivedAt});}
      finally{for(const image of captured?.images??[])image.data.fill(0);}});});
  ctx.on('agent/inbox/claimed',({agent,message,turn})=>{const state=stateFor(agent);if(!active(state)||message.source?.kind!=='user')return;
    const epoch=state.epoch;schedule(state,async()=>{const received=state.received.get(message.id);
      if(!active(state)||state.epoch!==epoch||!received||received.epoch!==epoch||!await enhancementStamp(state))return;
      const claimed=await bridge.claim(agent.id,message.id,turn);if(!claimed.context){await bridge.cancel(agent.id,'cmcp_shared_protection');return;}
      state.binding={userMessageId:message.id,harnessTurn:turn,activationEpoch:epoch};state.error=null;});});
  ctx.on('agent/inbox/discarded',({agent,message})=>{const state=stateFor(agent);if(!state?.received.has(message.id))return;
    state.received.delete(message.id);schedule(state,()=>bridge.discard(agent.id,message.id));});
  ctx.on('agent/pre-step',async({agent,signal},next)=>{
    const state=stateFor(agent);if(!active(state))return next();
    if(pinHost?.isPinTurn(agent.id))return next();
    await queues.get(agent.id);const stamp=await enhancementStamp(state);if(!stamp)return next();
    const decision=await next();if(decision.kind!=='enter'||!active(state)||signal?.aborted)return decision;
    const epoch=state.epoch,contexts=[];
    try{
      if(!state.binding||state.binding.activationEpoch!==epoch)throw Error('cmcp_no_authorized_current_input');
      await bridge.validate(agent.id);
      const full=await bridge.requestContext(agent.id);if(!full)throw Error('cmcp_no_valid_source_context');
      if(!state.skillPublished){
        const skill=await ctx.skills.get(candidate.name,{cwd:agent.session.header.cwd,scope:agent,signal});
        if(!skill||skill.provider!==candidate.provider||typeof skill.content!=='string')throw Error('cmcp_required_skill_missing');
        await bridge.validate(agent.id);checkSignal(signal);
        await bridge.note(agent.id,'skill_loaded',{name:candidate.name,provider:skill.provider,source:skill.source,
          origin:'official_skills_api',projectionHash:sha(skill.content),projectionBytes:Buffer.byteLength(skill.content)});
        contexts.push({id:randomUUID(),role:'user',source:{kind:'cmcp-required-skill',name:candidate.name,
          authority:'workspace_host_skill_not_user_decision',scopeId:config.scopeId,activationEpoch:epoch},content:[{type:'text',text:skill.content}]});
      }
      const context=projectHarnessTimeContext(full,publishedContexts.has(full.contextId));
      contexts.push({id:randomUUID(),role:'user',source:{kind:'cmcp-time-context',scopeId:config.scopeId,activationEpoch:epoch},content:[{type:'text',text:JSON.stringify(context)}]});
      if(!active(state)||state.epoch!==epoch||!await stampValid(state,stamp))return decision;
      return {...decision,messages:[...decision.messages,...contexts]};
    }catch(error){await report(state,error);if(!active(state)||state.epoch!==epoch||!await stampValid(state,stamp))return decision;
      return {...decision,messages:[...decision.messages,
      {id:randomUUID(),role:'user',source:{kind:'cmcp-source-status',authority:'host_observation_not_user_decision'},
        content:[{type:'text',text:JSON.stringify({kind:'cmcp_source_unavailable',code:codeOf(error),
          notice:'CMCP 本輪沒有提供有效來源或成功保存的確認。普通宿主聊天繼續；不得宣稱 CMCP 原文已取得，也不得把有限失敗說成全部歷史不存在。'})}]}]};}
  });
  ctx.on('session/event',(session,event)=>{const state=states.get(session.id);if(!active(state))return;
    if(event.type==='agent/inbox/spliced')for(const message of event.data.inserted??[])if(message.source?.kind==='user')receivedTimes.set(key(session.id,message.id),new Date(event.time).toISOString());
    if(event.type==='user/message'&&event.data.source?.kind==='cmcp-required-skill'&&event.data.source.activationEpoch===state.epoch)state.skillPublished=true;
    if(event.type==='user/message'&&event.data.source?.kind==='cmcp-time-context')try{const value=JSON.parse(textOf(event.data));if(value.contextId)publishedContexts.add(value.contextId);}catch{}
    if(event.type==='tool/result')try{const value=JSON.parse(textOf(event.data.message));if(value.pageProtocol?.id===value.pageProtocolRef)publishedProtocols.add(value.pageProtocolRef);}catch{}
    if(pinHost?.isPinTurn(session.id))return;
    if(event.type==='assistant/message'&&!event.data.interrupted&&event.data.message?.role==='assistant'){
      const epoch=state.epoch,text=textOf(event.data.message),messageId=event.data.message.id,receivedAt=new Date(event.time).toISOString();
      if(text.trim())schedule(state,async()=>{
        if(!active(state)||state.epoch!==epoch||!await enhancementStamp(state))return;
        const binding=state.binding,previous=state.finals.get(event.data.turn);
        if(!binding||binding.activationEpoch!==epoch||binding.harnessTurn!==event.data.turn)throw Error('cmcp_no_authorized_current_input');
        if(previous?.failed&&previous.binding===binding)return;
        try{await bridge.appendAssistant(session.id,messageId,text,receivedAt,binding,()=>active(state)&&state.epoch===epoch&&state.binding===binding);
          state.finals.set(event.data.turn,{messageId,text,receivedAt,binding});
        }catch(error){state.finals.set(event.data.turn,{failed:true,binding});throw error;}
      });}
    if(event.type==='turn/end'){
      const binding=state.binding,epoch=state.epoch;schedule(state,async()=>{
        const final=state.finals.get(event.data.turn);state.finals.delete(event.data.turn);if(!binding||binding.harnessTurn!==event.data.turn)return;
        if(!active(state)||state.epoch!==epoch)return;
        try{
          if(final?.failed&&final.binding===binding)return;
          if(!await enhancementStamp(state))await bridge.cancel(session.id,'cmcp_shared_protection',binding);
          else if(event.data.reason.kind==='completed'&&final?.binding===binding)await bridge.complete(session.id,final.messageId,final.text,final.receivedAt,binding,()=>active(state)&&state.epoch===epoch&&state.binding===binding);
          else await bridge.cancel(session.id,'native_turn_'+event.data.reason.kind,binding);
        }finally{
          // 取消若失敗仍保留原 binding，供明示 OFF 重試；不能把仍 running 的票遺留成無主工作。
          if(state.binding===binding&&bridge.turns.get(session.id)?.state!=='running')state.binding=null;
        }
      });
    }
  });
  ctx.on('agent/status',({agent})=>{const state=states.get(agent.id);if(active(state)&&agent.status==='idle')
    schedule(state,()=>bridge.sessionAvailable(agent.id));});
  ctx.on('session/flush',async session=>{await queues.get(session.id);});
  ctx.on('llm/stream',async function*(request,next){const state=states.get(request.sessionId);
    if(active(state)&&await enhancementStamp(state))try{
      const serialized=JSON.stringify(request.messages);
      await bridge.note(request.sessionId,'model_input',{provider:request.provider,model:request.model,projectionHash:sha(serialized),projectionBytes:Buffer.byteLength(serialized),
        messages:projectModelInputMetadata(request.messages),bodyRetention:'metadata_only'});
    }catch(error){await report(state,error);}
    yield* next();
  });
  const close=async()=>{if(stopping)return;stopping=true;for(const state of states.values()){state.optedIn=false;state.epoch++;}
    promptOriginals?.dispose();invalidateSkills();await mediaRpcInitialization;await mediaRpcDispose?.();await pinInitialization;await pinHost?.close();for(const binding of pinEpochs.values())binding.detach();pinEpochs.clear();await drain();await bridge.close();};
  ctx.effect(()=>close,'cmcp-native.runtime');
  return {bridge,command,provider,states,drain,close,pinInitialization,mediaRpcInitialization,get pinHost(){return pinHost;}};
}
