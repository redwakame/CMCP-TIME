const resolvedContexts = new WeakSet();

// Shared pure instant parser; no clock reads or fallback.
export function parseCmcpInstant(value, field = "timestamp") {
  // Require an explicit offset; never interpret a host string in machine-local time.
  const match = typeof value === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
    : null;
  if (!match) throw new TypeError(`invalid_time_context:${field}`);
  const [, year, month, day, hour, minute, second, , offset] = match;
  const y = Number(year);
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (+month < 1 || +month > 12 || +day < 1 || +day > days[+month - 1]
    || +hour > 23 || +minute > 59 || +second > 59
    || (offset !== "Z" && (+offset.slice(1, 3) > 23 || +offset.slice(4) > 59))
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`invalid_time_context:${field}`);
  }
  return Date.parse(value);
}

/** Single clock boundary. Omission alone enables legacy system-time fallback.
 * Explicit input requires {now: offset ISO timestamp, timezone, lastInteractionAt?}.
 * Frozen results can be passed through nested calls without resolving the clock again.
 */
export function resolveCmcpTimeContext(input) {
  if (resolvedContexts.has(input)) return input;
  const fallback = input === undefined;
  if (!fallback && (!input || typeof input !== "object" || Array.isArray(input))) {
    throw new TypeError("invalid_time_context:object_required");
  }
  const timezone = fallback ? "UTC" : input.timezone;
  if (typeof timezone !== "string" || !timezone.trim()) {
    throw new TypeError("invalid_time_context:timezone");
  }
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, calendar: "iso8601", numberingSystem: "latn",
      year: "numeric", month: "2-digit", day: "2-digit"
    });
  } catch {
    throw new TypeError("invalid_time_context:timezone");
  }
  const nowMs = fallback ? Date.now() : parseCmcpInstant(input.now, "now");
  const lastMs = fallback || input.lastInteractionAt === undefined
    ? null : parseCmcpInstant(input.lastInteractionAt, "lastInteractionAt");
  const dateAt = (ms) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(({ type, value }) => [type, value]));
    return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`;
  };
  const localDate = dateAt(nowMs);
  const lastInteractionLocalDate = lastMs === null ? null : dateAt(lastMs);
  const result = Object.freeze({
    version: 1,
    source: fallback ? "system_time_fallback" : "explicit_injected",
    now: new Date(nowMs).toISOString(), nowEpochMs: nowMs,
    timezone: formatter.resolvedOptions().timeZone,
    timezoneSource: fallback ? "fallback_utc" : "explicit_injected",
    lastInteractionAt: lastMs === null ? null : new Date(lastMs).toISOString(),
    elapsedSinceLastInteractionMs: lastMs === null ? null : nowMs - lastMs,
    localDate, lastInteractionLocalDate,
    crossedLocalDateBoundary: lastMs === null ? null : localDate !== lastInteractionLocalDate,
    lastInteractionInFuture: lastMs === null ? null : lastMs > nowMs
  });
  resolvedContexts.add(result);
  return result;
}
