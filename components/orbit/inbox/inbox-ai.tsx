'use client';
import {ArrowUpRight} from 'lucide-react';
import {useEffect,useState,type ReactNode} from 'react';
import {toast} from 'sonner';
import type {WorkspaceSnapshot} from '@/lib/orbit/model';
import type {AgentAction} from '@/lib/orbit/agent/types';
import {ActionCard,useActionDecisions} from '../agent/action-review';
import {MeetingDecisions} from './meeting-decisions';
import {MeetingBulkReject} from './meeting-bulk-reject';
import {SlackDrafts} from './slack-drafts';
import {SLACK_REQUEST_CONVERSATION} from '@/lib/orbit/slack/request-view';

import {agentRefresh} from '../agent/refresh';
export {agentRefresh};

interface Props {actions:readonly AgentAction[];snapshot:WorkspaceSnapshot;onOpenNote:(id:string)=>void;onOpenConversation:(id:string)=>void;onAskOrbit:(text:string)=>void;onReviewDeferred:()=>void;deferredCount:number}

// Orbit proposals, decided in place with the same card and checks as the chat review queue.
// Meeting-review cards are grouped under their meeting note.
export function InboxAiDecisions({actions,snapshot,onOpenNote,onOpenConversation,onAskOrbit,onReviewDeferred,deferredCount:deferred}:Props){
 // Decisions made elsewhere (e.g. inside a meeting note) must not linger here: reload when shown.
 useEffect(()=>{void agentRefresh().catch(()=>{})},[]);
 // Meetings picked for 회의 단위 반려 (header checkboxes work on collapsed groups too).
 const [picked,setPicked]=useState<Set<string>>(()=>new Set());
 const togglePick=(noteId:string)=>setPicked(previous=>{const next=new Set(previous);if(next.has(noteId))next.delete(noteId);else next.add(noteId);return next});
 const askOther=(item:AgentAction)=>onAskOrbit('“'+item.title+'” 제안을 기존 일정과 겹치지 않는 시간으로 다시 제안해 줘.');
 const review=useActionDecisions({timeZone:snapshot.data.preferences.timeZone,refresh:agentRefresh,load:agentRefresh,onFeedback:message=>toast(message),onAskOther:askOther});
 const open=actions.filter(a=>a.state==='pending'||a.state==='applying');
 const meetingOf=(a:AgentAction)=>a.guard?.meeting?.noteId;
 const meetings=[...new Set(open.map(meetingOf).filter((id):id is string=>!!id))];
 // Drafts recovered from a saved Slack request are reviewed together, one group per request.
 const slackOf=(a:AgentAction)=>a.conversationId?.startsWith(SLACK_REQUEST_CONVERSATION)?a.conversationId:undefined;
 const slackGroups=[...new Set(open.map(slackOf).filter((id):id is string=>!!id))];
 const others=open.filter(a=>!meetingOf(a)&&!slackOf(a));
const card=(item:AgentAction,lead?:ReactNode)=><ActionCard key={item.id} item={item} snapshot={snapshot} review={review} onAskOther={askOther} lead={lead}/>;
 return <>
  {meetings.length>0&&<MeetingBulkReject meetings={meetings} items={open} picked={picked} onPick={setPicked}/>}
  {meetings.map((noteId,index)=>{const note=snapshot.data.notes.find(n=>n.id===noteId);return <MeetingDecisions key={noteId} noteId={noteId} title={note?.title??'회의록'} items={open.filter(a=>meetingOf(a)===noteId)} onOpenNote={onOpenNote} initiallyOpen={index<5} picked={picked.has(noteId)} onPick={()=>togglePick(noteId)}/>;})}
  {slackGroups.map(id=>{const items=open.filter(a=>slackOf(a)===id);return <SlackDrafts key={id} id={id} title={'초안 준비 '+new Intl.DateTimeFormat('ko-KR',{timeZone:snapshot.data.preferences.timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(items[0].createdAt))} items={items} snapshot={snapshot} review={review} onOpenConversation={()=>onOpenConversation(id)}/>;})}
  {others.map(item=>card(item,item.conversationId?<button className="text-button inbox-source" onClick={()=>onOpenConversation(item.conversationId!)}>Orbit 대화에서 나온 제안 · 대화 열기 <ArrowUpRight size={14}/></button>:null))}
  {deferred>0&&<button className="text-button inbox-deferred" onClick={onReviewDeferred}>보류한 Orbit 제안 {deferred}건 · 다시 검토일과 함께 보기 <ArrowUpRight size={14}/></button>}
  {review.deferDialog}
 </>;
}
