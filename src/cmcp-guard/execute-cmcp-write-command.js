import { evaluateCmcpWriteCandidate } from "./evaluate-cmcp-write-candidate.js";
import {
  applyCmcpCorrectionAction,
  canApplyCmcpCorrectionAction
} from "./apply-cmcp-correction-action.js";
import { persistCmcpWriteDecision } from "./persist-cmcp-write.js";
import { tryResolveCmcpStorageAdapter } from "./cmcp-storage-adapter.js";
import { assertValidCmcpPersistenceResult } from "./validate-cmcp-runtime-shapes.js";
import { resolveCmcpTimeContext } from "./resolve-cmcp-time-context.js";

function noWriteResult(decision, storage, reasons) {
  return assertValidCmcpPersistenceResult({
    persisted: false,
    finalLayer: decision.finalLayer,
    storage,
    stateRoot: storage.stateRoot,
    touchedSections: [],
    createdIds: [],
    updatedIds: [],
    removedIds: [],
    tombstoneCount: 0,
    memoryPersisted: false,
    settingsPersisted: false,
    correctionPersisted: false,
    persistenceKinds: [],
    reasons
  });
}

/**
 * Synchronous, host-neutral single write boundary.
 * kind: candidate | correction; mode: preview | commit.
 * input is raw structured data; storageAdapter is required even for preview.
 * Preview evaluates policy but never calls storage reads or mutation methods.
 * Optional previewRecords supports correction presentation without storage IO.
 * Adapter exceptions during commit propagate: partial writes are not reported
 * as persisted:false. This boundary does not add transaction guarantees.
 */
export function executeCmcpWriteCommand(command = {}) {
  // Invalid explicit time throws before evaluation or any adapter invocation.
  const temporal = resolveCmcpTimeContext(command.timeContext);
  const { kind, mode, input, storageAdapter, previewRecords } = command;
  const validCommand = ["candidate", "correction"].includes(kind)
    && ["preview", "commit"].includes(mode)
    && input !== null && typeof input === "object" && !Array.isArray(input);
  const rawInput = validCommand ? structuredClone(input) : {};
  // Evaluate raw fields before normalization can discard invalid categories.
  const decision = validCommand
    ? kind === "correction"
      ? canApplyCmcpCorrectionAction(rawInput)
      : evaluateCmcpWriteCandidate(rawInput)
    : { ...evaluateCmcpWriteCandidate({}), reasons: ["invalid_write_command"] };
  const resolution = tryResolveCmcpStorageAdapter({ storageAdapter });

  if (!validCommand || !resolution.ok) {
    return {
      temporal,
      decision,
      persistence: noWriteResult(decision, resolution.storage, [
        ...(!validCommand ? ["invalid_write_command"] : []),
        ...(!resolution.ok ? ["storage_resolution_failed"] : [])
      ])
    };
  }

  const result = {
    temporal,
    decision,
    persistence: mode === "commit"
      ? persistCmcpWriteDecision(decision, rawInput, { storageAdapter: resolution.adapter }, temporal)
      : noWriteResult(decision, resolution.storage, ["preview_only"])
  };
  if (kind === "correction" && decision.accepted && Array.isArray(previewRecords)) {
    result.previewRecords = applyCmcpCorrectionAction(structuredClone(previewRecords), rawInput, temporal);
  }
  return result;
}
