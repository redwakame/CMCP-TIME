import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const productRoot=process.env.CMCP_TEST_PRODUCT_ROOT?path.resolve(process.env.CMCP_TEST_PRODUCT_ROOT):fileURLToPath(new URL('../',import.meta.url));
const load=file=>import(pathToFileURL(path.join(productRoot,file)).href),copy=structuredClone;
const {createCmcpRuntimeSession}=await load('src/cmcp-guard/cmcp-runtime-session.js');
const {projectCmcpReadingContinuity:project,validateCmcpContinuityPublication:publish,
 getCmcpContinuityCorrection,CMCP_CONTINUITY_PROJECTION_LIMITS:limits}=await load('src/cmcp-guard/cmcp-continuity-projection.js');
const {createCmcpQuotationView:quotationView}=await load('src/cmcp-guard/cmcp-continuity-quotation-view.js');
const {continuityToolSchema,readContinuityProposal}=await load('adapters/continuity-input.mjs');
const {loopHash}=await load('src/cmcp-guard/cmcp-local-loop-journal.js');

// 異領域合成資料；全部來源先經正式 Runtime ingest / navigate / open / read。
// 本測試沒有私人 History、模型答案、外部服務或語意通過宣告。
test('v7 條件與對象經正式 Runtime 局部更新，仍受既有來源、範圍及容量守護',async t=>{
 const root=path.resolve(process.env.CMCP_TEST_OUTPUT??'tmp/cmcp-continuity-scoped-proposal');await fs.mkdir(root,{recursive:true});
 const out=await fs.mkdtemp(path.join(root,'formal-scoped-'));
 const scopeId='synthetic-observatory-scoped-continuity',now='2026-10-14T00:00:00.000Z',timezone='Asia/Taipei';
 const bodies=[
  '赤道儀🔭與光譜儀分別安排。兩者曝光六秒，並且每週校準。曝光一致是為了比較同一批星點。校準頻率是因為夜班人手有限。',
  '赤道儀🔭改為曝光八秒。光譜儀維持原來的曝光條件。',
  '赤道儀🔭與光譜儀一律改為曝光十秒。',
  '只暫停赤道儀🔭的曝光安排；等追蹤誤差完成校正後恢復。這次暫停是因為驅動皮帶需要更換。光譜儀的曝光安排與兩台設備的校準安排照舊。',
  '赤道儀🔭的曝光優先考量改為降低震動。這個調整是因為鄰近道路施工。',
  '赤道儀🔭的曝光不再以比較同一批星點作為理由；光譜儀的這個理由與赤道儀🔭的降低震動理由仍保留。',
  '備用相機可以加入；這只是 Assistant 建議。'
 ];
 const times=bodies.map((_,i)=>new Date(Date.parse(now)-600000+i*60000).toISOString());
 const config={kind:'cmcp_runtime_config',version:1,runtimeId:scopeId,providerMode:'host',
  input:{root:path.join(out,'state'),scopeId,events:[],timezone,
   limits:{maxEntries:12,maxCatalogBytes:12000,maxSources:2,maxSourceBytes:8192,maxProjectionBytes:12000},
   storageCapacity:{maxSources:64,maxSourceBytes:8192},loopTiming:{ttlMs:43200000,inactivityMs:43200000,activityWindowMs:43200000}},
  receiptRoot:path.join(out,'receipts'),sourceAuthorization:{saveUser:true,saveAssistant:true},
  controls:{enabled:true,clean:false,proactive:false,pins:false},answerHistory:{enabled:true}};
 let modelCalls=0;
 const runtime=await createCmcpRuntimeSession({config,repoRoot:out,sessionId:scopeId+'-session',
  hostProvider:{request:async()=>{modelCalls++;throw Error('synthetic_test_model_calls_forbidden');}}});
 const results=[],artifacts=[];
 const save=async(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 async function check(name,fn){await t.test(name,async()=>{try{await fn();results.push({name,status:'PASS'});}
  catch(error){results.push({name,status:'FAIL',error:error.stack});throw error;}});}
 try{
  for(const [i,text]of bodies.entries())await runtime.ingest({role:i===6?'assistant':'user',text,timeContext:{now:times[i],timezone}});
  const navigation=await runtime.readingNavigate({text:'核對觀測設備的曝光、校準、修改對象與理由。'});
  const opening=await runtime.readingOpen({navigationTicket:navigation.host.ticket,mode:'all',
   selection:{version:2,eventRefs:[],scope:{basis:'ordinary_history'},clarification:''},
   limits:{maxSources:64,maxTotalBytes:65536,maxPageBytes:4096,maxPages:64,maxProjectionBytes:32768}});
  const pages=[];for(let i=0;i<64;i++){const page=await runtime.readingPage({ticket:opening.reader.ticket,project:true});pages.push(page);if(page.reader.coverage.complete)break;}
  assert.equal(pages.at(-1).reader.coverage.complete,true,'the selected synthetic sources must be completely read');
  const refs=bodies.map(text=>{const page=pages.find(p=>p.reader.text===text);assert.ok(page,'whole synthetic source page must exist');return page.reader.source.ref;});
  const baselineBuffer=await runtime.bufferList(),baselineControls=await runtime.controlsSnapshot();
  const base=()=>({version:7,plans:[],unknowns:[],scopedPlans:[{id:'observatory',topic:'觀測設備安排',
   scopes:[{id:'mount',ref:refs[0],quote:'赤道儀🔭'},{id:'spectrograph',ref:refs[0],quote:'光譜儀'}],
   conditions:[{id:'exposure',ref:refs[0],quote:'曝光六秒',aspect:'曝光',temporalUse:'current',scopeIds:['mount','spectrograph'],
    reasons:[{id:'comparison',ref:refs[0],quote:'為了比較同一批星點'}]},
   {id:'calibration',ref:refs[0],quote:'每週校準',aspect:'校準頻率',temporalUse:'current',scopeIds:['mount','spectrograph'],
    reasons:[{id:'staffing',ref:refs[0],quote:'因為夜班人手有限'}]}]}]});
  const group=q=>q.scopedPlans[0];
  const local=()=>{const q=base();group(q).orderedChanges=[{conditionId:'exposure',scopeIds:['mount'],kind:'content',
   ref:refs[1],quote:'赤道儀🔭改為曝光八秒',replacement:{ref:refs[1],quote:'曝光八秒'}}];return q;};
  const retained=()=>{const q=local();group(q).retentions=[{conditionId:'exposure',scopeIds:['spectrograph'],ref:refs[1],
   quote:'光譜儀維持原來的曝光條件',temporalUse:'current'}];return q;};
  const calc=q=>project({reading:opening,previousPages:pages,scopeId,proposal:q,timeContext:{now,timezone}});
  const tuple=(projection,conditionId,scope)=>{const row=projection.currentPlans.find(p=>p.applicability?.conditionId===conditionId&&p.applicability.scopeId===scope);
   assert.ok(row,`missing tuple ${conditionId}/${scope}`);return row;};
  const resolved=()=>{const q=retained(),review=calc(q).projection.planScopeReview;
   assert.equal(review.totalFindings,1);q.scopeResolutions=review.findings.map(f=>({findingId:f.findingId,kind:'independent_retention',
    source:copy(f.source),retainedPlan:copy(f.retainedPlan),changedPlan:copy(f.changedPlan),
    evidence:{ref:refs[1],quote:'光譜儀維持原來的曝光條件'}}));return q;};
  async function formal(name,q){const before=JSON.stringify(q);assert.equal(continuityToolSchema.safeParse({ticket:opening.reader.ticket,proposal:q}).success,true);
   assert.deepEqual(readContinuityProposal({ticket:opening.reader.ticket,proposal:q}),q);
   const result=await runtime.readingContinuity({ticket:opening.reader.ticket,proposal:q});
   artifacts.push({name,proposal:copy(q),result:copy(result)});assert.equal(JSON.stringify(q),before);return result;}
  async function rejected(name,q,pattern){const before=await runtime.continuityStatus();let rejection;
   try{await runtime.readingContinuity({ticket:opening.reader.ticket,proposal:q});}
   catch(error){rejection={message:error.message,stack:error.stack,correction:getCmcpContinuityCorrection(error)};}
   artifacts.push({name,proposal:copy(q),rejection:rejection??null});assert.ok(rejection,'invalid proposal must reject');assert.match(rejection.message,pattern);
   const after=await runtime.continuityStatus();assert.equal(after.projectionHash,before.projectionHash,'rejected input must not replace the last published projection');return rejection;}
  function verifyView(result){const view=result.presentation.quotationView,context=result.presentation.sourceContext;
   assert.equal(view.status,'available',view.reason??'quotation view unavailable');assert.equal(context.metadata.status,'available');assert.equal(context.originalMessages.status,'available');
   assert.equal(view.semanticVerification,'not_performed');assert.equal(view.executionAuthority,'none');
   assert.equal(view.currentPlans.length,result.projection.currentPlans.length);
   for(const plan of view.currentPlans){const projected=result.projection.currentPlans.find(p=>p.nodeId===plan.nodeId),scope=plan.applicability.scopeQuotation;
    assert.equal(scope.text,projected.applicability.scopeId==='mount'?'赤道儀🔭':'光譜儀');
    assert.equal(scope.ref,refs[0]);assert.equal(scope.sourceAuthorRole,'user');assert.equal(Date.parse(scope.messageRecordedAt),Date.parse(times[0]));
    assert.equal([...bodies[0]].slice(scope.range.start,scope.range.end).join(''),scope.text);
    assert.equal(scope.use,'explicit_condition_scope');assert.equal(plan.applicability.executionAuthority,'none');
    assert.equal(plan.applicability.scopedPlanBindingHash,projected.applicability.scopedPlanBindingHash);
    assert.equal(plan.applicability.textUse,'current_condition_applies_only_to_this_declared_scope_not_every_object_named_in_original_quote');
    for(const quote of plan.quotations){const index=refs.indexOf(quote.ref);assert.ok(index>=0);assert.equal([...bodies[index]].slice(quote.range.start,quote.range.end).join(''),quote.text);
     assert.equal(Date.parse(quote.messageRecordedAt),Date.parse(times[index]));assert.equal(quote.sourceAuthorRole,'user');}
   }
  }
  await save('formal-fixture.json',{config,bodies,times,navigation,opening,pages,refs});

  await check('共享條件只改具名對象，另一對象及另一條件的值與來源保持',async()=>{
   const original=await formal('original',base()),changed=await formal('local-change',local());verifyView(original);verifyView(changed);
   const p=changed.projection;assert.equal(changed.status,'partial');assert.equal(changed.reason,'scope_review_required');
   assert.equal(p.planScopeReview.status,'required');assert.equal(p.planScopeReview.totalFindings,1);
   assert.equal(tuple(p,'exposure','mount').text,'曝光八秒');assert.equal(tuple(p,'exposure','spectrograph').text,'曝光六秒');
   for(const [condition,scope]of [['exposure','spectrograph'],['calibration','mount'],['calibration','spectrograph']]){
    const before=tuple(original.projection,condition,scope),after=tuple(p,condition,scope);
    assert.equal(after.planVersion,before.planVersion);assert.equal(after.text,before.text);assert.deepEqual(after.sourceFragments,before.sourceFragments);
    assert.equal(after.applicability.scopedPlanBindingHash,before.applicability.scopedPlanBindingHash);
   }
   assert.equal(changed.compilation.inputVersion,7);assert.equal(p.validation.executionAuthority,'none');assert.deepEqual(p.unknowns,[]);
  });
  await check('明示 retention 仍須原 finding；完整合法 resolution 才 ready 且不升格語意',async()=>{
   const pending=await formal('retention-still-pending',retained());verifyView(pending);
   assert.equal(pending.status,'partial');assert.deepEqual(pending.readinessReasons,['scope_review_required']);
   assert.equal(pending.projection.planScopeReview.unresolvedFindings,1);
   assert(pending.presentation.quotationView.currentPlans.every(p=>p.quotations.every(q=>q.scopeAnnotations===undefined)));
   const accepted=await formal('source-bound-resolution',resolved());verifyView(accepted);
   assert.equal(accepted.status,'ready');assert.equal(accepted.projection.planScopeReview.status,'addressed_by_source_bound_host_resolution');
   assert.equal(accepted.projection.planScopeReview.unresolvedFindings,0);
   assert.equal(accepted.projection.planScopeReview.semanticVerification,'not_performed');
   const kept=tuple(accepted.projection,'exposure','spectrograph'),changed=tuple(accepted.projection,'exposure','mount');
   const annotation=accepted.presentation.quotationView.currentPlans.find(p=>p.nodeId===kept.nodeId).quotations[0].scopeAnnotations[0];
   assert.equal(annotation.retainedPlan.nodeId,kept.nodeId);assert.equal(annotation.changedPlan.nodeId,changed.nodeId);
   assert.equal(annotation.scopeUse,'retained_plan_only_not_changed_plan');assert.equal(annotation.executionAuthority,'none');
   assert.equal((await runtime.continuityStatus()).status,'ready');
  });
  await check('不能偽造 ready、錯 scope finding 或移除正式 retention 過關',async()=>{
   const partial=calc(retained());await assert.rejects(publish({stores:{scopeId},reading:opening,previousPages:pages,
    result:{...partial,status:'ready',reason:null,readinessReasons:[]},timeContext:{now,timezone}}),/continuity_projection_binding_changed/);
   const wrong=resolved();wrong.scopeResolutions[0].source.pointer.scopeId='foreign-observatory';
   await rejected('wrong-resolution-scope',wrong,/continuity_scope_resolution_binding/);
   const missing=resolved();delete group(missing).retentions;
   await rejected('missing-resolution-retention',missing,/continuity_scope_resolution_retention_required/);
  });
  await check('明示全體修改只更新指定 condition 的全體 scope，校準保持',async()=>{
   const q=base();group(q).orderedChanges=[{conditionId:'exposure',scopeIds:['mount','spectrograph'],kind:'content',
    ref:refs[2],quote:bodies[2],replacement:{ref:refs[2],quote:'曝光十秒'}}];
   const result=await formal('all-declared-exposure-scopes',q);verifyView(result);assert.equal(result.status,'ready');
   assert.equal(result.projection.planScopeReview.status,'no_overlap_detected');
   for(const scope of ['mount','spectrograph']){assert.equal(tuple(result.projection,'exposure',scope).text,'曝光十秒');
    assert.equal(tuple(result.projection,'calibration',scope).text,'每週校準');assert.equal(tuple(result.projection,'calibration',scope).sourceFragments[0].ref,refs[0]);}
  });
  await check('同 tuple 的 status 與 reason 依順序綁定，其他 tuple 完整保持',async()=>{
   const q=base();group(q).orderedChanges=[{conditionId:'exposure',scopeIds:['mount'],kind:'status',ref:refs[3],
    quote:'只暫停赤道儀🔭的曝光安排；等追蹤誤差完成校正後恢復',planStatus:'paused',
    reasons:[{id:'drive',ref:refs[3],quote:'因為驅動皮帶需要更換'}]},
   {conditionId:'exposure',scopeIds:['mount'],kind:'reason',ref:refs[4],quote:bodies[4],
    reasons:[{id:'vibration',ref:refs[4],quote:'因為鄰近道路施工',kind:'prioritizes'}]}];
   const result=await formal('tuple-status-reason',q);verifyView(result);assert.equal(result.status,'ready');
   const p=result.projection,changed=tuple(p,'exposure','mount'),changes=p.planChanges.filter(c=>c.targetNodeId===changed.nodeId);
   assert.equal(changed.planStatus,'paused');assert.equal(changed.text,'曝光六秒');assert.equal(changed.statusSource.citation.text,group(q).orderedChanges[0].quote);
   assert.deepEqual(changes.map(c=>c.kind),['status','reason']);assert.equal(changes[1].afterChangeId,changes[0].id);
   assert.equal(changes[1].priorVersion,changes[0].planVersion);
   const original=calc(base()).projection;
   for(const [condition,scope]of [['exposure','spectrograph'],['calibration','mount'],['calibration','spectrograph']]){
    const before=tuple(original,condition,scope),after=tuple(p,condition,scope);assert.equal(after.planStatus,'planned');
    assert.equal(after.planVersion,before.planVersion);assert.deepEqual(after.sourceFragments,before.sourceFragments);
    assert.deepEqual(p.reasonBindings.filter(r=>r.binding.nodeId===after.nodeId),original.reasonBindings.filter(r=>r.binding.nodeId===before.nodeId));
   }
   const added=p.reasonBindings.filter(r=>changes.some(c=>r.binding.changeId===c.id));assert.equal(added.length,2);
   assert(added.every(r=>r.standing==='not_explicitly_withdrawn'));
  });
  await check('理由撤回只作用於具名 condition、scope 與 reason，其他理由及狀態保留',async()=>{
   const q=base();group(q).orderedChanges=[{conditionId:'exposure',scopeIds:['mount'],kind:'reason',ref:refs[4],quote:bodies[4],
    reasons:[{id:'vibration',ref:refs[4],quote:'因為鄰近道路施工',kind:'prioritizes'}]}];
   group(q).reasonWithdrawals=[{conditionId:'exposure',scopeIds:['mount'],targetReasonId:'comparison',ref:refs[5],
    quote:'赤道儀🔭的曝光不再以比較同一批星點作為理由',temporalUse:'current'}];
   const result=await formal('named-reason-withdrawal',q);verifyView(result);assert.equal(result.status,'ready');
   const p=result.projection,mount=tuple(p,'exposure','mount'),spectrograph=tuple(p,'exposure','spectrograph');
   const withdrawn=p.reasonBindings.filter(r=>r.standing==='withdrawn_by_explicit_user_source');assert.equal(withdrawn.length,1);
   assert.equal(withdrawn[0].binding.nodeId,mount.nodeId);assert.equal(withdrawn[0].citation.text,'為了比較同一批星點');
   assert.equal(p.reasonBindings.find(r=>r.binding.nodeId===spectrograph.nodeId).standing,'not_explicitly_withdrawn');
   assert(p.reasonBindings.filter(r=>r.reasonId!==withdrawn[0].reasonId).every(r=>r.standing==='not_explicitly_withdrawn'));
   assert(p.currentPlans.every(p=>p.planStatus==='planned'));assert.equal(mount.text,'曝光六秒');
   const wrong=copy(q);group(wrong).reasonWithdrawals[0].scopeIds=['spectrograph'];group(wrong).reasonWithdrawals[0].targetReasonId='vibration';
   await rejected('reason-not-owned-by-named-tuple',wrong,/continuity_v7_reason_withdrawal_target/);
  });
  await check('未知、重複、空或不屬 condition 的 scope 與錯 condition 皆拒絕',async()=>{
   for(const [label,ids]of [['unknown',['other']],['duplicate',['mount','mount']],['empty',[]]]){
    const q=local();group(q).orderedChanges[0].scopeIds=ids;await rejected('scope-'+label,q,/continuity_v7_scope_target/);}
   const narrowed=local();group(narrowed).conditions[0].scopeIds=['spectrograph'];await rejected('scope-outside-condition',narrowed,/continuity_v7_scope_target/);
   const wrong=local();group(wrong).orderedChanges[0].conditionId='unknown';await rejected('missing-condition',wrong,/continuity_v7_condition_target/);
  });
  await check('對象來源須為已讀 User 原話；錯 role/ref/不存在 quote/缺 quote 拒絕',async()=>{
   const wrongRole=base();group(wrongRole).scopes[0]={id:'mount',ref:refs[6],quote:'備用相機'};
   await rejected('scope-assistant-source',wrongRole,/continuity_v7_scope_user_source_required/);
   const wrongRef=base();group(wrongRef).scopes[0].ref='unread-ref';await rejected('scope-unread-ref',wrongRef,/continuity_source_outside_reading/);
   const absent=base();group(absent).scopes[0].quote='未出現的觀測器';await rejected('scope-absent-quote',absent,/continuity_quote_absent/);
   const missing=base();delete group(missing).scopes[0].quote;assert.equal(continuityToolSchema.safeParse({ticket:opening.reader.ticket,proposal:missing}).success,false);
   await rejected('scope-missing-quote',missing,/continuity_v7_shape/);
   const replacement=local();group(replacement).orderedChanges[0].replacement.ref='unread-ref';await rejected('replacement-unread-ref',replacement,/continuity_source_outside_reading/);
  });
  await check('原 schema bytes、展開 tuples／changes／retentions／withdrawals 都有有限上限',async()=>{
   const cases=[];
   const nodes=base();group(nodes).conditions=Array.from({length:13},(_,i)=>({...copy(group(nodes).conditions[0]),id:'capacity-'+i,aspect:'容量-'+i,reasons:[]}));cases.push(['expanded-tuples',nodes]);
   const changes=base();group(changes).orderedChanges=Array.from({length:13},()=>({conditionId:'exposure',scopeIds:['mount','spectrograph'],kind:'status',ref:refs[3],quote:bodies[3],planStatus:'paused'}));cases.push(['expanded-changes',changes]);
   const retentions=base();group(retentions).retentions=Array.from({length:5},()=>({conditionId:'exposure',scopeIds:['mount','spectrograph'],ref:refs[1],quote:bodies[1],temporalUse:'current'}));cases.push(['expanded-retentions',retentions]);
   const withdrawals=base();group(withdrawals).reasonWithdrawals=Array.from({length:7},()=>({conditionId:'exposure',scopeIds:['mount','spectrograph'],targetReasonId:'comparison',ref:refs[5],quote:bodies[5],temporalUse:'current'}));cases.push(['expanded-withdrawals',withdrawals]);
   for(const [name,q]of cases){assert.equal(continuityToolSchema.safeParse({ticket:opening.reader.ticket,proposal:q}).success,true);
    const failure=await rejected(name,q,/continuity_proposal_limit/);assert.equal(failure.correction?.issues[0].phase,'compiled');
    assert(failure.correction.issues[0].actualItems>failure.correction.issues[0].maxItems);}
   const oversized=base();oversized.unknowns=['x'.repeat(limits.maxProposalBytes)];
   assert.equal(continuityToolSchema.safeParse({ticket:opening.reader.ticket,proposal:oversized}).success,false);
   assert.throws(()=>readContinuityProposal({ticket:opening.reader.ticket,proposal:oversized}),/continuity_proposal_too_large/);
   await rejected('proposal-bytes',oversized,/continuity_proposal_limit/);
  });
  await check('正式 sourceContext 是 scopeQuotation 的必要證據；缺失及篡改不提供新視圖',async()=>{
   const result=await formal('quotation-source-proof',resolved());verifyView(result);
   const calcView=(p,c)=>quotationView({projection:p,projectionHash:loopHash(p),sourceContext:c});
   assert.equal(calcView(result.projection,null).reason,'continuity_quotation_scope_formal_context_unavailable');
   for(const binding of result.projection.scopedPlanBindings)assert(binding.scopeSource.citation.end<=binding.conditionSource.citation.start,
    'scope quote outside the condition quote must still use the complete formal source');
   const rehashBinding=(binding,plan)=>{const {bindingHash,...body}=binding;binding.bindingHash=loopHash(body);plan.applicability.scopedPlanBindingHash=binding.bindingHash;};
   for(const [name,mutate,reason]of [
    ['scope-label',({plan})=>{plan.applicability.scopeLabel='其他設備';},'continuity_quotation_scoped_plan_hash_mismatch'],
    ['binding-hash',({binding,plan})=>{binding.bindingHash='0'.repeat(64);plan.applicability.scopedPlanBindingHash=binding.bindingHash;},'continuity_quotation_scoped_plan_hash_mismatch'],
    ['binding-version',({binding,plan})=>{binding.planVersion='0'.repeat(64);rehashBinding(binding,plan);},'continuity_quotation_scoped_plan_binding'],
    ['scope-pointer',({binding,plan})=>{binding.scopeSource.pointer.scopeId='foreign-scope';rehashBinding(binding,plan);},'continuity_quotation_scope_pointer_binding'],
    ['context-pointer',({context})=>{context.metadata.sources.find(s=>s.ref===refs[0]).pointer.scopeId='wrong-scope';},'continuity_quotation_scope_pointer_binding'],
    ['same-length-false-quote',({binding,plan})=>{binding.scopeSource.citation.text='赤道儀🌙';plan.applicability.scopeLabel=binding.scopeSource.citation.text;rehashBinding(binding,plan);},'continuity_quotation_scope_exact_source_quote_mismatch']
   ]){
    const p=copy(result.projection),context=copy(result.presentation.sourceContext),binding=p.scopedPlanBindings[0],plan=p.currentPlans.find(row=>row.nodeId===binding.nodeId);
    mutate({p,context,binding,plan});context.projectionHash=loopHash(p);
    const forged=calcView(p,context);artifacts.push({name:'quotation-tamper-'+name,projection:p,sourceContext:context,result:forged});
    assert.equal(forged.status,'unavailable',name);assert.equal(forged.reason,reason,name);assert.equal(forged.currentPlans,null);assert.equal(forged.retentions,null);
   }
  });
  await check('正式 readback、完整投影、原時間、Buffer 與 control 不因查看或拒絕改動',async()=>{
   const result=await formal('final-readback',resolved()),before=JSON.stringify(result.projection);
   const readback=await runtime.continuityStatus();verifyView(readback);assert.deepEqual(readback.projection,result.projection);
   assert.deepEqual(readback.presentation.quotationView,result.presentation.quotationView);assert.equal(result.projectionHash,loopHash(result.projection));
   assert.equal(JSON.stringify(result.projection),before);assert.deepEqual((await runtime.bufferList()).items,baselineBuffer.items);
   assert.deepEqual(await runtime.controlsSnapshot(),baselineControls);assert.equal(modelCalls,0);
   for(const source of result.projection.sources){const index=refs.indexOf(source.ref);assert.equal(Date.parse(source.messageRecordedAt),Date.parse(times[index]));}
   await save('formal-readback.json',{result,readback,buffer:baselineBuffer,controls:baselineControls,modelCalls});
  });
  await check('撤權、OFF 與 Clean 仍不洩出 scoped 引文視圖',async()=>{
   await runtime.revokeReading({ticket:opening.reader.ticket,reason:'caller_revoked'});
   const revoked=await runtime.continuityStatus();assert.equal(revoked.status,'unavailable');assert.equal(revoked.presentation,undefined);
   await runtime.configureControls({updateId:'scoped-test-off',patch:{enabled:false},persist:false});
   const off=await runtime.continuityStatus();assert.equal(off.status,'unavailable');assert.equal(off.presentation,undefined);
   await runtime.configureControls({updateId:'scoped-test-clean',patch:{enabled:true,clean:true},persist:false});
   const clean=await runtime.continuityStatus();assert.equal(clean.status,'unavailable');assert.equal(clean.presentation,undefined);assert.equal(modelCalls,0);
  });
 }finally{
  await runtime.close();await save('formal-results.json',{kind:'cmcp_scoped_proposal_runtime_tests',productRoot,modelCalls,
   semanticVerification:'not_performed',executionAuthority:'none',runtimeClosed:true,results,artifacts});
 }
});
