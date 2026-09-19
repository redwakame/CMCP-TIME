import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLocalLoopJournal,loopHash} from './cmcp-local-loop-journal.js';
import {createCmcpSourceIndexSegments} from './cmcp-source-index-segments.js';
import {createCmcpFileHistoryBackend as files} from './cmcp-file-history-backend.js';
import {createCmcpLocalHistoryProvider} from './cmcp-local-history-provider.js';
import {createCmcpEventLineageStore} from './cmcp-event-lineage-store.js';
import {createCmcpSourceEvidence} from './cmcp-source-evidence.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {resolveCmcpHistorySource} from './cmcp-history-provider.js';
import {resolveCmcpTemporalEvidence} from './resolve-cmcp-temporal-evidence.js';
import {projectCmcpTemporalEvidence} from './project-cmcp-temporal-evidence.js';
import {resolveCmcpTimeContext,parseCmcpInstant} from './resolve-cmcp-time-context.js';
import {createCmcpAssistantTiming,observeCmcpAssistantTime} from './cmcp-assistant-timing.js';
import {projectCmcpRuntimeTime} from './project-cmcp-local-time.js';
import {readCmcpBufferBoundary,assertCmcpBufferGeneration,withCmcpBufferPublication,cmcpBufferExpiry,projectCmcpBufferState} from './cmcp-buffer-lifecycle.js';
import {buildLoopRequest,decodeLoopResponse,LOOP_SCHEMAS,validateLoopSchema} from './cmcp-local-loop-protocol.js';
import {projectCmcpDialogueCatalogContext} from './cmcp-dialogue-source-binding.js';
import {resolveCmcpReadingQuery,assertCmcpEphemeralQueryText} from './cmcp-reading-query-authorization.js';

const copy=value=>structuredClone(value),bytes=value=>Buffer.byteLength(JSON.stringify(value));
const positive=n=>Number.isSafeInteger(n)&&n>0;
const sourceHint=source=>{const points=[...source.content.body],text=points.slice(0,80).join('');return {
  kind:source.content.kind,text,purpose:'source_locator_not_complete_evidence',
  location:{unit:'unicode_code_points',start:0,end:[...text].length},complete:points.length<=80};};
export function createCmcpReactivationStores({root,scopeId,providerNamespace='cmcp-local-console-v1'}){
  if(!path.isAbsolute(root)||typeof scopeId!=='string'||!scopeId)throw Error('explicit_reactivation_scope_required');
  const history=createCmcpLocalHistoryProvider({providerNamespace,backend:files({root:path.join(root,'history')})});
  const eventBackend=files({root:path.join(root,'event')});
  return {root,scopeId,history,eventBackend,eventStore(event,provider=history){
    if(event.scopeId!==scopeId)throw Error('event_scope_mismatch');
    return createCmcpEventLineageStore({event,historyProvider:provider,backend:eventBackend});
  }};
}

/** Caller-authorized index, not another History store. No raw body or inferred time is saved here. */
export function createCmcpTemporalSourceCatalog({stores,maxEntries,maxSegments=1}){
  if(!positive(maxEntries))throw Error('catalog_limit_required');
  const journal=createCmcpSourceIndexSegments({root:path.join(stores.root,'source-index'),name:'cmcp-temporal-source-index-v1',maxEntries,maxSegments});
  async function list(){const entries=new Map();for(const row of await journal.read())entries.set(row.record.value.id,row.record.value);return [...entries.values()];}
  async function batchValid(batch){if(batch&&(!batch.active||!await batch.valid()))throw Error('catalog_batch_cancelled');}
  async function publish(kind,entry,batch){await batchValid(batch);await journal.append(kind,entry);batch?.entries.set(entry.id,copy(entry));}
  async function sourceFor(pointer){
    if(pointer?.scopeId!==stores.scopeId)throw Error('catalog_scope_mismatch');
    const found=await resolveCmcpHistorySource({provider:stores.history,pointer});
    if(found.status!=='found')throw Error('catalog_source_'+found.status);return found.evidence;
  }
  async function registerSource({pointer},batch=null){
    await batchValid(batch);
    const source=await sourceFor(pointer),id=loopHash(cmcpSourcePointerKey(pointer)),entries=batch?.entries??new Map((await list()).map(row=>[row.id,row])),same=entries.get(id);
    await batchValid(batch);
    if(same){
      if(same.evidenceHash!==loopHash(source))throw Error('catalog_entry_conflict');
      if(same.sourceHint)return {status:'unchanged',entry:copy(same)};
      // Bounded, caller-triggered repair of legacy metadata; immutable original evidence remains untouched.
      const entry={...same,sourceHint:sourceHint(source)};await publish('locator',entry,batch);return {status:'updated',entry};
    }
    const points=[...source.content.body],excerpt=points.slice(0,80).join('');
    const entry={id,pointer:source.pointer,eventLink:null,title:source.sourceAuthorRole+' '+source.sourceKind,sourceHint:sourceHint(source),
      synopsis:{kind:source.content.kind,text:excerpt,location:{unit:'unicode_code_points',start:0,end:[...excerpt].length},complete:points.length<=80},
      sourceAuthorRole:source.sourceAuthorRole,sourceKind:source.sourceKind,messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt,
      evidenceHash:loopHash(source),location:{unit:'unicode_code_points',start:0,end:points.length},processing:{registration:'registered',event:'not_requested',dialogue:'not_requested'}};
    await publish('source',entry,batch);return {status:'stored',entry};
  }
    // Annotation is derived from the existing verified Event Store and supported persisted dialogue.
    async function annotate({pointer,event,dialogue=null,eventProcessing='pending',dialogueProcessing='pending'},batch=null){
      const {entry}=await registerSource({pointer},batch),source=await sourceFor(pointer),next=copy(entry);
      if(loopHash(source)!==entry.evidenceHash)throw Error('catalog_entry_conflict');
      await batchValid(batch);
      const store=stores.eventStore(event),eventKey=JSON.stringify(event);
      // A batch verifies the full Event and its exact source snapshots once.
      // No Event writes occur through this capability. Original evidence for
      // every annotated pointer is still resolved/hash-checked above, so a
      // changed source cannot inherit an earlier supported result.
      let topology;
      if(batch){topology=batch.events.get(eventKey);if(!topology){topology=await store.readEvent();batch.events.set(eventKey,topology);}}
      else topology=await store.readEvent({sourceUpdateIds:[]});
      if(!['found','missing'].includes(topology.status))throw Error('catalog_event_unavailable');
      // Annotation belongs to this exact source, not every historical source in
      // the Event. Saved topology supplies identity; selected commands are still
      // checked against their current original role/hash/citation below.
      const sourceUpdateIds=(topology.internal?.records??[]).filter(record=>cmcpSourcePointerKey(record.command.source.pointer)===cmcpSourcePointerKey(pointer)).map(record=>record.command.updateId);
      const result=!batch&&sourceUpdateIds.length?await store.readEvent({sourceUpdateIds}):topology;
      if(!['found','missing'].includes(result.status))throw Error('catalog_event_unavailable');
      const nodes=(result.view?.knownEvolution??[]).filter(node=>node.supported&&cmcpSourcePointerKey(node.source.pointer)===cmcpSourcePointerKey(pointer));
      const contexts=nodes.map(node=>({kind:'derived_interpretation',text:node.interpretation.text,interpretationKind:node.interpretation.kind,
        temporalUse:node.interpretation.temporalUse,aspect:node.aspect}));
      if(dialogue?.supports?.some(item=>cmcpSourcePointerKey(item.pointer)===cmcpSourcePointerKey(pointer))){
        if(source.sourceAuthorRole!=='user'||!['open','closed','unknown'].includes(dialogue.status)||typeof dialogue.synopsis!=='string')throw Error('invalid_catalog_dialogue');
        for(const support of dialogue.supports){
          const evidence=await sourceFor(support.pointer),range=support.citation;
          if(evidence.sourceAuthorRole!=='user'||loopHash(evidence)!==support.evidenceHash||!range||range.unit!=='unicode_code_points'
            ||!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<=range.start
            ||typeof range.text!=='string'||!range.text||evidence.content.body.indexOf(range.text)!==evidence.content.body.lastIndexOf(range.text)
            ||[...evidence.content.body].slice(range.start,range.end).join('')!==range.text)throw Error('invalid_catalog_dialogue_support');
        }
        contexts.push({kind:'derived_dialogue',status:dialogue.status,text:dialogue.synopsis});
      }
      next.eventScope=event;next.eventLinks=nodes.map(node=>({event,nodeId:node.nodeId}));next.eventLink=next.eventLinks[0]??null;
      if(contexts.length)next.synopsis={kind:'derived_context',items:contexts};
      next.processing={registration:'registered',event:eventProcessing,dialogue:dialogueProcessing};
      await batchValid(batch);
      if(JSON.stringify(entry)===JSON.stringify(next))return {status:'unchanged',entry};
      await publish('annotation',next,batch);return {status:'updated',entry:next};
    }
  return Object.freeze({list,async get(pointer){return (await list()).find(entry=>cmcpSourcePointerKey(entry.pointer)===cmcpSourcePointerKey(pointer))??null;},capacity:journal.status,registerSource:input=>registerSource(input),annotate:input=>annotate(input),
    /** Request-local verified derivative snapshot. No cross-request caching;
     * the caller must not mutate Event state inside this reconciliation. */
    async withBatch(run,{valid=async()=>true}={}){
      if(typeof run!=='function'||typeof valid!=='function')throw Error('invalid_catalog_batch');
      if(!await valid())throw Error('catalog_batch_cancelled');
      const batch={active:true,valid,entries:new Map((await list()).map(entry=>[entry.id,entry])),events:new Map()};
      const scoped=Object.freeze({list:async()=>{await batchValid(batch);return [...batch.entries.values()].map(copy);},
        registerSource:input=>registerSource(input,batch),annotate:input=>annotate(input,batch)});
      try{return await run(scoped);}finally{batch.active=false;batch.entries.clear();batch.events.clear();}
    },
    async repairHints({sourceIds}){
      if(!Array.isArray(sourceIds)||sourceIds.length>maxEntries||new Set(sourceIds).size!==sourceIds.length)throw Error('explicit_bounded_index_repair_required');
      const entries=await list(),results=[];
      for(const id of sourceIds){const entry=entries.find(row=>row.id===id);if(!entry)throw Error('authorized_catalog_entry_missing');
        if(entry.sourceHint){results.push({id,status:'unchanged'});continue;}
        try{results.push({id,status:(await registerSource({pointer:entry.pointer})).status});}catch(error){results.push({id,status:'pending',code:error.message});}
      }return results;
    },async register({pointer,title,synopsis,eventLink=null}){
    if(pointer?.scopeId!==stores.scopeId||typeof title!=='string'||!title.trim()||[...title].length>80
      ||typeof synopsis!=='string'||!synopsis.trim()||[...synopsis].length>160)throw Error('invalid_catalog_entry');
    const found=await resolveCmcpHistorySource({provider:stores.history,pointer});
    if(found.status!=='found')throw Error('catalog_source_'+found.status);
    const source=found.evidence;
    if(eventLink){
      const event=await stores.eventStore(eventLink.event).readEvent({sourceUpdateIds:[eventLink.nodeId]});
      const node=event.view?.knownEvolution.find(node=>node.nodeId===eventLink.nodeId);
      if(event.status!=='found'||!node?.supported||cmcpSourcePointerKey(node.source.pointer)!==cmcpSourcePointerKey(pointer))throw Error('catalog_event_source_mismatch');
    }
    const entry={id:loopHash(cmcpSourcePointerKey(source.pointer)),pointer:source.pointer,eventLink:copy(eventLink),title,
      synopsis:{kind:'derived_summary',text:synopsis},sourceAuthorRole:source.sourceAuthorRole,sourceKind:source.sourceKind,
      messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt,evidenceHash:loopHash(source),
      location:{unit:'unicode_code_points',start:0,end:[...source.content.body].length}};
    const existing=await list(),same=existing.find(item=>item.id===entry.id);
    if(same){const {sourceHint:hint,...originalFields}=same;
      if(JSON.stringify(originalFields)!==JSON.stringify(entry))throw Error('catalog_entry_conflict');return {status:'unchanged',entry:same};}
    await journal.append('source',entry);return {status:'stored',entry};
  }});
}

const emptyFocus=()=>({kind:'derived_focus_continuity',buffer:[],lastUserAt:null,lastSelection:null,proactiveEligible:false});
async function readFocus(root){
  return (await createLocalLoopJournal({root:path.join(root,'focus'),name:'local-focus-v1'}).read()).findLast(row=>row.record.kind==='reactivation_state')?.record.value??emptyFocus();
}

/** Shared exact read. Optional ranges are source code-point locations, never a replacement History. */
export async function readCmcpSelectedHistory({stores,selected,temporal,limits,contextOnly=true,activeAt,
  valid=async()=>true,progress={readRanges:[]}}){
  const cache=new Map(),evidence=[],sourceMap={};let sourceBytes=0,materializedSourceBytes=0;
  progress.selected=selected.map(entry=>({sourceId:entry.id,pointer:entry.pointer}));progress.retrieval='in_progress';
  for(const [index,entry] of selected.entries()){
    if(!await valid())throw Error('reactivation_cancelled');
    let resolution,modelContext;
    if(entry.readRange){
      resolution=await resolveCmcpHistorySource({provider:stores.history,pointer:entry.pointer});
    }else{
      const resolved=await resolveCmcpTemporalEvidence({enabled:true,clean:false,provider:stores.history,pointer:entry.pointer,
        timeContext:temporal,limits:{maxBytes:limits.maxProjectionBytes}});
      resolution=resolved.resolution;modelContext=resolved.modelContext;
    }
    if(resolution?.status!=='found'){
      progress.retrieval='source_unavailable';progress.readRanges.push({pointer:entry.pointer,status:resolution?.status??'unknown'});
      return {status:'source_unavailable',reason:resolution?.status??'unknown',sourceBytes,materializedSourceBytes};
    }
    const source=resolution.evidence,points=[...source.content.body];
    if(loopHash(source)!==entry.evidenceHash)throw Error('indexed_source_changed');
    const fullBytes=Buffer.byteLength(source.content.body);materializedSourceBytes+=fullBytes;
    if(limits.maxMaterializedSourceBytes!==undefined&&fullBytes>limits.maxMaterializedSourceBytes)throw Error('materialized_source_budget');
    const range=entry.readRange??{unit:'unicode_code_points',start:0,end:points.length};
    if(range.unit!=='unicode_code_points'||!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)
      ||range.start<0||range.end<range.start||(entry.readRange&&range.end===range.start)||range.end>points.length)throw Error('invalid_exact_read_range');
    const body=points.slice(range.start,range.end).join(''),size=Buffer.byteLength(body);
    if(entry.readRange)modelContext=projectCmcpTemporalEvidence({enabled:true,clean:false,timeContext:temporal,
      limits:{maxBytes:limits.maxProjectionBytes},evidence:{sourceRef:cmcpSourcePointerKey(source.pointer),
        sourceAuthorRole:source.sourceAuthorRole,messageRecordedAt:source.messageRecordedAt,eventOccurredAt:source.eventOccurredAt,
        content:{kind:source.content.kind,text:body}}}).modelContext;
    if(!modelContext)throw Error('selected_source_oversize');
    sourceBytes+=size;if(sourceBytes>limits.maxSourceBytes)throw Error('selected_source_budget');
    progress.readRanges.push({pointer:entry.pointer,status:'found',location:copy(range),messageRecordedAt:source.messageRecordedAt,
      eventOccurredAt:source.eventOccurredAt,evidenceHash:loopHash(source),bytes:size,
      ...(entry.readRange?{storedContentCodePoints:points.length,completeStoredContent:range.start===0&&range.end===points.length}:{})});
    const ref=entry.projectionRef??'r'+(index+1);
    if(!/^r[1-9]\d*$/.test(ref)||Object.hasOwn(sourceMap,ref))throw Error('invalid_selected_source_alias');sourceMap[ref]=entry.pointer;
    const projectedEvidence={ref,...JSON.parse(modelContext)};
    if(contextOnly){projectedEvidence.source.sourceKind=source.sourceKind;projectedEvidence.source.availability=source.metadata?.availability??'unknown';
      projectedEvidence.readRange={basis:'stored_evidence_content',...range,bytes:size,
        ...(entry.readRange?{storedContentCodePoints:points.length,completeStoredContent:range.start===0&&range.end===points.length}:{})};}
    evidence.push(projectedEvidence);
    // The provider materializes the selected original; the Host receives only the declared range.
    cache.set(cmcpSourcePointerKey(entry.pointer),resolution);
  }
  progress.retrieval='found';progress.sourceBytes=sourceBytes;
  const restricted={descriptor:stores.history.descriptor,capabilities:stores.history.capabilities,
    async resolve(pointer){return cache.get(cmcpSourcePointerKey(pointer))??{status:'permission_denied',pointer};}};
  const events=[],eventVersions={};
  for(const entry of selected.filter(row=>row.eventLink)){
    const key=JSON.stringify(entry.eventLink.event);if(Object.hasOwn(eventVersions,key))continue;
    const result=await stores.eventStore(entry.eventLink.event,restricted).readEvent();
    if(result.status!=='found')throw Error('selected_event_unavailable');eventVersions[key]=loopHash(result.internal.records);
    const nodeRefs=new Map(result.view.knownEvolution.map(node=>[node.nodeId,Object.keys(sourceMap).find(ref=>cmcpSourcePointerKey(sourceMap[ref])===cmcpSourcePointerKey(node.source.pointer))]));
    const nodes=result.view.knownEvolution.filter(node=>nodeRefs.get(node.nodeId)&&node.supported);
    if(!nodes.some(node=>node.nodeId===entry.eventLink.nodeId))throw Error('selected_event_source_unsupported');
    events.push({ref:'e'+(events.length+1),kind:'derived_event_progress',title:entry.title,
      currentClaims:result.view.currentClaims.map(claim=>({aspect:claim.aspect,text:claim.text,sourceRef:nodeRefs.get(claim.nodeId)})),
      selectedProgress:nodes.map(node=>({aspect:node.aspect,interpretation:node.interpretation,sourceRef:nodeRefs.get(node.nodeId)})),
      unresolved:result.view.unresolved.map(item=>({aspect:item.aspect,reason:item.reason})),
      unknownParts:result.view.unknownParts.map(item=>({reason:item.reason,sourceRef:nodeRefs.get(item.nodeId)??null}))});
  }
  const projected={kind:contextOnly?'cmcp_host_context':'selected_history_context',runtimeTime:projectCmcpRuntimeTime(temporal),events,evidence,
    ...(contextOnly?{readScope:{coverage:'selected_sources_only',answerSufficiency:'not_assessed'}}:
      {attention:{activatedAt:activeAt,eventProgressMutation:'none',proactiveEligible:false}})};
  if(bytes(projected)>limits.maxProjectionBytes)throw Error('reactivation_projection_budget');progress.projectionBytes=bytes(projected);
  return {status:'found',projected,sourceMap,eventVersions,sourceBytes,materializedSourceBytes,readRanges:progress.readRanges,projectionBytes:bytes(projected)};
}

export async function activateCmcpHistorySources({stores,selected,query,activeAt,read,valid=async()=>true,skipActivation=false,skipSourceIds=[],
  bufferGeneration=0,ttlMs,bufferTtlMs=ttlMs,timeContext}){
  const scope={root:stores.root,scopeId:stores.scopeId};
  return withCmcpBufferPublication(scope,async()=>{
    const boundary=await assertCmcpBufferGeneration({...scope,generation:bufferGeneration});
    if(!await valid())throw Error('reactivation_cancelled');
    const original=await readFocus(stores.root),after=copy(original);
    const observed=focus=>({...focus,...projectCmcpBufferState({focus,boundary,timeContext,ttlMs,scopeId:stores.scopeId})});
    const before=observed(original);
    if(skipActivation)return {before,after:copy(before)};
    // Stamp old retained entries before advancing the focus generation. A new activation
    // must not accidentally relabel uncleared/expired siblings as current entries.
    after.buffer=after.buffer.map(entry=>({...entry,bufferGeneration:entry.bufferGeneration??original.bufferGeneration??0}));
    after.bufferGeneration=bufferGeneration;
    if(!after.lastUserAt||parseCmcpInstant(activeAt)>parseCmcpInstant(after.lastUserAt))after.lastUserAt=activeAt;
    for(const entry of selected){
      if(skipSourceIds.includes(entry.id))continue;
      const active={sourceId:entry.id,pointer:entry.pointer,eventLink:entry.eventLink,activatedAt:activeAt,
        context:entry.synopsis,queryPointer:query.pointer,...(query.queryAuthorization?{queryAuthorization:copy(query.queryAuthorization)}:{}),proactiveEligible:false,bufferGeneration,expiry:cmcpBufferExpiry(activeAt,bufferTtlMs)};
      const index=after.buffer.findIndex(row=>row.sourceId===entry.id);if(index<0)after.buffer.push(active);
      else if(parseCmcpInstant(activeAt)>=parseCmcpInstant(after.buffer[index].activatedAt))after.buffer[index]=active;
    }
    after.lastSelection={sourceIds:selected.map(entry=>entry.id),sourceMap:read.sourceMap,at:activeAt,sourceBytes:read.sourceBytes,
      projectionBytes:read.projectionBytes,eventVersions:read.eventVersions};
    await assertCmcpBufferGeneration({...scope,generation:bufferGeneration});
    if(!await valid())throw Error('reactivation_cancelled');
    await createLocalLoopJournal({root:path.join(stores.root,'focus'),name:'local-focus-v1'}).append('reactivation_state',after);
    if(!await valid())throw Error('reactivation_cancelled');
    return {before,after:observed(after)};
  });
}
export async function readCmcpHistoryReactivationStatus({stores,maxEntries,timeContext,ttlMs}){
  const catalog=await createCmcpTemporalSourceCatalog({stores,maxEntries}).list(),storedFocus=await readFocus(stores.root);
  const boundary=await readCmcpBufferBoundary({root:stores.root,scopeId:stores.scopeId});
  const bufferLifecycle=projectCmcpBufferState({focus:storedFocus,boundary,timeContext,ttlMs,scopeId:stores.scopeId});
  const focus=timeContext===undefined?{...storedFocus,buffer:bufferLifecycle.buffer}:{...storedFocus,...bufferLifecycle};
  const states=(await createLocalLoopJournal({root:path.join(stores.root,'focus'),name:'local-focus-v1'}).read()).filter(row=>row.record.kind==='reactivation_state');
  const events=[];
  for(const entry of catalog.filter(row=>row.eventLink)){
    if(events.some(row=>JSON.stringify(row.event)===JSON.stringify(entry.eventLink.event)))continue;
    const result=await stores.eventStore(entry.eventLink.event).readEvent();
    events.push({event:entry.eventLink.event,status:result.status,progress:result.view});
  }
  const latestRecall=(await createLocalLoopJournal({root:path.join(stores.root,'focus'),name:'local-focus-v1'}).read()).findLast(row=>row.record.kind==='reactivation_outcome')?.record.value??null;
  return {kind:'history_reactivation_status',catalog,focus,bufferLifecycle,latestRecall,bufferBeforeLastActivation:states.at(-2)?.record.value.buffer??[],
    events,proactiveEligible:false,pinMutation:'none',tokenMeasurement:'not_measured'};
}

/** One writer; only a new explicit User question can activate selected references. */
export function createCmcpHistoryReactivation({stores,allowedSourceIds,limits,adapter,sessionId=randomUUID(),canContinue=async()=>true,clock=()=>new Date().toISOString(),ttlMs,bufferTtlMs=ttlMs,bufferBoundary,continuingClock=false}){
  if(!Array.isArray(allowedSourceIds)||new Set(allowedSourceIds).size!==allowedSourceIds.length
    ||allowedSourceIds.some(id=>typeof id!=='string')||!limits||!['maxEntries','maxCatalogBytes','maxSources','maxSourceBytes','maxProjectionBytes'].every(key=>positive(limits[key]))
    ||allowedSourceIds.length>limits.maxEntries||limits.maxEntries>12||limits.maxSources>2||typeof adapter?.request!=='function')throw Error('explicit_reactivation_grant_required');
  if(ttlMs!==undefined&&(!Number.isSafeInteger(ttlMs)||ttlMs<=0))throw Error('invalid_buffer_ttl');
  if(bufferTtlMs!==undefined&&(!Number.isSafeInteger(bufferTtlMs)||bufferTtlMs<=0))throw Error('invalid_buffer_ttl');
  if(typeof continuingClock!=='boolean'||typeof clock!=='function')throw Error('invalid_reactivation_clock');
  if(bufferBoundary!==undefined&&(!Number.isSafeInteger(bufferBoundary?.generation)||bufferBoundary.generation<0
    ||typeof bufferBoundary.valid!=='function'))throw Error('invalid_buffer_boundary');
  const grant=new Set(allowedSourceIds),catalog=createCmcpTemporalSourceCatalog({stores,maxEntries:limits.maxEntries});
  const journal=createLocalLoopJournal({root:path.join(stores.root,'focus'),name:'local-focus-v1'});
  let enabled=true,clean=false,generation=0,busy=false;
  function controls(value){
    if(typeof value.enabled!=='boolean'||typeof value.clean!=='boolean')throw Error('invalid_reactivation_controls');
    enabled=value.enabled;clean=value.clean;generation++;
  }
  return Object.freeze({setControls:controls,
    async submit({text,timeContext,contextOnly=false,savedQueryPointer=null,queryBinding=null,saveAssistant=true,activateBuffer=true}){
      if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>4096||busy||typeof contextOnly!=='boolean')throw Error('invalid_or_busy_reactivation');
      busy=true;const captured=generation;
      // Normal callers capture synchronously before the first await. Standalone callers
      // capture the durable boundary here, before any source read or model invocation.
      let capturedBufferGeneration=bufferBoundary?.generation;
      let operationTemporal,activationExpiry=null;
      const unexpired=()=>!activationExpiry||(continuingClock
        ?resolveCmcpTimeContext({now:clock(),timezone:operationTemporal.timezone}):operationTemporal).nowEpochMs<parseCmcpInstant(activationExpiry);
      const valid=async()=>{
        if(captured!==generation||!enabled||clean||!await canContinue()||bufferBoundary&&!await bufferBoundary.valid())return false;
        return (await readCmcpBufferBoundary({root:stores.root,scopeId:stores.scopeId})).generation===capturedBufferGeneration&&unexpired();
      };
      let progress;
      async function finish(value){
        const carriesContext=Boolean(value.modelContext||value.answer);
        if(carriesContext&&!await valid())throw Error('reactivation_cancelled');
        await journal.append('reactivation_outcome',{...progress,status:value.status,pendingReason:queryBinding?null:value.reason??value.clarification??null});
        if(carriesContext&&!await valid())throw Error('reactivation_cancelled');
        return value;
      }
      try{
        const initialBoundary=await readCmcpBufferBoundary({root:stores.root,scopeId:stores.scopeId});
        capturedBufferGeneration??=initialBoundary.generation;
        if(savedQueryPointer&&initialBoundary.generation>0&&bufferBoundary===undefined)throw Error('buffer_generation_required_for_resume');
        if(timeContext===undefined)throw Error('explicit_reactivation_time_required');
        const temporal=resolveCmcpTimeContext(timeContext);
        operationTemporal=temporal;
        if(temporal.source!=='explicit_injected')throw Error('explicit_reactivation_time_required');
        async function saveSource(role,body,observedAt=temporal.now){
          if(role==='assistant'&&!saveAssistant)return {pointer:null};
          const evidence=createCmcpSourceEvidence({pointer:{version:1,providerNamespace:stores.history.descriptor.providerNamespace,scopeId:stores.scopeId,
            sessionId,itemId:randomUUID(),revisionId:'r1'},sourceKind:'message',sourceAuthorRole:role,messageRecordedAt:observedAt,eventOccurredAt:null,
            content:{kind:'source_excerpt',body},metadata:{availability:'partial'}});
          if((await stores.history.writeEvidence(evidence)).status!=='stored')throw Error('new_source_history_write_failed');return evidence;
        }
        // Authorized new sources survive independently of enhancement/Buffer. No historical lookup in this branch.
        let query;
        if(queryBinding){
          if(savedQueryPointer||!queryBinding.queryAuthorization)throw Error('conflicting_reactivation_query_binding');
          query=await resolveCmcpReadingQuery({history:stores.history,scopeId:stores.scopeId,binding:queryBinding});
          assertCmcpEphemeralQueryText(query.queryAuthorization,text);
        }else if(savedQueryPointer){
          if(savedQueryPointer.scopeId!==stores.scopeId)throw Error('resume_source_scope_mismatch');
          const found=await resolveCmcpHistorySource({provider:stores.history,pointer:savedQueryPointer});
          if(found.status!=='found')throw Error('resume_source_'+found.status);
          query=found.evidence;
          if(query.sourceAuthorRole!=='user'||query.content.kind!=='source_excerpt'||query.content.body!==text)throw Error('resume_source_role_or_text_mismatch');
          if(query.messageRecordedAt===null)throw Error('resume_source_time_unknown');
        }else query=await saveSource('user',text);
        const activeAt=queryBinding?queryBinding.queryTime:savedQueryPointer?query.messageRecordedAt:temporal.now;
        activationExpiry=cmcpBufferExpiry(activeAt,ttlMs);
        if(!enabled||clean){
          if(contextOnly)return {status:'unaugmented',queryPointer:query.pointer,modelContext:'',selected:[],sourceBytes:0,projectionBytes:0,proactiveEligible:false};
          const reply=await adapter.request('recall_answer',{question:text},{canAttempt:async()=>captured===generation&&await canContinue()});
          const assistantTiming=createCmcpAssistantTiming(temporal,clock);
          if(captured!==generation||!await canContinue())throw Error('reactivation_cancelled');
          if(!validateLoopSchema(reply.value,LOOP_SCHEMAS.recall_answer))throw Error('invalid_recall_answer_schema');
          if(reply.value.sourceRefs.length)throw Error('answer_reference_out_of_scope');
          const answer=await saveSource('assistant',reply.value.text,assistantTiming.responseReceivedAt);
          assistantTiming.sourceSaveAcknowledgedAt=observeCmcpAssistantTime(clock,temporal.timezone);
          await journal.append('assistant_timing',{queryPointer:query.pointer,answerPointer:answer.pointer,assistantTiming:copy(assistantTiming)});
          return {status:'unaugmented',answer:reply.value.text,queryPointer:query.pointer,answerPointer:answer.pointer,assistantTiming,modelContext:'',selected:[],sourceBytes:0,proactiveEligible:false};
        }
        progress={queryPointer:query.pointer,...(queryBinding?{queryAuthorization:copy(queryBinding.queryAuthorization)}:{}),selection:'not_run',retrieval:'not_run',answer:'not_run',selected:[],readRanges:[],sourceBytes:0,projectionBytes:0};
        const available=(await catalog.list()).filter(entry=>grant.has(entry.id));
        if(available.length!==grant.size)throw Error('authorized_catalog_entry_missing');
        const aliases=new Map(available.map((entry,index)=>['c'+(index+1),entry]));
        const listing=[...aliases].map(([ref,entry])=>({ref,title:entry.title,sourceHint:entry.sourceHint??null,context:projectCmcpDialogueCatalogContext(entry.synopsis),sourceAuthorRole:entry.sourceAuthorRole,
          sourceKind:entry.sourceKind,location:entry.location,messageRecordedAt:entry.messageRecordedAt,eventOccurredAt:entry.eventOccurredAt,
          association:entry.eventLink||entry.eventScope?'event':'general_conversation',locatorCompleteness:entry.sourceHint?'bounded_excerpt':'legacy_context_only'}));
        if(bytes(listing)>limits.maxCatalogBytes)throw Error('catalog_projection_budget');
        if(!await valid())throw Error('reactivation_cancelled');
        if(!listing.length)return await finish({status:'not_found',reason:'empty_authorized_catalog',queryPointer:query.pointer,selected:[],modelContext:'',proactiveEligible:false});
        const selectionInput={question:text,catalog:listing,maxSources:limits.maxSources,runtimeTime:projectCmcpRuntimeTime(temporal)};
        const selection=await adapter.request('recall_select',selectionInput,{canAttempt:async()=>valid()});
        await journal.append('reactivation_selection',{query:query.pointer,raw:queryBinding?null:selection.value,transport:selection.transport??null,
          ...(queryBinding?{bodyRetention:'not_saved_ephemeral_operation'}:{})});
        if(!await valid())throw Error('reactivation_cancelled');
        const proposal=decodeLoopResponse(selection.value,'recall_select',buildLoopRequest('recall_select',selectionInput).schema);
        progress.selection=proposal.status;
        if(!['selected','needs_clarification','not_found'].includes(proposal.status)||!Array.isArray(proposal.refs)
          ||new Set(proposal.refs).size!==proposal.refs.length||proposal.refs.some(ref=>!aliases.has(ref)))throw Error('selection_reference_out_of_scope');
        if(proposal.status!=='selected'){
          if(proposal.refs.length||typeof proposal.clarification!=='string'||!proposal.clarification.trim())throw Error('invalid_selection_disposition');
          return await finish({status:proposal.status,clarification:proposal.clarification,selected:[],modelContext:'',queryPointer:query.pointer,proactiveEligible:false});
        }
        if(!proposal.refs.length||proposal.refs.length>limits.maxSources||proposal.clarification!=='')throw Error('selection_limit_or_disposition');
        const selected=proposal.refs.map(ref=>aliases.get(ref));
        const read=await readCmcpSelectedHistory({stores,selected,temporal,limits,contextOnly,activeAt,valid,progress});
        if(read.status!=='found')return await finish({status:read.status,reason:read.reason,queryPointer:query.pointer,
          selected:selected.map(row=>row.id),modelContext:'',sourceBytes:read.sourceBytes,proactiveEligible:false});
        const {projected,sourceMap,eventVersions,sourceBytes}=read;
        const {before,after}=await activateCmcpHistorySources({stores,selected,query,activeAt,read,valid,
          bufferGeneration:capturedBufferGeneration,ttlMs,bufferTtlMs,timeContext:temporal,skipActivation:!activateBuffer});
        if(contextOnly)return await finish({status:'context_ready',selected:selected.map(entry=>entry.id),queryPointer:query.pointer,
          modelContext:JSON.stringify(projected),sourceMap,sourceBytes,projectionBytes:bytes(projected),
          readRanges:progress.readRanges,bufferBefore:before.buffer,bufferAfter:after.buffer,activeAt,eventVersions,proactiveEligible:false});
        const answerInput={question:text,context:projected};
        const answer=await adapter.request('recall_answer',answerInput,{canAttempt:async()=>valid()});
        const assistantTiming=createCmcpAssistantTiming(temporal,clock);
        if(!await valid())throw Error('reactivation_cancelled');
        if(!validateLoopSchema(answer.value,buildLoopRequest('recall_answer',answerInput).schema))throw Error('invalid_recall_answer_schema');
        if(!answer.value.sourceRefs.length||answer.value.sourceRefs.some(ref=>!Object.hasOwn(sourceMap,ref)))throw Error('answer_reference_out_of_scope');
        const answerSource=await saveSource('assistant',answer.value.text,assistantTiming.responseReceivedAt);
        assistantTiming.sourceSaveAcknowledgedAt=observeCmcpAssistantTime(clock,temporal.timezone);
        await journal.append('reactivation_answer',{queryPointer:query.pointer,answerPointer:answerSource.pointer,answer:saveAssistant?answer.value:null,transport:answer.transport??null,assistantTiming:copy(assistantTiming)});
        progress.answer=answer.value.evidenceStatus;
        return await finish({status:answer.value.evidenceStatus==='sufficient'?'answered':'source_insufficient',answer:answer.value.text,answerSourceRefs:answer.value.sourceRefs,selected:selected.map(entry=>entry.id),
          queryPointer:query.pointer,answerPointer:answerSource.pointer,assistantTiming,modelContext:JSON.stringify(projected),sourceMap,sourceBytes,projectionBytes:bytes(projected),
          bufferBefore:before.buffer,bufferAfter:after.buffer,activeAt,eventVersions,proactiveEligible:false});
      }catch(error){if(progress)await journal.append('reactivation_outcome',{...progress,status:'failed',pendingReason:error.message});throw error;}
      finally{busy=false;}
    }
  });
}
