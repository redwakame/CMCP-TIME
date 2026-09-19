// Wire representation only. Canonical dialogue and exact source validation remain unchanged.
export const CMCP_DIALOGUE_SYNOPSIS_MAX_CODE_POINTS = 512;
export const CMCP_DIALOGUE_SYNOPSIS_MODEL_MAX_CODE_POINTS = 384;
export const CMCP_DIALOGUE_SYNOPSIS_GUIDANCE = `synopsis is one bounded replacement of the current supported discussion focus, not an append-only conversation summary. Replace it rather than concatenating prior synopsis or accumulating each turn. Keep necessary uncertainty, conditions and unfinished purpose within ${CMCP_DIALOGUE_SYNOPSIS_MAX_CODE_POINTS} Unicode code points; exact supporting sources remain separate. Never shorten by changing a qualification into a fact.`;
/** Projection only: never truncates, rewrites, or changes stored dialogue status/support. */
export function projectCmcpDialogueSynopsis(synopsis) {
  if(typeof synopsis!=='string')throw Error('invalid_dialogue_synopsis_projection');
  const codePoints=[...synopsis].length;
  return codePoints<=CMCP_DIALOGUE_SYNOPSIS_MODEL_MAX_CODE_POINTS?{synopsis}:{synopsisCoverage:{status:'omitted',reason:'model_projection_limit',
    codePoints,maxCodePoints:CMCP_DIALOGUE_SYNOPSIS_MODEL_MAX_CODE_POINTS}};
}
/** Catalog annotations are saved intact; only their model-facing dialogue text uses the same projection. */
export function projectCmcpDialogueCatalogContext(context) {
  const result=structuredClone(context);
  if(result?.kind==='derived_context'&&Array.isArray(result.items))result.items=result.items.map(item=>{
    if(item.kind!=='derived_dialogue')return item;
    const {text,...rest}=item,projected=projectCmcpDialogueSynopsis(text);
    return {...rest,...(Object.hasOwn(projected,'synopsis')?{text:projected.synopsis}:{synopsisCoverage:projected.synopsisCoverage})};
  });
  return result;
}
const obj = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: "string", minLength: 1 };
const support = refs => obj({ ref: { type: "string", enum: refs }, quote: str });
export function buildDialogueSourceBinding(input) {
  if (input?.source?.ref !== "input" || input.source.sourceAuthorRole !== "user"
    || typeof input.source.text !== "string" || !Array.isArray(input.priorDialogue?.supports)) throw Error("explicit_dialogue_sources_required");
  const refs = ["input"];
  for (const item of input.priorDialogue.supports) {
    if (!/^d[1-9][0-9]*$/.test(item.ref) || refs.includes(item.ref)
      || item.sourceAuthorRole !== "user" || typeof item.quote !== "string") throw Error("invalid_prior_dialogue_source");
    refs.push(item.ref);
  }
  const synopsis = { type: "string", maxLength: CMCP_DIALOGUE_SYNOPSIS_MAX_CODE_POINTS };
  return {
    catalog: { version: 1, current: { ref: "input", location: "source.text", sourceAuthorRole: "user" },
      additionalRefs: refs, priorLocation: "priorDialogue.supports[].quote",
      excluded: "eventContext.sourceRefs aliases are not dialogue source references" },
    schema: { anyOf: [
      obj({ status: { type: "string", enum: ["open", "closed"] }, synopsis,
        currentSupport: support(["input"]), additionalSupports: { type: "array", maxItems: 3, items: support(refs) } }),
      obj({ status: { type: "string", enum: ["unknown"] }, synopsis,
        supports: { type: "array", maxItems: 4, items: support(refs) } })
    ] }
  };
}
/** Called only after validating the complete wire schema. No inferred ref, quote or status. */
export function mapDialogueWire(value) {
  const result = structuredClone(value);
  if (result.dialogue.status !== "unknown") {
    const { status, synopsis, currentSupport, additionalSupports } = result.dialogue;
    result.dialogue = { status, synopsis, supports: [currentSupport, ...additionalSupports] };
  }
  return result;
}
