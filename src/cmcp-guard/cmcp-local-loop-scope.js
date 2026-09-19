import { validateCmcpSourceIdentity as identity } from "./cmcp-source-pointer.js";
/** Caller-owned scope only; no domain template, classification or aspect remapping. */
export function normalizeLocalLoopObjects(objects) {
  if (!Array.isArray(objects) || !objects.length) throw Error("explicit_object_scope_required");
  const result = objects.map(object => {
    if (!object || Object.keys(object).length !== 2 || !Object.hasOwn(object, "objectId") || !Array.isArray(object.aspects)
      || !object.aspects.length || new Set(object.aspects).size !== object.aspects.length) throw Error("invalid_loop_object_scope");
    return { objectId: identity(object.objectId), aspects: object.aspects.map(aspect => identity(aspect)) };
  });
  if (new Set(result.map(object => object.objectId)).size !== result.length) throw Error("duplicate_loop_object");
  return result;
}
export function parseLocalLoopScope({ objectsJson, object, aspect }) {
  if (objectsJson !== undefined && (object !== undefined || aspect !== undefined)) throw Error("mixed_scope_configuration");
  return normalizeLocalLoopObjects(objectsJson === undefined ? [{ objectId: object, aspects: [aspect] }] : JSON.parse(objectsJson));
}
