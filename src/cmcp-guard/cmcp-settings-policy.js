import { getCmcpRuntimePolicy } from "./get-cmcp-runtime-policy.js";
import {
  CMCP_VALUE_LIMITS,
  isCmcpScalarValue,
  sanitizeCmcpText
} from "./cmcp-content-safety.js";
import { detectCmcpForbiddenText } from "./detect-cmcp-forbidden-text.js";

const TIME_VALUE_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

let allowedSettingsConfigCache = null;

function getAllowedSettingsConfig() {
  if (allowedSettingsConfigCache) {
    return allowedSettingsConfigCache;
  }

  const policy = getCmcpRuntimePolicy();
  const targets = new Set(policy.settingsOnly ?? []);
  const prefixes = new Set(policy.settingsValidation?.allowedTargetPrefixes ?? []);

  for (const fieldSpec of Object.values(policy.dualSurfaceFields ?? {})) {
    if (typeof fieldSpec?.settingsTarget === "string" && fieldSpec.settingsTarget) {
      targets.add(fieldSpec.settingsTarget);
    }
  }

  for (const fieldSpec of Object.values(policy.surfaceFieldMapping?.cmcpSetup?.fields ?? {})) {
    if (typeof fieldSpec?.settingsTarget === "string" && fieldSpec.settingsTarget) {
      targets.add(fieldSpec.settingsTarget);
    }
  }

  for (const fieldPath of Object.keys(policy.settingsValidation?.typedRules ?? {})) {
    if (!fieldPath.endsWith(".")) {
      targets.add(fieldPath);
    }
  }

  allowedSettingsConfigCache = { targets, prefixes };
  return allowedSettingsConfigCache;
}

function getAllowedSettingsPrefixMatch(fieldPath) {
  const { prefixes } = getAllowedSettingsConfig();
  for (const prefix of prefixes) {
    if (fieldPath.startsWith(prefix) && fieldPath.length > prefix.length) {
      return prefix;
    }
  }
  return null;
}

function isTimeSetting(fieldPath) {
  return [
    "quiet_hours.start",
    "quiet_hours.end",
    "routine_schedule.sleep_time",
    "routine_schedule.wake_time"
  ].includes(fieldPath);
}

function isBooleanSetting(fieldPath) {
  return fieldPath === "proactive_chat.enabled"
    || fieldPath === "memory_policy.global_opt_out"
    || getAllowedSettingsPrefixMatch(fieldPath) !== null;
}

function isNumericSetting(fieldPath) {
  return [
    "heartbeat.interval",
    "retry.interval",
    "max_unanswered_before_park"
  ].includes(fieldPath);
}

export function validateCmcpSettingsWrite(fieldPathInput, valueInput) {
  const fieldPath = sanitizeCmcpText(String(fieldPathInput ?? "").trim());
  const reasons = [];
  const { targets } = getAllowedSettingsConfig();
  const prefixMatch = getAllowedSettingsPrefixMatch(fieldPath);
  const value = typeof valueInput === "string" ? sanitizeCmcpText(valueInput) : valueInput;

  if (!fieldPath) {
    reasons.push("missing_settings_target");
  } else if (!targets.has(fieldPath) && !prefixMatch) {
    reasons.push("unknown_settings_target");
  }

  if (!isCmcpScalarValue(value)) {
    reasons.push("invalid_settings_value_type");
  }

  if (typeof value === "string") {
    if (value.length > CMCP_VALUE_LIMITS.settingsStringMaxChars) {
      reasons.push("settings_value_too_large");
    }
    if (detectCmcpForbiddenText(value).length > 0) {
      reasons.push("forbidden_settings_value");
    }
  }

  if (reasons.length === 0) {
    if (isTimeSetting(fieldPath) && (typeof value !== "string" || !TIME_VALUE_PATTERN.test(value))) {
      reasons.push("invalid_settings_time_format");
    } else if (isBooleanSetting(fieldPath) && typeof value !== "boolean") {
      reasons.push("invalid_settings_boolean_type");
    } else if (isNumericSetting(fieldPath) && (typeof value !== "number" || !Number.isFinite(value))) {
      reasons.push("invalid_settings_numeric_type");
    } else if (!isTimeSetting(fieldPath) && !isBooleanSetting(fieldPath) && !isNumericSetting(fieldPath) && typeof value !== "string") {
      reasons.push("invalid_settings_string_type");
    }
  }

  return {
    valid: reasons.length === 0,
    fieldPath,
    value,
    reasons
  };
}

export function assertValidCmcpSettingsWrite(fieldPathInput, valueInput) {
  const result = validateCmcpSettingsWrite(fieldPathInput, valueInput);
  if (!result.valid) {
    throw new Error(`Invalid CMCP settings write: ${result.reasons.join(", ")}`);
  }
  return {
    fieldPath: result.fieldPath,
    value: result.value
  };
}
