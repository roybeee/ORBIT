'use client';
import {ArrowRight,Check,CheckCheck,Crosshair,Inbox,Pause,Sparkles,Workflow} from 'lucide-react';
import {useEffect,useState,type ReactNode} from 'react';
import {addDays,koreanDate} from '@/lib/orbit/dates';
import {formatTime,type WorkspaceData,type WorkspaceSnapshot} from '@/lib/orbit/model';
import type {AgentAction} from '@/lib/orbit/agent/types';
import type {NewsSummary} from '../notifications';
import {InboxAiDecisions} from './inbox-ai';
import {InboxNews} from './inbox-news';
import {InboxBacklog} from './inbox-backlog';
import type {ProposalSplit} from '@/lib/orbit/inbox-backlog';
import type {WorkspaceAction} from '@/lib/orbit/validation';
import {orderStatusLabel,type WorkOrder} from '@/lib/orbit/agent/orders-schema';
import {orderNeedsDecision,type InboxCounts} from '@/lib/orbit/navigation';

type Filter='all'|'plans'|'ai'|'orders'|'followups';
type Perform=(action:WorkspaceAction,message?:string)=>Promise<boolean>;
interface Props {data:WorkspaceData;today:string;nowMinute:number;counts:InboxCounts;orders:readonly WorkOrder[];actions:readonly AgentAction[];split:ProposalSplit;aiLoading:boolean;snapshot:WorkspaceSnapshot;news:NewsSummary|null;busy:boolean;demo:boolean;perform:Perform;onProposal:(date:string)=>void;onOrder:(id:string)=>void;onFollowup:()=>void;onNews:()=>void;onOpenNote:(id:string)=>void;onOpenConversation:(id:string)=>void;onAskOrbit:(text:string)=>void;onReviewDeferred:()=>void}

const dayLabel=(date:string,today:string)=>date===today?'오늘':date===addDays(today,1)?'내일':koreanDate(date,false);

function Card({kind,tone,source,title,children,actions}:{kind:string;tone:string;source:string;title:ReactNode;children?:ReactNode;actions:ReactNode}){
 return <article className="inbox-card"><div className="inbox-card-source"><span className={`inbox-kind tone-${tone}`}>{kind}</span><span>{source}</span></div><h3>{title}</h3>{children}<div className="inbox-card-actions">{actions}</div></article>;
}

function PlanCard({date,today,late,item,title,busy,demo,perform,onProposal}:{date:string;today:string;late:boolean;item:WorkspaceData['proposals'][number]['items'][number];title:string;busy:boolean;demo:boolean;perform:Perform;onProposal:(date:string)=>void}){
 const [deferring,setDeferring]=useState(false);
 const [reason,setReason]=useState('');
 const [revisit,setRevisit]=useState(addDays(date,1));
 const role=item.role==='laser'?' · Goal Laser':item.role==='must'?' · 반드시 종결':'';
 const approve=()=>void perform({type:'proposal.approve',date,itemId:item.id},'승인한 결과물과 집중 시간을 Orbit 일정에 반영했습니다.');
 const defer=async()=>{if(await perform({type:'proposal.defer',date,itemId:item.id,reason:reason.trim(),revisitDate:revisit},'보류 이유를 저장했습니다.'))setDeferring(false);};
 return <Card kind="계획" tone="plan" source={`${dayLabel(date,today)} 실행 제안 · ${formatTime(item.start)}–${formatTime(item.end)}${role}`} title={<>{item.role==='laser'&&<Crosshair size={15} aria-hidden="true"/>}{title}</>}
  actions={deferring?null:<>{late?<button className="primary-button" onClick={()=>onProposal(date)}><Sparkles size={15}/>대안 다시 계산</button>:<button className="primary-button" disabled={busy||demo} onClick={approve}><Check size={15}/>승인</button>}<button className="secondary-button" disabled={busy||demo} onClick={()=>setDeferring(true)}><Pause size={15}/>보류</button>{!late&&<button className="text-button" onClick={()=>onProposal(date)}>제안 전체 보기<ArrowRight size={14}/></button>}</>}>
  {late&&<p className="inbox-card-late" role="note">시작 시각이 지나 그대로 승인할 수 없습니다. 남은 시간으로 대안을 다시 계산하거나 보류하세요.</p>}
  {item.reason&&<p className="inbox-card-why">{item.reason}</p>}
  {deferring&&<form className="inbox-defer" onSubmit={e=>{e.preventDefault();void defer();}}>
   <label>보류 이유<textarea className="form-field" required rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder="예: 다른 일이 먼저예요"/></label>
   <label>다시 검토할 날짜<input className="form-field" type="date" required min={addDays(date,1)} value={revisit} onChange={e=>setRevisit(e.target.value)}/></label>
   <div className="inbox-card-actions"><button className="primary-button" disabled={busy||!reason.trim()}>보류 저장</button><button type="button" className="secondary-button" onClick={()=>setDeferring(false)}>취소</button></div>
  </form>}
 </Card>;
}

// 결재함 v1: everything the owner must decide, with its source, in one list.
export function InboxPanel({data,today,nowMinute,counts,orders,actions,split,aiLoading,snapshot,news,busy,demo,perform,onProposal,onOrder,onFollowup,onNews,onOpenNote,onOpenConversation,onAskOrbit,onReviewDeferred}:Props){
 const [picked,setPicked]=useState<Filter>('all');
 // The chat loads Orbit proposals; if that never finishes, say so instead of loading forever.
 const [slow,setSlow]=useState(false);
 useEffect(()=>{if(!aiLoading)return;const timer=setTimeout(()=>setSlow(true),20000);return()=>{clearTimeout(timer);setSlow(false);};},[aiLoading]);
 const toBacklog=()=>{setPicked('all');requestAnimationFrame(()=>document.getElementById('inbox-backlog')?.scrollIntoView({behavior:'smooth',block:'start'}));};
 // When the chosen category empties, fall back to everything instead of a blank list.
 const filter:Filter=picked!=='all'&&counts[picked]===0?'all':picked;
 const show=(f:Filter)=>filter==='all'||filter===f;
 const plans=data.proposals.filter(p=>p.date>=today).sort((a,b)=>a.date.localeCompare(b.date)).flatMap(p=>p.items.filter(i=>i.state==='pending').map(item=>({date:p.date,item})));
 const actionable=orders.filter(orderNeedsDecision);
 const due=[
  ...(data.decisions??[]).filter(d=>d.status!=='closed'&&d.reviewDate<=today).map(d=>({id:'decision:'+d.id,kind:'결정 재검토',title:d.title,date:d.reviewDate,projectId:d.projectId})),
  ...(data.delegations??[]).filter(d=>!['verified','cancelled'].includes(d.status)&&d.checkDate<=today).map(d=>({id:'delegation:'+d.id,kind:`위임 · ${d.assignee}`,title:d.title,date:d.checkDate,projectId:d.projectId})),
 ].sort((a,b)=>a.date.localeCompare(b.date));
 const project=(id:string)=>data.projects.find(p=>p.id===id)?.name??'개인';
 const chips:[Filter,string,number][]=[['all','전체',counts.total],['plans','계획',counts.plans],['ai','AI 제안',counts.ai],['orders','업무 지시',counts.orders],['followups','확인일',counts.followups]];
 return <section className="inbox-panel" aria-label="결재함">
  <header className="inbox-summary"><div><strong>{aiLoading?(counts.total?<>지금까지 <em>{counts.total}</em>건 · 나머지를 확인하는 중</>:'정할 일을 확인하는 중…'):counts.total?<>내가 정할 일 <em>{counts.total}</em>건</>:'지금 정할 일이 없습니다'}</strong><p>승인한 항목만 할 일·일정에 반영됩니다. 외부 연락과 Google 일정 등록은 따로 한 번 더 확인합니다.</p>{split.backlogCount>0&&<button className="text-button inbox-backlog-jump" onClick={toBacklog}>7일 넘은 회의 결재 {split.backlogCount}건 보기</button>}</div></header>
  <div className="inbox-filters" role="group" aria-label="결재함 분류">{chips.filter(([id,,n])=>id==='all'||n>0).map(([id,label,n])=><button key={id} className={filter===id?'is-selected':''} aria-pressed={filter===id} onClick={()=>setPicked(id)}>{label}<span>{n}</span></button>)}</div>
  {show('plans')&&plans.map(({date,item})=><PlanCard key={date+item.id} date={date} today={today} late={date===today&&item.start<nowMinute} item={item} title={data.tasks.find(t=>t.id===item.taskId)?.title??item.draftTask?.title??'저장된 실행 항목'} busy={busy} demo={demo} perform={perform} onProposal={onProposal}/>)}
  {aiLoading&&<p className="inbox-loading" role="status">{slow?'Orbit 제안을 아직 불러오지 못했습니다. 연결을 확인하거나 Orbit 대화를 한 번 열어 주세요.':'Orbit 제안을 불러오는 중…'}</p>}
  {show('ai')&&<InboxAiDecisions actions={split.fresh} deferredCount={actions.filter(a=>a.state==='deferred').length} snapshot={snapshot} onOpenNote={onOpenNote} onOpenConversation={onOpenConversation} onAskOrbit={onAskOrbit} onReviewDeferred={onReviewDeferred}/>}
  {show('orders')&&actionable.map(o=><Card key={o.id} kind="업무 지시" tone="order" source={orderStatusLabel[o.status]} title={o.title} actions={<button className="primary-button" onClick={()=>onOrder(o.id)}><Workflow size={15}/>실행 승인하기</button>}>{o.approval&&<p className="inbox-card-why">{o.approval.description}</p>}</Card>)}
  {show('followups')&&due.map(d=><Card key={d.id} kind={d.kind} tone="follow" source={`${project(d.projectId)} · 확인일 ${dayLabel(d.date,today)}`} title={d.title} actions={<button className="secondary-button" onClick={onFollowup}><CheckCheck size={15}/>확인하고 기록</button>}/>)}
  {counts.total===0&&!aiLoading&&<div className="inbox-empty"><Inbox size={30} aria-hidden="true"/><h3>정할 일이 모두 처리됐습니다</h3><p>새 실행 제안, 회의 결재, 업무 지시 결과, 확인일이 된 위임이 생기면 여기와 탭 배지에 표시됩니다.</p><button className="text-button" onClick={()=>onProposal(addDays(today,1))}><Sparkles size={15}/>내일 제안 보기</button></div>}
  {(filter==='all'||filter==='ai')&&<InboxBacklog groups={split.backlog} count={split.backlogCount} snapshot={snapshot} today={today} demo={demo} onOpenNote={onOpenNote} onAskOrbit={onAskOrbit}/>}
  {filter==='all'&&<InboxNews news={news} onNews={onNews}/>}
 </section>;
}
