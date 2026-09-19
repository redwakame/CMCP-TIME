import path from 'node:path';
import {createLocalLoopJournal,loopHash} from './cmcp-local-loop-journal.js';
import {createCmcpSourceIndexSegments} from './cmcp-source-index-segments.js';
import {createCmcpSourcePointer,cmcpSourcePointerKey,validateCmcpSourceIdentity} from './cmcp-source-pointer.js';
import {describeCmcpHistoryProvider,resolveCmcpHistorySource} from './cmcp-history-provider.js';

const positive=value=>Number.isSafeInteger(value)&&value>0;
const jsonBytes=value=>Buffer.byteLength(JSON.stringify(value));
const hashTerm=text=>loopHash(text.normalize('NFKC').toLowerCase());
const cjk=point=>/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(point);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const copy=value=>structuredClone(value);
const DEFAULT_INDEX_SOURCE_BYTES=1024*1024;
const DEFAULT_INDEX_TOKENS=131072;

/** Lexical locator only. NFKC/case folding applies to lookup terms, never source text/identity.
 * Intl word segmentation is optional. Unicode word runs + overlapping CJK bigrams are
 * the Node 18 fallback; neither is semantic relevance or a universal language tokenizer.
 * Persisted terms are hashes with original Unicode code-point positions, not a second body.
 */
function tokenize(text,maxTokens){
  const points=[...text],utf16ToPoint=new Map();let offset=0;
  points.forEach((point,index)=>{utf16ToPoint.set(offset,index);offset+=point.length;});utf16ToPoint.set(offset,points.length);
  const occurrences=new Map();let count=0;
  function add(term,start,end,weight){
    if(!term.trim())return;
    const key=hashTerm(term),values=occurrences.get(key)??{weight,positions:[],seen:new Set()},positionKey=start+':'+end;
    if(!values.seen.has(positionKey)){
      if(++count>maxTokens)throw Error('local_index_token_limit');values.positions.push([start,end]);
      values.seen.add(positionKey);
    }
    values.weight=Math.max(values.weight,weight);occurrences.set(key,values);
  }
  let segmentation='unicode_word_runs_and_cjk_bigrams';
  if(typeof Intl.Segmenter==='function'){
    segmentation='intl_word_and_cjk_bigrams';
    for(const part of new Intl.Segmenter('und',{granularity:'word'}).segment(text)){
      if(part.isWordLike)add(part.segment,utf16ToPoint.get(part.index),utf16ToPoint.get(part.index+part.segment.length),2);
    }
  }else{
    for(const part of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu))add(part[0],utf16ToPoint.get(part.index),utf16ToPoint.get(part.index+part[0].length),2);
  }
  for(let index=0;index<points.length;index++)if(cjk(points[index])){
    add(points[index],index,index+1,0.25);
    if(index+1<points.length&&cjk(points[index+1]))add(points[index]+points[index+1],index,index+2,2);
  }
  return {terms:[...occurrences].sort(([a],[b])=>a.localeCompare(b)).map(([hash,value])=>({hash,weight:value.weight,positions:value.positions})),count,segmentation,codePoints:points.length};
}

function normalizeLimits(input){
  const required=['maxStoredSources','maxCandidates','maxCandidateBytes','maxExcerptCodePoints','maxQueryBytes'];
  if(!input||required.some(key=>!positive(input[key])))throw Error('explicit_local_candidate_limits_required');
  const limits={...Object.fromEntries(required.map(key=>[key,input[key]])),
    maxIndexSourceBytes:input.maxIndexSourceBytes??DEFAULT_INDEX_SOURCE_BYTES,maxIndexTokens:input.maxIndexTokens??DEFAULT_INDEX_TOKENS};
  if(!positive(limits.maxIndexSourceBytes)||!positive(limits.maxIndexTokens)||limits.maxCandidates>limits.maxStoredSources)throw Error('invalid_local_candidate_limits');
  return Object.freeze(limits);
}

/** Exact bounded window search over lexical locations, not semantic completion.
 * Each distinct query term contributes once per window. Repeating background terms
 * cannot swamp a rarer combination, and no frequency-based anchor cutoff hides the tail.
 * End-sorted additions and start-sorted removals keep work O(N log N), O(N) memory.
 */
function locatorWindow(locations,codePoints,width){
  const maxStart=Math.max(0,codePoints-width),margin=Math.floor(width/4);
  const starts=[...new Set(locations.map(location=>Math.max(0,Math.min(maxStart,location.start-margin))))].sort((a,b)=>a-b);
  const indexed=locations.map((location,index)=>({...location,index}));
  const byEnd=[...indexed].sort((a,b)=>a.end-b.end||a.start-b.start),byStart=[...indexed].sort((a,b)=>a.start-b.start||a.end-b.end);
  const active=new Uint8Array(locations.length),counts=new Map();let addAt=0,removeAt=0,score=0,best=null;
  for(const start of starts){
    const end=Math.min(codePoints,start+width);
    while(addAt<byEnd.length&&byEnd[addAt].end<=end){
      const location=byEnd[addAt++];if(location.start<start)continue;
      const count=counts.get(location.hash)??0;if(count===0)score+=location.weight;
      counts.set(location.hash,count+1);active[location.index]=1;
    }
    while(removeAt<byStart.length&&byStart[removeAt].start<start){
      const location=byStart[removeAt++];if(!active[location.index])continue;active[location.index]=0;
      const count=counts.get(location.hash);if(count===1){counts.delete(location.hash);score-=location.weight;}else counts.set(location.hash,count-1);
    }
    // Equal term coverage favors the later window, retaining following context instead
    // of spending the whole allowance on repeated lead-in. This is still a locator,
    // not a guarantee that all qualifications or answers fit the caller's size limit.
    if(!best||score>=best.score-1e-9)best={start,end,score};
  }
  return best;
}

/** Re-window an already bounded locator under a JSON UTF-8 byte allowance.
 * Uses the same lexical terms/window machinery as search, not semantic selection.
 * Returned text is a literal Unicode code-point slice, never assembled evidence.
 */
export function boundCmcpLocalLocator({text,query,maxBytes}){
  if(typeof text!=='string'||typeof query!=='string'||!positive(maxBytes)||maxBytes<2)throw Error('invalid_local_locator_budget');
  const points=[...text];if(jsonBytes(text)<=maxBytes)return {text,start:0,end:points.length,shortened:false};
  const queryTerms=new Map(tokenize(query,DEFAULT_INDEX_TOKENS).terms.map(term=>[term.hash,term])),locations=[];
  for(const term of tokenize(text,DEFAULT_INDEX_TOKENS).terms){const match=queryTerms.get(term.hash);if(!match)continue;
    for(const [start,end] of term.positions)locations.push({start,end,weight:Math.min(match.weight,term.weight),hash:term.hash});}
  let width=Math.min(points.length,maxBytes-2);
  while(width>0){const range=locations.length?locatorWindow(locations,points.length,width):{start:0,end:width};
    const excerpt=points.slice(range.start,range.end).join(''),size=jsonBytes(excerpt);
    if(size<=maxBytes)return {text:excerpt,start:range.start,end:range.end,shortened:true};
    width=Math.min(width-1,Math.max(0,Math.floor(width*(maxBytes-2)/(size-2))));
  }
  return {text:'',start:0,end:0,shortened:true};
}

/** Pure in-memory locator ranking over already authorized derived text. This
 * shares the local index tokenizer; scores are never semantic truth or scope. */
export function rankCmcpLocalTexts({query,documents,maxQueryBytes=4096,maxTextBytes=65536}){
  if(typeof query!=='string'||!positive(maxQueryBytes)||Buffer.byteLength(query)>maxQueryBytes
    ||!positive(maxTextBytes)||!Array.isArray(documents)||documents.some(doc=>typeof doc?.id!=='string'
      ||!doc.id||typeof doc.text!=='string'||Buffer.byteLength(doc.text)>maxTextBytes)
    ||new Set(documents.map(doc=>doc.id)).size!==documents.length)throw Error('invalid_local_text_locator_input');
  const queryTerms=new Map(tokenize(query,DEFAULT_INDEX_TOKENS).terms.map(term=>[term.hash,term]));
  const rows=documents.map((doc,index)=>({id:doc.id,index,terms:tokenize(doc.text,DEFAULT_INDEX_TOKENS).terms}));
  const frequency=new Map();for(const row of rows)for(const term of row.terms)if(queryTerms.has(term.hash))frequency.set(term.hash,(frequency.get(term.hash)??0)+1);
  const ranked=[];for(const row of rows){let score=0,matchedTerms=0;for(const term of row.terms){const q=queryTerms.get(term.hash);if(!q)continue;
    matchedTerms++;score+=Math.min(q.weight,term.weight)*Math.log(1+(rows.length+0.5)/((frequency.get(term.hash)??0)+0.5));}
    if(matchedTerms)ranked.push({id:row.id,score,matchedTerms,index:row.index});}
  ranked.sort((a,b)=>b.score-a.score||a.index-b.index);
  return {ranked:ranked.map(({index,...row})=>row),semanticRelevance:'unverified',sourceBodiesRead:0};
}

/** Nominate bounded literal-anchor coverage before filling from lexical scores.
 * This is not a semantic ID classifier. Only explicit quoting, code-like word
 * shape, or a title-cased word inside mixed-script text creates this channel.
 * Ordinary unquoted words and CJK fragments retain the original lexical path.
 * No token list, role, recency, event truth or domain name influences admission.
 */
function interleaveSourceUses(hits,sourceUses){
  if(!sourceUses)return hits;
  const uses=new Map();for(const hit of hits){const use=sourceUses[hit.entry.id]??'unclassified';if(!uses.has(use))uses.set(use,[]);uses.get(use).push(hit);}
  const groups=[...uses.values()],interleaved=[];
  for(let at=0;interleaved.length<hits.length;at++)for(const group of groups)if(group[at])interleaved.push(group[at]);
  return interleaved;
}
function literalCandidateCoverage({text,query,hits,documents,frequency,maxCandidates,sourceUses}){
  const points=[...text],hasCjk=points.some(cjk),quotes=new Map([['"','"'],["'","'"],['「','」'],['『','』'],['“','”'],['‘','’']]);
  const anchors=[];
  for(const term of query.terms){
    if(term.weight<2)continue;
    let shape=null,literal=null;
    for(const [start,end] of term.positions){
      const value=points.slice(start,end).join(''),chars=[...value];if(chars.length<2)continue;
      const quoted=quotes.get(points[start-1])===points[end]&&quotes.has(points[start-1]);
      const whole=!/[\p{L}\p{N}\p{M}]/u.test(points[start-1]??'')&&!/[\p{L}\p{N}\p{M}]/u.test(points[end]??'');
      const nonCjk=chars.every(point=>!cjk(point));
      const codeShape=whole&&nonCjk&&/\p{L}/u.test(value)&&(/\p{N}/u.test(value)||/^[\p{Lu}\p{N}]{2,}$/u.test(value)||/[\p{Ll}]\p{Lu}/u.test(value));
      // Script boundaries are reliable word boundaries even without whitespace.
      const mixedTitle=hasCjk&&nonCjk&&chars.length>=3&&/^\p{Lu}\p{Ll}+$/u.test(value)
        &&(start===0||!/[\p{Script=Latin}\p{N}]/u.test(points[start-1]))&&(end===points.length||!/[\p{Script=Latin}\p{N}]/u.test(points[end]));
      if(quoted||codeShape||mixedTitle){shape=quoted?'quoted_literal':codeShape?'code_shaped_word':'mixed_script_named_word';literal=value;break;}
    }
    if(!shape)continue;
    const count=frequency.get(term.hash)??0;
    anchors.push({hash:term.hash,literal,shape,queryStart:term.positions[0][0],matchedSources:count,eligible:count>0&&count*2<=documents.length,
      reason:count===0?'literal_not_in_authorized_index':count*2>documents.length?'not_selective_in_authorized_index':null});
  }
  anchors.sort((a,b)=>a.queryStart-b.queryStart);
  const channels=anchors.filter(anchor=>anchor.eligible).map(anchor=>{
    const matching=hits.filter(hit=>hit.entry.terms.some(term=>term.hash===anchor.hash));
    // Proven Runtime lookup requests are sources too. Keep their best locators
    // alongside other records, rather than allowing repeated retrieval questions
    // to consume every slot. Channel order follows existing lexical rank, never
    // author role or time. Without explicit provenance the old order is intact.
    return {...anchor,hits:interleaveSourceUses(matching,sourceUses),at:0};
  });
  const selected=[],seen=new Set();let advanced=true;
  while(selected.length<maxCandidates&&advanced){advanced=false;
    for(const channel of channels){while(channel.at<channel.hits.length&&seen.has(channel.hits[channel.at].entry.id))channel.at++;
      const hit=channel.hits[channel.at++];if(!hit)continue;advanced=true;selected.push(hit);seen.add(hit.entry.id);if(selected.length>=maxCandidates)break;}}
  const nominated=new Set(selected.map(hit=>hit.entry.id));
  for(const hit of interleaveSourceUses(hits,sourceUses)){if(selected.length>=maxCandidates)break;if(!seen.has(hit.entry.id)){selected.push(hit);seen.add(hit.entry.id);}}
  return {selected,diagnostics:{kind:'bounded_literal_candidate_coverage',semanticIdentity:'unverified',candidateLimit:maxCandidates,
    anchors:anchors.map(anchor=>({...anchor,nominatedSourceIds:selected.filter(hit=>hit.entry.terms.some(term=>term.hash===anchor.hash)).map(hit=>hit.entry.id)})),
    allocation:selected.map(hit=>({id:hit.entry.id,channel:nominated.has(hit.entry.id)?'literal_coverage':sourceUses?'source_use_coverage':'lexical_fill',sourceUse:sourceUses?.[hit.entry.id]??'unclassified'})),
    historyAbsence:'not_established'}};
}

export function createCmcpLocalCandidates({root,scopeId,history,catalog,limits:inputLimits,maxSegments=1}){
  if(!path.isAbsolute(root)||typeof catalog?.list!=='function')throw Error('explicit_local_candidate_dependencies_required');
  validateCmcpSourceIdentity(scopeId,'scopeId');describeCmcpHistoryProvider(history);
  const limits=normalizeLimits(inputLimits),journal=createCmcpSourceIndexSegments({root,name:'cmcp-local-lexical-index-v1',maxEntries:limits.maxStoredSources,maxSegments});
  function pointerFor(input){const pointer=createCmcpSourcePointer(input?.pointer??input);if(pointer.scopeId!==scopeId)throw Error('local_candidate_scope_mismatch');return pointer;}
  async function indexed(){
    const result=new Map();
    for(const row of await journal.read()){
      const entry=row.record.value;
      if(row.record.kind!=='indexed_source'||entry?.version!==1||entry.scopeId!==scopeId||!digest(entry.id)||!digest(entry.evidenceHash)
        ||entry.id!==loopHash(cmcpSourcePointerKey(pointerFor(entry.pointer)))||!Array.isArray(entry.terms)
        ||!Number.isSafeInteger(entry.codePoints)||entry.codePoints<0||!Number.isSafeInteger(entry.sourceBytes)||entry.sourceBytes<0
        ||entry.terms.some(term=>!digest(term.hash)||!Number.isFinite(term.weight)||!Array.isArray(term.positions)
          ||term.positions.some(range=>!Array.isArray(range)||range.length!==2||!Number.isSafeInteger(range[0])||!Number.isSafeInteger(range[1])
            ||range[0]<0||range[1]<=range[0]||range[1]>entry.codePoints)))throw Error('local_candidate_index_invalid');
      result.set(entry.id,entry);
    }
    return result;
  }
  async function authorized(ids,sourceCatalog=catalog){
    const entries=await sourceCatalog.list();
    if(!Array.isArray(entries)||entries.some(entry=>entry.pointer?.scopeId!==scopeId))throw Error('local_catalog_scope_or_capacity');
    if(new Set(entries.map(entry=>entry.id)).size!==entries.length)throw Error('local_catalog_duplicate_identity');
    const byId=new Map(entries.map(entry=>[entry.id,entry]));
    if(ids!==undefined){
      if(!Array.isArray(ids)||ids.length>Math.max(limits.maxStoredSources*maxSegments,entries.length)||new Set(ids).size!==ids.length||ids.some(id=>!byId.has(id)))throw Error('local_candidate_authorized_source_missing');
      return new Map(ids.map(id=>[id,byId.get(id)]));
    }
    return byId;
  }
  async function indexSource(input,batch=null){
    if(batch&&(!batch.active||!await batch.valid()))throw Error('local_index_batch_cancelled');
    const pointer=pointerFor(input),id=loopHash(cmcpSourcePointerKey(pointer));
    // The caller may have formally registered a new source earlier in this same
    // reconciliation. Refresh only that metadata snapshot; existing source/hash
    // checks below still resolve the exact original on every call.
    if(batch&&!batch.entries.has(id))batch.entries=await authorized(undefined,batch.catalog);
    const entries=batch?.entries??await authorized(),existing=batch?.existing??await indexed();
    if(!entries.has(id)||cmcpSourcePointerKey(entries.get(id).pointer)!==cmcpSourcePointerKey(pointer))throw Error('local_candidate_source_not_registered');
    const resolved=await resolveCmcpHistorySource({provider:history,pointer});
    if(resolved.status!=='found')return {status:'pending',id,reason:'source_'+resolved.status};
    const evidence=resolved.evidence,evidenceHash=loopHash(evidence),sourceBytes=Buffer.byteLength(evidence.content.body);
    if(batch&&(!batch.active||!await batch.valid()))throw Error('local_index_batch_cancelled');
    if(entries.get(id).evidenceHash!==evidenceHash)return {status:'pending',id,reason:'catalog_evidence_changed'};
    if(sourceBytes>limits.maxIndexSourceBytes)return {status:'pending',id,reason:'local_index_source_byte_limit',sourceBytes};
    if(existing.has(id)){
      if(existing.get(id).evidenceHash!==evidenceHash)return {status:'pending',id,reason:'indexed_evidence_changed'};
      return {status:'unchanged',id,sourceBytes};
    }
    let lexical;try{lexical=tokenize(evidence.content.body,limits.maxIndexTokens);}catch(error){if(error.message==='local_index_token_limit')return {status:'pending',id,reason:error.message,sourceBytes};throw error;}
    const value={version:1,scopeId,id,pointer,evidenceHash,sourceBytes,...lexical};
    await journal.append('indexed_source',value);existing.set(id,value);
    return {status:'indexed',id,sourceBytes,indexBytes:jsonBytes(value),terms:lexical.terms.length};
  }
  async function search({text,enabled,clean,allowedSourceIds,representation,sourceUses}={}){
    // Controls precede even derived index/catalog reads and query validation.
    if(enabled===false||clean===true)return {status:'disabled',candidates:[],sourceMap:[],diagnostics:{historyResolves:0,modelCalls:0}};
    if(enabled!==true||clean!==false)throw Error('explicit_local_candidate_controls_required');
    if(representation!==undefined&&representation!=='registered_event_groups')throw Error('invalid_local_candidate_representation');
    if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>limits.maxQueryBytes)throw Error('invalid_local_candidate_query');
    const [entries,index]=await Promise.all([authorized(allowedSourceIds),indexed()]);
    if(sourceUses!==undefined&&(!sourceUses||typeof sourceUses!=='object'||Array.isArray(sourceUses)
      ||Object.entries(sourceUses).some(([id,use])=>!entries.has(id)||!['history_lookup_request','source_record'].includes(use))))throw Error('invalid_local_candidate_source_use');
    const query=tokenize(text,limits.maxIndexTokens),queryTerms=new Map(query.terms.map(term=>[term.hash,term]));
    const documents=[...index.values()].filter(entry=>entries.has(entry.id));
    const frequency=new Map();for(const entry of documents)for(const term of entry.terms)if(queryTerms.has(term.hash))frequency.set(term.hash,(frequency.get(term.hash)??0)+1);
    const hits=[];
    for(const entry of documents){
      let score=0;const locations=[];
      for(const term of entry.terms){
        const q=queryTerms.get(term.hash);if(!q)continue;
        const weight=Math.min(q.weight,term.weight)*(1+Math.log((documents.length+1)/((frequency.get(term.hash)??0)+1)));
        score+=weight;for(const [start,end] of term.positions)locations.push({start,end,weight,hash:term.hash});
      }
      if(score>0)hits.push({entry,score,locations});
    }
    // A lexical score orders bounded suggestions, never authorizes a source or chooses a winner.
    hits.sort((a,b)=>b.score-a.score);
    const literalCoverage=literalCandidateCoverage({text,query,hits,documents,frequency,maxCandidates:limits.maxCandidates,sourceUses});
    let selectedHits=literalCoverage.selected,groups=null;
    if(representation==='registered_event_groups'){
      const grouped=new Map();
      for(const hit of hits){
        const metadata=entries.get(hit.entry.id),event=metadata.eventScope??metadata.eventLink?.event??null;
        if(event&&(event.scopeId!==scopeId||typeof event.eventId!=='string'||!event.eventId))throw Error('local_candidate_event_scope_mismatch');
        const key=event?JSON.stringify([event.scopeId,event.eventId]):'unassociated';
        if(!grouped.has(key))grouped.set(key,{groupRef:'g'+(grouped.size+1),associated:event!==null,hits:[]});
        grouped.get(key).hits.push(hit);
      }
      groups=[...grouped.values()];
      // The existing lexical order selects each registered group's representative.
      // Role, event name and recency do not influence this optional allocation.
      selectedHits=groups.slice(0,limits.maxCandidates).map(group=>group.hits[0]);
      const chosen=new Set(selectedHits.map(hit=>hit.entry.id));
      for(const hit of hits){if(selectedHits.length>=limits.maxCandidates)break;if(!chosen.has(hit.entry.id)){selectedHits.push(hit);chosen.add(hit.entry.id);}}
    }
    const candidates=[],sourceMap=[],unavailable=[],omitted=[];let sourceBytes=0,historyResolves=0;
    for(const hit of selectedHits){
      const entry=hit.entry,meta=entries.get(entry.id);historyResolves++;
      const resolved=await resolveCmcpHistorySource({provider:history,pointer:entry.pointer});
      if(resolved.status!=='found'){unavailable.push({id:entry.id,status:resolved.status});continue;}
      const evidence=resolved.evidence,materializedBytes=Buffer.byteLength(evidence.content.body);sourceBytes+=materializedBytes;
      if(loopHash(evidence)!==entry.evidenceHash||meta.evidenceHash!==entry.evidenceHash){unavailable.push({id:entry.id,status:'changed'});continue;}
      if(materializedBytes>limits.maxIndexSourceBytes){omitted.push({id:entry.id,reason:'local_index_source_byte_limit'});continue;}
      const points=[...evidence.content.body],range=locatorWindow(hit.locations,points.length,limits.maxExcerptCodePoints);
      const ref='c'+(candidates.length+1),excerpt={kind:evidence.content.kind,text:points.slice(range.start,range.end).join(''),
        purpose:'locator_excerpt_requires_explicit_read',location:{unit:'unicode_code_points',start:range.start,end:range.end},complete:range.start===0&&range.end===points.length};
      const candidate={ref,sourceAuthorRole:evidence.sourceAuthorRole,sourceKind:evidence.sourceKind,
        messageRecordedAt:evidence.messageRecordedAt,eventOccurredAt:evidence.eventOccurredAt,availability:evidence.metadata?.availability??'unknown',
        eventAssociated:!!(meta.eventScope||meta.eventLink||meta.eventLinks?.length),...(sourceUses?.[entry.id]?{sourceUse:sourceUses[entry.id]}:{}),excerpt};
      if(jsonBytes([...candidates,candidate])>limits.maxCandidateBytes){omitted.push({id:entry.id,reason:'local_candidate_projection_byte_limit'});continue;}
      candidates.push(candidate);sourceMap.push({ref,id:entry.id,pointer:copy(entry.pointer),evidenceHash:entry.evidenceHash,range:copy(excerpt.location)});
    }
    let groupRepresentation;
    if(groups){
      const chosen=new Set(selectedHits.map(hit=>hit.entry.id)),returned=new Set(sourceMap.map(source=>source.id));
      const rows=groups.map(group=>{
        const chosenIds=group.hits.filter(hit=>chosen.has(hit.entry.id)).map(hit=>hit.entry.id),returnedIds=group.hits.filter(hit=>returned.has(hit.entry.id)).map(hit=>hit.entry.id);
        return {groupRef:group.groupRef,associated:group.associated,matchedSources:group.hits.length,representativeId:group.hits[0].entry.id,
          chosenIds,returnedIds,status:returnedIds.length?'represented':'not_represented',reason:returnedIds.length?null:
            chosenIds.length?'selected_sources_unavailable_or_over_budget':'candidate_count_limit'};
      });
      groupRepresentation={mode:representation,coverage:'authorized_lexical_hits_only_not_complete_history',groupCount:rows.length,
        representedGroupCount:rows.filter(group=>group.status==='represented').length,skippedSourceCount:hits.length-selectedHits.length,groups:rows};
    }
    const returnedIds=new Set(sourceMap.map(row=>row.id));
    const literalDiagnostics={...literalCoverage.diagnostics,anchors:literalCoverage.diagnostics.anchors.map(anchor=>{
      const returnedSourceIds=selectedHits.filter(hit=>returnedIds.has(hit.entry.id)&&hit.entry.terms.some(term=>term.hash===anchor.hash)).map(hit=>hit.entry.id);
      return {...anchor,returnedSourceIds,coverage:returnedSourceIds.length?'represented':anchor.eligible?'not_represented':anchor.reason};
    })};
    return {status:candidates.length?'requires_host_selection':unavailable.length?'source_unavailable':omitted.length?'budget_exceeded':'no_match',
      candidates,sourceMap,diagnostics:{modelCalls:0,historyResolves,sourceBytesMaterialized:sourceBytes,candidateBytes:jsonBytes(candidates),
        registeredSources:entries.size,indexedSources:documents.length,unindexedSources:[...entries.keys()].filter(id=>!index.has(id)),
        lexicalMatches:hits.length,truncated:hits.length>limits.maxCandidates,unavailable,omitted,querySegmentation:query.segmentation,
        selectionRequired:true,semanticRelevance:'unverified',historyAbsence:'not_established',multipleCandidates:candidates.length>1,
        ...(groupRepresentation?{groupRepresentation,literalCoverage:{...literalDiagnostics,applied:false,reason:'registered_event_group_allocation_preserved'}}:
          {literalCoverage:{...literalDiagnostics,applied:true}})}};
  }
  // Supply comparable locators for IDs already offered by a caller. This does
  // not perform another top-k selection, formal read, activation or index write.
  async function locateSources({text,sourceIds,maxSources,maxSourceBytes,maxExcerptCodePoints,enabled,clean}={}){
    if(enabled===false||clean===true)return {status:'disabled',locators:[],diagnostics:{historyResolves:0,sourceBytesMaterialized:0,modelCalls:0}};
    if(enabled!==true||clean!==false||typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>limits.maxQueryBytes
      ||!positive(maxSources)||maxSources>limits.maxStoredSources||!positive(maxSourceBytes)||maxSourceBytes>limits.maxIndexSourceBytes
      ||!positive(maxExcerptCodePoints)||maxExcerptCodePoints>limits.maxExcerptCodePoints
      ||!Array.isArray(sourceIds)||sourceIds.length>maxSources||new Set(sourceIds).size!==sourceIds.length)throw Error('invalid_local_locator_request');
    const entries=await authorized(sourceIds),index=await indexed(),query=new Map(tokenize(text,limits.maxIndexTokens).terms.map(term=>[term.hash,term]));
    const locators=[],unavailable=[];let historyResolves=0,sourceBytesMaterialized=0;
    for(const id of sourceIds){
      const meta=entries.get(id),entry=index.get(id);
      if(!entry||entry.evidenceHash!==meta.evidenceHash){unavailable.push({id,reason:entry?'indexed_evidence_changed':'source_not_indexed'});continue;}
      if(entry.sourceBytes>maxSourceBytes){unavailable.push({id,reason:'locator_source_byte_limit'});continue;}
      historyResolves++;const found=await resolveCmcpHistorySource({provider:history,pointer:entry.pointer});
      if(found.status!=='found'){unavailable.push({id,reason:'source_'+found.status});continue;}
      const evidence=found.evidence,sourceBytes=Buffer.byteLength(evidence.content.body);sourceBytesMaterialized+=sourceBytes;
      if(loopHash(evidence)!==entry.evidenceHash||evidence.sourceAuthorRole!==meta.sourceAuthorRole
        ||sourceBytes!==entry.sourceBytes||sourceBytes>maxSourceBytes){unavailable.push({id,reason:'source_changed'});continue;}
      const locations=[];for(const term of entry.terms){const match=query.get(term.hash);if(match)for(const [start,end]of term.positions)locations.push({start,end,hash:term.hash,weight:Math.min(match.weight,term.weight)});}
      const points=[...evidence.content.body],range=locations.length?locatorWindow(locations,points.length,maxExcerptCodePoints):{start:0,end:Math.min(points.length,maxExcerptCodePoints)};
      locators.push({id,pointer:copy(entry.pointer),evidenceHash:entry.evidenceHash,excerpt:{kind:evidence.content.kind,text:points.slice(range.start,range.end).join(''),
        purpose:'locator_excerpt_requires_explicit_read',location:{unit:'unicode_code_points',start:range.start,end:range.end},complete:range.start===0&&range.end===points.length}});
    }
    return {status:unavailable.length?'partial':'complete',locators,diagnostics:{historyResolves,sourceBytesMaterialized,modelCalls:0,
      requestedSources:sourceIds.length,maxSources,maxSourceBytes,maxMaterializedSourceBytes:sourceIds.length*maxSourceBytes,unavailable,formalRead:false,activation:'none'}};
  }
  return Object.freeze({limits,indexSource:input=>indexSource(input),search,locateSources,
    /** One caller-owned reconciliation, never a process-lifetime index cache.
     * Each journal is verified once at entry; appends keep the same immutable
     * publication guard. Exact original reads are deliberately not cached.
     */
    async withBatch(run,{catalog:sourceCatalog=catalog,valid=async()=>true}={}){
      if(typeof run!=='function'||typeof sourceCatalog?.list!=='function'||typeof valid!=='function')throw Error('invalid_local_index_batch');
      if(!await valid())throw Error('local_index_batch_cancelled');
      const batch={active:true,catalog:sourceCatalog,entries:await authorized(undefined,sourceCatalog),existing:await indexed(),valid};
      const scoped=Object.freeze({indexSource:input=>indexSource(input,batch)});
      try{return await run(scoped);}finally{batch.active=false;batch.entries.clear();batch.existing.clear();}
    },
    async rebuild({sourceIds}){
      if(!Array.isArray(sourceIds)||sourceIds.length>limits.maxStoredSources)throw Error('explicit_bounded_local_rebuild_required');
      const entries=await authorized(sourceIds),results=[];for(const entry of entries.values())results.push(await indexSource(entry.pointer));
      return {status:results.some(result=>result.status==='pending')?'partial':'complete',results};
    },
    async status(){const [entries,index]=await Promise.all([authorized(),indexed()]);return {
      kind:'cmcp_local_candidate_status',scopeId,registeredSources:entries.size,indexedSources:index.size,
      pendingSourceIds:[...entries.keys()].filter(id=>!index.has(id)),limits:copy(limits),capacity:await journal.status(),modelCalls:0,
      derivative:true,semanticRelevance:'unverified',tokenizer:'Intl.Segmenter when available, otherwise Unicode word runs; CJK bigrams in both'};}
  });
}
