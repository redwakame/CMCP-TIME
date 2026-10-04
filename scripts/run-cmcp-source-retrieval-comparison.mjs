import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createCmcpReactivationStores,createCmcpTemporalSourceCatalog} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {createCmcpLocalCandidates} from '../src/cmcp-guard/cmcp-local-candidates.js';
import {createCmcpAnswerHistory} from '../src/cmcp-guard/cmcp-answer-history.js';
import {createLocalLoopJournal,loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {createCmcpSourceEvidence} from '../src/cmcp-guard/cmcp-source-evidence.js';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const work=path.resolve(process.argv[2]??'');
const allowed=path.join(root,'logs','retrieval-comparison');
const relative=path.relative(allowed,work);
assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'comparison root must be a new logs/retrieval-comparison child');
await fs.mkdir(allowed,{recursive:true});
await fs.mkdir(work);
const scopeId='synthetic-source-comparison',event={scopeId,eventId:'conversation'},eventKey='conversation',sessionId='original-dialogue';
const stores=createCmcpReactivationStores({root:work,scopeId});
const catalog=createCmcpTemporalSourceCatalog({stores,maxEntries:40});
const journal=createLocalLoopJournal({root:path.join(work,'input-journal'),name:'cmcp-common-input-v1'});
const index=createCmcpLocalCandidates({root:path.join(work,'local-lexical-index'),scopeId,history:stores.history,catalog,
  limits:{maxStoredSources:40,maxCandidates:6,maxCandidateBytes:9000,maxExcerptCodePoints:420,maxQueryBytes:4096,maxIndexSourceBytes:4096,maxIndexTokens:131072}});
const dialogue=[
  ['u1','user','2026-05-02T09:00:00Z','The dockside demonstration is postponed until Friday because safety approval has not arrived.'],
  ['a1','assistant','2026-05-02T09:01:00Z','I can draft a launch announcement for the dockside demonstration. This is only a suggestion.','u1'],
  ['u2','user','2026-05-03T10:00:00Z','The original museum caption says the map was drawn in 1894. Please keep that sentence in draft one.'],
  ['a2','assistant','2026-05-03T10:01:00Z','Draft one: The harbor map was drawn in 1894, before the new rail link opened.','u2'],
  ['u3','user','2026-05-08T11:00:00Z','The revised museum caption should say the map was redrawn in 1902, not drawn in 1894.'],
  ['a3','assistant','2026-05-08T11:01:00Z','Draft two: The harbor map was redrawn in 1902 after the rail link opened.','u3'],
  ['u4','user','2026-05-10T14:00:00Z','For the harbor tour, I decided to postpone the public walk to next month. Do not publish the launch email.'],
  ['a4','assistant','2026-05-10T14:01:00Z','Understood. I would also consider adding a press preview, but that is my proposal.','u4'],
  ['u5','user','2026-05-12T12:00:00Z','I am comparing the blue and green exhibit layouts; neither has been approved.'],
  ['a5','assistant','2026-05-12T12:01:00Z','The green layout might be easier to navigate. I suggest it for review, not as your decision.','u5'],
  ['u6','user','2026-05-15T08:00:00Z','The repair invoice total is 41 dollars, conditional on the replacement part passing inspection.'],
  ['u7','user','2026-05-17T08:00:00Z','A second repair quote is 41 euros and remains an unaccepted alternative.'],
];
const byId=new Map();
function evidence([id,role,messageRecordedAt,body]){return createCmcpSourceEvidence({pointer:{version:1,providerNamespace:stores.history.descriptor.providerNamespace,
  scopeId,sessionId,itemId:id,revisionId:'r1'},sourceKind:'message',sourceAuthorRole:role,messageRecordedAt,eventOccurredAt:null,
  content:{kind:'source_excerpt',body},metadata:{availability:'available'}});}
for(const row of dialogue){const source=evidence(row);byId.set(row[0],source);await stores.history.writeEvidence(source);
  await catalog.registerSource({pointer:source.pointer});await index.indexSource(source.pointer);
  await journal.append('source_association',{pointer:source.pointer,event,bufferGeneration:0});
  if(row[4]){const user=byId.get(row[4]);await journal.append('assistant_reply_binding',{version:1,pointer:source.pointer,sourceHash:loopHash(source),
    replyTo:user.pointer,replyToEvidenceHash:loopHash(user),eventKey,eventVersion:loopHash([]),bufferGeneration:0,
    basis:'runtime_observed_answer_to_exact_user_source'});}
}
const access=createCmcpAnswerHistory({stores,catalog,journal,localIndex:index,timezone:'Etc/UTC',now:()=> '2026-05-20T12:00:00Z'});
const cases=[
  {id:'paraphrase',question:'When did I decide the public outing would happen?',expected:['u4']},
  {id:'cross_language',question:'港口導覽的公開活動，我最後決定延到什麼時候？',expected:['u4']},
  {id:'time_range',question:'In the second week of May, what changed in the museum caption?',expected:['u3','a3']},
  {id:'first_version',question:'What wording did the first draft use for the map date?',expected:['a2']},
  {id:'conditional_negative',question:'Was the repair payment unconditional and already approved?',expected:['u6','u7']},
  {id:'assistant_not_user',question:'Did I choose the green layout, or was that only advice?',expected:['u5','a5']},
  {id:'ambiguous',question:'What did the map draft say?',expected:['a2','a3']},
  {id:'limited_miss',question:'What was my final choice of caterer?',expected:[]},
  {id:'holdout',question:'Welche Summe galt nur, falls das Ersatzteil die Prüfung besteht?',expected:['u6']},
];
const results=[];
for(const item of cases){const query=evidence(['q-'+item.id,'user','2026-05-20T12:00:00Z',item.question]);await stores.history.writeEvidence(query);
  const start=performance.now(),prepared=await access.prepare({source:query,event,eventKey,bufferGeneration:0});
  const offered=prepared.internal.mapping.map(row=>({ref:row.ref,id:row.entry.pointer.itemId,role:row.entry.sourceAuthorRole,
    time:row.entry.messageRecordedAt,hash:row.entry.evidenceHash}));
  results.push({id:item.id,question:item.question,expected:item.expected,offered,necessaryOffered:item.expected.filter(id=>offered.some(row=>row.id===id)),
    catalog:prepared.model,diagnostics:{locatorIO:prepared.internal.locatorIO,allocation:prepared.internal.locatorAllocation,
      candidateGroups:prepared.internal.candidateGroups},elapsedMs:Math.round((performance.now()-start)*10)/10});
}
const output={kind:'cmcp_source_retrieval_comparison_v1',sourceCount:dialogue.length,cases:results};
await fs.writeFile(path.join(work,'comparison.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({root:work,cases:results.map(row=>({id:row.id,expected:row.expected,offered:row.offered.map(item=>item.id),
  necessaryOffered:row.necessaryOffered,elapsedMs:row.elapsedMs}))},null,2));
