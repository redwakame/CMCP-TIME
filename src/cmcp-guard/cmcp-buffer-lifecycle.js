import path from 'node:path';
import {createLocalLoopJournal} from './cmcp-local-loop-journal.js';
import {parseCmcpInstant,resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';

const publications=new Map();
const safeGeneration=value=>Number.isSafeInteger(value)&&value>=0;
function boundaryKey({root,scopeId}){
  if(!path.isAbsolute(root)||typeof scopeId!=='string'||!scopeId)throw Error('explicit_buffer_scope_required');
  return JSON.stringify([path.resolve(root),scopeId]);
}

/** Short single-writer publication ordering across existing journals; no new durable store/lock. */
export async function withCmcpBufferPublication(scope,action){
  const key=boundaryKey(scope);
  if(typeof action!=='function')throw Error('invalid_buffer_publication');
  const prior=publications.get(key)??Promise.resolve();
  const operation=prior.then(action),tail=operation.catch(()=>{});publications.set(key,tail);
  try{return await operation;}finally{if(publications.get(key)===tail)publications.delete(key);}
}

/** Clear barriers remain in the common input journal. Absent records mean legacy generation zero. */
export async function readCmcpBufferBoundary({root,scopeId}){
  boundaryKey({root,scopeId});
  const journal=createLocalLoopJournal({root:path.join(root,'input-journal'),name:'cmcp-common-input-v1'});
  let generation=0,clearedAt=null;
  for(const {record} of await journal.readIncremental()){
    if(record.kind!=='buffer_clear')continue;
    const value=record.value;
    if(!value||typeof value.scopeId!=='string'||!safeGeneration(value.generation)||value.generation<1)throw Error('invalid_buffer_clear_record');
    parseCmcpInstant(value.clearedAt,'bufferClearedAt');
    if(value.scopeId!==scopeId)continue;
    if(value.generation!==generation+1)throw Error('invalid_buffer_clear_generation');
    generation=value.generation;clearedAt=value.clearedAt;
  }
  return {generation,clearedAt};
}

export async function assertCmcpBufferGeneration({root,scopeId,generation}){
  if(!safeGeneration(generation))throw Error('invalid_buffer_generation');
  const boundary=await readCmcpBufferBoundary({root,scopeId});
  if(boundary.generation!==generation)throw Error('buffer_cleared_during_operation');
  return boundary;
}

/** No default TTL, refresh, or inferred event time. */
export function cmcpBufferExpiry(activatedAt,ttlMs){
  if(ttlMs===undefined)return null;
  if(!Number.isSafeInteger(ttlMs)||ttlMs<=0)throw Error('invalid_buffer_ttl');
  const expires=parseCmcpInstant(activatedAt,'bufferActivatedAt')+ttlMs;
  if(!Number.isSafeInteger(expires)||!Number.isFinite(new Date(expires).getTime()))throw Error('invalid_buffer_expiry');
  return new Date(expires).toISOString();
}

/** Effective list plus retained observations. Legacy TTL is derived read-only from original activation. */
export function projectCmcpBufferState({focus,boundary,timeContext,ttlMs,scopeId}){
  if(!focus||!Array.isArray(focus.buffer)||!boundary||!safeGeneration(boundary.generation))throw Error('invalid_buffer_state');
  if(ttlMs!==undefined&&(!Number.isSafeInteger(ttlMs)||ttlMs<=0))throw Error('invalid_buffer_ttl');
  const temporal=timeContext===undefined?null:resolveCmcpTimeContext(timeContext);
  if(temporal&&temporal.source!=='explicit_injected')throw Error('explicit_buffer_time_required');
  const retainedBuffer=focus.buffer.map(entry=>{
    if(scopeId!==undefined&&entry.pointer?.scopeId!==scopeId)throw Error('buffer_entry_scope_mismatch');
    const generation=entry.bufferGeneration??focus.bufferGeneration??0;
    if(!safeGeneration(generation)||generation>boundary.generation)throw Error('invalid_buffer_generation');
    let expiry=entry.expiry??null,expirySource=expiry===null?'not_configured':'stored';
    if(expiry!==null)parseCmcpInstant(expiry,'bufferExpiry');
    else if(ttlMs!==undefined){expiry=cmcpBufferExpiry(entry.activatedAt,ttlMs);expirySource='configured_ttl_from_original_activation';}
    let status='active',reason='active';
    if(generation!==boundary.generation){status='inactive';reason='cleared';}
    else if(!temporal){status='unassessed';reason='time_not_provided';}
    else if(expiry===null){status='unassessed';reason='expiry_not_configured';}
    else if(temporal.nowEpochMs>=parseCmcpInstant(expiry)){status='inactive';reason='expired';}
    return {...structuredClone(entry),lifecycle:{status,reason,expiry,expirySource,generation}};
  });
  return {
    // Legacy callers without time/TTL retain observational entries, explicitly unassessed.
    buffer:retainedBuffer.filter(entry=>entry.lifecycle.status!=='inactive').map(({lifecycle,...entry})=>entry),
    retainedBuffer,bufferGeneration:boundary.generation,clearedAt:boundary.clearedAt,
    evaluation:{now:temporal?.now??null,timezone:temporal?.timezone??null,
      expiry:ttlMs===undefined?'no_configured_ttl':'existing_caller_ttl',ttlMs:ttlMs??null}
  };
}
