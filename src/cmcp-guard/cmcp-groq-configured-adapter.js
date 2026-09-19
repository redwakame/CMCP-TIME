import { loopHash } from "./cmcp-local-loop-journal.js";
import { LOOP_INSTRUCTIONS, LOOP_SCHEMAS, LOOP_EVENT_REVIEW_PROTOCOL } from "./cmcp-local-loop-protocol.js";

export const GROQ_LOOP_CONFIG = Object.freeze({ endpoint: "https://api.groq.com/openai/v1/responses",
  model: "openai/gpt-oss-120b", reasoning: "low", maxOutputTokens: 1200, maxRequestBytes: 16384,
  providerId: "groq-responses", strictFormat: true, maxResponseBytes: 131072, timeoutMs: 90000, maxCalls: 6 });
export const loopProtocolHash = () => loopHash({ instructions: LOOP_INSTRUCTIONS, schemas: LOOP_SCHEMAS, eventReview:LOOP_EVENT_REVIEW_PROTOCOL, config: GROQ_LOOP_CONFIG });
import { createCmcpResponsesTransport } from "./cmcp-responses-transport.js";
export function createCmcpGroqConfiguredAdapter(options) {
 return createCmcpResponsesTransport({ ...options, config: GROQ_LOOP_CONFIG, expectedProtocolHash: loopProtocolHash(),
 ledgerName: options.ledgerName ?? "groq-loop-attempts-v1", purposeLimits: { semantic: 3, answer: 2, proactive: 1 } });
}
