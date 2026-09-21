// RC distribution check only: never opens Runtime data or calls a model.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const pkg=read('package.json'),plugin=read('.codex-plugin/plugin.json');
assert.equal(pkg.name,'@redwakame-skill/cmcp-time');assert.equal(plugin.name,'cmcp');
assert.deepEqual(pkg.bin,{'cmcp-time':'./bin/cmcp-time.mjs'});
assert.equal(pkg.publishConfig.access,'public');assert.equal(pkg.publishConfig.tag,'next');
for(const name of ['preinstall','install','postinstall','prepare','prepublish','prepublishOnly'])assert.equal(Object.hasOwn(pkg.scripts,name),false,'no automatic install/publish side effects');
assert.equal(plugin.interface.displayName,'CMCP-TIME');assert.equal(plugin.version,pkg.version);
assert.equal(plugin.skills,'./.agents/skills');
assert.equal(Object.hasOwn(plugin,'hooks'),false);
assert.equal(pkg.license,'Apache-2.0');assert.equal(plugin.license,'Apache-2.0');
const required=['bin/cmcp-time.mjs','docs/npm-installation.md','.agents/skills/cmcp-context/SKILL.md','.agents/skills/cmcp-context/scripts/recall.mjs',
 'scripts/cmcp-playground.mjs','scripts/cmcp-query-resume-command.mjs','scripts/cmcp-setup.mjs',
 'scripts/cmcp-codex-hook.mjs','scripts/cmcp-host-context-cli.mjs','scripts/cmcp-host-operation.mjs',
 'scripts/cmcp-native-host-process.mjs','scripts/cmcp-protected-credential.ps1',
 'src/cmcp-guard/cmcp-runtime-session.js','examples/setup-host.json','docs/commands.md',
 'docs/configuration.md','docs/installation-and-hosts.md','docs/read-operations-v0.1.md','LICENSE','NOTICE'];
assert.equal(new Set(pkg.files).size,pkg.files.length,'duplicate package allowlist entry');
for(const file of required)assert.ok(pkg.files.includes(file),`not packaged: ${file}`);
let imports=0;
for(const file of pkg.files){
 assert.ok(!path.isAbsolute(file)&&!file.split('/').includes('..'),'unsafe package path');
 const full=path.join(root,file),stat=fs.lstatSync(full);
 assert.ok(stat.isFile()&&!stat.isSymbolicLink(),`not an ordinary file: ${file}`);
 if(!/\.(mjs|js)$/.test(file))continue;
 const text=fs.readFileSync(full,'utf8');
 for(const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)){
  const dep=path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1]));
  assert.ok(pkg.files.includes(dep),`unpackaged dependency: ${file} -> ${dep}`);imports++;
 }
}
const manifest=read('PUBLIC-FILES.json');assert.equal(manifest.version,pkg.version);
assert.deepEqual(manifest.files.map(row=>row.path).sort(),pkg.files.filter(file=>file!=='PUBLIC-FILES.json').sort());
for(const row of manifest.files){const bytes=fs.readFileSync(path.join(root,row.path));assert.equal(bytes.length,row.bytes,`size mismatch: ${row.path}`);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,`hash mismatch: ${row.path}`);}
assert.equal(Object.hasOwn(read('skills/cmcp-core/_meta.json'),'openclaw'),false);
console.log(JSON.stringify({status:'pass',version:pkg.version,files:pkg.files.length,relativeImports:imports,modelCalls:0}));
