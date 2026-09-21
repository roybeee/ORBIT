'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,CalendarDays,Check,Clock3,Pause} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {ItemColorPicker} from './item-color-picker';
import {categoryOf,categoryColor} from '@/lib/orbit/calendar-categories';
import {Checkbox} from '@/components/ui/checkbox';
import type {WorkspaceData} from '@/lib/orbit/model';
import {durationText,formatTime} from '@/lib/orbit/model';
import {addDays,planningFloor,todayInZone} from '@/lib/orbit/dates';
import {taskScheduleSlots,taskScheduleProblem} from '@/lib/orbit/task-scheduling';
import type {WorkspaceAction} from '@/lib/orbit/validation';

type Props={data:WorkspaceData;taskId:string;initialDate:string;now:Date;busy:boolean;pending:boolean;demo:boolean;onSave:(action:WorkspaceAction)=>Promise<boolean>;onRetry:()=>void;onClose:()=>void;onHold:()=>Promise<boolean>;onHeld:()=>void;onDetails:()=>void;onSaved:(date:string,eventId:string)=>void};
export function QuickTaskSchedule({data,taskId,initialDate,now,busy,pending,demo,onSave,onRetry,onClose,onHold,onHeld,onDetails,onSaved}:Props){
 const task=data.tasks.find(t=>t.id===taskId),today=todayInZone(data.preferences.timeZone,now);
 const [eventId]=useState(()=>crypto.randomUUID()),[date,setDate]=useState(initialDate<today?today:initialDate);
 const [minutes,setMinutes]=useState(String(task?.duration??45)),[resolveWaiting,setResolveWaiting]=useState(false),[error,setError]=useState('');
 const [color,setColor]=useState<string|null|undefined>(),[colorMessage,setColorMessage]=useState('');
 const [start,setStart]=useState(()=>{
  const date=initialDate<today?today:initialDate;
  const first=taskScheduleSlots(data,date,task?.duration??45,now)[0];
  return formatTime(first??Math.min(1425,Math.ceil(Math.max(data.preferences.workStart,planningFloor(date,data.preferences.timeZone,now))/15)*15));
 });
 const heading=useRef<HTMLHeadingElement>(null);
 const saving=useRef(false),[submitting,setSubmitting]=useState(false),confirmed=useRef(false);
 const holdRequested=useRef(false);
 const locked=busy||pending||submitting;
 const amount=Number(minutes),startMinute=/^\d{2}:\d{2}$/.test(start)?Number(start.slice(0,2))*60+Number(start.slice(3)):NaN;
 const input={taskId,date,start:startMinute,minutes:amount,resolveWaiting,...(color!==undefined?{color}:{})};
 const problem=taskScheduleProblem(data,input,now,true),slots=taskScheduleSlots(data,date,amount,now);
 const saved=data.events.find(e=>e.id===eventId);
 useEffect(()=>{if(!task)onClose()},[task,onClose]);
 useEffect(()=>{if(saved&&!pending&&!confirmed.current){confirmed.current=true;onSaved(saved.date,eventId)}},[saved,pending,onSaved]);
 useEffect(()=>{if(holdRequested.current&&task?.status==='waiting'&&!pending&&!confirmed.current){confirmed.current=true;onHeld()}},[task?.status,pending,onHeld]);
 if(!task)return null;
 const waiting=task.status==='waiting'||!!task.blocker?.trim();
 const selectedColor=color===undefined?task.color??null:color;
 const defaultColor=categoryColor(categoryOf(task),data.preferences,'task');
 async function saveColor(){
  if(!task||locked||saving.current||demo||color===undefined)return;
  saving.current=true;setSubmitting(true);setError('');setColorMessage('');
  try{if(await onSave({type:'task.upsert',task:{...task,color}})){setColor(undefined);setColorMessage('색상을 저장했습니다. Google 연결 시 자동으로 반영됩니다.')}else setError('색상을 저장하지 못했습니다. 선택한 색상은 유지됩니다.')}
  catch{setError('색상 저장 결과를 확인해 주세요. 선택한 색상은 유지됩니다.')}
  finally{saving.current=false;setSubmitting(false)}
 }
 function chooseDate(value:string){setDate(value);setError('');const first=taskScheduleSlots(data,value,amount,now)[0];if(first!==undefined)setStart(formatTime(first))}
 async function submit(e:React.FormEvent){
  e.preventDefault();if(locked||saving.current||demo)return;
  const currentProblem=taskScheduleProblem(data,input,new Date(),true);if(currentProblem){setError(currentProblem);return}
  saving.current=true;setSubmitting(true);setError('');
  try{const ok=await onSave({type:'task.schedule',eventId,...input});if(ok&&!confirmed.current){confirmed.current=true;onSaved(date,eventId)}else if(!ok)setError('등록하지 않았습니다. 입력한 시간은 유지됩니다. 저장 확인 중인 요청이 있으면 아래에서 확인해 주세요.')}
  catch{setError('저장을 확인하지 못했어요. 입력한 시간은 유지됩니다.')}
  finally{saving.current=false;setSubmitting(false)}
 }
 async function hold(){
  if(locked||saving.current||demo)return;
  saving.current=true;holdRequested.current=true;setSubmitting(true);setError('');
  try{const ok=await onHold();if(ok&&!confirmed.current){confirmed.current=true;onHeld()}else if(!ok)setError('보류 결과를 확인해 주세요. 저장 확인 중에는 다시 요청하지 않아도 됩니다.')}
  catch{setError('보류하지 못했어요. 다시 시도해 주세요.')}
  finally{saving.current=false;setSubmitting(false)}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!submitting)onClose()}}>
  <DialogContent className="orbit-create-dialog quick-task-schedule" onOpenAutoFocus={e=>{e.preventDefault();heading.current?.focus()}} onPointerDownOutside={e=>{if(locked)e.preventDefault()}}>
   <DialogHeader><DialogTitle ref={heading} tabIndex={-1}>시간 배정</DialogTitle><DialogDescription>{data.projects.find(p=>p.id===task.projectId)?.name??'할 일'} · 예상 {durationText(task.duration)}</DialogDescription></DialogHeader>
   <form className="quick-schedule-form" onSubmit={e=>void submit(e)}>
    <h3 className="quick-schedule-task">{task.title}</h3>
    <ItemColorPicker value={selectedColor} defaultColor={defaultColor} disabled={locked||demo} onChange={value=>{setColor(value);setColorMessage('');setError('')}}/>
    <div><button type="button" className="text-button" disabled={locked||demo||color===undefined} onClick={()=>void saveColor()}>색상 저장</button><p className="quick-schedule-note" role="status">{colorMessage||'시간을 배정하지 않고 색상만 저장할 수도 있어요.'}</p></div>
    <div className="quick-schedule-date-shortcuts"><button type="button" disabled={locked} aria-pressed={date===today} onClick={()=>chooseDate(today)}>오늘</button><button type="button" disabled={locked} aria-pressed={date===addDays(today,1)} onClick={()=>chooseDate(addDays(today,1))}>내일</button><label><span className="sr-only">배정 날짜</span><input type="date" value={date} min={today} required disabled={locked} onChange={e=>chooseDate(e.target.value)}/></label></div>
    <div className="quick-schedule-fields"><label>시작 시간<input type="time" value={start} step={300} required disabled={locked} onChange={e=>{setStart(e.target.value);setError('')}}/></label><label>소요 시간<div><input type="number" min={5} max={480} step={1} inputMode="numeric" value={minutes} required disabled={locked} onChange={e=>{setMinutes(e.target.value);setError('')}}/><span>분</span></div></label></div>
    {date&&(!data.preferences.workDays.includes(new Date(date+'T12:00:00Z').getUTCDay())||startMinute<data.preferences.workStart||startMinute+amount>data.preferences.workEnd)&&<p className="quick-schedule-note">설정한 업무 시간 밖에도 직접 배정할 수 있어요.</p>}
    <div className="quick-schedule-estimates">{[...new Set([30,task.duration,60,90])].sort((a,b)=>a-b).map(n=><button type="button" key={n} disabled={locked} aria-pressed={amount===n} onClick={()=>{setMinutes(String(n));setError('')}}>{n===task.duration?'예상 ':''}{n}분</button>)}</div>
    <div className="quick-schedule-slots"><p><Clock3 size={16}/>현재 일정 기준 빈 시간</p>{slots.length?<div>{slots.map(slot=><button type="button" disabled={locked} key={slot} aria-pressed={startMinute===slot} onClick={()=>{setStart(formatTime(slot));setError('')}}>{formatTime(slot)}–{formatTime(slot+amount)}</button>)}</div>:<p className="muted">추천할 빈 시간이 없어요. 직접 시간을 입력하면 겹치는 일정을 확인하고 승인할 수 있어요.</p>}</div>
    {waiting&&<label className="quick-schedule-waiting"><Checkbox checked={resolveWaiting} disabled={locked} onCheckedChange={value=>{setResolveWaiting(value===true);setError('')}}/><span><strong>대기 조건이 해결됐어요</strong><small>{task.blocker||'대기 상태를 해제하고 이 시간에 진행합니다.'}</small></span></label>}
    {Number.isFinite(startMinute)&&amount>=5&&startMinute+amount<=1440&&<div className="quick-schedule-preview" style={{borderLeft:`4px solid ${selectedColor??defaultColor}`}}><CalendarDays size={20}/><div><span>{date===today?'오늘':date===addDays(today,1)?'내일':date.slice(5).replace('-','/')}</span><strong>{start}<ArrowRight size={17}/>{formatTime(startMinute+amount)}<small>{durationText(amount)}</small></strong></div></div>}
    {(error||problem)&&!pending&&<p className="quick-schedule-error" role="alert">{error||problem}</p>}
    {pending&&<div className="quick-schedule-pending" role="status"><p>저장 결과를 확인하고 있어요. 같은 일정이 중복되지 않도록 기존 요청을 확인합니다.</p><button type="button" className="secondary-button" disabled={busy||submitting} onClick={onRetry}>저장 결과 확인</button></div>}
    <p className="quick-schedule-note">마감일 {task.due.slice(5).replace('-','/')}은 유지됩니다. Google 연결 시 자동으로 동기화됩니다.</p>
    {task.status!=='waiting'&&<button type="button" className="secondary-button quick-schedule-hold" disabled={locked||demo} onClick={()=>void hold()}><Pause size={17}/><span>보류<small>할 일 대기함으로 이동</small></span></button>}
    <div className="quick-schedule-actions"><button type="button" className="text-button" disabled={locked} onClick={onDetails}>할 일 내용 보기</button><button type="submit" className="primary-button" disabled={locked||!!problem||demo}><Check size={18}/>{locked?'저장 확인 중…':'이 시간에 배정'}</button></div>
   </form>
  </DialogContent>
 </Dialog>;
}
