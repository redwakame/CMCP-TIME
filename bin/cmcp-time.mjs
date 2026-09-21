#!/usr/bin/env node
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const help=`CMCP-TIME — source-preserving temporal continuity
Usage: cmcp-time <command> [options]

  help | --help       Show this command index (no model calls)
  version | --version Show the installed package version
  setup               Interactive explicit setup; --answers <file> is optional
  update              Refresh managed setup/Host bindings; does not install npm updates
  disable             Detach automatic Host hooks; retain data and manual Skill
  uninstall           Remove unchanged managed Host bindings/Skill; retain data
  status              Inspect Runtime data and remaining authorization (zero API)
  playground          Chat and manage READ, Buffer, controls and Pins
  context             Advanced Host context helper (no second Runtime)

Data commands require --workspace <existing persistent directory> for npm installs.
Setup/playground/status default --root local-data/cmcp, relative to that workspace.
Use setup --help or playground --help for their strict options.
Install does not attach a Host, open History, authorize paid calls or enable proactive delivery.
Use a persistent npm prefix; npx cache-based Host installation is not supported.
Uninstall here detaches CMCP Host bindings, not the npm package or retained History.`;
const [command='help',...args]=process.argv.slice(2);
try {
  if(['help','--help','-h','version','--version','-v'].includes(command)) {
    if(args.length)throw Error('unexpected_arguments');
    if(['version','--version','-v'].includes(command)) {
      const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
      console.log(`CMCP-TIME ${pkg.version} (${pkg.name})`);
    } else console.log(help);
  } else if(['setup','update','disable','uninstall'].includes(command)) {
    const {runCmcpSetupCli}=await import('../scripts/cmcp-setup.mjs');
    await runCmcpSetupCli(command==='setup'?args:[...args,'--'+command]);
  } else if(['playground','status'].includes(command)) {
    if(command==='status') {
      const {parseArgs}=await import('node:util');
      // Inspection accepts only read-only options, never another action's grant or initialization flags.
      parseArgs({args,options:{workspace:{type:'string'},root:{type:'string'},json:{type:'boolean'},help:{type:'boolean'}}});
    }
    const forwarded=[...args];
    if(!args.some(a=>a==='--root'||a.startsWith('--root=')))forwarded.push('--root','local-data/cmcp');
    if(command==='status')forwarded.push('--status');
    // Initialization belongs to explicit setup; a typo must not silently create another data root.
    if(!args.includes('--help')) {
      const {parseArgs}=await import('node:util');
      const {resolveCmcpWorkspaceRoot,cmcpWorkspacePath}=await import('../src/cmcp-guard/cmcp-project-paths.js');
      const {values}=parseArgs({args:forwarded,strict:false,options:{workspace:{type:'string'},root:{type:'string'}}});
      const workspace=resolveCmcpWorkspaceRoot(values.workspace);
      await fs.access(cmcpWorkspacePath(workspace,`${values.root}/config.json`)).catch(()=>{throw Error('configuration_missing_run_setup_first');});
    }
    process.argv=[process.execPath,fileURLToPath(new URL('../scripts/cmcp-playground.mjs',import.meta.url)),...forwarded];
    await import('../scripts/cmcp-playground.mjs');
  } else if(command==='context') {
    const {runCmcpHostContextCli}=await import('../scripts/cmcp-host-context-cli.mjs');
    await runCmcpHostContextCli(args);
  } else throw Error('unknown_command:'+command);
} catch(error) {console.error('CMCP-TIME: '+error.message);process.exitCode=1;}
