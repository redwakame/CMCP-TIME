import {createHash,randomUUID} from 'node:crypto';
import {projectContinuityModelView,restoreContinuityModelView} from './continuity-model-view.mjs';

// 正式結果的短期傳輸視圖；原件、授權與來源仍由 Runtime 每頁核對。
export const CONTINUITY_PAGE_CHARS=32000;
export const CONTINUITY_COMPOSITION_BYTES=2048;
export const CONTINUITY_PAGE_PARAMETERS={type:'object',properties:{ticket:{type:'string'},deliveryId:{type:'string'},page:{type:'string',pattern:'^[0-9]{1,2}$'}},required:['ticket','deliveryId','page'],additionalProperties:false};
export const CONTINUITY_PAGE_DESCRIPTION='讀取 cmcp_project_continuity 回傳的同回合正式結果下一頁。依 delivery.nextPage 逐頁取得全部 sections；path 是完整結果內 JSON Pointer，並非另一份來源。delivery.complete=false 時不能稱完整取得投影。每頁重新核對票券、來源版本、控制及取消；不重提 proposal、不讀暫存 spill。';
const hash=s=>createHash('sha256').update(s).digest('hex');
const escape=s=>s.replaceAll('~','~0').replaceAll('/','~1');
const copy=v=>JSON.parse(JSON.stringify(v));
/** 可信傳輸規約；只指回既有表示，不產生答案、採納關係或新的 Core 證據。 */
function compositionBoundary(result,transportCoverage){
  if(result?.kind!=='cmcp_continuity_projection'||!['ready','partial'].includes(result.status)||!result.projection
    ||typeof result.ticket!=='string'||!result.ticket||typeof result.projectionHash!=='string'||!/^[a-f0-9]{64}$/.test(result.projectionHash))return null;
  const candidates=[['current_plans','/projection/currentPlans',result.projection.currentPlans],
    ['reported_claims','/projection/currentClaims',result.projection.currentClaims],
    ['source_roles','/projection/sources',result.projection.sources],['source_coverage','/projection/coverage',result.projection.coverage],
    ['original_sources','/presentation/sourceContext',result.presentation?.sourceContext],
    ['capture_identity','/sourceOrigins',result.sourceOrigins]];
  const scopedQuotation=result.presentation?.quotationView?.status==='available'
    &&result.presentation.quotationView.currentPlans?.some(plan=>plan.quotations?.some(quote=>quote.scopeAnnotations?.length));
  if(scopedQuotation)candidates.push(['scope_bound_quotations','/presentation/quotationView',result.presentation.quotationView]);
  const value={kind:'cmcp_answer_composition_boundary',version:1,authority:'trusted_transport_contract_not_user_source_or_core_receipt',
    projectionHash:result.projectionHash,projectionStatus:result.status,transportCoverage,
    semanticVerification:'not_performed',executionAuthority:'none',ticketReference:'/ticket',
    references:candidates.filter(([, ,value])=>value!==undefined).map(([purpose,path])=>({purpose,path})),
    instruction:'正式材料已完整提供時，再核對可見答案每項的來源與作用範圍。User 條件與回報沿本結果及正式 User 原文；Assistant 草稿新增的流程、順序與細節，未有 User 明說採納仍是建議。「其餘維持」不把它們升格成 User 條件。混合段逐項區分：有 User 依據的條件不降級，新增建議不升格。可提出建議或推論，須明示其身分；來源不足按需補讀，不用草稿補成已定。答案提及原時間時，沿 sourceContext.metadata.sources 同 ref／角色／原時間／hash 的 messageRecordedAt／localMessageRecordedAt 已給值核對，不另猜時區或拿現在、相鄰回覆時間代替；未知保留未知，不要求每答列時間。partial、完整傳輸與結構通過均不等於語意已驗、全歷史完整或執行授權。'};
  if(scopedQuotation)value.instruction+=' quotationView 的 scopeAnnotations 限定舊聯合引文的保留對象；依附註核對修訂與保留原話，不把原引文的共同用語擴回已修改對象。';
  if(Buffer.byteLength(JSON.stringify(value))>CONTINUITY_COMPOSITION_BYTES)throw Error('continuity_composition_capacity_exceeded');
  return value;
}
function sections(value,path='',out=[]){
  const serialized=JSON.stringify(value);
  if(serialized.length<=24000){out.push({path,value});return out;}
  if(typeof value==='string'){
    for(let start=0;start<value.length;start+=6000)out.push({path,stringPart:{start,total:value.length,text:value.slice(start,start+6000)}});
  }else if(value&&typeof value==='object'){
    out.push({path,container:Array.isArray(value)?'array':'object'});
    for(const [key,child]of Object.entries(value))sections(child,path+'/'+escape(key),out);
  }else throw Error('continuity_delivery_value_too_large');
  return out;
}
export function createContinuityDelivery(result){
  const model=projectContinuityModelView(result),json=JSON.stringify(model);
  if(!['ready','partial'].includes(result?.status)||!result.projection)return {inline:copy(model)};
  const boundary=compositionBoundary(result,'complete_result_not_model_delivery');
  if(json.length<=CONTINUITY_PAGE_CHARS){
    // 已編碼的封套先正式驗證／還原；新 metadata 在可信編碼前加入，兩個視圖雜湊仍可核對。
    const full=restoreContinuityModelView(model),inline=boundary?projectContinuityModelView({...full,compositionBoundary:boundary}):model;
    if(JSON.stringify(inline).length<=CONTINUITY_PAGE_CHARS)return {inline:copy(inline)};
  }
  if(Buffer.byteLength(json)>1048576)throw Error('continuity_delivery_capacity_exceeded');
  const deliveryId=randomUUID(),resultHash=hash(json),pages=[],items=sections(model);
  let batch=[];
  for(const item of items){
    if(JSON.stringify([...batch,item]).length>28000){pages.push(batch);batch=[];}
    batch.push(item);
  }
  if(batch.length)pages.push(batch);
  if(pages.length>64)throw Error('continuity_delivery_page_capacity_exceeded');
  return {deliveryId,ticket:result.ticket,projectionHash:result.projectionHash,resultHash,resultBytes:Buffer.byteLength(json),resultChars:json.length,
    projectionStatus:result.status,projectionReason:result.reason??null,compositionBoundary:boundary,pages,provided:new Set(),publications:new Map()};
}
function preparedPage(delivery,index,publicationId){
  const prospective=new Set([...delivery.provided,index]);
  const complete=prospective.size===delivery.pages.length;
  const result={kind:'cmcp_continuity_delivery_page',status:'prepared',ticket:delivery.ticket,projectionHash:delivery.projectionHash,
    projectionStatus:delivery.projectionStatus,projectionReason:delivery.projectionReason,modelCalls:0,
    delivery:{version:1,id:delivery.deliveryId,resultHash:delivery.resultHash,resultBytes:delivery.resultBytes,resultChars:delivery.resultChars,
      page:index,pageCount:delivery.pages.length,publicationId,providedPages:[...prospective].sort((a,b)=>a-b),complete,nextPage:complete?null:String(delivery.pages.findIndex((_,i)=>!prospective.has(i))),
      merge:'sections 的 path 指向同一完整結果；container 建立容器，value 保留完整子樹；stringPart 按 start 串接。精確參照依完整結果解析。',
      evidenceLevel:'formal_tool_result_prepared_not_published'},
    continuation:{operation:complete?null:'cmcp_read_continuity',
      purpose:complete?'selected_result_fully_provided':'read_remaining_sections_of_this_result_before_claiming_full_coverage',
      review:delivery.projectionReason==='report_scope_review_required'?'report_use_review_pending_in_projection.reportScopeReview;_after_reading_check_current_findings_and_requiredResolutionKind;_reportRef_uses_finding.report.source.ref_not_nodeId':null,
      automaticResolution:false,executionAuthority:'none'},sections:copy(delivery.pages[index])};
  return result;
}
function completedBoundary(delivery,result){
  return result.delivery.complete&&result.delivery.page===delivery.pages.length-1&&delivery.compositionBoundary
    ?{...copy(delivery.compositionBoundary),transportCoverage:'complete_result_provided_not_model_comprehension'}:null;
}
function withCompletedBoundary(delivery,result){
  const boundary=completedBoundary(delivery,result);
  return boundary?{...result,compositionBoundary:boundary}:result;
}
export function continuityDeliveryPage(delivery,index){
  if(!Number.isInteger(index)||index<0||index>=delivery.pages.length)throw Error('continuity_delivery_page_invalid');
  // 只能順序提供或重讀已有頁；不能跳頁後宣稱完整取得。
  if(index>0&&!delivery.provided.has(index-1))throw Error('continuity_delivery_previous_page_required');
  const result=preparedPage(delivery,index,randomUUID());
  // 預留可信提交後的最後頁提示；prepared 本身沒有可作答的完整交付提示。
  if(JSON.stringify(withCompletedBoundary(delivery,result)).length>CONTINUITY_PAGE_CHARS)throw Error('continuity_delivery_page_capacity_exceeded');
  return result;
}

/** 準備不計已提供；可信出口完成最後核對後才提交這次頁面。 */
export function commitContinuityDeliveryPage(delivery,result){
  const d=result?.delivery,index=d?.page;
  if(result?.kind!=='cmcp_continuity_delivery_page'||result.status!=='prepared'||result.ticket!==delivery.ticket
    ||result.projectionHash!==delivery.projectionHash||d?.id!==delivery.deliveryId||d?.resultHash!==delivery.resultHash
    ||result.projectionStatus!==delivery.projectionStatus||result.projectionReason!==delivery.projectionReason
    ||d.resultBytes!==delivery.resultBytes||d.resultChars!==delivery.resultChars||d.pageCount!==delivery.pages.length
    ||typeof d.publicationId!=='string'||!d.publicationId||delivery.publications.has(d.publicationId)
    ||!Number.isInteger(index)||index<0||index>=delivery.pages.length
    ||JSON.stringify(result)!==JSON.stringify(preparedPage(delivery,index,d.publicationId)))throw Error('continuity_delivery_publication_invalid');
  if(index>0&&!delivery.provided.has(index-1))throw Error('continuity_delivery_previous_page_required');
  if(delivery.publications.size>=256)throw Error('continuity_delivery_publication_capacity_exceeded');
  if(JSON.stringify(withCompletedBoundary(delivery,result)).length>CONTINUITY_PAGE_CHARS)throw Error('continuity_delivery_page_capacity_exceeded');
  delivery.provided.add(index);
  result.status='provided';d.evidenceLevel='formal_tool_result_provided_not_model_comprehension';
  d.providedPages=[...delivery.provided].sort((a,b)=>a-b);d.complete=delivery.provided.size===delivery.pages.length;
  d.nextPage=d.complete?null:String(delivery.pages.findIndex((_,i)=>!delivery.provided.has(i)));
  const boundary=completedBoundary(delivery,result);if(boundary)result.compositionBoundary=boundary;
  delivery.publications.set(d.publicationId,{page:index,providedResultHash:hash(JSON.stringify(result))});
  return result;
}

/** 外層出口拒絕時僅撤回該次提交；成功重讀不會被另一個晚到拒絕撤回。 */
export function rejectContinuityDeliveryPage(delivery,result){
  const d=result?.delivery,publication=delivery?.publications?.get(d?.publicationId);
  if(!publication||result.ticket!==delivery.ticket||result.projectionHash!==delivery.projectionHash||d.id!==delivery.deliveryId
    ||d.resultHash!==delivery.resultHash||publication.page!==d.page||publication.providedResultHash!==hash(JSON.stringify(result)))return false;
  delivery.publications.delete(d.publicationId);
  if(![...delivery.publications.values()].some(row=>row.page===publication.page))delivery.provided.delete(publication.page);
  delete result.compositionBoundary;
  return true;
}

// 供驗收／非模型客戶端核對全頁完整性，不修改正式資料。
export function restoreContinuityDelivery(pages){
  if(!pages.length)throw Error('continuity_delivery_incomplete');
  const first=pages[0],ordered=[...pages].sort((a,b)=>a.delivery.page-b.delivery.page);
  const equalKeys=['id','resultHash','resultBytes','resultChars','pageCount'];
  if(ordered.length!==first.delivery.pageCount||ordered.some((p,i)=>p.kind!==first.kind||p.ticket!==first.ticket||p.projectionHash!==first.projectionHash||p.projectionStatus!==first.projectionStatus||p.projectionReason!==first.projectionReason||p.delivery.page!==i||equalKeys.some(k=>p.delivery[k]!==first.delivery[k])))throw Error('continuity_delivery_incomplete');
  let root;const strings=new Map();
  function set(pointer,value){if(pointer===''){root=value;return;}const keys=pointer.slice(1).split('/').map(k=>k.replaceAll('~1','/').replaceAll('~0','~'));
    if(keys.some(k=>['__proto__','prototype','constructor'].includes(k)))throw Error('continuity_delivery_unsafe_path');
    let target=root;for(const key of keys.slice(0,-1))target=target[key];target[keys.at(-1)]=value;}
  for(const page of ordered)for(const item of page.sections){
    if(item.container)set(item.path,item.container==='array'?[]:{});
    else if(item.stringPart){const p=item.stringPart,old=strings.get(item.path)??'';if(p.start!==old.length)throw Error('continuity_delivery_string_gap');const text=old+p.text;strings.set(item.path,text);if(text.length===p.total)set(item.path,text);}
    else set(item.path,copy(item.value));
  }
  const restored=JSON.stringify(root);
  if(hash(restored)!==first.delivery.resultHash||restored.length!==first.delivery.resultChars||Buffer.byteLength(restored)!==first.delivery.resultBytes)throw Error('continuity_delivery_hash_mismatch');
  for(const page of ordered)if(Object.hasOwn(page,'compositionBoundary')){
    const expected=compositionBoundary(root,'complete_result_provided_not_model_comprehension');
    if(page.status!=='provided'||page.delivery.page!==page.delivery.pageCount-1||page.delivery.complete!==true||!expected
      ||JSON.stringify(page.compositionBoundary)!==JSON.stringify(expected))throw Error('continuity_composition_boundary_invalid');
  }
  return root;
}
