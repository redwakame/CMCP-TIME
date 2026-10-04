import assert from 'node:assert/strict';
import {buildLoopRequest,decodeLoopResponse,validateLoopSchema} from '../src/cmcp-guard/cmcp-local-loop-protocol.js';
import {buildCmcpDeepSeekWireRequest} from '../src/cmcp-guard/cmcp-responses-transport.js';
import {parseCmcpJsonOutput} from '../src/cmcp-guard/cmcp-json-framing.js';

const rawNewline='first paragraph\n\nsecond paragraph';
const output={text:rawNewline,sourceRefs:['r1'],evidenceStatus:'sufficient'};
const malformed='{"text":"'+rawNewline+'","sourceRefs":["r1"],"evidenceStatus":"sufficient"}';
assert.throws(()=>parseCmcpJsonOutput(malformed,{mode:'strict_json'}),SyntaxError);
assert.throws(()=>parseCmcpJsonOutput('```json\n'+malformed+'\n```',{mode:'single_json_fence'}),SyntaxError);
assert.deepEqual(parseCmcpJsonOutput(JSON.stringify(output),{mode:'strict_json'}).value,output);

const formatRule='JSON escape '+String.raw`\n`;
const basic=buildLoopRequest('recall_answer',{question:'What did I say?'});
assert.ok(basic.instructions.includes(formatRule));
assert.ok(basic.instructions.includes('never place a literal newline or carriage return'));
assert.equal(basic.schema.properties.text.maxLength,1600);
const selectedOther=buildLoopRequest('recall_answer',{question:'What did I say?',
  context:{kind:'selected_original',status:'read',context:{evidence:[]}}});
assert.equal(selectedOther.schema.properties.text.maxLength,1600);
assert.match(selectedOther.instructions,/1\.\.1600 Unicode code points/);
const selected=buildLoopRequest('recall_answer',{question:'What did I say?',
  context:{kind:'answer_history',status:'read',context:{evidence:[]}},allowedSourceRefs:[]});
assert.ok(selected.instructions.includes(formatRule));
assert.equal(selected.schema.properties.evidenceStatus.type,'string');
assert.match(selected.instructions,/exactly text, sourceRefs, evidenceStatus/);
assert.match(selected.instructions,/1\.\.2400 Unicode code points/);
assert.deepEqual(selected.schema.required,['text','sourceRefs','evidenceStatus']);
assert.equal(selected.schema.properties.text.maxLength,2400);
const textOnly={text:'x'.repeat(1792)};
assert.equal(validateLoopSchema(textOnly,selected.schema),false);
assert.throws(()=>decodeLoopResponse(textOnly,'recall_answer',selected.schema),/invalid_proposal_schema/,
 'a text-only output is rejected without inventing citations or an evidence verdict');
assert.equal(validateLoopSchema({text:'x'.repeat(1958),sourceRefs:[],evidenceStatus:'sufficient'},selected.schema),true);
assert.equal(validateLoopSchema({text:'x'.repeat(2400),sourceRefs:[],evidenceStatus:'sufficient'},selected.schema),true);
assert.equal(validateLoopSchema({text:'x'.repeat(2401),sourceRefs:[],evidenceStatus:'sufficient'},selected.schema),false);
assert.equal(validateLoopSchema({text:'A bounded finding.',sourceRefs:[],evidenceStatus:'insufficient'},selected.schema),true);
const config={model:'synthetic',reasoning:'none',maxOutputTokens:1000,endpoint:'https://example.invalid'};
const wire=JSON.parse(buildCmcpDeepSeekWireRequest({purpose:'recall_answer',input:{question:'What did I say?'},config}).body);
assert.equal(wire.text.format.type,'json_schema');
assert.ok(wire.instructions.includes(formatRule));
const plain=buildLoopRequest('answer',{user:{text:'Hello',sourceAuthorRole:'user'}},{answerOutputMode:'plain_text'});
assert.equal(plain.outputMode,'plain_text');
assert.ok(!plain.instructions.includes(formatRule));

console.log(JSON.stringify({kind:'offline_recall_json_boundary',status:'PASS',modelCalls:0,
  malformedRawLineBreaksRejected:true,escapedParagraphsPreserved:true,
  recallRequestPaths:['ordinary','selected_context','formal_answer_history'],plainAnswerUnchanged:true,
  textOnlyRejected:true,formalAnswerHistoryLimit:2400,overLimitRejected:true}));
