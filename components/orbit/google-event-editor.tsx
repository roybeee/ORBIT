'use client';
import {eventScopes,eventScopeLabels,type EventScope} from '@/lib/orbit/event-details';
import {useEffect,useRef,useState} from 'react';
import {Pencil,LoaderCircle} from 'lucide-react';
import {clientRequest} from '@/lib/orbit/agent/client-request';
import {readDraft,saveDraft,clearDraft} from '@/lib/orbit/device-drafts';
import type {CalendarEdit} from '@/lib/orbit/agent/calendar-edit';
import type {CalendarEvent} from '@/lib/orbit/model';
type Form=Omit<CalendarEdit,'operationId'>&{recurring?:boolean};
const time=(n:number)=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const minute=(value:string)=>{const [h,m]=value.split(':').map(Number);return h*60+m};
export function GoogleEventEditor({eventId,storageKey,ownerId,disabled,onEditing,onSaved}:{eventId:string;storageKey:string;ownerId:string;disabled:boolean;onEditing:(value:boolean)=>void;onSaved:(event:CalendarEvent)=>Promise<void>}){
 const [open,setOpen]=useState(false),[form,setForm]=useState<Form|null>(null),[pending,setPending]=useState<CalendarEdit|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 useEffect(()=>{onEditing(open);return()=>onEditing(false)},[open,onEditing]);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- reports a device storage failure raised while persisting the draft to the external store
 useEffect(()=>{if(form&&open)try{saveDraft(ownerId,'calendar-edit-draft',storageKey,form)}catch{setError('임시 저장을 사용할 수 없습니다. 수정 창을 닫기 전에 저장해 주세요.')}},[form,open,ownerId,storageKey]);
 const load=async(fresh=false)=>{if(lock.current)return;lock.current=true;setBusy(true);setOpen(true);setError('');try{
  const receipt=fresh?null:readDraft<CalendarEdit>(ownerId,'calendar-edit-pending',storageKey),draft=fresh?null:readDraft<Form>(ownerId,'calendar-edit-draft',storageKey);
  if(receipt){setPending(receipt);setForm(draft??receipt);return}
  const current=await clientRequest('/api/integrations/calendar/event?id='+encodeURIComponent(eventId));
  if(alive.current){setForm(draft?{...current,...draft}:current);setPending(null)}
 }catch(e){if(alive.current)setError(e instanceof Error?e.message:'일정을 불러오지 못했습니다.')}finally{lock.current=false;if(alive.current)setBusy(false)}};
 const change=(patch:Partial<Form>)=>setForm(old=>old?{...old,...patch}:old);
 const save=async()=>{if(!form||lock.current)return;lock.current=true;setBusy(true);setError('');try{
  const {id,calendarId,eventId:googleId,etag,timeZone,title,startDate,endDate,start,end,allDay,description,scope}=form;
  let input:CalendarEdit=pending??{operationId:crypto.randomUUID(),id,calendarId,eventId:googleId,etag,timeZone,title:title.trim(),startDate,endDate,start,end,allDay,description,scope};
  if(!input.title||input.endDate<input.startDate||!input.allDay&&input.startDate===input.endDate&&input.end<=input.start){setError('제목을 입력하고 종료 시간을 시작 시간 이후로 선택해 주세요.');return}
  saveDraft(ownerId,'calendar-edit-pending',storageKey,input);setPending(input);
  let result;
  try{result=await clientRequest('/api/integrations/calendar/event','PATCH',input)}catch(error){
   const failure=error as {code?:string;message?:string;registrationConfirmation?:string};
   if(failure.code!=='OVERLAP'||!failure.registrationConfirmation)throw error;
   clearDraft(ownerId,'calendar-edit-pending',storageKey);setPending(null);
   if(!window.confirm(failure.message??'겹치는 상태로 등록할까요?'))return;
   input={...input,operationId:crypto.randomUUID(),overlapConfirmation:failure.registrationConfirmation};
   saveDraft(ownerId,'calendar-edit-pending',storageKey,input);setPending(input);
   result=await clientRequest('/api/integrations/calendar/event','PATCH',input);
  }
  clearDraft(ownerId,'calendar-edit-pending',storageKey);clearDraft(ownerId,'calendar-edit-draft',storageKey);setPending(null);setOpen(false);setForm(null);
  await onSaved(result.event);
 }catch(e){if(alive.current){if(e&&typeof e==='object'&&'code' in e&&['INPUT','CONFLICT','NOT_FOUND','CALENDAR_READ_ONLY','MANAGED_EVENT','OVERLAP'].includes(String(e.code))){clearDraft(ownerId,'calendar-edit-pending',storageKey);setPending(null)}setError(e instanceof Error?e.message:'저장 결과를 확인하지 못했습니다. 다시 확인해 주세요.')}}finally{lock.current=false;if(alive.current)setBusy(false)}};
 if(!open)return <button className="primary-button event-edit-entry" disabled={disabled} onClick={()=>void load()}><Pencil size={16}/>일정 수정</button>;
 return <section className="google-event-editor" aria-label="일정 수정">
  <h3>일정 수정</h3>
  {busy&&!form&&<p role="status"><LoaderCircle size={16} className="animate-spin"/>현재 일정을 불러오고 있습니다.</p>}
  {form&&<fieldset disabled={busy||!!pending}>
   <label className="form-label" htmlFor="google-event-title">제목</label><input id="google-event-title" className="form-field" maxLength={160} value={form.title} onChange={e=>change({title:e.target.value})}/>
   <label className="form-label" htmlFor="google-event-scope">일정 구분</label><select id="google-event-scope" className="form-field" value={form.scope??'personal'} onChange={e=>change({scope:e.target.value as EventScope})}>{eventScopes.map(scope=><option key={scope} value={scope}>{eventScopeLabels[scope]}</option>)}</select>
   <label className="form-label" htmlFor="google-event-memo">메모</label><textarea id="google-event-memo" className="form-field" rows={5} maxLength={20000} value={form.description??''} onChange={e=>change({description:e.target.value})} placeholder="통화 내용, 준비 사항 등을 적어 주세요."/>
   <p className="form-hint">메모는 Google Calendar의 설명에도 저장됩니다.</p>
   <label className="google-event-all-day"><input type="checkbox" checked={form.allDay} onChange={e=>change({allDay:e.target.checked,...(!e.target.checked&&form.start===form.end?{start:600,end:630}:{})})}/>종일</label>
   <div className="field-grid"><div><label className="form-label" htmlFor="google-event-start-date">시작 날짜</label><input id="google-event-start-date" className="form-field" type="date" value={form.startDate} onChange={e=>change({startDate:e.target.value,...(form.endDate===form.startDate||form.endDate<e.target.value?{endDate:e.target.value}:{})})}/></div><div><label className="form-label" htmlFor="google-event-end-date">종료 날짜</label><input id="google-event-end-date" className="form-field" type="date" min={form.startDate} value={form.endDate} onChange={e=>change({endDate:e.target.value})}/></div></div>
   {!form.allDay&&<div className="field-grid"><div><label className="form-label" htmlFor="google-event-start-time">시작 시간</label><input id="google-event-start-time" className="form-field" type="time" value={time(form.start)} onChange={e=>change({start:minute(e.target.value)})}/></div><div><label className="form-label" htmlFor="google-event-end-time">종료 시간</label><input id="google-event-end-time" className="form-field" type="time" value={time(form.end)} onChange={e=>change({end:minute(e.target.value)})}/></div></div>}
   <p className="form-hint">{form.recurring?'반복 일정 중 선택한 회차만 변경합니다.':'저장하면 Google Calendar에도 반영됩니다.'} {!form.allDay&&`시간대 · ${form.timeZone}`}</p>
  </fieldset>}
  {error&&<p className="agent-error" role="alert">{error}</p>}
  {pending&&<p className="form-hint" role="status">저장 요청의 결과를 확인하고 있습니다. 같은 요청으로 다시 확인할 수 있습니다.</p>}
  <div className="sheet-actions">{form&&<button className="primary-button" disabled={busy||disabled} onClick={()=>void save()}>{busy?'저장 중…':pending?'저장 결과 확인':'변경 저장'}</button>}<button className="secondary-button" disabled={busy} onClick={()=>setOpen(false)}>닫기</button></div>
  {!pending&&<button className="text-button" disabled={busy} onClick={()=>void load(true)}>최신 일정 다시 불러오기</button>}
 </section>;
}
