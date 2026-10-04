import http from 'node:http';
import net from 'node:net';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {isInitializeRequest} from '@modelcontextprotocol/sdk/types.js';
import {startSharedProjectServer} from '../shared-project/server.mjs';
import {loadMcpConfig,readJSON,atomicJSON,safeError} from './config.mjs';
import {createJwtVerifier,authorizeReader,revokeReader} from './auth.mjs';
import {createMcpReader,capabilities} from './tools.mjs';

export async function startMcpService({configFile,onReceipt=()=>{},bridgeFactory}){
  const {config,shared}=await loadMcpConfig(configFile),verify=await createJwtVerifier(config),secret=await readJSON(config.managementAuthFile);
  if(typeof secret.token!=='string'||!/^[a-f0-9]{64}$/.test(secret.token))throw Error('mcp_management_credential_invalid');
  const broker=await startSharedProjectServer({config:await readJSON(config.sharedConfig),bridgeFactory}),sessions=new Map(),managementSockets=new Set(),httpRequests=new Set();let closing=null,managementSerial=Promise.resolve();
  const instance=randomUUID(),send=(res,code,value)=>{if(res.headersSent||res.destroyed)return;res.writeHead(code,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
  const dispatch=(...args)=>broker.dispatch(...args);
  const server=http.createServer(async(req,res)=>{
    httpRequests.add(req);res.once('close',()=>httpRequests.delete(req));
    const requestTimer=setTimeout(()=>{send(res,408,{error:'mcp_request_timeout'});req.destroy();},config.limits.timeoutMs);
    res.once('finish',()=>clearTimeout(requestTimer));res.once('close',()=>clearTimeout(requestTimer));
    try{
      if(!config.http.allowedHosts.includes(req.headers.host)||req.headers.origin&&!config.http.allowedOrigins.includes(req.headers.origin))return send(res,403,{error:'mcp_host_or_origin_denied'});
      if(req.headers.forwarded||(!config.http.remote&&(req.headers['x-forwarded-for']||req.headers['x-forwarded-host']||req.headers['x-forwarded-proto'])))return send(res,403,{error:'mcp_forwarded_header_denied'});
      if(config.http.remote&&(req.headers['x-forwarded-proto']!=='https'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)))return send(res,403,{error:'mcp_trusted_tls_proxy_required'});
      if(req.url==='/health'&&req.method==='GET')return send(res,closing?503:200,{status:closing?'stopping':'ready',transport:'streamable-http',modelCalls:0});
      if(req.url!=='/mcp')return send(res,404,{error:'mcp_route_not_found'});
      if(closing)return send(res,503,{error:'mcp_service_stopping'});
      const header=req.headers.authorization;if(typeof header!=='string'||!header.startsWith('Bearer '))return send(res,401,{error:'mcp_bearer_required'});
      const token=header.slice(7);let authorization;try{authorization=await verify(token);}catch(error){return send(res,401,{error:safeError(error)});}
      const sessionId=req.headers['mcp-session-id'];let session;
      if(sessionId){session=sessions.get(sessionId);if(!session||session.authorization.subject!==authorization.subject||session.authorization.stamp!==authorization.stamp)return send(res,403,{error:'mcp_session_principal_mismatch'});}
      let body;
      if(req.method==='POST'){
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))return send(res,415,{error:'mcp_json_required'});
        if(Number(req.headers['content-length']??0)>config.limits.requestBytes)return send(res,413,{error:'mcp_request_too_large'});
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>config.limits.requestBytes){send(res,413,{error:'mcp_request_too_large'});return;}chunks.push(chunk);}try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(res,400,{error:'mcp_invalid_json'});}
      }
      if(!session){
        if(req.method!=='POST'||!isInitializeRequest(body))return send(res,400,{error:'mcp_initialization_required'});
        if(sessions.size>=config.limits.maxSessions)return send(res,429,{error:'mcp_session_capacity'});
        // Session ID 是通訊身分，不是授權；每個 HTTP 請求與工具結果均重新核對 grant。
        session={authorization,lastAt:Date.now()};
        const reader=createMcpReader({config,shared,authorization,dispatch,revalidate:async()=>{const fresh=await verify(token);if(fresh.stamp!==authorization.stamp)throw Error('mcp_authorization_changed');},onReceipt});
        const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID(),enableJsonResponse:true,maxRequestBodySize:config.limits.requestBytes,
          onsessioninitialized:id=>sessions.set(id,session),onsessionclosed:id=>{sessions.delete(id);reader.close().catch(()=>{});}});
        session.reader=reader;session.transport=transport;await reader.server.connect(transport);
        const sdkOnClose=transport.onclose;transport.onclose=()=>{if(transport.sessionId)sessions.delete(transport.sessionId);sdkOnClose?.();};
      }
      clearTimeout(requestTimer);session.lastAt=Date.now();await session.transport.handleRequest(req,res,body);
    }catch(error){send(res,500,{error:safeError(error)});}
  });
  server.requestTimeout=config.limits.timeoutMs;server.headersTimeout=config.limits.timeoutMs;server.keepAliveTimeout=1000;
  const management=net.createServer(socket=>{managementSockets.add(socket);socket.once('close',()=>managementSockets.delete(socket));socket.on('error',()=>{});socket.setTimeout(15000,()=>socket.destroy());let bytes=0,chunks=[],used=false;
    socket.on('data',chunk=>{if(used)return socket.destroy();bytes+=chunk.length;if(bytes>16384)return socket.destroy();chunks.push(chunk);const buffer=Buffer.concat(chunks),end=buffer.indexOf(10);if(end<0)return;used=true;
      managementSerial=managementSerial.then(async()=>{try{if(end!==buffer.length-1)throw Error('mcp_management_frame_invalid');const frame=JSON.parse(buffer.subarray(0,end).toString());
        if(typeof frame.token!=='string'||!/^[a-f0-9]{64}$/.test(frame.token)||!timingSafeEqual(Buffer.from(frame.token,'hex'),Buffer.from(secret.token,'hex')))throw Error('mcp_management_auth_failed');
        if(Object.keys(frame).some(k=>!['token','operation','args'].includes(k)))throw Error('mcp_management_frame_invalid');
        let result;switch(frame.operation){case 'health':result={status:closing?'stopping':'ready',instance,projectId:config.projectId,pipe:broker.pipe,http:'http://'+config.http.host+':'+config.http.port+'/mcp',sessions:sessions.size,modelCalls:0};break;
          case 'capabilities':result=capabilities;break;
          case 'authorize-reader':if(!frame.args||Object.keys(frame.args).some(k=>!['hostId','sessionId','subject','ttlSeconds'].includes(k)))throw Error('mcp_management_args_invalid');result=await authorizeReader({...frame.args,config,shared});break;
          case 'revoke-reader':result=await revokeReader(config,frame.args?.subject);break;
          case 'stop':result={status:'stopping',instance,modelCalls:0};break;
          default:throw Error('mcp_management_operation_unknown');}
        socket.end(JSON.stringify({ok:true,result})+'\n');if(frame.operation==='stop')setImmediate(()=>close().catch(()=>{}));
      }catch(error){socket.end(JSON.stringify({ok:false,error:safeError(error)})+'\n');}}).catch(()=>socket.destroy());});
  });
  const listen=(s,...args)=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(...args,()=>{s.off('error',reject);resolve();});});
  let timer;
  try{await listen(management,config.managementPipe);await listen(server,config.http.port,config.http.host);
    await atomicJSON(config.stateFile,{kind:'cmcp_mcp_service_state',status:'ready',instance,pid:process.pid,startedAt:new Date().toISOString(),http:'http://'+config.http.host+':'+config.http.port+'/mcp',modelCalls:0});
  }catch(error){await Promise.allSettled([new Promise(r=>management.close(()=>r())),new Promise(r=>server.close(()=>r())),broker.close()]);throw Error(error.code==='EADDRINUSE'?'mcp_listener_busy':safeError(error));}
  const idle=setInterval(()=>{for(const [id,session]of sessions)if(Date.now()-session.lastAt>config.limits.idleMs){sessions.delete(id);session.reader.close().catch(()=>{});}},Math.min(config.limits.idleMs,30000));idle.unref();
  timer=setTimeout(()=>close().catch(()=>{}),shared.lifetimeMs);timer.unref();
  let resolveClosed;const closed=new Promise(r=>resolveClosed=r);
  function close(){if(closing)return closing;clearInterval(idle);clearTimeout(timer);closing=(async()=>{
    await Promise.allSettled([...sessions.values()].map(s=>s.reader.close()));sessions.clear();
    await broker.close();for(const socket of managementSockets)socket.end();for(const req of httpRequests)req.destroy();server.closeIdleConnections();
    await Promise.all([new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())),new Promise((resolve,reject)=>management.close(e=>e?reject(e):resolve()))]);
    await atomicJSON(config.stateFile,{kind:'cmcp_mcp_service_state',status:'closed',instance,pid:process.pid,endedAt:new Date().toISOString(),modelCalls:0});resolveClosed();return {status:'closed',modelCalls:0};})();return closing;}
  server.on('error',()=>close().catch(()=>{}));management.on('error',()=>close().catch(()=>{}));
  return {close,closed,config,shared,instance,dispatch,url:'http://'+config.http.host+':'+config.http.port+'/mcp'};
}
export async function callManagement(config,operation,args={}){const credential=await readJSON(config.managementAuthFile);return new Promise((resolve,reject)=>{
  const socket=net.createConnection(config.managementPipe);let data='',settled=false;const finish=(e,value)=>{if(settled)return;settled=true;socket.destroy();e?reject(e):resolve(value);};
  socket.setTimeout(15000,()=>finish(Error('mcp_management_timeout')));socket.on('error',()=>finish(Error('mcp_service_unavailable')));socket.on('end',()=>{if(!settled)finish(Error('mcp_management_incomplete'));});
  socket.once('connect',()=>socket.write(JSON.stringify({token:credential.token,operation,args})+'\n'));socket.on('data',chunk=>{data+=chunk.toString();if(Buffer.byteLength(data)>32768)return finish(Error('mcp_management_response_too_large'));if(!data.endsWith('\n'))return;
    try{const value=JSON.parse(data);value.ok?finish(null,value.result):finish(Error(value.error));}catch{finish(Error('mcp_management_response_invalid'));}});
});}
