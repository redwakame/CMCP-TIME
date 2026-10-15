import {loopHash} from './cmcp-local-loop-journal.js';
import {createCmcpContinuityProposalChecks} from './cmcp-continuity-proposal.js';

export const CMCP_CONTINUITY_SCOPED_PREFIX='__cmcp_v7_';
const copy=structuredClone,bytes=value=>Buffer.byteLength(JSON.stringify(value));
const reasonKinds=new Set(['adds','prioritizes','accepts_tradeoff']);

/** 明示 condition × scope 的 reducer；不從文字猜範圍、理由或先後。
 * 只編譯成原 v6 輸入，結果仍須通過既有正式來源、版本、scope review 和 publication。
 */
export function compileCmcpScopedContinuityProposal(input,{limits,correction=code=>new TypeError(code),support,sourcePointer}={}){
 const fail=(code,issues=[])=>{throw correction(code,issues);};
 const {shape,list}=createCmcpContinuityProposalChecks(fail,7);
 const value=(row,max,path)=>{if(typeof row!=='string'||!row.trim()||[...row].length>max)fail('continuity_v7_value',[{path,reason:'nonempty_bounded_string_required',maxCodePoints:max}]);return row;};
 const id=(row,path)=>value(row,80,path),cite=(row,path)=>{id(row.ref,path+'.ref');value(row.quote,limits.maxQuoteCodePoints,path+'.quote');};
 const rows=(row,max,path)=>list(row===undefined?[]:row,max,path);
 const temporal=(row,path)=>{if(!['current','historical','unspecified'].includes(row))fail('continuity_v7_temporal_use',[{path}]);};
 const status=(row,path)=>{if(!['planned','paused','cancelled'].includes(row))fail('continuity_v7_plan_status',[{path}]);};
 const overflow=(path,actualItems,maxItems)=>fail('continuity_proposal_limit',[{path,reason:'compiled_max_items_exceeded',expected:'existing_compiled_collection_bound',actualItems,maxItems,phase:'compiled',inputVersion:7}]);
 if(!limits||input?.version!==7)fail('continuity_v7_version');
 shape(input,['version','plans','unknowns'],['scopedPlans','reports','suggestions','context','scopeResolutions','reportScopeResolutions']);
 if(bytes(input)>limits.maxProposalBytes)fail('continuity_proposal_limit',[{path:'$',reason:'max_bytes_exceeded',actualBytes:bytes(input),maxBytes:limits.maxProposalBytes,phase:'input',inputVersion:7}]);
 list(input.plans,limits.maxNodes,'$.plans');list(input.unknowns,limits.maxUnknowns,'$.unknowns');
 const groups=rows(input.scopedPlans,limits.maxNodes,'$.scopedPlans');
 if(groups.length&&(!support||!sourcePointer))fail('continuity_v7_formal_scope_support_required');
 // 此 prefix 由編譯器產生；不得用 plain plans／reason id 偽装或碰撞。
 for(const [index,plan]of input.plans.entries()){
  if(typeof plan?.id==='string'&&plan.id.startsWith(CMCP_CONTINUITY_SCOPED_PREFIX))fail('continuity_v7_id_collision',[{path:`$.plans[${index}].id`}]);
  for(const row of [...(Array.isArray(plan?.reasons)?plan.reasons:[]),...(Array.isArray(plan?.orderedChanges)?plan.orderedChanges.flatMap(change=>Array.isArray(change?.reasons)?change.reasons:[]):[])])
   if(typeof row?.id==='string'&&row.id.startsWith(CMCP_CONTINUITY_SCOPED_PREFIX))fail('continuity_v7_id_collision');
 }
 const proposal={...copy(input),version:6};delete proposal.scopedPlans;
 const declarations=[],paths=[],groupIds=new Set();let expandedChanges=0,expandedRetentions=0,expandedWithdrawals=0;
 const countExpanded=()=>{
  const count=proposal.plans.length+(input.reports?.length??0)+(input.suggestions?.length??0)+(input.context?.length??0)+expandedRetentions+expandedWithdrawals;
  if(count>limits.maxNodes)overflow('$.scopedPlans',count,limits.maxNodes);
  if(expandedChanges>limits.maxPlanChanges)overflow('$.scopedPlans',expandedChanges,limits.maxPlanChanges);
  if(expandedRetentions>limits.maxRetentions)overflow('$.scopedPlans',expandedRetentions,limits.maxRetentions);
  if(expandedWithdrawals>limits.maxReasonRelations)overflow('$.scopedPlans',expandedWithdrawals,limits.maxReasonRelations);
 };
 for(const [groupIndex,group]of groups.entries()){
  const groupPath=`$.scopedPlans[${groupIndex}]`;
  shape(group,['id','topic','scopes','conditions'],['orderedChanges','retentions','reasonWithdrawals'],groupPath);
  id(group.id,groupPath+'.id');value(group.topic,128,groupPath+'.topic');
  if(groupIds.has(group.id))fail('continuity_v7_id_collision',[{path:groupPath+'.id'}]);groupIds.add(group.id);
  const scopeRows=list(group.scopes,limits.maxNodes,groupPath+'.scopes'),conditionRows=list(group.conditions,limits.maxNodes,groupPath+'.conditions');
  if(!scopeRows.length||!conditionRows.length)fail('continuity_v7_empty_scoped_plan',[{path:groupPath}]);
  const scopes=new Map(),conditions=new Map(),cells=new Map();
  for(const [scopeIndex,scope]of scopeRows.entries()){
   const scopePath=`${groupPath}.scopes[${scopeIndex}]`;
   shape(scope,['id','ref','quote'],[],scopePath);id(scope.id,scopePath+'.id');cite(scope,scopePath);
   if(scopes.has(scope.id))fail('continuity_v7_id_collision',[{path:scopePath+'.id'}]);
   const matched=support(scope.ref,scope.quote,limits.maxQuoteCodePoints),pointer=sourcePointer(scope.ref);
   if(matched.sourceAuthorRole!=='user')fail('continuity_v7_scope_user_source_required',[{path:scopePath,phase:'formal_source_role',reason:'scope_anchor_requires_formal_user_source'}]);
   if(!pointer||pointer.version!==1||matched.ref!==scope.ref||matched.citation?.text!==scope.quote)fail('continuity_v7_scope_source_binding');
   scopes.set(scope.id,{index:scopeIndex,path:scopePath,source:{...copy(matched),pointer:copy(pointer)}});
  }
  const membership=(row,condition,path)=>{
   const selected=list(row.scopeIds,limits.maxRelationTargets,path+'.scopeIds');
   if(!selected.length||new Set(selected).size!==selected.length||selected.some(scopeId=>typeof scopeId!=='string'||!scopes.has(scopeId)||condition&&!condition.scopeIds.includes(scopeId)))
    fail('continuity_v7_scope_target',[{path:path+'.scopeIds',reason:'unique_existing_condition_scope_subset_required',expected:'name_only_scopes_declared_for_this_condition'}]);
   return selected;
  };
  const registerReasons=(condition,entries,changed,path)=>rows(entries,limits.maxNodes,path).map((reason,index)=>{
   const reasonPath=`${path}[${index}]`;shape(reason,['id','ref','quote'],changed?['kind']:[],reasonPath);id(reason.id,reasonPath+'.id');cite(reason,reasonPath);
   value(reason.quote,limits.maxReasonCodePoints,reasonPath+'.quote');
   if(reason.kind!==undefined&&!reasonKinds.has(reason.kind))fail('continuity_v7_reason_kind',[{path:reasonPath+'.kind',allowedKinds:[...reasonKinds]}]);
   if(condition.reasonIds.has(reason.id))fail('continuity_v7_reason_id_collision',[{path:reasonPath+'.id'}]);
   const ordinal=condition.reasonIds.size;condition.reasonIds.set(reason.id,ordinal);return {row:reason,ordinal,path:reasonPath};
  });
  const reasonFor=(reason,conditionIndex,scopeIndex)=>({...copy(reason.row),id:`${CMCP_CONTINUITY_SCOPED_PREFIX}reason_${groupIndex}_${conditionIndex}_${scopeIndex}_${reason.ordinal}`});
  for(const [conditionIndex,condition]of conditionRows.entries()){
   const conditionPath=`${groupPath}.conditions[${conditionIndex}]`;
   shape(condition,['id','ref','quote','aspect','temporalUse','scopeIds'],['reasons','planStatus'],conditionPath);
   id(condition.id,conditionPath+'.id');cite(condition,conditionPath);value(condition.aspect,128,conditionPath+'.aspect');temporal(condition.temporalUse,conditionPath+'.temporalUse');
   if(condition.planStatus!==undefined)status(condition.planStatus,conditionPath+'.planStatus');
   if(conditions.has(condition.id))fail('continuity_v7_id_collision',[{path:conditionPath+'.id'}]);
   const scopeIds=membership(condition,null,conditionPath),entry={index:conditionIndex,scopeIds,reasonIds:new Map(),path:conditionPath};conditions.set(condition.id,entry);
   const reasons=registerReasons(entry,condition.reasons,false,conditionPath+'.reasons');
   for(const scopeId of scopeIds){
    const scope=scopes.get(scopeId),nodeId=`${CMCP_CONTINUITY_SCOPED_PREFIX}plan_${groupIndex}_${conditionIndex}_${scope.index}`;
    const aspect=scope.source.citation.text+'／'+condition.aspect;value(aspect,128,conditionPath+'.aspect');
    const plan={id:nodeId,ref:condition.ref,quote:condition.quote,topic:group.topic,aspect,temporalUse:condition.temporalUse,
     ...(condition.planStatus===undefined?{}:{planStatus:condition.planStatus}),...(reasons.length?{reasons:reasons.map(reason=>reasonFor(reason,conditionIndex,scope.index))}:{} )};
    const planIndex=proposal.plans.length;proposal.plans.push(plan);paths.push({compiledPath:`$.plans[${planIndex}]`,inputPath:conditionPath});
    declarations.push({groupId:group.id,conditionId:condition.id,scopeId,nodeId,scopeSource:copy(scope.source),inputPath:conditionPath});
    cells.set(JSON.stringify([condition.id,scopeId]),{plan,index:planIndex,value:condition.quote,reasonIds:new Set(reasons.map(reason=>reason.row.id)),conditionIndex,scopeIndex:scope.index});countExpanded();
   }
  }
  const selectedCells=(row,path)=>{
   const condition=conditions.get(row.conditionId);if(!condition)fail('continuity_v7_condition_target',[{path:path+'.conditionId',reason:'existing_condition_required'}]);
   return {condition,cells:membership(row,condition,path).map(scopeId=>cells.get(JSON.stringify([row.conditionId,scopeId])))};
  };
  for(const [index,change]of rows(group.orderedChanges,limits.maxPlanChanges,groupPath+'.orderedChanges').entries()){
   const changePath=`${groupPath}.orderedChanges[${index}]`;
   shape(change,['conditionId','scopeIds','kind','ref','quote'],['reasons',...(change?.kind==='content'?['replacement']:change?.kind==='status'?['planStatus']:[])],changePath);
   id(change.conditionId,changePath+'.conditionId');cite(change,changePath);
   if(!['content','status','reason'].includes(change.kind))fail('continuity_v7_change_kind',[{path:changePath+'.kind'}]);
   if(change.kind==='content'){shape(change.replacement,['ref','quote'],[],changePath+'.replacement');cite(change.replacement,changePath+'.replacement');}
   if(change.kind==='status')status(change.planStatus,changePath+'.planStatus');
   const selected=selectedCells(change,changePath),reasons=registerReasons(selected.condition,change.reasons,true,changePath+'.reasons');
   if(change.kind==='reason'&&!reasons.length)fail('continuity_plan_change_reason_required',[{path:changePath+'.reasons'}]);
   for(const cell of selected.cells){
    const ordered=cell.plan.orderedChanges??=[];const orderIndex=ordered.length;
    ordered.push({kind:change.kind,ref:change.ref,quote:change.quote,
     ...(change.kind==='content'?{edits:[{quote:cell.value,kind:'replace',replacement:copy(change.replacement)}]}:change.kind==='status'?{planStatus:change.planStatus}:{}),
     ...(reasons.length?{reasons:reasons.map(reason=>reasonFor(reason,cell.conditionIndex,cell.scopeIndex))}:{} )});
    paths.push({compiledPath:`$.plans[${cell.index}].orderedChanges[${orderIndex}]`,inputPath:changePath});
    if(change.kind==='content')cell.value=change.replacement.quote;
    for(const reason of reasons)cell.reasonIds.add(reason.row.id);expandedChanges++;countExpanded();
   }
  }
  for(const [index,retention]of rows(group.retentions,limits.maxRetentions,groupPath+'.retentions').entries()){
   const retentionPath=`${groupPath}.retentions[${index}]`;shape(retention,['conditionId','scopeIds','ref','quote','temporalUse'],[],retentionPath);
   cite(retention,retentionPath);temporal(retention.temporalUse,retentionPath+'.temporalUse');
   for(const cell of selectedCells(retention,retentionPath).cells){
    const retained=cell.plan.retentions??=[],position=retained.length;retained.push({ref:retention.ref,quote:retention.quote,temporalUse:retention.temporalUse});
    paths.push({compiledPath:`$.plans[${cell.index}].retentions[${position}]`,inputPath:retentionPath});expandedRetentions++;countExpanded();
   }
  }
  for(const [index,withdrawal]of rows(group.reasonWithdrawals,limits.maxReasonRelations,groupPath+'.reasonWithdrawals').entries()){
   const withdrawalPath=`${groupPath}.reasonWithdrawals[${index}]`;shape(withdrawal,['conditionId','scopeIds','targetReasonId','ref','quote','temporalUse'],[],withdrawalPath);
   cite(withdrawal,withdrawalPath);temporal(withdrawal.temporalUse,withdrawalPath+'.temporalUse');id(withdrawal.targetReasonId,withdrawalPath+'.targetReasonId');
   const selected=selectedCells(withdrawal,withdrawalPath);
   for(const cell of selected.cells){
    if(!cell.reasonIds.has(withdrawal.targetReasonId))fail('continuity_v7_reason_withdrawal_target',[{path:withdrawalPath+'.targetReasonId',reason:'reason_must_exist_on_each_named_condition_scope'}]);
    const items=cell.plan.reasonWithdrawals??=[],position=items.length,ordinal=selected.condition.reasonIds.get(withdrawal.targetReasonId);
    items.push({ref:withdrawal.ref,quote:withdrawal.quote,temporalUse:withdrawal.temporalUse,targetReasonId:`${CMCP_CONTINUITY_SCOPED_PREFIX}reason_${groupIndex}_${cell.conditionIndex}_${cell.scopeIndex}_${ordinal}`});
    paths.push({compiledPath:`$.plans[${cell.index}].reasonWithdrawals[${position}]`,inputPath:withdrawalPath});expandedWithdrawals++;countExpanded();
   }
  }
 }
 if(bytes(proposal)>limits.maxProposalBytes)fail('continuity_proposal_limit',[{path:'$.scopedPlans',reason:'compiled_max_bytes_exceeded',actualBytes:bytes(proposal),maxBytes:limits.maxProposalBytes,phase:'compiled',inputVersion:7}]);
 return {proposal,bindingDeclarations:declarations,inputPaths:paths.sort((a,b)=>b.compiledPath.length-a.compiledPath.length),
  proof:{kind:'cmcp_scoped_continuity_compilation',version:1,inputVersion:7,outputVersion:6,inputHash:loopHash(input),compiledProposalHash:loopHash(proposal),
   tupleNodeIds:declarations.map(row=>row.nodeId),orderAuthority:'orderedChanges_is_explicit_host_order_not_inferred_source_chronology',
   scopeAuthority:'formally_cited_host_declared_membership_not_semantic_verification',semanticVerification:'not_performed',executionAuthority:'none'}};
}

/** 只附同一 Core 的已驗來源與目前版本，先入正式 projection hash，才進 presentation。 */
export function bindCmcpScopedPlanApplicability({plans,declarations,sourcePointer,correction=code=>new TypeError(code)}){
 const bindings=[];
 for(const declaration of declarations){
  const basis=plans.planBasis.find(row=>row.nodeId===declaration.nodeId),current=plans.currentPlans.find(row=>row.nodeId===declaration.nodeId);
  if(!basis||basis.candidates.length!==1)throw correction('continuity_v7_scoped_plan_version_binding');
  const candidate=current??basis.candidates[0];
  const value={kind:'cmcp_condition_scope_binding',version:1,groupId:declaration.groupId,conditionId:declaration.conditionId,scopeId:declaration.scopeId,
   nodeId:declaration.nodeId,planVersion:candidate.planVersion,basisVersion:basis.baseVersion,scopeSource:copy(declaration.scopeSource),
   conditionSource:{...copy(basis.source),pointer:copy(sourcePointer(basis.source.ref))},
   appliedChanges:plans.planChanges.filter(row=>row.targetNodeId===declaration.nodeId).map(row=>({changeId:row.id,kind:row.kind,
    priorVersion:row.priorVersion,planVersion:row.planVersion,source:{...copy(row.source),pointer:copy(sourcePointer(row.source.ref))}})),
   currentness:current?'selected_current_basis':'not_established_as_current',authority:'source_bound_host_declared_condition_scope_not_semantic_verification',
   sourceBindingVerification:'validated',semanticVerification:'not_performed',executionAuthority:'none'};
  const binding={...value,bindingHash:loopHash(value)};bindings.push(binding);
  if(current)current.applicability={kind:'declared_condition_scope',groupId:binding.groupId,conditionId:binding.conditionId,scopeId:binding.scopeId,
   scopedPlanBindingHash:binding.bindingHash,scopeLabel:binding.scopeSource.citation.text,semanticVerification:'not_performed'};
 }
 return bindings;
}
