// Distribution integrity check only: never opens Runtime data or calls a model.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {requireCmcpNodeVersion} from '../src/cmcp-guard/cmcp-node-version.js';
requireCmcpNodeVersion();
const root=fileURLToPath(new URL('../',import.meta.url));
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const pkg=read('package.json'),plugin=read('.codex-plugin/plugin.json');
assert.equal(pkg.name,'@redwakame-skill/cmcp-time');assert.equal(plugin.name,'cmcp');
assert.deepEqual(pkg.bin,{'cmcp-time':'./bin/cmcp-time.mjs'});
assert.equal(pkg.publishConfig.access,'public');assert.equal(pkg.publishConfig.tag,'latest');
for(const name of ['preinstall','install','postinstall','prepare','prepublish','prepublishOnly'])assert.equal(Object.hasOwn(pkg.scripts,name),false,'no automatic install/publish side effects');
assert.equal(plugin.interface.displayName,'CMCP-TIME');assert.equal(plugin.version,pkg.version);
assert.equal(plugin.skills,'./.agents/skills');
assert.equal(Object.hasOwn(plugin,'hooks'),false);
assert.equal(pkg.license,'Apache-2.0');assert.equal(plugin.license,'Apache-2.0');
assert.equal(pkg.engines.node,'>=22.16.0','套件最低 Node 宣告不同');
if(fs.existsSync(path.join(root,'package-lock.json'))){const lock=read('package-lock.json');
 assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);
 assert.equal(lock.packages[''].engines.node,pkg.engines.node,'lockfile 最低 Node 不一致');}
const required=['bin/cmcp-time.mjs','docs/npm-installation.md','.agents/skills/cmcp-context/SKILL.md','.agents/skills/cmcp-context/scripts/recall.mjs',
 'scripts/cmcp-playground.mjs','scripts/cmcp-query-resume-command.mjs','scripts/cmcp-setup.mjs',
 'scripts/cmcp-codex-hook.mjs','scripts/cmcp-host-context-cli.mjs','scripts/cmcp-host-operation.mjs',
 'scripts/cmcp-native-host-process.mjs','scripts/cmcp-protected-credential.ps1',
 'src/cmcp-guard/cmcp-runtime-session.js','examples/setup-host.json','docs/commands.md',
 'docs/configuration.md','docs/installation-and-hosts.md','docs/read-operations-v0.1.md','LICENSE','NOTICE',
 'adapters/control/contract.mjs','adapters/project-entry/cli.mjs','adapters/shared-project/service.mjs',
 'adapters/codex/shared-project/read-cli.mjs','adapters/deepseek-harness/native-desktop/host.mjs',
 'adapters/deepseek-harness/native-desktop/client.js','adapters/deepseek-harness/native-desktop/package.json','docs/local-delivery.zh-TW.md',
 'adapters/mcp/cli.mjs','adapters/mcp/auth.mjs','adapters/mcp/tools.mjs','adapters/hermes/cli.mjs',
 'docs/interop.zh-TW.md','docs/interop.en.md','docs/interop.es.md','docs/interop.ja.md'];
for(const [name,version]of Object.entries({'@modelcontextprotocol/sdk':'1.32.0',zod:'4.6.5',jose:'6.2.12'})){
 assert.equal(pkg.dependencies?.[name],version,'互通正式相依須固定版本：'+name);
 const lock=read('npm-shrinkwrap.json');assert.equal(lock.packages[''].dependencies?.[name],version,'散布 lock 與直接相依不同：'+name);
}
assert.equal(new Set(pkg.files).size,pkg.files.length,'duplicate package allowlist entry');
assert.equal(new Set(pkg.files.map(file=>file.normalize('NFC').toLowerCase())).size,pkg.files.length,'套件路徑正規化碰撞');
for(const file of required)assert.ok(pkg.files.includes(file),`not packaged: ${file}`);
let imports=0;
for(const file of pkg.files){
 assert.ok(!path.isAbsolute(file)&&!file.includes('\\')&&!file.includes(':')&&file.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part===part.normalize('NFC')&&!/[. ]$/.test(part)),'unsafe package path');
 assert.ok(!file.split('/').some(part=>/^(?:logs?|private|credentials?|secrets?|sessions?|sdk-home|node_modules|\.git|fixtures?|tests?|test-runs|__pycache__)$/i.test(part))&&!/\.(?:zip|tgz|asar|sqlite|db)$/i.test(file),'套件含非公開資料範圍');
 assert.ok(!file.startsWith('adapters/')||!file.includes('.test.'),'宿主測試不列為正式套件資產');
 const full=path.join(root,file),stat=fs.lstatSync(full);
 assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1,`not an ordinary file: ${file}`);
 for(let parent=path.dirname(full);parent!==path.resolve(root);parent=path.dirname(parent))assert.ok(!fs.lstatSync(parent).isSymbolicLink(),`套件祖先路徑別名：${file}`);
 if(!/\.(mjs|js)$/.test(file))continue;
 const text=fs.readFileSync(full,'utf8');
 const specs=new Set([...text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.{1,2}\/[^'"\r\n]+)['"]/g),...text.matchAll(/^\s*import\s*['"](\.{1,2}\/[^'"\r\n]+)['"]/gm)].map(match=>match[1]));
 for(const match of text.matchAll(/new URL\(\s*['"](\.{1,2}\/[^'"\r\n]+)['"]\s*,\s*import\.meta\.url\s*\)/g))if(!match[1].endsWith('/'))specs.add(match[1]);
 for(const spec of specs){
  const dep=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
  assert.ok(pkg.files.includes(dep),`unpackaged dependency: ${file} -> ${dep}`);imports++;
 }
}
const manifest=read('PUBLIC-FILES.json');assert.equal(manifest.version,pkg.version);
assert.equal(manifest.buildScope,'formal-release-source','此 gate 核對 0.1.0 正式來源；不代替遠端發布回執');
assert.equal(manifest.nodeCompatibility.declared,pkg.engines.node);
assert.equal(manifest.nodeCompatibility.currentIncrementMinimumRuntimeTested,false,'本單不得預填最低 Node 已驗');
assert.deepEqual(manifest.files.map(row=>row.path).sort(),pkg.files.filter(file=>file!=='PUBLIC-FILES.json').sort());
for(const row of manifest.files){const bytes=fs.readFileSync(path.join(root,row.path));assert.equal(bytes.length,row.bytes,`size mismatch: ${row.path}`);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,`hash mismatch: ${row.path}`);}
assert.equal(Object.hasOwn(read('skills/cmcp-core/_meta.json'),'openclaw'),false);
console.log(JSON.stringify({status:'pass',version:pkg.version,files:pkg.files.length,relativeImports:imports,modelCalls:0}));
