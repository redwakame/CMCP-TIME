import fs from "node:fs";
import path from "node:path";

import { getCmcpBundleRoot } from "./get-cmcp-runtime-policy.js";

const SCHEMA_DIR = path.join(
  getCmcpBundleRoot(),
  "skills",
  "cmcp-core",
  "schemas"
);

const SCHEMA_FILES = {
  writeDecision: "cmcp-write-decision.schema.json",
  continuityContext: "cmcp-continuity-context.schema.json",
  storageAdapterDescriptor: "cmcp-storage-adapter-descriptor.schema.json",
  persistenceResult: "cmcp-persistence-result.schema.json"
};

let schemaRegistryCache = null;

function loadSchemaRegistry() {
  if (schemaRegistryCache) {
    return schemaRegistryCache;
  }

  const byKey = new Map();
  const byId = new Map();

  for (const [key, filename] of Object.entries(SCHEMA_FILES)) {
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, filename), "utf8"));
    byKey.set(key, schema);
    if (typeof schema.$id === "string" && schema.$id) {
      byId.set(schema.$id, schema);
    }
  }

  schemaRegistryCache = { byKey, byId };
  return schemaRegistryCache;
}

function getSchema(schemaKey) {
  const registry = loadSchemaRegistry();
  const schema = registry.byKey.get(schemaKey);
  if (!schema) {
    throw new Error(`Unknown CMCP runtime schema: ${schemaKey}`);
  }
  return schema;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAllowedType(value, allowedType) {
  if (allowedType === "string") return typeof value === "string";
  if (allowedType === "number") return typeof value === "number" && Number.isFinite(value);
  if (allowedType === "integer") return Number.isInteger(value);
  if (allowedType === "boolean") return typeof value === "boolean";
  if (allowedType === "array") return Array.isArray(value);
  if (allowedType === "object") return isPlainObject(value);
  if (allowedType === "null") return value === null;
  return true;
}

function joinPath(basePath, segment) {
  if (!basePath || basePath === "$") {
    return String(segment);
  }
  return `${basePath}.${segment}`;
}

function resolveSchemaRef(schema, registry, errors, pathLabel) {
  if (!schema.$ref) {
    return schema;
  }

  const resolved = registry.byId.get(schema.$ref);
  if (!resolved) {
    errors.push(`${pathLabel}: unresolved_ref`);
    return null;
  }

  return resolved;
}

function validateArrayItems(items, itemSchema, registry, errors, pathLabel) {
  if (!itemSchema) {
    return;
  }

  items.forEach((item, index) => {
    validateValueAgainstSchema(item, itemSchema, registry, errors, `${pathLabel}[${index}]`);
  });
}

function validateObjectProperties(value, schema, registry, errors, pathLabel) {
  if (!isPlainObject(value)) {
    return;
  }

  for (const requiredKey of schema.required ?? []) {
    if (!(requiredKey in value)) {
      errors.push(`${joinPath(pathLabel, requiredKey)}: missing_required`);
    }
  }

  const properties = schema.properties ?? {};

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        errors.push(`${joinPath(pathLabel, key)}: unexpected_property`);
      }
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in value)) {
      continue;
    }
    validateValueAgainstSchema(value[key], propertySchema, registry, errors, joinPath(pathLabel, key));
  }
}

function validateValueAgainstSchema(value, schemaInput, registry, errors, pathLabel = "$") {
  const schema = resolveSchemaRef(schemaInput, registry, errors, pathLabel);
  if (!schema) {
    return;
  }

  if (Array.isArray(schema.allOf)) {
    for (const subSchema of schema.allOf) {
      validateValueAgainstSchema(value, subSchema, registry, errors, pathLabel);
    }
  }

  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${pathLabel}: invalid_enum`);
  }

  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.some((allowedType) => isAllowedType(value, allowedType))) {
      errors.push(`${pathLabel}: invalid_type`);
      return;
    }
  }

  if (typeof value === "string" && typeof schema.minLength === "number" && value.length < schema.minLength) {
    errors.push(`${pathLabel}: min_length`);
  }

  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${pathLabel}: below_minimum`);
  }

  if (typeof value === "number" && typeof schema.maximum === "number" && value > schema.maximum) {
    errors.push(`${pathLabel}: above_maximum`);
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${pathLabel}: min_items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${pathLabel}: max_items`);
    }
    validateArrayItems(value, schema.items, registry, errors, pathLabel);
    return;
  }

  if (isPlainObject(value)) {
    validateObjectProperties(value, schema, registry, errors, pathLabel);
  }
}

function validateSchemaShape(schemaKey, value) {
  const registry = loadSchemaRegistry();
  const schema = getSchema(schemaKey);
  const errors = [];

  validateValueAgainstSchema(value, schema, registry, errors);

  return {
    valid: errors.length === 0,
    errors
  };
}

function assertValidSchemaShape(schemaKey, value, label) {
  const result = validateSchemaShape(schemaKey, value);
  if (!result.valid) {
    throw new Error(`Invalid ${label}: ${result.errors.join(", ")}`);
  }
  return value;
}

export function validateCmcpWriteDecision(value) {
  return validateSchemaShape("writeDecision", value);
}

export function assertValidCmcpWriteDecision(value) {
  return assertValidSchemaShape("writeDecision", value, "CMCP write decision");
}

export function validateCmcpContinuityContext(value) {
  return validateSchemaShape("continuityContext", value);
}

export function assertValidCmcpContinuityContext(value) {
  return assertValidSchemaShape("continuityContext", value, "CMCP continuity context");
}

export function validateCmcpStorageAdapterDescriptor(value) {
  return validateSchemaShape("storageAdapterDescriptor", value);
}

export function assertValidCmcpStorageAdapterDescriptor(value) {
  return assertValidSchemaShape("storageAdapterDescriptor", value, "CMCP storage adapter descriptor");
}

export function validateCmcpPersistenceResult(value) {
  return validateSchemaShape("persistenceResult", value);
}

export function assertValidCmcpPersistenceResult(value) {
  return assertValidSchemaShape("persistenceResult", value, "CMCP persistence result");
}
