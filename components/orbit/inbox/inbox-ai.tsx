'use client';
import {ArrowUpRight,FileText} from 'lucide-react';
import type {ReactNode} from 'react';
import {toast} from 'sonner';
import type {WorkspaceSnapshot} from '@/lib/orbit/model';
import type {AgentAction} from '@/lib/orbit/agent/types';
import {ActionCard,useActionDecisions} from '../agent/action-review';

// The chat owns the proposal list; ask that single instance to reload after a decision.
// Rejects when that reload fails so the card says the list could not be refreshed; resolves
// after 15s so a missing listener never leaves a decision hanging.
const agentRefresh=()=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,15000);window.dispatchEvent(new CustomEvent('orbit:agent-refresh',{detail:{done:(error?:unknown)=>{clearTimeout(timer);if(error)reject(error);else resolve()}}}))});

interface Props {actions:readonly AgentAction[];snapshot:WorkspaceSnapshot;onOpenNote:(id:string)=>void;onOpenConversation:(id:string)=>void;onAskOrbit:(text:string)=>void;onReviewDeferred:()=>void}

// Orbit proposals, decided in place with the same card and checks as the chat review queue.
// Meeting-review cards are grouped under their meeting note.
export function InboxAiDecisions({actions,snapshot,onOpenNote,onOpenConversation,onAskOrbit,onReviewDeferred}:Props){
 const askOther=(item:AgentAction)=>onAskOrbit('“'+item.title+'” 제안을 기존 일정과 겹치지 않는 시간으로 다시 제안해 줘.');
 const review=useActionDecisions({timeZone:snapshot.data.preferences.timeZone,refresh:agentRefresh,load:agentRefresh,onFeedback:message=>toast(message),onAskOther:askOther});
 const deferred=actions.filter(a=>a.state==='deferred').length;
 const open=actions.filter(a=>a.state==='pending'||a.state==='applying');
 const meetingOf=(a:AgentAction)=>a.guard?.meeting?.noteId;
 const meetings=[...new Set(open.map(meetingOf).filter((id):id is string=>!!id))];
 const others=open.filter(a=>!meetingOf(a));
const card=(item:AgentAction,lead?:ReactNode)=><ActionCard key={item.id} item={item} snapshot={snapshot} review={review} onAskOther={askOther} lead={lead}/>;
 return <>
  {meetings.map(noteId=>{const note=snapshot.data.notes.find(n=>n.id===noteId);const items=open.filter(a=>meetingOf(a)===noteId);return <section key={noteId} className="inbox-group" aria-label={`회의 결재 · ${note?.title??'회의록'}`}>
   <header className="inbox-group-head"><span className="inbox-kind tone-ai">회의 결재</span><strong>{note?.title??'회의록'}</strong><span className="inbox-group-count">{items.length}건</span><button className="text-button" onClick={()=>onOpenNote(noteId)}><FileText size={14}/>회의록 열기</button></header>
   {items.map(item=>card(item))}
  </section>;})}
  {others.map(item=>card(item,item.conversationId?<button className="text-button inbox-source" onClick={()=>onOpenConversation(item.conversationId!)}>Orbit 대화에서 나온 제안 · 대화 열기 <ArrowUpRight size={14}/></button>:null))}
  {deferred>0&&<button className="text-button inbox-deferred" onClick={onReviewDeferred}>보류한 Orbit 제안 {deferred}건 · 다시 검토일과 함께 보기 <ArrowUpRight size={14}/></button>}
  {review.deferDialog}
 </>;
}
