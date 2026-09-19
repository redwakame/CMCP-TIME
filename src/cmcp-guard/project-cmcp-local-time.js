import { parseCmcpInstant, resolveCmcpTimeContext } from "./resolve-cmcp-time-context.js";

/** Pure display of an existing instant in the supplied zone. Never observes a clock. */
export function formatCmcpLocalInstant(instant, timezone) {
  if (instant === null || instant === undefined) return null;
  const instantMs = parseCmcpInstant(instant);
  const temporal = resolveCmcpTimeContext({ now: instant, timezone });
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: temporal.timezone, calendar: "iso8601", numberingSystem: "latn",
    year: "numeric", era: "short", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    timeZoneName: "longOffset"
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instantMs)).map(({ type, value }) => [type, value]));
  const year = String(parts.era === "BC" ? 1 - Number(parts.year) : Number(parts.year)).padStart(4, "0");
  const offset = parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName.replace(/^GMT/, "");
  if (!/^[+-]\d{2}:\d{2}(?::\d{2})?$/.test(offset)) throw new TypeError("unsupported_local_time_offset");
  const milliseconds = String(new Date(instantMs).getUTCMilliseconds()).padStart(3, "0");
  return `${year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}${offset}`;
}

/** Explicit runtime -> small model projection. No complete state or diagnostic fields. */
export function projectCmcpRuntimeTime(timeContext) {
  if (timeContext === undefined) throw new TypeError("explicit_local_projection_time_required");
  const temporal = resolveCmcpTimeContext(timeContext);
  if (temporal.source !== "explicit_injected") throw new TypeError("explicit_local_projection_time_required");
  return {
    now: temporal.now, timezone: temporal.timezone,
    nowLocal: formatCmcpLocalInstant(temporal.now, temporal.timezone),
    ...(temporal.lastInteractionAt === null ? {} : {
      lastInteractionAt: temporal.lastInteractionAt,
      localLastInteractionAt: formatCmcpLocalInstant(temporal.lastInteractionAt, temporal.timezone),
      elapsedSinceLastInteractionMs: temporal.elapsedSinceLastInteractionMs,
      crossedLocalDateBoundary: temporal.crossedLocalDateBoundary
    })
  };
}
