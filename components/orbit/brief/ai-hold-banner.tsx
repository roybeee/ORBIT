'use client';
import {useEffect,useState} from 'react';
import {Hourglass} from 'lucide-react';
import {agentRequest} from '../agent/connections';
import type {aiHoldStatus} from '@/lib/orbit/agent/hold-status';

type HoldStatus=Awaited<ReturnType<typeof aiHoldStatus>>;
const POLL_MS=60000;
// Observes GET /api/ai-hold only. The banner exists only while a provider limit holds analysis back.
function useAiHold(demo:boolean){
 const [status,setStatus]=useState<HoldStatus|null>(null);
 useEffect(()=>{
  if(demo)return;
  let active=true;
  const visible=()=>document.visibilityState==='visible';
  const load=async()=>{try{const next=await agentRequest('/api/ai-hold') as HoldStatus;if(active)setStatus(next)}catch{/* the banner is advisory; the inbox keeps the hold notice */}};
  void load();
  const timer=setInterval(()=>{if(visible())void load()},POLL_MS);
  const onVisibility=()=>{if(visible())void load()};
  document.addEventListener('visibilitychange',onVisibility);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility)};
 },[demo]);
 return status;
}
export function AiHoldBanner({demo,timeZone,onPlan,onNote}:{demo:boolean;timeZone:string;onPlan:()=>void;onNote:(id:string)=>void}){
 const status=useAiHold(demo),[open,setOpen]=useState(false);
 const hold=status?.holds[0];
 if(!status||!hold)return null;
 const at=new Intl.DateTimeFormat('ko-KR',{timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(hold.nextCheckAt));
 const count=status.waiting.meetings.length+status.waiting.plans.length;
 return <section className="ai-hold" role="status" aria-label="AI 분석 대기">
  <p><Hourglass size={16} aria-hidden/><strong>AI 분석 대기 중</strong><span>기존 계획과 결과 기록은 사용 가능</span></p>
  <small>{hold.retryKnown?`한도 회복 예정 ${at}`:`회복 시각 미확인 · ${at}에 다시 확인`} · 대기 작업 {count}건</small>
  <div className="ai-hold-actions"><button className="secondary-button" onClick={onPlan}>현재 계획 보기</button><button className="secondary-button" aria-expanded={open} onClick={()=>setOpen(!open)}>대기 작업 보기</button></div>
  {open&&<ul className="ai-hold-list">{status.waiting.plans.map(p=><li key={p.date}>{p.date} 계획 전체 분석</li>)}{status.waiting.meetings.map(m=><li key={m.noteId}><button onClick={()=>onNote(m.noteId)}>{m.title}</button></li>)}{count===0&&<li>대기 중인 작업이 없습니다.</li>}</ul>}
 </section>;
}
