import {todayInZone} from '../dates.ts';
import {focusIds} from '../derived.ts';
import type {Task,WorkspaceData} from '../model.ts';

// Read-only view of today's work for the Slack assistant, so "오늘 할 일" is answered from
// ORBIT itself. Items are the ones to act on first: today's focus, overdue, due today, in progress.
export type TodayState='focus'|'overdue'|'today'|'doing';
const ORDER:TodayState[]=['focus','overdue','today','doing'];
const MAX_ITEMS=10;

export function slackToday(data:WorkspaceData,now:Date,origin:string){
 const date=todayInZone(data.preferences.timeZone,now);
 const focus=focusIds(data,date);
 const open=data.tasks.filter(t=>t.status!=='done');
 const stateOf=(t:Task):TodayState|null=>focus.has(t.id)?'focus':t.due<date?'overdue':t.due===date?'today':t.status==='doing'?'doing':null;
 const project=(t:Task)=>data.projects.find(p=>p.id===t.projectId)?.name??null;
 const ranked=open.flatMap(t=>{const state=stateOf(t);return state?[{t,state}]:[]})
  .sort((a,b)=>ORDER.indexOf(a.state)-ORDER.indexOf(b.state)||a.t.due.localeCompare(b.t.due));
 return {
  contract:'orbit-slack-today-v1' as const,
  date,
  counts:{
   // "오늘 할 일": today's focus plus everything due today or already overdue.
   today:open.filter(t=>t.due<=date||focus.has(t.id)).length,
   overdue:open.filter(t=>t.due<date).length,
   doing:open.filter(t=>t.status==='doing').length,
   focus:open.filter(t=>focus.has(t.id)).length,
   doneToday:data.tasks.filter(t=>t.status==='done'&&t.completedOn===date).length,
   open:open.length,
  },
  items:ranked.slice(0,MAX_ITEMS).map(({t,state})=>({title:t.title,due:t.due,state,status:t.status,project:project(t)})),
  url:origin+'/#today',
 };
}
