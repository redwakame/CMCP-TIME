/** A Host receives source data, never an answer or the internal receipt/store mapping. */
export async function getCmcpHostContext({runtime,text,timeContext}) {
  if(typeof runtime?.submit!=='function')throw Error('host_context_runtime_required');
  const internal=await runtime.submit({text,recall:true,contextOnly:true,...(timeContext?{timeContext}:{})});
  const host={question:text,context:internal.modelContext?JSON.parse(internal.modelContext):null,
    retrieval:{status:internal.status,answerSufficiency:'not_assessed'}};
  if(internal.status==='needs_clarification')host.retrieval.clarification=internal.clarification;
  return {host,internal};
}
