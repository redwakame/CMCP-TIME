import {randomUUID} from 'node:crypto';

// 只解析已由宿主正式命令或本機控制入口提交的操作；不掃描 History、工具回覆或聊天文字。
export const CONTROL_CONTRACT_VERSION=1;
export const DISPLAY_MODES=Object.freeze(['minimized','row','hidden']);
const booleanKeys={enabled:'enabled',clean:'clean',buffer:'buffer',time:'timeIndex',history:'historyRecall',answer:'answerHistory',proactive:'proactive',pins:'pins','save-user':'saveUser','save-assistant':'saveAssistant'};
const bool=text=>{if(!['on','off'].includes(text))throw Error('cmcp_control_on_or_off_required');return text==='on';};
const identity=s=>JSON.stringify([s.id,s.pinId,s.pointer,s.evidenceHash,s.revision,s.status,s.dueAt]);
const pinRows=s=>Array.isArray(s.pins)?s.pins:s.pins?.pins??s.pins?.items;
export function controlMenu({scopeId,sessionId,projectId=null,capabilities={}}){
  return {contractVersion:CONTROL_CONTRACT_VERSION,scope:{projectId,scopeId,sessionId},modelCalls:0,
    instructions:'只有目前明確提交的控制操作會執行。加入對話不解除共用保護；數字選項只在本次清冊及有效期間內使用。',
    operations:[
      ['help / menu','操作選單與目前範圍'],...(capabilities.sessionControl===false?[]:[['on / off','僅加入／退出目前對話']]),['status','正式狀態：原件保存、清冊登錄與 reader 資格；跨宿主交接另依正式回執判定'],
      ['sources [頁碼] / time','來源與原時間清冊'],['read <選項> [頁碼]','正式原文；每頁最多 2048 字元，回執明列覆蓋'],['media-list <選項>','來源媒體清冊'],
      ['buffer / pins','Buffer／Pin 正式狀態'],['clear-buffer','只清 Buffer，不刪 History 或獨立 Pin'],
      ['retry-registration','明示重試本授權範圍登錄；零模型、不擴容量或刪原件，根因未排除仍待處理'],
      ['set <欄位> on|off','明示修改共用控制；欄位：'+Object.keys(booleanKeys).join(', ')],
      ['dnd off / dnd <時區> <HH:MM> <HH:MM>','明示修改共用勿擾'],
      ...(capabilities.pinCreate?[['pin <來源選項> <含時區時間|none>','建立指向目前對話的獨立 Pin']]:[]),
      ...(capabilities.pinChange?[['pin-cancel <選項> / pin-complete <選項> / pin-time <選項> <含時區時間|none>','修改本對話的獨立 Pin']]:[]),
      ...(capabilities.ui?[['ui minimized|row|hidden','只改顯示偏好，不改授權']]:[])].map(([command,description])=>({command,description})),
    storageSemantics:{sourceSaved:'原件已保存不代表已登錄或可被另一宿主使用。',formalReadable:'狀態只核對正式 reader 資格；實際閱讀仍須正式原文操作及當前授權。',crossHost:'保存狀態只評估中繼資料，未在此判定跨宿主交接；請另查接收端專案、Session、正式 reader 來源綁定及宿主回執。本欄不否定既有正式閱讀，也不由本機保存成功推論交接成功。',retry:'目前 status 為唯讀，不會重試登錄；無可用重試入口時明示限制。'},
    unsupported:[...(capabilities.sessionControl===false?['此接點不支援 /cmcp on 或 off；請在專案入口使用 /enable harness、/enable codex 或 /disable。']:[]),...(!capabilities.pinCreate?['此接點沒有可用 Pin 生成／派送宿主，未展示建立按鈕。']:[]),...(!capabilities.ui?['此入口無圖形控制列；正式原文及狀態仍可查閱。']:[])]};
}
export function createControlOptions({clock=Date.now,ttlMs=300000}={}){
  let sourceMenu=null,pinMenu=null;
  function offer(snapshot,context,kind='sources',page=1){
    if(!Number.isSafeInteger(page)||page<1)throw Error('cmcp_invalid_page');
    const rows=kind==='sources'?snapshot.registration?.sources:pinRows(snapshot);
    if(!Array.isArray(rows))throw Error('cmcp_state_unknown');
    const from=(page-1)*50;if(from>=rows.length&&page!==1)throw Error('cmcp_invalid_page');
    const selected=structuredClone(rows.slice(from,from+50)),menu={id:randomUUID(),scopeId:context.scopeId,sessionId:context.sessionId,generation:snapshot.controlConfiguration?.generation,expiresAt:clock()+ttlMs,rows:selected};
    if(kind==='sources')sourceMenu=menu;else pinMenu=menu;
    return {kind,page,total:rows.length,shown:selected.length,hasNext:from+selected.length<rows.length,coverage:'目前正式清冊的這一頁；不是全部 History 或已讀原文',expiresAt:new Date(menu.expiresAt).toISOString(),
      choices:selected.map((row,i)=>({option:i+1,choice:menu.id+':'+(i+1),...(kind==='sources'?{role:row.sourceAuthorRole??null,time:row.messageRecordedAt??null,pointer:row.pointer,evidenceHash:row.evidenceHash}:{pinId:row.pinId??row.id,revision:row.revision,dueAt:row.dueAt??null,status:row.status})}))};
  }
  function choose(value,snapshot,context,kind='sources'){
    const menu=kind==='sources'?sourceMenu:pinMenu,parts=String(value).split(':'),n=Number(parts.at(-1));
    if(!menu||clock()>=menu.expiresAt||menu.scopeId!==context.scopeId||menu.sessionId!==context.sessionId||menu.generation!==snapshot.controlConfiguration?.generation
      ||parts.length>2||(parts.length===2&&parts[0]!==menu.id)||!Number.isSafeInteger(n)||n<1||n>menu.rows.length)throw Error('cmcp_choice_expired_refresh_required');
    const prior=menu.rows[n-1],rows=kind==='sources'?snapshot.registration?.sources:pinRows(snapshot);
    if(!rows?.some(row=>identity(row)===identity(prior)))throw Error('cmcp_choice_source_changed');
    return prior;
  }
  function resolve(input,snapshot,context){
    if(typeof input!=='string'||input.length>16384)throw Error('cmcp_invalid_command');
    const match=/^(\S+)(?:\s+([\s\S]*))?$/u.exec(input.trim()),operation=match?.[1]??'help',tail=match?.[2]??'';
    const words=tail.split(/\s+/).filter(Boolean),generation=snapshot?.controlConfiguration?.generation;
    const payload=extra=>({scopeId:context.scopeId,generation,...extra});
    if(['help','menu','status','on','off','buffer','time','clear-buffer','retry-registration'].includes(operation)){
      if(tail)throw Error('cmcp_unexpected_arguments');return {operation,...(['clear-buffer','retry-registration'].includes(operation)?{payload:payload({})}:{})};}
    if(operation==='ui'){if(words.length!==1||!DISPLAY_MODES.includes(words[0]))throw Error('cmcp_invalid_display_mode');return {operation,uiPreference:words[0]};}
    if(operation==='sources'||operation==='pins'){if(words.length>1)throw Error('cmcp_unexpected_arguments');return {operation,choices:offer(snapshot,context,operation,words.length?Number(words[0]):1)};}
    if(['read','original','media-list'].includes(operation)&&!tail.startsWith('{')){
      if(!words.length||words.length>(operation==='media-list'?1:2))throw Error('cmcp_source_choice_required');const source=choose(words[0],snapshot,context);
      const payload={pointer:source.pointer,evidenceHash:source.evidenceHash};
      if(operation!=='media-list'){
        const page=words[1]===undefined?1:Number(words[1]),start=(source.location?.start??0)+(page-1)*2048,end=Math.min(source.location?.end,start+2048);
        if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(end)||start>=end)throw Error('cmcp_source_range_unavailable');
        Object.assign(payload,{start,end,maxBytes:8192});
      }
      return {operation:operation==='read'?'original':operation,payload};}
    if(operation==='set'){
      if(words.length!==2||!booleanKeys[words[0]])throw Error('cmcp_unknown_control');
      return {operation:'controls',payload:payload({patch:{[booleanKeys[words[0]]]:bool(words[1])}})};
    }
    if(operation==='dnd'){
      let dnd;if(words.length===1&&words[0]==='off')dnd={enabled:false,timezone:null,windows:[]};
      else if(words.length===3)dnd={enabled:true,timezone:words[0],windows:[{start:words[1],end:words[2]}]};
      else throw Error('cmcp_explicit_dnd_required');return {operation:'controls',payload:payload({patch:{doNotDisturb:dnd}})};
    }
    if(['pin','pin-time','pin-cancel','pin-complete'].includes(operation)){
      if(words.length!==(operation==='pin'||operation==='pin-time'?2:1))throw Error('cmcp_pin_choice_required');
      const due=words[1];if(due&&due!=='none'&&(!/(?:Z|[+-]\d\d:\d\d)$/.test(due)||!Number.isFinite(Date.parse(due))))throw Error('cmcp_pin_explicit_timezone_required');
      if(operation==='pin'){if(!context.capabilities?.pinCreate)throw Error('cmcp_pin_host_unavailable');const source=choose(words[0],snapshot,context);return {operation:'pin-create',payload:payload({sessionId:context.sessionId,sourceIds:[source.id],dueAt:due==='none'?null:new Date(due).toISOString()})};}
      if(!context.capabilities?.pinChange)throw Error('cmcp_pin_host_unavailable');const pin=choose(words[0],snapshot,context,'pins');
      return {operation:'pin-change',payload:payload({pinId:pin.pinId??pin.id,expectedRevision:pin.revision,change:operation==='pin-time'?'schedule':operation==='pin-cancel'?'cancel':'complete',...(operation==='pin-time'?{dueAt:due==='none'?null:new Date(due).toISOString()}:{})})};
    }
    // 保留已交付 UI 的結構化命令相容性；最後仍由正式宿主核對 scope／generation／授權。
    if(['original','media-list','controls','pin-create','pin-change'].includes(operation)&&tail.startsWith('{'))return {operation,payload:JSON.parse(tail)};
    throw Error('cmcp_unknown_command');
  }
  return {offer,resolve,clear(){sourceMenu=null;pinMenu=null;}};
}
