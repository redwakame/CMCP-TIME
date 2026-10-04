import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export const MAX_FRAME_BYTES=1048576;
export const MODEL_OPERATIONS=Object.freeze({find:'cmcp_find_history',open:'cmcp_open_history',read:'cmcp_read_history',progress:'cmcp_reading_progress','reader-status':'cmcp_status','list-images':'cmcp_list_images','read-image':'cmcp_read_image'});
// 既有 Codex／Harness 順序交接只承諾文字。通用 MCP 增加工具不自動擴大宿主 profile。
const textOperations=Object.freeze(['find','open','read','progress']);
export const MODEL_TEXT_PROFILE=Object.freeze({kind:'cmcp_model_read_capabilities',version:1,profile:'shared-text-v1',readOnly:true,modelCapture:false,modelControl:false,
  operations:textOperations,tools:Object.freeze(textOperations.map(operation=>MODEL_OPERATIONS[operation])),
  unavailableOperations:Object.freeze(Object.keys(MODEL_OPERATIONS).filter(operation=>!textOperations.includes(operation))),
  reason:'本 profile 保留已驗的四項文字正式閱讀；狀態與媒體 MCP 工具是另一個明示傳輸能力，不宣稱本宿主已接通。'});
export const validHostId=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
export function validatePipe(pipe){if(typeof pipe!=='string'||(!/^\\\\\.\\pipe\\cmcp-[A-Za-z0-9._-]{1,100}$/.test(pipe)&&!(process.platform!=='win32'&&path.isAbsolute(pipe)&&Buffer.byteLength(pipe)<=100&&path.basename(pipe).startsWith('cmcp-')&&pipe.endsWith('.sock'))))throw Error('shared_project_invalid_pipe');return pipe;}
export async function readSharedProjectCredential(file){
  if(typeof file!=='string'||!file)throw Error('shared_project_invalid_credential');
  const stat=await fs.stat(file);if(!stat.isFile()||stat.size>4096)throw Error('shared_project_invalid_credential');
  const value=JSON.parse(await fs.readFile(file,'utf8'));
  if(!value||Object.keys(value).sort().join(',')!=='hostId,kind,projectId,role,token,version'||value.kind!=='cmcp_shared_project_credential'||value.version!==1
    ||!validHostId(value.hostId)||!['controller','model_read'].includes(value.role)||typeof value.projectId!=='string'||!value.projectId
    ||typeof value.token!=='string'||!/^([a-f0-9]{64})$/.test(value.token))throw Error('shared_project_invalid_credential');
  return value;
}
/** 憑證僅送本機固定 named pipe；不放回傳、錯誤或證據。 */
export async function callSharedProject({connection,role,request,timeoutMs=30000,signal}){
  validatePipe(connection?.pipe);
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw Error('shared_project_invalid_timeout');
  const credential=await readSharedProjectCredential(connection.authFile);
  if(credential.role!==role||credential.projectId!==request?.projectId||credential.hostId!==request?.hostId)throw Error('shared_project_credential_binding_mismatch');
  const frame=JSON.stringify({credential,request})+'\n';if(Buffer.byteLength(frame)>MAX_FRAME_BYTES)throw Error('shared_project_frame_too_large');
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(connection.pipe);let chunks=[],bytes=0,settled=false;
    const abort=()=>finish(Error('shared_project_request_cancelled'));
    const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(value);};
    if(signal?.aborted){finish(Error('shared_project_request_cancelled'));return;}signal?.addEventListener('abort',abort,{once:true});
    socket.setTimeout(timeoutMs,()=>finish(Error('shared_project_ipc_timeout')));
    socket.once('connect',()=>socket.write(frame));socket.on('error',()=>finish(Error('shared_project_ipc_unavailable')));
    socket.on('end',()=>{if(!settled)finish(Error('shared_project_ipc_incomplete'));});
    socket.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_FRAME_BYTES)return finish(Error('shared_project_frame_too_large'));chunks.push(chunk);
      const data=Buffer.concat(chunks),end=data.indexOf(10);if(end<0)return;
      try{if(end!==data.length-1)throw Error();const result=JSON.parse(data.subarray(0,end).toString('utf8'));
        if(result.ok===true)finish(null,result.result);else if(result.ok===false&&/^[a-z][a-z0-9_]{1,100}$/.test(result.error))finish(Error(result.error));else throw Error();
      }catch{finish(Error('shared_project_ipc_invalid_response'));}});
  });
}
