import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {withContinuityReadingContract} from './continuity-contract-view.mjs';
import {projectHarnessToolResult} from './deepseek-harness/runtime-bridge.mjs';
import {CONTINUITY_READING_CONTRACT,CONTINUITY_READING_CONTRACT_METADATA,CONTINUITY_BEFORE_ANSWER_POLICY} from './continuity-policy.mjs';
const open=()=>({kind:'cmcp_reading_collection',status:'ready',ticket:'ticket-local',collection:{sources:[{ref:'r1',sourceAuthorRole:'user',messageRecordedAt:'2026-10-01T00:00:00Z'}]},readSources:0});
test('靜態詳細契約只附於成功 open，不改正式來源、票券或覆蓋，重複呈現冪等',()=>{
 const value=open(),before=structuredClone(value),result=withContinuityReadingContract(value);
 assert.deepEqual(value,before);const {continuityContract,...formal}=result;assert.deepEqual(formal,before);
 assert.equal(continuityContract.text,CONTINUITY_READING_CONTRACT);
 assert.equal(continuityContract.sha256,createHash('sha256').update(continuityContract.text).digest('hex'));
 assert.equal(continuityContract.bytes,Buffer.byteLength(continuityContract.text));
 assert.equal(continuityContract.authority,'host_protocol_not_source_or_authorization');
 assert.deepEqual(continuityContract,{...CONTINUITY_READING_CONTRACT_METADATA,text:CONTINUITY_READING_CONTRACT});
 assert.equal(withContinuityReadingContract(result),result);
 assert.equal(result.readSources,0);assert.ok(!CONTINUITY_BEFORE_ANSWER_POLICY.includes(CONTINUITY_READING_CONTRACT));
});
test('拒絕、範圍不足、未授權、缺票券與每頁結果不取得詳細契約',()=>{
 for(const value of [null,{...open(),status:'rejected'},{...open(),status:'scope_limit'},{...open(),status:'disabled'},{...open(),status:'clean'},
  {...open(),ticket:''},{...open(),collection:{}},
  {kind:'cmcp_reading_page',ticket:'ticket-local',status:'page',source:{ref:'r1'},modelContext:'{}'},
  {kind:'cmcp_reading_navigation',status:'ready'},{kind:'cmcp_continuity_projection',status:'rejected'}])assert.equal(withContinuityReadingContract(value),value);
});
test('Harness 共用呈現只在 open 加入同源契約，原生／SDK／Hermes 不逐頁重複',()=>{
 const value=open(),projected=projectHarnessToolResult(value),again=projectHarnessToolResult(projected);
 assert.equal(projected.continuityContract.sha256,CONTINUITY_READING_CONTRACT_METADATA.sha256);assert.deepEqual(again,projected);
 assert.equal(projected.ticket,value.ticket);assert.equal(projected.manifestHash,value.manifestHash);
 assert.deepEqual(projected.collection.sources,[{ref:'r1'}]);
 const page={kind:'cmcp_reading_page',status:'page',ticket:value.ticket,modelContext:'{}'};
 assert.equal(projectHarnessToolResult(page).continuityContract,undefined);
});
