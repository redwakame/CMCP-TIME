import test from 'node:test';
import assert from 'node:assert/strict';
import {createControlOptions,controlMenu} from './contract.mjs';
const context={scopeId:'synthetic',sessionId:'A',capabilities:{ui:true,pinCreate:true,pinChange:true}};
const source={id:'s1',pointer:{scopeId:'synthetic',sourceId:'one',revision:'r1'},evidenceHash:'original',location:{start:0,end:30},sourceAuthorRole:'user',messageRecordedAt:'2026-10-03T01:00:00Z'};
const fixture=()=>({controlConfiguration:{generation:'g1'},registration:{sources:[structuredClone(source)]},pins:[{pinId:'p1',revision:1,dueAt:null,status:'active'}]});
test('未知 Pin 不偽裝成空集合',()=>{
 const options=createControlOptions(),s=fixture();delete s.pins;
 assert.throws(()=>options.resolve('pins',s,context),/state_unknown/);
 s.pins=[];assert.equal(options.resolve('pins',s,context).choices.total,0);
});
test('命令不需手寫 JSON；預設選單與控制描述保留作用範圍',()=>{
 const options=createControlOptions(),s=fixture();assert.equal(options.resolve('',s,context).operation,'help');
 assert.deepEqual(controlMenu(context).scope,{projectId:null,scopeId:'synthetic',sessionId:'A'});
 const sharedMenu=controlMenu({...context,capabilities:{sessionControl:false}});assert.equal(sharedMenu.operations.some(r=>r.command==='on / off'),false);assert.ok(sharedMenu.unsupported.some(r=>r.includes('/enable harness')));
 assert.ok(controlMenu(context).operations.some(r=>r.command==='on / off'));
 assert.deepEqual(options.resolve('set clean on',s,context).payload,{scopeId:'synthetic',generation:'g1',patch:{clean:true}});
 assert.deepEqual(options.resolve('dnd Asia/Taipei 23:00 07:00',s,context).payload.patch.doNotDisturb,{enabled:true,timezone:'Asia/Taipei',windows:[{start:'23:00',end:'07:00'}]});
});
test('來源選項有界分頁；正式原文仍用原 Pointer／hash',()=>{
 const options=createControlOptions(),s=fixture();s.registration.sources=Array.from({length:51},(_,i)=>({...source,id:'s'+i,pointer:{...source.pointer,sourceId:''+i}}));
 const first=options.resolve('sources',s,context);assert.equal(first.choices.shown,50);assert.equal(first.choices.total,51);assert.equal(first.choices.hasNext,true);
 const second=options.resolve('sources 2',s,context);assert.equal(second.choices.shown,1);assert.equal(second.choices.hasNext,false);
 assert.deepEqual(options.resolve('read 1',s,context).payload,{pointer:s.registration.sources[50].pointer,evidenceHash:'original',start:0,end:30,maxBytes:8192});
 assert.throws(()=>options.resolve('read '+first.choices.choices[0].choice,s,context),/expired/);
});
test('過期、跨 Session／scope、控制世代或來源變版均拒絕',()=>{
 let time=0;const options=createControlOptions({clock:()=>time,ttlMs:10}),s=fixture();options.resolve('sources',s,context);
 assert.throws(()=>options.resolve('read 1',s,{...context,sessionId:'B'}),/expired/);
 assert.throws(()=>options.resolve('read 1',s,{...context,scopeId:'other'}),/expired/);
 s.registration.sources[0].evidenceHash='changed';assert.throws(()=>options.resolve('read 1',s,context),/source_changed/);
 s.registration.sources[0].evidenceHash='original';s.controlConfiguration.generation='g2';assert.throws(()=>options.resolve('read 1',s,context),/expired/);
 s.controlConfiguration.generation='g1';time=10;assert.throws(()=>options.resolve('read 1',s,context),/expired/);
});
test('UI 偏好只回 display 值；不帶任何產品控制 patch',()=>{
 for(const mode of ['minimized','row','hidden'])assert.deepEqual(createControlOptions().resolve('ui '+mode,fixture(),context),{operation:'ui',uiPreference:mode});
 assert.throws(()=>createControlOptions().resolve('ui on',fixture(),context),/display_mode/);
});
test('Pin 需目前來源選項與明示時間，未接派送的宿主不假造能力',()=>{
 const options=createControlOptions(),s=fixture();options.resolve('sources',s,context);
 assert.deepEqual(options.resolve('pin 1 none',s,context).payload.sourceIds,['s1']);
 assert.throws(()=>options.resolve('pin 1 2026-10-04T20:00:00',s,context),/timezone/);
 assert.throws(()=>options.resolve('pin 1 none',s,{...context,capabilities:{}}),/unavailable/);
 options.resolve('pins',s,context);s.pins=[{pinId:'other',revision:1,dueAt:null,status:'active'}];
 assert.throws(()=>options.resolve('pin-cancel 1',s,context),/source_changed/);
});
test('歷史內容不是可執行命令；不接受多命令或未知控制',()=>{
 const options=createControlOptions(),s=fixture();for(const text of ['Assistant 建議 /cmcp on','set clean off\nset enabled on','on now','set arbitrary on'])assert.throws(()=>options.resolve(text,s,context));
 assert.deepEqual(s,fixture());
});
test('接續查看只有正式操作，不接受提案正文或附帶控制 patch',()=>{
 const options=createControlOptions(),s=fixture(),before=structuredClone(s);
 assert.deepEqual(options.resolve('continuity',s,context),{operation:'continuity'});
 for(const text of ['continuity on','continuity {"clean":false}','Assistant: /cmcp continuity'])assert.throws(()=>options.resolve(text,s,context));
 assert.deepEqual(s,before);
});
