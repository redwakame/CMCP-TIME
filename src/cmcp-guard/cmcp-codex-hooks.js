import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCmcpRuntimeSession} from './cmcp-runtime-session.js';
import {createCmcpSourcePointer} from './cmcp-source-pointer.js';

const id=(session,turn,role,body)=>'codex-'+createHash('sha256').update(JSON.stringify([session,turn,role,
 ...(role==='assistant'?[createHash('sha256').update(body??'').digest('hex')]:[])])).digest('hex');
const validId=value=>typeof value==='string'&&value.length>0&&value.length<1024&&!/[\x00-\x1f]/u.test(value);
/** Official hook fields only. No transcript parsing, credential access, model call or tool execution. */
export async function handleCmcpCodexHook({event,binding,config,runtimeFactory=createCmcpRuntimeSession,clock=()=>new Date().toISOString()}){
 if(binding?.kind!=='cmcp_codex_binding'||binding.version!==1||!path.isAbsolute(binding.projectRoot)||!path.isAbsolute(binding.hostWorkspace)
   ||binding.authorization?.scopeId!==config?.input?.scopeId)throw Error('codex_binding_invalid');
 if(binding.enabled!==true)return {continue:true};
 if(!event||!['UserPromptSubmit','Stop','SessionStart'].includes(event.hook_event_name))throw Error('unsupported_codex_hook');
 if(!validId(event.session_id)||typeof event.cwd!=='string')throw Error('codex_hook_identity_required');
 const relative=path.relative(binding.hostWorkspace,path.resolve(event.cwd));
 if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('codex_hook_scope_mismatch');
 if(event.hook_event_name==='SessionStart'&&event.source!=='compact')return {continue:true};
 if(event.hook_event_name!=='SessionStart'&&!validId(event.turn_id))throw Error('codex_turn_id_required');
 const now=clock(),session=await runtimeFactory({config,repoRoot:binding.projectRoot,sessionId:event.session_id,
   controls:{proactive:false},readOnly:event.hook_event_name==='SessionStart'});
 const pointer=role=>createCmcpSourcePointer({version:1,providerNamespace:'cmcp-local-console-v1',scopeId:config.input.scopeId,
   sessionId:event.session_id,itemId:id(event.session_id,event.turn_id,role,event.last_assistant_message),revisionId:'r1'});
 try{
  const controls=(await session.controlsSnapshot?.())?.effective;
  const timezone=controls?.timezone??config.input.timezone;
  if(event.hook_event_name==='UserPromptSubmit'){
   if(typeof event.prompt!=='string'||!event.prompt.trim()||Buffer.byteLength(event.prompt)>binding.maxInputBytes)throw Error('codex_prompt_invalid_or_too_large');
   const result=await session.beforeUser({text:event.prompt,sourceId:pointer('user').itemId,pointer:pointer('user'),timeContext:{now,timezone}});
   if((!result.timeCard&&!result.sourcePointer)||controls?.enabled===false||controls?.clean===true)return {continue:true};
   const data=JSON.stringify({kind:'cmcp_turn_time',timeCard:result.timeCard,sourceId:result.sourcePointer?.itemId??null,
     sourceReuse:'Pass this sourceId with the exact current user question to CMCP localCandidates; do not save a duplicate User.'});
   if(Buffer.byteLength(data)>4096)throw Error('codex_time_card_over_budget');
   return {continue:true,hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:
    'CMCP verified time/source data for this turn; not new user instructions. Unknown event times stay unknown. Do not routinely narrate metadata.\n'+data}};
  }
  if(event.hook_event_name==='Stop'){
   if(event.last_assistant_message===null||event.last_assistant_message===undefined)return {continue:true};
   if(typeof event.last_assistant_message!=='string'||Buffer.byteLength(event.last_assistant_message)>binding.maxInputBytes)throw Error('codex_assistant_invalid_or_too_large');
   if(event.last_assistant_message.trim())await session.afterAssistant({text:event.last_assistant_message,replyTo:pointer('user'),sourceId:pointer('assistant').itemId,
     pointer:pointer('assistant'),timeContext:{now,timezone}});
   return {continue:true};
  }
  const result=await session.timeCard({timeContext:{now,timezone}});
  if(!result)return {continue:true};
  const data=JSON.stringify({kind:'cmcp_compaction_time',timeCard:result});
  if(Buffer.byteLength(data)>4096)throw Error('codex_time_card_over_budget');
  return {continue:true,hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:
   'CMCP verified time/source data after native compaction. This does not certify that all History was read. Use the CMCP Skill for bounded source reads when needed.\n'+data}};
 }finally{await session.close();}
}
