import { parseCmcpInstant, resolveCmcpTimeContext } from "./resolve-cmcp-time-context.js";
import { formatCmcpLocalInstant } from "./project-cmcp-local-time.js";

const encoder = new TextEncoder();
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function result(modelContext, internal, diagnostics, candidate = null) {
  return {
    modelContext,
    internal,
    diagnostics,
    size: {
      outputBytes: encoder.encode(modelContext).length,
      outputCharacters: [...modelContext].length,
      candidateBytes: candidate === null ? null : encoder.encode(candidate).length,
      candidateCharacters: candidate === null ? null : [...candidate].length,
      tokenMeasurement: "not_measured"
    }
  };
}

function sourceTime(value, field, nowMs, diagnostics) {
  if (value === undefined || value === null) {
    diagnostics.push({ code: "unknown_source_time", field });
    return { instant: null, elapsedMs: null };
  }
  try {
    const instantMs = parseCmcpInstant(value, field);
    return { instant: new Date(instantMs).toISOString(), elapsedMs: nowMs - instantMs };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    diagnostics.push({ code: "invalid_source_time", field });
    return { instant: null, elapsedMs: null };
  }
}

/**
 * Single, caller-selected evidence -> bounded modelContext string.
 * Prototype interface only; see docs/temporal-evidence-projection-v0.1.md.
 * No I/O, clock fallback, ranking, text generation, or retained projection state.
 */
export function projectCmcpTemporalEvidence(input) {
  if (!isObject(input) || typeof input.enabled !== "boolean"
    || (input.clean !== undefined && typeof input.clean !== "boolean")) {
    throw new TypeError("invalid_projection_controls");
  }
  // A disabled/Clean projection must not even inspect the supplied evidence.
  if (!input.enabled || input.clean === true) {
    return result("", null, [{ code: input.clean === true ? "clean_projection" : "projection_disabled" }]);
  }

  const { limits, timeContext } = input;
  if (!isObject(limits)) throw new TypeError("invalid_projection_limits");
  const { maxBytes, maxCharacters } = limits;
  if (maxBytes === undefined && maxCharacters === undefined) {
    throw new TypeError("invalid_projection_limits");
  }
  for (const value of [maxBytes, maxCharacters]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new TypeError("invalid_projection_limits");
    }
  }
  if (timeContext === undefined) throw new TypeError("explicit_projection_time_required");
  const temporal = resolveCmcpTimeContext(timeContext);
  if (temporal.source !== "explicit_injected") throw new TypeError("explicit_projection_time_required");

  const evidence = input.evidence;
  if (!isObject(evidence) || typeof evidence.sourceRef !== "string" || evidence.sourceRef.length === 0) {
    return result("", null, [{ code: "invalid_evidence", field: "sourceRef" }]);
  }
  // Opaque reference: never sanitize, truncate, normalize, resolve, or project it.
  const internal = { sourceRef: evidence.sourceRef, sourceVerification: "not_performed" };
  const { sourceAuthorRole, content } = evidence;
  if (!["user", "assistant", "tool"].includes(sourceAuthorRole)) {
    return result("", internal, [{ code: "invalid_evidence", field: "sourceAuthorRole" }]);
  }
  if (!isObject(content) || !["source_excerpt", "derived_summary"].includes(content.kind)
    || typeof content.text !== "string" || content.text.length === 0) {
    return result("", internal, [{ code: "invalid_evidence", field: "content" }]);
  }

  const diagnostics = [];
  const message = sourceTime(evidence.messageRecordedAt, "messageRecordedAt", temporal.nowEpochMs, diagnostics);
  const event = sourceTime(evidence.eventOccurredAt, "eventOccurredAt", temporal.nowEpochMs, diagnostics);
  // Explicit allowlist. Never stringify the evidence envelope or entire runtime state.
  const candidate = JSON.stringify({
    time: {
      now: temporal.now,
      timezone: temporal.timezone,
      nowLocal: formatCmcpLocalInstant(temporal.now, temporal.timezone),
      messageRecordedAt: message.instant,
      localMessageRecordedAt: formatCmcpLocalInstant(message.instant, temporal.timezone),
      elapsedSinceMessageMs: message.elapsedMs,
      eventOccurredAt: event.instant,
      localEventOccurredAt: formatCmcpLocalInstant(event.instant, temporal.timezone),
      elapsedSinceEventMs: event.elapsedMs
    },
    source: { sourceAuthorRole, contentKind: content.kind },
    content: content.text
  });
  const bytes = encoder.encode(candidate).length;
  const characters = [...candidate].length;
  const exceeded = [];
  if (maxBytes !== undefined && bytes > maxBytes) exceeded.push("maxBytes");
  if (maxCharacters !== undefined && characters > maxCharacters) exceeded.push("maxCharacters");
  if (exceeded.length) {
    diagnostics.push({ code: "projection_budget_exceeded", limitsExceeded: exceeded });
    return result("", internal, diagnostics, candidate);
  }
  return result(candidate, internal, diagnostics, candidate);
}
