import {assertCmcpEventWorkingSet,projectCmcpEventWorkingSet} from './cmcp-event-working-set.js';
import {locateCmcpSourceSupport} from './cmcp-source-citations.js';
import {encodeCmcpSemanticNodeAliases} from './cmcp-semantic-wire.js';
import { createHash } from "node:crypto";
import { createCmcpSourcePointer, validateCmcpSourceIdentity as identity } from "./cmcp-source-pointer.js";
import { resolveCmcpHistorySource } from "./cmcp-history-provider.js";
import { normalizeCmcpEventUpdate, buildCmcpEventView, freezeLineage, cmcpEventInterpretationRoles } from "./cmcp-event-lineage.js";
import { projectCmcpCompactContinuity, selectCmcpContinuityNodes } from "./project-cmcp-compact-continuity.js";
import { isCmcpSemanticProviderBridge } from "./cmcp-semantic-provider-bridge.js";
import { resolveCmcpTimeContext } from "./resolve-cmcp-time-context.js";

const json = value => JSON.stringify(value);
const hash = value => createHash("sha256").update(json(value)).digest("hex");
const fail = (status, code, details = {}) => freezeLineage({ status, code, ...details });
function shape(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError("invalid_proposal_shape");
}
function scopeSnapshot(scope) {
  shape(scope, ["objects", "nodeIds", "relatedNodeIds"]);
  if (!Array.isArray(scope.objects) || !scope.objects.length) throw new TypeError("invalid_intake_scope");
  const objects = scope.objects.map(item => {
    shape(item, ["objectId", "aspects"]);
    if (!Array.isArray(item.aspects) || !item.aspects.length || new Set(item.aspects).size !== item.aspects.length) {
      throw new TypeError("invalid_intake_aspects");
    }
    return { objectId: identity(item.objectId), aspects: item.aspects.map(value => identity(value)) };
  });
  if (new Set(objects.map(item => item.objectId)).size !== objects.length) throw new TypeError("duplicate_intake_object");
  for (const field of ["nodeIds", "relatedNodeIds"]) {
    if (!Array.isArray(scope[field]) || new Set(scope[field]).size !== scope[field].length) throw new TypeError("invalid_intake_nodes");
    scope[field].forEach(value => identity(value));
  }
  return freezeLineage({ objects, nodeIds: [...scope.nodeIds], relatedNodeIds: [...scope.relatedNodeIds] });
}
const locate = locateCmcpSourceSupport;
const revision = read => hash(read.internal.records);
function sourceSnapshot(evidence) {
  return { sourceKind: evidence.sourceKind, sourceAuthorRole: evidence.sourceAuthorRole,
    contentKind: evidence.content.kind, messageRecordedAt: evidence.messageRecordedAt,
    eventOccurredAt: evidence.eventOccurredAt, evidenceSha256: hash(evidence),
    ...(Object.hasOwn(evidence, "metadata") ? { metadata: evidence.metadata } : {}) };
}

/** Source -> bounded async proposals -> preview ticket -> explicit existing-store commit. */
export function createCmcpSemanticIntake({ historyProvider, eventStore, semanticProvider, limits, allowEmptyEvent = false, allowNoEventChange = false, allowPendingConversation = false, eventWorkingSet = null }) {
  if (typeof allowEmptyEvent !== "boolean") throw new TypeError("invalid_empty_event_control");
  if (typeof allowNoEventChange !== "boolean") throw new TypeError("invalid_no_event_change_control");
  if (typeof allowPendingConversation !== "boolean") throw new TypeError("invalid_pending_conversation_control");
  if (!eventStore?.event || typeof eventStore.readEvent !== "function" || typeof eventStore.applyUpdate !== "function"
    || !isCmcpSemanticProviderBridge(semanticProvider)) throw new TypeError("invalid_intake_dependencies");
  for (const field of ["maxSourceBytes", "maxContextBytes", "maxProposals"]) {
    if (!Number.isSafeInteger(limits?.[field]) || limits[field] <= 0) throw new TypeError("invalid_intake_limits");
  }
  const cap = Object.freeze({ ...limits }), tickets = new WeakMap();
  let committing = false;
  async function source(pointer) {
    if (pointer.scopeId !== eventStore.event.scopeId) return fail("needs_source", "source_scope_mismatch");
    try {
      const resolution = await resolveCmcpHistorySource({ provider: historyProvider, pointer });
      return resolution.status === "found" ? resolution : fail("needs_source", "source_" + resolution.status);
    } catch { return fail("needs_source", "invalid_history_reply"); }
  }
  async function context(scope, timeContext) {
    // Replay selected event topology without loading historical message bodies.
    const topology = await eventStore.readEvent({ sourceUpdateIds: [] });
    // Explicit bootstrap only: no fabricated seed/source/interpretation. Existing callers stay unchanged.
    // Commit re-enters this function and compares the issued empty revision before applyUpdate.
    if (topology.status === "missing" && allowEmptyEvent && !scope.nodeIds.length && !scope.relatedNodeIds.length) {
      const view = buildCmcpEventView(eventStore.event, []);
      const modelContext = json({ kind: "derived_event_view", event: eventStore.event,
        knownEvolution: [], currentClaims: [], unresolved: [], unknownParts: [], sourceRefs: [],
        runtimeTime: { now: timeContext.now, timezone: timeContext.timezone } });
      if (Buffer.byteLength(modelContext) > cap.maxContextBytes) return fail("budget_exceeded", "intake_context_budget");
      return { status: "ready", required: [], read: { view, internal: { records: [], checks: [] } },
        compact: { modelContext, internal: { sourceMap: {}, selectedNodeIds: [] } } };
    }
    if (topology.status !== "found") return fail("needs_source", "event_" + topology.status);
    const allNodes = topology.view.knownEvolution;
    if(eventWorkingSet){
      // This Runtime selection is checked against current full topology; model output
      // cannot enlarge its target scope or weaken exact source verification.
      try{
        const nominal=buildCmcpEventView(eventStore.event,topology.internal.records);
        assertCmcpEventWorkingSet({view:nominal,selection:eventWorkingSet,objects:scope.objects});
        if(json(scope)!==json(eventWorkingSet.scope))throw Error('working_set_scope_changed');
        const required=eventWorkingSet.requiredSourceUpdateIds;
        const read=await eventStore.readEvent({sourceUpdateIds:required});
        if(read.status!=='found')return fail('needs_source','event_'+read.status);
        if(required.some(id=>!read.internal.checks[read.internal.records.findIndex(r=>r.command.updateId===id)]?.supported))
          return fail('needs_source','context_source_unverified');
        const compact=projectCmcpEventWorkingSet({view:read.view,topologyView:nominal,selection:eventWorkingSet,timeContext,compactNodeIds:false});
        const encoded=semanticProvider.inputEncoding==='node_aliases'?encodeCmcpSemanticNodeAliases({eventContext:JSON.parse(compact.modelContext),scope}).input.eventContext:JSON.parse(compact.modelContext);
        if(Buffer.byteLength(json(encoded))>cap.maxContextBytes)return fail('budget_exceeded','intake_context_budget');
        return {status:'ready',read,compact,required};
      }catch(error){return fail('needs_source',error.message);}
    }
    const allowed = node => scope.objects.some(object => object.objectId === node.objectId && object.aspects.includes(node.aspect));
    if (scope.nodeIds.some(id => !allNodes.some(node => node.nodeId === id && allowed(node)))
      || scope.relatedNodeIds.some(id => !scope.nodeIds.includes(id))) return fail("needs_clarification", "invalid_candidate_scope");
    const selected = selectCmcpContinuityNodes(topology.view, [...new Set([...scope.relatedNodeIds, ...scope.nodeIds])]);
    if (selected.some(id => !scope.nodeIds.includes(id))) return fail("needs_clarification", "scope_omits_active_branch");
    const required = [...new Set(selected.flatMap(id => {
      const node = allNodes.find(node => node.nodeId === id);
      return [id, ...node.effectiveRelation.updateIds];
    }))];
    const read = await eventStore.readEvent({ sourceUpdateIds: required });
    if (read.status !== "found") return fail("needs_source", "event_" + read.status);
    if (required.some(id => !read.internal.checks[read.internal.records.findIndex(record => record.command.updateId === id)].supported)) {
      return fail("needs_source", "context_source_unverified");
    }
    const aliases=semanticProvider.inputEncoding==='node_aliases';
    const compact = projectCmcpCompactContinuity({ enabled: true, view: read.view, timeContext,
      relatedNodeIds: selected, limits: { maxBytes: aliases?Number.MAX_SAFE_INTEGER:cap.maxContextBytes } });
    if (!compact.modelContext) return fail("budget_exceeded", "intake_context_budget");
    // Only an issued bridge with this explicit encoding can use the encoded
    // context budget. Canonical context/scope/tickets stay unchanged internally.
    if(aliases){
      const encoded=encodeCmcpSemanticNodeAliases({eventContext:JSON.parse(compact.modelContext),scope});
      if(Buffer.byteLength(json(encoded.input.eventContext))>cap.maxContextBytes)return fail('budget_exceeded','intake_context_budget');
    }
    return { status: "ready", read, compact, required };
  }
  return Object.freeze({
    async preview(input) {
      const pointer = createCmcpSourcePointer(input.pointer), scope = scopeSnapshot(input.scope);
      if (input.timeContext === undefined) throw new TypeError("explicit_intake_time_required");
      const timeContext = resolveCmcpTimeContext(input.timeContext);
      if (timeContext.source !== "explicit_injected") throw new TypeError("explicit_intake_time_required");
      const evidenceResult = await source(pointer);
      if (evidenceResult.status !== "found") return evidenceResult;
      const evidence = evidenceResult.evidence;
      if (Buffer.byteLength(evidence.content.body) > cap.maxSourceBytes) return fail("budget_exceeded", "intake_source_budget");
      const prepared = await context(scope, timeContext);
      if (prepared.status !== "ready") return prepared;
      const request = {
        source: { ref: "input", sourceKind: evidence.sourceKind, sourceAuthorRole: evidence.sourceAuthorRole,
          contentKind: evidence.content.kind, messageRecordedAt: evidence.messageRecordedAt, eventOccurredAt: evidence.eventOccurredAt,
          text: evidence.content.body },
        eventContext: JSON.parse(prepared.compact.modelContext), scope,
        maxProposals: cap.maxProposals,
        ...(allowNoEventChange ? { allowedOutcomes: ["proposed", "no_event_change", "needs_clarification", "needs_source"] } : {})
      };
      const response = await semanticProvider.propose(request);
      if (response.status !== "proposed") return fail(response.status, response.code, { audit: response.audit ?? null });
      const proposal = response.proposal;
      if (["needs_clarification", "needs_source"].includes(proposal?.status)) {
        try { shape(proposal, ["status", "reason"]); if (typeof proposal.reason !== "string" || !proposal.reason.trim()) throw Error(); }
        catch { return fail("rejected", "invalid_clarification", { audit: response.audit }); }
        // A valid clarification disposition does not invalidate the independently
        // resolved User source and authorized event context. This is a verification
        // snapshot for the normal conversation path, never a commit ticket, an
        // accepted event interpretation or permission to use pending proposals.
        // The caller must recheck source/version/controls before answering.
        const sourceValidation=allowPendingConversation&&evidence.sourceAuthorRole==='user'
          ?{status:'verified',sourceAuthorRole:'user',pointer,evidenceHash:hash(evidence),eventVersion:revision(prepared.read)}:undefined;
        return fail(proposal.status, "provider_" + proposal.status, { reason: proposal.reason, audit: response.audit,
          ...(sourceValidation?{sourceValidation}:{}) });
      }
      if (proposal?.status === "no_event_change") {
        if (!allowNoEventChange) return fail("rejected", "no_event_change_not_enabled", { audit: response.audit });
        try {
          shape(proposal, ["status", "objectId", "targetNodeIds", "quote"]);
          const object = scope.objects.find(item => item.objectId === proposal.objectId);
          if (!object || !Array.isArray(proposal.targetNodeIds) || !proposal.targetNodeIds.length
            || new Set(proposal.targetNodeIds).size !== proposal.targetNodeIds.length
            || proposal.targetNodeIds.some(id => !scope.nodeIds.includes(id) || !prepared.read.view.knownEvolution.some(node =>
              node.nodeId === id && node.objectId === object.objectId && object.aspects.includes(node.aspect) && node.supported))) {
            return fail("needs_clarification", "no_event_change_target_out_of_scope", { audit: response.audit });
          }
          if (evidence.sourceAuthorRole !== "user") throw new TypeError("proposal_role_mismatch");
          const citation = locate(evidence.content.body, proposal.quote);
          const preview = freezeLineage({ status: "ready", eventMutation: "none", commands: [],
            sourceVerification: "exact_pointer_role_scope_located_fragments", semanticVerification: "not_performed", audit: response.audit,
            internal: { context: prepared.compact, sourcePointer: pointer,
              noEventChange: { objectId: proposal.objectId, targetNodeIds: [...proposal.targetNodeIds], citation } } });
          tickets.set(preview, { pointer, evidenceHash: hash(evidence), revision: revision(prepared.read),
            scope, timeContext, commands: [], noEventChange: true, receipts: null });
          return preview;
        } catch (error) { return fail("rejected", error.code ?? error.message, { audit: response.audit }); }
      }
      const commands = [];
      try {
        shape(proposal, ["status", "proposals"]);
        if (proposal.status !== "proposed" || !Array.isArray(proposal.proposals) || !proposal.proposals.length
          || proposal.proposals.length > cap.maxProposals) throw new TypeError("invalid_proposal_count");
        for (const item of proposal.proposals) {
          shape(item, ["kind", "temporalUse", "objectId", "aspect", "text", "quote", "relation"]);
          const object = scope.objects.find(object => object.objectId === item.objectId);
          if (!object || !object.aspects.includes(item.aspect)) return fail("needs_clarification", "proposal_out_of_scope", { audit: response.audit });
          shape(item.relation, ["kind", "targetNodeIds"]);
          if (!Array.isArray(item.relation.targetNodeIds) || item.relation.targetNodeIds.some(id => !scope.nodeIds.includes(id))) {
            return fail("needs_clarification", "relation_target_out_of_scope", { audit: response.audit });
          }
          if (cmcpEventInterpretationRoles[item.kind] !== evidence.sourceAuthorRole) throw new TypeError("proposal_role_mismatch");
          const citation = locate(evidence.content.body, item.quote);
          const action = { type: "add_node", objectId: item.objectId, aspect: item.aspect,
            relation: { kind: item.relation.kind, targetNodeIds: [...item.relation.targetNodeIds].sort() } };
          const interpretation = { kind: item.kind, temporalUse: item.temporalUse, text: item.text };
          const seed = { event: eventStore.event, pointer, citation, interpretation, action };
          const command = normalizeCmcpEventUpdate({ version: 1, updateId: "semantic-" + hash(seed),
            source: { pointer, citation }, interpretation, action });
          if (!commands.some(existing => existing.updateId === command.updateId)) commands.push(command);
        }
        const newCommands = commands.filter(command => !prepared.read.internal.records.some(record => record.command.updateId === command.updateId));
        // Reuse the existing pure replay for preview validation, never an alternate event store.
        buildCmcpEventView(eventStore.event, [...prepared.read.internal.records,
          ...newCommands.map(command => ({ command, sourceSnapshot: sourceSnapshot(evidence) }))]);
      } catch (error) { return fail("rejected", error.code ?? error.message, { audit: response.audit }); }
      const preview = freezeLineage({ status: "ready", sourceVerification: "exact_pointer_role_scope_located_fragments",
        semanticVerification: "not_performed", commands, audit: response.audit,
        internal: { context: prepared.compact, sourcePointer: pointer } });
      tickets.set(preview, { pointer, evidenceHash: hash(evidence), revision: revision(prepared.read),
        scope, timeContext, commands, receipts: null });
      return preview;
    },
    async commit(preview, { canCommit = async () => true } = {}) {
      if (typeof canCommit !== 'function') throw new TypeError('invalid_intake_commit_guard');
      const ticket = tickets.get(preview);
      if (!ticket) return fail("rejected", "unissued_preview");
      if (ticket.receipts) return freezeLineage({ status: "unchanged", receipts: ticket.receipts, semanticVerification: "not_performed" });
      if (committing) return fail("failed", "single_writer_busy");
      committing = true;
      const receipts = [];
      try {
        if (!await canCommit()) throw Object.assign(new Error('intake_commit_cancelled'), {code:'intake_commit_cancelled'});
        const currentSource = await source(ticket.pointer);
        if (currentSource.status !== "found") return currentSource;
        if (hash(currentSource.evidence) !== ticket.evidenceHash) return fail("rejected", "source_changed_after_preview");
        const current = await context(ticket.scope, ticket.timeContext);
        if (current.status !== "ready") return current;
        const records = current.read.internal.records;
        const alreadyApplied = ticket.commands.length > 0 && ticket.commands.every(command => records.some(record => json(record.command) === json(command)));
        if (!alreadyApplied && revision(current.read) !== ticket.revision) return fail("needs_clarification", "event_changed_after_preview");
        if (!await canCommit()) throw Object.assign(new Error('intake_commit_cancelled'), {code:'intake_commit_cancelled'});
        if (ticket.noEventChange) {
          ticket.receipts = freezeLineage([]);
          return freezeLineage({ status: "unchanged", eventMutation: "none", receipts: [], semanticVerification: "not_performed" });
        }
        for (const command of ticket.commands) {
          const receipt = await eventStore.applyUpdate(command, {canCommit});
          receipts.push(receipt);
          if (!["stored", "unchanged"].includes(receipt.status)) {
            return freezeLineage({ status: receipts.some(item => item.status === "stored") ? "partial" : "failed", receipts,
              code: "event_commit_incomplete", semanticVerification: "not_performed" });
          }
        }
        ticket.receipts = freezeLineage(receipts);
        return freezeLineage({ status: receipts.every(item => item.status === "unchanged") ? "unchanged" : "committed",
          receipts, semanticVerification: "not_performed" });
      } catch (error) { return freezeLineage({ status: receipts.some(item => item.status === "stored") ? "partial" : "failed",
        code: error.code ?? "intake_commit_failed", receipts }); }
      finally { committing = false; }
    }
  });
}
