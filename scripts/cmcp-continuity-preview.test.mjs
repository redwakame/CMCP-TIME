import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=relative=>import(pathToFileURL(path.join(productRoot,relative)));
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,getCmcpContinuityCorrection:correction,CMCP_CONTINUITY_PROJECTION_LIMITS:limits}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {compileCmcpTypedContinuityProposal:compileTyped}=await load('src/cmcp-guard/cmcp-continuity-typed-proposal.js');
const {compileCmcpContinuityProposal:compileV4}=await load('src/cmcp-guard/cmcp-continuity-proposal.js');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');
const {CmcpHarnessBridge,projectHarnessToolResult}=await load('adapters/deepseek-harness/runtime-bridge.mjs');
const copy=structuredClone,sha=value=>createHash('sha256').update(value).digest('hex');
const capture=fn=>{try{fn();assert.fail('應拒絕原提案');}catch(error){assert.notEqual(error.code,'ERR_ASSERTION');return error;}};
const captureAsync=async fn=>{try{await fn();assert.fail('應拒絕原提案');}catch(error){assert.notEqual(error.code,'ERR_ASSERTION');return error;}};
const publicError=error=>({code:error.code??error.message,correction:correction(error)});
const previewOf=error=>correction(error)?.issues?.[0]?.previousVersion?.preview;
const root=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-preview');await fs.mkdir(root,{recursive:true});
const output=await fs.mkdtemp(path.join(root,'preview-'));
const publicationOnly=process.env.CMCP_PREVIEW_PUBLICATION_ONLY==='1';
const checkedPaths=['src/cmcp-guard/cmcp-continuity-projection.js','src/cmcp-guard/cmcp-continuity-proposal.js','src/cmcp-guard/cmcp-continuity-typed-proposal.js','src/cmcp-guard/cmcp-local-input.js','src/cmcp-guard/cmcp-runtime-session.js'];
const checkedSources=await Promise.all(checkedPaths.map(async relative=>({relative,sha256:sha(await fs.readFile(path.join(productRoot,relative)))})));

async function fixture(name,rows,{projectPages=true}={}){
 const area=path.join(output,name),scopeId='synthetic-preview-'+name,timezone='Asia/Taipei';
 const records=rows.map((row,i)=>({role:'user',...row,time:row.time??new Date(Date.parse('2026-10-11T00:00:00.000Z')+i*1000).toISOString()}));
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:scopeId,providerMode:'host',input:{root:path.join(area,'state'),scopeId,events:[],timezone,limits:{maxEntries:12,maxCatalogBytes:14000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:14000},storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(area,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:area,sessionId:'synthetic-preview-session',hostProvider:{request:async()=>{throw Error('本測試禁止模型');}}});
 try{
  for(const row of records)await runtime.ingest({role:row.role,text:row.text,timeContext:{now:row.time,timezone}});
  const nav=await runtime.readingNavigate({text:'核對所選計畫的前版與明示修改。'});
  const reading=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:32768}});
  const pages=[];for(let n=0;n<64;n++){const page=await runtime.readingPage({ticket:reading.reader.ticket,project:projectPages});pages.push(page);if(page.reader.coverage.complete)break;}assert(pages.at(-1).reader.coverage.complete);
  const refs=records.map(row=>{const selected=pages.filter(page=>page.reader.text===row.text);assert.equal(selected.length,1);assert.equal(selected[0].reader.source.sourceAuthorRole,row.role);assert.equal(selected[0].reader.source.messageRecordedAt,row.time);return selected[0].reader.source.ref;});
  await fs.writeFile(path.join(area,'formal-reading.json'),JSON.stringify({records,refs,reading,pages},null,2)+'\n',{flag:'wx'});
  return {runtime,area,scopeId,config,records,refs,reading,pages,input:proposal=>({reading,previousPages:pages,scopeId,proposal,timeContext:{now:'2026-10-11T01:00:00.000Z',timezone}})};
 }catch(error){await runtime.close();throw error;}
}

test('拒絕提案的正式來源前一版預覽不取得狀態或執行權',async t=>{
 const large=['甲','乙','丙','丁'].map((char,i)=>({text:'新版'+String(i)+char.repeat(750)}));
 const rows=[{text:'甲😀乙｜原段B｜原段C。'},{text:'新段B'},{text:'新段C'},{role:'assistant',text:'助手提出的替代字句。'},
  {text:'重複｜重複。'},{text:'本次只核對其他事項。新段B'}, {text:'代號A|代號B|代號C|代號D'},...large,{text:'甲段B|甲段C'},{text:'乙段B|乙段C'}];
 const f=await fixture('portable',rows),outcomes=[];
 const plan={id:'plan',ref:f.refs[0],quote:rows[0].text,topic:'合成計畫',aspect:'指定片段',temporalUse:'current'};
 const replace=(old,ref,quote)=>({kind:'replace',quote:old,replacement:{ref,quote}});
 const change=(ref,quote,edits)=>({kind:'content',ref,quote,edits});
 const q=(version=6)=>({version,plans:[{...plan,orderedChanges:[change(f.refs[1],rows[1].text,[replace('原段B',f.refs[1],rows[1].text)]),change(f.refs[2],rows[2].text,[replace('原段B',f.refs[2],rows[2].text)])]}],unknowns:[]});
 const calc=proposal=>project(f.input(proposal));
 const assertNoEcho=(error,values=[])=>{assert.equal(previewOf(error),undefined);const text=JSON.stringify(publicError(error));for(const value of values)assert(!text.includes(value));};
 const check=async(name,fn)=>{
  if(publicationOnly&&!name.startsWith('正式 Runtime'))return;
  return t.test(name,async()=>{try{await fn();outcomes.push({name,status:'PASS'});}catch(error){outcomes.push({name,status:'FAIL',error:error.message});throw error;}});
 };
 try{
  const before={buffer:(await f.runtime.bufferList()).items,reading:copy(f.reading),pages:copy(f.pages)};
  await check('v5／v6 精確前驅與原輸入位置相同，Unicode 及 hash 正確',()=>{
   for(const version of [5,6]){
    const proposal=q(version),snapshot=copy(proposal),error=capture(()=>calc(proposal)),c=correction(error),v=previewOf(error);
    assert.equal(error.code,'continuity_v4_edit_quote_absent');assert.equal(c.issues[0].path,'$.plans[0].orderedChanges[1].edits[0]');
    assert.equal(c.issues[0].compiledPath,'$.planChanges[1].edits[0]');assert.equal(c.issues[0].previousVersion.basisPath,'$.plans[0].quote');assert.equal(c.issues[0].previousVersion.predecessorPath,'$.plans[0].orderedChanges[0]');
    assert.equal(v.status,'available');assert.equal(v.text,'甲😀乙｜新段B｜原段C。');assert.equal(v.textHash,loopHash(v.text));assert.equal(v.includedChangeCount,1);
    assert.equal(v.proposalAccepted,false);assert.equal(v.semanticVerification,'not_performed');assert.equal(v.executionAuthority,'none');assert.equal(v.truncated,false);
    assert(Buffer.byteLength(v.text)<=8192);assert(Buffer.byteLength(JSON.stringify(v))<=16384);assert.deepEqual(proposal,snapshot);
    assert.deepEqual(v.sourceBindings.map(row=>[row.use,row.ref]),[['basis',f.refs[0]],['change',f.refs[1]],['replacement',f.refs[1]]]);
    for(const row of v.sourceBindings){const source=f.reading.internal.manifest.sources.find(source=>source.ref===row.ref);assert.equal(row.sourceAuthorRole,'user');assert.equal(row.messageRecordedAt,source.messageRecordedAt);assert.equal(row.evidenceHash,source.evidenceHash);assert(!Object.hasOwn(row.range,'text'));}
    outcomes.push({name:'原位置與正式前像',version,error:publicError(error)});
   }
  });
  await check('v4 保留原 API，pure compiler 未接 callback 時不回顯正文',()=>{
   const v4={version:4,nodes:[{...plan,kind:'user_intent'}],planChanges:[{id:'c1',targetNodeId:'plan',afterChangeId:null,...q().plans[0].orderedChanges[0]},{id:'c2',targetNodeId:'plan',afterChangeId:'c1',...q().plans[0].orderedChanges[1]}],unknowns:[]};
   const direct=capture(()=>calc(v4));assert.equal(correction(direct).issues[0].path,'$.planChanges[1].edits[0]');assert.equal(previewOf(direct).text,'甲😀乙｜新段B｜原段C。');
   const attach=(code,issues=[])=>Object.assign(new TypeError(code),{code,issues});
   for(const error of [capture(()=>compileTyped(q(),{limits,correction:attach})),capture(()=>compileV4(v4,{limits,correction:attach}))]){assert.equal(error.code,'continuity_v4_edit_quote_absent');assert.equal(error.issues[0].previousVersion.preview,undefined);assert(!JSON.stringify(error.issues).includes(plan.quote));assert(!JSON.stringify(error.issues).includes('新段B'));}
  });
  await check('舊片段重複仍拒絕，只顯示已核基底，不自動選 occurrence',()=>{
   const proposal={version:6,plans:[{...plan,ref:f.refs[4],quote:rows[4].text,orderedChanges:[change(f.refs[1],rows[1].text,[replace('重複',f.refs[1],rows[1].text)])]}],unknowns:[]};
   const error=capture(()=>calc(proposal));assert.equal(error.code,'continuity_v4_edit_quote_not_unique');assert.equal(previewOf(error).text,rows[4].text);assert.equal(previewOf(error).includedChangeCount,0);
  });
  await check('錯 ref／base／replacement 原文無法藉 preview 回顯',()=>{
   const variants=[];
   const outside=q();outside.plans[0].ref='outside-reading';variants.push([outside,'continuity_source_outside_reading']);
   const base=q();base.plans[0].quote='未核基底SENTINEL';variants.push([base,'continuity_quote_absent']);
   const replacement=q();replacement.plans[0].orderedChanges[0].edits[0].replacement.quote='未核替換SENTINEL';variants.push([replacement,'continuity_quote_absent']);
   const source=q();source.plans[0].orderedChanges[0].ref='outside-reading';variants.push([source,'continuity_source_outside_reading']);
   for(const [proposal,expected]of variants){const error=capture(()=>calc(proposal));assert.equal(error.code??error.message,expected);assertNoEcho(error,['SENTINEL',plan.quote]);}
  });
  await check('Assistant 基底或已成功前綴不能升格為 User 預覽',()=>{
   const base=q();base.plans[0].ref=f.refs[3];base.plans[0].quote=rows[3].text;
   const prefix=q();prefix.plans[0].orderedChanges[0]=change(f.refs[3],rows[3].text,[replace('原段B',f.refs[3],rows[3].text)]);
   for(const proposal of [base,prefix]){const error=capture(()=>calc(proposal));assert.equal(error.message,'continuity_previous_version_user_source_required');assertNoEcho(error,[rows[3].text]);}
  });
  await check('replacement 必須屬於其 change 的正式來源與範圍',()=>{
   const outside=q();outside.plans[0].orderedChanges[0].ref=f.refs[5];outside.plans[0].orderedChanges[0].quote='本次只核對其他事項。';outside.plans[0].orderedChanges[0].edits[0].replacement.ref=f.refs[5];
   const other=q();other.plans[0].orderedChanges[0].edits[0].replacement={ref:f.refs[2],quote:rows[2].text};
   for(const proposal of [outside,other]){const error=capture(()=>calc(proposal));assert.equal(error.message,'continuity_plan_replacement_source_mismatch');assertNoEcho(error,[plan.quote]);}
  });
  await check('正式讀完但未進模型材料的來源仍不可透過 preview 旁路',async()=>{
   const pages=copy(f.pages);for(const page of pages)if(page.reader.source.ref===f.refs[1])page.modelContext=null;
   const tampered=capture(()=>project({...f.input(q()),previousPages:pages}));assert.equal(tampered.message,'reading_page_chain_mismatch');assertNoEcho(tampered,[plan.quote]);
   const unread=await fixture('unprojected',rows.slice(0,3),{projectPages:false});
   try{
    const proposal=q();proposal.plans[0].ref=unread.refs[0];for(const [i,entry]of proposal.plans[0].orderedChanges.entries()){entry.ref=unread.refs[i+1];entry.edits[0].replacement.ref=unread.refs[i+1];}
    const error=capture(()=>project(unread.input(proposal)));assert.equal(error.message,'continuity_quote_not_in_model_material');assertNoEcho(error,[plan.quote]);
   }finally{await unread.runtime.close();}
   const incomplete=capture(()=>project({...f.input(q()),previousPages:f.pages.slice(0,-1)}));assert.equal(incomplete.message,'continuity_complete_selected_reading_required');assertNoEcho(incomplete);
  });
  await check('前像超過 8192 bytes 回 unavailable，沒有裁切或片段正文',()=>{
   const changes=large.map((row,i)=>change(f.refs[7+i],row.text,[replace('代號'+String.fromCharCode(65+i),f.refs[7+i],row.text)]));
   changes.push(change(f.refs[1],rows[1].text,[replace('已不存在片段',f.refs[1],rows[1].text)]));
   const proposal={version:6,plans:[{...plan,ref:f.refs[6],quote:rows[6].text,orderedChanges:changes}],unknowns:[]};
   const error=capture(()=>calc(proposal)),v=previewOf(error);assert.equal(error.code,'continuity_v4_edit_quote_absent');assert.equal(v.status,'unavailable');assert.equal(v.reason,'bounded_preview_limit');assert(v.textBytes>8192);assert.equal(v.truncated,false);assert.equal(v.text,undefined);assert.equal(v.sourceBindings,undefined);
   outcomes.push({name:'text 上限回執',error:publicError(error)});
  });
  await check('前像短但來源回執累積超過 16384 bytes，也不裁減來源湊成功',()=>{
   const changes=[];for(let i=0;i<23;i++){
    const from=i%2===0?'甲':'乙',to=i%2===0?'乙':'甲',ref=f.refs[to==='甲'?11:12],body=rows[to==='甲'?11:12].text;
    changes.push(change(ref,body,[replace(from+'段B',ref,to+'段B'),replace(from+'段C',ref,to+'段C')]));
   }
   changes.push(change(f.refs[1],rows[1].text,[replace('不存在片段',f.refs[1],rows[1].text)]));
   const proposal={version:6,plans:[{...plan,ref:f.refs[11],quote:rows[11].text,orderedChanges:changes}],unknowns:[]};
   const error=capture(()=>calc(proposal)),v=previewOf(error);assert.equal(error.code,'continuity_v4_edit_quote_absent');assert.equal(v.status,'unavailable');assert(v.textBytes<8192);assert.equal(v.reason,'bounded_preview_limit');assert.equal(v.text,undefined);assert.equal(v.sourceBindings,undefined);outcomes.push({name:'整體 preview 上限回執',error:publicError(error)});
  });
  await check('正式 Runtime 仍拒絕且不保存；Buffer、時間與原閱讀材料不變',async()=>{
   const original=await f.runtime.continuityStatus();assert.equal(original.projection,null);
   const error=await captureAsync(()=>f.runtime.readingContinuity({ticket:f.reading.reader.ticket,proposal:q()}));assert.equal(error.code,'continuity_v4_edit_quote_absent');assert.equal(previewOf(error).status,'available');
   assert.equal((await f.runtime.continuityStatus()).projection,null);assert.deepEqual((await f.runtime.bufferList()).items,before.buffer);assert.deepEqual(f.reading,before.reading);assert.deepEqual(f.pages,before.pages);
   await f.runtime.revokeReading({ticket:f.reading.reader.ticket,reason:'caller_revoked'});assert.equal((await f.runtime.continuityStatus()).projection,null);
   await f.runtime.configureControls({updateId:'preview-off',patch:{enabled:false},persist:false});assert.equal((await f.runtime.readingContinuity({ticket:f.reading.reader.ticket,proposal:q()})).status,'disabled');
   await f.runtime.configureControls({updateId:'preview-clean',patch:{enabled:true,clean:true},persist:false});assert.equal((await f.runtime.continuityStatus()).projection,null);assert.deepEqual((await f.runtime.bufferList()).items,before.buffer);
  });
 }finally{await f.runtime.close();await fs.writeFile(path.join(f.area,'results.json'),JSON.stringify({modelCalls:0,runtimeClosed:true,semanticVerification:'not_performed',outcomes},null,2)+'\n',{flag:'wx'});}
});

test('正式 Bridge 工具公開結果完整保留預覽與拒絕，不當成模型已修正',async()=>{
 const rows=[{text:'甲😀乙｜原段B｜原段C。'},{text:'新段B'},{text:'新段C'}],f=await fixture('bridge',rows);
 await f.runtime.close();
 const runtimeConfig=path.join(f.area,'runtime.json');await fs.writeFile(runtimeConfig,JSON.stringify(f.config),{flag:'wx'});
 const bridge=new CmcpHarnessBridge({deploymentRoot:f.area,runtimeConfig,traceRoot:path.join(f.area,'trace'),scopeId:f.scopeId});
 try{
  const sid='synthetic-preview-bridge';await bridge.begin(sid,'query','核對同一個計畫明示修改後的前一版。');
  const nav=await bridge.tool(sid,'cmcp_find_history',{}),opened=await bridge.tool(sid,'cmcp_open_history',{navigationTicket:nav.ticket,selectionJson:JSON.stringify({version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''})});
  const pages=[];for(let i=0;i<64;i++){const page=await bridge.tool(sid,'cmcp_read_history',{ticket:opened.ticket});pages.push(page);if(page.coverage.complete)break;}assert(pages.at(-1).coverage.complete);
  const ref=text=>pages.find(page=>JSON.parse(page.modelContext).content===text).source.ref;
  const proposal={version:6,plans:[{id:'plan',ref:ref(rows[0].text),quote:rows[0].text,topic:'合成計畫',aspect:'指定片段',temporalUse:'current',orderedChanges:rows.slice(1).map(row=>({kind:'content',ref:ref(row.text),quote:row.text,edits:[{kind:'replace',quote:'原段B',replacement:{ref:ref(row.text),quote:row.text}}]}))}],unknowns:[]};
  const results=[];
  for(const input of [{proposal},{proposalJson:JSON.stringify(proposal)}]){
   const rejected=await bridge.tool(sid,'cmcp_project_continuity',{ticket:opened.ticket,...input}),publicRejection=JSON.parse(JSON.stringify(projectHarnessToolResult(rejected)));
   assert.equal(publicRejection.status,'rejected');assert.equal(publicRejection.reason,'continuity_v4_edit_quote_absent');
   const issue=publicRejection.correction.issues[0],v=issue.previousVersion.preview;
   assert.equal(issue.path,'$.plans[0].orderedChanges[1].edits[0]');assert.equal(v.status,'available');assert.equal(v.text,'甲😀乙｜新段B｜原段C。');assert.equal(v.textHash,loopHash(v.text));
   assert.equal(v.proposalAccepted,false);assert.equal(v.semanticVerification,'not_performed');assert.equal(v.executionAuthority,'none');
   assert.deepEqual(publicRejection.correction,rejected.correction);assert.equal((await bridge.continuityStatus(sid)).projection,null);
   results.push({input:input.proposal?'typed_object':'legacy_json',rejected,publicRejection});
  }
  await fs.writeFile(path.join(f.area,'bridge-publication.json'),JSON.stringify({layer:'正式 Bridge／Core 工具公開序列化，無宿主模型',modelCalls:0,proposal,pages,results},null,2)+'\n',{flag:'wx'});
 }finally{await bridge.close();await fs.writeFile(path.join(f.area,'bridge-close.json'),JSON.stringify({bridgeClosed:bridge.closed,modelCalls:0})+'\n',{flag:'wx'});}
});

if(process.env.CMCP_PREVIEW_ORIGINAL_DIAGNOSTIC&&!publicationOnly)test('可選：原 C28 七次拒絕及五個真正前一版逐筆對照',async()=>{
 const source=path.resolve(process.env.CMCP_PREVIEW_ORIGINAL_DIAGNOSTIC),read=async name=>JSON.parse(await fs.readFile(path.join(source,name),'utf8'));
 const original=await read('replay-result.json'),calls=(await read('public-proposals.json')).calls,records=await read('formal-synthetic-sources.json');
 const f=await fixture('original-c28',records.map(row=>({text:row.text,role:row.role,time:row.messageRecordedAt}))),results=[];
 try{
  assert.equal(calls.length,7);
  for(const call of calls){
   const before=JSON.stringify(call.proposal),prior=original.results.find(row=>row.sequence===call.seq),error=await captureAsync(()=>f.runtime.readingContinuity({ticket:f.reading.reader.ticket,proposal:copy(call.proposal)})),preview=previewOf(error);
   assert.equal(error.code??error.message,prior.nativeError);assert.equal(JSON.stringify(call.proposal),before);
   if(prior.compilerError){const changeId=prior.compilerError.issues[0].changeId,expected=prior.stages.find(stage=>stage.changeId===changeId).before;assert.equal(preview.status,'available');assert.equal(preview.text,expected);assert.equal(preview.textHash,loopHash(expected));assert.equal(preview.proposalAccepted,false);}
   else assert.equal(preview,undefined);
   results.push({seq:call.seq,proposalSha256:sha(before),sameRejection:true,error:publicError(error),semanticVerification:'not_performed'});
  }
  assert.equal((await f.runtime.continuityStatus()).projection,null);
 }finally{await f.runtime.close();await fs.writeFile(path.join(f.area,'results.json'),JSON.stringify({modelCalls:0,runtimeClosed:true,results},null,2)+'\n',{flag:'wx'});}
});

test('本批來源版本固定且無模型',async()=>{
 for(const item of checkedSources)assert.equal(sha(await fs.readFile(path.join(productRoot,item.relative))),item.sha256,'測試期間產品檔變動：'+item.relative);
 await fs.writeFile(path.join(output,'source-hashes.json'),JSON.stringify({productRoot,checkedSources,modelCalls:0,mode:publicationOnly?'runtime_bridge_publication_only':'complete_preview_suite'},null,2)+'\n',{flag:'wx'});
});
