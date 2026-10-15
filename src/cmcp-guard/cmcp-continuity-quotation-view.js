import {loopHash} from './cmcp-local-loop-journal.js';

export const CMCP_QUOTATION_VIEW_LIMITS=Object.freeze({maxPlans:128,maxBindings:512,maxSupportingRows:2048,maxQuoteCodePoints:32768,maxBytes:65536});
const copy=structuredClone,points=value=>[...value];
function check(ok,reason){if(!ok)throw Error('continuity_quotation_'+reason);}
function cite(value){check(value&&value.unit==='unicode_code_points'&&Number.isSafeInteger(value.start)&&Number.isSafeInteger(value.end)
 &&value.start>=0&&value.end>value.start&&typeof value.text==='string'&&points(value.text).length===value.end-value.start,'citation_invalid');return value;}
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;

/** 同一正式投影的逐字讀取視圖；不產生答案、理由效力或另一份 History。 */
export function createCmcpQuotationView({projection,projectionHash,sourceContext=null}){
 const base={kind:'cmcp_formal_quotation_view',version:1,projectionHash,
  authority:'exact_fragments_of_same_formal_projection_not_new_user_message',semanticVerification:'not_performed',executionAuthority:'none',
  scope:'current_plan_fragments_and_explicit_retentions_for_current_plans',limits:CMCP_QUOTATION_VIEW_LIMITS};
 try{
  check(projection&&loopHash(projection)===projectionHash,'projection_hash_mismatch');
  check(projection.version===3,'legacy_projection');
  for(const key of ['currentPlans','knownEvolution','sources','retentions','planChanges'])check(Array.isArray(projection[key]),'collection_unavailable');
  check(projection.currentPlans.length<=CMCP_QUOTATION_VIEW_LIMITS.maxPlans,'plan_limit');
  for(const key of ['knownEvolution','sources','retentions','planChanges'])check(projection[key].length<=CMCP_QUOTATION_VIEW_LIMITS.maxSupportingRows,'support_limit');
  const unique=(rows,key)=>{const found=new Map();rows.forEach((row,index)=>{check(typeof row?.[key]==='string'&&row[key]&&!found.has(row[key]),'identity_conflict');found.set(row[key],{row,index});});return found;};
  const sources=unique(projection.sources,'ref'),nodes=unique(projection.knownEvolution,'nodeId'),plans=unique(projection.currentPlans,'nodeId');
  const scopedRows=projection.scopedPlanBindings??[];
  check(Array.isArray(scopedRows)&&scopedRows.length<=CMCP_QUOTATION_VIEW_LIMITS.maxSupportingRows,'scoped_bindings_unavailable');
  const scoped=unique(scopedRows,'nodeId');
  let bindings=0,quotePoints=0,scopeBindings=0;
  const sourceOf=(value)=>{
   cite(value?.citation);const found=sources.get(value.ref),source=found?.row;
   check(source&&source.sourceAuthorRole==='user'&&value.sourceAuthorRole==='user'&&validHash(source.evidenceHash)
    &&source.evidenceHash===value.evidenceHash&&typeof source.messageRecordedAt==='string'&&Number.isFinite(Date.parse(source.messageRecordedAt))
    &&source.messageRecordedAt===value.messageRecordedAt&&source.eventOccurredAt===value.eventOccurredAt,'source_binding_mismatch');
   return found;
  };
  // knownEvolution 與 planChanges.source 已由同一正式 reader 核過；修改來源不一定另建演進節點。
  // 逐字再對回完整修改引文的範圍，不能只核字數或 ref，也不拿待查片段當自己的核對依據。
  const anchored=(value,onlyNode)=>{
   const found=sourceOf(value);let anchor=null;
   for(const {row:node,index}of onlyNode?[onlyNode]:nodes.values()){
    if(node.supported!==true||node.source?.ref!==value.ref||node.source.sourceAuthorRole!=='user')continue;
    const citation=cite(node.source.citation),time=node.time;
    check(time&&time.messageRecordedAt===found.row.messageRecordedAt&&time.eventOccurredAt===found.row.eventOccurredAt,'anchor_time_mismatch');
    if(value.citation.start<citation.start||value.citation.end>citation.end)continue;
    const text=points(citation.text).slice(value.citation.start-citation.start,value.citation.end-citation.start).join('');
    if(text!==value.citation.text)continue;
    anchor={sourceAnchorReference:'/projection/knownEvolution/'+index+'/source',sourceReference:'/projection/sources/'+found.index};break;
   }
   if(!anchor&&!onlyNode)for(const [index,change]of projection.planChanges.entries()){
    if(change.source?.ref!==value.ref)continue;
    sourceOf(change.source);const citation=change.source.citation;
    if(value.citation.start<citation.start||value.citation.end>citation.end)continue;
    if(points(citation.text).slice(value.citation.start-citation.start,value.citation.end-citation.start).join('')!==value.citation.text)continue;
    anchor={sourceAnchorReference:`/projection/planChanges/${index}/source`,sourceReference:'/projection/sources/'+found.index};break;
   }
   check(anchor,'exact_source_quote_mismatch');return anchor;
  };
  const scopedAnchor=value=>{
   const found=sourceOf(value);
   check(sourceContext?.kind==='cmcp_formal_source_context'&&sourceContext.projectionHash===projectionHash
    &&sourceContext.metadata?.status==='available'&&sourceContext.metadata.complete===true
    &&sourceContext.originalMessages?.status==='available'&&sourceContext.originalMessages.complete===true,'scope_formal_context_unavailable');
   const metadata=sourceContext.metadata.sources?.find(row=>row.ref===value.ref),
    index=sourceContext.originalMessages.messages?.findIndex(row=>row.ref===value.ref),message=sourceContext.originalMessages.messages?.[index];
   check(metadata&&message&&metadata.formalRead?.complete===true&&metadata.formalToolMaterial?.complete===true
    &&metadata.sourceReference==='/projection/sources/'+found.index,'scope_formal_context_binding');
   for(const key of ['ref','sourceAuthorRole','messageRecordedAt','eventOccurredAt','evidenceHash'])check(metadata[key]===value[key]&&message[key]===value[key],'scope_formal_context_binding');
   check(value.pointer&&JSON.stringify(ordered(metadata.pointer))===JSON.stringify(ordered(value.pointer)),'scope_pointer_binding');
   check(message.range?.unit==='unicode_code_points'&&message.range.start===0&&typeof message.text==='string'
    &&message.range.end===points(message.text).length&&message.textHash===loopHash(message.text)
    &&value.citation.end<=message.range.end
    &&points(message.text).slice(value.citation.start,value.citation.end).join('')===value.citation.text,'scope_exact_source_quote_mismatch');
   return {sourceAnchorReference:`/presentation/sourceContext/originalMessages/messages/${index}`,sourceReference:metadata.sourceReference};
  };
  const quotation=(value,reference,use,onlyNode,scopeAnchor=false)=>{
   check(++bindings<=CMCP_QUOTATION_VIEW_LIMITS.maxBindings,'binding_limit');
   quotePoints+=points(value?.citation?.text??'').length;check(quotePoints<=CMCP_QUOTATION_VIEW_LIMITS.maxQuoteCodePoints,'quote_limit');
   const anchor=scopeAnchor?scopedAnchor(value):anchored(value,onlyNode);
   return {use,textUse:'verbatim_source_fragment',text:value.citation.text,ref:value.ref,
    sourceAuthorRole:value.sourceAuthorRole,messageRecordedAt:value.messageRecordedAt,eventOccurredAt:value.eventOccurredAt,
    evidenceHash:value.evidenceHash,range:{unit:value.citation.unit,start:value.citation.start,end:value.citation.end},
    projectionReference:reference,...anchor};
  };
  const currentPlans=projection.currentPlans.map((plan,index)=>{
   const node=nodes.get(plan.nodeId)?.row;
   check(node?.supported===true&&node.interpretation?.kind==='user_intent'&&node.source?.sourceAuthorRole==='user','plan_owner_mismatch');
   check(Array.isArray(plan.sourceFragments)&&validHash(plan.planVersion),'plan_version_unavailable');
   check(plan.sourceFragments.map(part=>part.citation?.text??'').join('')===plan.text,'plan_text_mismatch');
   check(loopHash({fragments:plan.sourceFragments,planStatus:plan.planStatus,statusSource:plan.statusSource})===plan.planVersion,'plan_version_mismatch');
   let applicability;
   const scopedEntry=scoped.get(plan.nodeId);
   if(scopedEntry||Object.hasOwn(plan,'applicability')){
    const binding=scopedEntry?.row,app=plan.applicability;
    check(binding&&app&&binding.kind==='cmcp_condition_scope_binding'&&binding.version===1
     &&binding.sourceBindingVerification==='validated'&&binding.semanticVerification==='not_performed'&&binding.executionAuthority==='none'
     &&binding.currentness==='selected_current_basis'&&binding.planVersion===plan.planVersion,'scoped_plan_binding');
    const {bindingHash,...body}=binding;
    check(validHash(bindingHash)&&loopHash(body)===bindingHash&&app.kind==='declared_condition_scope'
     &&app.scopedPlanBindingHash===bindingHash&&app.semanticVerification==='not_performed'
     &&['groupId','conditionId','scopeId'].every(key=>app[key]===binding[key])
     &&app.scopeLabel===binding.scopeSource?.citation?.text,'scoped_plan_hash_mismatch');
    const basis=projection.planBasis?.find(row=>row.nodeId===plan.nodeId);
    check(basis&&basis.baseVersion===binding.basisVersion,'scoped_basis_version_mismatch');
    anchored(binding.conditionSource,nodes.get(plan.nodeId));scopedAnchor(binding.conditionSource);
    check(Array.isArray(binding.appliedChanges),'scoped_changes_unavailable');
    const changes=projection.planChanges.filter(change=>change.targetNodeId===plan.nodeId);
    check(changes.length===binding.appliedChanges.length&&changes.every((change,i)=>{
     const bound=binding.appliedChanges[i];if(!bound?.source)return false;
     scopedAnchor(bound.source);const {pointer,...boundSource}=bound.source;
     return bound.changeId===change.id&&bound.kind===change.kind&&bound.priorVersion===change.priorVersion
      &&bound.planVersion===change.planVersion&&JSON.stringify(ordered(boundSource))===JSON.stringify(ordered(change.source));
    }),'scoped_change_binding');
    applicability={...copy(app),scopeQuotation:quotation(binding.scopeSource,`/projection/scopedPlanBindings/${scopedEntry.index}/scopeSource`,
     'explicit_condition_scope',null,true),bindingReference:`/projection/scopedPlanBindings/${scopedEntry.index}`,
     textUse:'current_condition_applies_only_to_this_declared_scope_not_every_object_named_in_original_quote',executionAuthority:'none'};
   }
   return {nodeId:plan.nodeId,planVersion:plan.planVersion,planStatus:plan.planStatus,
    ...(applicability?{applicability}:{}),
    currentTextReference:'/projection/currentPlans/'+index+'/text',currentTextUse:'assembled_formal_fragments_not_a_single_user_quote',
    quotations:plan.sourceFragments.map((part,i)=>quotation(part,`/projection/currentPlans/${index}/sourceFragments/${i}`,'current_plan_fragment'))};
  });
  let outsideCurrentPlans=0;
  const retentions=[];
  for(const [index,row]of projection.retentions.entries()){
   check(Array.isArray(row.targetNodeIds)&&row.targetNodeIds.length&&new Set(row.targetNodeIds).size===row.targetNodeIds.length,'retention_targets_invalid');
   const targets=row.targetNodeIds.filter(id=>plans.has(id));
   if(!targets.length){outsideCurrentPlans++;continue;}
   const node=nodes.get(row.byNodeId);
   check(node?.row.supported===true&&node.row.interpretation?.kind==='user_intent','retention_owner_mismatch');
   retentions.push({byNodeId:row.byNodeId,targetPlans:targets.map(id=>({nodeId:id,planVersion:plans.get(id).row.planVersion})),
    quotation:quotation(row,`/projection/retentions/${index}`,'explicit_retention_source',node),
    relationAuthority:'source_bound_host_interpretation_not_semantically_verified'});
  }
  // 原聯合引文仍逐字保留；只將同投影已核獨立保留的作用範圍連到實際交集旁。
  // 不重新解決 finding、不改計畫或語意，也不接受模型另填的 scope 自述。
  const review=projection.planScopeReview;
  if(review&&Object.hasOwn(review,'resolutions')){
   check(Array.isArray(review.resolutions),'scope_resolutions_unavailable');
   if(review.resolutions.length){
    check(review.kind==='cmcp_plan_scope_review'&&review.version===2&&review.sourceBindingVerification==='validated'
     &&review.semanticVerification==='not_performed'&&Array.isArray(review.findings)
     &&Number.isSafeInteger(review.maxFindings)&&review.maxFindings>0&&review.maxFindings<=CMCP_QUOTATION_VIEW_LIMITS.maxSupportingRows
     &&review.findings.length<=review.maxFindings&&review.resolutions.length<=review.findings.length
     &&Number.isSafeInteger(review.totalFindings)&&review.totalFindings>=review.findings.length
     &&review.unresolvedFindings===review.totalFindings-review.resolutions.length
     &&review.status===(review.unresolvedFindings?'required':'addressed_by_source_bound_host_resolution'),'scope_review_binding');
    const findings=unique(review.findings,'findingId'),changes=unique(projection.planChanges,'id'),resolved=new Set();
    const sameCitation=(a,b)=>a&&b&&a.ref===b.ref&&a.evidenceHash===b.evidenceHash&&a.sourceAuthorRole===b.sourceAuthorRole
     &&a.messageRecordedAt===b.messageRecordedAt&&a.eventOccurredAt===b.eventOccurredAt&&JSON.stringify(a.citation)===JSON.stringify(b.citation);
    const range=value=>{check(value?.unit==='unicode_code_points'&&Number.isSafeInteger(value.start)&&Number.isSafeInteger(value.end)
     &&value.start>=0&&value.end>value.start,'scope_range_invalid');return value;};
    const sameRange=(a,b)=>a.unit===b.unit&&a.start===b.start&&a.end===b.end;
    const sameOriginal=(a,b)=>a.ref===b.ref&&a.evidenceHash===b.evidenceHash;
    const changedSpans=part=>{
     check(Array.isArray(part.priorSourceFragments)&&Array.isArray(part.replacementSourceFragments),'scope_change_fragments');
     for(const fragment of [...part.priorSourceFragments,...part.replacementSourceFragments])anchored(fragment);
     const prior=points(part.priorSourceFragments.map(f=>f.citation.text).join('')),
      replacement=points(part.replacementSourceFragments.map(f=>f.citation.text).join(''));let left=0,right=prior.length,other=replacement.length;
     while(left<right&&left<other&&prior[left]===replacement[left])left++;
     while(right>left&&other>left&&prior[right-1]===replacement[other-1]){right--;other--;}
     const spans=[];let position=0;
     for(const fragment of part.priorSourceFragments){const length=points(fragment.citation.text).length,
      start=Math.max(left,position),end=Math.min(right,position+length);
      if(start<end)spans.push({...fragment,range:{unit:'unicode_code_points',start:fragment.citation.start+start-position,end:fragment.citation.start+end-position}});
      position+=length;
     }return spans;
    };
    for(const [resolutionIndex,resolution]of review.resolutions.entries()){
     const found=findings.get(resolution?.findingId),finding=found?.row;
     check(resolution?.kind==='independent_retention'&&finding&&validHash(finding.findingId)&&!resolved.has(finding.findingId)
      &&finding.resolutionStatus==='source_bound_host_declaration'&&resolution.semanticVerification==='not_performed'
      &&resolution.executionAuthority==='none'&&resolution.authority==='source_bound_host_declared_independence_not_semantic_verification','scope_resolution_binding');
     resolved.add(finding.findingId);
     check(finding.source&&finding.retainedPlan&&finding.changedPlan
      &&loopHash(ordered({source:finding.source,retainedPlan:finding.retainedPlan,changedPlan:finding.changedPlan}))===finding.findingId,'scope_finding_hash');
     const shared=range(finding.source.range),retained=plans.get(finding.retainedPlan.nodeId),changed=plans.get(finding.changedPlan.nodeId);
     check(retained&&changed&&retained.row.nodeId!==changed.row.nodeId&&retained.row.planStatus!=='cancelled'&&changed.row.planStatus!=='cancelled'
      &&finding.nodeId===retained.row.nodeId&&finding.targetNodeId===changed.row.nodeId&&finding.changeId===finding.changedPlan.changeId
      &&finding.retainedPlan.planVersion===retained.row.planVersion&&finding.changedPlan.planVersion===changed.row.planVersion
      &&finding.source.ref===finding.sourceRef&&finding.ref===finding.sourceRef&&finding.source.evidenceHash===finding.sourceEvidenceHash
      &&finding.source.pointer?.version===1&&['providerNamespace','scopeId','itemId','sessionId','revisionId'].every(key=>
       typeof finding.source.pointer[key]==='string'&&finding.source.pointer[key].length>0&&finding.source.pointer[key].length<=512)
      &&sameRange(shared,range(finding.range)),'scope_plan_binding');
     // finding 的 changed change 必須在目前版本的同目標正式鏈內，不能指舊版或另一計畫。
     let id=changed.row.changeId,version=changed.row.planVersion,changedReceipt=null;const chain=new Set();
     while(id!==null){
      check(typeof id==='string'&&!chain.has(id)&&chain.size<CMCP_QUOTATION_VIEW_LIMITS.maxSupportingRows,'scope_change_chain');chain.add(id);
      const receipt=changes.get(id)?.row;
      check(receipt&&receipt.targetNodeId===changed.row.nodeId&&receipt.planVersion===version&&validHash(receipt.priorVersion),'scope_change_version');
      if(id===finding.changedPlan.changeId){changedReceipt=receipt;break;}version=receipt.priorVersion;id=receipt.afterChangeId;
     }
     check(changedReceipt?.kind==='content'&&Array.isArray(changedReceipt.parts),'scope_change_target');
     const spans=changedReceipt.parts.filter(part=>part.kind!=='keep').flatMap(changedSpans);
     check(retained.row.sourceFragments.some(fragment=>sameOriginal(fragment,finding.source)&&spans.some(span=>sameOriginal(span,finding.source)
      &&Math.max(fragment.citation.start,span.range.start)===shared.start&&Math.min(fragment.citation.end,span.range.end)===shared.end)),'scope_overlap_mismatch');
     let restored=shared.start;
     for(const part of changed.row.sourceFragments.filter(part=>sameOriginal(part,finding.source)).map(part=>part.citation).sort((a,b)=>a.start-b.start)){
      if(part.start>restored)break;restored=Math.max(restored,part.end);
     }
     check(restored<shared.end,'scope_changed_span_restored');
     const retentionIndex=projection.retentions.findIndex(row=>row.byNodeId===resolution.retentionByNodeId
      &&row.targetNodeIds.includes(retained.row.nodeId)&&sameCitation(row,resolution.evidence));
     const retention=projection.retentions[retentionIndex],actor=nodes.get(resolution.retentionByNodeId);
     check(retention&&actor?.row.supported===true&&actor.row.interpretation?.kind==='user_intent'
      &&actor.row.interpretation.temporalUse==='current','scope_retention_binding');
     anchored(resolution.evidence,actor);
     check(!(sameOriginal(resolution.evidence,finding.source)&&resolution.evidence.citation.start<shared.end
      &&resolution.evidence.citation.end>shared.start),'scope_distinct_support');
     let attached=0;
     for(const quotation of currentPlans[retained.index].quotations){
      if(!sameOriginal(quotation,finding.source))continue;
      const start=Math.max(quotation.range.start,shared.start),end=Math.min(quotation.range.end,shared.end);if(start>=end)continue;
      check(bindings+(++scopeBindings)<=CMCP_QUOTATION_VIEW_LIMITS.maxBindings,'binding_limit');attached++;
      (quotation.scopeAnnotations??=[]).push({kind:'resolved_independent_retention',findingId:finding.findingId,
       retainedPlan:copy(finding.retainedPlan),changedPlan:copy(finding.changedPlan),
       sharedSource:{ref:finding.source.ref,evidenceHash:finding.source.evidenceHash,range:{unit:'unicode_code_points',start,end}},
       reviewFindingReference:`/projection/planScopeReview/findings/${found.index}`,resolutionReference:`/projection/planScopeReview/resolutions/${resolutionIndex}`,
       retentionReference:`/projection/retentions/${retentionIndex}`,evidenceReference:`/projection/planScopeReview/resolutions/${resolutionIndex}/evidence`,
       scopeUse:'retained_plan_only_not_changed_plan',semanticVerification:'not_performed',executionAuthority:'none'});
     }
     check(attached>0,'scope_quotation_overlap_missing');
    }
   }
  }else if(review)check(review.status!=='addressed_by_source_bound_host_resolution','scope_resolutions_unavailable');
  const result={...base,status:'available',reason:null,currentPlans,retentions,
   coverage:{currentPlans:currentPlans.length,quotationBindings:bindings,retentions:retentions.length,retentionsOutsideCurrentPlans:outsideCurrentPlans,
    completeness:'this_view_scope_only_full_projection_and_formal_sources_remain_authoritative'}};
  check(Buffer.byteLength(JSON.stringify(result),'utf8')<=CMCP_QUOTATION_VIEW_LIMITS.maxBytes,'bytes_limit');return result;
 }catch(error){
  if(!String(error?.message).startsWith('continuity_quotation_'))throw error;
  return {...base,status:'unavailable',reason:error.message,currentPlans:null,retentions:null};
 }
}
