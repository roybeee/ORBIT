import test from 'node:test';
import assert from 'node:assert/strict';
import {dayMode,NIGHT_END} from '../lib/orbit/day-mode.ts';

const at=(h,m=0)=>h*60+m;
const base={workStart:at(9),eveningHour:21};

test('the day moves from morning briefing to focus to the evening review',()=>{
 assert.equal(dayMode({...base,minute:at(7,40)}),'morning');
 assert.equal(dayMode({...base,minute:at(9,59)}),'morning','the first work hour is still for the briefing');
 assert.equal(dayMode({...base,minute:at(10)}),'day');
 assert.equal(dayMode({...base,minute:at(20,59)}),'day');
 assert.equal(dayMode({...base,minute:at(21)}),'evening','evening starts at the same hour the server prepares tomorrow');
 assert.equal(dayMode({...base,minute:at(23,30)}),'evening');
});

test('after midnight is still the evening until the night ends',()=>{
 assert.equal(dayMode({...base,minute:at(1)}),'evening');
 assert.equal(dayMode({...base,minute:NIGHT_END-1}),'evening');
 assert.equal(dayMode({...base,minute:NIGHT_END}),'morning');
});

test('an early evening hour or late work start never skips the evening',()=>{
 assert.equal(dayMode({workStart:at(18),eveningHour:18,minute:at(18,30)}),'evening');
 assert.equal(dayMode({workStart:at(13),eveningHour:21,minute:at(12)}),'morning');
 assert.equal(dayMode({workStart:at(13),eveningHour:21,minute:at(14,30)}),'day');
});

import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {after} from 'node:test';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',configFile:false,root,resolve:{alias:{'@':root}},server:{middlewareMode:true}});
after(async()=>{await vite.close();});

async function home(iso,over={}){
 const {emptyWorkspace}=await vite.ssrLoadModule('/lib/orbit/model.ts');
 const {TodayHome}=await vite.ssrLoadModule('/components/orbit/today-home.tsx');
 const data=emptyWorkspace();Object.assign(data,over);
 const noop=()=>{};
 return renderToStaticMarkup(React.createElement(TodayHome,{data,now:new Date(iso),busy:false,demo:true,eveningHour:21,inboxCount:2,onInbox:noop,perform:async()=>true,onOpen:noop,navigate:noop,onCreate:noop,onAsk:noop,onCalendar:noop,onProposal:noop,onTimeSettings:noop}));
}

test('오늘 opens as the morning briefing before work and as the review card in the evening',async()=>{
 const morning=await home('2026-09-26T22:30:00Z');// 07:30 Seoul next day
 assert.match(morning,/data-day-mode="morning"/);
 assert.match(morning,/아침 브리핑/);
 assert.match(morning,/aria-pressed="true"[^>]*>[\s\S]*?아침<small> 지금<\/small>/);
 const evening=await home('2026-09-26T12:30:00Z');// 21:30 Seoul
 assert.match(evening,/data-day-mode="evening"/);
 assert.match(evening,/하루를 돌아보는 5분/);
 assert.match(evening,/회고 시작/);
});

test('after the review the evening card leads to tomorrow and the inbox replaces the old proposal list',async()=>{
 const html=await home('2026-09-26T12:30:00Z',{reviews:[{id:'r',date:'2026-09-26',win:'',block:'',energy:'normal',completedIds:[]}]});
 assert.match(html,/오늘 회고를 마쳤어요/);
 assert.match(html,/결재함 · 정할 일 2건/);
 assert.doesNotMatch(html,/확인할 제안|집중과 돌아보기|하루를 마무리할까요/);
});

test('a very early preparation hour never leaves 오늘 stuck in the evening',()=>{
 assert.equal(dayMode({workStart:at(9),eveningHour:0,minute:at(14)}),'day');
 assert.equal(dayMode({workStart:at(9),eveningHour:2,minute:at(17,59)}),'day');
 assert.equal(dayMode({workStart:at(9),eveningHour:2,minute:at(18)}),'evening');
});

test('after midnight the evening card still closes the previous day',async()=>{
 const html=await home('2026-09-26T15:30:00Z',{// 00:30 Seoul on 09-27
  reviews:[{id:'r',date:'2026-09-26',win:'',block:'',energy:'normal',completedIds:[]}],
  proposals:[{id:'plan:2026-09-27',date:'2026-09-27',budget:0,energy:'normal',unscheduled:[],items:[{id:'i',taskId:'t',start:600,end:660,reason:'',state:'pending'}]}],
 });
 assert.match(html,/data-day-mode="evening"/);
 assert.match(html,/오늘 회고를 마쳤어요/);
 assert.match(html,/결재함에서 승인/);
});
