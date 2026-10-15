import {loopHash} from './cmcp-local-loop-journal.js';
import {createCmcpQuotationView} from './cmcp-continuity-quotation-view.js';
import {createCmcpContinuitySourceContext} from './cmcp-continuity-source-context.js';
const points=value=>[...value],copy=structuredClone;
function check(ok,code){if(!ok)throw Error('continuity_presentation_'+code);}
function citation(value){check(value&&value.unit==='unicode_code_points'&&Number.isSafeInteger(value.start)&&Number.isSafeInteger(value.end)
 &&value.start>=0&&value.end>value.start&&typeof value.text==='string'&&points(value.text).length===value.end-value.start,'citation_invalid');return value;}
const layerLimits=Object.freeze({maxCurrentRows:128,maxSourceBindings:512,maxMetadataBytes:65536,maxSupportingRows:2048});
// 此 metadata 只由 Core 的容量出口產生；不是模型提案欄位或語意決定。
export function createCmcpContentSourceUseDelivery({projection,status,reason=null}){
 check(projection?.version===3&&Object.hasOwn(projection,'reasonBindings'),'source_use_delivery_version');
 if(status==='provided'){
  check(projection.sourceUseReview?.kind==='cmcp_content_source_use_review'
   &&projection.sourceUseReview.sourceBindingVerification==='validated','source_use_delivery_review_missing');
  return {status,reference:'/projection/sourceUseReview',semanticVerification:'not_performed',executionAuthority:'none'};
 }
 check(status==='not_evaluated_due_capacity'&&!Object.hasOwn(projection,'sourceUseReview')
  &&['continuity_projection_expanded_limit','continuity_projection_limit'].includes(reason),'source_use_delivery_capacity');
 return {status,reason,semanticVerification:'not_performed',executionAuthority:'none',
  instruction:'來源用途提示未在既有容量內提供，不表示沒有未套用片段或語意已通過；仍沿正式原話核對目前計畫，不裁掉必要來源。'};
}
/** 只連接同一正式投影的分類與來源；不由計畫、缺欄或未連結推斷外部結果。 */
function evidenceLayers(projection,projectionHash){
 const base={version:1,projectionHash,authority:'cross_reference_of_existing_formal_projection_not_new_state_evidence',
  semanticVerification:'not_performed',executionAuthority:'none',limits:layerLimits};
 try{
  const collections=['currentPlans','currentClaims','knownEvolution','sources','unknownParts'];
  for(const name of collections)check(Array.isArray(projection[name]),'evidence_layers_collection_unavailable');
  check(projection.currentPlans.length+projection.currentClaims.length<=layerLimits.maxCurrentRows,'evidence_layers_row_limit');
  for(const name of ['knownEvolution','sources','unknownParts'])check(projection[name].length<=layerLimits.maxSupportingRows,'evidence_layers_support_limit');
  const unique=(rows,key)=>{const map=new Map();rows.forEach((row,index)=>{check(typeof row?.[key]==='string'&&row[key].length>0&&!map.has(row[key]),'evidence_layers_identity_conflict');map.set(row[key],{row,index});});return map;};
  const nodes=unique(projection.knownEvolution,'nodeId'),sources=unique(projection.sources,'ref');
  unique([...projection.currentPlans,...projection.currentClaims],'nodeId');let bindingCount=0;
  const bind=(value,reference,time)=>{
   check(++bindingCount<=layerLimits.maxSourceBindings,'evidence_layers_binding_limit');citation(value?.citation);
   const found=sources.get(value.ref),row=found?.row;
   check(row&&row.sourceAuthorRole===value.sourceAuthorRole&&typeof row.evidenceHash==='string'&&/^[a-f0-9]{64}$/.test(row.evidenceHash)
    &&typeof row.messageRecordedAt==='string'&&Number.isFinite(Date.parse(row.messageRecordedAt)),'evidence_layers_source_mismatch');
   for(const key of ['evidenceHash','messageRecordedAt','eventOccurredAt'])if(Object.hasOwn(value,key))check(value[key]===row[key],'evidence_layers_source_mismatch');
   if(time)check(time.messageRecordedAt===row.messageRecordedAt&&time.eventOccurredAt===row.eventOccurredAt,'evidence_layers_source_time_mismatch');
   return {bindingReference:reference,sourceReference:'/projection/sources/'+found.index,ref:row.ref,
    sourceAuthorRole:row.sourceAuthorRole,messageRecordedAt:row.messageRecordedAt,eventOccurredAt:row.eventOccurredAt,
    evidenceHash:row.evidenceHash,range:{unit:value.citation.unit,start:value.citation.start,end:value.citation.end}};
  };
  const rows=(collection)=>projection[collection].map((current,index)=>{
   const found=nodes.get(current.nodeId),node=found?.row,plan=collection==='currentPlans';
   check(node&&node.supported===true,'evidence_layers_node_unavailable');
   const kind=node.interpretation?.kind,role=plan?'user':kind==='user_report'?'user':kind==='tool_observation'?'tool':null;
   check((plan?kind==='user_intent':['user_report','tool_observation'].includes(kind))&&node.source?.sourceAuthorRole===role,'evidence_layers_kind_role_mismatch');
   if(!plan)check(current.text===node.interpretation.text,'evidence_layers_claim_text_mismatch');
   const view='/projection/'+collection+'/'+index,nodeReference='/projection/knownEvolution/'+found.index;
   const result={nodeId:current.nodeId,currentViewReference:view,nodeReference,interpretationKind:kind,
    evidenceLevel:plan?'user_intent_not_outcome_or_execution_permission':kind==='user_report'?'user_report_not_independently_verified':'tool_source_observation_not_beyond_its_evidence',
    source:bind(node.source,nodeReference+'/source',node.time),
    existingLimitations:projection.unknownParts.flatMap((row,i)=>row.nodeId===current.nodeId?[{reason:row.reason,reference:'/projection/unknownParts/'+i}]:[])};
   if(plan){
    check(Array.isArray(current.sourceFragments)&&typeof current.planVersion==='string'&&/^[a-f0-9]{64}$/.test(current.planVersion),'evidence_layers_plan_version_unavailable');
    check(current.sourceFragments.map(part=>part.citation?.text??'').join('')===current.text,'evidence_layers_plan_text_mismatch');
    result.sourceUse='basis_source_only_current_text_and_revision_times_follow_current_view_bindings';
    result.planVersion=current.planVersion;result.planStatus=current.planStatus;
    result.currentSourceBindings=current.sourceFragments.map((part,i)=>bind(part,view+'/sourceFragments/'+i));
    result.statusSourceBinding=current.statusSource?bind(current.statusSource,view+'/statusSource'):null;
   }
   return result;
  });
  const result={...base,status:'available',reason:null,currentPlans:rows('currentPlans'),currentClaims:rows('currentClaims')};
  check(Buffer.byteLength(JSON.stringify(result),'utf8')<=layerLimits.maxMetadataBytes,'evidence_layers_metadata_limit');return result;
 }catch(error){
  if(!String(error?.message).startsWith('continuity_presentation_'))throw error;
  return {...base,status:'not_available',reason:error.message,currentPlans:null,currentClaims:null};
 }
}
/** 唯讀附註：保留具名撤回標記，另連接既有分類與正式來源；不重新判讀語意。 */
export function createCmcpContinuityPresentation({projection,projectionHash,scopeId,verifiedScopeId,reading=null,previousPages=null,sourceUseReviewDelivery=null}){
 check(typeof scopeId==='string'&&scopeId.length>0&&scopeId===verifiedScopeId,'scope_mismatch');
 check(projection&&loopHash(projection)===projectionHash,'projection_hash_mismatch');
 const base={kind:'cmcp_continuity_presentation',version:1,scopeId,projectionHash,
  authority:'derived_from_explicit_reason_withdrawal_not_new_condition_change',semanticVerification:'not_performed'};
 if(sourceUseReviewDelivery!==null){
  const expected=createCmcpContentSourceUseDelivery({projection,status:sourceUseReviewDelivery?.status,reason:sourceUseReviewDelivery?.reason});
  check(sourceUseReviewDelivery&&typeof sourceUseReviewDelivery==='object'&&!Array.isArray(sourceUseReviewDelivery)
   &&Object.keys(sourceUseReviewDelivery).length===Object.keys(expected).length
   &&Object.entries(expected).every(([key,value])=>sourceUseReviewDelivery[key]===value),'source_use_delivery_binding');
  base.sourceUseReviewDelivery=expected;
 }
 if(projection.version!==3)return {...base,status:'not_available',reason:'legacy_projection_without_exact_plan_fragments',plans:[]};
 const sources=new Map((projection.sources??[]).map(row=>[row.ref,row]));
 const source=value=>{citation(value?.citation);const row=sources.get(value.ref);
  check(row&&row.evidenceHash===value.evidenceHash&&row.sourceAuthorRole===value.sourceAuthorRole&&row.messageRecordedAt===value.messageRecordedAt,'source_binding_mismatch');};
 const reasonRows=[...(projection.reasons??[]).map((reason,index)=>({reason,reference:{collection:'reasons',index},nodeId:reason.nodeId})),
  ...(projection.planChanges??[]).filter(row=>row.reason).map(row=>({reason:row.reason,reference:{collection:'planChanges',index:projection.planChanges.indexOf(row),changeId:row.id},nodeId:row.targetNodeId})),
  ...(projection.reasonBindings??[]).map((reason,index)=>({reason,reference:{collection:'reasonBindings',index,reasonId:reason.reasonId},nodeId:reason.binding?.nodeId}))];
 const plans=[];
 for(const plan of projection.currentPlans??[]){
  if(!Array.isArray(plan.sourceFragments))return {...base,status:'not_available',reason:'plan_fragments_unavailable',plans:[]};
  check(plan.sourceFragments.map(part=>part.citation?.text??'').join('')===plan.text,'text_binding_mismatch');
  const annotations=[];let position=0;
  for(const [sourceFragmentIndex,part] of plan.sourceFragments.entries()){
   source(part);const partPoints=points(part.citation.text);
   for(const row of reasonRows){
    const reason=row.reason;if(row.nodeId!==plan.nodeId||reason.standing!=='withdrawn_by_explicit_user_source')continue;
    check(reason.binding?.nodeId===plan.nodeId,'reason_node_mismatch');source(reason);
    const named=row.reference.collection==='reasonBindings';
    if(row.reference.collection==='reasons'||named&&reason.binding.kind==='plan_basis'){
     check(reason.binding.kind==='plan_basis','reason_kind_mismatch');
     const basis=projection.planBasis?.find(b=>b.nodeId===plan.nodeId);
     check(basis&&basis.baseVersion===reason.binding.basisVersion,'basis_version_mismatch');
    }else if(named){
     const change=projection.planChanges?.find(change=>change.id===reason.binding.changeId);
     check(reason.binding.kind==='plan_change'&&change&&change.targetNodeId===plan.nodeId&&change.priorVersion===reason.binding.priorVersion&&change.planVersion===reason.binding.planVersion,'change_binding_mismatch');
    }else check(reason.binding.kind==='plan_change'&&reason.binding.changeId===row.reference.changeId,'change_binding_mismatch');
    const withdrawalRelationIndexes=[];for(const [index,relation] of (projection.reasonRelations??[]).entries()){
     if(relation.kind!=='withdraws'||relation.effect!=='withdraws_only_named_reasons')continue;
     if(named?!relation.targetReasonIds?.includes(reason.reasonId):row.reference.collection==='reasons'?!relation.targetNodeIds?.includes(plan.nodeId):!relation.targetChangeIds?.includes(row.reference.changeId))continue;
     source(relation);check(relation.sourceAuthorRole==='user','withdrawal_role_mismatch');withdrawalRelationIndexes.push(index);
    }
    check(withdrawalRelationIndexes.length>0,'withdrawal_relationship_missing');
    if(part.ref!==reason.ref||part.evidenceHash!==reason.evidenceHash)continue;
    const left=Math.max(part.citation.start,reason.citation.start),right=Math.min(part.citation.end,reason.citation.end);if(left>=right)continue;
    const start=left-part.citation.start,end=right-part.citation.start,text=partPoints.slice(start,end).join('');
    check(text===points(reason.citation.text).slice(left-reason.citation.start,right-reason.citation.start).join(''),'overlap_text_mismatch');
    annotations.push({kind:'withdrawn_reason_source_text',range:{unit:'unicode_code_points',start:position+start,end:position+end,text},
     sourceFragmentIndex,sourceRange:{unit:'unicode_code_points',start:left,end:right},fragmentRange:{unit:'unicode_code_points',start,end},
     reason:copy(row.reference),withdrawalRelationIndexes});
   }
   position+=partPoints.length;
  }
  if(annotations.length)plans.push({nodeId:plan.nodeId,planVersion:plan.planVersion,textHash:loopHash(plan.text),annotations});
 }
 const sourceContext=createCmcpContinuitySourceContext({projection,projectionHash,scopeId,reading,previousPages});
 return {...base,status:'available',reason:null,plans,quotationView:createCmcpQuotationView({projection,projectionHash,sourceContext}),evidenceLayers:evidenceLayers(projection,projectionHash),sourceContext};
}

