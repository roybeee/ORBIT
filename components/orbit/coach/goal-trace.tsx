'use client';
import {useMemo} from 'react';
import {ArrowDownRight,ArrowRight,ArrowUpRight,CheckCheck,Clock3,FileText,Compass,MessagesSquare,Minus,Repeat} from 'lucide-react';
import {goalTrace,orbitCheck,type GoalTrace,type Momentum,type TraceItem} from '@/lib/orbit/goal-trace';
import {durationText,type WorkspaceData} from '@/lib/orbit/model';

const momentumLabel:Record<Momentum,string>={rising:'가속 중',steady:'유지',falling:'느려짐',idle:'멈춤',new:'첫 기록 대기'};
const MomentumIcon=({m}:{m:Momentum})=>m==='rising'?<ArrowUpRight size={14}/>:m==='falling'?<ArrowDownRight size={14}/>:m==='steady'?<ArrowRight size={14}/>:<Minus size={14}/>;
const kindIcon={task:CheckCheck,meeting:MessagesSquare,event:MessagesSquare,note:FileText,routine:Repeat} as const;
type Open=(target:{kind:'task'|'note'|'event';id:string})=>void;

export function MomentumBadge({trace}:{trace:GoalTrace}){
 return <span className={`goal-momentum is-${trace.momentum}`}><MomentumIcon m={trace.momentum}/>{momentumLabel[trace.momentum]}{trace.momentum==='idle'&&trace.idleDays!==undefined?` · ${trace.idleDays}일째`:''}</span>;
}

// "최근 7일 이 목표에 쌓인 기록" — the owner's own history, gathered without extra input.
export function GoalTracePanel({trace,onOpen}:{trace:GoalTrace;onOpen:Open}){
 const c=trace.current,p=trace.previous;
 const delta=(now:number,before:number)=>now===before?'':now>before?` ▲${now-before}`:` ▼${before-now}`;
 return <section className="goal-trace" aria-label="최근 7일 이 목표에 쌓인 기록">
  <div className="goal-trace-head"><h3>최근 7일, 이 목표에 쌓인 기록</h3><MomentumBadge trace={trace}/></div>
  <div className="goal-trace-stats">
   <div><CheckCheck size={16}/><strong>{c.done}</strong><span>완료{delta(c.done,p.done)}</span></div>
   <div><Clock3 size={16}/><strong>{c.minutes?durationText(c.minutes):'0분'}</strong><span>실행 시간</span></div>
   <div><MessagesSquare size={16}/><strong>{c.meetings}</strong><span>회의</span></div>
   <div><FileText size={16}/><strong>{c.notes}</strong><span>메모·문서</span></div>
   {c.routines>0&&<div><Repeat size={16}/><strong>{c.routines}</strong><span>루틴</span></div>}
  </div>
  {trace.recent.length?<ul className="goal-trace-list">{trace.recent.map(item=><TraceRow key={item.kind+item.id} item={item} onOpen={onOpen}/>)}</ul>
   :<p className="goal-trace-empty">{trace.lastActivity?`마지막 기록은 ${trace.lastActivity.slice(5).replace('-','/')}입니다. 오늘 한 단계를 끝내면 여기에 바로 쌓입니다.`:'아직 이 목표에 연결된 기록이 없습니다. 프로젝트를 목표에 연결하면 완료·회의·메모가 자동으로 모입니다.'}</p>}
 </section>;
}
function TraceRow({item,onOpen}:{item:TraceItem;onOpen:Open}){
 const Icon=kindIcon[item.kind];
 const target=item.kind==='task'?{kind:'task' as const,id:item.id}:item.kind==='note'||item.kind==='meeting'?{kind:'note' as const,id:item.id}:item.kind==='event'?{kind:'event' as const,id:item.id}:null;
 const body=<><Icon size={15}/><span>{item.title}</span><small>{item.date.slice(5).replace('-','/')}{item.minutes?` · ${durationText(item.minutes)}`:''}</small></>;
 return <li>{target?<button type="button" onClick={()=>onOpen(target)}>{body}</button>:<div>{body}</div>}</li>;
}

export function useGoalTraces(data:WorkspaceData,today:string){
 return useMemo(()=>goalTrace(data,today),[data,today]);
}

// Today's 궤도 점검: one line on where this week's effort went, and the goal that went quiet.
export function OrbitCheckCard({data,today,onGoals}:{data:WorkspaceData;today:string;onGoals:()=>void}){
 const check=useMemo(()=>orbitCheck(data,today),[data,today]);
 if(!check)return null;
 const {alignment:a,quiet,falling}=check;
 const percent=a.ratio===null?null:Math.round(a.ratio*100);
 const headline=percent===null?'이번 주 완료한 일이 아직 없습니다':`이번 주 완료한 일의 ${percent}%가 목표로 이어졌어요`;
 const tone=percent===null?'':percent>=60?'is-good':percent>=35?'is-mid':'is-low';
 const alert=quiet[0]??falling[0];
 return <section className={`orbit-check ${tone}`} aria-label="궤도 점검">
  <button type="button" className="orbit-check-main" onClick={onGoals}>
   <Compass size={20}/>
   <span><strong>{headline}</strong>
    <small>{a.done?`완료 ${a.aligned}/${a.done} · 목표 실행 ${durationText(a.alignedMinutes)}`:'목표에 연결된 일을 하나 끝내면 여기서 바로 반영됩니다'}{a.unlinked[0]&&percent!==null&&percent<60?` · 목표 밖: ${a.unlinked[0].name}`:''}</small>
    {alert&&<small className="orbit-check-alert">{alert.momentum==='new'?`‘${alert.goal.sentence}’에 아직 기록이 없어요. 첫 실행 단계를 정해 보세요.`:alert.momentum==='idle'?`‘${alert.goal.sentence}’ 목표가 ${alert.idleDays}일째 멈춰 있어요.`:`‘${alert.goal.sentence}’ 진행이 지난주보다 느려졌어요.`}</small>}
   </span>
   <ArrowUpRight size={18}/>
  </button>
 </section>;
}
