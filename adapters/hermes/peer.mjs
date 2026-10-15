import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadHermesConfig} from './config.mjs';
import {runHarnessTurn} from '../project-entry/harness-driver.mjs';
import {noAlias} from '../project-entry/config.mjs';

/** 同一外部 broker 的既有 Harness 正常 driver；不啟動第二個 broker 或複製 History。 */
export async function configureHarnessPeer({hermesConfig,executable,cli,output}){
  const loaded=await loadHermesConfig(hermesConfig);if(!loaded.shared.hosts.harness)throw Error('hermes_harness_peer_not_configured');
  for(const file of [executable,cli])if(typeof file!=='string'||!path.isAbsolute(file))throw Error('hermes_peer_absolute_path_required');
  await noAlias(executable);await fs.access(executable);
  const value={kind:'cmcp_hermes_harness_peer',version:1,hermesConfig:loaded.file,executable:path.resolve(executable),cli:path.resolve(cli)};
  await noAlias(path.resolve(output));await fs.writeFile(path.resolve(output),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  return {kind:'cmcp_hermes_harness_peer_configured',version:1,configFile:path.resolve(output),projectId:loaded.shared.projectId,scopeId:loaded.scopeId,hostId:'harness',workspace:loaded.shared.hosts.harness.workspace,modelCalls:0};
}
export async function runHarnessPeer({configFile,text,sessionId='harness-peer-'+randomUUID(),signal,onEvent=()=>{},driver=runHarnessTurn}){
  await noAlias(path.resolve(configFile));
  const peer=JSON.parse(await fs.readFile(configFile,'utf8'));if(peer?.kind!=='cmcp_hermes_harness_peer'||peer.version!==1||Object.keys(peer).some(k=>!['kind','version','hermesConfig','executable','cli'].includes(k)))throw Error('hermes_peer_invalid_config');
  for(const key of ['hermesConfig','executable','cli'])if(typeof peer[key]!=='string'||!path.isAbsolute(peer[key]))throw Error('hermes_peer_absolute_path_required');
  if(typeof sessionId!=='string'||!sessionId.trim()||sessionId.length>200||typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>524288)throw Error('hermes_peer_invalid_input');
  await noAlias(peer.executable);await fs.access(peer.executable);if(signal?.aborted)throw Error('hermes_cancelled');
  const loaded=await loadHermesConfig(peer.hermesConfig);if(!loaded.shared.hosts.harness)throw Error('hermes_harness_peer_not_configured');
  const base=path.join(loaded.service.projectRoot,'harness-peer'),config={projectId:loaded.shared.projectId,profileName:'cmcp-interop-peer',sdkHome:path.join(base,'sdk-home'),evidenceRoot:path.join(base,'receipts'),turnDeadlineMs:loaded.config.timeoutSeconds*1000,
    hosts:{harness:{executable:peer.executable,cli:peer.cli,route:{provider:loaded.config.provider==='groq'?'groq':'deepseek-official',model:loaded.config.model},credentials:{path:loaded.config.credentialFile,reference:loaded.config.credentialRef}}}};
  return driver({config,shared:loaded.shared,text,signal,onEvent,sessionId});
}
