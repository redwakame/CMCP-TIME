import fs from 'node:fs/promises';import path from 'node:path';import {parseArgs} from 'node:util';import {createInterface} from 'node:readline';
import {createCmcpLocalInput} from '../src/cmcp-guard/cmcp-local-input.js';
import {createCmcpBoundedProviderAdapter,boundedProviderProtocolHash} from '../src/cmcp-guard/cmcp-bounded-provider-adapter.js';
import {readCmcpProtectedCredential} from '../src/cmcp-guard/cmcp-protected-credential.js';
import {loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {createCmcpRuntimeSession,authorizeCmcpRuntime,cancelCmcpRuntimeWork,recoverCmcpRuntimeWork} from '../src/cmcp-guard/cmcp-runtime-session.js';
import {resolveCmcpWorkspaceRoot,cmcpWorkspacePath} from '../src/cmcp-guard/cmcp-project-paths.js';
const {values:args}=parseArgs({options:{workspace:{type:'string'},config:{type:'string'},manifest:{type:'string'},status:{type:'boolean'},disabled:{type:'boolean'},clean:{type:'boolean'},
 text:{type:'string'},event:{type:'string'},recall:{type:'boolean'},now:{type:'string'},check:{type:'boolean'},
 proactive:{type:'boolean'},'no-proactive':{type:'boolean'},
 'buffer-list':{type:'boolean'},'buffer-clear':{type:'boolean'},'buffer-hours':{type:'string'},scope:{type:'string'},
 authorize:{type:'string'},posts:{type:'string'},'host-jobs':{type:'string'},'authorized-by':{type:'string'},
 'resume-source':{type:'string'},'resume-dialogue':{type:'string'},'resume-discussion':{type:'string'},'resume-conversation':{type:'string'},'work-id':{type:'string'},'deadline-ms':{type:'string'},progress:{type:'string'},
 'cancel-work':{type:'string'},'recover-work':{type:'string'},'recover-logical':{type:'string'},
 ingest:{type:'boolean'},'source-file':{type:'string'},role:{type:'string'},'local-candidates':{type:'boolean'},
 'local-read':{type:'string'},refs:{type:'string'},answer:{type:'boolean'},'local-recall':{type:'boolean'},
 read:{type:'boolean'},'read-all':{type:'boolean'},'read-page':{type:'string'},'read-progress':{type:'string'},
 'revoke-reading':{type:'string'},'reading-limits':{type:'string'},'project-page':{type:'boolean'},
 'discussion-file':{type:'string'},'discussion-list':{type:'boolean'},'discussion-query':{type:'string'},'calendar-range':{type:'string'},
 'continue-ref':{type:'string'},'range-start':{type:'string'},'range-end':{type:'string'}}});
const repo=resolveCmcpWorkspaceRoot(args.workspace),within=file=>{const target=path.resolve(repo,file),rel=path.relative(repo,target);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('repo_local_path_required');return cmcpWorkspacePath(repo,target);};
const config=JSON.parse(await fs.readFile(within(args.config),'utf8'));
const write=value=>new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):resolve()));
if(config.kind==='cmcp_runtime_config'){
 let session,reader;const controller=new AbortController();const cancel=()=>{controller.abort();reader?.close();process.stdin.destroy();};process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
 try{
  // Explicit invocation override only. Edit the caller-owned config to persist it.
  if(args['buffer-hours']!==undefined)config.bufferRetention={hours:Number(args['buffer-hours'])};
  if(args.proactive&&args['no-proactive'])throw Error('conflicting_proactive_controls');
  if(args['buffer-list']&&args['buffer-clear'])throw Error('conflicting_buffer_operations');
  const readingFlags=['read','read-all','read-page','read-progress','revoke-reading'];
  if(readingFlags.filter(k=>args[k]).length>1)throw Error('conflicting_reading_operations');
  if((args.read||args['read-all'])&&(!args.text||!args['reading-limits']))throw Error('reading_requires_question_and_explicit_limits');
  if(args['reading-limits']&&!args.read&&!args['read-all'])throw Error('reading_limits_require_open');
  if(args['discussion-query']&&!args['discussion-list']&&!args.read&&!args['read-all'])throw Error('discussion_query_requires_list_or_read');
  if(args['calendar-range']&&!args.read&&!args['read-all'])throw Error('calendar_range_requires_read');
  if(args['discussion-query']&&args['calendar-range'])throw Error('conflicting_temporal_reading_scope');
  if(args['discussion-file']&&(args['discussion-list']||readingFlags.some(k=>args[k])||args.text||args['discussion-query']||args['calendar-range']))throw Error('conflicting_discussion_operations');
  if(args['discussion-list']&&(readingFlags.some(k=>args[k])||args.text))throw Error('conflicting_discussion_operations');
  const discussionQuery=args['discussion-query']?JSON.parse(await fs.readFile(within(args['discussion-query']),'utf8')):undefined;
  const temporalReading={...(discussionQuery===undefined?{}:{discussion:discussionQuery}),...(args['calendar-range']?{calendarRange:JSON.parse(await fs.readFile(within(args['calendar-range']),'utf8'))}:{})};
  if(args['project-page']&&!args['read-page'])throw Error('projection_requires_reading_page');
  if((args['read-page']||args['read-progress']||args['revoke-reading'])&&args.text!==undefined)throw Error('reading_reuses_saved_question');
  if(args.manifest)throw Error('runtime_does_not_accept_experiment_manifest');
  let continuation;
  if(['continue-ref','range-start','range-end'].some(key=>args[key]!==undefined)){
    if(!args['local-read']||!/^c[1-9]\d*$/.test(args['continue-ref']??'')||args.refs!==args['continue-ref']
      ||!['range-start','range-end'].every(key=>/^(?:0|[1-9]\d*)$/.test(args[key]??'')&&Number.isSafeInteger(Number(args[key])))
      ||Number(args['range-end'])<=Number(args['range-start']))throw Error('invalid_local_continuation_arguments');
    continuation={ref:args['continue-ref'],range:{unit:'unicode_code_points',start:Number(args['range-start']),end:Number(args['range-end'])}};
  }
  if(args['cancel-work'])await write(await cancelCmcpRuntimeWork({config,repoRoot:repo,workId:args['cancel-work'],reason:'user_cancelled'}));
  else if(args['recover-work']||args['recover-logical'])await write(await recoverCmcpRuntimeWork({config,repoRoot:repo,workId:args['recover-work'],
    logicalId:args['recover-logical']?Number(args['recover-logical']):undefined}));
  else if(args.authorize){await write(await authorizeCmcpRuntime({config,repoRoot:repo,authorizationId:args.authorize,
    limits:{deepseek:Number(args.posts),codex:Number(args['host-jobs'])},authorizedBy:args['authorized-by']}));}
  else{
   session=await createCmcpRuntimeSession({config,repoRoot:repo,readOnly:args.status===true||args.check===true||!!args.progress||args['buffer-list']===true||!!args['read-progress']||args['discussion-list']===true,
    controls:{...(args.disabled?{enabled:false}:{}),...(args.clean?{clean:true}:{}),...(args.proactive?{proactive:true}:{}),...(args['no-proactive']?{proactive:false}:{})},observe:write,
    delivery:{async present(message){await write({type:'console_delivery',pid:process.pid,...message});return {status:'presented',channel:'local_stdout',acknowledgement:'write_callback_only'};}}});
   if(args['discussion-list'])await write(await session.discussionSegments(discussionQuery??{}));
   else if(args['buffer-list'])await write(await session.bufferList({scopeId:args.scope??config.input.scopeId}));
   else if(args['read-progress'])await write((await session.readingStatus(args['read-progress'])).reader);
   else if(args['revoke-reading'])await write((await session.revokeReading({ticket:args['revoke-reading']})).reader);
   else if(args['buffer-clear'])await write(await session.clearBuffer({scopeId:args.scope??config.input.scopeId}));
   else if(args.progress)await write(await session.progress(args.progress));
   else if(args.status||args.check)await write(await session.status());
   else{
    await write({type:'ready',pid:process.pid,sessionId:session.sessionId,runtimeId:config.runtimeId,modelCalls:0});
    const options={signal:controller.signal,...(args['work-id']?{workId:args['work-id']}:{}),...(args['deadline-ms']?{deadlineMs:Number(args['deadline-ms'])}:{})};
    const submit=async input=>{const recall=input.recall??args.recall??false;await write({type:'input_complete',pid:process.pid,result:await session.submit({...options,text:input.text,
     recall,eventKey:input.eventKey??(recall?null:args.event??null),...(input.now??args.now?{timeContext:{now:input.now??args.now,timezone:config.input.timezone}}:{})})});};
    const localTime=args.now?{timeContext:{now:args.now,timezone:config.input.timezone}}:{};
    if(args['discussion-file'])await write({type:'discussion_registered',result:await session.linkDiscussionSegment(JSON.parse(await fs.readFile(within(args['discussion-file']),'utf8')))});
    else if(args.read||args['read-all'])await write({type:'reading_open',result:(await session.readingOpen({text:args.text,mode:args['read-all']?'all':'read',limits:JSON.parse(await fs.readFile(within(args['reading-limits']),'utf8')),...temporalReading,...localTime,...options})).reader});
    else if(args['read-page']){const page=await session.readingPage({ticket:args['read-page'],project:args['project-page']===true,...options});await write({type:'reading_page',result:page.reader,modelContext:page.modelContext});}
    else if(args.ingest){const source=args['source-file']?JSON.parse(await fs.readFile(within(args['source-file']),'utf8')):{text:args.text,role:args.role??'user',eventKey:args.event??null};
      await write({type:'source_saved',result:await session.ingest({...source,...localTime,...options})});}
    else if(args['local-recall'])await write({type:'local_recall',result:await session.localRecall({text:args.text,...localTime,...options})});
    else if(args['local-candidates'])await write({type:'local_candidates',result:await session.localCandidates({text:args.text,...localTime,...options})});
    else if(args['local-read'])await write({type:'local_read',result:await session.localRead({ticket:args['local-read'],refs:(args.refs??'').split(',').filter(Boolean),answer:args.answer===true,...(continuation?{continuation}:{}),...localTime,...options})});
    else if(args['resume-source']||args['resume-dialogue']||args['resume-discussion']||args['resume-conversation']){if(args.text!==undefined||['resume-source','resume-dialogue','resume-discussion','resume-conversation'].filter(name=>args[name]).length!==1)throw Error('resume_source_and_new_text_are_exclusive');
      const pointer=JSON.parse(await fs.readFile(within(args['resume-source']??args['resume-dialogue']??args['resume-discussion']??args['resume-conversation']),'utf8'));
      await write({type:'input_complete',pid:process.pid,result:await session.resumeSource(pointer,{...options,...(args['resume-dialogue']?{stage:'dialogue'}:args['resume-discussion']?{stage:'discussion'}:args['resume-conversation']?{stage:'conversation'}:{})})});}
    else if(args.text!==undefined)await submit({text:args.text});else{
     reader=createInterface({input:process.stdin,crlfDelay:Infinity});let foreground=null,ending=false;const controlsInFlight=new Set();
     const failure=error=>write({type:'operation_failure',code:error.message});
     // Keep controls and exit responsive while a foreground or timer operation awaits HTTP.
     const execute=async input=>{
      if(input.command==='recover')return write({type:'recovery',result:await session.recover()});
      if(input.command==='discussion-link')return write({type:'discussion_registered',result:await session.linkDiscussionSegment(input.declaration)});
      if(input.command==='ingest'){const {command,...source}=input;return write({type:'source_saved',result:await session.ingest({...source,signal:controller.signal})});}
      if(input.command==='candidates')return write({type:'local_candidates',result:await session.localCandidates({text:input.text,signal:controller.signal})});
      if(input.command==='recall-local')return write({type:'local_recall',result:await session.localRecall({text:input.text,signal:controller.signal})});
      if(input.command==='read'&&input.ticket&&input.refs)return write({type:'local_read',result:await session.localRead({ticket:input.ticket,refs:input.refs,answer:input.answer===true,
        ...(input.continuation===undefined?{}:{continuation:input.continuation}),signal:controller.signal})});
      if(['read','read-all'].includes(input.command))return write({type:'reading_open',result:(await session.readingOpen({text:input.text,mode:input.command==='read-all'?'all':'read',limits:input.limits,...(input.discussion===undefined?{}:{discussion:input.discussion}),...(input.calendarRange===undefined?{}:{calendarRange:input.calendarRange}),signal:controller.signal})).reader});
      if(input.command==='read-page'){const page=await session.readingPage({ticket:input.ticket,project:input.project===true,signal:controller.signal});return write({type:'reading_page',result:page.reader,modelContext:page.modelContext});}
      return submit(input);
     };
     await new Promise(resolve=>{
      reader.on('close',resolve);
      reader.on('line',line=>{
       if(ending||!line.trim())return;let input;try{input=JSON.parse(line);}catch{input={text:line};}
       if(input.command==='exit'||line==='/exit'){ending=true;cancel();return;}
       if(['status','controls','buffer-list','buffer-clear','buffer-retention','read-progress','revoke-reading','discussion-list'].includes(input.command)||line==='/status'){
        const task=(async()=>{
          if(input.command==='buffer-list')return write(await session.bufferList({scopeId:input.scopeId??config.input.scopeId}));
          if(input.command==='discussion-list')return write(await session.discussionSegments(input.query??{}));
          if(input.command==='read-progress')return write((await session.readingStatus(input.ticket)).reader);
          if(input.command==='revoke-reading')return write((await session.revokeReading({ticket:input.ticket})).reader);
          if(input.command==='buffer-clear')return write(await session.clearBuffer({scopeId:input.scopeId??config.input.scopeId}));
          if(input.command==='buffer-retention')return write(session.setBufferRetention({hours:input.hours}));
          if(input.command==='controls')session.setControls(input);
          await write(input.command==='controls'?{type:'controls_changed',controls:(await session.status()).controls}:await session.status());})().catch(failure);
        controlsInFlight.add(task);task.finally(()=>controlsInFlight.delete(task));return;
       }
       if(foreground){failure(Error('foreground_work_in_progress_use_status_or_cancel'));return;}
       foreground=execute(input).catch(failure).finally(()=>{foreground=null;});
      });
     });
     // A finite stdin stream completes its final operation. Explicit exit/signal
     // cancels immediately instead of waiting for an unfinished model operation.
     if(!ending&&!controller.signal.aborted)await foreground;
     await session.close();await foreground;await Promise.all(controlsInFlight);
    }
    await session.close();
    await write({type:'closed',sessionId:session.sessionId,pid:process.pid});
   }
  }
 }catch(error){await write({type:'input_failure',code:error.message});process.exitCode=1;}
 finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);reader?.close();await session?.close();}
}else{
if(args.authorize||args.check||args.posts||args['host-jobs']||args['authorized-by']||args['buffer-list']||args['buffer-clear']||args['buffer-hours']!==undefined||args.scope
 ||['read','read-all','read-page','read-progress','revoke-reading','reading-limits','project-page','discussion-file','discussion-list','discussion-query','calendar-range'].some(k=>args[k]!==undefined)
 ||['continue-ref','range-start','range-end'].some(key=>args[key]!==undefined))throw Error('normal_runtime_config_required');
config.root=within(config.root);
let core,adapter,lock,reader,secretB;
const lockFile=path.join(config.root,'.common-input-writer.lock');
try{
 const proxy={descriptor:{mode:'model',providerId:'bounded-deepseek',model:'explicit_per_attempt',settings:{}},async request(...values){
  if(args.status)throw Error('status_cannot_invoke_model');
  if(!adapter){
   const manifest=JSON.parse(await fs.readFile(within(args.manifest),'utf8'));
   if(manifest.profile!=='incremental-catalog-v1'||manifest.configHash!==loopHash(config)||manifest.protocolHash!==boundedProviderProtocolHash(manifest.profile))throw Error('frozen_input_configuration_mismatch');
   for(const [file,hash] of Object.entries(manifest.files))if(loopHash(await fs.readFile(within(file),'utf8'))!==hash)throw Error('frozen_file_mismatch');
   secretB=await readCmcpProtectedCredential(path.join(repo,'.cmcp/deepseek-credential.json'),'deepseek',{workspace:repo});
   adapter=createCmcpBoundedProviderAdapter({deepseekKey:secretB,ledgerRoot:within(manifest.ledgerRoot),manifest});secretB=undefined;
  }
  return adapter.request(...values);
 },dispose(){adapter?.dispose();}};
 if(!args.status){await fs.mkdir(config.root,{recursive:true});lock=await fs.open(lockFile,'wx');await lock.writeFile(String(process.pid));await lock.sync();}
 core=await createCmcpLocalInput({...config,readOnly:args.status===true,adapter:proxy,observe:write,delivery:{async present(message){await write({type:'console_delivery',pid:process.pid,...message});return {status:'presented',channel:'local_stdout',acknowledgement:'write_callback_only'};}}});
 core.setControls({enabled:!args.disabled,clean:args.clean===true});
 if(args.status){await write(await core.status());}
 else{
  const recovery=await core.recover();await write({type:'ready',pid:process.pid,sessionId:core.sessionId,recovery,modelCalls:0});
  async function submit(input){
   const recall=input.recall??args.recall??false;
   const result=await core.submit({text:input.text,eventKey:input.eventKey??(recall?null:args.event??null),recall,
    ...(input.now??args.now?{timeContext:{now:input.now??args.now,timezone:config.timezone}}:{})});
   await write({type:'input_complete',pid:process.pid,result});
  }
  if(args.text!==undefined)await submit({text:args.text});
  else{
   reader=createInterface({input:process.stdin,crlfDelay:Infinity});
   for await(const line of reader){if(!line.trim())continue;let input;try{input=JSON.parse(line);}catch{input={text:line};}
    if(input.command==='exit'||line==='/exit')break;
    if(input.command==='status'||line==='/status'){await write(await core.status());continue;}
    if(input.command==='recover'){await write({type:'recovery',result:await core.recover()});continue;}
    if(input.command==='controls'){core.setControls(input);continue;}
    await submit(input);
   }
  }
  await write({type:'closed',pid:process.pid,sessionId:core.sessionId});
 }
}catch(error){await write({type:'input_failure',code:error.message});process.exitCode=1;}
finally{reader?.close();core?.close();adapter?.dispose();secretB=undefined;if(lock){await lock.close();await fs.unlink(lockFile);}}
}
