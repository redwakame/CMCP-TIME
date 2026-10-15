import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
const testProduct=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const product=path.resolve(process.env.CMCP_PRODUCT_ROOT??testProduct);
const load=rel=>import(pathToFileURL(path.join(product,rel)).href),require=createRequire(path.join(product,'package.json'));
const {createMcpProject,loadMcpConfig,readJSON,atomicJSON,digest}=await load('adapters/mcp/config.mjs');
const {startMcpService,callManagement}=await load('adapters/mcp/server.mjs');
const {identityRequest,createJwtVerifier}=await load('adapters/mcp/auth.mjs');
const {callSharedProject}=await load('adapters/shared-project/client.mjs');
const {CONTINUITY_READING_CONTRACT,CONTINUITY_READING_CONTRACT_METADATA}=await load('adapters/continuity-policy.mjs');
const {projectContinuityModelView,restoreContinuityModelView}=await load('adapters/continuity-model-view.mjs');
const {runMcp}=await load('adapters/mcp/cli.mjs');
const {CmcpHarnessBridge}=await load('adapters/deepseek-harness/runtime-bridge.mjs');
const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const {StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
const {StreamableHTTPClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')).href);
const {SignJWT,importPKCS8}=await import(pathToFileURL(require.resolve('jose')).href);
const base=path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT??path.join(testProduct,'logs/tests/mcp'));
await fs.mkdir(base,{recursive:true});const run=await fs.mkdtemp(path.join(base,'run-')),resources=new Set(),records=[];
const hash=value=>createHash('sha256').update(value).digest('hex');
const port=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const output={write(){}},input={async *[Symbol.asyncIterator](){yield Buffer.from('CLI 合成實際可見原答。');}};
async function fixture(label,{bridgeFactory,limits}={}){
  const root=path.join(run,label),made=await createMcpProject({root,projectId:'合成互通-'+label,hosts:['generic','hermes'],port:await port()});let {config,shared}=await loadMcpConfig(made.configFile);
  if(limits){config.limits={...config.limits,...limits};await atomicJSON(made.configFile,config);}
  const service=await startMcpService({configFile:made.configFile,bridgeFactory,onReceipt:row=>records.push({...row,case:label})});resources.add(service);
  const grant={hostId:'generic',sessionId:'synthetic-session'};
  const send=async(op,args={},who=grant,role='controller')=>{const known=await callSharedProject({connection:{pipe:shared.pipe,authFile:shared.hosts[who.hostId].controlAuthFile},role:'controller',request:identityRequest(shared,who,'status')});return callSharedProject({connection:{pipe:shared.pipe,authFile:shared.hosts[who.hostId][role==='controller'?'controlAuthFile':'readAuthFile']},role,request:identityRequest(shared,{...who,epoch:known.epoch},op,args)});};
  await send('join');await send('claim');let number=0;
  const begin=async(text='請找回合成紙雕展的原稿及書面同意條件。',attachments=[])=>{number++;const v={messageId:'u'+number,text,receivedAt:new Date().toISOString(),...(attachments.length?{attachments}:{})};const received=await send('receive',v);await send('claim-turn',{messageId:v.messageId,harnessTurn:number});return {v,received};};
  const finish=()=>send('finish',{messageId:'a'+number,text:'合成原答：紙雕展六人，場地尚待書面同意。',receivedAt:new Date().toISOString(),userMessageId:'u'+number,harnessTurn:number});
  const authorize=(subject='test-client')=>callManagement(config,'authorize-reader',{hostId:grant.hostId,sessionId:grant.sessionId,subject,ttlSeconds:900});
  const httpClient=async auth=>{const token=await fs.readFile(auth.tokenFile,'utf8'),client=new Client({name:'cmcp-synthetic-test',version:'1'});const transport=new StreamableHTTPClientTransport(new URL(service.url),{requestInit:{headers:{Authorization:'Bearer '+token}}});await client.connect(transport);resources.add(client);return {client,transport,token};};
  const cli=more=>runMcp(['control','--config',made.configFile,'--host',grant.hostId,'--session',grant.sessionId,...more],{output,error:output,input});
  return {root,config,shared,service,send,begin,finish,authorize,httpClient,grant,cli,configFile:made.configFile};
}
async function readAll(client){const nav=await client.callTool({name:'cmcp_find_history',arguments:{}});assert.equal(nav.isError,undefined,JSON.stringify(nav));
  const opened=await client.callTool({name:'cmcp_open_history',arguments:{navigationTicket:nav.structuredContent.ticket,selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''})}});assert.equal(opened.isError,undefined,JSON.stringify(opened));
  assert.deepEqual(opened.structuredContent.continuityContract,{...CONTINUITY_READING_CONTRACT_METADATA,text:CONTINUITY_READING_CONTRACT});
  assert.deepEqual(JSON.parse(opened.content[0].text),opened.structuredContent);
  await fs.writeFile(path.join(run,`layered-contract-${randomUUID()}.json`),JSON.stringify({layer:'官方 MCP client 與同機正式服務／Core，HTTP 或 stdio，零模型',formalOpen:opened.structuredContent},null,2),{flag:'wx'});
  const pages=[];for(let n=0;n<16;n++){const value=await client.callTool({name:'cmcp_read_history',arguments:{ticket:opened.structuredContent.ticket}});assert.equal(value.isError,undefined,JSON.stringify(value));assert.equal(value.structuredContent.continuityContract,undefined);pages.push(value.structuredContent);if(value.structuredContent.coverage?.complete||['complete','complete_with_gaps'].includes(value.structuredContent.status))return pages;}throw Error('test_read_did_not_complete');}
function png(){const crc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let n=0;n<8;n++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;};const chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;};const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;h[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,250,30,60]))),chunk('IEND',Buffer.alloc(0))]);}

test('SDK HTTP 與 stdio 真 client 走正式 reader；工具唯讀，原文角色時間與 host 保留',async()=>{
  const f=await fixture('read');const saved=await f.begin('合成紙雕展原稿：六人，場地尚待書面同意。');await f.finish();await f.begin();const auth=await f.authorize();
  const {client}=await f.httpClient(auth);const names=(await client.listTools()).tools.map(x=>x.name);assert.equal(names.length,9);assert.ok(names.includes('cmcp_project_continuity'));assert.equal(names.some(x=>/capture|control|write|join|retry/.test(x)),false);
  const pages=await readAll(client);assert.ok(JSON.stringify(pages).includes('合成紙雕展原稿'));assert.ok(pages.some(p=>p.source?.sourceAuthorRole==='user'&&p.source.messageRecordedAt===saved.v.receivedAt));assert.ok(pages.some(p=>p.sourceOrigins?.some(o=>o.origin?.hostId==='generic')));
  assert.equal((await client.callTool({name:'cmcp_capture_user',arguments:{role:'user',text:'模型不能冒充使用者'}})).isError,true);
  const stdio=new Client({name:'cmcp-stdio-test',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(product,'adapters/mcp/stdio.mjs'),'--binding',auth.bindingFile],stderr:'pipe'});let stderr='';transport.stderr.on('data',v=>stderr+=v);await stdio.connect(transport);resources.add(stdio);
  const state=await stdio.callTool({name:'cmcp_status',arguments:{}});assert.equal(state.isError,undefined,stderr);assert.equal(state.structuredContent.projectId,f.shared.projectId);assert.equal(state.structuredContent.continuityContract,undefined);
  const stdioPages=await readAll(stdio);assert.ok(stdioPages.some(p=>p.source?.sourceAuthorRole==='user'));await stdio.close();await client.close();
  records.push({case:'read',formalPages:pages.length,originalSha256:hash(saved.v.text),roleTimeVerified:true,transports:['stdio','streamable-http'],productModelCalls:0});
});
test('MCP 真 client 正式閱讀歷史加當輪 User 原文，保留來源身分與分離覆蓋',async()=>{
  const f=await fixture('current-input-reader'),prior=await f.begin('合成露營名單原案：六人，出發仍須書面許可。');await f.finish();
  const current=await f.begin('改為四人，其他條件維持。請依原案修訂名單。'),auth=await f.authorize(),{client}=await f.httpClient(auth);
  const readings=[];
  for(const includeCurrentInput of [false,true]){
    const nav=await client.callTool({name:'cmcp_find_history',arguments:{}});assert.equal(nav.isError,undefined);
    const opened=await client.callTool({name:'cmcp_open_history',arguments:{navigationTicket:nav.structuredContent.ticket,
      selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''}),...(includeCurrentInput?{includeCurrentInput:true}:{})}});
    assert.equal(opened.isError,undefined,JSON.stringify(opened));const pages=[];
    for(let n=0;n<12;n++){
      const page=await client.callTool({name:'cmcp_read_history',arguments:{ticket:opened.structuredContent.ticket}});
      assert.equal(page.isError,undefined,JSON.stringify(page));pages.push(page.structuredContent);if(page.structuredContent.coverage?.complete)break;
    }
    await fs.writeFile(path.join(f.root,`formal-${includeCurrentInput?'with-current':'default'}-pages.json`),JSON.stringify({opening:opened.structuredContent,pages},null,2),{flag:'wx'});
    const originalText=page=>page.modelContext?JSON.parse(page.modelContext).content:null;
    assert.equal(pages.at(-1).coverage.complete,true);assert.ok(pages.some(p=>originalText(p)===prior.v.text&&p.source.sourceAuthorRole==='user'&&p.source.messageRecordedAt===prior.v.receivedAt));
    const currentPages=pages.filter(p=>originalText(p)===current.v.text);assert.equal(currentPages.length,includeCurrentInput?1:0);
    if(includeCurrentInput){
      const p=currentPages[0],scope=opened.structuredContent.collection.scopeDescriptor;
      assert.equal(p.source.sourceAuthorRole,'user');assert.equal(p.source.messageRecordedAt,current.v.receivedAt);assert.ok(p.modelContext);
      assert.equal(scope.kind,'authorized_history_with_current_input');assert.equal(scope.historyScope.kind,'authorized_history_inventory');assert.equal(scope.currentInput.ref,p.source.ref);
      assert.equal(Object.hasOwn(scope.currentInput,'pointer'),false);assert.equal(Object.hasOwn(scope.currentInput,'evidenceHash'),false);
      assert.ok(p.sourceOrigins.some(o=>o.origin?.hostId==='generic'&&o.origin?.sessionId===f.grant.sessionId&&o.origin?.messageId===current.v.messageId&&o.origin?.role==='user'));
    }
    readings.push({includeCurrentInput,opening:opened.structuredContent,pages});
  }
  await fs.writeFile(path.join(f.root,'formal-current-input-evidence.json'),JSON.stringify({layer:'MCP SDK HTTP 同機真服務／正式 Core，未呼叫模型',original:{prior,current},readings,productModelCalls:0},null,2),{flag:'wx'});
  records.push({case:'current-input-reader',originalSha256:hash(current.v.text),currentSourceId:current.v.messageId,originalTime:current.v.receivedAt,defaultExcludesCurrent:true,optInFormalOriginal:true,scopeSeparated:true,productModelCalls:0});
  await client.close();await f.finish();
});
test('MCP 型別投影物件與舊字串在真 client／正式 Core 等價，來源與二擇一守護保留',async()=>{
 const f=await fixture('typed-continuity-input'),original='我打算籌辦合成石雕展示；入場仍須取得書面許可。';
 await f.begin(original);await f.finish();await f.begin('請核對先前原案與尚待書面許可的條件。');
 const auth=await f.authorize(),{client}=await f.httpClient(auth),listed=(await client.listTools()).tools.find(t=>t.name==='cmcp_project_continuity');
 assert.equal(listed.inputSchema.properties.proposal.type,'object');assert.deepEqual(listed.inputSchema.oneOf,[{required:['proposal']},{required:['proposalJson']}]);
 const pages=await readAll(client),user=pages.find(p=>p.source.sourceAuthorRole==='user'),assistant=pages.find(p=>p.source.sourceAuthorRole==='assistant');
 const body=p=>typeof p.modelContext==='string'?JSON.parse(p.modelContext).content:p.modelContext.content;
 const ticket=user.ticket,proposal={version:6,plans:[{id:'p',ref:user.source.ref,quote:body(user),topic:'合成展示',aspect:'計畫',temporalUse:'current'}],unknowns:[]};
 const projected=[];for(const args of [{ticket,proposal},{ticket,proposalJson:JSON.stringify(proposal)}]){
  const value=await client.callTool({name:'cmcp_project_continuity',arguments:args});assert.equal(value.isError,undefined,JSON.stringify(value));assert.equal(value.structuredContent.status,'ready');projected.push(value.structuredContent);
 }
 const sameProjection=(a,b)=>{for(const value of [a,b])assert.ok(Number.isFinite(Date.parse(value.runtimeTime.now)));assert.equal(a.runtimeTime.timezone,b.runtimeTime.timezone);
  assert.deepEqual({...a,runtimeTime:undefined},{...b,runtimeTime:undefined});};
 // SDK 實際 HTTP／stdio 回傳消重後封套；精確還原來源、角色、時間與身分補充。
 for(const wire of projected){const full=restoreContinuityModelView(wire);assert.ok(wire.projectionCapacity);assert.deepEqual(projectContinuityModelView(full),wire);
  assert.equal(full.projectionHash,createHash('sha256').update(JSON.stringify(full.projection)).digest('hex'));
  assert.deepEqual(projectContinuityModelView(wire),wire);assert.deepEqual(wire.sourceOrigins,full.sourceOrigins);}
 // 兩次正式呼叫的查核現在時間本來不同；只排除 runtimeTime，不排除任何原來源時間或內容。
 sameProjection(projected[0].projection,projected[1].projection);
 for(const key of ['inputVersion','compilation','sourceOrigins'])assert.deepEqual(projected[0][key],projected[1][key],key);
 const double=await client.callTool({name:'cmcp_project_continuity',arguments:{ticket,proposal,proposalJson:JSON.stringify(proposal)}});assert.equal(double.isError,true);
 const wrongRole=structuredClone(proposal);wrongRole.plans[0].ref=assistant.source.ref;wrongRole.plans[0].quote=body(assistant);
 const wrongQuote=structuredClone(proposal);wrongQuote.plans[0].quote='正式原文沒有這一段。';
 const rejected=[];for(const p of [wrongRole,wrongQuote])for(const args of [{ticket,proposal:p},{ticket,proposalJson:JSON.stringify(p)}]){
  const value=await client.callTool({name:'cmcp_project_continuity',arguments:args});assert.equal(value.isError,undefined);assert.equal(value.structuredContent.status,'rejected');rejected.push(value.structuredContent.reason);
 }
 assert.deepEqual(rejected,['continuity_source_role_mismatch','continuity_source_role_mismatch','continuity_quote_absent','continuity_quote_absent']);
 const big=structuredClone(proposal);big.plans=Array.from({length:24},(_,i)=>({...structuredClone(proposal.plans[0]),id:'p'+i,reasons:[{id:'reason'+i,ref:user.source.ref,quote:body(user)}]}));
 const elements=value=>value&&typeof value==='object'?Object.values(value).reduce((sum,v)=>sum+1+elements(v),0):0;
 assert.ok(elements({ticket,proposal:big})>256);assert.ok(Buffer.byteLength(JSON.stringify(big))<=24576);
 // 同面向重複宣告沒有交代關係，應由 Core 拒絕；只驗傳輸不因改用物件而縮小原有輸入範圍。
 const bigResults=[];for(const args of [{ticket,proposal:big},{ticket,proposalJson:JSON.stringify(big)}]){
  const value=await client.callTool({name:'cmcp_project_continuity',arguments:args});assert.equal(value.isError,undefined,JSON.stringify(value));bigResults.push(value.structuredContent);
 }
 for(const value of bigResults){assert.equal(value.status,'rejected');assert.equal(value.reason,'continuity_plan_relation_required');}
 const stdio=new Client({name:'cmcp-typed-stdio-test',version:'1'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(product,'adapters/mcp/stdio.mjs'),'--binding',auth.bindingFile],stderr:'pipe'});transport.stderr.on('data',()=>{});await stdio.connect(transport);resources.add(stdio);
 const stdioSchema=(await stdio.listTools()).tools.find(t=>t.name==='cmcp_project_continuity');assert.deepEqual(stdioSchema.inputSchema,listed.inputSchema);
 const fromStdio=await stdio.callTool({name:'cmcp_project_continuity',arguments:{ticket,proposal}});assert.equal(fromStdio.isError,undefined);assert.equal(fromStdio.structuredContent.status,'ready');sameProjection(fromStdio.structuredContent.projection,projected[0].projection);
 assert.ok(fromStdio.structuredContent.projectionCapacity);const restoredStdio=restoreContinuityModelView(fromStdio.structuredContent);
 assert.equal(restoredStdio.projectionHash,createHash('sha256').update(JSON.stringify(restoredStdio.projection)).digest('hex'));
 assert.deepEqual(projectContinuityModelView(restoredStdio),fromStdio.structuredContent);
 await fs.writeFile(path.join(f.root,'typed-input-evidence.json'),JSON.stringify({layer:'正式 MCP SDK HTTP／stdio 同機 client 與正式 Core；不是真模型語意驗收',listed,proposal,projected,rejected,big:{elements:elements({ticket,proposal:big}),bytes:Buffer.byteLength(JSON.stringify(big)),results:bigResults},stdioSchema,fromStdio,modelCalls:0},null,2)+'\n',{flag:'wx'});
 await stdio.close();await client.close();await f.finish();
});

test('MCP 正式客戶端的 open 保持當輪原文選配布林與嚴格範圍，不接受模型指定 pointer',async()=>{
  const forwarded=[],f=await fixture('current-input-schema',{bridgeFactory:options=>{const bridge=new CmcpHarnessBridge(options),original=bridge.tool.bind(bridge);bridge.tool=async(...args)=>{if(args[1]==='cmcp_open_history'){forwarded.push(args);return {status:'opened'};}return original(...args);};return bridge;}});
  await f.begin();const auth=await f.authorize(),{client}=await f.httpClient(auth),tool=(await client.listTools()).tools.find(t=>t.name==='cmcp_open_history');
  assert.equal(tool.inputSchema.properties.includeCurrentInput.type,'boolean');assert.equal(tool.inputSchema.required.includes('includeCurrentInput'),false);
  const selection={navigationTicket:'正式導航',selectionJson:'{}'};
  for(const option of [{},{includeCurrentInput:false},{includeCurrentInput:true}]){const args={...selection,...option},result=await client.callTool({name:tool.name,arguments:args});assert.equal(result.isError,undefined,JSON.stringify(result));assert.deepEqual(forwarded.at(-1)[2],args);}
  for(const option of [{includeCurrentInput:'true'},{includeCurrentInput:null},{pointer:'other'}]){const count=forwarded.length,result=await client.callTool({name:tool.name,arguments:{...selection,...option}});assert.equal(result.isError,true);assert.equal(forwarded.length,count);}
  await client.close();await f.finish();
});

test('模型讀者不能控制／未加入、未開始回合不能發讀取授權；單一 writer 與作用範圍守護',async()=>{
  const f=await fixture('scope');await assert.rejects(f.authorize(),/active_authorized_host_turn_required/);await f.begin();
  await assert.rejects(f.send('control',{text:'set clean off'},f.grant,'model_read'),/role_forbidden/);
  const other={hostId:'hermes',sessionId:'other'};await f.send('join',{},other);await assert.rejects(f.send('claim',{},other),/owner_required/);
  const r=identityRequest(f.shared,{...f.grant,epoch:(await f.send('status')).epoch},'reader-status');r.projectId='foreign';await assert.rejects(f.service.dispatch(r,{hostId:'generic',role:'model_read'}),/unauthorized_project/);
  await assert.rejects(startMcpService({configFile:f.configFile}),/pipe_busy|listener_busy/);assert.equal((await f.send('status')).activeTurn,true);
});
test('JWT exact aud／issuer／scope／簽章／到期／grant世代；撤權再授權不復活舊token',async()=>{
  const f=await fixture('jwt');await f.begin();const auth=await f.authorize(),token=await fs.readFile(auth.tokenFile,'utf8'),verify=await createJwtVerifier(f.config);const parsed=await verify(token);
  const key=await importPKCS8(await fs.readFile(path.join(f.root,'private/issuer-private.pem'),'utf8'),'RS256');
  const mint=(patch={},options={})=>new SignJWT({scope:'cmcp:read',grantStamp:parsed.stamp,projectId:f.config.projectId,...patch}).setProtectedHeader({alg:'RS256'}).setSubject(options.subject??'test-client').setIssuer(options.issuer??f.config.auth.issuer).setAudience(options.aud??f.config.auth.audience).setIssuedAt().setExpirationTime(options.exp??'10m').setJti(randomUUID()).sign(key);
  await assert.rejects(verify(await mint({}, {aud:[f.config.auth.audience,'https://foreign.test/mcp']})),/audience_mismatch/);await assert.rejects(verify(await mint({}, {issuer:'foreign'})),/invalid_token/);await assert.rejects(verify(await mint({scope:'cmcp:write'})),/scope_forbidden/);await assert.rejects(verify(await mint({}, {exp:1})),/invalid_token/);await assert.rejects(verify(token.slice(0,-10)+'AAAAAAAAAA'),/invalid_token/);
  await callManagement(f.config,'revoke-reader',{subject:'test-client'});await assert.rejects(verify(token),/grant_unavailable/);await f.authorize();await assert.rejects(verify(token),/token_grant_mismatch/);
});
test('HTTP Host／Origin／forwarded／缺token／body總量守護與標準協定端點',async()=>{
  const f=await fixture('http');await f.begin();const auth=await f.authorize(),token=await fs.readFile(auth.tokenFile,'utf8');
  const request=(headers={},body='{}')=>fetch(f.service.url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},body});
  const hostStatus=await new Promise((resolve,reject)=>{const req=http.request(f.service.url,{method:'POST',headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end('{}');});assert.equal(hostStatus,403);
  assert.equal((await request({Origin:'https://evil.example'})).status,403);assert.equal((await request({'X-Forwarded-Proto':'https'})).status,403);assert.equal((await request({Authorization:''})).status,401);assert.equal((await request({},' '.repeat(f.config.limits.requestBytes+1))).status,413);
  assert.equal((await fetch(f.service.url.replace('/mcp','/health'))).status,200);assert.equal((await request({'Mcp-Session-Id':'foreign-session'})).status,403);
});
test('MCP Session ID 不是授權：其他principal與舊grant不得重用',async()=>{
  const f=await fixture('principal');await f.begin();const a=await f.authorize('a'),{client,transport}=await f.httpClient(a),b=await f.authorize('b'),token=await fs.readFile(b.tokenFile,'utf8');
  const res=await fetch(f.service.url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','Mcp-Session-Id':transport.sessionId,'Mcp-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:88,method:'tools/list',params:{}})});assert.equal(res.status,403);
  await callManagement(f.config,'revoke-reader',{subject:'a'});await assert.rejects(client.callTool({name:'cmcp_status',arguments:{}}),/401|grant/);
});
test('正式media handle原件hash；未讀、任意路徑／URL與變版拒絕，取消後失效',async()=>{
  const f=await fixture('media'),bytes=png(),attachment={filename:'synthetic.png',mimeType:'image/png',dataBase64:bytes.toString('base64'),sha256:hash(bytes)};
  const first=await f.begin('合成紙雕展原稿圖片：這是紅色試片，場地尚待書面同意。',[attachment]);assert.equal(first.received.context.mediaOriginals.status,'stored');await f.finish();await f.begin('請取回紙雕展原稿圖片及當時的原說明。');const {client}=await f.httpClient(await f.authorize());
  assert.equal((await client.callTool({name:'cmcp_read_image',arguments:{sourceRef:'C:/secret.png',mediaId:'https://example.com'}})).isError,true);
  assert.equal((await client.callTool({name:'cmcp_read_image',arguments:{sourceRef:'m1',mediaId:'x',url:'https://example.com'}})).isError,true);
  const pages=await readAll(client);let list,ref;for(const page of pages)if(page.mediaSourceRef){const result=await client.callTool({name:'cmcp_list_images',arguments:{sourceRef:page.mediaSourceRef}});if(result.structuredContent?.items?.length){list=result.structuredContent;ref=page.mediaSourceRef;break;}}
  assert.equal(list?.items.length,1);const mediaId=list.items[0].mediaId,read=await client.callTool({name:'cmcp_read_image',arguments:{sourceRef:ref,mediaId}});assert.equal(read.isError,undefined,JSON.stringify(read));assert.equal(hash(Buffer.from(read.content.find(c=>c.type==='image').data,'base64')),hash(bytes));
  await assert.rejects(f.send('receive',{...first.v,attachments:[{...attachment,filename:'changed.png'}]}),/source_version_conflict/);
  await f.send('cancel',{userMessageId:'u2',harnessTurn:2,reason:'synthetic_cancel'});assert.equal((await client.callTool({name:'cmcp_read_image',arguments:{sourceRef:ref,mediaId}})).isError,true);
  records.push({case:'media',bytes:bytes.length,sha256:hash(bytes),formalOriginalMatched:true,productModelCalls:0});
});
test('服務重啟保留原文並使舊epoch/turn失效；不自動加入',async()=>{
  const f=await fixture('restart');await f.begin();const auth=await f.authorize(),token=await fs.readFile(auth.tokenFile,'utf8');await f.service.close();
  const next=await startMcpService({configFile:f.configFile});resources.add(next);const c=new Client({name:'restart-test',version:'1'});await c.connect(new StreamableHTTPClientTransport(new URL(next.url),{requestInit:{headers:{Authorization:'Bearer '+token}}}));resources.add(c);
  assert.equal((await c.callTool({name:'cmcp_status',arguments:{}})).isError,true);assert.equal((await f.send('status')).joined,false);
});
test('Clean與OFF透過正式controller設定；新Session加入不解除共用保護',async()=>{
  const f=await fixture('controls');await f.begin();const {client}=await f.httpClient(await f.authorize());await f.send('control',{text:'set clean on'});
  const b={hostId:'hermes',sessionId:'B'};await f.send('join',{},b);assert.equal((await client.callTool({name:'cmcp_find_history',arguments:{}})).isError,true);
  const control=await f.send('control',{text:'status'});assert.equal(control.snapshot.controlConfiguration.effective.clean,true);await f.send('control',{text:'set clean off'});await f.send('control',{text:'set enabled off'});assert.equal((await client.callTool({name:'cmcp_find_history',arguments:{}})).isError,true);
});
test('CLI正常啟用、stdin保存、結算、retry與stop；未知錯誤不回顯JSON秘密',async()=>{
  const f=await fixture('cli',{bridgeFactory:options=>{const b=new CmcpHarnessBridge(options),original=b.close.bind(b);b.close=async()=>{await new Promise(r=>setTimeout(r,120));return original();};return b;}});await f.cli(['--operation','begin','--text','CLI合成實際輸入']);const auth=await f.cli(['--operation','authorize-reader','--subject','cli-reader']);assert.ok(auth.bindingFile);await f.cli(['--operation','answer','--stdin']);
  const retried=await f.cli(['--operation','command','--text','retry-registration']);assert.equal(retried.operation,'retry-registration');await f.cli(['--operation','disable']);assert.equal((await f.send('status')).joined,false);
  await atomicJSON(f.config.stateFile,{status:'closed',instance:'previous-instance'});const startedStop=Date.now();const stopped=await runMcp(['stop','--config',f.configFile],{output,error:output});assert.equal(stopped.status,'closed');assert.equal(stopped.instance,f.service.instance);assert.ok(Date.now()-startedStop>=100);assert.equal((await readJSON(f.config.stateFile)).instance,f.service.instance);await assert.rejects(callManagement(f.config,'health'),/unavailable/);
  const invalid=path.join(f.root,'bad.json');await fs.writeFile(invalid,'SECRET_TEST_VALUE {');let message='';await assert.rejects(runMcp(['check','--config',invalid],{output,error:{write:s=>message+=s}}),e=>!e.message.includes('SECRET'));assert.equal(message.includes('SECRET'),false);
});
test('MCP取消通知中止正式reader；撤權晚到結果拒絕；逾時不保持未完成工作',async()=>{
  let enter,release,mode='cancel';const ready=()=>new Promise(r=>enter=r);
  const f=await fixture('cancel',{limits:{timeoutMs:500},bridgeFactory:options=>{const b=new CmcpHarnessBridge(options),original=b.tool.bind(b);b.tool=async(...args)=>{enter();if(mode==='late')await new Promise(r=>release=r);else await new Promise(resolve=>{const signal=args[3];if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});return original(...args);};return b;}});
  await f.begin();const {client}=await f.httpClient(await f.authorize());let entered=ready();const abort=new AbortController(),pending=client.callTool({name:'cmcp_find_history',arguments:{}},undefined,{signal:abort.signal});await entered;abort.abort();await assert.rejects(pending,/abort|cancel/i);
  assert.equal((await client.callTool({name:'cmcp_status',arguments:{}})).isError,undefined);
  mode='late';entered=ready();const late=client.callTool({name:'cmcp_find_history',arguments:{}});await entered;await callManagement(f.config,'revoke-reader',{subject:'test-client'});release();const result=await late;assert.equal(result.isError,true);assert.match(result.content[0].text,/grant_unavailable|authorization|cancelled/);
  mode='timeout';const next=await f.httpClient(await f.authorize('new-reader'));entered=ready();const started=Date.now(),timed=next.client.callTool({name:'cmcp_find_history',arguments:{}});await entered;const timeoutResult=await timed;assert.equal(timeoutResult.isError,true);assert.match(timeoutResult.content[0].text,/cancelled/);assert.ok(Date.now()-started<2500);assert.equal((await callManagement(f.config,'health')).status,'ready');
});
test('慢HTTP body與回應容量有界；關閉不遺留socket',async()=>{
  const f=await fixture('bounded',{limits:{timeoutMs:300,responseBytes:1024}});await f.begin();const auth=await f.authorize(),token=await fs.readFile(auth.tokenFile,'utf8'),start=Date.now();
  const result=await new Promise(resolve=>{const req=http.request(f.service.url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':'100',Accept:'application/json, text/event-stream'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',()=>resolve('closed'));req.write('{');});assert.ok(result===408||result==='closed');assert.ok(Date.now()-start<1500);
  const {client}=await f.httpClient(auth);const navigation=await client.callTool({name:'cmcp_find_history',arguments:{}});assert.equal(navigation.isError,true);assert.equal(navigation.content[0].text,'mcp_response_too_large');await f.service.close();assert.equal((await readJSON(f.config.stateFile)).status,'closed');
});
test('兩個人類管理client並行撤權／授權由同一服務序列化，不遺失撤權',async()=>{
  const f=await fixture('grant-serial');await f.begin();const a=await f.authorize('a'),token=await fs.readFile(a.tokenFile,'utf8');
  await Promise.all([callManagement(f.config,'revoke-reader',{subject:'a'}),f.authorize('b'),f.authorize('c')]);
  const state=await readJSON(f.config.authorizationFile);assert.equal(state.grants.find(g=>g.subject==='a').state,'revoked');assert.equal(state.grants.filter(g=>g.state==='active').length,2);const verify=await createJwtVerifier(f.config);await assert.rejects(verify(token),/grant_unavailable/);
});
test('媒體超過整frame拒絕整筆，正式原件hash變更時fail closed',async()=>{
  const f=await fixture('media-bounds'),bytes=png(),attachment={filename:'synthetic.png',mimeType:'image/png',dataBase64:bytes.toString('base64')};
  const oversized={...attachment,dataBase64:Buffer.alloc(450000).toString('base64')};await assert.rejects(f.send('receive',{messageId:'too-big',text:'超量不能先存正文',receivedAt:new Date().toISOString(),attachments:[oversized,oversized]}),/frame_too_large/);
  const before=await f.send('control',{text:'status'});assert.equal(before.snapshot.registration.sources.length,0);
  await f.begin('合成紙雕展圖片：紅色試片。',[attachment]);await f.finish();await f.begin('請取回紙雕展圖片。');const {client}=await f.httpClient(await f.authorize()),pages=await readAll(client);let item,ref;
  for(const page of pages)if(page.mediaSourceRef){const result=await client.callTool({name:'cmcp_list_images',arguments:{sourceRef:page.mediaSourceRef}});if(result.structuredContent?.items?.length){item=result.structuredContent.items[0];ref=page.mediaSourceRef;break;}}
  assert.ok(item);const blobs=path.join(f.root,'state/history/media-originals/blobs'),files=await fs.readdir(blobs);const original=path.join(blobs,files[0]),old=await fs.readFile(original),changed=Buffer.from(old);changed[changed.length-1]^=1;await fs.writeFile(original,changed);
  const read=await client.callTool({name:'cmcp_read_image',arguments:{sourceRef:ref,mediaId:item.mediaId}});assert.equal(read.isError,true);assert.match(read.content[0].text,/hash_mismatch|unavailable/);
});
test('遠端配置僅明示TLS反代，直接公開綁定拒絕；不建立OAuth端點',async()=>{
  const f=await fixture('remote');await f.service.close();let cfg=await readJSON(f.configFile);cfg.http.host='0.0.0.0';await atomicJSON(f.configFile,cfg);await assert.rejects(loadMcpConfig(f.configFile),/loopback_binding_required/);
  cfg.http.host='127.0.0.1';cfg.http.remote=true;cfg.auth.audience='https://cmcp.example.test/mcp';await atomicJSON(f.configFile,cfg);await assert.rejects(loadMcpConfig(f.configFile),/remote_tls_proxy_required/);
  cfg.http.trustedProxy=true;cfg.http.allowedHosts=['cmcp.example.test'];await atomicJSON(f.configFile,cfg);const loaded=await loadMcpConfig(f.configFile);assert.equal(loaded.config.http.remote,true);
});
test('公開CLI子程序init→start→check/health/capabilities→stop，無模型且程序正常退出',async()=>{
  const root=path.join(run,'cli-process'),cli=path.join(product,'adapters/mcp/cli.mjs');
  const command=args=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[cli,...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.once('error',reject);p.once('exit',code=>code===0?resolve(JSON.parse(out)):reject(Error(err)));});
  const created=await command(['init','--root',root,'--project','cli-independent','--hosts','generic','--port',String(await port())]);
  assert.equal((await command(['check','--config',created.configFile])).status,'valid');
  const child=spawn(process.execPath,[cli,'start','--config',created.configFile],{stdio:['ignore','pipe','pipe'],windowsHide:true});let out='',err='';child.stderr.on('data',b=>err+=b);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{out+=b;if(out.includes('"ready"'))resolve();});child.once('error',reject);child.once('exit',code=>{if(!out.includes('"ready"'))reject(Error('cli_start_failed:'+code+err));});});
  try{assert.equal((await command(['health','--config',created.configFile])).status,'ready');assert.equal((await command(['capabilities','--config',created.configFile])).readOnlyTools,true);assert.equal((await command(['stop','--config',created.configFile])).status,'closed');}
  finally{const cfg=await readJSON(created.configFile);await callManagement(cfg,'stop').catch(()=>{});}
  const ended=await exited;assert.equal(ended.code,0,err);assert.equal(ended.signal,null);records.push({case:'cli-process',exitCode:ended.code,signal:ended.signal,modelCalls:0});
});
test.after(async()=>{for(const resource of [...resources].reverse())await resource.close().catch(()=>{});await fs.writeFile(path.join(run,'summary.json'),JSON.stringify({kind:'cmcp_mcp_test_summary',productRoot:product,at:new Date().toISOString(),modelCalls:0,records},null,2)+'\n');});
