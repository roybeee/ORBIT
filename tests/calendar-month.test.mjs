import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {addDays} from '../lib/orbit/dates.ts';
import {monthGrid,shiftMonth,calendarSyncDate,calendarSyncWindow,monthItems,dayColumns,dayHours,hourLabel} from '../lib/orbit/calendar-month.ts';

const task={id:'t',title:'채용 제안',projectId:'p',due:'2026-09-21',status:'todo',duration:45,impact:3,focus:false,definition:'전달',category:'work'};
const event={id:'e',title:'미팅',date:'2026-09-21',start:600,end:660,kind:'meeting'};

test('the month grid is whole Monday-first weeks touching the month',()=>{
 const sep=monthGrid('2026-09-27');
 assert.equal(sep.length,35);assert.equal(sep[0],'2026-08-31');assert.equal(sep.at(-1),'2026-10-04');
 const nov=monthGrid('2026-11-15');
 assert.equal(nov.length,42,'November 2026 starts on a Sunday and needs six rows');assert.equal(nov[0],'2026-10-26');assert.equal(nov.at(-1),'2026-12-06');
 assert.equal(monthGrid('2027-02-10').length,28,'February 2027 starts on a Monday and fills exactly four rows');
});

test('month steps keep the day and clamp it to the target month',()=>{
 assert.equal(shiftMonth('2026-01-31',1),'2026-02-28');
 assert.equal(shiftMonth('2024-03-31',-1),'2024-02-29');
 assert.equal(shiftMonth('2026-12-15',1),'2027-01-15');
 assert.equal(shiftMonth('2026-01-10',-1),'2025-12-10');
});

test('one Google sync window covers every grid day of the displayed month',()=>{
 for(let month=shiftMonth('2026-01-01',0);month<'2028-01-01';month=shiftMonth(month,1)){
  const grid=monthGrid(month),{from,to}=calendarSyncWindow(calendarSyncDate(month));
  assert.ok(from<=grid[0]&&grid.at(-1)<to,`${month}: ${from}..${to} misses ${grid[0]}..${grid.at(-1)}`);
  for(const day of [month.slice(0,8)+'01',month.slice(0,8)+'15',addDays(shiftMonth(month,1),-1)])assert.equal(calendarSyncDate(day),calendarSyncDate(month),'every day of the month shares one sync date');
 }
});

test('month cells list meetings before tasks and completed work last',()=>{
 const today='2026-09-21';
 const tasks=[{...task,id:'old',title:'이월',due:'2026-09-19'},{...task,id:'done',title:'끝난 일',status:'done',completedOn:today},{...task,id:'wait',status:'waiting'},{...task,id:'timed',title:'배정된 일'}];
 const events=[{...event,id:'late',start:900,end:960},event,{...event,id:'holiday',title:'추석',allDay:true,start:0,end:1440},{...event,id:'block',taskId:'timed',start:480,end:540},{...event,id:'other-day',date:'2026-09-22'}];
 const items=monthItems(tasks,events,monthGrid(today),today);
 assert.deepEqual(items.get(today).map(e=>e.id),['holiday','block','e','late','task-due:old','task-due:done']);
 assert.deepEqual(items.get('2026-09-22').map(e=>e.id),['other-day']);
 assert.deepEqual(items.get('2026-09-19'),[],'an unfinished task is carried to today, not its past due date');
 assert.equal(items.size,35);
});

test('overlapping events share the width in columns; touching ones do not',()=>{
 const placed=dayColumns([{...event,id:'a',start:600,end:660},{...event,id:'b',start:615,end:700},{...event,id:'c',start:630,end:690},{...event,id:'d',start:700,end:760},{...event,id:'e',start:840,end:900}]);
 const by=Object.fromEntries(placed.map(p=>[p.event.id,[p.column,p.columns]]));
 assert.deepEqual(by,{a:[0,3],b:[1,3],c:[2,3],d:[0,1],e:[0,1]});
 const short=dayColumns([{...event,id:'x',start:600,end:605},{...event,id:'y',start:610,end:640}]);
 assert.deepEqual(short.map(p=>p.columns),[2,2],'a five-minute block is drawn taller, so the next one moves beside it');
});

test('the hour range starts at 06:00 unless an event starts earlier',()=>{
 assert.deepEqual(dayHours([event]),{from:6,to:24});
 assert.deepEqual(dayHours([{...event,start:270,end:300}]),{from:4,to:24});
 assert.deepEqual(dayHours([]),{from:6,to:24});
 assert.deepEqual([0,9,12,15].map(hourLabel),['오전 12시','오전 9시','오후 12시','오후 3시']);
});

const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',configFile:false,root,resolve:{alias:{'@':root}},server:{middlewareMode:true},logLevel:'error'});
after(async()=>{await vite.close();});
const preferences={timeZone:'Asia/Seoul'};
const noop=()=>{};

test('the month view shows a few titles per day, the overflow count and today',async()=>{
 const {CalendarMonth}=await vite.ssrLoadModule('/components/orbit/calendar-month.tsx');
 const events=Array.from({length:6},(_,i)=>({...event,id:'m'+i,title:'미팅 '+i,start:540+i*60,end:600+i*60}));
 const html=renderToStaticMarkup(React.createElement(CalendarMonth,{date:'2026-09-21',today:'2026-09-21',tasks:[],events,preferences,onSelect:noop,onStep:noop}));
 assert.equal((html.match(/class="calendar-month-cell/g)??[]).length,35);
 assert.match(html,/aria-label="9월 21일 월요일, 오늘, 6개: 미팅 0, 미팅 1, 미팅 2 외" aria-current="date"/);
 assert.equal((html.match(/class="calendar-month-chip/g)??[]).length,3,'three titles and a +3 line fill the four lines of a cell');
 assert.match(html,/<span class="calendar-month-more">\+3<\/span>/);
 assert.match(html,/aria-label="10월 1일 목요일, 일정 없음"/);
 assert.match(html,/class="calendar-month-cell is-outside"/);
});

test('the day view places timed events on an hour grid below all-day items',async()=>{
 const {CalendarDayGrid}=await vite.ssrLoadModule('/components/orbit/calendar-day-grid.tsx');
 const events=[{id:'task-due:t',taskId:'t',title:'채용 제안',date:'2026-09-21',start:0,end:1440,allDay:true,kind:'focus'},{...event,start:840,end:930}];
 const html=renderToStaticMarkup(React.createElement(CalendarDayGrid,{date:'2026-09-21',today:'2026-09-21',nowMinute:750,events,tasks:[task],projects:[],preferences,disabled:false,onOpen:noop,onScheduleTask:noop,onToggleTask:noop,onCreateAt:noop}));
 assert.match(html,/종일 · 시간 미정 <span>1개<\/span>/);
 assert.match(html,/할 일 · 시간 미정/);assert.match(html,/시간 배정/);
 // 06:00 is the first line: 14:00 sits 8 hours × 60px below it.
 assert.match(html,/id="day-block-e"[^>]*style="top:481px;height:88px;left:calc\(0 \* 100% \/ 1\);width:calc\(100% \/ 1 - 3px\)/);
 assert.match(html,/aria-label="미팅, 14:00부터 15:30까지"/);
 assert.equal((html.match(/class="day-grid-slot"/g)??[]).length,18);
 assert.match(html,/aria-label="오후 3시에 일정 추가"/);
 assert.match(html,/class="day-grid-now" style="top:390px"/);
 const other=renderToStaticMarkup(React.createElement(CalendarDayGrid,{date:'2026-09-22',today:'2026-09-21',nowMinute:750,events:[],tasks:[],projects:[],preferences,disabled:false,onOpen:noop,onScheduleTask:noop,onToggleTask:noop}));
 assert.doesNotMatch(other,/day-grid-now|day-grid-allday|day-grid-slot/,'no now line on another day, and no slots without a create handler');
});
