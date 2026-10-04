import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMcpConfig} from '../mcp/config.mjs';
import {noAlias} from '../project-entry/config.mjs';

export const adapterRoot=path.dirname(fileURLToPath(import.meta.url));
export const officialHermes=Object.freeze({tag:'v2026.9.24',commit:'f97608f178d1ffeca59860195ab7da295f7c8e5f',packageVersion:'0.21.5',license:'MIT',python:'>=3.11,<3.14',repository:'https://github.com/NousResearch/hermes-agent'});
const names=['kind','version','serviceConfig','python','home','model','baseUrl','credentialFile','credentialRef','nativeToolsets','timeoutSeconds','gitBash'];
export async function loadHermesConfig(file){
  file=path.resolve(file);await noAlias(file);const config=JSON.parse(await fs.readFile(file,'utf8'));
  if(config?.kind!=='cmcp_hermes_config'||config.version!==1||Object.keys(config).some(k=>!names.includes(k))||names.filter(k=>k!=='gitBash').some(k=>!Object.hasOwn(config,k)))throw Error('hermes_invalid_config');
  for(const key of ['serviceConfig','python','home','credentialFile']){if(!path.isAbsolute(config[key]))throw Error('hermes_absolute_path_required');await noAlias(config[key]);}
  if(config.gitBash){if(!path.isAbsolute(config.gitBash))throw Error('hermes_absolute_path_required');await noAlias(config.gitBash);await fs.access(config.gitBash);}
  if(config.baseUrl!=='https://api.deepseek.com'||typeof config.model!=='string'||!/^deepseek-[a-z0-9-]+$/.test(config.model)||config.credentialRef!=='DEEPSEEK_API_KEY')throw Error('hermes_existing_deepseek_route_required');
  if(!Array.isArray(config.nativeToolsets)||!config.nativeToolsets.length||config.nativeToolsets.some(x=>typeof x!=='string'||!/^[a-z][a-z0-9_-]+$/.test(x))||!Number.isSafeInteger(config.timeoutSeconds)||config.timeoutSeconds<10||config.timeoutSeconds>1800)throw Error('hermes_invalid_native_settings');
  const loaded=await loadMcpConfig(config.serviceConfig),host=loaded.shared.hosts.hermes;if(!host)throw Error('hermes_project_host_missing');
  const relative=path.relative(loaded.config.projectRoot,config.home);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('hermes_home_outside_project');
  return {file,config,service:loaded.config,shared:loaded.shared,host,scopeId:loaded.shared.scopeId};
}
export async function configureHermes({output,serviceConfig,python,home,credentialFile,gitBash,model='deepseek-flash',nativeToolsets=['terminal','file','skills'],timeoutSeconds=600}){
  const value={kind:'cmcp_hermes_config',version:1,serviceConfig:path.resolve(serviceConfig),python:path.resolve(python),home:path.resolve(home),model,baseUrl:'https://api.deepseek.com',credentialFile:path.resolve(credentialFile),credentialRef:'DEEPSEEK_API_KEY',nativeToolsets,timeoutSeconds,...(gitBash?{gitBash:path.resolve(gitBash)}:{})};
  await noAlias(path.resolve(output));await fs.writeFile(path.resolve(output),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  const loaded=await loadHermesConfig(output);await fs.mkdir(value.home,{recursive:false});
  // 專屬新 profile；不覆蓋既有 Hermes 設定，也不影響其他 profile 的外掛。
  const pluginRoot=path.join(value.home,'plugins','cmcp-continuity');await fs.mkdir(pluginRoot,{recursive:true});
  for(const name of ['__init__.py','plugin.yaml'])await fs.copyFile(path.join(adapterRoot,'plugin',name),path.join(pluginRoot,name),fs.constants.COPYFILE_EXCL);
  await fs.mkdir(path.join(pluginRoot,'skills','cmcp-continuity'),{recursive:true});await fs.copyFile(path.join(adapterRoot,'SKILL.md'),path.join(pluginRoot,'skills','cmcp-continuity','SKILL.md'),fs.constants.COPYFILE_EXCL);
  const nativeConfig={model:{default:model,provider:'custom',base_url:value.baseUrl},terminal:{backend:'local',cwd:loaded.host.workspace},security:{allow_lazy_installs:false},telemetry:{shared_metrics:{enabled:false,send:false}},plugins:{enabled:['cmcp-continuity'],stream_reasoning_deltas:false},memory:{memory_enabled:false},display:{show_reasoning:false}};
  await fs.writeFile(path.join(value.home,'config.yaml'),JSON.stringify(nativeConfig,null,2)+'\n',{flag:'wx',mode:0o600});
  return {kind:'cmcp_hermes_configured',version:1,configFile:path.resolve(output),projectId:loaded.shared.projectId,scopeId:loaded.scopeId,workspace:loaded.host.workspace,home:value.home,sessionAuthorization:'每次 chat 必須明示 --authorize-session；不自動啟用其他對話',officialHermes,modelCalls:0};
}
