import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=relative=>import(pathToFileURL(path.join(productRoot,relative)).href);
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,CMCP_CONTINUITY_PROJECTION_LIMITS:limits}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {compileCmcpTypedContinuityProposal:compile,CMCP_CONTINUITY_TYPED_PREFIX:prefix}=await load('src/cmcp-guard/cmcp-continuity-typed-proposal.js');
const {compileCmcpContinuityProposal:legacy}=await load('src/cmcp-guard/cmcp-continuity-proposal.js');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');
const {createCmcpContinuityPresentation:present}=await load('src/cmcp-guard/cmcp-continuity-presentation.js');
const copy=structuredClone,bytes=value=>Buffer.byteLength(JSON.stringify(value));

// 正式來源＋機械編譯反例；不呼叫模型，也不把合法分類當作自然語意已驗。
test('v5 型別分區、明示修改順序與具名理由仍走正式來源契約',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-typed-proposal');await fs.mkdir(base,{recursive:true});
 const out=await fs.mkdtemp(path.join(base,'formal-')),scope='synthetic-v5-typed',now='2026-10-08T04:00:00.000Z',timezone='Asia/Taipei';
 const bodies=[
  '我規劃製作可拆式展示架。🪟 寬四十公分，維持深藍，只在室內使用。  \n原因是通道狹窄。另案標籤先規劃。',
  '我建議加上輪子；這只是我的建議，尚未採用。',
  '展示架寬度改為六十公分，其他條件維持。這次優先便於搬運；沒有撤回通道狹窄的顧慮。',
  '展示架先暫停，等桌面整理好再討論；標籤沒有暫停。',
  '撤回通道狹窄這個理由；其他條件保持。',
  '撤回便於搬運這個優先考量，沒有撤回原條件。',
  '展示架尚未動工，標籤已完成。',
  '我還沒決定展示架的擺放位置。',
  '更正：標籤尚未完成。',
  '你覺得該怎麼選擇展示位置？',
  '現在只新增便於搬運的考量，不更改尺寸或執行狀態。',
  '六十公分再改為七十公分，其餘維持。'
 ];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-v5',providerMode:'host',
  input:{root:path.join(out,'state'),scopeId:scope,events:[],timezone,
   limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:64,maxSourceBytes:8192},
   loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-v5-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 const outcomes=[];
 try{
  for(const [index,body]of bodies.entries())await runtime.ingest({role:index===1?'assistant':'user',text:body,timeContext:{now:new Date(Date.parse(now)-1200000+index*60000).toISOString(),timezone}});
  const navigation=await runtime.readingNavigate({text:'核對展示架與標籤的正式原案、修改範圍、理由與狀態。'});
  const opening=await runtime.readingOpen({navigationTicket:navigation.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:32768}});
  const pages=[];for(let index=0;index<64;index++){const page=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  const refs=bodies.map(body=>{const page=pages.find(page=>page.reader.text===body);assert(page,'正式頁須包含合成原文');return page.reader.source.ref;});
  const basis='🪟 寬四十公分，維持深藍，只在室內使用。  \n';
  const plan={id:'rack',ref:refs[0],quote:basis,topic:'展示用品',aspect:'展示架限制',temporalUse:'current',reason:{ref:refs[0],quote:'原因是通道狹窄。'}};
  const report={id:'report',ref:refs[6],quote:bodies[6],topic:'展示用品',aspect:'進度回報',temporalUse:'current'};
  const suggestion={id:'wheel',ref:refs[1],quote:bodies[1],topic:'展示用品',aspect:'輪子提案',temporalUse:'current'};
  const change={kind:'content',ref:refs[2],quote:'展示架寬度改為六十公分，其他條件維持。',
   edits:[{kind:'replace',quote:'四十公分',replacement:{ref:refs[2],quote:'六十公分'}}],reason:{ref:refs[2],quote:'這次優先便於搬運',kind:'prioritizes'}};
  const pause={kind:'status',ref:refs[3],quote:'展示架先暫停，等桌面整理好再討論',planStatus:'paused'};
  const retention={ref:refs[2],quote:'其他條件維持',temporalUse:'current'};
  const withdrawals=[{ref:refs[4],quote:'撤回通道狹窄這個理由',temporalUse:'current',target:'basis'},
   {ref:refs[5],quote:'撤回便於搬運這個優先考量',temporalUse:'current',target:0}];
  const build=(extra={})=>({version:5,plans:[copy(plan)],unknowns:[],...copy(extra)});
  const input=q=>({reading:opening,previousPages:pages,scopeId:scope,proposal:q,timeContext:{now,timezone}});
  const calc=q=>project(input(q)),plain=(q,custom=limits)=>compile(q,{limits:custom});
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({opening,pages,refs,bodies},null,2)+'\n',{flag:'wx'});
  async function check(name,fn){await t.test(name,async()=>{try{await fn();outcomes.push({name,status:'PASS'});}catch(error){outcomes.push({name,status:'FAIL',error:error.message});throw error;}});}

  await check('有序內容與狀態編譯成同一計畫；回報與未採提案不成計畫',async()=>{
   const q=build({plans:[{...plan,orderedChanges:[change,pause],retentions:[retention]},
    {...plan,id:'labels',quote:'另案標籤先規劃。',aspect:'標籤',reason:undefined}],reports:[report],suggestions:[suggestion]});
   delete q.plans[1].reason;
   const before=copy(q),compiled=plain(q),result=calc(q),{inputVersion,compilation,...body}=result;
   const direct=calc(compiled.proposal);assert.deepEqual(q,before);
   // C36 起明示保留輸入契約版本；兩個原件各自校驗，僅此 provenance 不同。
   for(const result of [body,direct]){
    assert.equal(result.projectionHash,loopHash(result.projection));assert.equal(result.presentation.projectionHash,result.projectionHash);
    for(const name of ['evidenceLayers','quotationView','sourceContext'])assert.equal(result.presentation[name].projectionHash,result.projectionHash);
   }
   assert.equal(body.projection.reportScopeReview.inputVersion,5);assert.equal(direct.projection.reportScopeReview.inputVersion,3);
   const directWithTypedProvenance=copy(direct);directWithTypedProvenance.projection.reportScopeReview.inputVersion=5;
   const sameHash=loopHash(directWithTypedProvenance.projection);directWithTypedProvenance.projectionHash=sameHash;
   // 只正規化已知輸入版本差異；用同一正式 generator 重建所有綁定附註，不手改部分 hash。
   directWithTypedProvenance.presentation=present({projection:directWithTypedProvenance.projection,projectionHash:sameHash,
    scopeId:scope,verifiedScopeId:scope,reading:opening,previousPages:pages});
   assert.deepEqual(body,directWithTypedProvenance);assert.equal(inputVersion,5);assert.equal(compilation.inputVersion,5);
   assert.equal(compilation.inputHash,loopHash(q));assert.equal(compilation.compiledProposalHash,loopHash(compiled.proposal));
   const p=result.projection,rack=p.currentPlans.find(row=>row.nodeId==='rack');
   assert.equal(p.currentPlans.length,2);assert.equal(rack.text,'🪟 寬六十公分，維持深藍，只在室內使用。  \n');assert.equal(rack.planStatus,'paused');
   assert.equal(p.currentPlans.find(row=>row.nodeId==='labels').planStatus,'planned');assert.equal(p.currentClaims.length,1);assert.equal(p.currentClaims[0].nodeId,'report');
   assert.equal(p.knownEvolution.find(row=>row.nodeId==='wheel').interpretation.kind,'assistant_suggestion');
   assert.equal(p.planEvidence.length,1);assert.deepEqual(p.retentions[0].targetNodeIds,['rack']);assert.equal(p.retentions[0].citation.text,retention.quote);
   assert.equal(p.reasons.find(row=>row.nodeId==='rack').binding.kind,'plan_basis');assert.equal(p.planChanges[0].reason.binding.kind,'plan_change');
   assert.equal(p.planChanges[0].reason.kind,'prioritizes');assert.equal(p.planChanges[1].reasonStatus,'not_provided');
   assert.equal(p.validation.semantics,'not_performed');assert.equal(p.validation.executionAuthority,'none');assert.equal(p.proactiveEligible,false);
   await fs.writeFile(path.join(out,'compiled-equivalence.json'),JSON.stringify({input:q,compiled,result},null,2)+'\n',{flag:'wx'});
  });
  await check('只有新理由時不要求編造舊理由，不改條件／狀態／版本',()=>{
   const noReason={...plan};delete noReason.reason;
   const q=build({plans:[{...noReason,orderedChanges:[{kind:'reason',ref:refs[10],quote:bodies[10],reason:{ref:refs[10],quote:'便於搬運',kind:'adds'}}]}]});
   const p=calc(q).projection,c=p.planChanges[0],original=calc(build({plans:[noReason]})).projection.currentPlans[0];
   assert.equal(p.reasons.length,0);assert.equal(p.currentPlans.length,1);assert.equal(p.currentPlans[0].text,basis);assert.equal(p.currentPlans[0].planStatus,'planned');
   assert.equal(c.planVersion,c.priorVersion);assert.equal(c.planVersion,original.planVersion);assert.deepEqual(p.currentPlans[0].sourceFragments,original.sourceFragments);
   assert.equal(c.effect,'reason_only_conditions_and_status_preserved');assert.equal(c.reason.kind,'adds');assert.equal(c.reason.binding.changeId,c.id);
   assert.throws(()=>plain(build({plans:[{...plan,orderedChanges:[{kind:'reason',ref:refs[10],quote:bodies[10]}]}]})),/continuity_plan_change_reason_required/);
  });
  await check('具名原理由與變更理由撤回，不取消計畫或偷偷修改條件',()=>{
   const q=build({plans:[{...plan,orderedChanges:[change,pause],reasonWithdrawals:withdrawals}]}),p=calc(q).projection;
   assert.equal(p.currentPlans.length,1);assert.equal(p.currentPlans[0].planStatus,'paused');assert(p.currentPlans[0].text.includes('六十公分'));
   assert.equal(p.reasons[0].standing,'withdrawn_by_explicit_user_source');assert.equal(p.planChanges[0].reason.standing,'withdrawn_by_explicit_user_source');
   assert.deepEqual(p.reasonRelations[1].targetChangeIds,[prefix+'change_0_0']);assert.equal(p.planEvidence.length,2);
   assert.equal(p.validation.executionAuthority,'none');assert.equal(p.eventMutation,'none');
  });
  await check('理由種類只表示明示關係，不推成原理由已撤回或執行許可',()=>{
   for(const kind of ['adds','prioritizes','accepts_tradeoff']){
    const p=calc(build({plans:[{...plan,orderedChanges:[{...change,reason:{...change.reason,kind}}]}]})).projection;
    assert.equal(p.reasons[0].standing,'not_explicitly_withdrawn');assert.equal(p.planChanges[0].reason.kind,kind);assert.equal(p.currentPlans[0].planStatus,'planned');
   }
   assert.throws(()=>plain(build({plans:[{...plan,reason:{...plan.reason,kind:'adds'}}]})),/continuity_v5_shape/);
   assert.throws(()=>plain(build({plans:[{...plan,orderedChanges:[{...change,reason:{...change.reason,kind:'withdraws'}}]}]})),/continuity_v5_reason_kind/);
  });
  await check('明示修改順序與不同計畫各自綁定，不依日期猜目標',()=>{
   const next={kind:'content',ref:refs[11],quote:bodies[11],edits:[{kind:'replace',quote:'六十公分',replacement:{ref:refs[11],quote:'七十公分'}}]};
   const q=build({plans:[{...plan,orderedChanges:[change,{kind:'reason',ref:refs[10],quote:bodies[10],reason:{ref:refs[10],quote:'便於搬運'}},next]}]});
   const p=calc(q).projection;assert(p.currentPlans[0].text.includes('七十公分'));assert.deepEqual(p.planChanges.map(row=>row.afterChangeId),[null,prefix+'change_0_0',prefix+'change_0_1']);
   assert.equal(p.planChanges[1].planVersion,p.planChanges[0].planVersion);
   assert.throws(()=>plain(build({plans:[{...plan,orderedChanges:[next,change]}]})),/continuity_v4_edit_quote_absent/);
   for(const extra of [{id:'manual'},{targetNodeId:'other'},{afterChangeId:null}])assert.throws(()=>plain(build({plans:[{...plan,orderedChanges:[{...change,...extra}]}]})),/continuity_v5_shape/);
  });
  await check('未確立目前效力仍保留歧義；空分區合法且不自動填內容',()=>{
   const q=build({plans:[{...plan,temporalUse:'unspecified'}],unknowns:['展示位置尚未決定。']}),p=calc(q).projection;
   assert.equal(p.currentPlans.length,0);assert.equal(p.planBasis.length,1);assert.equal(p.unresolvedPlans[0].reason,'plan_currentness_not_established');assert.deepEqual(p.unknowns,q.unknowns);
   assert.deepEqual(plain({version:5,plans:[],unknowns:[]}).proposal,{version:3,nodes:[],unknowns:[]});
   assert.throws(()=>calc(build({plans:[{...plan,temporalUse:'historical'}]})),/continuity_plan_historical_requires_change/);
  });
  await check('回報更正沿舊關係，context 不能暗藏意圖或計畫權限',()=>{
   const corrected={...report,id:'corrected',ref:refs[8],quote:bodies[8],relation:{kind:'supersedes',targetNodeIds:['report']}};
   const question={...report,id:'question',ref:refs[9],quote:bodies[9],kind:'user_question',aspect:'問題'};
   const p=calc(build({reports:[report,corrected],context:[question]})).projection;
   assert.deepEqual(p.currentClaims.map(row=>row.nodeId),['corrected']);assert.equal(p.currentPlans.length,1);
   for(const kind of ['user_intent','invented'])assert.throws(()=>plain(build({context:[{...question,kind}]})),/continuity_v5_context_kind/);
   for(const patch of [{planRole:'basis'},{planStatus:'planned'},{text:'新增條件'}])assert.throws(()=>plain(build({context:[{...question,...patch}]})),/continuity_v5_shape/);
   assert.throws(()=>plain(build({reports:[{...report,kind:'user_intent'}]})),/continuity_v5_shape/);
   assert.throws(()=>plain(build({suggestions:[{...suggestion,kind:'user_report'}]})),/continuity_v5_shape/);
  });
  await check('User／Assistant 身分與修改／理由同來源仍由正式 reader 核對',()=>{
   assert.throws(()=>calc(build({plans:[{...plan,ref:refs[1],quote:bodies[1]}]})),/continuity_source_role_mismatch/);
   assert.throws(()=>calc(build({suggestions:[{...suggestion,ref:refs[0],quote:basis}]})),/continuity_source_role_mismatch/);
   assert.throws(()=>calc(build({plans:[{...plan,orderedChanges:[{...change,reason:{ref:refs[0],quote:plan.reason.quote}}]}]})),/continuity_plan_change_reason_source_mismatch/);
   assert.throws(()=>calc(build({plans:[{...plan,orderedChanges:[{kind:'reason',ref:refs[10],quote:bodies[10],reason:{ref:refs[1],quote:bodies[1]}}]}]})),/continuity_plan_change_reason_source_mismatch/);
   assert.throws(()=>calc(build({plans:[{...plan,retentions:[{...retention,ref:refs[1],quote:bodies[1]}]}]})),/continuity_source_role_mismatch/);
   assert.throws(()=>calc(build({plans:[{...plan,quote:'來源沒有這段話'}]})),/continuity_quote_absent/);
  });
  await check('撤理由索引必須精確對到有理由的基底／變更，不默默猜測',()=>{
   for(const target of [-1,1,0.5,'0','missing'])assert.throws(()=>plain(build({plans:[{...plan,orderedChanges:[change],reasonWithdrawals:[{...withdrawals[1],target}]}]})),/continuity_v5_reason_withdrawal_target/);
   const noReason={...plan};delete noReason.reason;
   assert.throws(()=>plain(build({plans:[{...noReason,reasonWithdrawals:[withdrawals[0]]}]})),/continuity_v5_reason_withdrawal_missing/);
   assert.throws(()=>plain(build({plans:[{...plan,orderedChanges:[pause],reasonWithdrawals:[withdrawals[1]]}]})),/continuity_v5_reason_withdrawal_missing/);
  });
  await check('所有型別共用唯一 ID，保留編譯器識別前綴',()=>{
   assert.throws(()=>plain(build({reports:[{...report,id:'rack'}]})),/continuity_v5_id_collision/);
   for(const id of [prefix+'change_0_0','__cmcp_v4_retention_0'])assert.throws(()=>plain(build({plans:[{...plan,id}]})),/continuity_v5_id_collision/);
   for(const patch of [{text:'工程自填答案'},{planRole:'evidence'},{enabled:true}])assert.throws(()=>plain(build({plans:[{...plan,...patch}]})),/continuity_v5_shape/);
  });
  await check('原句片段不存在或重疊仍拒絕，保留原空白與 Unicode',()=>{
   assert.throws(()=>plain(build({plans:[{...plan,orderedChanges:[{...change,edits:[{kind:'withdraw',quote:'不存在'}]}]}]})),/continuity_v4_edit_quote_absent/);
   assert.throws(()=>plain(build({plans:[{...plan,orderedChanges:[{...change,edits:[{kind:'withdraw',quote:'四十公分'},{kind:'withdraw',quote:'十公分'}]}]}]})),/continuity_v4_edit_overlap/);
   assert.throws(()=>plain(build({plans:[{...plan,quote:'兩組、兩組',orderedChanges:[{...change,edits:[{kind:'withdraw',quote:'兩組'}]}]}]})),/continuity_v4_edit_quote_not_unique/);
  });
  await check('來源／scope／正式閱讀與模型材料不因型別編譯而省略',()=>{
   assert.throws(()=>project({...input(build()),scopeId:'other'}),/invalid_reading_manifest/);
   assert.throws(()=>project({...input(build()),previousPages:pages.slice(0,-1)}),/continuity_complete_selected_reading_required/);
   const tampered=copy(pages);tampered[0].modelContext=null;assert.throws(()=>project({...input(build()),previousPages:tampered}),/reading_page_chain_mismatch/);
  });
  await check('節點／保留／理由／改動總量及編譯後 bytes 不得繞過原上限',()=>{
   const q=build({plans:[{...plan,retentions:[retention],reasonWithdrawals:[withdrawals[0]]}]});
   assert.throws(()=>plain(q,{...limits,maxNodes:2}),/continuity_proposal_limit/);
   assert.throws(()=>plain(build({plans:[{...plan,retentions:Array(5).fill(retention)},{...plan,id:'other',retentions:Array(4).fill(retention)}]})),/continuity_proposal_limit/);
   assert.throws(()=>plain(build({plans:[{...plan,reasonWithdrawals:Array(7).fill(withdrawals[0])},{...plan,id:'other',reasonWithdrawals:Array(6).fill(withdrawals[0])}]})),/continuity_proposal_limit/);
   assert.throws(()=>plain(build({plans:[{...plan,orderedChanges:Array(13).fill(pause)},{...plan,id:'other',orderedChanges:Array(12).fill(pause)}]})),/continuity_proposal_limit/);
   const length=bytes(q);assert(bytes(plain(q).proposal)>length);assert.throws(()=>plain(q,{...limits,maxProposalBytes:length}),/continuity_proposal_limit/);
   for(const unknowns of [Array(17).fill('未定'),['字'.repeat(257)],[' '],[{text:'未知'}]])assert.throws(()=>plain(build({unknowns})),/continuity_v5_(limit|value)/);
   for(const patch of [{plans:null},{reports:null},{unknowns:null}])assert.throws(()=>plain(build(patch)),/continuity_v5_limit/);
  });
  await check('保留 v1 至 v4 正常入口，不將舊投影改標為 v5',()=>{
   const old={id:plan.id,ref:plan.ref,quote:plan.quote,kind:'user_intent',temporalUse:'current',topic:plan.topic,aspect:plan.aspect};
   const v4={version:4,nodes:[old],unknowns:[]},v3=legacy(v4,{limits}).proposal;
   assert.deepEqual(plain(build({plans:[{...plan,reason:undefined}]})).proposal,v3);
   for(const version of [1,2,3]){const value=calc({...v3,version,nodes:v3.nodes.map(({planRole,...node})=>node)});assert.equal(value.projection.version,version);assert.equal(value.inputVersion,undefined);}
   assert.equal(calc(v4).inputVersion,4);
  });
  await check('正式 Runtime 發布保留來源與時間；唯讀不更新 Buffer 或授權',async()=>{
   const before=await runtime.bufferList(),q=build({plans:[{...plan,orderedChanges:[change,pause],retentions:[retention]}]});
   const result=await runtime.readingContinuity({ticket:opening.reader.ticket,proposal:q});assert.equal(result.status,'ready');assert.equal(result.inputVersion,5);
   const view=await runtime.continuityStatus();assert.equal(view.status,'ready');assert.equal(view.projection.currentPlans[0].planStatus,'paused');
   assert.deepEqual((await runtime.bufferList()).items,before.items);assert.equal(view.projection.activation,'none');assert.equal(view.projection.proactiveEligible,false);
   assert.deepEqual(result.projection.sources.map(row=>row.messageRecordedAt),view.projection.sources.map(row=>row.messageRecordedAt));
   await fs.writeFile(path.join(out,'runtime-publication.json'),JSON.stringify({result,view},null,2)+'\n',{flag:'wx'});
  });
 }finally{
  await runtime.close();
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({kind:'cmcp_continuity_v5_zero_model_results',productRoot,modelCalls:0,semanticVerification:'not_performed',runtimeClosed:true,outcomes},null,2)+'\n',{flag:'wx'});
 }
});
