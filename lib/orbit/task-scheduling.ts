import type {Task,WorkspaceData,CalendarEvent} from './model';
import {workEligibility} from './work-policy.ts';
import {planningFloor,todayInZone,validDate} from './dates.ts';
import {planningEvents,protectedEvents} from './allocation-policy.ts';
import {careEvents} from './chief.ts';

export type TaskTime={taskId:string;date:string;start:number;minutes:number;resolveWaiting?:boolean};
export function taskAfterWaiting(task:Task,resolve=false):Task{
 return resolve?{...task,status:task.status==='waiting'?'todo':task.status,blocker:undefined,checkDate:undefined}:task;
}
export function scheduleBusyEvents(data:WorkspaceData,date:string):CalendarEvent[]{
 return planningEvents([...data.events,...careEvents(data,date),...protectedEvents(data,date)].filter(e=>e.date===date),date,data.preferences);
}
export function taskScheduleProblem(data:WorkspaceData,input:TaskTime,now=new Date(),reviewOverlap=false):string|null{
 const {date,start,minutes,taskId}=input;
 if(!validDate(date))return '배정할 날짜를 선택해 주세요.';
 if(!Number.isInteger(start)||start<0||start>=1440)return '시작 시간을 선택해 주세요.';
 if(!Number.isInteger(minutes)||minutes<5||minutes>480)return '소요 시간은 5분부터 480분까지 입력해 주세요.';
 if(start+minutes>1440)return '자정을 넘지 않도록 시작 시간이나 소요 시간을 조정해 주세요.';
 if(date<todayInZone(data.preferences.timeZone,now)||start<planningFloor(date,data.preferences.timeZone,now))return '현재 시각 이후의 시간을 선택해 주세요.';
 const task=data.tasks.find(t=>t.id===taskId);if(!task)return '할 일을 찾을 수 없습니다.';
 const eligible=workEligibility(data,taskAfterWaiting(task,input.resolveWaiting),date);
 if(!eligible.allowed)return eligible.reason;
 if(data.events.some(e=>e.date===date&&(e.taskId===taskId||e.google?.orbitEventId==='task-due:'+taskId&&!e.allDay)))return '이미 이날 배정된 시간이 있어요. 일정에서 확인하거나 다른 날짜를 선택해 주세요.';
 if(reviewOverlap)return null;
 const conflict=scheduleBusyEvents(data,date).find(e=>e.start<start+minutes&&e.end>start);
 return conflict?`‘${conflict.title}’ 시간과 겹쳐요. 다른 시간을 골라 주세요.`:null;
}
export function taskScheduleSlots(data:WorkspaceData,date:string,minutes:number,now=new Date()):number[]{
 if(!validDate(date)||!Number.isInteger(minutes)||minutes<5||minutes>480)return [];
 const busy=scheduleBusyEvents(data,date),slots:number[]=[];
 const floor=Math.max(data.preferences.workStart,planningFloor(date,data.preferences.timeZone,now));
 for(let start=Math.ceil(floor/15)*15;start+minutes<=data.preferences.workEnd&&slots.length<3;start+=15){
  if(busy.some(e=>e.start<start+minutes&&e.end>start))continue;
  slots.push(start);start+=Math.ceil(Math.max(30,minutes)/15)*15-15;
 }
 return slots;
}
