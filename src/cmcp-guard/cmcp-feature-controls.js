import path from 'node:path';
import {createLocalLoopJournal,loopHash} from './cmcp-local-loop-journal.js';
import {withCmcpBufferPublication} from './cmcp-buffer-lifecycle.js';
import {resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';
import {normalizeCmcpBufferRetention} from './cmcp-buffer-retention.js';

const clone=value=>structuredClone(value);
const booleans=['enabled','clean','buffer','timeIndex','historyRecall','answerHistory','discussionAssociation','saveUser','saveAssistant','proactive','pins'];
export const CMCP_FEATURE_CONTROL_DEFAULTS=Object.freeze({enabled:true,clean:false,buffer:true,timeIndex:true,
  historyRecall:true,answerHistory:true,discussionAssociation:true,saveUser:true,saveAssistant:true,proactive:false,pins:true,
  bufferRetentionHours:12,doNotDisturb:Object.freeze({enabled:false,timezone:null,windows:Object.freeze([])}),readingLimits:null,timezone:null,language:null});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export function normalizeCmcpFeatureControlPatch(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(CMCP_FEATURE_CONTROL_DEFAULTS,key)))throw Error('invalid_feature_control_patch');
  const patch=clone(value);
  if(patch.timezone!==undefined&&patch.timezone!==null){
    if(typeof patch.timezone!=='string'||!patch.timezone)throw Error('invalid_control_timezone');
    resolveCmcpTimeContext({now:'2026-01-01T00:00:00Z',timezone:patch.timezone});}
  if(patch.language!==undefined&&patch.language!==null&&(typeof patch.language!=='string'||!patch.language.trim()||patch.language.length>80))throw Error('invalid_control_language');
  for(const key of booleans)if(Object.hasOwn(patch,key)&&typeof patch[key]!=='boolean')throw Error('invalid_feature_control:'+key);
  if(Object.hasOwn(patch,'bufferRetentionHours'))normalizeCmcpBufferRetention({hours:patch.bufferRetentionHours});
  if(Object.hasOwn(patch,'doNotDisturb')){
    const dnd=patch.doNotDisturb;
    if(!dnd||typeof dnd.enabled!=='boolean'||!Array.isArray(dnd.windows)||dnd.windows.length>32
      ||Object.keys(dnd).some(key=>!['enabled','timezone','windows'].includes(key)))throw Error('invalid_do_not_disturb');
    if(dnd.timezone!==null){try{new Intl.DateTimeFormat('en',{timeZone:dnd.timezone}).format(0);}catch{throw Error('invalid_do_not_disturb_timezone');}}
    if(dnd.enabled&&(typeof dnd.timezone!=='string'||!dnd.windows.length))throw Error('explicit_do_not_disturb_schedule_required');
    for(const window of dnd.windows){
      if(!window||Object.keys(window).some(key=>!['start','end','weekdays'].includes(key))
        ||![window.start,window.end].every(text=>typeof text==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/u.test(text))
        ||window.start===window.end||window.weekdays!==undefined&&(!Array.isArray(window.weekdays)||!window.weekdays.length
          ||new Set(window.weekdays).size!==window.weekdays.length||window.weekdays.some(day=>!Number.isInteger(day)||day<0||day>6)))throw Error('invalid_do_not_disturb_window');
    }
  }
  if(Object.hasOwn(patch,'readingLimits')&&patch.readingLimits!==null){
    if(!patch.readingLimits||Array.isArray(patch.readingLimits)||!Object.keys(patch.readingLimits).length
      ||Object.keys(patch.readingLimits).some(key=>!['maxSources','maxReadBytes','maxProjectionBytes','pageBytes'].includes(key))
      ||Object.values(patch.readingLimits).some(number=>!Number.isSafeInteger(number)||number<1))throw Error('invalid_control_reading_limits');
  }
  return patch;
}
export function cmcpDoNotDisturbActive(controls,timeContext){
  const dnd=normalizeCmcpFeatureControlPatch({doNotDisturb:controls.doNotDisturb}).doNotDisturb;
  if(!dnd.enabled)return false;
  const temporal=resolveCmcpTimeContext(timeContext);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:dnd.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(temporal.nowEpochMs).map(part=>[part.type,part.value]));
  const today=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday),clock=parts.hour+':'+parts.minute;
  return dnd.windows.some(window=>{
    const overnight=window.start>window.end,inRange=overnight?clock>=window.start||clock<window.end:clock>=window.start&&clock<window.end;
    const startDay=overnight&&clock<window.end?(today+6)%7:today;
    return inRange&&(window.weekdays===undefined||window.weekdays.includes(startDay));
  });
}

/** Control metadata shares the existing common input journal; no History or second state store. */
export function createCmcpFeatureControls({root,scopeId,defaults={},sessionOverrides={}}){
  if(!path.isAbsolute(root)||typeof scopeId!=='string'||!scopeId)throw Error('explicit_controls_scope_required');
  const initial={...clone(CMCP_FEATURE_CONTROL_DEFAULTS),...normalizeCmcpFeatureControlPatch(defaults)};
  let overrides=normalizeCmcpFeatureControlPatch(sessionOverrides),sessionRevision=0;
  const journal=createLocalLoopJournal({root:path.join(root,'input-journal'),name:'cmcp-common-input-v1'});
  async function records(){return (await journal.read()).map(row=>row.record).filter(row=>['feature_controls','feature_control_epoch'].includes(row.kind)&&row.value.scopeId===scopeId);}
  async function snapshot(){
    let persistent=clone(initial),revision=0;const featureRevisions={};
    for(const {kind,value} of await records()){
      if(kind==='feature_control_epoch'){
        if(value.version!==1||typeof value.updateId!=='string'||!Array.isArray(value.keys)||new Set(value.keys).size!==value.keys.length
          ||value.keys.some(key=>!Object.hasOwn(CMCP_FEATURE_CONTROL_DEFAULTS,key))||typeof value.patchHash!=='string')throw Error('feature_control_epoch_invalid');
        for(const key of value.keys)featureRevisions[key]='session_epoch:'+loopHash([value.updateId,value.patchHash,value.at]);
        continue;
      }
      if(value.version!==1||value.revision!==revision+1)throw Error('feature_control_journal_invalid');
      persistent={...persistent,...normalizeCmcpFeatureControlPatch(value.patch)};revision=value.revision;
      for(const key of Object.keys(value.patch))featureRevisions[key]='persistent:'+revision;
    }
    // Unrelated settings do not cancel the other route; OFF -> ON still advances that feature's epoch.
    return {persistent,effective:{...clone(persistent),...clone(overrides)},revision,sessionRevision,
      generation:loopHash([scopeId,revision,canonical(featureRevisions),sessionRevision,canonical(overrides)]),featureRevisions,
      sessionOverrides:clone(overrides),modelCalls:0};
  }
  async function update({updateId,patch,timeContext,persist=true}){
    if(typeof updateId!=='string'||!updateId||typeof persist!=='boolean')throw Error('explicit_control_update_required');
    const normalized=normalizeCmcpFeatureControlPatch(patch),temporal=resolveCmcpTimeContext(timeContext);
    if(temporal.source!=='explicit_injected')throw Error('explicit_control_time_required');
    return withCmcpBufferPublication({root,scopeId},async()=>{
      const binding=(await journal.read())[0]?.record;
      if(binding?.kind!=='binding'||binding.value?.scopeId!==scopeId)throw Error('controls_require_initialized_common_input');
      const previous=(await records()).find(row=>row.value.updateId===updateId);
      const patchHash=loopHash(canonical(normalized));
      if(previous){
        const previousPersistent=previous.kind==='feature_controls';
        if(previousPersistent!==persist||(persist?loopHash(canonical(previous.value.patch)):previous.value.patchHash)!==patchHash)throw Error('control_update_conflict');
        // Replayed authorization never reinstates a discarded temporary value.
        return {...await snapshot(),persistence:persist?'already_saved':'already_recorded_session_epoch',at:previous.value.at};
      }
      if(!persist){
        await journal.append('feature_control_epoch',{version:1,scopeId,updateId,keys:Object.keys(normalized).sort(),patchHash,at:temporal.now});
        overrides={...overrides,...normalized};sessionRevision++;
        return {...await snapshot(),persistence:'session_only',epochPersistence:'durable_revocation_only_no_temporary_values',at:temporal.now};
      }
      const current=await snapshot();await journal.append('feature_controls',{version:1,scopeId,updateId,revision:current.revision+1,patch:normalized,at:temporal.now});
      return {...await snapshot(),persistence:'saved',at:temporal.now};
    });
  }
  return Object.freeze({snapshot,update});
}
