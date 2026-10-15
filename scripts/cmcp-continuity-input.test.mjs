import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const product=path.resolve(process.env.CMCP_PRODUCT_ROOT??source);
const load=file=>import(pathToFileURL(path.join(product,file)).href);
const {continuityToolSchema,CONTINUITY_TOOL_PARAMETERS,readContinuityProposal,CONTINUITY_MAX_PROPOSAL_BYTES}=await load('adapters/continuity-input.mjs');
const {dynamicTools,validateRead}=await load('adapters/codex/shared-project/adapter.mjs');
const {readerTools}=await load('adapters/hermes/bridge.mjs');
const basis={id:'p',ref:'r1',quote:'我打算製作合成展示架。',topic:'展示架',aspect:'計畫',temporalUse:'current'};
const proposal=()=>({version:6,plans:[structuredClone(basis)],unknowns:[]});

test('型別物件與舊字串正規化等價，保留舊 v1-v6 表示且不補語意預設',()=>{
 const p=proposal(),typed=readContinuityProposal({ticket:'t',proposal:p}),legacy=readContinuityProposal({ticket:'t',proposalJson:JSON.stringify(p)});
 assert.deepEqual(typed,legacy);assert.equal(Object.hasOwn(typed.plans[0],'planStatus'),false);assert.deepEqual(typed,p);assert.notEqual(typed,p);
 for(const version of [1,2,3,4,5,6])assert.equal(readContinuityProposal({ticket:'t',proposalJson:JSON.stringify({version,nodes:[],unknowns:[]})}).version,version);
 assert.throws(()=>readContinuityProposal({ticket:'t',proposal:{version:5,plans:[],unknowns:[]}}),/typed_v6_or_v7_required/);
});
test('物件及字串恰好擇一，未知外殼與過大提案拒絕',()=>{
 for(const args of [{ticket:'t'},{ticket:'t',proposal:proposal(),proposalJson:'{}'}]){
  assert.equal(continuityToolSchema.safeParse(args).success,false);assert.throws(()=>readContinuityProposal(args),/exactly_one/);
 }
 assert.throws(()=>readContinuityProposal({ticket:'t',proposal:proposal(),role:'user'}),/invalid_tool_arguments/);
 const huge=proposal();huge.unknowns=['界'.repeat(CONTINUITY_MAX_PROPOSAL_BYTES)];
 for(const args of [{ticket:'t',proposal:huge},{ticket:'t',proposalJson:JSON.stringify(huge)}])assert.throws(()=>readContinuityProposal(args),/too_large/);
});
test('型別 schema 定位 context 與 status 缺件，不接受換 kind 躲過該分支必填',()=>{
 const context=proposal();context.context=[{...basis,id:'q',kind:'user_question'}];delete context.context[0].temporalUse;
 const c=continuityToolSchema.safeParse({ticket:'t',proposal:context});assert.equal(c.success,false);assert.ok(c.error.issues.some(i=>i.path.join('.')==='proposal.context.0.temporalUse'));
 const status=proposal();status.plans[0].orderedChanges=[{kind:'status',ref:'r2',quote:'先暫停製作。'}];
 const s=continuityToolSchema.safeParse({ticket:'t',proposal:status});assert.equal(s.success,false);assert.ok(s.error.issues.some(i=>i.path.join('.')==='proposal.plans.0.orderedChanges.0.planStatus'));
 status.plans[0].orderedChanges[0].kind='reason';assert.equal(continuityToolSchema.safeParse({ticket:'t',proposal:status}).success,false);
 status.plans[0].orderedChanges=[{kind:'reason',ref:'r2',quote:'以方便收納為優先。',reasons:[{id:'r',ref:'r2',quote:'以方便收納為優先。',kind:'withdraws'}]}];
 assert.equal(continuityToolSchema.safeParse({ticket:'t',proposal:status}).success,false);
});
test('Codex 與 Hermes 使用同一可機讀 schema，二擇一條件不在轉接時遺失',()=>{
 const a=dynamicTools.find(t=>t.name==='cmcp_project_continuity').inputSchema,b=readerTools.find(t=>t.name==='cmcp_project_continuity').inputSchema;
 assert.deepEqual(a,CONTINUITY_TOOL_PARAMETERS);assert.deepEqual(b,a);assert.deepEqual(a.oneOf,[{required:['proposal']},{required:['proposalJson']}]);
 assert.equal(a.properties.proposal.type,'object');assert.deepEqual(a.properties.proposal.properties.version.anyOf.map(v=>v.const),[6,7]);
 for(const args of [{ticket:'t',proposal:proposal()},{ticket:'t',proposalJson:JSON.stringify(proposal())}])assert.deepEqual(validateRead('continuity',args),args);
 assert.throws(()=>validateRead('continuity',{ticket:'t',proposal:proposal(),proposalJson:'{}'}),/exactly_one/);
});
test('來源用途兩種明示解決kind共用v6 schema，ACK／未知kind仍拒絕',()=>{
 const kinds=['reported_state_in_status_clause','reported_state_in_status_message'];
 assert.deepEqual(CONTINUITY_TOOL_PARAMETERS.properties.proposal.properties.reportScopeResolutions.items.properties.kind.enum,kinds);
 for(const kind of kinds){const p=proposal();p.reportScopeResolutions=[{findingId:'a'.repeat(64),kind,reportRef:'r2',reportQuote:'已完成校對。'}];
  assert.equal(continuityToolSchema.safeParse({ticket:'t',proposal:p}).success,true);assert.deepEqual(readContinuityProposal({ticket:'t',proposal:p}),p);
  assert.deepEqual(validateRead('continuity',{ticket:'t',proposal:p}),{ticket:'t',proposal:p});
 }
 for(const kind of ['ack','reported_state_in_other_message']){const p=proposal();p.reportScopeResolutions=[{findingId:'a'.repeat(64),kind,reportRef:'r2',reportQuote:'已完成校對。'}];assert.equal(continuityToolSchema.safeParse({ticket:'t',proposal:p}).success,false);}
});
