// Real shared input schemas and adapter methods; injected transports/authorization only.
// No model, live service, Core reduction, or filesystem fixture writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const product = path.resolve(process.env.CMCP_PRODUCT_ROOT ?? source);
const load = file => import(pathToFileURL(path.join(product, file)).href);
const require = createRequire(path.join(product, 'package.json'));
const {continuityToolSchema, CONTINUITY_TOOL_PARAMETERS, readContinuityProposal,
  CONTINUITY_MAX_PROPOSAL_BYTES, CONTINUITY_MAX_TOOL_ELEMENTS} = await load('adapters/continuity-input.mjs');
const {dynamicTools, validateRead, readTool, makeTicket} = await load('adapters/codex/shared-project/adapter.mjs');
const {readerTools, createHermesBridge} = await load('adapters/hermes/bridge.mjs');
const {createSharedHarnessHost} = await load('adapters/deepseek-harness/shared-project/host.mjs');
const {CmcpHarnessBridge} = await load('adapters/deepseek-harness/runtime-bridge.mjs');
const {createMcpReader} = await load('adapters/mcp/tools.mjs');
const {digest} = await load('adapters/mcp/config.mjs');
const {projectContinuitySchemaFeedback} = await load('adapters/continuity-schema-feedback.mjs');
const {Client} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const {InMemoryTransport} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/inMemory.js')).href);
const Ajv = require('ajv');
const validateJsonSchema = new Ajv({strict: false, allErrors: true}).compile(CONTINUITY_TOOL_PARAMETERS);
const clone = structuredClone;
const toolName = 'cmcp_project_continuity';
const pipe = '\\\\.\\pipe\\cmcp-scoped-input-fixture';
const proposal = () => ({version: 7, plans: [], unknowns: [], scopedPlans: [{
  id: 'shared-plan', topic: '來源綁定的兩個對象',
  scopes: [{id: 'left', ref: 'r1', quote: '甲區'}, {id: 'right', ref: 'r1', quote: '乙區'}],
  conditions: [{id: 'shared-condition', ref: 'r1', quote: '兩區都採原值', aspect: '共同条件',
    temporalUse: 'current', scopeIds: ['left', 'right'], planStatus: 'planned',
    reasons: [{id: 'original-reason', ref: 'r1', quote: '原考量'}]}],
  orderedChanges: [
    {kind: 'content', conditionId: 'shared-condition', scopeIds: ['left'], ref: 'r2', quote: '只改甲區的新值',
      replacement: {ref: 'r2', quote: '新值'}, reasons: [{id: 'new-priority', ref: 'r2', quote: '新優先', kind: 'prioritizes'}]},
    {kind: 'status', conditionId: 'shared-condition', scopeIds: ['right'], ref: 'r3', quote: '乙區暫停', planStatus: 'paused'},
    {kind: 'reason', conditionId: 'shared-condition', scopeIds: ['left'], ref: 'r4', quote: '甲區接受取捨',
      reasons: [{id: 'tradeoff', ref: 'r4', quote: '接受取捨', kind: 'accepts_tradeoff'}]}
  ],
  retentions: [{conditionId: 'shared-condition', scopeIds: ['right'], ref: 'r2', quote: '乙區仍維持', temporalUse: 'current'}],
  reasonWithdrawals: [{conditionId: 'shared-condition', scopeIds: ['left'], ref: 'r5', quote: '甲區撤回原考量',
    temporalUse: 'current', targetReasonId: 'original-reason'}]
}]});
const args = () => ({ticket: 'scoped-input-ticket', proposal: proposal()});
const invalidCases = () => [
  ['unknown change kind', p => { p.scopedPlans[0].orderedChanges[0].kind = 'override_all'; }],
  ['missing condition target', p => { delete p.scopedPlans[0].orderedChanges[0].conditionId; }],
  ['missing scope targets', p => { delete p.scopedPlans[0].orderedChanges[0].scopeIds; }],
  ['empty scope targets', p => { p.scopedPlans[0].orderedChanges[0].scopeIds = []; }],
  ['missing replacement', p => { delete p.scopedPlans[0].orderedChanges[0].replacement; }],
  ['status without status value', p => { delete p.scopedPlans[0].orderedChanges[1].planStatus; }],
  ['reason without reasons', p => { p.scopedPlans[0].orderedChanges[2].reasons = []; }],
  ['retention without target', p => { delete p.scopedPlans[0].retentions[0].conditionId; }],
  ['withdrawal without reason id', p => { delete p.scopedPlans[0].reasonWithdrawals[0].targetReasonId; }],
  ['v6 scoped extension', p => { p.version = 6; }],
  ['unknown nested key', p => { p.scopedPlans[0].orderedChanges[0].inventedScope = ['left']; }]
];
const echo = value => ({kind: 'schema_transport_echo_only', received: clone(value), modelCalls: 0});

function registeredHarnessFixture() {
  const tools = new Map(), agents = new Map();
  const ctx = {profileContext: {name: 'fixture'}, agents: {get: id => agents.get(id)},
    on: () => () => {}, effect: factory => factory(),
    tools: {register: tool => { tools.set(tool.name, tool); return () => {}; }},
    skills: {registerProvider: factory => { factory({invalidate() {}}); return () => {}; }}};
  const calls = [], config = {kind: 'cmcp_shared_harness_config', version: 1, projectId: 'fixture-project',
    hostId: 'harness', agentId: 'fixture-agent', profileName: 'fixture', workspaceRoot: product,
    artifactRoot: path.join(product, 'never-written-scoped-input-fixture'), skillPath: path.join(product, 'adapters/hermes/SKILL.md'),
    sessionIds: ['fixture-session'], route: {provider: 'no-provider', model: 'no-model'},
    connection: {pipe, controlAuthFile: path.join(product, 'unused-control-auth'), readAuthFile: path.join(product, 'unused-read-auth')}};
  const host = createSharedHarnessHost(ctx, config, {call: async request => { calls.push(clone(request)); return echo(request.request.args); }});
  const agent = {id: 'fixture-session', session: {id: 'fixture-session', header: {cwd: product}}};
  agents.set(agent.id, agent);
  host.states.set(agent.id, {agent, tail: Promise.resolve(), joined: true, revoked: false, epoch: 'fixture-epoch',
    binding: {userMessageId: 'fixture-message', harnessTurn: 1}, error: null, toolResults: 0, toolResultBytes: 0});
  return {tools, calls, config, agent};
}

test('v7 rich scoped input survives Zod, JSON transport, and both normalization forms without stripping', () => {
  const input = args(), saved = clone(input), parsed = continuityToolSchema.parse(input);
  assert.deepEqual(parsed, saved);
  assert.equal(validateJsonSchema(input), true, JSON.stringify(validateJsonSchema.errors));
  for (const envelope of [input, {ticket: input.ticket, proposalJson: JSON.stringify(input.proposal)}]) {
    assert.deepEqual(readContinuityProposal(envelope), input.proposal);
    assert.deepEqual(validateRead('continuity', envelope), envelope);
  }
  assert.deepEqual(input, saved);
  assert.equal(projectContinuitySchemaFeedback(input), null);
});

test('real shared Zod and emitted JSON schemas reject wrong kinds, missing targets, and v6 scopedPlans', () => {
  for (const [label, mutate] of invalidCases()) {
    const input = args(); mutate(input.proposal);
    assert.equal(continuityToolSchema.safeParse(input).success, false, label);
    assert.equal(validateJsonSchema(input), false, label);
    const feedback = projectContinuitySchemaFeedback(input);
    assert.equal(feedback.status, 'rejected', label);
    assert.equal(feedback.formalProjection, false, label);
    assert.equal(feedback.sourceRead, false, label);
  }
  const emptyExtension = {ticket: 't', proposal: {version: 6, plans: [], unknowns: [], scopedPlans: []}};
  assert.equal(continuityToolSchema.safeParse(emptyExtension).success, false);
  assert.equal(validateJsonSchema(emptyExtension), false);
  const missing = args(); delete missing.proposal.scopedPlans[0].orderedChanges[0].conditionId;
  assert.ok(projectContinuitySchemaFeedback(missing).correction.issues.some(issue =>
    issue.path.join('.') === 'proposal.scopedPlans.0.orderedChanges.0.conditionId'));
});

test('v6 ordinary typed plans and legacy strings remain accepted; envelope exclusivity remains enforced', () => {
  const p = {version: 6, plans: [{id: 'p', ref: 'r1', quote: '原計畫', topic: '原計畫', aspect: '條件', temporalUse: 'current'}], unknowns: []};
  const input = {ticket: 't', proposal: p};
  assert.deepEqual(continuityToolSchema.parse(input), input);
  assert.equal(validateJsonSchema(input), true);
  assert.deepEqual(readContinuityProposal(input), p);
  for (const version of [1, 2, 3, 4, 5, 6, 7]) {
    const legacy = {ticket: 't', proposalJson: JSON.stringify({version, plans: [], unknowns: []})};
    assert.equal(readContinuityProposal(legacy).version, version);
  }
  for (const envelope of [{ticket: 't'}, {...input, proposalJson: JSON.stringify(p)}]) {
    assert.equal(continuityToolSchema.safeParse(envelope).success, false);
    assert.equal(validateJsonSchema(envelope), false);
    assert.throws(() => readContinuityProposal(envelope), /exactly_one/);
  }
});

test('v7 schema feedback identifies version and scoped field paths without echoing values or invented keys', () => {
  const input = args(), secret = 'PRIVATE_SCOPED_INPUT_FIXTURE_DO_NOT_ECHO';
  delete input.proposal.scopedPlans[0].orderedChanges[0].conditionId;
  input.proposal.scopedPlans[0].conditions[0].quote = secret;
  input.proposal.scopedPlans[0][secret] = secret;
  const before = clone(input), feedback = projectContinuitySchemaFeedback(input), serialized = JSON.stringify(feedback);
  assert.equal(feedback.correction.proposalVersion, 7);
  assert.equal(feedback.status, 'rejected');
  assert.equal(feedback.correction.valuesIncluded, false);
  assert.equal(feedback.correction.autoFilled, false);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('scoped-input-ticket'), false);
  assert.ok(feedback.correction.issues.some(issue => issue.path.join('.') === 'proposal.scopedPlans.0.orderedChanges.0.conditionId'));
  assert.deepEqual(input, before);
});

test('Harness, Codex, and Hermes register the complete same v7 schema, including the v6 exclusion', () => {
  const harness = registeredHarnessFixture();
  for (const schema of [harness.tools.get(toolName).parameters,
    dynamicTools.find(tool => tool.name === toolName).inputSchema,
    readerTools.find(tool => tool.name === toolName).inputSchema]) {
    assert.deepEqual(schema, CONTINUITY_TOOL_PARAMETERS);
    assert.ok(schema.properties.proposal.properties.scopedPlans.items.properties.orderedChanges);
    assert.deepEqual(schema.properties.proposal.allOf, [{if: {properties: {version: {const: 6}}}, then: {not: {required: ['scopedPlans']}}}]);
  }
  assert.equal(harness.calls.length, 0, 'registration alone must not contact any service');
});

test('Harness shared tool and native bridge forward every scoped field to their existing receiver', async t => {
  const f = registeredHarnessFixture(), notes = [];
  t.mock.method(fs, 'mkdir', async target => { assert.equal(target, f.config.artifactRoot); });
  t.mock.method(fs, 'appendFile', async (target, data) => { assert.equal(target, path.join(f.config.artifactRoot, 'host-events.jsonl')); notes.push(data); });
  const input = args(), actual = await f.tools.get(toolName).execute(input, {agent: f.agent, signal: new AbortController().signal});
  assert.deepEqual(f.calls[0].request.args, input);
  assert.deepEqual(actual.received, input);
  assert.equal(notes.length, 1);
  const forwarded = [];
  const fixture = {enqueue: task => task(), turn: async () => ({turn: {text: '合成入口', capture: {}, enhanced: true, readings: new Set([input.ticket])},
    runtime: {config: {input: {timezone: 'Asia/Taipei'}}, readingContinuity: async value => { forwarded.push(clone(value.proposal)); return {kind: 'cmcp_continuity_projection', status: 'rejected', reason: 'fixture_no_core', modelCalls: 0}; }}}),
    validate: async () => {}, note: async () => {}};
  for (const envelope of [input, {ticket: input.ticket, proposalJson: JSON.stringify(input.proposal)}])
    await CmcpHarnessBridge.prototype.tool.call(fixture, 'fixture-session', toolName, envelope);
  assert.deepEqual(forwarded, [input.proposal, input.proposal]);
});

test('Codex actual readTool preserves scoped input in its injected broker request', async () => {
  const binding = {kind: 'cmcp_codex_shared_binding', version: 1, projectId: 'fixture-project', hostId: 'codex', agentId: 'fixture-agent',
    workspace: product, role: 'model_read', connection: {pipe, authFile: path.join(product, 'unused-read-auth')}};
  const ticket = makeTicket(binding, 'fixture-session', 'fixture-epoch'), input = args(), calls = [];
  const result = await readTool({binding, ticket, operation: 'continuity', args: input,
    call: async request => { calls.push(clone(request)); return echo(request.request.args); }});
  assert.deepEqual(calls[0].request.args, input);
  assert.deepEqual(result.received, input);
});

test('Hermes actual bridge preserves scoped input and rejects invalid nested fields before its reader', async () => {
  const received = [], sessionId = 'fixture-session', turnId = 'fixture-turn';
  const bridge = createHermesBridge({config: {}, scopeId: 'fixture-scope', shared: {projectId: 'fixture-project', pipe},
    host: {agentId: 'fixture-agent', workspace: product, controlAuthFile: path.join(product, 'unused-control-auth')}},
    {sessionId, authorized: true, note: async () => {}, call: async ({request}) => request.operation === 'join'
      ? {joined: true, epoch: 'fixture-epoch'} : request.operation === 'receive' ? {capture: {sourcePointer: {fixture: true}}} : {},
      mcpFactory: async () => ({call: async (name, value) => { received.push({name, value: clone(value)}); return echo(value); }, close: async () => {}})});
  try {
    await bridge.dispatch({sessionId, operation: 'begin', args: {turnId, userMessage: '合成入口測試，沒有模型。', receivedAt: '2026-01-01T00:00:00.000Z'}});
    const input = args(), result = await bridge.dispatch({sessionId, operation: 'tool', args: {turnId, name: toolName, arguments: input}});
    assert.deepEqual(received, [{name: toolName, value: input}]);
    assert.deepEqual(result.received, input);
    for (const [label, mutate] of invalidCases()) {
      const invalid = args(); mutate(invalid.proposal);
      const rejected = await bridge.dispatch({sessionId, operation: 'tool', args: {turnId, name: toolName, arguments: invalid}});
      assert.equal(rejected.status, 'rejected', label);
    }
    assert.equal(received.length, 1, 'schema-invalid input must not reach the reader');
  } finally { await bridge.dispatch({sessionId, operation: 'close'}); }
});

test('MCP real registration and in-memory SDK transport preserve fields and reject invalid inputs before dispatch', async t => {
  const subject = 'fixture-subject', authorizationFile = path.join(product, 'never-read-scoped-input-authorization.json');
  const grant = {subject, projectId: 'fixture-project', hostId: 'generic', sessionId: 'fixture-session', epoch: 'fixture-epoch',
    activeTurnId: 'fixture-turn', state: 'active', expiresAt: Date.now() + 60000};
  const originalRead = fs.readFile;
  t.mock.method(fs, 'readFile', async (filename, ...rest) => String(filename) === authorizationFile
    ? JSON.stringify({kind: 'cmcp_mcp_read_grants', version: 1, grants: [grant], revokedTokenIds: []}) : originalRead(filename, ...rest));
  const calls = [], reader = createMcpReader({config: {projectId: grant.projectId, authorizationFile, limits: {timeoutMs: 5000, responseBytes: 1048576}},
    shared: {projectId: grant.projectId, hosts: {generic: {agentId: 'fixture-agent', workspace: product}}},
    authorization: {subject, stamp: digest(grant)}, dispatch: async request => {
      if (request.operation === 'reader-status') return {epoch: grant.epoch, activeTurnId: grant.activeTurnId, joined: true, activeTurn: true,
        owner: {hostId: grant.hostId, sessionId: grant.sessionId}};
      calls.push(clone(request)); return echo(request.args);
    }});
  const client = new Client({name: 'zero-model-scoped-input-test', version: '1'}), [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await reader.server.connect(serverTransport); await client.connect(clientTransport);
    const listed = (await client.listTools()).tools.find(tool => tool.name === toolName);
    const {$schema, ...schema} = listed.inputSchema;
    assert.deepEqual(schema, CONTINUITY_TOOL_PARAMETERS);
    const input = args(), result = await client.callTool({name: toolName, arguments: input});
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.deepEqual(result.structuredContent.received, input);
    assert.deepEqual(calls[0].args, input);
    for (const [label, mutate] of invalidCases()) {
      const invalid = args(); mutate(invalid.proposal);
      const rejected = await client.callTool({name: toolName, arguments: invalid});
      assert.equal(rejected.isError, true, label);
    }
    assert.equal(calls.length, 1);
  } finally { await client.close(); await reader.close(); }
});

test('existing 24576 UTF-8 byte ceiling is unchanged for v7 object and legacy string paths', () => {
  assert.equal(CONTINUITY_MAX_PROPOSAL_BYTES, 24576);
  assert.equal(CONTINUITY_MAX_TOOL_ELEMENTS, 24576 + 256);
  const p = {version: 7, plans: [], unknowns: [], scopedPlans: [{id: 'bytes', topic: 'bytes', scopes: [{id: 's', ref: 'r', quote: 'scope'}],
    conditions: Array.from({length: 24}, (_, i) => ({id: 'c' + i, ref: 'r', quote: i ? 'x' : '界', aspect: 'a', temporalUse: 'current', scopeIds: ['s']}))}]};
  for (const condition of p.scopedPlans[0].conditions) {
    const extra = Math.min(1024 - [...condition.quote].length, CONTINUITY_MAX_PROPOSAL_BYTES - Buffer.byteLength(JSON.stringify(p)));
    if (extra > 0) condition.quote += 'x'.repeat(extra);
  }
  assert.equal(Buffer.byteLength(JSON.stringify(p)), CONTINUITY_MAX_PROPOSAL_BYTES);
  for (const input of [{ticket: 't', proposal: p}, {ticket: 't', proposalJson: JSON.stringify(p)}]) {
    assert.equal(continuityToolSchema.safeParse(input).success, true);
    assert.deepEqual(readContinuityProposal(input), p);
  }
  const oversized = clone(p), last = oversized.scopedPlans[0].conditions.find(condition => [...condition.quote].length < 1024);
  assert.ok(last); last.quote += 'x';
  assert.equal(Buffer.byteLength(JSON.stringify(oversized)), CONTINUITY_MAX_PROPOSAL_BYTES + 1);
  for (const input of [{ticket: 't', proposal: oversized}, {ticket: 't', proposalJson: JSON.stringify(oversized)}]) {
    assert.equal(continuityToolSchema.safeParse(input).success, false);
    assert.throws(() => readContinuityProposal(input), /too_large/);
  }
});
