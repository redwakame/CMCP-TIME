import fs from 'node:fs/promises';
import path from 'node:path';

export const name='cmcp-shared-harness-preflight';
export const inject=['credentials','llm','agents','cmcpSharedHarnessHost'];

/** 只查詢認證參照是否已設定，不解析或輸出秘密值、不呼叫模型。 */
export async function apply(ctx,config){
  if(typeof config?.outputFile!=='string'||!path.isAbsolute(config.outputFile)
    ||typeof config.credentialRef!=='string'||!/^[A-Z][A-Z0-9_]+$/.test(config.credentialRef))throw Error('shared_harness_preflight_config_required');
  const description=await ctx.credentials.describe(config.credentialRef);
  const result={kind:'cmcp_shared_harness_preflight',version:1,credentialRef:config.credentialRef,
    credentialConfigured:description.configured===true,credentialValueExported:false,hostCapabilityDependencyReady:true,modelCalls:0,
    providers:ctx.llm.listProviders().map(item=>({id:item.id}))};
  await fs.mkdir(path.dirname(config.outputFile),{recursive:true});
  await fs.writeFile(config.outputFile,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  if(config.lifecycle){
    const probe=config.lifecycle;
    if(typeof probe.sessionId!=='string'||!probe.sessionId.startsWith('cmcp-cross-host-20261003-harness-')
      ||!['workspace','gateFile','outputFile'].every(key=>typeof probe[key]==='string'&&path.isAbsolute(probe[key])))throw Error('shared_harness_lifecycle_probe_config_required');
    const observed=[],identity=agent=>({agentId:agent?.id??null,sessionId:agent?.session?.id??null,cwd:agent?.session?.header?.cwd??null,
      registrySameObject:agent?.id?ctx.agents.get(agent.id)===agent:false});
    const record=subscription=>payload=>{if(payload?.agent?.session?.id===probe.sessionId||payload?.agent?.id===probe.sessionId)observed.push({subscription,payloadKeys:Object.keys(payload),...identity(payload.agent)});};
    ctx.on('agent/created',record('ordinary'));
    ctx.on('agent/created',record('global'),{global:true});
    let running=false,finished=false,handle;
    ctx.effect(()=>{
      const timer=setInterval(async()=>{
        if(running||finished)return;
        try{await fs.access(probe.gateFile);}catch{return;}
        running=true;const outcome={kind:'cmcp_official_agent_lifecycle_probe',version:1,sessionId:probe.sessionId,modelCalls:0,promptSubmitted:false,observed};
        try{
          handle=await ctx.agents.create({sessionId:probe.sessionId,meta:{cwd:probe.workspace},agentOptions:probe.route});
          outcome.created=identity(handle.agent);await handle.dispose();handle=null;outcome.disposed=true;outcome.status='PASS';
        }catch(error){outcome.status='FAIL';outcome.error=/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'official_agent_lifecycle_failed';}
        finally{finished=true;running=false;await fs.writeFile(probe.outputFile,JSON.stringify(outcome,null,2)+'\n',{flag:'wx'});}
      },50);
      return async()=>{clearInterval(timer);await handle?.dispose();};
    },'cmcp-harness.zero-model-lifecycle-probe');
  }
}
