import {
  detectCmcpForbiddenText,
  isCmcpForbiddenCategory
} from "./detect-cmcp-forbidden-text.js";
import { getCmcpRuntimePolicy } from "./get-cmcp-runtime-policy.js";

export const CMCP_VALUE_LIMITS = Object.freeze({
  sourceRefMaxChars: 512,
  continuityValueMaxChars: 4096,
  latestUserOwnedClauseMaxChars: 4096,
  storedValueStringMaxChars: 1024,
  anchorTurnTextMaxChars: 1024,
  anchorTurnMaxItems: 50,
  resolutionConditionMaxChars: 512,
  fieldKeyMaxChars: 256,
  personalizationTypeMaxChars: 128,
  correctionReasonMaxChars: 256,
  settingsStringMaxChars: 128
});

const UNSAFE_TEXT_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isTooLong(value, maxChars) {
  return typeof value === "string" && value.length > maxChars;
}

export function sanitizeCmcpText(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(UNSAFE_TEXT_CHARS, "");
}

export function sanitizeCmcpScalarValue(value) {
  if (typeof value === "string") {
    return sanitizeCmcpText(value);
  }
  return value;
}

export function sanitizeCmcpAnchorTurns(turns) {
  if (!Array.isArray(turns)) {
    return [];
  }

  return turns.slice(0, CMCP_VALUE_LIMITS.anchorTurnMaxItems).map((turn) => ({
    role: turn?.role === "assistant" ? "assistant" : "user",
    text: sanitizeCmcpText(String(turn?.text ?? ""))
  }));
}

export function isCmcpScalarValue(value) {
  return value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function isRegisteredForbiddenCategory(category) {
  return typeof category === "string" && isCmcpForbiddenCategory(category);
}

export function normalizeRegisteredForbiddenCategory(category) {
  return isRegisteredForbiddenCategory(category) ? category : null;
}

export function resolveMostRestrictiveForbiddenCategory(categories) {
  const policy = getCmcpRuntimePolicy();
  let selectedCategory = null;
  let selectedPriority = -1;

  for (const category of categories) {
    if (!isRegisteredForbiddenCategory(category)) {
      continue;
    }

    let priority = 0;
    if (policy.forbiddenCategories.alwaysForbidden.includes(category)) {
      priority = 2;
    } else if (policy.forbiddenCategories.inferenceForbidden.includes(category)) {
      priority = 1;
    }

    if (priority > selectedPriority) {
      selectedPriority = priority;
      selectedCategory = category;
    }
  }

  return selectedCategory;
}

export function detectFirstForbiddenCategoryInEntries(entries = []) {
  for (const entry of entries) {
    if (!hasText(entry?.value)) {
      continue;
    }

    const matches = detectCmcpForbiddenText(entry.value);
    if (matches.length > 0) {
      return {
        category: matches[0].category,
        field: entry.field ?? null
      };
    }
  }

  return null;
}

export function collectCmcpCandidateTextEntries(candidate = {}) {
  const entries = [
    { field: "continuity_value", value: candidate.continuityValue, maxChars: CMCP_VALUE_LIMITS.continuityValueMaxChars },
    { field: "latest_user_owned_clause", value: candidate.latestUserOwnedClause, maxChars: CMCP_VALUE_LIMITS.latestUserOwnedClauseMaxChars },
    { field: "source_ref", value: candidate.evidenceRef, maxChars: CMCP_VALUE_LIMITS.sourceRefMaxChars },
    { field: "resolution_condition", value: candidate.resolutionCondition, maxChars: CMCP_VALUE_LIMITS.resolutionConditionMaxChars },
    { field: "field_key", value: candidate.fieldKey, maxChars: CMCP_VALUE_LIMITS.fieldKeyMaxChars },
    { field: "personalization_type", value: candidate.allowedPersonalizationType, maxChars: CMCP_VALUE_LIMITS.personalizationTypeMaxChars }
  ];

  if (typeof candidate.storedValue === "string") {
    entries.push({
      field: "stored_value",
      value: candidate.storedValue,
      maxChars: CMCP_VALUE_LIMITS.storedValueStringMaxChars
    });
  }

  for (const turn of Array.isArray(candidate.anchorTurns) ? candidate.anchorTurns : []) {
    entries.push({
      field: "anchorTurns.text",
      value: turn?.text,
      maxChars: CMCP_VALUE_LIMITS.anchorTurnTextMaxChars
    });
  }

  return entries;
}

export function collectCmcpRecordTextEntries(record = {}) {
  const entries = [
    { field: "source_ref", value: record.source_ref, maxChars: CMCP_VALUE_LIMITS.sourceRefMaxChars },
    { field: "continuity_value", value: record.continuity_value, maxChars: CMCP_VALUE_LIMITS.continuityValueMaxChars },
    { field: "latest_user_owned_clause", value: record.latest_user_owned_clause, maxChars: CMCP_VALUE_LIMITS.latestUserOwnedClauseMaxChars },
    { field: "resolution_condition", value: record.resolution_condition, maxChars: CMCP_VALUE_LIMITS.resolutionConditionMaxChars },
    { field: "field_key", value: record.field_key, maxChars: CMCP_VALUE_LIMITS.fieldKeyMaxChars },
    { field: "personalization_type", value: record.personalization_type, maxChars: CMCP_VALUE_LIMITS.personalizationTypeMaxChars },
    { field: "deletion_reason", value: record.deletion_reason, maxChars: CMCP_VALUE_LIMITS.correctionReasonMaxChars }
  ];

  if (typeof record.stored_value === "string") {
    entries.push({
      field: "stored_value",
      value: record.stored_value,
      maxChars: CMCP_VALUE_LIMITS.storedValueStringMaxChars
    });
  }

  for (const turn of Array.isArray(record.anchor_turns) ? record.anchor_turns : []) {
    entries.push({
      field: "anchor_turns.text",
      value: turn?.text,
      maxChars: CMCP_VALUE_LIMITS.anchorTurnTextMaxChars
    });
  }

  return entries;
}

export function assessCmcpTextEntries(entries = []) {
  const reasons = [];
  const detected = detectFirstForbiddenCategoryInEntries(entries);

  if (detected?.category) {
    reasons.push("forbidden_category");
  }

  for (const entry of entries) {
    if (typeof entry?.maxChars === "number" && isTooLong(entry.value, entry.maxChars)) {
      reasons.push(`${entry.field}_too_large`);
    }
  }

  return {
    reasons: [...new Set(reasons)],
    detectedForbiddenCategory: detected?.category ?? null,
    detectedField: detected?.field ?? null
  };
}

export function sanitizeCmcpMemoryRecordInput(record = {}) {
  return {
    ...record,
    source_ref: sanitizeCmcpText(record.source_ref),
    ...(Object.prototype.hasOwnProperty.call(record, "continuity_value")
      ? { continuity_value: sanitizeCmcpText(record.continuity_value) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "latest_user_owned_clause")
      ? { latest_user_owned_clause: sanitizeCmcpText(record.latest_user_owned_clause) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "resolution_condition")
      ? { resolution_condition: sanitizeCmcpText(record.resolution_condition) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "field_key")
      ? { field_key: sanitizeCmcpText(record.field_key) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "personalization_type")
      ? { personalization_type: sanitizeCmcpText(record.personalization_type) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "stored_value")
      ? { stored_value: sanitizeCmcpScalarValue(record.stored_value) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "deletion_reason")
      ? { deletion_reason: sanitizeCmcpText(record.deletion_reason) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "anchor_turns")
      ? { anchor_turns: sanitizeCmcpAnchorTurns(record.anchor_turns) }
      : {})
  };
}

export function assertCmcpMemoryRecordContentSafe(recordInput = {}) {
  const record = sanitizeCmcpMemoryRecordInput(recordInput);
  const reasons = [];
  const entries = collectCmcpRecordTextEntries(record);
  const textAssessment = assessCmcpTextEntries(entries);

  reasons.push(...textAssessment.reasons);

  if (!isCmcpScalarValue(record.stored_value)) {
    reasons.push("stored_value_must_be_scalar");
  }

  if (reasons.length > 0) {
    throw new Error(`Invalid CMCP memory record content: ${[...new Set(reasons)].join(", ")}`);
  }

  return record;
}
