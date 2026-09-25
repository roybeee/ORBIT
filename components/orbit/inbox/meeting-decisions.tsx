'use client';
import {Check,FileText,LoaderCircle} from 'lucide-react';
import {useState} from 'react';
import {toast} from 'sonner';
import type {AgentAction} from '@/lib/orbit/agent/types';
import {scopedRequest} from '@/lib/orbit/agent/client-request';
import {sendDecision} from '@/lib/orbit/agent/decision-client';
import {AgentRequestError} from '@/lib/orbit/agent/approval-feedback';
import {bulkPlan,bulkReject,summarizeResults} from '@/lib/orbit/meeting-decisions';
import {MeetingReview} from '../meeting-review';
import {agentRequest} from '../agent/connections';
import {agentRefresh} from '../agent/refresh';

interface Props {noteId:string;title:string;items:readonly AgentAction[];onOpenNote:(id:string)=>void;initiallyOpen?:boolean;picked?:boolean;onPick?:()=>void}

// Every decision of one meeting, shown with the meeting note's own cards (마감일 지정, 승인하고 등록,
// 수정 후 등록, 보류, 다른 일정과 통합, 반려), plus a checkbox per card for 선택 승인 / 나머지 반려.
export function MeetingDecisions({noteId,title,items,onOpenNote,initiallyOpen=true,picked=false,onPick}:Props){
 // Only a few meetings are laid out at once; the others open on demand (hundreds of cards were slow).
 const [open,setOpen]=useState(initiallyOpen);
 const [selected,setSelected]=useState<Set<string>>(()=>new Set());
 // A bulk notice belongs to the card as it was; once the card changes (merge, date saved) it is dropped.
 const [failures,setFailures]=useState<Record<string,{message:string;version:string}>>({});
 const version=(item:AgentAction)=>JSON.stringify([item.title,item.guard?.meeting?.needsDue,item.action]);
 const [running,setRunning]=useState('');
 const [confirmReject,setConfirmReject]=useState(false);
 const [bulkDue,setBulkDue]=useState('');
 const pending=items.filter(i=>i.state==='pending');
 const busy=!!running;
 const toggle=(id:string)=>setSelected(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next});
 const all=pending.length>0&&pending.every(i=>selected.has(i.id));
 const rest=pending.filter(i=>!selected.has(i.id));
 const revision=items[0]?.guard?.meeting?.revision??1;

 async function run(label:string,plan:ReturnType<typeof bulkPlan<AgentAction>>){
  setRunning(label);setFailures({});
  const results:{decision:'approve'|'reject';ok:boolean}[]=[],failed:Record<string,string>={};
  const cards=new Map(items.map(i=>[i.id,version(i)]));
  const request=scopedRequest(agentRequest);
  const decide=async(item:AgentAction,decision:'approve'|'reject')=>{
   try{await sendDecision(item,decision,{},request);results.push({decision,ok:true})}
   catch(error){results.push({decision,ok:false});failed[item.id]=error instanceof AgentRequestError&&error.code==='CALENDAR_OVERLAP'?'다른 일정과 겹칩니다. 이 카드에서 승인하고 등록을 눌러 겹침을 확인해 주세요.':error instanceof Error?error.message:'처리하지 못했습니다.'}
  };
  try{
   const dueFailed=new Set<string>();
   for(const {item,due} of plan.setDue){
    try{await request('/api/meetings/review','PATCH',{noteId,actionId:item.id,due})}
    catch(error){dueFailed.add(item.id);results.push({decision:'approve',ok:false});failed[item.id]=error instanceof Error?error.message:'마감일을 저장하지 못했습니다.'}
   }
   for(const item of plan.approve.filter(i=>!dueFailed.has(i.id)))await decide(item,'approve');
   // One server call for the whole rest; a card someone already decided is skipped, not failed.
   if(plan.reject.length){
    try{const {rejected}=await bulkReject(plan.reject.map(i=>i.id),request);results.push(...Array.from({length:rejected},()=>({decision:'reject' as const,ok:true})))}
    catch(error){for(const item of plan.reject){results.push({decision:'reject',ok:false});failed[item.id]=error instanceof Error?error.message:'반려하지 못했습니다.'}}
   }
   for(const {item,reason} of plan.blocked)failed[item.id]=reason;
  }finally{
   setFailures(Object.fromEntries(Object.entries(failed).map(([id,message])=>[id,{message,version:cards.get(id)??''}])));setSelected(new Set());setConfirmReject(false);setBulkDue('');
   const summary=summarizeResults(results);
   if(summary||plan.blocked.length)toast([summary,plan.blocked.length?`남은 ${plan.blocked.length}건은 먼저 확인이 필요합니다.`:''].filter(Boolean).join(' · '));
   await agentRefresh().catch(()=>toast('목록을 새로 불러오지 못했습니다. 잠시 후 다시 열어 주세요.'));
   setRunning('');
  }
 }

 const lead=(item:AgentAction)=>item.state!=='pending'?null:<div className="decision-pick">
  <label><input type="checkbox" aria-label={item.title+' 선택'} checked={selected.has(item.id)} disabled={busy} onChange={()=>toggle(item.id)}/> 일괄 처리에 포함</label>
  {failures[item.id]?.version===version(item)&&<p role="alert" className="agent-error">{failures[item.id].message}</p>}
 </div>;

 return <section className="inbox-group meeting-decisions" aria-label={`회의 결재 · ${title}`}>
  <header className="inbox-group-head">{onPick&&<input type="checkbox" className="decision-meeting-pick" aria-label={title+' 회의 전체 선택'} checked={picked} disabled={!pending.length} onChange={onPick}/>}<span className="inbox-kind tone-ai">회의 결재</span><strong>{title}</strong><span className="inbox-group-count">{pending.length}건</span><button className="text-button" onClick={()=>onOpenNote(noteId)}><FileText size={14}/>회의록 열기</button></header>
  {!open&&<button className="text-button decision-open" onClick={()=>setOpen(true)}>결재안 펼치기 · {pending.length}건</button>}
  {open&&<>
  <label className="decision-select-all"><input type="checkbox" checked={all} disabled={busy||!pending.length} onChange={()=>setSelected(all?new Set():new Set(pending.map(i=>i.id)))}/> 전체 선택</label>
  {pending.length>0&&<div className="decision-bulk">
   {pending.some(i=>selected.has(i.id)&&i.guard?.meeting?.needsDue)&&<label className="decision-bulk-due">마감 미정 항목 마감일<input type="date" value={bulkDue} onChange={e=>setBulkDue(e.target.value)}/></label>}
   <button className="primary-button" disabled={busy||!selected.size} onClick={()=>void run('approve',bulkPlan(items,selected,{rejectRest:false,dueOf:()=>bulkDue||undefined}))}>{running==='approve'?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/>} 선택 {selected.size}건 승인</button>
   <button className={'secondary-button'+(confirmReject?' decision-reject-confirm':'')} disabled={busy||!rest.length} onClick={()=>{if(!confirmReject){setConfirmReject(true);return}void run('reject',{approve:[],reject:rest,blocked:[],setDue:[]})}}>{confirmReject?`한 번 더 누르면 ${rest.length}건 반려`:`선택하지 않은 ${rest.length}건 반려`}</button>
   {confirmReject&&<button className="text-button" onClick={()=>setConfirmReject(false)}>취소</button>}
  </div>}
  <MeetingReview noteId={noteId} revision={revision} demo={false} focus={items.map(i=>i.id)} lead={lead} onChanged={()=>void agentRefresh().catch(()=>{})}/>
  </>}
 </section>;
}
