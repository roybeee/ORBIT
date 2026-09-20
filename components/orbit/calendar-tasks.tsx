'use client';
import type {CSSProperties} from 'react';
import {CheckCheck,ChevronRight,RotateCcw} from 'lucide-react';
import {Checkbox} from '@/components/ui/checkbox';
import type {Task,Project,Preferences} from '@/lib/orbit/model';
import {statusLabel} from '@/lib/orbit/model';
import {categoryOf,categoryColor,categoryLabels} from '@/lib/orbit/calendar-categories';

export function CalendarTasks({tasks,projects,preferences,date,today,disabled,onOpen,onToggle,inbox=false,onResume}:{tasks:Task[];projects:Project[];preferences:Preferences;date:string;today:string;disabled:boolean;onOpen:(id:string)=>void;onToggle:(id:string)=>void;inbox?:boolean;onResume?:(id:string)=>void}){
 const pending=tasks.filter(t=>t.status!=='done').sort((a,b)=>a.due.localeCompare(b.due)||b.impact-a.impact);
 const completed=tasks.filter(t=>t.status==='done');
 const carried=pending.filter(t=>t.due<date);
 const row=(task:Task)=>{
  const done=task.status==='done',category=categoryOf(task),project=projects.find(p=>p.id===task.projectId);
  return <article key={task.id} className={`calendar-task-card ${done?'is-done':''}`} style={{'--task-category-color':categoryColor(category,preferences)} as CSSProperties}>
   <label className="calendar-task-check"><Checkbox checked={done} disabled={disabled} aria-label={`${task.title} ${done?'완료 취소':'완료'}`} onCheckedChange={()=>onToggle(task.id)}/></label>
   <button className="calendar-task-open" disabled={disabled} onClick={()=>onOpen(task.id)}><strong>{task.title}</strong><span>{project?.name??'개인 할 일'} · {categoryLabels[category]} · {task.duration}분</span>
    {inbox?<span>대기 · 마감 {task.due.slice(5).replace('-','/')}{task.blocker?` · ${task.blocker}`:''}</span>:!done&&task.due<date?<span className="calendar-task-carried"><RotateCcw size={14}/>이월 · 원래 마감 {task.due.slice(5).replace('-','/')} · {statusLabel[task.status]}</span>:<span>{done?'완료':statusLabel[task.status]}</span>}
   </button>{inbox&&onResume?<button type="button" className="secondary-button calendar-task-resume" disabled={disabled} onClick={()=>onResume(task.id)}>할 일로 복귀</button>:<ChevronRight size={17} aria-hidden="true"/>}
  </article>;
 };
 return <div className="calendar-task-list">
  <div className="section-title"><h2>{inbox?'할 일 대기함':`${Number(date.slice(-2))}일 할 일`}</h2><span className="muted">{inbox?'대기':'미완료'} {pending.length}개</span></div>
  <p className="calendar-task-guidance">{inbox?'보류한 할 일은 여기에 보관됩니다. 다시 진행할 때 복귀하거나 눌러서 시간을 배정하세요.':<>{date===today&&carried.length?`이전 날짜의 미완료 ${carried.length}개가 이월됐어요. `:''}완료하지 않은 할 일은 다음 날로 자동 이월됩니다.</>}</p>
  {pending.map(row)}
  {!pending.length&&<div className="calendar-empty"><CheckCheck size={28}/><strong>{inbox?'대기 중인 할 일이 없어요':completed.length?'이날 할 일을 모두 완료했어요':'이날 남은 할 일이 없어요'}</strong></div>}
  {!!completed.length&&<section className="calendar-tasks-done"><h3>완료한 할 일 {completed.length}개</h3>{completed.map(row)}</section>}
 </div>;
}
