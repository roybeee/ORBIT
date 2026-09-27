import type {CalendarEvent,Task} from './model';
import {addDays,weekday} from './dates.ts';
import {calendarTimeline} from './calendar-timeline.ts';

// Monday-first, like the week strip.
export const weekdayLabels=['월','화','수','목','금','토','일'] as const;
export const HOUR_PX=60;
// A short event still needs room for one line of title.
const MIN_BLOCK_MINUTES=20;

export function mondayIndex(date:string){return (weekday(date)+6)%7}

// Same day of month, clamped to the target month's length (1/31 → 2/28).
export function shiftMonth(date:string,months:number){
 const index=Number(date.slice(0,4))*12+Number(date.slice(5,7))-1+months,year=Math.floor(index/12),month=index-year*12;
 const day=Math.min(Number(date.slice(8,10)),new Date(Date.UTC(year,month+1,0)).getUTCDate());
 return `${String(year).padStart(4,'0')}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

// Every week that touches the month: 4 to 6 rows of 7.
export function monthGrid(date:string):string[]{
 const first=date.slice(0,8)+'01',last=addDays(shiftMonth(first,1),-1);
 const start=addDays(first,-mondayIndex(first)),end=addDays(last,6-mondayIndex(last));
 const out:string[]=[];for(let day=start;day<=end;day=addDays(day,1))out.push(day);return out;
}

// Google events kept for a sync date: six weeks, [from, to).
export function calendarSyncWindow(day:string){return {from:addDays(day,-7),to:addDays(day,35)}}
// Anchoring a week into the grid covers all of its rows, so the month grid, its days and their
// week strips share one window instead of refetching on every tap.
export function calendarSyncDate(date:string){return addDays(monthGrid(date)[0],7)}

// Meetings first so carried-over tasks cannot bury them in a small month cell.
function monthRank(event:CalendarEvent,done:Set<string>){
 if(event.taskId&&done.has(event.taskId))return 3;
 if(event.id.startsWith('task-due:'))return 2;
 return event.allDay?0:1;
}
export function monthItems(tasks:Task[],events:CalendarEvent[],dates:string[],today:string){
 const byDate=new Map<string,CalendarEvent[]>(),done=new Set(tasks.filter(t=>t.status==='done').map(t=>t.id));
 for(const event of events){const list=byDate.get(event.date);if(list)list.push(event);else byDate.set(event.date,[event]);}
 return new Map(dates.map(date=>{
  const rows=calendarTimeline(tasks,byDate.get(date)??[],date,today).map((event,index)=>({event,index,rank:monthRank(event,done)}));
  return [date,rows.sort((a,b)=>a.rank-b.rank||(a.rank===1?a.event.start-b.event.start:0)||a.index-b.index).map(r=>r.event)];
 }));
}

export interface PlacedEvent {event:CalendarEvent;column:number;columns:number}
// Side-by-side columns for events whose drawn blocks overlap, like Google's day view.
export function dayColumns(events:CalendarEvent[]):PlacedEvent[]{
 const sorted=[...events].sort((a,b)=>a.start-b.start||b.end-a.end||a.id.localeCompare(b.id));
 const out:PlacedEvent[]=[];let cluster:PlacedEvent[]=[],ends:number[]=[],clusterEnd=-1;
 const close=()=>{for(const placed of cluster)placed.columns=ends.length;cluster=[];ends=[];};
 for(const event of sorted){
  const end=Math.max(event.end,event.start+MIN_BLOCK_MINUTES);
  if(cluster.length&&event.start>=clusterEnd)close();
  let column=ends.findIndex(e=>e<=event.start);
  if(column===-1){column=ends.length;ends.push(end)}else ends[column]=end;
  const placed={event,column,columns:1};cluster.push(placed);out.push(placed);
  clusterEnd=cluster.length===1?end:Math.max(clusterEnd,end);
 }
 close();return out;
}
export function blockHeight(event:CalendarEvent){return Math.max(event.end,event.start+MIN_BLOCK_MINUTES)-event.start}

// Start at 06:00 unless something is earlier; always run to midnight.
export function dayHours(events:CalendarEvent[]){
 const first=Math.min(360,...events.map(e=>e.start));
 return {from:Math.floor(first/60),to:24};
}
export function hourLabel(hour:number){return hour===0||hour===24?'오전 12시':hour<12?`오전 ${hour}시`:hour===12?'오후 12시':`오후 ${hour-12}시`}
