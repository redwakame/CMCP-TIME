import fs from 'node:fs/promises';
import path from 'node:path';
import {createLocalLoopJournal} from './cmcp-local-loop-journal.js';
const tails=new Map();

export function normalizeCmcpSourceCatalogConfig(input){
  if(input===undefined)return Object.freeze({maxSegments:1});
  if(!input||Object.keys(input).length!==1||!Number.isSafeInteger(input.maxSegments)||input.maxSegments<1||input.maxSegments>1024)throw Error('invalid_source_catalog_configuration');
  return Object.freeze({maxSegments:input.maxSegments});
}

/** Append-only derivative segments over the existing publisher. Segment zero is
 * the unchanged legacy journal. Segment count is a resource budget, not a
 * History retention rule, a query candidate count, or a model input limit. */
export function createCmcpSourceIndexSegments({root,name,maxEntries,maxSegments=1}){
  normalizeCmcpSourceCatalogConfig({maxSegments});
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||!Number.isSafeInteger(maxEntries*maxSegments))throw Error('invalid_source_segment_capacity');
  const directory=path.join(root,'segments'),journals=new Map();
  const queueKey=path.resolve(root)+'\0'+name;
  const journal=index=>{if(!journals.has(index))journals.set(index,createLocalLoopJournal({root:index===0?root:path.join(directory,String(index).padStart(6,'0')),name}));return journals.get(index);};
  async function indices(){let names=[];try{names=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
    const result=[0];for(const item of names){if(!/^\d{6}$/.test(item.name)||!item.isDirectory()||item.isSymbolicLink())throw Error('source_segment_directory_invalid');
      const index=Number(item.name);if(index<1||index>1023)throw Error('source_segment_directory_invalid');result.push(index);}
    return result.sort((a,b)=>a-b);}
  async function snapshot(){const segments=[],owners=new Map(),rows=[];
    for(const index of await indices()){const store=journal(index),records=await (store.readIncremental?.()??store.read()),ids=new Set();
      for(const row of records){const id=row.record.value?.id;if(typeof id!=='string')throw Error('source_segment_identity_invalid');
        if(owners.has(id)&&owners.get(id)!==index)throw Error('source_segment_duplicate_identity');owners.set(id,index);ids.add(id);rows.push(row);}
      segments.push({index,sources:ids.size});}
    return {segments,owners,rows};}
  async function append(kind,value){const state=await snapshot();let index=state.owners.get(value.id);
      if(index===undefined){if(state.segments.some(segment=>segment.index>=maxSegments||segment.sources>maxEntries))throw Error('catalog_configuration_below_existing');
        index=state.segments.find(segment=>segment.index<maxSegments&&segment.sources<maxEntries)?.index;
        if(index===undefined){const existing=new Set(state.segments.map(segment=>segment.index));for(let next=1;next<maxSegments;next++)if(!existing.has(next)){index=next;break;}}
        if(index===undefined)throw Error('catalog_capacity_exceeded');}
      return journal(index).append(kind,value);}
  return Object.freeze({
    async read(){return (await snapshot()).rows;},
    append(kind,value){const copied=structuredClone(value),run=(tails.get(queueKey)??Promise.resolve()).then(()=>append(kind,copied)),settled=run.catch(()=>{});
      tails.set(queueKey,settled);settled.then(()=>{if(tails.get(queueKey)===settled)tails.delete(queueKey);});return run;},
    async status(){const state=await snapshot();return {mode:maxSegments>1?'segmented':'legacy_single_segment',segmentSources:maxEntries,maxSegments,
      maxRegisteredSources:maxEntries*maxSegments,registeredSources:state.owners.size,segments:state.segments,
      configurationBelowExisting:state.segments.some(segment=>segment.index>=maxSegments||segment.sources>maxEntries),
      remainingRegistrationSlots:state.segments.some(segment=>segment.index>=maxSegments||segment.sources>maxEntries)?0:Math.max(0,maxEntries*maxSegments-state.owners.size),
      historyRetention:'independent',queryBudgets:'unchanged',derivative:true};}
  });
}
