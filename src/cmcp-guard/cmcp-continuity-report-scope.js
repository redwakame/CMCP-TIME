import {loopHash} from './cmcp-local-loop-journal.js';

const copy=structuredClone;
const range=citation=>({unit:citation.unit,start:citation.start,end:citation.end});
const contains=(outer,inner)=>outer.unit===inner.unit&&outer.start<=inner.start&&outer.end>=inner.end;
const sameRange=(a,b)=>a.unit===b.unit&&a.start===b.start&&a.end===b.end;
const containedReason='current_report_quote_contained_in_status_change_support';
const messageReason='current_report_quote_in_same_status_change_message';
const resolutionFields=['findingId','kind','reportRef','reportQuote'];
// 只說明目前 finding 的既有輸入契約；不替宿主決定原話用途或填入 resolution。
const resolutionContract=finding=>({
 expectedKind:finding.reason===messageReason?'reported_state_in_status_message':'reported_state_in_status_clause',
 allowedFields:resolutionFields,reportRef: finding.report.source.ref,
 reportRefMeaning:'formal_reading_source_ref_not_report_node_id',reportInputPath:finding.reportInputPath,
 quoteRule:finding.reason===messageReason?'exact_current_report_quote_and_range':'report_clause_inside_both_support_ranges',
 sourceUseDecision:'host_must_review_complete_original_before_declaring_report_use',autoResolved:false});
const shape=value=>value&&typeof value==='object'&&!Array.isArray(value)
 &&['findingId','kind','reportRef','reportQuote'].every(key=>Object.hasOwn(value,key))
 &&Object.keys(value).every(key=>['findingId','kind','reportRef','reportQuote'].includes(key));

// 優先保留原先的完整包含；沒有包含時才核對同一正式訊息的不同引文用途。
// 同訊息只代表待核對用途，不推同案、不依詞彙判定意圖或事實。
// 來源綁定的宿主解決仍是可修正的解釋，不證明語意正確或外部工作完成。
export function reviewCmcpReportScope({proposal,view,plans,support,sourceIdentity,limits,resolutions=[],correction,
 reportPath=()=>null,statusPath=()=>null}){
 const maxFindings=limits.maxNodes,findings=[],nodes=new Map(proposal.nodes.map(node=>[node.id,node]));
 if(!Number.isSafeInteger(maxFindings)||maxFindings<1||view.currentClaims.length>maxFindings
  ||plans.planChanges.length>limits.maxPlanChanges)throw Error('continuity_report_scope_limit');
 const source=row=>({ref:row.ref,sourceIdentity:sourceIdentity(row.ref),evidenceHash:row.evidenceHash,
  range:range(row.citation),sourceAuthorRole:row.sourceAuthorRole,messageRecordedAt:row.messageRecordedAt,eventOccurredAt:row.eventOccurredAt});
 for(const claim of view.currentClaims){
  const node=nodes.get(claim.nodeId);if(node?.kind!=='user_report'||node.temporalUse!=='current')continue;
  const report=support(node.ref,node.quote,limits.maxQuoteCodePoints),reportSource=source(report);
  if(report.sourceAuthorRole!=='user'||!reportSource.sourceIdentity)continue;
  const statusChanges=[];
  for(const change of plans.planChanges){
   if(change.kind!=='status')continue;
   const statusSource=source(change.source);
   if(statusSource.sourceAuthorRole!=='user'||statusSource.sourceIdentity!==reportSource.sourceIdentity
    ||statusSource.evidenceHash!==reportSource.evidenceHash||!contains(statusSource.range,reportSource.range))continue;
   statusChanges.push({changeId:change.id,nodeId:change.targetNodeId,priorVersion:change.priorVersion,
    planVersion:change.planVersion,planStatus:change.planStatus,source:statusSource});
  }
  let reason=containedReason;
  if(!statusChanges.length){
   reason=messageReason;
   for(const change of plans.planChanges){
    if(change.kind!=='status')continue;
    const statusSource=source(change.source);
    if(statusSource.sourceAuthorRole!=='user'||statusSource.sourceIdentity!==reportSource.sourceIdentity
     ||statusSource.evidenceHash!==reportSource.evidenceHash||statusSource.messageRecordedAt!==reportSource.messageRecordedAt
     ||statusSource.eventOccurredAt!==reportSource.eventOccurredAt||change.source.citation.text===report.citation.text)continue;
    statusChanges.push({changeId:change.id,nodeId:change.targetNodeId,priorVersion:change.priorVersion,
     planVersion:change.planVersion,planStatus:change.planStatus,source:statusSource});
   }
  }
  if(statusChanges.length){
   const binding={report:{nodeId:node.id,kind:node.kind,source:reportSource,
    interpretationHash:loopHash({id:node.id,kind:node.kind,topic:node.topic,aspect:node.aspect,temporalUse:node.temporalUse,quote:node.quote})},statusChanges};
   findings.push({findingId:loopHash(binding),...binding,
    reportInputPath:reportPath(node.id),statusInputPaths:statusChanges.map(change=>statusPath(change.changeId)),
    reason,resolutionStatus:'pending',
    requiredReview:reason===containedReason
     ?'recheck_whether_the_report_excerpt_is_a_reported_state_or_an_instruction_or_condition;_if_misclassified_correct_the_report_without_discarding_plan_conditions;_a_genuine_report_requires_an_exact_source_bound_report_clause'
     :'recheck_the_complete_formal_message_and_current_report_use;_same_message_does_not_prove_same_case_or_conflict;_correct_instructions_without_discarding_plans;_a_genuine_report_requires_the_exact_current_report_reference_quote_and_range',
    semanticVerification:'not_performed',executionAuthority:'none'});
   findings.at(-1).requiredResolutionKind=reason===messageReason?'reported_state_in_status_message':'reported_state_in_status_clause';
  }
 }
 if(!Array.isArray(resolutions)||resolutions.length>maxFindings)throw Error('continuity_report_scope_resolution_limit');
 const byId=new Map(findings.map(f=>[f.findingId,f])),seen=new Set(),resolved=[];
 for(const [index,row]of resolutions.entries()){
  const path=`$.reportScopeResolutions[${index}]`,finding=byId.get(row?.findingId);
  const expectedKind=finding?.reason===messageReason?'reported_state_in_status_message':'reported_state_in_status_clause';
  if(!shape(row)||row.kind!==expectedKind||!finding||seen.has(row.findingId))
   throw correction('continuity_report_scope_resolution_binding',[{path,
    reason:!shape(row)?'resolution_fields_invalid':!finding?'finding_not_in_current_proposal':seen.has(row.findingId)?'duplicate_finding':'resolution_kind_does_not_match_finding_reason',
    ...(finding?{findingId:finding.findingId,resolutionContract:resolutionContract(finding)}:{currentFindingIds:findings.map(f=>f.findingId)}),
    expected:'review_current_finding_and_use_only_its_declared_fields;_reportRef_is_the_formal_source_ref_not_the_report_id;_no_automatic_acceptance'}]);
  const matched=support(row.reportRef,row.reportQuote,limits.maxQuoteCodePoints),bound=source(matched);
  const exactMessageReport=row.kind==='reported_state_in_status_message';
  const rangeValid=exactMessageReport
   ?row.reportRef===finding.report.source.ref&&row.reportQuote===nodes.get(finding.report.nodeId)?.quote
    &&sameRange(finding.report.source.range,bound.range)
    &&finding.statusChanges.every(change=>change.source.sourceAuthorRole==='user'
     &&change.source.sourceIdentity===bound.sourceIdentity&&change.source.evidenceHash===bound.evidenceHash
     &&change.source.messageRecordedAt===bound.messageRecordedAt&&change.source.eventOccurredAt===bound.eventOccurredAt)
   :contains(finding.report.source.range,bound.range)&&finding.statusChanges.every(change=>contains(change.source.range,bound.range));
  if(bound.sourceAuthorRole!=='user'||bound.sourceIdentity!==finding.report.source.sourceIdentity
   ||bound.evidenceHash!==finding.report.source.evidenceHash||!rangeValid)
   throw correction('continuity_report_scope_resolution_source',[{path,findingId:row.findingId,
    reason:exactMessageReport?'report_message_requires_the_exact_current_report_reference_quote_and_range_in_the_same_formal_source_revision'
     :'report_clause_requires_the_same_formal_source_revision_and_a_range_inside_both_original_supports',
    expected:'cite_the_explicit_report_clause_of_this_finding;_do_not_substitute_a_different_source_or_reclassify_a_condition_to_pass'}]);
  seen.add(row.findingId);
  resolved.push({findingId:row.findingId,kind:row.kind,reportClause:{...bound,quote:matched.citation.text},
   authority:'source_bound_host_declared_report_use_not_semantic_verification',semanticVerification:'not_performed',executionAuthority:'none'});
 }
 const totalFindings=findings.length,unresolvedFindings=totalFindings-resolved.length;
 return {kind:'cmcp_report_scope_review',version:1,status:unresolvedFindings?'required':resolved.length?'addressed_by_source_bound_host_resolution':'no_overlap_detected',
  authority:findings.some(f=>f.reason===messageReason)?'formal_source_message_and_range_use_not_semantic_classification':'formal_source_range_overlap_not_semantic_classification',scope:'proposed_current_user_reports_and_status_changes_only',
  maxFindings,totalFindings,unresolvedFindings,truncated:false,
  findings:findings.map(f=>({...copy(f),resolutionStatus:seen.has(f.findingId)?'source_bound_host_declaration':'pending'})),resolutions:resolved,
  sourceBindingVerification:'validated',semanticVerification:'not_performed',completeness:'not_established',executionAuthority:'none'};
}
