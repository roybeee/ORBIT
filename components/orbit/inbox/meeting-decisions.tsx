'use client';
import {Check,ChevronDown,ChevronRight,FileText,LoaderCircle,X} from 'lucide-react';
import {useState} from 'react';
import {toast} from 'sonner';
import type {WorkspaceSnapshot} from '@/lib/orbit/model';
import type {AgentAction} from '@/lib/orbit/agent/types';
import {scopedRequest} from '@/lib/orbit/agent/client-request';
import {sendDecision} from '@/lib/orbit/agent/decision-client';
import {AgentRequestError} from '@/lib/orbit/agent/approval-feedback';
import {bulkPlan,decisionRow,summarizeResults} from '@/lib/orbit/meeting-decisions';
import type {ActionReview} from '../agent/action-review';
import {MeetingReview} from '../meeting-review';
import {agentRequest} from '../agent/connections';
import {agentRefresh} from '../agent/refresh';

interface Props {noteId:string;title:string;items:readonly AgentAction[];snapshot:WorkspaceSnapshot;review:ActionReview;onOpenNote:(id:string)=>void;onAskOther:(item:AgentAction)=>void}

// Every decision of one meeting as a list: each row can be approved or closed at once, or chosen
// and handled together (선택 승인 / 나머지 반려). A row opens into the same card as the meeting note
// (마감일 지정, 수정 후 등록, 보류, 다른 일정과 통합, 반려).
export function MeetingDecisions({noteId,title,items,snapshot,review,onOpenNote,onAskOther}:Props){
 const [selected,setSelected]=useState<Set<string>>(()=>new Set());
 const [open,setOpen]=useState<string|null>(null);
 const [dates,setDates]=useState<Record<string,string>>({});
 const [failures,setFailures]=useState<Record<string,string>>({});
 const [running,setRunning]=useState('');
 const [confirmReject,setConfirmReject]=useState(false);
 const [bulkDue,setBulkDue]=useState('');
 const pending=items.filter(i=>i.state==='pending');
 const busy=!!running||!!review.acting;
 const toggle=(id:string)=>setSelected(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next});
 const all=pending.length>0&&pending.every(i=>selected.has(i.id));
 const rest=pending.filter(i=>!selected.has(i.id));

 async function saveDue(item:AgentAction){
  const due=dates[item.id];if(!due)return;
  setRunning(item.id);
  try{await agentRequest('/api/meetings/review','PATCH',{noteId,actionId:item.id,due});await agentRefresh().catch(()=>{});return true}
  catch(error){setFailures(previous=>({...previous,[item.id]:(error as Error).message}));return false}
  finally{setRunning('')}
 }
 // A typed due date and the approval happen in one press.
 async function approveRow(item:AgentAction){
  if(item.guard?.meeting?.needsDue&&!await saveDue(item))return;
  await review.decide(item,'approve');
 }
 async function run(label:string,plan:ReturnType<typeof bulkPlan<AgentAction>>){
  setRunning(label);setFailures({});
  const results:{decision:'approve'|'reject';ok:boolean}[]=[],failed:Record<string,string>={};
  const request=scopedRequest(agentRequest);
  const decide=async(item:AgentAction,decision:'approve'|'reject')=>{
   try{await sendDecision(item,decision,{},request);results.push({decision,ok:true})}
   catch(error){results.push({decision,ok:false});failed[item.id]=error instanceof AgentRequestError&&error.code==='CALENDAR_OVERLAP'?'다른 일정과 겹칩니다. 펼쳐서 겹침을 확인하고 등록해 주세요.':error instanceof Error?error.message:'처리하지 못했습니다.'}
  };
  try{
   const dueFailed=new Set<string>();
   for(const {item,due} of plan.setDue){
    try{await request('/api/meetings/review','PATCH',{noteId,actionId:item.id,due})}
    catch(error){dueFailed.add(item.id);results.push({decision:'approve',ok:false});failed[item.id]=error instanceof Error?error.message:'마감일을 저장하지 못했습니다.'}
   }
   for(const item of plan.approve.filter(i=>!dueFailed.has(i.id)))await decide(item,'approve');
   for(const item of plan.reject)await decide(item,'reject');
   for(const {item,reason} of plan.blocked)failed[item.id]=reason;
  }finally{
   setFailures(failed);setSelected(new Set());setConfirmReject(false);setBulkDue('');
   const summary=summarizeResults(results);
   if(summary||plan.blocked.length)toast([summary,plan.blocked.length?`남은 ${plan.blocked.length}건은 먼저 확인이 필요합니다.`:''].filter(Boolean).join(' · '));
   await agentRefresh().catch(()=>toast('목록을 새로 불러오지 못했습니다. 잠시 후 다시 열어 주세요.'));
   setRunning('');
  }
 }

 return <section className="inbox-group meeting-decisions" aria-label={`회의 결재 · ${title}`}>
  <header className="inbox-group-head"><span className="inbox-kind tone-ai">회의 결재</span><strong>{title}</strong><span className="inbox-group-count">{pending.length}건</span><button className="text-button" onClick={()=>onOpenNote(noteId)}><FileText size={14}/>회의록 열기</button></header>
  <label className="decision-select-all"><input type="checkbox" checked={all} disabled={busy||!pending.length} onChange={()=>setSelected(all?new Set():new Set(pending.map(i=>i.id)))}/> 전체 선택</label>
  <ul className="decision-list">
   {items.map(item=>{const row=decisionRow(item,snapshot.data.projects),expanded=open===item.id,isPending=item.state==='pending';
    return <li key={item.id} className={'decision-row '+item.state}>
     <div className="decision-line">
      <input type="checkbox" aria-label={item.title+' 선택'} checked={selected.has(item.id)} disabled={busy||!isPending} onChange={()=>toggle(item.id)}/>
      <button className="decision-main" aria-expanded={expanded} onClick={()=>setOpen(expanded?null:item.id)}>
       <span className="inbox-kind tone-ai">{row.kind}</span><strong>{item.title}</strong>
       <small>{[row.date,row.project].filter(Boolean).join(' · ')}</small>
       {expanded?<ChevronDown size={16}/>:<ChevronRight size={16}/>}
      </button>
      {isPending&&<div className="decision-quick">
       <button className="icon-button" aria-label={item.title+' 승인'} disabled={busy||(row.needsDue&&!dates[item.id])} onClick={()=>void approveRow(item)}>{review.acting===item.id?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/>}</button>
       <button className="icon-button" aria-label={item.title+' 반려'} disabled={busy} onClick={()=>void review.decide(item,'reject')}><X size={15}/></button>
      </div>}
     </div>
     {row.needsDue&&isPending&&!expanded&&<form className="decision-due" onSubmit={e=>{e.preventDefault();void saveDue(item)}}><label>마감일<input type="date" required value={dates[item.id]??''} onChange={e=>setDates(previous=>({...previous,[item.id]:e.target.value}))}/></label><button className="secondary-button" disabled={busy||!dates[item.id]}>저장만</button></form>}
     {failures[item.id]&&<p role="alert" className="agent-error">{failures[item.id]}</p>}
     {!expanded&&review.notice(item,onAskOther)}
     {expanded&&<MeetingReview noteId={noteId} revision={item.guard?.meeting?.revision??1} demo={false} focus={item.id} onChanged={()=>void agentRefresh().catch(()=>{})}/>}
    </li>;})}
  </ul>
  {pending.length>0&&<div className="decision-bulk">
   {pending.some(i=>selected.has(i.id)&&i.guard?.meeting?.needsDue&&!dates[i.id])&&<label className="decision-bulk-due">마감 미정 항목 마감일<input type="date" value={bulkDue} onChange={e=>setBulkDue(e.target.value)}/></label>}
   <button className="primary-button" disabled={busy||!selected.size} onClick={()=>void run('approve',bulkPlan(items,selected,{rejectRest:false,dueOf:i=>dates[i.id]||bulkDue||undefined}))}>{running==='approve'?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/>} 선택 {selected.size}건 승인</button>
   <button className={'secondary-button'+(confirmReject?' decision-reject-confirm':'')} disabled={busy||!rest.length} onClick={()=>{if(!confirmReject){setConfirmReject(true);return}void run('reject',{approve:[],reject:rest,blocked:[],setDue:[]})}}>{confirmReject?`한 번 더 누르면 ${rest.length}건 반려`:`선택하지 않은 ${rest.length}건 반려`}</button>
   {confirmReject&&<button className="text-button" onClick={()=>setConfirmReject(false)}>취소</button>}
  </div>}
 </section>;
}
