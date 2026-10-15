import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const {createCmcpRuntimeSession}=await import(pathToFileURL(path.join(productRoot,'src/cmcp-guard/cmcp-runtime-session.js')).href);
const {projectCmcpReadingContinuity:project,getCmcpContinuityCorrection}=await import(pathToFileURL(path.join(productRoot,'src/cmcp-guard/cmcp-continuity-projection.js')).href);

// 零模型正式來源反例。以下驗表示、來源及守護，不把結構接受當成自然語意認證。
test('變更理由有自己的責任；具名撤回不改綁原方案',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-change-reason');await fs.mkdir(base,{recursive:true});
 const out=await fs.mkdtemp(path.join(base,'formal-')),now='2026-10-08T06:00:00.000Z',timezone='Asia/Taipei',scopeId='synthetic-change-reason';
 const texts=[
  '我打算整理社團器材，先用紙本清單記錄，每週核對一次。採紙本是為了方便現場勾記。',
  '我建議每件貼色標，這只是尚未採用的建議。',
  '清單改用可離線編輯的表格，因為多人整理時要避免重抄；其他條件維持。',
  '核對頻率改成每月一次，這次以減少行政工時為優先；接受資料更新慢一些的取捨。',
  '器材盤點先暫停，等庫房重新開放後再談。',
  '我明確撤回避免重抄這個理由，最近已改成只有我登錄；減少行政工時的考量維持。',
  '我回報球具已清點完成，音響還沒點完。',
  '另一件事是義賣包裝：改用紙袋，因為便於回收。',
  '我撤回避免重抄的理由。',
  '原先現場勾記的理由不再適用，現在都在辦公室處理。'
 ];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-change-reason',providerMode:'host',
  input:{root:path.join(out,'state'),scopeId,events:[],timezone,
   limits:{maxEntries:12,maxCatalogBytes:14000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:14000},storageCapacity:{maxSources:64,maxSourceBytes:8192},
   loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),
  sourceAuthorization:{saveUser:true,saveAssistant:true},controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-change-reason-session',hostProvider:{request:async()=>{throw Error('本測試禁止模型呼叫');}}});
 try{
  for(const [i,text]of texts.entries())await runtime.ingest({role:[1,8].includes(i)?'assistant':'user',text,timeContext:{now:new Date(Date.parse(now)-900000+i*60000).toISOString(),timezone}});
  const nav=await runtime.readingNavigate({text:'核對器材盤點的方案、變更理由、部分完成與暫停。'});
  const opening=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:16384}});
  const pages=[];for(let i=0;i<64;i++){const p=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(p);if(p.reader.coverage.complete)break;}
  assert.equal(pages.at(-1).reader.coverage.complete,true);
  const refs=texts.map(text=>{const p=pages.find(page=>page.reader.text===text);assert(p);return p.reader.source.ref;});
  const node=(id,i,quote,extra={})=>({id,ref:refs[i],quote,kind:'user_intent',temporalUse:'current',topic:'器材盤點',aspect:id,
   relation:{kind:'independent',targetNodeIds:[]},...extra});
  const format=node('format',0,'先用紙本清單記錄');
  const frequency=node('frequency',0,'每週核對一次');
  const reported=node('reported',6,texts[6],{kind:'user_report',text:texts[6]});
  const change={id:'format-change',targetNodeId:'format',afterChangeId:null,kind:'content',ref:refs[2],quote:texts[2],
   parts:[{kind:'replace',quote:'先用紙本清單記錄',replacement:{ref:refs[2],quote:'改用可離線編輯的表格'}}],
   reason:{kind:'adds',ref:refs[2],quote:'因為多人整理時要避免重抄'}};
  const frequencyChange={id:'frequency-change',targetNodeId:'frequency',afterChangeId:null,kind:'content',ref:refs[3],quote:texts[3],
   parts:[{kind:'replace',quote:'每週核對一次',replacement:{ref:refs[3],quote:'每月一次'}}],
   reason:{kind:'prioritizes',ref:refs[3],quote:'這次以減少行政工時為優先'}};
  const pause={id:'pause',targetNodeId:'format',afterChangeId:'format-change',kind:'status',ref:refs[4],quote:texts[4],planStatus:'paused'};
  const withdrawal=node('withdrawal',5,texts[5],{temporalUse:'unspecified',planRole:'evidence',relation:{kind:'related',targetNodeIds:['format']}});
  const relation={kind:'withdraws',fromNodeId:'withdrawal',targetChangeIds:['format-change'],ref:refs[5],quote:'我明確撤回避免重抄這個理由'};
  const input=proposal=>({reading:opening,previousPages:pages,scopeId,proposal,timeContext:{now,timezone}});
  const calc=(extra={})=>project(input({version:3,nodes:[structuredClone(format),structuredClone(frequency),structuredClone(reported)],unknowns:[],
   planChanges:[structuredClone(change),structuredClone(frequencyChange)],...extra}));
  const originalReason={ref:refs[0],quote:'採紙本是為了方便現場勾記。'};
  const getError=fn=>{let error;try{fn();}catch(e){error=e;}assert(error);return error;};
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify({clock:'明示合成時鐘',opening,pages,format,frequency,reported,change,frequencyChange,pause,withdrawal,relation},null,2)+'\n',{flag:'wx'});

  await t.test('新增理由直接綁定變更，不要求沒有原理由的基底先補理由',()=>{
   const r=calc(),p=r.projection,reason=p.planChanges.find(x=>x.id==='format-change').reason;
   assert.equal(r.status,'ready');assert.deepEqual(p.reasons,[]);
   assert.equal(reason.kind,'adds');assert.equal(reason.standing,'not_explicitly_withdrawn');
   assert.equal(reason.citation.text,'因為多人整理時要避免重抄');assert.equal(reason.binding.kind,'plan_change');
   assert.equal(reason.binding.changeId,'format-change');assert.notEqual(reason.binding.planVersion,reason.binding.priorVersion);
   assert.equal(p.planBasis.find(x=>x.nodeId==='format').reasonStatus,'not_provided');
  });
  await t.test('優先與接受取捨保留各自種類，沒有原理由仍可表示',()=>{
   for(const [kind,quote]of [['prioritizes','這次以減少行政工時為優先'],['accepts_tradeoff','接受資料更新慢一些的取捨']]){
    const p=calc({planChanges:[change,{...frequencyChange,reason:{kind,ref:refs[3],quote}}]}).projection;
    const reason=p.planChanges.find(x=>x.id==='frequency-change').reason;
    assert.equal(reason.kind,kind);assert.equal(reason.citation.text,quote);assert.deepEqual(p.reasons,[]);
   }
   for(const kind of ['withdraws','current',null])assert.throws(()=>calc({planChanges:[{...change,reason:{...change.reason,kind}}]}),/continuity_plan_change_reason_kind/);
  });
  await t.test('暫停不自動撤回理由，後續變更不自動繼承前個理由',()=>{
   const before=calc().projection,after=calc({planChanges:[change,frequencyChange,pause]}).projection;
   assert.deepEqual(after.planChanges.find(x=>x.id==='format-change').reason,before.planChanges.find(x=>x.id==='format-change').reason);
   assert.equal(after.planChanges.find(x=>x.id==='pause').reason,null);
   assert.equal(after.currentPlans.find(x=>x.nodeId==='format').planStatus,'paused');
   assert.deepEqual(after.reasonRelations,[]);assert.equal(after.planChanges.find(x=>x.id==='format-change').reason.standing,'not_explicitly_withdrawn');
  });
  await t.test('撤回具名變更理由，不撤原基底理由、其他新理由或條件',()=>{
   const old={...format,reason:originalReason};
   const before=calc({nodes:[old,frequency,reported]}).projection;
   const after=calc({nodes:[old,frequency,reported,withdrawal],reasonRelations:[relation]}).projection;
   assert.deepEqual(after.reasons,before.reasons);assert.equal(after.reasons[0].standing,'not_explicitly_withdrawn');
   assert.equal(after.planChanges.find(x=>x.id==='format-change').reason.standing,'withdrawn_by_explicit_user_source');
   assert.equal(after.planChanges.find(x=>x.id==='frequency-change').reason.standing,'not_explicitly_withdrawn');
   assert.deepEqual(after.currentPlans,before.currentPlans);assert.deepEqual(after.currentClaims,before.currentClaims);
   assert.equal(after.planEvidence.length,1);assert.equal(after.planEvidence[0].nodeId,'withdrawal');
   assert(after.planEvidence[0].uses.some(x=>x.kind==='reason_relation'&&x.targetNodeId==='format'));
   assert(!after.currentPlans.some(x=>x.nodeId==='withdrawal'));
  });
  await t.test('既有未帶kind的變更理由仍可被具名撤回',()=>{
   const legacy=structuredClone(change);delete legacy.reason.kind;
   const before=calc({planChanges:[legacy]}).projection;
   assert.equal(before.planChanges[0].reason.kind,undefined);
   const after=calc({nodes:[format,frequency,reported,withdrawal],planChanges:[legacy],reasonRelations:[relation]}).projection;
   assert.equal(after.planChanges[0].reason.standing,'withdrawn_by_explicit_user_source');
   assert.equal(after.planChanges[0].reason.binding.changeId,'format-change');
  });
  await t.test('混合節點與變更目標、非withdraws及重複目標拒絕',()=>{
   const base={nodes:[format,frequency,reported,withdrawal]};
   assert.throws(()=>calc({...base,reasonRelations:[{...relation,targetNodeIds:['format']}]}),/invalid_continuity_proposal_shape/);
   for(const kind of ['adds','prioritizes','accepts_tradeoff','unresolved'])assert.throws(()=>calc({...base,reasonRelations:[{...relation,kind}]}),/continuity_change_reason_relation_invalid/);
   assert.throws(()=>calc({...base,reasonRelations:[{...relation,targetChangeIds:['format-change','format-change']}]}),/continuity_scoped_targets_invalid/);
  });
  await t.test('Assistant原句不能偽裝User撤回，錯主題或錯來源均拒絕',()=>{
   const assistant=node('withdrawal',8,texts[8],{kind:'assistant_suggestion',text:texts[8],temporalUse:'unspecified'});
   assert.throws(()=>calc({nodes:[format,frequency,reported,assistant],reasonRelations:[{...relation,ref:refs[8],quote:texts[8]}]}),/continuity_scoped_actor_invalid/);
   const spoof={...withdrawal,ref:refs[8],quote:texts[8]};
   assert.throws(()=>calc({nodes:[format,frequency,reported,spoof],reasonRelations:[{...relation,ref:refs[8],quote:texts[8]}]}),/continuity_(source_role|role|user|scoped_user|interpretation)/);
   const other={...withdrawal,topic:'義賣包裝',planRole:undefined,relation:{kind:'independent',targetNodeIds:[]}};delete other.planRole;
   assert.throws(()=>calc({nodes:[format,frequency,reported,other],reasonRelations:[relation]}),/continuity_scoped_target_mismatch/);
   assert.throws(()=>calc({nodes:[format,frequency,reported,withdrawal],reasonRelations:[{...relation,ref:refs[9],quote:texts[9]}]}),/continuity_scoped_user_source_required/);
  });
  await t.test('不存在變更或缺理由不能用後來引文補成已有理由',()=>{
   assert.throws(()=>calc({nodes:[format,frequency,reported,withdrawal],reasonRelations:[{...relation,targetChangeIds:['absent']}]}),/continuity_scoped_target_mismatch/);
   const noReason=structuredClone(change);delete noReason.reason;
   const error=getError(()=>calc({nodes:[format,frequency,reported,withdrawal],planChanges:[noReason],reasonRelations:[relation]}));
   assert.equal(error.message,'continuity_reason_target_missing');
   const issue=getCmcpContinuityCorrection(error).issues[0];
   assert.equal(issue.targetChangeId,'format-change');assert.equal(issue.reason,'target_change_reason_missing');
  });
  await t.test('撤回引文仍須落在證據節點精確範圍，不借同則其他句',()=>{
   const narrow={...withdrawal,quote:'最近已改成只有我登錄'};
   assert.throws(()=>calc({nodes:[format,frequency,reported,narrow],reasonRelations:[relation]}),/continuity_plan_evidence_quote_mismatch/);
   assert.throws(()=>calc({nodes:[format,frequency,reported,withdrawal],reasonRelations:[{...relation,quote:'自由杜撰的撤回理由'}]}),/continuity_quote_absent/);
  });
  await t.test('合法用途不掩蓋同證據另外一個越界變更理由關係',()=>{
   const bounded={...withdrawal,quote:'我明確撤回避免重抄這個理由',relation:{kind:'related',targetNodeIds:['format','frequency']}};
   const another={...relation,targetChangeIds:['frequency-change'],quote:'減少行政工時的考量維持。'};
   assert.throws(()=>calc({nodes:[format,frequency,reported,bounded],reasonRelations:[relation,another]}),/continuity_plan_evidence_quote_mismatch/);
  });
  await t.test('變更理由仍限同則正式User來源，不能借Assistant或另一輪理由',()=>{
   for(const i of [0,1,3,8])assert.throws(()=>calc({planChanges:[{...change,reason:{kind:'adds',ref:refs[i],quote:texts[i]}}]}),/continuity_plan_change_reason_source_mismatch/);
   assert.throws(()=>calc({planChanges:[{...change,reason:{...change.reason,quote:'自行創造的理由'}}]}),/continuity_quote_absent/);
  });
  await t.test('證據關聯明指變更所屬基底，不能藉合法引文作用於未列出的基底',()=>{
   assert.throws(()=>calc({nodes:[format,frequency,reported,withdrawal],reasonRelations:[{...relation,targetChangeIds:['frequency-change']}]}),/continuity_plan_evidence_change_target_mismatch/);
  });
  await t.test('只有新增理由時不偽造條件或狀態修改，版本與原文片段保持',()=>{
   const reasonOnly={id:'new-priority',targetNodeId:'format',afterChangeId:'format-change',kind:'reason',ref:refs[3],quote:texts[3],
    reason:{kind:'prioritizes',ref:refs[3],quote:'這次以減少行政工時為優先'}};
   const before=calc({planChanges:[change]}).projection,after=calc({planChanges:[change,reasonOnly]}).projection;
   const first=after.planChanges.find(x=>x.id==='format-change'),addition=after.planChanges.find(x=>x.id==='new-priority');
   assert.equal(addition.effect,'reason_only_conditions_and_status_preserved');
   assert.equal(addition.priorVersion,first.planVersion);assert.equal(addition.planVersion,first.planVersion);
   assert.equal(after.currentPlans[0].text,before.currentPlans[0].text);
   assert.equal(after.currentPlans[0].planStatus,before.currentPlans[0].planStatus);
   assert.deepEqual(after.currentPlans[0].sourceFragments,before.currentPlans[0].sourceFragments);
   assert.equal(after.currentPlans[0].statusSource,null);
   const paused=calc({planChanges:[change,reasonOnly,{...pause,afterChangeId:'new-priority'}]}).projection;
   assert.equal(paused.planChanges.find(x=>x.id==='new-priority').reason.standing,'not_explicitly_withdrawn');
   assert.equal(paused.planChanges.find(x=>x.id==='pause').reason,null);
   const invalid={...reasonOnly};delete invalid.reason;
   assert.throws(()=>calc({planChanges:[change,invalid]}),/continuity_plan_change_reason_required/);
  });
  await t.test('查看不改回報、來源原時間、Buffer期限、控制與派送資格',async()=>{
   const before=await runtime.bufferList(),pagesBefore=structuredClone(pages),openingBefore=structuredClone(opening);
   const plain=calc().projection;
   const p=calc({nodes:[format,frequency,reported,withdrawal],reasonRelations:[relation]}).projection;
   assert.deepEqual(p.currentClaims,plain.currentClaims);assert.equal(p.currentClaims[0].text,texts[6]);
   assert.equal(p.validation.executionAuthority,'none');assert.equal(p.activation,'none');assert.equal(p.proactiveEligible,false);
   assert.deepEqual(pages,pagesBefore);assert.deepEqual(opening,openingBefore);assert.deepEqual((await runtime.bufferList()).items,before.items);
   assert.equal(p.planChanges[0].reason.messageRecordedAt,pages.find(x=>x.reader.source?.ref===refs[2]).reader.source.messageRecordedAt);
  });
  await t.test('v1/v2既有輸出不添新欄位，v3原基底撤回保持原責任',()=>{
   const old={...format,reason:originalReason};
   for(const version of [1,2]){
    const p=project(input({version,nodes:[{...old,text:old.quote}],unknowns:[]})).projection;
    assert.equal(p.planChanges,undefined);assert.equal(p.reasons[0].binding,undefined);assert.equal(p.reasons[0].citation.text,originalReason.quote);
   }
   const actor=node('old-withdraw',9,texts[9],{temporalUse:'unspecified',planRole:'evidence',relation:{kind:'related',targetNodeIds:['format']}});
   const p=calc({nodes:[old,frequency,reported,actor],reasonRelations:[{kind:'withdraws',fromNodeId:'old-withdraw',targetNodeIds:['format'],ref:refs[9],quote:texts[9]}]}).projection;
   assert.equal(p.reasons[0].standing,'withdrawn_by_explicit_user_source');
   assert.equal(p.planChanges[0].reason.standing,'not_explicitly_withdrawn');
  });
  const final=calc({nodes:[{...format,reason:originalReason},frequency,reported,withdrawal],planChanges:[change,frequencyChange,pause],reasonRelations:[relation]});
  await fs.writeFile(path.join(out,'final-projection.json'),JSON.stringify(final,null,2)+'\n',{flag:'wx'});
 }finally{await runtime.close();}
});
