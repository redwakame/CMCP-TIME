import { parseCmcpInstant, resolveCmcpTimeContext } from "./resolve-cmcp-time-context.js";
import { getCmcpRuntimePolicy } from "./get-cmcp-runtime-policy.js";
import {
  CMCP_VALUE_LIMITS,
  assessCmcpTextEntries,
  collectCmcpRecordTextEntries,
  sanitizeCmcpMemoryRecordInput,
  sanitizeCmcpText
} from "./cmcp-content-safety.js";
import { detectCmcpForbiddenText } from "./detect-cmcp-forbidden-text.js";
import { assertValidCmcpContinuityContext } from "./validate-cmcp-runtime-shapes.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const ALLOWED_BACKGROUND_PROFILE_KEYS = new Set([
  "timezone",
  "language",
  "locale",
  "relationship",
  "use_case",
  "preferred_name",
  "form_of_address",
  "sleep_time",
  "wake_time",
  "interaction_preference"
]);

function normalizeSelectionRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  const sanitized = sanitizeCmcpMemoryRecordInput(record);
  const assessment = assessCmcpTextEntries(collectCmcpRecordTextEntries(sanitized));
  if (assessment.reasons.length > 0) {
    return null;
  }

  return sanitized;
}

function isEligibleCmcpAnchor(record, blockedStates, nowMs) {
  const expiresAt = typeof record?.expires_at === "string" ? Date.parse(record.expires_at) : null;
  const isExpiredByTimestamp = expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= nowMs);

  return (
    record &&
    typeof record === "object" &&
    !blockedStates.has(record.status ?? "active") &&
    !isExpiredByTimestamp &&
    !record.deleted_at &&
    !record.deleted &&
    !record.superseded_by
  );
}

function buildStructuredSourceEligibilityMap(trackedRecords, stagedRecords, blockedStates, nowMs) {
  const sourceEligibility = new Map();

  for (const record of [...asArray(trackedRecords), ...asArray(stagedRecords)]) {
    if (record && typeof record === "object" && typeof record.memory_id === "string" && record.memory_id) {
      sourceEligibility.set(record.memory_id, isEligibleCmcpAnchor(record, blockedStates, nowMs));
    }
  }

  return sourceEligibility;
}

function buildTombstonedSourceIdSet(tombstones) {
  const sourceIds = new Set();

  for (const tombstone of asArray(tombstones)) {
    if (tombstone && typeof tombstone === "object" && typeof tombstone.memory_id === "string" && tombstone.memory_id) {
      sourceIds.add(tombstone.memory_id);
    }
  }

  return sourceIds;
}

function isEligibleDailyAnchor(record, blockedStates, sourceEligibility, tombstonedSourceIds, nowMs) {
  if (!isEligibleCmcpAnchor(record, blockedStates, nowMs)) {
    return false;
  }

  const sourceId = typeof record?.derived_from === "string" ? record.derived_from : null;
  if (sourceId && tombstonedSourceIds.has(sourceId)) {
    return false;
  }
  if (sourceId && !sourceEligibility.has(sourceId)) {
    return false;
  }
  if (sourceId && sourceEligibility.has(sourceId) && sourceEligibility.get(sourceId) !== true) {
    return false;
  }

  return true;
}

function orderByRecency(records) {
  const datedRecords = [];
  for (const record of records) {
    try {
      datedRecords.push({ record, instant: parseCmcpInstant(record.updated_at, "updated_at") });
    } catch (error) {
      // Invalid/missing time excludes only this selection candidate, with no fallback.
      if (!(error instanceof TypeError)) throw error;
    }
  }
  // Equal instants compare as zero; Array.sort preserves their input order.
  return datedRecords.sort((left, right) => right.instant - left.instant).map(({ record }) => record);
}

function clampRecentContext(turns, maxTurns) {
  return asArray(turns).slice(0, maxTurns).map((turn) => ({
    role: turn.role === "assistant" ? "assistant" : "user",
    text: String(turn.text ?? "")
  }));
}

function buildNoneResult(backgroundProfile) {
  return {
    continuity_source: "none",
    anchor_level: "none",
    memory_id: null,
    recent_user_context: [],
    latest_user_owned_clause: null,
    resolution_state: "none",
    background_profile: backgroundProfile
  };
}

function normalizeBackgroundProfile(backgroundProfile) {
  const result = {};
  if (!backgroundProfile || typeof backgroundProfile !== "object" || Array.isArray(backgroundProfile)) {
    return result;
  }

  for (const [key, value] of Object.entries(backgroundProfile)) {
    if (!ALLOWED_BACKGROUND_PROFILE_KEYS.has(key)) {
      continue;
    }

    if (typeof value === "string") {
      const sanitized = sanitizeCmcpText(value);
      if (
        sanitized.length <= CMCP_VALUE_LIMITS.storedValueStringMaxChars
        && detectCmcpForbiddenText(sanitized).length === 0
      ) {
        result[key] = sanitized;
      }
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }

  return result;
}

function finalizeSelection(result) {
  return assertValidCmcpContinuityContext(result);
}

export function selectCmcpNewAnchor({
  trackedRecords = [],
  stagedRecords = [],
  dailyRecords = [],
  tombstones = [],
  backgroundProfile = {}
} = {}) {
  // Keep legacy expiry semantics; only centralize its system-clock acquisition.
  const nowMs = resolveCmcpTimeContext().nowEpochMs;
  const policy = getCmcpRuntimePolicy();
  const maxTurns = policy.anchorRules.maxRecentUserContextTurns;
  const blockedStates = new Set(asArray(policy.anchorRules.blockedStates));
  const selectionPriority = asArray(policy.newSessionSelectionPriority);
  const selectedBy = policy.surfaceOwnership?.runtimeEnforcement ?? "cmcp_guard";
  const normalizedBackgroundProfile = normalizeBackgroundProfile(backgroundProfile);
  const normalizedTrackedRecords = asArray(trackedRecords).map(normalizeSelectionRecord).filter(Boolean);
  const normalizedStagedRecords = asArray(stagedRecords).map(normalizeSelectionRecord).filter(Boolean);
  const normalizedDailyRecords = asArray(dailyRecords).map(normalizeSelectionRecord).filter(Boolean);
  const structuredSourceEligibility = buildStructuredSourceEligibilityMap(normalizedTrackedRecords, normalizedStagedRecords, blockedStates, nowMs);
  const tombstonedSourceIds = buildTombstonedSourceIdSet(tombstones);

  const tracked = orderByRecency(normalizedTrackedRecords.filter((record) => !tombstonedSourceIds.has(record.memory_id) && isEligibleCmcpAnchor(record, blockedStates, nowMs)));
  if (tracked.length > 0) {
    const selected = tracked[0];
    return finalizeSelection({
      continuity_source: "tracked",
      anchor_level: "tracked_followup",
      memory_id: selected.memory_id ?? null,
      recent_user_context: clampRecentContext(selected.anchor_turns, maxTurns),
      latest_user_owned_clause: selected.latest_user_owned_clause ?? null,
      resolution_state: selected.status,
      background_profile: normalizedBackgroundProfile,
      selection_priority: selectionPriority,
      selected_by: selectedBy
    });
  }

  const staged = orderByRecency(normalizedStagedRecords.filter((record) => !tombstonedSourceIds.has(record.memory_id) && isEligibleCmcpAnchor(record, blockedStates, nowMs)));
  if (staged.length > 0) {
    const selected = staged[0];
    return finalizeSelection({
      continuity_source: "staged",
      anchor_level: "staged_open_loop",
      memory_id: selected.memory_id ?? null,
      recent_user_context: clampRecentContext(selected.anchor_turns, maxTurns),
      latest_user_owned_clause: selected.latest_user_owned_clause ?? selected.continuity_value ?? null,
      resolution_state: selected.status,
      background_profile: normalizedBackgroundProfile,
      selection_priority: selectionPriority,
      selected_by: selectedBy
    });
  }

  const daily = orderByRecency(normalizedDailyRecords
    .filter((record) => isEligibleDailyAnchor(record, blockedStates, structuredSourceEligibility, tombstonedSourceIds, nowMs)));
  if (daily.length > 0) {
    const selected = daily[0];
    return finalizeSelection({
      continuity_source: "daily_memory",
      anchor_level: "background_only",
      memory_id: selected.memory_id ?? null,
      recent_user_context: [],
      latest_user_owned_clause: null,
      resolution_state: selected.status ?? "active",
      background_profile: normalizedBackgroundProfile,
      selection_priority: selectionPriority,
      selected_by: selectedBy
    });
  }

  return finalizeSelection({
    ...buildNoneResult(normalizedBackgroundProfile),
    selection_priority: selectionPriority,
    selected_by: selectedBy
  });
}
