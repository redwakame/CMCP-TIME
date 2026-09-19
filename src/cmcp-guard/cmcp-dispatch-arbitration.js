import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLocalLoopJournal,loopHash} from './cmcp-local-loop-journal.js';
import {readCmcpBufferBoundary,withCmcpBufferPublication} from './cmcp-buffer-lifecycle.js';
import {createCmcpSourcePointer,cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {resolveCmcpTimeContext,parseCmcpInstant} from './resolve-cmcp-time-context.js';
import {cmcpDoNotDisturbActive} from './cmcp-feature-controls.js';

const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
function controlKey(snapshot,candidate){
  const effective=snapshot.effective??snapshot,keys=['enabled','clean','proactive','doNotDisturb',candidate.route==='buffer'?'buffer':'pins'];
  return loopHash(canonical(keys.map(key=>[key,effective[key],snapshot.featureRevisions? snapshot.featureRevisions[key]??0:snapshot.generation??null])));
}
function candidateSnapshot(value,scopeId){
  if(!value||!['buffer','pin'].includes(value.route)||typeof value.id!=='string'||!value.id||!value.target
    ||!(typeof value.target.eventId==='string'&&value.target.eventId||typeof value.target.sourceId==='string'&&value.target.sourceId)
    ||typeof value.progressVersion!=='string'||!value.progressVersion
    ||!Array.isArray(value.sourcePointers)||!value.sourcePointers.length)throw Error('invalid_dispatch_candidate');
  const candidate=clone(value);candidate.sourcePointers=candidate.sourcePointers.map(createCmcpSourcePointer);
  if(candidate.sourcePointers.some(pointer=>pointer.scopeId!==scopeId))throw Error('dispatch_scope_mismatch');
  if(candidate.dueAt!==null)parseCmcpInstant(candidate.dueAt,'dispatchDueAt');
  if(candidate.route==='buffer'&&(!Number.isSafeInteger(candidate.bufferGeneration)||candidate.bufferGeneration<0
    ||candidate.dueAt===null||!candidate.expiresAt||parseCmcpInstant(candidate.expiresAt)!==parseCmcpInstant(candidate.dueAt)))throw Error('buffer_dispatch_requires_original_expiry');
  if(candidate.route==='pin'&&(!Number.isSafeInteger(candidate.pinRevision)||candidate.pinRevision<1))throw Error('pin_dispatch_revision_required');
  return candidate;
}
export function cmcpDispatchProgressKey(candidate,scopeId){
  const normalized=candidateSnapshot(candidate,scopeId);
  if(!normalized.target.eventId&&normalized.target.sourceId&&normalized.sourceHashes){
    const pointers=[...new Set(normalized.sourcePointers.map(cmcpSourcePointerKey))].sort(),pairs=pointers.map(pointer=>[pointer,normalized.sourceHashes[pointer]]);
    if(pairs.some(([,hash])=>typeof hash!=='string'||!hash))throw Error('dispatch_source_identity_hash_required');
    const {sourceId,...scope}=normalized.target;
    // sourceId may be a legacy order-dependent locator alias. Exact immutable
    // Pointer/revision/hash identity is a set; original presentation order stays
    // on the candidate and no stored Pin/reservation is rewritten.
    return loopHash(canonical([scopeId,{identity:'exact_source_set_v2',...scope},pairs]));
  }
  return loopHash(canonical([scopeId,normalized.target,normalized.progressVersion,
    [...new Set(normalized.sourcePointers.map(cmcpSourcePointerKey))].sort()]));
}
export function cmcpDispatchReservedKeys(records,scopeId){
  const keys=new Set();for(const record of records){if(record.kind!=='dispatch_reserved'||record.value.scopeId!==scopeId)continue;
    keys.add(record.value.key);
    if(record.value.candidate)keys.add(cmcpDispatchProgressKey(record.value.candidate,scopeId));
  }return keys;
}

/** One in-process due evaluation, common durable reservations, caller-owned budget/work/delivery. */
export function createCmcpDispatchArbiter({root,scopeId,getControls,validate,generate,deliver,clock,timeoutMs=90000}){
  if(!path.isAbsolute(root)||typeof scopeId!=='string'||!scopeId
    ||[getControls,validate,generate,deliver,clock].some(fn=>typeof fn!=='function')
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>90000)throw Error('explicit_dispatch_dependencies_required');
  const journal=createLocalLoopJournal({root:path.join(root,'input-journal'),name:'cmcp-common-input-v1'});
  const armed=new Map();let epoch=0,flight=null,closed=false,admitted=false;
  const now=()=>{const context=resolveCmcpTimeContext(clock());if(context.source!=='explicit_injected')throw Error('explicit_dispatch_time_required');return context;};
  const append=(kind,value)=>withCmcpBufferPublication({root,scopeId},()=>journal.append(kind,{version:1,scopeId,...value}));
  async function status(){
    const records=(await journal.read()).map(row=>row.record).filter(row=>row.kind.startsWith('dispatch_')&&row.value.scopeId===scopeId);
    return {kind:'cmcp_dispatch_status',generating:flight!==null,closed,armedCount:armed.size,
      records:clone(records),latest:clone(records.at(-1)??null),modelCalls:0};
  }
  async function controlsAt(temporal){
    const snapshot=await getControls(),controls=snapshot.effective??snapshot;
    if(!controls.enabled||controls.clean)return {reason:'enhancement_disabled',snapshot,controls};
    if(!controls.proactive)return {reason:'proactive_disabled',snapshot,controls};
    if(cmcpDoNotDisturbActive(controls,temporal))return {reason:'do_not_disturb',snapshot,controls};
    return {reason:null,snapshot,controls};
  }
  async function validateCurrent(candidate,stage,signal){
    if(candidate.route==='buffer'){
      const boundary=await readCmcpBufferBoundary({root,scopeId});
      if(boundary.generation!==candidate.bufferGeneration)return {status:'ineligible',code:'buffer_cleared'};
    }
    const result=await validate(clone(candidate),{stage,signal});
    if(result?.status!=='eligible')return {status:'ineligible',code:result?.code??'candidate_not_supported'};
    if(result.progressVersion!==candidate.progressVersion)return {status:'ineligible',code:'candidate_progress_changed'};
    if(candidate.route==='pin'&&result.pinRevision!==candidate.pinRevision)return {status:'ineligible',code:'pin_revision_changed'};
    return result;
  }
  /** Ephemeral token: cannot be restored after restart or generated for an already expired Buffer. */
  async function arm(input){
    if(closed)throw Error('dispatch_closed');
    const candidate=candidateSnapshot(input,scopeId),temporal=now();
    if(candidate.route!=='buffer'||temporal.nowEpochMs>=parseCmcpInstant(candidate.dueAt))return {status:'not_armed',reason:'not_before_buffer_due'};
    const check=await controlsAt(temporal);
    // An arm only schedules a future eligibility check. DND must still block
    // evaluation and presentation, but must not erase a future Buffer due time
    // when the quiet window can end before that time.
    if(check.reason&&check.reason!=='do_not_disturb'||!check.controls.buffer)return {status:'not_armed',reason:check.reason??'buffer_disabled'};
    const verified=await validateCurrent(candidate,'arm');if(verified.status!=='eligible')return {status:'not_armed',reason:verified.code};
    const token=randomUUID();armed.set(token,{candidate,epoch,controlGeneration:controlKey(check.snapshot,candidate),at:temporal.now});
    return {status:'armed',token,dueAt:candidate.dueAt,key:cmcpDispatchProgressKey(candidate,scopeId)};
  }
  async function reserve(candidate,temporal){
    const key=cmcpDispatchProgressKey(candidate,scopeId);
    return withCmcpBufferPublication({root,scopeId},async()=>{
      const binding=(await journal.read())[0]?.record;
      if(binding?.kind!=='binding'||binding.value?.scopeId!==scopeId)throw Error('dispatch_requires_initialized_common_input');
      const previous=cmcpDispatchReservedKeys((await journal.read()).map(row=>row.record),scopeId);
      if(previous.has(key))return null;
      const reservation={id:randomUUID(),key,candidate:clone(candidate),at:temporal.now,
        deadlineAt:new Date((candidate.route==='buffer'?parseCmcpInstant(candidate.dueAt):temporal.nowEpochMs)+timeoutMs).toISOString(),status:'reserved'};
      await journal.append('dispatch_reserved',{version:1,scopeId,...reservation});return reservation;
    });
  }
  async function evaluateWork({candidates,armedDueTokens=[]}={}){
    if(closed||flight)return {status:'ineligible',reason:closed?'closed':'work_in_progress',modelCalls:0};
    if(!Array.isArray(candidates)||!Array.isArray(armedDueTokens))throw Error('explicit_dispatch_candidates_required');
    const start=now(),checked=await controlsAt(start),observed=[];
    // Due tokens are single-evaluation intent, including OFF/DND outcomes; they cannot accrue missed reminders.
    const supplied=new Map();for(const token of armedDueTokens){const record=armed.get(token);if(record&&start.nowEpochMs>=parseCmcpInstant(record.candidate.dueAt)){supplied.set(token,record);armed.delete(token);}}
    if(checked.reason)return {status:'ineligible',reason:checked.reason,modelCalls:0};
    let selected=null;
    const ordered=candidates.map(candidate=>candidateSnapshot(candidate,scopeId)).map((candidate,index)=>({candidate,index}))
      .sort((a,b)=>(a.candidate.dueAt===null?Infinity:parseCmcpInstant(a.candidate.dueAt))-(b.candidate.dueAt===null?Infinity:parseCmcpInstant(b.candidate.dueAt))||a.index-b.index);
    for(const {candidate} of ordered){
      let reason=null;
      if(!checked.controls[candidate.route==='buffer'?'buffer':'pins'])reason=candidate.route+'_disabled';
      else if(candidate.dueAt===null)reason='no_user_schedule';
      else if(start.nowEpochMs<parseCmcpInstant(candidate.dueAt))reason='not_due';
      else if(candidate.route==='buffer'){
        const matching=[...supplied.values()].find(record=>loopHash(canonical(record.candidate))===loopHash(canonical(candidate))
          &&record.epoch===epoch&&record.controlGeneration===controlKey(checked.snapshot,candidate)
          &&start.nowEpochMs<parseCmcpInstant(candidate.dueAt)+timeoutMs);
        if(!matching&&start.nowEpochMs!==parseCmcpInstant(candidate.dueAt))reason='buffer_expired_without_due_token';
      }
      if(!reason){const valid=await validateCurrent(candidate,'eligibility');if(valid.status!=='eligible')reason=valid.code;}
      if(reason){observed.push({id:candidate.id,route:candidate.route,reason});continue;}
      const reservation=await reserve(candidate,start);
      if(!reservation){observed.push({id:candidate.id,route:candidate.route,reason:'progress_already_reserved'});continue;}
      selected={candidate,reservation};break;
    }
    if(!selected)return {status:'ineligible',reason:'no_eligible_candidate',observed,modelCalls:0};
    const {candidate,reservation}=selected,capturedEpoch=epoch,controller=new AbortController();
    const active={controller,reservation,candidate};flight=active;
    const deadline=setTimeout(()=>controller.abort('dispatch_deadline'),Math.max(0,parseCmcpInstant(reservation.deadlineAt)-now().nowEpochMs));
    const ensure=async stage=>{
      const current=now();
      if(closed||controller.signal.aborted||epoch!==capturedEpoch||current.nowEpochMs>=parseCmcpInstant(reservation.deadlineAt))throw Error('dispatch_cancelled_or_deadline');
      const state=await controlsAt(current);
      if(state.reason||!state.controls[candidate.route==='buffer'?'buffer':'pins']
        ||controlKey(state.snapshot,candidate)!==controlKey(checked.snapshot,candidate))throw Error(state.reason??'dispatch_controls_changed');
      const verified=await validateCurrent(candidate,stage,controller.signal);
      if(verified.status!=='eligible')throw Error(verified.code);
    };
    let modelStarted=false,presentationStarted=false;
    try{
      await ensure('before_generation');modelStarted=true;
      const abortPromise=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('dispatch_cancelled_or_deadline')),{once:true}));
      const result=await Promise.race([generate(clone(candidate),{signal:controller.signal,reservation:clone(reservation),canContinue:async()=>{await ensure('generation');return true;}}),abortPromise]);
      await ensure('before_presentation');
      await append('dispatch_presentation_started',{id:reservation.id,key:reservation.key,at:now().now});presentationStarted=true;
      // Delivery must check canPresent immediately before its local side effect, not just when generation returns.
      const receipt=await deliver(result,clone(candidate),{signal:controller.signal,reservation:clone(reservation),canPresent:async()=>{await ensure('delivery');return true;}});
      if(receipt?.status!=='presented')throw Error('dispatch_presentation_unconfirmed');
      await append('dispatch_result',{id:reservation.id,key:reservation.key,status:'presented',at:now().now,receipt:clone(receipt)});
      return {status:'presented',candidateId:candidate.id,route:candidate.route,reservationId:reservation.id,receipt,modelCalls:1,observed};
    }catch(error){
      const outcome=presentationStarted?'presentation_unknown':controller.signal.aborted||capturedEpoch!==epoch?'cancelled':'not_presented';
      await append('dispatch_result',{id:reservation.id,key:reservation.key,status:outcome,code:error.message,at:now().now,
        remoteOutcome:modelStarted?'unknown':'not_started'});
      return {status:outcome,code:error.message,reservationId:reservation.id,modelCalls:modelStarted?1:0,observed};
    }finally{clearTimeout(deadline);if(flight===active)flight=null;}
  }
  function cancel(reason='user_control'){epoch++;armed.clear();flight?.controller.abort(reason);}
  function close(){closed=true;cancel('runtime_closed');}
  async function evaluate(input){
    if(admitted)return {status:'ineligible',reason:'work_in_progress',modelCalls:0};
    admitted=true;try{return await evaluateWork(input);}finally{admitted=false;}
  }
  // Reservation ownership exists before projection/generation. Buffer Clear must
  // not cancel a Pin while its exact sources are still being revalidated.
  return Object.freeze({arm,evaluate,status,cancel,close,activeRoute:()=>flight?.candidate.route??null});
}
