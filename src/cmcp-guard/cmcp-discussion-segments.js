import {cmcpSourcePointerKey,createCmcpSourcePointer} from './cmcp-source-pointer.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {resolveCmcpTimeContext,parseCmcpInstant} from './resolve-cmcp-time-context.js';
import {formatCmcpLocalInstant} from './project-cmcp-local-time.js';
import {loopHash} from './cmcp-local-loop-journal.js';
const copy=value=>structuredClone(value),sameEvent=(a,b)=>a?.scopeId===b?.scopeId&&a?.eventId===b?.eventId;
const eventOf=entry=>entry.eventScope??entry.eventLink?.event??null;
const key=pointer=>cmcpSourcePointerKey(createCmcpSourcePointer(pointer));
function shape(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error('invalid_discussion_input');}
function zone(value){resolveCmcpTimeContext({now:'2026-01-01T00:00:00Z',timezone:value});return value;}
function identifier(value){if(typeof value!=='string'||!value.trim()||value.length>128)throw Error('invalid_discussion_identifier');return value;}
function exactCitation(text,quote){
 if(typeof quote!=='string'||!quote.length)throw Error('discussion_quote_required');
 const p=[...text],q=[...quote],found=[];for(let i=0;i<=p.length-q.length;i++)if(q.every((v,j)=>v===p[i+j])){found.push(i);if(found.length>1)break;}
 if(found.length!==1)throw Error('discussion_quote_not_unique');return {unit:'unicode_code_points',start:found[0],end:found[0]+q.length,text:quote};
}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('invalid_discussion_start_date');return value;}
const localDate=(instant,timezone)=>formatCmcpLocalInstant(instant,timezone).slice(0,10);
function publicSegment(record,timezone=record.segment.timezone){const s=record.segment;return {kind:'caller_declared_discussion_segment',segmentId:s.segmentId,eventKey:s.eventKey,event:copy(s.event),segmentHash:record.segmentHash,
 timezone,startDate:localDate(s.firstMessageAt,timezone),firstMessageAt:s.firstMessageAt,lastIncludedMessageAt:s.lastIncludedMessageAt,
 firstLocal:formatCmcpLocalInstant(s.firstMessageAt,timezone),lastIncludedLocal:formatCmcpLocalInstant(s.lastIncludedMessageAt,timezone),
 crossesLocalDateBoundary:localDate(s.firstMessageAt,timezone)!==localDate(s.lastIncludedMessageAt,timezone),
 firstSource:copy(s.sources[0].pointer),lastIncludedSource:copy(s.sources.at(-1).pointer),sourceCount:s.sources.length,
 sources:s.sources.map(source=>({pointer:copy(source.pointer),sourceAuthorRole:source.sourceAuthorRole,messageRecordedAt:source.messageRecordedAt,
  localMessageRecordedAt:formatCmcpLocalInstant(source.messageRecordedAt,timezone),eventOccurredAt:source.eventOccurredAt,range:copy(source.citation)})),
 associationBasis:s.associationBasis??'explicit_caller_declaration_with_exact_source_support',semanticVerification:'not_performed',sourceAvailability:'rechecked_on_exact_read',closure:'not_inferred',workDuration:'not_inferred',historyCompleteness:'declared_sources_only'};}
function choiceSegment(record,timezone){const {sources,firstSource,lastIncludedSource,...metadata}=publicSegment(record,timezone);
 return {...metadata,sourceVisibility:'metadata_only_exact_read_required'};}

/** Derived relations live in the existing input journal; source content stays in History. */
export function createCmcpDiscussionSegments({stores,catalog,journal,events,maxSources,maxSourceBytes,now,valid=async()=>true}){
 const authorized=eventKey=>{const selected=events.find(item=>item.key===eventKey);if(!selected)throw Error('discussion_event_outside_authorized_scope');return selected;};
 async function records(){const rows=(await journal.read()).filter(row=>['discussion_segment_registered','discussion_segment_extended'].includes(row.record.kind)),current=new Map();
  for(const {record:{kind,value:row}}of rows){if(row.segment?.version!==1||row.segment.event.scopeId!==stores.scopeId||loopHash(row.segment)!==row.segmentHash)throw Error('discussion_segment_journal_invalid');
   authorized(row.segment.eventKey);const prior=current.get(row.segment.segmentId);
   if(kind==='discussion_segment_registered'&&prior||kind==='discussion_segment_extended'&&(!prior||row.previousSegmentHash!==prior.segmentHash
     ||!sameEvent(row.segment.event,prior.segment.event)||row.segment.eventKey!==prior.segment.eventKey
     ||row.segment.timezone!==prior.segment.timezone||prior.segment.sources.some(source=>!row.segment.sources.some(next=>key(next.pointer)===key(source.pointer)&&JSON.stringify(next)===JSON.stringify(source)))))throw Error('discussion_segment_journal_invalid');
   current.set(row.segment.segmentId,row);}return [...current.values()];}
 async function selection(input){
  shape(input,['startDate','timezone','eventKey','segmentId']);const timezone=zone(input.timezone);if(input.startDate!==undefined)date(input.startDate);if(input.segmentId!==undefined)identifier(input.segmentId);
  if(input.eventKey!==undefined)authorized(input.eventKey);
  const found=(await records()).filter(row=>(input.startDate===undefined||localDate(row.segment.firstMessageAt,timezone)===input.startDate)
   &&(input.eventKey===undefined||row.segment.eventKey===input.eventKey)&&(input.segmentId===undefined||row.segment.segmentId===input.segmentId));
  return {status:found.length===0?'not_found':found.length===1?'selected':'needs_clarification',records:found,timezone};
 }
 return Object.freeze({
  async link(input,{canLink=async()=>true}={}){
   if(typeof canLink!=='function')throw Error('invalid_discussion_commit_guard');
   shape(input,['segmentId','eventKey','timezone','supports','limits','previousSegmentHash','associationBasis']);identifier(input.segmentId);const selected=authorized(input.eventKey),timezone=zone(input.timezone),limits=input.limits;
   if(input.previousSegmentHash!==undefined&&!/^[a-f0-9]{64}$/.test(input.previousSegmentHash))throw Error('invalid_discussion_previous_hash');
   if(input.associationBasis!==undefined&&input.associationBasis!=='model_proposed_exact_source_supported')throw Error('invalid_discussion_association_basis');
   shape(limits,['maxSources','maxSourceBytes','maxRecordBytes']);
   if(!['maxSources','maxSourceBytes','maxRecordBytes'].every(name=>Number.isSafeInteger(limits?.[name])&&limits[name]>0)
     ||limits.maxSources>maxSources||limits.maxSourceBytes>maxSourceBytes)throw Error('invalid_discussion_limits');
   if(!Array.isArray(input.supports)||!input.supports.length||input.supports.length>limits.maxSources)throw Error('discussion_source_limit');
   const entries=await catalog.list(),seen=new Set(),sources=[];
   for(const support of input.supports){
    shape(support,['pointer','quote','sourceAuthorRole']);const pointer=createCmcpSourcePointer(support.pointer),id=key(pointer);
    if(pointer.scopeId!==stores.scopeId||seen.has(id)||!['user','assistant','tool'].includes(support.sourceAuthorRole))throw Error('discussion_source_scope_role_or_duplicate');seen.add(id);
    const entry=entries.find(item=>key(item.pointer)===id);if(!entry||!sameEvent(eventOf(entry),selected.event))throw Error('discussion_source_not_associated_with_event');
    if(!await valid()||!await canLink())throw Error('discussion_cancelled');const found=await resolveCmcpHistorySource({provider:stores.history,pointer});
    if(found.status!=='found')throw Error('discussion_source_'+found.status);const evidence=found.evidence;
    if(loopHash(evidence)!==entry.evidenceHash||evidence.sourceAuthorRole!==support.sourceAuthorRole||evidence.sourceAuthorRole!==entry.sourceAuthorRole)throw Error('discussion_source_changed_or_role_mismatch');
    if(Buffer.byteLength(evidence.content.body)>limits.maxSourceBytes)throw Error('discussion_source_byte_limit');
    const instant=parseCmcpInstant(evidence.messageRecordedAt),citation=exactCitation(evidence.content.body,support.quote);
    sources.push({pointer:copy(pointer),sourceAuthorRole:evidence.sourceAuthorRole,evidenceHash:entry.evidenceHash,citation,
      messageRecordedAt:evidence.messageRecordedAt,eventOccurredAt:evidence.eventOccurredAt,instant});
   }
   // Stable actual-instant order locates the first included source; it does not infer discussion membership.
   sources.sort((a,b)=>a.instant-b.instant);
   const segment={version:1,segmentId:input.segmentId,eventKey:input.eventKey,event:copy(selected.event),timezone,
    firstMessageAt:sources[0].messageRecordedAt,lastIncludedMessageAt:sources.at(-1).messageRecordedAt,sources:sources.map(({instant,...source})=>source),
    ...(input.associationBasis?{associationBasis:input.associationBasis}:{})};
   if(Buffer.byteLength(JSON.stringify(segment))>limits.maxRecordBytes)throw Error('discussion_record_byte_limit');
   const segmentHash=loopHash(segment),prior=(await records()).find(row=>row.segment.segmentId===segment.segmentId);
   if(prior){if(prior.segmentHash===segmentHash)return {status:'unchanged',segment:publicSegment(prior),modelCalls:0};
    if(input.previousSegmentHash!==prior.segmentHash||!sameEvent(segment.event,prior.segment.event)||segment.timezone!==prior.segment.timezone
      ||prior.segment.sources.some(source=>!segment.sources.some(next=>key(next.pointer)===key(source.pointer)&&JSON.stringify(next)===JSON.stringify(source))))throw Error('discussion_segment_id_conflict');
   }else if(input.previousSegmentHash!==undefined)throw Error('discussion_extension_base_missing');
   if(!await valid()||!await canLink())throw Error('discussion_cancelled');const record={segment,segmentHash,registeredAt:now(),...(prior?{previousSegmentHash:prior.segmentHash}:{})};
   await journal.append(prior?'discussion_segment_extended':'discussion_segment_registered',record);return {status:prior?'extended':'registered',segment:publicSegment(record),modelCalls:0};
  },
  async list(input={}){const timezone=zone(input.timezone??'UTC'),result=await selection({...input,timezone});
   return {kind:'cmcp_discussion_segments',status:result.status,segments:result.records.map(row=>publicSegment(row,timezone)),modelCalls:0,originalTimesNotRefreshed:true};},
  async select(input){const result=await selection(input);if(result.status!=='selected')return {status:result.status,choices:result.records.map(row=>choiceSegment(row,result.timezone)),entries:[]};
   const record=result.records[0],entries=await catalog.list(),selected=[];
   for(const source of record.segment.sources){const entry=entries.find(item=>key(item.pointer)===key(source.pointer));
    if(!entry||entry.evidenceHash!==source.evidenceHash||entry.sourceAuthorRole!==source.sourceAuthorRole||!sameEvent(eventOf(entry),record.segment.event))throw Error('discussion_registered_source_changed');
    selected.push(entry);}
   return {status:'selected',entries:selected,descriptor:{...publicSegment(record,result.timezone),scopeCoverage:'frozen_declared_discussion_sources'}};
  },
  async selectMany(input){
   shape(input,['segmentIds','segmentHashes','timezone','eventKey']);const timezone=zone(input.timezone),event=authorized(input.eventKey);
   if(!Array.isArray(input.segmentIds)||!input.segmentIds.length||input.segmentIds.length>16||new Set(input.segmentIds).size!==input.segmentIds.length
    ||!Array.isArray(input.segmentHashes)||input.segmentHashes.length!==input.segmentIds.length)throw Error('invalid_discussion_segment_union');
   const all=await records(),selectedRecords=input.segmentIds.map((id,index)=>{identifier(id);const record=all.find(row=>row.segment.segmentId===id);
    if(!record||record.segment.eventKey!==event.key||record.segmentHash!==input.segmentHashes[index])throw Error('discussion_selection_changed_or_outside_event');return record;});
   const entries=await catalog.list(),selected=[],seen=new Set();
   for(const record of selectedRecords)for(const source of record.segment.sources){const entry=entries.find(item=>key(item.pointer)===key(source.pointer));
    if(!entry||entry.evidenceHash!==source.evidenceHash||entry.sourceAuthorRole!==source.sourceAuthorRole||!sameEvent(eventOf(entry),event.event))throw Error('discussion_registered_source_changed');
    if(!seen.has(key(source.pointer))){seen.add(key(source.pointer));selected.push(entry);}}
   selected.sort((a,b)=>parseCmcpInstant(a.messageRecordedAt)-parseCmcpInstant(b.messageRecordedAt));
   if(!await valid())throw Error('discussion_cancelled');
   return {status:'selected',entries:selected,descriptor:{kind:'declared_discussion_union',event:copy(event.event),timezone,
    segments:selectedRecords.map(record=>publicSegment(record,timezone)),sourceCount:selected.length,
    scopeCoverage:'frozen_union_of_declared_discussion_sources',historyCompleteness:'declared_sources_only',workDuration:'not_inferred'}};
  },
  async calendar(input,{excludePointer}={}){shape(input,['from','to','timezone','eventKey']);const from=parseCmcpInstant(input.from),to=parseCmcpInstant(input.to),timezone=zone(input.timezone);
   if(to<=from)throw Error('invalid_calendar_range');const selected=input.eventKey===undefined?null:authorized(input.eventKey);
   const entries=(await catalog.list()).filter(entry=>{if(excludePointer&&key(entry.pointer)===key(excludePointer))return false;let instant;try{instant=parseCmcpInstant(entry.messageRecordedAt);}catch{return false;}
    return instant>=from&&instant<to&&(!selected||sameEvent(eventOf(entry),selected.event));});
   const groups=new Set(entries.map(entry=>eventOf(entry)?JSON.stringify(eventOf(entry)):'unassociated'));
   if(groups.size>1&&!selected)return {status:'needs_clarification',entries:[],reason:'calendar_range_contains_distinct_event_scopes'};
   return {status:entries.length?'selected':'not_found',entries,descriptor:{kind:'exact_calendar_range',from:input.from,to:input.to,timezone,
    event:copy(selected?.event??null),bounds:'inclusive_from_exclusive_to',discussionExpansion:false,scopeCoverage:'frozen_exact_calendar_range'}};
  }
 });
}
