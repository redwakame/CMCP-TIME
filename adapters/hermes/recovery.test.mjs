import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createSharedProjectService} from '../shared-project/service.mjs';
import {createHermesBridge} from './bridge.mjs';
import {MODEL_OPERATIONS} from '../shared-project/client.mjs';
import {CONTINUITY_ATTRIBUTION_RULES} from '../continuity-policy.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=process.env.CMCP_TEST_OUTPUT_ROOT?path.resolve(process.env.CMCP_TEST_OUTPUT_ROOT):path.join(repo,'logs/tests/hermes-recovery');
test('四個通用 Skill 導向正式閱讀契約，實際 open 供應來源歸屬責任',async()=>{
  for(const rel of ['adapters/hermes/SKILL.md','adapters/deepseek-harness/shared-project/SKILL.md','adapters/deepseek-harness/native-desktop/SKILL.md','adapters/codex/shared-project/skills/cmcp-shared-history/SKILL.md']){
    const skill=await fs.readFile(path.join(repo,rel),'utf8');
    // 目前 Skill 已精簡為路由；必要責任必須在真正 open 回執取得，不能僅測檔名。
    for(const clause of [/continuityContract/,/cmcp_read_history/,/includeCurrentInput:true/,/User 計畫、明說回報、Assistant 建議及工具核實分開/])assert.match(skill,clause,rel);
    for(const clause of [/readerIdentity/,/sourceOrigins/,/readerComparison/,/不表示採納或執行/,/不稱本輪自己的建議/,/不推定同作者/,/User 轉述 Assistant 建議不變更作者/,/User 回報完成不等於工具核實外部完成/])assert.match(CONTINUITY_ATTRIBUTION_RULES,clause,'回答前規約');
  }
  const f=await fixture({formalReader:true});try{
    const {opened}=await readStage(f),contract=opened.continuityContract;
    assert.equal(contract?.kind,'cmcp_continuity_reading_contract');
    assert.equal(contract.authority,'host_protocol_not_source_or_authorization');
    assert.equal(contract.bytes,Buffer.byteLength(contract.text));assert.equal(contract.sha256,createHash('sha256').update(contract.text).digest('hex'));
    for(const clause of [/readerIdentity/,/sourceOrigins/,/readerComparison/,/sameHost／sameAgent／sameSession/,/reply/,/不授予採納或執行權/,/不稱本輪自己的建議/,/不推定同作者/,/User 轉述 Assistant 提案也不改作者/,/User 回報完成與工具核實完成分開/,/新 Session 不重設原時間/])assert.match(contract.text,clause,'正式 open 實際契約');
  }finally{await f.service.close();}
});
async function hashes(root){const rows={};async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else rows[path.relative(root,p)]=createHash('sha256').update(await fs.readFile(p)).digest('hex');}}await walk(root);return rows;}
async function fixture({formalReader=false}={}){
  await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'recovery-')),workspace=path.join(root,'workspace');await fs.mkdir(workspace);
  const runtime={kind:'cmcp_runtime_config',version:1,runtimeId:'recovery-synthetic',providerMode:'host',input:{root:path.join(root,'state'),scopeId:'synthetic-recovery',events:[],timezone:'Asia/Taipei',limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:128,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(root,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true},localRetrieval:{maxStoredSources:128,maxCandidates:8,maxCandidateBytes:12000,maxExcerptCodePoints:420,maxQueryBytes:4096,maxIndexSourceBytes:8192,maxIndexTokens:131072,maxReadSources:2,maxReadBytes:16384,maxProjectionBytes:12000}};
  const runtimeConfig=path.join(root,'runtime.json');await fs.writeFile(runtimeConfig,JSON.stringify(runtime));
  const host={workspace,agentId:'synthetic-hermes',controlAuthFile:path.join(root,'controller-reference.json'),readAuthFile:path.join(root,'reader-reference.json')};
  // 本測試以明示合成 principal 走同程序正式服務，沒有網路／IPC 認證端點。
  await fs.writeFile(host.controlAuthFile,'{}');await fs.writeFile(host.readAuthFile,'{}');
  const config={kind:'cmcp_shared_project_config',version:1,projectId:'synthetic-recovery',projectRoot:root,runtimeConfig,traceRoot:path.join(root,'trace'),pipe:process.platform==='win32'?'\\\\.\\pipe\\cmcp-recovery-'+randomUUID():path.join(root,'service.sock'),lifetimeMs:60000,hosts:{hermes:host}};
  const service=await createSharedProjectService({config});let lastRequest,readerOpened=0,readCalls=0;const notes=[];
  const bridge=createHermesBridge({config:{},shared:config,host,scopeId:'synthetic-recovery'},{sessionId:'synthetic-session',authorized:true,note:async(kind,value)=>notes.push({kind,...value}),call:async({request,role})=>{lastRequest=request;return service.dispatch(request,{hostId:'hermes',role});},mcpFactory:async()=>{readerOpened++;return {call:async(name,args)=>{readCalls++;if(!formalReader)throw Error('本反例不可讀取來源');const operation=Object.entries(MODEL_OPERATIONS).find(([,value])=>value===name)?.[0];return service.dispatch({...lastRequest,requestId:randomUUID(),operation,args},{hostId:'hermes',role:'model_read'});},close:async()=>{}};}});
  const dispatch=(operation,args={})=>bridge.dispatch({sessionId:'synthetic-session',operation,args});
  await dispatch('begin',{userMessage:'合成普通問題，尚未要求回查。',turnId:'synthetic-turn',receivedAt:new Date().toISOString()});
  const control=text=>service.dispatch({...lastRequest,requestId:randomUUID(),operation:'control',args:{text}},{hostId:'hermes',role:'controller'});
  const revoke=()=>service.dispatch({...lastRequest,requestId:randomUUID(),operation:'revoke',args:{}},{hostId:'hermes',role:'controller'});
  return {root,service,dispatch,control,revoke,notes,get readerOpened(){return readerOpened;},get readCalls(){return readCalls;}};
}

async function readStage(f){
  await f.dispatch('finish',{turnId:'synthetic-turn',text:'這是合成原答，尚未執行任何工作。',receivedAt:new Date().toISOString()});
  await f.dispatch('begin',{userMessage:'請回查剛才的合成問題與原答。',turnId:'read-turn',receivedAt:new Date().toISOString()});
  const tool=(name,args={})=>f.dispatch('tool',{turnId:'read-turn',name,arguments:args});
  const found=await tool('cmcp_find_history'),opened=await tool('cmcp_open_history',{navigationTicket:found.ticket,selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''})});
  const pages=[];for(let i=0;i<4;i++){const page=await tool('cmcp_read_history',{ticket:opened.ticket});pages.push(page);if(page.coverage.complete)break;}
  assert.equal(pages.at(-1).coverage.complete,true);
  return {ticket:opened.ticket,pages,tool,opened};
}

test('正式閱讀階段只在同回合完整來源成立；一次提醒不改 History、TTL、grant 或派送',async()=>{
  const f=await fixture({formalReader:true});try{
    assert.deepEqual(await f.dispatch('stage-check',{turnId:'synthetic-turn'}),{active:false,reason:'no_pending_formal_stage'});
    assert.equal(f.readCalls,0);
    const {ticket,tool}=await readStage(f),before=await hashes(f.root),count=f.readCalls;
    const stage=await f.dispatch('stage-check',{turnId:'read-turn'});assert.equal(stage.active,true);assert.equal(stage.ticket,ticket);assert.match(stage.context,/先前已讀完/);assert.match(stage.context,/重驗來源版本/);
    assert.equal(f.readCalls,count+1);assert.deepEqual(await hashes(f.root),before);
    assert.equal((await f.dispatch('stage-check',{turnId:'read-turn'})).active,false);assert.equal(f.readCalls,count+1);
    const projected=await tool('cmcp_project_continuity',{ticket,proposalJson:JSON.stringify({version:3,nodes:[],unknowns:[]})});
    assert.equal(projected.kind,'cmcp_continuity_projection');assert.equal(projected.status,'ready');
    assert.equal((await f.dispatch('stage-check',{turnId:'read-turn'})).active,false);
    await f.dispatch('cancel');await assert.rejects(f.dispatch('stage-check',{turnId:'read-turn'}),/active_authorized/);
  }finally{await f.service.close();}
});

test('同回合 budget 查核跨工具及投影仍可用；只讀既有覆蓋，不建立授權或重發提示',async()=>{
  const f=await fixture({formalReader:true});try{
    assert.equal((await f.dispatch('budget-check',{turnId:'synthetic-turn',ticket:'不存在的票券'})).active,false);
    const {ticket,tool}=await readStage(f);
    await f.dispatch('stage-check',{turnId:'read-turn'});
    const before=await hashes(f.root);
    for(let i=0;i<2;i++){
      const checked=await f.dispatch('budget-check',{turnId:'read-turn',ticket});
      assert.equal(checked.active,true);assert.equal(checked.completion.formalReading,'completed');
      assert.equal(checked.completion.projectionCompletion,'not_performed');assert.equal(checked.context,undefined);
    }
    assert.deepEqual(await hashes(f.root),before);
    await tool('cmcp_project_continuity',{ticket,proposalJson:JSON.stringify({version:3,nodes:[],unknowns:[]})});
    const afterProjection=await hashes(f.root),checked=await f.dispatch('budget-check',{turnId:'read-turn',ticket});
    assert.equal(checked.active,true);assert.equal(checked.completion.projectionCompletion,'completed');
    assert.equal(checked.completion.sourceVersionValidation,'formal_projection_tool_rechecks');
    assert.equal(checked.completion.semanticAssessment,'not_assessed');assert.deepEqual(await hashes(f.root),afterProjection);
    assert.equal((await f.dispatch('budget-check',{turnId:'read-turn',ticket:'其他票券'})).active,false);
    for(const args of [{turnId:'其他回合',ticket},{turnId:'read-turn',ticket,context:'不可注入'},{turnId:'read-turn',ticket:7}])
      await assert.rejects(f.dispatch('budget-check',args),/hermes_budget_binding_mismatch/);
    await assert.rejects(f.dispatch('tool',{turnId:'read-turn',name:'budget-check',arguments:{ticket}}),/hermes_read_tool_forbidden/);
  }finally{await f.service.close();}
});

test('budget 查核不繼承已關閉回合，不繞過 OFF／Clean／撤權／取消',async()=>{
  for(const condition of ['set enabled off','set clean on','revoke','cancel','finish','next-turn','close']){
    const f=await fixture({formalReader:true});try{
      const {ticket}=await readStage(f);
      assert.equal((await f.dispatch('budget-check',{turnId:'read-turn',ticket})).active,true);
      if(condition.startsWith('set '))await f.control(condition);
      else if(condition==='revoke')await f.revoke();
      else if(condition==='cancel'||condition==='close')await f.dispatch(condition);
      else {
        await f.dispatch('finish',{turnId:'read-turn',text:'合成原答。',receivedAt:new Date().toISOString()});
        if(condition==='next-turn'){
          await f.dispatch('begin',{userMessage:'下一輪普通問題。',turnId:'next-turn',receivedAt:new Date().toISOString()});
          assert.equal((await f.dispatch('budget-check',{turnId:'next-turn',ticket})).active,false);
        }
      }
      await assert.rejects(f.dispatch('budget-check',{turnId:'read-turn',ticket}),/disabled|changed|stale|not_joined|active_authorized|cancelled|controls|invalidated|binding_mismatch/);
    }finally{await f.service.close();}
  }
});

test('正式階段 fresh-check 保持 OFF／Clean／撤權與取消；新回合不繼承舊票',async()=>{
  for(const condition of ['set clean on','set enabled off','revoke','cancel','next-turn']){
    const f=await fixture({formalReader:true});try{
      await readStage(f);
      if(condition.startsWith('set '))await f.control(condition);
      else if(condition==='revoke')await f.revoke();
      else if(condition==='cancel')await f.dispatch('cancel');
      else {await f.dispatch('finish',{turnId:'read-turn',text:'合成回覆。',receivedAt:new Date().toISOString()});await f.dispatch('begin',{userMessage:'全新普通問題。',turnId:'next-turn',receivedAt:new Date().toISOString()});assert.equal((await f.dispatch('stage-check',{turnId:'next-turn'})).active,false);}
      await assert.rejects(f.dispatch('stage-check',{turnId:'read-turn'}),/disabled|changed|stale|not_joined|active_authorized|cancelled|controls|invalidated|binding_mismatch/);
    }finally{await f.service.close();}
  }
});

test('原件異動後先前閱讀完成不冒充來源新鮮；正式投影仍拒絕變動',async()=>{
  const f=await fixture({formalReader:true});try{
    const {ticket,tool}=await readStage(f);
    const files=[];async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.name.endsWith('.json'))files.push(p);}}await walk(path.join(f.root,'state'));
    let changed=false;
    for(const file of files){let stored;try{stored=JSON.parse(await fs.readFile(file,'utf8'));}catch{continue;}
      if(stored.format==='cmcp-local-history-reference'&&stored.evidence?.content?.body==='合成普通問題，尚未要求回查。'){
        await fs.copyFile(file,path.join(f.root,'synthetic-before-source-change.json'));
        stored.evidence.content.body='合成來源受到變更；不得沿用舊頁作正式依據。';stored.evidenceSha256=createHash('sha256').update(JSON.stringify(stored.evidence)).digest('hex');
        await fs.writeFile(file,JSON.stringify(stored));changed=true;break;
      }
    }
    assert.equal(changed,true,'只修改本測試建立的明示負例原件，不操作日常 History');
    const stage=await f.dispatch('stage-check',{turnId:'read-turn'});assert.equal(stage.active,true);assert.match(stage.context,/先前已讀完/);
    await assert.rejects(tool('cmcp_project_continuity',{ticket,proposalJson:JSON.stringify({version:3,nodes:[],unknowns:[]})}),/source.*changed|source.*unavailable|publication|history|source.*invalid/);
    const recovery=await f.dispatch('recovery-check',{turnId:'read-turn',visibleContent:'absent'});
    assert.equal(recovery.completion.formalReading,'completed');assert.equal(recovery.completion.projectionCompletion,'pending');
    assert.equal(recovery.completion.sourceVersionValidation,'formal_projection_tool_rechecks');assert.match(recovery.context,/不是全歷史覆蓋或原件重新核驗/);
  }finally{await f.service.close();}
});

test('length 併入同輪正式閱讀狀態，不消耗 stage 額度、不把未投影當失敗',async()=>{
  const f=await fixture({formalReader:true});try{
    const {ticket}=await readStage(f),before=await hashes(f.root);
    const length=await f.dispatch('recovery-check',{turnId:'read-turn',visibleContent:'absent'});
    assert.deepEqual(length.completion,{formalReading:'completed',projectionCompletion:'not_performed',ticket,projectionStatus:null,evidenceLevel:'same_turn_formal_tool_receipts',sourceVersionValidation:'formal_projection_tool_rechecks',semanticAssessment:'not_assessed'});
    assert.match(length.context,/not_performed/);assert.match(length.context,/不代表回答失敗/);assert.ok(length.context.includes(ticket));
    assert.ok(Buffer.byteLength(length.context)<=4096,'實際長度規約與階段摘要可通過宿主有界材料限制');
    assert.ok(!length.context.includes('合成普通問題，尚未要求回查。'));
    const stage=await f.dispatch('stage-check',{turnId:'read-turn'});assert.equal(stage.active,true);
    const nextLength=await f.dispatch('recovery-check',{turnId:'read-turn',visibleContent:'absent'});
    assert.deepEqual(nextLength.completion,length.completion);assert.deepEqual(await hashes(f.root),before);
    const original='這是僅需原文的正常合成答覆，不另外建立投影。';
    const saved=await f.dispatch('finish',{turnId:'read-turn',text:original,receivedAt:new Date().toISOString()});
    assert.ok(saved.sourcePointer);assert.equal(saved.completion.projectionCompletion,'not_performed');
    const note=f.notes.filter(x=>x.kind==='final_saved').at(-1);
    assert.equal(note.bodyHash,createHash('sha256').update(original).digest('hex'));assert.deepEqual(note.completion,saved.completion);
  }finally{await f.service.close();}
});

test('保存回執分列未請求、未執行、嘗試未完及正式完成，不把結構回執當語意',async()=>{
  const f=await fixture({formalReader:true});try{
    assert.equal((await f.dispatch('recovery-check',{turnId:'synthetic-turn'})).completion.projectionCompletion,'not_requested');
    const {ticket,tool}=await readStage(f);
    await assert.rejects(tool('cmcp_project_continuity',{ticket,proposalJson:JSON.stringify({version:42,nodes:[]})}),/invalid_continuity_version/);
    const incomplete=await f.dispatch('recovery-check',{turnId:'read-turn'});
    assert.equal(incomplete.completion.projectionCompletion,'pending');assert.equal(incomplete.completion.projectionStatus,null);
    const projected=await tool('cmcp_project_continuity',{ticket,proposalJson:JSON.stringify({version:3,nodes:[],unknowns:[]})});
    assert.equal(projected.status,'ready');
    const completed=await f.dispatch('recovery-check',{turnId:'read-turn'});
    assert.equal(completed.completion.projectionCompletion,'completed');assert.equal(completed.completion.projectionStatus,'ready');assert.equal(completed.completion.semanticAssessment,'not_assessed');
    const saved=await f.dispatch('finish',{turnId:'read-turn',text:'合成原答保持。',receivedAt:new Date().toISOString()});
    assert.deepEqual(saved.completion,completed.completion);
    await f.dispatch('begin',{userMessage:'下一輪普通問候。',turnId:'next-turn',receivedAt:new Date().toISOString()});
    const next=await f.dispatch('recovery-check',{turnId:'next-turn'});
    assert.equal(next.completion.formalReading,'not_requested');assert.equal(next.completion.projectionCompletion,'not_requested');assert.equal(next.completion.ticket,null);
  }finally{await f.service.close();}
});

test('已有正式閱讀後的 length 狀態仍 fresh-check OFF、Clean、撤權及取消',async()=>{
  for(const condition of ['set enabled off','set clean on','revoke','cancel']){
    const f=await fixture({formalReader:true});try{
      await readStage(f);
      if(condition.startsWith('set '))await f.control(condition);else if(condition==='revoke')await f.revoke();else await f.dispatch('cancel');
      await assert.rejects(f.dispatch('recovery-check',{turnId:'read-turn',visibleContent:'absent'}),/disabled|changed|stale|not_joined|active_authorized|cancelled|controls|invalidated/);
    }finally{await f.service.close();}
  }
});

test('正式服務 length 查核不刷新原時間、TTL、History、grant 或派送，Clean／OFF／撤權均拒絕',async()=>{
  const originalFetch=globalThis.fetch;let fetches=0;globalThis.fetch=async()=>{fetches++;throw Error('本測試禁止模型');};
  try{
    for(const condition of ['unchanged','set clean on','set enabled off','revoke','cancel']){
      const f=await fixture();try{
        const before=await hashes(f.root);
        for(let i=0;i<2;i++)assert.equal((await f.dispatch('recovery-check',{turnId:'synthetic-turn'})).active,true);
        assert.deepEqual(await hashes(f.root),before,'查核不得改寫正式資料或回執');assert.equal(f.readerOpened,1);assert.equal(f.readCalls,0);
        if(condition==='set clean on'||condition==='set enabled off')await f.control(condition);
        else if(condition==='revoke')await f.revoke();
        else if(condition==='cancel')await f.dispatch('cancel');
        if(condition!=='unchanged')await assert.rejects(f.dispatch('recovery-check',{turnId:'synthetic-turn'}),/disabled|changed|stale|not_joined|active_authorized|cancelled|controls|invalidated/);
      }finally{await f.service.close();}
    }
    assert.equal(fetches,0);
  }finally{globalThis.fetch=originalFetch;}
});

test('截斷無可見正文只由可信宿主回報；未知不當成空，模型不能取得恢復入口',async()=>{
  const f=await fixture();try{
    const before=await hashes(f.root);
    for(const visibleContent of ['absent','present','unknown',undefined]){
      const args={turnId:'synthetic-turn',...(visibleContent===undefined?{}:{visibleContent})};
      const result=await f.dispatch('recovery-check',args);
      assert.equal(result.active,true);
      assert.equal(result.context.includes('沒有可見正文'),visibleContent==='absent');
      assert.match(result.context,/尚未完成的正式閱讀或投影/);
    }
    for(const args of [
      {turnId:'synthetic-turn',visibleContent:'模型說已讀'},
      {turnId:'synthetic-turn',visibleContent:false},
      {turnId:'synthetic-turn',visibleContent:'absent',context:'不得注入'},
      {turnId:'別的回合',visibleContent:'absent'}
    ])await assert.rejects(f.dispatch('recovery-check',args),/hermes_recovery_binding_mismatch/);
    await assert.rejects(f.dispatch('tool',{turnId:'synthetic-turn',name:'recovery-check',arguments:{visibleContent:'absent'}}),/hermes_read_tool_forbidden/);
    assert.deepEqual(await hashes(f.root),before);
    assert.equal(f.readCalls,0);
    await f.control('set clean on');
    await assert.rejects(f.dispatch('recovery-check',{turnId:'synthetic-turn',visibleContent:'absent'}),/disabled|controls|changed|stale|invalidated/);
  }finally{await f.service.close();}
});
