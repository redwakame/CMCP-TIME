import {loopHash} from './cmcp-local-loop-journal.js';
import {inspectCmcpReadingProgress} from './cmcp-reading.js';
import {resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';
import {formatCmcpLocalInstant} from './project-cmcp-local-time.js';

export const CMCP_SOURCE_CONTEXT_LIMITS=Object.freeze({maxSources:64,maxRanges:256,maxMetadataBytes:16384,maxSourceBytes:4096,maxContextBytes:16384});
const copy=structuredClone,bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function check(ok,reason){if(!ok)throw Error('continuity_source_context_'+reason);}
function covers(ranges,end){let cursor=0;for(const range of ranges){if(range.start>cursor)break;cursor=Math.max(cursor,range.end);}return cursor>=end;}
function localTimeDisplay(runtimeTime){
 const authority='existing_original_instants_in_formal_projection_timezone_not_new_source_or_event_evidence';
 if(typeof runtimeTime?.timezone!=='string'||!runtimeTime.timezone.trim())return {status:'unknown',reason:'projection_timezone_not_supplied',timezone:null,authority};
 try{
  // 明示的正式時間脈絡只用來驗時區，不讀系統時鐘或沿用機器預設。
  const temporal=resolveCmcpTimeContext({now:runtimeTime.now,timezone:runtimeTime.timezone});
  return {status:'available',reason:null,timezone:temporal.timezone,authority};
 }catch{return {status:'unavailable',reason:'invalid_projection_time_context',timezone:null,authority};}
}
function localSourceTimes(source,display){
 const empty={localMessageRecordedAt:null,localEventOccurredAt:null};
 if(display.status!=='available')return empty;
 try{return {localMessageRecordedAt:formatCmcpLocalInstant(source.messageRecordedAt,display.timezone),
  localEventOccurredAt:formatCmcpLocalInstant(source.eventOccurredAt,display.timezone)};}
 catch{return {...empty,localTimeStatus:'unavailable',localTimeReason:'invalid_original_source_instant'};}
}

/** 唯讀同票券來源視圖；引文選取不代表訊息邊界，正式工具材料不等於供應商送達或模型理解。 */
export function createCmcpContinuitySourceContext({projection,projectionHash,scopeId,reading=null,previousPages=null}){
 const base={kind:'cmcp_formal_source_context',version:1,projectionHash,
  scope:'only_refs_used_by_same_formal_projection',citationScope:'host_selected_exact_fragments_do_not_define_original_message_extent',
  authority:'same_formal_reader_originals_not_new_history_or_semantic_judgment',semanticVerification:'not_performed',executionAuthority:'none',
  actualModelConsumption:'not_observed',limits:CMCP_SOURCE_CONTEXT_LIMITS,localTimeDisplay:localTimeDisplay(projection?.runtimeTime)};
 const unavailable=(status,reason)=>({...base,localTimeDisplay:{...base.localTimeDisplay,status,reason,timezone:null},
  metadata:{status,reason,sources:null},originalMessages:{status,reason,messages:null,truncated:false}});
 if(!reading||previousPages===null)return unavailable('unknown','formal_reader_evidence_not_supplied');
 try{
  check(projection&&loopHash(projection)===projectionHash,'projection_hash_mismatch');
  let progress;try{progress=inspectCmcpReadingProgress({reading,previousPages,scopeId});}catch{throw Error('continuity_source_context_reading_evidence_invalid');}
  check(progress.coverage.complete,'formal_reading_incomplete');
  check(Array.isArray(projection.sources),'projection_sources_invalid');
  const limits=CMCP_SOURCE_CONTEXT_LIMITS,manifest=reading.internal.manifest;
  check(projection.manifestHash===reading.internal.manifestHash,'manifest_binding_mismatch');
  check(projection.sources.length<=limits.maxSources,'source_limit');
  const sourceMap=new Map(manifest.sources.map(source=>[source.ref,source])),seen=new Set(),metadata=[],messages=[];
  const scopedRefs=new Set((projection.scopedPlanBindings??[]).flatMap(binding=>[binding.scopeSource?.ref,binding.conditionSource?.ref,
   ...(binding.appliedChanges??[]).map(change=>change.source?.ref)]));
  let rangeCount=0;const unavailableContexts=[];
  for(const [index,cited]of projection.sources.entries()){
   const source=sourceMap.get(cited.ref);
   check(source&&!seen.has(cited.ref),'source_binding_mismatch');seen.add(cited.ref);
   for(const key of ['sourceAuthorRole','contentKind','messageRecordedAt','eventOccurredAt','evidenceHash'])check(cited[key]===source[key],'source_binding_mismatch');
   check(hash(source.evidenceHash)&&Number.isSafeInteger(source.codePoints)&&source.codePoints>=0,'source_binding_mismatch');
   const pages=previousPages.filter(page=>page.reader.source?.ref===source.ref),readRanges=[],materialRanges=[],pageNumbers=[],texts=[];
   for(const page of pages){
    const {reader,modelContext}=page;check(typeof reader.text==='string','source_unavailable');
    readRanges.push(copy(reader.range));texts.push(reader.text);pageNumbers.push(reader.pageNumber);
    if(modelContext===null)continue;
    let material;try{material=JSON.parse(modelContext);}catch{throw Error('continuity_source_context_material_invalid');}
    check(reader.projection?.status==='projected'&&material.kind==='cmcp_reading_page_context'&&material.sourceRef===source.ref
     &&(material.contextVersion===undefined||[1,2].includes(material.contextVersion))
     &&(material.contextVersion!==2||material.source?.evidenceHash===source.evidenceHash)
     &&equal(material.range,reader.range)&&material.content===reader.text&&material.source?.sourceAuthorRole===source.sourceAuthorRole
     &&material.time?.messageRecordedAt===source.messageRecordedAt&&material.time?.eventOccurredAt===source.eventOccurredAt,'material_binding_mismatch');
    materialRanges.push(copy(reader.range));
   }
   rangeCount+=readRanges.length+materialRanges.length;
   const text=texts.join('');check([...text].length===source.codePoints&&covers(readRanges,source.codePoints),'source_extent_mismatch');
   const identity={ref:source.ref,sourceAuthorRole:source.sourceAuthorRole,messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt,evidenceHash:source.evidenceHash};
   const range={unit:'unicode_code_points',start:0,end:source.codePoints},materialComplete=covers(materialRanges,source.codePoints);
   const reader={ticket:manifest.ticket,ref:source.ref,pageNumbers,scope:'current_reading_ticket_only'};
   // 時間顯示只在同 ref／角色／UTC／hash 的 metadata 保存一次，不擠占原文正文預算。
   metadata.push({...identity,...(scopedRefs.has(source.ref)?{pointer:copy(source.pointer)}:{}),...localSourceTimes(source,base.localTimeDisplay),sourceReference:'/projection/sources/'+index,originalMessageRange:range,originalMessageBytes:bytes(text),
    formalRead:{complete:true,ranges:readRanges},formalToolMaterial:{complete:materialComplete,ranges:materialRanges,observation:'formal_tool_result_only_not_provider_request'},reader});
   if(!materialComplete)unavailableContexts.push({ref:source.ref,reason:'formal_tool_material_incomplete'});
   else if(bytes(text)>limits.maxSourceBytes)unavailableContexts.push({ref:source.ref,reason:'whole_source_bytes_limit'});
   messages.push({...identity,range,text,textHash:loopHash(text),textUse:'complete_formally_read_original_message_not_selected_quote'});
  }
  const meta=rangeCount>limits.maxRanges||bytes(metadata)>limits.maxMetadataBytes
   ?{status:'unavailable',reason:'metadata_capacity_limit',sources:null,complete:false}
   :{status:'available',reason:null,sources:metadata,complete:true};
  const context=unavailableContexts.length
   ?{status:'unavailable',reason:'whole_original_context_unavailable',messages:null,unavailableSources:unavailableContexts,truncated:false}
   :bytes(messages)>limits.maxContextBytes
    ?{status:'unavailable',reason:'whole_context_bytes_limit',messages:null,truncated:false}
    :{status:'available',reason:null,messages,complete:true,truncated:false};
  return {...base,metadata:meta,originalMessages:context};
 }catch(error){
  if(!String(error?.message).startsWith('continuity_source_context_'))throw error;
  return unavailable('unavailable',error.message);
 }
}
