import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_ROOT = path.resolve(MODULE_DIR, "..", "..");
const RUNTIME_POLICY_PATH = path.join(
  BUNDLE_ROOT,
  "skills",
  "cmcp-core",
  "contract",
  "cmcp-runtime-policy.json"
);

let runtimePolicyCache = null;

export function getCmcpBundleRoot() {
  return BUNDLE_ROOT;
}

export function getCmcpRuntimePolicy() {
  if (runtimePolicyCache) {
    return runtimePolicyCache;
  }

  runtimePolicyCache = JSON.parse(fs.readFileSync(RUNTIME_POLICY_PATH, "utf8"));
  return runtimePolicyCache;
}

export function getCmcpInvocationAreaSpec(invocationArea) {
  if (typeof invocationArea !== "string" || !invocationArea.trim()) {
    return null;
  }

  const policy = getCmcpRuntimePolicy();
  return policy.invocationAreaRegistry[invocationArea] ?? null;
}

export function getCmcpWriteRoute(routeKey) {
  if (typeof routeKey !== "string" || !routeKey.trim()) {
    return [];
  }

  const policy = getCmcpRuntimePolicy();
  return Array.isArray(policy.writeRoutes?.[routeKey]) ? policy.writeRoutes[routeKey] : [];
}

export function getCmcpSurfaceOwnership() {
  const policy = getCmcpRuntimePolicy();
  return policy.surfaceOwnership ?? {};
}
