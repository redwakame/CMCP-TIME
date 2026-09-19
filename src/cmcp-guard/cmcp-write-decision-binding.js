import { isDeepStrictEqual } from "node:util";

// Process-local evaluation evidence, not a serialized authorization token.
const bindings = new WeakMap();

export function bindCmcpWriteDecision(decision, input) {
  bindings.set(decision, {
    decision: structuredClone(decision),
    input: structuredClone(input)
  });
  return decision;
}

export function matchesCmcpWriteDecision(decision, input) {
  const binding = bindings.get(decision);
  return Boolean(binding)
    && isDeepStrictEqual(binding.decision, decision)
    && isDeepStrictEqual(binding.input, input);
}
