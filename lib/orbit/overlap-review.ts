import type {CalendarEvent,WorkspaceData} from './model.ts';
import type {WorkspaceAction} from './validation.ts';
import {scheduleBusyEvents} from './task-scheduling.ts';
import {protectedEvents} from './allocation-policy.ts';

export type OverlapTarget={id:string;title:string;startDate:string;endDate:string;start:number;end:number;allDay?:boolean};
export type OverlapReview={confirmation:string;message:string;conflicts:CalendarEvent[]};
const stamp=(date:string,minute:number)=>Date.parse(date+'T00:00:00Z')/60000+minute;
const time=(minute:number)=>String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
// Bind consent to the exact time range and current conflicts. This is a review
// receipt, not a blanket allow-overlap flag; changed conflicts require new consent.
export function overlapReview(target:OverlapTarget,events:CalendarEvent[]):OverlapReview|null{
 const start=stamp(target.startDate,target.allDay?0:target.start),end=stamp(target.endDate,target.allDay?1440:target.end);
 const seen=new Set<string>();
 const conflicts=events.filter(e=>{
  if(e.id===target.id||e.google?.orbitEventId===target.id||e.id.startsWith('task-due:')||e.allDay&&e.google?.orbitEventId?.startsWith('task-due:'))return false;
  if(!(stamp(e.date,e.start)<end&&stamp(e.date,e.end)>start))return false;
  const key=JSON.stringify([e.google?.orbitEventId??e.id,e.date,e.start,e.end]);
  if(seen.has(key))return false;seen.add(key);return true;
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start||a.id.localeCompare(b.id));
 if(!conflicts.length)return null;
 const confirmation=JSON.stringify([target.id,target.title,target.startDate,target.endDate,target.start,target.end,!!target.allDay,conflicts.map(e=>[e.id,e.title,e.date,e.start,e.end])]);
 return {confirmation,conflicts,message:`‘${target.title}’ 일정이 다음 시간과 겹칩니다.\n\n${conflicts.map(e=>`${e.date} ${time(e.start)}–${time(e.end)} · ${e.title}`).join('\n')}\n\n겹치는 상태로 등록할까요? 취소하면 입력 내용은 유지됩니다.`};
}
export function registrationOverlap(data:WorkspaceData,action:WorkspaceAction):OverlapReview|null{
 if(action.type==='task.schedule')return overlapReview({id:action.eventId,title:data.tasks.find(t=>t.id===action.taskId)?.title??'할 일',startDate:action.date,endDate:action.date,start:action.start,end:action.start+action.minutes},scheduleBusyEvents(data,action.date));
 if(action.type==='proposal.approve'){
  const proposal=data.proposals.find(p=>p.date===action.date),item=proposal?.items.find(i=>i.id===action.itemId);
  if(!item||item.state==='approved')return null;
  const task=data.tasks.find(t=>t.id===item.taskId)??item.draftTask;
  return overlapReview({id:'approved:'+item.id,title:task?.title??'집중 시간',startDate:action.date,endDate:action.date,start:item.start,end:item.end},scheduleBusyEvents(data,action.date));
 }
 if(action.type!=='event.upsert')return null;
 const e=action.event,old=data.events.find(x=>x.id===e.id);
 // Editing a memo/color on an already registered overlap does not rebook time.
 if(old&&old.date===e.date&&old.start===e.start&&old.end===e.end)return null;
 return overlapReview({id:e.id,title:e.title,startDate:e.date,endDate:e.date,start:e.start,end:e.end},[...data.events,...protectedEvents(data,e.date)]);
}
