// Exact source locations. Anchors are program-issued start-location windows,
// never semantic sentence boundaries, and do not alter original text.
export const CMCP_SOURCE_ANCHOR_POINTS = 96;
export function buildCmcpSourceAnchors(text) {
  if (typeof text !== 'string') throw Error('invalid_source_text');
  const points = [...text], result = [];
  for (let start = 0; start < points.length; start += CMCP_SOURCE_ANCHOR_POINTS) {
    const end = Math.min(points.length, start + CMCP_SOURCE_ANCHOR_POINTS);
    result.push({ref:'a'+(result.length+1),start,end,text:points.slice(start,end).join('')});
  }
  return result;
}
export function locateCmcpSourceFragment(text, fragment) {
  const quote = typeof fragment === 'string' ? fragment : fragment?.text;
  const anchorRef = typeof fragment === 'string' ? '' : fragment?.anchor ?? '';
  if (typeof quote !== 'string' || !quote.length || typeof anchorRef !== 'string') throw Error('invalid_quote');
  if (typeof fragment === 'object' && !['text','anchor,text','text,withinQuote'].includes(Object.keys(fragment).sort().join(','))) throw Error('invalid_quote_fragment');
  if (typeof fragment==='object' && Object.hasOwn(fragment,'anchor') && typeof fragment.anchor!=='string') throw Error('invalid_quote_fragment');
  if (typeof fragment==='object' && Object.hasOwn(fragment,'withinQuote')) {
    // Explicit exact context is used only to locate this fragment. It is NOT
    // additional selected support and never fills omitted conditions or facts.
    if(typeof fragment.withinQuote!=='string'||!fragment.withinQuote.length)throw Error('invalid_quote_context');
    const context=locateCmcpSourceFragment(text,fragment.withinQuote),points=[...text],query=[...quote],matches=[];
    for(let start=context.start;start<=context.end-query.length;start++) {
      if(query.every((point,index)=>point===points[start+index]))matches.push(start);
      if(matches.length>1)break;
    }
    if(matches.length!==1)throw Error(matches.length?'ambiguous_quote':'quote_not_found');
    return {unit:'unicode_code_points',start:matches[0],end:matches[0]+query.length,text:quote};
  }
  const anchor = anchorRef ? buildCmcpSourceAnchors(text).find(item=>item.ref===anchorRef) : null;
  if (anchorRef && !anchor) throw Error('source_anchor_out_of_scope');
  const points=[...text], query=[...quote], matches=[];
  for(let start=anchor?.start??0;start<Math.min(anchor?.end??points.length,points.length-query.length+1);start++) {
    if(query.every((point,index)=>point===points[start+index])) matches.push(start);
    if(matches.length>1) break;
  }
  if(matches.length!==1) throw Error(matches.length?'ambiguous_quote':'quote_not_found');
  return {unit:'unicode_code_points',start:matches[0],end:matches[0]+query.length,text:quote};
}
export function locateCmcpSourceSupport(text, quote) {
  if (typeof quote === 'string') return locateCmcpSourceFragment(text,quote);
  if (!quote || Object.keys(quote).join(',')!=='parts' || !Array.isArray(quote.parts)
    || !quote.parts.length || quote.parts.length>16) throw Error('invalid_quote_parts');
  // supportRefs is a support set, not instructions to concatenate text. Sort the
  // program-computed locations only; leave the raw proposal and reference order.
  const fragments=quote.parts.map(part=>locateCmcpSourceFragment(text,part)).sort((a,b)=>a.start-b.start||a.end-b.end);
  for(let i=1;i<fragments.length;i++)if(fragments[i].start<fragments[i-1].end)throw Error('quote_fragments_overlap');
  if(fragments.length===1)return fragments[0];
  const start=fragments[0].start,end=fragments.at(-1).end;
  // This is the actual contiguous original window, NOT concatenated excerpts.
  // Only fragments are asserted as selected support; gap text stays visible.
  return {unit:'unicode_code_points',start,end,text:[...text].slice(start,end).join(''),fragments};
}
export function cmcpCitationFragments(citation) {return citation.fragments??[citation];}
