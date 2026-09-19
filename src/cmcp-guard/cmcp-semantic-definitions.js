/** Shared domain-neutral meanings. These classify observations, never supply missing facts. */
export const CMCP_SEMANTIC_DEFINITIONS = Object.freeze({
  user_report: "The user states something that has happened or an actual state; a report is not merely an intention.",
  user_intent: "The user plans, hopes, wants or commits to an action; this does not establish that it happened.",
  user_question: "The user asks a question or expresses an information need.",
  assistant_suggestion: "Advice or a suggestion from the assistant, not a user-confirmed fact.",
  assistant_statement: "An assistant statement or inference, not a user-confirmed fact.",
  tool_observation: "An observation attributed to the tool, not a user statement.",
  current: "A currently known state. Knowing its exact occurrence date is not required.",
  historical: "A recollection of the past; it does not directly replace the current state.",
  unspecified: "The temporal use cannot be established. Do not invent an occurrence time."
});
export const cmcpSemanticDefinitionText = () => Object.entries(CMCP_SEMANTIC_DEFINITIONS)
  .map(([name, meaning]) => name + ": " + meaning).join("\n");
