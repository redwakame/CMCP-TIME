import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createLocalLoopJournal} from './cmcp-local-loop-journal.js';
import {createCmcpRuntimeSession,normalizeCmcpRuntimeConfig} from './cmcp-runtime-session.js';
import {normalizeCmcpReadingLimits} from './cmcp-reading.js';

/** UI bookmarks only. Sources, events, reading progress and budget stay in the existing Runtime. */
export const playgroundReadingLimits=Object.freeze({maxSources:64,maxTotalBytes:65536,maxPageBytes:1400,maxPages:80,maxProjectionBytes:16384});
export async function playgroundPath(repoRoot,value){
 const repo=await fs.realpath(repoRoot),target=path.resolve(repo,value),relative=path.relative(repo,target);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('playground_path_outside_repo');
 let current=repo;for(const part of relative.split(path.sep)){current=path.join(current,part);try{if((await fs.lstat(current)).isSymbolicLink())throw Error('playground_redirect_forbidden');}catch(error){if(error.code!=='ENOENT')throw error;}}
 return target;
}
export function defaultPlaygroundConfig(root,{timezone=Intl.DateTimeFormat().resolvedOptions().timeZone}={}){return {kind:'cmcp_runtime_config',version:1,runtimeId:'deepseek-playground',
 input:{root:path.join(root,'state'),scopeId:'cmcp-deepseek-playground',events:[
  {key:'studio',eventId:'studio-exhibition',objects:[{objectId:'studio-exhibition',aspects:['arrangements','progress']}]},
  {key:'harbor',eventId:'harbor-exhibition',objects:[{objectId:'harbor-exhibition',aspects:['arrangements','progress']}]}],
  limits:{maxEntries:12,maxCatalogBytes:7000,maxSources:2,maxSourceBytes:4096,maxProjectionBytes:8500},
  storageCapacity:{maxSources:256,maxSourceBytes:65536},timezone,
  loopTiming:{ttlMs:600000,inactivityMs:60000,activityWindowMs:600000}},
 sourceCatalog:{maxSegments:64},
 localRetrieval:{maxStoredSources:256,maxCandidates:4,maxCandidateBytes:6000,maxExcerptCodePoints:420,maxQueryBytes:4096,
  maxIndexSourceBytes:65536,maxIndexTokens:131072,maxReadSources:2,maxReadBytes:4096,maxProjectionBytes:8500},
 recallLimits:{maxEntries:12,maxCatalogBytes:10000,maxSources:2,maxSourceBytes:4096,maxProjectionBytes:8500},
 receiptRoot:path.join(root,'receipts'),credentialRef:'.cmcp/deepseek-credential.json',sourceAuthorization:{saveUser:true,saveAssistant:true},
 responsePreferences:{language:'en'},controls:{enabled:true,clean:false,proactive:false},deepseekStream:false,bufferRetention:{hours:12},discussionAssociation:{enabled:true},answerHistory:{enabled:true}};}

export async function loadCmcpPlayground({repoRoot,root='local-data/deepseek-playground',initialize=false}){
 root=await playgroundPath(repoRoot,root);const configPath=await playgroundPath(repoRoot,path.join(root,'config.json')),profilePath=await playgroundPath(repoRoot,path.join(root,'playground.json'));
 const defaults={version:1,kind:'cmcp_playground_ui',topics:[{key:null,label:'一般對話'},{key:'studio',label:'Studio Exhibition'},{key:'harbor',label:'Harbor Exhibition'}],readingLimits:playgroundReadingLimits};
 async function readOrCreate(file,value){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;
  if(initialize){await fs.mkdir(root,{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}return value;}}
 const config=await readOrCreate(configPath,defaultPlaygroundConfig(root)),profile=await readOrCreate(profilePath,defaults);
 const normalized=normalizeCmcpRuntimeConfig(config,{repoRoot});
 // The trial owns only this root. A config cannot silently redirect its data or receipts elsewhere.
 for(const target of [normalized.config.input.root,normalized.config.receiptRoot]){const relative=path.relative(root,target);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('playground_config_data_outside_root');await playgroundPath(repoRoot,target);}
 if(profile.kind!=='cmcp_playground_ui'||profile.version!==1||!Array.isArray(profile.topics)||!profile.topics.length
  ||new Set(profile.topics.map(row=>row.key)).size!==profile.topics.length
  ||profile.topics.some(row=>typeof row.label!=='string'||!row.label.trim()||row.key!==null&&!config.input.events.some(event=>event.key===row.key)))throw Error('invalid_playground_profile');
 normalizeCmcpReadingLimits(profile.readingLimits);
 return {root,configPath,profilePath,config,profile};
}

export async function createCmcpPlayground({repoRoot,settings,sessionFactory=createCmcpRuntimeSession,observe=async()=>{},delivery,sessionName}){
 const journal=createLocalLoopJournal({root:path.join(settings.root,'ui-journal'),name:'cmcp-playground-ui-v1'});
 let runtime=null,current=null,closed=false;
 async function state(){const rows=await journal.read(),sessions=[];let selected=null;
  for(const {record:{kind,value}}of rows){if(kind==='session_created')sessions.push({...value,eventKey:null,readingTicket:null});
   const found=sessions.find(row=>row.id===value.id);if(kind==='session_selected')selected=value.id;
   else if(kind==='topic_selected'&&found)found.eventKey=value.eventKey;
   else if(kind==='reading_selected'&&found)found.readingTicket=value.ticket;}
  return {sessions,selected};}
 async function choose(reference,{create=false}={}){
  if(closed)throw Error('playground_closed');const saved=await state();let next;
  if(create){if(typeof reference!=='string'||!reference.trim()||[...reference].length>120)throw Error('invalid_session_name');
   if(saved.sessions.some(row=>row.label===reference.trim()))throw Error('session_name_exists');next={id:randomUUID(),label:reference.trim(),createdAt:new Date().toISOString(),eventKey:null,readingTicket:null};}
  else next=saved.sessions.find((row,index)=>String(index+1)===reference||row.label===reference||row.id===reference);
  if(!next)throw Error('session_not_found');
  // A UI Session switch is not a new enable/clean/proactive authorization.
  const controls=runtime?(await runtime.status()).controls:undefined;await runtime?.close();runtime=null;
  runtime=await sessionFactory({config:settings.config,repoRoot,sessionId:next.id,observe,delivery,...(controls?{controls}: {})});
  if(create)await journal.append('session_created',{id:next.id,label:next.label,createdAt:next.createdAt});
  await journal.append('session_selected',{id:next.id,at:new Date().toISOString()});current=next;
  return {kind:'playground_session',...current,modelCalls:0,budgetReset:false};
 }
 const saved=await state();if(sessionName){const match=saved.sessions.find(row=>row.label===sessionName||row.id===sessionName);await choose(match?.id??sessionName,{create:!match});}
 else if(saved.selected)await choose(saved.selected);else await choose('Getting started',{create:true});
 async function status(){return {kind:'playground_status',session:{...current},runtime:await runtime.status(),
   registrationRecovery:(await journal.read()).findLast(row=>row.record.kind==='registration_recovery_progress')?.record.value??null,modelCalls:0};}
 const api={settings,status,get runtime(){return runtime;},get current(){return {...current};},
  async sessions(){const saved=await state();return {kind:'playground_sessions',selected:current.id,sessions:saved.sessions,modelCalls:0};},
  newSession:label=>choose(label,{create:true}),useSession:reference=>choose(reference),
  async topic(reference){const selected=settings.profile.topics.find((row,index)=>String(index+1)===reference||row.label===reference||row.key===reference||reference==='general'&&row.key===null);
   if(!selected)throw Error('topic_not_found');await journal.append('topic_selected',{id:current.id,eventKey:selected.key});current.eventKey=selected.key;
   return {kind:'playground_topic',...selected,modelCalls:0};},
  async submit(text,options={}){return runtime.submit({...options,text,eventKey:current.eventKey});},
  async register({resume=false}={}){const previous=(await journal.read()).findLast(row=>row.record.kind==='registration_recovery_progress')?.record.value;
   if(resume&&!previous?.nextCursor)throw Error('no_registration_recovery_pending');
   const result=await runtime.recover({maxPages:1,...(resume?{cursor:previous.nextCursor}:{})});
   await journal.append('registration_recovery_progress',{status:result.status,nextCursor:result.inventory?.nextCursor??null,
    sources:result.sources??0,pending:result.pending??[],inventoryStatus:result.inventory?.status??null,modelCalls:0});
   return result;},
  async recoveries(){const status=await runtime.status(),state=status.discussionAssociation;
   const rows=[...(status.pending?.conversation??[]),...(status.pending?.event??[]).flatMap(event=>event.pending.map(row=>({pointer:row.pointer??row,eventKey:event.key,status:'pending',reason:'event_or_dialogue_pending'}))),
    ...(state?.unassociated??[]),...(state?.pending??[]),...(state?.assistant?.pending??[])],seen=new Set(),sources=[];
   for(const row of rows){const pointer=row.replyTo??row.pointer,id=JSON.stringify(pointer);if(seen.has(id))continue;seen.add(id);
     sources.push({number:sources.length+1,pointer,eventKey:row.eventKey??null,status:row.status,reason:row.reason??null});}
   return {kind:'playground_discussion_recoveries',sources,modelCalls:0};},
  async resumeDiscussion(reference,options={}){const list=await api.recoveries(),selected=list.sources.find(row=>String(row.number)===reference);
   if(!selected)throw Error('discussion_recovery_selection_required');return runtime.resumeDiscussion(selected.pointer,options);},
  async resumeConversation(reference,options={}){const list=await api.recoveries(),selected=list.sources.find(row=>String(row.number)===reference);
   if(!selected)throw Error('conversation_recovery_selection_required');return runtime.resumeConversation(selected.pointer,options);},
  async read(text,{all=false,...options}={}){
   // A new question that fails or is ambiguous must not silently page the previous question.
   await journal.append('reading_selected',{id:current.id,ticket:null});current.readingTicket=null;
   const result=await runtime.readingOpen({...options,text,mode:all?'all':'read',limits:settings.profile.readingLimits,naturalTime:true});
   if(result.reader?.status==='ready'&&result.reader.collection&&result.reader.ticket){await journal.append('reading_selected',{id:current.id,ticket:result.reader.ticket});current.readingTicket=result.reader.ticket;
     if(!all)return runtime.readingOutline({ticket:current.readingTicket,...(options.signal?{signal:options.signal}:{})});}return result;},
  async page(options={}){if(!current.readingTicket)throw Error('no_reading_selected');return runtime.readingPage({...options,ticket:current.readingTicket,project:false});},
  async progress(){if(!current.readingTicket)return {kind:'playground_reading',status:'none',modelCalls:0};return runtime.readingStatus(current.readingTicket);},
  async revoke(){if(!current.readingTicket)throw Error('no_reading_selected');return runtime.revokeReading({ticket:current.readingTicket});},
  async close(){if(closed)return;closed=true;await runtime?.close();}};
 return Object.freeze(api);
}
