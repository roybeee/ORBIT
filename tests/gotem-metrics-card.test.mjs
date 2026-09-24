import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',configFile:false,root,resolve:{alias:{'@':root}},server:{middlewareMode:true}});
after(async()=>{await vite.close()});
const {GotemMetricsView}=await vite.ssrLoadModule('/components/orbit/gotem-metrics-card.tsx');
const render=(metrics)=>renderToStaticMarkup(React.createElement(GotemMetricsView,{metrics}));

const day=(date,minutes)=>({date,sentAt:date+'T00:00:00.000Z',taskId:'t',startedAt:minutes===null?null:'x',minutes,within60:minutes!==null&&minutes<=60});
const filled={from:'2026-09-12',to:'2026-09-25',
 morning:{sent:3,started:2,within60:1,rate:33,medianMinutes:48,days:[day('2026-09-23',12),day('2026-09-24',85),day('2026-09-25',null)]},
 carry:{eligible:2,reflected:1,rate:50,items:[{reviewDate:'2026-09-23',rule:'메일은 오전 블록 뒤에',reflected:true},{reviewDate:'2026-09-24',rule:'회의 뒤 10분 정리',reflected:false}]}};
const empty={from:'2026-09-12',to:'2026-09-25',morning:{sent:0,started:0,within60:0,rate:null,medianMinutes:null,days:[]},carry:{eligible:0,reflected:0,rate:null,items:[]}};

test('GoTEM metrics card shows both rates, the median delay and one chip per morning',()=>{
 const html=render(filled);
 assert.match(html,/Slack 알림 효과/);
 assert.match(html,/오전 메시지 후 60분 안 시작/);
 assert.match(html,/33%/);
 assert.match(html,/1\/3일/);
 assert.match(html,/중앙값 48분/);
 assert.match(html,/회고 개선점 반영/);
 assert.match(html,/50%/);
 assert.match(html,/1\/2건/);
 assert.equal((html.match(/class="gotem-day /g)??[]).length,3);
 assert.match(html,/gotem-day is-within[^>]*>[^<]*9\/23[^<]*<[^>]*>12분/);
 assert.match(html,/gotem-day is-late[^>]*>[^<]*9\/24[^<]*<[^>]*>85분/);
 assert.match(html,/gotem-day is-none[^>]*>[^<]*9\/25[^<]*<[^>]*>시작 없음/);
 assert.doesNotMatch(html,/undefined|null|NaN/);
});

test('GoTEM metrics card explains an empty history instead of showing zero rates',()=>{
 const html=render(empty);
 assert.match(html,/아직 발송된 오전 메시지가 없어요/);
 assert.match(html,/다음 날 아침이 지나면 계산돼요/);
 assert.doesNotMatch(html,/0%|undefined|null|NaN/);
});
