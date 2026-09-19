import { parseCmcpInstant } from "./resolve-cmcp-time-context.js";

function fail(field) {
  throw new TypeError("invalid_temporal_encoding:" + field);
}

function fields(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || keys.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !keys.includes(key))) fail(label);
}

function precision(value, label) {
  // Caller-declared metadata, not inferred accuracy or a rounding instruction.
  if (value !== null && value !== "second" && value !== "millisecond") fail(label);
  return value;
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value)) fail(label);
  return value;
}

function canonical(instantMs) {
  safeInteger(instantMs, "instantMs");
  const date = new Date(instantMs);
  if (!Number.isFinite(date.getTime())) fail("instant_range");
  const timestamp = date.toISOString();
  // Keep decoded output consumable by the unchanged four-digit-year parser.
  // Offset inputs that spill beyond that UTC range are outside this trial.
  try { parseCmcpInstant(timestamp, "decodedInstant"); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    fail("instant_range");
  }
  return timestamp;
}

function section(input) {
  fields(input, ["version", "unit", "base", "entries"], "section");
  if (input.version !== 1) fail("version");
  if (input.unit !== "ms") fail("unit");
  fields(input.base, ["instant", "precision"], "base");
  const baseMs = parseCmcpInstant(input.base.instant, "base.instant");
  const base = {
    instant: canonical(baseMs),
    precision: precision(input.base.precision, "base.precision")
  };
  if (!Array.isArray(input.entries)) fail("entries");
  return { baseMs, base };
}

function entryMetadata(entry, valueKey) {
  fields(entry, ["sourceId", "timeKind", "precision", valueKey], "entry");
  if (typeof entry.sourceId !== "string" || entry.sourceId.length === 0) fail("sourceId");
  if (!["messageRecordedAt", "eventOccurredAt"].includes(entry.timeKind)) fail("timeKind");
  return {
    sourceId: entry.sourceId,
    timeKind: entry.timeKind,
    precision: precision(entry.precision, "entry.precision")
  };
}

/**
 * Absolute timestamps -> one base instant + signed integer millisecond offsets.
 * No source selection, storage, clock, or precision inference.
 * Prototype only: docs/temporal-encoding-trial-v0.1.md.
 */
export function encodeCmcpTemporalSection(input) {
  const { baseMs, base } = section(input);
  const entries = Array.from(input.entries, entry => {
    const metadata = entryMetadata(entry, "timestamp");
    if (entry.timestamp === null) return { ...metadata, deltaMs: null };
    const instantMs = parseCmcpInstant(entry.timestamp, "entry.timestamp");
    canonical(instantMs);
    return { ...metadata, deltaMs: safeInteger(instantMs - baseMs, "deltaMs") };
  });
  return { version: 1, unit: "ms", base, entries };
}

/** Restore the same instants and declared metadata, not original timestamp spelling. */
export function decodeCmcpTemporalSection(input) {
  const { baseMs, base } = section(input);
  const entries = Array.from(input.entries, entry => {
    const metadata = entryMetadata(entry, "deltaMs");
    if (entry.deltaMs === null) return { ...metadata, timestamp: null };
    const deltaMs = safeInteger(entry.deltaMs, "deltaMs");
    const instantMs = safeInteger(baseMs + deltaMs, "instantMs");
    return { ...metadata, timestamp: canonical(instantMs) };
  });
  return { version: 1, unit: "ms", base, entries };
}
