import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const KIND='cmcp-pin-dispatch';
const textOf=message=>(message?.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('');
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const deferred=()=>{const item=Promise.withResolvers();item.promise.catch(()=>{});return item;};
const abortError=reason=>Object.assign(Error(reason),{name:'AbortError'});
const raceSignal=(promise,signal)=>{
  if(signal.aborted)return Promise.reject(signal.reason??abortError('pin_host_cancelled'));
  return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason??abortError('pin_host_cancelled'));};
    signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});
};

/**
 * 窄宿主閘門：排程、授權、來源、去重仍由 CMCP dispatcher 負責。
 * 只有正式 AgentLoop 的指定非人類回合會暫存串流；普通聊天原樣通過。
 * resolveAgent 必須核對目前資料區並回傳 {agent,scopeId}，不能猜最新 Session。
 * record 僅接收中繼資料；原始 chunks 只存記憶體，取消後釋放。
 */
export function createPinHost({ctx,resolveAgent,record=async()=>{},llmModulePath,
  maxInputBytes=32768,maxStreamBytes=262144,maxChunks=8192,maxWaitMs=90000}={}){
  if(!ctx?.on||typeof resolveAgent!=='function'||typeof record!=='function'||typeof llmModulePath!=='string')throw Error('pin_host_dependencies_required');
  for(const limit of [maxInputBytes,maxStreamBytes,maxChunks,maxWaitMs])if(!Number.isSafeInteger(limit)||limit<1)throw Error('pin_host_invalid_limit');
  if(maxWaitMs>90000)throw Error('pin_host_deadline_limit');
  const entries=new Map(),sessions=new Map(),disposers=[],live=new Set();let closed=false,apiPromise;
  const api=()=>apiPromise??=import(pathToFileURL(llmModulePath).href);
  const initialize=async()=>{const module=await api();if(typeof module.BlockAssembler!=='function')throw Error('pin_host_official_assembler_unavailable');return {ready:true,modelCalls:0};};
  const note=(entry,kind,detail={})=>record({kind,at:new Date().toISOString(),reservationId:entry.reservation.id,
    candidateId:entry.candidate.id,scopeId:entry.target.scopeId,sessionId:entry.target.sessionId,messageId:entry.messageId,...detail});
  const detach=entry=>{
    clearTimeout(entry.timer);entry.detach?.();
    entry.restoreSend?.();
    if(sessions.get(entry.target.sessionId)===entry)sessions.delete(entry.target.sessionId);
    entries.delete(entry.token);entry.chunks=[];
  };
  function abort(entry,reason='pin_host_cancelled'){
    if(entry.controller.signal.aborted||entry.state==='committed')return;
    const error=abortError(reason);entry.state='cancelled';entry.controller.abort(error);
    entry.generated.reject(error);entry.release.reject(error);entry.done.reject(error);
    // 保留真正 User 的後續輸入；只移除本閘門自己的待領訊息。
    entry.agent?.inbox.remove(entry.messageId);
    if(entry.agent&&entry.turn!==null)entry.agent.cancel({kind:'hook',reason},{keepInbox:true});
    detach(entry);void note(entry,'pin_host_cancelled',{reason}).catch(()=>{});
  }
  function own(entry){if(closed||entry.controller.signal.aborted||entries.get(entry.token)!==entry)throw entry.controller.signal.reason??abortError('pin_host_closed_or_stale');
    if(Date.now()>=entry.deadlineAt)throw abortError('pin_host_deadline');}
  async function valid(entry,check=entry.canAttempt){own(entry);if(check&&await raceSignal(check(),entry.controller.signal)===false)throw Error('pin_host_authorization_changed');own(entry);}

  disposers.push(ctx.on('agent/inbox/inserted',({agent,message})=>{
    if(message.source?.kind==='user'){
      const entry=sessions.get(agent.id);if(!entry)return;
      abort(entry,'pin_host_new_user');
    }
  }));
  disposers.push(ctx.on('agent/inbox/claimed',({agent,message,turn})=>{
    const entry=sessions.get(agent.id);if(!entry||message.id!==entry.messageId)return;
    if(message.source?.kind!==KIND||message.source.reservationId!==entry.reservation.id)return abort(entry,'pin_host_claim_mismatch');
    entry.turn=turn;
  }));
  disposers.push(ctx.on('session/event',(session,event)=>{
    const entry=sessions.get(session.id);if(!entry||entry.turn===null)return;
    if(event.type==='assistant/message'&&event.data.turn===entry.turn){
      if(entry.state!=='released'||event.data.interrupted||textOf(event.data.message)!==entry.text){abort(entry,'pin_host_assistant_mismatch');return;}
      entry.assistant={messageId:event.data.message.id,eventSeq:event.seq,recordedAt:new Date(event.time).toISOString(),
        bodyHash:hash(textOf(event.data.message)),bytes:Buffer.byteLength(textOf(event.data.message))};
    }
    if(event.type==='turn/end'&&event.data.turn===entry.turn){
      if(entry.state!=='released'||event.data.reason.kind!=='completed'||!entry.assistant){abort(entry,'pin_host_turn_'+event.data.reason.kind);return;}
      entry.done.resolve({assistant:entry.assistant,turn:{number:event.data.turn,eventSeq:event.seq,endedAt:new Date(event.time).toISOString(),reason:event.data.reason.kind}});
    }
  }));
  disposers.push(ctx.on('agent/error',({agent,error})=>{const entry=sessions.get(agent.id);if(entry)abort(entry,'pin_host_agent_error:'+String(error?.message??'unknown'));}));
  disposers.push(ctx.on('llm/stream',async function*(request,next){
    const entry=sessions.get(request.sessionId);
    if(!entry){yield* next();return;}
    const task=deferred();live.add(task.promise);let iterator;
    try{
      own(entry);
      if(entry.requestClaimed||entry.turn===null||!request.messages.some(message=>message.id===entry.messageId&&message.source?.kind===KIND
        &&message.source.reservationId===entry.reservation.id))throw Error('pin_host_request_binding_mismatch');
      entry.requestClaimed=true;await valid(entry);
      const {BlockAssembler}=await api(),assembler=new BlockAssembler();
      await note(entry,'pin_host_generation_started',{provider:request.provider,model:request.model,turn:entry.turn});
      iterator=next()[Symbol.asyncIterator]();entry.state='generating';
      while(true){
        const item=await raceSignal(iterator.next(),entry.controller.signal);own(entry);if(item.done)break;
        const chunk=structuredClone(item.value),bytes=Buffer.byteLength(JSON.stringify(chunk));entry.streamBytes+=bytes;
        if(entry.streamBytes>maxStreamBytes||entry.chunks.length>=maxChunks)throw Error('pin_host_stream_limit');
        entry.chunks.push(chunk);assembler.push(chunk);
      }
      await valid(entry);
      const blocks=assembler.blocks(),finish=assembler.finish;
      if(finish.kind!=='stop'||blocks.some(block=>!['text','reasoning'].includes(block.type)))throw Error('pin_host_nonfinal_or_tool_output');
      entry.text=textOf({content:blocks});if(!entry.text.trim())throw Error('pin_host_empty_answer');
      entry.generatedAt=new Date().toISOString();entry.state='generated';
      await note(entry,'pin_host_generated',{generatedAt:entry.generatedAt,bodyHash:hash(entry.text),bytes:Buffer.byteLength(entry.text),
        chunks:entry.chunks.length,streamBytes:entry.streamBytes,usage:assembler.usage??null});
      entry.generated.resolve({value:{text:entry.text},receivedAt:entry.generatedAt,hostDelivery:{token:entry.token,reservationId:entry.reservation.id,
        scopeId:entry.target.scopeId,sessionId:entry.target.sessionId,generatedAt:entry.generatedAt,bodyHash:hash(entry.text)}});
      await raceSignal(entry.release.promise,entry.controller.signal);await valid(entry,entry.canPresent);
      // 逐 chunk 核對同步撤銷；未通過交付守護前不發布任何正文。
      for(const chunk of entry.chunks){own(entry);yield chunk;}
    }catch(error){abort(entry,error.message);throw error;}
    finally{
      if(entry.controller.signal.aborted&&iterator?.return)Promise.resolve(iterator.return()).catch(()=>{});
      task.resolve();live.delete(task.promise);
    }
  }));

  async function request(purpose,input,options={}){
    if(closed||purpose!=='proactive')throw Error('pin_host_proactive_only');
    const dispatch=structuredClone(options.dispatch),target=dispatch?.target,candidate=dispatch?.candidate,reservation=dispatch?.reservation;
    if(!target?.scopeId||!target.sessionId||candidate?.route!=='pin'||!candidate.id||!reservation?.id||!reservation.key
      ||!Array.isArray(candidate.sourcePointers)||!candidate.sourcePointers.length||candidate.sourcePointers.some(pointer=>pointer.scopeId!==target.scopeId))throw Error('pin_host_explicit_dispatch_binding_required');
    if(typeof options.canAttempt!=='function')throw Error('pin_host_current_guard_required');
    const inputText=JSON.stringify(input);if(Buffer.byteLength(inputText)>maxInputBytes)throw Error('pin_host_input_limit');
    if(sessions.has(target.sessionId))throw Error('pin_host_session_busy');
    const deadlineAt=Math.min(Date.parse(reservation.deadlineAt),Date.now()+maxWaitMs);
    if(!Number.isFinite(deadlineAt)||deadlineAt<=Date.now())throw Error('pin_host_invalid_deadline');
    const entry={token:randomUUID(),messageId:randomUUID(),target,candidate,reservation,deadlineAt,controller:new AbortController(),
      generated:deferred(),release:deferred(),done:deferred(),canAttempt:options.canAttempt,chunks:[],streamBytes:0,turn:null,state:'resolving',requestClaimed:false};
    entries.set(entry.token,entry);sessions.set(target.sessionId,entry);
    entry.timer=setTimeout(()=>abort(entry,'pin_host_deadline'),Math.max(1,deadlineAt-Date.now()));entry.timer.unref?.();
    if(options.signal){const listener=()=>abort(entry,'pin_host_cancelled');options.signal.addEventListener('abort',listener,{once:true});entry.detach=()=>options.signal.removeEventListener('abort',listener);if(options.signal.aborted)listener();}
    try{
      await valid(entry);const resolved=await raceSignal(resolveAgent(target,{candidate,reservation}),entry.controller.signal);own(entry);
      if(resolved?.scopeId!==target.scopeId||resolved?.agent?.id!==target.sessionId)throw Error('pin_host_target_scope_mismatch');
      entry.agent=resolved.agent;
      if(entry.agent.status!=='idle'||entry.agent.inbox.hasPending)throw Error('pin_host_agent_busy');
      // AgentLoop 沒有公開的無訊息 wake API。公開 send 在插入前就取得
      // wakeAfterAbort，故取消必須早於原 send。這個暫時包裝只取消 Pin，
      // 不改寫／移除／重插 User；原方法仍負責唯一插入與官方喚醒。
      const agent=entry.agent,previousOwnSend=Object.getOwnPropertyDescriptor(agent,'send'),originalSend=agent.send;
      function guardedSend(message,target,wakeup){
        if(message?.source?.kind==='user'&&sessions.get(agent.id)===entry)abort(entry,'pin_host_new_user');
        return Reflect.apply(originalSend,this,[message,target,wakeup]);
      }
      Object.defineProperty(agent,'send',{value:guardedSend,writable:true,configurable:true});
      entry.restoreSend=()=>{if(agent.send!==guardedSend)return;if(previousOwnSend)Object.defineProperty(agent,'send',previousOwnSend);else delete agent.send;};
      await valid(entry);await note(entry,'pin_host_queued',{inputHash:hash(inputText),inputBytes:Buffer.byteLength(inputText)});own(entry);
      entry.state='queued';entry.agent.followup({id:entry.messageId,role:'user',source:{kind:KIND,form:'notice',summary:'使用者明確 Pin 的站內到期跟進；這不是新 User 訊息。',
        reservationId:reservation.id,pinId:candidate.id,scopeId:target.scopeId},content:[{type:'text',text:
          '這是已明確授權的 Pin 到期工作，不是新 User 輸入或新提醒授權。依以下正式脈絡直接提供一次簡潔跟進，不呼叫工具、不新增提醒、不宣稱目標完成。\n'+inputText}]});
      return await entry.generated.promise;
    }catch(error){abort(entry,error.message);throw error;}
  }
  async function present({hostDelivery,canPresent,signal}={}){
    const entry=entries.get(hostDelivery?.token);
    if(!entry||entry.state!=='generated'||hostDelivery.reservationId!==entry.reservation.id||hostDelivery.scopeId!==entry.target.scopeId
      ||hostDelivery.sessionId!==entry.target.sessionId||hostDelivery.bodyHash!==hash(entry.text)||typeof canPresent!=='function')throw Error('pin_host_delivery_binding_mismatch');
    let detachSignal=()=>{};
    if(signal){const listener=()=>abort(entry,'pin_host_delivery_cancelled');signal.addEventListener('abort',listener,{once:true});detachSignal=()=>signal.removeEventListener('abort',listener);if(signal.aborted)listener();}
    try{
      entry.canPresent=canPresent;await valid(entry,canPresent);
      await note(entry,'pin_host_handoff_started',{generatedAt:entry.generatedAt,bodyHash:hash(entry.text)});
      await valid(entry,canPresent);entry.state='released';entry.release.resolve();
      const native=await raceSignal(entry.done.promise,entry.controller.signal);await valid(entry,canPresent);
      const flushed=await raceSignal(ctx.sessions.flush(entry.agent.session),entry.controller.signal);own(entry);
      const receipt={status:'handed_to_host',channel:'harness_session',scopeId:entry.target.scopeId,sessionId:entry.target.sessionId,reservationId:entry.reservation.id,
        generatedAt:entry.generatedAt,hostReceipt:{stage:'host_committed',at:new Date().toISOString(),native,flushObserved:flushed},presentation:'not_observed',userRead:'not_observed'};
      await note(entry,'pin_host_committed',receipt);entry.state='committed';detach(entry);return receipt;
    }catch(error){abort(entry,error.message);throw error;}finally{detachSignal();}
  }
  function cancel(input={},targetSessionId){
    const {reservationId,sessionId,reason='pin_host_cancelled'}=typeof input==='string'?{reason:input,sessionId:targetSessionId}:input;
    let count=0;for(const entry of [...entries.values()])if((!reservationId||entry.reservation.id===reservationId)&&(!sessionId||entry.target.sessionId===sessionId)){abort(entry,reason);count++;}return {cancelled:count};
  }
  async function close(){if(closed)return;closed=true;cancel({reason:'pin_host_closed'});await Promise.allSettled([...live]);for(const dispose of disposers.reverse())dispose();}
  return Object.freeze({initialize,request,present,cancel,close,isPinTurn:sessionId=>sessions.has(sessionId),
    isRequeue:()=>false,
    status:()=>({active:entries.size,streamTasks:live.size,closed,retainedBodies:'memory_only_until_settlement'})});
}
