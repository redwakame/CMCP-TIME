import {createHash} from 'node:crypto';
import {freezeLineage} from './cmcp-event-lineage.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {normalizeLocalLoopObjects} from './cmcp-local-loop-scope.js';
import {rankCmcpLocalTexts} from './cmcp-local-candidates.js';
import {projectCmcpCompactAnswerContinuity,projectCmcpCompactContinuity} from './project-cmcp-compact-continuity.js';
import {resolveCmcpTimeContext} from './resolve-cmcp-time-context.js';
import {projectCmcpRuntimeTime} from './project-cmcp-local-time.js';

const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const positive=value=>Number.isSafeInteger(value)&&value>0;
const group=node=>JSON.stringify([node.objectId,node.aspect]);
const stable=value=>JSON.parse(JSON.stringify(value));
export const CMCP_EVENT_WORKING_SET_DEFAULTS=Object.freeze({maxNodes:12,maxAnchors:3,maxContextBytes:10000,maxQueryBytes:4096});
function normalizeLimits(input={}){
  if(Object.keys(input).some(key=>!Object.hasOwn(CMCP_EVENT_WORKING_SET_DEFAULTS,key)))throw Error('invalid_working_set_limits');
  const limits={...CMCP_EVENT_WORKING_SET_DEFAULTS,...input};
  if(Object.values(limits).some(value=>!positive(value))||limits.maxNodes>64||limits.maxAnchors>limits.maxNodes
    ||limits.maxContextBytes>24576||limits.maxQueryBytes>16384)throw Error('invalid_working_set_limits');
  return limits;
}
function nodesFor(view,objects){
  if(view?.kind!=='derived_event_view'||view.version!==1||!Array.isArray(view.knownEvolution)
    ||!Array.isArray(view.currentClaims)||!Array.isArray(view.unresolved)||!Array.isArray(view.unknownParts))throw Error('invalid_working_set_view');
  const allowed=node=>objects.some(object=>object.objectId===node.objectId&&object.aspects.includes(node.aspect));
  const all=new Map(view.knownEvolution.map(node=>[node.nodeId,node]));
  if(all.size!==view.knownEvolution.length)throw Error('duplicate_working_set_node');
  for(const node of all.values()){
    if(typeof node.nodeId!=='string'||!node.nodeId||typeof node.interpretation?.text!=='string'
      ||!node.effectiveRelation||!Array.isArray(node.effectiveRelation.relation?.targetNodeIds)
      ||node.effectiveRelation.relation.targetNodeIds.some(id=>!all.has(id)))throw Error('invalid_working_set_node');
    cmcpSourcePointerKey(node.source.pointer);
  }
  return {all,allowed,nodes:view.knownEvolution.filter(allowed)};
}

/** Topology identity is independent of whether readEvent has materialized source
 * bodies. Normal Runtime must still retain its full Event Store revision guard. */
export function cmcpEventWorkingSetViewDigest(view){
  return digest({event:view.event,nodes:view.knownEvolution.map(node=>({nodeId:node.nodeId,objectId:node.objectId,aspect:node.aspect,
    interpretation:node.interpretation,time:node.time,source:node.source,relation:node.effectiveRelation.relation,
    relationUpdateIds:node.effectiveRelation.updateIds,relationSources:node.effectiveRelation.sourceUpdates,
    relationAmbiguous:node.effectiveRelation.ambiguous}))});
}
function dependencies({all,nodes,allowed}){
  const strong=new Map(nodes.map(node=>[node.nodeId,new Set()])),sources=new Map();
  const add=(a,b)=>{if(!allowed(all.get(a))||!allowed(all.get(b)))throw Error('working_set_dependency_outside_scope');strong.get(a).add(b);strong.get(b).add(a);};
  for(const node of nodes){
    const key=cmcpSourcePointerKey(node.source.pointer),peers=sources.get(key)??[];
    peers.push(node.nodeId);sources.set(key,peers);
    // A correction may retire an earlier node in either direction. Explicit
    // unresolved targets are also inseparable; never select a single winner.
    if(['supersedes','unresolved'].includes(node.effectiveRelation.relation.kind))for(const target of node.effectiveRelation.relation.targetNodeIds)add(node.nodeId,target);
  }
  for(const peers of sources.values())for(const id of peers.slice(1))add(peers[0],id);
  return id=>{const found=new Set(),queue=[id];while(queue.length){const next=queue.pop();if(found.has(next))continue;found.add(next);queue.push(...strong.get(next));}return found;};
}
function required(view,nodeIds){const ids=new Set(nodeIds);return [...new Set(view.knownEvolution.filter(node=>ids.has(node.nodeId))
  .flatMap(node=>[node.nodeId,...node.effectiveRelation.updateIds]))];}
function coverageFor(view,ids,omittedGroups){
  const selected=new Set(ids),selectedNodes=view.knownEvolution.filter(node=>selected.has(node.nodeId));
  const selectedGroups=new Set(selectedNodes.map(group));
  const hiddenRelated=new Set(selectedNodes.flatMap(node=>node.effectiveRelation.relation.targetNodeIds.filter(id=>!selected.has(id))));
  const unresolved=view.unresolved.filter(item=>selectedGroups.has(JSON.stringify([item.objectId,item.aspect])));
  const hiddenUnresolved=unresolved.flatMap(item=>item.nodeIds.filter(id=>!selected.has(id)));
  const hiddenCurrent=view.currentClaims.filter(item=>selectedGroups.has(JSON.stringify([item.objectId,item.aspect]))&&!selected.has(item.nodeId)).map(item=>item.nodeId);
  const omittedAlternatives=new Set([...hiddenUnresolved,...hiddenCurrent]);
  const isPartial=selected.size<view.knownEvolution.length;
  return {mode:'query_scoped_event_working_set_v1',storedNodes:view.knownEvolution.length,selectedNodes:selected.size,
    omittedNodes:view.knownEvolution.length-selected.size,historyCompleteness:'not_established',
    coverage:isPartial?'selected_subset_not_entire_event':'all_known_event_nodes_not_entire_history',
    currentStateCompleteness:omittedAlternatives.size?'partial_frontier_do_not_infer_unique_current_state':'selected_groups_only',
    unselectedRelatedTargets:hiddenRelated.size,unselectedStateAlternatives:omittedAlternatives.size,
    unrepresentedRequiredGroups:omittedGroups.length,
    sourceNavigation:(hiddenRelated.size||omittedAlternatives.size||omittedGroups.length)?'may_require_bounded_source_read':'available_via_existing_history_reader',
    semanticRelevance:'unverified_lexical_locator_not_fact_verification'};
}
function selectedView(view,nodeIds){
  const selected=new Set(nodeIds);
  // Preserve full unresolved lists here: projectCmcpEventView emits the selected
  // members AND hasUnselectedAlternatives. Do not manufacture a singleton claim.
  return {...view,knownEvolution:view.knownEvolution.filter(node=>selected.has(node.nodeId)),
    currentClaims:view.currentClaims.filter(claim=>selected.has(claim.nodeId)),
    unresolved:view.unresolved.filter(item=>item.nodeIds.some(id=>selected.has(id))),
    unknownParts:view.unknownParts.filter(item=>selected.has(item.nodeId))};
}
function render(view,nodeIds,timeContext,coverage,compactNodeIds){
  const temporal=resolveCmcpTimeContext(timeContext);
  if(temporal.source!=='explicit_injected')throw Error('explicit_working_set_time_required');
  if(!nodeIds.length){const model={kind:'derived_event_view',event:view.event,semanticVerification:'not_performed',
    knownEvolution:[],currentClaims:[],unresolved:[],unknownParts:[],sourceRefs:[],runtimeTime:projectCmcpRuntimeTime(temporal),
    workingSet:coverage,referenceMode:'projection_local_alias',...(compactNodeIds?{nodeReferenceMode:'projection_local_alias'}:{})};
    const modelContext=JSON.stringify(model);return {modelContext,internal:{sourceMap:{},nodeMap:{},selectedNodeIds:[]},
      diagnostics:[],size:{bytes:Buffer.byteLength(modelContext),characters:[...modelContext].length,tokenMeasurement:'not_measured'}};}
  // Passing the selected view avoids the legacy compact projector's automatic
  // global frontier expansion. Source pointers and relation aliases stay exact.
  const localView=selectedView(view,nodeIds),project=compactNodeIds?projectCmcpCompactAnswerContinuity:projectCmcpCompactContinuity;
  // Legacy select() also includes unresolved alternatives: explicitly use the
  // caller-selected path, while its default full-frontier contract is unchanged.
  const result=project({enabled:true,view:localView,relatedNodeIds:nodeIds,timeContext:temporal,
    selectionMode:'explicit_working_set',limits:{maxBytes:Number.MAX_SAFE_INTEGER}});
  const modelContext=JSON.stringify({...JSON.parse(result.modelContext),workingSet:coverage});
  return {...result,modelContext,size:{bytes:Buffer.byteLength(modelContext),characters:[...modelContext].length,tokenMeasurement:'not_measured'}};
}

/** Pure derived selection. Whole source siblings and supersession/correction
 * dependencies are atomic. Ordinary related edges remain explicit navigation,
 * not an excuse to recursively inject an entire discussion chain. */
export function selectCmcpEventWorkingSet({view,query,objects,anchorNodeIds=[],limits:inputLimits={},timeContext}){
  const limits=normalizeLimits(inputLimits),normalizedObjects=normalizeLocalLoopObjects(objects),info=nodesFor(view,normalizedObjects);
  if(typeof query!=='string'||Buffer.byteLength(query)>limits.maxQueryBytes||!Array.isArray(anchorNodeIds)
    ||new Set(anchorNodeIds).size!==anchorNodeIds.length||anchorNodeIds.some(id=>!info.all.has(id)||!info.allowed(info.all.get(id))))throw Error('invalid_working_set_query_or_anchor');
  const ranked=rankCmcpLocalTexts({query,documents:info.nodes.map(node=>({id:node.nodeId,text:node.interpretation.text+'\n'+node.source.citation.text})),maxQueryBytes:limits.maxQueryBytes});
  const anchors=[...new Set([...anchorNodeIds,...ranked.ranked.slice(0,limits.maxAnchors).map(row=>row.id)])];
  const closure=dependencies(info),selected=new Set(),omittedGroups=[],basis=[];
  for(const anchor of anchors){if(selected.has(anchor))continue;
    const atomic=closure(anchor),candidate=new Set([...selected,...atomic]);
    const nodeIds=view.knownEvolution.filter(node=>candidate.has(node.nodeId)).map(node=>node.nodeId);
    const coverage=coverageFor(view,nodeIds,omittedGroups),projection=render(view,nodeIds,timeContext,coverage,true);
    if(candidate.size>limits.maxNodes||projection.size.bytes>limits.maxContextBytes){
      omittedGroups.push({anchorNodeId:anchor,nodeIds:[...atomic],reason:candidate.size>limits.maxNodes?'node_limit':'context_byte_limit'});continue;
    }
    for(const id of atomic)selected.add(id);
    basis.push({anchorNodeId:anchor,mode:anchorNodeIds.includes(anchor)?'caller_verified_anchor':'lexical_locator',atomicNodeIds:[...atomic]});
  }
  const nodeIds=view.knownEvolution.filter(node=>selected.has(node.nodeId)).map(node=>node.nodeId),coverage=coverageFor(view,nodeIds,omittedGroups);
  const projection=render(view,nodeIds,timeContext,coverage,true);
  if(projection.size.bytes>limits.maxContextBytes)throw Error('working_set_metadata_budget_exceeded');
  const selection={version:1,kind:'cmcp_event_working_set',event:stable(view.event),viewDigest:cmcpEventWorkingSetViewDigest(view),
    status:omittedGroups.length?'needs_narrowing':nodeIds.length?'selected':'no_matching_event_nodes',
    scope:{objects:normalizedObjects,nodeIds,relatedNodeIds:[...nodeIds]},requiredSourceUpdateIds:required(view,nodeIds),coverage,
    internal:{query,anchorNodeIds:[...anchorNodeIds],limits,selectionBasis:basis,omittedGroups,
      omittedNodeIds:view.knownEvolution.filter(node=>!selected.has(node.nodeId)).map(node=>node.nodeId)},
    projection:{...projection,sourceVerification:'not_performed_candidate_plan_only'}};
  return freezeLineage(selection);
}

/** Recheck a serialized Runtime selection against the complete current topology.
 * This is a boundary check, never a license to accept model-supplied node IDs. */
export function assertCmcpEventWorkingSet({view,selection,objects}){
  if(selection?.kind!=='cmcp_event_working_set'||selection.version!==1||selection.viewDigest!==cmcpEventWorkingSetViewDigest(view)
    ||JSON.stringify(selection.event)!==JSON.stringify(view.event))throw Error('working_set_event_changed');
  const normalized=normalizeLocalLoopObjects(objects??selection.scope?.objects),info=nodesFor(view,normalized);
  if(JSON.stringify(normalized)!==JSON.stringify(selection.scope?.objects))throw Error('working_set_scope_changed');
  const ids=selection.scope.nodeIds,limit=normalizeLimits(selection.internal?.limits);
  if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>limit.maxNodes
    ||ids.some(id=>!info.all.has(id)||!info.allowed(info.all.get(id)))
    ||JSON.stringify(ids)!==JSON.stringify(selection.scope.relatedNodeIds))throw Error('invalid_working_set_selection');
  const closure=dependencies(info),selected=new Set(ids);
  if(ids.some(id=>[...closure(id)].some(required=>!selected.has(required))))throw Error('working_set_dependency_omitted');
  if(JSON.stringify(required(view,ids))!==JSON.stringify(selection.requiredSourceUpdateIds))throw Error('working_set_source_scope_changed');
  return true;
}

/** Use verified sources from the existing Event Store for the actual model view.
 * Full Store revision and controls remain the caller's preview/commit concern. */
export function projectCmcpEventWorkingSet({view,topologyView=view,selection,timeContext,compactNodeIds=true}){
  assertCmcpEventWorkingSet({view,selection});
  assertCmcpEventWorkingSet({view:topologyView,selection});
  const selected=new Set(selection.scope.nodeIds);
  if(view.knownEvolution.some(node=>selected.has(node.nodeId)&&(!node.supported||!node.effectiveRelation.supported)))throw Error('working_set_selected_source_unverified');
  const coverage=coverageFor(topologyView,selection.scope.nodeIds,selection.internal.omittedGroups);
  // The complete structural frontier comes from saved topology. Only selected,
  // exactly verified nodes provide facts; unmaterialized siblings remain explicit
  // alternatives, not mistaken for deleted/unavailable sources.
  const projectionView={...view,currentClaims:topologyView.currentClaims,unresolved:topologyView.unresolved};
  const result=render(projectionView,selection.scope.nodeIds,timeContext,coverage,compactNodeIds);
  // Canonical IDs can be larger before semantic wire aliases; caller applies its
  // existing post-alias bridge budget. The answer form is always directly bounded.
  if(compactNodeIds&&result.size.bytes>selection.internal.limits.maxContextBytes)throw Error('working_set_context_budget_exceeded');
  return freezeLineage({...result,coverage,sourceVerification:'selected_sources_verified',requiredSourceUpdateIds:selection.requiredSourceUpdateIds});
}
