import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {identityRequest,resolveGrant} from './auth.mjs';
import {safeError} from './config.mjs';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const packageInfo=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
const sourceIndexSha256=createHash('sha256').update(fs.readFileSync(new URL('../../PUBLIC-FILES.json',import.meta.url))).digest('hex');

export const capabilities=Object.freeze({kind:'cmcp_mcp_capabilities',version:1,productVersion:packageInfo.version,sourceIndexSha256,transports:['stdio','streamable-http'],readOnlyTools:true,modelCapture:false,modelControl:false,
  requires:'可信宿主須先明確加入、取得 writer 並以正式生命週期建立使用者回合；MCP 不補造使用者訊息',
  operations:['cmcp_status','cmcp_find_history','cmcp_open_history','cmcp_read_history','cmcp_reading_progress','cmcp_list_images','cmcp_read_image'],
  media:'只接受本回合正式閱讀產生的 sourceRef 與媒體 ID；每次回傳最多 512 KiB 原件；超限明示拒絕',authorization:'預先配置的標準 JWT bearer；不實作 OAuth 登入或授權伺服器',modelCalls:0});
const definitions=[
  ['cmcp_status','reader-status','查看目前已授權專案與有效控制；不改原時間。',z.object({}).strict()],
  ['cmcp_find_history','find','依可信宿主本回合問題找出正式歷史候選。導航不是原文。',z.object({}).strict()],
  ['cmcp_open_history','open','依導航票券建立正式讀取；READ-ALL 須沿完整閱讀。',z.object({navigationTicket:z.string().min(1).max(256),selectionJson:z.string().min(2).max(16384)}).strict()],
  ['cmcp_read_history','read','讀正式閱讀票券下一頁原文，保留來源角色、時間及版本。',z.object({ticket:z.string().min(1).max(256)}).strict()],
  ['cmcp_reading_progress','progress','查看正式讀取覆蓋，不將有限未命中當作全歷史不存在。',z.object({ticket:z.string().min(1).max(256)}).strict()],
  ['cmcp_list_images','list-images','僅列出本回合正式已讀 User 來源連結的圖片原件。',z.object({sourceRef:z.string().min(1).max(256)}).strict()],
  ['cmcp_read_image','read-image','依正式媒體 handle 讀取已授權原圖；不接受路徑或 URL。',z.object({sourceRef:z.string().min(1).max(256),mediaId:z.string().min(1).max(256)}).strict()]
];
export function createMcpReader({config,shared,authorization,dispatch,revalidate,onReceipt=()=>{}}){
  const server=new McpServer({name:'cmcp-time',version:packageInfo.version},{maxToolInputElements:256}),pending=new Set();let closed=false;
  const guard=async()=>{if(closed)throw Error('mcp_reader_closed');const fresh=await resolveGrant(config,authorization.subject);if(fresh.stamp!==authorization.stamp)throw Error('mcp_authorization_changed');if(revalidate)await revalidate();return fresh.grant;};
  const boundStatus=async(grant,signal)=>{const result=await dispatch(identityRequest(shared,grant,'reader-status'),{hostId:grant.hostId,role:'model_read'},{signal});
    if(result.epoch!==grant.epoch||result.activeTurnId!==grant.activeTurnId||!result.joined||!result.activeTurn||result.owner?.hostId!==grant.hostId||result.owner?.sessionId!==grant.sessionId)throw Error('mcp_host_turn_authorization_changed');return result;};
  for(const [name,operation,description,schema]of definitions)server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async(args,extra)=>{
    const began=Date.now(),abort=new AbortController();pending.add(abort);const cancel=()=>abort.abort();if(extra.signal?.aborted)abort.abort();else extra.signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>abort.abort(),config.limits.timeoutMs);let status='failed';
    try{const grant=await guard();await boundStatus(grant,abort.signal);if(abort.signal.aborted)throw Error('mcp_request_cancelled');
      const result=await dispatch(identityRequest(shared,grant,operation,args),{hostId:grant.hostId,role:'model_read'},{signal:abort.signal});
      await guard();await boundStatus(grant,abort.signal);if(abort.signal.aborted)throw Error('mcp_request_cancelled');
      const json=JSON.stringify(result);if(Buffer.byteLength(json)>config.limits.responseBytes)throw Error('mcp_response_too_large');status='complete';
      if(operation==='read-image'){const {data,...metadata}=result;if(typeof data!=='string')throw Error('mcp_media_original_unavailable');return {content:[{type:'text',text:JSON.stringify(metadata)},{type:'image',data,mimeType:result.mimeType??result.mediaType}],structuredContent:metadata};}
      return {content:[{type:'text',text:json}],structuredContent:result};
    }catch(error){return {isError:true,content:[{type:'text',text:safeError(error)}]};}
    finally{clearTimeout(timer);pending.delete(abort);extra.signal?.removeEventListener('abort',cancel);onReceipt({kind:'cmcp_mcp_operation',operation,status,durationMs:Date.now()-began,subject:authorization.subject,modelCalls:0});}
  });
  return {server,close:async()=>{closed=true;for(const abort of pending)abort.abort();await server.close();}};
}
