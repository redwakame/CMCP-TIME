import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {loopHash} from './cmcp-local-loop-journal.js';

const crossHostAssessment=()=>({status:'not_assessed',assessmentScope:'storage_metadata_only',
  reason:'receiver_handoff_not_assessed_by_storage_status',
  guidance:'此保存狀態未評估接收端交接，不代表交接失敗或尚未取得來源。請另查本回合接收端的正式 reader 來源綁定、完整閱讀及宿主材料／回答回執；本欄不取代那些證據。'});

/** 唯讀中繼資料投影；不建立閱讀票券、活化 Buffer、重試登錄或授權。 */
export async function projectCmcpStorageStatus({scopeId,registration,controls,requiresReopen=false,resolveSource,maxVerifiedSources=16}){
  if(!Number.isSafeInteger(maxVerifiedSources)||maxVerifiedSources<1||maxVerifiedSources>16)throw Error('invalid_storage_status_bound');
  const known=Array.isArray(registration?.sources)&&Array.isArray(registration?.unregistered);
  const controlReason=requiresReopen?'runtime_reopen_required':controls?.enabled!==true?'shared_enhancement_off':controls.clean!==false?'shared_clean':
    controls.historyRecall!==true||controls.answerHistory!==true?'material_controls_disabled':null;
  const retry={available:null,operation:'retry-registration',formalRuntimeMethod:'recover',reason:'requires_authenticated_current_controller',
    guidance:'明示執行 retry-registration，仍核對目前對話／專案授權、控制及 writer。清冊容量或其他根因未排除時仍待處理；不擴容量、不刪除 History。'};
  const base={kind:'cmcp_storage_status',version:1,scopeId,modelCalls:0,readOnly:true,assessmentScope:'storage_metadata_only',
    boundary:'原件核驗、清冊登錄與正式 reader 資格分列；資格不等於已正式閱讀、模型已取得或跨宿主交接成立。',retry};
  if(!known)return {...base,status:'unknown',reason:'registration_state_unknown',counts:null,sources:[],
    inventory:{status:registration?.inventoryStatus??'unknown',complete:null},crossHost:crossHostAssessment()};
  const entries=new Map(registration.sources.map(row=>[cmcpSourcePointerKey(row.pointer),row]));
  const pending=new Map(registration.unregistered.map(pointer=>[cmcpSourcePointerKey(pointer),pointer]));
  const pointers=new Map([...registration.sources.map(row=>[cmcpSourcePointerKey(row.pointer),row.pointer]),...pending]);
  const failures=new Map((registration.failures??[]).map(row=>[cmcpSourcePointerKey(row.pointer),row.code]));
  const sources=[];let verified=0;
  for(const [key,pointer]of pointers){
    const entry=entries.get(key),registered=!!entry;
    const row={pointer,sourceId:entry?.id??null,evidenceHash:entry?.evidenceHash??null,
      sourceAuthorRole:entry?.sourceAuthorRole??null,messageRecordedAt:entry?.messageRecordedAt??null,
      original:{status:'unknown',reason:controlReason??'source_resolution_not_observed'},
      registration:{status:registered?'registered':failures.has(key)?'failed':'pending',pending:!registered,retryRequired:!registered,reason:registered?null:failures.get(key)??'not_registered'},
      formalRead:{status:'unknown',reason:'original_not_verified',proof:'reader_eligibility_not_read_receipt'},
      crossHost:crossHostAssessment()};
    if(pointer.scopeId!==scopeId)row.original={status:'unknown',reason:'source_outside_authorized_scope'};
    else if(!controlReason&&typeof resolveSource==='function'&&verified<maxVerifiedSources){
      verified++;
      try{
        const found=await resolveSource(pointer);
        if(found?.status==='found'&&found.evidence){
          const same=cmcpSourcePointerKey(found.evidence.pointer)===key,hash=loopHash(found.evidence);
          if(!same||entry&&hash!==entry.evidenceHash)row.original={status:'changed',reason:'source_identity_or_hash_changed'};
          else{row.original={status:'stored',reason:null,verification:'current_formal_provider_pointer_and_hash'};
            row.evidenceHash=hash;row.sourceAuthorRole=found.evidence.sourceAuthorRole;row.messageRecordedAt=found.evidence.messageRecordedAt;}
        }else{
          const status=['missing','changed','revoked','deleted','permission_denied','unavailable','unsupported'].includes(found?.status)?found.status:'unknown';
          row.original={status,reason:status==='unknown'?'source_resolution_unknown':'source_'+status};
        }
      }catch{row.original={status:'unavailable',reason:'source_verification_failed'};}
    }else if(!controlReason&&verified>=maxVerifiedSources)row.original.reason='bounded_status_not_checked';
    const reason=controlReason??(pointer.scopeId!==scopeId?'source_outside_authorized_scope':null)
      ??(!registered?'source_registration_pending':null)??(row.original.status!=='stored'?row.original.reason:null);
    row.formalRead={status:reason?(row.original.status==='unknown'&&!controlReason&&registered?'unknown':'blocked'):'eligible',
      reason,proof:'reader_eligibility_not_read_receipt'};
    sources.push(row);
  }
  const counts={knownSources:sources.length,originalStored:sources.filter(s=>s.original.status==='stored').length,
    originalUnknown:sources.filter(s=>s.original.status==='unknown').length,
    originalUnavailable:sources.filter(s=>!['stored','unknown'].includes(s.original.status)).length,
    registered:registration.sources.length,registrationPending:pending.size,
    registrationFailed:sources.filter(s=>s.registration.status==='failed').length,
    registrationFailureRecords:(registration.failures??[]).length,readerEligible:sources.filter(s=>s.formalRead.status==='eligible').length,
    readerBlocked:sources.filter(s=>s.formalRead.status==='blocked').length,readerUnknown:sources.filter(s=>s.formalRead.status==='unknown').length};
  return {...base,status:controlReason?'blocked':registration.inventoryComplete!==true||counts.registrationPending||counts.originalUnknown||counts.originalUnavailable?'partial':'verified_metadata',
    reason:controlReason,counts,sources,verification:{checked:verified,maxVerifiedSources,remaining:sources.length-verified,scope:'bounded_current_provider_checks'},inventory:{status:registration.inventoryStatus??'unknown',complete:registration.inventoryComplete===true,
      failures:registration.inventoryFailures??[],recordCount:registration.inventoryRecordCount??null},
    crossHost:crossHostAssessment()};
}
