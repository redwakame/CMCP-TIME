import { resolveCmcpTimeContext } from "./resolve-cmcp-time-context.js";
import { projectCmcpTemporalEvidence } from "./project-cmcp-temporal-evidence.js";
import { resolveCmcpHistorySource } from "./cmcp-history-provider.js";
import { cmcpSourcePointerKey } from "./cmcp-source-pointer.js";

/** Single explicit pointer -> async resolution -> existing bounded projection. */
export async function resolveCmcpTemporalEvidence(input) {
  if (!input || typeof input.enabled !== "boolean"
    || (input.clean !== undefined && typeof input.clean !== "boolean")) throw new TypeError("invalid_projection_controls");
  const { enabled, clean } = input;
  if (!enabled || clean === true) {
    const projection = projectCmcpTemporalEvidence({ enabled, clean });
    return { modelContext: "", resolution: null, projection, diagnostics: projection.diagnostics };
  }
  // Validate/snapshot controls before awaiting a provider; no legacy clock fallback.
  if (input.timeContext === undefined) throw new TypeError("explicit_projection_time_required");
  const temporal = resolveCmcpTimeContext(input.timeContext);
  if (temporal.source !== "explicit_injected") throw new TypeError("explicit_projection_time_required");
  if (!input.limits || typeof input.limits !== "object" || Array.isArray(input.limits)) {
    throw new TypeError("invalid_projection_limits");
  }
  const { maxBytes, maxCharacters } = input.limits;
  if ((maxBytes === undefined && maxCharacters === undefined)
    || [maxBytes, maxCharacters].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) {
    throw new TypeError("invalid_projection_limits");
  }
  const limits = { maxBytes, maxCharacters };
  const resolution = await resolveCmcpHistorySource({ provider: input.provider, pointer: input.pointer });
  if (resolution.status !== "found") {
    return {
      modelContext: "", resolution, projection: null,
      diagnostics: [{ code: "history_resolution", status: resolution.status }]
    };
  }
  const source = resolution.evidence;
  const projection = projectCmcpTemporalEvidence({
    enabled, clean, timeContext: temporal, limits,
    evidence: {
      // Transient bridge to the existing string interface, never a source_ref migration.
      sourceRef: cmcpSourcePointerKey(source.pointer),
      sourceAuthorRole: source.sourceAuthorRole,
      messageRecordedAt: source.messageRecordedAt,
      eventOccurredAt: source.eventOccurredAt,
      content: { kind: source.content.kind, text: source.content.body }
    }
  });
  return { modelContext: projection.modelContext, resolution, projection, diagnostics: projection.diagnostics };
}
