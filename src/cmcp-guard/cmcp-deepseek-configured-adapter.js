import { createCmcpResponsesTransport } from "./cmcp-responses-transport.js";
import { createLocalLoopJournal, loopHash } from "./cmcp-local-loop-journal.js";
import { LOOP_INSTRUCTIONS, LOOP_SCHEMAS, LOOP_EVENT_REVIEW_PROTOCOL } from "./cmcp-local-loop-protocol.js";

// Official Responses/pricing documentation verified 2026-09-13; no model probing/fallback.
export const DEEPSEEK_LOOP_CONFIG = Object.freeze({ endpoint: "https://api.deepseek.com/responses", model: "deepseek-flash",
  reasoning: "none", providerId: "deepseek-responses", strictFormat: false, maxOutputTokens: 1200,
  maxRequestBytes: 16384, maxResponseBytes: 131072, timeoutMs: 90000, maxCalls: 6 });
export const DEEPSEEK_PREFLIGHT_CONFIG = Object.freeze({ ...DEEPSEEK_LOOP_CONFIG,
  maxOutputTokens: 800, maxRequestBytes: 8192, timeoutMs: 60000, maxCalls: 1 });
export const deepseekProtocolHash = (preflight = false) => loopHash({ instructions: LOOP_INSTRUCTIONS, schemas: LOOP_SCHEMAS,
  eventReview:LOOP_EVENT_REVIEW_PROTOCOL, config: preflight ? DEEPSEEK_PREFLIGHT_CONFIG : DEEPSEEK_LOOP_CONFIG });
export function createCmcpDeepSeekConfiguredAdapter(options) {
  const preflight = options.preflight === true;
  return createCmcpResponsesTransport({ ...options, config: preflight ? DEEPSEEK_PREFLIGHT_CONFIG : DEEPSEEK_LOOP_CONFIG,
    expectedProtocolHash: deepseekProtocolHash(preflight), ledgerName: options.ledgerName ?? (preflight ? "deepseek-preflight-model-v1" : "cmcp-local-loop-attempts-v1"),
    purposeLimits: preflight ? { semantic: 1 } : { semantic: 3, answer: 2, proactive: 1 } });
}
/** One balance GET per explicit preflight root. No POST, retry, model lookup or top-up here. */
export async function checkDeepSeekBalance({ apiKey, root, fetchImpl = fetch }) {
  if (typeof apiKey !== "string" || !apiKey.trim() || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw Error("secure_configured_key_required");
  const ledger = createLocalLoopJournal({ root, name: "deepseek-balance-preflight-v1" });
  if ((await ledger.read()).length) throw Error("balance_already_attempted");
  const startedAt = new Date().toISOString(), endpoint = "https://api.deepseek.com/user/balance";
  await ledger.append("started", { method: "GET", endpoint, startedAt, pid: process.pid });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
  let http = null, responseBody = "";
  try {
    const response = await fetchImpl(endpoint, { method: "GET", redirect: "error", signal: controller.signal,
      headers: { Authorization: "Bearer " + apiKey } });
    http = response.status;
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 16384) { await reader.cancel(); throw Error("balance_response_budget"); }
        chunks.push(next.value);
      }
    } finally { responseBody = Buffer.concat(chunks).toString("utf8"); }
    const redacted = responseBody.includes(apiKey);
    if (redacted) responseBody = responseBody.split(apiKey).join("[REDACTED_SECRET]");
    let parsed = null; try { parsed = JSON.parse(responseBody); } catch { /* retain raw malformed reply */ }
    const valid = typeof parsed?.is_available === "boolean" && Array.isArray(parsed.balance_infos);
    const usable = http === 200 && valid && parsed.is_available && parsed.balance_infos.some(item =>
      typeof item.total_balance === "string" && /^\d+(?:\.\d+)?$/.test(item.total_balance) && Number(item.total_balance) > 0);
    const result = { http, usable, authentication: http === 200 ? "accepted" : http === 401 ? "rejected" : "unverified",
      status: usable ? "PASS" : http === 200 && valid ? "BALANCE_UNAVAILABLE" : "FAIL", parsed,
      responseBody, responseSha256: loopHash(responseBody), hashBasis: redacted ? "redacted" : "raw", startedAt, endedAt: new Date().toISOString() };
    await ledger.append("result", result); return result;
  } catch (error) {
    if (responseBody.includes(apiKey)) responseBody = responseBody.split(apiKey).join("[REDACTED_SECRET]");
    const result = { http, usable: false, status: "FAIL", errorType: error.name, responseBody, startedAt, endedAt: new Date().toISOString() };
    await ledger.append("result", result); return result;
  } finally { clearTimeout(timer); apiKey = undefined; }
}
