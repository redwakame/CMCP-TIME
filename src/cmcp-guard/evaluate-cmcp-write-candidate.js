import {
  getCmcpInvocationAreaSpec,
  getCmcpRuntimePolicy,
  getCmcpWriteRoute
} from "./get-cmcp-runtime-policy.js";
import {
  isCmcpForbiddenCategory
} from "./detect-cmcp-forbidden-text.js";
import { canApplyCmcpCorrectionAction } from "./apply-cmcp-correction-action.js";
import { assertValidCmcpWriteDecision } from "./validate-cmcp-runtime-shapes.js";
import { bindCmcpWriteDecision } from "./cmcp-write-decision-binding.js";
import {
  assessCmcpTextEntries,
  collectCmcpCandidateTextEntries,
  isCmcpScalarValue,
  isRegisteredForbiddenCategory,
  normalizeRegisteredForbiddenCategory,
  resolveMostRestrictiveForbiddenCategory,
  sanitizeCmcpAnchorTurns,
  sanitizeCmcpScalarValue,
  sanitizeCmcpText
} from "./cmcp-content-safety.js";

function hasValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== null && value !== undefined && value !== false;
}

export function getCmcpWriteCandidateSafetyAssessment(candidateInput = {}) {
  const normalized = normalizeCmcpWriteCandidate(candidateInput);
  const reasons = [];
  const textAssessment = assessCmcpTextEntries(collectCmcpCandidateTextEntries(normalized));
  const effectiveForbiddenCategory = resolveMostRestrictiveForbiddenCategory([
    normalized.forbiddenCategory,
    normalized.inferenceForbiddenCategory,
    textAssessment.detectedForbiddenCategory
  ]);

  if (effectiveForbiddenCategory) {
    reasons.push("forbidden_category");
  }

  if (
    Object.prototype.hasOwnProperty.call(candidateInput, "hostClassifiedForbiddenCategory")
    || Object.prototype.hasOwnProperty.call(candidateInput, "inferenceForbiddenCategory")
  ) {
    const rawHostCategory = candidateInput.hostClassifiedForbiddenCategory ?? candidateInput.inferenceForbiddenCategory ?? null;
    if (rawHostCategory !== null && rawHostCategory !== undefined && !isRegisteredForbiddenCategory(rawHostCategory)) {
      reasons.push("unknown_host_forbidden_category");
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(candidateInput, "forbiddenCategory")
    && candidateInput.forbiddenCategory !== null
    && candidateInput.forbiddenCategory !== undefined
    && !isRegisteredForbiddenCategory(candidateInput.forbiddenCategory)
  ) {
    reasons.push("unknown_forbidden_category");
  }

  reasons.push(...textAssessment.reasons);

  if (!isCmcpScalarValue(normalized.storedValue)) {
    reasons.push("stored_value_must_be_scalar");
  }

  return {
    candidate: effectiveForbiddenCategory && normalized.forbiddenCategory !== effectiveForbiddenCategory
      ? { ...normalized, forbiddenCategory: effectiveForbiddenCategory }
      : normalized,
    reasons: [...new Set(reasons)],
    detectedForbiddenCategory: textAssessment.detectedForbiddenCategory
  };
}

export function normalizeCmcpWriteCandidate(candidate = {}) {
  return {
    memoryType: candidate.memoryType ?? "event",
    sourceKind: candidate.sourceKind ?? "dialogue",
    sourceSurface: sanitizeCmcpText(candidate.sourceSurface ?? null),
    fieldKey: sanitizeCmcpText(candidate.fieldKey ?? null),
    storedValue: sanitizeCmcpScalarValue(candidate.storedValue ?? candidate.value ?? null),
    writeMode: candidate.writeMode ?? "content_read_only_no_write",
    invocationArea: candidate.invocationArea ?? null,
    surfaceDisclosedMemoryEffect: candidate.surfaceDisclosedMemoryEffect === true,
    sourceConfirmed: candidate.sourceConfirmed !== false,
    continuityValue: sanitizeCmcpText(candidate.continuityValue ?? candidate.summary ?? ""),
    unresolved: candidate.unresolved !== false,
    inferenceForbiddenCategory: normalizeRegisteredForbiddenCategory(
      candidate.inferenceForbiddenCategory ?? candidate.hostClassifiedForbiddenCategory ?? null
    ),
    forbiddenCategory: normalizeRegisteredForbiddenCategory(candidate.forbiddenCategory ?? null),
    evidenceRef: sanitizeCmcpText(candidate.evidenceRef ?? candidate.sourceRef ?? null),
    explicitTracking: candidate.explicitTracking === true,
    repeatedCount: Number(candidate.repeatedCount ?? 0),
    reopenedAcrossSessions: candidate.reopenedAcrossSessions === true,
    dueAt: candidate.dueAt ?? null,
    retryAfter: candidate.retryAfter ?? null,
    followupWindow: candidate.followupWindow ?? null,
    userOwnership: candidate.userOwnership ?? "explicit",
    allowedPersonalizationType: sanitizeCmcpText(candidate.allowedPersonalizationType ?? null),
    stableSignalCount: Number(candidate.stableSignalCount ?? 0),
    userCanManage: candidate.userCanManage !== false,
    anchorTurns: sanitizeCmcpAnchorTurns(candidate.anchorTurns),
    latestUserOwnedClause: sanitizeCmcpText(candidate.latestUserOwnedClause ?? candidate.latest_user_owned_clause ?? null),
    resolutionCondition: sanitizeCmcpText(candidate.resolutionCondition ?? candidate.resolution_condition ?? null),
    correctionAction: candidate.correctionAction ?? candidate.action ?? null,
    targetMemoryId: candidate.targetMemoryId ?? candidate.target_memory_id ?? null,
    targetScope: candidate.targetScope ?? candidate.target_scope ?? "single_record"
  };
}

export function isCmcpSettingsOnlyField(fieldKey) {
  const policy = getCmcpRuntimePolicy();
  return typeof fieldKey === "string" && policy.settingsOnly.includes(fieldKey);
}

export function getCmcpInvocationAuthorization(candidateInput, layer) {
  const candidate = normalizeCmcpWriteCandidate(candidateInput);
  const policy = getCmcpRuntimePolicy();
  const invocationAreaSpec = getCmcpInvocationAreaSpec(candidate.invocationArea);
  const allowedAreas = policy.writeAuthorization.authorizedInvocationAreas[layer] ?? [];
  const reasons = [];

  if (candidate.writeMode !== "explicit_write_enabled") {
    reasons.push("write_not_explicitly_enabled");
  }

  if (!candidate.invocationArea) {
    reasons.push("missing_invocation_area");
  }

  if (!invocationAreaSpec) {
    reasons.push("unknown_invocation_area");
  } else {
    if (!allowedAreas.includes(candidate.invocationArea)) {
      reasons.push("invocation_area_not_authorized_for_layer");
    }
    if (!Array.isArray(invocationAreaSpec.allowedTargets) || !invocationAreaSpec.allowedTargets.includes(layer)) {
      reasons.push("invocation_area_target_mismatch");
    }
    if (candidate.sourceSurface && invocationAreaSpec.ownerSurface !== candidate.sourceSurface) {
      reasons.push("source_surface_does_not_own_invocation_area");
    }
  }

  return {
    authorized: reasons.length === 0,
    ownerSurface: invocationAreaSpec?.ownerSurface ?? null,
    invocationAreaSpec,
    reasons
  };
}

export function isCmcpPersistentWriteAuthorized(candidateInput, layer) {
  return getCmcpInvocationAuthorization(candidateInput, layer).authorized;
}

export function canEnterCmcpStaged(candidateInput) {
  const candidate = normalizeCmcpWriteCandidate(candidateInput);
  if (!isCmcpPersistentWriteAuthorized(candidate, "staged")) return false;
  if (!candidate.sourceConfirmed) return false;
  if (!hasValue(candidate.continuityValue)) return false;
  if (!candidate.unresolved) return false;
  if (candidate.forbiddenCategory && isCmcpForbiddenCategory(candidate.forbiddenCategory)) return false;
  if (!hasValue(candidate.evidenceRef)) return false;
  if (isCmcpSettingsOnlyField(candidate.fieldKey)) return false;
  return true;
}

export function shouldPromoteCmcpTracked(candidateInput) {
  const candidate = normalizeCmcpWriteCandidate(candidateInput);
  if (!isCmcpPersistentWriteAuthorized(candidate, "tracked")) return false;
  if (!canEnterCmcpStaged(candidate)) return false;
  if (candidate.explicitTracking) return true;
  if (candidate.repeatedCount >= 2) return true;
  if (candidate.reopenedAcrossSessions) return true;
  if (hasValue(candidate.dueAt) || hasValue(candidate.retryAfter) || hasValue(candidate.followupWindow)) {
    return true;
  }
  return false;
}

export function canBecomeCmcpLongTermPersonalization(candidateInput) {
  return getCmcpLongTermAssessment(candidateInput).accepted;
}

export function getCmcpLongTermAssessment(candidateInput) {
  const candidate = normalizeCmcpWriteCandidate(candidateInput);
  const policy = getCmcpRuntimePolicy();
  const authorization = getCmcpInvocationAuthorization(candidate, "long_term_personalization");
  const reasons = [];

  if (!authorization.authorized) {
    reasons.push(...authorization.reasons);
  }

  if (candidate.forbiddenCategory && isCmcpForbiddenCategory(candidate.forbiddenCategory)) {
    reasons.push("forbidden_category");
  }

  if (!candidate.allowedPersonalizationType) {
    reasons.push("missing_allowed_personalization_type");
  } else if (!policy.allowedPersonalizationTypes.includes(candidate.allowedPersonalizationType)) {
    reasons.push("unsupported_personalization_type");
  }

  if (!candidate.userCanManage) {
    reasons.push("user_manageability_required");
  }

  if (policy.restrictedFields.includes(candidate.allowedPersonalizationType)) {
    if (candidate.userOwnership !== "explicit") {
      reasons.push("explicit_user_ownership_required");
    }
    if (!candidate.surfaceDisclosedMemoryEffect) {
      reasons.push("surface_disclosed_memory_effect_required");
    }
  }

  let eligibleBySignal = false;
  if (candidate.sourceKind === "onboarding" && candidate.userOwnership === "explicit" && candidate.surfaceDisclosedMemoryEffect) {
    eligibleBySignal = true;
  } else if (candidate.userOwnership === "explicit" && candidate.surfaceDisclosedMemoryEffect && candidate.explicitTracking !== true) {
    eligibleBySignal = true;
  } else if (candidate.stableSignalCount >= 2 && candidate.userOwnership !== "derived" && candidate.surfaceDisclosedMemoryEffect) {
    eligibleBySignal = true;
  }

  if (!eligibleBySignal) {
    reasons.push("long_term_signal_not_strong_enough");
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    ownerSurface: authorization.ownerSurface,
    persistentWriteAuthorized: authorization.authorized
  };
}

function getRouteKeyForLayer(layer, candidate) {
  if (layer === "user_correction") return "manualMemoryWrite";
  if (layer === "settings") return "onboardingProfileCapture";
  if (layer === "long_term_personalization") {
    return candidate.sourceKind === "onboarding" ? "onboardingProfileCapture" : "manualMemoryWrite";
  }
  if (layer === "staged" || layer === "tracked") return "manualMemoryWrite";
  return null;
}

function buildDecision(candidate, {
  accepted,
  targetLayer,
  finalLayer,
  decisionStep,
  reasons,
  ownerSurface = null,
  persistentWriteAuthorized = false,
  checkedSteps = []
}) {
  const routeKey = getRouteKeyForLayer(finalLayer, candidate);
  return assertValidCmcpWriteDecision({
    accepted,
    persistentWrite: accepted,
    persistentWriteAuthorized,
    targetLayer,
    finalLayer,
    decisionStep,
    ownerSurface,
    invocationArea: candidate.invocationArea,
    routeKey,
    route: routeKey ? getCmcpWriteRoute(routeKey) : [],
    checkedSteps,
    reasons
  });
}

export function evaluateCmcpWriteCandidate(candidateInput) {
  return bindCmcpWriteDecision(evaluateCandidate(candidateInput), candidateInput);
}

function evaluateCandidate(candidateInput) {
  const safetyAssessment = getCmcpWriteCandidateSafetyAssessment(candidateInput);
  const candidate = safetyAssessment.candidate;
  const checkedSteps = [];

  checkedSteps.push("explicit_user_correction");
  if (candidate.correctionAction) {
    const correctionDecision = canApplyCmcpCorrectionAction(candidateInput);

    return {
      ...correctionDecision,
      checkedSteps
    };
  }

  checkedSteps.push("forbidden_persistence_filter");

  if (
    (candidate.forbiddenCategory && isCmcpForbiddenCategory(candidate.forbiddenCategory))
    || safetyAssessment.reasons.length > 0
  ) {
    return buildDecision(candidate, {
      accepted: false,
      targetLayer: null,
      finalLayer: "session",
      decisionStep: "forbidden_persistence_filter",
      reasons: safetyAssessment.reasons.length > 0 ? safetyAssessment.reasons : ["forbidden_category"],
      checkedSteps
    });
  }

  checkedSteps.push("settings_only_routing");
  if (isCmcpSettingsOnlyField(candidate.fieldKey)) {
    return buildDecision(candidate, {
      accepted: false,
      targetLayer: "settings",
      finalLayer: "settings",
      decisionStep: "settings_only_routing",
      reasons: ["settings_only_field"],
      checkedSteps
    });
  }

  checkedSteps.push("staged_eligibility");
  const stagedAuthorization = getCmcpInvocationAuthorization(candidate, "staged");
  const canStage = canEnterCmcpStaged(candidate);

  checkedSteps.push("tracked_promotion");
  const trackedAuthorization = getCmcpInvocationAuthorization(candidate, "tracked");
  if (shouldPromoteCmcpTracked(candidate)) {
    return buildDecision(candidate, {
      accepted: true,
      targetLayer: "tracked",
      finalLayer: "tracked",
      decisionStep: "tracked_promotion",
      reasons: ["tracked_promotion_rule_matched"],
      ownerSurface: trackedAuthorization.ownerSurface,
      persistentWriteAuthorized: trackedAuthorization.authorized,
      checkedSteps
    });
  }

  if (canStage) {
    return buildDecision(candidate, {
      accepted: true,
      targetLayer: "staged",
      finalLayer: "staged",
      decisionStep: "staged_eligibility",
      reasons: ["staged_write_rule_matched"],
      ownerSurface: stagedAuthorization.ownerSurface,
      persistentWriteAuthorized: stagedAuthorization.authorized,
      checkedSteps
    });
  }

  checkedSteps.push("long_term_personalization");
  const longTermAssessment = getCmcpLongTermAssessment(candidate);
  if (longTermAssessment.accepted) {
    return buildDecision(candidate, {
      accepted: true,
      targetLayer: "long_term_personalization",
      finalLayer: "long_term_personalization",
      decisionStep: "long_term_personalization",
      reasons: ["long_term_personalization_rule_matched"],
      ownerSurface: longTermAssessment.ownerSurface,
      persistentWriteAuthorized: longTermAssessment.persistentWriteAuthorized,
      checkedSteps
    });
  }

  checkedSteps.push("session_only_no_persistent_write");
  const combinedReasons = [
    ...new Set([
      ...trackedAuthorization.reasons,
      ...stagedAuthorization.reasons,
      ...longTermAssessment.reasons,
      "no_write_rule_matched_or_write_not_authorized"
    ].filter(Boolean))
  ];

  return buildDecision(candidate, {
    accepted: false,
    targetLayer: null,
    finalLayer: "session",
    decisionStep: "session_only_no_persistent_write",
    reasons: combinedReasons,
    checkedSteps
  });
}
