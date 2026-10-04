// 資料管理只使用明示的單一 scope；備份資料不授予模型、宿主或派送權限。
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createCmcpReactivationStores,createCmcpTemporalSourceCatalog} from './cmcp-history-reactivation.js';
import {createLocalLoopJournal,loopHash} from './cmcp-local-loop-journal.js';
import {createCmcpSourceIndexSegments} from './cmcp-source-index-segments.js';
import {createCmcpSourceEvidence} from './cmcp-source-evidence.js';
import {cmcpSourcePointerKey} from './cmcp-source-pointer.js';
import {normalizeCmcpRuntimeConfig,createCmcpRuntimeSession} from './cmcp-runtime-session.js';
import {createCmcpFeatureControls} from './cmcp-feature-controls.js';
import {createCmcpLocalCandidates} from './cmcp-local-candidates.js';
import {createCmcpMediaOriginals,validateCmcpImageBytes} from '../../adapters/deepseek-harness/media-originals.mjs';

export const DATA_BACKUP_VERSION=1;
export const cmcpDataShellQuote=(value,platform=process.platform)=>"'"+String(value).replaceAll("'",platform==='win32'?"''":"'\"'\"'")+"'";
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const fail=code=>{throw Object.assign(Error(code),{code});};
const clone=structuredClone;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const MAX_FILES=20000,MAX_BYTES=256*1024*1024,MAX_JSON=32*1024*1024;
const INPUT_KINDS=new Set(['binding','source_time_card','source_association','assistant_reply_binding','host_reply_binding',
 'raw_source_ingest','registration_pending','annotation_pending',
 'shared_project_source_intent','shared_project_source_binding','discussion_segment_registered','discussion_segment_extended',
 'auto_discussion_result','assistant_discussion_result','buffer_clear','buffer_retention','feature_controls','feature_control_epoch',
 'pin_update','focus_selection','dispatch_reserved','dispatch_presentation_started','dispatch_result','restored_data']);
const FOCUS_KINDS=new Set(['binding','state','reactivation_state','assistant_timing','dialogue_control','dialogue_control_correction']);
const SAFE_CONFIG_KEYS=['kind','version','runtimeId','input','receiptRoot','controls','sourceAuthorization','providerMode','recallLimits',
 'localRetrieval','sourceCatalog','bufferRetention','discussionAssociation','answerHistory','naturalReading','responsePreferences','eventContext'];
const DENY_CONTROLS={enabled:false,clean:true,saveUser:false,saveAssistant:false,proactive:false,pins:false};

export async function assertBackupPath(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))fail('backup_absolute_path_required');
 for(let item=path.resolve(file);;item=path.dirname(item)){
  const stat=await fs.lstat(item).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  if(stat?.isSymbolicLink()||stat?.isFile()&&stat.nlink!==1)fail('backup_path_alias_denied');
  if(item===path.dirname(item))break;
 }
 return path.resolve(file);
}
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);};
function memberPath(value){
 if(typeof value!=='string'||!value||value.includes('\\')||value.startsWith('/')||value.includes(':')||value.split('/').some(x=>!x||x==='.'||x==='..'||/[. ]$/.test(x))
  ||/[\x00-\x1f\x7f]/.test(value))fail('backup_member_path_invalid');return value;
}
async function readStable(file,max=MAX_JSON){
 await assertBackupPath(file);const before=await fs.lstat(file);if(!before.isFile()||before.size>max)fail('backup_file_capacity_or_type');
 const bytes=await fs.readFile(file),after=await fs.lstat(file);await assertBackupPath(file);
 if(['dev','ino','size','mtimeMs','ctimeMs','nlink'].some(k=>before[k]!==after[k])||bytes.length!==before.size)fail('backup_source_changed');return bytes;
}
async function newDirectory(directory){await assertBackupPath(directory);await fs.mkdir(directory);await assertBackupPath(directory);}
async function writeExclusive(file,bytes,checkpoint=async()=>{}){
 await assertBackupPath(file);await fs.mkdir(path.dirname(file),{recursive:true});await assertBackupPath(file);
 await checkpoint({phase:'write',path:file,bytes:bytes.length});const handle=await fs.open(file,'wx',0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 if(!(await readStable(file,Math.max(MAX_JSON,bytes.length))).equals(bytes))fail('backup_write_readback_failed');
}
async function filesIn(directory,prefix=''){
 await assertBackupPath(directory);let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
 const result=[];for(const entry of entries){const rel=prefix+entry.name,full=path.join(directory,entry.name);await assertBackupPath(full);
  if(entry.isDirectory())result.push(...await filesIn(full,rel+'/'));else if(entry.isFile())result.push(rel);else fail('backup_file_type_invalid');
  if(result.length>MAX_FILES)fail('backup_capacity_exceeded');}return result.sort();
}
async function acquireLease(root){
 await assertBackupPath(root);const stat=await fs.stat(root);if(!stat.isDirectory())fail('backup_data_root_invalid');
 const file=path.join(root,'.common-input-writer.lock');let handle;
 try{handle=await fs.open(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')fail('backup_writer_active_or_unreleased');throw e;}
 const bytes=Buffer.from(String(process.pid));await handle.writeFile(bytes);await handle.sync();const identity=await handle.stat();
 return async()=>{const current=await fs.lstat(file);if(current.ino!==identity.ino||current.dev!==identity.dev||!(await fs.readFile(file)).equals(bytes)){
  await handle.close();fail('backup_writer_lease_changed');}await handle.close();await fs.unlink(file);};
}
function authorized(request,purpose,scopeId){
 if(!request||request.kind!=='cmcp_current_user_data_action'||request.purpose!==purpose||request.scopeId!==scopeId||request.confirmed!==true)fail('backup_current_user_authorization_required');
}
async function sourceConfig({config,repoRoot,scopeId}){
 await assertBackupPath(repoRoot);const normalized=normalizeCmcpRuntimeConfig(config,{repoRoot});
 if(normalized.config.input.scopeId!==scopeId)fail('backup_scope_mismatch');await assertBackupPath(normalized.config.input.root);return normalized;
}
function template(raw){const safe=Object.fromEntries(SAFE_CONFIG_KEYS.filter(k=>raw[k]!==undefined).map(k=>[k,clone(raw[k])]));
 safe.input=Object.fromEntries(['root','scopeId','events','timezone','limits','storageCapacity','loopTiming'].filter(k=>raw.input[k]!==undefined).map(k=>[k,clone(raw.input[k])]));
 safe.input.root='data';safe.receiptRoot='receipts';safe.providerMode='host';safe.controls={...safe.controls,...DENY_CONTROLS};
 safe.sourceAuthorization={saveUser:false,saveAssistant:false};return safe;
}
function scoped(value,scopeId){if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const item of value)scoped(item,scopeId);return;}
 if(typeof value.scopeId==='string'&&value.scopeId!==scopeId)fail('backup_nested_scope_mismatch');
 for(const item of Object.values(value))scoped(item,scopeId);
}
function sanitizeRecord(record){const value=clone(record.value);
 if(record.kind==='pin_update')value.authorization={status:'historical_only',executionAuthorization:false};
 return {kind:record.kind,value};
}
function parentOf(source){return {sourcePointer:source.pointer,evidenceHash:loopHash(source),sourceAuthorRole:source.sourceAuthorRole,
 sessionId:source.pointer.sessionId,scopeId:source.pointer.scopeId,messageRecordedAt:source.messageRecordedAt,textHash:loopHash(source.content.body)};}
async function snapshot(options){
 const {config}=await sourceConfig(options),root=config.input.root,scopeId=config.input.scopeId;
 for(const relative of ['history','input-journal','source-index','event','focus','event-focus','media-originals'])await filesIn(path.join(root,relative));
 const journal=createLocalLoopJournal({root:path.join(root,'input-journal'),name:'cmcp-common-input-v1'}),rows=await journal.read();
 if(rows[0]?.record.kind!=='binding'||rows[0].record.value.scopeId!==scopeId)fail('backup_binding_invalid');
 const stateRows=rows.map(x=>x.record).filter(r=>INPUT_KINDS.has(r.kind)).map(sanitizeRecord);scoped(stateRows,scopeId);
 const stores=createCmcpReactivationStores({root,scopeId}),inventory=await stores.history.listPointers({scopeId,maxRecords:MAX_FILES});
 if(inventory.status!=='complete')fail('backup_history_inventory_'+inventory.status);
 const sources=[];for(const pointer of inventory.pointers){const result=await stores.history.resolve(pointer);if(result.status!=='found')fail('backup_original_'+result.status);sources.push(result.evidence);}
 const catalog=createCmcpSourceIndexSegments({root:path.join(root,'source-index'),name:'cmcp-temporal-source-index-v1',maxEntries:config.input.storageCapacity?.maxSources??config.input.limits.maxEntries,maxSegments:config.sourceCatalog?.maxSegments??1});
 const catalogRows=(await catalog.read()).map(row=>({kind:row.record.kind,value:row.record.value}));scoped(catalogRows,scopeId);
 const journals=[{path:'input-journal',name:'cmcp-common-input-v1',records:stateRows},{path:'source-index',name:'cmcp-temporal-source-index-v1',records:catalogRows}];
 for(const relative of ['focus',...config.input.events.map(event=>'event-focus/'+loopHash({scopeId,eventId:event.eventId})+'/focus')]){
  const records=(await createLocalLoopJournal({root:path.join(root,relative),name:'local-focus-v1'}).read()).map(x=>x.record).filter(r=>FOCUS_KINDS.has(r.kind)).map(sanitizeRecord);
  scoped(records,scopeId);if(records.length)journals.push({path:relative,name:'local-focus-v1',records});
 }
 const events=[];for(const item of config.input.events){const event={scopeId,eventId:item.eventId},read=await stores.eventStore(event).readEvent();
  if(!['found','missing'].includes(read.status))fail('backup_event_unavailable');if(read.status==='found')events.push({event,records:read.internal.records});}
 const controls=await createCmcpFeatureControls({root,scopeId,defaults:{...config.controls,saveUser:config.sourceAuthorization.saveUser,saveAssistant:config.sourceAuthorization.saveAssistant}}).snapshot();
 const mediaStore=createCmcpMediaOriginals({dataRoot:root,scopeId});
 const stamp=loopHash(rows),guard=async()=>({allowed:true,stamp});const media=await mediaStore.backupSnapshot({onGuard:guard,dataAuthorization:{kind:'cmcp_current_user_data_action',purpose:'export',scopeId,confirmed:true}});
 const sourceKeys=new Map(sources.map(source=>[cmcpSourcePointerKey(source.pointer),source]));
 for(const item of media){const source=sourceKeys.get(cmcpSourcePointerKey(item.record.parent.sourcePointer));if(!source||!same(parentOf(source),item.record.parent))fail('backup_media_parent_mismatch');}
 const authorityHistory=rows.filter(x=>x.record.kind==='source_authorization').map(x=>clone(x.record.value));scoped(authorityHistory,scopeId);
 const hostLinks=options.readHostLinks?await options.readHostLinks():[];scoped(hostLinks,scopeId);
 return {config,scopeId,sources,journals,events,media,controls,authorityHistory,hostLinks,snapshotVersion:{inputJournal:stamp,journals:loopHash(journals),catalog:loopHash(catalogRows),sources:loopHash(sources),media:loopHash(media.map(({content,...meta})=>meta)),events:loopHash(events),hostLinks:loopHash(hostLinks)}};
}

export async function inspectCmcpData(options){
 const {config}=await sourceConfig(options);authorized(options.authorization,'inspect',options.scopeId);const release=await acquireLease(config.input.root);
 try{const value=await snapshot(options);return {kind:'cmcp_data_inspection',version:1,scopeId:value.scopeId,sources:value.sources.length,
  media:value.media.length,originalBytes:value.sources.reduce((n,s)=>n+Buffer.byteLength(s.content.body),0)+value.media.reduce((n,m)=>n+m.record.bytes,0),
  controls:value.controls,snapshotVersion:value.snapshotVersion,status:'verified',modelCalls:0};}finally{await release();}
}
export async function exportCmcpData(options){
 const {config}=await sourceConfig(options);authorized(options.authorization,'export',options.scopeId);const output=await assertBackupPath(options.output);
 if(inside(config.input.root,output)||inside(output,config.input.root)||output===config.input.root)fail('backup_source_destination_overlap');
 const release=await acquireLease(config.input.root);let made=false;
 try{const value=await snapshot(options);await newDirectory(output);made=true;const entries=[],checkpoint=options.checkpoint??(async()=>{});
  async function add(relative,bytes,kind){memberPath(relative);const existing=entries.find(x=>x.path===relative);if(existing){if(existing.sha256!==sha(bytes))fail('backup_member_conflict');return;}
   if(entries.reduce((n,x)=>n+x.bytes,0)+bytes.length>MAX_BYTES)fail('backup_capacity_exceeded');
   await writeExclusive(path.join(output,relative),bytes,checkpoint);entries.push({path:relative,bytes:bytes.length,sha256:sha(bytes),kind});}
  await add('data.json',json({kind:'cmcp_data_snapshot',version:1,scopeId:value.scopeId,config:template(options.config),sources:value.sources,journals:value.journals,events:value.events,
   controlsAtBackup:value.controls,authorityHistoryAtBackup:value.authorityHistory,hostLinks:value.hostLinks,media:value.media.map(({content,...rest})=>rest),snapshotVersion:value.snapshotVersion}),'originals_and_durable_state');
  for(const item of value.media)if(item.content)await add('media/'+item.record.sha256+(item.record.mimeType==='image/png'?'.png':'.jpg'),item.content,'media_original');
  const after=await snapshot(options);if(JSON.stringify(value.snapshotVersion)!==JSON.stringify(after.snapshotVersion))fail('backup_source_changed');
  const manifest={kind:'cmcp_user_data_backup',version:1,scopeId:value.scopeId,createdAt:new Date().toISOString(),snapshotStrategy:'exclusive_common_input_writer_lease_and_before_after_formal_snapshot',
   snapshotVersion:value.snapshotVersion,entries,exclusions:['credentials','controller_capabilities','runtime_work_and_reading_tickets','writer_locks','active_session_authorizations','provider_grants','provider_wire','host_private_sessions'],
   projections:{sourceCatalog:'retained_verified_projection',lexicalIndex:'rebuilt_from_originals_when_configured'},hostPinDestinations:options.readHostLinks?'historical_only_no_host_authorization':'not_configured_no_host_trace_read',restorePolicy:'new_empty_target_no_execution_authority',totalBytes:entries.reduce((n,e)=>n+e.bytes,0)};
  manifest.indexSha256=loopHash(manifest.entries);await addManifest(output,manifest,checkpoint);await verifyCmcpBackup({backup:output,scopeId:value.scopeId});
  return {kind:'cmcp_data_export',status:'complete',output,scopeId:value.scopeId,sources:value.sources.length,media:value.media.length,manifestSha256:sha(json(manifest)),modelCalls:0};
 }catch(error){if(made)await fs.writeFile(path.join(output,'FAILED.json'),json({status:'incomplete',code:error.code??error.message,at:new Date().toISOString()}),{flag:'wx'}).catch(()=>{});throw error;}finally{await release();}
}
const addManifest=(root,value,checkpoint)=>writeExclusive(path.join(root,'MANIFEST.json'),json(value),checkpoint);

export async function verifyCmcpBackup({backup,scopeId}){
 backup=await assertBackupPath(backup);const manifest=JSON.parse((await readStable(path.join(backup,'MANIFEST.json'))).toString('utf8'));
 if(manifest.kind!=='cmcp_user_data_backup'||manifest.version!==1||manifest.scopeId!==scopeId||!Array.isArray(manifest.entries)||manifest.entries.length<1||manifest.entries.length>MAX_FILES
  ||manifest.indexSha256!==loopHash(manifest.entries))fail('backup_manifest_invalid_or_scope_mismatch');
 const names=new Set(),caseNames=new Set();let total=0;for(const entry of manifest.entries){memberPath(entry.path);if(entry.path!=='data.json'&&!/^media\/[a-f0-9]{64}\.(png|jpg)$/.test(entry.path))fail('backup_member_kind_invalid');if(names.has(entry.path)||caseNames.has(entry.path.toLocaleLowerCase('en-US')))fail('backup_duplicate_member');
  names.add(entry.path);caseNames.add(entry.path.toLowerCase());if(!Number.isSafeInteger(entry.bytes)||entry.bytes<0||total+entry.bytes>MAX_BYTES)fail('backup_capacity_exceeded');total+=entry.bytes;
  const bytes=await readStable(path.join(backup,entry.path),Math.max(MAX_JSON,entry.bytes));if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)fail('backup_member_hash_mismatch');}
 if(total!==manifest.totalBytes)fail('backup_total_bytes_mismatch');const actual=await filesIn(backup);
 if(actual.length!==names.size+1||actual.some(name=>name!=='MANIFEST.json'&&!names.has(name)))fail('backup_unindexed_or_incomplete_member');
 const data=JSON.parse((await readStable(path.join(backup,'data.json'))).toString('utf8'));
 if(data.kind!=='cmcp_data_snapshot'||data.version!==1||data.scopeId!==scopeId||data.config?.input?.scopeId!==scopeId)fail('backup_data_scope_mismatch');scoped(data,scopeId);
 if(!same(data.config,template(data.config)))fail('backup_configuration_not_portable_or_authority_active');normalizeCmcpRuntimeConfig(data.config,{repoRoot:backup});
 if(!Array.isArray(data.sources)||!Array.isArray(data.journals)||!Array.isArray(data.events)||!Array.isArray(data.media))fail('backup_data_schema_invalid');
 const pointers=new Map();for(const raw of data.sources){const source=createCmcpSourceEvidence(raw),key=cmcpSourcePointerKey(source.pointer);
  if(pointers.has(key))fail('backup_source_version_conflict');pointers.set(key,source);}
 const allowedJournal=p=>p==='input-journal'||p==='source-index'||p==='focus'||/^event-focus\/[a-f0-9]{64}\/focus$/.test(p);
 const paths=new Set();for(const journal of data.journals){memberPath(journal.path);if(!allowedJournal(journal.path)||paths.has(journal.path)||!Array.isArray(journal.records))fail('backup_journal_invalid');paths.add(journal.path);
  const expected=journal.path==='input-journal'?'cmcp-common-input-v1':journal.path==='source-index'?'cmcp-temporal-source-index-v1':'local-focus-v1';if(journal.name!==expected)fail('backup_journal_invalid');
  for(const record of journal.records){if(journal.path==='input-journal'&&!INPUT_KINDS.has(record.kind)||journal.path==='source-index'&&!['source','locator','annotation'].includes(record.kind)
   ||!['input-journal','source-index'].includes(journal.path)&&!FOCUS_KINDS.has(record.kind))fail('backup_journal_kind_invalid');}
  if(journal.records.some(record=>record.kind==='pin_update'&&!same(record.value.authorization,{status:'historical_only',executionAuthorization:false})))fail('backup_pin_execution_authority_invalid');
 }
 if(!paths.has('input-journal')||data.journals.find(x=>x.path==='input-journal').records[0]?.kind!=='binding')fail('backup_binding_invalid');
 for(const entry of data.journals.find(x=>x.path==='source-index')?.records??[]){const source=pointers.get(cmcpSourcePointerKey(entry.value.pointer));if(!source||loopHash(source)!==entry.value.evidenceHash)fail('backup_catalog_source_conflict');}
 const mediaIds=new Set();for(const item of data.media){const record=item.record;if(mediaIds.has(record.mediaId))fail('backup_duplicate_media');mediaIds.add(record.mediaId);
  const source=pointers.get(cmcpSourcePointerKey(record.parent.sourcePointer));if(!source||!same(parentOf(source),record.parent))fail('backup_media_parent_mismatch');
  const file='media/'+record.sha256+(record.mimeType==='image/png'?'.png':'.jpg');if(!names.has(file))fail('backup_media_missing');
  const {mediaId,...body}=record;if(sha(JSON.stringify(canonical(body)))!==mediaId||record.originalTime!==record.parent.messageRecordedAt)fail('backup_media_record_invalid');
  const bytes=await readStable(path.join(backup,file));if(bytes.length!==record.bytes||sha(bytes)!==record.sha256)fail('backup_media_hash_mismatch');validateCmcpImageBytes(bytes,record.mimeType);
  if(item.availability&&(item.availability.kind!=='cmcp_media_unavailable'||item.availability.version!==1||item.availability.mediaId!==mediaId||!['revoked','deleted'].includes(item.availability.state)||item.availability.originalBytesRetained!==true))fail('backup_media_availability_invalid');}
 if(!Array.isArray(data.hostLinks)||data.hostLinks.some(x=>x.kind!=='pin_destination'||x.scopeId!==scopeId||typeof x.pinId!=='string'||typeof x.sessionId!=='string'||x.executionAuthorization!==false))fail('backup_host_links_invalid');
 return {kind:'cmcp_backup_verification',status:'verified',scopeId,files:names.size,sources:data.sources.length,media:data.media.length,totalBytes:total,manifestSha256:sha(json(manifest)),modelCalls:0,manifest,data};
}

export async function restoreCmcpData(options){
 authorized(options.authorization,'restore',options.scopeId);const verified=await verifyCmcpBackup(options),target=await assertBackupPath(options.target),backup=path.resolve(options.backup);
 if(target===backup||inside(backup,target)||inside(target,backup))fail('backup_source_destination_overlap');
 // 成功目標不能重覆匯入；失敗目標保留現場，重試須明示另一個新空目標。
 if(await fs.lstat(target).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))fail('backup_restore_target_exists');
 await newDirectory(target);const checkpoint=options.checkpoint??(async()=>{}),{data}=verified;let published=0;
 try{const config=clone(data.config);config.controls={...config.controls,...DENY_CONTROLS};config.sourceAuthorization={saveUser:false,saveAssistant:false};
  await writeExclusive(path.join(target,'runtime.json'),json(config),checkpoint);const root=path.join(target,'.restore-staging-'+randomUUID());await fs.mkdir(root);
  const stores=createCmcpReactivationStores({root,scopeId:options.scopeId});
  for(const source of data.sources){await checkpoint({phase:'history',sourcePointer:source.pointer,index:published});const result=await stores.history.writeEvidence(source);
   if(!['stored','unchanged'].includes(result.status))fail('backup_restore_source_'+result.status);published++;}
  for(const item of data.events){const store=stores.eventStore(item.event);for(const row of item.records){await checkpoint({phase:'event'});const result=await store.applyUpdate(row.command);if(!['stored','unchanged'].includes(result.status))fail('backup_restore_event_failed');}}
  for(const item of data.journals){
   const dest=item.path==='source-index'?createCmcpSourceIndexSegments({root:path.join(root,item.path),name:item.name,maxEntries:config.input.storageCapacity?.maxSources??config.input.limits.maxEntries,maxSegments:config.sourceCatalog?.maxSegments??1}):createLocalLoopJournal({root:path.join(root,item.path),name:item.name});
   for(const record of item.records){await checkpoint({phase:'journal',kind:record.kind});await dest.append(record.kind,record.value);}
  }
  const media=createCmcpMediaOriginals({dataRoot:root,scopeId:options.scopeId}),stamp=verified.manifestSha256;
  for(const item of data.media){await checkpoint({phase:'media',mediaId:item.record.mediaId});const file='media/'+item.record.sha256+(item.record.mimeType==='image/png'?'.png':'.jpg');
   await media.restoreRecord({...item,content:await readStable(path.join(backup,file)),onGuard:async()=>({allowed:true,stamp}),dataAuthorization:options.authorization});}
  const now=new Date().toISOString(),journal=createLocalLoopJournal({root:path.join(root,'input-journal'),name:'cmcp-common-input-v1'});
  await journal.append('source_authorization',{updateId:'restore-'+randomUUID(),scopeId:options.scopeId,patch:{saveUser:false,saveAssistant:false},authorizedBy:'restore_requires_fresh_user_authorization',at:now});
  const controls=createCmcpFeatureControls({root,scopeId:options.scopeId,defaults:config.controls});await controls.update({updateId:'restore-'+randomUUID(),patch:DENY_CONTROLS,persist:true,timeContext:{now,timezone:config.input.timezone}});
  await journal.append('restored_data',{version:1,scopeId:options.scopeId,backupHash:stamp,at:now,executionAuthority:'none',priorTickets:'not_imported',dispatch:'disabled_pending_new_authorization',controlsAtBackup:data.controlsAtBackup,authorityHistoryAtBackup:data.authorityHistoryAtBackup,hostLinks:data.hostLinks});
  if(config.localRetrieval){const catalog=createCmcpTemporalSourceCatalog({stores,maxEntries:config.input.storageCapacity?.maxSources??config.input.limits.maxEntries,maxSegments:config.sourceCatalog?.maxSegments??1});
   const index=createCmcpLocalCandidates({root:path.join(root,'local-lexical-index'),scopeId:options.scopeId,history:stores.history,catalog,limits:config.localRetrieval,maxSegments:config.sourceCatalog?.maxSegments??1});
   for(const entry of await catalog.list()){await checkpoint({phase:'projection'});await index.indexSource(entry.pointer);}}
  // 資料先以正式來源核對，再發布完成回執；失敗時 OFF 設定與部分資料均保留。
  for(const source of data.sources){const found=await stores.history.resolve(source.pointer);if(found.status!=='found'||loopHash(found.evidence)!==loopHash(source))fail('backup_restore_readback_failed');}
  const checkConfig={...config,input:{...config.input,root:path.basename(root)}};
  const runtime=await createCmcpRuntimeSession({config:checkConfig,repoRoot:target,readOnly:true});let status;try{status=await runtime.status();}finally{await runtime.close();}
  if(status.controls.enabled||!status.controls.clean||status.controls.proactive||status.controls.pins||status.sourceAuthorization.saveUser||status.sourceAuthorization.saveAssistant)fail('backup_restore_authority_active');
  const destination=path.join(target,'data');await assertBackupPath(root);await assertBackupPath(destination);
  if(!inside(target,root)||!inside(target,destination)||await fs.lstat(destination).catch(e=>e.code==='ENOENT'?null:Promise.reject(e)))fail('backup_restore_publication_target_invalid');
  await checkpoint({phase:'publish',source:root,target:destination});await fs.rename(root,destination);
  const runtimeConfig=path.join(target,'runtime.json'),common=' --config '+cmcpDataShellQuote(runtimeConfig)+' --scope '+cmcpDataShellQuote(options.scopeId);
  const receipt={kind:'cmcp_data_restore',version:1,status:'complete',target,scopeId:options.scopeId,sources:published,media:data.media.length,backupHash:stamp,
   runtimeConfig,controls:status.controls,executionAuthority:'none',hostLinks:data.hostLinks,reopen:'必須在新環境重新明示授權。尚未配置任何宿主路線或憑證。下列 controls 命令只在使用者決定恢復閱讀時執行，不會自動執行。',
   nextCommands:{inspect:'cmcp-time data inspect'+common,explicitReadingControl:'cmcp-time data controls'+common+' --enabled true --clean false --authorize-controls',sources:'cmcp-time data sources'+common+' --authorize-reading'},modelCalls:0};
  await writeExclusive(path.join(target,'RESTORED.json'),json(receipt),checkpoint);return receipt;
 }catch(error){await fs.writeFile(path.join(target,'RESTORE-FAILED.json'),json({status:'incomplete',publishedSources:published,code:error.code??error.message,executionAuthority:'none',at:new Date().toISOString()}),{flag:'wx'}).catch(()=>{});throw error;}
}
