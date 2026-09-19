import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { createCmcpFileHistoryBackend } from "./cmcp-file-history-backend.js";

export const loopHash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const journalTails = new Map();
// Process-local acceleration of the existing immutable publisher, never durable
// authority. A new process performs a complete chain verification. Every reuse
// checks the current key set and file identity/size/write metadata; changed rows
// are read and hashed again. History evidence is still resolved independently.
const journalSnapshots = new Map(), snapshotTails = new Map();
const maxCachedJournals = 24, maxCachedBytes = 64 * 1024 * 1024;
const signature = stat => [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join(':');
async function limitedMap(values, action) {
  const output = new Array(values.length); let next = 0;
  await Promise.all(Array.from({length:Math.min(24,values.length)},async()=>{
    while(next<values.length){const index=next++;output[index]=await action(values[index]);}
  }));return output;
}
function cacheSnapshot(key, snapshot) {
  journalSnapshots.delete(key);
  if(snapshot.bytes<=maxCachedBytes)journalSnapshots.set(key,snapshot);
  while(journalSnapshots.size>maxCachedJournals
    ||[...journalSnapshots.values()].reduce((total,item)=>total+item.bytes,0)>maxCachedBytes)
    journalSnapshots.delete(journalSnapshots.keys().next().value);
}
/** Single-writer journal over the existing no-replace publisher, not a second History store. */
export function createLocalLoopJournal({ root, name }) {
  const backend = createCmcpFileHistoryBackend({ root });
  const queueKey = path.resolve(root) + '\0' + name;
  const keyFor = sequence => loopHash([name, sequence]);
  function checkedRow(key, text) {
      const row = JSON.parse(text);
      if (!row || Object.keys(row).length !== 2 || row.sha256 !== loopHash(row.record)
        || row.record.name !== name || !Number.isSafeInteger(row.record.sequence) || row.record.sequence < 0
        || key !== keyFor(row.record.sequence)) throw Error("loop_journal_invalid");
      return row;
  }
  function checkedChain(rows) {
    rows.sort((a, b) => a.record.sequence - b.record.sequence);
    rows.forEach((row, index) => {
      if (row.record.sequence !== index || row.record.previous !== (rows[index - 1]?.sha256 ?? null)) throw Error("loop_journal_chain_invalid");
    });
    return rows;
  }
  // Explicit full read retains the prior integrity-check semantics.
  async function read() {
    return checkedChain(await limitedMap(await backend.listKeys(),async key=>checkedRow(key,await backend.read(key))));
  }
  async function refreshSnapshot() {
    const keys=await backend.listKeys(),keySet=new Set(keys),prior=journalSnapshots.get(queueKey),items=new Map();
    if(prior&&[...prior.items.keys()].some(key=>!keySet.has(key))){
      throw Error('loop_journal_rows_removed');
    }
    const rows=await limitedMap(keys,async key=>{
      const file=path.join(path.resolve(root),key+'.json'),before=await fs.stat(file,{bigint:true});
      if(!before.isFile())throw Error('loop_journal_invalid');
      const fingerprint=signature(before),old=prior?.items.get(key);
      if(old?.fingerprint===fingerprint){items.set(key,old);return old.row;}
      const row=checkedRow(key,await backend.read(key)),after=await fs.stat(file,{bigint:true});
      if(signature(after)!==fingerprint)throw Error('loop_journal_changed_during_read');
      // A previously observed immutable record may not be replaced by a different
      // valid-looking chain. Legitimate new rows are appended with no replacement.
      if(old&&old.row.sha256!==row.sha256)throw Error('loop_journal_record_replaced');
      items.set(key,{fingerprint,row,bytes:Number(after.size)});return row;
    });
    checkedChain(rows);cacheSnapshot(queueKey,{items,rows,bytes:[...items.values()].reduce((sum,item)=>sum+item.bytes,0)});
    return structuredClone(rows);
  }
  function readIncremental() {
    const operation=(snapshotTails.get(queueKey)??Promise.resolve()).then(refreshSnapshot);
    const settled=operation.catch(()=>{});snapshotTails.set(queueKey,settled);
    settled.then(()=>{if(snapshotTails.get(queueKey)===settled)snapshotTails.delete(queueKey);});
    return operation;
  }
  async function append(kind, value) {
    const rows = await readIncremental();
    const record = { name, sequence: rows.length, previous: rows.at(-1)?.sha256 ?? null, kind, value };
    const serialized = JSON.stringify({ record, sha256: loopHash(record) });
    const key = keyFor(rows.length), result = await backend.create(key, serialized);
    if (result.status !== "created" || result.temporaryFileRetained || await backend.read(key) !== serialized) {
      throw Error("loop_journal_publication_failed");
    }
    return record;
  }
  return Object.freeze({ read, readIncremental, append(kind, value) {
    const snapshot = JSON.parse(JSON.stringify(value));
    const operation = (journalTails.get(queueKey) ?? Promise.resolve()).then(() => append(kind, snapshot));
    const settled = operation.catch(() => {});
    journalTails.set(queueKey, settled);
    settled.then(() => { if (journalTails.get(queueKey) === settled) journalTails.delete(queueKey); });
    return operation;
  } });
}
