import {CMCP_SOURCE_CONTEXT_LIMITS} from '../../src/cmcp-guard/cmcp-continuity-source-context.js';
import {cmcpSourcePointerKey} from '../../src/cmcp-guard/cmcp-source-pointer.js';
import {createHash} from 'node:crypto';

const copy=structuredClone,bytes=value=>Buffer.byteLength(JSON.stringify(value));
const opaque=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=1024&&!/[\x00-\x1f\x7f]/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const comparisonMeaning='identity_equality_only_not_adoption_or_execution';
const captureKeys=['projectId','hostId','agentId','sessionId','messageId','revisionId'];
const sha=value=>createHash('sha256').update(value).digest('hex');
function currentReaderIdentity(reader,scopeId){
 const valid=reader?.kind==='cmcp_reader_identity'&&reader.version===1&&reader.verification==='authenticated_active_host_turn'
  &&['projectId','scopeId','hostId','agentId','sessionId'].every(key=>opaque(reader[key]))
  &&reader.scopeId===scopeId&&digest(reader.activeTurnId);
 return valid?Object.fromEntries(['kind','version','projectId','scopeId','hostId','agentId','sessionId','activeTurnId','verification'].map(key=>[key,reader[key]])):null;
}
function formalOriginBinding(result,row,reader,scopeId){
 const unknown=reason=>({ref:row.ref,evidenceHash:row.evidenceHash,messageRole:row.sourceAuthorRole,status:'unknown',reason,capture:null,readerComparison:null});
 if(!reader)return unknown('authenticated_reader_identity_unavailable');
 const matches=(result.sourceOrigins??[]).map((value,index)=>({value,index})).filter(({value})=>value.ref===row.ref);
 if(matches.length!==1)return unknown('unique_formal_source_origin_unavailable');
 const {value,index}=matches[0],origin=value.origin;
 if(value.ticket!==result.ticket||value.verification!=='formal_read_binding'||value.evidenceHash!==row.evidenceHash
  ||!origin||!captureKeys.every(key=>opaque(origin[key]))||origin.role!==row.sourceAuthorRole||origin.projectId!==reader.projectId
  ||value.sourcePointer?.scopeId!==scopeId||value.qualifiedSessionId!==value.sourcePointer?.sessionId)return unknown('formal_source_origin_binding_mismatch');
 try{cmcpSourcePointerKey(value.sourcePointer);}catch{return unknown('formal_source_pointer_unavailable');}
 const sameHost=origin.hostId===reader.hostId,sameAgent=sameHost&&origin.agentId===reader.agentId,sameSession=sameAgent&&origin.sessionId===reader.sessionId;
 const expected={sameHost,sameAgent,sameSession,meaning:comparisonMeaning};
 if(!equal(value.readerComparison,expected))return unknown('formal_reader_comparison_mismatch');
 return {ref:row.ref,evidenceHash:row.evidenceHash,messageRole:row.sourceAuthorRole,status:'verified',reason:null,
  sourceOriginReference:'/sourceOrigins/'+index,capture:Object.fromEntries(captureKeys.map(key=>[key,origin[key]])),readerComparison:copy(value.readerComparison)};
}

/** 當頁正式原文的身分關聯；保留原 reader／modelContext 位元組，不另複製正文。 */
export function attachSharedReadAttribution(result,scopeId){
 if(result?.kind!=='cmcp_reading_page'||!result.source?.ref)return result;
 const base={kind:'cmcp_formal_page_source_attribution',version:1,verificationLayer:'shared_project_broker_formal_read_binding_not_core_receipt',
  sourceReference:'/source',rangeReference:'/range',readerIdentityReference:'/readerIdentity',
  meaning:'message_role_and_original_capture_identity_are_separate_from_current_reader',
  sourceCoverage:'only_this_formal_page',semanticVerification:'not_performed',actualModelConsumption:'not_observed',executionAuthority:'none'};
 const unknown=reason=>({...result,sourceAttribution:{...base,status:'unknown',reason,currentReader:null,binding:null,material:null}});
 let context;const serialized=typeof result.modelContext==='string';
 try{context=serialized?JSON.parse(result.modelContext):result.modelContext;}catch{return unknown('formal_page_material_unavailable');}
 const compact=!serialized&&digest(result.pageProtocolRef);
 if(result.projection?.status!=='projected'||(!compact&&context?.kind!=='cmcp_reading_page_context')||typeof context?.content!=='string'
  ||!digest(context.source?.evidenceHash))return unknown('formal_page_material_unavailable');
 const source=result.source,range=result.range;
 if(!['user','assistant'].includes(source.sourceAuthorRole)||!opaque(source.ref)||!opaque(source.messageRecordedAt)
  ||!Number.isFinite(Date.parse(source.messageRecordedAt))||range?.unit!=='unicode_code_points'||!Number.isSafeInteger(range.start)
  ||!Number.isSafeInteger(range.end)||range.start<0||range.end<range.start||[...context.content].length!==range.end-range.start
  ||(!compact&&(context.sourceRef!==source.ref||context.source.sourceAuthorRole!==source.sourceAuthorRole||!equal(context.range,range)||context.time?.messageRecordedAt!==source.messageRecordedAt))
  ||(compact&&((context.sourceRef!==undefined&&context.sourceRef!==source.ref)||(context.source.sourceAuthorRole!==undefined&&context.source.sourceAuthorRole!==source.sourceAuthorRole)
   ||(context.range!==undefined&&!equal(context.range,range))||(context.time?.messageRecordedAt!==undefined&&context.time.messageRecordedAt!==source.messageRecordedAt))))return unknown('formal_page_material_binding_mismatch');
 const currentReader=currentReaderIdentity(result.readerIdentity,scopeId),binding=formalOriginBinding(result,{ref:source.ref,evidenceHash:context.source.evidenceHash,sourceAuthorRole:source.sourceAuthorRole},currentReader,scopeId);
 const view={...base,status:binding.status==='verified'?'available':'unknown',reason:binding.reason,currentReader,binding,
  material:{sourceRef:source.ref,messageRole:source.sourceAuthorRole,messageRecordedAt:source.messageRecordedAt,
   evidenceHash:context.source.evidenceHash,range:{unit:range.unit,start:range.start,end:range.end},
   contentReference:{container:'/modelContext',resolution:'parse_json_string_or_use_projected_json_object',pointerWithinParsedContainer:'/content'},
   textBytes:Buffer.byteLength(context.content),textSha256:sha(context.content),unchangedCoreModelContext:true}};
 if(bytes(view)>CMCP_SOURCE_CONTEXT_LIMITS.maxMetadataBytes)return {...result,sourceAttribution:{...base,status:'unavailable',reason:'source_identity_metadata_capacity',currentReader:null,binding:null,material:null}};
 return {...result,sourceAttribution:view};
}

/** 僅由 broker 的正式來源身分封套補充呈現，不寫回 Core 原投影或回執。 */
export function attachSharedSourceProvenance(result){
 const original=result?.presentation?.sourceContext;
 if(!['ready','partial'].includes(result?.status)||original?.kind!=='cmcp_formal_source_context'
  ||original.version!==1||original.projectionHash!==result.projectionHash)return result;
 const hasMetadata=original.metadata?.status==='available'&&Array.isArray(original.metadata.sources);
 const hasMessages=original.originalMessages?.status==='available'&&Array.isArray(original.originalMessages.messages);
 if(!hasMetadata&&!hasMessages)return result;
 const view=copy(original),limits=CMCP_SOURCE_CONTEXT_LIMITS,currentReader=currentReaderIdentity(result.readerIdentity,result.scopeId);
 const base={kind:'cmcp_broker_source_provenance',version:1,verificationLayer:'shared_project_broker_formal_read_binding_not_core_receipt',
  meaning:'capture_host_agent_and_native_session_not_model_personality_or_reader_adoption',
  readerIdentityReference:'/readerIdentity',semanticVerification:'not_performed',actualModelConsumption:'not_observed',executionAuthority:'none'};
 const unavailable=reason=>({...base,status:'unavailable',reason,currentReader:null,bindings:null});
 const rows=hasMetadata?view.metadata.sources:view.originalMessages.messages;
 const bound=(row)=>{
  const unknown=reason=>({ref:row.ref,evidenceHash:row.evidenceHash,messageRole:row.sourceAuthorRole,status:'unknown',reason,capture:null,readerComparison:null});
  if(!currentReader)return unknown('authenticated_reader_identity_unavailable');
  const selected=result.projection?.sources?.filter(source=>source.ref===row.ref)??[];
  if(selected.length!==1||selected[0].evidenceHash!==row.evidenceHash||selected[0].sourceAuthorRole!==row.sourceAuthorRole)return unknown('projection_source_binding_mismatch');
  return formalOriginBinding(result,row,currentReader,result.scopeId);
 };
 let provenance;
 if(rows.length>limits.maxSources||new Set(rows.map(row=>row.ref)).size!==rows.length)provenance=unavailable('source_identity_reference_limit');
 else{
  const bindings=rows.map(bound),verified=bindings.filter(row=>row.status==='verified').length;
  provenance={...base,status:verified===bindings.length?'available':verified?'partial':'unknown',reason:verified===bindings.length?null:'some_formal_source_identities_unavailable',currentReader,bindings};
  const references=new Map(bindings.map((row,index)=>[row.ref,{evidenceHash:row.evidenceHash,role:row.messageRole,path:'/presentation/sourceContext/provenance/bindings/'+index}]));
  const add=row=>{const ref=references.get(row.ref);return ref?.evidenceHash===row.evidenceHash&&ref.role===row.sourceAuthorRole
   ?{...row,sourceProvenanceReference:ref.path}:{...row,sourceProvenanceStatus:'unknown'};};
  if(hasMetadata)view.metadata={...view.metadata,sources:view.metadata.sources.map(add)};
  if(hasMessages)view.originalMessages={...view.originalMessages,messages:view.originalMessages.messages.map(add)};
 }
 // 身分表與原 metadata 共用原上限；不裁欄位、來源或原文來冒充完整。
 if(provenance.status==='unavailable'||bytes({metadata:view.metadata,provenance})>limits.maxMetadataBytes){
  provenance=unavailable(provenance.reason??'source_identity_metadata_capacity');
  if(hasMetadata)view.metadata={status:'unavailable',reason:provenance.reason,sources:null,complete:false};
  if(hasMessages)view.originalMessages={status:'unavailable',reason:provenance.reason,messages:null,truncated:false};
 }else if(hasMessages&&bytes(view.originalMessages)>limits.maxContextBytes){
  view.originalMessages={status:'unavailable',reason:'source_identity_context_capacity',messages:null,truncated:false};
 }
 view.provenance=provenance;
 return {...result,presentation:{...result.presentation,sourceContext:view}};
}
