import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {CmcpHarnessBridge,projectHarnessToolResult,projectHarnessTimeContext,within} from './runtime-bridge.mjs';
import {statusPage} from './status-page.mjs';
import {createPinHost} from './pin-host.mjs';

export const name='cmcp-continuity';
export const inject=['agents','tools','sessions','skills','llm'];
const textOf=message=>(message?.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('');
const names=['cmcp_find_history','cmcp_open_history','cmcp_read_history','skill'];
// tools.register 接受完整 JSON Schema；欄位 map 只屬 defineTool 的輸入格式。
const object=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'};
const key=(sessionId,messageId)=>JSON.stringify([sessionId,messageId]);
function assertArguments(schema,args){if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(name=>!Object.hasOwn(schema.properties,name))
  ||schema.required.some(name=>typeof args[name]!=='string')||Object.entries(args).some(([name,value])=>schema.properties[name].type==='string'&&typeof value!=='string'))throw Error('invalid_cmcp_tool_arguments');}

/** 使用官方事件與工具接口；未授權工具不會出現在此部署。 */
export function apply(ctx,config){
  let stopping=false;
  const bridge=new CmcpHarnessBridge(config),queues=new Map(),captures=new Map(),finals=new Map(),watchers=new Map(),ready=new Map(),receivedTimes=new Map(),bindings=new Map(),agents=new Map(),publishedContexts=new Set(),publishedProtocols=new Set(),publishedSkills=new Set();
  const pinHost=createPinHost({ctx,llmModulePath:config.llmModulePath??config.skillModulePath?.replace('/dsh-skill/','/dsh-llm/'),
    resolveAgent:async target=>{if(target.scopeId!==config.scopeId)throw Error('host_dispatch_scope_mismatch');const agent=agents.get(target.sessionId);if(!agent)throw Error('pin_destination_session_unavailable');return {agent,scopeId:config.scopeId};},
    record:row=>bridge.note(row.sessionId??'unknown','pin_host_event',row)});
  bridge.attachHost({request:(...args)=>pinHost.request(...args),present:(...args)=>pinHost.present(...args),
    hasSession:id=>agents.has(id),ready:()=>![...agents.values()].some(agent=>agent.status!=='idle'||agent.inbox.hasPending),
    sessions:()=>[...agents.values()].map(agent=>({id:agent.id,label:agent.session.header?.title??'對話 '+agent.id}))});
  const output={schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(projectHarnessToolResult(value,publishedProtocols))}]};
  const sequence=(id,fn)=>{const pending=(queues.get(id)??Promise.resolve()).then(fn);queues.set(id,pending.catch(async error=>{await bridge.note(id,'bridge_error',{code:error.message}).catch(()=>{});await bridge.cancel(id,'bridge_error').catch(()=>{});}));return pending;};
  const tools=[
    {name:names[0],description:'當問題需要前次或其他 Session 的原文時，取得已授權歷史的範圍導航與選取協定。這不是已讀全文；不要由導航推測答案。',parameters:object()},
    {name:names[1],description:'依 cmcp_find_history 回傳的 schema 與 input 選擇真正需要的範圍。selectionJson 是該協定的 JSON；真正歧義保留澄清。凍結集合後仍需正式分頁讀取。',parameters:object({navigationTicket:str,selectionJson:str},['navigationTicket','selectionJson'])},
    {name:names[2],description:'正式閱讀已開啟集合的下一頁原文，回傳原角色、版本、時間與累計覆蓋。未讀完不得宣稱全集已讀；只需材料已足也要明示範圍。',parameters:object({ticket:str},['ticket'])}
  ];
  for(const tool of tools)ctx.effect(()=>ctx.tools.register({...tool,output,execute:(args,exec)=>{assertArguments(tool.parameters,args);return bridge.tool(exec.agent.id,tool.name,args,exec.signal);}}));
  ctx.effect(()=>ctx.tools.guard(exec=>names.includes(exec.name)&&(exec.name!=='skill'||exec.arguments?.name==='cmcp-continuity')?undefined:'此部署只允許 CMCP 正式閱讀及指定 Skill'));
  ctx.on('agent/created',({agent})=>{agent.ctx.tools.restrict({allow:names.filter(name=>name!=='skill')});agents.set(agent.id,agent);
    ready.set(agent.id,sequence(agent.id,()=>bridge.sessionAvailable(agent.id)));
    // 官方 AgentLoop 在 machine.whenIdle 後 await scope.dispose；emit 型 disposed 事件不能承擔非同步回收。
    agent.ctx.effect(()=>async()=>{clearInterval(watchers.get(agent.id));watchers.delete(agent.id);await queues.get(agent.id);await bridge.releaseSession(agent.id);agents.delete(agent.id);},'cmcp-harness.session-runtime');});
  ctx.on('agent/inbox/inserted',({agent,message})=>{if(message.source?.kind!=='user')return;
    const messageKey=key(agent.id,message.id),receivedAt=receivedTimes.get(messageKey)??new Date().toISOString();
    ready.set(agent.id,sequence(agent.id,async()=>{const capture=await bridge.receive(agent.id,message.id,textOf(message),receivedAt);captures.set(messageKey,capture);}));});
  ctx.on('agent/inbox/claimed',({agent,message,turn})=>{if(message.source?.kind!=='user')return;
    ready.set(agent.id,sequence(agent.id,async()=>{const capture=await bridge.claim(agent.id,message.id,turn);captures.set(key(agent.id,message.id),capture);bindings.set(agent.id,{userMessageId:message.id,harnessTurn:turn});
      clearInterval(watchers.get(agent.id));let checking=false;
      if(capture.capture.hostTurn){const watcher=setInterval(async()=>{if(checking)return;checking=true;try{await bridge.validate(agent.id);}catch(error){agent.cancel({kind:'hook',reason:error.message});}finally{checking=false;}},500);watcher.unref();watchers.set(agent.id,watcher);}
    }));});
  ctx.on('agent/inbox/discarded',({agent,message})=>{if(message.source?.kind==='user')sequence(agent.id,()=>bridge.discard(agent.id,message.id));});
  ctx.on('agent/status',({agent,status})=>{if(!stopping&&status==='idle')sequence(agent.id,()=>bridge.sessionAvailable(agent.id));});
  ctx.on('agent/pre-step',async({agent,messages,signal},next)=>{await ready.get(agent.id);await queues.get(agent.id);if(signal.aborted)return {kind:'reject'};
    if(pinHost.isPinTurn(agent.id))return next();
    await bridge.validate(agent.id);const decision=await next();if(decision.kind!=='enter')return decision;
    const contexts=[],full=bindings.has(agent.id)?await bridge.requestContext(agent.id):null,context=projectHarnessTimeContext(full,publishedContexts.has(full?.contextId));
    if(full&&!publishedSkills.has(agent.id)){
      if(!config.skillModulePath)throw Error('cmcp_official_skill_module_required');
      const {renderSkillContent}=await import(pathToFileURL(within(bridge.root,config.skillModulePath)).href);
      const skill=await ctx.skills.get('cmcp-continuity',{cwd:agent.session.header.cwd,scope:agent,signal});
      if(!skill)throw Error('cmcp_required_skill_missing');await bridge.validate(agent.id);signal.throwIfAborted();
      const text=renderSkillContent(skill);contexts.push({id:randomUUID(),role:'user',source:{kind:'cmcp-required-skill',name:'cmcp-continuity',authority:'host_skill_not_user_decision'},content:[{type:'text',text}]});
    }
    if(context)contexts.push({id:randomUUID(),role:'user',source:{kind:'cmcp-time-context',form:'snapshot',sections:[{name:'CMCP 時間與來源',text:JSON.stringify(context)}]},content:[{type:'text',text:JSON.stringify(context)}]});
    return {...decision,messages:[...decision.messages,...contexts]};});
  ctx.on('session/event',(session,event)=>{
    if(event.type==='user/message'&&event.data.source?.kind==='cmcp-required-skill'){
      publishedSkills.add(session.id);sequence(session.id,()=>bridge.note(session.id,'skill_loaded',{name:'cmcp-continuity',success:true,origin:'official_skills_api',bytes:Buffer.byteLength(textOf(event.data))}));
    }
    if(event.type==='tool/result')try{const value=JSON.parse(textOf(event.data.message));if(value.pageProtocol?.id===value.pageProtocolRef)publishedProtocols.add(value.pageProtocolRef);}catch{}
    // 只有正式提交的 snapshot 才能供後續時間增量引用；pre-step 拒絕不算已發佈。
    if(event.type==='user/message'&&event.data.source?.kind==='cmcp-time-context'){
      try{const context=JSON.parse(textOf(event.data));if(context.kind==='cmcp_host_time_context'&&context.contextId)publishedContexts.add(context.contextId);}catch{}
    }
    if(event.type==='agent/inbox/spliced')for(const message of event.data.inserted)if(message.source?.kind==='user')receivedTimes.set(key(session.id,message.id),new Date(event.time).toISOString());
    if(event.type==='assistant/message'&&!event.data.interrupted){finals.set(key(session.id,event.data.turn),{message:event.data.message,turn:event.data.turn,receivedAt:new Date(event.time).toISOString()});}
    if(event.type==='turn/end')sequence(session.id,async()=>{const binding=bindings.get(session.id),finalKey=key(session.id,event.data.turn),final=finals.get(finalKey);finals.delete(finalKey);
      if(!binding||binding.harnessTurn!==event.data.turn)return;
      clearInterval(watchers.get(session.id));watchers.delete(session.id);
      if(event.data.reason.kind==='completed'&&final?.turn===event.data.turn){await bridge.complete(session.id,final.message.id,textOf(final.message),final.receivedAt,binding);}
      else await bridge.cancel(session.id,'harness_turn_'+event.data.reason.kind,binding);
      bindings.delete(session.id);
    });
  });
  ctx.on('session/flush',async session=>{await queues.get(session.id);});
  ctx.on('llm/stream',async function*(request,next){
    // 只存真正送入宿主 LLM 的序列雜湊／大小／角色，不複製日常正文或隱藏推理。
    const bytes=JSON.stringify(request.messages),sha256=createHash('sha256').update(bytes).digest('hex');
    await bridge.note(request.sessionId,'model_input',{provider:request.provider,model:request.model,projectionHash:sha256,projectionBytes:Buffer.byteLength(bytes),
      messages:request.messages.map(m=>({id:m.id,role:m.role,sourceKind:m.source?.kind??null}))});
    yield* next();
  });
  ctx.on('tools/result',(exec,result)=>{if(exec.name==='skill')bridge.note(exec.agent?.id??'unknown','skill_loaded',{name:exec.arguments?.name,success:!result.isError}).catch(()=>{});});
  // Cordis 等待 effect disposer 回傳的 Promise；dispose 事件本身不等待 async listener。
  ctx.effect(()=>async()=>{for(const watcher of watchers.values())clearInterval(watcher);
    stopping=true;
    await pinHost.close();
    for(const agent of agents.values())agent.cancel({kind:'disposed'});
    await Promise.allSettled([...agents.values()].map(agent=>agent.whenIdle()));
    await Promise.allSettled(queues.values());await bridge.close();},'cmcp-harness.runtime');
  ctx.inject(['webServer'],ctx=>{
    const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    const register=(route,handler)=>ctx.effect(()=>ctx.webServer.register({kind:'exact',path:route,handler}));
    register('/cmcp/status',async(req,res)=>{if(req.method!=='GET'){res.writeHead(405);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"});res.end(statusPage);});
    register('/cmcp/status.json',async(req,res)=>{try{if(req.method!=='GET')return json(res,405,{error:'method_not_allowed'});json(res,200,await bridge.status());}catch(error){json(res,409,{error:error.message});}});
    register('/cmcp/control',async(req,res)=>{try{if(req.method!=='POST')return json(res,405,{error:'method_not_allowed'});
      // 官方 webServer 的本機登入仍在路由外核對；寫入額外要求同 origin 與明確 scope。
      if(req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'same_origin_required'});
      if(req.headers['content-type']!=='application/json')return json(res,415,{error:'json_required'});
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>8192)throw Error('request_limit');}
      const value=JSON.parse(body);
      json(res,200,await bridge.operate(value));
    }catch(error){json(res,409,{error:error.message});}});
    register('/cmcp/original',async(req,res)=>{try{if(req.method!=='POST')return json(res,405,{error:'method_not_allowed'});
      const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)return json(res,403,{error:'origin_mismatch'});
      if(req.headers['content-type']!=='application/json')return json(res,415,{error:'json_required'});let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>8192)throw Error('request_limit');}
      json(res,200,await bridge.original(JSON.parse(body)));}catch(error){json(res,409,{error:error.message});}});
  });
}
