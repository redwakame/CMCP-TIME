import fs from 'node:fs/promises';
import path from 'node:path';
export const name='cmcp-project-entry-preflight';
export const inject=['credentials','llm','agents','cmcpSharedHarnessHost'];
export async function apply(ctx,config){
  if(typeof config?.outputFile!=='string'||!path.isAbsolute(config.outputFile)||!/^\w+$/.test(config.credentialRef??''))throw Error('project_entry_preflight_config_required');
  const description=await ctx.credentials.describe(config.credentialRef);
  await fs.mkdir(path.dirname(config.outputFile),{recursive:true});
  await fs.writeFile(config.outputFile,JSON.stringify({kind:'cmcp_project_entry_preflight',credentialConfigured:description.configured===true,credentialValueExported:false,hostCapabilityDependencyReady:true,modelCalls:0})+'\n',{flag:'wx'});
}
