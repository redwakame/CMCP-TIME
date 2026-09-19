import {loopHash} from './cmcp-local-loop-journal.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {buildCmcpDiscussionAssociationBinding,CMCP_DISCUSSION_REASON_MAX_CODE_POINTS} from './cmcp-discussion-association-protocol.js';
const copy=value=>structuredClone(value),key=cmcpSourcePointerKey;
const excerpt=text=>({text:[...text].slice(0,80).join(''),complete:[...text].length<=80,kind:'literal_locator_not_full_source'});
const validProposal=(value,context)=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const keys=value.status==='new_segment'?['status','currentQuote','reason']:value.status==='continue_segment'?['status','segmentRef','currentQuote','reason']:value.status==='unknown'?['status','reason']:null;
 return keys&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k))
  &&typeof value.reason==='string'&&value.reason.trim()&&[...value.reason].length<=CMCP_DISCUSSION_REASON_MAX_CODE_POINTS
  &&(value.status==='unknown'||typeof value.currentQuote==='string'&&value.currentQuote.length)
  &&(value.status!=='continue_segment'||context.mapping.some(row=>row.ref===value.segmentRef));
};

/** Append-only association interpretation in the existing input journal, not an additional History. */
export function createCmcpAutoDiscussion({discussions,stores,journal,timezone,limits,now,valid=async()=>true}){
 async function latest(pointer){return (await journal.read()).map(row=>row.record).filter(row=>row.kind==='auto_discussion_result'&&key(row.value.pointer)===key(pointer)).at(-1)?.value;}
 async function prepare({eventKey,source,bufferGeneration=0}){
  const prior=await latest(source.pointer);if(prior?.status==='associated')return {model:null,internal:{alreadyAssociated:prior}};
  const list=await discussions.list({eventKey,timezone}),all=list.segments,selected=all.slice(-4),mapping=selected.map((segment,index)=>({ref:'g'+(index+1),segment:copy(segment)}));
  const previous=(await journal.read()).map(row=>row.record).filter(row=>row.kind==='submission'||row.kind==='reactivation').at(-1)?.value;
  const model={version:1,segments:mapping.map(({ref,segment})=>({ref,firstMessageAt:segment.firstMessageAt,lastIncludedMessageAt:segment.lastIncludedMessageAt,
   startDate:segment.startDate,timezone:segment.timezone,first:excerpt(segment.sources[0].range.text),last:excerpt(segment.sources.at(-1).range.text)})),
   omittedSegments:Math.max(0,all.length-selected.length),previousTurn:previous?{sameEvent:previous.eventKey===eventKey,eventAssociated:previous.eventKey!=null}:null,
   basis:'explicit_semantic_membership_required_not_session_or_time'};
  buildCmcpDiscussionAssociationBinding(model);if(Buffer.byteLength(JSON.stringify(model))>3600)throw Error('discussion_context_budget');
  return {model,internal:{eventKey,sourcePointer:copy(source.pointer),sourceHash:loopHash(source),mapping,bufferGeneration}};
 }
 async function apply({prepared,source,proposal,eventVersion,canApply=async()=>true}){
  if(prepared.internal.alreadyAssociated)return {...prepared.internal.alreadyAssociated,replayed:true};
  const basis=prepared.internal,sourceKey=key(source.pointer),inputHash=loopHash({sourceHash:basis.sourceHash,eventKey:basis.eventKey,proposal,eventVersion});
  const prior=await latest(source.pointer);if(prior?.status==='associated')return {...prior,replayed:true};
  const requireValid=async()=>{if(!await valid()||!await canApply())throw Error('discussion_cancelled_or_stale');
   if(key(basis.sourcePointer)!==sourceKey||loopHash(source)!==basis.sourceHash)throw Error('discussion_source_changed');
   const found=await resolveCmcpHistorySource({provider:stores.history,pointer:source.pointer});
   if(found.status!=='found'||loopHash(found.evidence)!==basis.sourceHash||found.evidence.sourceAuthorRole!=='user')throw Error('discussion_source_changed');return true;};
  let result,sourceVerified=false;
  try{
   await requireValid();sourceVerified=true;if(!validProposal(proposal,basis))throw Error('invalid_discussion_association_proposal');
   if(proposal.status==='unknown')result={status:'unassociated',reason:proposal.reason};
   else{
    const target=proposal.status==='continue_segment'?basis.mapping.find(row=>row.ref===proposal.segmentRef).segment:null;
    const supports=target?target.sources.map(row=>({pointer:row.pointer,quote:row.range.text,sourceAuthorRole:row.sourceAuthorRole})):[];
    if(supports.some(row=>key(row.pointer)===sourceKey))throw Error('discussion_source_already_in_segment');
    supports.push({pointer:source.pointer,quote:proposal.currentQuote,sourceAuthorRole:'user'});
    const linked=await discussions.link({segmentId:target?.segmentId??'auto-'+loopHash([basis.eventKey,source.pointer]),eventKey:basis.eventKey,timezone,
     supports,limits,associationBasis:'model_proposed_exact_source_supported',...(target?{previousSegmentHash:target.segmentHash}:{})},{canLink:requireValid});
    result={status:'associated',segmentId:linked.segment.segmentId,segmentHash:linked.segment.segmentHash,operation:linked.status,reason:proposal.reason};
   }
  }catch(error){result={status:'pending',reason:error.message};}
  const receipt={...result,pointer:copy(source.pointer),sourceHash:basis.sourceHash,eventKey:basis.eventKey,bufferGeneration:basis.bufferGeneration??0,sourceVerified,eventVersion,inputHash,proposal:copy(proposal??null),
   at:now(),semanticVerification:'not_performed',originalTimesUnchanged:true,activation:'none'};
  await journal.append('auto_discussion_result',receipt);return receipt;
 }
 async function recordReply({source,replyTo,replyToEvidenceHash,eventKey,eventVersion,bufferGeneration}){
  const user=await resolveCmcpHistorySource({provider:stores.history,pointer:replyTo}),assistant=await resolveCmcpHistorySource({provider:stores.history,pointer:source.pointer});
  if(user.status!=='found'||assistant.status!=='found'||user.evidence.sourceAuthorRole!=='user'||assistant.evidence.sourceAuthorRole!=='assistant'
    ||source.pointer.scopeId!==stores.scopeId||replyTo.scopeId!==stores.scopeId||loopHash(user.evidence)!==replyToEvidenceHash||loopHash(assistant.evidence)!==loopHash(source))throw Error('assistant_reply_source_mismatch');
  const binding={version:1,pointer:copy(source.pointer),sourceHash:loopHash(source),replyTo:copy(replyTo),replyToEvidenceHash,eventKey,eventVersion,bufferGeneration,
   basis:'runtime_observed_answer_to_exact_user_source'};
  const prior=(await journal.read()).find(row=>row.record.kind==='assistant_reply_binding'&&key(row.record.value.pointer)===key(source.pointer))?.record.value;
  if(prior){if(JSON.stringify(prior)!==JSON.stringify(binding))throw Error('assistant_reply_binding_conflict');return prior;}
  await journal.append('assistant_reply_binding',binding);return binding;
 }
 async function attachReplies({userPointer,eventKey,bufferGeneration,canApply=async()=>true}){
  const rows=(await journal.read()).map(row=>row.record),bindings=rows.filter(row=>row.kind==='assistant_reply_binding'&&key(row.value.replyTo)===key(userPointer)).map(row=>row.value),results=[];
  for(const binding of bindings){
   const previous=rows.findLast(row=>row.kind==='assistant_discussion_result'&&key(row.value.pointer)===key(binding.pointer))?.value;
   if(previous?.status==='associated'){results.push({...previous,replayed:true});continue;}
   let result;
   try{
    const guard=async()=>{if(!await valid()||!await canApply()||binding.eventKey!==eventKey||binding.bufferGeneration!==bufferGeneration)throw Error('discussion_cancelled_or_stale');
     const user=await resolveCmcpHistorySource({provider:stores.history,pointer:userPointer}),assistant=await resolveCmcpHistorySource({provider:stores.history,pointer:binding.pointer});
     if(user.status!=='found'||assistant.status!=='found'||user.evidence.sourceAuthorRole!=='user'||assistant.evidence.sourceAuthorRole!=='assistant'
      ||loopHash(user.evidence)!==binding.replyToEvidenceHash||loopHash(assistant.evidence)!==binding.sourceHash)throw Error('assistant_reply_source_mismatch');return assistant.evidence;};
    const source=await guard(),userAssociation=await latest(userPointer);
    if(userAssociation?.status!=='associated')throw Error('user_discussion_unassociated');
    const segment=(await discussions.list({eventKey,timezone})).segments.find(row=>row.segmentId===userAssociation.segmentId);
    if(!segment||!segment.sources.some(row=>key(row.pointer)===key(userPointer)))throw Error('assistant_reply_user_segment_changed');
    let linked;
    if(segment.sources.some(row=>key(row.pointer)===key(binding.pointer)))linked={status:'unchanged',segment};
    else linked=await discussions.link({segmentId:segment.segmentId,eventKey,timezone,previousSegmentHash:segment.segmentHash,associationBasis:'model_proposed_exact_source_supported',limits,
     supports:[...segment.sources.map(row=>({pointer:row.pointer,quote:row.range.text,sourceAuthorRole:row.sourceAuthorRole})),{pointer:source.pointer,quote:source.content.body,sourceAuthorRole:'assistant'}]},
     {canLink:async()=>{await guard();return true;}});
    result={status:'associated',segmentId:linked.segment.segmentId,segmentHash:linked.segment.segmentHash,operation:linked.status};
   }catch(error){result={status:'pending',reason:error.message};}
   const receipt={...result,pointer:binding.pointer,replyTo:binding.replyTo,eventKey,bufferGeneration:binding.bufferGeneration,sourceHash:binding.sourceHash,
    sourceAuthorRole:'assistant',basis:binding.basis,eventMutation:'none',activation:'none',originalTimesUnchanged:true,at:now()};
   await journal.append('assistant_discussion_result',receipt);results.push(receipt);
  }return results;
 }
 async function status(){const map=new Map(),replies=new Map();for(const row of await journal.read()){
  if(row.record.kind==='auto_discussion_result')map.set(key(row.record.value.pointer),row.record.value);
  if(row.record.kind==='assistant_discussion_result')replies.set(key(row.record.value.pointer),row.record.value);}
  const results=[...map.values()];return {enabled:true,associated:results.filter(row=>row.status==='associated').length,
   unassociated:results.filter(row=>row.status==='unassociated'),pending:results.filter(row=>row.status==='pending'),
   assistant:{associated:[...replies.values()].filter(row=>row.status==='associated').length,pending:[...replies.values()].filter(row=>row.status==='pending')},modelCalls:0};}
 return Object.freeze({prepare,apply,status,latest,recordReply,attachReplies});
}
