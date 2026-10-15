import {loopHash} from './cmcp-local-loop-journal.js';
import {compileCmcpContinuityProposal,CMCP_CONTINUITY_COMPILER_PREFIX,createCmcpContinuityProposalChecks} from './cmcp-continuity-proposal.js';

export const CMCP_CONTINUITY_TYPED_COMPILER_VERSION=1;
export const CMCP_CONTINUITY_TYPED_PREFIX='__cmcp_v5_';
const copy=structuredClone,bytes=value=>Buffer.byteLength(JSON.stringify(value));
const contexts=new Set(['user_report','user_question','assistant_suggestion','assistant_statement','tool_observation']);
const reasonKinds=new Set(['adds','prioritizes','accepts_tradeoff']);

/** 型別分區只編譯表示與明示順序，不判斷自然語意或新增授權。
 * 結果必須再走完整 v3 正式來源、角色、版本、覆蓋與 publication 守護。
 */
export function compileCmcpTypedContinuityProposal(input,{limits,correction=code=>new TypeError(code),inspectPreviousVersion}={}){
 const fail=(code,issues=[])=>{throw correction(code,issues);};
 const inputVersion=input?.version,named=inputVersion===6,prefix=named?'__cmcp_v6_':CMCP_CONTINUITY_TYPED_PREFIX;
 const {shape,list}=createCmcpContinuityProposalChecks(fail,named?6:5);
 const string=(value,max=80)=>{if(typeof value!=='string'||!value.trim()||[...value].length>max)fail('continuity_v5_value');return value;};
 const optionalList=(value,max,path)=>list(value===undefined?[]:value,max,path);
 const temporal=value=>{if(!['current','historical','unspecified'].includes(value))fail('continuity_v5_temporal_use');return value;};
 const status=value=>{if(!['planned','paused','cancelled'].includes(value))fail('continuity_v5_plan_status');return value;};
 const cite=value=>{string(value.ref);string(value.quote,limits.maxQuoteCodePoints);};
 const reason=(value,change=false,path='$')=>{shape(value,['ref','quote'],change?['kind']:[],path);string(value.ref);string(value.quote,limits.maxReasonCodePoints);
  if(value.kind!==undefined&&!reasonKinds.has(value.kind))fail('continuity_v5_reason_kind',[{path:`${path}.kind`,reason:'unsupported_reason_kind',allowedKinds:[...reasonKinds],expected:'use_one_allowed_reason_kind_only_if_supported_by_the_source;_correct_this_field_without_discarding_other_supported_reasons_or_relations'}]);return copy(value);};
 if(!limits||![5,6].includes(inputVersion))fail('continuity_v5_version');
 shape(input,['version','plans','unknowns'],['reports','suggestions','context',...(named?['scopeResolutions','reportScopeResolutions']:[])]);
 if(bytes(input)>limits.maxProposalBytes)fail('continuity_proposal_limit',[{path:'$',reason:'max_bytes_exceeded',expected:'bounded_proposal',maxBytes:limits.maxProposalBytes,actualBytes:bytes(input),phase:'input'}]);
 const plans=list(input.plans,limits.maxNodes,'$.plans'),reports=optionalList(input.reports,limits.maxNodes,'$.reports'),suggestions=optionalList(input.suggestions,limits.maxNodes,'$.suggestions'),context=optionalList(input.context,limits.maxNodes,'$.context');
 const unknowns=list(input.unknowns,limits.maxUnknowns,'$.unknowns').map(value=>string(value,256));
 const ids=new Set(),reserve=id=>{string(id);if(ids.has(id)||id.startsWith(CMCP_CONTINUITY_TYPED_PREFIX)||id.startsWith(CMCP_CONTINUITY_COMPILER_PREFIX)||(named&&id.startsWith(prefix)))fail('continuity_v5_id_collision');ids.add(id);return id;};
 const common=node=>{reserve(node.id);cite(node);string(node.topic,128);string(node.aspect,128);temporal(node.temporalUse);};
 const nodes=[],changes=[],retentions=[],withdrawals=[],generatedChangeIds=[],generatedEvidenceNodeIds=[],planChangeBindings=[],inputPaths=new Map();
 const reasonBindings=[],reasonOwners=new Map(),boundReasonChangeIds=new Set();
 const addReasons=(rows,owner,planId,change,path)=>{
  for(const [index,row]of optionalList(rows,limits.maxNodes,path).entries()){
   shape(row,['id','ref','quote'],change?['kind']:[],`${path}[${index}]`);string(row.id);cite(row);string(row.quote,limits.maxReasonCodePoints);
   if(reasonOwners.has(row.id))fail('continuity_v6_reason_id_collision',[{path:`${path}[${index}].id`,reason:'duplicate_reason_id',expected:'unique_reason_id_in_this_proposal'}]);
   if(row.kind!==undefined&&!reasonKinds.has(row.kind))fail('continuity_v6_reason_kind',[{path:`${path}[${index}].kind`,reason:'unsupported_reason_kind',allowedKinds:[...reasonKinds],expected:'use_one_allowed_reason_kind_only_if_supported_by_the_source;_correct_this_field_without_discarding_other_supported_reasons_or_relations'}]);
   reasonOwners.set(row.id,planId);reasonBindings.push({reasonId:row.id,...owner,ref:row.ref,quote:row.quote,...(row.kind===undefined?{}:{kind:row.kind})});
   if(change)boundReasonChangeIds.add(owner.targetChangeId);
  }
 };
 for(const [planIndex,plan]of plans.entries()){
  const planPath=`$.plans[${planIndex}]`;
  shape(plan,['id','ref','quote','topic','aspect','temporalUse'],[named?'reasons':'reason','planStatus','orderedChanges','retentions','reasonWithdrawals'],planPath);common(plan);
  const node={id:plan.id,ref:plan.ref,quote:plan.quote,topic:plan.topic,aspect:plan.aspect,temporalUse:plan.temporalUse,kind:'user_intent'};
  if(plan.reason!==undefined)node.reason=reason(plan.reason,false,`${planPath}.reason`);
  if(named)addReasons(plan.reasons,{targetNodeId:plan.id},plan.id,false,`${planPath}.reasons`);
  if(plan.planStatus!==undefined)node.planStatus=status(plan.planStatus);
  inputPaths.set(`$.nodes[${nodes.length}]`,planPath);nodes.push(node);
  const ordered=optionalList(plan.orderedChanges,limits.maxPlanChanges,`${planPath}.orderedChanges`),changeIds=[];let previous=null;
  for(const [index,change]of ordered.entries()){
   const changePath=`${planPath}.orderedChanges[${index}]`;
   shape(change,['kind','ref','quote'],[named?'reasons':'reason',...(change?.kind==='content'?['edits']:change?.kind==='status'?['planStatus']:[])],changePath);cite(change);
   if(!['content','status','reason'].includes(change.kind))fail('continuity_v5_change_kind');
   if(change.kind==='reason'&&(named?(!Array.isArray(change.reasons)||!change.reasons.length):change.reason===undefined))fail('continuity_plan_change_reason_required');
   const id=prefix+'change_'+planIndex+'_'+index;
   const compiled={...copy(change),id,targetNodeId:plan.id,afterChangeId:previous};
   if(named){delete compiled.reasons;addReasons(change.reasons,{targetChangeId:id},plan.id,true,`${changePath}.reasons`);}
   if(change.reason!==undefined)compiled.reason=reason(change.reason,true,`${changePath}.reason`);
   if(change.kind==='status')compiled.planStatus=status(change.planStatus);
   // edits 的逐字唯一性、重疊與保留片段仍由原 v4 編譯器裁決。
   inputPaths.set(`$.planChanges[${changes.length}]`,changePath);changes.push(compiled);changeIds.push(id);generatedChangeIds.push(id);planChangeBindings.push({planId:plan.id,index,changeId:id});previous=id;
  }
  for(const [index,row]of optionalList(plan.retentions,limits.maxRetentions,`${planPath}.retentions`).entries()){
   const rowPath=`${planPath}.retentions[${index}]`;
   shape(row,['ref','quote','temporalUse'],[],rowPath);cite(row);temporal(row.temporalUse);
   inputPaths.set(`$.retentions[${retentions.length}].evidence`,rowPath);inputPaths.set(`$.retentions[${retentions.length}]`,rowPath);
   retentions.push({targetNodeIds:[plan.id],evidence:{...copy(row),kind:'user_intent',aspect:plan.aspect}});
  }
  for(const [index,row]of optionalList(plan.reasonWithdrawals,limits.maxReasonRelations,`${planPath}.reasonWithdrawals`).entries()){
   if(named){
    shape(row,['ref','quote','temporalUse','targetReasonId'],[],`${planPath}.reasonWithdrawals[${index}]`);cite(row);temporal(row.temporalUse);string(row.targetReasonId);
    if(reasonOwners.get(row.targetReasonId)!==plan.id)fail('continuity_v6_reason_withdrawal_target',[{planId:plan.id,withdrawalIndex:index,reason:'target_requires_existing_reason_owned_by_this_plan',expected:'name_one_formally_cited_basis_or_change_reason_id_of_this_plan'}]);
    const id=prefix+'withdraw_'+planIndex+'_'+index;generatedEvidenceNodeIds.push(id);
    withdrawals.push({node:{id,ref:row.ref,quote:row.quote,text:row.quote,kind:'user_intent',temporalUse:row.temporalUse,
      topic:plan.topic,aspect:plan.aspect,planRole:'evidence',relation:{kind:'related',targetNodeIds:[plan.id]}},
     relation:{kind:'withdraws',fromNodeId:id,targetReasonIds:[row.targetReasonId],ref:row.ref,quote:row.quote}});
    continue;
   }
   shape(row,['ref','quote','temporalUse','target'],[],`${planPath}.reasonWithdrawals[${index}]`);cite(row);temporal(row.temporalUse);
   const targetBasis=row.target==='basis';
   if(!targetBasis&&(!Number.isSafeInteger(row.target)||row.target<0||row.target>=ordered.length))
    fail('continuity_v5_reason_withdrawal_target',[{planId:plan.id,withdrawalIndex:index,reason:'target_requires_basis_or_existing_ordered_change_index',expected:'name_the_existing_reason_owner_without_creating_a_plan'}]);
   if((targetBasis?plan.reason:ordered[row.target].reason)===undefined)
    fail('continuity_v5_reason_withdrawal_missing',[{planId:plan.id,withdrawalIndex:index,target:row.target,reason:'named_target_has_no_reason',expected:'withdraw_only_an_existing_formally_cited_reason'}]);
   const id=CMCP_CONTINUITY_TYPED_PREFIX+'withdraw_'+planIndex+'_'+index;
   generatedEvidenceNodeIds.push(id);
   withdrawals.push({node:{id,ref:row.ref,quote:row.quote,text:row.quote,kind:'user_intent',temporalUse:row.temporalUse,
     topic:plan.topic,aspect:plan.aspect,planRole:'evidence',relation:{kind:'related',targetNodeIds:[plan.id]}},
    relation:{kind:'withdraws',fromNodeId:id,...(targetBasis?{targetNodeIds:[plan.id]}:{targetChangeIds:[changeIds[row.target]]}),ref:row.ref,quote:row.quote}});
  }
 }
 const addNode=(node,kind,explicitKind=false,path='$')=>{
  shape(node,['id','ref','quote','topic','aspect','temporalUse',...(explicitKind?['kind']:[])],['relation'],path);common(node);
  inputPaths.set(`$.nodes[${nodes.length}]`,path);
  nodes.push({...copy(node),kind});
 };
 for(const [index,node]of reports.entries())addNode(node,'user_report',false,`$.reports[${index}]`);
 for(const [index,node]of suggestions.entries())addNode(node,'assistant_suggestion',false,`$.suggestions[${index}]`);
 for(const [index,node]of context.entries()){if(!contexts.has(node?.kind)&&!(named&&node?.kind==='user_instruction'))fail('continuity_v5_context_kind');addNode(node,node.kind,true,`$.context[${index}]`);}
 const overflow=[];
 for(const [path,actualItems,maxItems,expected]of [
  ['$',nodes.length+retentions.length+withdrawals.length,limits.maxNodes,'bounded_nodes_including_generated_evidence'],
  ['$.plans',changes.length,limits.maxPlanChanges,'bounded_total_ordered_changes'],
  ['$.plans',withdrawals.length,limits.maxReasonRelations,'bounded_total_reason_withdrawals'],
  ['$.plans',retentions.length,limits.maxRetentions,'bounded_total_retentions'],
  ...(named?[['$.plans',reasonBindings.length,limits.maxNodes,'bounded_total_named_reasons']]:[])
 ])if(actualItems>maxItems)overflow.push({path,reason:'compiled_max_items_exceeded',expected,maxItems,actualItems,phase:'compiled'});
 if(overflow.length)fail('continuity_proposal_limit',overflow);
 const v4={version:4,nodes,unknowns,...(changes.length?{planChanges:changes}:{}),...(retentions.length?{retentions}:{})};
 // v4 的精確 edits 守護保持；更正位置回映宿主原先提交的 v5 路徑。
 const mapPath=path=>{
  if(typeof path!=='string')return path;
  for(const [compiledPath,inputPath]of inputPaths)if(path===compiledPath||path.startsWith(compiledPath+'.')||path.startsWith(compiledPath+'['))
   return inputPath+path.slice(compiledPath.length);
  return path;
 };
 const mappedCorrection=(code,issues=[])=>correction(code,issues.map(issue=>{
  if(issue.phase==='input')issue={...issue,phase:'compiled'};
  if(issue.previousVersion)issue={...issue,previousVersion:{...issue.previousVersion,
   basisPath:mapPath(issue.previousVersion.basisPath),
   ...(issue.previousVersion.predecessorPath===undefined?{}:{predecessorPath:mapPath(issue.previousVersion.predecessorPath)})}};
  if(typeof issue.path!=='string')return issue;
  const mappedPath=mapPath(issue.path);
  if(mappedPath!==issue.path)return {...issue,path:mappedPath,compiledPath:issue.path,inputVersion};
  return {...issue,inputVersion};
 }));
 const compiled=compileCmcpContinuityProposal(v4,{limits,correction:mappedCorrection,inspectPreviousVersion,...(named?{boundReasonChangeIds}:{})});
 const proposal={...compiled.proposal,nodes:[...compiled.proposal.nodes,...withdrawals.map(row=>row.node)],
  ...(withdrawals.length?{reasonRelations:withdrawals.map(row=>row.relation)}:{}),...(named?{reasonBindings,
    ...(input.scopeResolutions===undefined?{}:{scopeResolutions:copy(list(input.scopeResolutions,8,'$.scopeResolutions'))}),
    ...(input.reportScopeResolutions===undefined?{}:{reportScopeResolutions:copy(list(input.reportScopeResolutions,limits.maxNodes,'$.reportScopeResolutions'))})}:{} )};
 generatedEvidenceNodeIds.push(...compiled.proof.generatedNodeIds);
 const finalOverflow=[];
 if(proposal.nodes.length>limits.maxNodes)finalOverflow.push({path:'$',reason:'compiled_max_items_exceeded',expected:'bounded_nodes_including_generated_evidence',maxItems:limits.maxNodes,actualItems:proposal.nodes.length,phase:'compiled'});
 if(bytes(proposal)>limits.maxProposalBytes)finalOverflow.push({path:'$',reason:'compiled_max_bytes_exceeded',expected:'bounded_proposal',maxBytes:limits.maxProposalBytes,actualBytes:bytes(proposal),phase:'compiled'});
 if(finalOverflow.length)fail('continuity_proposal_limit',finalOverflow);
 return {proposal,proof:{kind:'cmcp_continuity_compilation',version:CMCP_CONTINUITY_TYPED_COMPILER_VERSION,inputVersion,outputVersion:3,
  inputHash:loopHash(input),compiledProposalHash:loopHash(proposal),generatedChangeIds,generatedEvidenceNodeIds,planChangeBindings,
  orderAuthority:'orderedChanges_is_explicit_host_order_not_inferred_source_chronology',semanticVerification:'not_performed'}};
}
