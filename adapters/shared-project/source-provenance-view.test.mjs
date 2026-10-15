import test from 'node:test';
import assert from 'node:assert/strict';
import {attachSharedSourceProvenance as attach,attachSharedReadAttribution as attachRead} from './source-provenance-view.mjs';
import {createHash} from 'node:crypto';
import {projectHarnessToolResult} from '../deepseek-harness/runtime-bridge.mjs';
import {CMCP_SOURCE_CONTEXT_LIMITS as limits} from '../../src/cmcp-guard/cmcp-continuity-source-context.js';

const copy=structuredClone,digest='a'.repeat(64),projectionHash='b'.repeat(64);
function fixture(){
 const role='assistant',source={ref:'r1',sourceAuthorRole:role,messageRecordedAt:'2026-10-13T01:00:00.000Z',eventOccurredAt:null,evidenceHash:digest};
 const reader={kind:'cmcp_reader_identity',version:1,projectId:'synthetic-project',scopeId:'synthetic-scope',hostId:'hermes',agentId:'synthetic-agent',sessionId:'same-name',activeTurnId:'c'.repeat(64),verification:'authenticated_active_host_turn'};
 const origin={projectId:reader.projectId,hostId:'harness',agentId:reader.agentId,sessionId:reader.sessionId,messageId:'synthetic-message',revisionId:'r1',role};
 const provenance={ref:'r1',ticket:'synthetic-ticket',origin,qualifiedSessionId:'qualified-original',sourcePointer:{version:1,providerNamespace:'synthetic',scopeId:reader.scopeId,itemId:'original',sessionId:'qualified-original',revisionId:'r1'},evidenceHash:digest,verification:'formal_read_binding',readerComparison:{sameHost:false,sameAgent:false,sameSession:false,meaning:'identity_equality_only_not_adoption_or_execution'}};
 return {kind:'cmcp_continuity_projection',status:'ready',scopeId:reader.scopeId,ticket:provenance.ticket,projectionHash,projection:{sources:[source]},readerIdentity:reader,sourceOrigins:[provenance],presentation:{sourceContext:{kind:'cmcp_formal_source_context',version:1,projectionHash,
  metadata:{status:'available',sources:[copy(source)]},originalMessages:{status:'available',messages:[{...source,text:'合成的前一宿主可見回覆。',range:{unit:'unicode_code_points',start:0,end:13}}],truncated:false}}}};
}

test('來源身分呈現只取正式 broker 封套，與原角色及現在讀者分開',()=>{
 const original=fixture(),before=JSON.stringify(original),result=attach(original),view=result.presentation.sourceContext;
 assert.equal(view.provenance.status,'available');assert.equal(view.provenance.currentReader.hostId,'hermes');
 assert.equal(view.provenance.bindings[0].capture.hostId,'harness');assert.equal(view.provenance.bindings[0].messageRole,'assistant');
 assert.deepEqual(view.provenance.bindings[0].readerComparison,original.sourceOrigins[0].readerComparison);
 assert.equal(view.metadata.sources[0].sourceProvenanceReference,view.originalMessages.messages[0].sourceProvenanceReference);
 assert.equal(view.provenance.bindings[0].sourceOriginReference,'/sourceOrigins/0');assert.equal(view.provenance.actualModelConsumption,'not_observed');
 assert.equal(view.provenance.executionAuthority,'none');assert.match(view.provenance.verificationLayer,/not_core_receipt/);
 assert.equal(result.projectionHash,original.projectionHash);assert.deepEqual(result.projection,original.projection);assert.deepEqual(result.sourceOrigins,original.sourceOrigins);assert.equal(JSON.stringify(original),before);
 assert.equal(view.originalMessages.messages[0].text,original.presentation.sourceContext.originalMessages.messages[0].text);
});

test('缺身分或同 ref 的 ticket／hash／role／scope／Session／比較漂移都保留 unknown，不冒填目前讀者',()=>{
 const variants=[value=>{delete value.readerIdentity;},value=>{value.sourceOrigins=[];},value=>{value.sourceOrigins.push(copy(value.sourceOrigins[0]));},
  value=>{value.sourceOrigins[0].ticket='old-ticket';},value=>{value.sourceOrigins[0].evidenceHash='0'.repeat(64);},value=>{value.sourceOrigins[0].origin.role='user';},
  value=>{value.sourceOrigins[0].sourcePointer.scopeId='other';},value=>{value.sourceOrigins[0].qualifiedSessionId='other';},
  value=>{value.sourceOrigins[0].readerComparison.sameHost=true;},value=>{value.sourceOrigins[0].verification='model_claimed';}];
 for(const mutate of variants){const value=fixture();mutate(value);const row=attach(value).presentation.sourceContext.provenance.bindings[0];assert.equal(row.status,'unknown');assert.equal(row.capture,null);assert.equal(row.readerComparison,null);}
});

test('同宿主新 Session 與同 Session 自讀保留既有比較；opaque 名稱不當人格或採納證據',()=>{
 for(const same of [false,true]){const value=fixture();value.readerIdentity.hostId='harness';value.readerIdentity.sessionId=same?'same-name':'another-session';value.sourceOrigins[0].readerComparison={sameHost:true,sameAgent:true,sameSession:same,meaning:'identity_equality_only_not_adoption_or_execution'};
  const view=attach(value).presentation.sourceContext;assert.equal(view.provenance.bindings[0].status,'verified');assert.equal(view.provenance.bindings[0].readerComparison.sameSession,same);assert.equal(view.provenance.semanticVerification,'not_performed');}
});

test('原 unknown／unavailable 不復活；附加容量不足整個 view 明示 unavailable 而不裁原文',()=>{
 const missing=fixture();missing.presentation.sourceContext.metadata={status:'unknown',sources:null};missing.presentation.sourceContext.originalMessages={status:'unavailable',messages:null,reason:'original_missing'};
 assert.deepEqual(attach(missing),missing);
 const metadataFull=fixture();metadataFull.presentation.sourceContext.metadata.syntheticBoundary='x'.repeat(limits.maxMetadataBytes-400);
 const overflow=attach(metadataFull).presentation.sourceContext;assert.equal(overflow.provenance.status,'unavailable');assert.equal(overflow.metadata.status,'unavailable');assert.equal(overflow.metadata.sources,null);assert.equal(overflow.originalMessages.messages,null);assert.equal(overflow.originalMessages.truncated,false);
 const bodyFull=fixture();bodyFull.presentation.sourceContext.originalMessages.messages[0].text='x'.repeat(limits.maxContextBytes-300);
 const boundary=attach(bodyFull).presentation.sourceContext;assert.equal(boundary.provenance.status,'available');assert.equal(boundary.originalMessages.status,'unavailable');assert.equal(boundary.originalMessages.messages,null);assert.equal(boundary.originalMessages.truncated,false);
 const unavailable=fixture();unavailable.presentation.sourceContext.originalMessages={status:'unavailable',reason:'whole_source_bytes_limit',messages:null,truncated:false};
 assert.deepEqual(attach(unavailable).presentation.sourceContext.originalMessages,unavailable.presentation.sourceContext.originalMessages);
});

test('未知額外欄位不搬入身分視圖；無正式來源 view 或投影不一致時不補身分',()=>{
 const value=fixture();value.readerIdentity.privateBody='不得外洩';value.sourceOrigins[0].origin.privateBody='不得外洩';
 assert.equal(JSON.stringify(attach(value).presentation.sourceContext).includes('不得外洩'),false);
 for(const status of ['rejected','unavailable']){const changed=fixture();changed.status=status;assert.deepEqual(attach(changed),changed);}
 const changed=fixture();changed.presentation.sourceContext.projectionHash='0'.repeat(64);assert.deepEqual(attach(changed),changed);
});

function pageFixture(){
 const f=fixture(),source=f.projection.sources[0],content='另一宿主留下的合成可見回覆。',range={unit:'unicode_code_points',start:0,end:[...content].length};
 return {kind:'cmcp_reading_page',ticket:f.ticket,status:'page',source,range,coverage:{complete:true},projection:{status:'projected'},
  modelContext:JSON.stringify({kind:'cmcp_reading_page_context',sourceRef:source.ref,source:{sourceAuthorRole:source.sourceAuthorRole,evidenceHash:source.evidenceHash},time:{messageRecordedAt:source.messageRecordedAt},range,content}),
  readerIdentity:f.readerIdentity,sourceOrigins:f.sourceOrigins};
}
test('正式 read 當頁直接關聯原文與來源擷取身分，經既有精簡不改 hash／範圍／原時間',()=>{
 const page=pageFixture(),before=JSON.stringify(page),after=attachRead(page,page.readerIdentity.scopeId),view=after.sourceAttribution;
 assert.equal(view.status,'available');assert.equal(view.binding.capture.hostId,'harness');assert.equal(view.currentReader.hostId,'hermes');assert.equal(view.binding.messageRole,'assistant');
 assert.equal(view.binding.readerComparison.sameSession,false);assert.deepEqual(view.material.range,page.range);
 assert.equal(view.material.messageRecordedAt,page.source.messageRecordedAt);assert.equal(view.material.evidenceHash,digest);
 assert.equal(view.material.textSha256,createHash('sha256').update(JSON.parse(page.modelContext).content).digest('hex'));
 const {sourceAttribution,...unchanged}=after;assert.deepEqual(unchanged,page);assert.equal(JSON.stringify(page),before);
 assert.equal(Object.hasOwn(view.material,'content'),false);assert.equal(JSON.stringify(view).includes(JSON.parse(page.modelContext).content),false);
 const projected=projectHarnessToolResult(after);assert.deepEqual(projected.sourceAttribution,view);assert.equal(projected.modelContext.content,JSON.parse(page.modelContext).content);
 const {sourceAttribution:ignored,...compact}=projected;const fromCompact=attachRead(compact,page.readerIdentity.scopeId);assert.deepEqual(fromCompact.sourceAttribution,view);
});
test('read 原文／ref／range／role／time／ticket 漂移不取得有效身分，缺資料 unknown 且容量不足整份 unavailable',()=>{
 const variants=[p=>{p.sourceOrigins=[];},p=>{p.sourceOrigins[0].ticket='old';},p=>{p.sourceOrigins[0].origin.role='user';},
  p=>{p.sourceOrigins[0].evidenceHash='0'.repeat(64);},p=>{p.sourceOrigins[0].readerComparison.sameHost=true;},p=>{p.range.end++;},
  p=>{p.source.ref='other';},p=>{p.source.messageRecordedAt='2020-01-01T00:00:00.000Z';},p=>{delete p.readerIdentity;},p=>{p.modelContext=null;}];
 for(const mutate of variants){const p=pageFixture();mutate(p);const result=attachRead(p,'synthetic-scope');assert.equal(result.sourceAttribution.status,'unknown');assert.notEqual(result.sourceAttribution.binding?.status,'verified');assert.equal(result.modelContext,p.modelContext);}
 const capacity=pageFixture(),reader=capacity.readerIdentity,origin=capacity.sourceOrigins[0].origin;
 for(const key of ['projectId','hostId','agentId','sessionId'])reader[key]='"'.repeat(900);
 for(const key of ['projectId','hostId','agentId','sessionId','messageId','revisionId'])origin[key]='"'.repeat(900);
 capacity.sourceOrigins[0].readerComparison={sameHost:true,sameAgent:true,sameSession:true,meaning:'identity_equality_only_not_adoption_or_execution'};
 const full=attachRead(capacity,reader.scopeId);assert.equal(full.sourceAttribution.status,'unavailable');assert.equal(full.sourceAttribution.binding,null);assert.equal(full.modelContext,capacity.modelContext);
 const privateFields=pageFixture();privateFields.readerIdentity.privateBody='不得外洩';privateFields.sourceOrigins[0].origin.privateBody='不得外洩';assert.equal(JSON.stringify(attachRead(privateFields,'synthetic-scope').sourceAttribution).includes('不得外洩'),false);
});
