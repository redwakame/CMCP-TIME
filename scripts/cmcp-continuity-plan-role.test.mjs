import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const {createCmcpRuntimeSession}=await import(pathToFileURL(path.join(productRoot,'src/cmcp-guard/cmcp-runtime-session.js')).href);
const {projectCmcpReadingContinuity:project,getCmcpContinuityCorrection}=await import(pathToFileURL(path.join(productRoot,'src/cmcp-guard/cmcp-continuity-projection.js')).href);

// 正式來源與 Core 純投影反例；不呼叫模型、不修改原文，也不把結構通過當語意驗收。
test('v3 明示計畫基底與來源證據分工',async t=>{
 const base=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-plan-role');await fs.mkdir(base,{recursive:true});
 const out=await fs.mkdtemp(path.join(base,'formal-')),scopeId='synthetic-plan-role',timezone='Asia/Taipei',now='2026-10-08T05:00:00.000Z';
 const texts=[
  '我計畫製作木架。木架寬六十公分，只放室內。原因是走道有限。另外我計畫製作收納盒。收納盒的理由是充分利用零料。',
  '我建議加輪子，只是提案，尚未採用。',
  '木架寬改成八十公分，其他條件維持。原因是可用牆面增加。',
  '木架先暫停，等材料到貨再繼續。另案收納盒維持規劃。',
  '現在更在意容納量，原先走道限制仍須保留。',
  '木架只在室內使用這點維持不變。',
  '材料尚未獲准進場。請提出一份配色建議，但不要當作已採用。',
  '我建議淡灰色。尚未採用。',
  '材料仍未獲准進場。配色建議目前沒有決定採用。',
 ];
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:'synthetic-role',providerMode:'host',input:{root:path.join(out,'state'),scopeId,events:[],timezone,
  limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},storageCapacity:{maxSources:64,maxSourceBytes:8192},
  loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},receiptRoot:path.join(out,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},
  controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:'synthetic-role-session',hostProvider:{request:async()=>{throw Error('本測試禁止模型');}}});
 try{
  for(const [i,text]of texts.entries())await runtime.ingest({role:[1,7].includes(i)?'assistant':'user',text,timeContext:{now:new Date(Date.parse(now)-600000+i*60000).toISOString(),timezone}});
  const nav=await runtime.readingNavigate({text:'核對木架及收納盒的計畫。'});
  const reading=await runtime.readingOpen({navigationTicket:nav.host.ticket,mode:'all',selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:16384}});
  const pages=[];for(let i=0;i<64;i++){const page=await runtime.readingPage({ticket:reading.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  const refs=texts.map(text=>pages.find(page=>page.reader.text===text).reader.source.ref);
  const node=(id,i,quote,extra={})=>({id,ref:refs[i],quote,kind:'user_intent',temporalUse:'current',topic:'合成木作',aspect:id,relation:{kind:'independent',targetNodeIds:[]},...extra});
  const basis=node('shelf',0,'我計畫製作木架。木架寬六十公分，只放室內。',{planRole:'basis',reason:{ref:refs[0],quote:'原因是走道有限。'}});
  const evidence=(id,i,quote,extra={})=>node(id,i,quote,{planRole:'evidence',relation:{kind:'related',targetNodeIds:['shelf']},...extra});
  const changed={id:'width',targetNodeId:'shelf',afterChangeId:null,kind:'content',ref:refs[2],quote:texts[2],parts:[
   {kind:'keep',quote:'我計畫製作木架。木架寬'},{kind:'replace',quote:'六十公分',replacement:{ref:refs[2],quote:'八十公分'}},{kind:'keep',quote:'，只放室內。'}]};
  const paused={id:'pause',targetNodeId:'shelf',afterChangeId:'width',kind:'status',ref:refs[3],quote:'木架先暫停，等材料到貨再繼續。',planStatus:'paused'};
  const proposal={version:3,nodes:[basis,evidence('revision',2,texts[2]),evidence('pause-evidence',3,texts[3])],unknowns:[],planChanges:[changed,paused]};
  const input=proposal=>({reading,previousPages:pages,scopeId,timeContext:{now,timezone},proposal});
  const calc=(q=proposal)=>project(input(structuredClone(q)));
  const errorOf=(fn)=>{let error;try{fn();}catch(e){error=e;}assert(error);return error;};
  await fs.writeFile(path.join(out,'formal-fixture.json'),JSON.stringify(input(proposal),null,2)+'\n',{flag:'wx'});
  await t.test('修訂與暫停證據保留，但目前計畫只有一個暫停基底',()=>{
   const p=calc().projection;assert.equal(p.currentPlans.length,1);assert.equal(p.currentPlans[0].planStatus,'paused');assert.match(p.currentPlans[0].text,/八十公分/);
   assert.equal(p.planBasis.length,1);assert.equal(p.planEvidence.length,2);assert.deepEqual(p.currentClaims,[]);
   for(const e of p.planEvidence){assert.equal(e.source.sourceAuthorRole,'user');assert.equal(e.currentStatus,undefined);assert.equal(e.planStatus,undefined);assert.equal(e.uses[0].kind,'plan_change');}
   const e=p.knownEvolution.find(n=>n.nodeId==='pause-evidence');assert.equal(e.planRole,'evidence');assert.equal(e.interpretation.temporalUse,'current');assert.equal(e.interpretation.text,texts[3]);
   assert.equal(e.time.messageRecordedAt,p.planEvidence.find(n=>n.nodeId===e.nodeId).source.messageRecordedAt);
  });
  await t.test('同 aspect 的證據不產生假競爭，兩個真正基底仍拒絕未明示競爭',()=>{
   const q=structuredClone(proposal);q.nodes[1].aspect='shelf';q.nodes[2].aspect='shelf';assert.equal(calc(q).projection.currentPlans.length,1);
   delete q.nodes[1].planRole;assert.throws(()=>calc(q),/continuity_plan_relation_required/);
  });
  await t.test('同 ref 同 topic 的真正獨立計畫不被自動刪去',()=>{
   const q=structuredClone(proposal);q.nodes.push(node('box',0,'另外我計畫製作收納盒。',{planRole:'basis'}));
   const plans=calc(q).projection.currentPlans;assert.equal(plans.length,2);assert.equal(plans.find(n=>n.nodeId==='box').planStatus,'planned');
  });
  await t.test('省略 planRole 保持舊 v3 基底行為，明示角色才分流',()=>{
   const q=structuredClone(proposal);for(const n of q.nodes)delete n.planRole;
   const p=calc(q).projection;assert.equal(p.currentPlans.length,3);assert.equal(p.planEvidence.length,0);assert(p.knownEvolution.every(n=>n.planRole==='basis'));
  });
  await t.test('理由證據使用正式 reasonRelation 且綁 source_node，不升格基底',()=>{
   const reason=evidence('priority',4,texts[4],{reason:{ref:refs[4],quote:'現在更在意容納量'}});
   const q={...structuredClone(proposal),nodes:[basis,reason],reasonRelations:[{kind:'prioritizes',fromNodeId:'priority',targetNodeIds:['shelf'],ref:refs[4],quote:texts[4]}]};
   const p=calc(q).projection;assert.equal(p.planEvidence.length,1);assert.equal(p.planEvidence[0].uses[0].kind,'reason_relation');
   assert.equal(p.reasons.find(r=>r.nodeId==='priority').binding.kind,'source_node');assert.equal(p.reasons.find(r=>r.nodeId==='shelf').binding.kind,'plan_basis');
   delete q.nodes[1].reason;assert.throws(()=>calc(q),/continuity_reason_target_missing/);
  });
  await t.test('維持證據沿既有 retention，不改基底時間或狀態',()=>{
   const keep=evidence('keep',5,texts[5]),q={version:3,nodes:[basis,keep],unknowns:[],retentions:[{byNodeId:'keep',targetNodeIds:['shelf'],ref:refs[5],quote:texts[5]}]};
   const p=calc(q).projection;assert.equal(p.planEvidence[0].uses[0].kind,'retention');assert.equal(p.currentPlans[0].planStatus,'planned');
   assert.equal(p.currentPlans[0].sourceFragments[0].messageRecordedAt,p.planBasis[0].source.messageRecordedAt);
  });
  await t.test('只有 related 沒有正式用途，不以相同 ref 或時間推斷用途',()=>{
   const q={version:3,nodes:[basis,evidence('unbound',2,texts[2])],unknowns:[]};
   const error=errorOf(()=>calc(q));assert.equal(error.code,'continuity_plan_evidence_use_required');
   const c=getCmcpContinuityCorrection(error);assert.equal(c.issues[0].nodeId,'unbound');assert(!JSON.stringify(c).includes(texts[2]));
  });
  await t.test('同則 User 但不涵蓋變更引文，不能只憑 ref 算支援',()=>{
   const q=structuredClone(proposal);q.nodes[1].quote='原因是可用牆面增加。';assert.throws(()=>calc(q),/continuity_plan_evidence_use_required/);
  });
  await t.test('維持／理由用途也須在證據原句內，不藏同則另一個獨立計畫',()=>{
   for(const kind of ['retention','reason_relation']){
    // 此反例專驗證 evidence 引文越界；理由採不同的合法包含區間，
    // 避免先觸發「原理由與撤回完全同支持」的另一項獨立守護。
    const target={...basis,reason:{ref:refs[0],quote:'走道有限'}},other=evidence('separate-plan',0,'另外我計畫製作收納盒。'),q={version:3,nodes:[target,other],unknowns:[]};
    if(kind==='retention')q.retentions=[{byNodeId:other.id,targetNodeIds:['shelf'],ref:refs[0],quote:'只放室內。'}];
    else q.reasonRelations=[{kind:'withdraws',fromNodeId:other.id,targetNodeIds:['shelf'],ref:refs[0],quote:'原因是走道有限。'}];
    const error=errorOf(()=>calc(q));assert.equal(error.code,'continuity_plan_evidence_quote_mismatch');
    const c=getCmcpContinuityCorrection(error);assert.equal(c.issues[0].kind,kind);assert(!JSON.stringify(c).includes(other.quote));
   }
   // 已有一個合法用途不能掩蓋另外一個越界用途。
   const q=structuredClone(proposal);q.nodes[2].quote='木架先暫停，等材料到貨再繼續。';
   q.retentions=[{byNodeId:'pause-evidence',targetNodeIds:['shelf'],ref:refs[3],quote:'另案收納盒維持規劃。'}];
   assert.throws(()=>calc(q),/continuity_plan_evidence_quote_mismatch/);
  });
  await t.test('合法同則多目標用途各有包含範圍，兩個真正基底都保留',()=>{
   const q=structuredClone(proposal);q.nodes.push(node('box',0,'另外我計畫製作收納盒。',{planRole:'basis'}));q.nodes[2].relation.targetNodeIds.push('box');
   q.retentions=[{byNodeId:'pause-evidence',targetNodeIds:['box'],ref:refs[3],quote:'另案收納盒維持規劃。'}];
   const p=calc(q).projection;assert.equal(p.currentPlans.length,2);assert.equal(p.currentPlans.find(n=>n.nodeId==='shelf').planStatus,'paused');
   assert.equal(p.currentPlans.find(n=>n.nodeId==='box').planStatus,'planned');assert.equal(p.planEvidence.find(n=>n.nodeId==='pause-evidence').uses.length,2);
  });
  await t.test('全部明示關聯先驗引用範圍，不限 related 交集且保留合法外部目標',()=>{
   const make=()=>{const q=structuredClone(proposal);q.nodes[2].quote='木架先暫停，等材料到貨再繼續。';
    q.nodes.push(node('box',0,'另外我計畫製作收納盒。',{planRole:'basis',reason:{ref:refs[0],quote:'收納盒的理由是充分利用零料。'}}));return q;};
   for(const kind of ['retention','reason_relation']){
    const row=(targets,ref,quote)=>kind==='retention'?{byNodeId:'pause-evidence',targetNodeIds:targets,ref,quote}
     :{kind:'unresolved',fromNodeId:'pause-evidence',targetNodeIds:targets,ref,quote};
    const key=kind==='retention'?'retentions':'reasonRelations';
    // related 外目標、同列多目標，以及先合法後越界，都不可跳過任何明示引文。
    for(const targets of [['box'],['shelf','box']]){
     const q=make();q[key]=[row(targets,refs[3],'另案收納盒維持規劃。')];
     const e=errorOf(()=>calc(q));assert.equal(e.code,'continuity_plan_evidence_quote_mismatch');
    }
    const mixed=make();mixed[key]=[row(['shelf'],refs[3],mixed.nodes[2].quote),row(['box'],refs[3],'另案收納盒維持規劃。')];
    assert.throws(()=>calc(mixed),/continuity_plan_evidence_quote_mismatch/);
    const otherRef=make();otherRef[key]=[row(['box'],refs[5],texts[5])];
    assert.throws(()=>calc(otherRef),/continuity_scoped_user_source_required/);
    // 原本允許的精確引用關聯不因 target 不在 related 而被新政策排除。
    // 自然語意是否成立另由宿主驗收，此處只驗正式引用的必要條件。
    const legal=make();legal.nodes[2].quote=texts[3];legal[key]=[row(['box'],refs[3],'另案收納盒維持規劃。')];
    const p=calc(legal).projection;assert.equal(p.currentPlans.length,2);assert.equal(p[key].length,1);
    assert.equal(p.planEvidence.find(n=>n.nodeId==='pause-evidence').uses.length,1);
   }
  });
  await t.test('每個明示基底目標都需正式用途，不讓多目標偷渡',()=>{
   const q=structuredClone(proposal);q.nodes.push(node('box',0,'另外我計畫製作收納盒。'));q.nodes[1].relation.targetNodeIds.push('box');
   assert.throws(()=>calc(q),/continuity_plan_evidence_use_required/);
  });
  await t.test('獨立 relation、不同 topic 及以 evidence 作 target 均拒絕',()=>{
   const independent=structuredClone(proposal);independent.nodes[1].relation={kind:'independent',targetNodeIds:[]};assert.throws(()=>calc(independent),/continuity_plan_evidence_basis_required/);
   const topic=structuredClone(proposal);topic.nodes[1].topic='另一案件';assert.throws(()=>calc(topic),/continuity_plan_evidence_basis_required/);
   const target=structuredClone(proposal);target.nodes[2].relation.targetNodeIds=['revision'];assert.throws(()=>calc(target),/continuity_plan_evidence_basis_required/);
  });
  await t.test('evidence 不可攜狀態，也不能成為計畫修改 target',()=>{
   const status=structuredClone(proposal);status.nodes[1].planStatus='planned';assert.throws(()=>calc(status),/continuity_plan_evidence_status_forbidden/);
   const target=structuredClone(proposal);target.planChanges[0].targetNodeId='revision';assert.throws(()=>calc(target),/continuity_plan_evidence_change_target/);
  });
  await t.test('Assistant、未知角色值、非意圖節點不能取得 evidence 身分',()=>{
   const assistant=structuredClone(proposal);assistant.nodes[1].ref=refs[1];assistant.nodes[1].quote=texts[1];assert.throws(()=>calc(assistant),/continuity_source_role_mismatch/);
   for(const extra of [{planRole:'other'},{kind:'user_report',text:texts[2]}]){const q=structuredClone(proposal);Object.assign(q.nodes[1],extra);assert.throws(()=>calc(q),/continuity_plan_role_invalid/);}
  });
  await t.test('尚未完成的狀態回報與未採提案不被迫變成待執行計畫',()=>{
   const report=(id,i,quote,extra={})=>node(id,i,quote,{kind:'user_report',text:quote,...extra});
   const old=report('access-before',6,'材料尚未獲准進場。',{temporalUse:'historical'});
   const current=report('access-now',8,'材料仍未獲准進場。',{relation:{kind:'related',targetNodeIds:[old.id]}});
   const suggested=node('colour-suggestion',7,texts[7],{kind:'assistant_suggestion',text:texts[7]});
   const notAdopted=report('colour-not-adopted',8,'配色建議目前沒有決定採用。',{relation:{kind:'related',targetNodeIds:[suggested.id]}});
   const q={version:3,nodes:[old,current,suggested,notAdopted],unknowns:['何時獲准仍未決定']};
   const p=calc(q).projection;
   assert.deepEqual(p.currentPlans,[]);assert.deepEqual(p.planEvidence,[]);
   assert.deepEqual(p.currentClaims.map(r=>r.nodeId).sort(),['access-now','colour-not-adopted']);
   assert.equal(p.knownEvolution.find(n=>n.nodeId===suggested.id).source.sourceAuthorRole,'assistant');
   assert.equal(p.knownEvolution.find(n=>n.nodeId===old.id).interpretation.temporalUse,'historical');
   assert.equal(p.validation.executionAuthority,'none');
   // 回報誤帶計畫欄位時須保留原 kind，移除不適用欄位，不教宿主改類求通過。
   const invalid=structuredClone(q);invalid.nodes[1].planRole='evidence';invalid.nodes[1].planStatus='planned';
   const e=errorOf(()=>calc(invalid));assert.equal(e.code,'continuity_plan_role_invalid');
   const c=getCmcpContinuityCorrection(e);assert.match(c.issues[0].expected,/preserve_source_kind_remove_planRole_and_planStatus/);
   assert(!JSON.stringify(c).includes(current.quote));
   delete invalid.nodes[1].planRole;delete invalid.nodes[1].planStatus;
   assert.deepEqual(calc(invalid).projection.currentClaims,p.currentClaims);
   const wrongRetention=structuredClone(q);wrongRetention.retentions=[{byNodeId:current.id,targetNodeIds:[old.id],ref:refs[8],quote:current.quote}];
   const r=errorOf(()=>calc(wrongRetention));assert.equal(r.code,'continuity_retention_requires_plan');
   assert.match(getCmcpContinuityCorrection(r).issues[0].expected,/preserve_source_kind_remove_invalid_retention/);
  });
  await t.test('v3 重複計畫更正不再要求已禁止的整筆 revises',()=>{
   const q={version:3,nodes:[basis,{...basis,id:'duplicate-plan'}],unknowns:[]};
   const e=errorOf(()=>calc(q));assert.equal(e.code,'continuity_plan_relation_required');
   const c=getCmcpContinuityCorrection(e);assert.match(c.issues[0].expected,/scoped_planChanges/);
   assert(!c.issues[0].expected.includes('cite_revises'));
  });
  await t.test('證據與基底引文仍逐字核對，不能自由改寫或借別的 scope',()=>{
   const q=structuredClone(proposal);q.nodes[1].text='這是另一個計畫';assert.throws(()=>calc(q),/continuity_plan_text_not_source/);
   assert.throws(()=>project({...input(proposal),scopeId:'another-scope'}),/invalid_reading_manifest/);
  });
  await t.test('證據可保留 historical 原標記，基底仍不可藉 historical 退休',()=>{
   const q=structuredClone(proposal);q.nodes[1].temporalUse='historical';const p=calc(q).projection;assert.equal(p.knownEvolution.find(n=>n.nodeId==='revision').interpretation.temporalUse,'historical');
   q.nodes[0].temporalUse='historical';assert.throws(()=>calc(q),/continuity_plan_historical_requires_change/);
  });
  await t.test('v1／v2 不接受新 planRole，既有無角色提案仍保持',()=>{
   for(const version of [1,2]){
    const q={version,nodes:[{...basis,text:basis.quote}],unknowns:[]};assert.throws(()=>calc(q),/invalid_continuity_proposal_shape/);
    delete q.nodes[0].planRole;const p=calc(q).projection;assert.equal(p.version,version);assert.equal(p.planEvidence,undefined);assert.equal(p.knownEvolution[0].planRole,undefined);
   }
  });
  await t.test('純投影不改輸入與原時間，正式入口不改 Buffer／TTL 或派送',async()=>{
   const beforeInput=JSON.stringify(input(proposal)),before=await runtime.bufferList();calc();assert.equal(JSON.stringify(input(proposal)),beforeInput);
   const result=await runtime.readingContinuity({ticket:reading.reader.ticket,proposal});assert.equal(result.projection.planEvidence.length,2);
   assert.deepEqual((await runtime.bufferList()).items,before.items);assert.equal(result.projection.eventMutation,'none');assert.equal(result.projection.proactiveEligible,false);
   await fs.writeFile(path.join(out,'final-projection.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  });
 }finally{await runtime.close();}
});
