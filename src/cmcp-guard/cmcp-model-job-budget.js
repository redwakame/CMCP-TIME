import { createLocalLoopJournal } from './cmcp-local-loop-journal.js';
import fs from 'node:fs/promises';
import path from 'node:path';
/** Explicit work-order budget, one writer; reservations count even when transport fails. */
export async function reserveModelJob({ root, phase, provider, purpose, policy = 'three-way-v1', limits }) {
  if(limits!==undefined&&policy!=='host-integration-v1')throw Error('invalid_model_job_limits');
  const ledger = createLocalLoopJournal({ root, name: 'cmcp-model-work-order-v1' });
  const rows = (await ledger.read()).filter(row => row.record.kind === 'started').map(row => row.record.value);
  if(!['three-way-v1','compound-close-v1','compound-source-v1','history-reactivation-v1','incremental-catalog-v1','host-context-v1','host-integration-v1'].includes(policy)||rows.some(row=>(row.policy??'three-way-v1')!==policy)) throw Error('model_job_policy_mismatch');
  if(policy==='host-context-v1'||policy==='host-integration-v1'){
    const ceiling=policy==='host-integration-v1'?{codex:3,deepseek:4}:{codex:1,deepseek:5};
    if(limits!==undefined&&(policy!=='host-integration-v1'||!limits||Object.keys(limits).length!==2
      ||!['codex','deepseek'].every(k=>Number.isSafeInteger(limits[k])&&limits[k]>0&&limits[k]<=ceiling[k])))throw Error('invalid_model_job_limits');
    const effective=limits??ceiling;
    if(rows.some(row=>['codex','deepseek'].some(k=>(row.limits??ceiling)[k]!==effective[k])))throw Error('model_job_limits_mismatch');
    if(!['context','comparison','expression','native'].includes(phase)||!['deepseek','codex'].includes(provider)
      ||(phase==='native')!==(provider==='codex'))throw Error('invalid_model_job');
    if(rows.filter(row=>row.provider===provider).length>=effective[provider])throw Error('work_order_budget_exhausted');
  }else if(['history-reactivation-v1','incremental-catalog-v1'].includes(policy)){
    if(!['main','recall'].includes(phase)||!['groq','deepseek'].includes(provider))throw Error('invalid_model_job');
    if(rows.length>=10)throw Error('work_order_budget_exhausted');
  }else if(policy==='compound-source-v1'){
    if(!['main','diagnostic'].includes(phase)||!['groq','deepseek'].includes(provider))throw Error('invalid_model_job');
    if(rows.length>=8||phase==='diagnostic'&&rows.filter(row=>row.phase==='diagnostic').length>=2)throw Error('work_order_budget_exhausted');
  }else if(policy==='compound-close-v1'){
    if(!['main','point','native'].includes(phase)||!['groq','deepseek','codex'].includes(provider)
      ||phase==='point'&&provider!=='deepseek'||phase==='native'&&provider!=='codex'||phase==='main'&&provider==='codex')throw Error('invalid_model_job');
    if(rows.length>=9 || phase==='main'&&rows.filter(row=>row.phase==='main').length>=7
      ||phase!=='main'&&rows.some(row=>row.phase===phase)
      ||phase!=='native'&&rows.filter(row=>row.provider!=='codex').length>=8)throw Error('work_order_budget_exhausted');
  }else{
    if (!['diagnostic', 'main'].includes(phase) || !['groq', 'deepseek', 'codex'].includes(provider)) throw Error('invalid_model_job');
    if (rows.length >= 10 || phase === 'main' && rows.filter(row => row.phase === 'main').length >= 7
      || phase === 'diagnostic' && rows.some(row => row.phase === phase && row.provider === provider)) throw Error('work_order_budget_exhausted');
  }
  const reservation = { number: rows.length + 1, policy, ...(limits?{limits:{codex:limits.codex,deepseek:limits.deepseek}}:{}),phase, provider, purpose, startedAt: new Date().toISOString(), pid: process.pid };
  await ledger.append('started', reservation); return reservation;
}

// Normal operation uses one immutable authorization stream, independent of process/session
// and code versions. Existing experimental profiles above retain their frozen semantics.
const RUNTIME_BUDGET_POLICY = 'runtime-authorization-v1';
const RUNTIME_PROVIDERS = ['deepseek', 'codex'];
const sameLimits = (a, b) => RUNTIME_PROVIDERS.every(provider => a[provider] === b[provider]);
function runtimeString(value, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || value.includes('\0')) throw Error(code);
  return value;
}
function runtimeLocation(root, binding) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) throw Error('invalid_runtime_budget_root');
  if (typeof binding !== 'string' || !/^[a-f0-9]{64}$/.test(binding)) throw Error('invalid_runtime_budget_binding');
  return path.resolve(root);
}
function runtimeLimits(limits) {
  if (!limits || Array.isArray(limits) || Object.keys(limits).length !== 2
    || !RUNTIME_PROVIDERS.every(provider => Number.isSafeInteger(limits[provider]) && limits[provider] >= 0)
    || !RUNTIME_PROVIDERS.some(provider => limits[provider] > 0)) throw Error('invalid_runtime_budget_limits');
  return { deepseek: limits.deepseek, codex: limits.codex };
}
function runtimeLedger(root) {
  return createLocalLoopJournal({ root, name: 'cmcp-model-work-order-v1' });
}
async function runtimeSnapshot(root, binding) {
  const rows = await runtimeLedger(root).read(), grants = new Map();
  let active = null, number = 0, used = { deepseek: 0, codex: 0 };
  for (const row of rows) {
    const {kind, value} = row.record;
    if (!value || value.policy !== RUNTIME_BUDGET_POLICY) throw Error('runtime_budget_policy_mismatch');
    if (value.binding !== binding) throw Error('runtime_budget_binding_mismatch');
    if (kind === 'authorization') {
      runtimeString(value.authorizationId, 'runtime_budget_record_invalid');
      runtimeString(value.authorizedBy, 'runtime_budget_record_invalid');
      runtimeLimits(value.limits);
      if (value.version !== 1 || grants.has(value.authorizationId)) throw Error('runtime_budget_record_invalid');
      grants.set(value.authorizationId, value); active = value; used = { deepseek: 0, codex: 0 };
    } else if (kind === 'started') {
      if (!active || value.authorizationId !== active.authorizationId || !RUNTIME_PROVIDERS.includes(value.provider)
        || value.number !== number + 1 || !value.limits || !sameLimits(value.limits, active.limits)) throw Error('runtime_budget_record_invalid');
      runtimeString(value.purpose, 'runtime_budget_record_invalid');
      runtimeString(value.sessionId, 'runtime_budget_record_invalid');
      number++; used[value.provider]++;
      if (used[value.provider] > active.limits[value.provider]) throw Error('runtime_budget_record_invalid');
    } else throw Error('runtime_budget_record_invalid');
  }
  const remaining = Object.fromEntries(RUNTIME_PROVIDERS.map(provider => [provider, active ? active.limits[provider] - used[provider] : 0]));
  const canCall = Object.fromEntries(RUNTIME_PROVIDERS.map(provider => [provider, remaining[provider] > 0]));
  const anyAvailable = Object.values(canCall).some(Boolean);
  const status = { status: !active ? 'blocked' : anyAvailable ? 'ready' : 'exhausted', binding,
    authorization: active, authorizationId: active?.authorizationId ?? null, used, remaining, canCall,
    reason: !active ? 'runtime_authorization_required' : anyAvailable ? null : 'runtime_budget_exhausted' };
  return { status, grants, number };
}
async function withRuntimeBudgetWriter(root, action) {
  await fs.mkdir(root, { recursive: true });
  const lockFile = path.join(root, '.runtime-budget-writer.lock');
  let lock;
  try { lock = await fs.open(lockFile, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw Error('runtime_budget_writer_busy'); throw error; }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await lock.sync();
    return await action();
  } finally {
    try { await lock.close(); } finally { await fs.unlink(lockFile); }
  }
}

/** Explicit grant operation. Replaying an old ID never makes it active again. */
export async function authorizeRuntimeBudget({ root, authorizationId, binding, limits, authorizedBy }) {
  root = runtimeLocation(root, binding);
  runtimeString(authorizationId, 'invalid_runtime_authorization_id');
  runtimeString(authorizedBy, 'explicit_runtime_authorizer_required');
  limits = runtimeLimits(limits);
  return withRuntimeBudgetWriter(root, async () => {
    const snapshot = await runtimeSnapshot(root, binding), previous = snapshot.grants.get(authorizationId);
    if (previous) {
      if (!sameLimits(previous.limits, limits) || previous.authorizedBy !== authorizedBy) throw Error('runtime_authorization_conflict');
      return { status: 'unchanged', budget: snapshot.status };
    }
    await runtimeLedger(root).append('authorization', { version: 1, policy: RUNTIME_BUDGET_POLICY,
      authorizationId, binding, limits, authorizedBy, authorizedAt: new Date().toISOString(), pid: process.pid });
    return { status: 'authorized', budget: (await runtimeSnapshot(root, binding)).status };
  });
}

/** Read-only even when root is absent. No credential or model access. */
export async function readRuntimeBudget({ root, binding }) {
  root = runtimeLocation(root, binding);
  return (await runtimeSnapshot(root, binding)).status;
}

/** Durable reservation before model work. Failures consume the same grant across all entrances. */
export async function reserveRuntimeJob({ root, binding, provider, purpose, sessionId, expectedAuthorizationId }) {
  root = runtimeLocation(root, binding);
  if (!RUNTIME_PROVIDERS.includes(provider)) throw Error('invalid_runtime_budget_provider');
  runtimeString(purpose, 'invalid_runtime_budget_purpose');
  runtimeString(sessionId, 'explicit_runtime_session_required');
  if(expectedAuthorizationId!==undefined)runtimeString(expectedAuthorizationId,'invalid_runtime_authorization_id');
  // Missing authorization does not even create a budget directory/lock.
  if (!(await runtimeSnapshot(root, binding)).status.authorization) throw Error('runtime_authorization_required');
  return withRuntimeBudgetWriter(root, async () => {
    const snapshot = await runtimeSnapshot(root, binding), grant = snapshot.status.authorization;
    if (!grant) throw Error('runtime_authorization_required');
    if(expectedAuthorizationId!==undefined&&grant.authorizationId!==expectedAuthorizationId)throw Error('runtime_expected_authorization_changed');
    if (!snapshot.status.canCall[provider]) throw Error('runtime_budget_exhausted');
    const reservation = { number: snapshot.number + 1, policy: RUNTIME_BUDGET_POLICY,
      authorizationId: grant.authorizationId, binding, limits: { ...grant.limits }, provider, purpose, sessionId,
      startedAt: new Date().toISOString(), pid: process.pid };
    await runtimeLedger(root).append('started', reservation);
    return reservation;
  });
}

