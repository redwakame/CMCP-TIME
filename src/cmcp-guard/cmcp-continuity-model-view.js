import {createHash} from 'node:crypto';

const REF='$cmcpExactRef';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const escaped=key=>String(key).replaceAll('~','~0').replaceAll('/','~1');
// 適用範圍的查證綁定沿既有無損編碼；目前計畫的 applicability 與用途 finding 仍直接呈現。
const secondary=new Set(['knownEvolution','planBasis','planChanges','planEvidence','scopedPlanBindings']);
// 還原是查證與重送的一部分；在配置展開物件之前限制工作與位元組。
export const CMCP_CONTINUITY_MODEL_VIEW_LIMITS=Object.freeze({maxEnvelopeBytes:1048576,maxExpandedProjectionBytes:131072,maxDepth:64,maxVisitedNodes:65536});
function budget(){
 const limits=CMCP_CONTINUITY_MODEL_VIEW_LIMITS;let total=0,nodes=0,projectionStart=null;
 return {visit(depth){if(depth>limits.maxDepth||++nodes>limits.maxVisitedNodes)throw Error('continuity_model_view_work_limit');},
  add(count){total+=count;if(total>limits.maxEnvelopeBytes||projectionStart!==null&&total-projectionStart>limits.maxExpandedProjectionBytes)
   throw Error('continuity_model_view_expanded_limit');},
  beginProjection(){projectionStart=total;},endProjection(){projectionStart=null;}};
}
function inspectInput(value){
 const meter=budget(),active=new Set();
 function walk(item,depth){
  meter.visit(depth);
  if(item===null||typeof item!=='object'){
   if(item!==null&&!['string','boolean','number'].includes(typeof item)||typeof item==='number'&&!Number.isFinite(item))throw Error('continuity_model_view_invalid');
   meter.add(bytes(item));return;
  }
  if(active.has(item))throw Error('continuity_model_view_invalid');active.add(item);
  const entries=Object.entries(item);meter.add(2+Math.max(0,entries.length-1));
  for(const [key,child]of entries){if(!Array.isArray(item))meter.add(bytes(key)+1);walk(child,depth+1);}
  active.delete(item);
 }
 walk(value,0);
}
function plain(value,active=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value)&&!Object.is(value,-0);
 if(typeof value!=='object'||active.has(value)||(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype)||Object.hasOwn(value,REF))return false;
 if(Object.getOwnPropertySymbols(value).length||Array.isArray(value)&&Object.keys(value).some((key,index)=>key!==String(index))
  ||Array.isArray(value)&&Object.keys(value).length!==value.length)return false;
 active.add(value);const result=Object.values(value).every(item=>plain(item,active));active.delete(value);return result;
}

/** 模型傳輸視圖；主視圖直接可讀，只有完全相同的次要物件共用同一訊息內的值。 */
export function projectContinuityModelView(value){
 if(value?.kind!=='cmcp_continuity_projection'||!['ready','partial'].includes(value.status)||!value.projection)return value;
 // 已編碼的結果只能在完整雜湊及參照驗證後重送；不能把外加 metadata 當成可信視圖。
 if(Object.hasOwn(value??{},'modelView')){restoreContinuityModelView(value);return value;}
 if(!plain(value))return value;
 const canonical=new Map(),full=structuredClone(value),projection=full.projection;
 function remember(item,pointer){
  if(!item||typeof item!=='object')return;
  const serialized=JSON.stringify(item);
  if(Buffer.byteLength(serialized)>=160&&!canonical.has(serialized))canonical.set(serialized,pointer);
  for(const [key,child]of Object.entries(item))remember(child,`${pointer}/${escaped(key)}`);
 }
 // 現況、理由、關係、未知、來源、時間與覆蓋直接呈現；不把它們變成參照表。
 for(const [key,item]of Object.entries(projection))if(!secondary.has(key))remember(item,`/projection/${escaped(key)}`);
 let references=0;
 function compact(item,pointer){
  if(!item||typeof item!=='object')return item;
  const serialized=JSON.stringify(item),existing=canonical.get(serialized);
  if(existing!==undefined){const reference={[REF]:existing};
   if(Buffer.byteLength(serialized)-bytes(reference)>=96){references++;return reference;}
  }
  // 路徑只指向確實留在本結果的物件；不同來源、版本、時間或引文不共用。
  if(Buffer.byteLength(serialized)>=160&&!canonical.has(serialized))canonical.set(serialized,pointer);
  const entries=Object.entries(item).map(([key,child])=>[key,compact(child,`${pointer}/${escaped(key)}`)]);
  return Array.isArray(item)?entries.map(([,child])=>child):Object.fromEntries(entries);
 }
 for(const [key,item]of Object.entries(projection))if(secondary.has(key))projection[key]=compact(item,`/projection/${escaped(key)}`);
 if(!references)return value;
 const result={...full,modelView:{version:1,encoding:'exact_object_references',referenceKey:REF,
  referenceRoot:'this_tool_result',
  instruction:'An object containing only $cmcpExactRef has exactly the complete value at that JSON Pointer in this same result. It is not missing, unknown, withdrawn, or a new semantic relation. Main views remain inline; resolve references when inspecting historical details or scope-binding evidence. projectionHash identifies the restored full Core projection.',
  sourceResultSha256:hash(value),viewResultSha256:hash(full)}};
 return bytes(result)<bytes(value)?result:value;
}

/** 還原供查證與測試；不讀外部來源、不猜欄位，也不把傳輸參照當成衍生關係。 */
export function restoreContinuityModelView(value){
 if(!Object.hasOwn(value??{},'modelView'))return structuredClone(value);
 inspectInput(value);
 const {modelView,...body}=value;
 if(modelView?.version!==1||modelView.encoding!=='exact_object_references'||modelView.referenceKey!==REF
  ||modelView.referenceRoot!=='this_tool_result'||hash(body)!==modelView.viewResultSha256)throw Error('continuity_model_view_invalid');
 const resolving=new Set(),meter=budget();
 function at(pointer){
  if(typeof pointer!=='string'||!pointer.startsWith('/projection/')||/\~(?![01])/.test(pointer))throw Error('continuity_model_view_reference_invalid');
  let current=body;
  for(const encoded of pointer.slice(1).split('/')){const key=encoded.replaceAll('~1','/').replaceAll('~0','~');
   if(!current||typeof current!=='object'||!Object.hasOwn(current,key))throw Error('continuity_model_view_reference_missing');current=current[key];
  }
  if(!current||typeof current!=='object')throw Error('continuity_model_view_reference_type');
  return current;
 }
 function expand(item,depth=0){
  meter.visit(depth);
  if(!item||typeof item!=='object'){meter.add(bytes(item));return item;}
  if(Object.hasOwn(item,REF)){
   if(Object.keys(item).length!==1)throw Error('continuity_model_view_reference_shape');
   const pointer=item[REF];if(resolving.has(pointer))throw Error('continuity_model_view_reference_cycle');
   resolving.add(pointer);const restored=expand(at(pointer),depth+1);resolving.delete(pointer);return restored;
  }
  const sourceEntries=Object.entries(item);meter.add(2+Math.max(0,sourceEntries.length-1));
  const entries=sourceEntries.map(([key,child])=>{
   if(!Array.isArray(item))meter.add(bytes(key)+1);
   if(depth===0&&key==='projection')meter.beginProjection();
   const restored=expand(child,depth+1);
   if(depth===0&&key==='projection')meter.endProjection();
   return [key,restored];
  });
  return Array.isArray(item)?entries.map(([,child])=>child):Object.fromEntries(entries);
 }
 const restored=expand(body);
 if(hash(restored)!==modelView.sourceResultSha256)throw Error('continuity_model_view_restore_mismatch');
 return restored;
}
