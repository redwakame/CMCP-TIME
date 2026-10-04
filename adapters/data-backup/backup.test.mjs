// 合成資料、真檔案後端及正式 Runtime／reader；不呼叫宿主或模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const testProduct=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const product=process.env.CMCP_PRODUCT_ROOT?path.resolve(process.env.CMCP_PRODUCT_ROOT):testProduct;
const load=relative=>import(pathToFileURL(path.join(product,relative)).href);
const {inspectCmcpData,exportCmcpData,verifyCmcpBackup,restoreCmcpData,cmcpDataShellQuote}=await load('src/cmcp-guard/cmcp-data-backup.js');
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {createCmcpReactivationStores,createCmcpTemporalSourceCatalog,activateCmcpHistorySources}=await load('src/cmcp-guard/cmcp-history-reactivation.js');
const {createLocalLoopJournal,loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');
const {createCmcpFileHistoryBackend}=await load('src/cmcp-guard/cmcp-file-history-backend.js');
const {createCmcpLocalHistoryProvider}=await load('src/cmcp-guard/cmcp-local-history-provider.js');
const {createCmcpMediaOriginals}=await load('adapters/deepseek-harness/media-originals.mjs');
const {runDataBackupCli}=await load('adapters/data-backup/cli.mjs');

const base=process.env.CMCP_BACKUP_TEST_ROOT??process.env.CMCP_TEST_OUTPUT_ROOT??path.resolve(testProduct,'logs/tests/data-backup');
await fs.mkdir(base,{recursive:true});const run=await fs.mkdtemp(path.join(base,'run-')),receipts=[];
const originalFetch=globalThis.fetch;let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('離線備份測試禁止網路');};
const sha=x=>createHash('sha256').update(x).digest('hex'),now='2026-10-04T00:00:00.123Z',later='2026-10-04T00:01:00.456Z';
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,data){const head=Buffer.alloc(8),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);head.write(type,4);let n=0xffffffff;for(const b of Buffer.concat([head.subarray(4),data]))n=table[(n^b)&255]^(n>>>8);tail.writeUInt32BE((n^0xffffffff)>>>0);return Buffer.concat([head,data,tail]);}
function png(){const h=Buffer.alloc(13);h.writeUInt32BE(2);h.writeUInt32BE(1,4);h[8]=8;h[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,12,40,90,13,41,91]))),chunk('IEND',Buffer.alloc(0))]);}
const authorization=(purpose,scopeId)=>({kind:'cmcp_current_user_data_action',purpose,scopeId,confirmed:true});
async function fixture(name,{image=true,capacity=64}={}){
 const repoRoot=path.join(run,name),scopeId='synthetic-backup-'+name;await fs.mkdir(repoRoot);
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:scopeId,providerMode:'host',input:{root:'state',scopeId,events:[],timezone:'Asia/Taipei',
  limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:capacity,maxSourceBytes:8192},
  loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:'receipts',sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:true},answerHistory:{enabled:true}};
 await fs.writeFile(path.join(repoRoot,'runtime.json'),JSON.stringify(config));
 const runtime=await createCmcpRuntimeSession({config,repoRoot,sessionId:'synthetic-source-session',clock:()=>later});
 const user=await runtime.beforeUser({text:'修補工作坊初稿是週六；尚待書面同意。',sourceId:'user-original',timeContext:{now,timezone:'Asia/Taipei'}});
 const reply=await runtime.afterAssistant({text:'草稿保留未定條件，另提議增加材料清單。',messageId:'assistant-original',replyTo:user.sourcePointer,timeContext:{now:later,timezone:'Asia/Taipei'}});
 const status=await runtime.status(),source=status.state.registration.sources.find(row=>row.pointer.itemId==='user-original');
 const pin=await runtime.pinCreate({updateId:'pin-created',pinId:'pin-synthetic',sourceIds:[source.id],dueAt:'2026-10-06T03:00:00Z',userAction:{kind:'callable_authorization',authorized:true,scopeId}});
 await runtime.pinChange({updateId:'pin-cancelled',pinId:'pin-synthetic',expectedRevision:pin.pin.revision,action:'cancel',userAction:{kind:'callable_authorization',authorized:true,scopeId}});
 const dataRoot=path.join(repoRoot,'state'),stores=createCmcpReactivationStores({root:dataRoot,scopeId}),catalog=createCmcpTemporalSourceCatalog({stores,maxEntries:64});
 const resolved=await stores.history.resolve(user.sourcePointer),evidence=resolved.evidence;
 const parent={sourcePointer:evidence.pointer,evidenceHash:loopHash(evidence),sourceAuthorRole:'user',sessionId:evidence.pointer.sessionId,scopeId,messageRecordedAt:now,textHash:loopHash(evidence.content.body)};
 const media=createCmcpMediaOriginals({dataRoot,scopeId}),guard=async()=>({allowed:true,stamp:'synthetic-explicit-capture'});let picture=null;
 if(image)picture=await media.capture({parent,attachment:{filename:'修補初稿.png',mimeType:'image/png',bytes:png()},onGuard:guard});
 const selected=await catalog.list();await activateCmcpHistorySources({stores,selected:[selected.find(x=>x.id===source.id)],query:evidence,activeAt:now,
  read:{sourceMap:{r1:evidence.pointer},eventVersions:[],sourceBytes:Buffer.byteLength(evidence.content.body),projectionBytes:100},bufferGeneration:0,ttlMs:43200000,timeContext:{now,timezone:'Asia/Taipei'}});
 await runtime.close();return {repoRoot,config,scopeId,dataRoot,source,user,reply,parent,picture,media,guard};
}
const exportOptions=f=>({...f,authorization:authorization('export',f.scopeId),output:path.join(run,path.basename(f.repoRoot)+'-backup')});
const restoreOptions=(f,backup,target=path.join(run,path.basename(f.repoRoot)+'-restore'))=>({backup,target,scopeId:f.scopeId,authorization:authorization('restore',f.scopeId)});
async function allHashes(root){const result={};async function scan(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())await scan(full);else result[path.relative(root,full)]=sha(await fs.readFile(full));}}await scan(root);return result;}

test('完整原文／媒體／reply／Pin／Buffer還原且新權限預設關閉，正式reader重新授權後原時間不變',async()=>{
 const f=await fixture('roundtrip'),before=await allHashes(f.dataRoot),out=await exportCmcpData(exportOptions(f));
 assert.deepEqual(await allHashes(f.dataRoot),before);const verified=await verifyCmcpBackup({backup:out.output,scopeId:f.scopeId});assert.equal(verified.sources,2);assert.equal(verified.media,1);
 const restored=await restoreCmcpData(restoreOptions(f,out.output));assert.equal(restored.status,'complete');assert.equal(restored.controls.clean,true);assert.equal(restored.controls.enabled,false);
 const config=JSON.parse(await fs.readFile(restored.runtimeConfig,'utf8')),runtime=await createCmcpRuntimeSession({config,repoRoot:restored.target,clock:()=>later});
 const initial=await runtime.status();assert.equal(initial.pins.pins[0].status,'cancelled');assert.equal(initial.pins.pins[0].dueAt,'2026-10-06T03:00:00.000Z');
 await assert.rejects(runtime.readSource({pointer:f.source.pointer,evidenceHash:f.source.evidenceHash,start:0,end:f.source.location.end,maxBytes:8192}),/source_read_disabled/);
 await runtime.configureControls({updateId:'new-explicit-reading-grant',patch:{enabled:true,clean:false},timeContext:{now:later,timezone:'Asia/Taipei'}});
 const read=await runtime.readSource({pointer:f.source.pointer,evidenceHash:f.source.evidenceHash,start:0,end:f.source.location.end,maxBytes:8192});assert.equal(read.text,'修補工作坊初稿是週六；尚待書面同意。');assert.equal(read.messageRecordedAt,now);
 const sources=createCmcpReactivationStores({root:path.join(restored.target,'data'),scopeId:f.scopeId});assert.deepEqual((await sources.history.resolve(f.user.sourcePointer)).evidence,(await createCmcpReactivationStores({root:f.dataRoot,scopeId:f.scopeId}).history.resolve(f.user.sourcePointer)).evidence);
 const media=createCmcpMediaOriginals({dataRoot:path.join(restored.target,'data'),scopeId:f.scopeId}),image=await media.read({mediaId:f.picture.mediaId,parent:f.parent,onGuard:f.guard});assert.deepEqual(image.content,png());assert.equal(image.originalTime,now);
 const journals=await createLocalLoopJournal({root:path.join(restored.target,'data/input-journal'),name:'cmcp-common-input-v1'}).read();assert.ok(journals.some(x=>x.record.kind==='host_reply_binding'));assert.equal(journals.some(x=>x.record.kind==='runtime_budget_dependency'),false);
 const focus=await createLocalLoopJournal({root:path.join(restored.target,'data/focus'),name:'local-focus-v1'}).read();const active=focus.findLast(x=>x.record.kind==='reactivation_state').record.value.buffer[0];assert.equal(active.activatedAt,now);assert.equal(active.expiry,'2026-10-04T12:00:00.123Z');
 await runtime.close();receipts.push({case:'roundtrip',out,restored,sourceHashesUnchanged:true,originalTime:now,bufferExpiry:active.expiry});
});
test('正式撤權標記保留；備份原件不能使一般媒體read恢復可讀',async()=>{const f=await fixture('revoked');await f.media.setAvailability({mediaId:f.picture.mediaId,parent:f.parent,onGuard:f.guard,state:'revoked',reason:'合成撤權'});
 const out=await exportCmcpData(exportOptions(f)),restored=await restoreCmcpData(restoreOptions(f,out.output));const media=createCmcpMediaOriginals({dataRoot:path.join(restored.target,'data'),scopeId:f.scopeId});
 await assert.rejects(media.read({mediaId:f.picture.mediaId,parent:f.parent,onGuard:f.guard}),/media_original_revoked/);assert.deepEqual(await fs.readFile(path.join(restored.target,'data/media-originals/blobs',f.picture.sha256+'.png')),png());});
test('未授權或錯scope拒絕，不用共用目錄取代明確資料管理授權',async()=>{const f=await fixture('authorization');await assert.rejects(exportCmcpData({...exportOptions(f),authorization:null}),/backup_current_user_authorization_required/);
 await assert.rejects(exportCmcpData({...exportOptions(f),scopeId:'other'}),/backup_scope_mismatch/);});
test('現有writer拒絕且不刪鎖；正常關閉後可匯出',async()=>{const f=await fixture('writer'),runtime=await createCmcpRuntimeSession({config:f.config,repoRoot:f.repoRoot});
 await assert.rejects(exportCmcpData(exportOptions(f)),/backup_writer_active_or_unreleased/);assert.ok(await fs.stat(path.join(f.dataRoot,'.common-input-writer.lock')));await runtime.close();await exportCmcpData(exportOptions(f));});
test('缺件、hash損壞、錯scope與未索引檔皆拒絕驗證',async()=>{for(const mode of ['missing','hash','scope','extra']){const f=await fixture('verify-'+mode),out=await exportCmcpData(exportOptions(f));
 if(mode==='missing')await fs.rename(path.join(out.output,'data.json'),path.join(out.output,'data-preserved.json'));
 if(mode==='hash')await fs.appendFile(path.join(out.output,'data.json'),' ');
 if(mode==='extra')await fs.writeFile(path.join(out.output,'extra.json'),'{}');
 await assert.rejects(verifyCmcpBackup({backup:out.output,scopeId:mode==='scope'?'wrong':f.scopeId}));}});
async function tamperData(out,change){const file=path.join(out.output,'data.json'),data=JSON.parse(await fs.readFile(file,'utf8'));change(data);const bytes=Buffer.from(JSON.stringify(data,null,2)+'\n');await fs.writeFile(file,bytes);const mf=path.join(out.output,'MANIFEST.json'),m=JSON.parse(await fs.readFile(mf,'utf8'));const e=m.entries.find(x=>x.path==='data.json');e.bytes=bytes.length;e.sha256=sha(bytes);m.totalBytes=m.entries.reduce((n,x)=>n+x.bytes,0);m.indexSha256=loopHash(m.entries);await fs.writeFile(mf,JSON.stringify(m,null,2)+'\n');}
test('即使重算外層索引，來源版本衝突、journal穿越、設定外部路徑或執行授權仍拒絕',async()=>{for(const mode of ['conflict','traversal','scope','config-path','config-extra','config-authority','pin-authority']){const f=await fixture('inner-'+mode),out=await exportCmcpData(exportOptions(f));
 await tamperData(out,data=>{if(mode==='conflict')data.sources.push({...data.sources[0],content:{...data.sources[0].content,body:'衝突'}});if(mode==='traversal')data.journals[0].path='../outside';if(mode==='scope')data.sources[0].pointer.scopeId='wrong';
 if(mode==='config-path')data.config.input.root='../outside';if(mode==='config-extra')data.config.credentialRef='../outside';if(mode==='config-authority')data.config.sourceAuthorization.saveUser=true;
 if(mode==='pin-authority')data.journals.find(x=>x.path==='input-journal').records.find(x=>x.kind==='pin_update').value.authorization={status:'verified'};});
 await assert.rejects(verifyCmcpBackup({backup:out.output,scopeId:f.scopeId}),/backup_/);}});
test('路徑別名及備份與來源重疊拒絕',async()=>{const f=await fixture('alias'),alias=path.join(run,'source-alias');await fs.symlink(f.dataRoot,alias,process.platform==='win32'?'junction':'dir');
 await assert.rejects(exportCmcpData({...exportOptions(f),config:{...f.config,input:{...f.config.input,root:alias}}}));await assert.rejects(exportCmcpData({...exportOptions(f),output:path.join(f.dataRoot,'backup')}),/backup_source_destination_overlap/);});
test('中途還原故障保留失敗目標／無完成回執，換新空目標可完整重試且不重複來源',async()=>{const f=await fixture('interrupt'),out=await exportCmcpData(exportOptions(f)),opts=restoreOptions(f,out.output);let count=0;
 await assert.rejects(restoreCmcpData({...opts,checkpoint:async event=>{if(event.phase==='history'&&++count===2)throw Object.assign(Error('合成中途終止'),{code:'TEST_INTERRUPTED'});}}),/合成中途終止/);
 assert.equal((JSON.parse(await fs.readFile(path.join(opts.target,'RESTORE-FAILED.json'),'utf8'))).publishedSources,1);await assert.rejects(fs.stat(path.join(opts.target,'RESTORED.json')),e=>e.code==='ENOENT');
 await assert.rejects(fs.stat(path.join(opts.target,'data')),e=>e.code==='ENOENT');
 await assert.rejects(restoreCmcpData(opts),/backup_restore_target_exists/);const next=await restoreCmcpData({...opts,target:opts.target+'-retry'});assert.equal(next.sources,2);receipts.push({case:'interruption',failedTarget:opts.target,retry:next});});
test('合成容量滿／寫入拒絕匯出失敗不改來源且保留診斷，容量恢復後成功',async()=>{for(const code of ['ENOSPC','EACCES']){const f=await fixture('write-'+code),before=await allHashes(f.dataRoot),opts=exportOptions(f);
 await assert.rejects(exportCmcpData({...opts,checkpoint:async()=>{throw Object.assign(Error(code),{code});}}),new RegExp(code));assert.deepEqual(await allHashes(f.dataRoot),before);assert.ok(await fs.stat(path.join(opts.output,'FAILED.json')));
 await exportCmcpData({...opts,output:opts.output+'-retry'});}});
test('正式原文保存後端故障注入：容量滿與拒寫均未保存；恢復後同Pointer重試不重複、不改角色原時間',async()=>{
 for(const code of ['ENOSPC','EACCES']){const root=path.join(run,'backend-'+code),real=createCmcpFileHistoryBackend({root});let fault=true;
 const backend={...real,create:async(...args)=>{if(fault)throw Object.assign(Error(code),{code});return real.create(...args);}},provider=createCmcpLocalHistoryProvider({providerNamespace:'cmcp-local-console-v1',backend});
 const evidence={pointer:{version:1,providerNamespace:'cmcp-local-console-v1',scopeId:'fault-synthetic',sessionId:'source-session',itemId:'same-original',revisionId:'r1'},sourceKind:'message',sourceAuthorRole:'assistant',messageRecordedAt:now,eventOccurredAt:null,content:{kind:'source_excerpt',body:'完整原答不可截短。'}};
 assert.equal((await provider.writeEvidence(evidence)).status,'failed');assert.equal((await provider.resolve(evidence.pointer)).status,'missing');fault=false;
 assert.equal((await provider.writeEvidence(evidence)).status,'stored');assert.equal((await provider.writeEvidence(evidence)).status,'unchanged');assert.equal((await real.listKeys()).length,1);assert.deepEqual((await provider.resolve(evidence.pointer)).evidence,evidence);
 receipts.push({case:'storage-fault',code,backend:'真檔案後端加注入create故障，不是另一種部署後端',recovered:'same_pointer_original_role_and_time'});}});
test('媒體原件缺件明示匯出失敗，不改成只有描述的成功備份',async()=>{const f=await fixture('media-missing'),blob=path.join(f.dataRoot,'media-originals/blobs',f.picture.sha256+'.png');await fs.rename(blob,blob+'.preserved');await assert.rejects(exportCmcpData(exportOptions(f)),/media_backup_original_missing/);});
test('公開CLI inspect與help不回顯原文；匯出需明示旗標',async()=>{const f=await fixture('cli');let output='';const io={stdout:{write:x=>{output+=x;}}};await runDataBackupCli(['inspect','--config',path.join(f.repoRoot,'runtime.json'),'--scope',f.scopeId],io);assert.equal(JSON.parse(output).sources,2);assert.ok(!output.includes('修補工作坊'));
 await assert.rejects(runDataBackupCli(['export','--config',path.join(f.repoRoot,'runtime.json'),'--scope',f.scopeId,'--output',path.join(run,'unauthorized-export')],io),/backup_cli_explicit_export_required/);});
test('公開CLI還原後明示開啟閱讀、選取正式原文及媒體；原文／原時間與期限均不改',async()=>{
 const f=await fixture('cli-restore');async function cli(args){let result='';await runDataBackupCli(args,{stdout:{write:x=>result+=x}});const output=JSON.parse(result);receipts.push({case:'cli-restore',operation:args[0],arguments:args,result:output});return output;}
 const exported=await cli(['export','--config',path.join(f.repoRoot,'runtime.json'),'--scope',f.scopeId,'--output',path.join(run,'cli-exported'),'--authorize-backup']);
 await cli(['verify','--backup',exported.output,'--scope',f.scopeId]);const restored=await cli(['restore','--backup',exported.output,'--scope',f.scopeId,'--target',path.join(run,'cli-restored'),'--authorize-restore']);
 const common=['--config',restored.runtimeConfig,'--scope',f.scopeId],reading=[...common,'--authorize-reading'];
 await assert.rejects(cli(['sources',...common]),/current_user_operation_authorization_required/);
 await assert.rejects(cli(['sources',...reading]),/source_read_disabled/);
 await assert.rejects(cli(['controls',...common,'--enabled','true','--clean','false']),/current_user_operation_authorization_required/);
 const controls=await cli(['controls',...common,'--enabled','true','--clean','false','--authorize-controls']);assert.equal(controls.controls.proactive,false);assert.equal(controls.controls.pins,false);assert.equal(controls.sourceAuthorization.saveUser,false);
 const listed=await cli(['sources',...reading]),source=listed.sources.find(x=>x.pointer.itemId==='user-original'),selection=['--source',String(source.number),'--selection',listed.selection];
 await assert.rejects(cli(['read',...reading,'--source',String(source.number),'--selection','stale']),/selection_expired/);
 const before=await allHashes(path.join(restored.target,'data'));const original=await cli(['read',...reading,...selection]);assert.equal(original.text,'修補工作坊初稿是週六；尚待書面同意。');assert.equal(original.messageRecordedAt,now);
 const media=await cli(['media',...reading,...selection]);assert.equal(media.items.length,1);const output=path.join(run,'cli-restored-image.png');
 const image=await cli(['media',...reading,...selection,'--image','1','--media-selection',media.mediaSelection,'--output',output]);assert.deepEqual(await fs.readFile(output),png());assert.equal(image.originalTime,now);assert.deepEqual(await allHashes(path.join(restored.target,'data')),before);
 await assert.rejects(cli(['verify','--scope',f.scopeId]),/backup_cli_backup_required/);await assert.rejects(cli(['verify','--backup',exported.output,'--scope',f.scopeId,'--target','unused']),/argument_invalid_for_operation/);
});
test('媒體資料管理能力不能以一般reader guard冒充；deleted標記還原後仍拒絕正式閱讀',async()=>{
 const f=await fixture('deleted');await assert.rejects(f.media.backupSnapshot({onGuard:f.guard}),/data_management_authorization_required/);
 await f.media.setAvailability({mediaId:f.picture.mediaId,parent:f.parent,onGuard:f.guard,state:'deleted',reason:'合成刪除狀態，原件保留'});
 const out=await exportCmcpData(exportOptions(f)),restored=await restoreCmcpData(restoreOptions(f,out.output)),media=createCmcpMediaOriginals({dataRoot:path.join(restored.target,'data'),scopeId:f.scopeId});
 await assert.rejects(media.read({mediaId:f.picture.mediaId,parent:f.parent,onGuard:f.guard}),/media_original_deleted/);
});
test('正式單筆bytes容量拒存不裁切舊來源，也不暗改既有綁定的容量設定',async()=>{
 const f=await fixture('capacity'),before=await allHashes(path.join(f.dataRoot,'history')),originalText='後續修訂限八人，仍須書面同意。'.repeat(240);
 let runtime=await createCmcpRuntimeSession({config:f.config,repoRoot:f.repoRoot,sessionId:'capacity-session',clock:()=>later}),failure;
 try{try{await runtime.beforeUser({text:originalText,sourceId:'capacity-original',timeContext:{now:later,timezone:'Asia/Taipei'}});}catch(error){failure=error.message;}}finally{await runtime.close();}
 assert.ok(failure,'容量滿必須明示未保存');assert.deepEqual(await allHashes(path.join(f.dataRoot,'history')),before);
 const config={...f.config,input:{...f.config.input,storageCapacity:{...f.config.input.storageCapacity,maxSourceBytes:16384}}};
 await assert.rejects(createCmcpRuntimeSession({config,repoRoot:f.repoRoot,sessionId:'capacity-session',clock:()=>later}),/common_input_root_binding_mismatch/);
 const stores=createCmcpReactivationStores({root:f.dataRoot,scopeId:f.scopeId});assert.equal((await stores.history.listPointers({scopeId:f.scopeId,maxRecords:20})).pointers.length,2);assert.deepEqual(await allHashes(path.join(f.dataRoot,'history')),before);
 receipts.push({case:'source-byte-capacity',failure,attemptedBytes:Buffer.byteLength(originalText),configuredBytes:8192,priorHistoryUnchanged:true,resize:'既有綁定不允許直接改限額；本單不新增遷移政策。ENOSPC／EACCES 恢復另以正式後端驗證。'});
});
test('原生Pin派送位置經正式bridge讀取，只匯出本scope歷史目標而不恢復派送授權',async()=>{
 const f=await fixture('host-links'),traceRoot=path.join(f.repoRoot,'trace');await fs.mkdir(traceRoot);await fs.writeFile(path.join(traceRoot,'bridge-events.jsonl'),[
 {scopeId:f.scopeId,sessionId:'host-session-original',kind:'pin_destination',pinId:'pin-synthetic',at:now},
 {scopeId:'other-scope',sessionId:'not-authorized',kind:'pin_destination',pinId:'other-pin',at:now},
 {scopeId:f.scopeId,sessionId:'host-session-original',kind:'assistant_result',text:'不需備份的合成除錯副本'}].map(JSON.stringify).join('\n')+'\n');
 const file=path.join(f.repoRoot,'desktop.json');await fs.writeFile(file,JSON.stringify({deploymentRoot:f.repoRoot,runtimeConfig:'runtime.json',traceRoot:'trace',scopeId:f.scopeId}));
 let output='';await runDataBackupCli(['export','--config',path.join(f.repoRoot,'runtime.json'),'--scope',f.scopeId,'--desktop-config',file,'--output',path.join(run,'host-links-backup'),'--authorize-backup'],{stdout:{write:x=>output+=x}});
 const result=JSON.parse(output),verified=await verifyCmcpBackup({backup:result.output,scopeId:f.scopeId});assert.deepEqual(verified.data.hostLinks,[{kind:'pin_destination',pinId:'pin-synthetic',scopeId:f.scopeId,sessionId:'host-session-original',executionAuthorization:false}]);
 assert.ok(!JSON.stringify(verified.data).includes('除錯副本'));const restored=await restoreCmcpData(restoreOptions(f,result.output));assert.deepEqual(restored.hostLinks,verified.data.hostLinks);assert.equal(restored.controls.proactive,false);assert.equal(restored.controls.pins,false);
 receipts.push({case:'host-links',result,restored});
});
test('還原active Pin僅開共用開關仍不派送；既有schedule新userAction才恢復且cancel不復活',async()=>{
 const f=await fixture('pin-authority');let runtime=await createCmcpRuntimeSession({config:f.config,repoRoot:f.repoRoot,sessionId:'pin-owner',clock:()=>later});
 const action={kind:'callable_authorization',authorized:true,scopeId:f.scopeId},dueAt='2026-10-06T04:00:00.000Z';
 let created;try{created=await runtime.pinCreate({updateId:'active-created',pinId:'active-to-restore',sourceIds:[f.source.id],dueAt,userAction:action});assert.equal(created.pin.requiresFreshAuthorization,undefined);}finally{await runtime.close();}
 const out=await exportCmcpData(exportOptions(f)),restored=await restoreCmcpData(restoreOptions(f,out.output)),config=JSON.parse(await fs.readFile(restored.runtimeConfig,'utf8'));
 runtime=await createCmcpRuntimeSession({config,repoRoot:restored.target,sessionId:'new-pin-owner',clock:()=>later});
 try{await runtime.configureControls({updateId:'explicit-shared-controls',patch:{enabled:true,clean:false,proactive:true,pins:true}});
  const before=await runtime.status(),pin=before.pins.pins.find(x=>x.pinId==='active-to-restore');assert.equal(pin.status,'active');assert.equal(pin.dueAt,dueAt);assert.equal(pin.createdAt,created.pin.createdAt);assert.equal(pin.requiresFreshAuthorization,true);
  assert.equal(before.proactiveExecutor.dispatch.timerScheduled,false);assert.equal(before.proactiveExecutor.dispatch.reason,'restored_pin_requires_authorization');
  await assert.rejects(runtime.pinChange({updateId:'unauthorized-schedule',pinId:pin.pinId,expectedRevision:pin.revision,action:'schedule',dueAt,userAction:{...action,authorized:false}}),/pin_explicit_scoped_user_action_required/);
  const changed=await runtime.pinChange({updateId:'fresh-explicit-schedule',pinId:pin.pinId,expectedRevision:pin.revision,action:'schedule',dueAt,userAction:action});assert.equal(changed.pin.requiresFreshAuthorization,undefined);
  const after=await runtime.status();assert.equal(after.proactiveExecutor.dispatch.timerScheduled,true);assert.equal(after.proactiveExecutor.dispatch.reason,'waiting_due');
  const cancelled=after.pins.pins.find(x=>x.pinId==='pin-synthetic');await assert.rejects(runtime.pinChange({updateId:'cannot-revive-cancelled',pinId:cancelled.pinId,expectedRevision:cancelled.revision,action:'schedule',dueAt,userAction:action}),/pin_not_active/);
  await runtime.pinChange({updateId:'finish-synthetic-pin',pinId:pin.pinId,expectedRevision:changed.pin.revision,action:'cancel',userAction:action});
  receipts.push({case:'restored-pin-authorization',before,changed,after,scope:'離線Runtime與合成時鐘，只驗排程資格，沒有模型或派送'});
 }finally{await runtime.close();}
});
test('CLI可貼命令將空白、單引號及$()保留為字面值，不執行插值',async()=>{
 const f=await fixture("quoted ' $(literal) space");let text='';await runDataBackupCli(['sources','--config',path.join(f.repoRoot,'runtime.json'),'--scope',f.scopeId,'--authorize-reading'],{stdout:{write:x=>text+=x}});
 const result=JSON.parse(text),expectedConfig=cmcpDataShellQuote(path.join(f.repoRoot,'runtime.json')),expectedScope=cmcpDataShellQuote(f.scopeId);
 assert.ok(result.sources[0].readCommand.includes('--config '+expectedConfig+' --scope '+expectedScope));
 assert.equal(cmcpDataShellQuote("a b'$(literal)`",'win32'),"'a b''$(literal)`'");assert.equal(cmcpDataShellQuote("a b'$(literal)`",'linux'),"'a b'\"'\"'$(literal)`'");
 const out=await exportCmcpData(exportOptions(f)),restored=await restoreCmcpData(restoreOptions(f,out.output));assert.ok(restored.nextCommands.explicitReadingControl.includes('--config '+cmcpDataShellQuote(restored.runtimeConfig)+' --scope '+expectedScope));
 receipts.push({case:'shell-quoting',scope:f.scopeId,commands:restored.nextCommands,execution:'未執行任何字面值內的命令內容'});
});
test.after(async()=>{globalThis.fetch=originalFetch;assert.equal(networkCalls,0);await fs.writeFile(path.join(run,'results.json'),JSON.stringify({kind:'cmcp_data_backup_tests',run,product,receipts,networkCalls,modelCalls:0,platform:process.platform,node:process.version},null,2));console.log('BACKUP_RESULTS '+path.join(run,'results.json'));});
