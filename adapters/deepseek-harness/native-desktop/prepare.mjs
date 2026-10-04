import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const NATIVE='adapters/deepseek-harness/native-desktop';
const SOURCE=fileURLToPath(new URL('../../../',import.meta.url));
const HASH=/^[a-f0-9]{64}$/u;
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Error(code);};
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');

/** 只建立新部署；不修改 Desktop profile、既有部署、Session 授權或宿主程序。 */
export function createDesktopPreparer({io=fs,packageRoot=SOURCE}={}){
  async function ordinary(file,kind){
    if(typeof file!=='string'||!path.isAbsolute(file))fail('cmcp_prepare_absolute_path_required');
    const resolved=path.resolve(file);let cursor=resolved,first=true;
    for(;;){
      const stat=await io.lstat(cursor),real=await io.realpath(cursor);
      if(stat.isSymbolicLink()||!same(real,cursor))fail('cmcp_prepare_path_alias_refused');
      const expectedFile=first&&kind==='file';
      if(expectedFile?!stat.isFile():!stat.isDirectory())fail('cmcp_prepare_path_kind_invalid');
      if(first&&kind==='file'&&stat.nlink!==1)fail('cmcp_prepare_hardlink_refused');
      const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;first=false;
    }
    return resolved;
  }
  async function absent(file){try{await io.lstat(file);fail('cmcp_prepare_target_exists');}catch(error){if(error.code!=='ENOENT')throw error;}}
  async function read(file,limit){
    await ordinary(file,'file');const stat=await io.stat(file);if(stat.size>limit)fail('cmcp_prepare_size_limit');
    const value=await io.readFile(file);if(value.length>limit)fail('cmcp_prepare_size_limit');return value;
  }
  async function source(){
    const root=await ordinary(packageRoot,'directory'),indexBytes=await read(path.join(root,'PUBLIC-FILES.json'),2*1024*1024);
    let index;try{index=JSON.parse(indexBytes);}catch{fail('cmcp_prepare_index_invalid');}
    if(index.kind!=='cmcp-time-public-source-allowlist'||!Array.isArray(index.files)||!index.files.length||index.files.length>1000)fail('cmcp_prepare_index_invalid');
    const entries=[],seen=new Set();let total=0;
    for(const entry of index.files){
      const rel=entry.path;
      if(typeof rel!=='string'||rel==='PUBLIC-FILES.json'||/[\\:\x00-\x1f]/u.test(rel)||rel.startsWith('/')
        ||rel.split('/').some(v=>!v||v==='.'||v==='..'||/[. ]$/u.test(v)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(v))
        ||seen.has(rel.toLowerCase())||!HASH.test(entry.sha256??'')||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)fail('cmcp_prepare_index_path_invalid');
      seen.add(rel.toLowerCase());const content=await read(path.join(root,...rel.split('/')),16*1024*1024);
      if(content.length!==entry.bytes||digest(content)!==entry.sha256)fail('cmcp_prepare_member_mismatch');
      total+=content.length;if(total>64*1024*1024)fail('cmcp_prepare_size_limit');entries.push({path:rel,bytes:entry.bytes,sha256:entry.sha256,content});
    }
    for(const required of [NATIVE+'/host.mjs',NATIVE+'/client.js',NATIVE+'/SKILL.md','package.json'])if(!seen.has(required.toLowerCase()))fail('cmcp_prepare_dependency_missing');
    // 靜態相對依賴須在同一索引中；不執行套件，也不安裝或複製第三方依賴。
    for(const entry of entries.filter(row=>/\.(?:mjs|js|cjs)$/u.test(row.path))){
      for(const match of entry.content.toString('utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.[^'"\r\n]+)\1/gu)){
        const rel=path.posix.normalize(path.posix.join(path.posix.dirname(entry.path),match[2]));
        if(rel.startsWith('../')||!seen.has(rel.toLowerCase()))fail('cmcp_prepare_dependency_missing');
      }
    }
    let pkg;try{pkg=JSON.parse(entries.find(v=>v.path==='package.json').content);}catch{fail('cmcp_prepare_package_invalid');}
    if(pkg.name!=='@redwakame-skill/cmcp-time'||pkg.version!==index.version)fail('cmcp_prepare_package_invalid');
    return {root,indexBytes,entries,version:pkg.version,indexSha256:digest(indexBytes),total};
  }
  async function llm(file){
    if(typeof file!=='string'||!path.isAbsolute(file))fail('cmcp_prepare_absolute_path_required');
    const resolved=path.resolve(file),parts=resolved.split(path.sep),asarAt=parts.findIndex(v=>v.toLowerCase()==='app.asar');
    const suffix=['dsh','node_modules','@deepseek-ai','dsh-llm','lib','index.js'];
    if(asarAt>=0){
      if(parts.slice(asarAt+1).join('/')!==suffix.join('/'))fail('cmcp_prepare_llm_module_invalid');
      const archive=parts.slice(0,asarAt+1).join(path.sep);await ordinary(archive,'file');
      return {path:resolved,kind:'desktop-asar-module',archive,loadState:'host_load_not_verified'};
    }
    if(parts.slice(-4).join('/')!=='@deepseek-ai/dsh-llm/lib/index.js')fail('cmcp_prepare_llm_module_invalid');
    await ordinary(resolved,'file');return {path:resolved,kind:'physical-module',loadState:'host_load_not_verified'};
  }
  async function prepare(input){
    const keys=['workspace','scope','timezone','llmModule','saveUser','saveAssistant'];
    if(!input||Object.keys(input).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(input,key)))fail('cmcp_prepare_arguments_invalid');
    if(typeof input.scope!=='string'||!input.scope.trim()||input.scope!==input.scope.trim()||input.scope.length>256||/[\x00-\x1f\x7f]/u.test(input.scope))fail('cmcp_prepare_scope_invalid');
    if(typeof input.timezone!=='string'||!input.timezone||/^[+-]/u.test(input.timezone))fail('cmcp_prepare_timezone_invalid');
    try{new Intl.DateTimeFormat('zh-TW',{timeZone:input.timezone}).format(0);}catch{fail('cmcp_prepare_timezone_invalid');}
    if(typeof input.saveUser!=='boolean'||typeof input.saveAssistant!=='boolean')fail('cmcp_prepare_save_choice_required');
    const workspace=await ordinary(input.workspace,'directory'),deployment=path.join(workspace,'cmcp-desktop-native');
    await absent(deployment);const module=await llm(input.llmModule),snapshot=await source();
    // 所有來源及必要設定均通過後才建立目的地；部分寫入失敗保留原件，不刪除或重用。
    await ordinary(workspace,'directory');await absent(deployment);await io.mkdir(deployment);await ordinary(deployment,'directory');
    async function write(relative,content){
      const target=path.join(deployment,...relative.split('/')),parent=path.dirname(target);
      let current=deployment;
      for(const part of path.relative(deployment,parent).split(path.sep).filter(Boolean)){
        current=path.join(current,part);try{await io.mkdir(current);}catch(error){if(error.code!=='EEXIST')throw error;}await ordinary(current,'directory');
      }
      await ordinary(parent,'directory');await io.writeFile(target,content,{flag:'wx'});
      const actual=await read(target,16*1024*1024);if(digest(actual)!==digest(content))fail('cmcp_prepare_write_verification_failed');
    }
    for(const entry of snapshot.entries)await write('product/'+entry.path,entry.content);
    await write('product/PUBLIC-FILES.json',snapshot.indexBytes);
    const config={kind:'cmcp_runtime_config',version:1,runtimeId:'desktop-native-'+digest(input.scope).slice(0,20),providerMode:'host',
      input:{root:'state/history',scopeId:input.scope,events:[],timezone:input.timezone,
        limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},
        storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
      receiptRoot:'state/receipts',sourceAuthorization:{saveUser:input.saveUser,saveAssistant:input.saveAssistant},
      controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true},bufferRetention:{hours:12},discussionAssociation:{enabled:true}};
    const options={workspaceRoot:workspace,deploymentRoot:deployment,runtimeConfig:path.join(deployment,'runtime-config.json'),
      traceRoot:path.join(deployment,'state/trace'),scopeId:input.scope,skillPath:path.join(deployment,'product',NATIVE,'SKILL.md'),
      llmModulePath:module.path,areaInfo:{id:'desktop-native-workspace',label:'官方 Desktop 工作區專屬 CMCP；每個對話需啟用',kind:'workspace'},acceptanceSessionIds:[]};
    await write('runtime-config.json',json(config));await write('plugin-options.json',json(options));
    const receipt={kind:'cmcp_desktop_prepare_result',version:1,state:'prepared-not-registered',at:new Date().toISOString(),workspace,deploymentRoot:deployment,
      scopeId:input.scope,timezone:input.timezone,sourceAuthorization:config.sourceAuthorization,packageVersion:snapshot.version,packageIndexSha256:snapshot.indexSha256,
      productFiles:snapshot.entries.length+1,productBytes:snapshot.total+snapshot.indexBytes.length,module,
      runtimeConfigSha256:digest(json(config)),pluginOptionsSha256:digest(json(options)),profileChanged:false,sessionAuthorized:false,modelCalls:0,
      limitations:['尚未登錄或由 Desktop 載入；需另行核對 profile 前像再登錄。','只複製索引中的產品檔案，不包含 node_modules；其他 CLI 需使用完整安裝的套件。','失敗時保留已建立的部分目錄，不會自動清除或覆寫。']};
    await write('prepare-receipt.json',json(receipt));return receipt;
  }
  return {prepare};
}

export const prepareDesktop=createDesktopPreparer().prepare;
