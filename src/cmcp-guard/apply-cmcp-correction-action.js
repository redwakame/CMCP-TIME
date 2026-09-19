import {
  getCmcpInvocationAreaSpec,
  getCmcpRuntimePolicy,
  getCmcpWriteRoute
} from "./get-cmcp-runtime-policy.js";
import { detectCmcpForbiddenText } from "./detect-cmcp-forbidden-text.js";
import {
  CMCP_VALUE_LIMITS,
  sanitizeCmcpText
} from "./cmcp-content-safety.js";
import { assertValidCmcpWriteDecision } from "./validate-cmcp-runtime-shapes.js";
import { bindCmcpWriteDecision } from "./cmcp-write-decision-binding.js";
import { resolveCmcpTimeContext } from "./resolve-cmcp-time-context.js";

const VALID_CORRECTION_ACTIONS = new Set(["replace", "delete", "suppress", "resolve", "opt_out"]);
const VALID_TARGET_SCOPES = new Set(["single_record", "memory_type", "category", "global"]);

export function recordMatchesCmcpCorrectionTarget(record, actionInput) {
  const action = normalizeCmcpCorrectionAction(actionInput);

  if (!record || typeof record !== "object") return false;
  if (action.target_scope === "global") return true;
  if (action.target_memory_id && record.memory_id === action.target_memory_id) return true;
  if (action.target_memory_id && record.derived_from === action.target_memory_id) return true;
  if (action.target_scope === "memory_type" && action.reason && record.memory_type === action.reason) return true;
  if (action.target_scope === "category" && action.reason) {
    return (
      record.sensitivity === action.reason ||
      record.field_key === action.reason ||
      record.personalization_type === action.reason
    );
  }
  return false;
}

function tombstone(record, action, timestamp) {
  return {
    memory_id: record.memory_id ?? null,
    deleted_at: timestamp,
    deleted_by: "user",
    deletion_reason: action.reason ?? "user_request"
  };
}

export function normalizeCmcpCorrectionAction(action = {}) {
  return {
    action: action.action ?? action.correctionAction ?? null,
    target_memory_id: action.target_memory_id ?? action.targetMemoryId ?? null,
    target_scope: action.target_scope ?? action.targetScope ?? "single_record",
    apply_to_layers: Array.isArray(action.apply_to_layers)
      ? action.apply_to_layers
      : Array.isArray(action.applyToLayers)
        ? action.applyToLayers
        : [],
    preserve_tombstone: (action.preserve_tombstone ?? action.preserveTombstone) !== false,
    redact_content: (action.redact_content ?? action.redactContent) !== false,
    reason: sanitizeCmcpText(action.reason ?? null),
    replacement_memory_id: action.replacement_memory_id ?? action.replacementMemoryId ?? null,
    sourceSurface: action.sourceSurface ?? action.source_surface ?? null,
    invocationArea: action.invocationArea ?? action.invocation_area ?? null,
    writeMode: action.writeMode ?? action.write_mode ?? "content_read_only_no_write"
  };
}

export function canApplyCmcpCorrectionAction(actionInput = {}) {
  return bindCmcpWriteDecision(evaluateCorrectionAction(actionInput), actionInput);
}

function evaluateCorrectionAction(actionInput) {
  const action = normalizeCmcpCorrectionAction(actionInput);
  const policy = getCmcpRuntimePolicy();
  const invocationAreaSpec = getCmcpInvocationAreaSpec(action.invocationArea);
  const authorizedAreas = policy.writeAuthorization.authorizedInvocationAreas.user_correction ?? [];
  const reasons = [];

  if (!VALID_CORRECTION_ACTIONS.has(action.action)) {
    reasons.push("invalid_correction_action");
  }

  if (!VALID_TARGET_SCOPES.has(action.target_scope)) {
    reasons.push("invalid_target_scope");
  }

  if (action.writeMode !== "explicit_write_enabled") {
    reasons.push("write_not_explicitly_enabled");
  }

  if (!action.invocationArea) {
    reasons.push("missing_invocation_area");
  }

  if (!invocationAreaSpec) {
    reasons.push("unknown_invocation_area");
  } else {
    if (!authorizedAreas.includes(action.invocationArea)) {
      reasons.push("invocation_area_not_authorized_for_user_correction");
    }
    if (!Array.isArray(invocationAreaSpec.allowedTargets) || !invocationAreaSpec.allowedTargets.includes("user_correction")) {
      reasons.push("invocation_area_target_mismatch");
    }
    if (action.sourceSurface && invocationAreaSpec.ownerSurface !== action.sourceSurface) {
      reasons.push("source_surface_does_not_own_invocation_area");
    }
  }

  if (action.target_scope === "single_record" && !action.target_memory_id) {
    reasons.push("missing_target_memory_id");
  }

  if (["category", "memory_type"].includes(action.target_scope) && (!action.reason || !action.reason.trim())) {
    reasons.push("missing_correction_reason");
  }

  if (action.action === "replace" && !action.replacement_memory_id) {
    reasons.push("missing_replacement_memory_id");
  }

  if (
    action.action === "replace"
    && action.target_memory_id
    && action.replacement_memory_id
    && action.target_memory_id === action.replacement_memory_id
  ) {
    reasons.push("replacement_memory_id_must_differ_from_target");
  }

  if (typeof action.reason === "string" && action.reason.length > CMCP_VALUE_LIMITS.correctionReasonMaxChars) {
    reasons.push("correction_reason_too_large");
  }

  if (typeof action.reason === "string" && action.reason.trim()) {
    const forbiddenMatches = detectCmcpForbiddenText(action.reason);
    if (forbiddenMatches.length > 0) {
      reasons.push("forbidden_correction_reason");
    }
  }

  const accepted = reasons.length === 0;

  return assertValidCmcpWriteDecision({
    accepted,
    persistentWrite: accepted,
    finalLayer: accepted ? "user_correction" : "session",
    targetLayer: accepted ? "user_correction" : null,
    decisionStep: "explicit_user_correction",
    ownerSurface: invocationAreaSpec?.ownerSurface ?? null,
    invocationArea: action.invocationArea,
    routeKey: accepted ? "manualMemoryWrite" : null,
    route: accepted ? getCmcpWriteRoute("manualMemoryWrite") : [],
    checkedSteps: ["explicit_user_correction"],
    reasons: accepted ? ["user_correction_rule_matched"] : reasons
  });
}

export function applyCmcpCorrectionAction(records = [], actionInput = {}, timeContext) {
  const timestamp = resolveCmcpTimeContext(timeContext).now;
  const action = normalizeCmcpCorrectionAction(actionInput);
  const decision = canApplyCmcpCorrectionAction(action);

  if (!decision.accepted) {
    throw new Error(`Invalid CMCP correction action: ${decision.reasons.join(", ")}`);
  }

  return records.map((record) => {
    if (!recordMatchesCmcpCorrectionTarget(record, action)) {
      return record;
    }

    if (action.action === "resolve") {
      return {
        ...record,
        status: "resolved",
        updated_at: timestamp
      };
    }

    if (action.action === "suppress") {
      return {
        ...record,
        status: "cancelled",
        updated_at: timestamp
      };
    }

    if (action.action === "replace") {
      return {
        ...record,
        status: "superseded",
        updated_at: timestamp,
        superseded_by: action.replacement_memory_id ?? null
      };
    }

    if (action.action === "opt_out") {
      return {
        ...record,
        status: "cancelled",
        updated_at: timestamp
      };
    }

    if (action.action === "delete") {
      return action.preserve_tombstone === false ? null : tombstone(record, action, timestamp);
    }

    return record;
  }).filter(Boolean);
}
