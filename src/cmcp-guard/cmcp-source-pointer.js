export const CMCP_SOURCE_IDENTITY_MAX_BYTES = 1024;
const encoder = new TextEncoder();
const required = ["version", "providerNamespace", "scopeId", "itemId"];
const optional = ["sessionId", "revisionId", "partId"];

/** Validate only; never normalize an opaque identity. No durability claim. */
export function validateCmcpSourceIdentity(value, field = "identity") {
  if (typeof value !== "string" || !value.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || encoder.encode(value).length > CMCP_SOURCE_IDENTITY_MAX_BYTES) {
    throw new TypeError("invalid_source_identity:" + field);
  }
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) throw new TypeError("invalid_source_identity:" + field);
  }
  return value;
}

export function createCmcpSourcePointer(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || required.some(key => !Object.hasOwn(input, key))
    || Object.keys(input).some(key => ![...required, ...optional].includes(key))
    || input.version !== 1) throw new TypeError("invalid_source_pointer");
  const pointer = { version: 1 };
  for (const key of [...required.slice(1), ...optional]) {
    if (Object.hasOwn(input, key)) pointer[key] = validateCmcpSourceIdentity(input[key], key);
  }
  return Object.freeze(pointer);
}

/** Canonical field order, not canonicalized identity values; not an Event ID. */
export function cmcpSourcePointerKey(input) {
  return JSON.stringify(createCmcpSourcePointer(input));
}
