'use client';
import {useState,type CSSProperties,type MouseEvent} from 'react';
import {CalendarPlus,ChevronDown,LockKeyhole} from 'lucide-react';
import {Checkbox} from '@/components/ui/checkbox';
import type {CalendarEvent,Preferences,Project,Task} from '@/lib/orbit/model';
import {formatTime} from '@/lib/orbit/model';
import {calendarItemColor} from '@/lib/orbit/calendar-categories';
import {moveConflict,moveRestriction} from '@/lib/orbit/calendar-move';
import {HOUR_PX,blockHeight,dayColumns,dayHours,hourLabel} from '@/lib/orbit/calendar-month';

import {useDayGridMove} from './use-day-grid-move';

// Room above the first hour line so its label is not clipped.
const TOP_PAD=10;
// Beyond this many all-day rows the rest folds behind "N개 더 보기".
const ALL_DAY_ROWS=4;

type Props={
 onStep?:(days:number)=>void;
 date:string;today:string;nowMinute:number|null;events:CalendarEvent[];tasks:Task[];projects:Project[];preferences:Preferences;disabled:boolean;
 onMove:(before:CalendarEvent,after:CalendarEvent)=>Promise<boolean>;onInteractionChange:(active:boolean)=>void;
 onOpen:(event:CalendarEvent)=>void;onScheduleTask:(id:string)=>void;onToggleTask:(id:string)=>void;onCreateAt?:(minute:number)=>void;
};

export function CalendarDayGrid(props:Props){
 const {root,preview,suppressClick}=useDayGridMove(props);
 const conflict=preview&&moveConflict(preview.event,props.events);
 const [expanded,setExpanded]=useState(false);
 const taskById=new Map(props.tasks.map(t=>[t.id,t]));
 const allDay=props.events.filter(e=>e.allDay),timed=props.events.filter(e=>!e.allDay);
 const {from,to}=dayHours(timed),hours=Array.from({length:to-from},(_,i)=>from+i);
 const y=(minute:number)=>(minute-from*60)*HOUR_PX/60;
 const color=(event:CalendarEvent)=>calendarItemColor(event,props.preferences,event.taskId?'task':'event',taskById.get(event.taskId??''));
 const shownAllDay=expanded||allDay.length<=ALL_DAY_ROWS+1?allDay:allDay.slice(0,ALL_DAY_ROWS);
 const now=props.date===props.today&&props.nowMinute!==null&&props.nowMinute>=from*60?props.nowMinute:null;
 const slot=(hour:number,e:MouseEvent<HTMLButtonElement>)=>props.onCreateAt?.(hour*60+(e.nativeEvent.offsetY>=HOUR_PX/2?30:0));
 return <div ref={root} className="day-grid" onClickCapture={e=>{if(suppressClick()){e.preventDefault();e.stopPropagation();}}}>
  <p className="day-grid-move-hint" role="status">{preview?`${formatTime(preview.event.start)}–${formatTime(preview.event.end)} · ${preview.saving?'저장 중':conflict?'다른 일정과 겹칩니다':'놓으면 시간 변경 · Esc로 취소'}`:'좌우로 밀어 날짜 이동 · 일정을 길게 눌러 시간 변경'}</p>
  {allDay.length>0&&<section className="day-grid-allday" aria-label="종일 일정과 시간 미정 할 일">
   <h3>종일 · 시간 미정 <span>{allDay.length}개</span></h3>
   {shownAllDay.map(event=>{
    const task=event.taskId?taskById.get(event.taskId):undefined,untimed=event.id.startsWith('task-due:'),done=task?.status==='done';
    const canSchedule=untimed&&!!task&&!done;
    const project=props.projects.find(p=>p.id===event.projectId);
    return <div key={event.id} className={`day-grid-allday-row ${untimed?'is-task':''} ${done?'is-done':''}`} style={{'--event-color':color(event)} as CSSProperties}>
     {task&&untimed&&<label className="day-grid-check"><Checkbox checked={done} disabled={props.disabled} aria-label={`${task.title} ${done?'완료 취소':'완료'}`} onCheckedChange={()=>props.onToggleTask(task.id)}/></label>}
     <button type="button" disabled={props.disabled&&canSchedule} onClick={()=>{if(canSchedule&&task)props.onScheduleTask(task.id);else props.onOpen(event)}}>
      <strong>{task?.title??event.title}</strong>
      <span>{untimed?(done?'완료한 할 일':'할 일 · 시간 미정'):'종일 일정'}{project&&<> · {project.name}</>}</span>
      {canSchedule&&<em><CalendarPlus size={15}/>시간 배정</em>}
     </button>
    </div>;
   })}
   {allDay.length>shownAllDay.length&&<button type="button" className="text-button day-grid-more" onClick={()=>setExpanded(true)}>{allDay.length-shownAllDay.length}개 더 보기<ChevronDown size={16}/></button>}
  </section>}
  <div className="day-grid-body" style={{height:(to-from)*HOUR_PX+TOP_PAD*2}}>
   <div className="day-grid-labels" aria-hidden="true">{hours.map(h=><span key={h} style={{top:TOP_PAD+y(h*60)}}>{hourLabel(h)}</span>)}</div>
   <div className="day-grid-lane" style={{top:TOP_PAD,height:(to-from)*HOUR_PX,'--hour-px':HOUR_PX+'px'} as CSSProperties}>
    {props.onCreateAt&&hours.map(h=><button key={h} type="button" tabIndex={-1} className="day-grid-slot" style={{top:y(h*60),height:HOUR_PX}} disabled={props.disabled} aria-label={`${hourLabel(h)}에 일정 추가`} onClick={e=>slot(h,e)}/>)}
    {dayColumns(timed).map(({event,column,columns})=>{
     const task=event.taskId?taskById.get(event.taskId):undefined,done=task?.status==='done',height=blockHeight(event)*HOUR_PX/60-2;
     const title=task?.title??event.title,restriction=moveRestriction(event);
     const moving=preview?.event.id===event.id,shown=moving?preview.event:event;
     return <button key={event.id} data-grid-move={event.id} id={'day-block-'+event.id} type="button" className={`day-grid-event ${moving?'is-moving':''} ${moving&&conflict?'is-conflicting':''} ${done?'is-done':''} ${event.id.startsWith('protected:')?'is-protected':''} ${height<40?'is-short':''}`}
      style={{top:y(shown.start)+1,height,left:`calc(${column} * 100% / ${columns})`,width:`calc(100% / ${columns} - 3px)`,'--event-color':color(event)} as CSSProperties}
      aria-label={`${task?'할 일 ':''}${title}, ${formatTime(event.start)}부터 ${formatTime(event.end)}까지${done?', 완료':''}${restriction?', '+restriction:''}`}
      onClick={e=>{if(suppressClick()){e.preventDefault();return;}props.onOpen(event)}}>
      <strong>{title}</strong>
      <span>{formatTime(shown.start)}–{formatTime(shown.end)}{event.id.startsWith('protected:')&&<LockKeyhole size={11}/>}</span>
     </button>;
    })}
    {now!==null&&<div className="day-grid-now" style={{top:y(now)}} aria-hidden="true"/>}
   </div>
  </div>
 </div>;
}
