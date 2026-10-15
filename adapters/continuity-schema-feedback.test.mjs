import test from 'node:test';
import assert from 'node:assert/strict';
import {projectContinuitySchemaFeedback,CONTINUITY_SCHEMA_FEEDBACK_LIMITS as limits} from './continuity-schema-feedback.mjs';
import {readContinuityProposal,continuityToolSchema,CONTINUITY_MAX_PROPOSAL_BYTES} from './continuity-input.mjs';
const args=()=>({ticket:'synthetic-ticket',proposal:{version:6,plans:[{id:'p',ref:'r1',quote:'我打算製作模型。',topic:'模型',aspect:'計畫',temporalUse:'current',orderedChanges:[{kind:'content',quote:'尺寸改大。',edits:[{quote:'模型',kind:'replace',replacement:{ref:'r2',quote:'模型'}}]}]}],unknowns:[]}});
const preflight=value=>{readContinuityProposal(value);return projectContinuitySchemaFeedback(value);};

test('缺少修改來源只回同 schema 的欄位／型別，不猜值或更改提案',()=>{
 const value=args(),before=structuredClone(value),result=preflight(value);
 assert.deepEqual(value,before);assert.equal(continuityToolSchema.safeParse(value).success,false);
 assert.deepEqual(result.correction.issues,[{path:['proposal','plans',0,'orderedChanges',0,'ref'],code:'invalid_type',expectedType:'string'}]);
 assert.equal(result.status,'rejected');assert.equal(result.sourceRead,false);assert.equal(result.inputSchemaValidated,false);assert.equal(result.formalProjection,false);assert.equal(result.correction.autoFilled,false);
 value.proposal.plans[0].orderedChanges[0].ref='r2';assert.equal(preflight(value),null);assert.equal(continuityToolSchema.safeParse(value).success,true);
});
test('錯型別、未知鍵與字串秘密不進回饋；原始錯誤訊息也不外露',()=>{
 const value=args(),secret='PRIVATE_FIXTURE_DO_NOT_ECHO';value.proposal.plans[0].orderedChanges[0].ref={secret};value.proposal.plans[0][secret]=secret;value.proposal.plans[0].temporalUse=secret;
 const result=preflight(value),text=JSON.stringify(result);
 assert.equal(text.includes(secret),false);assert.equal(text.includes('message'),false);assert.equal(text.includes('received'),false);assert.equal(text.includes('ticket'),false);
 assert(result.correction.issues.some(x=>x.code==='invalid_type'));assert(result.correction.issues.some(x=>x.code==='unrecognized_keys'));
});
test('回饋量有界且缺省明示，外殼與容量拒絕仍在較前層',()=>{
 const value=args();value.proposal.plans=Array.from({length:12},(_,i)=>({...structuredClone(value.proposal.plans[0]),id:'p'+i}));
 const result=preflight(value);assert.equal(result.correction.issues.length,limits.maxIssues);assert.equal(result.correction.complete,false);assert.equal(result.correction.omittedIssues,true);assert(Buffer.byteLength(JSON.stringify(result))<=limits.maxBytes);
 const oversized=args();oversized.proposal.unknowns=['界'.repeat(CONTINUITY_MAX_PROPOSAL_BYTES)];assert.throws(()=>preflight(oversized),/too_large/);
 assert.throws(()=>preflight({...args(),private:'PRIVATE'}),/invalid_tool_arguments/);
 const circular=args();circular.proposal.self=circular;assert.throws(()=>preflight(circular),/invalid_tool_arguments/);
});
test('舊 proposalJson v1–v6 不套新深層 schema，字串與正常型別輸入保持原樣',()=>{
 for(const version of [1,2,3,4,5,6]){const value={ticket:'t',proposalJson:JSON.stringify({version,nodes:[],unknowns:[]})},before=structuredClone(value);assert.equal(preflight(value),null);assert.deepEqual(value,before);}
 assert.throws(()=>preflight({ticket:'t',proposalJson:'{'}),/invalid_proposal_json/);
});
