import {locateCmcpSourceFragment,locateCmcpSourceSupport} from './cmcp-source-citations.js';
// Request-local reference encoding. Original text, roles, times and branches are unchanged.
const scalarFields = new Set(['nodeId']);
const listFields = new Set(['nodeIds', 'relatedNodeIds', 'targetNodeIds', 'selectedNodeIds']);
function rewrite(value, mapping, key = '') {
  if (Array.isArray(value)) return listFields.has(key) ? value.map(id => lookup(mapping, id)) : value.map(item => rewrite(item, mapping));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, rewrite(item, mapping, name)]));
  return scalarFields.has(key) ? lookup(mapping, value) : value;
}
function lookup(mapping, value) {
  if (typeof value !== 'string' || !Object.hasOwn(mapping, value)) throw Error('semantic_node_alias_out_of_scope');
  return mapping[value];
}
export function encodeCmcpSemanticNodeAliases(input) {
  const ids = input.scope?.nodeIds;
  if (ids === undefined) return { input: structuredClone(input), nodeAliases: {} };
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id)) throw Error('invalid_semantic_node_scope');
  const encode = Object.fromEntries(ids.map((id, index) => [id, 'n' + (index + 1)]));
  const nodeAliases = Object.fromEntries(Object.entries(encode).map(([id, alias]) => [alias, id]));
  return { input: rewrite(input, encode), nodeAliases };
}
/** Exact inverse for evidence comparison; this does not select nodes or resolve History. */
export function expandCmcpSemanticNodeAliases(input, nodeAliases) { return rewrite(input, nodeAliases); }
function joinExactParts(parts, sourceText) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 8 || parts.some(part => typeof part !== 'string' || !part)
    || typeof sourceText !== 'string') throw Error('invalid_semantic_quote_parts');
  const quote = parts.join(''), points = [...sourceText], needle = [...quote];
  let matches = 0;
  for (let i = 0; i <= points.length - needle.length; i++) {
    if (needle.every((point, j) => point === points[i + j]) && ++matches > 1) break;
  }
  if (matches !== 1) throw Error('semantic_quote_parts_not_unique_or_contiguous');
  return quote;
}
/** Only declared aliases and literal, already supplied quote pieces are mapped. No semantic repair. */
export function decodeCmcpSemanticWire(value, mapping) {
  const result = structuredClone(value), proposal = result.proposal;
  if([5,6,7].includes(result.eventReview?.version)){
    const version=result.eventReview.version;
    if(mapping?.reviewMapping!==({5:'independent_fragment_refs_v5_to_v3',6:'exact_context_fragments_v6_to_v3',7:'shared_dialogue_fragment_v7_to_v3'})[version])throw Error('semantic_review_mapping_required');
    const fragment=segment=>version===5?{text:segment.quote,anchor:segment.anchor}:{text:segment.quote,...(Object.hasOwn(segment,'withinQuote')?{withinQuote:segment.withinQuote}:{})};
    const review=result.eventReview,segments=review.segments,proposals=proposal?.status==='proposed'?proposal.proposals:[];
    const refs=segments.map((_,i)=>'r'+(i+1));
    const independentDialogue=version===7&&mapping.fixedDialogueMapping==='independent_source_support_v1';
    const fixed=independentDialogue?mapping.fixedTurnIntent?.dialogue:null;
    if(independentDialogue&&(!fixed||!['open','closed','unknown'].includes(fixed.status)))throw Error('fixed_dialogue_mapping_required');
    const current=fixed?.supports?.filter(row=>row.ref==='input')??[];
    if(fixed&&fixed.status!=='unknown'&&current.length!==1)throw Error('fixed_turn_intent_current_support_required');
    const fixedLocation=current.length===1?locateCmcpSourceFragment(mapping.sourceText,current[0].quote):null;
    for(const segment of segments){
      const located=locateCmcpSourceFragment(mapping.sourceText,fragment(segment));
      segment.targets=[];
      if(Object.hasOwn(segment,'fixedDialogueSupportRef')){
        if(!independentDialogue||fixed.status==='unknown'||segment.fixedDialogueSupportRef!=='t1'||!fixedLocation)throw Error('fixed_dialogue_review_ref_invalid');
        if(located.start<fixedLocation.start||located.end>fixedLocation.end)throw Error('fixed_dialogue_review_source_mismatch');
        // Only the model's explicit association adds this target. Mere overlap
        // with a fixed quotation never processes facts or remaining conditions.
        segment.targets.push('dialogue');delete segment.fixedDialogueSupportRef;
      }
    }
    for(const [index,item] of proposals.entries()){
      const declared=item.supportRefs;
      if(!Array.isArray(declared)||!declared.length||new Set(declared).size!==declared.length
        ||declared.some(ref=>!refs.includes(ref)))throw Error('semantic_review_support_refs_invalid');
      item.quote={parts:declared.map(ref=>{const segment=segments[refs.indexOf(ref)];segment.targets.push('p'+(index+1));
        return fragment(segment);})};
      locateCmcpSourceSupport(mapping.sourceText,item.quote);
      delete item.supportRefs;
    }
    let explicitNoChange=false;
    if(version===7&&proposal?.status==='no_event_change'&&Object.hasOwn(proposal,'supportRefs')){
      const declared=proposal.supportRefs,whole=locateCmcpSourceFragment(mapping.sourceText,proposal.quote);
      if(!Array.isArray(declared)||!declared.length||new Set(declared).size!==declared.length||declared.some(ref=>!refs.includes(ref)))throw Error('semantic_review_no_change_refs_invalid');
      for(const ref of declared){const segment=segments[refs.indexOf(ref)],located=locateCmcpSourceFragment(mapping.sourceText,fragment(segment));
        if(located.start<whole.start||located.end>whole.end)throw Error('semantic_review_no_change_source_mismatch');
        segment.targets.push('no_change');
      }
      delete proposal.supportRefs;explicitNoChange=true;
    }
    if(version===7){
      if(independentDialogue){
        if(Object.hasOwn(result,'dialogue'))throw Error('fixed_dialogue_output_forbidden');
        result.dialogue=structuredClone(fixed);
      }else if(result.dialogue?.status!=='unknown'){
        const {status,synopsis,currentSupportRef,additionalSupports}=result.dialogue;
        if(!['open','closed'].includes(status)||!refs.includes(currentSupportRef)||!Array.isArray(additionalSupports))throw Error('semantic_review_dialogue_refs_invalid');
        const segment=segments[refs.indexOf(currentSupportRef)];
        // Explicit shared identity only; quotation overlap and synopsis infer nothing.
        segment.targets.push('dialogue');
        result.dialogue={status,synopsis,supports:[{ref:'input',quote:Object.hasOwn(segment,'withinQuote')?fragment(segment):segment.quote},...additionalSupports]};
      }
    }else{
      if(!Array.isArray(review.dialogueRefs)||new Set(review.dialogueRefs).size!==review.dialogueRefs.length
        ||review.dialogueRefs.some(ref=>!refs.includes(ref)))throw Error('semantic_review_dialogue_refs_invalid');
      for(const ref of review.dialogueRefs)segments[refs.indexOf(ref)].targets.push('dialogue');
    }
    result.eventReview={version:explicitNoChange?4:3,segments};
  }
  if(value.eventReview?.version===4){
    if(mapping?.reviewMapping!=='explicit_segment_refs_v4_to_v3')throw Error('semantic_review_mapping_required');
    const segments=result.eventReview.segments,proposals=proposal?.status==='proposed'?proposal.proposals:[];
    for(const segment of segments)joinExactParts([segment.quote],mapping.sourceText);
    for(const [index,item] of proposals.entries()){
      const ref='p'+(index+1),declared=item.supportRefs;
      if(!Array.isArray(declared)||!declared.length||new Set(declared).size!==declared.length)throw Error('semantic_review_support_refs_invalid');
      const expected=segments.flatMap((segment,i)=>segment.targets.includes(ref)?['r'+(i+1)]:[]);
      if(declared.length!==expected.length||declared.some(id=>!expected.includes(id)))throw Error('semantic_review_support_mapping_mismatch');
      item.quote=joinExactParts(declared.map(id=>segments[Number(id.slice(1))-1]?.quote),mapping.sourceText);
      delete item.supportRefs;
    }
    for(const segment of segments)if(segment.targets.some(ref=>ref!=='dialogue'&&!proposals[Number(ref.slice(1))-1]))throw Error('semantic_review_unknown_target');
    result.eventReview.version=3;
  }
  const mapIds = ids => mapping ? ids.map(id => lookup(mapping.nodeAliases, id)) : ids;
  if (proposal?.status === 'proposed') for (const item of proposal.proposals) {
    item.relation.targetNodeIds = mapIds(item.relation.targetNodeIds);
    if (item.quote && typeof item.quote === 'object' && typeof item.quote.parts?.[0]==='string') {
      item.quote = joinExactParts(item.quote.parts, mapping?.sourceText);
    }
  }
  if (proposal?.status === 'no_event_change') proposal.targetNodeIds = mapIds(proposal.targetNodeIds);
  return result;
}
