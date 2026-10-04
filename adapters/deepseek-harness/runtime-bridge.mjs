import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createCmcpRuntimeSession,normalizeCmcpHostTurnPolicy} from '../../src/cmcp-guard/cmcp-runtime-session.js';
import {createCmcpMediaOriginals} from './media-originals.mjs';
import {cmcpSourcePointerKey} from '../../src/cmcp-guard/cmcp-source-pointer.js';

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
const assistantSaveSummary=turn=>{const committed=[...(turn.assistantMessages?.values()??[])],saved=committed.filter(row=>row.receipt.sourcePointer);
  return {committedMessages:committed.length,committedTextBytes:turn.assistantBytes??0,savedMessages:saved.length,savedBytes:saved.reduce((total,row)=>total+row.bytes,0)};};
/** 只折疊正式 host 結果中完全相同的欄位；原文、否定、來源及覆蓋不裁切。 */
export function projectHarnessToolResult(value,publishedProtocols=new Set()){
  if(value?.kind==='cmcp_reading_navigation'&&value.question===value.selection?.input?.question){const projected={...value};delete projected.question;return projected;}
  if(value?.kind==='cmcp_reading_collection'&&Array.isArray(value.collection?.sources))return {...value,collection:{...value.collection,sources:value.collection.sources.map(source=>({ref:source.ref})),sourceMetadata:'provided_with_each_formal_page'}};
  if(value?.kind!=='cmcp_reading_page'||typeof value.modelContext!=='string')return value;
  let context;try{context=JSON.parse(value.modelContext);}catch{return value;}
  if(context?.kind!=='cmcp_reading_page_context')return value;
  const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
  if(context.sourceRef===value.source?.ref)delete context.sourceRef;
  if(context.sourceKind===value.source?.sourceKind)delete context.sourceKind;
  for(const key of ['sourceAuthorRole','contentKind'])if(context.source?.[key]===value.source?.[key])delete context.source[key];
  if(context.source&&Object.keys(context.source).length===0)delete context.source;
  if(same(context.range,value.range))delete context.range;
  if(same(context.runtimeTime,value.runtimeTime))delete context.runtimeTime;
  for(const key of ['now','timezone','nowLocal'])if(context.time?.[key]===value.runtimeTime?.[key])delete context.time[key];
  for(const key of ['messageRecordedAt','localMessageRecordedAt','eventOccurredAt','localEventOccurredAt'])if(context.time?.[key]===value.source?.[key])delete context.time[key];
  const projected={...value,coverage:{...value.coverage},modelContext:context},fields={coverage:{},modelContext:{}};
  for(const key of ['pageBoundary','originalText'])if(projected[key]!==undefined){fields[key]=projected[key];delete projected[key];}
  for(const key of ['scopeCoverage','associationCompleteness','semanticCompleteness'])if(projected.coverage[key]!==undefined){fields.coverage[key]=projected.coverage[key];delete projected.coverage[key];}
  for(const key of ['kind','instructionBoundary','sourceCoverage','semanticCompleteness','sourceProcessing','eventProcessingCoverage'])if(context[key]!==undefined){fields.modelContext[key]=context[key];delete context[key];}
  const id=hash({ticket:value.ticket,fields});projected.pageProtocolRef=id;
  // fields 是本頁相同路徑的固定欄位；只有已提交的協定才可省略，未提交／新版本仍完整給出。
  if(!publishedProtocols.has(id))projected.pageProtocol={id,merge:'fields_are_shared_at_the_same_object_paths_on_every_page_with_this_ref',fields};
  return projected;
}
export function projectHarnessTimeContext(context,published){return !context||!published?context:{kind:'cmcp_model_request_time',contextId:context.contextId,modelRequestTime:context.modelRequestTime};}
export const READING_LIMITS=Object.freeze({maxSources:64,maxTotalBytes:65536,maxPageBytes:2400,maxPages:64,maxProjectionBytes:16384});
// 每筆仍受正式 History 原有容量限制；本界線只限制單一宿主回合的逐筆保存數量／總量。
export const HOST_ASSISTANT_LIMITS=Object.freeze({maxMessages:64,maxTotalBytes:524288});
export function within(root,value){const full=path.resolve(value),relative=path.relative(root,full);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('deployment_path_outside_root');return full;}

/** 薄宿主介接：不呼叫第二個回答模型，不維護另一份 History。 */
export class CmcpHarnessBridge {
  constructor(options){this.options=options;this.hostTurnPolicy=options.hostTurnPolicy===undefined?undefined:normalizeCmcpHostTurnPolicy(options.hostTurnPolicy);this.root=path.resolve(options.deploymentRoot);this.configPath=within(this.root,options.runtimeConfig);this.traceRoot=within(this.root,options.traceRoot);this.current=null;this.turns=new Map();this.inputs=new Map();this.serial=Promise.resolve();this.closed=false;}
  enqueue(operation){const next=this.serial.then(operation);this.serial=next.catch(()=>{});return next;}
  async config(){const config=JSON.parse(await fs.readFile(this.configPath,'utf8'));if(config.providerMode!=='host'||config.input.scopeId!==this.options.scopeId)throw Error('host_configuration_mismatch');return config;}
  async runtime(sessionId){if(this.closed)throw Error('bridge_closed');if(this.current?.sessionId===sessionId)return this.current.runtime;
    if([...this.turns.values()].some(turn=>turn.state==='running'))throw Error('one_active_harness_turn_required');
    if(this.current)await this.current.runtime.close();
    const runtime=await createCmcpRuntimeSession({config:await this.config(),repoRoot:this.root,sessionId,hostTurnPolicy:this.hostTurnPolicy,
      dispatchReady:async candidate=>{
        if([...this.turns.values()].some(turn=>turn.state==='running')||!this.host?.ready?.())return false;
        if(!candidate)return true;
        const target=(await this.destinations()).get(candidate.id);
        return candidate.route==='pin'&&target?.scopeId===this.options.scopeId&&this.host.hasSession(target.sessionId);
      },
      hostProvider:{request:(purpose,input,options)=>this.hostRequest(purpose,input,options)},
      delivery:{present:input=>this.hostDelivery(input)}});this.current={sessionId,runtime};return runtime;}
  attachHost(host){if(this.host)throw Error('host_already_attached');this.host=host;}
  async destinations(){const result=new Map(),file=path.join(this.traceRoot,'bridge-events.jsonl');let content;
    try{content=await fs.readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')content='';else throw error;}
    for(const line of content.split('\n')){if(!line)continue;const row=JSON.parse(line);
      if(row.kind==='pin_destination'&&row.scopeId===this.options.scopeId)result.set(row.pinId,{scopeId:row.scopeId,sessionId:row.sessionId});}
    for(const [id,target]of this.pendingDestinations??[])result.set(id,target);return result;}
  async hostRequest(purpose,input,options){
    const candidate=options?.dispatch?.candidate;
    if(!this.host||purpose!=='proactive'||candidate?.route!=='pin')throw Error('harness_requires_explicit_pin_destination');
    const target=(await this.destinations()).get(candidate.id);
    if(!target||target.scopeId!==this.options.scopeId)throw Error('pin_destination_unavailable');
    return this.host.request(purpose,input,{...options,dispatch:{...options.dispatch,target}});
  }
  async hostDelivery(input){if(!this.host)throw Error('harness_delivery_unavailable');
    const receipt=await this.host.present(input);
    await this.note(receipt.sessionId??'unknown','pin_host_receipt',{reservationId:input.reservation.id,pinId:input.candidate.id,receipt});return receipt;}
  async sessionAvailable(sessionId){return this.enqueue(async()=>{const runtime=await this.runtime(this.current?.sessionId??sessionId);await runtime.refreshDispatch();});}
  async operate(input){
    if(!input||input.scopeId!==this.options.scopeId||typeof input.generation!=='string')throw Error('control_scope_required');
    // UI 控制沒有加入模型工具；不能由普通聊天或模型提案取得這項權限。
    return this.enqueue(async()=>{
      const runtime=await this.runtime(this.current?.sessionId??'cmcp-controls'),before=await runtime.controlsSnapshot();
      if(input.generation!==before.generation)throw Error('controls_changed_refresh_required');
      const updateId=randomUUID(),userAction={kind:'callable_authorization',authorized:true,scopeId:this.options.scopeId};let result;
      if(input.action==='controls')result=await runtime.configureControls({updateId,patch:input.patch,persist:true});
      else if(input.action==='saveAuthorization'){
        if(!input.patch||Object.keys(input.patch).some(k=>!['saveUser','saveAssistant'].includes(k)))throw Error('invalid_save_authorization');
        result=await runtime.authorizeSources({updateId,patch:input.patch,authorizedBy:'authenticated_local_settings'});
        await runtime.configureControls({updateId:randomUUID(),patch:input.patch,persist:true});
      }else if(input.action==='clearBuffer')result=await runtime.clearBuffer({});
      else if(input.action==='recover'){
        if(typeof input.sessionGuard!=='function'||input.sessionGuard()!==true)throw Error('cmcp_source_authorization_changed');
        if(!before.effective.enabled||before.effective.clean)throw Error('cmcp_shared_protection');
        if([...this.turns.values()].some(turn=>turn.state==='running'))throw Error('runtime_not_writable_or_busy');
        result=await runtime.recover({operationValid:input.sessionGuard});
        if(input.sessionGuard()!==true)throw Error('cmcp_source_authorization_changed');
      }
      else if(input.action==='pinCreate'){
        if(!before.effective.enabled||before.effective.clean)throw Error('cmcp_disabled');
        if(!this.host?.hasSession(input.sessionId))throw Error('pin_destination_session_unavailable');
        if(input.dueAt!==null&&(typeof input.dueAt!=='string'||!Number.isFinite(Date.parse(input.dueAt))))throw Error('pin_time_required');
        const pinId=randomUUID();
        this.pendingDestinations??=new Map();this.pendingDestinations.set(pinId,{scopeId:this.options.scopeId,sessionId:input.sessionId});
        try{result=await runtime.pinCreate({updateId,pinId,sourceIds:input.sourceIds,dueAt:input.dueAt,userAction});
          await this.note(input.sessionId,'pin_destination',{pinId,authorizedBy:'authenticated_local_explicit_pin'});
        }finally{this.pendingDestinations.delete(pinId);}
      }else if(input.action==='pinChange')result=await runtime.pinChange({updateId,pinId:input.pinId,expectedRevision:input.expectedRevision,action:input.change,dueAt:input.dueAt,userAction});
      else if(input.action==='cancelWork')result=await runtime.cancelWork({workId:input.workId,reason:'authenticated_user_cancel'});
      else throw Error('unknown_control_action');
      await this.note(this.current?.sessionId??'cmcp-controls','control_result',{action:input.action,updateId,status:result?.status??'saved'});
      return {result,controls:await runtime.controlsSnapshot(),modelCalls:0};
    });
  }
  async note(sessionId,kind,value){await fs.mkdir(this.traceRoot,{recursive:true});const row={at:new Date().toISOString(),sessionId,kind,...value,scopeId:this.options.scopeId};await fs.appendFile(path.join(this.traceRoot,'bridge-events.jsonl'),JSON.stringify(row)+'\n');await this.options.onReceipt?.(plain(row));return row;}
  inputKey(sessionId,messageId){return JSON.stringify([sessionId,messageId]);}
  async receive(sessionId,messageId,text,receivedAt=new Date().toISOString(),attachments=[],sessionGuard=()=>true){return this.enqueue(async()=>{
    if(typeof sessionGuard!=='function'||sessionGuard()!==true)throw Error('cmcp_source_authorization_changed');
    if(typeof messageId!=='string'||!messageId||typeof text!=='string'||!Number.isFinite(Date.parse(receivedAt)))throw Error('invalid_host_input');
    const key=this.inputKey(sessionId,messageId),prior=this.inputs.get(key);
    if(prior){if(prior.text!==text)throw Error('host_input_identity_conflict');return {capture:prior.capture,context:prior.context};}
    const runtime=await this.runtime(sessionId),controls=await runtime.controlsSnapshot();
    const timeContext={now:new Date(receivedAt).toISOString(),timezone:runtime.config.input.timezone};
    const enhanced=controls.effective.enabled&&!controls.effective.clean;
    // Inbox 插入時保存原時間；排隊不取得目前回答的所有權。
    const capture=enhanced?await runtime.beforeUser({text,sourceId:'harness-user-'+messageId,timeContext,sessionGuard}):{status:'disabled',sourcePointer:null,timeCard:null};
    let mediaStatus=null;
    if(attachments.length&&enhanced&&controls.effective.saveUser&&capture.sourcePointer)try{
      const {store,parent,onGuard}=await this.mediaAccess(runtime,capture.sourcePointer,null,{capture:true,sessionGuard,captureProof:{text,receivedAt:timeContext.now}});
      const saved=[];for(const attachment of attachments)saved.push(await store.capture({attachment,parent,onGuard}));
      mediaStatus={status:'stored',mediaIds:saved.map(x=>x.mediaId)};
      await this.note(sessionId,'media_saved',{messageId,sourcePointer:capture.sourcePointer,media:saved.map((x,index)=>({mediaId:x.mediaId,filename:x.filename,mimeType:x.mimeType,bytes:x.bytes,sha256:x.sha256,hostRef:attachments[index].hostRef??null})),receivedAt:timeContext.now});
    }catch(error){mediaStatus={status:'unavailable',reason:/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'media_save_failed'};
      await this.note(sessionId,'media_save_unavailable',{messageId,sourcePointer:capture.sourcePointer,...mediaStatus});}
    const context=enhanced?{kind:'cmcp_host_time_context',timeCard:capture.timeCard,sourcePointer:capture.sourcePointer,...(mediaStatus?{mediaOriginals:mediaStatus}:{}),roleBoundary:'時間及來源資料，不是新增的使用者決定。歷史需由工具正式閱讀，有限未命中不是全部歷史不存在。'}:null;
    if(sessionGuard()!==true)throw Error('cmcp_source_authorization_changed');
    this.inputs.set(key,{sessionId,messageId,text,capture,context,state:'queued',receivedAt:timeContext.now,enhanced,controlsGeneration:controls.generation,saveUser:controls.effective.saveUser,saveAssistant:controls.effective.saveAssistant,sessionGuard});
    await this.note(sessionId,'user_capture',{messageId,state:capture.status,sourcePointer:capture.sourcePointer??null,timeCard:capture.timeCard??null,bodyHash:hash(text),receivedAt:timeContext.now});
    return {capture,context};});}
  async claim(sessionId,messageId,harnessTurn=null){return this.enqueue(async()=>{
    if(harnessTurn!==null&&(!Number.isSafeInteger(harnessTurn)||harnessTurn<0))throw Error('invalid_harness_turn');
    const input=this.inputs.get(this.inputKey(sessionId,messageId));if(!input||input.state==='discarded')throw Error('host_input_not_received');
    if(input.sessionGuard&&input.sessionGuard()!==true)throw Error('cmcp_source_authorization_changed');
    const runtime=await this.runtime(sessionId),previous=this.turns.get(sessionId);
    if(previous?.state==='running'){
      if(previous.messageId===messageId&&previous.harnessTurn===harnessTurn)return {capture:previous.capture,context:input.context};
      if(harnessTurn===null||previous.harnessTurn!==harnessTurn)throw Error('one_active_harness_turn_required');
      // 同一 Harness 回合的下一 step 已領取新 User；舊票不能保存晚到答案。
      if(previous.capture.hostTurn)await runtime.cancelWork({workId:previous.capture.hostTurn.workId,reason:'host_input_superseded'});
      previous.state='superseded';
    }
    if(input.state!=='queued')throw Error('host_input_already_claimed');
    const controls=await runtime.controlsSnapshot(),enhanced=input.enhanced&&controls.effective.enabled&&!controls.effective.clean;
    if(enhanced&&(input.controlsGeneration!==controls.generation||input.saveUser!==controls.effective.saveUser||input.saveAssistant!==controls.effective.saveAssistant))throw Error('host_input_controls_changed');
    const claimed=enhanced?await runtime.beforeUser({text:input.text,sourceId:'harness-user-'+messageId,
      timeContext:{now:input.receivedAt,timezone:runtime.config.input.timezone},sessionGuard:input.sessionGuard,
      hostTurn:{workId:randomUUID(),deadlineAt:new Date(Date.now()+(this.hostTurnPolicy?runtime.hostTurnPolicy.timeoutMs:300000)).toISOString(),bufferDependent:controls.effective.historyRecall}}):{status:'disabled',sourcePointer:null,timeCard:null};
    const capture=enhanced?{...claimed,status:input.capture.status,timeCard:input.capture.timeCard}:claimed;
    const turn={sessionId,messageId,text:input.text,capture,state:'running',startedAt:input.receivedAt,navigation:new Map(),readings:new Set(),enhanced,harnessTurn};
    this.turns.set(sessionId,turn);input.state='claimed';
    await this.note(sessionId,'user_claimed',{messageId,harnessTurn,sourcePointer:capture.sourcePointer??null,hostTurn:capture.hostTurn??null,receivedAt:input.receivedAt});
    return {capture,context:enhanced?input.context:null};});}
  async begin(sessionId,messageId,text,receivedAt=new Date().toISOString()){await this.receive(sessionId,messageId,text,receivedAt);return this.claim(sessionId,messageId);}
  async discard(sessionId,messageId){return this.enqueue(async()=>{const input=this.inputs.get(this.inputKey(sessionId,messageId));if(input?.state==='queued'){input.state='discarded';await this.note(sessionId,'queued_input_discarded',{messageId,receivedAt:input.receivedAt});}});}
  async turn(sessionId){const turn=this.turns.get(sessionId);if(!turn||turn.state!=='running')throw Error('no_active_cmcp_host_turn');const runtime=await this.runtime(sessionId);if(turn.capture.hostTurn)await runtime.validateHostTurn(turn.capture.hostTurn);return {turn,runtime};}
  async validate(sessionId){const turn=this.turns.get(sessionId);if(!turn)return;if(turn.capture.hostTurn)await this.current.runtime.validateHostTurn(turn.capture.hostTurn);}
  async requestContext(sessionId){return this.enqueue(async()=>{const {turn,runtime}=await this.turn(sessionId);if(!turn.enhanced)return null;
    const fresh=await runtime.timeCard({timeContext:{now:new Date().toISOString(),timezone:runtime.config.input.timezone},
      excludePointers:turn.capture.sourcePointer?[turn.capture.sourcePointer]:[]});
    if(!fresh)return null;await this.validate(sessionId);
    const context=this.inputs.get(this.inputKey(sessionId,turn.messageId)).context;
    // 請求時鐘每 step 更新；前次 User 仍是本輪插入前的正式觀測，不刷新保存時間／TTL。
    return {...context,contextId:turn.capture.hostTurn?.workId??this.inputKey(sessionId,turn.messageId),timeCard:turn.capture.timeCard?{...turn.capture.timeCard,current:fresh.current}:null,
      modelRequestTime:fresh.current,userMessageRecordedAt:turn.startedAt};});}
  async tool(sessionId,name,args={},signal){return this.enqueue(async()=>{const {turn,runtime}=await this.turn(sessionId);if(signal?.aborted)throw Error('host_tool_cancelled');if(!turn.enhanced)throw Error('cmcp_disabled');let result;
    const base={text:turn.text,savedQueryPointer:turn.capture.sourcePointer??undefined,timeContext:{now:new Date().toISOString(),timezone:runtime.config.input.timezone},signal};
    let formalRanges=[];
    if(name==='cmcp_find_history'){
      result=await runtime.readingNavigate(base);if(result.host.ticket)turn.navigation.set(result.host.ticket,result.host);
      result=result.host;
    }else if(name==='cmcp_open_history'){
      if(!turn.navigation.has(args.navigationTicket))throw Error('navigation_not_owned_by_turn');
      result=await runtime.readingOpen({navigationTicket:args.navigationTicket,selection:JSON.parse(args.selectionJson),mode:'all',limits:READING_LIMITS,signal,
        ...(turn.capture.sourcePointer?{}:{queryText:turn.text})});
      if(result.host?.ticket)turn.readings.add(result.host.ticket);result=result.host;
    }else if(name==='cmcp_read_history'){
      if(!turn.readings.has(args.ticket))throw Error('reading_not_owned_by_turn');
      const page=await runtime.readingPage({ticket:args.ticket,project:true,signal});
      result=page.host;formalRanges=page.internal?.readRanges??[];
    }else throw Error('unknown_cmcp_tool');
    await this.validate(sessionId);if(signal?.aborted)throw Error('host_tool_cancelled');
    if(result?.source?.ref&&result.source.sourceAuthorRole==='user'&&result.modelContext){
      // 公開頁的 r1 等 ref 不含內部 Pointer，且不同 ticket 可同名。
      // 只由本回合正式 reader 的已驗 readRanges 建立不歧義媒體參照。
      const ranges=formalRanges.filter(row=>row.status==='found'&&row.ref===result.source.ref);
      if(ranges.length!==1||!ranges[0].pointer||typeof ranges[0].evidenceHash!=='string')throw Error('media_formal_read_binding_unavailable');
      const source={pointer:plain(ranges[0].pointer),evidenceHash:ranges[0].evidenceHash};
      const mediaSourceRef='m'+hash({ticket:result.ticket,ref:result.source.ref,...source}).slice(0,24);
      turn.mediaSources??=new Map();turn.mediaSources.set(mediaSourceRef,source);
      result={...result,mediaSourceRef};
    }
    await this.note(sessionId,'formal_read',{tool:name,harnessTurn:turn.harnessTurn,messageId:turn.messageId,ticket:result?.ticket??null,status:result?.status??null,source:result?.source??null,sourceBindings:formalRanges.filter(row=>row.status==='found').map(row=>({ref:row.ref,pointer:row.pointer,evidenceHash:row.evidenceHash})),mediaSourceRef:result?.mediaSourceRef??null,range:result?.range??null,coverage:result?.coverage??null,limits:result?.limits??null,projectionHash:result?.modelContext?hash(result.modelContext):null,projectionBytes:result?.modelContext?Buffer.byteLength(typeof result.modelContext==='string'?result.modelContext:JSON.stringify(result.modelContext)):0});
    return plain(result);});}
  appendAssistant(sessionId,messageId,text,receivedAt=new Date().toISOString(),expected,sessionGuard=()=>true){return this.saveAssistant(sessionId,messageId,text,receivedAt,expected,false,sessionGuard);}
  complete(sessionId,messageId,text,receivedAt=new Date().toISOString(),expected,sessionGuard=()=>true){return this.saveAssistant(sessionId,messageId,text,receivedAt,expected,true,sessionGuard);}
  async saveAssistant(sessionId,messageId,text,receivedAt,expected,finalizeHostTurn,sessionGuard){return this.enqueue(async()=>{
    const turn=this.turns.get(sessionId);if(!turn||turn.state!=='running')throw Error('no_active_cmcp_host_turn');
    if(turn.harnessTurn!==null&&(!expected||expected.userMessageId!==turn.messageId||expected.harnessTurn!==turn.harnessTurn)
      ||expected&&(expected.userMessageId!==turn.messageId||expected.harnessTurn!==turn.harnessTurn))throw Error('host_completion_turn_mismatch');
    try{if(typeof sessionGuard!=='function'||sessionGuard()!==true)throw Error('cmcp_source_authorization_changed');const {runtime}=await this.turn(sessionId);
    if(typeof messageId!=='string'||!messageId||typeof text!=='string'||!text.trim()||!Number.isFinite(Date.parse(receivedAt)))throw Error('invalid_host_assistant_commit');
    turn.assistantMessages??=new Map();const prior=turn.assistantMessages.get(messageId),bodyHash=hash(text),bytes=Buffer.byteLength(text);
    if(prior&&(prior.bodyHash!==bodyHash||prior.bytes!==bytes||prior.receivedAt!==receivedAt))throw Error('host_assistant_message_identity_conflict');
    if(!prior&&(turn.assistantMessages.size>=HOST_ASSISTANT_LIMITS.maxMessages||(turn.assistantBytes??0)+bytes>HOST_ASSISTANT_LIMITS.maxTotalBytes))throw Error('host_assistant_commit_capacity_exceeded');
    const receipt=turn.enhanced?await runtime.afterAssistant({text,sourceId:'harness-assistant-'+messageId,
      replyTo:turn.capture.sourcePointer??turn.capture.nativeSourcePointer??null,hostTurn:turn.capture.hostTurn,
      timeContext:{now:receivedAt,timezone:runtime.config.input.timezone},finalizeHostTurn,sessionGuard}):{status:'disabled',sourcePointer:null};
    if(turn.capture.hostTurn)await runtime.validateHostTurn(turn.capture.hostTurn);
    if(sessionGuard()!==true)throw Error('cmcp_source_authorization_changed');
    if(!prior){turn.assistantMessages.set(messageId,{bodyHash,bytes,receivedAt,receipt});turn.assistantBytes=(turn.assistantBytes??0)+bytes;}
    if(finalizeHostTurn){turn.state='saved';turn.receipt=receipt;}
    if(!prior)await this.note(sessionId,'assistant_saved',{messageId,state:receipt.status,receipt,bodyHash,bytes,receivedAt,harnessTurn:turn.harnessTurn,phase:finalizeHostTurn?'turn_completed':'message_committed'});
    if(finalizeHostTurn&&prior)await this.note(sessionId,'host_turn_completed',{messageId,harnessTurn:turn.harnessTurn,receipt,...assistantSaveSummary(turn)});
    if(finalizeHostTurn)await runtime.refreshDispatch();return receipt;
    }catch(error){
      // 已提交訊息保存失敗後保留前面已保存原件，取消原票；後續不能冒稱整回合保存完整。
      turn.assistantSaveFailure={messageId,phase:finalizeHostTurn?'turn_completed':'message_committed',code:/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'host_assistant_save_failed',currentMessageOutcome:'unconfirmed',...assistantSaveSummary(turn)};
      try{await this.cancelTurn(sessionId,turn,finalizeHostTurn?'host_completion_failed':'host_assistant_commit_failed');}
      catch(cleanupError){throw new AggregateError([error,cleanupError],'host_completion_cleanup_failed',{cause:error});}
      throw error;
    }});}
  async cancelTurn(sessionId,turn,reason){
    if(this.turns.get(sessionId)!==turn||turn.state!=='running')return;
    // 正式取消失敗時保留 running，禁止其他回合旁路尚未失效的原票。
    if(turn.capture.hostTurn){if(this.current?.sessionId!==sessionId)throw Error('host_cancel_runtime_unavailable');
      await this.current.runtime.cancelWork({workId:turn.capture.hostTurn.workId,reason});}
    turn.state='cancelled';await this.note(sessionId,'cancelled',{reason,hostTurn:turn.capture.hostTurn??null,...(turn.assistantSaveFailure?{assistantSaveFailure:turn.assistantSaveFailure}: {})});
    if(this.current)await this.current.runtime.refreshDispatch();
  }
  async cancel(sessionId,reason,expected){return this.enqueue(async()=>{const turn=this.turns.get(sessionId);if(!turn||turn.state!=='running')return;
    if(expected&&(expected.userMessageId!==turn.messageId||expected.harnessTurn!==turn.harnessTurn))throw Error('host_cancel_turn_mismatch');
    await this.cancelTurn(sessionId,turn,reason);});}
  async readOnly(operation){const runtime=await createCmcpRuntimeSession({config:await this.config(),repoRoot:this.root,readOnly:true});try{return await operation(runtime);}finally{await runtime.close();}}
  async traceObservation(full){
    const allowed=status=>{const controls=status.controlConfiguration.effective;return controls.enabled&&!controls.clean&&controls.historyRecall&&controls.answerHistory
      &&status.sourceAuthorization.saveUser&&status.sourceAuthorization.saveAssistant
      &&!['enabled','clean','historyRecall','answerHistory'].some(key=>String(status.controlConfiguration.featureRevisions[key]??'').startsWith('session_epoch:'));};
    const unavailable=()=>({kind:'cmcp_adapter_metadata_trace',status:'unavailable',reason:'history_or_source_controls_disabled_or_changed',total:null,shown:0,entries:[],modelCalls:0});
    if(!allowed(full))return unavailable();
    const file=path.join(this.traceRoot,'bridge-events.jsonl');let stat;try{stat=await fs.stat(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    const entries=[];let total=0,excludedScope=0;
    if(stat?.size){const stream=createReadStream(file,{encoding:'utf8',start:0,end:stat.size-1}),lines=createInterface({input:stream,crlfDelay:Infinity});
      try{for await(const line of lines){if(!line)continue;let row;try{row=JSON.parse(line);}catch{throw Error('adapter_trace_invalid_record');}total++;
        if(row.scopeId!==this.options.scopeId){excludedScope++;continue;}
        const item={};for(const key of ['at','sessionId','kind','scopeId','messageId','harnessTurn','state','receivedAt','tool','ticket','status','projectionHash','projectionBytes','provider','model','messages'])if(row[key]!==undefined)item[key]=row[key];
        if(row.source){item.source={};for(const key of ['ref','pointer','evidenceHash','sourceAuthorRole','messageRecordedAt','sourceKind','codePoints'])if(row.source[key]!==undefined)item.source[key]=row.source[key];}
        for(const key of ['sourcePointer','hostTurn','range','coverage','limits'])if(row[key]!==undefined)item[key]=row[key];
        if(row.receipt)item.receipt=Object.fromEntries(['status','sourcePointer','replyTo','replyBinding','formalReply','hostTurn'].filter(key=>row.receipt[key]!==undefined).map(key=>[key,row.receipt[key]]));
        entries.push(item);if(entries.length>100)entries.shift();
      }}finally{lines.close();stream.destroy();}}
    const after=await this.readOnly(runtime=>runtime.status());
    if(!allowed(after)||after.controlConfiguration.generation!==full.controlConfiguration.generation||hash(after.sourceAuthorization)!==hash(full.sourceAuthorization))return unavailable();
    return {kind:'cmcp_adapter_metadata_trace',status:'available',total,excludedScope,shown:entries.length,limit:100,entries,modelCalls:0,
      evidenceBoundary:'工具正式回傳與保存回執的 metadata；不等於模型實際收到的 wire，不含原文正文。'};
  }
  async status(){return this.readOnly(async runtime=>{const full=await runtime.status();
    // 清冊身分與時間仍可見；關閉回查不由狀態摘要旁路輸出原文。
    const c=full.controlConfiguration.effective,mayRead=c.enabled&&!c.clean&&c.historyRecall&&c.answerHistory;
    const registration=mayRead?full.state.registration:{...full.state.registration,sources:full.state.registration.sources.map(source=>Object.fromEntries(
      ['id','pointer','evidenceHash','sourceAuthorRole','messageRecordedAt','eventOccurredAt','location','sourceKind','contentKind'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]))),materialStatus:'目前控制不提供來源摘要'};
    const buffer=await runtime.bufferList();if(!mayRead)for(const row of [...buffer.items,...buffer.retained]){delete row.context;delete row.lastPresentation;}
    const liveDispatch=await this.current?.runtime.dispatchStatus();
    const observation={kind:'cmcp_harness_observation',at:new Date().toISOString(),modelCalls:0,
    scopeId:full.dataScope.scopeId,area:this.options.areaInfo??{id:'legacy',label:'原合成驗收區',kind:'acceptance'},sessions:this.host?.sessions()??[],destinations:Object.fromEntries(await this.destinations()),
    controls:full.controls,controlConfiguration:full.controlConfiguration,sourceAuthorization:full.sourceAuthorization,timeCard:await runtime.timeCard(),localReadProgress:full.localReadProgress,
    registration,storageStatus:{...full.storageStatus,retry:{...full.storageStatus?.retry,available:true,reason:'authenticated_controller_action_required'}},buffer,pins:full.pins,proactive:mayRead?{...full.proactiveExecutor,liveDispatch:liveDispatch??null}:{readOnly:true,reason:'material_controls_disabled'},dispatchObservation:full.dispatchObservation,trace:await this.traceObservation(full),
    work:full.work.map(({workId,mode,state,source,terminal})=>({workId,mode,state,source,terminal})),
    turns:[...this.turns.values()].map(turn=>{const {sessionId,messageId,harnessTurn,state,capture,receipt}=turn;
      return {sessionId,messageId,harnessTurn,state,sourcePointer:capture.sourcePointer,receipt,assistantSave:{...assistantSaveSummary(turn),failure:turn.assistantSaveFailure??null}};}),
    limits:{reading:READING_LIMITS,assistantCommits:HOST_ASSISTANT_LIMITS,parallelSessions:'僅單一前景回合，不宣稱多代理並行'},sourceOfTruth:'既有 CMCP Runtime／History；Harness Session 另列'};
    if((await runtime.controlsSnapshot()).generation!==full.controlConfiguration.generation)throw Error('status_controls_changed_refresh_required');return observation;});}
  async original(input){return this.readOnly(runtime=>runtime.readSource(input));}
  async mediaAccess(runtime,pointer,evidenceHash,{capture=false,sessionGuard=()=>true,captureProof}={}){
    const config=await this.config(),status=await runtime.status(),row=status.state.registration.sources.find(x=>cmcpSourcePointerKey(x.pointer)===cmcpSourcePointerKey(pointer));
    if(!row||row.sourceAuthorRole!=='user'||evidenceHash&&row.evidenceHash!==evidenceHash)throw Error('media_parent_not_authorized');
    const end=row.codePoints??row.location?.end;
    // 新 User 原件依正式 beforeUser 回執與當次輸入綁定，不把回查 OFF 當停止保存。
    if(capture&&(!captureProof||typeof captureProof.text!=='string'||captureProof.receivedAt!==row.messageRecordedAt))throw Error('media_current_capture_proof_required');
    const original=capture?{status:'found',completeStoredContent:true,sourcePointer:row.pointer,messageRecordedAt:row.messageRecordedAt,text:captureProof.text}
      :await runtime.readSource({pointer:row.pointer,evidenceHash:row.evidenceHash,start:0,end,maxBytes:8192});
    if(original.status!=='found'||!original.completeStoredContent)throw Error('media_parent_original_required');
    const proof={pointer:row.pointer,evidenceHash:row.evidenceHash,messageRecordedAt:original.messageRecordedAt,textHash:hash(original.text),forCapture:capture};
    await runtime.validateMediaParent(proof);
    const initial=await runtime.controlsSnapshot(),stamp=hash(initial);
    const onGuard=async()=>{const current=await runtime.controlsSnapshot(),c=current.effective;
      const allowed=sessionGuard()&&c.enabled&&!c.clean&&(capture?c.saveUser:c.historyRecall&&c.answerHistory)&&hash(current)===stamp;
      if(allowed)await runtime.validateMediaParent(proof);
      return {allowed:allowed&&sessionGuard(),stamp};};
    const parent={sourcePointer:original.sourcePointer,evidenceHash:row.evidenceHash,sourceAuthorRole:'user',sessionId:pointer.sessionId,scopeId:pointer.scopeId,messageRecordedAt:original.messageRecordedAt,textHash:hash(original.text)};
    const store=createCmcpMediaOriginals({dataRoot:path.resolve(this.root,config.input.root),scopeId:this.options.scopeId});
    return {store,parent,onGuard,original};
  }
  async mediaList(input,sessionGuard=()=>true){return this.readOnly(async runtime=>{
    const {store,parent,onGuard,original}=await this.mediaAccess(runtime,input.pointer,input.evidenceHash,{sessionGuard});
    return {...await store.list({parent,onGuard}),source:{sourcePointer:parent.sourcePointer,evidenceHash:parent.evidenceHash,sourceAuthorRole:'user',sessionId:parent.sessionId,scopeId:parent.scopeId,messageRecordedAt:parent.messageRecordedAt,text:original.text},modelCalls:0};});}
  async mediaRead(input,sessionGuard=()=>true){return this.readOnly(async runtime=>{
    const {store,parent,onGuard}=await this.mediaAccess(runtime,input.pointer,input.evidenceHash,{sessionGuard});
    const value=await store.read({mediaId:input.mediaId,parent,onGuard,encoding:'dataUrl'});
    const {dataUrl,...metadata}=value;return {metadata,dataUrl,modelCalls:0};});}
  async mediaTool(sessionId,name,args,sessionGuard=()=>true){
    const {turn}=await this.turn(sessionId);if(!turn.enhanced)throw Error('cmcp_disabled');
    const source=turn.mediaSources?.get(args.sourceRef);if(!source)throw Error('media_requires_formal_read_source');
    if(name==='cmcp_list_images')return this.mediaList(source,sessionGuard);
    if(name==='cmcp_read_image')return this.readOnly(async runtime=>{
      const {store,parent,onGuard}=await this.mediaAccess(runtime,source.pointer,source.evidenceHash,{sessionGuard});
      return store.read({mediaId:args.mediaId,parent,onGuard,encoding:'bytes'});});
    throw Error('unknown_media_tool');
  }
  async readingStatus(ticket){return this.readOnly(runtime=>runtime.readingStatus(ticket));}
  async releaseSession(sessionId){return this.enqueue(async()=>{
    if(this.current?.sessionId!==sessionId)return;
    const current=this.current,turn=this.turns.get(sessionId);let primary;
    try{if(turn?.state==='running'){
      if(turn.capture.hostTurn)await current.runtime.cancelWork({workId:turn.capture.hostTurn.workId,reason:'harness_session_disposed'});
      turn.state='cancelled';await this.note(sessionId,'cancelled',{reason:'harness_session_disposed',hostTurn:turn.capture.hostTurn??null});
    }}catch(error){primary=error;}finally{
      try{await current.runtime.close();if(this.current===current)this.current=null;}catch(error){if(primary)throw new AggregateError([primary,error],'harness_session_cleanup_failed',{cause:primary});throw error;}
    }
    if(primary)throw primary;
  });}
  async close(){await this.serial;let primary;
    try{for(const [id,turn]of this.turns)if(turn.state==='running')await this.cancel(id,'harness_shutdown');}catch(error){primary=error;}
    finally{await this.serial;try{if(this.current){await this.current.runtime.close();this.current=null;}}catch(error){if(primary)throw new AggregateError([primary,error],'harness_cleanup_failed',{cause:primary});throw error;}finally{this.closed=true;}}
    if(primary)throw primary;
  }
}
