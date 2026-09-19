import { getCmcpRuntimePolicy } from "./get-cmcp-runtime-policy.js";

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSeparatedKeywordPattern(keyword) {
  const separated = keyword
    .split("")
    .map((char) => escapeRegex(char))
    .join("[\\s._-]*");

  return new RegExp(`\\b(?:my\\s+)?${separated}\\b\\s+(?:is|was)\\s+\\S{4,}`, "gi");
}

function normalizeTextForForbiddenDetection(text) {
  return typeof text?.normalize === "function" ? text.normalize("NFKC") : text;
}

const PATTERNS = [
  { category: "api_key", regex: /\b(?:sk|rk|pk)[-_][A-Za-z0-9_-]{12,}\b/g },
  { category: "api_key", regex: /(?:^|[^A-Za-z0-9])(?:sk|rk|pk)[-_][A-Za-z0-9_-]{12,}\b/g },
  { category: "api_key", regex: /\b(?:api[-_ ]?key|access[-_ ]?token|bearer(?:\s+token)?)\b\s*[:=]\s*[A-Za-z0-9._-]{12,}/gi },
  { category: "api_key", regex: /\b(?:my\s+)?(?:api[-_ ]?key|access[-_ ]?token|bearer(?:\s+token)?)\b\s+(?:is|was)\s+[A-Za-z0-9._-]{8,}/gi },
  { category: "password", regex: /\b(?:password|passcode|pwd)\b\s*[:=]\s*\S{4,}/gi },
  { category: "password", regex: /\b(?:my\s+)?(?:password|passcode|pwd)\b\s+(?:is|was)\s+\S{4,}/gi },
  { category: "password", regex: buildSeparatedKeywordPattern("password") },
  { category: "password", regex: buildSeparatedKeywordPattern("passcode") },
  { category: "otp", regex: /\b(?:otp|one[- ]?time(?:\s+pass(?:word|code)?)?|verification code)\b/i },
  { category: "session_cookie", regex: /\b(?:session(?:id)?|cookie)\s*[:=]\s*[A-Za-z0-9._-]{12,}/gi },
  { category: "private_key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { category: "payment_credentials", regex: /\b(?:card number|cvv|security code)\b/i },
  { category: "government_id", regex: /\b(?:passport|driver'?s license|national id|social security)\b/i }
];

export function detectCmcpForbiddenText(text) {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  const normalizedText = normalizeTextForForbiddenDetection(text);
  const matches = [];
  for (const pattern of PATTERNS) {
    const found = normalizedText.match(pattern.regex);
    if (found && found.length > 0) {
      matches.push({
        category: pattern.category,
        count: found.length
      });
    }
  }
  return matches;
}

export function isCmcpForbiddenCategory(category) {
  const policy = getCmcpRuntimePolicy();
  const forbidden = policy.forbiddenCategories;
  return forbidden.alwaysForbidden.includes(category) || forbidden.inferenceForbidden.includes(category);
}
