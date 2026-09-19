import {parseCmcpInstant,resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';
import {resolveCmcpLocalReadingBoundary} from './cmcp-natural-temporal-reading.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {loopHash} from './cmcp-local-loop-journal.js';

const copy=value=>structuredClone(value),eventOf=entry=>entry.eventScope??entry.eventLink?.event??null;
const sameEvent=(a,b)=>a?.scopeId===b?.scopeId&&a?.eventId===b?.eventId;

/** Calendar math is Runtime work, independent of Event/Buffer or language. */
export function cmcpReadingMonthRange({year,month,timezone}){
  if(!Number.isInteger(year)||year<1||year>9998||!Number.isInteger(month)||month<1||month>12)throw Error('invalid_reading_calendar_month');
  const date=(y,m)=>String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-01';
  const fromLocal=date(year,month),toLocal=date(month===12?year+1:year,month===12?1:month+1);
  return {from:resolveCmcpLocalReadingBoundary(fromLocal,timezone),to:resolveCmcpLocalReadingBoundary(toLocal,timezone),timezone};
}

/** Exhaustive registered scope navigation for a finite evidence lookup; not an account-wide assertion. */
export function selectCmcpReadingAuthorizedCollection({entries,scopeId,event=null,excludePointers=[]}){
  if(typeof scopeId!=='string'||!scopeId||!Array.isArray(entries))throw Error('explicit_history_inventory_scope_required');
  if(event!==null&&(event.scopeId!==scopeId||typeof event.eventId!=='string'||!event.eventId))throw Error('history_event_outside_scope');
  const excluded=new Set(excludePointers.map(cmcpSourcePointerKey)),unique=new Map();
  for(const entry of entries){
    if(entry.pointer?.scopeId!==scopeId)throw Error('history_inventory_scope_mismatch');
    const key=cmcpSourcePointerKey(entry.pointer);if(excluded.has(key)||event&&!sameEvent(eventOf(entry),event))continue;
    const prior=unique.get(key);if(prior&&prior.evidenceHash!==entry.evidenceHash)throw Error('history_inventory_identity_conflict');
    if(!prior)unique.set(key,copy(entry));
  }
  const frozen=[...unique.values()];
  return {status:frozen.length?'selected':'not_found',entries:frozen,descriptor:{kind:'authorized_history_inventory',event:copy(event),
    scopeCoverage:'frozen_authorized_registered_source_inventory',inventory:{scopeId,
      hash:loopHash(frozen.map(entry=>({pointer:entry.pointer,evidenceHash:entry.evidenceHash,messageRecordedAt:entry.messageRecordedAt}))),
      registeredSources:frozen.length,matchedSources:frozen.length,unresolvedTimeSources:[],completeWithinRegisteredInventory:true,
      historyBeyondRegisteredInventory:'not_established'}},reason:frozen.length?null:'no_registered_source_in_authorized_scope'};
}

/** Freeze the complete authorized registered inventory before paging; no top-k or text matching. */
export function selectCmcpReadingCalendarCollection({entries,scopeId,ranges,event=null,excludePointers=[]}){
  if(typeof scopeId!=='string'||!scopeId||!Array.isArray(entries)||!Array.isArray(ranges)||!ranges.length||ranges.length>8)
    throw Error('explicit_calendar_inventory_scope_required');
  if(event!==null&&(event.scopeId!==scopeId||typeof event.eventId!=='string'||!event.eventId))throw Error('calendar_event_outside_scope');
  const windows=ranges.map(range=>{
    const from=parseCmcpInstant(range.from),to=parseCmcpInstant(range.to);
    resolveCmcpTimeContext({now:range.from,timezone:range.timezone});
    if(to<=from)throw Error('invalid_calendar_range');return {...copy(range),fromEpoch:from,toEpoch:to};
  });
  const excluded=new Set(excludePointers.map(cmcpSourcePointerKey)),unique=new Map(),seen=new Map(),unknown=[],conflicts=[];
  for(const [position,entry] of entries.entries()){
    if(entry.pointer?.scopeId!==scopeId)throw Error('calendar_inventory_scope_mismatch');
    if(event&&!sameEvent(eventOf(entry),event))continue;
    const key=cmcpSourcePointerKey(entry.pointer);if(excluded.has(key))continue;
    const previous=seen.get(key);
    if(previous){if(previous.evidenceHash!==entry.evidenceHash)conflicts.push(entry.id);continue;}seen.set(key,entry);
    let instant;try{instant=parseCmcpInstant(entry.messageRecordedAt);}catch{unknown.push({id:entry.id,reason:'message_time_unknown_or_invalid'});continue;}
    unique.set(key,{entry,instant,position});
  }
  if(conflicts.length)throw Error('calendar_inventory_identity_conflict');
  const frozen=[...unique.values()].filter(row=>windows.some(range=>row.instant>=range.fromEpoch&&row.instant<range.toEpoch))
    .sort((a,b)=>a.instant-b.instant||a.position-b.position).map(row=>copy(row.entry));
  const inventoryHash=loopHash([...unique.values()].map(row=>({pointer:row.entry.pointer,evidenceHash:row.entry.evidenceHash,messageRecordedAt:row.entry.messageRecordedAt}))),
    descriptor={kind:'exact_calendar_union',event:copy(event),ranges:windows.map(({fromEpoch,toEpoch,...range})=>range),
      discussionExpansion:false,bounds:'inclusive_from_exclusive_to',scopeCoverage:'frozen_authorized_registered_calendar_union',
      inventory:{scopeId,hash:inventoryHash,registeredSources:unique.size+unknown.length,matchedSources:frozen.length,
        unresolvedTimeSources:unknown,completeWithinRegisteredInventory:unknown.length===0,historyBeyondRegisteredInventory:'not_established'}};
  return {status:frozen.length?'selected':unknown.length?'incomplete':'not_found',entries:frozen,descriptor,
    reason:frozen.length?null:unknown.length?'sources_with_unknown_message_time':'no_registered_source_in_exact_range'};
}
