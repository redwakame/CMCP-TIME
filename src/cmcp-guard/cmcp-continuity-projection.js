import {normalizeCmcpEventUpdate,buildCmcpEventView,cmcpEventInterpretationRoles} from './cmcp-event-lineage.js';
import {inspectCmcpReadingProgress,validateCmcpReadingPublication} from './cmcp-reading.js';
import {loopHash} from './cmcp-local-loop-journal.js';
import {createCmcpContinuityPresentation,createCmcpContentSourceUseDelivery} from './cmcp-continuity-presentation.js';
import {resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';
import {projectCmcpRuntimeTime} from './project-cmcp-local-time.js';
import {projectCmcpPlanChanges,projectCmcpPlanEvidence,reviewCmcpReasonSpans,reviewCmcpContentSourceUses,resolveCmcpPlanScope} from './cmcp-continuity-plan-patch.js';
import {compileCmcpContinuityProposal} from './cmcp-continuity-proposal.js';
import {compileCmcpTypedContinuityProposal} from './cmcp-continuity-typed-proposal.js';
import {compileCmcpScopedContinuityProposal,bindCmcpScopedPlanApplicability} from './cmcp-continuity-scoped-proposal.js';
import {projectContinuityModelView} from './cmcp-continuity-model-view.js';
import {reviewCmcpReportScope} from './cmcp-continuity-report-scope.js';

const copy=value=>structuredClone(value),bytes=value=>Buffer.byteLength(JSON.stringify(value));
// 來源覆蓋與尚未處理的修改範圍分開；partial 保留完整投影，沒有新增未知或裁切條件。
function continuityReadiness(modelCoverageComplete,projection){
 const reasons=[];
 if(!modelCoverageComplete)reasons.push('model_material_incomplete');
 if(projection?.planScopeReview?.status==='required')reasons.push('scope_review_required');
 if(projection?.reportScopeReview?.status==='required')reasons.push('report_scope_review_required');
 return {status:reasons.length?'partial':'ready',reason:reasons[0]??null,readinessReasons:reasons};
}
export const CMCP_CONTINUITY_PROJECTION_LIMITS=Object.freeze({maxNodes:24,maxUnknowns:16,maxQuoteCodePoints:1024,maxReasonCodePoints:512,
 maxRetentions:8,maxReasonRelations:12,maxRelationTargets:8,maxPlanChanges:24,maxPlanParts:32,maxProposalBytes:24576,
 maxProjectionBytes:65536,maxModelProjectionBytes:65536,maxExpandedProjectionBytes:131072});
// maxProjectionBytes 保留為模型投影上限的相容別名；原文、節點與輸入上限不變。
// 只共用完全相同物件，不裁切主視圖。完整查證物件及模型投影各有有限容量。
export function measureCmcpContinuityProjectionCapacity(projection){
 const limits=CMCP_CONTINUITY_PROJECTION_LIMITS,expandedProjectionBytes=bytes(projection);
 if(expandedProjectionBytes>limits.maxExpandedProjectionBytes)throw Error('continuity_projection_expanded_limit');
 const view=projectContinuityModelView({kind:'cmcp_continuity_projection',status:'ready',projection});
 const modelProjectionBytes=bytes(view.projection);
 if(modelProjectionBytes>limits.maxModelProjectionBytes)throw Error('continuity_projection_limit');
 return {version:1,measurementScope:'projection_only',encoding:view.modelView?.encoding??'inline',
  expandedProjectionBytes,modelProjectionBytes,maxExpandedProjectionBytes:limits.maxExpandedProjectionBytes,
  maxModelProjectionBytes:limits.maxModelProjectionBytes,lossless:true,mainViews:'inline',wireEnvelopeLimit:'transport_defined'};
}
// 僅包裝已核來源的可選提示；測量不重建原件、不改接受規則或容量。
export function attachCmcpContentSourceUseReview(projection,review){
 const projectionCapacity=measureCmcpContinuityProjectionCapacity(projection);
 if(!review)return {projection,projectionCapacity,delivery:null};
 const candidate={...projection,sourceUseReview:review};
 try{return {projection:candidate,projectionCapacity:measureCmcpContinuityProjectionCapacity(candidate),
  delivery:createCmcpContentSourceUseDelivery({projection:candidate,status:'provided'})};
 }catch(error){
  if(!['continuity_projection_expanded_limit','continuity_projection_limit'].includes(error.message))throw error;
  return {projection,projectionCapacity,delivery:createCmcpContentSourceUseDelivery({projection,status:'not_evaluated_due_capacity',reason:error.message})};
 }
}
function shape(value,required,optional=[]){if(!value||typeof value!=='object'||Array.isArray(value)
 ||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))throw Error('invalid_continuity_proposal_shape');}
function text(value,max,code){if(typeof value!=='string'||!value.trim()||[...value].length>max)throw Error(code);return value;}
const corrections=new WeakMap();
// 只接受本模組建立的更正。一般錯誤不回顯輸入；前版預覽則先沿正式 reader
// 核對來源、角色、完整讀取及引用範圍，且仍是被拒提案的機械材料，不是語意通過。
// 不接納呼叫端自行附加的錯誤屬性，也不回傳底層路徑。
export function getCmcpContinuityCorrection(error){return corrections.has(error)?copy(corrections.get(error)):null;}
export function hasCmcpContinuityPreview(error){return corrections.get(error)?.issues.some(issue=>issue.previousVersion?.preview?.status==='available')===true;}
function correction(code,issues){
 const error=Object.assign(new TypeError(code),{code});
 corrections.set(error,{kind:'cmcp_continuity_correction',version:1,code,issues:issues.slice(0,8),truncated:issues.length>8});return error;
}
function relationIssue(record,refById,targetNodeId,reason,expected){return {nodeId:record.command.updateId,
 ref:refById.get(record.command.updateId),targetNodeId,reason,expected};}
// A proposal is one atomic collection of add_node records, not an event log.
// Order only explicit target dependencies for the existing event replay. Never
// use source time, array proximity, or language to infer a relation.
function dependencyOrder(records,refById){
 const byId=new Map(records.map(record=>[record.command.updateId,record])),issues=[];
 for(const record of records)for(const target of record.command.action.relation.targetNodeIds){
  if(!byId.has(target))issues.push(relationIssue(record,refById,target,'target_missing','target_must_name_a_node_in_this_proposal'));
 }
 if(issues.length)throw correction('continuity_relation_target_missing',issues);
 const ordered=[],done=new Set();
 while(ordered.length<records.length){
  const next=records.find(record=>!done.has(record.command.updateId)&&record.command.action.relation.targetNodeIds.every(target=>done.has(target)));
  if(!next)break;ordered.push(next);done.add(next.command.updateId);
 }
 if(ordered.length!==records.length){
  const reaches=(from,to,seen=new Set())=>{if(from===to)return true;if(seen.has(from))return false;seen.add(from);
   return byId.get(from).command.action.relation.targetNodeIds.some(target=>reaches(target,to,seen));};
  for(const record of records)for(const target of record.command.action.relation.targetNodeIds){
   if(reaches(target,record.command.updateId))issues.push(relationIssue(record,refById,target,
    target===record.command.updateId?'self_reference':'cyclic_relation','explicit_target_dependencies_must_be_acyclic'));
  }
  throw correction('continuity_relation_cycle',issues);
 }
 return ordered;
}
function replayProjection(event,records,refById){
 const ordered=dependencyOrder(records,refById);
 try{return buildCmcpEventView(event,ordered);}catch(error){
  if(!['invalid_state_relation','invalid_plan_relation'].includes(error.code))throw error;
  // Ask the unchanged replay validator which explicit edge fails. Do not
  // duplicate or relax its eligibility, role, topic or aspect rules.
  const issues=[];
  for(const [index,record]of ordered.entries()){
   try{buildCmcpEventView(event,ordered.slice(0,index+1));}catch(failure){
    if(!['invalid_state_relation','invalid_plan_relation'].includes(failure.code))throw failure;
    for(const target of record.command.action.relation.targetNodeIds){
     const single=copy(record);single.command.action.relation.targetNodeIds=[target];
     try{buildCmcpEventView(event,[...ordered.slice(0,index),single]);}catch(edgeError){
      if(!['invalid_state_relation','invalid_plan_relation'].includes(edgeError.code))throw edgeError;
      issues.push(relationIssue(record,refById,target,edgeError.code,edgeError.code==='invalid_plan_relation'
       ?'revises_requires_current_user_intent_and_prior_user_intent_same_topic_and_aspect'
       :'supersedes_requires_current_report_or_observation_same_topic_and_aspect'));
     }
    }
    break;
   }
  }
  throw correction(error.code,issues);
 }
}
// 同一面向存在多個計畫／回報尖端是提案結構未定，不能自行升格為原文的真正歧義。
// 只接受提案明示、且連結整組尖端的 unresolved 關係；引文仍由正式 reader 核對。
// 不解析語句、不以日期或陣列順序選新版本，也不改既有持久 event replay。
function requireExplicitFrontier(view,records,refById,version){
 const byId=new Map(records.map(record=>[record.command.updateId,record]));
 for(const [channel,groups]of [['plan',view.unresolvedPlans??[]],['claim',view.unresolved??[]]]){
 const issues=[];
 for(const group of groups){
  if(group.nodeIds.length<2)continue;
  const ids=new Set(group.nodeIds),edges=new Map(group.nodeIds.map(id=>[id,new Set()]));
  for(const id of group.nodeIds){const relation=byId.get(id).command.action.relation;
   if(relation.kind!=='unresolved')continue;
   for(const target of relation.targetNodeIds)if(ids.has(target)){edges.get(id).add(target);edges.get(target).add(id);}
  }
  const reached=new Set(),pending=[group.nodeIds[0]];
  while(pending.length){const id=pending.pop();if(reached.has(id))continue;reached.add(id);pending.push(...edges.get(id));}
  for(const id of group.nodeIds)if(!reached.has(id))issues.push(relationIssue(byId.get(id),refById,group.nodeIds[0],
   `multiple_current_${channel}s_without_explicit_relationship`,channel==='plan'
    ?(version===3?'separate_independent_aspects_or_use_scoped_planChanges_for_revisions_or_cite_true_unresolved_relationship':'separate_independent_aspects_or_cite_revises_or_explicit_unresolved_relationship')
    :'separate_independent_aspects_or_cite_supersedes_or_explicit_unresolved_relationship'));
 }
 if(issues.length)throw correction(`continuity_${channel}_relation_required`,issues);
 }
}
// v3 的證據角色只改查詢投影的計畫尖端；不改持久 event replay，
// 也不把原本 current 的證據改標 unspecified／historical 以隱藏它。
function planRoleFrontier(view,proposal){
 const evidenceIds=new Set(proposal.nodes.filter(node=>node.planRole==='evidence').map(node=>node.id));
 if(!evidenceIds.size)return view;
 const nodes=new Map(view.knownEvolution.map(node=>[node.nodeId,node]));
 const currentPlans=view.currentPlans.filter(node=>!evidenceIds.has(node.nodeId)),unresolvedPlans=[];
 for(const group of view.unresolvedPlans){
  if(!group.nodeIds.some(id=>evidenceIds.has(id))){unresolvedPlans.push(group);continue;}
  const ids=group.nodeIds.filter(id=>!evidenceIds.has(id));if(!ids.length)continue;
  const blocked=ids.some(id=>{const node=nodes.get(id),edge=node.effectiveRelation;
   return !node.supported||!edge.supported||edge.ambiguous||edge.relation.kind==='unresolved';});
  if(ids.length===1&&!blocked){const node=nodes.get(ids[0]);
   currentPlans.push({objectId:node.objectId,aspect:node.aspect,nodeId:node.nodeId,text:node.interpretation.text,
    planStatus:node.interpretation.planStatus??'planned',authority:'user_intent_not_outcome_or_execution_permission'});
  }else unresolvedPlans.push({...group,nodeIds:ids,reason:blocked?'support_or_relation_unresolved':'multiple_unresolved_plans'});
 }
 return {...view,currentPlans,unresolvedPlans};
}
function exactQuote(source,body,quote,max){
 text(quote,max,'continuity_quote_required_or_too_large');
 const start=body.indexOf(quote);if(start<0)throw Error('continuity_quote_absent');
 if(body.indexOf(quote,start+1)>=0)throw Error('continuity_quote_not_unique');
 const offset=[...body.slice(0,start)].length;
 return {ref:source.ref,citation:{unit:'unicode_code_points',start:offset,end:offset+[...quote].length,text:quote},
  sourceAuthorRole:source.sourceAuthorRole,messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt,evidenceHash:source.evidenceHash};
}
// 只定位提交內容中具有相同 ref／quote 的固定 schema 欄位，不選第一筆猜呼叫位置。
// 所有位置都共用同一個失敗的正式來源比對；不回顯正文、不改 ref，也不產生更正答案。
function quoteInputLocations(input,ref,quote){
 const paths=[],object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const child=(value,key)=>object(value)&&Object.hasOwn(value,key)?value[key]:undefined;
  const cite=(value,path,refKey='ref',quoteKey='quote')=>{
   if(object(value)&&Object.hasOwn(value,refKey)&&Object.hasOwn(value,quoteKey)&&value[refKey]===ref&&value[quoteKey]===quote)paths.push(path);
 };
 const rows=(value,key,path,visit)=>{const list=child(value,key);if(Array.isArray(list))list.forEach((row,index)=>visit(row,`${path}.${key}[${index}]`));};
 const reasons=(value,path,named)=>{if(named)rows(value,'reasons',path,cite);else cite(child(value,'reason'),`${path}.reason`);};
 const replacements=(value,path,key)=>rows(value,key,path,(row,p)=>cite(child(row,'replacement'),`${p}.replacement`));
 // 依正式輸入版本列固定位置，引用物件內不再遞迴；未知欄位即使同名也不成為定位。
 if([5,6,7].includes(input?.version)){
  rows(input,'plans','$',(plan,path)=>{
   cite(plan,path);reasons(plan,path,input.version>=6);
   rows(plan,'orderedChanges',path,(change,p)=>{cite(change,p);reasons(change,p,input.version>=6);replacements(change,p,'edits');});
   rows(plan,'retentions',path,cite);rows(plan,'reasonWithdrawals',path,cite);
  });
  for(const key of ['reports','suggestions','context'])rows(input,key,'$',cite);
   if(input.version>=6){
    rows(input,'scopeResolutions','$',(row,path)=>cite(child(row,'evidence'),`${path}.evidence`));
    rows(input,'reportScopeResolutions','$',(row,path)=>cite(row,path,'reportRef','reportQuote'));
   }
   if(input.version===7)rows(input,'scopedPlans','$',(group,path)=>{
    rows(group,'scopes',path,cite);
    rows(group,'conditions',path,(condition,p)=>{cite(condition,p);reasons(condition,p,true);});
    rows(group,'orderedChanges',path,(change,p)=>{cite(change,p);reasons(change,p,true);cite(child(change,'replacement'),`${p}.replacement`);});
    rows(group,'retentions',path,cite);rows(group,'reasonWithdrawals',path,cite);
   });
 }else{
  rows(input,'nodes','$',(node,path)=>{cite(node,path);reasons(node,path,false);});
  rows(input,'planChanges','$',(change,path)=>{cite(change,path);reasons(change,path,false);replacements(change,path,input?.version===4?'edits':'parts');});
  for(const key of ['retentions','reasonRelations'])rows(input,key,'$',(row,path)=>{
   if(input?.version===4){cite(child(row,'evidence'),`${path}.evidence`);reasons(child(row,'evidence'),`${path}.evidence`,false);}
   else cite(row,path);
  });
 }
 return {inputLocations:paths.slice(0,8),inputLocationCount:paths.length,inputLocationsTruncated:paths.length>8,
  inputLocationMeaning:'all_input_locations_with_same_ref_and_quote_not_a_unique_call_site'};
}
function completed({reading,previousPages,scopeId}){
 const progress=inspectCmcpReadingProgress({reading,previousPages,scopeId});
 if(!progress.coverage.complete)throw Error('continuity_complete_selected_reading_required');
 return {progress,manifest:reading.internal.manifest};
}
function previousVersionPreview({basis,changes,before},support,limits,binding){
 const sourceBindings=[];
 const checked=(row,use,index)=>{
  const found=support(row.ref,row.quote,limits.maxQuoteCodePoints);
  if(found.sourceAuthorRole!=='user')throw Error('continuity_previous_version_user_source_required');
  const {text:ignored,...range}=found.citation;
  sourceBindings.push({use,...(index===undefined?{}:{changeIndex:index}),ref:found.ref,range,
   sourceAuthorRole:found.sourceAuthorRole,messageRecordedAt:found.messageRecordedAt,eventOccurredAt:found.eventOccurredAt,evidenceHash:found.evidenceHash});
  return found;
 };
 checked(basis,'basis');
 for(const [index,change]of changes.entries()){
  const cited=checked(change,'change',index);
  if(change.kind==='content')for(const part of change.parts){
   if(part.kind!=='replace')continue;
   const added=checked(part.replacement,'replacement',index);
   if(added.ref!==cited.ref||added.citation.start<cited.citation.start||added.citation.end>cited.citation.end)
    throw Error('continuity_plan_replacement_source_mismatch');
  }
 }
 const base={kind:'cmcp_continuity_previous_version_preview',version:1,...binding,
  authority:'source_checked_mechanical_prefix_of_rejected_proposal',proposalAccepted:false,
  semanticVerification:'not_performed',executionAuthority:'none',includedChangeCount:changes.length,
  maxTextBytes:8192,maxPreviewBytes:16384};
 const preview={...base,status:'available',text:before,textHash:loopHash(before),sourceBindings};
 if(Buffer.byteLength(before)>base.maxTextBytes||bytes(preview)>base.maxPreviewBytes)
  return {...base,status:'unavailable',reason:'bounded_preview_limit',textBytes:Buffer.byteLength(before),truncated:false};
 return {...preview,truncated:false};
}
function containsRange(ranges,start,end){
 let covered=start;for(const range of ranges){if(range.start>covered)break;if(range.end>covered)covered=range.end;if(covered>=end)return true;}return false;
}
function roleCounts(sources){
 const counts={user:0,assistant:0,tool:0,unknown:0};
 for(const source of sources){const role=source.sourceAuthorRole;counts[['user','assistant','tool'].includes(role)?role:'unknown']++;}return counts;
}
// These are exact materials in formal tool-result receipts. They are not evidence
// of a later network delivery, model consumption, or semantic understanding.
function modelMaterial(manifest,previousPages){
 const ranges=new Map(manifest.sources.map(source=>[source.ref,[]])),unprojectedPages=[];
 let pagesWithModelContext=0,modelContextBytes=0;
 for(const page of previousPages){
  const {reader,modelContext}=page,source=manifest.sources.find(row=>row.ref===reader.source?.ref);
  if(modelContext===null){unprojectedPages.push({ref:reader.source?.ref??null,pageNumber:reader.pageNumber,range:copy(reader.range),reason:reader.projection?.status??'not_available'});continue;}
  let material;try{material=JSON.parse(modelContext);}catch{throw Error('continuity_model_material_invalid');}
  if(!source||reader.projection?.status!=='projected'||material.kind!=='cmcp_reading_page_context'||material.sourceRef!==source.ref
   ||material.contextVersion!==undefined&&![1,2].includes(material.contextVersion)
   ||material.contextVersion===2&&material.source?.evidenceHash!==source.evidenceHash
   ||JSON.stringify(material.range)!==JSON.stringify(reader.range)||material.content!==reader.text
   ||material.source?.sourceAuthorRole!==source.sourceAuthorRole||material.time?.messageRecordedAt!==source.messageRecordedAt
   ||material.time?.eventOccurredAt!==source.eventOccurredAt)throw Error('continuity_model_material_binding_changed');
  ranges.get(source.ref).push(copy(reader.range));pagesWithModelContext++;modelContextBytes+=Buffer.byteLength(modelContext);
 }
 for(const rows of ranges.values())rows.sort((a,b)=>a.start-b.start);
 const completeSourceRefs=manifest.sources.filter(source=>containsRange(ranges.get(source.ref),0,source.codePoints)).map(source=>source.ref);
 const unprojectedSourceRefs=manifest.sources.filter(source=>!completeSourceRefs.includes(source.ref)).map(source=>source.ref);
 return {ranges,coverage:{modelCoverageComplete:unprojectedSourceRefs.length===0,
  materialAvailableInFormalToolResult:{complete:unprojectedSourceRefs.length===0,selectedSources:manifest.sources.length,
   completeSourceRefs,unprojectedSourceRefs,pagesWithModelContext,pagesWithoutModelContext:unprojectedPages.length,modelContextBytes,unprojectedPages},
  actualModelConsumption:'not_observed'}};
}

// 僅整理有引文的修訂作用範圍與理由關係；不解析文字或產生新的執行權。
function prepareNamedReasons({proposal,support,limits}){
 const rows=proposal.reasonBindings;
 if(!Array.isArray(rows)||rows.length>limits.maxNodes)throw correction('continuity_named_reason_limit',
  [{reason:'bounded_total_named_reasons',maxItems:limits.maxNodes,expected:'named_reasons_share_the_existing_node_count_bound'}]);
 const nodes=new Map(proposal.nodes.map(node=>[node.id,node])),changes=new Map((proposal.planChanges??[]).map(change=>[change.id,change])),ids=new Set();
 return rows.map((row,index)=>{
  shape(row,['reasonId','ref','quote'],['targetNodeId','targetChangeId','kind']);text(row.reasonId,80,'continuity_named_reason_id');
  if(ids.has(row.reasonId))throw Error('continuity_named_reason_id_collision');ids.add(row.reasonId);
  const isChange=Object.hasOwn(row,'targetChangeId');
  if(isChange===Object.hasOwn(row,'targetNodeId'))throw Error('continuity_named_reason_owner');
  const change=isChange?changes.get(row.targetChangeId):null,node=nodes.get(isChange?change?.targetNodeId:row.targetNodeId);
  if(!node||node.kind!=='user_intent'||node.planRole==='evidence'||(isChange&&!change))throw Error('continuity_named_reason_owner');
  if(row.kind!==undefined&&(!isChange||!['adds','prioritizes','accepts_tradeoff'].includes(row.kind)))throw Error('continuity_named_reason_kind');
  const matched=support(row.ref,row.quote,limits.maxReasonCodePoints);
  if(matched.sourceAuthorRole!=='user')throw Error('continuity_user_reason_requires_user_source');
  if(isChange){const owner=support(change.ref,change.quote,limits.maxQuoteCodePoints);
   if(owner.sourceAuthorRole!=='user'||owner.ref!==matched.ref)throw correction('continuity_plan_change_reason_source_mismatch',
    [{nodeId:node.id,changeId:change.id,reasonId:row.reasonId,ref:owner.ref,reason:'change_reason_requires_same_user_source',expected:'cite_a_reason_from_the_same_formally_read_user_change_source'}]);
  }
  return {reasonId:row.reasonId,...matched,...(row.kind===undefined?{}:{kind:row.kind}),ownerNodeId:node.id,ownerChangeId:isChange?change.id:null,
   standing:'not_explicitly_withdrawn',relationAuthority:'host_proposed_reason_relation_not_semantically_verified'};
 });
}
function bindNamedReasons(prepared,plans,sourceIdentity){
 return prepared.map(({ownerNodeId,ownerChangeId,...reason})=>{
  const base=plans.planBasis.find(row=>row.nodeId===ownerNodeId),change=ownerChangeId===null?null:plans.planChanges.find(row=>row.id===ownerChangeId);
  if(!base||(ownerChangeId!==null&&(!change||change.targetNodeId!==ownerNodeId)))throw Error('continuity_named_reason_owner_version');
  const binding=change?{kind:'plan_change',nodeId:ownerNodeId,changeId:change.id,priorVersion:change.priorVersion,planVersion:change.planVersion}
   :{kind:'plan_basis',nodeId:ownerNodeId,basisVersion:base.baseVersion,source:copy(base.source)};
  return {...reason,binding,reasonVersion:loopHash({binding,sourceIdentity:sourceIdentity(reason.ref),range:{unit:reason.citation.unit,start:reason.citation.start,end:reason.citation.end}})};
 });
}
function scopedRelations({proposal,view,support,limits,reasons,plans,sourceIdentity,namedReasons}){
 const nodes=new Map(proposal.nodes.map(node=>[node.id,node])),reasonByNode=new Map(reasons.map(reason=>[reason.nodeId,reason]));
 // 兩端須能分別核對；只拒同一正式原件／版本的完全相同區間。
 // 不解析原話、推測時間先後或拒絕合法包含；不同區間仍須由宿主核對語意。
 const distinctSupport=(target,withdrawal,location)=>{
  const identity=sourceIdentity(target.ref);
  if(!identity||identity!==sourceIdentity(withdrawal.ref)||target.evidenceHash!==withdrawal.evidenceHash
   ||target.citation.unit!==withdrawal.citation.unit||target.citation.start!==withdrawal.citation.start
   ||target.citation.end!==withdrawal.citation.end)return null;
  const endpoint=value=>({ref:value.ref,sourceIdentity:sourceIdentity(value.ref),evidenceHash:value.evidenceHash,
   range:{unit:value.citation.unit,start:value.citation.start,end:value.citation.end},sourceAuthorRole:value.sourceAuthorRole,
   messageRecordedAt:value.messageRecordedAt,eventOccurredAt:value.eventOccurredAt});
  return {...location,reason:'target_reason_and_withdrawal_use_identical_formal_support',
   targetReason:endpoint(target),withdrawal:endpoint(withdrawal),
   expected:'cite_the_original_reason_and_the_withdrawal_as_distinct_exact_supports;_recheck_the_named_reason_target;_do_not_only_change_quote_boundaries_to_bypass_validation',
   semanticVerification:'not_performed',executionAuthority:'none'};
 };
 const currentPlanIds=new Set((view.currentPlans??[]).map(node=>node.nodeId));
 const revisedIds=new Set(view.knownEvolution.flatMap(node=>node.effectiveRelation.relation.kind==='revises'?node.effectiveRelation.relation.targetNodeIds:[]));
 const rows=(key,max)=>{const value=proposal[key]??[];if(!Array.isArray(value)||value.length>max)throw Error('continuity_scoped_relation_limit');return value;};
 const targets=(row,fromId)=>{
  if(!Array.isArray(row.targetNodeIds)||!row.targetNodeIds.length||row.targetNodeIds.length>limits.maxRelationTargets
   ||new Set(row.targetNodeIds).size!==row.targetNodeIds.length)throw Error('continuity_scoped_targets_invalid');
  const from=nodes.get(fromId);if(!from||!['user_intent','user_report'].includes(from.kind))throw Error('continuity_scoped_actor_invalid');
  const result=row.targetNodeIds.map(id=>nodes.get(id));
  if(result.some(node=>!node||node.id===fromId||node.topic!==from.topic))throw Error('continuity_scoped_target_mismatch');
  const matched=support(row.ref,row.quote,limits.maxReasonCodePoints);
  if(matched.sourceAuthorRole!=='user'||matched.ref!==from.ref)throw Error('continuity_scoped_user_source_required');
  return {from,result,matched};
 };
 const retentionPairs=new Set();
 const retentions=rows('retentions',limits.maxRetentions).map(row=>{
  shape(row,['byNodeId','targetNodeIds','ref','quote']);const {from,result,matched}=targets(row,row.byNodeId);
  if(from.kind!=='user_intent'||result.some(node=>node.kind!=='user_intent')){
   if(proposal.version!==3)throw Error('continuity_retention_requires_plan');
   throw correction('continuity_retention_requires_plan',[{nodeId:from.id,ref:from.ref,
    reason:'retention_is_only_for_user_intent_not_reaffirmed_reports',
    expected:'preserve_source_kind_remove_invalid_retention_keep_formal_report_and_its_related_evidence_do_not_reclassify_to_pass'}]);
  }
  for(const node of result){const pair=JSON.stringify([from.id,node.id]);if(retentionPairs.has(pair))throw Error('continuity_duplicate_retention');retentionPairs.add(pair);}
  return {byNodeId:from.id,targetNodeIds:[...row.targetNodeIds],...matched,
   targets:result.map(node=>({nodeId:node.id,status:currentPlanIds.has(node.id)?'current_plan':revisedIds.has(node.id)?'revised_by_explicit_plan_relation':'not_resolved_as_current'})),
   authority:'explicitly_cited_preservation_host_interpretation_not_semantically_verified'};
 });
 const relationPairs=new Set();
 const reasonRelations=rows('reasonRelations',limits.maxReasonRelations).map((row,relationIndex)=>{
  if(Object.hasOwn(row,'targetReasonIds')){
   shape(row,['kind','fromNodeId','targetReasonIds','ref','quote']);
   if(!namedReasons||row.kind!=='withdraws')throw Error('continuity_named_reason_relation_invalid');
   const ids=row.targetReasonIds,from=nodes.get(row.fromNodeId);
   if(!Array.isArray(ids)||!ids.length||ids.length>limits.maxRelationTargets||new Set(ids).size!==ids.length)throw Error('continuity_scoped_targets_invalid');
   if(!from||!['user_intent','user_report'].includes(from.kind))throw Error('continuity_scoped_actor_invalid');
   const matched=support(row.ref,row.quote,limits.maxReasonCodePoints);
   if(matched.sourceAuthorRole!=='user'||matched.ref!==from.ref)throw Error('continuity_scoped_user_source_required');
   const targets=ids.map(id=>namedReasons.find(reason=>reason.reasonId===id));
   if(targets.some(reason=>!reason||nodes.get(reason.binding.nodeId)?.topic!==from.topic||!from.relation?.targetNodeIds?.includes(reason.binding.nodeId)))
    throw correction('continuity_named_reason_target_mismatch',[{relationIndex,nodeId:from.id,reason:'target_requires_named_reason_of_explicitly_related_same_topic_plan',expected:'name_an_existing_reason_of_the_explicit_plan_owner'}]);
   const identical=targets.map(reason=>distinctSupport(reason,matched,{relationIndex,nodeId:from.id,targetReasonId:reason.reasonId,targetNodeId:reason.binding.nodeId,
    ...(reason.binding.kind==='plan_change'?{targetChangeId:reason.binding.changeId}:{})})).filter(Boolean);
   if(identical.length)throw correction('continuity_reason_distinct_support_required',identical);
   for(const reason of targets){const pair=JSON.stringify([from.id,'reason',reason.reasonId]);if(relationPairs.has(pair))throw Error('continuity_duplicate_reason_relation');relationPairs.add(pair);reason.standing='withdrawn_by_explicit_user_source';}
   return {kind:row.kind,fromNodeId:from.id,targetReasonIds:[...ids],...matched,effect:'withdraws_only_named_reasons',
    authority:'explicitly_cited_reason_relation_host_interpretation_not_semantically_verified'};
  }
  // 新增理由直接綁定它解釋的變更；撤回時只指明已存在的理由。
  // 不靠暫停或參數修改推定撤回，也不替宿主判讀引文語意。
  if(Object.hasOwn(row,'targetChangeIds')){
   shape(row,['kind','fromNodeId','targetChangeIds','ref','quote']);
   if(proposal.version!==3||row.kind!=='withdraws')throw Error('continuity_change_reason_relation_invalid');
   const targetIds=row.targetChangeIds;
   if(!Array.isArray(targetIds)||!targetIds.length||targetIds.length>limits.maxRelationTargets||new Set(targetIds).size!==targetIds.length)throw Error('continuity_scoped_targets_invalid');
   const from=nodes.get(row.fromNodeId);
   if(!from||!['user_intent','user_report'].includes(from.kind))throw Error('continuity_scoped_actor_invalid');
   const matched=support(row.ref,row.quote,limits.maxReasonCodePoints);
   if(matched.sourceAuthorRole!=='user'||matched.ref!==from.ref)throw Error('continuity_scoped_user_source_required');
   const changes=targetIds.map(id=>plans?.planChanges.find(change=>change.id===id));
   if(changes.some(change=>!change||nodes.get(change.targetNodeId)?.topic!==from.topic))throw Error('continuity_scoped_target_mismatch');
   const issues=changes.filter(change=>!change.reason||change.reason.sourceAuthorRole!=='user').map(change=>({relationIndex,nodeId:from.id,targetChangeId:change.id,
    reason:'target_change_reason_missing',expected:'name_an_existing_formally_cited_change_reason_do_not_attach_a_later_reason_to_an_earlier_change'}));
   if(issues.length)throw correction('continuity_reason_target_missing',issues);
   const identical=changes.map(change=>distinctSupport(change.reason,matched,{relationIndex,nodeId:from.id,targetChangeId:change.id})).filter(Boolean);
   if(identical.length)throw correction('continuity_reason_distinct_support_required',identical);
   for(const change of changes){
    const pair=JSON.stringify([from.id,'change',change.id]);if(relationPairs.has(pair))throw Error('continuity_duplicate_reason_relation');relationPairs.add(pair);
    change.reason.standing='withdrawn_by_explicit_user_source';
   }
   return {kind:row.kind,fromNodeId:from.id,targetChangeIds:[...targetIds],...matched,effect:'withdraws_only_named_reasons',
    authority:'explicitly_cited_reason_relation_host_interpretation_not_semantically_verified'};
  }
  shape(row,['kind','fromNodeId','targetNodeIds','ref','quote']);
  if(!['adds','withdraws','prioritizes','accepts_tradeoff','unresolved'].includes(row.kind))throw Error('continuity_reason_relation_invalid');
  const {from,result,matched}=targets(row,row.fromNodeId);
  const issues=[];
  for(const node of result){const reason=reasonByNode.get(node.id);
   if(!reason||reason.sourceAuthorRole!=='user')issues.push({relationIndex,nodeId:from.id,targetNodeId:node.id,ref:node.ref,
    reason:reason?'target_reason_requires_user_source':'target_node_reason_missing',
    expected:'attach_exact_user_source_reason_to_the_named_target_node'});
  }
  if(['adds','prioritizes','accepts_tradeoff'].includes(row.kind)&&!reasonByNode.has(from.id))issues.push({relationIndex,nodeId:from.id,ref:from.ref,
   reason:'from_node_reason_missing',expected:'attach_exact_user_source_reason_to_the_from_node'});
  if(issues.length)throw proposal.version===3?correction('continuity_reason_target_missing',issues):Error('continuity_reason_target_missing');
  if(row.kind==='withdraws'){
   const identical=result.map(node=>distinctSupport(reasonByNode.get(node.id),matched,{relationIndex,nodeId:from.id,targetNodeId:node.id})).filter(Boolean);
   if(identical.length)throw correction('continuity_reason_distinct_support_required',identical);
  }
  for(const node of result){const pair=JSON.stringify([from.id,node.id]);if(relationPairs.has(pair))throw Error('continuity_duplicate_reason_relation');relationPairs.add(pair);
   if(row.kind==='withdraws')reasonByNode.get(node.id).standing='withdrawn_by_explicit_user_source';
  }
  return {kind:row.kind,fromNodeId:from.id,targetNodeIds:[...row.targetNodeIds],...matched,
   effect:row.kind==='withdraws'?'withdraws_only_named_reasons':row.kind==='unresolved'?'relationship_unresolved':'does_not_withdraw_existing_reasons',
   authority:'explicitly_cited_reason_relation_host_interpretation_not_semantically_verified'};
 });
 return {retentions,reasonRelations};
}

/** A pure, correctable Host interpretation of an exactly read collection.
 * It never writes an Event, changes source associations, refreshes activity or dispatches. */
export function projectCmcpReadingContinuity({reading,previousPages=[],scopeId,proposal,timeContext}){
 const {progress,manifest}=completed({reading,previousPages,scopeId}),limits=CMCP_CONTINUITY_PROJECTION_LIMITS,material=modelMaterial(manifest,previousPages);
 const originalProposal=proposal;
 let compilation=null,typedCompilation=null,scopedCompilation=null;
 const originalNodePaths=new Map();
 if([5,6,7].includes(proposal?.version))for(const collection of ['plans','reports','suggestions','context']){
  if(Array.isArray(proposal[collection]))proposal[collection].forEach((row,index)=>{if(typeof row?.id==='string')originalNodePaths.set(row.id,`$.${collection}[${index}]`);});
 }
 const sourceMap=new Map(manifest.sources.map(source=>[source.ref,source])),bodies=new Map(),bindings=new Map(),reasons=[],records=[];
 const support=(ref,quote,max)=>{
   const source=sourceMap.get(ref);
   if(!source||source.pointer.scopeId!==scopeId){
    // 只提供本票券已核對的身分與固定欄位位置，不回顯被拒 ref／引文或查其他 scope。
    const legal=manifest.sources.filter(row=>row.pointer.scopeId===scopeId);
    throw correction('continuity_source_outside_reading',[{ticket:manifest.ticket,phase:'formal_source_validation',
     ...quoteInputLocations(originalProposal,ref,quote),reason:'ref_not_bound_to_current_formal_reading_scope',
     formalReading:'completed_selected_sources',sourceCoverage:'current_reading_ticket_only_not_all_history',
     legalRefs:legal.slice(0,limits.maxNodes).map(row=>({ref:row.ref,sourceAuthorRole:row.sourceAuthorRole,
      messageRecordedAt:row.messageRecordedAt,eventOccurredAt:row.eventOccurredAt,evidenceHash:row.evidenceHash})),
     legalRefCount:legal.length,legalRefsTruncated:legal.length>limits.maxNodes,
     refScope:'current_reading_ticket_only_not_stable_across_openings',
     expected:'recheck_the_current_ticket_ref_for_this_input_location_without_guessing_or_automatic_substitution',
     recovery:'selected_reading_is_already_complete;_correct_a_misbound_ref_against_current_formal_identity;_only_if_a_required_original_is_genuinely_unselected_use_formal_find_open_read;_do_not_reopen_the_same_selection_to_resolve_a_ref_mismatch'}]);
   }
  if(!bodies.has(ref)){const body=previousPages.filter(page=>page.reader.source?.ref===ref&&page.reader.text!==null).map(page=>page.reader.text).join('');
   if([...body].length!==source.codePoints)throw Error('continuity_source_not_completely_read');bodies.set(ref,body);}
  let matched;
  try{matched=exactQuote(source,bodies.get(ref),quote,max);}catch(error){
   if(!['continuity_quote_absent','continuity_quote_not_unique'].includes(error.message))throw error;
   // 只列當前已授權、已讀 manifest 的身分，不回顯正文或在其他來源猜引文。
   // r1／r2 等 ref 只屬於此票券；缺少原件仍須沿正式 find → open → read 取得。
   throw correction(error.message,[{ticket:manifest.ticket,ref:source.ref,phase:'formal_source_validation',
    ...quoteInputLocations(originalProposal,ref,quote),
    reason:error.message==='continuity_quote_absent'?'quote_absent_from_selected_formal_source':'quote_ambiguous_in_selected_formal_source',
    sourceAuthorRole:source.sourceAuthorRole,messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt,evidenceHash:source.evidenceHash,
    refScope:'current_reading_ticket_only_not_stable_across_openings',
    expected:'one_unique_exact_quote_from_this_ticket_ref_with_original_role_time_and_version',
    recovery:error.message==='continuity_quote_absent'
     ?'inspect_current_ticket_source_identity;_if_required_original_is_not_selected_use_formal_find_open_read;_do_not_reuse_old_ticket_refs_or_substitute_assistant_retellings'
     :'select_one_unique_exact_excerpt_from_the_same_formally_read_source;_do_not_fuzzily_match_or_guess_an_occurrence'}]);
  }
  if(!containsRange(material.ranges.get(ref),matched.citation.start,matched.citation.end))throw Error('continuity_quote_not_in_model_material');
  bindings.set(ref,source);return matched;
 };
 const sourcePointer=ref=>sourceMap.get(ref)?.pointer;
 const inspectPreviousVersion=context=>previousVersionPreview(context,support,limits,{ticket:manifest.ticket,manifestHash:reading.internal.manifestHash});
 const mapScopedPath=path=>{
  if(typeof path!=='string')return path;
  const binding=scopedCompilation?.inputPaths.find(row=>path===row.compiledPath||path.startsWith(row.compiledPath+'.')||path.startsWith(row.compiledPath+'['));
  return binding?binding.inputPath+path.slice(binding.compiledPath.length):path;
 };
 if(proposal?.version===7){
  scopedCompilation=compileCmcpScopedContinuityProposal(proposal,{limits,correction,support,sourcePointer});proposal=scopedCompilation.proposal;
  for(const row of scopedCompilation.bindingDeclarations)originalNodePaths.set(row.nodeId,row.inputPath);
 }
 const typedPlanPaths=new Map(Array.isArray(proposal?.plans)?proposal.plans.map((row,index)=>[row.id,`$.plans[${index}]`]):[]);
 const compiledCorrection=scopedCompilation?(code,issues=[])=>correction(code,issues.map(issue=>({...issue,
  ...(typeof issue.path==='string'?{path:mapScopedPath(issue.path),compiledPath:issue.compiledPath??issue.path}:{}),
  ...(issue.previousVersion?{previousVersion:{...issue.previousVersion,basisPath:mapScopedPath(issue.previousVersion.basisPath),
   ...(issue.previousVersion.predecessorPath===undefined?{}:{predecessorPath:mapScopedPath(issue.previousVersion.predecessorPath)})}}:{}),inputVersion:7}))):correction;
 if([4,5,6].includes(proposal?.version)){
  const typed=[5,6].includes(proposal.version),compiled=typed?compileCmcpTypedContinuityProposal(proposal,{limits,correction:compiledCorrection,inspectPreviousVersion}):compileCmcpContinuityProposal(proposal,{limits,correction,inspectPreviousVersion});
  proposal=compiled.proposal;compilation=compiled.proof;if(typed)typedCompilation=compiled.proof;
  if(scopedCompilation)compilation={...compilation,inputVersion:7,typedInputVersion:typedCompilation.inputVersion,inputHash:scopedCompilation.proof.inputHash,scopedCompilation:scopedCompilation.proof};
 }
 // named 功能由真正走過 v6 typed compiler 的內部 proof 決定，不信新版 inputVersion 自述。
 const named=typedCompilation?.inputVersion===6;
 const version=proposal?.version??1;
 if(![1,2,3].includes(version))throw Error('invalid_continuity_version');
 shape(proposal,['nodes','unknowns'],['version',...(version>=2?['retentions','reasonRelations']:[]),...(version===3?['planChanges']:[]),...(named?['reasonBindings','scopeResolutions','reportScopeResolutions']:[])]);
 if(bytes(proposal)>limits.maxProposalBytes||!Array.isArray(proposal.nodes)||proposal.nodes.length>limits.maxNodes
  ||!Array.isArray(proposal.unknowns)||proposal.unknowns.length>limits.maxUnknowns)throw Error('continuity_proposal_limit');
 const unknowns=proposal.unknowns.map(value=>text(value,256,'invalid_continuity_unknown'));
 const ids=new Set();
 if(version===3)proposal={...proposal,nodes:proposal.nodes.map(node=>{
  if(node?.planRole!==undefined&&(!['basis','evidence'].includes(node.planRole)||node.kind!=='user_intent'))
   throw correction('continuity_plan_role_invalid',[{nodeId:node?.id,ref:node?.ref,reason:'plan_role_requires_user_intent_basis_or_evidence',expected:node?.kind==='user_intent'?'use_basis_or_evidence_for_a_verified_user_intent':'preserve_source_kind_remove_planRole_and_planStatus_from_non_intent_do_not_reclassify_to_pass'}]);
  if(node?.kind!=='user_intent')return node;
  if(node.planRole==='evidence'&&Object.hasOwn(node,'planStatus'))throw correction('continuity_plan_evidence_status_forbidden',
   [{nodeId:node.id,ref:node.ref,reason:'evidence_is_not_a_plan_status',expected:'put_status_on_a_planChanges_status_targeting_the_explicit_basis'}]);
  if(node.text!==undefined&&node.text!==node.quote)throw correction('continuity_plan_text_not_source',[{nodeId:node.id,ref:node.ref,
   reason:'plan_text_must_equal_formal_quote',expected:'omit_text_or_use_the_exact_quote'}]);
  if(node.planRole!=='evidence'&&node.temporalUse==='historical')throw correction('continuity_plan_historical_requires_change',[{nodeId:node.id,ref:node.ref,
   reason:'plan_basis_cannot_be_retired_by_temporal_label',expected:'for_the_current_plan_select_temporalUse_current_on_the_basis_and_apply_explicit_planChanges_preserving_original_time;_unspecified_only_when_currentness_is_truly_unestablished_not_as_a_rejection_workaround'}]);
  if(['revises','supersedes'].includes(node.relation?.kind))throw correction('continuity_plan_requires_scoped_change',[{nodeId:node.id,ref:node.ref,
   reason:'whole_node_retirement_not_a_scoped_plan_change',expected:'use_planChanges_status_or_content_with_complete_prior_scope'}]);
  return {...node,text:node.quote};
 })};
 for(const node of proposal.nodes){
  shape(node,['id','ref','quote','kind','temporalUse','text','topic','aspect','relation'],['reason',...(version>=2?['planStatus']:[]),...(version===3?['planRole']:[])]);
  text(node.id,80,'invalid_continuity_node_id');if(ids.has(node.id))throw Error('duplicate_continuity_node');ids.add(node.id);
  text(node.topic,128,'invalid_continuity_topic');text(node.aspect,128,'invalid_continuity_aspect');text(node.text,800,'invalid_continuity_text');
  const matched=support(node.ref,node.quote,limits.maxQuoteCodePoints),source=sourceMap.get(node.ref);
  if(cmcpEventInterpretationRoles[node.kind]!==source.sourceAuthorRole)throw correction('continuity_source_role_mismatch',[
   {path:originalNodePaths.get(node.id)??`$.nodes[${proposal.nodes.indexOf(node)}]`,nodeId:node.id,ref:node.ref,
    declaredKind:typeof node.kind==='string'&&Object.hasOwn(cmcpEventInterpretationRoles,node.kind)?node.kind:null,
    expectedRole:typeof node.kind==='string'&&Object.hasOwn(cmcpEventInterpretationRoles,node.kind)?cmcpEventInterpretationRoles[node.kind]:null,actualRole:source.sourceAuthorRole,
    phase:'formal_source_role',reason:'interpretation_kind_does_not_match_verified_source_author',
    expected:'recheck_this_row_against_the_formally_read_source_role;_do_not_relabel_the_source_or_discard_other_supported_reasons_to_pass'}]);
  const command=normalizeCmcpEventUpdate({version:version===3?2:version,updateId:node.id,source:{pointer:copy(source.pointer),citation:matched.citation},
   interpretation:{kind:node.kind,temporalUse:node.temporalUse,text:node.text,...(node.planStatus!==undefined?{planStatus:node.planStatus}:{})},
   action:{type:'add_node',objectId:node.topic,aspect:node.aspect,relation:node.relation}},{allowPlanContract:version>=2,allowUserInstruction:named});
  records.push({command,sourceSnapshot:{sourceAuthorRole:source.sourceAuthorRole,contentKind:source.contentKind,messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt}});
  if(node.reason!==undefined){shape(node.reason,['ref','quote']);const basis=support(node.reason.ref,node.reason.quote,limits.maxReasonCodePoints);
   if(version>=2&&['user_intent','user_report'].includes(node.kind)&&basis.sourceAuthorRole!=='user')throw Error('continuity_user_reason_requires_user_source');
   reasons.push({nodeId:node.id,...basis,relationAuthority:'host_proposed_reason_relation_not_semantically_verified',
    ...(version>=2?{standing:'not_explicitly_withdrawn',appliesTo:'cited_node_only_not_automatic_current_validity'}:{})});}
 }
 const refById=new Map(proposal.nodes.map(node=>[node.id,node.ref])),inputOrder=new Map(proposal.nodes.map((node,index)=>[node.id,index]));
 const event={scopeId,eventId:'reading-projection-'+reading.internal.manifestHash},replayed=replayProjection(event,records,refById),
  view=version===3?planRoleFrontier(replayed,proposal):replayed;
 if(version>=2)requireExplicitFrontier(view,records,refById,version);
 // 來源身分只來自已驗證的正式 manifest，包含 scope／Pointer／revision；不相信提案新增識別。
 const sourceIdentity=ref=>{const source=sourceMap.get(ref);return source?loopHash({
  pointer:Object.fromEntries(Object.entries(source.pointer).sort(([a],[b])=>a.localeCompare(b))),evidenceHash:source.evidenceHash}):null;};
 const preparedNamed=named?prepareNamedReasons({proposal,support,limits}):null;
 const plans=version===3?projectCmcpPlanChanges({proposal,view,support,limits,correction,sourceIdentity,sourcePointer,...(named?{namedReasons:preparedNamed}:{})}):null;
 const namedReasons=named?bindNamedReasons(preparedNamed,plans,sourceIdentity):null;
 const reportScopeReview=plans?(named?reviewCmcpReportScope({proposal,view,plans,support,sourceIdentity,limits,
  resolutions:proposal.reportScopeResolutions??[],correction,reportPath:id=>originalNodePaths.get(id)??null,
  statusPath:id=>{const binding=compilation?.planChangeBindings?.find(row=>row.changeId===id);
   return binding?mapScopedPath(`${typedPlanPaths.get(binding.planId)}.orderedChanges[${binding.index}]`):null;}})
  :{kind:'cmcp_report_scope_review',version:1,status:'not_evaluated_legacy_input',inputVersion:compilation?.inputVersion??version,
   authority:'legacy_input_contract_unchanged',semanticVerification:'not_performed',executionAuthority:'none'}):null;
 if(plans){
  const basisById=new Map(plans.planBasis.map(basis=>[basis.nodeId,basis]));
  for(const reason of reasons){const node=proposal.nodes.find(node=>node.id===reason.nodeId),basis=basisById.get(reason.nodeId);
   const matched=support(node.ref,node.quote,limits.maxQuoteCodePoints);
   const source={ref:matched.ref,citation:copy(matched.citation),sourceAuthorRole:matched.sourceAuthorRole,
    messageRecordedAt:matched.messageRecordedAt,eventOccurredAt:matched.eventOccurredAt,evidenceHash:matched.evidenceHash};
   reason.binding=basis?{kind:'plan_basis',nodeId:node.id,basisVersion:basis.baseVersion,source}:{kind:'source_node',nodeId:node.id,source};
   reason.appliesTo=basis?'original_plan_basis_not_automatically_a_later_change_cause':'cited_source_node_only_not_automatic_current_validity';
  }
 }
 const scoped=version>=2?scopedRelations({proposal,view:plans?{...view,currentPlans:plans.currentPlans}:view,support,limits,reasons,plans,sourceIdentity,namedReasons}):null;
 if(plans)plans.planScopeReview=resolveCmcpPlanScope({review:plans.planScopeReview,resolutions:proposal.scopeResolutions??[],
  retentions:scoped.retentions,nodes:proposal.nodes,support,limits,sourceIdentity,correction});
 const planEvidence=plans?projectCmcpPlanEvidence({proposal,plans,scoped,support,limits,correction,...(named?{namedReasons}:{})}):null;
 const scopedPlanBindings=scopedCompilation?.bindingDeclarations.length?bindCmcpScopedPlanApplicability({plans,declarations:scopedCompilation.bindingDeclarations,sourcePointer,correction}):null;
  // 只有 v6 增加來源用途提示；已驗引文／版本來自同一 Core，不接受新的 ACK 或 support 輸入。
  const sourceUseReview=named?reviewCmcpContentSourceUses({plans,retentions:scoped.retentions,reasonBindings:namedReasons,
    nodes:proposal.nodes,sourceIdentity,sourcePointer}):null;
 const planRoles=new Map(proposal.nodes.filter(node=>node.kind==='user_intent').map(node=>[node.id,node.planRole??'basis']));
 const refByPointer=new Map(manifest.sources.map(source=>[JSON.stringify(source.pointer),source.ref]));
 const projectedSource=source=>({ref:refByPointer.get(JSON.stringify(source.pointer)),citation:copy(source.citation),sourceAuthorRole:source.sourceAuthorRole,contentKind:source.contentKind});
 // 主視圖的正文旁保留正式引文聲音，不推定「你」指誰或把原話變成目前宿主的話。
 const claimVoice=row=>{
  const node=view.knownEvolution.find(node=>node.nodeId===row.nodeId),ref=refById.get(row.nodeId),source=sourceMap.get(ref);
  if(!node?.supported||!source||row.text!==node.interpretation.text
   ||JSON.stringify(source.pointer)!==JSON.stringify(node.source.pointer)
   ||node.source.sourceAuthorRole!==source.sourceAuthorRole||node.time.messageRecordedAt!==source.messageRecordedAt
   ||node.time.eventOccurredAt!==source.eventOccurredAt)throw Error('continuity_claim_source_binding');
  return {...copy(row),textUse:row.text===node.source.citation.text?'quoted_source_voice_not_current_speaker':'host_interpretation_not_source_quote',
   source:{...projectedSource(node.source),pointer:copy(source.pointer),evidenceHash:source.evidenceHash},
   originalTime:copy(node.time)};
 };
  let projection={kind:'query_scoped_derived_continuity',version,ticket:manifest.ticket,manifestHash:reading.internal.manifestHash,
  authority:'correctable_host_interpretation_not_world_verification',semanticVerification:'not_performed',
  eventMutation:'none',sourceAssociationMutation:'none',activation:'none',proactiveEligible:false,
  // Keep the visible proposal order; the dependency replay order is not a chronology.
  knownEvolution:[...view.knownEvolution].sort((a,b)=>inputOrder.get(a.nodeId)-inputOrder.get(b.nodeId)).map(node=>({...copy(node),topic:node.objectId,source:projectedSource(node.source),
   ...(version===3&&planRoles.has(node.nodeId)?{planRole:planRoles.get(node.nodeId)}:{}),
   effectiveRelation:{...copy(node.effectiveRelation),sourceUpdates:node.effectiveRelation.sourceUpdates.map(row=>({...copy(row),source:projectedSource({...row.source,sourceAuthorRole:row.sourceAuthorRole,contentKind:row.contentKind})}))}})),
  currentClaims:version===3?view.currentClaims.map(claimVoice):copy(view.currentClaims),unresolved:copy(view.unresolved),unknownParts:copy(view.unknownParts),reasons,...(named?{reasonBindings:namedReasons,
   reasonScopeReview:reviewCmcpReasonSpans({plans,reasonBindings:namedReasons,reasonRelations:scoped.reasonRelations,sourceIdentity})}:{}),
  ...(version>=2?{currentPlans:version===3?(plans?.currentPlans??[]).map(row=>({...copy(row),textUse:'source_bound_plan_not_external_outcome'})):copy(view.currentPlans??[]),unresolvedPlans:copy(plans?.unresolvedPlans??view.unresolvedPlans??[]),
   retentions:scoped.retentions,reasonRelations:scoped.reasonRelations,
   validation:{structure:'validated',source:'formal_reading_verified',semantics:'not_performed',executionAuthority:'none'}}:{}),
  ...(plans?{planBasis:plans.planBasis,planChanges:plans.planChanges,planScopeReview:plans.planScopeReview,reportScopeReview,planEvidence,planCoverage:{...plans.planCoverage,evidenceNodes:planEvidence.length},
   reasonCoverage:{scope:'proposed_nodes_and_changes_only',nodeReasonsProvided:reasons.length,
    changeReasonsProvided:plans.planChanges.filter(change=>change.reasonStatus==='provided').length,...(named?{bindingReasonsProvided:namedReasons.length}:{}),
    interpretationCompleteness:'not_established',omissionMeaning:'not_provided_does_not_mean_no_reason',semanticVerification:'not_performed'}}:{}),
   ...(scopedPlanBindings?{scopedPlanBindings}:{}),
  unknowns,unknownsAuthority:'unverified_host_uncertainty_not_new_facts',
  sources:[...bindings.values()].map(source=>({ref:source.ref,sourceAuthorRole:source.sourceAuthorRole,contentKind:source.contentKind,
   messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt,evidenceHash:source.evidenceHash})),
  coverage:{...copy(progress.coverage),...material.coverage,historyCompleteness:'not_established',interpretationCompleteness:'not_established',
   selectedRoleCounts:roleCounts(manifest.sources),citedRoleCounts:roleCounts([...bindings.values()]),
   proposedNodes:records.length,citedSources:bindings.size,uncitedReadSources:manifest.sources.filter(source=>!bindings.has(source.ref)).map(source=>source.ref)},
  runtimeTime:projectCmcpRuntimeTime(resolveCmcpTimeContext(timeContext))};
  // 可選提示不裁切父材料；容量 metadata 留在既有 presentation 封套，不越界提供來源正文。
  const sourceUseDelivery=attachCmcpContentSourceUseReview(projection,sourceUseReview);
  projection=sourceUseDelivery.projection;
  const projectionCapacity=sourceUseDelivery.projectionCapacity,sourceUseReviewDelivery=sourceUseDelivery.delivery;
  const presentation=version===3?createCmcpContinuityPresentation({projection,projectionHash:loopHash(projection),scopeId,verifiedScopeId:manifest.scopeId,reading,previousPages,sourceUseReviewDelivery}):null;
 return {kind:'cmcp_continuity_projection',...continuityReadiness(material.coverage.modelCoverageComplete,projection),modelCoverageComplete:material.coverage.modelCoverageComplete,
  ticket:manifest.ticket,projection,projectionHash:loopHash(projection),projectionCapacity,modelCalls:0,
   ...(version===3?{scopeId,presentation}:{}),
  ...(compilation?{inputVersion:compilation.inputVersion,compilation}:{}),
  internal:{manifestHash:reading.internal.manifestHash,queryPointer:copy(manifest.queryPointer),
   ...(manifest.queryAuthorization?{queryAuthorization:copy(manifest.queryAuthorization)}:{}),queryHash:manifest.queryHash,queryTime:manifest.queryTime,
   bufferGeneration:manifest.bufferGeneration,sourceRefs:manifest.sources.map(source=>source.ref),modelCalls:0}};
}

/** Revalidate all selected originals, not only convenient quoted supporters.
 * Complete reading is collection coverage and never establishes semantic truth. */
export async function validateCmcpContinuityCorrectionPublication({stores,catalog,reading,previousPages=[],error,timeContext,bufferGeneration,valid=async()=>true}){
 if(!hasCmcpContinuityPreview(error))return {status:'not_required'};
 const {manifest}=completed({reading,previousPages,scopeId:stores.scopeId});
 for(const issue of corrections.get(error).issues){const preview=issue.previousVersion?.preview;
  if(preview?.status==='available'&&(preview.ticket!==manifest.ticket||preview.manifestHash!==reading.internal.manifestHash||preview.textHash!==loopHash(preview.text)))
   throw Error('continuity_correction_binding_changed');
 }
 const publication=await validateCmcpReadingPublication({stores,catalog,reading,timeContext,bufferGeneration,sourceRefs:manifest.sources.map(source=>source.ref),valid});
 if(publication.status!=='verified')throw Error('continuity_source_unavailable');
 if(!await valid())throw Error('continuity_publication_cancelled');
 return {status:'verified',proposalAccepted:false,semanticVerification:'not_performed'};
}
export async function validateCmcpContinuityPublication({stores,catalog,reading,previousPages=[],result,timeContext,bufferGeneration,valid=async()=>true}){
 const {manifest}=completed({reading,previousPages,scopeId:stores.scopeId});
 const material=modelMaterial(manifest,previousPages),readiness=continuityReadiness(material.coverage.modelCoverageComplete,result?.projection);
 if(result?.kind!=='cmcp_continuity_projection'||result.status!==readiness.status||result.ticket!==manifest.ticket
  ||result.modelCoverageComplete!==material.coverage.modelCoverageComplete
  ||result.reason!==readiness.reason||result.readinessReasons!==undefined&&JSON.stringify(result.readinessReasons)!==JSON.stringify(readiness.readinessReasons)
  ||JSON.stringify(result.projection?.coverage?.materialAvailableInFormalToolResult)!==JSON.stringify(material.coverage.materialAvailableInFormalToolResult)
  ||result.projection?.coverage?.modelCoverageComplete!==material.coverage.modelCoverageComplete||result.projection?.coverage?.actualModelConsumption!=='not_observed'
  ||result.internal?.manifestHash!==reading.internal.manifestHash||result.projection?.manifestHash!==reading.internal.manifestHash
  ||result.projectionHash!==loopHash(result.projection)||result.internal.queryHash!==manifest.queryHash
  ||JSON.stringify(result.internal.sourceRefs)!==JSON.stringify(manifest.sources.map(source=>source.ref)))throw Error('continuity_projection_binding_changed');
 // 舊回執可沒有此欄位；新回執的容量數字必須仍能由完整投影逐位元組重算。
 if(result.projectionCapacity&&JSON.stringify(result.projectionCapacity)!==JSON.stringify(measureCmcpContinuityProjectionCapacity(result.projection)))
  throw Error('continuity_projection_capacity_changed');
 // 舊回執未記錄此視圖時保持未知；新視圖須能以同票券原始 reader 材料完整重算。
  const expectedPresentation=result.presentation?.sourceContext||result.presentation?.sourceUseReviewDelivery?createCmcpContinuityPresentation({
   projection:result.projection,projectionHash:result.projectionHash,scopeId:stores.scopeId,verifiedScopeId:manifest.scopeId,reading,previousPages,
   sourceUseReviewDelivery:result.presentation.sourceUseReviewDelivery??null}):null;
  if(result.presentation?.sourceContext&&JSON.stringify(result.presentation.sourceContext)!==JSON.stringify(expectedPresentation.sourceContext))
   throw Error('continuity_source_context_binding_changed');
  if(result.presentation?.sourceUseReviewDelivery&&JSON.stringify(result.presentation.sourceUseReviewDelivery)!==JSON.stringify(expectedPresentation.sourceUseReviewDelivery))
   throw Error('continuity_source_use_delivery_binding_changed');
 const publication=await validateCmcpReadingPublication({stores,catalog,reading,timeContext,bufferGeneration,sourceRefs:result.internal.sourceRefs,valid});
 if(publication.status!=='verified')throw Error('continuity_source_unavailable');
 if(!await valid())throw Error('continuity_publication_cancelled');
 return {status:'verified',sourceVerification:'exact_pointer_revision_role_scope_time_hash',semanticVerification:'not_performed'};
}
