import path from 'node:path';
import {createLocalLoopJournal,loopHash} from './cmcp-local-loop-journal.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {readCmcpSelectedHistory} from './cmcp-history-reactivation.js';

const key=cmcpSourcePointerKey,copy=value=>structuredClone(value),bytes=value=>Buffer.byteLength(JSON.stringify(value));
const defaults=Object.freeze({maxSources:2,maxSourceBytes:4096,maxProjectionBytes:6144,maxMaterializedSourceBytes:65536});
const controlKeys=['enabled','clean','historyRecall','answerHistory','readingLimits'];
const enabled=snapshot=>snapshot.effective.enabled&&!snapshot.effective.clean&&snapshot.effective.historyRecall&&snapshot.effective.answerHistory;
const stamp=snapshot=>loopHash(controlKeys.map(name=>[name,snapshot.effective[name],snapshot.featureRevisions?.[name]??0]));

/** Read only exact answer-to-focus reply edges already recorded by the normal
 * Runtime. No lexical topic guess, new User, focus activation or summary write. */
export function createCmcpProactiveHistory({stores,catalog,getControls,limits={}}){
  const bound={...defaults,...limits};
  if(!stores?.root||!stores.scopeId||typeof stores.history?.resolve!=='function'||typeof catalog?.list!=='function'
    ||typeof getControls!=='function'||Object.keys(bound).some(k=>!Object.hasOwn(defaults,k))
    ||Object.values(bound).some(n=>!Number.isSafeInteger(n)||n<1)||bound.maxSources>2)throw Error('invalid_proactive_history_dependencies');
  const journal=createLocalLoopJournal({root:path.join(stores.root,'input-journal'),name:'cmcp-common-input-v1'});
  const bindings=async()=> (await journal.read()).map(row=>row.record).filter(row=>row.kind==='assistant_reply_binding').map(row=>row.value);
  async function exact(entry,role){
    if(entry.pointer?.scopeId!==stores.scopeId)throw Error('proactive_history_scope');
    const source=await resolveCmcpHistorySource({provider:stores.history,pointer:entry.pointer});
    if(source.status!=='found')throw Error('proactive_history_source_unavailable');
    if(source.evidence.sourceAuthorRole!==role||loopHash(source.evidence)!==entry.evidenceHash)throw Error('proactive_history_source_changed');
    return source.evidence;
  }
  async function verify(receipt,{valid=async()=>true}={}){
    if(!await valid())throw Error('proactive_history_cancelled');
    if(!receipt||receipt.kind!=='proactive_reply_read_v1'||receipt.scopeId!==stores.scopeId)throw Error('proactive_history_receipt_required');
    if(receipt.status==='disabled')return true;
    const snapshot=await getControls();
    if(!enabled(snapshot)||stamp(snapshot)!==receipt.controlStamp)throw Error('proactive_history_controls_changed');
    const current=await bindings(),entries=await catalog.list();
    for(const item of receipt.read){
      if(!await valid())throw Error('proactive_history_cancelled');
      const matches=current.filter(row=>key(row.pointer)===key(item.binding.pointer));
      if(matches.length!==1||loopHash(matches[0])!==item.bindingHash)throw Error('proactive_reply_binding_changed');
      const entry=entries.find(row=>key(row.pointer)===key(item.binding.pointer));
      if(!entry||entry.sourceAuthorRole!=='assistant'||entry.evidenceHash!==item.binding.sourceHash)throw Error('proactive_reply_catalog_changed');
      await exact({pointer:item.binding.replyTo,evidenceHash:item.binding.replyToEvidenceHash},'user');
      await exact(entry,'assistant');
    }
    if(!await valid()||stamp(await getControls())!==receipt.controlStamp)throw Error('proactive_history_controls_changed');
    return true;
  }
  async function prepare({eventKey=null,sources,temporal,valid=async()=>true,maxProjectionBytes=bound.maxProjectionBytes}){
    if(!Array.isArray(sources)||sources.some(source=>source.pointer?.scopeId!==stores.scopeId))throw Error('proactive_history_scope');
    const snapshot=await getControls();
    const receipt={kind:'proactive_reply_read_v1',scopeId:stores.scopeId,status:'disabled',controlStamp:stamp(snapshot),
      eventKey,read:[],unavailable:[],unread:[],omitted:[],formalReads:0,readAttempts:0,sourceBytes:0,projectedSourceBytes:0,materializedSourceBytes:0,
      projectionBytes:0,costBasis:'formal_reader_only_not_guard_revalidation_IO',activation:'none'};
    const model={kind:'bounded_exact_focus_replies',status:'disabled',roleBoundary:'Assistant replies are prior proposals or statements, not User adoption or verified external facts.',sources:[],
      coverage:{basis:'formal_reply_to_selected_user_sources',matchedReplies:0,readReplies:0,projectedReplies:0,unreadReplies:0,unavailableReplies:0,omittedFromProjection:0,completeWithinMatchedReplies:false}};
    if(!enabled(snapshot))return {model,receipt};
    const guard=async()=>{if(!await valid())return false;const current=await getControls();return enabled(current)&&stamp(current)===receipt.controlStamp;};
    if(!await guard())throw Error('proactive_history_cancelled');
    const all=await bindings(),entries=await catalog.list(),parents=new Map(sources.map((source,index)=>[key(source.pointer),{...source,ref:'s'+(index+1)}]));
    const matched=all.filter(row=>row.version===1&&row.basis==='runtime_observed_answer_to_exact_user_source'
      &&(eventKey===null||row.eventKey===eventKey)&&parents.has(key(row.replyTo)));
    const seen=new Set(),selected=[];
    for(const binding of matched){
      const identity=key(binding.pointer);if(seen.has(identity))throw Error('proactive_reply_binding_ambiguous');seen.add(identity);
      const parent=parents.get(key(binding.replyTo)),entry=entries.find(row=>key(row.pointer)===identity);
      if(binding.pointer.scopeId!==stores.scopeId||parent.evidence.sourceAuthorRole!=='user'
        ||parent.evidenceHash!==binding.replyToEvidenceHash||!entry||entry.sourceAuthorRole!=='assistant'
        ||entry.evidenceHash!==binding.sourceHash)throw Error('proactive_reply_binding_invalid');
      selected.push({binding,entry,parent});
    }
    // Exact current focus membership supplies relevance. Stored reply order does
    // not establish chronology, completion, adoption or an event relationship.
    const policy=snapshot.effective.readingLimits??{};
    if(!selected.length){
      model.status=receipt.status='none';receipt.projectionBytes=bytes(model);
      if(!await guard())throw Error('proactive_history_cancelled');
      return {model,receipt};
    }
    const maxSources=Math.min(bound.maxSources,policy.maxSources??bound.maxSources);
    const maxSourceBytes=Math.min(bound.maxSourceBytes,policy.maxReadBytes??bound.maxSourceBytes);
    const projectionLimit=Math.min(bound.maxProjectionBytes,maxProjectionBytes,policy.maxProjectionBytes??bound.maxProjectionBytes);
    if(!Number.isSafeInteger(projectionLimit)||projectionLimit<1)throw Error('proactive_history_projection_budget');
    model.status='none';receipt.status='none';model.coverage.matchedReplies=selected.length;
    for(const [index,item] of selected.entries()){
      if(!await guard())throw Error('proactive_history_cancelled');
      if(index>=maxSources||receipt.materializedSourceBytes>=maxSourceBytes){receipt.unread.push({pointer:copy(item.binding.pointer),reason:'source_budget'});continue;}
      const {entry,binding,parent}=item;
      const range=entry.location;
      if(range?.unit!=='unicode_code_points'||range.start!==0||!Number.isSafeInteger(range.end)||range.end<1)throw Error('proactive_reply_full_range_unknown');
      // The Provider may materialize a whole original before a bounded reader
      // can reject it. Count that actual I/O even on rejection; it cannot give
      // the next source a fresh allowance. Successful reads and model-projected
      // content have separate counters, including a read later omitted to fit.
      let read,materialized=0;
      const readingStores={...stores,history:{...stores.history,resolve:async pointer=>{
        const result=await stores.history.resolve(pointer);
        if(result?.status==='found'&&typeof result.evidence?.content?.body==='string')materialized+=Buffer.byteLength(result.evidence.content.body);
        return result;
      }}};
      receipt.readAttempts++;
      try{
        read=await readCmcpSelectedHistory({stores:readingStores,selected:[{id:entry.id,pointer:entry.pointer,evidenceHash:entry.evidenceHash,readRange:range}],
          temporal,contextOnly:true,valid:guard,limits:{maxSourceBytes:maxSourceBytes-receipt.materializedSourceBytes,
            maxProjectionBytes:projectionLimit,maxMaterializedSourceBytes:Math.max(1,bound.maxMaterializedSourceBytes-receipt.materializedSourceBytes)}});
      }catch(error){
        if(['selected_source_budget','selected_source_oversize','reactivation_projection_budget','materialized_source_budget'].includes(error.message)){
          receipt.unread.push({pointer:copy(binding.pointer),reason:'bounded_original_does_not_fit'});continue;
        }
        throw error;
      }finally{receipt.materializedSourceBytes+=materialized;}
      if(read.status!=='found'){receipt.unavailable.push({pointer:copy(binding.pointer),reason:read.reason});continue;}
      receipt.formalReads++;receipt.sourceBytes+=read.sourceBytes;
      const projected=read.projected.evidence[0];
      if(projected.source.sourceAuthorRole!=='assistant')throw Error('proactive_reply_role_changed');
      const source={ref:'a'+(model.sources.length+1),replyTo:parent.ref,sourceAuthorRole:'assistant',
        messageRecordedAt:projected.time.messageRecordedAt,messageRecordedAtLocal:projected.time.localMessageRecordedAt,
        eventOccurredAt:projected.time.eventOccurredAt,content:{kind:'exact_prior_reply',text:projected.content},readRange:projected.readRange};
      model.sources.push(source);
      if(bytes(model)>projectionLimit){model.sources.pop();receipt.omitted.push({pointer:copy(binding.pointer),reason:'read_but_not_projected_budget'});continue;}
      receipt.read.push({binding:copy(binding),bindingHash:loopHash(binding),readRanges:copy(read.readRanges)});
      receipt.projectedSourceBytes+=read.sourceBytes;
    }
    model.coverage.readReplies=receipt.formalReads;model.coverage.projectedReplies=receipt.read.length;model.coverage.unreadReplies=receipt.unread.length;
    model.coverage.unavailableReplies=receipt.unavailable.length;model.coverage.omittedFromProjection=receipt.omitted.length;
    model.coverage.completeWithinMatchedReplies=selected.length>0&&receipt.read.length===selected.length;
    model.status=receipt.status=receipt.unread.length||receipt.unavailable.length||receipt.omitted.length?'partial':receipt.read.length?'read':'none';
    receipt.projectionBytes=bytes(model);
    if(receipt.projectionBytes>projectionLimit)throw Error('proactive_history_projection_budget');
    await verify(receipt,{valid});return {model,receipt};
  }
  return Object.freeze({prepare,verify,limits:copy(bound)});
}
