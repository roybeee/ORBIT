'use client';
import {useMemo,type CSSProperties} from 'react';
import type {CalendarEvent,Preferences,Task} from '@/lib/orbit/model';
import {calendarItemColor} from '@/lib/orbit/calendar-categories';
import {monthGrid,monthItems,mondayIndex,weekdayLabels} from '@/lib/orbit/calendar-month';
import {CalendarDateStrip} from './calendar-date-strip';

// Four lines fit a phone cell; beyond that the last line becomes "+N".
const CELL_LINES=4;

type Props={date:string;today:string;tasks:Task[];events:CalendarEvent[];preferences:Preferences;onSelect:(date:string)=>void;onStep:(months:number)=>void};

export function CalendarMonth({date,today,tasks,events,preferences,onSelect,onStep}:Props){
 const month=date.slice(0,7);
 const dates=useMemo(()=>monthGrid(month+'-01'),[month]);
 const items=useMemo(()=>monthItems(tasks,events,dates,today),[tasks,events,dates,today]);
 const taskById=useMemo(()=>new Map(tasks.map(t=>[t.id,t])),[tasks]);
 return <CalendarDateStrip label="좌우로 밀어 달 이동" onStep={onStep}><div className="calendar-month">
  <div className="calendar-month-weekdays" aria-hidden="true">{weekdayLabels.map((label,i)=><span key={label} className={i===5?'is-sat':i===6?'is-sun':''}>{label}</span>)}</div>
  <div className="calendar-month-grid">
   {dates.map(day=>{
    const list=items.get(day)??[],index=mondayIndex(day),outside=day.slice(0,7)!==month;
    const shown=list.length>CELL_LINES?list.slice(0,CELL_LINES-1):list,more=list.length-shown.length;
    const titles=list.slice(0,3).map(e=>(e.taskId&&taskById.get(e.taskId)?.title)||e.title);
    const label=`${Number(day.slice(5,7))}월 ${Number(day.slice(8))}일 ${weekdayLabels[index]}요일${day===today?', 오늘':''}, ${list.length?`${list.length}개: ${titles.join(', ')}${list.length>3?' 외':''}`:'일정 없음'}`;
    return <button key={day} type="button" className={['calendar-month-cell',outside&&'is-outside',day===today&&'is-today',day===date&&'is-selected',index===5&&'is-sat',index===6&&'is-sun'].filter(Boolean).join(' ')} aria-label={label} aria-current={day===today?'date':undefined} onClick={()=>onSelect(day)}>
     <span className="calendar-month-date">{Number(day.slice(8))}</span>
     <span className="calendar-month-items" aria-hidden="true">
      {shown.map(event=>{
       const task=event.taskId?taskById.get(event.taskId):undefined;
       const kind=task?.status==='done'?'is-done':event.id.startsWith('task-due:')?'is-task':event.id.startsWith('protected:')?'is-protected':'';
       return <span key={event.id} className={`calendar-month-chip ${kind}`} style={{'--event-color':calendarItemColor(event,preferences,event.taskId?'task':'event',task)} as CSSProperties}>{event.id.startsWith('task-due:')?event.title:task?.title??event.title}</span>;
      })}
      {more>0&&<span className="calendar-month-more">+{more}</span>}
     </span>
    </button>;
   })}
  </div>
 </div></CalendarDateStrip>;
}
