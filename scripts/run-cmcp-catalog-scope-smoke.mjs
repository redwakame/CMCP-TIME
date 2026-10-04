// Synthetic shared-root scope boundary regression. No model or product API calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createCmcpReactivationStores,createCmcpTemporalSourceCatalog} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {createCmcpSourceEvidence} from '../src/cmcp-guard/cmcp-source-evidence.js';
import {buildCmcpNaturalTemporalCatalog} from '../src/cmcp-guard/cmcp-natural-temporal-reading.js';
import {resolveCmcpTimeContext} from '../src/cmcp-guard/resolve-cmcp-time-context.js';

const outputRoot=path.resolve(process.env.CMCP_CATALOG_SCOPE_TEST_ROOT??path.join('logs','retrieval-improvement-20260923','catalog-scope-smoke'));
await fs.mkdir(outputRoot,{recursive:true});
const root=await fs.mkdtemp(path.join(outputRoot,'run-'));
const firstScope='synthetic-scope',secondScope='synthetic-scope-other';
const first=createCmcpReactivationStores({root,scopeId:firstScope});
const second=createCmcpReactivationStores({root,scopeId:secondScope});
const firstCatalog=createCmcpTemporalSourceCatalog({stores:first,maxEntries:8});
const secondCatalog=createCmcpTemporalSourceCatalog({stores:second,maxEntries:8});
function evidence(scopeId,body){
  return createCmcpSourceEvidence({pointer:{version:1,providerNamespace:'cmcp-local-console-v1',scopeId,
    sessionId:'same-session',itemId:'same-item',revisionId:'r1'},sourceKind:'message',sourceAuthorRole:'user',
    messageRecordedAt:'2026-09-27T09:00:00+08:00',eventOccurredAt:null,
    content:{kind:'source_excerpt',body},metadata:{availability:'partial'}});
}
const firstSource=evidence(firstScope,'Alpha River display opens after inspection.');
const secondSource=evidence(secondScope,'Beta Valley display opens after inspection.');
assert.equal((await first.history.writeEvidence(firstSource)).status,'stored');
assert.equal((await second.history.writeEvidence(secondSource)).status,'stored');
const firstEntry=(await firstCatalog.registerSource({pointer:firstSource.pointer})).entry;
const secondEntry=(await secondCatalog.registerSource({pointer:secondSource.pointer})).entry;
assert.notEqual(firstEntry.id,secondEntry.id);
const onlyFirst=await firstCatalog.list(),onlySecond=await secondCatalog.list();
assert.deepEqual(onlyFirst.map(row=>row.id),[firstEntry.id]);
assert.deepEqual(onlySecond.map(row=>row.id),[secondEntry.id]);
assert.equal(await firstCatalog.get(secondSource.pointer),null);
assert.equal(await secondCatalog.get(firstSource.pointer),null);
await assert.rejects(firstCatalog.repairHints({sourceIds:[secondEntry.id]}),/authorized_catalog_entry_missing/);
await firstCatalog.withBatch(async batch=>{
  assert.deepEqual((await batch.list()).map(row=>row.id),[firstEntry.id]);
  assert.equal((await batch.registerSource({pointer:firstSource.pointer})).status,'unchanged');
  await assert.rejects(batch.registerSource({pointer:secondSource.pointer}),/catalog_scope_mismatch/);
  assert.deepEqual((await batch.list()).map(row=>row.id),[firstEntry.id]);
});
const projected=buildCmcpNaturalTemporalCatalog({question:'What did Beta Valley say?',events:[],segments:[],
  entries:onlyFirst,timeContext:resolveCmcpTimeContext({now:'2026-09-27T10:00:00+08:00',timezone:'Asia/Taipei'}),maxBytes:6000});
assert.equal(projected.input.ordinaryHistory.registeredSources,1);
assert.ok(JSON.stringify(projected.input.ordinaryHistory).includes('Alpha River'));
assert.ok(!JSON.stringify(projected.input.ordinaryHistory).includes('Beta Valley'));
console.log(JSON.stringify({status:'PASS',cases:9,scopes:[firstScope,secondScope],
  firstVisible:onlyFirst.length,secondVisible:onlySecond.length,modelCalls:0,outputRoot:root}));
