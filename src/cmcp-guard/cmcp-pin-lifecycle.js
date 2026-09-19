import path from 'node:path';
import {createLocalLoopJournal,loopHash} from './cmcp-local-loop-journal.js';
import {withCmcpBufferPublication} from './cmcp-buffer-lifecycle.js';
import {createCmcpSourcePointer,cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {parseCmcpInstant,resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';

const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const text=value=>typeof value==='string'&&value.trim().length>0&&Buffer.byteLength(value,'utf8')<=1024;
function normalizeTarget(target){
  if(!target||!text(target.eventId)&&!text(target.sourceId)||Object.keys(target).some(key=>!['eventId','sourceId','objectId','aspect'].includes(key))
    ||Object.values(target).some(value=>!text(value)))throw Error('invalid_pin_target');
  return clone(target);
}
function instant(value){return value===null?null:new Date(parseCmcpInstant(value,'pinDueAt')).toISOString();}

/** Independent Pin lifecycle; records are append-only metadata in the existing common journal. */
export function createCmcpPinLifecycle({root,scopeId,verifyUserAction,verifySources}){
  if(!path.isAbsolute(root)||!text(scopeId)||typeof verifyUserAction!=='function'||typeof verifySources!=='function')throw Error('explicit_pin_scope_and_verifiers_required');
  const journal=createLocalLoopJournal({root:path.join(root,'input-journal'),name:'cmcp-common-input-v1'});
  async function rows(){return (await journal.read()).map(row=>row.record).filter(row=>row.kind==='pin_update'&&row.value.scopeId===scopeId);}
  async function list(){
    const pins=new Map();
    for(const {value} of await rows()){
      const pin=value.pin,previous=pins.get(pin?.pinId);
      if(value.version!==1||!pin||!text(pin.pinId)||pin.revision!==(previous?.revision??0)+1
        ||!['active','completed','cancelled'].includes(pin.status))throw Error('invalid_pin_journal');
      pins.set(pin.pinId,clone(pin));
    }
    return {kind:'cmcp_pin_list',scopeId,pins:[...pins.values()],modelCalls:0};
  }
  async function verifiedAction(userAction,operation){
    const result=await verifyUserAction({scopeId,userAction:clone(userAction),operation:clone(operation)});
    if(result?.status!=='verified')throw Error(result?.code??'pin_explicit_user_authorization_required');
    return clone(result);
  }
  async function verifiedSources(sourcePointers,target,progressVersion){
    const result=await verifySources({scopeId,sourcePointers:clone(sourcePointers),target:clone(target),progressVersion});
    if(result?.status!=='verified')throw Error(result?.code??'pin_source_unavailable_or_changed');
    return clone(result);
  }
  async function apply(input,create){
    if(!input||!text(input.updateId)||!text(input.pinId))throw Error('explicit_pin_update_required');
    const temporal=resolveCmcpTimeContext(input.timeContext);
    if(temporal.source!=='explicit_injected')throw Error('explicit_pin_time_required');
    let command;
    if(create){
      const target=normalizeTarget(input.target);
      if(!Array.isArray(input.sourcePointers)||!input.sourcePointers.length||input.sourcePointers.length>64||!text(input.progressVersion))throw Error('invalid_pin_sources_or_version');
      const sourcePointers=input.sourcePointers.map(createCmcpSourcePointer);
      if(sourcePointers.some(pointer=>pointer.scopeId!==scopeId)||new Set(sourcePointers.map(cmcpSourcePointerKey)).size!==sourcePointers.length)throw Error('pin_source_scope_or_duplicate');
      command={action:'create',pinId:input.pinId,target,sourcePointers,progressVersion:input.progressVersion,dueAt:instant(input.dueAt??null)};
      if(input.eligibilityPolicy!==undefined){
        if(input.eligibilityPolicy!=='explicit_independent_v1')throw Error('invalid_pin_eligibility_policy');
        command.eligibilityPolicy=input.eligibilityPolicy;
      }
    }else{
      if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!['schedule','complete','cancel'].includes(input.action))throw Error('invalid_pin_change');
      command={action:input.action,pinId:input.pinId,expectedRevision:input.expectedRevision,
        ...(input.action==='schedule'?{dueAt:instant(input.dueAt??null)}:{})};
    }
    const fingerprint=loopHash(canonical(command));
    return withCmcpBufferPublication({root,scopeId},async()=>{
      const binding=(await journal.read())[0]?.record;
      if(binding?.kind!=='binding'||binding.value?.scopeId!==scopeId)throw Error('pins_require_initialized_common_input');
      const all=await rows(),existing=all.find(row=>row.value.updateId===input.updateId);
      if(existing){if(existing.value.fingerprint!==fingerprint)throw Error('pin_update_conflict');return {status:'already_saved',pin:clone(existing.value.pin),modelCalls:0};}
      const previous=(await list()).pins.find(pin=>pin.pinId===input.pinId);
      if(create&&previous)throw Error('pin_already_exists');
      if(!create&&(!previous||previous.revision!==input.expectedRevision))throw Error('pin_revision_mismatch');
      if(!create&&previous.status!=='active')throw Error('pin_not_active');
      const authorization=await verifiedAction(input.userAction,command);
      let pin;
      if(create){
        const sourceValidation=await verifiedSources(command.sourcePointers,command.target,command.progressVersion);
        pin={version:1,pinId:input.pinId,scopeId,target:command.target,sourcePointers:command.sourcePointers,
          progressVersion:command.progressVersion,dueAt:command.dueAt,status:'active',revision:1,
          ...(command.eligibilityPolicy?{eligibilityPolicy:command.eligibilityPolicy}:{}),
          createdAt:temporal.now,updatedAt:temporal.now,sourceValidation};
      }else{
        pin={...previous,revision:previous.revision+1,updatedAt:temporal.now};
        if(command.action==='schedule')pin.dueAt=command.dueAt;
        else {pin.status=command.action==='complete'?'completed':'cancelled';pin.closedAt=temporal.now;}
      }
      await journal.append('pin_update',{version:1,scopeId,updateId:input.updateId,fingerprint,command,pin,authorization,at:temporal.now});
      return {status:'saved',pin:clone(pin),modelCalls:0};
    });
  }
  return Object.freeze({list,create:input=>apply(input,true),change:input=>apply(input,false)});
}
