import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {CmcpHarnessBridge,READING_LIMITS} from '../deepseek-harness/runtime-bridge.mjs';
import {createLocalLoopJournal} from '../../src/cmcp-guard/cmcp-local-loop-journal.js';
import {cmcpSourcePointerKey} from '../../src/cmcp-guard/cmcp-source-pointer.js';
import {normalizeSharedProjectConfig,record,opaque,qualifiedSession,sourceIdentity,hash,copy} from './config.mjs';
import {MODEL_OPERATIONS,MAX_FRAME_BYTES,readContinuityProposal} from './client.mjs';
import {createControlOptions,controlMenu,CONTROL_CONTRACT_VERSION} from '../control/contract.mjs';
import {projectContinuityModelView} from '../continuity-model-view.mjs';
import {attachSharedSourceProvenance,attachSharedReadAttribution} from './source-provenance-view.mjs';

const controllerOps=new Set(['join','revoke','claim','handoff','receive','claim-turn','request-context','append-assistant','finish','cancel','status','control']);
const mutationOps=new Set(['receive','claim-turn','append-assistant','finish','cancel','handoff','claim']);
const keyOf=x=>JSON.stringify([x.hostId,x.agentId,x.sessionId]);
const exposed=x=>x?{hostId:x.hostId,agentId:x.agentId,sessionId:x.sessionId}:null;
const samePointer=(a,b)=>cmcpSourcePointerKey(a)===cmcpSourcePointerKey(b);

/** 單一 Core writer 的短命本機協調器；來源正文只進既有 History。 */
export async function createSharedProjectService({config:input,bridgeFactory=options=>new CmcpHarnessBridge(options)}){
  const config=await normalizeSharedProjectConfig(input),instance=randomUUID();let serial=Promise.resolve(),sequence=0,epoch=instance+':0',owner=null,closed=false,closing=null,latestRead=null;
  const sessions=new Map(),requests=new Map(),sources=new Map(),controllers=new Set();
  const journal=createLocalLoopJournal({root:path.join(config.stateRoot,'input-journal'),name:'cmcp-common-input-v1'});
  for(const row of await journal.read())if(['shared_project_source_intent','shared_project_source_binding'].includes(row.record.kind)){
    const v=row.record.value;if(v.origin?.projectId===config.projectId){const id=sourceIdentity(config,v.origin,v.origin,v.origin.role);
      if(v.messageId!==id.messageId||v.sessionId!==id.sessionId||!/^([a-f0-9]{64})$/.test(v.bodyHash))throw Error('shared_project_provenance_invalid');
      const prior=sources.get(v.messageId);if(prior&&(prior.bodyHash!==v.bodyHash||prior.receivedAt!==v.receivedAt||prior.mediaFingerprint!==v.mediaFingerprint||JSON.stringify(prior.origin)!==JSON.stringify(v.origin)))throw Error('shared_project_provenance_conflict');sources.set(v.messageId,v);}}
  const bridge=bridgeFactory({deploymentRoot:config.projectRoot,runtimeConfig:config.runtimeConfig,traceRoot:config.traceRoot,scopeId:config.scopeId,
    ...(config.hostTurnPolicy?{hostTurnPolicy:config.hostTurnPolicy}:{}),onReceipt:row=>{if(row.kind==='formal_read')latestRead=copy(row);}});
  const readConfig=bridge.config.bind(bridge);bridge.config=async()=>{const value=await readConfig();if(hash(value)!==config.runtimeConfigHash)throw Error('shared_project_runtime_configuration_changed');return value;};
  // 交接服務不新增自動回答或重新路由既有 Pin；共享 controls 本身保持原狀。
  bridge.attachHost({ready:()=>false,hasSession:()=>false,sessions:()=>[...sessions.values()].filter(s=>s.joined).map(exposed),
    request:async()=>{throw Error('shared_project_proactive_host_unavailable');},present:async()=>{throw Error('shared_project_proactive_host_unavailable');}});
  const nextEpoch=()=>{epoch=instance+':'+(++sequence);return epoch;};
  const enqueue=fn=>{const result=serial.then(fn);serial=result.catch(()=>{});return result;};
  const isOwner=r=>owner&&keyOf(owner)===keyOf(r);
  function identity(r,principal){
    record(r,['projectId','hostId','agentId','workspace','sessionId','epoch','requestId','operation','args'],['projectId','hostId','agentId','workspace','sessionId','requestId','operation','args']);
    if(closed)throw Error('shared_project_closed');
    if(r.projectId!==config.projectId)throw Error('shared_project_unauthorized_project');
    const h=config.hosts[r.hostId];if(!h||principal?.hostId!==r.hostId||!['controller','model_read'].includes(principal?.role))throw Error('shared_project_unauthorized_host');
    if(r.agentId!==h.agentId||typeof r.workspace!=='string'||path.resolve(r.workspace)!==h.workspace)throw Error('shared_project_identity_mismatch');
    opaque(r.sessionId);opaque(r.requestId);record(r.args,Object.keys(r.args??{}));
    if(principal.role==='controller'?!controllerOps.has(r.operation):!Object.hasOwn(MODEL_OPERATIONS,r.operation))throw Error('shared_project_role_forbidden');
  }
  function admitted(r,{needOwner=true,needEpoch=true}={}){
    if(closed)throw Error('shared_project_closed');if(needEpoch&&r.epoch!==epoch)throw Error('shared_project_epoch_stale');
    const s=sessions.get(keyOf(r));if(!s?.joined)throw Error('shared_project_session_not_joined');if(needOwner&&!isOwner(r))throw Error('shared_project_owner_required');return s;
  }
  function guardFor(r,s){const admittedEpoch=epoch,cancelSequence=s.cancelSequence??0;return ()=>!closed&&s.joined&&isOwner(r)&&epoch===admittedEpoch&&(s.cancelSequence??0)===cancelSequence;}
  async function controlsAllowed(){const value=await bridge.readOnly(r=>r.controlsSnapshot());if(!value.effective.enabled||value.effective.clean)throw Error('shared_project_controls_disabled');}
  function status(r){const s=sessions.get(keyOf(r));return {kind:'cmcp_shared_project_status',projectId:config.projectId,scopeId:config.scopeId,epoch,owner:exposed(owner),joined:s?.joined===true,
    activeTurn:!!owner?.active,activeTurnId:owner?.active?hash([owner.active.messageId,owner.active.harnessTurn]):null,queuedInputs:owner?.queued.size??0,closed,modelCalls:0};}
  // 身分只來自已驗 host credential、專案設定及目前 owner/回合，不接受模型參數。
  function readerIdentity(r,s){return {kind:'cmcp_reader_identity',version:1,projectId:config.projectId,scopeId:config.scopeId,
    ...exposed(r),activeTurnId:hash([s.active.messageId,s.active.harnessTurn]),verification:'authenticated_active_host_turn',
    meaning:'configured_host_agent_and_native_session_not_user_identity_or_model_personality'};}
  function sourceOrigin(binding,reader,ticket){
    const matches=[...sources.values()].filter(value=>value.sourcePointer&&samePointer(value.sourcePointer,binding.pointer)&&value.evidenceHash===binding.evidenceHash);
    const value=matches.length===1?matches[0]:null;
    if(!value||binding.sourceAuthorRole&&value.origin.role!==binding.sourceAuthorRole)return {ref:binding.ref,ticket,verification:'origin_unavailable',reason:matches.length>1?'ambiguous_source_binding':'verified_origin_not_found'};
    const sameHost=value.origin.projectId===reader.projectId&&value.origin.hostId===reader.hostId;
    const sameAgent=sameHost&&value.origin.agentId===reader.agentId,sameSession=sameAgent&&value.origin.sessionId===reader.sessionId;
    return {ref:binding.ref,ticket,origin:copy(value.origin),qualifiedSessionId:value.sessionId,sourcePointer:copy(binding.pointer),evidenceHash:binding.evidenceHash,
      verification:'formal_read_binding',readerComparison:{sameHost,sameAgent,sameSession,meaning:'identity_equality_only_not_adoption_or_execution'}};
  }
  function rememberRead(s,ticket,bindings){
    // 只保留當輪正式讀取的中繼資料；界線沿既有 reader source 數，超出僅失去身分補充，不裁原文。
    const tickets=s.active.formalOrigins??=new Map();let selected=tickets.get(ticket);
    if(!selected){if(tickets.size>=READING_LIMITS.maxSources)return;selected=new Map();tickets.set(ticket,selected);}
    for(const binding of bindings){const prior=selected.get(binding.ref);
      if(prior&&(!samePointer(prior.pointer,binding.pointer)||prior.evidenceHash!==binding.evidenceHash))throw Error('shared_project_read_binding_changed');
      if(prior||selected.size<READING_LIMITS.maxSources)selected.set(binding.ref,copy(binding));}
  }
  function validText(args){if(typeof args.text!=='string'||!args.text.trim()||Buffer.byteLength(args.text)>524288||typeof args.receivedAt!=='string'||!Number.isFinite(Date.parse(args.receivedAt))||new Date(args.receivedAt).toISOString()!==args.receivedAt)throw Error('shared_project_invalid_source');}
  async function intent(r,args,role){
    validText(args);const id=sourceIdentity(config,r,args,role),prior=sources.get(id.messageId),value={...id,bodyHash:hash(args.text),bytes:Buffer.byteLength(args.text),receivedAt:args.receivedAt,...(args.attachments?.length?{mediaFingerprint:hash(args.attachments)}:{})};
    if(prior&&(prior.bodyHash!==value.bodyHash||prior.bytes!==value.bytes||prior.receivedAt!==value.receivedAt||prior.mediaFingerprint!==value.mediaFingerprint))throw Error('shared_project_source_version_conflict');
    if(!prior){await bridge.runtime(id.sessionId);await journal.append('shared_project_source_intent',value);sources.set(id.messageId,value);}return id;
  }
  async function bind(id,capture){
    if(!capture?.sourcePointer)return {origin:id.origin,status:'not_saved'};
    const registration=await bridge.readOnly(async runtime=>(await runtime.status()).state.registration.sources);
    const source=registration.find(row=>samePointer(row.pointer,capture.sourcePointer));if(!source||typeof source.evidenceHash!=='string')throw Error('shared_project_source_proof_missing');
    const prior=sources.get(id.messageId);if(prior.sourcePointer){if(!samePointer(prior.sourcePointer,source.pointer)||prior.evidenceHash!==source.evidenceHash)throw Error('shared_project_source_proof_changed');return copy(prior);}
    const value={...prior,sourcePointer:source.pointer,evidenceHash:source.evidenceHash};await journal.append('shared_project_source_binding',value);sources.set(id.messageId,value);return copy(value);
  }
  function expected(r,args){return {userMessageId:sourceIdentity(config,r,{messageId:args.userMessageId,revisionId:args.userRevisionId??'r1'},'user').messageId,harnessTurn:args.harnessTurn??null};}
  function requireActive(s,args,r){const e=expected(r,args);if(!s.active||s.active.messageId!==e.userMessageId||s.active.harnessTurn!==e.harnessTurn)throw Error('shared_project_turn_mismatch');return e;}
  async function cleanup(s,reason){
    await bridge.cancel(s.qualifiedSessionId,reason);
    for(const id of s.queued)await bridge.discard(s.qualifiedSessionId,id);
    await bridge.releaseSession(s.qualifiedSessionId);s.active=null;s.queued.clear();s.revoking=false;if(owner===s)owner=null;
  }
  async function run(r,principal,signal){
    if(signal?.aborted)throw Error('shared_project_request_cancelled');
    identity(r,principal);await bridge.config();identity(r,principal);const op=r.operation,args=r.args;
    if(op==='status'){record(args,[]);return status(r);}
    if(op==='reader-status'){
      record(args,[]);admitted(r,{needOwner:false});const snapshot=await bridge.status();admitted(r,{needOwner:false});if(signal?.aborted)throw Error('shared_project_request_cancelled');
      const c=snapshot.controlConfiguration.effective;return {...status(r),controls:c,sourceAccess:c.enabled&&!c.clean&&c.historyRecall&&c.answerHistory,requiresActiveHostTurn:true,storageStatus:snapshot.storageStatus??null};
    }
    if(op==='join'){record(args,[]);let s=sessions.get(keyOf(r));if(s?.revoking)throw Error('shared_project_revocation_incomplete');if(!s){if(sessions.size>=256)throw Error('shared_project_session_capacity');s={...exposed(r),workspace:config.hosts[r.hostId].workspace,qualifiedSessionId:qualifiedSession(config,r),queued:new Set(),active:null,joined:true};sessions.set(keyOf(r),s);}else s.joined=true;
      return {joined:true,sessionId:r.sessionId,qualifiedSessionId:s.qualifiedSessionId,epoch};}
    if(op==='control'){
      record(args,['text']);if(typeof args.text!=='string')throw Error('cmcp_invalid_command');
      const s=admitted(r,{needOwner:false});if(owner&&owner!==s)throw Error('shared_project_owner_required');
      const commandKey=keyOf(r)+'\0'+r.requestId;if(requests.has(commandKey))throw Error('cmcp_command_replayed');
      if(requests.size>=4096)throw Error('shared_project_request_capacity');
      const snapshot=await bridge.status();admitted(r,{needOwner:false});
      const context={projectId:config.projectId,scopeId:config.scopeId,sessionId:r.sessionId,capabilities:{ui:false,pinCreate:false,pinChange:false,sessionControl:false}};
      s.controlOptions??=createControlOptions();const command=s.controlOptions.resolve(args.text,snapshot,context);
      let value;const operation=command.operation,write=['controls','clear-buffer','retry-registration'].includes(operation);
      // 控制入口須是獨立 controller capability，模型 reader 與 History 內容不能呼叫。
      if(write){requests.set(commandKey,{hash:hash(r),result:null});
        if(!command.payload||command.payload.scopeId!==config.scopeId)throw Error('control_scope_required');
        value=await bridge.operate({...command.payload,action:operation==='controls'?'controls':operation==='retry-registration'?'recover':'clearBuffer',sessionGuard:guardFor(r,s)});
      }else if(operation==='original'){await controlsAllowed();value=await bridge.original(command.payload);}
      else if(operation==='continuity'){
        await controlsAllowed();value=await bridge.continuityStatus(s.qualifiedSessionId,{projectWide:true});
        if(signal?.aborted)throw Error('shared_project_request_cancelled');
      }
      else if(operation==='media-list'){await controlsAllowed();value=await bridge.mediaList(command.payload,()=>s.joined&&!closed&&r.epoch===epoch);}
      else if(['help','menu','status','sources','time','buffer','pins'].includes(operation)){
        if(['sources','time','buffer','pins'].includes(operation))await controlsAllowed();
        value=command.choices??null;
      }else if(['on','off'].includes(operation))throw Error('cmcp_use_project_enable_disable');
      else throw Error('cmcp_operation_unavailable_on_host');
      const finalSnapshot=await bridge.status();admitted(r,{needOwner:false});
      if(['original','media-list','sources','time','buffer','pins','continuity'].includes(operation)
        &&(finalSnapshot.controlConfiguration.generation!==snapshot.controlConfiguration.generation
          ||!finalSnapshot.controlConfiguration.effective.enabled||finalSnapshot.controlConfiguration.effective.clean)){
        s.controlOptions.clear();throw Error('cmcp_source_authorization_changed');
      }
      if(operation==='continuity'&&signal?.aborted)throw Error('shared_project_request_cancelled');
      return {kind:'cmcp_control_result',contractVersion:CONTROL_CONTRACT_VERSION,operation,scope:{projectId:config.projectId,scopeId:config.scopeId,sessionId:r.sessionId},
        sessionAuthorization:{joined:s.joined,epoch},snapshot:finalSnapshot,menu:['help','menu'].includes(operation)?controlMenu(context):undefined,result:value,modelCalls:0};
    }
    const requestKey=keyOf(r)+'\0'+r.requestId,requestHash=hash(r),prior=requests.get(requestKey);
    if(['claim','handoff'].includes(op)&&prior?.hash===requestHash&&prior.result.epoch===epoch&&JSON.stringify(prior.result.owner)===JSON.stringify(exposed(owner)))return copy(prior.result);
    const s=admitted(r,{needOwner:!['claim'].includes(op)}),guard=guardFor(r,s);
    if(mutationOps.has(op)&&prior){if(prior.hash!==requestHash)throw Error('shared_project_request_conflict');return copy(prior.result);}
    if(mutationOps.has(op)&&requests.size>=4096)throw Error('shared_project_request_capacity');
    let result;
    if(op==='claim'){
      record(args,[]);if(owner&&owner!==s)throw Error('shared_project_owner_required');await controlsAllowed();admitted(r,{needOwner:false});
      if(!owner){owner=s;nextEpoch();}result={owner:exposed(owner),epoch};
    }else if(op==='handoff'){
      record(args,['target']);record(args.target,['hostId','agentId','workspace','sessionId']);
      const target=args.target,h=config.hosts[target.hostId],next=sessions.get(keyOf(target));
      if(!h||target.agentId!==h.agentId||target.workspace!==h.workspace||!next?.joined)throw Error('shared_project_target_not_joined');
      if(s.active||s.queued.size)throw Error('shared_project_active_turn');await controlsAllowed();admitted(r);
      await bridge.releaseSession(s.qualifiedSessionId);admitted(r);owner=next;nextEpoch();result={owner:exposed(owner),epoch};
    }else if(op==='receive'){
      record(args,['messageId','text','receivedAt','revisionId','attachments'],['messageId','text','receivedAt']);if(Buffer.byteLength(JSON.stringify(r))+512>MAX_FRAME_BYTES)throw Error('shared_project_frame_too_large');
      if(args.attachments!==undefined&&(!Array.isArray(args.attachments)||args.attachments.length>4))throw Error('shared_project_invalid_attachments');
      const attachments=(args.attachments??[]).map(a=>{record(a,['filename','mimeType','dataBase64','sha256'],['filename','mimeType','dataBase64']);
        if(typeof a.dataBase64!=='string'||a.dataBase64.length>699052||!a.dataBase64.length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.dataBase64))throw Error('shared_project_invalid_attachment_bytes');
        const bytes=Buffer.from(a.dataBase64,'base64');if(bytes.length>524288)throw Error('shared_project_media_response_too_large');return {filename:a.filename,mimeType:a.mimeType,bytes,...(a.sha256?{sha256:a.sha256}:{})};});
      await controlsAllowed();admitted(r);const id=await intent(r,args,'user');if(!guard())throw Error('shared_project_authorization_changed');
      const capture=await bridge.receive(id.sessionId,id.messageId,args.text,args.receivedAt,attachments,guard);if(!guard())throw Error('shared_project_authorization_changed');
      if(!s.active||s.active.messageId!==id.messageId)s.queued.add(id.messageId);result={...capture,origin:await bind(id,capture.capture),epoch};
    }else if(op==='claim-turn'){
      record(args,['messageId','revisionId','harnessTurn'],['messageId']);const id=sourceIdentity(config,r,args,'user'),harnessTurn=args.harnessTurn??null;
      if(s.active&&(s.active.messageId!==id.messageId||s.active.harnessTurn!==harnessTurn))throw Error('shared_project_active_turn');
      const value=await bridge.claim(id.sessionId,id.messageId,harnessTurn);if(!guard())throw Error('shared_project_authorization_changed');
      s.queued.delete(id.messageId);s.active={messageId:id.messageId,harnessTurn};result={...value,epoch};
    }else if(op==='request-context'){record(args,[]);if(!s.active)throw Error('shared_project_turn_mismatch');result=await bridge.requestContext(s.qualifiedSessionId);
      if(result)result={...result,readerIdentity:readerIdentity(r,s)};
    }else if(op==='append-assistant'||op==='finish'){
      record(args,['messageId','revisionId','text','receivedAt','userMessageId','userRevisionId','harnessTurn'],['messageId','text','receivedAt','userMessageId']);
      const e=requireActive(s,args,r),id=await intent(r,args,'assistant');if(!guard())throw Error('shared_project_authorization_changed');
      result=await bridge[op==='finish'?'complete':'appendAssistant'](id.sessionId,id.messageId,args.text,args.receivedAt,e,guard);
      if(!guard())throw Error('shared_project_authorization_changed');const origin=await bind(id,result);if(op==='finish')s.active=null;result={...result,origin,epoch};
    }else if(op==='cancel'){
      record(args,['userMessageId','userRevisionId','harnessTurn','reason'],['userMessageId']);const e=expected(r,args);
      if(args.reason!==undefined&&!/^[a-z][a-z0-9_]{0,80}$/.test(args.reason))throw Error('shared_project_invalid_reason');
      if(s.queued.has(e.userMessageId)){await bridge.discard(s.qualifiedSessionId,e.userMessageId);s.queued.delete(e.userMessageId);result={status:'discarded',epoch};}
      else{requireActive(s,args,r);await bridge.cancel(s.qualifiedSessionId,args.reason??'shared_project_cancelled',e);s.active=null;result={status:'cancelled',epoch};}
    }else if(Object.hasOwn(MODEL_OPERATIONS,op)){
      if(!s.active)throw Error('shared_project_turn_mismatch');const abort=new AbortController();controllers.add(abort);
      const cancelled=()=>abort.abort();if(signal?.aborted)abort.abort();else signal?.addEventListener('abort',cancelled,{once:true});
      try{if(op==='progress'){record(args,['ticket']);const turn=bridge.turns.get(s.qualifiedSessionId);if(!turn?.readings.has(args.ticket))throw Error('reading_not_owned_by_turn');await bridge.validate(s.qualifiedSessionId);result=await bridge.readingStatus(args.ticket);}
        else if(op==='list-images'||op==='read-image'){
          record(args,op==='list-images'?['sourceRef']:['sourceRef','mediaId']);await controlsAllowed();
          result=await bridge.mediaTool(s.qualifiedSessionId,MODEL_OPERATIONS[op],args,()=>guard()&&!abort.signal.aborted);
          if(op==='read-image'&&result.content){const {content,...metadata}=result;if(content.length>524288)throw Error('shared_project_media_response_too_large');result={...metadata,data:Buffer.from(content).toString('base64')};}
        }
        else{const required=op==='find'?[]:op==='open'?['navigationTicket','selectionJson']:['ticket'];
          record(args,op==='open'?[...required,'includeCurrentInput']:op==='continuity'?['ticket','proposal','proposalJson']:op==='continuity-page'?['ticket','deliveryId','page']:required,op==='continuity-page'?['ticket','deliveryId','page']:required);
          if(required.some(key=>typeof args[key]!=='string')||(op==='open'&&Object.hasOwn(args,'includeCurrentInput')&&typeof args.includeCurrentInput!=='boolean'))throw Error('shared_project_invalid_schema');
          if(op==='continuity')readContinuityProposal(args);
          latestRead=null;result=await bridge.tool(s.qualifiedSessionId,MODEL_OPERATIONS[op],args,abort.signal);
          if(op==='read'&&result?.kind==='cmcp_reading_page'){
            if(result.ticket!==args.ticket)throw Error('shared_project_read_binding_changed');
            const reader=readerIdentity(r,s),bindings=latestRead?.ticket===args.ticket?latestRead.sourceBindings??[]:[];
            rememberRead(s,args.ticket,bindings);result=attachSharedReadAttribution({...result,readerIdentity:reader,sourceOrigins:bindings.map(binding=>sourceOrigin(binding,reader,args.ticket))},config.scopeId);
          }else if(op==='continuity'&&['ready','partial'].includes(result?.status)&&Array.isArray(result.projection?.sources)){
            if(result.ticket!==args.ticket)throw Error('shared_project_read_binding_changed');
            const reader=readerIdentity(r,s),selected=s.active.formalOrigins?.get(args.ticket);
            const origins=result.projection.sources.map(source=>{const binding=selected?.get(source.ref);
              if(!binding||binding.evidenceHash!==source.evidenceHash)return {ref:source.ref,ticket:args.ticket,verification:'origin_unavailable',reason:'matching_turn_ticket_read_binding_unavailable'};
              return sourceOrigin({...binding,sourceAuthorRole:source.sourceAuthorRole},reader,args.ticket);});
            result=attachSharedSourceProvenance({...result,readerIdentity:reader,sourceOrigins:origins});
          }}
        if(abort.signal.aborted)throw Error('shared_project_request_cancelled');
      }catch(error){if(result?.kind==='cmcp_continuity_delivery_page')await bridge.rejectContinuityDeliveryPage(s.qualifiedSessionId,result);throw error;
      }finally{controllers.delete(abort);signal?.removeEventListener('abort',cancelled);}
    }else throw Error('shared_project_unknown_operation');
    try{
    if(!['claim','handoff'].includes(op)&&!guard())throw Error('shared_project_authorization_changed');if(signal?.aborted)throw Error('shared_project_request_cancelled');
    // 來源身分補充完成後，模型出口才以同一可逆編碼序列化；人類控制維持完整查證視圖。
    if(principal.role==='model_read'&&op==='continuity'){
      result=await bridge.prepareContinuityDelivery(s.qualifiedSessionId,result);
      if(!guard()||signal?.aborted)throw Error('shared_project_authorization_changed');
    }
    if(mutationOps.has(op))requests.set(requestKey,{hash:requestHash,result:copy(result)});return copy(result);
    }catch(error){if(result?.kind==='cmcp_continuity_delivery_page')await bridge.rejectContinuityDeliveryPage(s.qualifiedSessionId,result);throw error;}
  }
  function dispatch(request,principal,{signal}={}){
    let r;try{r=copy(request);identity(r,principal);
      if(r.operation==='revoke'){
        record(r.args,[]);const s=sessions.get(keyOf(r));if(!s)return Promise.reject(Error('shared_project_session_not_joined'));
        if(r.epoch!==epoch&&(!s.revoking||r.epoch!==s.revocationEpoch))throw Error('shared_project_epoch_stale');
        // 權限失效同步先於序列尾端；未完成 reader／出版 guard 立即見到撤權。
        if(!s.revoking)s.revocationEpoch=r.epoch;s.joined=false;s.revoking=true;if(owner===s){nextEpoch();for(const c of controllers)c.abort();}
        return enqueue(async()=>{await cleanup(s,'shared_project_revoked');return {status:'revoked',epoch,owner:exposed(owner)};});
      }
      if(r.operation==='cancel'){
        record(r.args,['userMessageId','userRevisionId','harnessTurn','reason'],['userMessageId']);
        if(r.args.reason!==undefined&&!/^[a-z][a-z0-9_]{0,80}$/.test(r.args.reason))throw Error('shared_project_invalid_reason');
        const s=admitted(r),e=expected(r,r.args);if(s.active?.messageId===e.userMessageId&&s.active.harnessTurn===e.harnessTurn){s.cancelSequence=(s.cancelSequence??0)+1;for(const c of controllers)c.abort();}
      }
    }catch(error){return Promise.reject(error);}return enqueue(()=>run(r,principal,signal));
  }
  function close(){if(closing)return closing;closed=true;nextEpoch();for(const s of sessions.values())s.joined=false;for(const c of controllers)c.abort();clearTimeout(timer);
    closing=enqueue(async()=>{await bridge.close();owner=null;return {status:'closed',modelCalls:0};});return closing;}
  const timer=setTimeout(()=>{close().catch(()=>{});},config.lifetimeMs);timer.unref();
  return Object.freeze({dispatch,close,config:copy(config)});
}
