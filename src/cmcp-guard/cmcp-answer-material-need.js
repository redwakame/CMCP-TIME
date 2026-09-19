import {locateCmcpSourceFragment} from './cmcp-source-citations.js';

// Pure contract shared by the initial purpose stage and the existing exact reader.
// No Runtime, History catalog, transport or protocol imports belong here.
export const CMCP_ANSWER_NO_READ_NEEDS=Object.freeze(['current_input_sufficient','event_context_sufficient','history_excluded']);
export const CMCP_ANSWER_READ_NEEDS=Object.freeze(['prior_content_reference','recorded_fact_lookup','unclear_reference']);
export function validateCmcpAnswerHistoryNeedShape(plan){
  const need=plan.need;if(!need||Object.keys(need).sort().join(',')!=='basis,quote'
    ||![...CMCP_ANSWER_NO_READ_NEEDS,...CMCP_ANSWER_READ_NEEDS].includes(need.basis))throw Error('invalid_answer_history_need');
  if(plan.status==='none'?!CMCP_ANSWER_NO_READ_NEEDS.includes(need.basis):!CMCP_ANSWER_READ_NEEDS.includes(need.basis)
    ||need.basis==='unclear_reference'&&plan.status!=='needs_clarification')throw Error('answer_history_need_status_conflict');
  if(typeof need.quote!=='string'&&(!need.quote||Object.keys(need.quote).sort().join(',')!=='text,withinQuote'
    ||typeof need.quote.text!=='string'||!need.quote.text||typeof need.quote.withinQuote!=='string'||!need.quote.withinQuote))throw Error('invalid_answer_history_need_quote');
  if(need.quote===''&&need.basis!=='current_input_sufficient'&&need.basis!=='event_context_sufficient')throw Error('answer_history_need_quote_required');
  return need;
}
/** Explicit model choice, not language matching or post-generation correction. */
export function cmcpAnswerHistoryMaterialScope(plan){
  if(!Object.hasOwn(plan??{},'need'))return null;
  return ['current_input_sufficient','history_excluded'].includes(validateCmcpAnswerHistoryNeedShape(plan).basis)?'current_question_only':'as_needed';
}
export function validateCmcpAnswerHistoryNeed(plan,sourceText){
  if(!Object.hasOwn(plan??{},'need'))return null;
  const need=validateCmcpAnswerHistoryNeedShape(plan);if(typeof sourceText!=='string')throw Error('answer_history_current_need_source_required');
  const citation=need.quote===''?null:locateCmcpSourceFragment(sourceText,need.quote);
  return {basis:need.basis,materials:cmcpAnswerHistoryMaterialScope(plan),citation,
    verification:'exact_current_User_quote_not_semantic_truth_certification'};
}
