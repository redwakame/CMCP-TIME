import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {parseArgs} from 'node:util';import {randomUUID} from 'node:crypto';
import {createCmcpLocalInput} from '../src/cmcp-guard/cmcp-local-input.js';
import {getCmcpHostContext} from '../src/cmcp-guard/cmcp-host-context.js';
import {createCmcpBoundedProviderAdapter,boundedProviderProtocolHash} from '../src/cmcp-guard/cmcp-bounded-provider-adapter.js';
import {readCmcpProtectedCredential} from '../src/cmcp-guard/cmcp-protected-credential.js';
import {loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {createCmcpRuntimeSession} from '../src/cmcp-guard/cmcp-runtime-session.js';
const repo=fileURLToPath(new URL('../',import.meta.url));
const within=value=>{if(typeof value!=='string')throw Error('explicit_repo_path_required');const full=path.resolve(repo,value),rel=path.relative(repo,full);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('repo_local_path_required');return full;};
const json=file=>fs.readFile(file,'utf8').then(JSON.parse);
/** Presentation metadata only. Stored reading receipts and their version/hash checks are unchanged. */
export function projectCmcpHostReadingUnits(host){
  if(!host||typeof host!=='object'||!host.coverage?.cumulative)return host;
  const measurementUnits={
    'coverage.cumulative.pages':'page_count',
    'coverage.cumulative.sourceBytes':'utf8_bytes',
    'coverage.cumulative.projectionBytes':'utf8_bytes'};
  if(host.source?.codePoints!==undefined)measurementUnits['source.codePoints']='unicode_code_points';
  if(host.outline?.some(row=>row.source?.codePoints!==undefined))measurementUnits['outline[].source.codePoints']='unicode_code_points';
  return {...host,measurementUnits};
}
/** Persist an operation receipt, not an unsaved new User body. Authorized source pages remain intact. */
export function retainCmcpHostReadingReceipt(output){
  if(!output?.internal?.queryAuthorization&&output?.host?.queryBinding?.kind!=='ephemeral_reading_query')return output;
  const kept=structuredClone(output);
  if(kept.host){delete kept.host.question;if(kept.host.selection?.input)delete kept.host.selection.input.question;
    if(kept.host.reason)kept.host.reason='ephemeral_query_detail_not_retained';}
  if(kept.internal){delete kept.internal.question;if(kept.internal.prepared?.input)delete kept.internal.prepared.input.question;
    delete kept.internal.rawSelection;delete kept.internal.refinedSelection;if(kept.internal.selection)delete kept.internal.selection.clarification;}
  if(kept.reader?.reason)kept.reader.reason='ephemeral_query_detail_not_retained';
  kept.queryBodyRetention='not_saved_ephemeral_operation';return kept;
}
export async function runCmcpHostContextCli(argv=process.argv.slice(2)){
  const {values:a}=parseArgs({args:argv,options:{config:{type:'string'},manifest:{type:'string'},text:{type:'string'},now:{type:'string'},
    status:{type:'boolean'},check:{type:'boolean'},disabled:{type:'boolean'},clean:{type:'boolean'},
    'resume-source':{type:'string'},'work-id':{type:'string'},'deadline-at':{type:'string'},'lifecycle-file':{type:'string'},
    'local-candidates':{type:'boolean'},'local-read':{type:'string'},refs:{type:'string'},'source-id':{type:'string'},
    read:{type:'boolean'},'read-all':{type:'boolean'},'read-page':{type:'string'},'read-progress':{type:'string'},
    'read-scope':{type:'boolean'},'navigation-ticket':{type:'string'},'scope-json':{type:'string'},'query-text':{type:'string'},'read-outline':{type:'string'},
    'revoke-reading':{type:'string'},'reading-limits':{type:'string'},'project-page':{type:'boolean'},
    'continue-ref':{type:'string'},'range-start':{type:'string'},'range-end':{type:'string'}}});
  let runtime,adapter,key,lock,lockFile,receiptRoot,lifecycleFile,workId=a['work-id']??randomUUID(),outputWritten=false;
  const controller=new AbortController();
  const cancel=()=>{controller.abort();runtime?.cancelWork?.({workId,reason:'user_cancelled'}).catch(()=>{});};
  process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  const emit=value=>new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):resolve()));
  try{
    const config=await json(within(a.config)),input={...config.input,root:within(config.input.root)};receiptRoot=within(config.receiptRoot);
    const localStage=a['local-candidates']?'candidates':a['local-read']!==undefined?'read':null;
    if(a['source-id']!==undefined&&(localStage!=='candidates'&&!a['read-scope']||typeof a['source-id']!=='string'||!a['source-id'].trim()))throw Error('source_id_requires_local_candidates_or_read_scope');
    const readingModes=['read','read-all','read-scope','read-outline','read-page','read-progress','revoke-reading'].filter(name=>a[name]!==undefined&&a[name]!==false);
    if(readingModes.length>1)throw Error('reading_modes_are_exclusive');
    const readingStage=readingModes[0]??null;
    if(readingStage&&(localStage||a['resume-source']!==undefined||a.manifest!==undefined||a.status||a.check))throw Error('reading_mode_conflict');
    const openingReading=readingStage==='read'||readingStage==='read-all';
    if(openingReading&&(!a['reading-limits']||!a['navigation-ticket']&&(typeof a.text!=='string'||!a.text.trim())))throw Error('reading_question_and_limits_required');
    if(readingStage&&!openingReading&&readingStage!=='read-scope'&&a.text!==undefined)throw Error('reading_reuses_saved_question');
    if(a['navigation-ticket']!==undefined&&(!['read','read-all','read-scope'].includes(readingStage)||a.text!==undefined||!a['scope-json']))throw Error('navigation_reuses_saved_question_and_requires_scope');
    if(a['scope-json']!==undefined&&!a['navigation-ticket'])throw Error('scope_requires_navigation_ticket');
    if(a['query-text']!==undefined&&(!a['navigation-ticket']||typeof a['query-text']!=='string'||!a['query-text'].trim()))throw Error('query_text_requires_ephemeral_navigation');
    if(readingStage==='read-scope'&&!a['navigation-ticket']&&(typeof a.text!=='string'||!a.text.trim()))throw Error('reading_question_required');
    if(a['reading-limits']!==undefined&&!openingReading)throw Error('reading_limits_require_open');
    if(a['project-page']&&readingStage!=='read-page')throw Error('projection_requires_reading_page');
    if(a['local-candidates']&&a['local-read']!==undefined)throw Error('local_candidate_and_read_modes_are_exclusive');
    if(localStage&&(a['resume-source']!==undefined||a.manifest!==undefined))throw Error('local_mode_cannot_use_provider_resume_or_manifest');
    if(localStage==='read'&&a.text!==undefined)throw Error('local_read_reuses_saved_question');
    if(localStage==='candidates'&&a.refs!==undefined||a.refs!==undefined&&localStage!=='read')throw Error('refs_require_local_read');
    if(localStage==='read'&&(typeof a.refs!=='string'||!a.refs))throw Error('local_read_refs_required');
    if(localStage&&(a.status||a.check))throw Error('local_retrieval_and_status_modes_are_exclusive');
    let continuation;
    if(['continue-ref','range-start','range-end'].some(key=>a[key]!==undefined)){
      if(localStage!=='read'||!/^c[1-9]\d*$/.test(a['continue-ref']??'')||a.refs!==a['continue-ref']
        ||!['range-start','range-end'].every(key=>/^(?:0|[1-9]\d*)$/.test(a[key]??'')&&Number.isSafeInteger(Number(a[key])))
        ||Number(a['range-end'])<=Number(a['range-start']))throw Error('invalid_local_continuation_arguments');
      continuation={ref:a['continue-ref'],range:{unit:'unicode_code_points',start:Number(a['range-start']),end:Number(a['range-end'])}};
    }
    if(config.kind==='cmcp_runtime_config'){
      if(a.manifest)throw Error('runtime_does_not_accept_experiment_manifest');
      runtime=await createCmcpRuntimeSession({config,repoRoot:repo,readOnly:a.status===true||a.check===true||readingStage==='read-progress',
        // This one-shot context outlet has no delivery channel or idle lifecycle.
        // Override only this process; never mutate the normal config or focus.
        controls:{proactive:false,...(a.disabled?{enabled:false}:{}),...(a.clean?{clean:true}:{})}});
      if(a.status||a.check){console.log(JSON.stringify(await runtime.status()));return;}
      if(readingStage==='read-progress'){await emit(projectCmcpHostReadingUnits((await runtime.readingStatus(a['read-progress'])).host));return;}
      if(a['lifecycle-file']){lifecycleFile=within(a['lifecycle-file']);await fs.mkdir(path.dirname(lifecycleFile),{recursive:true});
        await fs.writeFile(lifecycleFile,JSON.stringify({kind:'started',workId,pid:process.pid,sessionId:runtime.sessionId,startedAt:new Date().toISOString(),deadlineAt:a['deadline-at']??null})+'\n',{flag:'wx'});}
      const options={workId,signal:controller.signal,...(a['deadline-at']?{deadlineAt:a['deadline-at']}:{}),...(a.now?{timeContext:{now:a.now,timezone:input.timezone}}:{})};
      if(a['resume-source']&&a.text!==undefined)throw Error('resume_source_and_new_text_are_exclusive');
      const selectedRefs=localStage==='read'?a.refs.split(','):null;
      const navigation=a['navigation-ticket']?{navigationTicket:a['navigation-ticket'],selection:JSON.parse(a['scope-json']),
        ...(a['query-text']!==undefined?{queryText:a['query-text']}:{})}:{text:a.text};
      let output=readingStage==='read-scope'?await runtime.readingNavigate({...navigation,...(a['source-id']?{sourceId:a['source-id']}:{ }),...options})
        :openingReading?await runtime.readingOpen({...navigation,mode:readingStage==='read-all'?'all':'read',limits:await json(within(a['reading-limits'])),...options})
        :readingStage==='read-outline'?await runtime.readingOutline({ticket:a['read-outline'],...options})
        :readingStage==='read-page'?await runtime.readingPage({ticket:a['read-page'],project:a['project-page']===true,...options})
        :readingStage==='revoke-reading'?await runtime.revokeReading({ticket:a['revoke-reading'],reason:'caller_revoked'})
        :localStage==='candidates'?await runtime.localCandidates({text:a.text,...(a['source-id']?{sourceId:a['source-id']}:{ }),...options}):localStage==='read'
        ?await runtime.localRead({ticket:a['local-read'],refs:selectedRefs,...(continuation?{continuation}:{}),...options}):a['resume-source']
          ?await runtime.resumeContext(await json(within(a['resume-source'])),options):await runtime.context({text:a.text,...options});
      if(readingStage==='read'&&output.reader?.status==='ready')output=await runtime.readingOutline({ticket:output.reader.ticket,
        signal:controller.signal,...(a['deadline-at']?{deadlineAt:a['deadline-at']}:{})});
      const receiptPath=path.join(receiptRoot,runtime.sessionId+'.json');
      await fs.mkdir(receiptRoot,{recursive:true});await fs.writeFile(receiptPath,
        JSON.stringify({pid:process.pid,sessionId:runtime.sessionId,workId,at:new Date().toISOString(),
          ...(readingStage?{readingStage}:{}),
          ...(localStage?{localStage,...(localStage==='read'?{ticket:a['local-read'],selectedRefs,...(continuation?{continuation}:{})}: {})}:{}),...retainCmcpHostReadingReceipt(output)},null,2),{flag:'wx'});
      await emit(readingStage?projectCmcpHostReadingUnits(output.host):output.host);outputWritten=true;
      if(lifecycleFile)await fs.appendFile(lifecycleFile,JSON.stringify({kind:'completed',workId,pid:process.pid,at:new Date().toISOString(),receiptPath})+'\n');return;
    }
    if(a.check||localStage||readingStage)throw Error('normal_runtime_config_required');
    const proxy={async request(...args){
      if(a.status)throw Error('status_cannot_invoke_model');
      if(!adapter){const manifest=await json(within(a.manifest));
        if(!['host-context-v1','host-integration-v1'].includes(manifest.profile)||manifest.configHash!==loopHash(config)||manifest.protocolHash!==boundedProviderProtocolHash(manifest.profile))throw Error('frozen_host_configuration_mismatch');
        for(const [file,hash] of Object.entries(manifest.files))if(loopHash(await fs.readFile(within(file),'utf8'))!==hash)throw Error('frozen_file_mismatch');
        key=await readCmcpProtectedCredential(within('.cmcp/deepseek-credential.json'));
        adapter=createCmcpBoundedProviderAdapter({deepseekKey:key,ledgerRoot:within(manifest.ledgerRoot),manifest});key=undefined;
      }return adapter.request(...args);
    },dispose(){adapter?.dispose();}};
    if(!a.status){await fs.mkdir(input.root,{recursive:true});lockFile=path.join(input.root,'.common-input-writer.lock');lock=await fs.open(lockFile,'wx');await lock.writeFile(String(process.pid));await lock.sync();}
    runtime=await createCmcpLocalInput({...input,recallLimits:config.recallLimits,readOnly:a.status===true,adapter:proxy,
      delivery:{async present(){throw Error('context_only_cannot_present_answer');}}});
    runtime.setControls({enabled:!a.disabled,clean:a.clean===true});
    if(a.status){
      const s=await runtime.status();console.log(JSON.stringify({kind:'cmcp_host_status',modelCalls:0,registered:s.registration.registered,
        registrationPending:s.registration.unregistered.length,controls:s.controls,
        buffer:s.focus.buffer.map((row,i)=>({ref:'b'+(i+1),activatedAt:row.activatedAt,proactiveEligible:false})),
        latestRecall:s.latestRecall?{status:s.latestRecall.status,selection:s.latestRecall.selection,retrieval:s.latestRecall.retrieval,
          answer:s.latestRecall.answer,sourceBytes:s.latestRecall.sourceBytes,projectionBytes:s.latestRecall.projectionBytes}:null}));return;
    }
    // Receipt is internal and immutable. Only the explicit Host allowlist is printed.
    const output=await getCmcpHostContext({runtime,text:a.text,...(a.now?{timeContext:{now:a.now,timezone:input.timezone}}:{})});
    await fs.mkdir(receiptRoot,{recursive:true});
    await fs.writeFile(path.join(receiptRoot,runtime.sessionId+'.json'),JSON.stringify({pid:process.pid,sessionId:runtime.sessionId,at:new Date().toISOString(),...output},null,2),{flag:'wx'});
    console.log(JSON.stringify(output.host));
  }catch(error){
    // JSON.parse and native errors may embed input fragments or filenames. Keep
    // stable program codes; never turn malformed unsaved input into diagnostics.
    const code=error instanceof SyntaxError?'invalid_input_json':/^[a-zA-Z0-9_]{1,160}$/u.test(error?.message??'')?error.message:'host_operation_failed';
    if(receiptRoot){await fs.mkdir(receiptRoot,{recursive:true});await fs.writeFile(path.join(receiptRoot,'failure-'+process.pid+'.json'),
      JSON.stringify({code,at:new Date().toISOString()}),{flag:'wx'}).catch(()=>{});}
    await emit({question:a.text??null,context:null,retrieval:{status:'unavailable',reason:code,answerSufficiency:'not_assessed'}});
    if(lifecycleFile)await fs.appendFile(lifecycleFile,JSON.stringify({kind:'finished',workId,pid:process.pid,at:new Date().toISOString(),status:'failed',reason:code,remoteOutcome:'unknown'})+'\n');process.exitCode=1;}
  finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);await runtime?.close();adapter?.dispose();key=undefined;if(lock){await lock.close();await fs.unlink(lockFile);}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runCmcpHostContextCli();
