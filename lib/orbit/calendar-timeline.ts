import type {CalendarEvent,Task} from './model';
import {taskCalendarDate,taskCalendarEvent} from './calendar-categories.ts';

// A view only: untimed tasks never become busy calendar intervals or saved events.
export function calendarTimeline(tasks:Task[],events:CalendarEvent[],date:string,today:string):CalendarEvent[]{
 const taskById=new Map(tasks.map(t=>[t.id,t]));
 const due=tasks.filter(t=>t.status!=='waiting'&&taskCalendarDate(t,today)===date),dueIds=new Set(due.map(t=>t.id));
 const scheduled=events.filter(e=>e.date===date).flatMap(event=>{
  const source=event.google?.orbitEventId;
  const mirrorId=source?.startsWith('task-due:')?source.slice(9):undefined;
  // Replace an exported all-day reminder with the source task once. Preserve
  // externally moved/timed events and all distinct scheduled work blocks.
  if(mirrorId&&(dueIds.has(mirrorId)||taskById.get(mirrorId)?.status==='waiting')&&event.allDay)return [];
  return [mirrorId&&taskById.has(mirrorId)?{...event,taskId:mirrorId}:event];
 });
 const linked=new Set(scheduled.map(e=>e.taskId));
 const untimed=due.filter(t=>!linked.has(t.id)).sort((a,b)=>Number(a.status==='done')-Number(b.status==='done')||a.due.localeCompare(b.due)||b.impact-a.impact).map(t=>taskCalendarEvent(t,today));
 const ordered=[...untimed,...scheduled.sort((a,b)=>Number(!!b.allDay)-Number(!!a.allDay)||a.start-b.start||a.end-b.end||a.id.localeCompare(b.id))];
 // Completion is a separate final group, including tasks with a timed block.
 return ordered.sort((a,b)=>Number(taskById.get(a.taskId??'')?.status==='done')-Number(taskById.get(b.taskId??'')?.status==='done'));
}
