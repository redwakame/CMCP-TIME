import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {callSharedProject,MODEL_TEXT_PROFILE} from '../../shared-project/client.mjs';
import {projectHarnessTimeContext,projectHarnessToolResult} from '../runtime-bridge.mjs';

export const name='cmcp-shared-project-harness';
export const inject=['agents','tools','sessions','skills','llm'];
export const readCapabilities=MODEL_TEXT_PROFILE;
const hash=value=>createHash('sha256').update(value).digest('hex');
const textOf=message=>(message?.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('');
const codeOf=error=>/^[a-z][a-z0-9_]+$/.test(error?.message??'')?error.message:'shared_harness_operation_failed';
const checkSignal=signal=>{if(signal?.aborted)throw Error('shared_harness_cancelled');};
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const string={type:'string'};

export function validateSharedHarnessConfig(config){
  if(config?.kind!=='cmcp_shared_harness_config'||config.version!==1||config.hostId!=='harness'
    ||!['projectId','agentId','profileName','workspaceRoot','artifactRoot','skillPath'].every(key=>typeof config[key]==='string'&&config[key])
    ||!['workspaceRoot','artifactRoot','skillPath'].every(key=>path.isAbsolute(config[key]))
    ||!Array.isArray(config.sessionIds)||config.sessionIds.length<1||config.sessionIds.length>8
    ||new Set(config.sessionIds).size!==config.sessionIds.length||config.sessionIds.some(id=>typeof id!=='string'||!id)
    ||!config.route||!['provider','model'].every(key=>typeof config.route[key]==='string'&&config.route[key])
    ||!config.connection||typeof config.connection.pipe!=='string'
    ||!['controlAuthFile','readAuthFile'].every(key=>typeof config.connection[key]==='string'&&path.isAbsolute(config.connection[key])))throw Error('shared_harness_explicit_configuration_required');
  return structuredClone(config);
}

/** 只接入明列合成 Session；其他 Agent 保留宿主原本行為。 */
export function createSharedHarnessHost(ctx,rawConfig,{call=callSharedProject}={}){
  const config=validateSharedHarnessConfig(rawConfig),states=new Map(),receivedTimes=new Map();
  const workspaceRoot=path.resolve(config.workspaceRoot),skillPath=path.resolve(config.skillPath);
  const profile=ctx.get?.('profileContext')??ctx.profileContext;
  if(profile?.name!==config.profileName)throw Error('shared_harness_profile_mismatch');
  const matches=agent=>agent?.id===agent?.session?.id&&config.sessionIds.includes(agent.id)
    &&typeof agent.session.header?.cwd==='string'&&path.isAbsolute(agent.session.header.cwd)&&path.resolve(agent.session.header.cwd)===workspaceRoot;
  let closed=false,invalidateSkills=()=>{};
  const active=state=>!closed&&!!state?.joined&&!state.revoked&&matches(state.agent)&&ctx.agents.get(state.agent.id)===state.agent;
  const note=async(kind,value={})=>{await fs.mkdir(config.artifactRoot,{recursive:true});await fs.appendFile(path.join(config.artifactRoot,'host-events.jsonl'),JSON.stringify({at:new Date().toISOString(),kind,projectId:config.projectId,hostId:'harness',...value})+'\n');};
  const request=async(state,operation,args={},role='controller')=>{
    const value=await call({connection:{pipe:config.connection.pipe,authFile:role==='controller'?config.connection.controlAuthFile:config.connection.readAuthFile},role,
      request:{projectId:config.projectId,hostId:'harness',agentId:config.agentId,workspace:workspaceRoot,sessionId:state.agent.id,
        ...(state.epoch?{epoch:state.epoch}:{}),requestId:randomUUID(),operation,args}});
    if(value?.epoch)state.epoch=value.epoch;
    return value;
  };
  const fail=async(state,error)=>{state.error=codeOf(error);await note('operation_failed',{sessionId:state.agent.id,code:state.error});};
  const queue=(state,operation)=>{const next=state.tail.then(operation);state.tail=next.catch(error=>fail(state,error));return next;};
  const schedule=(state,operation)=>{void queue(state,operation).catch(()=>{});};
  const closeState=async state=>{
    if(state.closeTask)return state.closeTask;
    state.closeTask=(async()=>{
      await state.tail;state.revoked=true;invalidateSkills();
      if(state.joined){
        // revoke 在服務端撤銷權限並關閉原 writer；失敗必須回報，不能假裝交接完成。
        try{await request(state,'revoke');state.joined=false;state.binding=null;
          await note('session_released',{sessionId:state.agent.id,epoch:state.epoch});
        }catch(error){
          if(codeOf(error)!=='shared_project_epoch_stale')throw error;
          const previousEpoch=state.epoch,status=await request(state,'status');
          const stillOwner=status.owner?.hostId==='harness'&&status.owner?.agentId===config.agentId&&status.owner?.sessionId===state.agent.id;
          if(status.epoch===previousEpoch||stillOwner)throw error;
          // 已交出的舊 epoch 只能確認狀態；不能拿新 epoch 重試 revoke 或 claim。
          state.joined=false;state.binding=null;
          await note('session_handoff_confirmed',{sessionId:state.agent.id,previousEpoch,epoch:status.epoch,owner:status.owner});
        }
      }
    })();return state.closeTask;
  };
  const candidate={name:'cmcp-continuity',description:'依正式原文、角色、原時間與版本接續獲授權的共用專案。',
    invocation:{modelInvocable:true,userInvocable:true},provider:name,source:'workspace',rank:250,
    resourceBase:{kind:'directory',path:path.dirname(skillPath)},locator:pathToFileURL(skillPath)};
  const provider={name,
    async list(options){checkSignal(options?.signal);const state=states.get(options?.scope?.id);return active(state)&&typeof options?.cwd==='string'&&path.resolve(options.cwd)===workspaceRoot?[candidate]:[];},
    async get(offered,options){checkSignal(options?.signal);const state=states.get(options?.scope?.id);
      if(!active(state)||offered.name!==candidate.name||typeof options?.cwd!=='string'||path.resolve(options.cwd)!==workspaceRoot)return undefined;
      const epoch=state.epoch,content=await fs.readFile(skillPath,'utf8');checkSignal(options.signal);
      if(!active(state)||state.epoch!==epoch)return undefined;
      return {...candidate,content};}
  };
  ctx.skills.registerProvider(control=>{invalidateSkills=control.invalidate;return provider;});
  const definitions=[
    {name:'cmcp_find_history',operation:'find',description:'取得已授權原文的正式有界導航；導航不是已讀原文。',parameters:schema()},
    {name:'cmcp_open_history',operation:'open',description:'沿正式導航選取並凍結閱讀集合。',parameters:schema({navigationTicket:string,selectionJson:string},['navigationTicket','selectionJson'])},
    {name:'cmcp_read_history',operation:'read',description:'逐頁正式閱讀，保留原角色、原時間、版本及覆蓋範圍。',parameters:schema({ticket:string},['ticket'])},
    {name:'cmcp_reading_progress',operation:'progress',description:'查核正式閱讀集合的已讀覆蓋與剩餘範圍。',parameters:schema({ticket:string},['ticket'])}
  ];
  if(definitions.length!==readCapabilities.operations.length||definitions.some((tool,index)=>tool.operation!==readCapabilities.operations[index]||tool.name!==readCapabilities.tools[index]))throw Error('shared_harness_profile_schema_mismatch');
  for(const tool of definitions)ctx.effect(()=>ctx.tools.register({name:tool.name,description:tool.description,parameters:tool.parameters,
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(projectHarnessToolResult(value))}]},
    async execute(args,exec){const state=states.get(exec.agent?.id);if(!active(state))throw Error('shared_harness_session_not_authorized');
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!Object.hasOwn(tool.parameters.properties,key))
        ||tool.parameters.required.some(key=>typeof args[key]!=='string'))throw Error('shared_harness_invalid_tool_arguments');
      await state.tail;checkSignal(exec.signal);if(!active(state)||!state.binding)throw Error('shared_harness_no_active_turn');
      if(state.toolResults>=128)throw Error('shared_harness_tool_evidence_capacity_exceeded');
      const epoch=state.epoch,result=await request(state,tool.operation,args,'model_read');checkSignal(exec.signal);
      if(!active(state)||state.epoch!==epoch)throw Error('shared_harness_authorization_changed');
      // 明列的合成 profile 每次只留一份實際投影；後續模型觀測仍只留雜湊。
      const projectedResult=projectHarnessToolResult(result),serialized=JSON.stringify(projectedResult),projectionBytes=Buffer.byteLength(serialized);
      if(projectionBytes>1048576||state.toolResultBytes+projectionBytes>8388608)throw Error('shared_harness_tool_evidence_capacity_exceeded');
      state.toolResults++;state.toolResultBytes+=projectionBytes;
      await note('formal_tool',{sessionId:state.agent.id,tool:tool.name,status:result?.status??null,ticket:result?.ticket??null,
        projectedResult,projectionHash:hash(serialized),projectionBytes});return result;}
  }));
  ctx.on('agent/created',async({agent})=>{
    if(!matches(agent))return;
    const state={agent,tail:Promise.resolve(),epoch:null,joined:false,revoked:false,binding:null,received:new Set(),committed:new Map(),skillPublished:false,error:null,toolResults:0,toolResultBytes:0};
    states.set(agent.id,state);
    const joined=await request(state,'join');state.joined=joined.joined===true;if(!state.joined)throw Error('shared_harness_session_not_authorized');
    try{await request(state,'claim');}catch(error){await request(state,'revoke').catch(()=>{});state.joined=false;throw error;}
    agent.ctx.effect(()=>()=>closeState(state),'cmcp-shared-project.session');invalidateSkills();
    await note('session_authorized',{sessionId:agent.id,epoch:state.epoch,authorization:'explicit_sdk_profile_session_allowlist',workspace:workspaceRoot,route:config.route});
  });
  ctx.on('agent/inbox/inserted',({agent,message})=>{
    const state=states.get(agent.id);if(!active(state)||message.source?.kind!=='user')return;
    schedule(state,async()=>{
      if(!active(state))return;
      const receivedAt=receivedTimes.get(JSON.stringify([agent.id,message.id]));
      if(!receivedAt)throw Error('shared_harness_user_time_unavailable');
      if(!Array.isArray(message.content)||message.content.some(block=>block.type!=='text'||typeof block.text!=='string'))throw Error('shared_harness_text_only');
      const text=textOf(message);if(Buffer.byteLength(text)>1048576)throw Error('shared_harness_message_capacity_exceeded');
      const result=await request(state,'receive',{messageId:message.id,text,receivedAt,revisionId:'r1'});
      if(result.capture?.status==='disabled')throw Error('shared_harness_capture_disabled');
      state.received.add(message.id);await note('user_saved',{sessionId:agent.id,messageId:message.id,receivedAt,bodyHash:hash(text),receipt:result.capture});
    });
  });
  ctx.on('agent/inbox/claimed',({agent,message,turn})=>{
    const state=states.get(agent.id);if(!active(state)||message.source?.kind!=='user')return;
    schedule(state,async()=>{
      if(!active(state)||!state.received.has(message.id))throw Error('shared_harness_user_not_saved');
      const result=await request(state,'claim-turn',{messageId:message.id,revisionId:'r1',harnessTurn:turn});
      if(!result.context)throw Error('shared_harness_context_unavailable');
      state.binding={userMessageId:message.id,userRevisionId:'r1',harnessTurn:turn};state.committed.clear();state.failed=false;state.error=null;
    });
  });
  ctx.on('agent/inbox/discarded',({agent,message})=>{const state=states.get(agent.id);if(state?.received.has(message.id))schedule(state,async()=>{
    const discardedActive=state.binding?.userMessageId===message.id;
    await request(state,'cancel',{userMessageId:message.id,userRevisionId:'r1',harnessTurn:discardedActive?state.binding.harnessTurn:null,reason:'official_inbox_discarded'});
    if(discardedActive)state.binding=null;state.received.delete(message.id);
  });});
  ctx.on('agent/pre-step',async({agent,signal},next)=>{
    const state=states.get(agent.id);if(!active(state))return next();
    await state.tail;const decision=await next();if(decision.kind!=='enter'||!active(state)||signal?.aborted)return decision;
    if(!state.binding||state.error)throw Error(state.error??'shared_harness_no_active_turn');
    const epoch=state.epoch,full=await request(state,'request-context'),contexts=[];
    if(!full)throw Error('shared_harness_context_unavailable');
    if(!state.skillPublished){const skill=await ctx.skills.get(candidate.name,{cwd:workspaceRoot,scope:agent,signal});
      if(skill?.provider!==name||typeof skill.content!=='string')throw Error('shared_harness_required_skill_missing');
      contexts.push({id:randomUUID(),role:'user',source:{kind:'cmcp-required-skill',name:candidate.name,authority:'workspace_host_skill_not_user_decision'},content:[{type:'text',text:skill.content}]});
      await note('skill_loaded',{sessionId:agent.id,name:candidate.name,origin:'official_skills_api',bodyHash:hash(skill.content),bytes:Buffer.byteLength(skill.content)});}
    contexts.push({id:randomUUID(),role:'user',source:{kind:'cmcp-time-context',authority:'host_observation_not_user_decision'},content:[{type:'text',text:JSON.stringify(projectHarnessTimeContext(full,false))}]});
    checkSignal(signal);if(!active(state)||state.epoch!==epoch)throw Error('shared_harness_authorization_changed');
    return {...decision,messages:[...decision.messages,...contexts]};
  });
  ctx.on('session/event',(session,event)=>{
    const state=states.get(session.id);if(!active(state))return;
    if(event.type==='agent/inbox/spliced')for(const message of event.data.inserted??[])if(message.source?.kind==='user'){
      const time=new Date(event.time).toISOString();receivedTimes.set(JSON.stringify([session.id,message.id]),time);
    }
    if(event.type==='user/message'&&event.data.source?.kind==='cmcp-required-skill')state.skillPublished=true;
    if(event.type==='assistant/message'&&!event.data.interrupted&&event.data.message?.role==='assistant'){
      const message=event.data.message,text=textOf(message),receivedAt=new Date(event.time).toISOString();if(!text.trim())return;
      schedule(state,async()=>{
        try{
        if(!active(state))return;if(state.failed)throw Error('shared_harness_partial_assistant_save');
        const binding=state.binding;if(!binding||binding.harnessTurn!==event.data.turn)throw Error('shared_harness_turn_mismatch');
        const value={messageId:message.id,text,receivedAt,revisionId:'r1',...binding},previous=state.committed.get(message.id);
        if(previous){if(JSON.stringify(previous)!==JSON.stringify(value))throw Error('shared_harness_assistant_identity_conflict');return;}
        if(state.committed.size>=64||Buffer.byteLength(text)>1048576)throw Error('shared_harness_message_capacity_exceeded');
        const receipt=await request(state,'append-assistant',value);state.committed.set(message.id,value);
          await note('assistant_saved',{sessionId:session.id,messageId:message.id,receivedAt,bodyHash:hash(text),receipt});
        }catch(error){state.failed=true;throw error;}
      });
    }
    if(event.type==='turn/end')schedule(state,async()=>{
      const binding=state.binding;if(!binding||binding.harnessTurn!==event.data.turn)return;
      if(!active(state))return;
      const last=[...state.committed.values()].at(-1);
      try{
        if(event.data.reason.kind==='completed'&&!state.failed&&last){await request(state,'finish',last);
          await note('turn_saved',{sessionId:session.id,harnessTurn:event.data.turn,committedMessages:state.committed.size});}
        else{await request(state,'cancel',{...binding,reason:state.failed?'shared_harness_partial_assistant_save':'official_turn_'+event.data.reason.kind});
          await note('turn_cancelled',{sessionId:session.id,harnessTurn:event.data.turn,reason:event.data.reason.kind,partial:state.failed});}
        state.binding=null;
      }catch(error){state.failed=true;throw error;}
    });
  });
  ctx.on('session/flush',async session=>{await states.get(session.id)?.tail;});
  ctx.on('llm/stream',async function*(request,next){const state=states.get(request.sessionId);
    if(active(state)){
      if(request.provider!==config.route.provider||request.model!==config.route.model)throw Error('shared_harness_model_route_mismatch');
      await note('model_request_metadata',{sessionId:request.sessionId,provider:request.provider,model:request.model,
        messages:request.messages.map(message=>({id:message.id,role:message.role,sourceKind:message.source?.kind??null,bodyHash:hash(textOf(message)),bytes:Buffer.byteLength(textOf(message))}))});
    }yield* next();
  });
  const close=async()=>{if(closed)return;for(const state of states.values())await closeState(state);closed=true;invalidateSkills();};
  ctx.effect(()=>close,'cmcp-shared-project.runtime');
  return {states,provider,close,drain:async()=>{await Promise.all([...states.values()].map(state=>state.tail));},
    initialize:()=>note('host_ready',{profileName:config.profileName,sessionIds:config.sessionIds,workspace:workspaceRoot,route:config.route,controllerExposedToModel:false})};
}

export async function apply(ctx,config){
  const host=createSharedHarnessHost(ctx,config);
  // Cordis 的 async apply 只能回傳空值或 disposer；控制物件不能當作 effect 回傳。
  ctx.provide('cmcpSharedHarnessHost',{projectId:config.projectId,profileName:config.profileName,readCapabilities});
  await host.initialize();
}
