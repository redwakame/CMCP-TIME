import fs from "node:fs";
import path from "node:path";

import { getCmcpBundleRoot } from "./get-cmcp-runtime-policy.js";
import { CMCP_VALUE_LIMITS } from "./cmcp-content-safety.js";

const SCHEMA_PATH = path.join(
  getCmcpBundleRoot(),
  "skills",
  "cmcp-core",
  "schemas",
  "cmcp-memory-record.schema.json"
);

let memorySchemaCache = null;

function getMemorySchema() {
  if (memorySchemaCache) {
    return memorySchemaCache;
  }

  memorySchemaCache = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  return memorySchemaCache;
}

function isAllowedType(value, allowedType) {
  if (allowedType === "string") return typeof value === "string";
  if (allowedType === "number") return typeof value === "number" && Number.isFinite(value);
  if (allowedType === "boolean") return typeof value === "boolean";
  if (allowedType === "array") return Array.isArray(value);
  if (allowedType === "object") return value && typeof value === "object" && !Array.isArray(value);
  if (allowedType === "null") return value === null;
  return true;
}

function checkPropertyShape(key, value, schema, errors) {
  if (value === undefined) {
    return;
  }

  const propertySchema = schema.properties?.[key];
  if (!propertySchema) {
    return;
  }

  if (propertySchema.enum && !propertySchema.enum.includes(value)) {
    errors.push(`${key}: invalid_enum`);
  }

  if (propertySchema.type) {
    const types = Array.isArray(propertySchema.type) ? propertySchema.type : [propertySchema.type];
    if (!types.some((allowedType) => isAllowedType(value, allowedType))) {
      errors.push(`${key}: invalid_type`);
    }
  }

  if (typeof value === "string") {
    if (typeof propertySchema.minLength === "number" && value.length < propertySchema.minLength) {
      errors.push(`${key}: min_length`);
    }
    if (typeof propertySchema.maxLength === "number" && value.length > propertySchema.maxLength) {
      errors.push(`${key}: max_length`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof propertySchema.minItems === "number" && value.length < propertySchema.minItems) {
      errors.push(`${key}: min_items`);
    }
    if (typeof propertySchema.maxItems === "number" && value.length > propertySchema.maxItems) {
      errors.push(`${key}: max_items`);
    }
  }
}

export function validateCmcpMemoryRecord(record) {
  const schema = getMemorySchema();
  const errors = [];

  for (const key of schema.required ?? []) {
    if (!(key in record)) {
      errors.push(`${key}: missing_required`);
    }
  }

  for (const key of Object.keys(record)) {
    checkPropertyShape(key, record[key], schema, errors);
  }

  if (record.layer === "staged") {
    for (const key of ["anchor_turns", "expires_at"]) {
      if (!(key in record)) {
        errors.push(`${key}: missing_for_staged`);
      }
    }
  }

  if (Array.isArray(record.anchor_turns)) {
    record.anchor_turns.forEach((turn, index) => {
      if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
        errors.push(`anchor_turns[${index}]: invalid_type`);
        return;
      }

      const keys = Object.keys(turn);
      if (keys.some((key) => !["role", "text"].includes(key))) {
        errors.push(`anchor_turns[${index}]: unexpected_property`);
      }
      if (!["user", "assistant"].includes(turn.role)) {
        errors.push(`anchor_turns[${index}].role: invalid_enum`);
      }
      if (typeof turn.text !== "string") {
        errors.push(`anchor_turns[${index}].text: invalid_type`);
      } else if (turn.text.length > CMCP_VALUE_LIMITS.anchorTurnTextMaxChars) {
        errors.push(`anchor_turns[${index}].text: max_length`);
      }
    });
  }

  if (record.layer === "tracked") {
    for (const key of ["continuity_value", "resolution_condition", "latest_user_owned_clause"]) {
      if (!(key in record)) {
        errors.push(`${key}: missing_for_tracked`);
      }
    }
  }

  if (record.layer === "daily_memory") {
    for (const key of ["derived_from", "change_type"]) {
      if (!(key in record)) {
        errors.push(`${key}: missing_for_daily_memory`);
      }
    }
  }

  if (record.layer === "long_term_personalization" && !("stability_basis" in record)) {
    errors.push("stability_basis: missing_for_long_term_personalization");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function assertValidCmcpMemoryRecord(record) {
  const result = validateCmcpMemoryRecord(record);
  if (!result.valid) {
    throw new Error(`Invalid CMCP memory record: ${result.errors.join(", ")}`);
  }
  return record;
}
