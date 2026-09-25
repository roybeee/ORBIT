'use client';
import {Archive,ChevronDown,FileText,Pause,Square} from 'lucide-react';
import {useRef,useState,useSyncExternalStore} from 'react';
import {toast} from 'sonner';
import {addDays} from '@/lib/orbit/dates';
import {FRESH_DAYS,type BacklogGroup} from '@/lib/orbit/inbox-backlog';
import {deferActions} from '@/lib/orbit/agent/decision-client';
import {scopedRequest} from '@/lib/orbit/agent/client-request';
import type {WorkspaceSnapshot} from '@/lib/orbit/model';
import type {AgentAction} from '@/lib/orbit/agent/types';
import {agentRefresh} from './inbox-ai';
import {agentRequest} from '../agent/connections';
import {ActionCard,useActionDecisions} from '../agent/action-review';

// One bulk run at a time, kept outside the component: leaving the 결재함 mid-run must not
// lose its progress or allow a second run over the same cards.
interface Run {key:string;label:string;done:number;total:number;controller:AbortController}
let current:Run|null=null;
const listeners=new Set<()=>void>();
const setRun=(run:Run|null)=>{current=run;listeners.forEach(fn=>fn());};
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
const snapshotRun=()=>current,serverRun=()=>null;

const SHOWN=5;
const day=(date:string)=>date.slice(5).replace('-','/');
const ALL='all';

// Orbit proposals older than FRESH_DAYS (meeting cards by meeting date). They are not in the
// badge; approve the ones that still matter and defer the rest in bulk with one reason and date.
export function InboxBacklog({groups,count,snapshot,today,demo,onOpenNote,onAskOrbit}:{groups:readonly BacklogGroup[];count:number;snapshot:WorkspaceSnapshot;today:string;demo:boolean;onOpenNote:(id:string)=>void;onAskOrbit:(text:string)=>void}){
 const askOther=(item:AgentAction)=>onAskOrbit('“'+item.title+'” 제안을 기존 일정과 겹치지 않는 시간으로 다시 제안해 줘.');
 const review=useActionDecisions({timeZone:snapshot.data.preferences.timeZone,refresh:agentRefresh,load:agentRefresh,onFeedback:message=>toast(message),onAskOther:askOther});
 const run=useSyncExternalStore(subscribe,snapshotRun,serverRun);
 const [all,setAll]=useState(false),[opened,setOpened]=useState<string|null>(null),[target,setTarget]=useState<string|null>(null);
 const [reason,setReason]=useState('지난 제안 일괄 정리 · 필요할 때 다시 검토'),[revisit,setRevisit]=useState(addDays(today,14));
 const heading=useRef<HTMLHeadingElement>(null);
 if(!count&&!run)return null;
 const meetings=groups.filter(g=>g.noteId).length;
 const shown=all?groups:groups.slice(0,SHOWN);
 const busy=!!run||!!review.acting;
 const labelOf=(key:string)=>key===ALL?'쌓인 제안 전체':groups.find(g=>g.key===key)?.title??'선택한 묶음';
 // Resolved at submit time from the latest list, so cards closed or replaced meanwhile are not sent.
 const actionsOf=(key:string)=>key===ALL?groups.flatMap(g=>g.actions):groups.find(g=>g.key===key)?.actions??[];
 const start=async(key:string)=>{
  const actions=actionsOf(key).filter(a=>a.state==='pending');
  if(!actions.length||current)return;
  const controller=new AbortController(),label=labelOf(key);
  setOpened(null);setRun({key,label,done:0,total:actions.length,controller});
  try{
   const result=await deferActions(actions,{reason:reason.trim(),revisitDate:revisit},{request:scopedRequest(agentRequest),signal:controller.signal,onProgress:(done,total)=>setRun({key,label,done,total,controller})});
   const failed=result.failed.length?` ${result.failed.length}건은 보류하지 못했습니다(${result.failed[0].message}).`:'';
   const stopped=result.stopped?` ${result.remaining}건은 그대로 남았습니다 — ${result.stopped}`:'';
   toast(`${result.deferred}건을 ${revisit}에 다시 검토하도록 보류했습니다.${failed}${stopped}`);
   setTarget(null);
  }finally{
   await agentRefresh().catch(()=>toast('목록을 새로 불러오지 못했습니다. 잠시 후 다시 열어 주세요.'));
   setRun(null);
   heading.current?.focus();
  }
 };
 const form=(key:string)=>{
  const total=actionsOf(key).filter(a=>a.state==='pending').length,mine=run?.key===key;
  return <form className="inbox-defer inbox-backlog-form" onSubmit={e=>{e.preventDefault();void start(key);}}>
   <strong>{labelOf(key)} · {mine?run.total:total}건 보류</strong>
   <label>보류 이유<textarea className="form-field" required rows={2} maxLength={2000} value={reason} disabled={!!run} onChange={e=>setReason(e.target.value)}/></label>
   <label>다시 검토할 날짜<input className="form-field" type="date" required min={addDays(today,1)} value={revisit} disabled={!!run} onChange={e=>setRevisit(e.target.value)}/></label>
   {mine&&<div className="inbox-backlog-progress" role="progressbar" aria-label="일괄 보류 진행" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.done}><span style={{width:`${run.total?run.done/run.total*100:100}%`}}/><small>{run.done}/{run.total} 보류 중…</small></div>}
   <div className="inbox-card-actions">
    {mine?<button type="button" className="secondary-button" onClick={()=>run.controller.abort()}><Square size={14}/>중단</button>
     :<><button className="primary-button" disabled={busy||demo||!reason.trim()||!total}><Pause size={15}/>보류 {total}건</button><button type="button" className="secondary-button" onClick={()=>setTarget(null)}>취소</button></>}
   </div>
  </form>;
 };
 const active=run?.key??target;
 return <section id="inbox-backlog" className="inbox-backlog" aria-label="쌓인 회의 결재">
  <header>
   <div><h2 ref={heading} tabIndex={-1}><Archive size={17} aria-hidden="true"/>쌓인 회의 결재 <em>{count}</em>건</h2><p>회의가 {FRESH_DAYS}일 넘게 지난 제안이라 배지에 세지 않습니다{meetings?` · 회의 ${meetings}개`:''}. 필요한 것만 펼쳐 승인하고, 나머지는 이유와 재검토일을 남겨 한꺼번에 보류하세요. 보류한 제안은 재검토일에 다시 올라옵니다.</p></div>
   <button className="secondary-button" disabled={busy||demo||!count} onClick={()=>setTarget(ALL)}><Pause size={15}/>전체 보류</button>
  </header>
  {active===ALL&&form(ALL)}
  <ul className="inbox-backlog-list">{shown.map(group=>{const expanded=opened===group.key&&!run;const kind=group.noteId?'이 회의':'이 묶음';return <li key={group.key}>
   <div className="inbox-backlog-row">
    <span className="inbox-backlog-date">{day(group.date)}</span>
    <span className="inbox-backlog-title"><strong>{group.title}</strong><small>제안 {group.actions.length}건</small></span>
    <span className="inbox-backlog-actions">
     {group.noteId&&<button className="icon-button" aria-label={`${group.title} 회의록 열기`} onClick={()=>onOpenNote(group.noteId!)}><FileText size={16}/></button>}
     <button className="text-button" aria-expanded={expanded} aria-label={`${group.title} 카드 보기`} disabled={!!run} onClick={()=>setOpened(expanded?null:group.key)}>카드 보기<ChevronDown size={14}/></button>
     <button className="text-button" aria-label={`${group.title} ${kind} 보류`} disabled={busy||demo} onClick={()=>setTarget(group.key)}>{kind} 보류</button>
    </span>
   </div>
   {active===group.key&&form(group.key)}
   {expanded&&<div className="inbox-backlog-cards">{group.actions.map(item=><ActionCard key={item.id} item={item} snapshot={snapshot} review={review} onAskOther={askOther}/>)}</div>}
  </li>;})}</ul>
  {groups.length>SHOWN&&<button className="text-button" onClick={()=>setAll(v=>!v)}>{all?'접기':`회의 ${groups.length-SHOWN}개 더 보기`}</button>}
  {review.deferDialog}
 </section>;
}
