import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMcpConfig} from '../mcp/config.mjs';
import {noAlias} from '../project-entry/config.mjs';

export const adapterRoot=path.dirname(fileURLToPath(import.meta.url));
export const officialHermes=Object.freeze({tag:'v2026.9.24',commit:'f97608f178d1ffeca59860195ab7da295f7c8e5f',packageVersion:'0.21.5',license:'MIT',python:'>=3.11,<3.14',repository:'https://github.com/NousResearch/hermes-agent'});
const names=['kind','version','serviceConfig','python','home','model','baseUrl','credentialFile','credentialRef','nativeToolsets','timeoutSeconds','gitBash','provider','readMaxPages'];
const validateReadMaxPages=value=>{if(value!==undefined&&(!Number.isInteger(value)||value<1||value>2))throw Error('hermes_invalid_read_max_pages');};
function validateRoute(config){
  const provider=config.provider===undefined?'deepseek':config.provider;
  if(provider==='deepseek'){
    if(config.baseUrl!=='https://api.deepseek.com'||typeof config.model!=='string'||!/^deepseek-[a-z0-9-]+$/.test(config.model)||config.credentialRef!=='DEEPSEEK_API_KEY')throw Error('hermes_existing_deepseek_route_required');
  }else if(provider==='groq'){
    if(config.baseUrl!=='https://api.groq.com/openai/v1'||typeof config.model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(config.model)
      ||typeof config.credentialRef!=='string'||!/^[A-Z][A-Z0-9_]{1,127}$/.test(config.credentialRef)||config.credentialRef==='DEEPSEEK_API_KEY')throw Error('hermes_explicit_groq_route_required');
  }else throw Error('hermes_unsupported_provider');
}
export async function loadHermesConfig(file){
  file=path.resolve(file);await noAlias(file);const config=JSON.parse(await fs.readFile(file,'utf8'));
  if(config?.kind!=='cmcp_hermes_config'||config.version!==1||Object.keys(config).some(k=>!names.includes(k))||names.filter(k=>!['gitBash','provider','readMaxPages'].includes(k)).some(k=>!Object.hasOwn(config,k)))throw Error('hermes_invalid_config');
  validateReadMaxPages(config.readMaxPages);
  for(const key of ['serviceConfig','python','home','credentialFile']){if(!path.isAbsolute(config[key]))throw Error('hermes_absolute_path_required');await noAlias(config[key]);}
  if(config.gitBash){if(!path.isAbsolute(config.gitBash))throw Error('hermes_absolute_path_required');await noAlias(config.gitBash);await fs.access(config.gitBash);}
  validateRoute(config);
  if(!Array.isArray(config.nativeToolsets)||!config.nativeToolsets.length||config.nativeToolsets.some(x=>typeof x!=='string'||!/^[a-z][a-z0-9_-]+$/.test(x))||!Number.isSafeInteger(config.timeoutSeconds)||config.timeoutSeconds<10||config.timeoutSeconds>1800)throw Error('hermes_invalid_native_settings');
  const loaded=await loadMcpConfig(config.serviceConfig),host=loaded.shared.hosts.hermes;if(!host)throw Error('hermes_project_host_missing');
  const relative=path.relative(loaded.config.projectRoot,config.home);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('hermes_home_outside_project');
  return {file,config,service:loaded.config,shared:loaded.shared,host,scopeId:loaded.shared.scopeId};
}
export async function configureHermes({output,serviceConfig,python,home,credentialFile,gitBash,provider,credentialRef,model,readMaxPages,nativeToolsets=['terminal','file','skills'],timeoutSeconds=600}){
  validateReadMaxPages(readMaxPages);
  const groq=provider==='groq';model=model??(groq?undefined:'deepseek-flash');
  const value={kind:'cmcp_hermes_config',version:1,serviceConfig:path.resolve(serviceConfig),python:path.resolve(python),home:path.resolve(home),model,baseUrl:groq?'https://api.groq.com/openai/v1':'https://api.deepseek.com',credentialFile:path.resolve(credentialFile),credentialRef:credentialRef??(groq?undefined:'DEEPSEEK_API_KEY'),nativeToolsets,timeoutSeconds,...(gitBash?{gitBash:path.resolve(gitBash)}:{}),...(provider===undefined?{}:{provider}),...(readMaxPages===undefined?{}:{readMaxPages})};
  validateRoute(value);
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
