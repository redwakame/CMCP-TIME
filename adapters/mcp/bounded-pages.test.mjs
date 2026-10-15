import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedFormalPages,CONTINUITY_BATCH_CHILD_BYTES} from './tools.mjs';

const child=(page,complete=false)=>({kind:'cmcp_continuity_delivery_page',status:'provided',ticket:'t',projectionHash:'a'.repeat(64),projectionStatus:'ready',
 delivery:{id:'d',page,pageCount:4,complete,nextPage:complete?null:String(page+1),resultHash:'b'.repeat(64),resultBytes:90000,resultChars:85000},
 sections:[{path:'/source',value:'原文與原時間'+'🧩'.repeat(8000)}]});
const args={ticket:'t',deliveryId:'d',page:'1',maxPages:2};
test('bounded continuity pair 保留完整 child 與 UTF-8 bytes，maxPages 不下傳',async()=>{
 const calls=[],pages=[child(1),child(2)];let checks=0;
 const result=await readBoundedFormalPages({operation:'continuity-page',args,responseBytes:262144,check:async()=>{checks++;},read:async value=>{calls.push(value);return pages[calls.length-1];}});
 assert.deepEqual(result.pages,pages);assert.deepEqual(calls,[{ticket:'t',deliveryId:'d',page:'1'},{ticket:'t',deliveryId:'d',page:'2'}]);
 assert.equal(checks,5);assert.ok(Buffer.byteLength(JSON.stringify(result))<262144);assert.equal(result.coverage,undefined);assert.equal(result.delivery,undefined);
});
test('省略批次的 helper 單頁結果原樣；maxPages=1 不包裝',async()=>{
 const page=child(1),result=await readBoundedFormalPages({operation:'continuity-page',args:{...args,maxPages:1},responseBytes:262144,check:async()=>{},read:async()=>page});
 assert.equal(result,page);
});
test('第二頁前預留不足則明示只回實際第一頁，下一頁從未 dispatch',async()=>{
 let reads=0;const page=child(1),result=await readBoundedFormalPages({operation:'continuity-page',args,responseBytes:CONTINUITY_BATCH_CHILD_BYTES+1000,check:async()=>{},read:async()=>{reads++;return page;}});
 assert.equal(reads,1);assert.deepEqual(result.pages,[page]);assert.equal(result.stopReason,'response_budget');assert.equal(result.pages[0].delivery.nextPage,'2');assert.equal(result.pages[0].delivery.complete,false);
});
test('第一頁契約預留不足不消耗正式頁',async()=>{
 let reads=0;await assert.rejects(readBoundedFormalPages({operation:'continuity-page',args,responseBytes:1024,check:async()=>{},read:async()=>{reads++;return child(1);}}),/response_budget/);assert.equal(reads,0);
});
test('每頁與最後出口守護失敗不回傳 aggregate，不宣稱 server commit 回退',async()=>{
 for(const stopAt of [1,2,3,4,5]){let checks=0,reads=0;
  await assert.rejects(readBoundedFormalPages({operation:'continuity-page',args,responseBytes:262144,check:async()=>{if(++checks===stopAt)throw Error('synthetic_authorization_epoch_cancel_timeout');},read:async value=>{reads++;return child(Number(value.page));}}),/authorization_epoch_cancel_timeout/);
  assert.equal(reads,Math.floor(stopAt/2));
 }
});
test('全域 nextPage 不能把重讀後第二頁跳號，真正末頁不多讀',async()=>{
 const calls=[],first=child(1);first.delivery.nextPage='3';
 const result=await readBoundedFormalPages({operation:'continuity-page',args,responseBytes:262144,check:async()=>{},read:async value=>{calls.push(value.page);return calls.length===1?first:child(2);}});
 assert.deepEqual(calls,['1','2']);assert.equal(result.pages.length,2);
 let count=0;const last=await readBoundedFormalPages({operation:'continuity-page',args:{...args,page:'3'},responseBytes:262144,check:async()=>{},read:async()=>{count++;return child(3,true);}});assert.equal(count,1);assert.equal(last.stopReason,'formal_completion');
});
test('同票不同 delivery/hash 與非法頁數拒絕，不裁原文求通過',async()=>{
 for(const key of ['ticket','id','resultHash']){let count=0;await assert.rejects(readBoundedFormalPages({operation:'continuity-page',args,responseBytes:262144,check:async()=>{},read:async()=>{const page=child(++count);if(count===2){if(key==='ticket')page.ticket='other';else page.delivery[key]='other';}return page;}}),/binding_changed/);}
 for(const maxPages of [0,3,1.5,'2',true])await assert.rejects(readBoundedFormalPages({operation:'continuity-page',args:{...args,maxPages},responseBytes:262144,check:async()=>{},read:async()=>child(1)}),/batch_invalid/);
});
