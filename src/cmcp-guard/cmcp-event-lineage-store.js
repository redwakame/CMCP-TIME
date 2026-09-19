import { createHash } from "node:crypto";
import { createCmcpSourceEvidence } from "./cmcp-source-evidence.js";
import { describeCmcpHistoryProvider, resolveCmcpHistorySource } from "./cmcp-history-provider.js";
import { normalizeCmcpEvent, normalizeCmcpEventUpdate, buildCmcpEventView,
  cmcpEventInterpretationRoles, freezeLineage, lineageError } from "./cmcp-event-lineage.js";

const format = "cmcp-event-lineage-reference";
const json = value => JSON.stringify(value);
const hash = text => createHash("sha256").update(text, "utf8").digest("hex");
const keyFor = (event, updateId) => hash(json([format, event.scopeId, event.eventId, updateId]));
const isHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function snapshot(evidence) {
  const result = { sourceKind: evidence.sourceKind, sourceAuthorRole: evidence.sourceAuthorRole,
    contentKind: evidence.content.kind, messageRecordedAt: evidence.messageRecordedAt,
    eventOccurredAt: evidence.eventOccurredAt, evidenceSha256: hash(json(evidence)) };
  if (Object.hasOwn(evidence, "metadata")) result.metadata = evidence.metadata;
  return result;
}
async function verifySource(provider, event, command) {
  if (command.source.pointer.scopeId !== event.scopeId) throw lineageError("source_scope_mismatch");
  const reply = await resolveCmcpHistorySource({ provider, pointer: command.source.pointer });
  if (reply.status !== "found") throw lineageError("source_" + reply.status);
  const evidence = reply.evidence;
  if (evidence.sourceAuthorRole !== cmcpEventInterpretationRoles[command.interpretation.kind]) {
    throw lineageError("source_role_mismatch");
  }
  const range = command.source.citation, body = [...evidence.content.body];
  if (range.end > body.length || body.slice(range.start, range.end).join("") !== range.text) {
    throw lineageError("source_citation_mismatch");
  }
  return snapshot(evidence);
}

/** A single writer, one explicitly selected event, independent interpretation backend. */
export function createCmcpEventLineageStore({ event: inputEvent, backend, historyProvider }) {
  const event = normalizeCmcpEvent(inputEvent);
  if (!backend || ["read", "create", "listKeys"].some(method => typeof backend[method] !== "function")) {
    throw lineageError("invalid_event_backend");
  }
  describeCmcpHistoryProvider(historyProvider);
  const read = backend.read.bind(backend), create = backend.create.bind(backend), list = backend.listKeys.bind(backend);
  let writing = false;
  function decode(data, key) {
    try {
      if (typeof data !== "string") throw Error();
      const document = JSON.parse(data), raw = document.record;
      if (Object.keys(document).length !== 2 || !isHash(document.sha256)
        || document.sha256 !== hash(json(raw)) || raw.format !== format || raw.version !== 1
        || Object.keys(raw).length !== 7 || !Number.isSafeInteger(raw.sequence) || raw.sequence < 0
        || (raw.previousDigest !== null && !isHash(raw.previousDigest))) throw Error();
      const normalizedEvent = normalizeCmcpEvent(raw.event), command = normalizeCmcpEventUpdate(raw.command);
      const source = raw.sourceSnapshot;
      if (!source || !isHash(source.evidenceSha256)
        || Object.keys(source).some(name => !["sourceKind", "sourceAuthorRole", "contentKind", "messageRecordedAt",
          "eventOccurredAt", "evidenceSha256", "metadata"].includes(name))) throw Error();
      const evidence = createCmcpSourceEvidence({
        pointer: command.source.pointer, sourceKind: source.sourceKind, sourceAuthorRole: source.sourceAuthorRole,
        messageRecordedAt: source.messageRecordedAt, eventOccurredAt: source.eventOccurredAt,
        content: { kind: source.contentKind, body: command.source.citation.text },
        ...(Object.hasOwn(source, "metadata") ? { metadata: source.metadata } : {})
      });
      if (evidence.pointer.scopeId !== normalizedEvent.scopeId
        || evidence.sourceAuthorRole !== cmcpEventInterpretationRoles[command.interpretation.kind]
        || keyFor(normalizedEvent, command.updateId) !== key
        || json(command) !== json(raw.command)) throw Error();
      return { record: { ...raw, event: normalizedEvent, command }, sha256: document.sha256 };
    } catch { throw lineageError("event_storage_invalid"); }
  }
  async function load() {
    const keys = await list();
    if (!Array.isArray(keys) || keys.some(key => !isHash(key)) || new Set(keys).size !== keys.length) {
      throw lineageError("event_storage_invalid");
    }
    const documents = [];
    for (const key of keys) {
      const decoded = decode(await read(key), key);
      if (json(decoded.record.event) === json(event)) documents.push(decoded);
    }
    documents.sort((a, b) => a.record.sequence - b.record.sequence);
    for (const [index, document] of documents.entries()) {
      if (document.record.sequence !== index
        || document.record.previousDigest !== (index ? documents[index - 1].sha256 : null)) {
        throw lineageError("event_sequence_invalid");
      }
    }
    buildCmcpEventView(event, documents.map(item => item.record));
    return documents;
  }
  return Object.freeze({
    event,
    async applyUpdate(input, { canCommit = async () => true } = {}) {
      if (typeof canCommit !== 'function') throw lineageError('invalid_event_commit_guard');
      const command = normalizeCmcpEventUpdate(input);
      const result = (status, details = {}) => freezeLineage({ status, event, updateId: command.updateId, ...details });
      if (writing) return result("failed", { code: "single_writer_busy" });
      writing = true;
      try {
        if (!await canCommit()) throw lineageError('event_commit_cancelled');
        const documents = await load(), existing = documents.find(item => item.record.command.updateId === command.updateId);
        if (existing) return result(json(existing.record.command) === json(command) ? "unchanged" : "conflict");
        let sourceSnapshot;
        try { sourceSnapshot = await verifySource(historyProvider, event, command); }
        catch (error) { return result("rejected", { code: error.code ?? "invalid_source_reply" }); }
        const record = { format, version: 1, event, sequence: documents.length,
          previousDigest: documents.at(-1)?.sha256 ?? null, command, sourceSnapshot };
        try { buildCmcpEventView(event, [...documents.map(item => item.record), record]); }
        catch (error) { return result("rejected", { code: error.code ?? "invalid_event_relation" }); }
        const document = { record, sha256: hash(json(record)) }, key = keyFor(event, command.updateId);
        // Publication is the boundary: cancellation before create rejects, while
        // an already-started backend write is not represented as rolled back.
        if (!await canCommit()) throw lineageError('event_commit_cancelled');
        const publication = await create(key, json(document));
        if (!publication || !["created", "exists"].includes(publication.status)
          || typeof publication.temporaryFileRetained !== "boolean") throw lineageError("invalid_backend_reply");
        const saved = decode(await read(key), key);
        if (json(saved) !== json(document)) return result("conflict", { code: "writer_conflict" });
        // Reject competing sequence entries; this is not a multi-writer protocol.
        await load();
        return result(publication.status === "created" ? "stored" : "unchanged",
          { sequence: record.sequence, temporaryFileRetained: publication.temporaryFileRetained });
      } catch (error) { return result("failed", { code: error.code ?? "event_storage_unavailable" }); }
      finally { writing = false; }
    },
    async readEvent(options = {}) {
      // Optional narrow source verification for intake. Default still verifies every source.
      const selectedSources = options.sourceUpdateIds === undefined ? null : new Set(options.sourceUpdateIds);
      if (options.sourceUpdateIds !== undefined && (!Array.isArray(options.sourceUpdateIds)
        || options.sourceUpdateIds.some(id => typeof id !== "string")
        || selectedSources.size !== options.sourceUpdateIds.length)) throw lineageError("invalid_source_update_selection");
      try {
        const documents = await load(), records = documents.map(item => item.record);
        if (!records.length) return freezeLineage({ status: "missing", event, view: null });
        if (selectedSources && [...selectedSources].some(id => !records.some(record => record.command.updateId === id))) {
          throw lineageError("unknown_source_update");
        }
        const checks = await Promise.all(records.map(async record => {
          if (selectedSources && !selectedSources.has(record.command.updateId)) return { supported: false, code: "source_not_requested" };
          try {
            const current = await verifySource(historyProvider, event, record.command);
            return json(current) === json(record.sourceSnapshot)
              ? { supported: true } : { supported: false, code: "source_changed" };
          } catch (error) { return { supported: false, code: error.code ?? "invalid_source_reply" }; }
        }));
        const view = buildCmcpEventView(event, records, checks.map(check => check.supported));
        return freezeLineage({ status: "found", event, view,
          internal: { records, checks, sourceVerification: "exact_pointer_role_scope_citation", semanticVerification: "not_performed" } });
      } catch (error) {
        return freezeLineage({ status: "unavailable", event, view: null,
          diagnostics: [{ code: error.code ?? "event_storage_unavailable" }] });
      }
    }
  });
}
