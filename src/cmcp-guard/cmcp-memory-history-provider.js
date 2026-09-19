import { createCmcpSourcePointer, cmcpSourcePointerKey, validateCmcpSourceIdentity } from "./cmcp-source-pointer.js";
import { validateCmcpHistoryResolution } from "./cmcp-history-provider.js";

function itemKey(pointer) {
  const { revisionId, ...item } = pointer;
  return cmcpSourcePointerKey(item);
}

/** Read-only fixtures in volatile memory. Not an archive or revision history. */
export function createCmcpMemoryHistoryProvider({ providerNamespace, records }) {
  validateCmcpSourceIdentity(providerNamespace, "providerNamespace");
  if (!Array.isArray(records)) throw new TypeError("invalid_reference_history:records");
  const items = new Map();
  for (const record of records) {
    const pointer = createCmcpSourcePointer(record?.pointer);
    const normalized = validateCmcpHistoryResolution(record, pointer);
    if (pointer.providerNamespace !== providerNamespace || normalized.status === "changed") {
      throw new TypeError("invalid_reference_history:fixture");
    }
    const key = itemKey(pointer);
    if (items.has(key)) throw new TypeError("invalid_reference_history:duplicate_item");
    items.set(key, normalized);
  }
  return Object.freeze({
    descriptor: Object.freeze({ providerNamespace, implementation: "in_memory_reference", durable: false }),
    // Explicit declarations; unknown is not silently promoted to support.
    capabilities: Object.freeze({
      stableItemIdentity: "unknown", crossSessionResolve: true, revisionAware: true,
      messageRecordedAtAvailable: "unknown", eventOccurredAtAvailable: "unknown", rawContentAvailable: "unknown"
    }),
    async resolve(input) {
      const pointer = createCmcpSourcePointer(input);
      if (pointer.providerNamespace !== providerNamespace) return Object.freeze({ status: "unsupported", pointer });
      const record = items.get(itemKey(pointer));
      if (!record) return Object.freeze({ status: "missing", pointer });
      // Don't reveal revision/body information for a configured non-found state.
      if (record.status !== "found") return Object.freeze({ status: record.status, pointer });
      const requestedRevisionId = pointer.revisionId ?? null;
      const currentRevisionId = record.pointer.revisionId ?? null;
      if (requestedRevisionId !== currentRevisionId) {
        return Object.freeze({ status: "changed", pointer, requestedRevisionId, currentRevisionId });
      }
      return validateCmcpHistoryResolution({ status: "found", pointer, evidence: record.evidence }, pointer);
    }
  });
}
