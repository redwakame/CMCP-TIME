import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {pathToFileURL} from 'node:url';
import {Transform} from 'node:stream';
import {loadMcpConfig,readJSON,safeError} from './config.mjs';
import {resolveGrant} from './auth.mjs';
import {createMcpReader} from './tools.mjs';
import {callSharedProject} from '../shared-project/client.mjs';

export async function startMcpStdio({bindingFile,input=process.stdin,output=process.stdout}){
  const binding=await readJSON(bindingFile);if(binding?.kind!=='cmcp_mcp_stdio_binding'||binding.version!==1)throw Error('mcp_stdio_binding_invalid');
  const {config,shared}=await loadMcpConfig(binding.configFile),resolved=await resolveGrant(config,binding.subject);if(resolved.stamp!==binding.grantStamp)throw Error('mcp_authorization_changed');
  const authorization={...resolved,subject:binding.subject};
  const reader=createMcpReader({config,shared,authorization,dispatch:(request,principal,{signal}={})=>callSharedProject({connection:{pipe:shared.pipe,authFile:shared.hosts[principal.hostId].readAuthFile},role:'model_read',request,signal,timeoutMs:config.limits.timeoutMs})});
  let framedBytes=0;const bounded=new Transform({transform(chunk,encoding,done){const bytes=Buffer.from(chunk);for(const byte of bytes){if(byte===10)framedBytes=0;else if(++framedBytes>config.limits.requestBytes)return done(Error('mcp_request_too_large'));}done(null,bytes);}});
  const transport=new StdioServerTransport(bounded,output);let resolveClosed;const closed=new Promise(r=>resolveClosed=r);let stopped;
  const close=()=>stopped??=(async()=>{input.unpipe(bounded);input.pause();await reader.close();})().finally(resolveClosed);
  bounded.on('error',()=>close().catch(()=>{}));input.once('end',()=>close().catch(()=>{}));await reader.server.connect(transport);input.pipe(bounded);return {close,closed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--binding')throw Error('mcp_stdio_binding_required');
  try{const server=await startMcpStdio({bindingFile:args[1]});for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>server.close().catch(()=>{}));await server.closed;}
  catch(error){process.stderr.write(safeError(error)+'\n');process.exitCode=1;}}
