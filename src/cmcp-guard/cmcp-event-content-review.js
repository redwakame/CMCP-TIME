import { locateCmcpSourceFragment, locateCmcpSourceSupport, cmcpCitationFragments } from './cmcp-source-citations.js';
export const CMCP_MAX_SEMANTIC_PROPOSALS = 8;
export const CMCP_MAX_REVIEW_SEGMENTS = 16;
// Explicit source coverage, not a semantic classifier or a generator of event nodes.
export const EVENT_REVIEW_SCHEMA = Object.freeze({type:'object',additionalProperties:false,required:['version','segments'],properties:{
  version:{type:'integer',enum:[3]},segments:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,
    required:['quote','targets','processing'],properties:{quote:{type:'string',minLength:1},
      targets:{type:'array',maxItems:4,items:{type:'string',enum:['p1','p2','p3','dialogue']}},
      processing:{type:'string',enum:['handled','pending']}}}}}});
export const EVENT_REVIEW_INSTRUCTIONS = [
  'Return independent proposal and dialogue, with eventReview version=3 mapping source to outputs, not reclassifying. p1/p2/p3 refer to proposal.proposals entries; dialogue refers to supported discussion control. no_event_change is a proposal status, never a target.',
  'Each segment quotes exact NEW source text, names targets and processing=handled|pending. Cover all meaningful source text; punctuation/whitespace gaps are allowed. Quotes may overlap or group multiple propositions. No offsets or domain-specific segmentation template.',
  'handled declares ALL segment meaning represented by targets, including negation, conditions, uncertainty and control. Exact quotation overlap is not semantic proof. Target quotes must cover the segment; map every event proposal. Uninterpreted content remains pending, with empty targets when unclear.',
  'Reports, intentions and questions map to pN; discussion control maps to dialogue; mixed segments name both. A synopsis never substitutes for a factual update. no_event_change permits pure resumption/stopping only, without manufactured facts. Unknown dialogue and unresolved event content remain pending independently, even after a valid stop; valid facts can commit while dialogue remains pending.'
].join('\n');
// v7 retains one-way support associations. Unique quotes need no location hint;
// repeated quotes can carry an exact unique enclosing quote, never an offset.
const wireSegment=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const segmentFields={quote:{type:'string',minLength:1},processing:{type:'string',enum:['handled','pending']}};
export const EVENT_REVIEW_WIRE_SCHEMA = Object.freeze({type:'object',additionalProperties:false,required:['version','segments'],properties:{
  version:{type:'integer',enum:[7]},segments:{type:'array',minItems:1,maxItems:CMCP_MAX_REVIEW_SEGMENTS,items:{anyOf:[
    wireSegment(segmentFields),wireSegment({...segmentFields,withinQuote:{type:'string',minLength:1}})]}}}});
export const EVENT_REVIEW_WIRE_INSTRUCTIONS = [
  'eventReview version=7 is one exact source quote table: segments[0]=r1, segments[1]=r2, etc. Each proposal supportRefs selects its rN supports. For open/closed dialogue, currentSupportRef selects one rN supporting discussion control; Runtime derives both its exact input quotation and review association. Do not repeat dialogueRefs or target IDs. additionalSupports are context only, not extra handled segments. Mixed fact/control content still requires the appropriate proposal supportRefs; dialogue never substitutes for a factual update or an omitted condition.',
  'Each segment has quote and processing. Runtime locates a unique exact quote; do not output anchors or offsets. Only when the quote repeats, optionally add withinQuote: an exact, globally unique enclosing original excerpt containing that quote exactly once. Runtime computes its position. Missing or ambiguous locations remain rejected; no fuzzy matching. withinQuote is locator context, not extra claimed support.',
  'Multiple supportRefs select independently exact source fragments, including noncontiguous ones. Runtime orders their locations; reference order has no concatenation meaning. They remain separate quotations, never a joined statement. Include object qualifiers, negation, conditions and uncertainty. Do not discard a condition because the main clause can be quoted separately.',
  'Cover meaningful NEW source text. handled declares all segment meaning represented by its proposal or dialogue associations; this is not semantic proof. Content not yet represented stays pending with no invented proposal. Distinct source meanings may have distinct proposals within maxProposals. Unknown dialogue stays pending independently; a valid stop does not erase unresolved event facts.',
  'no_event_change is a proposal disposition for genuinely no new event information, not a source ref or an Event node. Supply its existing object/targetNodeIds, exact current quote, and supportRefs explicitly naming the rN fragments interpreted as no event update. Runtime derives a separate no_change review association only from those declared refs; it never infers it from quotation overlap. This can be handled independently of unknown or unchanged dialogue. Do not force every source into a new fact or every source into dialogue. New facts, negation, conditions or unresolved meaning must not be hidden by a no-change disposition; leave unprocessed fragments pending. A synopsis does not supply missing evidence.'
].join('\n');
function locate(text,quote){
  const range=quote?.parts?locateCmcpSourceSupport(text,quote):locateCmcpSourceFragment(text,quote);
  return {start:range.start,end:range.end};
}
function validateLegacyReview(review,proposal,source){
  if(!review || Object.keys(review).sort().join(',')!=='segments,status' || !['complete','pending'].includes(review.status)
    || !Array.isArray(review.segments)||!review.segments.length||review.segments.length>CMCP_MAX_REVIEW_SEGMENTS) throw Error('event_review_required');
  const covered=new Set(),segments=review.segments.map(segment=>{
    if(!segment||Object.keys(segment).sort().join(',')!=='kind,quote'||!['event_information','dialogue_control','uncertain'].includes(segment.kind))throw Error('invalid_event_review_segment');
    const span=locate(source.content.body,segment.quote);
    for(let i=span.start;i<span.end;i++){if(covered.has(i))throw Error('event_review_overlap'); covered.add(i);}
    return {...segment,...span};
  });
  if([...source.content.body].some((point,index)=>!covered.has(index)&&!/[\p{P}\p{Z}\s]/u.test(point)))throw Error('event_review_source_gap');
  if(review.status!=='complete'||segments.some(segment=>segment.kind==='uncertain'))throw Error('event_review_pending');
  const information=segments.filter(segment=>segment.kind==='event_information');
  if(proposal?.status==='no_event_change'){
    if(information.length)throw Error('event_information_without_update');
  }else if(proposal?.status==='proposed'){
    const proposals=proposal.proposals.map(item=>({...item,...locate(source.content.body,item.quote)}));
    if(information.some(segment=>!proposals.some(item=>item.start<=segment.start&&item.end>=segment.end)))throw Error('event_information_without_update');
    if(proposals.some(item=>item.kind==='user_report'&&!information.some(segment=>item.start<=segment.start&&item.end>=segment.end)))throw Error('report_from_dialogue_control');
  }else throw Error('event_interpretation_pending');
  return {status:'complete',sourceCoverage:'all_non_separator_characters',semanticVerification:'not_performed',segments};
}

const separator = point => /[\p{P}\p{Z}\s]/u.test(point);
/** Source alignment and explicit handling declarations cannot certify semantic truth. */
export function validateEventContentReview(review,proposal,source,dialogue) {
  // Legacy callers/replays remain conservative; never infer a v2 map from old text or overlap.
  if(![2,3,4].includes(review?.version)) return validateLegacyReview(review,proposal,source);
  if(Object.keys(review).sort().join(',')!=='segments,version'||!Array.isArray(review.segments)
    ||!review.segments.length||review.segments.length>CMCP_MAX_REVIEW_SEGMENTS)throw Error('event_review_required');
  const text=source.content.body, points=[...text], targets=new Map();
  if(proposal?.status==='proposed')proposal.proposals.forEach((item,index)=>targets.set('p'+(index+1),cmcpCitationFragments(locateCmcpSourceSupport(text,item.quote))));
  else if(proposal?.status==='no_event_change'){
    const span=locate(text,proposal.quote);
    if(review.version===2)targets.set('no_event_change',[span]);
    if(review.version===4)targets.set('no_change',[span]);
  }
  const current=dialogue?.supports?.filter(item=>item.ref==='input')??[];
  if(dialogue && ['open','closed'].includes(dialogue.status))targets.set('dialogue',current.map(item=>locate(text,item.quote)));
  const covered=new Set(),handled=new Set();
  const segments=review.segments.map(segment=>{
    if(!segment||!['processing,quote,targets','anchor,processing,quote,targets','processing,quote,targets,withinQuote'].includes(Object.keys(segment).sort().join(','))
      ||!['handled','pending'].includes(segment.processing)||!Array.isArray(segment.targets)||segment.targets.length>CMCP_MAX_SEMANTIC_PROPOSALS+1
      ||new Set(segment.targets).size!==segment.targets.length
      ||segment.targets.some(ref=>![...Array.from({length:CMCP_MAX_SEMANTIC_PROPOSALS},(_,i)=>'p'+(i+1)),'dialogue',...(review.version===2?['no_event_change']:review.version===4?['no_change']:[])].includes(ref)))throw Error('invalid_event_review_segment');
    const span=locateCmcpSourceFragment(text,Object.hasOwn(segment,'withinQuote')?{text:segment.quote,withinQuote:segment.withinQuote}:Object.hasOwn(segment,'anchor')?{text:segment.quote,anchor:segment.anchor}:segment.quote);
    for(let i=span.start;i<span.end;i++)covered.add(i);
    const anchors=[];
    for(const ref of segment.targets){
      if(!targets.has(ref)){
        if(ref==='dialogue'&&dialogue?.status==='unknown'&&segment.processing==='pending')continue;
        throw Error('event_review_unknown_target');
      }
      const matches=targets.get(ref).filter(anchor=>anchor.start<=span.start&&anchor.end>=span.end
        ||span.start<=anchor.start&&span.end>=anchor.end);
      if(!matches.length)throw Error('event_review_target_source_mismatch');
      anchors.push(...matches);
    }
    if(segment.processing==='handled'){
      if(!segment.targets.length)throw Error('event_review_handled_without_target');
      for(let i=span.start;i<span.end;i++)if(!separator(points[i])&&!anchors.some(anchor=>anchor.start<=i&&anchor.end>i))throw Error('event_review_unaccounted_source');
      segment.targets.forEach(ref=>handled.add(ref));
    }
    return {...segment,...span};
  });
  if(points.some((point,index)=>!separator(point)&&!covered.has(index)))throw Error('event_review_source_gap');
  const remaining=segments.filter(segment=>segment.processing==='pending');
  const eventRefs=[...targets.keys()].filter(ref=>ref!=='dialogue');
  const eventReady=(eventRefs.length>0&&eventRefs.every(ref=>handled.has(ref))
    ||review.version===3&&proposal?.status==='no_event_change'&&handled.has('dialogue'))
    &&!remaining.some(segment=>segment.targets.length!==1||segment.targets[0]!=='dialogue');
  const dialogueReady=targets.has('dialogue')&&handled.has('dialogue')
    &&!remaining.some(segment=>segment.targets.includes('dialogue')||!segment.targets.length);
  return {version:review.version,status:eventReady&&dialogueReady&&!remaining.length?'complete':'pending',eventReady,dialogueReady,
    sourceAlignment:'exact_fragments_and_explicit_associations',processingEvidence:'model_declared_not_semantically_certified',
    semanticVerification:'not_performed',remaining,segments};
}
