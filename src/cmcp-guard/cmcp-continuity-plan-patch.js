import {loopHash} from './cmcp-local-loop-journal.js';

const copy=structuredClone,points=value=>[...value];
const states=new Set(['planned','paused','cancelled']);
function shape(value,required,optional=[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))
  ||Object.keys(value).some(k=>![...required,...optional].includes(k)))throw Error('continuity_plan_change_shape');
}
function identity(value){if(typeof value!=='string'||!value.trim()||points(value).length>80)throw Error('continuity_plan_change_id');return value;}
function fragment(match){return {ref:match.ref,citation:copy(match.citation),sourceAuthorRole:match.sourceAuthorRole,
 messageRecordedAt:match.messageRecordedAt,eventOccurredAt:match.eventOccurredAt,evidenceHash:match.evidenceHash};}
function sliceFragments(fragments,start,end){
 const result=[];let position=0;
 for(const part of fragments){const content=points(part.citation.text),left=Math.max(start,position),right=Math.min(end,position+content.length);
  if(left<right){const from=left-position,to=right-position;result.push({...copy(part),citation:{unit:'unicode_code_points',
   start:part.citation.start+from,end:part.citation.start+to,text:content.slice(from,to).join('')}});}
  position+=content.length;
 }
 return result;
}
const versionOf=state=>loopHash({fragments:state.fragments,planStatus:state.planStatus,statusSource:state.statusSource});
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const scopeBindingHash=value=>loopHash(ordered(value));

// 只核對正式來源片段是否被後續內容修改碰到；文字更動不證明理由已撤回。
// v6 的具名理由仍由宿主依原文判讀，這裡不寫狀態、不改 standing、不決定語意。
export function reviewCmcpReasonSpans({plans,reasonBindings,reasonRelations,sourceIdentity}){
 const receipts=plans.planChanges,byId=new Map(receipts.map(row=>[row.id,row])),bases=new Map(plans.planBasis.map(row=>[row.nodeId,row]));
 const findings=[],seen=new Set(),maxFindings=8;let unresolved=0;
 const sameSource=(a,b)=>{const identity=sourceIdentity(a.ref);return identity!=null&&a.evidenceHash===b.evidenceHash&&identity===sourceIdentity(b.ref);};
 for(const current of plans.currentPlans){
  if(current.planStatus==='cancelled')continue;
  const chain=[];let id=current.changeId;
  while(id!==null){const row=byId.get(id);if(!row)break;chain.unshift(row);id=row.afterChangeId;}
  for(const reason of reasonBindings){
   const owner=reason.binding;if(owner.nodeId!==current.nodeId)continue;
   let ownerIndex=-1;
   if(owner.kind==='plan_basis'){if(owner.basisVersion!==bases.get(current.nodeId)?.baseVersion)continue;}
   else if(owner.kind==='plan_change'){
    ownerIndex=chain.findIndex(row=>row.id===owner.changeId&&row.priorVersion===owner.priorVersion&&row.planVersion===owner.planVersion);
    if(ownerIndex===-1)continue;
   }else continue;
   for(const receipt of chain.slice(ownerIndex+1)){
    if(receipt.kind!=='content')continue;
    for(const part of receipt.parts){
     if(part.kind==='keep')continue;
     const priorText=points(part.priorSourceFragments.map(f=>f.citation.text).join('')),replacement=points(part.replacementSourceFragments.map(f=>f.citation.text).join(''));
     let start=0,end=priorText.length,right=replacement.length;
     while(start<end&&start<right&&priorText[start]===replacement[start])start++;
     while(end>start&&right>start&&priorText[end-1]===replacement[right-1]){end--;right--;}
     if(start===end)continue;
     for(const prior of sliceFragments(part.priorSourceFragments,start,end)){
      if(!sameSource(prior,reason))continue;
      const left=Math.max(prior.citation.start,reason.citation.start),right=Math.min(prior.citation.end,reason.citation.end);if(left>=right)continue;
      const restored=current.sourceFragments.filter(f=>sameSource(f,prior)).map(f=>f.citation).sort((a,b)=>a.start-b.start);
      let covered=left;for(const range of restored){if(range.start>covered)break;if(range.end>covered)covered=range.end;}
      if(covered>=right)continue;
      const key=JSON.stringify([current.nodeId,receipt.id,reason.reasonId,left,right]);if(seen.has(key))continue;seen.add(key);
      const namedWithdrawal=reasonRelations.filter(row=>row.kind==='withdraws'&&row.targetReasonIds?.includes(reason.reasonId));
      const requiresReview=reason.standing!=='withdrawn_by_explicit_user_source'||!namedWithdrawal.length;if(requiresReview)unresolved++;
      if(findings.length<maxFindings)findings.push({nodeId:current.nodeId,changeId:receipt.id,priorVersion:receipt.priorVersion,planVersion:receipt.planVersion,
       reasonId:reason.reasonId,reasonVersion:reason.reasonVersion,
       reasonBinding:owner.kind==='plan_basis'?{kind:owner.kind,nodeId:owner.nodeId,basisVersion:owner.basisVersion}:
        {kind:owner.kind,nodeId:owner.nodeId,changeId:owner.changeId,priorVersion:owner.priorVersion,planVersion:owner.planVersion},
       sourceRef:reason.ref,sourceEvidenceHash:reason.evidenceHash,
       range:{unit:'unicode_code_points',start:left,end:right},changeRef:receipt.source.ref,standing:reason.standing,
       namedWithdrawalRefs:namedWithdrawal.map(row=>row.ref),requiresReview,
       reason:'content_change_touches_formally_cited_reason_span',
       requiredReview:'check_reason_effect_against_original_sources;_content_edit_is_not_reason_withdrawal;_preserve_valid_reasons_and_use_a_named_withdrawal_only_when_explicitly_supported'});
     }
    }
   }
  }
 }
 return {kind:'cmcp_reason_scope_review',version:1,status:unresolved?'required':seen.size?'addressed_by_named_withdrawal':'no_overlap_detected',
  authority:'exact_source_overlap_not_semantic_conflict_proof',semanticVerification:'not_performed',
  scope:'provided_named_reasons_and_selected_current_plan_chains_only',completeness:'not_established',
  findings,totalFindings:seen.size,unresolvedFindings:unresolved,maxFindings,truncated:seen.size>findings.length};
}

// 只查看已宣告 content 修改引文的用途；不把整則原文當修改範圍。
// 未進入 replacement 的字元可能是對象、連接詞、撤回指令或理由，不能據此判語意錯誤。
// 不接受 ACK／任意 support；上下文用途仍不等於條件已套用，也不使提示成為 resolved。
export function reviewCmcpContentSourceUses({plans,retentions=[],reasonBindings=[],nodes=[],sourceIdentity,sourcePointer}){
 const maxFindings=8,maxReviewBytes=8192,findings=[];
 if(!Array.isArray(plans?.planChanges)||plans.planChanges.length>24||!Array.isArray(retentions)||retentions.length>8
  ||!Array.isArray(reasonBindings)||reasonBindings.length>24||!Array.isArray(nodes)||nodes.length>24)throw Error('continuity_source_use_limit');
 const nodeById=new Map(nodes.map(node=>[node.id,node]));
 const sourceRange=value=>({unit:'unicode_code_points',start:value.citation.start,end:value.citation.end});
 const valid=value=>value?.sourceAuthorRole==='user'&&typeof value.evidenceHash==='string'
  &&value.citation?.unit==='unicode_code_points'&&Number.isSafeInteger(value.citation.start)&&value.citation.start>=0
  &&Number.isSafeInteger(value.citation.end)&&value.citation.end>value.citation.start
  &&typeof value.citation.text==='string'&&points(value.citation.text).length===value.citation.end-value.citation.start;
 const sameSource=(a,b)=>valid(a)&&valid(b)&&sourceIdentity(a.ref)!=null&&sourceIdentity(a.ref)===sourceIdentity(b.ref)
  &&a.evidenceHash===b.evidenceHash&&a.messageRecordedAt===b.messageRecordedAt&&a.eventOccurredAt===b.eventOccurredAt;
 const merge=ranges=>{
  const merged=[];for(const range of ranges.sort((a,b)=>a.start-b.start||a.end-b.end)){
   const last=merged.at(-1);if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);else merged.push({...range});
  }return merged;
 };
 const clipped=(source,value)=>sameSource(source,value)&&value.citation.start<source.citation.end&&value.citation.end>source.citation.start
  ?{unit:'unicode_code_points',start:Math.max(source.citation.start,value.citation.start),end:Math.min(source.citation.end,value.citation.end)}:null;
 const unused=(source,used)=>{
  const result=[],text=points(source.citation.text);let cursor=source.citation.start;
  const add=(start,end)=>result.push({unit:'unicode_code_points',start,end,text:text.slice(start-source.citation.start,end-source.citation.start).join('')});
  for(const range of merge(used)){if(range.start>cursor)add(cursor,range.start);cursor=Math.max(cursor,range.end);}
  if(cursor<source.citation.end)add(cursor,source.citation.end);return result;
 };
 let contentChanges=0,totalFindings=0,omittedFindings=0;
 const review=()=>({kind:'cmcp_content_source_use_review',version:1,
  status:totalFindings?'source_use_check_cues':'no_unused_replacement_source_detected',
  scope:'declared_content_change_quotes_only',authority:'formal_source_range_usage_not_semantic_omission_proof',
  sourceBindingVerification:'validated',semanticVerification:'not_performed',executionAuthority:'none',
  instruction:'本次 content 引文尚未進入 replacement 的片段在 unusedEffectRanges。回答前對照同來源原話與目前計畫，核對是否還有未套用的修改；contextualUses 是理由／保留用途，不等於替換效果。對象、連接詞、標點或撤回指令可留下，未使用字元不證明語意錯誤、原件漏選或應新增未知；不要用 ACK、其他來源或一般引用消除提示。',
  contentChanges,findings,totalFindings,omittedFindings,maxFindings,maxReviewBytes,
  truncated:omittedFindings>0,completeness:omittedFindings?'bounded_findings_only':'provided_content_changes_only'});
 for(const [changeIndex,change]of plans.planChanges.entries()){
  if(change.kind!=='content')continue;contentChanges++;
  const source=change.source;if(!valid(source)||sourceIdentity(source.ref)==null||!sourcePointer(source.ref))throw Error('continuity_source_use_binding_invalid');
  const effectRanges=[];
  for(const part of change.parts)if(part.kind==='replace')for(const added of part.replacementSourceFragments){
   const range=clipped(source,added);if(range)effectRanges.push(range);
  }
  const mergedEffects=merge(effectRanges),unusedEffectRanges=unused(source,mergedEffects);
  if(!unusedEffectRanges.length)continue;totalFindings++;
  const contextualUses=[];
  const contextual=(value,owner)=>{const range=clipped(source,value);if(range)contextualUses.push({...owner,range});};
  // 只有已綁這次修改及兩個版本的具名理由，才能列為它的上下文用途。
  for(const reason of reasonBindings){const owner=reason.binding;
   if(reason.standing==='withdrawn_by_explicit_user_source'||owner?.kind!=='plan_change'||owner.nodeId!==change.targetNodeId
    ||owner.changeId!==change.id||owner.priorVersion!==change.priorVersion||owner.planVersion!==change.planVersion)continue;
   contextual(reason,{kind:'reason',reasonId:reason.reasonId});
  }
  if(change.reason)contextual(change.reason,{kind:'reason',ownerChangeId:change.id});
  for(const [index,retention]of retentions.entries()){
   const actor=nodeById.get(retention.byNodeId);
   if(actor?.kind!=='user_intent'||actor.temporalUse!=='current'||retention.byNodeId===change.targetNodeId
    ||!retention.targetNodeIds.includes(change.targetNodeId))continue;
   contextual(retention,{kind:'retention',index,byNodeId:retention.byNodeId});
  }
  const finding={changeId:change.id,targetNodeId:change.targetNodeId,priorVersion:change.priorVersion,planVersion:change.planVersion,
   source:{ref:source.ref,pointer:copy(sourcePointer(source.ref)),evidenceHash:source.evidenceHash,range:sourceRange(source),
    sourceAuthorRole:source.sourceAuthorRole,messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt},
   sourceReference:`/projection/planChanges/${changeIndex}/source`,effectRanges:mergedEffects,contextualUses,unusedEffectRanges,
   unallocatedRanges:unused(source,[...mergedEffects,...contextualUses.map(use=>use.range)])};
  if(findings.length>=maxFindings){omittedFindings++;continue;}
  findings.push(finding);
  if(Buffer.byteLength(JSON.stringify(review()))>maxReviewBytes){findings.pop();omittedFindings++;}
 }
 while(findings.length&&Buffer.byteLength(JSON.stringify(review()))>maxReviewBytes){findings.pop();omittedFindings++;}
 return review();
}

// 相同正式片段在一個目前計畫已改、另一個仍保留時，列出作用範圍核對線索。
// 共用來源不證明同一修改對象：只要求宿主核對，不拒絕、改值、丟棄條件或新增未知。
function reviewCurrentSpans({currentPlans,receipts,byId,sourceIdentity,sourcePointer}){
 const active=currentPlans.filter(row=>row.planStatus!=='cancelled'),findings=[],seen=new Set(),maxFindings=8;
 const sameSource=(a,b)=>a.evidenceHash===b.evidenceHash&&sourceIdentity(a.ref)===sourceIdentity(b.ref);
 for(const changed of active){
  const ancestors=new Set();let id=changed.changeId;
  while(id!==null){ancestors.add(id);id=byId.get(id).afterChangeId;}
  for(const receipt of receipts){
   if(receipt.targetNodeId!==changed.nodeId||!ancestors.has(receipt.id)||receipt.kind!=='content')continue;
   for(const part of receipt.parts){
    if(part.kind==='keep')continue;
    const priorText=points(part.priorSourceFragments.map(f=>f.citation.text).join(''));
    const replacement=points(part.replacementSourceFragments.map(f=>f.citation.text).join(''));
    // 精確相同的前後綴未改字元不列疑點；不做語意對齊或模糊字詞比對。
    let start=0,end=priorText.length,right=replacement.length;
    while(start<end&&start<right&&priorText[start]===replacement[start])start++;
    while(end>start&&right>start&&priorText[end-1]===replacement[right-1]){end--;right--;}
    if(start===end)continue;
    for(const prior of sliceFragments(part.priorSourceFragments,start,end)){
     // 同一明示鏈若已恢復該正式來源片段，不把較早的修改當成目前撤回。
     const restored=changed.sourceFragments.filter(f=>sameSource(f,prior)).map(f=>f.citation).sort((a,b)=>a.start-b.start);
     let covered=prior.citation.start;
     for(const range of restored){if(range.start>covered)break;covered=Math.max(covered,range.end);}
     if(covered>=prior.citation.end)continue;
     for(const retained of active){
      // topic／objectId 是宿主提出的語意名稱，不是正式來源身分。
      // 不因不同命名漏掉同一片段；也不因此認定兩者是同一個修改對象。
      if(retained.nodeId===changed.nodeId)continue;
      for(const other of retained.sourceFragments){
       if(!sameSource(prior,other))continue;
       const left=Math.max(prior.citation.start,other.citation.start),right=Math.min(prior.citation.end,other.citation.end);
       if(left>=right)continue;
       const key=JSON.stringify([changed.nodeId,receipt.id,retained.nodeId,prior.ref,left,right]);if(seen.has(key))continue;seen.add(key);
       const binding={source:{ref:prior.ref,pointer:copy(sourcePointer(prior.ref)),evidenceHash:prior.evidenceHash,
        range:{unit:'unicode_code_points',start:left,end:right}},
        retainedPlan:{nodeId:retained.nodeId,planVersion:retained.planVersion},
        changedPlan:{nodeId:changed.nodeId,planVersion:changed.planVersion,changeId:receipt.id}};
       if(findings.length<maxFindings)findings.push({findingId:scopeBindingHash(binding),...binding,nodeId:retained.nodeId,ref:other.ref,targetNodeId:changed.nodeId,changeId:receipt.id,
        changedRef:receipt.source.ref,sourceRef:prior.ref,sourceEvidenceHash:prior.evidenceHash,
        sameProposedObject:retained.objectId===changed.objectId,
        range:{unit:'unicode_code_points',start:left,end:right},
        reason:'current_plan_retains_formal_span_changed_by_another_current_plan',
        requiredReview:'check_actual_change_target_and_retained_condition_scope;_same_source_span_does_not_prove_same_target;_preserve_independent_unchanged_conditions'});
      }
     }
    }
   }
  }
 }
 return {kind:'cmcp_plan_scope_review',version:2,status:seen.size?'required':'no_overlap_detected',
  authority:'exact_source_overlap_not_semantic_conflict_proof',semanticVerification:'not_performed',
  findings,totalFindings:seen.size,unresolvedFindings:seen.size,maxFindings,truncated:seen.size>findings.length};
}

// 獨立保留只接受這張票券的兩個目前版本、正式來源區間及明示 retention。
// 核對成功只證明來源與宣告綁定，不證明宿主對「獨立」的語意判讀正確。
export function resolveCmcpPlanScope({review,resolutions=[],retentions,nodes,support,limits,sourceIdentity,correction}){
 if(!Array.isArray(resolutions)||resolutions.length>review.maxFindings)throw Error('continuity_scope_resolution_limit');
 const findings=new Map(review.findings.map(row=>[row.findingId,row])),seen=new Set(),resolved=[];
 for(const [index,row]of resolutions.entries()){
  shape(row,['findingId','kind','source','retainedPlan','changedPlan','evidence']);
  shape(row.source,['ref','pointer','evidenceHash','range']);shape(row.source.range,['unit','start','end']);
  shape(row.retainedPlan,['nodeId','planVersion']);shape(row.changedPlan,['nodeId','planVersion','changeId']);shape(row.evidence,['ref','quote']);
  const finding=findings.get(row.findingId);
  if(row.kind!=='independent_retention'||!finding||seen.has(row.findingId))throw correction('continuity_scope_resolution_binding',
   [{path:`$.scopeResolutions[${index}]`,reason:'unknown_duplicate_or_unsupported_scope_resolution',expected:'one_source_bound_independent_retention_for_one_current_finding'}]);
  seen.add(row.findingId);
  const binding={source:row.source,retainedPlan:row.retainedPlan,changedPlan:row.changedPlan};
  if(scopeBindingHash(binding)!==finding.findingId)throw correction('continuity_scope_resolution_binding',
   [{path:`$.scopeResolutions[${index}]`,findingId:row.findingId,reason:'source_range_pointer_or_current_plan_version_changed',expected:'use_the_exact_binding_of_the_current_finding;_new_proposals_must_recheck_changed_versions'}]);
  const matched=support(row.evidence.ref,row.evidence.quote,limits.maxReasonCodePoints);
  if(matched.sourceAuthorRole!=='user')throw Error('continuity_scope_resolution_user_source_required');
  const retention=retentions.find(value=>value.targetNodeIds.includes(finding.nodeId)&&value.ref===matched.ref
   &&value.citation.start===matched.citation.start&&value.citation.end===matched.citation.end
   &&value.evidenceHash===matched.evidenceHash);
  if(!retention||nodes.find(node=>node.id===retention.byNodeId)?.temporalUse!=='current')throw correction('continuity_scope_resolution_retention_required',
   [{path:`$.scopeResolutions[${index}].evidence`,findingId:row.findingId,reason:'independent_retention_requires_same_formal_user_retention_for_retained_plan',expected:'cite_the_explicit_preservation_already_bound_to_the_retained_plan;_do_not_acknowledge_or_relabel_a_report'}]);
  if(sourceIdentity(matched.ref)===sourceIdentity(finding.sourceRef)&&matched.evidenceHash===finding.sourceEvidenceHash
   &&matched.citation.start<finding.range.end&&matched.citation.end>finding.range.start)
   throw correction('continuity_scope_resolution_distinct_support_required',
    [{path:`$.scopeResolutions[${index}].evidence`,findingId:row.findingId,reason:'changed_formal_span_is_not_independent_preservation_support',expected:'cite_distinct_explicit_user_preservation;_same_source_binding_does_not_establish_independent_scope'}]);
  resolved.push({findingId:row.findingId,kind:row.kind,evidence:fragment(matched),retentionByNodeId:retention.byNodeId,
   authority:'source_bound_host_declared_independence_not_semantic_verification',semanticVerification:'not_performed',executionAuthority:'none'});
 }
 const unresolvedFindings=review.totalFindings-resolved.length;
 return {...review,status:unresolvedFindings?'required':resolved.length?'addressed_by_source_bound_host_resolution':'no_overlap_detected',
  findings:review.findings.map(f=>({...f,resolutionStatus:seen.has(f.findingId)?'source_bound_host_declaration':'pending'})),
  unresolvedFindings,resolutions:resolved,sourceBindingVerification:'validated',semanticVerification:'not_performed'};
}

// 查詢衍生層的有界稀疏修改；不新增 History、Event、授權或派送工作。
// 不以詞彙、標點、時間或陣列順序猜測修訂。語意仍由宿主提出並另行驗收。
export function projectCmcpPlanChanges({proposal,view,support,limits,correction,sourceIdentity,sourcePointer,namedReasons}){
 const bases=new Map(),current=new Map((view.currentPlans??[]).map(row=>[row.nodeId,row]));
 for(const node of proposal.nodes){if(node.kind!=='user_intent'||node.planRole==='evidence')continue;
  const matched=support(node.ref,node.quote,limits.maxQuoteCodePoints);
  const state={fragments:[fragment(matched)],planStatus:node.planStatus??'planned',statusSource:null};
  bases.set(node.id,{node,state:{...state,planVersion:versionOf(state)}});
 }
 const changes=proposal.planChanges??[];
 if(!Array.isArray(changes)||changes.length>limits.maxPlanChanges)throw Error('continuity_plan_change_limit');
 const byId=new Map();
 for(const change of changes){
  shape(change,['id','targetNodeId','afterChangeId','kind','ref','quote'],['reason',...(change.kind==='status'?['planStatus']:change.kind==='content'?['parts']:[])]);
  identity(change.id);identity(change.targetNodeId);
  if(byId.has(change.id)||bases.has(change.id))throw Error('continuity_duplicate_plan_change');
  if(proposal.nodes.some(node=>node.id===change.targetNodeId&&node.planRole==='evidence'))throw correction('continuity_plan_evidence_change_target',
   [{nodeId:change.targetNodeId,changeId:change.id,reason:'evidence_cannot_be_changed_as_a_plan',expected:'target_the_explicit_plan_basis'}]);
  if(!bases.has(change.targetNodeId))throw Error('continuity_plan_change_target');
  if(change.afterChangeId!==null)identity(change.afterChangeId);
  if(!['status','content','reason'].includes(change.kind))throw Error('continuity_plan_change_kind');
  if(change.kind==='reason'&&change.reason===undefined&&!namedReasons?.some(reason=>reason.ownerChangeId===change.id))throw Error('continuity_plan_change_reason_required');
  byId.set(change.id,change);
 }
 const resolved=new Map(),visiting=new Set(),receipts=[];
 function resolve(id){
  if(resolved.has(id))return resolved.get(id);
  if(visiting.has(id))throw Error('continuity_plan_change_cycle');
  const change=byId.get(id);if(!change)throw Error('continuity_plan_change_predecessor_missing');
  visiting.add(id);
  const predecessor=change.afterChangeId===null?null:byId.get(change.afterChangeId);
  if(change.afterChangeId!==null&&(!predecessor||predecessor.targetNodeId!==change.targetNodeId))throw Error('continuity_plan_change_predecessor_target');
  const before=predecessor?resolve(predecessor.id):bases.get(change.targetNodeId).state;
  const matched=support(change.ref,change.quote,limits.maxQuoteCodePoints);
  if(matched.sourceAuthorRole!=='user')throw Error('continuity_plan_change_user_source_required');
  let reason=null;
  if(change.reason!==undefined){
   shape(change.reason,['ref','quote'],['kind']);
   if(change.reason.kind!==undefined&&!['adds','prioritizes','accepts_tradeoff'].includes(change.reason.kind))throw Error('continuity_plan_change_reason_kind');
   const cited=support(change.reason.ref,change.reason.quote,limits.maxReasonCodePoints);
   if(cited.sourceAuthorRole!=='user'||cited.ref!==matched.ref)throw correction('continuity_plan_change_reason_source_mismatch',
    [{nodeId:change.targetNodeId,changeId:change.id,ref:matched.ref,reason:'change_reason_requires_same_user_source',expected:'cite_a_reason_from_the_same_formally_read_user_change_source'}]);
   reason={...fragment(cited),...(change.reason.kind===undefined?{}:{kind:change.reason.kind,standing:'not_explicitly_withdrawn'})};
  }
  const after=copy(before),partReceipts=[];
  if(change.kind==='status'){
   if(!states.has(change.planStatus))throw Error('continuity_plan_change_status');
   after.planStatus=change.planStatus;after.statusSource=fragment(matched);
  }else if(change.kind==='content'){
   const length=before.fragments.reduce((n,f)=>n+points(f.citation.text).length,0);
   if(!Array.isArray(change.parts)||!change.parts.length||change.parts.length>limits.maxPlanParts||!length)throw Error('continuity_plan_change_parts');
   let cursor=0;const next=[],priorText=before.fragments.map(f=>f.citation.text).join('');
   for(const part of change.parts){
    shape(part,['quote','kind'],part.kind==='replace'?['replacement']:[]);
    if(typeof part.quote!=='string'||!part.quote.length)throw Error('continuity_plan_part_quote_required');
    const start=cursor,end=start+points(part.quote).length;
    if(end>length||points(priorText).slice(start,end).join('')!==part.quote)
     throw correction('continuity_plan_scope_incomplete',[{nodeId:change.targetNodeId,changeId:change.id,reason:'gap_overlap_or_invalid_range',expected:'contiguous_unicode_code_point_ranges_cover_every_prior_fragment'}]);
    if(!['keep','replace','withdraw'].includes(part.kind))throw Error('continuity_plan_part_kind');
    const prior=sliceFragments(before.fragments,start,end);let replacement=[];
    if(part.kind==='replace'){
     shape(part.replacement,['ref','quote']);
     const added=support(part.replacement.ref,part.replacement.quote,limits.maxQuoteCodePoints);
     if(added.sourceAuthorRole!=='user'||added.ref!==matched.ref||added.citation.start<matched.citation.start||added.citation.end>matched.citation.end)
      throw Error('continuity_plan_replacement_source_mismatch');
     replacement=[fragment(added)];next.push(...replacement);
    }else if(part.kind==='keep')next.push(...prior);
    partReceipts.push({start,end,kind:part.kind,priorSourceFragments:prior,replacementSourceFragments:replacement});
    cursor=end;
   }
   if(cursor!==length)throw correction('continuity_plan_scope_incomplete',[{nodeId:change.targetNodeId,changeId:change.id,
    reason:'unaccounted_prior_fragments',expected:'explicitly_keep_replace_or_withdraw_every_prior_fragment'}]);
   after.fragments=next;
  }
  after.planVersion=versionOf(after);resolved.set(id,after);visiting.delete(id);
  receipts.push({id:change.id,targetNodeId:change.targetNodeId,afterChangeId:change.afterChangeId,kind:change.kind,
   source:fragment(matched),priorVersion:before.planVersion,planVersion:after.planVersion,
   reasonStatus:reason?'provided':namedReasons?.some(row=>row.ownerChangeId===change.id)?'provided_by_binding':'not_provided',reason:reason?{...reason,
    binding:{kind:'plan_change',nodeId:change.targetNodeId,changeId:change.id,priorVersion:before.planVersion,planVersion:after.planVersion},
    relationAuthority:'host_proposed_reason_relation_not_semantically_verified'}:null,
   effect:change.kind==='status'?'status_only_conditions_preserved':change.kind==='reason'?'reason_only_conditions_and_status_preserved':'only_explicitly_scoped_content_changed',
   ...(change.kind==='status'?{planStatus:change.planStatus}:change.kind==='content'?{parts:partReceipts}:{}),semanticVerification:'not_performed',executionAuthority:'none'});
  return after;
 }
 for(const change of changes)resolve(change.id);
 const consumed=new Set(changes.map(c=>c.afterChangeId).filter(Boolean)),currentPlans=[],unresolvedPlans=copy(view.unresolvedPlans??[]),planBasis=[],unestablished=new Map();
 const row=(base,state,changeId)=>({...copy(current.get(base.node.id)??{nodeId:base.node.id,objectId:base.node.topic,aspect:base.node.aspect}),
  text:state.fragments.map(f=>f.citation.text).join(''),textAuthority:'concatenated_formal_fragments_not_a_new_user_message',
  planStatus:state.planStatus,conditionState:state.fragments.length?'present':'explicitly_withdrawn',
  sourceFragments:copy(state.fragments),statusSource:copy(state.statusSource),planVersion:state.planVersion,changeId,
  authority:'user_intent_not_outcome_or_execution_permission'});
 for(const [id,base]of bases){
  const leaves=changes.filter(c=>c.targetNodeId===id&&!consumed.has(c.id));
  const candidates=leaves.length?leaves.map(c=>row(base,resolved.get(c.id),c.id)):[row(base,base.state,null)];
  planBasis.push({nodeId:id,temporalUse:base.node.temporalUse,source:fragment(support(base.node.ref,base.node.quote,limits.maxQuoteCodePoints)),
   baseVersion:base.state.planVersion,reasonStatus:base.node.reason===undefined?(namedReasons?.some(row=>row.ownerNodeId===id&&row.ownerChangeId===null)?'provided_by_binding':'not_provided'):'provided',
   currentEligibility:current.has(id)?'selected_current_basis':'not_established_as_current',candidates});
  if(!current.has(id)){
   // 未宣告為本題目前基底仍保留未知身分，不提升為 current，也不靜默變成空集合。
   if(!unresolvedPlans.some(group=>group.nodeIds?.includes(id))){
    const ids=unestablished.get(base.node.temporalUse)??[];ids.push(id);unestablished.set(base.node.temporalUse,ids);
   }
   continue;
  }
  if(candidates.length===1)currentPlans.push(candidates[0]);
  else unresolvedPlans.push({objectId:base.node.topic,aspect:base.node.aspect,nodeIds:[id],changeIds:candidates.map(c=>c.changeId),
   reason:'competing_explicit_plan_change_branches',candidates});
 }
 // 同一未確立原因只保留識別清單；完整候選由 planBasis 對應，避免呈現使原有容量退步。
 for(const [temporalUse,nodeIds]of unestablished)unresolvedPlans.push({nodeIds,reason:'plan_currentness_not_established',temporalUse,
  candidateSource:{collection:'planBasis',key:'nodeId'},authority:'unestablished_host_selection_not_current_state_or_execution_permission'});
 const planScopeReview=reviewCurrentSpans({currentPlans,receipts,byId,sourceIdentity,sourcePointer});
 return {currentPlans,unresolvedPlans,planBasis,planChanges:receipts,planScopeReview,
  planCoverage:{scope:'proposed_source_bound_plan_bases_only',historyCompleteness:'not_established',
   semanticCompleteness:'not_inferred_from_span_coverage',proposedBases:bases.size,changes:changes.length,
   selectedCurrentBasisNodeIds:[...bases.keys()].filter(id=>current.has(id)),
   unestablishedCurrentBasisNodeIds:[...bases.keys()].filter(id=>!current.has(id)),
   currentnessMeaning:'explicit_host_selection_for_query_not_original_time_or_execution'}};
}

// 證據仍是正式 User 意圖；只有明示用途能把它與基底連接，
// 不用來源相同、相似文字、時間或列舉順序自行判為同案。
export function projectCmcpPlanEvidence({proposal,plans,scoped,support,limits,correction,namedReasons}){
 const nodes=new Map(proposal.nodes.map(node=>[node.id,node])),basisIds=new Set(plans.planBasis.map(base=>base.nodeId)),result=[];
 const changeTargets=new Map(plans.planChanges.map(change=>[change.id,change.targetNodeId]));
 const reasonTargets=new Map((namedReasons??[]).map(reason=>[reason.reasonId,reason.binding.nodeId]));
 const relationTargets=row=>row.targetNodeIds??(row.targetReasonIds?row.targetReasonIds.map(id=>reasonTargets.get(id)):row.targetChangeIds.map(id=>changeTargets.get(id)));
 for(const node of proposal.nodes){
  if(node.planRole!=='evidence')continue;
  const related=node.relation?.targetNodeIds??[],matched=support(node.ref,node.quote,limits.maxQuoteCodePoints);
  const badTarget=related.find(id=>!basisIds.has(id)||nodes.get(id)?.topic!==node.topic);
  if(node.relation?.kind!=='related'||!related.length||badTarget!==undefined)
   throw correction('continuity_plan_evidence_basis_required',[{nodeId:node.id,ref:node.ref,...(badTarget!==undefined?{targetNodeId:badTarget}:{}),
    reason:'evidence_requires_explicit_same_topic_plan_basis',expected:'use_related_targets_naming_actual_user_intent_plan_bases'}]);
  const contains=source=>source.ref===matched.ref&&source.citation.start>=matched.citation.start&&source.citation.end<=matched.citation.end;
  const checkRelationQuote=(row,kind,index,targetNodeId)=>{
   if(!contains(row))throw correction('continuity_plan_evidence_quote_mismatch',
    [{nodeId:node.id,ref:node.ref,targetNodeId,kind,index,reason:'relation_quote_outside_evidence_quote',expected:'cite_the_relation_within_the_same_formal_evidence_quote'}]);
  };
  // 每個由此證據提出的正式關聯均需核對；不能只查恰好用來支援 related 的交集。
  for(const [index,row]of scoped.retentions.entries())if(row.byNodeId===node.id)
   checkRelationQuote(row,'retention',index,row.targetNodeIds[0]);
  for(const [index,row]of scoped.reasonRelations.entries())if(row.fromNodeId===node.id){
   const targets=relationTargets(row);
   if((row.targetChangeIds||row.targetReasonIds)&&targets.some(id=>!basisIds.has(id)||!related.includes(id)))throw Error('continuity_plan_evidence_change_target_mismatch');
   checkRelationQuote(row,'reason_relation',index,targets[0]);
  }
  const uses=[];
  for(const targetNodeId of related){
   const targetUses=[];
   for(const change of plans.planChanges)if(change.targetNodeId===targetNodeId&&contains(change.source))
    targetUses.push({kind:'plan_change',targetNodeId,changeId:change.id,source:copy(change.source)});
   for(const [index,row]of scoped.retentions.entries())if(row.byNodeId===node.id&&row.targetNodeIds.includes(targetNodeId)){
    targetUses.push({kind:'retention',targetNodeId,index,source:fragment(row)});
   }
   for(const [index,row]of scoped.reasonRelations.entries())if(row.fromNodeId===node.id&&relationTargets(row).includes(targetNodeId)){
    targetUses.push({kind:'reason_relation',targetNodeId,index,source:fragment(row),...(row.targetChangeIds?{targetChangeIds:row.targetChangeIds.filter(id=>changeTargets.get(id)===targetNodeId)}:{}),
     ...(row.targetReasonIds?{targetReasonIds:row.targetReasonIds.filter(id=>reasonTargets.get(id)===targetNodeId)}:{})});
   }
   if(!targetUses.length)throw correction('continuity_plan_evidence_use_required',[{nodeId:node.id,ref:node.ref,targetNodeId,
    reason:'related_alone_does_not_establish_evidence_use',expected:'link_a_valid_plan_change_whose_quote_is_contained_in_this_evidence_or_an_explicit_retention_or_reason_relation'}]);
   uses.push(...targetUses);
  }
  result.push({nodeId:node.id,objectId:node.topic,aspect:node.aspect,source:fragment(matched),targetNodeIds:[...related],uses,
   authority:'source_bound_plan_evidence_not_an_independent_plan'});
 }
 return result;
}
