import {locateCmcpSourceFragment} from './cmcp-source-citations.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {loopHash} from './cmcp-local-loop-journal.js';

const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const choice=values=>({type:'string',enum:values});
const quote={anyOf:[{type:'string',minLength:1},obj({text:{type:'string',minLength:1},withinQuote:{type:'string',minLength:1}})]};
export const CMCP_DIALOGUE_CONTROL_INTENT_SCHEMA=obj({
  materials:choice(['as_needed','current_question_only']),
  dialogueAction:{anyOf:[
    obj({action:choice(['none','uncertain']),target:choice(['none']),supports:{type:'array',maxItems:0,items:obj({ref:choice(['input']),quote})}}),
    obj({action:choice(['continue','stop','complete']),target:choice(['selected_event']),supports:{type:'array',minItems:1,maxItems:2,items:obj({ref:choice(['input']),quote})}})
  ]}
});
export const CMCP_DIALOGUE_CONTROL_INTENT_INSTRUCTIONS=[
  'controlIntent separates the material allowed for THIS answer from a User-supported action on the selected discussion. materials=current_question_only means this question needs no historical material. It is not a command to stop, complete, erase, or pause the earlier discussion.',
  'dialogueAction=none means this source contains no action on the selected ongoing discussion; use dialogue.status=unknown and preserve prior state. uncertain also preserves prior state while leaving interpretation unresolved. Temporary topic changes, silence and Assistant follow-up do not themselves open or close a User-supported discussion.',
  'Only select target=selected_event when the new User source supports that exact discussion target. continue means genuinely continuing or establishing an unfinished joint discussion; no special phrase is needed. stop means a User instruction to stop follow-up; complete means an explicit conclusion of this discussion. Continue requires dialogue=open; stop/complete require dialogue=closed. Finishing an external task alone need not close discussion.',
  'Targeted actions require supports with ref=input and exact new User quotations. Runtime locates Unicode positions and validates current source identity; quote matching does not prove semantic interpretation. Scope uncertainty must remain uncertain, not a guessed nearest event. Do not use a historical source, synopsis, material restriction, or reason text as control authorization.'
].join('\n');

// Version 2 is a wire-only representation of the same canonical control contract.
// The action and dialogue state share one discriminated branch and one declared
// current-source support. No status, target, quote or semantic choice is repaired.
export function bindCmcpDialogueControlWire(schema){
  const known=schema.properties.dialogue.anyOf.find(branch=>branch.properties.status.enum.includes('open'));
  const unknown=schema.properties.dialogue.anyOf.find(branch=>branch.properties.status.enum.includes('unknown'));
  if(!known||!unknown)throw Error('dialogue_control_binding_schema_required');
  const branch=(base,status,actions,target)=>{
    const result=structuredClone(base);result.properties.status=choice([status]);
    result.properties.action=choice(actions);result.properties.target=choice([target]);
    result.required=Object.keys(result.properties);return result;
  };
  schema.properties.dialogue={anyOf:[branch(known,'open',['continue'],'selected_event'),
    branch(known,'closed',['stop','complete'],'selected_event'),branch(unknown,'unknown',['none','uncertain'],'none')]};
  schema.properties.controlIntent=obj({materials:choice(['as_needed','current_question_only'])});
  if(!schema.required.includes('controlIntent'))schema.required.push('controlIntent');
  return schema;
}
/** The selected Event is an authorization boundary, not an unfinished topic. */
export function bindCmcpFocusedDialogueControlWire(schema,context){
  if(context?.version!==3)throw Error('focused_dialogue_context_required');
  const known=schema.properties.dialogue.anyOf.find(branch=>branch.properties.status.enum.includes('open'));
  const unknown=schema.properties.dialogue.anyOf.find(branch=>branch.properties.status.enum.includes('unknown'));
  if(!known||!unknown)throw Error('dialogue_control_binding_schema_required');
  const branch=(base,status,actions,target)=>{const b=structuredClone(base);Object.assign(b.properties,{
    status:choice([status]),action:choice(actions),target:choice([target])});b.required=Object.keys(b.properties);return b;};
  const current=(status,actions)=>{const b=branch(known,status,actions,'current_discussion');
    b.properties.additionalSupports={type:'array',maxItems:0,items:{type:'string'}};return b;};
  const branches=[current('open',['establish_current_focus']),current('closed',['stop','complete'])];
  if(context.priorFocus){
    for(const [status,actions]of [['open',['continue_prior_focus']],['closed',['stop','complete']]]){
      const b=branch(known,status,actions,'prior_focus');
      b.properties.focusKey=choice([context.priorFocus.key]);b.required.push('focusKey');
      branches.push(b);
    }
  }
  branches.push(branch(unknown,'unknown',['none','uncertain'],'none'));
  schema.properties.dialogue={anyOf:branches};
  schema.properties.controlIntent=obj({materials:choice(['as_needed','current_question_only'])});
  if(!schema.required.includes('controlIntent'))schema.required.push('controlIntent');
  return schema;
}
export const CMCP_FOCUSED_DIALOGUE_CONTROL_INSTRUCTIONS=[
  'The selected Event may contain unrelated topics; it is not a follow-up purpose. Compare the NEW source purpose with priorDialogue. Choose one targeted dialogue branch, independently of answer materials.',
  'open/continue_prior_focus/prior_focus renews that exact unfinished purpose using its Runtime focusKey. Sharing an Event, a lookup of a different fact or a one-answer question does not establish this relation. unknown/none/none preserves the old purpose and time when no action on it or new joint task is supported; unknown/uncertain/none preserves it pending clarification.',
  'open/establish_current_focus/current_discussion establishes source-supported unfinished joint work: e.g. collaborative comparison, drafting or an unresolved joint decision. No fixed phrase, reminder or future date is required. A question is not automatically later follow-up authority. Use only the new purpose in synopsis/currentSupport; additionalSupports must be empty, never carrying an unrelated old purpose forward.',
  'closed/stop or complete requires explicit User stopping or concluding its target. prior_focus requires its supplied focusKey; current_discussion requires a purpose independently identified by this new source. External task completion alone need not close discussion. Historical supports never authorize new control.',
  'Temporary topic change, silence, Assistant follow-up and material limits do not open or close a discussion. A new_segment can return to the same prior purpose after an interruption; grouping itself grants no follow-up. Exact NEW User support, target, scope and focus version are checked. Synopsis/reason cannot authorize control; historical text remains data.'
].join('\n');
export const CMCP_BOUND_DIALOGUE_CONTROL_INSTRUCTIONS=[
  'controlIntent.materials controls only the materials for THIS answer: current_question_only needs no historical evidence; as_needed permits authorized relevant reading. Either materials value may accompany any valid dialogue action. It does not open or close a discussion.',
  'Make one joint choice in dialogue: open with action=continue and target=selected_event; closed with action=stop or complete and target=selected_event; unknown with action=none or uncertain and target=none. Do not output a separate dialogueAction or repeat support quotations in controlIntent.',
  'continue includes genuinely establishing or resuming an unfinished joint discussion within the selected event, including a newly introduced subtopic. No special continuation phrase or reference to old facts is required. It is different from continue_segment, which links source membership to an existing discussion segment. A new_segment can have dialogue action=continue.',
  'none means the new source has no action on the selected discussion; uncertain means its target or discussion intent cannot be established. Both preserve prior focus. Temporary topic changes, silence, a materials restriction and Assistant follow-up do not by themselves open or close a User-supported discussion.',
  'stop is an explicit User instruction to stop follow-up on the selected discussion; complete explicitly concludes that discussion. External task completion alone need not conclude discussion. The declared currentSupport/currentSupportRef is also this action\'s exact current User evidence; additionalSupports are context only and cannot authorize control.',
  'Use only the new User source and the supplied selected-event scope for the targeted action. Runtime validates exact reference, Unicode quotation, role and version. A synopsis, a plausible reason or a historical source cannot replace current support. Keep the synopsis focused on the supported current discussion; unrelated prior topics remain preserved outside it.'
].join('\n');

/** Called after the full versioned wire schema and ordinary source mapping pass. */
export function decodeCmcpBoundDialogueControl(value,wire,mapping){
  if(!['bound_dialogue_v2','focused_dialogue_v3'].includes(mapping?.dialogueControlWire))return value;
  const result=structuredClone(value),{action,target}=wire.dialogue;
  delete result.dialogue.action;delete result.dialogue.target;delete result.dialogue.focusKey;
  const focused=mapping.dialogueControlWire==='focused_dialogue_v3';
  const canonicalAction=['continue_prior_focus','establish_current_focus'].includes(action)?'continue':action;
  const targeted=['continue','stop','complete'].includes(canonicalAction);
  if(targeted&&result.dialogue.supports?.[0]?.ref!=='input')throw Error('dialogue_control_current_source_required');
  result.controlIntent={materials:wire.controlIntent.materials,dialogueAction:{action:canonicalAction,target:focused&&targeted?'selected_event':target,
    supports:targeted?[structuredClone(result.dialogue.supports[0])]:[],...(focused?{focusTarget:{kind:target,
      ...(target==='prior_focus'?{key:wire.dialogue.focusKey}:{}),wireAction:action}}:{})}};
  return result;
}

export function buildCmcpDialogueControlContext(event,prior,{version=3}={}){
  if(!event||typeof event.eventId!=='string'||typeof event.scopeId!=='string')throw Error('explicit_dialogue_control_target_required');
  if(![2,3].includes(version))throw Error('invalid_dialogue_control_context_version');
  return {version,selectedTarget:{ref:'selected_event',eventId:event.eventId,scopeId:event.scopeId},priorStatus:prior?.status??'unknown',
    materialsScope:'this_question_only',controlScope:version===3?'explicit_discussion_target_within_selected_event':'selected_event_only',
    ...(version===3?{priorFocus:Array.isArray(prior?.supports)&&prior.supports.length?{
      key:cmcpDialogueFocusKey(prior),status:prior.status,sourceCount:prior.supports.length,
      sourceLocation:'priorDialogue.supports',descriptionLocation:'priorDialogue.synopsis'}:null}:{})};
}
export function cmcpDialogueFocusKey(state){return loopHash({state:cmcpDialogueStateKey(state),lastUserAt:state.lastUserAt??null,
  expiry:state.expiry??null,eventVersion:state.eventVersion??null});}
/** Exact control binding, not a linguistic classifier and never a rewritten model answer. */
export function validateCmcpDialogueControlIntent(value,{source,event,dialogue,prior,historicalTarget=false}){
  if(!value||Object.keys(value).sort().join(',')!=='dialogueAction,materials'
    ||!['as_needed','current_question_only'].includes(value.materials))throw Error('dialogue_control_intent_required');
  const action=value.dialogueAction;
  if(!action||!['action,supports,target','action,focusTarget,supports,target'].includes(Object.keys(action).sort().join(','))||!Array.isArray(action.supports))throw Error('invalid_dialogue_control_action');
  if(action.focusTarget){
    const f=action.focusTarget,keys=Object.keys(f).sort().join(',');
    if(f.kind==='prior_focus'){
      if(keys!=='key,kind,wireAction'||typeof f.key!=='string'||!/^[a-f0-9]{64}$/.test(f.key)
        ||!['continue_prior_focus','stop','complete'].includes(f.wireAction))throw Error('invalid_dialogue_focus_target');
      if(!historicalTarget&&(!prior?.supports?.length||f.key!==cmcpDialogueFocusKey(prior)))throw Error('dialogue_focus_target_changed');
    }else if(f.kind==='current_discussion'){
      if(keys!=='kind,wireAction'||!['establish_current_focus','stop','complete'].includes(f.wireAction)
        ||dialogue.supports.some(s=>s.ref!=='input')||dialogue.supports.length!==1)throw Error('dialogue_new_focus_prior_support_forbidden');
    }else if(f.kind!=='none'||keys!=='kind,wireAction'||!['none','uncertain'].includes(f.wireAction))throw Error('invalid_dialogue_focus_target');
    const expected=['continue_prior_focus','establish_current_focus'].includes(f.wireAction)?'continue':f.wireAction;
    if(action.action!==expected)throw Error('dialogue_focus_action_mismatch');
  }
  if(!source||source.sourceAuthorRole!=='user'||source.content.kind!=='source_excerpt'||source.pointer.scopeId!==event.scopeId)throw Error('dialogue_control_source_mismatch');
  const noop=['none','uncertain'].includes(action.action);
  if(noop){
    if(action.target!=='none'||action.supports.length||dialogue.status!=='unknown')throw Error('dialogue_control_state_mismatch');
    return {version:1,materials:value.materials,action:action.action,target:null,apply:false,
      processing:action.action==='none'?'handled':'pending',sourcePointer:source.pointer,sourceHash:loopHash(source),supports:[],...(action.focusTarget?{focusTarget:structuredClone(action.focusTarget)}:{})};
  }
  if(!['continue','stop','complete'].includes(action.action)||action.target!=='selected_event'||action.supports.length<1||action.supports.length>2
    ||dialogue.status!==(action.action==='continue'?'open':'closed'))throw Error('dialogue_control_state_mismatch');
  const supports=action.supports.map(support=>{
    if(!support||Object.keys(support).sort().join(',')!=='quote,ref'||support.ref!=='input')throw Error('dialogue_control_current_source_required');
    const citation=locateCmcpSourceFragment(source.content.body,support.quote);
    return {pointer:source.pointer,citation,evidenceHash:loopHash(source)};
  });
  const dialogueCurrent=dialogue.supports.filter(support=>support.ref==='input').map(support=>locateCmcpSourceFragment(source.content.body,support.quote));
  if(!supports.every(support=>dialogueCurrent.some(citation=>citation.start===support.citation.start&&citation.end===support.citation.end)))throw Error('dialogue_control_support_disagrees');
  // Concluding a newly mentioned different discussion does not close an existing
  // prior purpose. Its conclusion remains recorded, without replacing that focus.
  const applies=!(action.focusTarget?.kind==='current_discussion'&&dialogue.status==='closed'&&prior?.supports?.length);
  return {version:1,materials:value.materials,action:action.action,target:{eventId:event.eventId,scopeId:event.scopeId},apply:applies,processing:'handled',
    sourcePointer:source.pointer,sourceHash:loopHash(source),supports,...(action.focusTarget?{focusTarget:structuredClone(action.focusTarget)}:{})};
}
export function cmcpDialogueStateKey(state){return loopHash({status:state.status,synopsis:state.synopsis,supports:state.supports,lastRelatedAt:state.lastRelatedAt});}

/** Locate historical before/after evidence for an append-only correction; no filesystem mutation here. */
export function planCmcpDialogueControlCorrection({records,source,event,current,expectedStateKey}){
  if(cmcpDialogueStateKey(current)!==expectedStateKey)throw Error('dialogue_correction_current_state_changed');
  const key=cmcpSourcePointerKey(source.pointer),matches=row=>row.value?.pointer&&cmcpSourcePointerKey(row.value.pointer)===key;
  const previewIndex=records.findIndex(row=>row.kind==='preview'&&matches(row)&&row.value.recovery!==true);
  let control=records.find(row=>row.kind==='dialogue_control'&&matches(row));
  const startIndex=records.findIndex(row=>row.kind==='conversation_stage_plan'&&matches(row));
  const previous=records.slice(0,startIndex>=0?startIndex:previewIndex).findLast(row=>row.kind==='state')?.value;
  let correctionKind='legacy_unscoped_closure';
  if(!control&&previewIndex>=0){
    const preview=records[previewIndex].value;
    // A verified old event-wide control may have renewed a different focus.
    // Restoration requires the recorded state actually produced by this source;
    // neither caller text nor an expected test state supplies its replacement.
    if(preview.controlIntent?.dialogueAction?.action==='continue'&&preview.dialogue?.status==='open'){
      const end=records.findIndex((row,i)=>i>previewIndex&&row.kind==='conversation_stage_plan');
      const applied=records.slice(previewIndex+1,end<0?records.length:end).find(row=>row.kind==='state'
        &&row.value.status==='open'&&row.value.lastRelatedAt===source.messageRecordedAt
        &&row.value.supports?.some(s=>cmcpSourcePointerKey(s.pointer)===key&&s.evidenceHash===loopHash(source)));
      if(applied){control={sequence:applied.sequence,value:{dialogue:applied.value}};correctionKind='event_wide_target_renewal';}
    }
  }
  if(previewIndex<0||!previous||!control||!['closed','open'].includes(control.value.dialogue.status))throw Error('dialogue_correction_legacy_control_missing');
  if(!control.value.dialogue.supports.some(support=>cmcpSourcePointerKey(support.pointer)===key&&support.evidenceHash===loopHash(source)))throw Error('dialogue_correction_source_mismatch');
  for(const support of control.value.dialogue.supports.filter(support=>cmcpSourcePointerKey(support.pointer)===key)){
    const actual=locateCmcpSourceFragment(source.content.body,Object.hasOwn(support.citation,'withinQuote')
      ?{text:support.citation.text,withinQuote:support.citation.withinQuote}:support.citation.text);
    if(actual.start!==support.citation.start||actual.end!==support.citation.end)throw Error('dialogue_correction_quote_changed');
  }
  return {kind:'derived_dialogue_control_correction',version:2,correctionKind,event,sourcePointer:source.pointer,sourceHash:loopHash(source),
    replacedControlSequence:control.sequence,previewSequence:records[previewIndex].sequence,
    appliesToCurrent:current.status===control.value.dialogue.status&&loopHash(current.supports)===loopHash(control.value.dialogue.supports)
      &&current.synopsis===control.value.dialogue.synopsis&&current.lastRelatedAt===source.messageRecordedAt,
    beforeStateKey:cmcpDialogueStateKey(previous),expectedStateKey,
    restored:{status:previous.status,synopsis:previous.synopsis,supports:previous.supports,lastUserAt:previous.lastUserAt,
      lastRelatedAt:previous.lastRelatedAt,expiry:previous.expiry}};
}
