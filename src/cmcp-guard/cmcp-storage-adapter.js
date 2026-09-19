import { createCmcpFileStorageAdapter } from "./cmcp-file-storage-adapter.js";
import { assertValidCmcpStorageAdapterDescriptor } from "./validate-cmcp-runtime-shapes.js";

const REQUIRED_STORAGE_METHODS = [
  "readSection",
  "writeSection",
  "upsertSection",
  "setSettingsValue",
  "loadSnapshot"
];

const EMPTY_STORAGE_CAPABILITIES = Object.freeze({
  sectionReads: false,
  sectionWrites: false,
  sectionUpserts: false,
  settingsWrites: false,
  snapshotReads: false,
  tombstones: false,
  atomicSectionWrite: false
});

function hasRequiredMethods(candidate) {
  return REQUIRED_STORAGE_METHODS.every((method) => typeof candidate?.[method] === "function");
}

function normalizeStorageDescriptor(adapter, described = {}) {
  return assertValidCmcpStorageAdapterDescriptor({
    adapterId: described.adapterId ?? adapter.adapterId ?? "cmcp.unknown",
    adapterKind: described.adapterKind ?? adapter.adapterKind ?? "unknown",
    stateRoot: described.stateRoot ?? adapter.stateRoot ?? null,
    capabilities: described.capabilities ?? adapter.capabilities ?? {}
  });
}

function inferStorageInputDescriptor(input = {}) {
  const storageDescriptor = input.storage && typeof input.storage === "object"
    ? input.storage
    : null;
  return assertValidCmcpStorageAdapterDescriptor({
    adapterId: "cmcp.unresolved",
    adapterKind: storageDescriptor?.kind ?? storageDescriptor?.adapterKind ?? "unknown",
    stateRoot: storageDescriptor?.stateRoot ?? input.stateRoot ?? null,
    capabilities: { ...EMPTY_STORAGE_CAPABILITIES }
  });
}

export function isCmcpStorageAdapter(candidate) {
  return Boolean(candidate) && typeof candidate === "object" && hasRequiredMethods(candidate);
}

export function assertValidCmcpStorageAdapter(candidate) {
  if (!isCmcpStorageAdapter(candidate)) {
    throw new Error("Invalid CMCP storage adapter: missing required adapter methods");
  }
  return candidate;
}

export function describeCmcpStorageAdapter(candidate) {
  const adapter = assertValidCmcpStorageAdapter(candidate);
  const described = typeof adapter.describe === "function" ? adapter.describe() : {};
  return normalizeStorageDescriptor(adapter, described);
}

export function resolveCmcpStorageAdapter(input = {}) {
  if (isCmcpStorageAdapter(input)) {
    return assertValidCmcpStorageAdapter(input);
  }

  if (Object.prototype.hasOwnProperty.call(input, "storageAdapter")) {
    return assertValidCmcpStorageAdapter(input.storageAdapter);
  }

  if (Object.prototype.hasOwnProperty.call(input, "adapter")) {
    return assertValidCmcpStorageAdapter(input.adapter);
  }

  const storageDescriptor = input.storage && typeof input.storage === "object"
    ? input.storage
    : null;
  const adapterKind = storageDescriptor?.kind ?? storageDescriptor?.adapterKind ?? "file";

  if (adapterKind !== "file") {
    throw new Error(`Unsupported CMCP storage adapter kind: ${adapterKind}`);
  }

  return createCmcpFileStorageAdapter({
    stateRoot: storageDescriptor?.stateRoot ?? input.stateRoot ?? null
  });
}

export function tryResolveCmcpStorageAdapter(input = {}) {
  try {
    const adapter = resolveCmcpStorageAdapter(input);
    return {
      ok: true,
      adapter,
      storage: describeCmcpStorageAdapter(adapter),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      adapter: null,
      storage: inferStorageInputDescriptor(input),
      error
    };
  }
}
