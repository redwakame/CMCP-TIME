import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {configureCmcpInstallation,inspectCmcpInstallation,inspectCmcpSetupEnvironment} from '../src/cmcp-guard/cmcp-setup.js';
import {resolveCmcpWorkspaceRoot} from '../src/cmcp-guard/cmcp-project-paths.js';
import {playgroundPath} from '../src/cmcp-guard/cmcp-playground.js';

const packageRoot=fileURLToPath(new URL('../',import.meta.url));
const help=`CMCP setup (project-local, no model calls or installation of dependencies)
node scripts/cmcp-setup.mjs                 Interactive setup
node scripts/cmcp-setup.mjs --root <dir> --status
node scripts/cmcp-setup.mjs --root <dir> --update
node scripts/cmcp-setup.mjs --root <dir> --disable
node scripts/cmcp-setup.mjs --root <dir> --uninstall
--answers <project-local JSON> supplies the same explicit choices for automation.
--workspace <dir> selects the existing writable authorization root (required for npm installs).
--host-workspace <dir> chooses a project-local Codex workspace.
Program assets remain in the installed package. Persistent npx hook attachment is unsupported.
Configuration and History are retained on disable/uninstall. No paid grant is created.
Codex hook trust is reviewed by Codex; do not bypass trust or run as administrator.`;
export async function runCmcpSetupCli(argv=process.argv.slice(2),{ask,emit=value=>console.log(typeof value==='string'?value:JSON.stringify(value,null,2))}={}){
 const {values:a}=parseArgs({args:argv,options:{workspace:{type:'string'},root:{type:'string'},'host-workspace':{type:'string'},answers:{type:'string'},status:{type:'boolean'},update:{type:'boolean'},disable:{type:'boolean'},uninstall:{type:'boolean'},help:{type:'boolean'}}});
 if(a.help){emit(help);return;}
 const projectRoot=resolveCmcpWorkspaceRoot(a.workspace);
 const root=a.root??'local-data/cmcp',hostWorkspace=a['host-workspace']??((a.update||a.disable||a.uninstall)?undefined:'local-data/cmcp-host');
 if([a.status,a.update,a.disable,a.uninstall].filter(Boolean).length>1)throw Error('choose_one_setup_action');
 if(a.status){emit(await inspectCmcpInstallation({projectRoot,root}));return;}
 let choices,reader;
 try{
  if(a.answers){const file=await playgroundPath(projectRoot,a.answers);choices=JSON.parse(await fs.readFile(file,'utf8'));}
  else if(!a.disable&&!a.uninstall){
   const previous=a.update?(await inspectCmcpInstallation({projectRoot,root})).choices:null;
   emit(inspectCmcpSetupEnvironment());
   reader=ask?null:createInterface({input:process.stdin,output:process.stdout});const question=ask??(q=>reader.question(q));
   const text=async(q,fallback)=>{const answer=(await question(`${q}${fallback===undefined?'':` [${fallback}]`}: `)).trim();if(!answer&&fallback===undefined)throw Error('explicit_setup_answer_required');return answer||fallback;};
   const yes=async q=>{const answer=(await question(`${q} (yes/no): `)).trim().toLowerCase();if(!['yes','no'].includes(answer))throw Error('explicit_yes_or_no_required');return answer==='yes';};
   const timezone=await text('Your effective timezone',previous?.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone);
   const language=await text('Default response language',previous?.language??'en'),scopeId=previous?.scopeId??await text('Private continuation scope ID','my-cmcp');
   if(previous)emit(`Updating existing scope ${scopeId}; its event scope and Skill identity are retained.`);
   const owner={id:await text('Your local owner ID',previous?.owner.id??'self'),label:await text('Your display name',previous?.owner.label??'Me')};
   const priorPeople=previous?.people??[],priorLabels=priorPeople.map(person=>person.label).join(',');
   const peopleText=await text('Optional people labels separated by comma; no accounts are contacted',priorLabels);
   const people=peopleText===priorLabels?priorPeople:peopleText?peopleText.split(',').map((label,index)=>({id:`person-${index+1}`,label:label.trim()})):[];
   const saveUser=await yes('Authorize saving your new message bodies to this data root');
   const saveAssistant=await yes('Authorize saving Assistant message bodies to this data root');
   const enabled=await yes('Enable CMCP time/source augmentation for this scope');
   const clean=await yes('Use Clean mode (suppress augmentation without deleting History)');
   const attachCodex=await yes('Attach the project-local Codex Skill and per-turn hooks');
   const providerMode=await text('Answer path: host or configured',previous?.providerMode??'host');
   const allowPaidCalls=await yes('Permit a separately authorized configured-provider path (no grant is created now)');
   const proactive=await yes('Enable automatic local proactive delivery; first-use default is OFF');
   const bufferHours=Number(await text('Buffer duration in hours, 6–48',String(previous?.bufferHours??12)));
   const featureControls={};
   for(const [key,label]of [['buffer','Buffer activity'],['timeIndex','Time/source index'],['historyRecall','History recall'],['answerHistory','On-demand original text'],['discussionAssociation','Discussion linking'],['pins','Pin controls']]){
    featureControls[key]=await yes(`Enable ${label}`);
   }
   if(await yes('Configure explicit do-not-disturb hours')){
    featureControls.doNotDisturb={enabled:true,timezone,windows:[{start:await text('Do-not-disturb start HH:MM'),end:await text('Do-not-disturb end HH:MM')}]};
   }else featureControls.doNotDisturb={enabled:false,timezone:null,windows:[]};
   if(await yes('Customize reading limits'))featureControls.readingLimits={
    maxSources:Number(await text('Maximum reading sources','64')),maxReadBytes:Number(await text('Cumulative reading bytes','65536')),
    maxProjectionBytes:Number(await text('Per-operation model projection bytes','16384')),pageBytes:Number(await text('User-facing page bytes','1400'))};
   choices={timezone,language,scopeId,skillName:previous?.skillName,owner,people,saveUser,saveAssistant,enabled,clean,attachCodex,providerMode,
    allowPaidCalls,paidConsent:allowPaidCalls,proactive,proactiveConsent:proactive,bufferHours,featureControls,authorizedBy:'Interactive explicit setup choices',events:previous?.events??[]};
  }
  const result=await configureCmcpInstallation({projectRoot,packageRoot,root,hostWorkspace,choices,action:a.update?'update':a.disable?'disable':a.uninstall?'uninstall':'setup'});
  emit(result);emit(`Chat/status: node ${JSON.stringify(path.join(packageRoot,'scripts/cmcp-playground.mjs'))} --workspace ${JSON.stringify(projectRoot)} --root ${JSON.stringify(path.relative(projectRoot,result.root))} --status`);
  emit(`Codex: codex --enable hooks --cd ${JSON.stringify(result.hostWorkspace)}; review this project's hook trust in /hooks. No DeepSeek key or administrator mode is required for host mode.`);
 }finally{reader?.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runCmcpSetupCli().catch(error=>{console.error(error.message);process.exitCode=1;});
