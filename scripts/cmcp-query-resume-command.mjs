/** Preserve legacy IDs; an explicit delimiter supplies an ephemeral question in memory. */
export function parseCmcpQueryResumeCommand(text){
  if(typeof text!=='string')throw Error('history_query_request_id_required');
  const marker=' --query-text ',at=text.indexOf(marker);
  if(at===-1){if(!text.trim())throw Error('history_query_request_id_required');return {requestId:text};}
  const requestId=text.slice(0,at).trim(),queryText=text.slice(at+marker.length);
  if(!requestId||!queryText.trim())throw Error('history_query_id_and_exact_query_text_required');
  return {requestId,queryText};
}
