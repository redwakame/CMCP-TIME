import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {handleCmcpCodexHook} from '../src/cmcp-guard/cmcp-codex-hooks.js';
import {playgroundPath} from '../src/cmcp-guard/cmcp-playground.js';
import {resolveCmcpWorkspaceRoot} from '../src/cmcp-guard/cmcp-project-paths.js';
const packageRoot=fileURLToPath(new URL('../',import.meta.url));
let receiptRoot,event;
async function receipt(stage,extra={}){
 if(!receiptRoot)return;
 await fs.mkdir(receiptRoot,{recursive:true});
 await fs.writeFile(path.join(receiptRoot,randomUUID()+'.json'),JSON.stringify({kind:'cmcp_codex_hook_receipt',stage,at:new Date().toISOString(),pid:process.pid,
  eventName:typeof event?.hook_event_name==='string'?event.hook_event_name:null,cwd:typeof event?.cwd==='string'?event.cwd:null,
  sessionId:typeof event?.session_id==='string'?event.session_id:null,turnId:typeof event?.turn_id==='string'?event.turn_id:null,
  inputShape:event&&typeof event==='object'?Object.fromEntries(Object.entries(event).map(([key,value])=>[key,value===null?'null':typeof value])):null,...extra},null,2),{flag:'wx'});
}
try{
 const {values:a}=parseArgs({options:{binding:{type:'string'},workspace:{type:'string'}}});
 const projectRoot=resolveCmcpWorkspaceRoot(a.workspace);
 const file=await playgroundPath(projectRoot,a.binding),binding=JSON.parse(await fs.readFile(file,'utf8'));
 if(path.resolve(binding.projectRoot)!==path.resolve(projectRoot))throw Error('hook_binding_project_mismatch');
 if(binding.packageRoot!==undefined){if(await fs.realpath(binding.packageRoot)!==await fs.realpath(packageRoot))throw Error('hook_binding_package_mismatch');}
 else if(await fs.realpath(projectRoot)!==await fs.realpath(packageRoot))throw Error('legacy_hook_binding_requires_same_root');
 const configFile=await playgroundPath(projectRoot,binding.runtimeConfig),config=JSON.parse(await fs.readFile(configFile,'utf8'));
 receiptRoot=await playgroundPath(projectRoot,path.join(config.receiptRoot,'host-hooks'));
 let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>131072)throw Error('hook_input_over_budget');}
 event=JSON.parse(input);await receipt('started');
 const result=await handleCmcpCodexHook({event,binding,config});
 await receipt('completed',{outputBytes:Buffer.byteLength(JSON.stringify(result)),timeCardProjected:Boolean(result.hookSpecificOutput?.additionalContext)});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){
 const candidateCode=error.code??(/^[a-z][a-z0-9_]+(?=:|$)/u.exec(error.message)?.[0]??'hook_runtime_failure');
 const code=typeof candidateCode==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/u.test(candidateCode)?candidateCode:'hook_runtime_failure';
 try{await receipt('failed',{code});}catch{}
 // Do not echo provider data, prompt, response, path contents or the raw incoming hook event.
 process.stderr.write('CMCP hook did not complete: '+code+'\n');
 process.exitCode=1;
}
