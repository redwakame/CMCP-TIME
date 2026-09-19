import {parseArgs} from 'node:util';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {loadCmcpPlayground,createCmcpPlayground} from '../src/cmcp-guard/cmcp-playground.js';
import {cmcpProjectRoot} from '../src/cmcp-guard/cmcp-project-paths.js';
import {createCmcpRuntimeSession,authorizeCmcpRuntime} from '../src/cmcp-guard/cmcp-runtime-session.js';
import {parseCmcpQueryResumeCommand} from './cmcp-query-resume-command.mjs';

const {values:args}=parseArgs({options:{root:{type:'string'},session:{type:'string'},status:{type:'boolean'},init:{type:'boolean'},json:{type:'boolean'},
 authorize:{type:'string'},posts:{type:'string'},'authorized-by':{type:'string'},help:{type:'boolean'}}});
const help=`CMCP local playground (DeepSeek; shared data and finite authorization across Sessions)
Enter text to chat in the current topic; general conversation is the default.
/topics                 List authorized topics
/topic 2                Select a topic number; /topic general returns to general chat
/sessions               List conversations without adding model authorization
/new conversation-name  Create a conversation label
/use number-or-name     Continue an existing conversation
/read natural-question  Show a sourced outline, time and scope (not full conversation)
/read-all question      Read the bounded source set completely, one page at a time
/next                   Read the next page without a new User input or budget reset
/reading                Inspect read/unread ranges, gaps, and cumulative limits
/count question         Batch-check reports in the naturally selected time/source scope
/lookup question        Batch-check exact evidence in the selected source scope
/query-status ID        Inspect a batch query without a model call
/query-resume ID        Resume only its unfinished safe stages (no automatic POST retry)
/query-resume ID --query-text exact original question   Resume an unsaved query across processes
/revoke                 Revoke the current reading ticket
/segments               List formally linked discussion segments
/recoveries             List unlinked or pending sources (zero API)
/register               Start a bounded saved-source registration/index recovery (zero API)
/register-next          Continue its saved inventory cursor, including after restart
/resume-discussion 1    Resume only the selected source's discussion linking
/resume-conversation 1  Resume unfinished event, discussion, or unstarted answer stages
/status                 Inspect status, authorization, and pending work (zero API)
/buffer                 List Buffer entries without changing activity
/clear                  Clear this scope's Buffer without deleting History
/on, /off               Persist context enhancement control
/clean on|off           Persist Clean mode
/proactive on|off       Persist proactive master switch (initially OFF)
/controls               Show persistent settings and Session overrides
/set key on|off|number  Persist one independent setting; /session-set is temporary
/dnd timezone from to   Set daily quiet hours, e.g. America/New_York 22:00 07:00
/dnd off                Disable quiet hours (no inferred schedule)
/pins                   List explicit Pins and their independent lifecycle
/pin topic-number ISO   Pin the current supported topic progress at an explicit instant
/pin-source source-ID ISO  Pin one registered source at an explicit instant
/pin-complete ID        Complete a Pin; /pin-cancel ID cancels it
/pin-time ID ISO        Change a Pin's explicit reminder instant
/read-limits sources bytes page-bytes projection-bytes  Persist bounded reading caps
/cancel                 Cancel current work; no refund or automatic resubmission
/exit                   Close normally and retain data
Initialization grants no model calls; status remains available without quota.
Only --authorize ID --posts N --authorized-by reason adds explicit finite authorization.`;
function display(row){if(args.json)return console.log(JSON.stringify(row));
 if(row.kind==='help')return console.log(help);
 if(row.type==='console_delivery')return console.log(`\n${row.kind==='proactive'?'CMCP proactive continuation':'Assistant'}: ${row.text}\n`);
 if(row.kind==='operation_error')return console.log('Not completed: '+row.reason);
 if(row.kind==='playground_ready')return console.log(`CMCP ready. Session: ${row.session.label}; /help lists operations. Proactive ${row.controls.proactive?'ON':'OFF'}.`);
 if(row.kind==='playground_closed')return console.log('Closed normally; data and remaining authorization are retained.');
 if(row.reader?.text!==undefined){console.log(JSON.stringify(row.reader,null,2));return;}
 if(row.kind==='playground_status'){const r=row.runtime,g=r.state.registration;return console.log(JSON.stringify({session:row.session,controls:r.controls,authorization:r.budget,dataScope:r.dataScope,
  bufferRetention:r.bufferRetention,capacity:r.capacity,registration:{registered:g.registered,unregistered:g.unregistered.length,
   inventoryStatus:g.inventoryStatus,inventoryComplete:g.inventoryComplete,inventoryRecordCount:g.inventoryRecordCount,
   failures:g.failures,inventoryFailures:g.inventoryFailures,nextCursor:g.inventoryNextCursor},registrationRecovery:row.registrationRecovery,
  answerHistory:r.state.events.map(e=>({eventKey:e.key,...e.answerHistory})),pending:r.pending,discussionAssociation:r.discussionAssociation,proactive:r.proactiveExecutor},null,2));}
 if(row.reader)return console.log(JSON.stringify(row.reader,null,2));
 console.log(JSON.stringify(row,null,2));}
let app,reader,ending=false,foreground=null,controller=null;const controls=new Set();
const stop=()=>{ending=true;controller?.abort();reader?.close();process.stdin.destroy();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
 if(args.help){display({kind:'help'});}else{
  if(args.authorize&&(!/^[1-9]\d*$/.test(args.posts??'')||!args['authorized-by']))throw Error('explicit_positive_grant_and_authorizer_required');
  if(!args.authorize&&(args.posts||args['authorized-by']))throw Error('grant_requires_authorization_id');
  const settings=await loadCmcpPlayground({repoRoot:cmcpProjectRoot,root:args.root,initialize:!args.status});
  if(args.authorize){display(await authorizeCmcpRuntime({config:settings.config,repoRoot:cmcpProjectRoot,authorizationId:args.authorize,
   limits:{deepseek:Number(args.posts),codex:0},authorizedBy:args['authorized-by']}));}
  else if(args.status){const session=await createCmcpRuntimeSession({config:settings.config,repoRoot:cmcpProjectRoot,readOnly:true});try{display(await session.status());}finally{await session.close();}}
  else if(args.init)display({kind:'playground_initialized',config:settings.configPath,profile:settings.profilePath,modelCalls:0,authorizationCreated:false});
  else{
   app=await createCmcpPlayground({repoRoot:cmcpProjectRoot,settings,sessionName:args.session,
    delivery:{async present(message){display({type:'console_delivery',...message});return {status:'presented',channel:'local_stdout',acknowledgement:'console_write_only'};}}});
   display({kind:'playground_ready',pid:process.pid,session:app.current,controls:(await app.status()).runtime.controls});
   const fail=error=>display({kind:'operation_error',reason:error.message});
   function parse(line){const match=/^\/(\S+)(?:\s+([\s\S]*))?$/.exec(line.trim());return match?{command:match[1],text:match[2]??''}:{command:'chat',text:line};}
   const onoff=text=>{if(!['on','off'].includes(text))throw Error('expected_on_or_off');return text==='on';};
   async function execute({command,text}){
    if(command==='help')return display({kind:'help'});
    if(command==='topics')return display({kind:'playground_topics',topics:settings.profile.topics.map((item,index)=>({number:index+1,...item})),modelCalls:0});
    if(command==='sessions')return display(await app.sessions());
    if(command==='new')return display(await app.newSession(text));if(command==='use')return display(await app.useSession(text));
    if(command==='topic')return display(await app.topic(text));
    if(command==='segments')return display(await app.runtime.discussionSegments());
    if(command==='recoveries')return display(await app.recoveries());
    if(command==='register'||command==='register-next')return display(await app.register({resume:command==='register-next'}));
    if(command==='reading')return display(await app.progress());if(command==='revoke')return display(await app.revoke());
    if(command==='status')return display(await app.status());if(command==='buffer')return display(await app.runtime.bufferList());
    if(command==='clear')return display(await app.runtime.clearBuffer());
    if(command==='controls')return display(await app.runtime.controlsSnapshot());
    if(command==='pins')return display(await app.runtime.pinList());
    if(command==='pin'||command==='pin-source'){
      const [target,time,...extra]=text.split(/\s+/);if(!target||extra.length)throw Error('expected_pin_target_and_optional_explicit_instant');
      const source=command==='pin-source',topic=source?null:settings.profile.topics[Number(target)-1];
      if(!source&&!topic)throw Error('pin_topic_number_outside_scope');
      return display(await app.runtime.pinCreate({updateId:randomUUID(),...(source?{sourceIds:[target]}:{eventKey:topic.key}),dueAt:time??null,
        userAction:{kind:'callable_authorization',authorized:true,scopeId:settings.config.input.scopeId}}));}
    if(['pin-complete','pin-cancel','pin-time'].includes(command)){
      const [pinId,time,...extra]=text.split(/\s+/),pin=(await app.runtime.pinList()).pins?.find(row=>row.pinId===pinId);
      if(!pin||extra.length||command==='pin-time'&&!time)throw Error('pin_not_found_or_invalid_time');
      return display(await app.runtime.pinChange({updateId:randomUUID(),pinId,expectedRevision:pin.revision,
        action:command==='pin-time'?'schedule':command==='pin-complete'?'complete':'cancel',...(time?{dueAt:time}:{}),
        userAction:{kind:'callable_authorization',authorized:true,scopeId:settings.config.input.scopeId}}));}
    if(command==='read-limits'){
      const values=text.split(/\s+/).map(Number);if(values.length!==4||values.some(value=>!Number.isSafeInteger(value)||value<1))throw Error('expected_four_positive_reading_limits');
      return display(await app.runtime.configureControls({updateId:randomUUID(),patch:{readingLimits:{maxSources:values[0],maxReadBytes:values[1],pageBytes:values[2],maxProjectionBytes:values[3]}}}));}
    if(command==='query-status')return display(await app.runtime.historyQueryStatus(text));
    if(['on','off','clean','proactive'].includes(command)){await app.runtime.configureControls({updateId:randomUUID(),patch:command==='on'||command==='off'?{enabled:command==='on'}:{[command]:onoff(text)}});return display(await app.status());}
    if(command==='set'||command==='session-set'){const [key,value,...extra]=text.split(/\s+/);if(!key||value===undefined||extra.length)throw Error('expected_setting_and_value');
      const parsed=['timezone','language'].includes(key)?value:['on','off'].includes(value)?onoff(value):Number(value);if(typeof parsed==='number'&&!Number.isFinite(parsed))throw Error('invalid_setting_value');
      return display(await app.runtime.configureControls({updateId:randomUUID(),patch:{[key]:parsed},persist:command==='set'}));}
    if(command==='dnd'){const parts=text.split(/\s+/);const dnd=text==='off'?{enabled:false,timezone:null,windows:[]}:parts.length===3?{enabled:true,timezone:parts[0],windows:[{start:parts[1],end:parts[2]}]}:null;
      if(!dnd)throw Error('expected_dnd_timezone_start_end');return display(await app.runtime.configureControls({updateId:randomUUID(),patch:{doNotDisturb:dnd}}));}
    if(command==='cancel'){controller?.abort();return display({kind:'cancel_requested',remoteOutcome:'unknown',budgetRefunded:false});}
    controller=new AbortController();const signal=controller.signal;
    try{if(command==='resume-conversation')return display(await app.resumeConversation(text,{signal}));
      if(command==='resume-discussion')return display(await app.resumeDiscussion(text,{signal}));
     if(command==='read'||command==='read-all'){if(!text.trim())throw Error('natural_question_required');return display(await app.read(text,{all:command==='read-all',signal}));}
     if(command==='next')return display(await app.page({signal}));
     if(command==='count'||command==='lookup')return display(await app.runtime.historyQuery({text,purpose:command==='count'?'report_count':'evidence_lookup',
       readingLimits:settings.profile.readingLimits,batchLimits:{maxBatchSources:4,maxInputBytes:12000,maxBatches:16},signal}));
     if(command==='query-resume')return display(await app.runtime.resumeHistoryQuery({...parseCmcpQueryResumeCommand(text),signal}));
     if(command==='chat'){if(!text.trim())return;const result=await app.submit(text,{signal});return display({kind:'playground_submission',status:result.status,code:result.code??null,
       eventProcessing:result.eventProcessing??null,dialogueProcessing:result.dialogueProcessing??null,pending:result.focus?.pending??null,
       discussionAssociation:result.discussionAssociation??null});}
     throw Error('unknown_command_use_help');
    }finally{controller=null;}
   }
   reader=createInterface({input:process.stdin,crlfDelay:Infinity});
   await new Promise(resolve=>{reader.on('close',resolve);reader.on('line',line=>{
    if(ending||!line.trim())return;const input=parse(line);if(input.command==='exit'){stop();return;}
    if(['status','buffer','clear','on','off','clean','proactive','cancel','controls','set','session-set','dnd','pins','pin-cancel','pin-complete','pin-time','read-limits'].includes(input.command)){
     const task=execute(input).catch(fail);controls.add(task);task.finally(()=>controls.delete(task));return;}
    // One source operation at a time. Do not turn pasted commands into hidden parallel submissions.
    if(foreground){fail(Error('work_in_progress_use_status_or_cancel'));return;}
    foreground=execute(input).catch(fail).finally(()=>{foreground=null;});
   });});
   if(!ending)await foreground;await app.close();await foreground;await Promise.all(controls);
   display({kind:'playground_closed',pid:process.pid,sessionId:app.current.id});
  }
 }
}catch(error){display({kind:'operation_error',reason:error.message});process.exitCode=1;}
finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);reader?.close();await app?.close();}
