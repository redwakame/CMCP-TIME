import {loopHash} from './cmcp-local-loop-journal.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {parseCmcpInstant} from './resolve-cmcp-time-context.js';

/** Operation identity, explicitly not a saved History source or a source Pointer. */
export function createCmcpEphemeralReadingQuery({scopeId,sessionId,operationId,text,issuedAt}){
  const value={kind:'ephemeral_reading_query',version:1,scopeId,sessionId,operationId,questionHash:loopHash(text),issuedAt};
  validateCmcpEphemeralReadingQuery(value,scopeId);if(typeof text!=='string'||!text.trim())throw Error('invalid_ephemeral_query_text');
  return Object.freeze(value);
}
export function validateCmcpEphemeralReadingQuery(value,scopeId){
  const keys=['kind','version','scopeId','sessionId','operationId','questionHash','issuedAt'];
  if(!value||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k))
    ||value.kind!=='ephemeral_reading_query'||value.version!==1||value.scopeId!==scopeId
    ||!['scopeId','sessionId','operationId'].every(k=>typeof value[k]==='string'&&value[k].trim())
    ||!/^[a-f0-9]{64}$/.test(value.questionHash??''))throw Error('invalid_ephemeral_query_authorization');
  parseCmcpInstant(value.issuedAt);return value;
}
export function cmcpReadingQueryKey(value){
  if(value.queryAuthorization){validateCmcpEphemeralReadingQuery(value.queryAuthorization,value.queryAuthorization.scopeId);
    if(value.queryPointer!=null)throw Error('ephemeral_query_cannot_claim_history_pointer');
    return 'operation:'+loopHash(value.queryAuthorization);}
  return 'source:'+cmcpSourcePointerKey(value.queryPointer);
}
export function assertCmcpEphemeralQueryText(value,text){
  validateCmcpEphemeralReadingQuery(value,value.scopeId);
  if(typeof text!=='string'||loopHash(text)!==value.questionHash)throw Error('ephemeral_query_text_required_or_changed');
}
export async function resolveCmcpReadingQuery({history,scopeId,binding}){
  if(binding.queryAuthorization){const auth=validateCmcpEphemeralReadingQuery(binding.queryAuthorization,scopeId);
    if(binding.queryPointer!=null||binding.queryHash!==loopHash(auth)||binding.queryTime!==auth.issuedAt)throw Error('reading_query_authorization_binding');
    return {pointer:null,queryAuthorization:structuredClone(auth)};
  }
  const query=await resolveCmcpHistorySource({provider:history,pointer:binding.queryPointer});
  if(query.status!=='found'||query.evidence.pointer.scopeId!==scopeId||query.evidence.sourceAuthorRole!=='user'
    ||loopHash(query.evidence)!==binding.queryHash||query.evidence.messageRecordedAt!==binding.queryTime)throw Error('reading_query_unavailable_or_changed');
  return query.evidence;
}
