// 官方 Desktop client：沿既有 dock／commands，不另開聊天室。
window.__ModuleLoader__.load({id:'cmcp-desktop-native',factory:(require)=>{
  const React=require('react'),h=React.createElement;
  // 沿官方共用 Modal：內容 portal 到 body，保留 Escape／Tab 與關閉後焦點還原。
  const {Modal}=require('@deepseek-ai/dsh-client-ui-primitives');
  // 共用契約的瀏覽器副本；client.test 逐位元核對，避免 host/client schema 漂移。
  const MEDIA_RPC=(()=>{
// 官方 Gateway 的專屬唯讀 RPC 契約；不依賴 Node，也不經 Session 指令紀錄。
const MEDIA_RPC_PACKAGE='cmcp-desktop-native-media';
const MEDIA_RPC_SERVICE='cmcpMediaOriginals';
const MEDIA_RPC_NAMESPACE=MEDIA_RPC_SERVICE;
const MEDIA_RPC_METHOD='read';
const MEDIA_RPC_MAX_BYTES=8*1024*1024;
const ID_BYTES=1024,MAX_METADATA_BYTES=128*1024,encoder=new TextEncoder();
const fail=()=>{throw new TypeError('cmcp_media_rpc_contract_invalid');};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,allowed,required=allowed)=>{
  if(!plain(value)||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!allowed.includes(key))
    ||required.some(key=>!Object.hasOwn(value,key)))fail();
  for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))if(!Object.hasOwn(descriptor,'value'))fail();
};
const identity=value=>{
  if(typeof value!=='string'||!value.trim()||/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ||encoder.encode(value).length>ID_BYTES)fail();
  for(const character of value){const code=character.codePointAt(0);if(code>=0xd800&&code<=0xdfff)fail();}
  return value;
};
function parseMediaRpcRequest(value){
  exact(value,['sessionId','pointer','evidenceHash','mediaId']);
  identity(value.sessionId);identity(value.mediaId);
  if(typeof value.evidenceHash!=='string'||!/^[a-f0-9]{64}$/u.test(value.evidenceHash))fail();
  exact(value.pointer,['version','providerNamespace','scopeId','itemId','sessionId','revisionId','partId'],['version','providerNamespace','scopeId','itemId']);
  if(value.pointer.version!==1)fail();
  for(const key of Object.keys(value.pointer))if(key!=='version')identity(value.pointer[key]);
  return value;
}
function jsonMetadata(value,depth=0,budget={nodes:0,bytes:0}){
  if(depth>12||++budget.nodes>4096)fail();
  if(typeof value==='string'){budget.bytes+=encoder.encode(value).length;if(budget.bytes>MAX_METADATA_BYTES)fail();return;}
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))fail();return;}
  if(Array.isArray(value)){
    if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||key!=='length'&&!/^(0|[1-9][0-9]*)$/u.test(key))
      ||Object.keys(value).length!==value.length)fail();
    for(const part of value)jsonMetadata(part,depth+1,budget);return;
  }
  if(!plain(value))fail();
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string'||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'))fail();
    jsonMetadata(key,depth+1,budget);jsonMetadata(value[key],depth+1,budget);
  }
}
function boundedDataUrl(value){
  if(typeof value!=='string'||value.length>Math.ceil(MEDIA_RPC_MAX_BYTES/3)*4+32)fail();
  const prefix=/^data:image\/(png|jpeg);base64,/u.exec(value);if(!prefix)fail();
  const encoded=value.slice(prefix[0].length);
  if(!encoded.length||encoded.length%4!==0||/[^A-Za-z0-9+/=]/u.test(encoded)||!/^[^=]*(?:==|=)?$/u.test(encoded))fail();
  const padding=encoded.endsWith('==')?2:encoded.endsWith('=')?1:0;
  if(encoded.length/4*3-padding>MEDIA_RPC_MAX_BYTES)fail();
  return value;
}
function parseMediaRpcResponse(value){
  exact(value,['kind','operation','enabled','sessionId','workspaceRoot','scopeId','optedIn','mediaOriginal','error'],['kind','operation','enabled','sessionId']);
  if(value.kind!=='cmcp_desktop_response'||value.operation!=='media-read'||typeof value.enabled!=='boolean')fail();
  identity(value.sessionId);
  if(value.error!==undefined){
    if(value.mediaOriginal!==undefined)fail();
    const {error,...metadata}=value;jsonMetadata(metadata);jsonMetadata(error);return value;
  }
  if(value.enabled!==true)fail();
  exact(value.mediaOriginal,['metadata','dataUrl','modelCalls']);
  if(value.mediaOriginal.modelCalls!==0)fail();
  boundedDataUrl(value.mediaOriginal.dataUrl);
  const {mediaOriginal,...metadata}=value;
  jsonMetadata({...metadata,mediaOriginal:{metadata:mediaOriginal.metadata,modelCalls:0}});
  return value;
}
// Gateway 使用 create().parse() 驗證嚴格 JSON 邊界；本手寫契約沒有冒充產生器產物。
const MEDIA_RPC_DESCRIPTOR=Object.freeze({
  id:MEDIA_RPC_PACKAGE+'#'+MEDIA_RPC_NAMESPACE+'/'+MEDIA_RPC_METHOD,
  service:MEDIA_RPC_SERVICE,namespace:MEDIA_RPC_NAMESPACE,method:MEDIA_RPC_METHOD,
  invocation:Object.freeze({kind:'direct'}),
  parameters:Object.freeze([Object.freeze({name:'request',wire:'request',source:'json',
    codec:Object.freeze({mode:'strict',typeSymbol:MEDIA_RPC_PACKAGE+'#MediaReadRequest',create:()=>({parse:parseMediaRpcRequest})})})]),
  cancellation:Object.freeze({parameter:'signal'}),
  result:Object.freeze({mode:'strict',typeSymbol:MEDIA_RPC_PACKAGE+'#MediaReadResponse',create:()=>({parse:parseMediaRpcResponse}),
    encode:parseMediaRpcResponse,decode:parseMediaRpcResponse})
});
return {MEDIA_RPC_PACKAGE,MEDIA_RPC_NAMESPACE,MEDIA_RPC_METHOD,MEDIA_RPC_DESCRIPTOR,parseMediaRpcRequest,parseMediaRpcResponse};
  })();
  const decode=value=>{
    if(value?.kind==='cmcp_desktop_response')return value;
    if(typeof value==='string'){try{return decode(JSON.parse(value));}catch{return null;}}
    if(Array.isArray(value)){for(const child of value){const found=decode(child);if(found)return found;}}
    else if(value&&typeof value==='object')for(const key of ['text','content','message','messages','value','result','output','posts','data']){const found=decode(value[key]);if(found)return found;}
    return null;
  };
  const show=value=>value===undefined||value===null?'尚無證據':typeof value==='object'?JSON.stringify(value,null,2):String(value);
  const errorText=error=>error instanceof Error?error.message:String(error);
  const pointerKey=pointer=>!pointer?null:JSON.stringify(['version','providerNamespace','scopeId','itemId','sessionId','revisionId','partId'].map(key=>pointer[key]??null));
  const roles={user:'使用者',assistant:'助手',system:'系統',tool:'工具'};
  const reasons={session_not_enabled:'本對話尚未加入',shared_enhancement_off:'工作區增強為 OFF',shared_clean:'工作區 Clean 保護中',
    active:'有效',expired:'已到期',cleared:'已 Clear',source_unavailable:'來源目前不可用',not_current_focus:'不是目前焦點',
    buffer_disabled:'Buffer 已停用',disabled:'控制未開啟',deduplicated:'相同進度已處理',source_pending:'來源待處理',
    purposeful_recall_does_not_grant_proactive:'回查本身未授權主動跟進',awaiting_executor_recheck:'等待執行器正式核對',
    executor_not_running:'執行器未運行',read_only_status:'此回執為唯讀觀測',material_controls_disabled:'來源閱讀控制未開啟',
    found:'原件核對成立',changed:'來源已異動',missing:'來源未找到',pin_not_scheduled:'Pin 未指定時間',pin_not_due:'Pin 尚未到期',
    pin_host_session_busy:'目標對話正在工作',pin_destination_session_unavailable:'目標尚未載入或未授權',pin_host_cancelled:'Pin 工作已取消',
    enhancement_disabled:'工作區增強或 Clean 阻擋',proactive_disabled:'主動總開關未開啟',pins_disabled:'Pin 派送控制未開啟',
    do_not_disturb:'目前在勿擾時段',no_user_schedule:'未指定派送時間',not_due:'尚未到期',progress_already_reserved:'此進度已有派送保留',
    no_eligible_candidate:'目前沒有通過派送核對的目標',host_destination_unavailable_or_busy:'站內目標不可用或正在工作',
    dispatch_not_ready:'宿主目前尚未可派送',dispatch_reserved:'已保留唯一派送資格',dispatch_presentation_started:'已開始交給宿主',
    dispatch_result:'派送結果已記錄',handed_to_host:'宿主已接受並正式提交',presented:'已觀測呈現',not_presented:'未呈現',
    presentation_unknown:'呈現結果未知',cancelled:'已取消',not_observed:'尚未觀測',host_committed:'宿主正式提交'};
  const why=value=>reasons[value]??(value===undefined||value===null?'尚無證據':String(value));
  const bool=value=>typeof value==='boolean'?(value?'ON':'OFF'):'尚無證據';
  const localZone=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone;}catch{return '本機時區';}};
  const localTime=value=>{if(!value||!Number.isFinite(Date.parse(value)))return '';const date=new Date(value),part=n=>String(n).padStart(2,'0');return date.getFullYear()+'-'+part(date.getMonth()+1)+'-'+part(date.getDate())+'T'+part(date.getHours())+':'+part(date.getMinutes());};
  const dueFromInput=value=>{if(!value)return null;const time=new Date(value);if(!Number.isFinite(time.getTime()))throw Error('請指定有效的本機日期與時間。');return time.toISOString();};
  const sourceLabel=source=>(roles[source?.sourceAuthorRole]??source?.sourceAuthorRole??'角色未知')+'｜'+(source?.messageRecordedAt??'原時間未知')+'｜'+(source?.sourceKind??'正式來源')+(source?.pointer?.itemId?'｜'+source.pointer.itemId.slice(0,28):'');
  const displayModes=['minimized','row','hidden'];
  const preferenceKey=data=>typeof data?.workspaceRoot==='string'&&data.workspaceRoot.length&&typeof data?.scopeId==='string'&&data.scopeId.length?JSON.stringify(['cmcp-native-ui',1,data.workspaceRoot,data.scopeId]):null;
  const box={display:'flex',flex:'1 1 auto',minWidth:0,maxWidth:'100%',boxSizing:'border-box',gap:6,alignItems:'center',color:'var(--dsw-alias-label-secondary, #526171)',fontSize:12,minHeight:24,maxHeight:28,overflow:'hidden'};
  const rowStyle={padding:'7px 0',borderBottom:'1px solid #dae2ea'},buttonStyle={margin:'3px 7px 3px 0',padding:'4px 8px'},inputStyle={margin:'3px 7px',padding:'4px',maxWidth:'100%'};
  function CmcpDock({runCmcp,readMedia,subscribeCommand}){
    const [state,setState]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[open,setOpen]=React.useState(false),[original,setOriginal]=React.useState(null);
    const [receipt,setReceipt]=React.useState(null),[selected,setSelected]=React.useState([]),[destination,setDestination]=React.useState(''),[due,setDue]=React.useState(''),[pinDates,setPinDates]=React.useState({});
    const [dndStart,setDndStart]=React.useState('22:00'),[dndEnd,setDndEnd]=React.useState('08:00');
    const [tab,setTab]=React.useState('summary');
    const [mediaList,setMediaList]=React.useState(null),[mediaOriginal,setMediaOriginal]=React.useState(null),[mediaContext,setMediaContext]=React.useState(null);
    const mediaRequest=React.useRef(null),mediaProof=React.useRef(state);mediaProof.current=state;
    const [displayMode,setDisplayMode]=React.useState('minimized'),[preferenceError,setPreferenceError]=React.useState('');
    const preferenceScope=React.useRef(null),acceptCommand=React.useRef(null);
    React.useEffect(()=>()=>mediaRequest.current?.abort(),[readMedia]);
    const accept=data=>{
      if(data.operation==='media-list'&&!data.error){const proof=mediaProof.current,effective=proof?.snapshot?.controlConfiguration?.effective;
        if(data.enabled!==true||data.sessionId!==proof?.sessionId||proof?.enabled!==true||effective?.historyRecall!==true||effective?.answerHistory!==true)throw Error('cmcp_media_source_controls_disabled');
        setMediaList(data.mediaList??null);setMediaOriginal(null);return;}
      const key=preferenceKey(data);
      if(key&&key!==preferenceScope.current){preferenceScope.current=key;let mode='minimized';try{const stored=window.localStorage?.getItem(key);if(displayModes.includes(stored))mode=stored;}catch{setPreferenceError('無法讀取顯示偏好；本次使用最小入口。');}setDisplayMode(mode);}
      if(data.operation==='ui'&&!data.error){
        if(!key||!displayModes.includes(data.uiPreference))throw Error('顯示偏好缺少正式範圍或有效模式。');
        setDisplayMode(data.uiPreference);setPreferenceError('');
        try{if(!window.localStorage)throw Error('storage_unavailable');window.localStorage.setItem(key,data.uiPreference);}catch{setPreferenceError('顯示已套用，但無法保存；重新開啟時將使用原顯示偏好。');}
        if(data.uiPreference==='hidden')setOpen(false);
      }
      const {mediaOriginal:preview,...safeState}=data;setState(safeState);if(['original','read'].includes(data.operation)&&!data.error){setOriginal(data.original??data.result);setTab('sources');}
      if(!data.error&&['help','menu'].includes(data.operation)){setTab('summary');setOpen(true);}
      if(data.operation==='media-read'&&!data.error)setMediaOriginal(preview??null);
      const effective=data.snapshot?.controlConfiguration?.effective;
      const mediaReadable=data.enabled&&effective?.historyRecall===true&&effective?.answerHistory===true;
      const currentSources=data.snapshot?.registration?.sources;
      const sourceChanged=mediaContext&&Array.isArray(currentSources)&&!currentSources.some(source=>pointerKey(source.pointer)===pointerKey(mediaContext.pointer)&&source.evidenceHash===mediaContext.evidenceHash);
      if(!data.enabled||data.error){setOriginal(null);}
      if(!mediaReadable||data.error||sourceChanged){setMediaList(null);setMediaOriginal(null);setMediaContext(null);}
      if(data.controlResult||data.pinResult||data.result?.pin)setReceipt({operation:data.operation,at:new Date().toISOString(),controlResult:data.controlResult,pinResult:data.pinResult,result:data.result});};
    acceptCommand.current=value=>{try{const data=decode(value);if(!data)throw Error('正式指令未提供可辨識的 CMCP 回執。');accept(data);setError(data.error?data.error.code??show(data.error):'');}catch(e){setError(errorText(e));}};
    React.useEffect(()=>typeof subscribeCommand==='function'?subscribeCommand(value=>acceptCommand.current?.(value)):undefined,[subscribeCommand]);
    const run=async command=>{setBusy(true);setError('');if(command.startsWith('media-'))setMediaOriginal(null);try{const data=decode(await runCmcp(command));if(!data)throw Error('正式指令未提供可辨識的 CMCP 回執。');accept(data);if(data.error)throw Error(data.error.code??show(data.error));}catch(e){setMediaOriginal(null);setError(errorText(e));}finally{setBusy(false);}};
    const runMedia=async payload=>{setBusy(true);setError('');setMediaOriginal(null);mediaRequest.current?.abort();const abort=new AbortController();mediaRequest.current=abort;
      try{if(typeof readMedia!=='function')throw Error('目前未取得正式的暫態圖片讀取接點。');
        const data=decode(await readMedia(payload,abort.signal));if(abort.signal.aborted)throw Error('cmcp_media_rpc_cancelled');
        if(!data||data.operation!=='media-read'||data.sessionId!==mediaProof.current?.sessionId)throw Error('正式圖片讀取未提供目前對話的可辨識回執。');
        if(data.error)throw Error(data.error.code??show(data.error));
        const effective=mediaProof.current?.snapshot?.controlConfiguration?.effective;
        if(data.enabled!==true||mediaProof.current?.enabled!==true||effective?.historyRecall!==true||effective?.answerHistory!==true)throw Error('cmcp_media_source_controls_disabled');
        // 暫態回包不覆寫一般狀態；圖片正文只由此單份 preview 持有。
        setMediaOriginal(data.mediaOriginal??null);
      }catch(e){setMediaOriginal(null);setError(errorText(e));}finally{if(mediaRequest.current===abort)mediaRequest.current=null;setBusy(false);}};
    const act=operation=>{try{const command=operation();if(command)void run(command);}catch(e){setError(errorText(e));}};
    React.useEffect(()=>{let active=true;runCmcp('status').then(value=>{if(active){const data=decode(value);if(data){accept(data);if(data.error)setError(data.error.code??show(data.error));}else setError('CMCP 狀態回執尚不可辨識。');}}).catch(e=>{if(active)setError(errorText(e));});return()=>{active=false;};},[runCmcp]);
    const s=state?.snapshot,configuration=s?.controlConfiguration,c=configuration?.effective??{},registration=s?.registration,storage=s?.storageStatus;
    const sources=Array.isArray(registration?.sources)?registration.sources:[],bufferData=s?.buffer,pinData=s?.pins;
    const buffer=Array.isArray(bufferData?.items)?bufferData.items:[],pins=Array.isArray(pinData)?pinData:pinData?.pins??pinData?.items??[];
    const sourceMap=new Map(sources.map(source=>[pointerKey(source.pointer),source]));
    const optedIn=state?.sessionAuthorization?.optedIn??state?.optedIn,currentSessionId=state?.currentSessionId??state?.sessionId??state?.sessionAuthorization?.sessionId;
    const statusLabel=state?.error?'待核對':state?.enabled===true?'ON':optedIn===false?'OFF':optedIn===true&&state?.enabled===false?'受阻':'核對中';
    const offered=state?.destinations??s?.sessions??[];
    const destinations=(Array.isArray(offered)?offered:[]).map(value=>typeof value==='string'?{sessionId:value}:value)
      .filter(value=>value&&typeof value.sessionId==='string'&&value.available!==false&&value.optedIn!==false&&(!value.scopeId||value.scopeId===state?.scopeId));
    const target=destinations.some(value=>value.sessionId===destination)?destination:destinations.find(value=>value.sessionId===currentSessionId)?.sessionId??destinations[0]?.sessionId??'';
    const time=s?.timeCard?.current,previous=s?.timeCard?.previousExchange,canChange=optedIn&&typeof configuration?.generation==='string'&&typeof state?.scopeId==='string';
    const mayRead=state?.enabled&&c.historyRecall===true&&c.answerHistory===true;
    const command=(name,payload)=>name+' '+JSON.stringify({scopeId:state.scopeId,generation:configuration.generation,...payload});
    const control=patch=>{if(!canChange)throw Error('請先明確加入本對話，並重新讀取正式共用控制。');return command('controls',{patch});};
    const change=(pin,action,dueAt)=>{if(!canChange)throw Error('本對話尚無操作授權或缺少正式控制世代。');return command('pin-change',{pinId:pin.pinId,expectedRevision:pin.revision,change:action,...(action==='schedule'?{dueAt}: {})});};
    const btn=(label,operation,disabled=false)=>h('button',{type:'button',disabled:busy||disabled,onClick:()=>typeof operation==='string'?run(operation):act(operation),style:buttonStyle},label);
    const detail=(title,value)=>h('details',{},h('summary',{},title),h('pre',{style:{whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:250,overflow:'auto'}},show(value)));
    const storageNames={stored:'原件已核驗',unknown:'未知',changed:'原件變版或雜湊不符',missing:'原件缺失',unavailable:'原件核驗失敗',revoked:'授權已撤回',deleted:'原件已刪除',permission_denied:'原件存取被拒',unsupported:'來源路徑不支援',registered:'已登錄',pending:'待登錄',failed:'登錄失敗（仍待處理）',eligible:'符合正式 reader 資格',blocked:'受阻',not_verified:'尚未驗證（舊版狀態欄位）',not_assessed:'本保存狀態未評估'};
    const storageLabel=value=>storageNames[value]??value??'未知';
    const storageCount=name=>Number.isSafeInteger(storage?.counts?.[name])?String(storage.counts[name]):'未知';
    const storageView=()=>h('div',{style:rowStyle,'aria-label':'原件保存與登錄狀態'},h('strong',{},'原件保存／清冊登錄／正式閱讀'),
      h('p',{},'原件已核驗 ',storageCount('originalStored'),'；待登錄 ',storageCount('registrationPending'),'（其中失敗 ',storageCount('registrationFailed'),'）；符合 reader 資格 ',storageCount('readerEligible')),
      h('p',{},storage?.boundary??'保存與登錄狀態尚未讀回，不能把來源數或原件保存成功當成可閱讀。'),
      storage?.verification&&h('p',{},'本次有界核驗 ',storage.verification.checked,' 筆；其餘 ',storage.verification.remaining,' 筆未核驗，不代表缺失。'),
      h('p',{},'跨宿主：',storageLabel(storage?.crossHost?.status),'；',storage?.crossHost?.guidance??'請另查接收端的正式閱讀與宿主回執；本保存狀態不取代交接判定。'),
      h('p',{},'登錄重試是明示寫入，刷新不會執行；清冊滿或根因未排除時仍待處理。'),
      storage?.retry?.available!==true&&h('p',{},'此接點尚未確認可用登錄重試；請查看正式回執，不以模型回覆代替操作。'),
      btn('重試登錄（本授權範圍）','retry-registration',!canChange||!state?.enabled||storage?.retry?.available!==true),
      (Array.isArray(storage?.sources)?storage.sources:[]).filter(row=>row.original?.status!=='stored'||row.registration?.status!=='registered'||row.formalRead?.status!=='eligible').map((row,index)=>h('div',{key:pointerKey(row.pointer)??index,style:rowStyle},
        h('span',{},(roles[row.sourceAuthorRole]??row.sourceAuthorRole??'角色未知')+'｜'+(row.messageRecordedAt??'原時間未知')+'｜'+(row.pointer?.itemId??'來源身分未知')),
        h('p',{},'原件：',storageLabel(row.original?.status),'；清冊：',storageLabel(row.registration?.status),'；閱讀：',storageLabel(row.formalRead?.status)),
        h('p',{},'原因：',[row.original?.reason,row.registration?.reason,row.formalRead?.reason].filter(Boolean).join('、')||'未提供'),detail('此來源正式 metadata',row))),
      state?.recoveryResult&&detail('最近一次明示重試回執',state.recoveryResult),detail('保存與登錄正式欄位',storage));
    const readButton=source=>btn('正式原文',()=>{if(!source?.pointer||!source.evidenceHash||!Number.isInteger(source.location?.end)||source.location.end<=0)throw Error('此來源尚缺正式版本／範圍，不能讀取。');
      return 'original '+JSON.stringify({pointer:source.pointer,evidenceHash:source.evidenceHash,start:source.location.start??0,end:Math.min(source.location.end,(source.location.start??0)+8192),maxBytes:8192});
    },!mayRead||!source?.pointer||!source?.evidenceHash||!Number.isInteger(source.location?.end)||source.location.end<=0);
    const mediaButton=source=>source?.sourceAuthorRole==='user'&&btn('圖片原件',()=>{if(!source?.pointer||!source.evidenceHash)throw Error('此來源缺少正式版本／雜湊，不能讀取圖片。');
      setMediaOriginal(null);setMediaList(null);setMediaContext({pointer:source.pointer,evidenceHash:source.evidenceHash});return 'media-list '+JSON.stringify({pointer:source.pointer,evidenceHash:source.evidenceHash});
    },!mayRead||!source?.pointer||!source?.evidenceHash);
    const mediaItems=Array.isArray(mediaList?.items)?mediaList.items:[];
    const availability=media=>media.availability?.state??media.status;
    const mediaStatus=value=>({available:'原件可用',unavailable:'原件不可用',missing:'原件缺失',changed:'原件異動',revoked:'授權已撤回',deleted:'原件已刪除',unsupported:'此路徑不支援的媒體類型',found:'原件核對成立'}[value]??why(value));
    // 圖片正文只走 host 的暫態正式 reader；不得經 command/result 落入宿主聊天紀錄。
    const mediaReadButton=media=>h('button',{type:'button',style:buttonStyle,disabled:busy||!mayRead||!mediaContext||typeof readMedia!=='function'||!['available','found'].includes(availability(media)),onClick:()=>{
      if(!mediaContext?.pointer||!mediaContext.evidenceHash||typeof media.mediaId!=='string'){setError('缺少目前正式來源／圖片身分，不能讀取。');return;}
      void runMedia({...mediaContext,mediaId:media.mediaId});}},'查看圖片原件');
    const previewValid=typeof mediaOriginal?.dataUrl==='string'&&/^data:image\/(?:png|jpeg);base64,/u.test(mediaOriginal.dataUrl)
      &&Number.isInteger(mediaOriginal.metadata?.bytes)&&mediaOriginal.metadata.bytes>0&&mediaOriginal.metadata.bytes<=8*1024*1024;
    const sourceRow=(pointer,sourceTime,index)=>{const source=sourceMap.get(pointerKey(pointer)),metadata=sourceTime??source??{};return h('div',{key:pointerKey(pointer)??index,style:rowStyle},
      h('span',{},sourceLabel({...source,...metadata,pointer:source?.pointer??pointer})),h('span',{},'；來源核對：',sourceTime?why(sourceTime.resolveStatus):source?'已登錄':'尚未在此清冊對上'),source&&readButton(source),
      detail('來源身分與核對欄位',{pointer,registration:source??null,sourceTime:sourceTime??null}));};
    const controls=[['enabled','工作區增強'],['clean','Clean 保護'],['proactive','主動總開關'],['pins','Pin 派送控制']];
    const dnd=c.doNotDisturb,dispatch=state?.dispatch??s?.dispatchObservation??s?.proactive;
    const liveDispatch=s?.proactive?.liveDispatch??state?.dispatch?.liveDispatch;
    const dispatchRecords=Array.isArray(dispatch?.records)?dispatch.records:Array.isArray(dispatch?.arbitration?.records)?dispatch.arbitration.records:[];
    const recent=(Array.isArray(s?.trace)?s.trace:Array.isArray(s?.trace?.entries)?s.trace.entries:[]).filter(item=>item?.source?.pointer||item?.sourcePointer||item?.receipt?.sourcePointer).at(-1);
    const recentKinds={received:'接收來源',user_saved:'保存使用者原文',assistant_saved:'保存助手原文',tool_result:'正式來源工具',context_prepared:'準備來源材料'};
    const recentLabel=recent?(recentKinds[recent.kind]??recent.kind??recent.operation??'正式來源操作')+' '+(recent.at??recent.receivedAt??'原時間尚未提供'):'尚無來源操作證據';
    const count=(available,items)=>state?.enabled&&available?String(items.length):'未知';
    const compactSummary='本工作區授權對話｜保存 '+(typeof c.saveUser==='boolean'&&typeof c.saveAssistant==='boolean'?(c.saveUser?'User':'')+(c.saveUser&&c.saveAssistant?'/':'')+(c.saveAssistant?'Assistant':'')||'OFF':'未知')+'｜來源 '+count(Array.isArray(registration?.sources),sources)+'｜Buffer '+count(bufferData,buffer)+'｜Pin '+count(pinData,pins)+'｜原件核驗 '+storageCount('originalStored')+'／待登錄 '+storageCount('registrationPending')+'｜共用 '+bool(c.enabled)+(c.clean===true?'／Clean':'')+'｜主動 '+bool(c.proactive)+'／Pin '+bool(c.pins)+'｜'+recentLabel;
    const tabs=[['summary','摘要與控制'],['sources','來源與原件'],['buffer','Buffer'],['pins','Pin'],['receipts','回查與回執']];
    const panel=(name,...children)=>h('section',{hidden:tab!==name,'aria-label':tabs.find(item=>item[0]===name)?.[1]},...children);
    const displayButtonStyle={flex:'0 0 auto',whiteSpace:'nowrap',margin:0,padding:'2px 6px',fontSize:12,color:'inherit',background:'transparent',border:'1px solid var(--dsw-alias-border-l2, #c6d0da)',borderRadius:6};
    return h(React.Fragment,{},displayMode!=='hidden'&&h('section',{style:displayMode==='row'?{...box,width:640}:box,'aria-label':'CMCP 原生接入狀態','data-display-mode':displayMode},
      displayMode==='row'&&h('strong',{style:{flex:'0 0 auto',whiteSpace:'nowrap'}},'CMCP ',statusLabel),
      displayMode==='row'&&
      h('span',{style:{flex:'1 1 0%',width:0,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},title:(state?.saveScope??'保存範圍尚未讀回')+'；工作區：'+(state?.workspaceRoot??'核對中')+'；'+compactSummary},compactSummary),
      h('button',{type:'button',onClick:()=>setOpen(true),'aria-label':'查看 CMCP 狀態','aria-haspopup':'dialog','aria-expanded':open,style:displayButtonStyle},displayMode==='minimized'?'CMCP '+statusLabel+(error?' !':' ▾'):error?'狀態（有錯誤）':'查看狀態')),
      h(Modal,{open,onClose:()=>{mediaRequest.current?.abort();setMediaOriginal(null);setOpen(false);},title:'CMCP｜目前對話與工作區',closeLabel:'關閉 CMCP 狀態',description:'查看與切換分頁不改控制、時間或 TTL，也不呼叫模型。'},
      open&&h('div',{style:{width:'min(720px, calc(100vw - 72px))',maxWidth:'100%',maxHeight:'calc(100vh - 230px)',overflowY:'auto',fontSize:13,overflowWrap:'anywhere'}},
        h('div',{role:'tablist','aria-label':'CMCP 詳細資料',style:{display:'flex',gap:4,flexWrap:'wrap',position:'sticky',top:0,background:'var(--color-surface, #f8fafc)',zIndex:1,paddingBottom:8}},tabs.map(([name,label])=>h('button',{key:name,type:'button',role:'tab','aria-selected':tab===name,onClick:()=>setTab(name),style:{...buttonStyle,fontWeight:tab===name?700:400}},label))),
        error&&h('p',{role:'alert',style:{color:'#a31212'}},'CMCP 操作未完成：',error),
        state?.lastError&&h('p',{},'先前錯誤紀錄：',state.lastError.code??show(state.lastError),state.lastError.at?'（'+state.lastError.at+'）':''),
        h('div',{'aria-label':'CMCP 顯示偏好',style:{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}},h('span',{},'入口顯示：'),[['minimized','最小入口'],['row','單列摘要'],['hidden','隱藏入口']].map(([mode,label])=>h('button',{key:mode,type:'button','aria-pressed':displayMode===mode,disabled:busy,onClick:()=>run('ui '+mode),style:buttonStyle},label))),
        h('p',{},'顯示偏好僅影響此工作區入口，不會加入或退出任何對話。隱藏後可輸入 /cmcp 開啟選單，或 /cmcp ui minimized 恢復入口。'),
        preferenceError&&h('p',{role:'status'},preferenceError),
        panel('summary',
        h('p',{},'CMCP｜',optedIn===true?'本對話已加入':optedIn===false?'本對話尚未加入':'本對話授權尚未讀回',state?.enabled===true?'；增強可用':optedIn===true&&state?.enabled===false?'；增強受阻':''),
        h('p',{},'工作區：',state?.workspaceRoot??'正在核對目前工作區'),
        h('p',{},'本對話授權與工作區共用控制分開。加入只授權本對話後續的 CMCP 保存／回查；共用保護仍會生效。Harness 原生紀錄由官方宿主管理。'),
        h('div',{},btn('加入本對話並依設定保存','on'),btn('退出本對話增強','off'),btn('重新讀取（唯讀）','status'),btn('命令與操作說明','help')),
        state?.menu&&h('section',{'aria-label':'CMCP 通用命令'},h('h3',{},'可用操作'),
          h('p',{},'在目前對話的輸入欄輸入下列命令。先用 /cmcp sources 取得本次選項，再用 /cmcp read 1 讀取第一項；換頁可用 /cmcp sources 2。'),
          h('dl',{},(Array.isArray(state.menu.operations)?state.menu.operations:[]).map((operation,index)=>h('div',{key:operation.command??index,style:rowStyle},h('dt',{},h('code',{},String(operation.command??'').split(' / ').map(command=>'/cmcp '+command).join(' 或 '))),h('dd',{style:{margin:'2px 0 0'}},operation.description)))),
          state.menu.instructions&&h('p',{},show(state.menu.instructions)),(Array.isArray(state.menu.unsupported)?state.menu.unsupported:[]).map((value,index)=>h('p',{key:index},show(value)))),
        h('p',{},'本對話授權：',bool(optedIn),'；增強有效：',bool(state?.enabled),'；阻擋原因：',state?.enhancementBlockedReasons?.length?state.enhancementBlockedReasons.map(why).join('、'):state?'目前沒有已回報阻擋':'尚未讀回'),
        h('p',{},'保存範圍：',state?.saveScope??'尚未讀回','；保存 User：',bool(c.saveUser),'；保存 Assistant：',bool(c.saveAssistant)),
        h('div',{style:rowStyle},h('strong',{},'工作區共用控制'),
          h('p',{},'下列操作作用於此工作區的已授權對話與目標；每次核對正式控制世代並讀回。建立 Pin 不會開啟主動總開關。'),
          controls.map(([name,label])=>h('div',{key:name},h('span',{},label,'：',bool(c[name])),btn((c[name]===true?'關閉':'開啟')+label+'（工作區）',()=>control({[name]:!c[name]}),!canChange||typeof c[name]!=='boolean'))),
          h('p',{},'勿擾：',bool(dnd?.enabled),'；時區：',dnd?.timezone??'尚未指定','；時段：',Array.isArray(dnd?.windows)&&dnd.windows.length?dnd.windows.map(window=>window.start+'–'+window.end+(window.weekdays?'（星期 '+window.weekdays.join('、')+'）':'')).join('、'):'尚未排定'),
          dnd?.windows?.length>0&&btn(dnd.enabled?'關閉既有勿擾（工作區）':'啟用既有勿擾（工作區）',()=>control({doNotDisturb:{...dnd,enabled:!dnd.enabled}}),!canChange),
          h('details',{},h('summary',{},'明確設定每日勿擾時段（工作區）'),h('p',{},'此操作取代工作區現有勿擾時段；使用本機時區 ',localZone(),'。'),
            h('label',{},'開始',h('input',{type:'time',value:dndStart,onChange:event=>setDndStart(event.target.value),style:inputStyle})),
            h('label',{},'結束',h('input',{type:'time',value:dndEnd,onChange:event=>setDndEnd(event.target.value),style:inputStyle})),
            btn('套用並啟用此勿擾時段（工作區）',()=>{if(!dndStart||!dndEnd||dndStart===dndEnd)throw Error('勿擾開始與結束須為不同的有效時間。');return control({doNotDisturb:{enabled:true,timezone:localZone(),windows:[{start:dndStart,end:dndEnd}]}});},!canChange)),
          detail('共用控制／保存授權正式欄位',{scope:state?.sharedControlScope,sessionAuthorization:state?.sessionAuthorization,controlConfiguration:configuration,sourceAuthorization:s?.sourceAuthorization}))),
        !state?.enabled&&h('p',{},optedIn===true?'共用保護目前阻擋增強。來源清冊、Buffer、Pin 與原文未提供查看，不能據此判定空集合。':optedIn===false?'本對話尚未授權查看來源清冊、Buffer、Pin 或原文；資料是否存在未知，不代表已刪除。':'尚未讀回本對話授權及正式來源狀態，資料是否存在未知。'),
        state?.enabled&&h(React.Fragment,{},
          panel('summary',h('p',{},'目前時間：',time?.nowLocal??time?.now??'尚無證據','；時區：',time?.timezone??'尚無證據','；前次交流：',previous?.recordedAtLocal??previous?.recordedAt??'尚無紀錄'),
          h('p',{},'最近來源操作：',recentLabel),detail('時間正式欄位（刷新不改原時間）',s?.timeCard)),
          panel('sources',
          storageView(),
          h('div',{style:rowStyle},h('strong',{},'正式來源清冊｜',Array.isArray(registration?.sources)?sources.length+' 筆':'尚未提供'),
            Array.isArray(registration?.sources)&&sources.length===0?h('p',{},'目前已提供清冊為空集合；已登錄範圍：',registration.inventoryComplete===true?'完整清冊':registration.inventoryComplete===false?'有界／未完整':'尚無證據'):sources.map((source,index)=>h('div',{key:source.id??pointerKey(source.pointer)??index,style:rowStyle},
              h('label',{},h('input',{type:'checkbox',disabled:busy||!source.id,checked:selected.includes(source.id),onChange:event=>setSelected(previous=>event.target.checked?[...new Set([...previous,source.id])]:previous.filter(id=>id!==source.id))}),'選作 Pin 來源：',sourceLabel(source)),readButton(source),mediaButton(source),detail('來源版本／雜湊與範圍',source))),
            !mayRead&&h('p',{},'回查或回答歷史控制未開啟；身分可核對，正式原文讀取仍受控制。')),
          original&&h('div',{style:rowStyle},h('strong',{},'正式閱讀結果'),h('p',{},'讀取狀態：',show(original.status),'；角色：',roles[original.sourceAuthorRole]??original.sourceAuthorRole??'尚無證據','；原時間：',original.messageRecordedAt??'尚無證據'),
            typeof original.text==='string'&&h('pre',{style:{whiteSpace:'pre-wrap',wordBreak:'break-word'}},original.text),detail('閱讀回執／版本／覆蓋（有界閱讀不冒稱整份）',original)),
          mediaList&&h('div',{style:rowStyle},h('strong',{},'此正式來源的圖片原件｜',mediaList.total??mediaItems.length,' 件'),
            typeof readMedia!=='function'&&h('p',{},'暫態正式圖片讀取接點尚未就緒；不透過聊天指令複製原件。'),
            h('p',{},'正式來源：',roles[mediaList.source?.sourceAuthorRole]??mediaList.source?.sourceAuthorRole??'角色未知','；原時間：',mediaList.source?.messageRecordedAt??'尚無證據'),
            typeof mediaList.source?.text==='string'&&h('div',{},h('strong',{},'當時隨圖片提交的原說明'),h('pre',{style:{whiteSpace:'pre-wrap',wordBreak:'break-word'}},mediaList.source.text)),
            mediaItems.length===0&&h('p',{},'目前正式來源未提供圖片原件；不以文字描述代替。'),
            mediaItems.map((media,index)=>h('div',{key:media.mediaId??index,style:rowStyle},
              h('p',{},'原檔：',media.filename??media.originalFilename??'未提供原檔名','；狀態：',mediaStatus(availability(media)),'；保存：',media.originalStatus==='stored'?'原件已保存':media.originalStatus??'尚無證據',media.availability?.reason?'；原因：'+why(media.availability.reason):''),
              h('p',{},'媒體類型：',media.mimeType??media.mediaType??'尚無證據','；大小：',media.bytes??'尚無證據',' bytes；SHA-256：',media.sha256??'尚無證據'),
              h('p',{},'角色：',roles[media.parent?.sourceAuthorRole??mediaList.source?.sourceAuthorRole]??media.parent?.sourceAuthorRole??mediaList.source?.sourceAuthorRole??'角色未知','；原時間：',media.parent?.messageRecordedAt??mediaList.source?.messageRecordedAt??'尚無證據'),
              mediaReadButton(media),detail('圖片正式身分／版本與保存回執（不含圖片正文）',media))),
            mediaList.truncated&&h('p',{},'此清冊有界提供 ',mediaList.shown??mediaItems.length,' 件，不能據此宣稱已列全部原件。')),
          mediaOriginal&&h('div',{style:rowStyle},h('strong',{},'核對後圖片原件預覽'),
            previewValid?h('img',{src:mediaOriginal.dataUrl,alt:mediaOriginal.metadata?.filename??mediaOriginal.metadata?.originalFilename??'正式圖片原件',style:{display:'block',maxWidth:'100%',maxHeight:'48vh',objectFit:'contain'},onError:()=>{setMediaOriginal(null);setError('宿主無法呈現這份核對後圖片；不能宣稱已查看。');}}):h('p',{},'未取得可呈現且不超過 8 MiB 的正式 PNG／JPEG 原件；不使用舊描述補替。'),
            detail('原件資訊與正式來源（預覽資料不複製到回執）',mediaOriginal.metadata))),
          panel('buffer',
          h('div',{style:rowStyle},h('strong',{},'Buffer｜',bufferData?buffer.length+' 筆活躍候選':'尚未提供'),
            bufferData&&buffer.length===0&&h('p',{},'正式介面目前回傳空的活躍集合；非活躍保留記錄另列。'),
            buffer.map((item,index)=>h('div',{key:item.id??item.eventKey??pointerKey(item.sourceRefs?.[0])??index,style:rowStyle},
              h('p',{},'候選種類：',item.kind==='recall'?'原文回查':item.kind==='proactive_focus'?'接續焦點':show(item.kind),'；狀態：',why(item.reason),'；原期限：',item.expiry??'尚未提供','；主動資格原因：',why(item.proactiveReason)),
              item.sourceRefs?.length?item.sourceRefs.map((pointer,i)=>sourceRow(pointer,item.sourceTimes?.find(time=>pointerKey(time.pointer)===pointerKey(pointer)),i)):h('p',{},'此候選未提供正式來源身分；維持未知。'),detail('候選正式欄位',item))),
            detail('非活躍保留記錄／Buffer 期限與世代',bufferData))),
          panel('pins',
          h('div',{style:rowStyle},h('strong',{},'建立明確 Pin'),
            h('p',{},'先到「來源與原件」分頁勾選已授權的正式來源，再指定站內對話與時間。未指定時間只釘選，不提醒；普通聊天與 Assistant 提案不會代你建立。'),
            h('p',{},'已選：',selected.filter(id=>sources.some(source=>source.id===id)).length,' 筆來源'),
            h('label',{},'站內派送位置',h('select',{value:target,disabled:busy||!canChange,onChange:event=>setDestination(event.target.value),style:inputStyle},
              !destinations.length&&h('option',{value:''},'尚無已載入、已授權目標'),destinations.map(value=>h('option',{key:value.sessionId,value:value.sessionId},value.label??(value.sessionId===currentSessionId?'目前對話':'已授權對話 '+value.sessionId.slice(0,12)))))),
            h('label',{},'排定時間（',localZone(),'；可留空）',h('input',{type:'datetime-local',value:due,disabled:busy,onChange:event=>setDue(event.target.value),style:inputStyle})),
            btn('以所選來源建立 Pin',()=>{const sourceIds=selected.filter(id=>sources.some(source=>source.id===id));if(!sourceIds.length)throw Error('請先從正式來源清冊勾選至少一筆來源。');if(!target)throw Error('尚無目前可用且已授權的站內目標。');return command('pin-create',{sessionId:target,sourceIds,dueAt:dueFromInput(due)});},!canChange||!state?.enabled||!target),
            detail('可用目標正式回執',offered)),
          h('div',{style:rowStyle},h('strong',{},'Pin｜',pinData?pins.length+' 筆':'尚未提供'),
            pinData&&pins.length===0&&h('p',{},'正式介面目前沒有 Pin 目標。'),
            pins.map((pin,index)=>{const id=pin.pinId??pin.id,destinationData=(state?.pinDestinations??s?.destinations)?.[id],draft=pinDates[id]?.revision===pin.revision?pinDates[id].value:localTime(pin.dueAt);return h('div',{key:id??index,style:rowStyle},
              h('p',{},'Pin：',String(id??'身分未知').slice(0,16),'；狀態：',{active:'有效',completed:'已完成',cancelled:'已取消'}[pin.status]??show(pin.status),'；版本：',show(pin.revision),'；時間：',pin.dueAt??'未指定（不派送）'),
              h('p',{},'站內位置：',destinationData?.label??(destinationData?.sessionId===currentSessionId?'目前對話':destinationData?.sessionId??'尚無位置證據')),
              (pin.sourcePointers??[]).map((pointer,i)=>sourceRow(pointer,null,i)),
              pin.status==='active'&&h('div',{},h('label',{},'改期（',localZone(),'；留空撤下時間）',h('input',{type:'datetime-local',value:draft,onChange:event=>setPinDates(previous=>({...previous,[id]:{revision:pin.revision,value:event.target.value}})),disabled:busy,style:inputStyle})),
                btn('套用改期',()=>change(pin,'schedule',dueFromInput(draft)),!canChange||!pin.pinId||!Number.isInteger(pin.revision)),
                btn('取消此 Pin',()=>change(pin,'cancel'),!canChange||!pin.pinId||!Number.isInteger(pin.revision)),
                btn('標記此 Pin 完成',()=>change(pin,'complete'),!canChange||!pin.pinId||!Number.isInteger(pin.revision))),detail('Pin 原始來源／時間／狀態及派送位置',{pin,destination:destinationData??null}));}),detail('Pin 正式清冊',pinData))),
          panel('receipts',
          h('div',{style:rowStyle},h('strong',{},'站內派送與回執'),h('p',{},'執行器原因：',why(liveDispatch?.reason??dispatch?.reason??dispatch?.executor?.reason),'；目前勿擾：',bool(dispatch?.doNotDisturbActive)),
            h('p',{},'生成、保存、宿主接受、畫面呈現及已讀各自核對；缺少畫面或已讀證據時維持未知，送出不等於完成。'),
            dispatchRecords.length===0?h('p',{},'尚無此範圍的已記錄派送事件。'):dispatchRecords.slice(-10).map((record,index)=>h('div',{key:record.value?.id+'-'+record.kind+'-'+index,style:rowStyle},
              h('p',{},'階段：',why(record.kind),'；時間：',record.value?.at??'尚無證據','；結果：',why(record.value?.status??record.value?.code),'；目標：',record.value?.candidate?.id??record.value?.id??'尚無證據'),
              record.value?.receipt&&h('p',{},'宿主回執：',why(record.value.receipt.hostReceipt?.stage),'；畫面：',why(record.value.receipt.presentation),'；已讀：',why(record.value.receipt.userRead)),detail('事件正式回執',record))),
            dispatchRecords.length>10&&h('p',{},'此處只列最近十筆；完整已回傳事件可展開核對。'),detail('正式派送觀測',dispatch),detail('執行器正式狀態',liveDispatch),detail('此次明確操作回執',receipt)),
          detail('當輪正式回查、模型輸入 metadata 與保存回執',s?.trace))),
        h('p',{},'查看、展開與重新讀取保持唯讀；不活化 Buffer、不刷新原時間／TTL、不取得提醒授權或派送。metadata 不等於完整模型 wire。')
      ))
    );
  }
  function apply(ctx){
    const handlers=new Map(),mediaReaders=new Map(),commandSubscribers=new Map(),subscriptions=new Map();
    ctx.on('command/executed',(sessionId,name,result)=>{
      if(name!=='cmcp')return;const data=decode(result);if(!data||data.sessionId!==sessionId)return;
      for(const listener of commandSubscribers.get(sessionId)??[])listener(result);
    });
    let invokeMedia=null;
    const mounting=Promise.resolve().then(async()=>{
      await ctx.remote.$mount({package:MEDIA_RPC.MEDIA_RPC_PACKAGE,descriptors:[MEDIA_RPC.MEDIA_RPC_DESCRIPTOR]});
      // namespace 由 $mount 建立後，才在子 fiber 宣告依賴；父 apply 不因可選媒體接點等待自身掛載。
      const fiber=ctx.inject(['remote.'+MEDIA_RPC.MEDIA_RPC_NAMESPACE],function cmcpMediaClient(child){
        const reader=(request,signal)=>child.remote[MEDIA_RPC.MEDIA_RPC_NAMESPACE][MEDIA_RPC.MEDIA_RPC_METHOD](request,signal);
        invokeMedia=reader;child.effect(()=>()=>{if(invokeMedia===reader)invokeMedia=null;});
      });
      await fiber;if(typeof invokeMedia!=='function')throw Error('cmcp_media_rpc_namespace_unavailable');
    });
    // 讀取時再呈現掛載錯誤，不讓可選圖片接點失敗破壞原生普通聊天或既有文字工具。
    void mounting.catch(()=>{});
    ctx.slots.inject('conversation.composer.dock',()=>ctx.slots.register({name:'conversation.composer.dock',id:'cmcp-desktop',order:20,
      inject:sessionId=>{if(!handlers.has(sessionId))handlers.set(sessionId,async command=>ctx.sessions.using(sessionId,{source:'cmcp-native-ui'},async reference=>{
        const state=reference.binding.session.getSnapshot();if(state.openState!=='open')throw state.openError??Error('目前 Session 尚未開啟');
        return ctx.remote.commands.execute(sessionId,'/cmcp '+command,[]);
      }));if(!mediaReaders.has(sessionId))mediaReaders.set(sessionId,async(payload,signal)=>ctx.sessions.using(sessionId,{source:'cmcp-native-media-ui'},async reference=>{
        const state=reference.binding.session.getSnapshot();if(state.openState!=='open')throw state.openError??Error('目前 Session 尚未開啟');
        if(signal?.aborted)throw Error('cmcp_media_rpc_cancelled');await mounting;
        const request=MEDIA_RPC.parseMediaRpcRequest(JSON.parse(JSON.stringify({sessionId,pointer:payload.pointer,evidenceHash:payload.evidenceHash,mediaId:payload.mediaId})));
        const reader=invokeMedia;if(typeof reader!=='function')throw Error('cmcp_media_rpc_namespace_unavailable');
        const result=await reader(request,signal);
        if(signal?.aborted)throw Error('cmcp_media_rpc_cancelled');if(!result?.ok)throw Error(result?.error?.code??result?.error?.message??'cmcp_media_rpc_failed');
        const value=MEDIA_RPC.parseMediaRpcResponse(result.value);
        if(value.sessionId!==sessionId||value.scopeId!==undefined&&value.scopeId!==request.pointer.scopeId)throw Error('cmcp_media_rpc_session_mismatch');
        if(!value.error&&value.mediaOriginal?.metadata?.mediaId!==request.mediaId)throw Error('cmcp_media_rpc_original_mismatch');return value;
      }));if(!subscriptions.has(sessionId))subscriptions.set(sessionId,listener=>{let listeners=commandSubscribers.get(sessionId);if(!listeners)commandSubscribers.set(sessionId,listeners=new Set());listeners.add(listener);return()=>{listeners.delete(listener);if(!listeners.size)commandSubscribers.delete(sessionId);};});
        return {runCmcp:handlers.get(sessionId),readMedia:mediaReaders.get(sessionId),subscribeCommand:subscriptions.get(sessionId)};}
    },CmcpDock));
    ctx.effect(()=>()=>{handlers.clear();mediaReaders.clear();commandSubscribers.clear();subscriptions.clear();});
  }
  return {name:'cmcp-desktop-client',inject:['slots','sessions','remote','remote.commands'],apply};
}});
