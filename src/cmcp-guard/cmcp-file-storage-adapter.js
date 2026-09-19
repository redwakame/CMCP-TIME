import {
  getCmcpStateRoot,
  loadCmcpStateSnapshot,
  readCmcpStateSection,
  setCmcpSettingsValue,
  upsertCmcpStateSection,
  writeCmcpStateSection
} from "./cmcp-file-store.js";
import {
  CMCP_VALUE_LIMITS,
  assertCmcpMemoryRecordContentSafe,
  sanitizeCmcpText
} from "./cmcp-content-safety.js";
import { assertValidCmcpSettingsWrite } from "./cmcp-settings-policy.js";
import { detectCmcpForbiddenText } from "./detect-cmcp-forbidden-text.js";
import { assertValidCmcpMemoryRecord } from "./validate-cmcp-record.js";

const FILE_ADAPTER_CAPABILITIES = Object.freeze({
  sectionReads: true,
  sectionWrites: true,
  sectionUpserts: true,
  settingsWrites: true,
  snapshotReads: true,
  tombstones: true,
  atomicSectionWrite: true
});

export function getCmcpFileStorageAdapterCapabilities() {
  return { ...FILE_ADAPTER_CAPABILITIES };
}

function assertValidCmcpTombstoneRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Invalid CMCP tombstone: invalid_type");
  }
  if (typeof record.memory_id !== "string" || record.memory_id.trim().length === 0) {
    throw new Error("Invalid CMCP tombstone: memory_id_missing");
  }
  if (typeof record.deleted_at !== "string" || record.deleted_at.trim().length === 0) {
    throw new Error("Invalid CMCP tombstone: deleted_at_missing");
  }
  if (!["user", "system", "policy"].includes(record.deleted_by)) {
    throw new Error("Invalid CMCP tombstone: deleted_by_invalid");
  }
  const deletionReason = sanitizeCmcpText(record.deletion_reason);
  if (typeof deletionReason !== "string") {
    throw new Error("Invalid CMCP tombstone: deletion_reason_invalid");
  }
  if (deletionReason.length > CMCP_VALUE_LIMITS.correctionReasonMaxChars) {
    throw new Error("Invalid CMCP tombstone: deletion_reason_too_large");
  }
  if (deletionReason.trim() && detectCmcpForbiddenText(deletionReason).length > 0) {
    throw new Error("Invalid CMCP tombstone: forbidden_deletion_reason");
  }
  return {
    ...record,
    deletion_reason: deletionReason
  };
}

function assertValidCmcpSectionValue(section, value) {
  if (section === "settings") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid CMCP settings section: invalid_type");
    }
    return value;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid CMCP ${section} section: invalid_type`);
  }

  if (section === "tombstones") {
    return value.map((record) => assertValidCmcpTombstoneRecord(record));
  }

  return value.map((record) => {
    const sanitized = assertCmcpMemoryRecordContentSafe(record);
    assertValidCmcpMemoryRecord(sanitized);
    return sanitized;
  });
}

export function createCmcpFileStorageAdapter(options = {}) {
  const stateRoot = getCmcpStateRoot(options.stateRoot);

  return Object.freeze({
    adapterId: "cmcp.file",
    adapterKind: "file",
    stateRoot,
    capabilities: getCmcpFileStorageAdapterCapabilities(),
    readSection(section) {
      return readCmcpStateSection(section, { stateRoot });
    },
    writeSection(section, value) {
      return writeCmcpStateSection(section, assertValidCmcpSectionValue(section, value), { stateRoot });
    },
    upsertSection(section, transform) {
      return upsertCmcpStateSection(section, (current) => (
        assertValidCmcpSectionValue(section, transform(current))
      ), { stateRoot });
    },
    setSettingsValue(fieldPath, value) {
      const validated = assertValidCmcpSettingsWrite(fieldPath, value);
      return setCmcpSettingsValue(validated.fieldPath, validated.value, { stateRoot });
    },
    loadSnapshot() {
      return loadCmcpStateSnapshot({ stateRoot });
    },
    describe() {
      return {
        adapterId: "cmcp.file",
        adapterKind: "file",
        stateRoot,
        capabilities: getCmcpFileStorageAdapterCapabilities()
      };
    }
  });
}
