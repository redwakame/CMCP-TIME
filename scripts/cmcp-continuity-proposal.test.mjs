import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=relative=>import(pathToFileURL(path.join(productRoot,relative)).href);
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,CMCP_CONTINUITY_PROJECTION_LIMITS:limits}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {compileCmcpContinuityProposal:compile,CMCP_CONTINUITY_COMPILER_PREFIX:prefix}=await load('src/cmcp-guard/cmcp-continuity-proposal.js');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');
const clone=value=>structuredClone(value),bytes=value=>Buffer.byteLength(JSON.stringify(value));

// 只使用正式介面建立合成來源。所有輸出保留；此測試不驗模型語意。
test('v4 薄編譯仍由完整 v3 正式閱讀契約裁決',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-proposal');await fs.mkdir(base,{recursive:true});
 const out=await fs.mkdtemp(path.join(base,'formal-')),now='2026-10-08T02:00:00.000Z',zone='Asia/Taipei',scope='synthetic-v4-compiler';
 const bodies=[
  '我規劃製作展示架。🪟 寬四十公分，深藍，只在室內使用。  \n原因是通道狹窄。另案標籤也先規劃。',
  '我建議增加輪子；這只是 Assistant 提案。',
  '寬度改為六十公分，其他條件維持。新增考量是搬運方便，原先通道狹窄的顧慮沒有撤回。',
  '展示架先暫停，標籤維持規劃。',
  '撤回通道狹窄這個理由；條件沒有因此自動改變。',
  '展示架尚未動工，標籤已完成。',
  '更正先前回報，標籤也尚未完成。',
  '我規劃兩組、兩組。',
  '取消深藍限制，其他條件維持。',
  '六十公分再改為七十公分，其餘維持。'
 ];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-v4',providerMode:'host',
  input:{root:path.join(out,'state'),scopeId:scope,events:[],timezone:zone,
   limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:64,maxSourceBytes:8192},
   loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-v4-session',hostProvider:{request:async()=>{throw Error('禁止模型');}}});
 try{
  for(const [index,body]of bodies.entries())await runtime.ingest({role:index===1?'assistant':'user',text:body,
   timeContext:{now:new Date(Date.parse(now)-1200000+index*60000).toISOString(),timezone:zone}});
  const nav=await runtime.readingNavigate({text:'請核對展示架及標籤的原案、修訂、理由與目前狀態。'});
  const opening=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:32768}});
  const pages=[];for(let index=0;index<64;index++){const page=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  const refs=bodies.map(body=>pages.find(page=>page.reader.text===body).reader.source.ref);
  const basis='🪟 寬四十公分，深藍，只在室內使用。  \n',reason={ref:refs[0],quote:'原因是通道狹窄。'};
  const node=(id,ref,quote,extra={})=>({id,ref,quote,kind:'user_intent',temporalUse:'current',topic:'展示用品',aspect:id,...extra});
  const proposal={version:4,nodes:[node('rack',refs[0],basis,{reason}),node('labels',refs[0],'另案標籤也先規劃。')],unknowns:[]};
  const width={id:'width',targetNodeId:'rack',afterChangeId:null,kind:'content',ref:refs[2],quote:'寬度改為六十公分，其他條件維持。',
   edits:[{quote:'寬四十公分',kind:'replace',replacement:{ref:refs[2],quote:'六十公分'}}]};
  const pause={id:'pause',targetNodeId:'rack',afterChangeId:'width',kind:'status',ref:refs[3],quote:'展示架先暫停',planStatus:'paused'};
  const retention={targetNodeIds:['rack'],evidence:{kind:'user_intent',ref:refs[2],quote:'寬度改為六十公分，其他條件維持。',temporalUse:'current',aspect:'修訂範圍'}};
  const addReason={kind:'adds',targetNodeIds:['rack'],evidence:{kind:'user_intent',ref:refs[2],quote:'新增考量是搬運方便，原先通道狹窄的顧慮沒有撤回。',temporalUse:'current',aspect:'理由關係',reason:{ref:refs[2],quote:'搬運方便'}}};
  const input=q=>({reading:opening,previousPages:pages,scopeId:scope,proposal:q,timeContext:{now,timezone:zone}});
  const calc=q=>project(input(q)),build=(extra={})=>({...clone(proposal),...extra});
  const plain=q=>compile(q,{limits});
  const fixture={opening,pages,proposal,refs,bodies};await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify(fixture,null,2)+'\n',{flag:'wx'});
  const outcomes=[];
  async function check(name,fn){await t.test(name,async()=>{try{await fn();outcomes.push({name,status:'PASS'});}catch(error){outcomes.push({name,status:'FAIL',error:error.message});throw error;}});}

  await check('v4 與明寫 v3 完整投影相等，外層保留輸入／編譯雜湊',async()=>{
   const v4=build({planChanges:[width,pause],retentions:[retention],reasonRelations:[addReason]});
   const explicit={version:3,nodes:[
    {...proposal.nodes[0],text:basis,relation:{kind:'independent',targetNodeIds:[]},planRole:'basis'},
    {...proposal.nodes[1],text:proposal.nodes[1].quote,relation:{kind:'independent',targetNodeIds:[]},planRole:'basis'},
    {id:prefix+'retention_0',ref:refs[2],quote:retention.evidence.quote,kind:'user_intent',temporalUse:'current',text:retention.evidence.quote,topic:'展示用品',aspect:'修訂範圍',relation:{kind:'related',targetNodeIds:['rack']},planRole:'evidence'},
    {id:prefix+'reason_0',ref:refs[2],quote:addReason.evidence.quote,kind:'user_intent',temporalUse:'current',text:addReason.evidence.quote,topic:'展示用品',aspect:'理由關係',relation:{kind:'related',targetNodeIds:['rack']},reason:addReason.evidence.reason,planRole:'evidence'}],unknowns:[],
    planChanges:[{id:'width',targetNodeId:'rack',afterChangeId:null,kind:'content',ref:refs[2],quote:width.quote,
     parts:[{kind:'keep',quote:'🪟 '},{quote:'寬四十公分',kind:'replace',replacement:{ref:refs[2],quote:'六十公分'}},{kind:'keep',quote:'，深藍，只在室內使用。  \n'}]},pause],
    retentions:[{ref:refs[2],quote:retention.evidence.quote,targetNodeIds:['rack'],byNodeId:prefix+'retention_0'}],
    reasonRelations:[{ref:refs[2],quote:addReason.evidence.quote,targetNodeIds:['rack'],kind:'adds',fromNodeId:prefix+'reason_0'}]};
   const before=clone(v4),compiled=plain(v4),actual=calc(v4),expected=calc(explicit),{compilation,inputVersion,...body}=actual;
   assert.deepEqual(compiled.proposal,explicit);assert.deepEqual(body,expected);assert.deepEqual(v4,before);
   assert.equal(inputVersion,4);assert.equal(compilation.version,1);assert.equal(compilation.inputHash,loopHash(v4));assert.equal(compilation.compiledProposalHash,loopHash(explicit));
   assert.equal(actual.projection.version,3);assert.equal(actual.projection.currentPlans.find(p=>p.nodeId==='rack').text,'🪟 六十公分，深藍，只在室內使用。  \n');
   assert.equal(actual.projection.currentPlans.find(p=>p.nodeId==='rack').planStatus,'paused');assert.equal(actual.projection.planEvidence.length,2);
   assert.equal(actual.projection.currentClaims.length,0);assert.equal(actual.projection.reasons.find(r=>r.nodeId==='rack').standing,'not_explicitly_withdrawn');
   assert.equal(actual.projection.semanticVerification,'not_performed');assert.equal(actual.projection.validation.executionAuthority,'none');
   await fs.writeFile(path.join(out,'equivalent-proposals.json'),JSON.stringify({v4,v3:explicit,compiled,bytes:{v4:bytes(v4),v3:bytes(explicit)}},null,2)+'\n',{flag:'wx'});
   await fs.writeFile(path.join(out,'final-projection.json'),JSON.stringify(actual,null,2)+'\n',{flag:'wx'});
  });
  await check('明示 User 回報種類、supersedes 與完成程度不被改成意圖',()=>{
   const q=build({nodes:[...proposal.nodes,node('old',refs[5],'標籤已完成',{kind:'user_report',aspect:'標籤進度'}),
    node('new',refs[6],bodies[6],{kind:'user_report',aspect:'標籤進度',relation:{kind:'supersedes',targetNodeIds:['old']}})]});
   const p=calc(q).projection;assert.equal(p.currentClaims.length,1);assert.equal(p.currentClaims[0].nodeId,'new');assert.equal(p.currentPlans.length,2);
   for(const n of plain(q).proposal.nodes.filter(n=>n.kind==='user_report'))assert.equal(Object.hasOwn(n,'planRole'),false);
  });
  await check('回報不能因 retention 編譯而轉成計畫',()=>{
   assert.throws(()=>calc(build({retentions:[{...retention,evidence:{...retention.evidence,kind:'user_report'}}]})),/continuity_retention_requires_plan/);
   const q=build({nodes:[node('report',refs[6],bodies[6],{kind:'user_report'})],retentions:[{...retention,targetNodeIds:['report']}]});
   assert.throws(()=>calc(q),/continuity_retention_requires_plan/);
  });
  await check('理由證據明示 report 時不附 planRole、不自動增加計畫',()=>{
   const q=build({reasonRelations:[{...addReason,evidence:{...addReason.evidence,kind:'user_report'}}]});
   const compiled=plain(q).proposal,p=calc(q).projection,n=compiled.nodes.at(-1);
   assert.equal(n.kind,'user_report');assert.equal(Object.hasOwn(n,'planRole'),false);assert.equal(p.currentPlans.length,2);
   assert.equal(p.reasons.find(r=>r.nodeId===n.id).binding.kind,'source_node');
  });
  await check('明示撤回只改指定理由站位，不撤計畫或條件',()=>{
   const q=build({reasonRelations:[{kind:'withdraws',targetNodeIds:['rack'],evidence:{kind:'user_intent',ref:refs[4],quote:bodies[4],temporalUse:'current',aspect:'理由撤回'}}]});
   const p=calc(q).projection;assert.equal(p.reasons[0].standing,'withdrawn_by_explicit_user_source');assert.equal(p.currentPlans[0].text,basis);assert.equal(p.currentPlans[0].planStatus,'planned');
  });
  await check('唯一局部撤回保留其他空白、Unicode 與條件，不做語言潤飾',()=>{
   const q=build({planChanges:[{id:'colour',targetNodeId:'rack',afterChangeId:null,kind:'content',ref:refs[8],quote:bodies[8],edits:[{quote:'深藍',kind:'withdraw'}]}]});
   const p=calc(q).projection;assert.equal(p.currentPlans[0].text,'🪟 寬四十公分，，只在室內使用。  \n');assert.equal(p.currentPlans[0].sourceFragments[0].ref,refs[0]);
  });
  await check('明示修改鏈採前一版本而非舊基底，輸入順序不選 winner',()=>{
   const next={id:'next-width',targetNodeId:'rack',afterChangeId:'width',kind:'content',ref:refs[9],quote:bodies[9],edits:[{quote:'六十公分',kind:'replace',replacement:{ref:refs[9],quote:'七十公分'}}]};
   const forward=calc(build({planChanges:[width,next]})),reverse=calc(build({planChanges:[next,width]}));
   assert.deepEqual(forward.projection.currentPlans,reverse.projection.currentPlans);assert.equal(forward.projection.currentPlans[0].text,'🪟 七十公分，深藍，只在室內使用。  \n');
   const branches=calc(build({planChanges:[width,{...pause,afterChangeId:null}]}));assert(!branches.projection.currentPlans.some(p=>p.nodeId==='rack'));assert.equal(branches.projection.unresolvedPlans.length,1);
  });
  await check('重複片段、缺片段、重疊與無效前驅拒絕，不猜哪一處',()=>{
   const duplicate=build({nodes:[node('rack',refs[7],bodies[7])],planChanges:[{...width,edits:[{quote:'兩組',kind:'withdraw'}]}]});
   assert.throws(()=>plain(duplicate),/continuity_v4_edit_quote_not_unique/);
   assert.throws(()=>plain(build({planChanges:[{...width,edits:[{quote:'不存在',kind:'withdraw'}]}]})),/continuity_v4_edit_quote_absent/);
   assert.throws(()=>plain(build({planChanges:[{...width,edits:[{quote:'寬四十公分',kind:'withdraw'},{quote:'四十公分',kind:'withdraw'}]}]})),/continuity_v4_edit_overlap/);
   assert.throws(()=>plain(build({planChanges:[{...width,afterChangeId:'missing'}]})),/continuity_plan_change_predecessor_target/);
   assert.throws(()=>plain(build({planChanges:[{...width,afterChangeId:'width'}]})),/continuity_plan_change_cycle/);
   assert.throws(()=>plain(build({planChanges:[width,{...pause,targetNodeId:'labels'}]})),/continuity_plan_change_predecessor_target/);
  });
  await check('不接受模型注入編譯器 ID 或把證據另升格成 basis',()=>{
   assert.throws(()=>plain(build({nodes:[{...proposal.nodes[0],id:prefix+'retention_0'}]})),/continuity_v4_id_collision/);
   assert.throws(()=>plain(build({planChanges:[{...width,id:'rack'}]})),/continuity_v4_id_collision/);
   assert.throws(()=>plain(build({nodes:[{...proposal.nodes[0],planRole:'evidence'}]})),/continuity_v4_basis_role_required/);
   assert.throws(()=>plain(build({nodes:[{...proposal.nodes[0],kind:'user_report',planStatus:'planned'}]})),/continuity_v4_non_intent_plan_status/);
  });
  await check('目標必須明示同主題正式節點，不能按名稱或相鄰來源推測',()=>{
   assert.throws(()=>plain(build({retentions:[{...retention,targetNodeIds:['missing']}]})),/continuity_v4_target_topic/);
   const q=build({nodes:[...proposal.nodes,node('unrelated',refs[0],'另案標籤也先規劃。',{topic:'另一主題'})],retentions:[{...retention,targetNodeIds:['rack','unrelated']}]});
   assert.throws(()=>plain(q),/continuity_v4_target_topic/);
  });
  await check('只有省略才採預設，明示 null 不得靜默改成獨立或原句',()=>{
   for(const patch of [{relation:null},{text:null}])assert.throws(()=>calc(build({nodes:[{...proposal.nodes[0],...patch}]})));
   for(const key of ['planChanges','retentions','reasonRelations'])assert.throws(()=>plain(build({[key]:null})),/continuity_v4_limit/);
  });
  await check('前後雙重限額：inline evidence 不得繞過節點與 bytes 限額',()=>{
   const q=build({retentions:[retention]});assert.equal(q.nodes.length,2);assert.throws(()=>compile(q,{limits:{...limits,maxNodes:2}}),/continuity_proposal_limit/);
   const length=bytes(q);assert(bytes(plain(q).proposal)>length);assert.throws(()=>compile(q,{limits:{...limits,maxProposalBytes:length}}),/continuity_proposal_limit/);
   assert.throws(()=>compile(q,{limits:{...limits,maxProposalBytes:length-1}}),/continuity_proposal_limit/);
   const many=build({planChanges:Array.from({length:25},(_,index)=>({...width,id:'c'+index}))});assert.throws(()=>plain(many),/continuity_v4_limit/);
  });
  await check('補齊 keep 後的 parts 數仍受限制，空修改不能隱藏完整範圍',()=>{
   assert.throws(()=>compile(build({planChanges:[width]}),{limits:{...limits,maxPlanParts:2}}),/continuity_plan_change_parts/);
   assert.throws(()=>plain(build({planChanges:[{...width,edits:[]}]})),/continuity_v4_empty_edit/);
  });
  await check('所有編譯後引用仍核 User/Assistant、同次修改範圍及原句',()=>{
   assert.throws(()=>calc(build({nodes:[node('rack',refs[1],bodies[1])]})),/continuity_source_role_mismatch/);
   const wrong=clone(width);wrong.edits[0].replacement={ref:refs[9],quote:'七十公分'};assert.throws(()=>calc(build({planChanges:[wrong]})),/continuity_plan_replacement_source_mismatch/);
   assert.throws(()=>calc(build({nodes:[node('rack',refs[0],'原文中不存在的條件')]})),/continuity_quote_absent/);
   assert.throws(()=>calc(build({reasonRelations:[{...addReason,evidence:{...addReason.evidence,ref:refs[1],quote:bodies[1]}}]})),/continuity_source_role_mismatch/);
  });
  await check('完整正式頁、scope 與模型材料要求不被編譯器省略',()=>{
   assert.throws(()=>project({...input(proposal),scopeId:'other'}),/invalid_reading_manifest/);
   assert.throws(()=>project({...input(proposal),previousPages:pages.slice(0,-1)}),/continuity_complete_selected_reading_required/);
   const tampered=clone(pages);tampered[0].modelContext=null;assert.throws(()=>project({...input(proposal),previousPages:tampered}),/reading_page_chain_mismatch/);
  });
  await check('v1／v2／v3 輸出保持原契約，沒有增加編譯欄位',()=>{
   for(const version of [1,2,3]){
    const n={...proposal.nodes[0],text:basis,relation:{kind:'independent',targetNodeIds:[]}};
    const result=calc({version,nodes:[n],unknowns:[]});assert.equal(result.projection.version,version);assert.equal(result.compilation,undefined);assert.equal(result.inputVersion,undefined);
   }
  });
  await check('正式 runtime 發布與唯讀查閱保留編譯 proof、來源與原時間',async()=>{
   const before=await runtime.bufferList(),result=await runtime.readingContinuity({ticket:opening.reader.ticket,proposal:build({planChanges:[width,pause]})});
   assert.equal(result.status,'ready');assert.equal(result.inputVersion,4);assert.equal(result.compilation.inputVersion,4);
   const published=await Promise.all((await fs.readdir(config.receiptRoot)).filter(name=>name.startsWith('continuity-publication-')).map(async name=>JSON.parse(await fs.readFile(path.join(config.receiptRoot,name),'utf8'))));
   assert(published.some(receipt=>receipt.status==='ready'&&receipt.projectionHash===result.projectionHash));
   assert.deepEqual((await runtime.bufferList()).items,before.items);const view=await runtime.continuityStatus();assert.equal(view.status,'ready');
   assert.equal(view.projection.currentPlans.find(p=>p.nodeId==='rack').planStatus,'paused');
   await fs.writeFile(path.join(out,'runtime-publication.json'),JSON.stringify({result,view},null,2)+'\n',{flag:'wx'});
  });
  await check('OFF／Clean 後不因新 inputVersion 重新取得授權',async()=>{
   await runtime.configureControls({updateId:'v4-clean',patch:{clean:true}});assert.equal((await runtime.continuityStatus()).projection,null);
   await runtime.configureControls({updateId:'v4-clean-off',patch:{clean:false}});assert.equal((await runtime.continuityStatus()).status,'unavailable');
   await runtime.configureControls({updateId:'v4-off',patch:{enabled:false}});assert.equal((await runtime.readingContinuity({ticket:opening.reader.ticket,proposal})).status,'disabled');
  });
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({kind:'cmcp_continuity_v4_zero_model_results',productRoot,modelCalls:0,outcomes},null,2)+'\n',{flag:'wx'});
 }finally{await runtime.close();}
});
