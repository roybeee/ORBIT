'use client';
import {useRef,useState} from 'react';
import {CalendarClock,LoaderCircle} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {clientRequest} from '@/lib/orbit/agent/client-request';
import type {CalendarEdit} from '@/lib/orbit/agent/calendar-edit';
import {postponedCalendarEdit,postponedEvent} from '@/lib/orbit/calendar-move';
import {addDays,minuteInZone,todayInZone} from '@/lib/orbit/dates';
import {clearDraft,readDraft,saveDraft} from '@/lib/orbit/device-drafts';
import type {CalendarEvent} from '@/lib/orbit/model';

const time=(minute:number)=>String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
const minute=(value:string)=>{const [hour,part]=value.split(':').map(Number);return hour*60+part};
type EditView=Omit<CalendarEdit,'operationId'>&{recurring?:boolean;sourceCalendarId?:string};

export function EventPostpone({event,timeZone,ownerId,storageKey,disabled,onSaved}:{event:CalendarEvent;timeZone:string;ownerId:string;storageKey:string;disabled:boolean;onSaved:(event:CalendarEvent,external:boolean)=>Promise<boolean|void>}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[edit,setEdit]=useState<EditView|null>(null),[pending,setPending]=useState<CalendarEdit|null>(null),[date,setDate]=useState(event.date),[start,setStart]=useState(event.start);
 const lock=useRef(false),external=event.id.startsWith('google:');
 const now=()=>({date:todayInZone(timeZone),minute:minuteInZone(timeZone)});
 const show=async()=>{if(lock.current||disabled)return;setOpen(true);setError('');setDate(event.date);setStart(event.start);if(!external){setEdit(null);return}lock.current=true;setBusy(true);try{const receipt=readDraft<CalendarEdit>(ownerId,'calendar-postpone-pending',storageKey);if(receipt){setPending(receipt);setEdit(receipt);setDate(receipt.startDate);setStart(receipt.start);return}const current=await clientRequest('/api/integrations/calendar/event?id='+encodeURIComponent(event.id)) as EditView;setEdit(current);setPending(null);setDate(current.startDate);setStart(current.start)}catch(e){setError(e instanceof Error?e.message:'일정을 불러오지 못했습니다.')}finally{lock.current=false;setBusy(false)}};
 const save=async(nextDate=date,nextStart=start)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
  if(external){
   if(!edit)throw new Error('현재 일정을 불러온 뒤 다시 시도해 주세요.');
   let input=pending??postponedCalendarEdit({...edit,operationId:crypto.randomUUID()},nextDate,nextStart,now());saveDraft(ownerId,'calendar-postpone-pending',storageKey,input);setPending(input);
   let result;
   try{result=await clientRequest('/api/integrations/calendar/event','PATCH',input) as {event:CalendarEvent}}catch(failure){
    const overlap=failure as {code?:string;message?:string;registrationConfirmation?:string};
    if(overlap.code!=='OVERLAP'||!overlap.registrationConfirmation)throw failure;
    clearDraft(ownerId,'calendar-postpone-pending',storageKey);setPending(null);
    if(!window.confirm(overlap.message??'겹치는 상태로 일정을 미룰까요?'))return;
    input={...input,operationId:crypto.randomUUID(),overlapConfirmation:overlap.registrationConfirmation};saveDraft(ownerId,'calendar-postpone-pending',storageKey,input);setPending(input);
    result=await clientRequest('/api/integrations/calendar/event','PATCH',input) as {event:CalendarEvent};
   }
   await onSaved(result.event,true);clearDraft(ownerId,'calendar-postpone-pending',storageKey);setPending(null);setOpen(false);
  }else{
   const target=postponedEvent(event,nextDate,event.allDay?0:nextStart,now());
   if(await onSaved(target,false)===false)throw new Error('일정을 미루지 못했습니다. 기존 시간은 그대로 유지됩니다.');
   setOpen(false);
  }
 }catch(e){const failure=e as {code?:string};if(failure.code&&['INPUT','CONFLICT','NOT_FOUND','CALENDAR_READ_ONLY','MANAGED_EVENT','OVERLAP'].includes(failure.code)){clearDraft(ownerId,'calendar-postpone-pending',storageKey);setPending(null)}setError(e instanceof Error?e.message:'일정을 미루지 못했습니다. 기존 시간은 그대로 유지됩니다.')}finally{lock.current=false;setBusy(false)}};
 const quick=(days:number)=>{const source=external&&edit?edit.startDate:event.date;void save(addDays(source,days),external&&edit?edit.start:event.start)};
 const allDay=external?edit?.allDay:event.allDay||event.start===0&&event.end===1440;
 return <>
  <button className="secondary-button event-postpone-entry" disabled={disabled} onClick={()=>void show()}><CalendarClock size={16}/>일정 미루기</button>
  <Dialog open={open} onOpenChange={value=>{if(!value&&!busy)setOpen(false)}}><DialogContent className="event-postpone-dialog">
   <DialogHeader><DialogTitle>일정 미루기</DialogTitle><DialogDescription>기존 일정 길이와 나머지 정보는 그대로 유지합니다.</DialogDescription></DialogHeader>
   {busy&&external&&!edit&&<p role="status"><LoaderCircle size={16} className="animate-spin"/>현재 일정을 불러오고 있습니다.</p>}
   {(!external||edit)&&<>
    <div className="event-postpone-quick"><button className="secondary-button" disabled={disabled||busy||!!pending} onClick={()=>quick(1)}>하루 뒤</button><button className="secondary-button" disabled={disabled||busy||!!pending} onClick={()=>quick(7)}>일주일 뒤</button></div>
    <div className="event-postpone-fields"><div><label className="form-label" htmlFor="postpone-date">새 시작 날짜</label><input id="postpone-date" className="form-field" type="date" disabled={busy||!!pending} value={date} onChange={e=>setDate(e.target.value)}/></div>{!allDay&&<div><label className="form-label" htmlFor="postpone-time">새 시작 시간</label><input id="postpone-time" className="form-field" type="time" disabled={busy||!!pending} value={time(start)} onChange={e=>setStart(minute(e.target.value))}/></div>}</div>
    {external&&edit?.recurring&&<p className="form-hint">반복 일정 중 선택한 회차만 변경합니다.</p>}
   </>}
   {error&&<p className="agent-error" role="alert">{error}</p>}
   {pending&&<p className="form-hint" role="status">이전 저장 요청의 결과를 같은 내용으로 확인합니다.</p>}
   <div className="sheet-actions">{(!external||edit)&&<button className="primary-button" disabled={disabled||busy} onClick={()=>void save()}>{busy?'저장 중…':pending?'저장 결과 확인':'이 시간으로 미루기'}</button>}<button className="secondary-button" disabled={busy} onClick={()=>setOpen(false)}>닫기</button></div>
  </DialogContent></Dialog>
 </>;
}
