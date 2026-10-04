import {createCmcpSourceEvidence} from '../src/cmcp-guard/cmcp-source-evidence.js';
import {createCmcpReactivationStores,createCmcpTemporalSourceCatalog} from '../src/cmcp-guard/cmcp-history-reactivation.js';

// Explicit caller-authored synthetic initialization. Not a routing template or model classification result.
export const REACTIVATION_FIXTURE={scopeId:'synthetic-recall-scope',sessionId:'synthetic-morning-source-session',
  timeContext:{now:'2026-09-14T15:20:00+08:00',timezone:'Asia/Taipei'},
  question:'上午說定那個節慶檔期方案，收單和交付最後怎麼安排的？',
  limits:{maxEntries:8,maxCatalogBytes:6000,maxSources:2,maxSourceBytes:4096,maxProjectionBytes:8000},
  sources:[
    {itemId:'morning-season-plan',at:'2026-09-14T09:20:00+08:00',role:'user',title:'中秋銷售方案',synopsis:'節慶銷售活動的完成紀錄與交付決策。',
      body:'今天上午已完成中秋銷售方案：採預購組合，9月18日截止收單，門市取貨；不走全品項折扣。',
      eventId:'season-plan',objectId:'sales-plan',aspect:'completion',interpretation:'中秋銷售方案已完成。'},
    {itemId:'morning-web-project',at:'2026-09-14T10:05:00+08:00',role:'user',title:'網站改版專案',synopsis:'網站首頁版型的待確認事項。',
      body:'網站改版還沒完成，首頁版型下週再確認，現有網站維持不變。',
      eventId:'website-project',objectId:'site-redesign',aspect:'completion',interpretation:'網站改版尚未完成。'},
    {itemId:'chat-lunch',at:'2026-09-14T11:30:00+08:00',role:'user',title:'午餐閒聊',synopsis:'一般用餐偏好的閒聊。',body:'午餐想吃麵，今天不想吃飯。'},
    {itemId:'chat-reply',at:'2026-09-14T11:31:00+08:00',role:'assistant',title:'用餐回覆',synopsis:'Assistant的一般用餐回應。',body:'祝你午餐愉快。'},
    {itemId:'chat-music',at:'2026-09-14T12:10:00+08:00',role:'user',title:'音樂閒聊',synopsis:'一般聽歌經驗。',body:'剛才聽了一首老歌，旋律很好聽。'}],
  assertions:{selectedItem:'morning-season-plan',completed:'中秋銷售方案已完成。',retainedDecision:['預購','9月18日','門市取貨'],
    forbidden:'不得把另一專案／一般對話注入，不能改為未完成，不取得主動資格；答案作語義審閱，不指定完整措辭。'}};

export async function seedCmcpReactivationFixture(root){
  const fixture=REACTIVATION_FIXTURE,stores=createCmcpReactivationStores({root,scopeId:fixture.scopeId});
  const catalog=createCmcpTemporalSourceCatalog({stores,maxEntries:fixture.limits.maxEntries}),entries=[];
  if((await catalog.list()).length)throw Error('existing_synthetic_seed_do_not_overwrite');
  for(const item of fixture.sources){
    const evidence=createCmcpSourceEvidence({pointer:{version:1,providerNamespace:'cmcp-local-console-v1',scopeId:fixture.scopeId,
      sessionId:fixture.sessionId,itemId:item.itemId,revisionId:'r1'},sourceKind:'message',sourceAuthorRole:item.role,
      messageRecordedAt:item.at,eventOccurredAt:null,content:{kind:'source_excerpt',body:item.body},metadata:{availability:'partial'}});
    if((await stores.history.writeEvidence(evidence)).status!=='stored')throw Error('synthetic_history_failed');
    let eventLink=null;
    if(item.eventId){
      const event={scopeId:fixture.scopeId,eventId:item.eventId},nodeId='synthetic-initial-'+item.itemId;
      const update={version:1,updateId:nodeId,source:{pointer:evidence.pointer,citation:{unit:'unicode_code_points',start:0,end:[...item.body].length,text:item.body}},
        interpretation:{kind:'user_report',temporalUse:'current',text:item.interpretation},
        action:{type:'add_node',objectId:item.objectId,aspect:item.aspect,relation:{kind:'independent',targetNodeIds:[]}}};
      const result=await stores.eventStore(event).applyUpdate(update);
      if(result.status!=='stored')throw Error('synthetic_event_failed:'+JSON.stringify(result));
      eventLink={event,nodeId};
    }
    entries.push((await catalog.register({pointer:evidence.pointer,title:item.title,synopsis:item.synopsis,eventLink})).entry);
  }
  return {kind:'SYNTHETIC_INITIALIZATION',actualModelCalls:0,entries,allowedSourceIds:entries.map(entry=>entry.id),
    sourceTimeNotice:'Synthetic morning timestamps; afternoon is explicitly injected, not a real Host compaction or cross-day test.'};
}
