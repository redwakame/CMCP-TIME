import {loopHash} from './cmcp-local-loop-journal.js';

export const CMCP_CONTINUITY_COMPILER_VERSION=1;
export const CMCP_CONTINUITY_COMPILER_PREFIX='__cmcp_v4_';
const copy=value=>structuredClone(value),size=value=>Buffer.byteLength(JSON.stringify(value));

// 只回傳固定 schema 名稱、位置與數量，不回顯正文、來源或未知欄位內容。
export function createCmcpContinuityProposalChecks(fail,version){
 const type=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
 const shape=(value,required,optional=[],path='$')=>{
  const object=value!==null&&typeof value==='object'&&!Array.isArray(value);
  const missingFields=object?required.filter(key=>!Object.hasOwn(value,key)):[...required];
  const unexpectedFieldCount=object?Object.keys(value).filter(key=>![...required,...optional].includes(key)).length:0;
  if(!object||missingFields.length||unexpectedFieldCount)fail(`continuity_v${version}_shape`,[{path,
   reason:!object?'expected_object':'object_fields_mismatch',expected:'object_with_required_and_allowed_fields',actualType:type(value),
   requiredFields:[...required],optionalFields:[...optional],missingFields,unexpectedFieldCount}]);
 };
 const list=(value,max,path='$')=>{
  if(!Array.isArray(value)||value.length>max)fail(`continuity_v${version}_limit`,[{path,
   reason:!Array.isArray(value)?'expected_array':'max_items_exceeded',expected:'array',actualType:type(value),maxItems:max,
   ...(Array.isArray(value)?{actualItems:value.length}:{})}]);
  return value;
 };
 return {shape,list};
}

/** v4 只省略機械重複；原句種類、目標、修改與理由關係仍由宿主明示。
 * 輸出必須再走完整 v3 來源、角色、範圍與 publication 驗證，不能直接保存。
 */
export function compileCmcpContinuityProposal(input,{limits,correction=(code)=>new TypeError(code),boundReasonChangeIds=new Set(),inspectPreviousVersion}={}){
 const fail=(code,issues=[])=>{throw correction(code,issues);};
 const {shape,list}=createCmcpContinuityProposalChecks(fail,4);
 const string=(value,max=80)=>{if(typeof value!=='string'||!value.trim()||[...value].length>max)fail('continuity_v4_value');return value;};
 if(!limits||input?.version!==4)fail('continuity_v4_version');
 shape(input,['version','nodes','unknowns'],['planChanges','retentions','reasonRelations']);
 if(size(input)>limits.maxProposalBytes)fail('continuity_proposal_limit',[{path:'$',reason:'max_bytes_exceeded',expected:'bounded_proposal',maxBytes:limits.maxProposalBytes,actualBytes:size(input),phase:'input'}]);
 list(input.nodes,limits.maxNodes,'$.nodes');list(input.unknowns,limits.maxUnknowns,'$.unknowns');
 const changes=list(input.planChanges===undefined?[]:input.planChanges,limits.maxPlanChanges,'$.planChanges'),retentions=list(input.retentions===undefined?[]:input.retentions,limits.maxRetentions,'$.retentions'),relations=list(input.reasonRelations===undefined?[]:input.reasonRelations,limits.maxReasonRelations,'$.reasonRelations');
 const ids=new Set(),reserve=id=>{string(id);if(id.startsWith(CMCP_CONTINUITY_COMPILER_PREFIX)||ids.has(id))fail('continuity_v4_id_collision');ids.add(id);return id;};
 const nodes=input.nodes.map((node,index)=>{
  shape(node,['id','ref','quote','kind','temporalUse','topic','aspect'],['text','relation','reason','planStatus','planRole'],`$.nodes[${index}]`);reserve(node.id);
  string(node.topic,128);string(node.aspect,128);string(node.quote,limits.maxQuoteCodePoints);
  if(node.planRole!==undefined&&(node.kind!=='user_intent'||node.planRole!=='basis'))fail('continuity_v4_basis_role_required');
  if(node.kind!=='user_intent'&&node.planStatus!==undefined)fail('continuity_v4_non_intent_plan_status');
  return {...copy(node),text:node.text===undefined?node.quote:node.text,relation:copy(node.relation===undefined?{kind:'independent',targetNodeIds:[]}:node.relation),...(node.kind==='user_intent'?{planRole:'basis'}:{})};
 });
 const byNode=new Map(nodes.map(node=>[node.id,node])),nodeIndexes=new Map(nodes.map((node,index)=>[node.id,index])),byChange=new Map(),changeIndexes=new Map();
 for(const [index,change]of changes.entries()){
  shape(change,['id','targetNodeId','afterChangeId','kind','ref','quote'],['reason',...(change?.kind==='content'?['edits']:change?.kind==='status'?['planStatus']:[])],`$.planChanges[${index}]`);
  reserve(change.id);string(change.targetNodeId);string(change.quote,limits.maxQuoteCodePoints);
  if(!['content','status','reason'].includes(change.kind))fail('continuity_v4_change_kind');
  if(change.kind==='reason'&&change.reason===undefined&&!boundReasonChangeIds.has(change.id))fail('continuity_plan_change_reason_required');
  if(change.afterChangeId!==null)string(change.afterChangeId);
  if(byNode.get(change.targetNodeId)?.kind!=='user_intent')fail('continuity_v4_change_target');
  byChange.set(change.id,change);changeIndexes.set(change.id,index);
 }
 const visiting=new Set(),resolved=new Map(),compiledChanges=new Map(),prefixes=new Map();
 function resolve(id){
  if(resolved.has(id))return resolved.get(id);
  if(visiting.has(id))fail('continuity_plan_change_cycle');
  const change=byChange.get(id);if(!change)fail('continuity_plan_change_predecessor_missing');visiting.add(id);
  const predecessor=change.afterChangeId===null?null:byChange.get(change.afterChangeId);
  if(change.afterChangeId!==null&&(!predecessor||predecessor.targetNodeId!==change.targetNodeId))fail('continuity_plan_change_predecessor_target');
  const before=predecessor?resolve(predecessor.id):byNode.get(change.targetNodeId).quote;
  let after=before,compiled={...copy(change)};
  if(change.kind==='content'){
   const changePath=`$.planChanges[${changeIndexes.get(change.id)}]`;
   const edits=list(change.edits,limits.maxPlanParts,`${changePath}.edits`);if(!edits.length)fail('continuity_v4_empty_edit');
   const positions=edits.map((edit,index)=>{
    const editPath=`${changePath}.edits[${index}]`;
    shape(edit,['quote','kind'],edit?.kind==='replace'?['replacement']:[],editPath);string(edit.quote,limits.maxQuoteCodePoints);
    if(!['replace','withdraw'].includes(edit.kind))fail('continuity_v4_edit_kind');
    const first=before.indexOf(edit.quote);
    if(first<0||before.indexOf(edit.quote,first+1)>=0){
     // 編譯器本身不回顯輸入；只有正式 reader 提供的查證函式可附來源已核的前版。
     const preview=inspectPreviousVersion?.({basis:copy(byNode.get(change.targetNodeId)),
      changes:copy(predecessor?prefixes.get(predecessor.id):[]),before});
     fail(first<0?'continuity_v4_edit_quote_absent':'continuity_v4_edit_quote_not_unique',
     [{path:editPath,changeId:change.id,targetNodeId:change.targetNodeId,editIndex:index,
      reason:first<0?'old_fragment_absent':'old_fragment_ambiguous',expected:'quote_one_unique_exact_fragment_from_the_explicit_previous_version',
      previousVersion:{kind:predecessor?'explicit_predecessor_result':'submitted_plan_basis',
       basisPath:`$.nodes[${nodeIndexes.get(change.targetNodeId)}].quote`,afterChangeId:change.afterChangeId,
       ...(predecessor?{predecessorPath:`$.planChanges[${changeIndexes.get(predecessor.id)}]`}:{}),
       ...(preview?{preview}:{})},
      recovery:'check_submitted_basis_and_explicit_predecessor_scope;_do_not_expand_or_fuzzily_match_the_old_fragment'}]);
    }
    if(edit.kind==='replace'){shape(edit.replacement,['ref','quote'],[],`${editPath}.replacement`);string(edit.replacement.quote,limits.maxQuoteCodePoints);}
    const start=[...before.slice(0,first)].length;return{edit,index,start,end:start+[...edit.quote].length};
   }).sort((a,b)=>a.start-b.start);
   const chars=[...before],parts=[];let cursor=0;
   for(const {edit,index,start,end}of positions){
    if(start<cursor)fail('continuity_v4_edit_overlap',[{changeId:change.id,targetNodeId:change.targetNodeId,editIndex:index,reason:'overlapping_old_fragments',expected:'non_overlapping_unique_fragments'}]);
    if(start>cursor)parts.push({kind:'keep',quote:chars.slice(cursor,start).join('')});
    parts.push(copy(edit));cursor=end;
   }
   if(cursor<chars.length)parts.push({kind:'keep',quote:chars.slice(cursor).join('')});
   if(parts.length>limits.maxPlanParts)fail('continuity_plan_change_parts',[{path:`${changePath}.edits`,reason:'compiled_parts_max_items_exceeded',expected:'bounded_exact_keep_replace_withdraw_parts',maxItems:limits.maxPlanParts,actualItems:parts.length,phase:'compiled'}]);
   delete compiled.edits;compiled.parts=parts;
   after=parts.map(part=>part.kind==='keep'?part.quote:part.kind==='replace'?part.replacement.quote:'').join('');
  }
  compiledChanges.set(id,compiled);prefixes.set(id,[...(predecessor?prefixes.get(predecessor.id):[]),compiled]);
  resolved.set(id,after);visiting.delete(id);return after;
 }
 for(const change of changes)resolve(change.id);
 const generatedNodeIds=[];
 function evidence(row,index,type){
  const rowPath=`$.${type==='retention'?'retentions':'reasonRelations'}[${index}]`;
  const allowed=type==='retention'?[]:['kind'];shape(row,['targetNodeIds','evidence',...allowed],[],rowPath);
  const targets=list(row.targetNodeIds,limits.maxRelationTargets,`${rowPath}.targetNodeIds`);if(!targets.length||new Set(targets).size!==targets.length)fail('continuity_v4_targets');
  const targetNodes=targets.map(id=>byNode.get(id));if(targetNodes.some(node=>!node)||new Set(targetNodes.map(node=>node.topic)).size!==1)fail('continuity_v4_target_topic');
  const e=row.evidence;shape(e,['kind','ref','quote','temporalUse','aspect'],['reason'],`${rowPath}.evidence`);
  if(!['user_intent','user_report'].includes(e.kind))fail('continuity_v4_evidence_kind');
  if(type==='retention'&&(e.kind!=='user_intent'||targetNodes.some(node=>node.kind!=='user_intent')))fail('continuity_retention_requires_plan');
  string(e.quote,limits.maxQuoteCodePoints);string(e.aspect,128);
  const id=CMCP_CONTINUITY_COMPILER_PREFIX+type+'_'+index;if(ids.has(id))fail('continuity_v4_id_collision');ids.add(id);generatedNodeIds.push(id);
  const node={id,ref:e.ref,quote:e.quote,kind:e.kind,temporalUse:e.temporalUse,text:e.quote,topic:targetNodes[0].topic,aspect:e.aspect,
   relation:{kind:'related',targetNodeIds:[...targets]},...(e.reason===undefined?{}:{reason:copy(e.reason)}),...(e.kind==='user_intent'?{planRole:'evidence'}:{})};
  nodes.push(node);
  return {ref:e.ref,quote:e.quote,targetNodeIds:[...targets],...(type==='retention'?{byNodeId:id}:{kind:row.kind,fromNodeId:id})};
 }
 const compiled={version:3,nodes,unknowns:copy(input.unknowns),
  ...(input.planChanges===undefined?{}:{planChanges:changes.map(change=>compiledChanges.get(change.id))}),
  ...(input.retentions===undefined?{}:{retentions:retentions.map((row,index)=>evidence(row,index,'retention'))}),
  ...(input.reasonRelations===undefined?{}:{reasonRelations:relations.map((row,index)=>evidence(row,index,'reason'))})};
 const overflow=[];
 if(nodes.length>limits.maxNodes)overflow.push({path:'$.nodes',reason:'compiled_max_items_exceeded',expected:'bounded_nodes_including_generated_evidence',maxItems:limits.maxNodes,actualItems:nodes.length,phase:'compiled'});
 if(size(compiled)>limits.maxProposalBytes)overflow.push({path:'$',reason:'compiled_max_bytes_exceeded',expected:'bounded_proposal',maxBytes:limits.maxProposalBytes,actualBytes:size(compiled),phase:'compiled'});
 if(overflow.length)fail('continuity_proposal_limit',overflow);
 return {proposal:compiled,proof:{kind:'cmcp_continuity_compilation',version:CMCP_CONTINUITY_COMPILER_VERSION,inputVersion:4,outputVersion:3,
  inputHash:loopHash(input),compiledProposalHash:loopHash(compiled),generatedNodeIds}};
}
