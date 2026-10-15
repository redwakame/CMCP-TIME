import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const clientPath=process.argv[2]??fileURLToPath(new URL('./client.js',import.meta.url)),resultPath=process.argv[3];
const code=await fs.readFile(clientPath,'utf8'),hooks=[],effects=[],commands=[],checks=[];
// Fixture writes target declared hook names, not positions that drift when state is added.
// A missing/ambiguous declaration fails closed instead of weakening the UI assertions.
const componentCode=code.slice(code.indexOf('function CmcpDock('),code.indexOf('function apply('));
const hookNames=[...componentCode.matchAll(/\[([A-Za-z_$][\w$]*),[A-Za-z_$][\w$]*\]\s*=\s*React\.useState\(|(?:const|,)\s*([A-Za-z_$][\w$]*)\s*=\s*React\.useRef\(/g)].map(match=>match[1]??match[2]);
assert.ok(hookNames.length>0);assert.equal(new Set(hookNames).size,hookNames.length);
const hookIndex=name=>{const index=hookNames.indexOf(name);assert.notEqual(index,-1,'fixture hook '+String(name));return index;};
const local=new Proxy({},{get:(_target,name)=>hooks[hookIndex(name)],set:(_target,name,value)=>{hooks[hookIndex(name)]=value;return true;}});
let hook=0,effectHook=0,component;const seenEffects=[],mediaReads=[],mountCalls=[],rpcReads=[],dynamicInjectCalls=[],childCleanups=[];let registration,rpcResult,rpcError,sessionOpen=true;
const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity).filter(child=>child!==false&&child!==null&&child!==undefined)}),
  useState(initial){const index=hook++;if(!(index in hooks))hooks[index]=initial;return [hooks[index],value=>hooks[index]=typeof value==='function'?value(hooks[index]):value];},
  useRef(initial){const index=hook++;if(!(index in hooks))hooks[index]={current:initial};return hooks[index];},
  useEffect(effect){const index=effectHook++;if(!seenEffects[index]){effects.push(effect);seenEffects[index]=true;}}};
let module;const storage=new Map(),eventListeners=new Map(),parentCleanups=[],effectCleanups=[];let storageDenied=false;
function OfficialModal(props){return props.open?React.createElement('modal-projection',props,props.children):null;}
const browserContext=vm.createContext({window:{localStorage:{getItem:key=>{if(storageDenied)throw Error('storage denied');return storage.get(key)??null;},setItem:(key,value)=>{if(storageDenied)throw Error('storage denied');storage.set(key,value);}},__ModuleLoader__:{load:entry=>module=entry.factory(name=>{if(name==='react')return React;assert.equal(name,'@deepseek-ai/dsh-client-ui-primitives');return {Modal:OfficialModal};})}},Intl,TextEncoder,AbortController,console});
vm.runInContext(code,browserContext,{filename:clientPath});
const remote={$mount:async spec=>mountCalls.push(spec),commands:{execute:async()=>{throw Error('圖片讀取不得使用 command');}},
  cmcpMediaOriginals:{read:async(request,signal)=>{rpcReads.push({request:clone(request),signal});if(rpcError)throw rpcError;return vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(rpcResult))+')',browserContext);}}};
const cordisRemote=declared=>new Proxy(remote,{get(target,key){if(key==='cmcpMediaOriginals'&&!declared.includes('remote.cmcpMediaOriginals'))throw Error('cannot get property "remote.cmcpMediaOriginals" without inject');return target[key];}});
const parentContext={on:(name,handler)=>eventListeners.set(name,handler),slots:{inject:(_name,operation)=>operation(),register:(options,value)=>{registration=options;component=value;}},effect:operation=>parentCleanups.push(operation()),
  sessions:{using:async(sessionId,metadata,operation)=>operation({binding:{session:{getSnapshot:()=>({openState:sessionOpen?'open':'closed'})}}})},
  remote:cordisRemote(module.inject),inject(names,apply){dynamicInjectCalls.push({names:[...names],mountCallsAtCreation:mountCalls.length});
    apply({remote:cordisRemote([...module.inject,...names]),effect:operation=>childCleanups.push(operation())});return Promise.resolve();}};
module.apply(parentContext);
const pointer={version:1,providerNamespace:'synthetic',scopeId:'scope-A',itemId:'source-item-1',sessionId:'session-A',revisionId:'rev-1'};
const source={id:'catalog-source-1',pointer,evidenceHash:'a'.repeat(64),sourceAuthorRole:'user',messageRecordedAt:'2026-10-01T01:02:03.000Z',
  sourceKind:'history',contentKind:'source_excerpt',location:{unit:'unicode_code_points',start:0,end:120}};
const control={enabled:true,clean:false,saveUser:true,saveAssistant:true,historyRecall:true,answerHistory:true,proactive:false,pins:true,doNotDisturb:{enabled:false,timezone:null,windows:[]}};
const fixture={kind:'cmcp_desktop_response',operation:'status',enabled:true,optedIn:true,scopeId:'scope-A',sessionId:'session-A',
  sessionAuthorization:{scope:'session',sessionId:'session-A',optedIn:true},sharedControlScope:{scope:'workspace',scopeId:'scope-A'},enhancementBlockedReasons:[],
  workspaceRoot:'synthetic-workspace',destinations:[{scopeId:'scope-A',sessionId:'session-B',label:'第二個已授權對話',available:true,optedIn:true},
    {scopeId:'scope-A',sessionId:'session-A',available:true,optedIn:true},{scopeId:'scope-Z',sessionId:'private-Z',available:true,optedIn:true}],
  snapshot:{controlConfiguration:{generation:'generation-1',effective:control},sourceAuthorization:{saveUser:true,saveAssistant:true},
    registration:{sources:[source],inventoryComplete:true},buffer:{items:[{kind:'recall',sourceRefs:[pointer],sourceTimes:[{pointer,sourceAuthorRole:'user',messageRecordedAt:source.messageRecordedAt,resolveStatus:'found'}],reason:'active',expiry:'2026-10-01T13:02:03.000Z',proactiveReason:'purposeful_recall_does_not_grant_proactive'}],retained:[]},
    pins:{pins:[]},destinations:{},dispatchObservation:{records:[],modelCalls:0},proactive:{liveDispatch:{reason:'disabled'}},timeCard:{current:{now:'2026-10-01T01:03:00Z',timezone:'Asia/Taipei'}}}};
const clone=value=>JSON.parse(JSON.stringify(value));
let responseOverride=null,exactResponse=null;
const runCmcp=async command=>{commands.push(command);const name=command.split(' ')[0];return {text:JSON.stringify(exactResponse??{...clone(local.state??fixture),operation:name,...(name==='ui'?{uiPreference:command.split(' ')[1]}:{}),...(name==='original'?{original:{status:'found',text:'合成來源原文',sourceAuthorRole:'user',messageRecordedAt:source.messageRecordedAt}}:{}),...(responseOverride??{})})};};
const readMedia=async payload=>{mediaReads.push(clone(payload));return {...clone(local.state??fixture),operation:'media-read',...(responseOverride??{})};};
const render=()=>{hook=0;effectHook=0;const tree=component({...registration.inject('session-A'),runCmcp,readMedia});assert.equal(hook,hookNames.length,'fixture covers every declared state/ref hook');return tree;};
const all=(node,match,result=[])=>{if(node&&typeof node==='object'){if(match(node))result.push(node);for(const child of node.children??[])all(child,match,result);}return result;};
const text=node=>typeof node==='string'||typeof node==='number'?String(node):node&&typeof node==='object'?(node.children??[]).map(text).join(''):'';
const button=(tree,label)=>{const found=all(tree,node=>node.type==='button'&&text(node)===label);assert.equal(found.length,1,'button '+label);return found[0];};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const check=(name,fn)=>{fn();checks.push({name,status:'PASS'});};
const descriptorPath=fileURLToPath(new URL('./media-rpc-descriptor.js',import.meta.url)),descriptorBody=(await fs.readFile(descriptorPath,'utf8')).replace(/^export /gm,'').trimEnd();
check('inline瀏覽器RPC契約與shared descriptor逐位元相同',()=>assert.ok(code.includes(descriptorBody)));
const initial=render();check('正式狀態尚未讀回時顯示核對中，不冒充OFF',()=>{assert.ok(text(initial).includes('CMCP 核對中'));assert.ok(!text(initial).includes('CMCP OFF'));});for(const effect of effects)effectCleanups.push(effect());await tick();
check('首次讀取只送 status，沒有提醒或控制寫入',()=>assert.deepEqual(commands,['status']));
let compact=render();
check('官方輸入欄下方composer.dock且預設只有最小入口',()=>{assert.equal(registration.name,'conversation.composer.dock');const dock=all(compact,node=>node.props['aria-label']==='CMCP 原生接入狀態')[0];assert.equal(dock.props['data-display-mode'],'minimized');assert.equal(dock.props.style.maxHeight,28);assert.equal(all(dock,node=>node.type==='button').length,1);assert.equal(all(dock,node=>node.type==='span').length,0);assert.equal(all(compact,node=>node.type===OfficialModal)[0].props.open,false);assert.equal(all(compact,node=>node.type==='pre').length,0);});
const authorityBeforeDisplay=JSON.stringify(local.state.sessionAuthorization),controlsBeforeDisplay=JSON.stringify(local.state.snapshot.controlConfiguration);
all(compact,node=>node.props['aria-label']==='查看 CMCP 狀態')[0].props.onClick();compact=render();button(compact,'單列摘要').props.onClick();await tick();compact=render();all(compact,node=>node.type===OfficialModal)[0].props.onClose();compact=render();
check('顯示切換只送ui且精確scopekey只存顯示字串',()=>{assert.deepEqual(commands,['status','ui row']);assert.deepEqual([...storage],[[JSON.stringify(['cmcp-native-ui',1,'synthetic-workspace','scope-A']),'row']]);assert.equal(JSON.stringify(local.state.sessionAuthorization),authorityBeforeDisplay);assert.equal(JSON.stringify(local.state.snapshot.controlConfiguration),controlsBeforeDisplay);});
check('單列摘要依slot縮小，狀態按鈕保留且title不丟完整摘要',()=>{const dock=all(compact,node=>node.props['aria-label']==='CMCP 原生接入狀態')[0],entry=button(compact,'查看狀態'),summary=all(dock,node=>node.type==='span')[0];assert.equal(dock.props['data-display-mode'],'row');assert.equal(dock.props.style.minWidth,0);assert.equal(dock.props.style.boxSizing,'border-box');assert.equal(summary.props.style.flex,'1 1 0%');assert.equal(summary.props.style.width,0);assert.equal(entry.props.style.flex,'0 0 auto');assert.ok(summary.props.title.includes('synthetic-workspace'));assert.ok(summary.props.title.includes('來源 1｜Buffer 1｜Pin 0'));});
const beforeView=commands.length,snapshotBeforeView=JSON.stringify(local.state);
button(compact,'查看狀態').props.onClick();compact=render();
check('狀態開啟沿官方 body portal Modal 且沒有額外命令',()=>{const modal=all(compact,node=>node.type===OfficialModal)[0];assert.equal(modal.props.open,true);assert.equal(modal.props.closeLabel,'關閉 CMCP 狀態');assert.equal(JSON.stringify(local.state),snapshotBeforeView);assert.equal(commands.length,beforeView);});
const sourceTab=all(compact,node=>node.props.role==='tab'&&text(node)==='來源與原件')[0];sourceTab.props.onClick();compact=render();
check('切換分頁只改介面狀態，不寫控制／時間或叫模型',()=>{const visible=all(compact,node=>node.type==='section'&&node.props.hidden===false);assert.equal(visible.length,1);assert.equal(visible[0].props['aria-label'],'來源與原件');assert.equal(JSON.stringify(local.state),snapshotBeforeView);assert.equal(commands.length,beforeView);});
all(compact,node=>node.type===OfficialModal)[0].props.onClose();compact=render();
check('關閉詳情保持正式狀態與命令數不變',()=>{assert.equal(local.open,false);assert.equal(JSON.stringify(local.state),snapshotBeforeView);assert.equal(commands.length,beforeView);});
local.open=true;let tree=render();
check('Buffer 以來源清冊與 sourceTimes 呈現角色與原時間',()=>{const result=text(tree);assert.ok(result.includes('使用者｜2026-10-01T01:02:03.000Z'));assert.ok(result.includes('原件核對成立'));assert.ok(!result.includes('未提供身分'));});
check('目前對話是正式目的地預設，異 scope 目標不列選項',()=>{const select=all(tree,node=>node.type==='select')[0];assert.equal(select.props.value,'session-A');assert.ok(!text(select).includes('private-Z'));});
const checkbox=all(tree,node=>node.type==='input'&&node.props.type==='checkbox')[0];checkbox.props.onChange({target:{checked:true}});tree=render();
button(tree,'以所選來源建立 Pin').props.onClick();await tick();
check('無時間 Pin 送 null，不暗寫主動或Pin開關',()=>{const command=commands.at(-1);assert.ok(command.startsWith('pin-create '));assert.deepEqual(JSON.parse(command.slice(11)),{scopeId:'scope-A',generation:'generation-1',sessionId:'session-A',sourceIds:['catalog-source-1'],dueAt:null});});
tree=render();button(tree,'開啟主動總開關（工作區）').props.onClick();await tick();
check('共用控制寫入有明示scope與世代，只寫所選功能',()=>assert.deepEqual(JSON.parse(commands.at(-1).slice(9)),{scopeId:'scope-A',generation:'generation-1',patch:{proactive:true}}));
local.state={...clone(fixture),enabled:false,enhancementBlockedReasons:['shared_clean'],snapshot:{controlConfiguration:{generation:'generation-2',effective:{...control,clean:true}}}};tree=render();
check('對話已加入且Clean阻擋可區分，來源不冒稱空集合',()=>{const value=text(tree);assert.ok(value.includes('本對話已加入'));assert.ok(value.includes('工作區 Clean 保護中'));assert.ok(value.includes('不能據此判定空集合'));assert.ok(!value.includes('目前沒有 Pin 目標'));assert.ok(!button(tree,'關閉Clean 保護（工作區）').props.disabled);});
local.state={...clone(fixture),optedIn:false,enabled:false,sessionAuthorization:{scope:'session',sessionId:'session-A',optedIn:false},enhancementBlockedReasons:['session_not_enabled'],snapshot:{controlConfiguration:{generation:'generation-2',effective:control}}};tree=render();
check('未授權分開呈現且工作區控制不可操作',()=>{assert.ok(text(tree).includes('資料是否存在未知'));assert.ok(button(tree,'開啟主動總開關（工作區）').props.disabled);});
local.state=clone(fixture);local.state.snapshot.buffer.items=[];tree=render();
check('只有正式已回傳Buffer空集合才宣告空活躍集合',()=>assert.ok(text(tree).includes('正式介面目前回傳空的活躍集合')));
local.state=clone(fixture);local.state.snapshot.controlConfiguration.effective.historyRecall=false;tree=render();
check('閱讀控制OFF時保留身分、正式原文按鈕禁用',()=>assert.ok(all(tree,node=>node.type==='button'&&text(node)==='正式原文').every(node=>node.props.disabled)));
local.state=clone(fixture);tree=render();all(tree,node=>node.type==='button'&&text(node)==='正式原文')[0].props.onClick();await tick();
check('正式原文沿有界版本hash與pointer指令',()=>{const request=JSON.parse(commands.at(-1).slice(9));assert.equal(request.evidenceHash,source.evidenceHash);assert.deepEqual(request.pointer,pointer);assert.equal(request.end,120);assert.equal(request.maxBytes,8192);});
check('原文正文以正式reader結果呈現並開啟來源分頁',()=>{assert.ok(text(render()).includes('合成來源原文'));assert.equal(local.tab,'sources');});
const pin={pinId:'pin-1',revision:4,status:'active',sourcePointers:[pointer],dueAt:'2026-10-01T15:00:00Z'};
local.state=clone(fixture);local.state.snapshot.pins.pins=[pin];local.state.snapshot.destinations={'pin-1':{scopeId:'scope-A',sessionId:'session-A'}};
tree=render();const date=all(tree,node=>node.type==='input'&&node.props.type==='datetime-local')[1];date.props.onChange({target:{value:''}});tree=render();button(tree,'套用改期').props.onClick();await tick();
check('Pin改期沿schedule+expectedRevision，可撤下排定時間',()=>assert.deepEqual(JSON.parse(commands.at(-1).slice(11)),{scopeId:'scope-A',generation:'generation-1',pinId:'pin-1',expectedRevision:4,change:'schedule',dueAt:null}));
tree=render();button(tree,'取消此 Pin').props.onClick();await tick();
check('取消綁正式Pin與revision，不含來源或共用開關改寫',()=>assert.deepEqual(JSON.parse(commands.at(-1).slice(11)),{scopeId:'scope-A',generation:'generation-1',pinId:'pin-1',expectedRevision:4,change:'cancel'}));
tree=render();button(tree,'標記此 Pin 完成').props.onClick();await tick();
check('完成只改正式Pin工作身分',()=>assert.equal(JSON.parse(commands.at(-1).slice(11)).change,'complete'));
local.state.snapshot.pins.pins[0]={...pin,revision:5,dueAt:'2026-10-02T16:00:00Z'};tree=render();
check('來源 Pin 版本改變不保留舊版改期草稿',()=>assert.notEqual(all(tree,node=>node.type==='input'&&node.props.type==='datetime-local')[1].props.value,''));
local.state.snapshot.dispatchObservation.records=[{kind:'dispatch_result',value:{id:'work-1',at:'2026-10-01T10:00:00Z',status:'handed_to_host',receipt:{hostReceipt:{stage:'host_committed'},presentation:'not_observed',userRead:'not_observed'}}}];tree=render();
check('宿主接受與未觀測畫面/已讀分列',()=>{const value=text(tree);assert.ok(value.includes('宿主已接受並正式提交'));assert.ok(value.includes('畫面：尚未觀測；已讀：尚未觀測'));});
const before=commands.length;tree=render();button(tree,'重新讀取（唯讀）').props.onClick();await tick();
check('刷新只送status，來源和Pin操作沒有旁路',()=>assert.deepEqual(commands.slice(before),['status']));
local.state=clone(fixture);tree=render();
const continuityPanel=value=>{const panels=all(value,node=>node.type==='section'&&node.props['aria-label']==='接續狀態');assert.equal(panels.length,1);return panels[0];};
const selectTab=(value,label)=>{const found=all(value,node=>node.props.role==='tab'&&text(node)===label);assert.equal(found.length,1);found[0].props.onClick();return render();};
const continuityMarker='合成接續獨有引文：舊場地尚未核准，不代表已開始。';
const continuityValue={status:'partial',reason:'model_material_incomplete',modelCalls:0,sourceLinks:[{...clone(source),ref:'r1'}],coverage:{selectedSources:2,modelMaterialSources:1,complete:false},projection:{knownEvolution:[{nodeId:'node-1',objectId:'synthetic-topic',topic:'合成場地安排',aspect:'開始條件',source:{ref:'r1',sourceAuthorRole:'user',citation:{text:continuityMarker}},time:{messageRecordedAt:source.messageRecordedAt},interpretation:{text:'使用者尚待場地核准；不是已執行的安排。',kind:'user_report',temporalUse:'current'},effectiveRelation:{status:'not_semantically_certified'}}],reasons:[{nodeId:'node-1',sourceAuthorRole:'user',citation:{text:'等待管理員正式回覆。'}}],unknowns:['場地是否核准仍未知。']}};
const continuityStateBefore=JSON.stringify(local.state),continuityCommandsBefore=commands.length;
tree=selectTab(tree,'接續狀態');
check('接續分頁缺投影不是空History或事件完成，切頁不發操作',()=>{const panel=continuityPanel(tree);assert.equal(panel.props.hidden,false);assert.ok(text(panel).includes('尚未讀回投影；不是沒有 History，也不是事件已完成'));assert.equal(JSON.stringify(local.state),continuityStateBefore);assert.equal(commands.length,continuityCommandsBefore);});
exactResponse={...clone(fixture),operation:'continuity',continuity:{status:'not_found',reason:'no_retained_projection',modelCalls:0}};
button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('正式continuity只送唯讀命令，沒有投影不宣稱History不存在',()=>{assert.deepEqual(commands.slice(continuityCommandsBefore),['continuity']);assert.equal(local.tab,'continuity');assert.equal(all(tree,node=>node.type===OfficialModal)[0].props.open,true);assert.ok(text(continuityPanel(tree)).includes('本對話尚無接續投影'));assert.ok(!text(continuityPanel(tree)).includes('History 為空'));assert.equal(JSON.stringify(local.state.snapshot),JSON.stringify(fixture.snapshot));assert.equal(JSON.stringify(local.state.sessionAuthorization),JSON.stringify(fixture.sessionAuthorization));});
exactResponse={...clone(fixture),operation:'continuity',continuity:clone(continuityValue)};
button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('partial接續明示材料不足並保留原角色原時間與引文',()=>{const value=text(continuityPanel(tree));assert.ok(value.includes('部分材料尚未提供給宿主，不能當作完整現況'));assert.ok(value.includes('來源核對不代表語意已認證'));assert.ok(value.includes('計畫不等於已執行'));assert.ok(value.includes('使用者回報不等於工具核實'));assert.ok(value.includes('原角色：使用者；原時間：'+source.messageRecordedAt));assert.ok(value.includes(continuityMarker));assert.ok(value.includes('理由引文（使用者）：等待管理員正式回覆。'));assert.ok(value.includes('場地是否核准仍未知。'));assert.equal(button(continuityPanel(tree),'正式原文').props.disabled,false);});
exactResponse=null;button(continuityPanel(tree),'正式原文').props.onClick();await tick();tree=render();
check('接續來源按鈕沿正式pointer版本hash有界reader且不補模型答案',()=>{const sent=commands.at(-1);assert.ok(sent.startsWith('original '));assert.deepEqual(JSON.parse(sent.slice(9)),{pointer,evidenceHash:source.evidenceHash,start:0,end:120,maxBytes:8192});assert.equal(local.tab,'sources');assert.ok(text(tree).includes('合成來源原文'));assert.equal(local.continuity,null);});
const readyContinuity={...clone(continuityValue),status:'ready',reason:null,coverage:{selectedSources:1,modelMaterialSources:1,complete:true}};
exactResponse={...clone(fixture),operation:'continuity',continuity:readyContinuity};tree=selectTab(tree,'接續狀態');button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('舊版未提供計畫分層時顯示未分列，ready不冒稱語意或執行授權',()=>{const value=text(continuityPanel(tree));assert.ok(value.includes('舊版投影未分列目前計畫'));assert.ok(value.includes('語意 尚未認證'));assert.ok(value.includes('執行授權 未授予'));});
readyContinuity.projection={...readyContinuity.projection,version:2,validation:{structure:'validated',source:'formal_reading_verified',semantics:'not_performed',executionAuthority:'none'},currentPlans:[{nodeId:'plan-v2',objectId:'合成準備',aspect:'時段',text:'計畫下午進行，尚未執行。',planStatus:'paused'}],currentClaims:[{nodeId:'report-v2',objectId:'合成準備',aspect:'聯絡',text:'使用者回報已寄出詢問。'}],unresolvedPlans:[{objectId:'合成準備',aspect:'標題',reason:'multiple_unresolved_plans'}],
 retentions:[{byNodeId:'plan-v2',citation:{text:'其他條件維持。'},targets:[{nodeId:'prior-condition',status:'revised_by_explicit_plan_relation'}]}],
 reasonRelations:[{kind:'prioritizes',citation:{text:'這次以時間安排優先。'},targetNodeIds:['prior-reason']}]};
exactResponse={...clone(fixture),operation:'continuity',continuity:readyContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('計畫、回報、真正歧義及驗證層級分開，工具ready不等於執行',()=>{const value=text(continuityPanel(tree));assert.ok(value.includes('目前計畫（不代表已執行）'));assert.ok(value.includes('計畫下午進行，尚未執行。'));assert.ok(value.includes('使用者回報已寄出詢問。'));assert.ok(value.includes('待釐清計畫：'));assert.ok(value.includes('語意 尚未認證'));assert.ok(value.includes('執行授權 未授予'));assert.equal(commands.at(-1),'continuity');});
check('維持範圍與理由優先如實呈現，不復活舊條件或冒稱撤回',()=>{const value=text(continuityPanel(tree));assert.ok(value.includes('計畫狀態：暫停'));assert.ok(value.includes('之後已明確修訂，不復活舊條件'));assert.ok(value.includes('優先考量：這次以時間安排優先。'));assert.ok(!value.includes('明示撤回：這次以時間安排優先。'));});
const planFragment={ref:'r1',sourceAuthorRole:'user',messageRecordedAt:source.messageRecordedAt,evidenceHash:source.evidenceHash,citation:{unit:'unicode_code_points',start:0,end:7,text:'仍須書面同意。'}};
const statusFragment={...planFragment,ref:'r2',messageRecordedAt:'2026-10-07T09:00:00Z',citation:{unit:'unicode_code_points',start:0,end:7,text:'製作部分先暫停'}};
readyContinuity.projection={...readyContinuity.projection,version:3,currentPlans:[{nodeId:'plan-v3',objectId:'合成準備',aspect:'製作',text:planFragment.citation.text,planStatus:'paused',conditionState:'present',textAuthority:'concatenated_formal_fragments_not_a_new_user_message',sourceFragments:[planFragment],statusSource:statusFragment,planVersion:'synthetic-plan-version-2',changeId:'pause-1'}],planChanges:[{id:'pause-1',kind:'status',targetNodeId:'plan-v3',source:statusFragment,priorVersion:'synthetic-plan-version-1',planVersion:'synthetic-plan-version-2'}],unresolvedPlans:[{objectId:'另一合成安排',aspect:'版本',reason:'competing_explicit_plan_change_branches',candidates:[{changeId:'branch-a',text:'分支甲'},{changeId:'branch-b',text:'分支乙'}]}]};
exactResponse={...clone(fixture),operation:'continuity',continuity:readyContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('v3 原條件與狀態分開呈現，片段保留原角色時間及正式原文入口',()=>{const panel=continuityPanel(tree),value=text(panel);assert.ok(value.includes('仍須書面同意。'));assert.ok(value.includes('計畫狀態：暫停'));assert.ok(value.includes('不是新的一則 User 原話'));assert.ok(value.includes('來源 r1；原角色：使用者；原時間：'+source.messageRecordedAt));assert.ok(value.includes('狀態修改原話：製作部分先暫停；原時間：2026-10-07T09:00:00Z'));assert.ok(value.includes('只改狀態，原條件保留'));assert.ok(all(panel,node=>node.type==='button'&&text(node)==='正式原文').some(node=>node.props.disabled===false));});
check('v3 競爭分支只展開未定材料，不把最後一個分支變成目前計畫',()=>{const value=text(continuityPanel(tree));assert.ok(value.includes('同一基底有未決修改分支，未依先後自行選定'));assert.ok(value.includes('尚未選定的修改分支'));assert.equal(commands.at(-1),'continuity');assert.equal(JSON.stringify(local.state.snapshot),JSON.stringify(fixture.snapshot));});
const reasonOnlyContinuity=clone(readyContinuity);
reasonOnlyContinuity.projection.planChanges=[{id:'reason-update',kind:'reason',targetNodeId:'plan-v3',source:statusFragment,reason:{...statusFragment,kind:'prioritizes',standing:'withdrawn_by_explicit_user_source'},reasonStatus:'provided'}];
reasonOnlyContinuity.projection.reasonRelations=[{kind:'withdraws',citation:{text:'明確撤回先前的優先考量。'},targetChangeIds:['reason-update']}];
exactResponse={...clone(fixture),operation:'continuity',continuity:reasonOnlyContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('理由專屬更新及撤回可呈現，不當成條件刪改且change目標不造成元件錯誤',()=>{const value=text(continuityPanel(tree));assert.ok(value.includes('只整理理由，條件與狀態保留'));assert.ok(value.includes('類型：優先考量'));assert.ok(value.includes('已有明示撤回來源'));assert.ok(value.includes('涉及 修改理由 reason-update'));assert.ok(value.includes('仍須書面同意。'));assert.ok(value.includes('計畫狀態：暫停'));assert.equal(commands.at(-1),'continuity');assert.equal(JSON.stringify(local.state.snapshot),JSON.stringify(fixture.snapshot));});
const annotatedContinuity=clone(readyContinuity);
annotatedContinuity.scopeId='synthetic-presentation-scope';annotatedContinuity.projectionHash='a'.repeat(64);
const annotatedPlan=annotatedContinuity.projection.currentPlans[0];
annotatedPlan.text='每次兩份。舊理由🙂已撤。其他條件維持。';
const annotatedPoints=[...annotatedPlan.text],annotationStart=annotatedPoints.indexOf('舊'),annotationEnd=annotationStart+[...'舊理由🙂已撤'].length;
annotatedContinuity.presentation={kind:'cmcp_continuity_presentation',version:1,status:'available',scopeId:annotatedContinuity.scopeId,projectionHash:annotatedContinuity.projectionHash,plans:[{nodeId:annotatedPlan.nodeId,planVersion:annotatedPlan.planVersion,annotations:[{kind:'withdrawn_reason_source_text',range:{unit:'unicode_code_points',start:annotationStart,end:annotationEnd,text:'舊理由🙂已撤'}}]}]};
exactResponse={...clone(fixture),operation:'continuity',continuity:annotatedContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('已撤回理由依Unicode精確範圍標歷史，不把其他條件或整案刪除',()=>{const panel=continuityPanel(tree),marks=all(panel,node=>node.type==='mark'),value=text(panel);assert.equal(marks.length,1);assert.ok(text(marks[0]).startsWith('舊理由🙂已撤'));assert.ok(text(marks[0]).includes('已撤回理由的原文，保留歷史'));assert.ok(value.includes('每次兩份。'));assert.ok(value.includes('其他條件維持。'));assert.ok(!value.includes('仍有效的原文片段'));assert.ok(value.includes('保留文字不代表歷史理由仍適用'));assert.equal(annotatedPlan.text,'每次兩份。舊理由🙂已撤。其他條件維持。');assert.equal(JSON.stringify(local.state.snapshot),JSON.stringify(fixture.snapshot));});
for(const [label,mutate]of [['scope異動',v=>v.presentation.scopeId='another-scope'],['投影版本異動',v=>v.presentation.projectionHash='b'.repeat(64)],['計畫版本異動',v=>v.presentation.plans[0].planVersion='old-version'],['字元不符',v=>v.presentation.plans[0].annotations[0].range.text='不同原文'],['範圍超界',v=>v.presentation.plans[0].annotations[0].range.end=999]]){
 const mismatched=clone(annotatedContinuity);mutate(mismatched);exactResponse={...clone(fixture),operation:'continuity',continuity:mismatched};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
 check('理由呈現拒用'+label+'註記且保留原文供查證',()=>{const panel=continuityPanel(tree);assert.equal(all(panel,node=>node.type==='mark').length,0);assert.ok(text(panel).includes('理由註記未能與目前投影核對'));assert.ok(text(panel).includes(annotatedPlan.text));assert.equal(JSON.stringify(local.state.snapshot),JSON.stringify(fixture.snapshot));});
}
for(const [label,mutate,expected]of [
 ['舊版缺註記',v=>delete v.presentation,'此投影未提供精確理由註記'],
 ['明示不可提供註記',v=>{v.presentation.status='not_available';v.presentation.plans=[];},'此投影未提供精確理由註記'],
 ['未知註記狀態',v=>{delete v.presentation.status;},'理由註記未能與目前投影核對'],
 ['合法空註記',v=>{v.presentation.plans=[];},'保留文字不代表歷史理由仍適用']]){
 const value=clone(annotatedContinuity);mutate(value);exactResponse={...clone(fixture),operation:'continuity',continuity:value};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
 check('理由呈現區分'+label+'且不宣告全部有效',()=>{const panel=continuityPanel(tree);assert.equal(all(panel,node=>node.type==='mark').length,0);assert.ok(text(panel).includes(expected));assert.ok(text(panel).includes(annotatedPlan.text));assert.ok(!text(panel).includes('仍有效的原文片段'));assert.equal(JSON.stringify(local.state.snapshot),JSON.stringify(fixture.snapshot));});
}
const unestablishedContinuity=clone(readyContinuity);
unestablishedContinuity.projection.currentPlans=[];
unestablishedContinuity.projection.planBasis=[{nodeId:'possible-a',candidates:[{nodeId:'possible-a',objectId:'甲案',aspect:'尺寸',text:'保留正式尺寸原件',planStatus:'paused',sourceFragments:[planFragment],statusSource:statusFragment}]},{nodeId:'possible-b',candidates:[{nodeId:'possible-b',objectId:'乙案',aspect:'場地',text:'另一案仍在商議',planStatus:'planned',sourceFragments:[planFragment]}]}];
unestablishedContinuity.projection.unresolvedPlans=[{nodeIds:['possible-a','possible-b'],reason:'plan_currentness_not_established',temporalUse:'unspecified',candidateSource:{collection:'planBasis',key:'nodeId'}}];
exactResponse={...clone(fixture),operation:'continuity',continuity:unestablishedContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('未確立群組依正式基底引用呈現各案，不冒充目前計畫或同案',()=>{const panel=continuityPanel(tree),value=text(panel);assert.ok(value.includes('目前效力尚未確立：2 項'));assert.ok(value.includes('不表示同一案件'));assert.ok(value.includes('甲案／尺寸：保留正式尺寸原件；候選狀態：暫停'));assert.ok(value.includes('乙案／場地：另一案仍在商議'));assert.ok(value.includes('未確立候選的正式原文、時間與版本'));assert.ok(all(panel,node=>node.type==='button'&&text(node)==='正式原文').some(node=>!node.props.disabled));assert.equal(JSON.stringify(local.state.snapshot),JSON.stringify(fixture.snapshot));assert.equal(JSON.stringify(local.state.sessionAuthorization),JSON.stringify(fixture.sessionAuthorization));});
unestablishedContinuity.projection.planBasis=[];
exactResponse={...clone(fixture),operation:'continuity',continuity:unestablishedContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('未確立候選引用缺件明示而不變成空集合',()=>{const value=text(continuityPanel(tree));assert.ok(value.includes('尚未取得對應基底：possible-a'));assert.ok(!value.includes('甲案／尺寸'));assert.equal(commands.at(-1),'continuity');});
unestablishedContinuity.projection.unresolvedPlans[0].candidateSource.collection='not-authorized';
exactResponse={...clone(fixture),operation:'continuity',continuity:unestablishedContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('未知候選引用不解析任意欄位或執行操作',()=>{const value=text(continuityPanel(tree));assert.ok(value.includes('候選引用未提供或格式不符，不能判定為空集合'));assert.equal(commands.at(-1),'continuity');assert.equal(JSON.stringify(local.state.snapshot),JSON.stringify(fixture.snapshot));});
readyContinuity.projection.reasons[0].binding={kind:'plan_basis',nodeId:'node-1',basisVersion:'synthetic-original-version',source:planFragment};
readyContinuity.projection.planChanges[0].reasonStatus='not_provided';
exactResponse={...clone(fixture),operation:'continuity',continuity:readyContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('原理由綁原計畫，修改未附理由與沒有理由分開，讀回不改控制',()=>{const value=text(continuityPanel(tree));assert.ok(value.includes('等待管理員正式回覆。'));assert.ok(value.includes('歸屬原計畫基底，不自動成為後續修改原因。'));assert.ok(value.includes('本次修改未附理由關係；不代表原文沒有理由'));assert.equal(all(continuityPanel(tree),node=>node.type==='p').some(node=>all(node,child=>child.type==='details').length>0),false,'段落不能包原生details區塊');assert.equal(JSON.stringify(local.state.snapshot),JSON.stringify(fixture.snapshot));assert.equal(JSON.stringify(local.state.sessionAuthorization),JSON.stringify(fixture.sessionAuthorization));});
readyContinuity.projection.planChanges[0].reasonStatus='provided';readyContinuity.projection.planChanges[0].reason={...statusFragment,ref:'r1',citation:{text:'本次因人力不足先停製作。'},binding:{kind:'plan_change',nodeId:'plan-v3',changeId:'pause-1',priorVersion:'synthetic-plan-version-1',planVersion:'synthetic-plan-version-2'}};
exactResponse={...clone(fixture),operation:'continuity',continuity:readyContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('本次變更理由另列正式引文與原時間，保留舊理由及正式reader入口',()=>{const panel=continuityPanel(tree),value=text(panel);assert.ok(value.includes('本次修改明說的理由（使用者）：本次因人力不足先停製作。'));assert.ok(value.includes('；原時間：2026-10-07T09:00:00Z'));assert.ok(value.includes('類型：未另分列'));assert.ok(value.includes('等待管理員正式回覆。'));assert.ok(!value.includes('本次修改未附理由關係'));assert.ok(all(panel,node=>node.type==='button'&&text(node)==='正式原文').some(node=>!node.props.disabled));assert.equal(commands.at(-1),'continuity');});
readyContinuity.projection.planEvidence=[{nodeId:'pause-evidence',objectId:'合成準備',aspect:'暫停依據',source:{...statusFragment,ref:'r1'},targetNodeIds:['plan-v3'],uses:[{kind:'plan_change',targetNodeId:'plan-v3',changeId:'pause-1'}],authority:'source_bound_plan_evidence_not_an_independent_plan'}];
exactResponse={...clone(fixture),operation:'continuity',continuity:readyContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('純暫停證據另列可查來源，不展示為額外待執行計畫',()=>{const panel=continuityPanel(tree),section=all(panel,node=>node.type==='details'&&text(node).startsWith('修改與理由的原文證據'))[0];assert.ok(section);assert.ok(text(section).includes(statusFragment.citation.text));assert.ok(text(section).includes('原時間：2026-10-07T09:00:00Z'));assert.ok(!text(section).includes('計畫狀態：待執行'));assert.ok(all(section,node=>node.type==='button'&&text(node)==='正式原文').some(node=>!node.props.disabled));assert.equal(commands.at(-1),'continuity');assert.equal(JSON.stringify(local.state.snapshot),JSON.stringify(fixture.snapshot));assert.equal(JSON.stringify(local.state.sessionAuthorization),JSON.stringify(fixture.sessionAuthorization));});
const namedReasonContinuity=clone(readyContinuity);
delete namedReasonContinuity.projection.reasons;
for(const change of namedReasonContinuity.projection.planChanges)delete change.reason;
Object.assign(namedReasonContinuity.projection.planChanges[0],{reasonStatus:'provided_by_binding',priorVersion:'named-prior-version',planVersion:'named-current-version'});
const basisReason=(reasonId,quote,standing='not_explicitly_withdrawn')=>({...clone(planFragment),reasonId,citation:{unit:'unicode_code_points',start:0,end:[...quote].length,text:quote},standing,
  relationAuthority:'host_proposed_reason_relation_not_semantically_verified',binding:{kind:'plan_basis',nodeId:'plan-v3',basisVersion:'named-basis-version',source:clone(planFragment)},reasonVersion:(reasonId==='basis-a'?'c':'d').repeat(64)});
namedReasonContinuity.projection.reasonBindings=[basisReason('basis-a','運送箱需防潮。','withdrawn_by_explicit_user_source'),basisReason('basis-b','方便現場清點。'),
  {...clone(statusFragment),reasonId:'change-c',citation:{unit:'unicode_code_points',start:0,end:[...'這次以搬運空間優先。'].length,text:'這次以搬運空間優先。'},kind:'prioritizes',standing:'not_explicitly_withdrawn',relationAuthority:'host_proposed_reason_relation_not_semantically_verified',
    binding:{kind:'plan_change',nodeId:'plan-v3',changeId:'pause-1',priorVersion:'named-prior-version',planVersion:'named-current-version'},reasonVersion:'e'.repeat(64)}];
namedReasonContinuity.projection.reasonRelations=[{kind:'withdraws',fromNodeId:'pause-evidence',targetReasonIds:['basis-a'],ref:'r2',citation:{text:'只撤回防潮的考量。'},sourceAuthorRole:'user',messageRecordedAt:statusFragment.messageRecordedAt,effect:'withdraws_only_named_reasons'}];
namedReasonContinuity.sourceLinks.push({...clone(source),id:'catalog-source-2',ref:'r2',pointer:{...clone(pointer),itemId:'source-item-2'},messageRecordedAt:statusFragment.messageRecordedAt});
const namedInputBefore=JSON.stringify(namedReasonContinuity),namedStateBefore=JSON.stringify(local.state.snapshot),namedAuthorizationBefore=JSON.stringify(local.state.sessionAuthorization);
exactResponse={...clone(fixture),operation:'continuity',continuity:namedReasonContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
const namedRow=(value,id)=>{const rows=all(continuityPanel(value),node=>node.props.role==='group'&&node.props['aria-label']==='具名理由 '+id);assert.equal(rows.length,1);return rows[0];};
const changeReasonsSummary=value=>all(continuityPanel(value),node=>node.type==='p'&&text(node).startsWith('本次修改')).map(text);
check('v6 修改回執 provided_by_binding 明示同對象同版本的具名理由，不顯示未附',()=>{assert.deepEqual(changeReasonsSummary(tree),['本次修改已分列具名理由：change-c；引文、原時間與各自效力見具名理由明細。']);});
check('v6 同一基底多個具名理由只撤回指定對象，其餘不誤標撤回或保證有效',()=>{
  const first=text(namedRow(tree,'basis-a')),second=text(namedRow(tree,'basis-b')),panel=text(continuityPanel(tree));
  assert.ok(first.includes('運送箱需防潮。'));assert.ok(first.includes('已有明示撤回來源'));assert.ok(!first.includes('未提供明示撤回；目前適用性'));
  assert.ok(second.includes('方便現場清點。'));assert.ok(second.includes('未提供明示撤回；目前適用性仍依來源判斷'));assert.ok(!second.includes('已有明示撤回來源'));
  assert.ok(panel.includes('明示撤回：只撤回防潮的考量。；涉及 具名理由 basis-a'));assert.ok(!panel.includes('涉及 具名理由 basis-a、basis-b'));
  assert.equal(JSON.stringify(namedReasonContinuity),namedInputBefore);assert.equal(namedReasonContinuity.projection.reasons,undefined);assert.ok(namedReasonContinuity.projection.planChanges.every(row=>!row.reason));
});
check('v6 理由基底與修改各列原角色時間及版本，reader沿既有正式sourceLinks',()=>{
  const base=namedRow(tree,'basis-b'),change=namedRow(tree,'change-c'),value=text(change);
  assert.ok(text(base).includes('來源 r1；原角色：使用者；原時間：'+source.messageRecordedAt));assert.ok(text(base).includes('歸屬原計畫基底：plan-v3；基底版本：named-basis-version'));
  assert.ok(text(base).includes('理由版本：'+'d'.repeat(64)));assert.ok(value.includes('原時間：'+statusFragment.messageRecordedAt));assert.ok(value.includes('歸屬計畫：plan-v3；修改：pause-1；修改前版本：named-prior-version；修改後版本：named-current-version'));
  assert.ok(value.includes('理由版本：'+'e'.repeat(64)));assert.ok(value.includes('理由關係類型：優先考量'));assert.ok(value.includes('來源核對不代表語意已認證，也不授予執行權'));
  assert.equal(button(base,'正式原文').props.disabled,false);assert.equal(button(change,'正式原文').props.disabled,false);
});
const namedCommandsBefore=commands.length;tree=render();
check('具名理由只有既有按需details，重新渲染不讀取不修改授權時間TTL或原投影',()=>{
  const section=all(continuityPanel(tree),node=>node.type==='details'&&text(node).startsWith('具名理由與各自效力｜3 筆'))[0];assert.ok(section);assert.equal(section.props.open,undefined);assert.equal(section.props.onToggle,undefined);
  assert.equal(commands.length,namedCommandsBefore);assert.equal(JSON.stringify(local.state.snapshot),namedStateBefore);assert.equal(JSON.stringify(local.state.sessionAuthorization),namedAuthorizationBefore);assert.equal(JSON.stringify(namedReasonContinuity),namedInputBefore);
});
const staleReasonStatus=clone(namedReasonContinuity);staleReasonStatus.projection.planChanges[0].reasonStatus='not_provided';
exactResponse={...clone(fixture),operation:'continuity',continuity:staleReasonStatus};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('已驗具名理由存在時不因舊 reasonStatus 誤稱本次未附理由',()=>{assert.deepEqual(changeReasonsSummary(tree),['本次修改已分列具名理由：change-c；引文、原時間與各自效力見具名理由明細。']);});
for(const [label,mutate] of [['不同歸屬',row=>row.binding.nodeId='another-plan'],['不同修改版本',row=>row.binding.planVersion='another-version']]){
  const mismatchedReason=clone(namedReasonContinuity);mutate(mismatchedReason.projection.reasonBindings[2]);
  exactResponse={...clone(fixture),operation:'continuity',continuity:mismatchedReason};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
  check('修改理由拒用'+label+'的同名理由且缺件不誤稱未附',()=>{assert.deepEqual(changeReasonsSummary(tree),['本次修改回執標示已附具名理由，但尚未取得同對象／版本的理由明細；不能判為未附理由。']);assert.equal(JSON.stringify(local.state.snapshot),namedStateBefore);});
}
const unknownReasonContinuity=clone(namedReasonContinuity);delete unknownReasonContinuity.projection.reasonBindings[0].standing;unknownReasonContinuity.sourceLinks=[];
exactResponse={...clone(fixture),operation:'continuity',continuity:unknownReasonContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('具名理由效力缺件明示未知，沒有正式sourceLinks時不以binding拼reader授權',()=>{const row=namedRow(tree,'basis-a'),value=text(row);assert.ok(value.includes('理由效力未知，不能判為仍有效或已撤回'));assert.ok(!value.includes('已有明示撤回來源'));assert.ok(!value.includes('未提供明示撤回；目前適用性'));assert.equal(all(row,node=>node.type==='button'&&text(node)==='正式原文').length,0);});
const emptyReasonContinuity=clone(namedReasonContinuity);emptyReasonContinuity.projection.reasonBindings=[];
exactResponse={...clone(fixture),operation:'continuity',continuity:emptyReasonContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('具名理由空集合只說投影未分列，不推論原文沒有理由',()=>{assert.ok(text(continuityPanel(tree)).includes('此投影未分列具名理由；不代表原文沒有理由'));assert.equal(all(continuityPanel(tree),node=>node.props.role==='group'&&node.props['aria-label']?.startsWith('具名理由 ')).length,0);});
exactResponse={...clone(fixture),operation:'continuity',continuity:readyContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
check('切回舊格式保留基底與修改理由，不要求具名集合或改寫舊投影',()=>{const value=text(continuityPanel(tree));assert.ok(!value.includes('具名理由與各自效力'));assert.ok(value.includes('理由引文（使用者）：等待管理員正式回覆。'));assert.ok(value.includes('本次修改明說的理由（使用者）：本次因人力不足先停製作。'));assert.equal(readyContinuity.projection.reasonBindings,undefined);});
const beforeContinuityClose=commands.length;
all(tree,node=>node.type===OfficialModal)[0].props.onClose();tree=render();
check('關閉Modal清除接續投影全部前端cache，不只是隱藏內容',()=>{assert.equal(local.continuity,null);assert.ok(!JSON.stringify(hooks).includes(continuityMarker));assert.equal(all(tree,node=>node.type===OfficialModal)[0].props.open,false);assert.equal(commands.length,beforeContinuityClose);});
local.open=true;tree=selectTab(render(),'接續狀態');button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
const beforeContinuityTabs=commands.length;
tree=selectTab(tree,'Buffer');tree=selectTab(tree,'接續狀態');
check('換tab清除接續投影cache，再返回須正式重驗且不自動讀取',()=>{assert.equal(local.continuity,null);assert.ok(!JSON.stringify(hooks).includes(continuityMarker));assert.ok(text(continuityPanel(tree)).includes('尚未讀回投影'));assert.equal(commands.length,beforeContinuityTabs);});
button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();exactResponse={...clone(fixture),operation:'status'};
button(tree,'重新讀取（唯讀）').props.onClick();await tick();tree=render();
check('正式status使先前接續投影失效，唯讀刷新不保留舊衍生內容',()=>{assert.equal(local.continuity,null);assert.ok(!JSON.stringify(hooks).includes(continuityMarker));assert.equal(commands.at(-1),'status');});
exactResponse={...clone(fixture),operation:'continuity',continuity:readyContinuity};button(continuityPanel(tree),'讀取並核對目前接續投影').props.onClick();await tick();tree=render();
exactResponse={...clone(fixture),operation:'status',snapshot:{...clone(fixture.snapshot),controlConfiguration:{generation:'generation-2',effective:{...control,historyRecall:false}}}};
button(tree,'重新讀取（唯讀）').props.onClick();await tick();tree=render();
check('閱讀控制撤回清除接續cache且停用正式投影讀取',()=>{assert.equal(local.continuity,null);assert.ok(!JSON.stringify(hooks).includes(continuityMarker));assert.equal(button(continuityPanel(tree),'讀取並核對目前接續投影').props.disabled,true);});
check('接續UI測試只有continuity原文status命令，零額外模型控制或TTL改寫',()=>{assert.ok(commands.slice(continuityCommandsBefore).every(command=>command==='continuity'||command==='status'||command.startsWith('original ')));assert.equal(JSON.stringify(local.state.snapshot.buffer),JSON.stringify(fixture.snapshot.buffer));assert.equal(JSON.stringify(local.state.snapshot.timeCard),JSON.stringify(fixture.snapshot.timeCard));assert.equal(JSON.stringify(local.state.sessionAuthorization),JSON.stringify(fixture.sessionAuthorization));assert.equal(local.state.snapshot.dispatchObservation.modelCalls,0);assert.equal(JSON.stringify(local.state.snapshot.pins),JSON.stringify(fixture.snapshot.pins));});
exactResponse=null;responseOverride=null;local.state=clone(fixture);local.original=null;local.continuity=null;tree=selectTab(render(),'來源與原件');
const imageBody='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7eUAAAAASUVORK5CYII=';
const media={mediaId:'media-original-A',filename:'synthetic-original.png',mimeType:'image/png',bytes:68,sha256:'b'.repeat(64),originalStatus:'stored',availability:{state:'available',reason:null},parent:{sourceAuthorRole:'user',sessionId:'session-A',scopeId:'scope-A',sourcePointer:pointer,evidenceHash:source.evidenceHash,messageRecordedAt:source.messageRecordedAt}};
const mediaSecond={...media,mediaId:'media-original-B',filename:'synthetic-revision.png',sha256:'c'.repeat(64)};
responseOverride={mediaList:{items:[media,mediaSecond],total:2,shown:2,truncated:false,limit:16,source:{sourceAuthorRole:'user',messageRecordedAt:source.messageRecordedAt,sourcePointer:pointer,evidenceHash:source.evidenceHash,text:'這是隨兩張合成圖片提交的原說明。'}}};
exactResponse={kind:'cmcp_desktop_response',operation:'media-list',enabled:true,sessionId:'session-A',mediaList:responseOverride.mediaList};
const beforeMinimalList=JSON.stringify(local.state);
button(tree,'圖片原件').props.onClick();await tick();tree=render();
check('真host minimal media-list不覆蓋snapshot、來源清冊或控制',()=>assert.equal(JSON.stringify(local.state),beforeMinimalList));exactResponse=null;
check('圖片清冊沿正式pointer與evidenceHash，不依檔名硬選取',()=>{assert.deepEqual(JSON.parse(commands.at(-1).slice(11)),{pointer,evidenceHash:source.evidenceHash});assert.ok(text(tree).includes(media.filename));assert.ok(text(tree).includes(mediaSecond.filename));assert.ok(text(tree).includes('這是隨兩張合成圖片提交的原說明。'));assert.ok(text(tree).includes(source.messageRecordedAt));});
check('真store availability／originalStatus與parent呈現可用原件，不誤報未知',()=>{assert.ok(text(tree).includes('狀態：原件可用；保存：原件已保存'));assert.ok(text(tree).includes('角色：使用者；原時間：'+source.messageRecordedAt));assert.ok(all(tree,node=>node.type==='button'&&text(node)==='查看圖片原件').every(node=>node.props.disabled===false));});
responseOverride={mediaOriginal:{metadata:media,dataUrl:imageBody,modelCalls:0}};
all(tree,node=>node.type==='button'&&text(node)==='查看圖片原件')[1].props.onClick();await tick();tree=render();
check('兩張相近原件使用各自mediaId與正式來源版本暫態讀取',()=>{assert.deepEqual(mediaReads.at(-1),{pointer,evidenceHash:source.evidenceHash,mediaId:mediaSecond.mediaId});assert.ok(commands.every(value=>!value.startsWith('media-read')));});
check('圖片預覽使用正式讀取結果，dataURL不入一般state或JSON回執',()=>{const image=all(tree,node=>node.type==='img')[0];assert.equal(image.props.src,imageBody);assert.ok(!JSON.stringify(local.state).includes(imageBody));assert.ok(all(tree,node=>node.type==='pre').every(node=>!text(node).includes(imageBody)));assert.ok(commands.every(value=>!value.includes('base64')));});
const beforeImageToggle=commands.length,sourceState=JSON.stringify(local.state);
all(tree,node=>node.props.role==='tab'&&text(node)==='Buffer')[0].props.onClick();tree=render();all(tree,node=>node.props.role==='tab'&&text(node)==='來源與原件')[0].props.onClick();tree=render();
check('圖片分頁切換不重讀原件、不刷新來源時間／TTL 或模型',()=>{assert.equal(commands.length,beforeImageToggle);assert.equal(JSON.stringify(local.state),sourceState);assert.equal(all(tree,node=>node.type==='img').length,1);});
const beforeImageError=commands.length;all(tree,node=>node.type==='img')[0].props.onError();tree=render();
check('宿主圖片呈現失敗清除預覽，不聲稱已查看或改控制',()=>{assert.equal(all(tree,node=>node.type==='img').length,0);assert.ok(text(tree).includes('不能宣稱已查看'));assert.equal(commands.length,beforeImageError);});
responseOverride={mediaOriginal:{metadata:{...media,bytes:8*1024*1024+1},dataUrl:imageBody}};button(tree,'重新讀取（唯讀）').props.onClick();await tick();
// 正式 read 的不可呈現結果以 local state 投影覆核；不冒充 backend 8 MiB 守護測試。
local.mediaOriginal={metadata:{...media,bytes:8*1024*1024+1},dataUrl:imageBody};tree=render();
check('超過8MiB或非PNG/JPEG不當成可呈現正式原件',()=>{assert.equal(all(tree,node=>node.type==='img').length,0);assert.ok(text(tree).includes('不超過 8 MiB'));local.mediaOriginal={metadata:media,dataUrl:'data:image/gif;base64,R0lG'};assert.equal(all(render(),node=>node.type==='img').length,0);});
local.mediaOriginal={metadata:media,dataUrl:imageBody};responseOverride={error:{code:'cmcp_media_hash_mismatch'}};tree=render();button(tree,'重新讀取（唯讀）').props.onClick();await tick();tree=render();
check('正式來源拒絕時清除舊清冊與預覽，不用舊描述替代',()=>{assert.equal(local.mediaList,null);assert.equal(local.mediaOriginal,null);assert.equal(local.mediaContext,null);assert.ok(text(tree).includes('cmcp_media_hash_mismatch'));});
local.state=clone(fixture);local.mediaList={items:[media]};local.mediaOriginal={metadata:media,dataUrl:imageBody};local.mediaContext={pointer,evidenceHash:source.evidenceHash};responseOverride={enabled:false,enhancementBlockedReasons:['shared_clean'],snapshot:{controlConfiguration:{generation:'generation-2',effective:{...control,clean:true}}}};tree=render();button(tree,'重新讀取（唯讀）').props.onClick();await tick();
check('OFF／Clean回覆不保留任何舊圖片預覽',()=>assert.equal(local.mediaOriginal,null));
local.state=clone(fixture);local.mediaList={items:[media]};local.mediaOriginal={metadata:media,dataUrl:imageBody};local.mediaContext={pointer,evidenceHash:source.evidenceHash};responseOverride={snapshot:{...clone(fixture.snapshot),registration:{sources:[{...source,evidenceHash:'d'.repeat(64)}]}}};tree=render();button(tree,'重新讀取（唯讀）').props.onClick();await tick();
check('刷新發現正式來源hash變版時清除舊原件',()=>assert.equal(local.mediaOriginal,null));
local.state=clone(fixture);local.mediaList={items:[{...media,availability:{state:'unsupported',reason:'media_type_unsupported'}}]};local.mediaOriginal=null;local.mediaContext={pointer,evidenceHash:source.evidenceHash};responseOverride=null;tree=render();
check('不支援媒體明示且不能套用舊原件讀取',()=>{assert.ok(text(tree).includes('此路徑不支援的媒體類型'));assert.ok(button(tree,'查看圖片原件').props.disabled);});
local.state.snapshot.trace={entries:[{kind:'model_input',at:'2026-10-02T00:01:00Z'},{kind:'assistant_saved',at:'2026-10-02T00:02:00Z',receipt:{sourcePointer:pointer}}]};tree=render();
check('最近來源操作來自正式trace.entries有pointer的事件，不猜模型內部',()=>assert.ok(text(tree).includes('保存助手原文 2026-10-02T00:02:00Z')));
const slot=registration.inject('session-A'),rpcRequest={pointer,evidenceHash:source.evidenceHash,mediaId:media.mediaId},rpcSignal=new AbortController().signal;
rpcResult={ok:true,value:{kind:'cmcp_desktop_response',operation:'media-read',enabled:true,sessionId:'session-A',scopeId:'scope-A',mediaOriginal:{metadata:media,dataUrl:imageBody,modelCalls:0}}};
await slot.readMedia(rpcRequest,rpcSignal);
check('slot只掛載專屬Gateway schema一次，不用nativecommand',()=>{assert.equal(mountCalls.length,1);assert.equal(mountCalls[0].package,'cmcp-desktop-native-media');assert.equal(mountCalls[0].descriptors.length,1);assert.equal(mountCalls[0].descriptors[0].namespace,'cmcpMediaOriginals');assert.equal(mountCalls[0].descriptors[0].method,'read');assert.equal(mountCalls[0].descriptors[0].cancellation.parameter,'signal');});
check('RPC namespace先掛載再由子fiber注入，不形成父apply等待循環',()=>{assert.equal(dynamicInjectCalls.length,1);assert.deepEqual(dynamicInjectCalls[0].names,['remote.cmcpMediaOriginals']);assert.equal(dynamicInjectCalls[0].mountCallsAtCreation,1);assert.ok(!module.inject.includes('remote.cmcpMediaOriginals'));});
check('官方Cordis未注入父context反例被保留，正式呼叫沿已注入child成功',()=>{assert.throws(()=>parentContext.remote.cmcpMediaOriginals,/without inject/);assert.ok(rpcReads.length>0);});
check('slot綁目前session與正式scope pointer並傳遞abort signal',()=>{assert.deepEqual(rpcReads.at(-1).request,{sessionId:'session-A',...rpcRequest});assert.equal(rpcReads.at(-1).signal,rpcSignal);});
await slot.readMedia({...rpcRequest,sessionId:'private-Z'},rpcSignal);
check('payload不能改寫slot綁定的Session身分',()=>assert.equal(rpcReads.at(-1).request.sessionId,'session-A'));
rpcResult={ok:false,error:{code:'cmcp_media_source_revoked'}};await assert.rejects(slot.readMedia(rpcRequest,rpcSignal),/cmcp_media_source_revoked/);checks.push({name:'RPC拒絕回覆保留正式原因，不能當成功',status:'PASS'});
rpcResult={ok:true,value:{kind:'cmcp_desktop_response',operation:'media-read',enabled:true,sessionId:'session-Z',mediaOriginal:{metadata:media,dataUrl:imageBody,modelCalls:0}}};await assert.rejects(slot.readMedia(rpcRequest,rpcSignal),/cmcp_media_rpc_session_mismatch/);checks.push({name:'成功封套仍核對目前Session，不錯投原件',status:'PASS'});
rpcResult={ok:true,value:{kind:'cmcp_desktop_response',operation:'media-read',enabled:true,sessionId:'session-A',scopeId:'scope-Z',mediaOriginal:{metadata:media,dataUrl:imageBody,modelCalls:0}}};await assert.rejects(slot.readMedia(rpcRequest,rpcSignal),/cmcp_media_rpc_session_mismatch/);checks.push({name:'回包scope須與正式來源一致',status:'PASS'});
rpcResult={ok:true,value:{kind:'cmcp_desktop_response',operation:'media-read',enabled:true,sessionId:'session-A',mediaOriginal:{metadata:mediaSecond,dataUrl:imageBody,modelCalls:0}}};await assert.rejects(slot.readMedia(rpcRequest,rpcSignal),/cmcp_media_rpc_original_mismatch/);checks.push({name:'回傳原件mediaId與要求不符時拒絕，不以相似圖片替代',status:'PASS'});
rpcResult={ok:true,value:{kind:'cmcp_desktop_response',operation:'media-read',enabled:true,sessionId:'session-A',mediaOriginal:{metadata:media,dataUrl:imageBody,modelCalls:1}}};await assert.rejects(slot.readMedia(rpcRequest,rpcSignal),/cmcp_media_rpc_contract_invalid/);checks.push({name:'reader回包不得宣告模型呼叫或放寬schema',status:'PASS'});
const aborted=new AbortController();aborted.abort();const beforeAbort=rpcReads.length;await assert.rejects(slot.readMedia(rpcRequest,aborted.signal),/cmcp_media_rpc_cancelled/);check('已取消的讀取不發RPC',()=>assert.equal(rpcReads.length,beforeAbort));
sessionOpen=false;const beforeClosed=rpcReads.length;await assert.rejects(slot.readMedia(rpcRequest,rpcSignal),/Session 尚未開啟/);check('未開啟Session不呼叫Gateway',()=>assert.equal(rpcReads.length,beforeClosed));sessionOpen=true;
for(const cleanup of childCleanups)if(typeof cleanup==='function')cleanup();const beforeWithdrawn=rpcReads.length;
await assert.rejects(slot.readMedia(rpcRequest,rpcSignal),/cmcp_media_rpc_namespace_unavailable/);
check('namespace撤回後停用暫態reader，不追加RPC或改正式控制',()=>assert.equal(rpcReads.length,beforeWithdrawn));
const emitCommand=(data,{sessionId='session-A',name='cmcp'}={})=>eventListeners.get('command/executed')(sessionId,name,{kind:'success',text:JSON.stringify(data)});
local.state=clone(fixture);responseOverride=null;exactResponse=null;render();
const preferenceStorageKey=JSON.stringify(['cmcp-native-ui',1,'synthetic-workspace','scope-A']),beforeNativeCommands=commands.length;
emitCommand({...clone(fixture),operation:'ui',uiPreference:'hidden'});tree=render();
check('原生ui hidden只隱藏入口並關閉Modal，沒有額外RPC或授權改寫',()=>{assert.equal(all(tree,node=>node.props['aria-label']==='CMCP 原生接入狀態').length,0);assert.equal(all(tree,node=>node.type===OfficialModal)[0].props.open,false);assert.equal(storage.get(preferenceStorageKey),'hidden');assert.equal(JSON.stringify(local.state.sessionAuthorization),JSON.stringify(fixture.sessionAuthorization));assert.equal(JSON.stringify(local.state.snapshot.controlConfiguration),JSON.stringify(fixture.snapshot.controlConfiguration));assert.equal(commands.length,beforeNativeCommands);});
const hiddenState=JSON.stringify(local.state);
emitCommand({...clone(fixture),operation:'menu'},{sessionId:'session-B'});
emitCommand({...clone(fixture),operation:'menu'},{name:'other'});
emitCommand({...clone(fixture),operation:'menu',sessionId:'session-B'});
check('native listener拒絕其他命令與錯投Session，不開啟隱藏選單',()=>{assert.equal(JSON.stringify(local.state),hiddenState);assert.equal(all(render(),node=>node.type===OfficialModal)[0].props.open,false);});
emitCommand({...clone(fixture),operation:'menu',menu:{scope:{scopeId:'scope-A',sessionId:'session-A'},operations:[{command:'help / menu',description:'操作選單與目前範圍'},{command:'ui minimized|row|hidden',description:'只改顯示偏好，不改授權'}],instructions:'數字選項只在本次清冊及有效期間內使用。',unsupported:[]}});tree=render();
check('隱藏時正式native menu開原Modal而不恢復入口或改授權',()=>{assert.equal(all(tree,node=>node.type===OfficialModal)[0].props.open,true);assert.equal(all(tree,node=>node.props['aria-label']==='CMCP 原生接入狀態').length,0);assert.equal(storage.get(preferenceStorageKey),'hidden');assert.equal(commands.length,beforeNativeCommands);});
check('原生選單顯示正式操作描述與完整命令前綴，不執行所列操作',()=>{const menu=all(tree,node=>node.props['aria-label']==='CMCP 通用命令')[0];assert.ok(text(menu).includes('/cmcp help 或 /cmcp menu'));assert.ok(text(menu).includes('/cmcp ui minimized|row|hidden'));assert.ok(text(menu).includes('只改顯示偏好，不改授權'));assert.ok(text(menu).includes('/cmcp sources 2'));assert.ok(!text(menu).includes('[]'));assert.equal(commands.length,beforeNativeCommands);});
emitCommand({...clone(fixture),operation:'ui',uiPreference:'hidden',lastError:{code:'cmcp_prior_error',at:'2026-10-03T01:00:00Z'}});
emitCommand({...clone(fixture),operation:'help',lastError:{code:'cmcp_prior_error',at:'2026-10-03T01:00:00Z'}});tree=render();
check('lastError只列先前紀錄，不阻擋成功ui/help也不冒充本次error',()=>{assert.equal(storage.get(preferenceStorageKey),'hidden');assert.equal(all(tree,node=>node.type===OfficialModal)[0].props.open,true);assert.ok(text(tree).includes('先前錯誤紀錄：cmcp_prior_error'));assert.equal(all(tree,node=>node.props.role==='alert').length,0);});
emitCommand({...clone(fixture),operation:'ui',uiPreference:'expanded'});
check('無效偏好保留原模式與正式範圍、不存其他資料',()=>{assert.equal(storage.get(preferenceStorageKey),'hidden');assert.ok(text(render()).includes('有效模式'));assert.deepEqual([...storage.values()],['hidden']);});
emitCommand({...clone(fixture),operation:'ui',uiPreference:'row',error:{code:'cmcp_ui_rejected'}});
check('host拒絕的顯示操作不能冒稱已套用',()=>{assert.equal(storage.get(preferenceStorageKey),'hidden');assert.equal(all(render(),node=>node.props['aria-label']==='CMCP 原生接入狀態').length,0);assert.ok(text(render()).includes('cmcp_ui_rejected'));});
storageDenied=true;emitCommand({...clone(fixture),operation:'ui',uiPreference:'minimized'});tree=render();
check('顯示儲存失敗明示僅本次套用且不更改authority',()=>{assert.equal(all(tree,node=>node.props['aria-label']==='CMCP 原生接入狀態')[0].props['data-display-mode'],'minimized');assert.ok(text(tree).includes('無法保存'));assert.equal(storage.get(preferenceStorageKey),'hidden');assert.equal(JSON.stringify(local.state.sessionAuthorization),JSON.stringify(fixture.sessionAuthorization));});storageDenied=false;
for(const cleanup of effectCleanups)if(typeof cleanup==='function')cleanup();effectCleanups.length=0;hooks.length=0;effects.length=0;seenEffects.length=0;
exactResponse={...clone(fixture),optedIn:false,enabled:false,sessionAuthorization:{scope:'session',sessionId:'session-A',optedIn:false},enhancementBlockedReasons:['session_not_enabled']};
const beforeRemount=commands.length;render();for(const effect of effects)effectCleanups.push(effect());await tick();tree=render();
check('重新掛載只恢復同範圍hidden偏好且本對話仍OFF',()=>{assert.equal(all(tree,node=>node.props['aria-label']==='CMCP 原生接入狀態').length,0);assert.equal(local.state.sessionAuthorization.optedIn,false);assert.equal(local.state.enabled,false);assert.deepEqual(commands.slice(beforeRemount),['status']);});
emitCommand({...exactResponse,operation:'help'});tree=render();
check('未授權對話的native help仍可開選單，所有變更仍依正式授權',()=>{assert.equal(all(tree,node=>node.type===OfficialModal)[0].props.open,true);assert.ok(button(tree,'開啟主動總開關（工作區）').props.disabled);assert.equal(local.state.sessionAuthorization.optedIn,false);});
emitCommand({...exactResponse,operation:'status',workspaceRoot:'another-workspace',scopeId:'scope-B'});tree=render();
check('不同工作區scope不繼承舊顯示偏好或授權',()=>{assert.equal(all(tree,node=>node.props['aria-label']==='CMCP 原生接入狀態')[0].props['data-display-mode'],'minimized');assert.equal(local.state.sessionAuthorization.optedIn,false);assert.equal(storage.size,1);});
for(const cleanup of effectCleanups)if(typeof cleanup==='function')cleanup();const afterUnmount=JSON.stringify(local.state);emitCommand({...clone(fixture),operation:'ui',uiPreference:'row'});
check('component卸載移除native command listener，不處理晚到操作',()=>assert.equal(JSON.stringify(local.state),afterUnmount));
for(const cleanup of parentCleanups)if(typeof cleanup==='function')cleanup();
const result={kind:'native_cmcp_client_projection_checks',at:new Date().toISOString(),status:'PASS',checks:checks.length,results:checks,
  clientPath,clientSha256:createHash('sha256').update(code).digest('hex'),productModelCalls:0,hostModelCalls:0,
  boundary:'離線 React hook／元素與指令 payload／Gateway掛載與schema檢查；官方 Modal／焦點／實際大小只核對使用契約，不是官方 Desktop 畫面、媒體 backend 或 Core 派送驗收。',commands,mediaReads,descriptorPath,descriptorSha256:createHash('sha256').update(await fs.readFile(descriptorPath)).digest('hex'),rpcReadCount:rpcReads.length};
if(resultPath)await fs.writeFile(resultPath,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,checks:checks.length,resultPath:resultPath??null}));
