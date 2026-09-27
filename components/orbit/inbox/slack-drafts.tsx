'use client';
import {Check,LoaderCircle,MessageSquareText} from 'lucide-react';
import {useState} from 'react';
import {toast} from 'sonner';
import type {AgentAction} from '@/lib/orbit/agent/types';
import type {WorkspaceSnapshot} from '@/lib/orbit/model';
import {formatTime} from '@/lib/orbit/model';
import {scopedRequest} from '@/lib/orbit/agent/client-request';
import {sendDecision} from '@/lib/orbit/agent/decision-client';
import {AgentRequestError} from '@/lib/orbit/agent/approval-feedback';
import {todayInZone} from '@/lib/orbit/dates';
import {eventStarted} from '@/lib/orbit/slack/request-view';
import {ActionCard,type ActionReview} from '../agent/action-review';
import {agentRequest} from '../agent/connections';
import {agentRefresh} from '../agent/refresh';

type Slot={date:string;start:number;end:number};
const eventOf=(item:AgentAction)=>item.action.type==='event.upsert'?item.action.event:undefined;
const toMinutes=(value:string)=>{const [h,m]=value.split(':').map(Number);return h*60+m};
const clock=(minute:number)=>formatTime(Math.min(minute,1439));

// A new time for one event draft; approving with it registers the event at that time instead.
function TimeEditor({item,timeZone,expired,onApprove,busy}:{item:AgentAction;timeZone:string;expired:boolean;onApprove:(slot:Slot)=>void;busy:boolean}){
 const event=eventOf(item)!;
 const [open,setOpen]=useState(expired);
 const [date,setDate]=useState(expired?todayInZone(timeZone):event.date),[start,setStart]=useState(clock(event.start)),[end,setEnd]=useState(clock(event.end));
 const valid=!!date&&toMinutes(end)>toMinutes(start);
 if(!open)return <button className="text-button" disabled={busy} onClick={()=>setOpen(true)}>시간 수정 후 등록</button>;
 return <form className="slack-draft-time" onSubmit={e=>{e.preventDefault();if(valid)onApprove({date,start:toMinutes(start),end:toMinutes(end)})}}>
  {expired&&<p className="inbox-card-late" role="note">예정 시간({event.date} {clock(event.start)})이 지나 그대로 등록하지 않습니다. 새 시간을 정해 주세요.</p>}
  <label>날짜<input className="form-field" type="date" required min={todayInZone(timeZone)} value={date} onChange={e=>setDate(e.target.value)}/></label>
  <label>시작<input className="form-field" type="time" required step={300} value={start} onChange={e=>setStart(e.target.value)}/></label>
  <label>종료<input className="form-field" type="time" required step={300} value={end} onChange={e=>setEnd(e.target.value)}/></label>
  <button className="primary-button" disabled={busy||!valid}><Check size={15}/>이 시간으로 등록</button>
  {!expired&&<button type="button" className="text-button" onClick={()=>setOpen(false)}>취소</button>}
 </form>;
}

// Drafts recovered from one saved Slack request: reviewed and registered together, one card each.
export function SlackDrafts({id,title,items,snapshot,review,onOpenConversation}:{id:string;title:string;items:readonly AgentAction[];snapshot:WorkspaceSnapshot;review:ActionReview;onOpenConversation:()=>void}){
 const timeZone=snapshot.data.preferences.timeZone;
 const [running,setRunning]=useState(false),[failures,setFailures]=useState<Record<string,string>>({});
 const pending=items.filter(i=>i.state==='pending');
 const expired=(item:AgentAction)=>item.action.type==='event.upsert'&&eventStarted(item.action.event,timeZone);
 const ready=pending.filter(i=>!expired(i));
 const request=scopedRequest(agentRequest);
 async function approve(list:readonly AgentAction[],slot?:Slot){
  setRunning(true);const failed:Record<string,string>={};let done=0;
  try{
   for(const item of list){
    try{await sendDecision(item,'approve',slot?{overrides:slot}:{},request);done++}
    catch(error){failed[item.id]=error instanceof AgentRequestError&&error.code==='CALENDAR_OVERLAP'?'다른 일정과 겹칩니다. 이 카드의 승인 버튼으로 겹침을 확인한 뒤 등록해 주세요.':error instanceof Error?error.message:'등록하지 못했습니다.'}
   }
  }finally{
   setFailures(failed);
   const left=Object.keys(failed).length;
   toast(`${done}건 등록${left?` · ${left}건은 카드에서 확인이 필요합니다`:''}`);
   await agentRefresh().catch(()=>toast('목록을 새로 불러오지 못했습니다. 잠시 후 다시 열어 주세요.'));
   setRunning(false);
  }
 }
 const extra=(item:AgentAction)=><>
  {failures[item.id]&&<p role="alert" className="agent-error">{failures[item.id]}</p>}
  {item.state==='pending'&&eventOf(item)&&<TimeEditor item={item} timeZone={timeZone} expired={expired(item)} busy={running||!!review.acting} onApprove={slot=>void approve([item],slot)}/>}
 </>;
 return <section className="inbox-group slack-drafts" data-slack-drafts={id} aria-label={`Slack 보관 요청 · ${title}`}>
  <header className="inbox-group-head"><span className="inbox-kind tone-ai">Slack 보관 요청</span><strong>{title}</strong><span className="inbox-group-count">{pending.length}건</span><button className="text-button" onClick={onOpenConversation}><MessageSquareText size={14}/>처리 기록 열기</button></header>
  <p className="inbox-card-why">AI 사용량 한도로 처리하지 못해 보관했던 Slack 지시에서 만든 초안입니다. 확인한 항목만 등록됩니다.</p>
  {ready.length>0&&<div className="decision-bulk"><button className="primary-button" disabled={running||!!review.acting} onClick={()=>void approve(ready)}>{running?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/>} {ready.length}건 확인 후 등록</button>{ready.length<pending.length&&<span className="inbox-group-count">만료 {pending.length-ready.length}건은 새 시간을 정해 따로 등록</span>}</div>}
  {items.map(item=><ActionCard key={item.id} item={item} snapshot={snapshot} review={review} extra={extra(item)}/>)}
 </section>;
}
