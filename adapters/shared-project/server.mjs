import net from 'node:net';
import {timingSafeEqual} from 'node:crypto';
import {createSharedProjectService} from './service.mjs';
import {MAX_FRAME_BYTES,readSharedProjectCredential} from './client.mjs';

const safeError=error=>{
  // Core 的單次導航票拒絕包含內部 workId；對外保留原因，不公開識別碼或放寬任意錯誤文字。
  if(/^reading_navigation_already_consumed:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(error?.message))return 'reading_navigation_already_consumed';
  return /^[a-z][a-z0-9_]{1,100}$/.test(error?.message)?error.message:'shared_project_operation_failed';
};
/** 不綁 TCP、不讀 provider credential；只在本機受驗 named pipe 接收一次性 JSON frame。 */
export async function startSharedProjectServer({config,bridgeFactory}){
  const service=await createSharedProjectService({config,bridgeFactory}),credentials=[];
  try{for(const hostId of Object.keys(service.config.hosts))for(const role of ['controller','model_read']){
    const file=service.config.hosts[hostId][role==='controller'?'controlAuthFile':'readAuthFile'],credential=await readSharedProjectCredential(file);
    if(credential.projectId!==config.projectId||credential.hostId!==hostId||credential.role!==role)throw Error('shared_project_credential_binding_mismatch');credentials.push(credential);}
    if(new Set(credentials.map(c=>c.token)).size!==credentials.length)throw Error('shared_project_credentials_must_differ');
  }catch(error){await service.close();throw error;}
  let closing=null;const sockets=new Set();
  const server=net.createServer(socket=>{
    const pending=new AbortController();socket.once('close',()=>pending.abort());
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.setTimeout(15000,()=>socket.destroy());
    let chunks=[],bytes=0,used=false;
    socket.on('data',async chunk=>{
      if(used)return socket.destroy();bytes+=chunk.length;if(bytes>MAX_FRAME_BYTES)return socket.destroy();chunks.push(chunk);
      const data=Buffer.concat(chunks),end=data.indexOf(10);if(end<0)return;used=true;
      try{
        if(end!==data.length-1)throw Error('shared_project_invalid_frame');const frame=JSON.parse(data.subarray(0,end).toString('utf8'));
        if(!frame||Object.keys(frame).sort().join(',')!=='credential,request')throw Error('shared_project_invalid_frame');
        const c=frame.credential,known=credentials.find(k=>k.hostId===c?.hostId&&k.role===c?.role);
        if(!known||c?.kind!==known.kind||c?.version!==1||c?.projectId!==known.projectId||typeof c.token!=='string'||!/^[a-f0-9]{64}$/.test(c.token)
          ||!timingSafeEqual(Buffer.from(known.token,'hex'),Buffer.from(c.token,'hex')))throw Error('shared_project_authentication_failed');
        const result=await service.dispatch(frame.request,{hostId:known.hostId,role:known.role},{signal:pending.signal});const response=JSON.stringify({ok:true,result})+'\n';
        if(Buffer.byteLength(response)>MAX_FRAME_BYTES)throw Error('shared_project_response_too_large');socket.end(response);
      }catch(error){socket.end(JSON.stringify({ok:false,error:safeError(error)})+'\n');}
    });
  });
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(service.config.pipe,()=>{server.off('error',reject);resolve();});});}
  catch(error){await service.close();throw Error(error.code==='EADDRINUSE'?'shared_project_pipe_busy':'shared_project_pipe_unavailable');}
  server.on('error',()=>{close().catch(()=>{});});
  function close(){if(closing)return closing;clearTimeout(timer);for(const socket of sockets)socket.destroy();
    closing=Promise.all([new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),service.close()]).then(()=>({status:'closed',modelCalls:0}));return closing;}
  const timer=setTimeout(()=>{close().catch(()=>{});},service.config.lifetimeMs);timer.unref();
  return Object.freeze({close,pipe:service.config.pipe,dispatch:service.dispatch,config:service.config,deadlineAt:new Date(Date.now()+service.config.lifetimeMs).toISOString()});
}
