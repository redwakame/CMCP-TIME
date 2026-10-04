import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {inspectCmcpData,exportCmcpData,verifyCmcpBackup,restoreCmcpData,assertBackupPath,cmcpDataShellQuote} from '../../src/cmcp-guard/cmcp-data-backup.js';
import {normalizeCmcpRuntimeConfig,createCmcpRuntimeSession} from '../../src/cmcp-guard/cmcp-runtime-session.js';
import {loopHash} from '../../src/cmcp-guard/cmcp-local-loop-journal.js';
import {createCmcpMediaOriginals} from '../deepseek-harness/media-originals.mjs';

export const DATA_HELP=`CMCP 資料管理（零模型）
  data inspect --config <runtime.json 或 entry.json> --scope <專案>
  data export --config <runtime.json 或 entry.json> --scope <專案> --output <新備份目錄> --authorize-backup
  data verify --backup <備份目錄> --scope <專案>
  data restore --backup <備份目錄> --scope <專案> --target <新的不存在目錄> --authorize-restore
  data controls --config <runtime.json> --scope <專案> --enabled true --clean false --authorize-controls
  data sources --config <runtime.json> --scope <專案> --authorize-reading
  data read --config <runtime.json> --scope <專案> --source <清冊編號> --selection <清冊提供值> --authorize-reading
  data media --config <runtime.json> --scope <專案> --source <清冊編號> --selection <清冊提供值> --authorize-reading
runtime.json 可加 --project-root <原設定相對路徑的根目錄>。
匯出／檢查可加 --desktop-config <原生 CMCP 設定> 保存該 scope 的歷史 Pin 派送位置，不複製宿主對話或執行權。
sources 會提供原文與媒體命令，不需找內部 ID。read 可用 --start <字元位置> --end <字元位置> 分頁。
media 列表提供 --image <編號> --media-selection <清冊值> --output <不存在的新檔案> 的匯出命令。
controls 只接受明示 --enabled、--clean；不改保存、主動、Pin 或 DND。讀取另需 --authorize-reading。
先正常停止該資料區 writer；不關閉其他工作。備份與還原不建立模型授權。
還原保留原文、媒體、角色、原時間、Buffer／Pin與失效狀態，預設 OFF／Clean／停止保存及派送。
還原目標失敗或已存在時保留，不覆寫；重試指定另一個新目標。`;

const configured=['--config','--runtime-config','--project-root','--scope'];
const permitted={inspect:[...configured,'--desktop-config'],export:[...configured,'--desktop-config','--output','--authorize-backup'],verify:['--scope','--backup'],restore:['--scope','--backup','--target','--authorize-restore'],
 controls:[...configured,'--enabled','--clean','--authorize-controls'],sources:[...configured,'--authorize-reading'],read:[...configured,'--authorize-reading','--source','--selection','--start','--end'],media:[...configured,'--authorize-reading','--source','--selection','--image','--media-selection','--output']};
const integer=(value,name,{optional=false}={})=>{if(value===undefined&&optional)return undefined;if(!/^\d+$/.test(value??'')||!Number.isSafeInteger(Number(value)))throw Error('backup_cli_'+name+'_invalid');return Number(value);};
async function configuration(flags){
 let file=flags['--config']??flags['--runtime-config'];if(!file||flags['--config']&&flags['--runtime-config'])throw Error('backup_cli_configuration_required_or_ambiguous');file=path.resolve(file);await assertBackupPath(file);
 let config=JSON.parse(await fs.readFile(file,'utf8')),repoRoot=path.resolve(flags['--project-root']??path.dirname(file));
 if(config.kind==='cmcp_project_entry'){
  if(flags['--project-root'])throw Error('backup_cli_project_entry_root_is_fixed');
  const {loadProject}=await import('../project-entry/config.mjs');const loaded=await loadProject(file);repoRoot=loaded.config.projectRoot;
  await assertBackupPath(loaded.shared.runtimeConfig);config=JSON.parse(await fs.readFile(loaded.shared.runtimeConfig,'utf8'));
 }
 let readHostLinks;
 if(flags['--desktop-config']){const hostFile=path.resolve(flags['--desktop-config']);await assertBackupPath(hostFile);const host=JSON.parse(await fs.readFile(hostFile,'utf8'));
  if(typeof host.deploymentRoot!=='string'||typeof host.runtimeConfig!=='string'||typeof host.traceRoot!=='string'||host.scopeId!==flags['--scope'])throw Error('backup_desktop_configuration_invalid');
  const root=path.resolve(host.deploymentRoot),runtimeFile=path.resolve(root,host.runtimeConfig),traceRoot=path.resolve(root,host.traceRoot);await assertBackupPath(runtimeFile);await assertBackupPath(traceRoot);
  const hostRuntime=JSON.parse(await fs.readFile(runtimeFile,'utf8'));
  if(normalizeCmcpRuntimeConfig(hostRuntime,{repoRoot:root}).config.input.root!==normalizeCmcpRuntimeConfig(config,{repoRoot}).config.input.root)throw Error('backup_desktop_data_root_mismatch');
  const {CmcpHarnessBridge}=await import('../deepseek-harness/runtime-bridge.mjs');const bridge=new CmcpHarnessBridge({...host,deploymentRoot:root,runtimeConfig:runtimeFile,traceRoot});
  readHostLinks=async()=>{await assertBackupPath(path.join(traceRoot,'bridge-events.jsonl'));return [...await bridge.destinations()].map(([pinId,target])=>({kind:'pin_destination',pinId,...target,executionAuthorization:false}));};
 }
 return {file,config,repoRoot,readHostLinks};
}
async function useRestoredData(operation,options,flags){
 const {config}=normalizeCmcpRuntimeConfig(options.config,{repoRoot:options.repoRoot});if(config.input.scopeId!==options.scopeId)throw Error('backup_scope_mismatch');
 await assertBackupPath(config.input.root);await fs.stat(config.input.root);
 const writing=operation==='controls';if(writing&&!flags['--authorize-controls']||!writing&&!flags['--authorize-reading'])throw Error('backup_cli_current_user_operation_authorization_required');
 const runtime=await createCmcpRuntimeSession({config:options.config,repoRoot:options.repoRoot,readOnly:!writing,sessionId:'data-cli-'+randomUUID()});
 try{
  if(writing){const patch={};for(const key of ['enabled','clean'])if(flags['--'+key]!==undefined){if(!['true','false'].includes(flags['--'+key]))throw Error('backup_cli_control_boolean_required');patch[key]=flags['--'+key]==='true';}
   if(!Object.keys(patch).length)throw Error('backup_cli_control_patch_required');await runtime.configureControls({updateId:'data-cli-'+randomUUID(),patch,persist:true});
   const status=await runtime.status();return {kind:'cmcp_data_controls',scopeId:options.scopeId,controls:status.controls,sourceAuthorization:status.sourceAuthorization,operationSource:'current_user_cli',modelCalls:0};}
  const status=await runtime.status(),controls=status.controls;if(!controls.enabled||controls.clean||!controls.historyRecall||!controls.answerHistory)throw Error('source_read_disabled_or_controls_changed');
  const sources=status.state.registration.sources,selection=loopHash(sources),common=' --config '+cmcpDataShellQuote(options.file)+(flags['--project-root']?' --project-root '+cmcpDataShellQuote(options.repoRoot):'')+' --scope '+cmcpDataShellQuote(options.scopeId);
  if(operation==='sources')return {kind:'cmcp_data_sources',scopeId:options.scopeId,selection,controls,operationSource:'current_user_cli',modelCalls:0,sources:sources.map((source,index)=>({number:index+1,...source,
   readCommand:'cmcp-time data read'+common+' --source '+(index+1)+' --selection '+selection+' --authorize-reading',mediaCommand:'cmcp-time data media'+common+' --source '+(index+1)+' --selection '+selection+' --authorize-reading'}))};
  const index=integer(flags['--source'],'source')-1;if(flags['--selection']!==selection||!sources[index])throw Error('backup_cli_source_selection_expired_or_invalid');const source=sources[index];
  if(operation==='read'){const start=integer(flags['--start'],'start',{optional:true})??0,end=integer(flags['--end'],'end',{optional:true})??Math.min(source.location.end,start+2048);
   const result=await runtime.readSource({pointer:source.pointer,evidenceHash:source.evidenceHash,start,end,maxBytes:8192});return {...result,scopeId:options.scopeId,operationSource:'current_user_cli',next:result.status==='found'&&!result.completeStoredContent?{start:result.range.end,command:'cmcp-time data read'+common+' --source '+(index+1)+' --selection '+selection+' --start '+result.range.end+' --authorize-reading'}:null};}
  const original=await runtime.readSource({pointer:source.pointer,evidenceHash:source.evidenceHash,start:0,end:Math.min(source.location.end,2048),maxBytes:8192});
  if(original.status!=='found'||original.sourceAuthorRole!=='user')throw Error('backup_cli_media_parent_unavailable');
  // textHash 從正式來源完整閱讀取得；不讀底層 History，也不把文字描述當成圖片。
  let body=original.text,end=original.range.end;while(end<source.location.end){const page=await runtime.readSource({pointer:source.pointer,evidenceHash:source.evidenceHash,start:end,end:Math.min(source.location.end,end+2048),maxBytes:8192});if(page.status!=='found'||page.range.end<=end)throw Error('backup_cli_media_parent_incomplete');body+=page.text;end=page.range.end;}
  const parent={sourcePointer:source.pointer,evidenceHash:source.evidenceHash,sourceAuthorRole:'user',sessionId:source.pointer.sessionId,scopeId:options.scopeId,messageRecordedAt:original.messageRecordedAt,textHash:loopHash(body)};
  const guard=async()=>{await runtime.validateMediaParent({pointer:source.pointer,evidenceHash:source.evidenceHash,messageRecordedAt:parent.messageRecordedAt,textHash:parent.textHash});return {allowed:true,stamp:(await runtime.controlsSnapshot()).generation};};
  const store=createCmcpMediaOriginals({dataRoot:config.input.root,scopeId:options.scopeId}),list=await store.list({parent,onGuard:guard}),mediaSelection=loopHash(list.items);
  if(flags['--image']===undefined){if(flags['--output']||flags['--media-selection'])throw Error('backup_cli_image_required');return {...list,scopeId:options.scopeId,mediaSelection,items:list.items.map((image,i)=>({number:i+1,...image,
    exportCommand:'cmcp-time data media'+common+' --source '+(index+1)+' --selection '+selection+' --image '+(i+1)+' --media-selection '+mediaSelection+' --authorize-reading --output <不存在的新檔案>'}))};}
  const image=list.items[integer(flags['--image'],'image')-1];if(!image||flags['--media-selection']!==mediaSelection||!flags['--output'])throw Error('backup_cli_media_selection_expired_or_invalid');
  const result=await store.read({mediaId:image.mediaId,parent,onGuard:guard}),output=path.resolve(flags['--output']);await assertBackupPath(output);const handle=await fs.open(output,'wx',0o600);try{await handle.writeFile(result.content);await handle.sync();}finally{await handle.close();}
  return {kind:'cmcp_data_media_export',scopeId:options.scopeId,output,mediaId:result.mediaId,sha256:result.sha256,bytes:result.bytes,sourcePointer:source.pointer,originalTime:result.originalTime,activation:'none',modelCalls:0};
 }finally{await runtime.close();}
}
export async function runDataBackupCli(argv,{stdout=process.stdout,stderr=process.stderr}={}){
 const [operation,...rest]=argv;
 if(!operation||['help','--help','-h'].includes(operation)){stdout.write(DATA_HELP+'\n');return 0;}
 const flags={};for(let i=0;i<rest.length;i++){
  const key=rest[i];if(!permitted[operation]?.includes(key)||Object.hasOwn(flags,key))throw Error('backup_cli_argument_invalid_for_operation');
  if(key.startsWith('--authorize-'))flags[key]=true;else {if(!rest[i+1]||rest[i+1].startsWith('--'))throw Error('backup_cli_argument_missing');flags[key]=rest[++i];}}
 if(!permitted[operation]||!flags['--scope'])throw Error('backup_cli_operation_or_scope_required');
 const scopeId=flags['--scope'];let result;
 if(operation==='verify'){if(!flags['--backup'])throw Error('backup_cli_backup_required');result=await verifyCmcpBackup({backup:path.resolve(flags['--backup']),scopeId});}
 else if(operation==='restore'){
  if(!flags['--backup']||!flags['--target']||!flags['--authorize-restore'])throw Error('backup_cli_explicit_restore_required');
  result=await restoreCmcpData({backup:path.resolve(flags['--backup']),target:path.resolve(flags['--target']),scopeId,
   authorization:{kind:'cmcp_current_user_data_action',purpose:'restore',scopeId,confirmed:true}});
 }else{
  const options={...await configuration(flags),scopeId,authorization:{kind:'cmcp_current_user_data_action',purpose:operation,scopeId,confirmed:true}};
  if(operation==='inspect')result=await inspectCmcpData(options);
  else if(operation==='export'){if(!flags['--output']||!flags['--authorize-backup'])throw Error('backup_cli_explicit_export_required');result=await exportCmcpData({...options,output:path.resolve(flags['--output'])});}
  else result=await useRestoredData(operation,options,flags);
 }
 // read 只有明示來源閱讀才回傳正文；其餘不回顯完整設定或備份內文。
 const {data,manifest,...receipt}=result;stdout.write(JSON.stringify(receipt,null,2)+'\n');return 0;
}
