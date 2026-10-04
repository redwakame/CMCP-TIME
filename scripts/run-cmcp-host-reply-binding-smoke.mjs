// 合成來源、離線分類替身與限定故障注入；不讀憑證、不連網、不呼叫模型。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createCmcpRuntimeSession} from '../src/cmcp-guard/cmcp-runtime-session.js';
import {createCmcpLocalInput} from '../src/cmcp-guard/cmcp-local-input.js';
import {createCmcpReactivationStores} from '../src/cmcp-guard/cmcp-history-reactivation.js';
import {createCmcpHistoryQueryRuntime} from '../src/cmcp-guard/cmcp-history-query-runtime.js';
import {validateCmcpReadingPublication} from '../src/cmcp-guard/cmcp-reading.js';
import {createLocalLoopJournal,loopHash} from '../src/cmcp-guard/cmcp-local-loop-journal.js';
import {resolveCmcpHistorySource} from '../src/cmcp-guard/cmcp-history-provider.js';
import {withCmcpBufferPublication} from '../src/cmcp-guard/cmcp-buffer-lifecycle.js';

const script=fileURLToPath(import.meta.url),repo=path.resolve(path.dirname(script),'..');
const management=process.env.CMCP_HOST_REPLY_TEST_ROOT??path.resolve(repo,'..','..','..');
const base=path.join(management,'logs','harness-20260929','host-reply-test');
const now='2026-09-29T02:00:00.000Z',userAt='2026-09-29T01:00:00.000Z',assistantAt='2026-09-29T01:01:00.000Z';
const temporal=at=>({now:at,timezone:'Asia/Taipei'});
const sourceText='請擬一份通知：只有安全審查通過後才開放，仍屬草案。';
const answerText='通知草稿：安全審查通過後才開放，尚未正式定案。';
const cases=[],live=new Set();
let networkCalls=0,credentialReads=0,fixtureIndex=0;
const configFor=root=>({kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-host-reply',providerMode:'host',
  input:{root:path.join(root,'state'),scopeId:'synthetic-host-reply',events:[],timezone:'Asia/Taipei',
    limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:4096,maxProjectionBytes:12000},
    storageCapacity:{maxSources:64,maxSourceBytes:4096},loopTiming:{ttlMs:43200000,inactivityMs:60000,activityWindowMs:43200000}},
  receiptRoot:path.join(root,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},
  controls:{enabled:true,clean:false,proactive:false},answerHistory:{enabled:true}});
const journalFor=config=>createLocalLoopJournal({root:path.join(config.input.root,'input-journal'),name:'cmcp-common-input-v1'});
const historyFor=config=>createCmcpReactivationStores({root:config.input.root,scopeId:config.input.scopeId}).history;
async function open(config,sessionId='host-session',readOnly=false){
  const runtime=await createCmcpRuntimeSession({config,repoRoot:management,sessionId,readOnly,clock:()=>now,
    fetchImpl:async()=>{networkCalls++;throw Error('離線驗收不得連網');},
    readCredential:async()=>{credentialReads++;throw Error('離線驗收不得讀憑證');}});
  live.add(runtime);return runtime;
}
async function close(runtime){await runtime.close();live.delete(runtime);}
async function fixture(root){const config=configFor(path.join(root,String(++fixtureIndex)));return {config,runtime:await open(config)};}
async function capture(runtime,id='u1',workId='turn1',options={}){
  return runtime.beforeUser({text:sourceText,sourceId:id,timeContext:temporal(userAt),hostTurn:{workId,...options}});
}
const reply=(runtime,captured,options={})=>runtime.afterAssistant({text:answerText,sourceId:'a1',replyTo:captured.sourcePointer??captured.nativeSourcePointer,
  timeContext:temporal(assistantAt),hostTurn:captured.hostTurn,...options});
async function evidence(config,pointer){const resolved=await resolveCmcpHistorySource({provider:historyFor(config),pointer});assert.equal(resolved.status,'found');return resolved.evidence;}
async function records(config,kind){return (await journalFor(config).read()).filter(row=>row.record.kind===kind).map(row=>row.record.value);}
async function countSources(config){return (await historyFor(config).listPointers({scopeId:config.input.scopeId,maxRecords:64})).pointers.length;}
async function hashes(root){const files={};
  async function walk(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const target=path.join(directory,entry.name);if(entry.isDirectory())await walk(target);else files[path.relative(root,target)]=loopHash(await fs.readFile(target,'utf8'));
  }}await walk(root);return files;
}
async function check(name,fn){try{const detail=await fn();cases.push({name,status:'PASS',...(detail?{detail}: {})});}
  catch(error){cases.push({name,status:'FAIL',error:error.stack});throw error;}}

// 子程序使用正式 History 與 reader 重建查詢，分類回覆是明示離線替身。
async function verifyInFreshProcess(root){
  const payload=JSON.parse(await fs.readFile(path.join(root,'fresh-input.json'),'utf8'));
  const {config,expected}=payload;
  let classificationCalls=0;
  const adapter={request:async(purpose,input)=>{
    assert.equal(purpose,'history_aggregate');classificationCalls++;
    return {value:{rows:input.sources.map(source=>({ref:source.ref,kind:source.sourceAuthorRole==='assistant'?'assistant_authored_text':'user_intent',
      quote:source.text,evidenceStatus:'supports_requested_detail'}))}};
  }};
  const local=await createCmcpLocalInput({...config.input,adapter,delivery:{present:async()=>{throw Error('唯讀回查不得呈現答案');}},
    answerHistory:config.answerHistory,clock:()=>now,sessionId:'reader-session'});
  try{
    for(const item of expected){const got=await evidence(config,item.pointer);assert.deepEqual(got,item.evidence);}
    const journal=journalFor(config),query=createCmcpHistoryQueryRuntime({scopeId:config.input.scopeId,journal,historyProvider:local.history,
      readingOpen:input=>local.readingOpen(input),readingPage:input=>local.readingPage(input),adapter,now:()=>now,
      valid:async()=>true,getReplyBindings:()=>records(config,'assistant_reply_binding'),
      validatePublication:({reading,sourceRefs})=>validateCmcpReadingPublication({stores:local.stores,catalog:local.catalog,reading,sourceRefs,
        timeContext:temporal(now),bufferGeneration:local.bufferGeneration,valid:async()=>true})});
    const result=await query.run({requestId:'formal-fresh-read',text:'請讀先前通知要求與助理草稿。',purpose:'evidence_lookup',navigation:{inventory:{}},
      readingLimits:{maxSources:8,maxTotalBytes:8192,maxPageBytes:4096,maxPages:8,maxProjectionBytes:8192},
      batchLimits:{maxBatchSources:8,maxInputBytes:12000,maxBatches:2}});
    assert.equal(result.status,'partial');assert.equal(result.aggregate.coverage.complete,true);
    assert.equal(result.publication.status,'verified');
    const projection=await query.verifiedReadSources('formal-fresh-read');
    assert.equal(projection.sources.length,2);assert.equal(projection.replyBindings.length,1);
    const binding=projection.replyBindings[0];
    assert.equal(binding.assistantEvidenceHash,loopHash(expected[1].evidence));assert.equal(binding.userEvidenceHash,loopHash(expected[0].evidence));
    const resultFile={status:'PASS',classificationCalls,modelCalls:0,sourceCount:projection.sources.length,replyBindings:projection.replyBindings,
      sources:projection.sources};
    await fs.writeFile(path.join(root,'fresh-result.json'),JSON.stringify(resultFile,null,2)+'\n',{flag:'wx'});
    process.stdout.write(JSON.stringify({status:'PASS',classificationCalls,formalReplyBindings:projection.replyBindings.length}));
  }finally{await local.close();}
}

if(process.argv[2]==='--fresh-reader'){
  await verifyInFreshProcess(path.resolve(process.argv[3]));
}else{
  await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'run-'));
  const result={kind:'CMCP_HOST_REPLY_BINDING_OFFLINE',root,status:'FAIL',cases,networkCalls:0,credentialReads:0,
    boundary:'合成 Host 回合、正式保存與新程序正式 reader；未驗證真 Harness 事件或模型語義'};
  const sourceFiles=['src/cmcp-guard/cmcp-local-input.js','src/cmcp-guard/cmcp-runtime-session.js','scripts/run-cmcp-host-reply-binding-smoke.mjs'];
  result.sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,loopHash(await fs.readFile(path.join(repo,name),'utf8'))])));
  try{
    await check('正式回覆關聯、原角色／時間／hash與重送冪等',async()=>{
      const {config,runtime}=await fixture(root),captured=await capture(runtime),saved=await reply(runtime,captured);
      assert.equal(saved.formalReply.status,'verified');assert.equal(saved.replyBinding,'verified_user_source');
      const first=[await evidence(config,captured.sourcePointer),await evidence(config,saved.sourcePointer)];
      assert.equal(first[0].sourceAuthorRole,'user');assert.equal(first[1].sourceAuthorRole,'assistant');
      assert.equal(first[0].messageRecordedAt,userAt);assert.equal(first[1].messageRecordedAt,assistantAt);
      const bufferBefore=await runtime.bufferList({timeContext:temporal(now)});
      const again=await runtime.beforeUser({text:sourceText,sourceId:'u1',timeContext:temporal(now),hostTurn:{workId:'turn1'}});
      const reordered=Object.fromEntries(Object.entries(again.sourcePointer).reverse());
      assert.equal((await reply(runtime,again,{replyTo:reordered,timeContext:temporal(now)})).status,'unchanged');
      assert.equal((await records(config,'assistant_reply_binding')).length,1);assert.equal((await records(config,'host_reply_binding')).length,1);
      assert.equal(await countSources(config),2);
      assert.deepEqual(await evidence(config,saved.sourcePointer),first[1]);assert.deepEqual(await evidence(config,captured.sourcePointer),first[0]);
      assert.deepEqual((await runtime.bufferList({timeContext:temporal(now)})).items,bufferBefore.items);
      await assert.rejects(reply(runtime,captured,{text:answerText+'改寫'}),/host_source_identity_conflict/);
      await assert.rejects(reply(runtime,captured,{sourceId:'different-answer'}),/host_turn_answer_identity_conflict/);
      await close(runtime);
      await fs.writeFile(path.join(root,'fresh-input.json'),JSON.stringify({config,expected:first.map(e=>({pointer:e.pointer,evidence:e}))},null,2)+'\n',{flag:'wx'});
      const child=spawnSync(process.execPath,[script,'--fresh-reader',root],{encoding:'utf8',timeout:45000});
      await fs.writeFile(path.join(root,'fresh-process.json'),JSON.stringify({status:child.status,stdout:child.stdout,stderr:child.stderr,error:child.error?.message},null,2)+'\n',{flag:'wx'});
      assert.equal(child.status,0,child.stderr||child.stdout);
      return {sourceCount:2,formalBindingCount:1,freshProcess:JSON.parse(child.stdout)};
    });

    for(const stage of ['assistant_reply_binding','host_reply_binding','terminal'])await check('部分完成重送恢復：'+stage,async()=>{
      const {config,runtime}=await fixture(root),captured=await capture(runtime);
      const originalLink=fs.link;let injected=false;
      fs.link=async(from,to)=>{
        const row=JSON.parse(await fs.readFile(from,'utf8'));
        if(!injected&&row.record?.kind===stage){injected=true;
          if(stage!=='assistant_reply_binding')await originalLink(from,to);
          throw Error('synthetic_partial_'+stage);}
        return originalLink(from,to);
      };
      try{await assert.rejects(reply(runtime,captured),new RegExp('synthetic_partial_'+stage));}finally{fs.link=originalLink;}
      assert.equal(injected,true);assert.equal(await countSources(config),2);
      const pointer={...captured.sourcePointer,itemId:'a1'},before=await evidence(config,pointer);
      const recovered=await reply(runtime,captured,{timeContext:temporal(now)});
      assert.equal(recovered.status,'unchanged');assert.equal(recovered.formalReply.status,'verified');
      assert.deepEqual(await evidence(config,pointer),before);assert.equal((await records(config,'assistant_reply_binding')).length,1);
      assert.equal((await records(config,'host_reply_binding')).length,1);assert.equal((await runtime.progress('turn1')).state,'completed');
      await close(runtime);
    });

    await check('不同 Session 票券拒絕與同 Session 完成回執重開',async()=>{
      const {config,runtime}=await fixture(root),captured=await capture(runtime);await reply(runtime,captured);await close(runtime);
      const other=await open(config,'other-session');await assert.rejects(reply(other,captured),/host_turn_not_active/);await close(other);
      const same=await open(config);assert.equal((await reply(same,captured,{timeContext:temporal(now)})).status,'unchanged');await close(same);
    });

    for(const [name,disable,enable] of [['OFF→ON',{enabled:false},{enabled:true}],['Clean→恢復',{clean:true},{clean:false}],
      ['停止保存→恢復',{saveAssistant:false},{saveAssistant:true}],['停止 User 保存→恢復',{saveUser:false},{saveUser:true}]]){
      await check('晚到守護：'+name,async()=>{
        const {config,runtime}=await fixture(root),captured=await capture(runtime);
        await runtime.configureControls({updateId:'off',patch:disable});await runtime.configureControls({updateId:'on',patch:enable});
        await assert.rejects(reply(runtime,captured),/host_turn_controls_changed/);assert.equal(await countSources(config),1);await close(runtime);
      });
    }

    for(const action of ['Clear','cancel','OFF'])await check('發布佇列競態：'+action,async()=>{
      const {config,runtime}=await fixture(root),captured=await capture(runtime);
      let release,entered;const gate=new Promise(resolve=>{release=resolve;}),entry=new Promise(resolve=>{entered=resolve;});
      const blocker=withCmcpBufferPublication({root:config.input.root,scopeId:config.input.scopeId},async()=>{entered();await gate;});
      await entry;const pending=reply(runtime,captured);const rejected=assert.rejects(pending,/host_turn_(context_stale|controls_changed|not_active)/);
      await new Promise(resolve=>setImmediate(resolve));
      let operation;
      if(action==='Clear')operation=runtime.clearBuffer({timeContext:temporal(now)});
      else if(action==='cancel')operation=runtime.cancelWork({workId:captured.hostTurn.workId,reason:'synthetic_cancel'});
      else operation=runtime.setControls({enabled:false});
      if(action==='cancel')await operation;
      release();await blocker;await rejected;await operation;
      assert.equal(await countSources(config),1);assert.equal((await records(config,'assistant_reply_binding')).length,0);await close(runtime);
    });

    await check('停止 User 保存保留原生身分，禁止虛構正式 User binding',async()=>{
      const {config,runtime}=await fixture(root);
      await runtime.configureControls({updateId:'no-user',patch:{saveUser:false}});
      const captured=await capture(runtime);assert.equal(captured.sourcePointer,null);assert.equal(captured.nativeSourcePointer.itemId,'u1');
      const saved=await reply(runtime,captured);assert.equal(saved.replyBinding,'native_identity_only_user_body_not_saved');assert.equal(saved.formalReply,null);
      assert.equal(await countSources(config),1);assert.equal((await records(config,'assistant_reply_binding')).length,0);await close(runtime);
    });

    await check('停止全部保存的新回合仍可完成，不保存原文',async()=>{
      const {config,runtime}=await fixture(root);
      await runtime.configureControls({updateId:'no-body',patch:{saveUser:false,saveAssistant:false}});
      const captured=await capture(runtime);assert.equal((await reply(runtime,captured)).status,'not_saved');
      assert.equal((await reply(runtime,captured)).status,'not_saved');assert.equal(await countSources(config),0);await close(runtime);
    });

    await check('撤銷來源授權後重新授權不得接受舊票',async()=>{
      const {config,runtime}=await fixture(root),captured=await capture(runtime);
      await runtime.authorizeSources({updateId:'revoke',patch:{saveAssistant:false},authorizedBy:'合成驗收'});
      await runtime.authorizeSources({updateId:'restore',patch:{saveAssistant:true},authorizedBy:'合成驗收'});
      await assert.rejects(reply(runtime,captured),/host_turn_controls_changed/);assert.equal(await countSources(config),1);await close(runtime);
    });

    await check('錯誤 User 對應、角色及未授予票券不得保存答案',async()=>{
      const {config,runtime}=await fixture(root),captured=await capture(runtime);
      await assert.rejects(reply(runtime,captured,{replyTo:{...captured.sourcePointer,itemId:'different-user'}}),/host_turn_reply_mismatch/);
      await assert.rejects(reply(runtime,captured,{hostTurn:{...captured.hostTurn,workId:'missing'}}),/host_turn_not_active/);
      const wrong=await runtime.ingest({text:'合成 Assistant',role:'assistant',timeContext:temporal(userAt)});
      await assert.rejects(runtime.afterAssistant({text:answerText,sourceId:'a2',replyTo:wrong.pointer,timeContext:temporal(now)}),/assistant_reply_role_mismatch/);
      assert.equal(await countSources(config),2);await close(runtime);
    });

    await check('唯讀正式原文範圍保持角色／時間／hash且零檔案變更',async()=>{
      const {config,runtime}=await fixture(root),captured=await capture(runtime),saved=await reply(runtime,captured);
      const original=await evidence(config,saved.sourcePointer);await close(runtime);
      const directory=path.dirname(config.input.root),before=await hashes(directory),reader=await open(config,'read-only-session',true);
      const input={pointer:saved.sourcePointer,evidenceHash:loopHash(original),start:2,end:12,maxBytes:40};
      const read=await reader.readSource(input);
      assert.equal(read.text,[...answerText].slice(2,12).join(''));assert.equal(read.sourceAuthorRole,'assistant');
      assert.equal(read.messageRecordedAt,assistantAt);assert.equal(read.evidenceHash,loopHash(original));
      assert.equal(read.storedContentCodePoints,[...answerText].length);assert.equal(read.completeStoredContent,false);
      assert.equal(read.activation,'none');assert.equal(read.modelCalls,0);
      await assert.rejects(reader.readSource({...input,evidenceHash:'0'.repeat(64)}),/source_read_binding_mismatch/);
      await assert.rejects(reader.readSource({...input,pointer:{...input.pointer,scopeId:'another'}}),/source_read_scope_mismatch/);
      await assert.rejects(reader.readSource({...input,end:9000}),/invalid_source_read_request/);
      await assert.rejects(reader.readSource({...input,end:100}),/invalid_exact_read_range/);
      await assert.rejects(reader.readSource({...input,maxBytes:1}),/selected_source_budget/);
      await close(reader);assert.deepEqual(await hashes(directory),before);
      return {range:read.range,bytes:read.bytes,filesUnchanged:Object.keys(before).length};
    });

    for(const patch of [{enabled:false},{clean:true},{historyRecall:false},{answerHistory:false}])await check('唯讀原文尊重控制：'+Object.keys(patch)[0],async()=>{
      const {config,runtime}=await fixture(root),captured=await capture(runtime),original=await evidence(config,captured.sourcePointer);
      await runtime.configureControls({updateId:'block-read',patch});await close(runtime);
      const reader=await open(config,'read-only-session',true);
      await assert.rejects(reader.readSource({pointer:captured.sourcePointer,evidenceHash:loopHash(original),end:8}),/source_read_disabled_or_controls_changed/);
      await close(reader);
    });

    await check('實際已活化 Buffer 的重送不刷新原 TTL',async()=>{
      const {config,runtime}=await fixture(root),captured=await capture(runtime);await reply(runtime,captured);await close(runtime);
      const local=await createCmcpLocalInput({...config.input,adapter:{request:async()=>{throw Error('本案例不得呼叫分類器');}},
        delivery:{present:async()=>{throw Error('本案例不得呈現答案');}},clock:()=>now,sessionId:'buffer-reader'});
      try{
        const reading=await local.readingOpen({text:'讀取已保存通知。',mode:'all',ticket:'activate-source',inventory:{},timeContext:temporal(now),
          limits:{maxSources:4,maxTotalBytes:4096,maxPageBytes:4096,maxPages:4,maxProjectionBytes:8192}});
        const page=await local.readingPage({reading,previousPages:[],timeContext:temporal(now),project:false,activateBuffer:true});
        assert.equal(page.internal.after.activatedRefs.length,1);
      }finally{await local.close();}
      const reopened=await open(config),before=await reopened.bufferList({timeContext:temporal(now)});assert.ok(before.items.length>0);
      await reply(reopened,captured,{timeContext:temporal(now)});
      assert.deepEqual((await reopened.bufferList({timeContext:temporal(now)})).items,before.items);
      await close(reopened);return {activeCount:before.items.length};
    });
    await check('唯讀範圍回讀期間 OFF→ON 拒絕晚到內容',async()=>{
      const {config,runtime}=await fixture(root),captured=await capture(runtime),original=await evidence(config,captured.sourcePointer);
      const originalRead=fs.readFile;let entered,release,held=false;
      const entry=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
      fs.readFile=async(file,...args)=>{
        const data=await originalRead(file,...args);
        if(!held&&String(file).startsWith(path.join(config.input.root,'history')+path.sep)){held=true;entered();await gate;}
        return data;
      };
      try{
        const pending=runtime.readSource({pointer:captured.sourcePointer,evidenceHash:loopHash(original),end:8});
        const rejected=assert.rejects(pending,/source_read_disabled_or_controls_changed|reactivation_cancelled/);
        await entry;await runtime.configureControls({updateId:'late-read-off',patch:{enabled:false}});
        await runtime.configureControls({updateId:'late-read-on',patch:{enabled:true}});release();await rejected;
      }finally{release();fs.readFile=originalRead;await close(runtime);}
    });
    assert.equal(networkCalls,0);assert.equal(credentialReads,0);result.status='PASS';
  }catch(error){result.error=error.stack;process.exitCode=1;}
  finally{
    for(const runtime of live)try{await close(runtime);}catch(error){result.closeError=error.stack;result.status='FAIL';process.exitCode=1;}
    result.networkCalls=networkCalls;result.credentialReads=credentialReads;
    await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  }
  console.log(JSON.stringify({status:result.status,root,checks:cases.length,passed:cases.filter(c=>c.status==='PASS').length,error:result.error??null}));
}
