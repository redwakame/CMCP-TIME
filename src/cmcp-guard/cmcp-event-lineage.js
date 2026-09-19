import { createCmcpSourcePointer, validateCmcpSourceIdentity as id } from "./cmcp-source-pointer.js";

export function lineageError(code) { return Object.assign(new TypeError(code), { code }); }
function shape(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).length !== keys.length) {
    throw lineageError("invalid_event_shape");
  }
}
export function freezeLineage(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeLineage); Object.freeze(value); }
  return value;
}
export function normalizeCmcpEvent(input) {
  shape(input, ["scopeId", "eventId"]);
  return freezeLineage({ scopeId: id(input.scopeId, "scopeId"), eventId: id(input.eventId, "eventId") });
}
const kinds = {
  user_report: "user", user_intent: "user", user_question: "user",
  assistant_suggestion: "assistant", assistant_statement: "assistant", tool_observation: "tool"
};
export const cmcpEventInterpretationRoles = Object.freeze(kinds);
function ids(input) {
  if (!Array.isArray(input)) throw lineageError("invalid_event_targets");
  const result = input.map(value => id(value, "target"));
  if (new Set(result).size !== result.length) throw lineageError("duplicate_event_target");
  return result;
}
function relation(input) {
  shape(input, ["kind", "targetNodeIds"]);
  if (!["independent", "supersedes", "related", "unresolved"].includes(input.kind)) throw lineageError("invalid_event_relation");
  const targetNodeIds = ids(input.targetNodeIds);
  if ((input.kind === "independent" && targetNodeIds.length)
    || (["supersedes", "related"].includes(input.kind) && !targetNodeIds.length)) throw lineageError("invalid_event_targets");
  return { kind: input.kind, targetNodeIds };
}
export function normalizeCmcpEventUpdate(input) {
  shape(input, ["version", "updateId", "source", "interpretation", "action"]);
  if (input.version !== 1) throw lineageError("invalid_event_version");
  shape(input.source, ["pointer", "citation"]);
  const pointer = createCmcpSourcePointer(input.source.pointer), citation = input.source.citation;
  shape(citation, ["unit", "start", "end", "text", ...(Object.hasOwn(citation,"fragments")?["fragments"]:[])]);
  if (citation.unit !== "unicode_code_points" || !Number.isSafeInteger(citation.start)
    || !Number.isSafeInteger(citation.end) || citation.start < 0 || citation.end <= citation.start
    || typeof citation.text !== "string" || !citation.text.length) throw lineageError("invalid_event_citation");
  if(Object.hasOwn(citation,'fragments')){
    if(!Array.isArray(citation.fragments)||citation.fragments.length<2||citation.fragments.length>16)throw lineageError('invalid_event_citation_fragments');
    let end=citation.start;
    for(const part of citation.fragments){
      shape(part,['unit','start','end','text']);
      if(part.unit!=='unicode_code_points'||!Number.isSafeInteger(part.start)||!Number.isSafeInteger(part.end)
        ||part.start<end||part.end<=part.start||part.end>citation.end||typeof part.text!=='string'
        ||[...citation.text].slice(part.start-citation.start,part.end-citation.start).join('')!==part.text)throw lineageError('invalid_event_citation_fragments');
      end=part.end;
    }
    if(citation.fragments[0].start!==citation.start||citation.fragments.at(-1).end!==citation.end)throw lineageError('invalid_event_citation_fragments');
  }
  const reading = input.interpretation;
  shape(reading, ["kind", "temporalUse", "text"]);
  if (!Object.hasOwn(kinds, reading.kind) || !["current", "historical", "unspecified"].includes(reading.temporalUse)
    || typeof reading.text !== "string" || !reading.text.trim()) throw lineageError("invalid_event_interpretation");
  const action = input.action;
  let normalizedAction;
  if (action?.type === "add_node") {
    shape(action, ["type", "objectId", "aspect", "relation"]);
    normalizedAction = { type: action.type, objectId: id(action.objectId, "objectId"),
      aspect: id(action.aspect, "aspect"), relation: relation(action.relation) };
  } else if (action?.type === "correct_relation") {
    shape(action, ["type", "nodeId", "replacesUpdateIds", "relation"]);
    const replacesUpdateIds = ids(action.replacesUpdateIds);
    if (!replacesUpdateIds.length) throw lineageError("explicit_correction_target_required");
    normalizedAction = { type: action.type, nodeId: id(action.nodeId, "nodeId"),
      replacesUpdateIds, relation: relation(action.relation) };
  } else throw lineageError("invalid_event_action");
  return freezeLineage({
    version: 1, updateId: id(input.updateId, "updateId"),
    source: { pointer, citation: { unit: citation.unit, start: citation.start, end: citation.end, text: citation.text, ...(citation.fragments?{fragments:citation.fragments.map(part=>({...part}))}:{}) } },
    interpretation: { kind: reading.kind, temporalUse: reading.temporalUse, text: reading.text },
    action: normalizedAction
  });
}
const eligible = command => command.interpretation.temporalUse === "current"
  && ["user_report", "tool_observation"].includes(command.interpretation.kind);
const groupKey = command => JSON.stringify([command.action.objectId, command.action.aspect]);

/** Pure replay of explicit relations; never classifies language or sorts timestamps. */
export function buildCmcpEventView(event, records, support = records.map(() => true)) {
  const nodes = new Map(), byId = new Map(), histories = new Map();
  function validateRelation(node, edge) {
    for (const targetId of edge.targetNodeIds) {
      const target = nodes.get(targetId);
      if (!target || targetId === node.command.updateId) throw lineageError("invalid_relation_target");
      if (edge.kind === "supersedes" && (!eligible(node.command) || !eligible(target.command)
        || groupKey(node.command) !== groupKey(target.command))) throw lineageError("invalid_state_relation");
    }
  }
  for (const [index, record] of records.entries()) {
    const command = record.command, action = command.action;
    if (byId.has(command.updateId)) throw lineageError("duplicate_update_id");
    const item = { ...record, supported: support[index] === true, index };
    if (action.type === "add_node") {
      validateRelation(item, action.relation);
      nodes.set(command.updateId, item);
      histories.set(command.updateId, [item]);
    } else {
      const target = nodes.get(action.nodeId);
      if (!target || !eligible(command)) throw lineageError("invalid_correction_actor_or_target");
      for (const targetId of action.replacesUpdateIds) {
        if (!histories.get(action.nodeId).some(entry => entry.command.updateId === targetId)) {
          throw lineageError("invalid_correction_base");
        }
      }
      validateRelation(target, action.relation);
      histories.get(action.nodeId).push(item);
    }
    byId.set(command.updateId, item);
  }
  const effective = new Map();
  for (const [nodeId, history] of histories) {
    const retired = new Set(history.flatMap(item => item.command.action.replacesUpdateIds ?? []));
    const tips = history.filter(item => !retired.has(item.command.updateId));
    effective.set(nodeId, {
      relation: tips.length === 1 ? tips[0].command.action.relation : { kind: "unresolved", targetNodeIds: [] },
      updateIds: tips.map(item => item.command.updateId),
      sourceUpdates: tips.map(item => ({ updateId: item.command.updateId, source: item.command.source,
        sourceAuthorRole: item.sourceSnapshot.sourceAuthorRole, contentKind: item.sourceSnapshot.contentKind })),
      supported: tips.every(item => item.supported), ambiguous: tips.length !== 1
    });
  }
  // Explicit relation corrections may point to later nodes; reject supersession cycles.
  const visiting = new Set(), visited = new Set();
  function visit(nodeId) {
    if (visiting.has(nodeId)) throw lineageError("relationship_cycle");
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    const edge = effective.get(nodeId).relation;
    if (edge.kind === "supersedes") edge.targetNodeIds.forEach(visit);
    visiting.delete(nodeId); visited.add(nodeId);
  }
  nodes.forEach((_, nodeId) => visit(nodeId));
  const retiredNodes = new Set([...effective.values()].flatMap(({ relation: edge }) =>
    edge.kind === "supersedes" ? edge.targetNodeIds : []));
  const groups = new Map();
  for (const node of nodes.values()) {
    if (!eligible(node.command)) continue;
    const key = groupKey(node.command);
    if (!groups.has(key)) groups.set(key, []);
    if (!retiredNodes.has(node.command.updateId)) groups.get(key).push(node);
  }
  const currentClaims = [], unresolved = [];
  for (const [key, frontier] of groups) {
    const [objectId, aspect] = JSON.parse(key);
    const blocked = frontier.some(node => {
      const edge = effective.get(node.command.updateId);
      return !node.supported || !edge.supported || edge.ambiguous || edge.relation.kind === "unresolved";
    });
    if (frontier.length === 1 && !blocked) {
      const node = frontier[0];
      currentClaims.push({ objectId, aspect, nodeId: node.command.updateId, text: node.command.interpretation.text });
    } else {
      unresolved.push({ objectId, aspect, nodeIds: frontier.map(node => node.command.updateId),
        reason: blocked ? "support_or_relation_unresolved" : "multiple_unresolved_claims" });
    }
  }
  const knownEvolution = [...nodes.values()].map(node => {
    const command = node.command, edge = effective.get(command.updateId), source = node.sourceSnapshot;
    return {
      nodeId: command.updateId, objectId: command.action.objectId, aspect: command.action.aspect,
      interpretation: command.interpretation, supported: node.supported,
      time: { messageRecordedAt: source.messageRecordedAt, eventOccurredAt: source.eventOccurredAt },
      source: { pointer: command.source.pointer, citation: command.source.citation,
        sourceAuthorRole: source.sourceAuthorRole, contentKind: source.contentKind },
      effectiveRelation: edge
    };
  });
  const unknownParts = knownEvolution.flatMap(node => {
    const reasons = [];
    if (node.time.eventOccurredAt === null) reasons.push("event_time_unknown");
    if (!node.supported) reasons.push("source_not_currently_verified");
    if (node.interpretation.kind === "user_intent") reasons.push("intent_outcome_not_inferred");
    if (node.interpretation.kind === "user_question") reasons.push("question_not_state_assertion");
    if (node.interpretation.temporalUse === "historical") reasons.push("historical_not_current");
    if (node.interpretation.kind.startsWith("assistant_")) reasons.push("assistant_not_state_evidence");
    return reasons.map(reason => ({ nodeId: node.nodeId, reason }));
  });
  return freezeLineage({ kind: "derived_event_view", version: 1, event, semanticVerification: "not_performed",
    knownEvolution, currentClaims, unresolved, unknownParts });
}
