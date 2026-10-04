import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadProject} from './config.mjs';
import {normalizeCmcpRuntimeConfig,recoverCmcpRuntimeWork} from '../../src/cmcp-guard/cmcp-runtime-session.js';
import {createCmcpRuntimeWorkJournal,isCmcpProcessAlive} from '../../src/cmcp-guard/cmcp-runtime-work.js';

/** 正式工作清冊只提供待處理身分；查看不執行恢復、不建 grant、不呼叫模型。 */
export async function inspectProjectRecovery(configFile){
  const loaded=await loadProject(configFile),raw=JSON.parse(await fs.readFile(loaded.shared.runtimeConfig,'utf8'));
  const {config,binding}=normalizeCmcpRuntimeConfig(raw,{repoRoot:loaded.config.projectRoot});
  const rows=(await createCmcpRuntimeWorkJournal({root:config.input.root,binding}).list()).filter(row=>['running','cancelling'].includes(row.state)).sort((a,b)=>a.at.localeCompare(b.at)||a.workId.localeCompare(b.workId));
  const work=rows.map((row,index)=>({option:index+1,workId:row.workId,sessionId:row.sessionId,state:row.state,mode:row.mode,startedAt:row.at,ownerPid:row.ownerPid,ownerAlive:isCmcpProcessAlive(row.ownerPid),remoteOutcome:row.terminal?.remoteOutcome??'unknown'}));
  const snapshot=createHash('sha256').update(JSON.stringify({binding,projectId:loaded.config.projectId,work})).digest('hex');
  return {kind:'cmcp_project_recovery_options',projectId:loaded.config.projectId,scopeId:config.input.scopeId,projectRoot:loaded.config.projectRoot,snapshot,work,modelCalls:0,executionRetried:false};
}
export async function recoverProjectWork({configFile,option,snapshot}){
  if(!Number.isSafeInteger(option)||option<1||typeof snapshot!=='string')throw Error('project_recovery_selection_required');
  const current=await inspectProjectRecovery(configFile);if(current.snapshot!==snapshot)throw Error('project_recovery_options_changed');
  const work=current.work.find(row=>row.option===option);if(!work)throw Error('project_recovery_option_missing');if(work.ownerAlive)throw Error('work_owner_still_alive');
  const loaded=await loadProject(configFile),config=JSON.parse(await fs.readFile(loaded.shared.runtimeConfig,'utf8'));
  const result=await recoverCmcpRuntimeWork({config,repoRoot:loaded.config.projectRoot,workId:work.workId,reason:'explicit_project_recovery'});
  return {kind:'cmcp_project_recovery_result',projectId:current.projectId,scopeId:current.scopeId,result,after:await inspectProjectRecovery(configFile),executionRetried:false,modelCalls:0};
}
