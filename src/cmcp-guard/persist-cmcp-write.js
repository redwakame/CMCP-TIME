import crypto from "node:crypto";

import {
  applyCmcpCorrectionAction,
  normalizeCmcpCorrectionAction,
  recordMatchesCmcpCorrectionTarget
} from "./apply-cmcp-correction-action.js";
import {
  getCmcpWriteCandidateSafetyAssessment,
  normalizeCmcpWriteCandidate
} from "./evaluate-cmcp-write-candidate.js";
import { isCmcpScalarValue } from "./cmcp-content-safety.js";
import { getCmcpInvocationAreaSpec, getCmcpRuntimePolicy } from "./get-cmcp-runtime-policy.js";
import { tryResolveCmcpStorageAdapter } from "./cmcp-storage-adapter.js";
import { validateCmcpSettingsWrite } from "./cmcp-settings-policy.js";
import {
  assertValidCmcpPersistenceResult,
  validateCmcpWriteDecision
} from "./validate-cmcp-runtime-shapes.js";
import { assertValidCmcpMemoryRecord } from "./validate-cmcp-record.js";
import { matchesCmcpWriteDecision } from "./cmcp-write-decision-binding.js";
import { resolveCmcpTimeContext } from "./resolve-cmcp-time-context.js";

const MEMORY_SECTIONS = ["staged", "tracked", "daily_memory", "long_term_personalization"];

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && value !== undefined && value !== false;
}

function buildMemoryId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function sanitizeAnchorTurns(turns, fallbackText) {
  if (Array.isArray(turns) && turns.length > 0) {
    return turns.map((turn) => ({
      role: turn.role === "assistant" ? "assistant" : "user",
      text: String(turn.text ?? "")
    }));
  }

  if (hasValue(fallbackText)) {
    return [{
      role: "user",
      text: String(fallbackText)
    }];
  }

  return [];
}

function addHours(timestamp, hours) {
  return new Date(new Date(timestamp).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function deriveSensitivity(candidate, policy) {
  if (candidate.allowedPersonalizationType && policy.restrictedFields.includes(candidate.allowedPersonalizationType)) {
    return "restricted";
  }
  return "ordinary";
}

function deriveConfidence(candidate) {
  if (candidate.userOwnership === "explicit") return 0.95;
  if (candidate.userOwnership === "repeated") return 0.85;
  return 0.65;
}

function deriveStoredValue(candidate) {
  if (candidate.storedValue !== null && candidate.storedValue !== undefined) {
    return candidate.storedValue;
  }
  if (hasValue(candidate.continuityValue)) {
    return candidate.continuityValue;
  }
  return null;
}

function deriveLatestUserOwnedClause(candidate) {
  return candidate.latestUserOwnedClause ?? candidate.continuityValue ?? null;
}

function normalizeFocusToken(value) {
  if (!hasValue(value)) {
    return null;
  }
  return String(value).trim().toLowerCase();
}

function getFocusTokens(recordLike) {
  return [
    recordLike?.source_ref ?? recordLike?.evidenceRef ?? null,
    recordLike?.continuity_value ?? recordLike?.continuityValue ?? null,
    recordLike?.latest_user_owned_clause ?? recordLike?.latestUserOwnedClause ?? null
  ].map(normalizeFocusToken).filter(Boolean);
}

function isSamePrimaryFocus(left, right) {
  const leftType = left?.memory_type ?? left?.memoryType ?? null;
  const rightType = right?.memory_type ?? right?.memoryType ?? null;

  if (leftType && rightType && leftType !== rightType) {
    return false;
  }

  const leftTokens = getFocusTokens(left);
  const rightTokens = getFocusTokens(right);
  return leftTokens.length > 0 && leftTokens.some((token) => rightTokens.includes(token));
}

function normalizePolicySettingSegment(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getNestedSetting(settings, path) {
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((cursor, segment) => (
      cursor && typeof cursor === "object" && !Array.isArray(cursor)
        ? cursor[segment]
        : undefined
    ), settings);
}

function getCmcpSuppressionReason(candidate, settings) {
  if (getNestedSetting(settings, "memory_policy.global_opt_out") === true) {
    return "global_memory_opt_out";
  }

  if (candidate.memoryType) {
    const memoryTypeKey = normalizePolicySettingSegment(candidate.memoryType);
    if (memoryTypeKey && getNestedSetting(settings, `memory_policy.opt_out_memory_types.${memoryTypeKey}`) === true) {
      return "memory_type_opted_out";
    }
  }

  for (const category of [candidate.allowedPersonalizationType, candidate.fieldKey]) {
    const categoryKey = normalizePolicySettingSegment(category);
    if (categoryKey && getNestedSetting(settings, `memory_policy.opt_out_categories.${categoryKey}`) === true) {
      return "category_opted_out";
    }
  }

  return null;
}

function getStorageContext(storageInput = {}) {
  return tryResolveCmcpStorageAdapter(storageInput);
}

function getPersistenceKinds({ persisted, finalLayer, touchedSections }) {
  if (persisted !== true) {
    return [];
  }

  const sections = new Set(Array.isArray(touchedSections) ? touchedSections : []);
  const kinds = [];

  if (sections.has("settings")) {
    kinds.push("settings");
  }

  if (["staged", "tracked", "daily_memory", "long_term_personalization", "tombstones"].some((section) => sections.has(section))) {
    kinds.push("memory");
  }

  if (finalLayer === "user_correction") {
    kinds.push("correction");
  }

  return kinds;
}

function buildPersistenceResult(finalLayer, storage, overrides = {}) {
  const base = {
    persisted: false,
    finalLayer,
    storage,
    stateRoot: storage.stateRoot ?? null,
    touchedSections: [],
    createdIds: [],
    updatedIds: [],
    removedIds: [],
    tombstoneCount: 0,
    memoryPersisted: false,
    settingsPersisted: false,
    correctionPersisted: false,
    persistenceKinds: []
  };
  const merged = {
    ...base,
    ...overrides
  };
  const persistenceKinds = overrides.persistenceKinds ?? getPersistenceKinds(merged);

  return assertValidCmcpPersistenceResult({
    ...merged,
    persistenceKinds,
    memoryPersisted: overrides.memoryPersisted ?? persistenceKinds.includes("memory"),
    settingsPersisted: overrides.settingsPersisted ?? persistenceKinds.includes("settings"),
    correctionPersisted: overrides.correctionPersisted ?? persistenceKinds.includes("correction")
  });
}

function buildBaseRecord(layer, candidate, decision, timestamp) {
  const policy = getCmcpRuntimePolicy();
  return {
    memory_id: buildMemoryId(layer),
    layer,
    memory_type: candidate.memoryType,
    source_kind: candidate.sourceKind,
    source_surface: candidate.sourceSurface ?? decision.ownerSurface ?? "cmcp_guard",
    source_ref: candidate.evidenceRef ?? `cmcp:${timestamp}`,
    user_ownership: candidate.userOwnership,
    confidence: deriveConfidence(candidate),
    status: "active",
    created_at: timestamp,
    updated_at: timestamp,
    owner_surface: decision.ownerSurface ?? "cmcp_guard",
    invocation_area: candidate.invocationArea,
    route_key: decision.routeKey,
    sensitivity: deriveSensitivity(candidate, policy)
  };
}

function buildDailyMemoryRecord(sourceRecord, changeType, timestamp, options = {}) {
  const redactDeletedContent = options.redactDeletedContent === true;
  return assertValidCmcpMemoryRecord({
    memory_id: buildMemoryId("daily"),
    layer: "daily_memory",
    memory_type: sourceRecord.memory_type,
    source_kind: "system_writeback",
    source_surface: "cmcp_guard",
    source_ref: sourceRecord.memory_id,
    user_ownership: sourceRecord.user_ownership,
    confidence: 1,
    status: "active",
    created_at: timestamp,
    updated_at: timestamp,
    owner_surface: "cmcp_guard",
    invocation_area: sourceRecord.invocation_area,
    route_key: sourceRecord.route_key,
    sensitivity: sourceRecord.sensitivity,
    derived_from: sourceRecord.memory_id,
    change_type: changeType,
    ...(redactDeletedContent ? {} : {
      latest_user_owned_clause: sourceRecord.latest_user_owned_clause ?? sourceRecord.continuity_value ?? null,
      anchor_turns: Array.isArray(sourceRecord.anchor_turns) ? sourceRecord.anchor_turns.slice(0, 4) : []
    })
  });
}

function appendDailyMemoryRecord(adapter, record, changeType, timestamp, options = {}) {
  const dailyRecord = buildDailyMemoryRecord(record, changeType, timestamp, options);
  adapter.upsertSection("daily_memory", (records) => [...records, dailyRecord]);
  return dailyRecord;
}

function persistStagedDecision(candidate, decision, context, timestamp) {
  const policy = getCmcpRuntimePolicy();
  const stagedRecord = assertValidCmcpMemoryRecord({
    ...buildBaseRecord("staged", candidate, decision, timestamp),
    anchor_turns: sanitizeAnchorTurns(candidate.anchorTurns, candidate.continuityValue),
    expires_at: addHours(timestamp, policy.stagedRule.defaultTtlHours),
    continuity_value: candidate.continuityValue,
    latest_user_owned_clause: deriveLatestUserOwnedClause(candidate)
  });

  const existingStaged = context.adapter.readSection("staged");
  const nextStaged = existingStaged.map((record) => {
    if (record.status !== "active" || !isSamePrimaryFocus(record, stagedRecord)) {
      return record;
    }

    return {
      ...record,
      status: "superseded",
      superseded_by: stagedRecord.memory_id,
      updated_at: timestamp
    };
  });

  nextStaged.push(stagedRecord);
  context.adapter.writeSection("staged", nextStaged);
  const dailyRecord = appendDailyMemoryRecord(context.adapter, stagedRecord, "created", timestamp);

  for (const record of nextStaged.filter((entry) => entry.status === "superseded" && entry.superseded_by === stagedRecord.memory_id)) {
    appendDailyMemoryRecord(context.adapter, record, "superseded", timestamp);
  }

  return buildPersistenceResult("staged", context.storage, {
    persisted: true,
    touchedSections: ["staged", "daily_memory"],
    createdIds: [stagedRecord.memory_id, dailyRecord.memory_id],
    updatedIds: nextStaged
      .filter((record) => record.status === "superseded" && record.superseded_by === stagedRecord.memory_id)
      .map((record) => record.memory_id)
  });
}

function persistTrackedDecision(candidate, decision, context, timestamp) {
  const trackedRecord = assertValidCmcpMemoryRecord({
    ...buildBaseRecord("tracked", candidate, decision, timestamp),
    anchor_turns: sanitizeAnchorTurns(candidate.anchorTurns, candidate.continuityValue),
    continuity_value: candidate.continuityValue,
    latest_user_owned_clause: deriveLatestUserOwnedClause(candidate),
    resolution_condition: candidate.resolutionCondition ?? "user_marks_done_or_followup_completed"
  });

  const stagedRecords = context.adapter.readSection("staged");
  const trackedRecords = context.adapter.readSection("tracked");
  const updatedStaged = stagedRecords.map((record) => {
    if (record.status !== "active" || !isSamePrimaryFocus(record, trackedRecord)) {
      return record;
    }

    return {
      ...record,
      status: "superseded",
      superseded_by: trackedRecord.memory_id,
      updated_at: timestamp
    };
  });
  const updatedTracked = trackedRecords.map((record) => {
    if (record.status !== "active" || !isSamePrimaryFocus(record, trackedRecord)) {
      return record;
    }

    return {
      ...record,
      status: "superseded",
      superseded_by: trackedRecord.memory_id,
      updated_at: timestamp
    };
  });

  context.adapter.writeSection("staged", updatedStaged);
  context.adapter.writeSection("tracked", [...updatedTracked, trackedRecord]);
  const createdDaily = appendDailyMemoryRecord(context.adapter, trackedRecord, "created", timestamp);

  for (const record of updatedStaged.filter((entry) => entry.status === "superseded" && entry.superseded_by === trackedRecord.memory_id)) {
    appendDailyMemoryRecord(context.adapter, record, "superseded", timestamp);
  }
  for (const record of updatedTracked.filter((entry) => entry.status === "superseded" && entry.superseded_by === trackedRecord.memory_id)) {
    appendDailyMemoryRecord(context.adapter, record, "superseded", timestamp);
  }

  return buildPersistenceResult("tracked", context.storage, {
    persisted: true,
    touchedSections: ["staged", "tracked", "daily_memory"],
    createdIds: [trackedRecord.memory_id, createdDaily.memory_id],
    updatedIds: [
      ...updatedStaged
        .filter((record) => record.status === "superseded" && record.superseded_by === trackedRecord.memory_id)
        .map((record) => record.memory_id),
      ...updatedTracked
        .filter((record) => record.status === "superseded" && record.superseded_by === trackedRecord.memory_id)
        .map((record) => record.memory_id)
    ]
  });
}

function resolvePersonalizationIdentity(candidate) {
  const policy = getCmcpRuntimePolicy();
  const setupField = policy.surfaceFieldMapping?.cmcpSetup?.fields?.[candidate.fieldKey ?? ""];
  return {
    fieldKey: candidate.fieldKey ?? candidate.allowedPersonalizationType ?? null,
    personalizationType: candidate.allowedPersonalizationType ?? setupField?.personalizationType ?? candidate.fieldKey ?? null
  };
}

function persistLongTermDecision(candidate, decision, context, timestamp) {
  const { fieldKey, personalizationType } = resolvePersonalizationIdentity(candidate);
  const storedValue = deriveStoredValue(candidate);
  if (storedValue === null || storedValue === undefined) {
    return buildPersistenceResult("long_term_personalization", context.storage, {
      reasons: ["missing_stored_value_for_long_term"]
    });
  }
  if (!isCmcpScalarValue(storedValue)) {
    return buildPersistenceResult("long_term_personalization", context.storage, {
      reasons: ["stored_value_must_be_scalar"]
    });
  }

  const longTermRecord = assertValidCmcpMemoryRecord({
    ...buildBaseRecord("long_term_personalization", candidate, decision, timestamp),
    field_key: fieldKey,
    personalization_type: personalizationType,
    stored_value: storedValue,
    latest_user_owned_clause: deriveLatestUserOwnedClause(candidate),
    stability_basis: candidate.sourceKind === "onboarding"
      ? "explicit_onboarding_answer"
      : candidate.stableSignalCount >= 2
        ? "repeated_consistent_signal"
        : "explicit_manual_memory_write"
  });

  const existing = context.adapter.readSection("long_term_personalization");
  const next = existing.map((record) => {
    const isSameField = record.status === "active" && (
      record.personalization_type === personalizationType ||
      record.field_key === fieldKey
    );

    if (!isSameField) {
      return record;
    }

    return {
      ...record,
      status: "superseded",
      superseded_by: longTermRecord.memory_id,
      updated_at: timestamp
    };
  });

  next.push(longTermRecord);
  context.adapter.writeSection("long_term_personalization", next);
  const dailyRecord = appendDailyMemoryRecord(context.adapter, longTermRecord, "created", timestamp);

  return buildPersistenceResult("long_term_personalization", context.storage, {
    persisted: true,
    touchedSections: ["long_term_personalization", "daily_memory"],
    createdIds: [longTermRecord.memory_id, dailyRecord.memory_id],
    updatedIds: next
      .filter((record) => record.status === "superseded" && record.superseded_by === longTermRecord.memory_id)
      .map((record) => record.memory_id)
  });
}

function resolveSettingsTarget(candidate) {
  const policy = getCmcpRuntimePolicy();
  const setupFields = policy.surfaceFieldMapping?.cmcpSetup?.fields ?? {};
  const setupAliases = policy.setupInputAliases ?? {};

  if (candidate.fieldKey && setupFields[candidate.fieldKey]?.settingsTarget) {
    return setupFields[candidate.fieldKey].settingsTarget;
  }

  const aliasedKey = candidate.fieldKey ? setupAliases[candidate.fieldKey] : null;
  if (aliasedKey && policy.dualSurfaceFields?.[aliasedKey]?.settingsTarget) {
    return policy.dualSurfaceFields[aliasedKey].settingsTarget;
  }

  if (candidate.fieldKey && policy.settingsOnly.includes(candidate.fieldKey)) {
    return candidate.fieldKey;
  }

  return null;
}

function persistSettingsDecision(candidate, decision, context) {
  const invocationAreaSpec = getCmcpInvocationAreaSpec(candidate.invocationArea);
  const settingsTarget = resolveSettingsTarget(candidate);
  const storedValue = deriveStoredValue(candidate);
  const reasons = [];

  if (candidate.writeMode !== "explicit_write_enabled") {
    reasons.push("write_not_explicitly_enabled");
  }

  if (!invocationAreaSpec) {
    reasons.push("unknown_invocation_area");
  } else {
    if (!Array.isArray(invocationAreaSpec.allowedTargets) || !invocationAreaSpec.allowedTargets.includes("settings")) {
      reasons.push("invocation_area_not_authorized_for_settings");
    }
    if (candidate.sourceSurface && invocationAreaSpec.ownerSurface !== candidate.sourceSurface) {
      reasons.push("source_surface_does_not_own_invocation_area");
    }
  }

  if (!settingsTarget) {
    reasons.push("missing_settings_target");
  }

  if (storedValue === null || storedValue === undefined) {
    reasons.push("missing_stored_value_for_settings");
  }

  const settingsValidation = reasons.length === 0
    ? validateCmcpSettingsWrite(settingsTarget, storedValue)
    : { valid: false, reasons: [] };
  if (!settingsValidation.valid) {
    reasons.push(...settingsValidation.reasons);
  }

  if (reasons.length > 0) {
    return buildPersistenceResult(decision.finalLayer, context.storage, { reasons });
  }

  context.adapter.setSettingsValue(settingsValidation.fieldPath, settingsValidation.value);
  return buildPersistenceResult("settings", context.storage, {
    persisted: true,
    touchedSections: ["settings"],
    updatedIds: [settingsTarget]
  });
}

function splitTombstones(records) {
  const liveRecords = [];
  const tombstones = [];

  for (const record of records) {
    if (record && typeof record === "object" && !("layer" in record)) {
      tombstones.push(record);
      continue;
    }
    liveRecords.push(record);
  }

  return { liveRecords, tombstones };
}

function findDirectTargetMatches(sectionSnapshots, targetMemoryId) {
  if (!targetMemoryId) {
    return [];
  }

  const matches = [];
  for (const [section, records] of sectionSnapshots.entries()) {
    for (const record of records) {
      if (record?.memory_id === targetMemoryId) {
        matches.push({ section, record });
      }
    }
  }

  return matches;
}

function findExistingTargetTombstone(adapter, targetMemoryId) {
  if (!targetMemoryId) {
    return null;
  }

  return adapter.readSection("tombstones").find((record) => record?.memory_id === targetMemoryId) ?? null;
}

function cleanupDerivedDailyRecords(targetMemoryId, context) {
  const before = context.adapter.readSection("daily_memory");
  const matches = before.filter((record) => record?.derived_from === targetMemoryId);

  if (matches.length === 0) {
    return {
      touched: false,
      removedIds: [],
      tombstones: []
    };
  }

  const after = applyCmcpCorrectionAction(before, {
    action: "delete",
    target_memory_id: targetMemoryId,
    target_scope: "single_record",
    invocationArea: "explicit_memory_correction_action",
    writeMode: "explicit_write_enabled"
  }, context.temporal);
  const { liveRecords, tombstones } = splitTombstones(after);
  context.adapter.writeSection("daily_memory", liveRecords);

  return {
    touched: true,
    removedIds: matches.map((record) => record.memory_id),
    tombstones: tombstones.map((record) => ({
      ...record,
      source_layer: "daily_memory"
    }))
  };
}

function buildOptOutSettingsUpdates(action) {
  if (action.action !== "opt_out") {
    return [];
  }

  if (action.target_scope === "global") {
    return [{
      fieldPath: "memory_policy.global_opt_out",
      value: true
    }];
  }

  if (action.target_scope === "memory_type") {
    const key = normalizePolicySettingSegment(action.reason);
    return key ? [{
      fieldPath: `memory_policy.opt_out_memory_types.${key}`,
      value: true
    }] : [];
  }

  if (action.target_scope === "category") {
    const key = normalizePolicySettingSegment(action.reason);
    return key ? [{
      fieldPath: `memory_policy.opt_out_categories.${key}`,
      value: true
    }] : [];
  }

  return [];
}

function persistCorrectionDecision(candidate, context, timestamp) {
  const action = normalizeCmcpCorrectionAction(candidate);
  const settingsUpdates = buildOptOutSettingsUpdates(action);
  const targetSections = Array.isArray(action.apply_to_layers) && action.apply_to_layers.length > 0
    ? action.apply_to_layers.filter((layer) => MEMORY_SECTIONS.includes(layer))
    : MEMORY_SECTIONS;
  if (Array.isArray(action.apply_to_layers) && action.apply_to_layers.length > 0 && targetSections.length === 0 && settingsUpdates.length === 0) {
    return buildPersistenceResult("user_correction", context.storage, {
      reasons: ["no_valid_target_layers"]
    });
  }

  const sectionSnapshots = new Map(
    targetSections.map((section) => [section, context.adapter.readSection(section)])
  );
  const directTargetMatches = findDirectTargetMatches(sectionSnapshots, action.target_memory_id);
  const existingTargetTombstone = findExistingTargetTombstone(context.adapter, action.target_memory_id);

  if (action.target_scope === "single_record") {
    if (action.action === "delete" && directTargetMatches.length === 0 && existingTargetTombstone) {
      return buildPersistenceResult("user_correction", context.storage, {
        reasons: ["target_already_deleted"]
      });
    }

    if (directTargetMatches.length === 0) {
      return buildPersistenceResult("user_correction", context.storage, {
        reasons: ["target_not_found"]
      });
    }
  }

  if (action.action === "replace") {
    const replacementExists = MEMORY_SECTIONS
      .map((section) => context.adapter.readSection(section))
      .flat()
      .some((record) => record?.memory_id === action.replacement_memory_id && record?.status === "active");

    if (!replacementExists) {
      return buildPersistenceResult("user_correction", context.storage, {
        reasons: ["replacement_memory_id_not_found"]
      });
    }
  }

  const touchedSections = new Set();
  const updatedIds = [];
  const removedIds = [];
  const createdIds = [];
  const tombstones = [];
  const matchedRecordsBefore = [];

  for (const section of targetSections) {
    const before = sectionSnapshots.get(section) ?? [];
    for (const record of before) {
      if (recordMatchesCmcpCorrectionTarget(record, action)) {
        matchedRecordsBefore.push(record);
      }
    }
    const after = applyCmcpCorrectionAction(before, action, context.temporal);
    const { liveRecords, tombstones: extractedTombstones } = splitTombstones(after);
    if (JSON.stringify(before) !== JSON.stringify(liveRecords)) {
      context.adapter.writeSection(section, liveRecords);
      touchedSections.add(section);
    }

    for (const record of liveRecords) {
      const previous = before.find((entry) => entry.memory_id === record.memory_id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
        updatedIds.push(record.memory_id);
      }
    }

    for (const previous of before) {
      if (!liveRecords.some((record) => record.memory_id === previous.memory_id)) {
        removedIds.push(previous.memory_id);
      }
    }

    for (const tombstone of extractedTombstones) {
      tombstones.push({
        ...tombstone,
        source_layer: section
      });
    }
  }

  if (matchedRecordsBefore.length === 0 && settingsUpdates.length === 0) {
    return buildPersistenceResult("user_correction", context.storage, {
      reasons: ["no_matching_records"]
    });
  }

  if (
    action.action === "delete"
    && action.target_scope === "single_record"
    && action.target_memory_id
    && !targetSections.includes("daily_memory")
    && directTargetMatches.some(({ section }) => section !== "daily_memory")
  ) {
    const cascade = cleanupDerivedDailyRecords(action.target_memory_id, context);
    if (cascade.touched) {
      touchedSections.add("daily_memory");
      removedIds.push(...cascade.removedIds);
      tombstones.push(...cascade.tombstones);
    }
  }

  for (const update of settingsUpdates) {
    context.adapter.setSettingsValue(update.fieldPath, update.value);
    touchedSections.add("settings");
    updatedIds.push(update.fieldPath);
  }

  if (tombstones.length > 0) {
    context.adapter.upsertSection("tombstones", (records) => [...records, ...tombstones]);
    touchedSections.add("tombstones");
  }

  const targetRecord = matchedRecordsBefore.find((record) => record.memory_id === action.target_memory_id)
    ?? matchedRecordsBefore[0]
    ?? null;

  if (targetRecord) {
    const changeType = action.action === "resolve"
      ? "resolved"
      : action.action === "suppress"
        ? "cancelled"
        : action.action === "opt_out"
          ? "cancelled"
        : action.action === "replace"
          ? "superseded"
          : "deleted";
    const dailyRecord = appendDailyMemoryRecord(
      context.adapter,
      targetRecord,
      changeType,
      timestamp,
      { redactDeletedContent: changeType === "deleted" }
    );
    touchedSections.add("daily_memory");
    createdIds.push(dailyRecord.memory_id);
  }

  return buildPersistenceResult("user_correction", context.storage, {
    persisted: true,
    touchedSections: [...touchedSections],
    createdIds,
    updatedIds,
    removedIds,
    tombstoneCount: tombstones.length
  });
}

export function persistCmcpWriteDecision(decisionInput, candidateInput, storageInput = {}, timeContext) {
  const temporal = resolveCmcpTimeContext(timeContext);
  const decision = decisionInput ?? {};
  // Snapshot before invoking host adapter code; never commit a different input
  // from the one that was evaluated, including nested content and corrections.
  candidateInput = structuredClone(candidateInput);
  let candidate = normalizeCmcpWriteCandidate(candidateInput);
  const timestamp = temporal.now;
  const storageResolution = getStorageContext(storageInput);
  const decisionValidation = validateCmcpWriteDecision(decision);
  const fallbackLayer = typeof decision.finalLayer === "string" ? decision.finalLayer : "session";

  if (!decisionValidation.valid) {
    return buildPersistenceResult(fallbackLayer, storageResolution.storage, {
      reasons: [
        "invalid_write_decision",
        ...decisionValidation.errors.map((error) => `decision.${error}`)
      ]
    });
  }

  if (decision.finalLayer === "session" || !decision.finalLayer) {
    return buildPersistenceResult(decision.finalLayer ?? "session", storageResolution.storage, {
      reasons: decision.reasons ?? ["session_only_no_persistent_write"]
    });
  }

  if (!storageResolution.ok) {
    return buildPersistenceResult(decision.finalLayer, storageResolution.storage, {
      reasons: [
        "storage_resolution_failed",
        storageResolution.error?.message ?? "unknown_storage_resolution_error"
      ]
    });
  }

  if (!matchesCmcpWriteDecision(decision, candidateInput)) {
    return buildPersistenceResult(decision.finalLayer, storageResolution.storage, {
      reasons: ["write_decision_input_mismatch"]
    });
  }

  const context = { ...storageResolution, temporal };

  if (decision.finalLayer !== "user_correction") {
    const safetyAssessment = getCmcpWriteCandidateSafetyAssessment(candidateInput);
    candidate = safetyAssessment.candidate;
    if (safetyAssessment.reasons.length > 0) {
      return buildPersistenceResult(decision.finalLayer, context.storage, {
        reasons: safetyAssessment.reasons
      });
    }
  }

  if (decision.finalLayer === "settings") {
    if (!candidate.sourceSurface) {
      return buildPersistenceResult("settings", context.storage, {
        reasons: ["missing_source_surface"]
      });
    }
    return persistSettingsDecision(candidate, decision, context);
  }

  if (!decision.accepted) {
    return buildPersistenceResult(decision.finalLayer, context.storage, {
      reasons: decision.reasons ?? ["write_not_accepted"]
    });
  }

  if (!candidate.sourceSurface) {
    return buildPersistenceResult(decision.finalLayer, context.storage, {
      reasons: ["missing_source_surface"]
    });
  }

  const suppressionReason = getCmcpSuppressionReason(candidate, context.adapter.readSection("settings"));
  if (suppressionReason) {
    return buildPersistenceResult(decision.finalLayer, context.storage, {
      reasons: [suppressionReason]
    });
  }

  if (decision.finalLayer === "staged") {
    return persistStagedDecision(candidate, decision, context, timestamp);
  }

  if (decision.finalLayer === "tracked") {
    return persistTrackedDecision(candidate, decision, context, timestamp);
  }

  if (decision.finalLayer === "long_term_personalization") {
    return persistLongTermDecision(candidate, decision, context, timestamp);
  }

  if (decision.finalLayer === "user_correction") {
    return persistCorrectionDecision(candidateInput, context, timestamp);
  }

  return buildPersistenceResult(decision.finalLayer, context.storage, {
    reasons: ["unsupported_final_layer"]
  });
}
