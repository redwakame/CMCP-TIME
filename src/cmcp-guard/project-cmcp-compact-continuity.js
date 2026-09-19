import { projectCmcpEventView } from "./project-cmcp-event-view.js";
import { resolveCmcpTimeContext } from "./resolve-cmcp-time-context.js";
import { cmcpSourcePointerKey } from "./cmcp-source-pointer.js";
import { freezeLineage } from "./cmcp-event-lineage.js";
import { formatCmcpLocalInstant, projectCmcpRuntimeTime } from "./project-cmcp-local-time.js";

// Normal Runtime explicitly opts in after measured multi-turn growth. Standalone
// callers retain the old bound; this does not change source, bridge or wire caps.
export const CMCP_CONTINUITY_CONTEXT_LIMITS = Object.freeze({legacyBytes:10500,normalBytes:16384,legacySemanticInputBytes:16384,normalSemanticInputBytes:24576,
  answerHistoryBytes:24576,answerHistorySemanticInputBytes:32768});
export function normalizeCmcpContinuityContextLimit(value=CMCP_CONTINUITY_CONTEXT_LIMITS.legacyBytes,{answerHistory=false}={}){
  if(typeof answerHistory!=='boolean'||!Number.isSafeInteger(value)||value<1||value>(answerHistory?CMCP_CONTINUITY_CONTEXT_LIMITS.answerHistoryBytes:CMCP_CONTINUITY_CONTEXT_LIMITS.normalBytes))throw Error('invalid_continuity_context_limit');
  return value;
}
export function normalizeCmcpSemanticInputLimit(value=CMCP_CONTINUITY_CONTEXT_LIMITS.legacySemanticInputBytes,{answerHistory=false}={}){
  if(typeof answerHistory!=='boolean'||!Number.isSafeInteger(value)||value<1||value>(answerHistory?CMCP_CONTINUITY_CONTEXT_LIMITS.answerHistorySemanticInputBytes:CMCP_CONTINUITY_CONTEXT_LIMITS.normalSemanticInputBytes))throw Error('invalid_semantic_input_limit');
  return value;
}

/** Full current frontier plus caller-related nodes; never select one conflict winner. */
export function selectCmcpContinuityNodes(view, relatedNodeIds) {
  if (view?.kind !== "derived_event_view" || !Array.isArray(relatedNodeIds)
    || new Set(relatedNodeIds).size !== relatedNodeIds.length
    || relatedNodeIds.some(id => !view.knownEvolution.some(node => node.nodeId === id))) {
    throw new TypeError("invalid_continuity_selection");
  }
  const selected = new Set([...relatedNodeIds, ...view.currentClaims.map(claim => claim.nodeId),
    ...view.unresolved.flatMap(item => item.nodeIds)]);
  return view.knownEvolution.filter(node => selected.has(node.nodeId)).map(node => node.nodeId);
}

/** Lossless reference compaction of the existing event projection at identical scope. */
export function projectCmcpCompactContinuity(input) {
  return projectContinuity(input, false);
}

/** Answer/proactive transport only: node identity aliases preserve every selected field. */
export function projectCmcpCompactAnswerContinuity(input) {
  return projectContinuity(input, true);
}

function mapNodeReferences(model, transform) {
  for (const node of model.knownEvolution) {
    node.nodeId = transform(node.nodeId);
    node.relation.targetNodeIds = node.relation.targetNodeIds.map(id => transform(id));
  }
  for (const claim of model.currentClaims) claim.nodeId = transform(claim.nodeId);
  for (const item of model.unresolved) item.selectedNodeIds = item.selectedNodeIds.map(id => transform(id));
  for (const item of model.unknownParts) item.nodeId = transform(item.nodeId);
  for (const reference of model.sourceRefs) {
    reference.nodeId = transform(reference.nodeId);
    if (Object.hasOwn(reference, 'relationUpdateId')) reference.relationUpdateId = transform(reference.relationUpdateId);
  }
  return model;
}

function projectContinuity(input, compactNodeIds) {
  if (!input || typeof input.enabled !== "boolean" || (input.clean !== undefined && typeof input.clean !== "boolean")) {
    throw new TypeError("invalid_continuity_controls");
  }
  const empty = code => ({ modelContext: "", internal: null, diagnostics: [{ code }],
    size: { bytes: 0, characters: 0, tokenMeasurement: "not_measured" } });
  if (!input.enabled || input.clean === true) return empty(input.clean ? "clean_projection" : "projection_disabled");
  const { maxBytes, maxCharacters } = input.limits ?? {};
  if ((maxBytes === undefined && maxCharacters === undefined)
    || [maxBytes, maxCharacters].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) {
    throw new TypeError("invalid_continuity_limits");
  }
  if (input.timeContext === undefined) throw new TypeError("explicit_continuity_time_required");
  const temporal = resolveCmcpTimeContext(input.timeContext);
  if (temporal.source !== "explicit_injected") throw new TypeError("explicit_continuity_time_required");
  if(input.selectionMode!==undefined&&input.selectionMode!=='explicit_working_set')throw new TypeError('invalid_continuity_selection_mode');
  const selectedNodeIds = input.selectionMode==='explicit_working_set' ? (()=>{
    if(input.view?.kind!=='derived_event_view'||!Array.isArray(input.relatedNodeIds)
      ||new Set(input.relatedNodeIds).size!==input.relatedNodeIds.length
      ||input.relatedNodeIds.some(id=>!input.view.knownEvolution.some(node=>node.nodeId===id)))throw new TypeError('invalid_continuity_selection');
    return [...input.relatedNodeIds];
  })() : selectCmcpContinuityNodes(input.view, input.relatedNodeIds);
  if (!selectedNodeIds.length) return empty("empty_continuity");
  const previous = projectCmcpEventView({ enabled: true, view: input.view, nodeIds: selectedNodeIds,
    limits: { maxBytes: Number.MAX_SAFE_INTEGER } });
  const baseline = { ...JSON.parse(previous.modelContext), runtimeTime: projectCmcpRuntimeTime(temporal) };
  baseline.knownEvolution = baseline.knownEvolution.map(node => ({ ...node, time: {
    ...node.time,
    localMessageRecordedAt: formatCmcpLocalInstant(node.time.messageRecordedAt, temporal.timezone),
    localEventOccurredAt: formatCmcpLocalInstant(node.time.eventOccurredAt, temporal.timezone)
  } }));
  const sourceMap = {}, aliases = new Map();
  const sourceRefs = baseline.sourceRefs.map(({ pointer, ...reference }) => {
    const key = cmcpSourcePointerKey(pointer);
    if (!aliases.has(key)) {
      const alias = "s" + (aliases.size + 1);
      aliases.set(key, alias); sourceMap[alias] = JSON.parse(key);
    }
    return { ...reference, ref: aliases.get(key) };
  });
  let candidate = { ...baseline, sourceRefs, referenceMode: "projection_local_alias" };
  const nodeMap = {};
  if (compactNodeIds) {
    const nodeAliases = new Map();
    const alias = id => {
      if (typeof id !== 'string' || !id) throw new TypeError('invalid_continuity_node_reference');
      if (!nodeAliases.has(id)) {
        const ref = 'n' + (nodeAliases.size + 1);
        nodeAliases.set(id, ref); nodeMap[ref] = id;
      }
      return nodeAliases.get(id);
    };
    // Canonical node order fixes aliases before walking relations. Correction
    // update IDs share the same map without being promoted to event nodes.
    for (const node of candidate.knownEvolution) alias(node.nodeId);
    candidate = mapNodeReferences(structuredClone(candidate), alias);
    candidate.nodeReferenceMode = 'projection_local_alias';
  }
  const modelContext = JSON.stringify(candidate), baselineModelContext = JSON.stringify(baseline);
  const bytes = Buffer.byteLength(modelContext), characters = [...modelContext].length;
  const comparison = { baselineBytes: Buffer.byteLength(baselineModelContext), baselineCharacters: [...baselineModelContext].length,
    candidateBytes: bytes, candidateCharacters: characters, tokenMeasurement: "not_measured" };
  if ((maxBytes !== undefined && bytes > maxBytes) || (maxCharacters !== undefined && characters > maxCharacters)) {
    return { ...empty("continuity_budget_exceeded"), comparison };
  }
  return freezeLineage({ modelContext, internal: { sourceMap, selectedNodeIds, baselineModelContext,
    ...(compactNodeIds ? {nodeMap} : {}) },
    diagnostics: [], size: { bytes, characters, tokenMeasurement: "not_measured" }, comparison });
}

/** Exact local inverse for comparison/lookup; does not resolve History or infer facts. */
export function expandCmcpCompactAnswerReferences(modelContext, {sourceMap, nodeMap}) {
  const {nodeReferenceMode, ...model} = JSON.parse(modelContext);
  if (nodeReferenceMode !== 'projection_local_alias' || !nodeMap || typeof nodeMap !== 'object') {
    throw new TypeError('invalid_continuity_node_reference_mode');
  }
  const expanded = mapNodeReferences(model, ref => {
    if (!Object.hasOwn(nodeMap, ref) || typeof nodeMap[ref] !== 'string' || !nodeMap[ref]) {
      throw new TypeError('missing_continuity_node_reference');
    }
    return nodeMap[ref];
  });
  return expandCmcpContinuityReferences(JSON.stringify(expanded), sourceMap);
}

/** Expand aliases for exact-information comparison/local lookup, not a History resolver. */
export function expandCmcpContinuityReferences(modelContext, sourceMap) {
  const { referenceMode, ...model } = JSON.parse(modelContext);
  if (referenceMode !== "projection_local_alias") throw new TypeError("invalid_continuity_reference_mode");
  return { ...model, sourceRefs: model.sourceRefs.map(({ ref, ...reference }) => {
    if (!Object.hasOwn(sourceMap, ref)) throw new TypeError("missing_continuity_reference");
    return { ...reference, pointer: JSON.parse(cmcpSourcePointerKey(sourceMap[ref])) };
  }) };
}
