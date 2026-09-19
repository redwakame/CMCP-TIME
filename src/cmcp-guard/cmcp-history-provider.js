import { createCmcpSourcePointer, cmcpSourcePointerKey, validateCmcpSourceIdentity } from "./cmcp-source-pointer.js";
import { createCmcpSourceEvidence } from "./cmcp-source-evidence.js";

export const CMCP_HISTORY_CAPABILITIES = Object.freeze([
  "stableItemIdentity", "crossSessionResolve", "revisionAware",
  "messageRecordedAtAvailable", "eventOccurredAtAvailable", "rawContentAvailable"
]);
export const CMCP_HISTORY_STATUSES = Object.freeze([
  "found", "missing", "deleted", "changed", "permission_denied", "unavailable", "unsupported"
]);

export function describeCmcpHistoryProvider(provider) {
  const caps = provider?.capabilities;
  if (typeof provider?.resolve !== "function" || !caps || typeof caps !== "object"
    || Array.isArray(caps) || Object.keys(caps).some(key => !CMCP_HISTORY_CAPABILITIES.includes(key))
    || CMCP_HISTORY_CAPABILITIES.some(key => !Object.hasOwn(caps, key)
      || ![true, false, "unknown"].includes(caps[key]))) throw new TypeError("invalid_history_provider:capabilities");
  const providerNamespace = validateCmcpSourceIdentity(provider.descriptor?.providerNamespace, "providerNamespace");
  return Object.freeze({
    providerNamespace,
    capabilities: Object.freeze(Object.fromEntries(CMCP_HISTORY_CAPABILITIES.map(key => [key, caps[key]])))
  });
}

/** Validate replies and bind found evidence to the exact requested source/revision. */
export function validateCmcpHistoryResolution(input, requestedPointer) {
  const requested = createCmcpSourcePointer(requestedPointer);
  if (!input || !CMCP_HISTORY_STATUSES.includes(input.status)) throw new TypeError("invalid_history_resolution:status");
  const extra = input.status === "found" ? ["evidence"]
    : input.status === "changed" ? ["requestedRevisionId", "currentRevisionId"] : [];
  const keys = ["status", "pointer", ...extra];
  if (keys.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => !keys.includes(key))) {
    throw new TypeError("invalid_history_resolution:shape");
  }
  const pointer = createCmcpSourcePointer(input.pointer);
  if (cmcpSourcePointerKey(pointer) !== cmcpSourcePointerKey(requested)) {
    throw new TypeError("invalid_history_resolution:pointer_mismatch");
  }
  const result = { status: input.status, pointer };
  if (input.status === "found") {
    result.evidence = createCmcpSourceEvidence(input.evidence);
    if (cmcpSourcePointerKey(result.evidence.pointer) !== cmcpSourcePointerKey(requested)) {
      throw new TypeError("invalid_history_resolution:evidence_pointer_mismatch");
    }
  }
  if (input.status === "changed") {
    for (const key of extra) {
      result[key] = input[key] === null ? null : validateCmcpSourceIdentity(input[key], key);
    }
    if (result.requestedRevisionId !== (requested.revisionId ?? null)
      || result.requestedRevisionId === result.currentRevisionId) {
      throw new TypeError("invalid_history_resolution:revision_mismatch");
    }
  }
  return Object.freeze(result);
}

/** Async seam, deliberately separate from the synchronous write command. */
export async function resolveCmcpHistorySource({ provider, pointer }) {
  const requested = createCmcpSourcePointer(pointer);
  const descriptor = describeCmcpHistoryProvider(provider);
  if (requested.providerNamespace !== descriptor.providerNamespace) {
    return Object.freeze({ status: "unsupported", pointer: requested });
  }
  let reply;
  try { reply = await provider.resolve(requested); }
  catch {
    // Provider execution failure says nothing about deletion or permissions.
    return Object.freeze({ status: "unavailable", pointer: requested });
  }
  // Malformed/misdirected replies are contract errors, never usable evidence.
  return validateCmcpHistoryResolution(reply, requested);
}
