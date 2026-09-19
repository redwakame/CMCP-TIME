const citationLocation = citation => ({unit:citation.unit,start:citation.start,end:citation.end,...(citation.fragments?{fragments:citation.fragments.map(({unit,start,end})=>({unit,start,end})),envelope:'original_source_window_not_joined_quote'}:{})});
/** Explicit node selection and whole-view budget; no graph/context auto-injection. */
export function projectCmcpEventView(input) {
  if (!input || typeof input.enabled !== "boolean" || (input.clean !== undefined && typeof input.clean !== "boolean")) {
    throw new TypeError("invalid_event_projection_controls");
  }
  const empty = code => ({ modelContext: "", diagnostics: [{ code }], size: { bytes: 0, characters: 0, tokenMeasurement: "not_measured" } });
  if (!input.enabled || input.clean === true) return empty(input.clean ? "clean_projection" : "projection_disabled");
  const { maxBytes, maxCharacters } = input.limits ?? {};
  if ((maxBytes === undefined && maxCharacters === undefined)
    || [maxBytes, maxCharacters].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) {
    throw new TypeError("invalid_event_projection_limits");
  }
  if (!Array.isArray(input.nodeIds) || input.nodeIds.some(id => typeof id !== "string")
    || new Set(input.nodeIds).size !== input.nodeIds.length) throw new TypeError("invalid_event_projection_selection");
  const view = input.view;
  if (view?.kind !== "derived_event_view" || view.version !== 1) throw new TypeError("invalid_event_view");
  const selected = new Set(input.nodeIds);
  if (input.nodeIds.some(id => !view.knownEvolution.some(node => node.nodeId === id))) throw new TypeError("unknown_event_node");
  if (!selected.size) return empty("empty_selection");
  const sourceRefs = [], knownEvolution = view.knownEvolution.filter(node => selected.has(node.nodeId)).map(node => {
    sourceRefs.push({ nodeId: node.nodeId, pointer: node.source.pointer,
      citation: citationLocation(node.source.citation),
      sourceAuthorRole: node.source.sourceAuthorRole, contentKind: node.source.contentKind });
    const effective = node.effectiveRelation;
    for (const update of effective.sourceUpdates.filter(update => update.updateId !== node.nodeId)) {
      sourceRefs.push({ nodeId: node.nodeId, relationUpdateId: update.updateId, pointer: update.source.pointer,
        citation: citationLocation(update.source.citation),
        sourceAuthorRole: update.sourceAuthorRole, contentKind: update.contentKind });
    }
    return { nodeId: node.nodeId, objectId: node.objectId, aspect: node.aspect,
      interpretation: { kind: node.interpretation.kind, temporalUse: node.interpretation.temporalUse, text: node.interpretation.text },
      supported: node.supported, time: { messageRecordedAt: node.time.messageRecordedAt, eventOccurredAt: node.time.eventOccurredAt },
      relation: { kind: effective.relation.kind, targetNodeIds: effective.relation.targetNodeIds.filter(id => selected.has(id)),
        hasUnselectedTargets: effective.relation.targetNodeIds.some(id => !selected.has(id)),
        ambiguous: effective.ambiguous, supported: effective.supported } };
  });
  const modelContext = JSON.stringify({
    kind: "derived_event_view", semanticVerification: "not_performed", coverage: "caller_selected_nodes",
    event: { scopeId: view.event.scopeId, eventId: view.event.eventId }, knownEvolution,
    currentClaims: view.currentClaims.filter(claim => selected.has(claim.nodeId))
      .map(({ objectId, aspect, nodeId, text }) => ({ objectId, aspect, nodeId, text })),
    unresolved: view.unresolved.filter(item => item.nodeIds.some(id => selected.has(id))).map(item => ({
      objectId: item.objectId, aspect: item.aspect, reason: item.reason,
      selectedNodeIds: item.nodeIds.filter(id => selected.has(id)), hasUnselectedAlternatives: item.nodeIds.some(id => !selected.has(id))
    })),
    unknownParts: view.unknownParts.filter(item => selected.has(item.nodeId)).map(({ nodeId, reason }) => ({ nodeId, reason })),
    sourceRefs
  });
  const bytes = Buffer.byteLength(modelContext, "utf8"), characters = [...modelContext].length;
  if ((maxBytes !== undefined && bytes > maxBytes) || (maxCharacters !== undefined && characters > maxCharacters)) {
    return { ...empty("event_view_budget_exceeded"), candidateSize: { bytes, characters } };
  }
  return { modelContext, diagnostics: [], size: { bytes, characters, tokenMeasurement: "not_measured" } };
}
