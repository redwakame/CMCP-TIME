import fs from "node:fs";
import path from "node:path";

import { getCmcpBundleRoot } from "./get-cmcp-runtime-policy.js";

const DEFAULT_STATE_ROOT = path.join(getCmcpBundleRoot(), "runtime-data", "cmcp-state");

const SECTION_FILES = {
  settings: "settings.json",
  staged: "staged.json",
  tracked: "tracked.json",
  daily_memory: "daily-memory.json",
  long_term_personalization: "long-term-personalization.json",
  tombstones: "tombstones.json"
};

function defaultValueForSection(section) {
  return section === "settings" ? {} : [];
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function readJsonOrDefault(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return fallback;
  }

  return JSON.parse(raw);
}

function readJsonOrDefaultFailClosed(filePath, fallback) {
  try {
    return readJsonOrDefault(filePath, fallback);
  } catch (_error) {
    return fallback;
  }
}

export function getCmcpStateRoot(stateRoot = null) {
  if (typeof stateRoot === "string" && stateRoot.trim()) {
    return path.resolve(stateRoot);
  }
  return DEFAULT_STATE_ROOT;
}

export function getCmcpSectionFilePath(section, options = {}) {
  const filename = SECTION_FILES[section];
  if (!filename) {
    throw new Error(`Unknown CMCP state section: ${section}`);
  }
  return path.join(getCmcpStateRoot(options.stateRoot), filename);
}

export function readCmcpStateSection(section, options = {}) {
  const fallback = defaultValueForSection(section);
  return readJsonOrDefault(getCmcpSectionFilePath(section, options), fallback);
}

export function writeCmcpStateSection(section, value, options = {}) {
  const filePath = getCmcpSectionFilePath(section, options);
  writeJsonAtomic(filePath, value);
  return {
    section,
    filePath
  };
}

export function upsertCmcpStateSection(section, transform, options = {}) {
  const current = readCmcpStateSection(section, options);
  const next = transform(current);
  writeCmcpStateSection(section, next, options);
  return next;
}

export function setCmcpSettingsValue(fieldPath, value, options = {}) {
  const settings = readCmcpStateSection("settings", options);
  const segments = String(fieldPath).split(".").filter(Boolean);
  let cursor = settings;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!cursor[segment] || typeof cursor[segment] !== "object" || Array.isArray(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  cursor[segments[segments.length - 1]] = value;
  writeCmcpStateSection("settings", settings, options);
  return settings;
}

export function buildCmcpBackgroundProfile(longTermRecords = []) {
  const profile = {};

  for (const record of longTermRecords) {
    if (!record || typeof record !== "object" || record.status !== "active") {
      continue;
    }

    const key = record.personalization_type ?? record.field_key ?? null;
    if (!key) {
      continue;
    }

    const value = record.stored_value ?? record.latest_user_owned_clause ?? record.continuity_value ?? null;
    if (value === null || value === undefined) {
      continue;
    }

    if (key === "language_preference") {
      profile.language = value;
      continue;
    }

    if (key === "stable_interaction_preference") {
      profile.interaction_preference = value;
      continue;
    }

    profile[key] = value;
  }

  return profile;
}

export function loadCmcpStateSnapshot(options = {}) {
  const trackedRecords = readJsonOrDefaultFailClosed(
    getCmcpSectionFilePath("tracked", options),
    defaultValueForSection("tracked")
  );
  const stagedRecords = readJsonOrDefaultFailClosed(
    getCmcpSectionFilePath("staged", options),
    defaultValueForSection("staged")
  );
  const dailyRecords = readJsonOrDefaultFailClosed(
    getCmcpSectionFilePath("daily_memory", options),
    defaultValueForSection("daily_memory")
  );
  const longTermRecords = readJsonOrDefaultFailClosed(
    getCmcpSectionFilePath("long_term_personalization", options),
    defaultValueForSection("long_term_personalization")
  );

  return {
    settings: readJsonOrDefaultFailClosed(
      getCmcpSectionFilePath("settings", options),
      defaultValueForSection("settings")
    ),
    trackedRecords,
    stagedRecords,
    dailyRecords,
    longTermRecords,
    tombstones: readJsonOrDefaultFailClosed(
      getCmcpSectionFilePath("tombstones", options),
      defaultValueForSection("tombstones")
    ),
    backgroundProfile: buildCmcpBackgroundProfile(longTermRecords)
  };
}
