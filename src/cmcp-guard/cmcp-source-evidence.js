import { createCmcpSourcePointer, validateCmcpSourceIdentity } from "./cmcp-source-pointer.js";
import { parseCmcpInstant } from "./resolve-cmcp-time-context.js";

function shape(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => ![...required, ...optional].includes(key))) {
    throw new TypeError("invalid_source_evidence:shape");
  }
}

/** Source data only: no inference, confirmation, event identity, or memory state. */
export function createCmcpSourceEvidence(input) {
  shape(input, ["pointer", "sourceKind", "sourceAuthorRole", "messageRecordedAt", "eventOccurredAt", "content"], ["metadata"]);
  const pointer = createCmcpSourcePointer(input.pointer);
  const { sourceKind, sourceAuthorRole, messageRecordedAt, eventOccurredAt } = input;
  if (!["message", "tool_result"].includes(sourceKind)
    || !["user", "assistant", "tool"].includes(sourceAuthorRole)
    || ((sourceKind === "tool_result") !== (sourceAuthorRole === "tool"))) {
    throw new TypeError("invalid_source_evidence:source_type");
  }
  for (const [field, time] of Object.entries({ messageRecordedAt, eventOccurredAt })) {
    if (time !== null) parseCmcpInstant(time, field);
  }
  shape(input.content, ["kind", "body"]);
  if (!["source_excerpt", "derived_summary"].includes(input.content.kind)
    || typeof input.content.body !== "string") throw new TypeError("invalid_source_evidence:content");
  const result = {
    pointer, sourceKind, sourceAuthorRole, messageRecordedAt, eventOccurredAt,
    content: Object.freeze({ kind: input.content.kind, body: input.content.body })
  };
  if (Object.hasOwn(input, "metadata")) {
    shape(input.metadata, [], ["revisionId", "availability"]);
    const metadata = {};
    if (Object.hasOwn(input.metadata, "revisionId")) {
      metadata.revisionId = validateCmcpSourceIdentity(input.metadata.revisionId, "metadata.revisionId");
      if (metadata.revisionId !== pointer.revisionId) throw new TypeError("invalid_source_evidence:revision");
    }
    if (Object.hasOwn(input.metadata, "availability")) {
      if (!["available", "partial", "unknown"].includes(input.metadata.availability)) {
        throw new TypeError("invalid_source_evidence:availability");
      }
      metadata.availability = input.metadata.availability;
    }
    result.metadata = Object.freeze(metadata);
  }
  return Object.freeze(result);
}
