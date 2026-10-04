import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {callSharedProject, MODEL_OPERATIONS, MODEL_TEXT_PROFILE, validatePipe} from '../../shared-project/client.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw Error(code); };
const record = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('codex_shared_invalid_schema');
};
const id = value => {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024 || /[\x00-\x1f\x7f]/.test(value)) fail('codex_shared_invalid_id');
  return value;
};
export const safeError = error => /^[a-z][a-z0-9_]{1,100}$/.test(error?.message) ? error.message : 'codex_shared_operation_failed';
export async function validateBinding(binding, role) {
  record(binding, ['kind','version','projectId','hostId','agentId','workspace','role','connection']);
  if (binding.kind !== 'cmcp_codex_shared_binding' || binding.version !== 1 || binding.hostId !== 'codex' || binding.role !== role || !['controller','model_read'].includes(role)) fail('codex_shared_binding_mismatch');
  for (const key of ['projectId','agentId']) id(binding[key]);
  if (typeof binding.workspace !== 'string' || !path.isAbsolute(binding.workspace) || await fs.realpath(binding.workspace) !== path.resolve(binding.workspace)) fail('codex_shared_workspace_mismatch');
  record(binding.connection, ['pipe','authFile']); validatePipe(binding.connection.pipe);
  if (typeof binding.connection.authFile !== 'string' || !path.isAbsolute(binding.connection.authFile)) fail('codex_shared_binding_mismatch');
  return structuredClone(binding);
}
export function validateTicket(ticket, binding) {
  record(ticket, ['kind','version','projectId','hostId','agentId','workspace','sessionId','epoch','enabled']);
  if (ticket.kind !== 'cmcp_codex_shared_session_ticket' || ticket.version !== 1 || ticket.enabled !== true) fail('codex_shared_session_not_enabled');
  for (const key of ['projectId','hostId','agentId','workspace']) if (ticket[key] !== binding[key]) fail('codex_shared_ticket_mismatch');
  id(ticket.sessionId); id(ticket.epoch); return structuredClone(ticket);
}
export function makeTicket(binding, sessionId, epoch) {
  return validateTicket({kind:'cmcp_codex_shared_session_ticket',version:1,projectId:binding.projectId,hostId:binding.hostId,agentId:binding.agentId,workspace:binding.workspace,sessionId,epoch,enabled:true},binding);
}
export function makeRequest(binding, ticket, operation, args, requestId = randomUUID()) {
  validateTicket(ticket,binding);
  return {projectId:binding.projectId,hostId:binding.hostId,agentId:binding.agentId,workspace:binding.workspace,sessionId:ticket.sessionId,epoch:ticket.epoch,requestId,operation,args};
}
const toolParameters = Object.freeze({find:[],open:['navigationTicket','selectionJson'],read:['ticket'],progress:['ticket']});
export const readCapabilities=MODEL_TEXT_PROFILE;
if(Object.keys(toolParameters).length!==readCapabilities.operations.length||readCapabilities.operations.some(operation=>!Object.hasOwn(toolParameters,operation)||!Object.hasOwn(MODEL_OPERATIONS,operation)))fail('codex_shared_profile_schema_mismatch');
export function validateRead(operation, args) {
  if (!Object.hasOwn(toolParameters,operation)) fail('codex_shared_read_operation_denied');
  const keys = toolParameters[operation]; record(args,keys);
  if (Object.keys(args).length !== keys.length) fail('codex_shared_invalid_tool_arguments');
  for (const key of keys) if (typeof args[key] !== 'string' || !args[key] || Buffer.byteLength(args[key]) > 65536) fail('codex_shared_invalid_tool_arguments');
  if (operation === 'open') { try { JSON.parse(args.selectionJson); } catch { fail('codex_shared_invalid_tool_arguments'); } }
  return structuredClone(args);
}
export const dynamicTools = readCapabilities.operations.map(operation => ({type:'function',name:MODEL_OPERATIONS[operation],
  description:({find:'Find shared project source history relevant to the current user request.',open:'Open a selection from a returned history navigation ticket.',read:'Read the next original source page from an open history ticket.',progress:'Check the reading coverage of an open history ticket.'})[operation],
  inputSchema:{type:'object',properties:Object.fromEntries(toolParameters[operation].map(key=>[key,{type:'string'}])),required:toolParameters[operation],additionalProperties:false}}));
export async function readTool({binding,ticket,operation,args,call = callSharedProject,requestId}) {
  const fixed = await validateBinding(binding,'model_read'); validateTicket(ticket,fixed);
  return call({connection:fixed.connection,role:'model_read',request:makeRequest(fixed,ticket,operation,validateRead(operation,args),requestId)});
}

/** The caller supplies only official events for this fixed, newly created thread. */
export async function createCodexSharedAdapter({binding,readBinding,ticket,call = callSharedProject,onEvidence = async()=>{}}) {
  const control = await validateBinding(binding,'controller'), reader = await validateBinding(readBinding,'model_read');
  for (const key of ['projectId','hostId','agentId','workspace']) if (reader[key] !== control[key]) fail('codex_shared_binding_mismatch');
  const fixed = validateTicket(ticket,control); let active = null, chain = Promise.resolve();
  const queue = work => { const pending = chain.then(work); chain = pending.catch(()=>{}); return pending; };
  const identity = (threadId,turnId) => { if (threadId !== fixed.sessionId) fail('codex_shared_session_mismatch'); id(turnId); };
  const invoke = (operation,args,key) => call({connection:control.connection,role:'controller',request:makeRequest(control,fixed,operation,args,'codex-'+hash([fixed.sessionId,fixed.epoch,key,operation]))});
  const timestamp = ms => { if (!Number.isSafeInteger(ms) || ms < 0) fail('codex_shared_missing_event_time'); return new Date(ms).toISOString(); };
  const text = value => { if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value)>524288) fail('codex_shared_invalid_text'); return value; };
  // 已保存前綴保留；任何同回合可見訊息失敗都不能由後來的 completed 掩蓋。
  const visible = async (turnId, operation) => {
    try {
      if (active?.turnId === turnId && active.failed) fail('codex_shared_partial_assistant_save');
      return await operation();
    } catch (error) {
      if (active?.turnId === turnId) { active.failed = true; active.failureCode ??= safeError(error); }
      throw error;
    }
  };
  async function cancelActive(threadId, turnId, status, reason) {
    const partial = active.failed === true, failureCode = active.failureCode ?? null, committedMessages = active.seen.size;
    const result = await invoke('cancel',{userMessageId:active.userMessageId,userRevisionId:'r1',harnessTurn:null,reason},['cancel',active.turnId]);
    active = null;
    await onEvidence({kind:'codex_shared_turn_cancelled',threadId,turnId,status,partial,failureCode,committedMessages,result}); return result;
  }
  async function receive({threadId,turnId,messageId,prompt,receivedAt,timeBasis}) {
    identity(threadId,turnId); id(messageId); text(prompt);
    const signature = hash([messageId,prompt,receivedAt]);
    if (active && (active.turnId !== turnId || active.signature !== signature)) fail('codex_shared_active_turn_conflict');
    const args = {messageId,text:prompt,receivedAt,revisionId:'r1'};
    await invoke('receive',args,['user',turnId,messageId]);
    const result = await invoke('claim-turn',{messageId,revisionId:'r1',harnessTurn:null},['user',turnId,messageId]);
    active ??= {turnId,userMessageId:messageId,signature,last:null,seen:new Map(),failed:false,failureCode:null};
    await onEvidence({kind:'codex_shared_user_admitted',threadId,turnId,messageId,text:prompt,receivedAt,timeBasis,result});
    return result;
  }
  async function append({threadId,turnId,messageId,body,receivedAt,phase}) {
    identity(threadId,turnId); id(messageId); text(body);
    if (!active || active.turnId !== turnId) fail('codex_shared_user_not_admitted');
    const args = {messageId,text:body,receivedAt,revisionId:'r1',userMessageId:active.userMessageId,userRevisionId:'r1',harnessTurn:null};
    const signature = hash(args), prior = active.seen.get(messageId);
    if (prior && prior !== signature) fail('codex_shared_item_identity_conflict');
    const result = await invoke('append-assistant',args,['assistant',turnId,messageId]);
    if (!prior) { active.seen.set(messageId,signature); active.last = {args,phase}; }
    await onEvidence({kind:'codex_shared_assistant_committed',threadId,turnId,messageId,text:body,receivedAt,timeBasis:'official_item_completed_at',phase:phase??null,result});
    return result;
  }
  return {
    async settled() { await chain; },
    handleItemCompleted(event) { return queue(async()=>{
      identity(event?.threadId,event?.turnId);
      const item = event.item;
      // Do not inspect reasoning, tool payloads, transcript paths, or internal plans.
      if (!item || !['userMessage','agentMessage'].includes(item.type)) return {ignored:true};
      if (item.type === 'userMessage') {
        const receivedAt = timestamp(event.completedAtMs);
        if (!Array.isArray(item.content) || item.content.length !== 1 || item.content[0]?.type !== 'text') fail('codex_shared_unsupported_user_content');
        return receive({threadId:event.threadId,turnId:event.turnId,messageId:item.id,prompt:item.content[0].text,receivedAt,timeBasis:'official_item_completed_at'});
      }
      return visible(event.turnId,async()=>{
        const receivedAt = timestamp(event.completedAtMs);
        if (item.delivery === 'async') fail('codex_shared_async_delivery_unsupported');
        return append({threadId:event.threadId,turnId:event.turnId,messageId:item.id,body:item.text,receivedAt,phase:item.phase});
      });
    }); },
    handleTurnCompleted(event) { return queue(async()=>{
      identity(event?.threadId,event?.turn?.id);
      if (!active || active.turnId !== event.turn.id) fail('codex_shared_user_not_admitted');
      if (active.failed || event.turn.status !== 'completed' || !active.last) {
        return cancelActive(event.threadId,event.turn.id,event.turn.status,active.failed?'codex_partial_assistant_save':event.turn.status === 'completed'?'codex_no_visible_assistant':'codex_turn_not_completed');
      }
      const final = active.last;
      const result = await visible(event.turn.id,()=>invoke('finish',final.args,['finish',active.turnId,final.args.messageId]));
      active = null;
      await onEvidence({kind:'codex_shared_turn_finished',threadId:event.threadId,turnId:event.turn.id,lastVisibleMessageId:final.args.messageId,phase:final.phase??null,coverage:'official_completed_agent_messages',result});
      return result;
    }); },
    tool(event) { return queue(async()=>{
      identity(event?.threadId,event?.turnId);
      if (!active || active.turnId !== event.turnId) fail('codex_shared_user_not_admitted');
      if (event.namespace !== null && event.namespace !== undefined) fail('codex_shared_tool_namespace_denied');
      const operation = Object.entries(MODEL_OPERATIONS).find(([,name])=>name===event.tool)?.[0];
      if (!operation) fail('codex_shared_read_operation_denied');
      const result = await readTool({binding:reader,ticket:fixed,operation,args:event.arguments,call,requestId:'codex-tool-'+hash([fixed.sessionId,fixed.epoch,event.turnId,id(event.callId)])});
      await onEvidence({kind:'codex_shared_tool_result',threadId:event.threadId,turnId:event.turnId,callId:event.callId,tool:event.tool,result}); return result;
    }); },
    // Separate legacy Hook translator: Stop certifies only its latest final text.
    handleHook(event,{receivedAt = new Date().toISOString()} = {}) { return queue(async()=>{
      if (!event || path.resolve(event.cwd??'') !== control.workspace) fail('codex_shared_workspace_mismatch');
      identity(event.session_id,event.turn_id);
      if (event.hook_event_name === 'UserPromptSubmit') {
        if (!Number.isFinite(Date.parse(receivedAt))) fail('codex_shared_missing_event_time');
        return receive({threadId:event.session_id,turnId:event.turn_id,messageId:event.turn_id,prompt:event.prompt,receivedAt,timeBasis:'hook_received_at'});
      }
      if (event.hook_event_name !== 'Stop') fail('codex_shared_unsupported_hook');
      if (!active || active.turnId !== event.turn_id) fail('codex_shared_user_not_admitted');
      if (active.failed) return cancelActive(event.session_id,event.turn_id,'completed','codex_partial_assistant_save');
      const result = await visible(event.turn_id,async()=>{
        if (!Number.isFinite(Date.parse(receivedAt))) fail('codex_shared_missing_event_time');
        text(event.last_assistant_message);
        const args = {messageId:event.turn_id+':stop-final',text:event.last_assistant_message,receivedAt,revisionId:'r1',userMessageId:active.userMessageId,userRevisionId:'r1',harnessTurn:null};
        return invoke('finish',args,['stop',event.turn_id]);
      }); active = null;
      await onEvidence({kind:'codex_shared_stop_final',threadId:event.session_id,turnId:event.turn_id,coverage:'Stop_last_assistant_message_only',timeBasis:'hook_received_at',result}); return result;
    }); }
  };
}
