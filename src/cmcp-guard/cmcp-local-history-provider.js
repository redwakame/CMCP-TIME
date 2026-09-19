import { createHash } from "node:crypto";
import { createCmcpSourcePointer, cmcpSourcePointerKey, validateCmcpSourceIdentity } from "./cmcp-source-pointer.js";
import { createCmcpSourceEvidence } from "./cmcp-source-evidence.js";
import { validateCmcpHistoryResolution } from "./cmcp-history-provider.js";

const format = "cmcp-local-history-reference";
const digest = text => createHash("sha256").update(text, "utf8").digest("hex");
const invalidData = () => Object.assign(new Error("stored_data_invalid"), { code: "HISTORY_INVALID_DATA" });

function serialize(evidence) {
  return JSON.stringify({ format, version: 1, evidenceSha256: digest(JSON.stringify(evidence)), evidence });
}

function deserialize(data, pointer) {
  try {
    const stored = JSON.parse(data);
    if (!stored || Object.keys(stored).length !== 4
      || stored.format !== format || stored.version !== 1
      || !/^[a-f0-9]{64}$/.test(stored.evidenceSha256)) throw invalidData();
    const evidence = createCmcpSourceEvidence(stored.evidence);
    if (digest(JSON.stringify(evidence)) !== stored.evidenceSha256
      || cmcpSourcePointerKey(evidence.pointer) !== cmcpSourcePointerKey(pointer)) throw invalidData();
    return evidence;
  } catch { throw invalidData(); }
}

function failureCode(error) {
  if (["EACCES", "EPERM"].includes(error?.code)) return "permission_denied";
  if (error?.code === "HISTORY_INVALID_DATA") return "stored_data_invalid";
  return "storage_unavailable";
}

/**
 * Explicit writeEvidence(envelope) + the existing async resolve(pointer) seam.
 * The injected backend must provide read(key) and exclusive create(key, data).
 */
export function createCmcpLocalHistoryProvider({ providerNamespace, backend }) {
  validateCmcpSourceIdentity(providerNamespace, "providerNamespace");
  if (!backend || typeof backend.read !== "function" || typeof backend.create !== "function") {
    throw new TypeError("invalid_local_history_backend");
  }
  // Snapshot the dependency methods; no silent filesystem/default backend.
  const read = backend.read.bind(backend), create = backend.create.bind(backend);
  const listKeys = typeof backend.listKeys === 'function' ? backend.listKeys.bind(backend) : null;
  async function load(pointer) {
    const data = await read(digest(cmcpSourcePointerKey(pointer)));
    if (data === null) return null;
    if (typeof data !== "string") throw invalidData();
    return deserialize(data, pointer);
  }
  return Object.freeze({
    descriptor: Object.freeze({ providerNamespace, implementation: "local_history_reference" }),
    capabilities: Object.freeze({
      // Lookup keys are stable; the caller's original ID provenance is not verified.
      stableItemIdentity: "unknown", crossSessionResolve: true, revisionAware: true,
      messageRecordedAtAvailable: "unknown", eventOccurredAtAvailable: "unknown", rawContentAvailable: "unknown"
    }),
    // Bounded verified inventory pages. The cursor binds the exact key set;
    // changes require a fresh inventory, never silently skip newly added keys.
    async listPointerPage({scopeId,maxRecords,cursor=null}) {
      validateCmcpSourceIdentity(scopeId,'scopeId');
      if(!Number.isSafeInteger(maxRecords)||maxRecords<1)throw Error('explicit_history_inventory_limit_required');
      if(cursor!==null&&(!cursor||cursor.version!==1||typeof cursor.afterKey!=='string'||!/^[a-f0-9]{64}$/.test(cursor.afterKey)
        ||typeof cursor.inventoryHash!=='string'||!/^[a-f0-9]{64}$/.test(cursor.inventoryHash)))throw Error('invalid_history_inventory_cursor');
      if(!listKeys)return {status:'unsupported',pointers:[],complete:false};
      try {
        const keys=await listKeys();
        if(!Array.isArray(keys)||new Set(keys).size!==keys.length||keys.some(key=>!/^[a-f0-9]{64}$/.test(key)))throw invalidData();
        keys.sort();const inventoryHash=digest(JSON.stringify({providerNamespace,scopeId,keys}));
        if(cursor&&(cursor.inventoryHash!==inventoryHash||!keys.includes(cursor.afterKey)))return {status:'stale_cursor',pointers:[],complete:false,recordCount:keys.length};
        const start=cursor?keys.indexOf(cursor.afterKey)+1:0,selected=keys.slice(start,start+maxRecords),pointers=[],failures=[];
        for(const key of selected){try {
          const data=await read(key),raw=JSON.parse(data),pointer=createCmcpSourcePointer(raw.evidence?.pointer),evidence=deserialize(data,pointer);
          if(digest(cmcpSourcePointerKey(pointer))!==key||pointer.providerNamespace!==providerNamespace)throw invalidData();
          if(pointer.scopeId===scopeId)pointers.push(evidence.pointer);
        }catch(error){failures.push({key,code:failureCode(error)});}}
        const complete=start+selected.length===keys.length;
        return {status:failures.length?'unavailable':complete?'complete':'partial',pointers,complete,recordCount:keys.length,
          scannedRecords:selected.length,failures,nextCursor:complete?null:{version:1,afterKey:selected.at(-1),inventoryHash}};
      }catch(error){return {status:'unavailable',pointers:[],complete:false,code:failureCode(error)};}
    },
    // Explicit bounded local recovery inventory, never a global/Host history scan.
    async listPointers({scopeId,maxRecords}) {
      validateCmcpSourceIdentity(scopeId,'scopeId');
      if(!Number.isSafeInteger(maxRecords)||maxRecords<1)throw Error('explicit_history_inventory_limit_required');
      if(!listKeys)return {status:'unsupported',pointers:[]};
      try {
        const keys=await listKeys();
        if(!Array.isArray(keys)||new Set(keys).size!==keys.length||keys.some(key=>!/^[a-f0-9]{64}$/.test(key)))throw invalidData();
        if(keys.length>maxRecords)return {status:'limit_exceeded',pointers:[],recordCount:keys.length};
        const pointers=[];
        for(const key of keys){
          const data=await read(key),raw=JSON.parse(data),pointer=createCmcpSourcePointer(raw.evidence?.pointer);
          const evidence=deserialize(data,pointer);
          if(digest(cmcpSourcePointerKey(pointer))!==key||pointer.providerNamespace!==providerNamespace)throw invalidData();
          if(pointer.scopeId===scopeId)pointers.push(evidence.pointer);
        }
        return {status:'complete',pointers};
      }catch(error){return {status:'unavailable',pointers:[],code:failureCode(error)};}
    },
    async resolve(input) {
      const pointer = createCmcpSourcePointer(input);
      if (pointer.providerNamespace !== providerNamespace) return Object.freeze({ status: "unsupported", pointer });
      try {
        const evidence = await load(pointer);
        return validateCmcpHistoryResolution(
          evidence === null ? { status: "missing", pointer } : { status: "found", pointer, evidence }, pointer);
      } catch (error) {
        const status = failureCode(error) === "permission_denied" ? "permission_denied" : "unavailable";
        return Object.freeze({ status, pointer });
      }
    },
    async writeEvidence(input) {
      // Validate/copy before the first await: later caller mutation cannot change a write.
      const evidence = createCmcpSourceEvidence(input), pointer = evidence.pointer;
      const result = (status, details = {}) => Object.freeze({ status, pointer, ...details });
      if (pointer.providerNamespace !== providerNamespace) return result("failed", { code: "unsupported" });
      const canonical = JSON.stringify(evidence);
      const compare = stored => JSON.stringify(stored) === canonical ? "unchanged" : "conflict";
      try {
        const existing = await load(pointer);
        if (existing !== null) return result(compare(existing));
        const publication = await create(digest(cmcpSourcePointerKey(pointer)), serialize(evidence));
        if (!publication || !["created", "exists"].includes(publication.status)
          || typeof publication.temporaryFileRetained !== "boolean") throw invalidData();
        // A backend acknowledgement alone is insufficient: re-read and bind the publication.
        const stored = await load(pointer);
        if (stored === null) throw invalidData();
        const equality = compare(stored);
        if (publication.status === "created" && equality !== "unchanged") throw invalidData();
        return result(publication.status === "created" ? "stored" : equality,
          { temporaryFileRetained: publication.temporaryFileRetained });
      } catch (error) { return result("failed", { code: failureCode(error) }); }
    }
  });
}
