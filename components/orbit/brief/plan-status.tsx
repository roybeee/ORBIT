'use client';
import {ChevronRight} from 'lucide-react';
import {usePlanStatus} from './use-plan-status';
import {MORNING_HOUR,formatAt,planSteps,type PlanStatus} from '@/lib/orbit/brief/status-model';
import type {Proposal} from '@/lib/orbit/model';

interface Props {demo:boolean;timeZone:string;proposals:Proposal[];onProposal:(date:string)=>void}

function historySummary(history:PlanStatus['history']){
 const completed=history.filter(h=>h.status==='completed');
 const durations=completed.map(h=>h.durationMs).filter((ms):ms is number=>ms!=null);
 const avg=durations.length?Math.round(durations.reduce((sum,ms)=>sum+ms,0)/durations.length/60000):null;
 return {done:completed.length,morning:history.filter(h=>h.readyBeforeMorning===true).length,avg};
}

function HistoryRow({row,timeZone}:{row:PlanStatus['history'][number];timeZone:string}){
 const ready=row.readyAt?formatAt(row.readyAt,timeZone):row.status==='failed'?'실패':'진행 중';
 const m=row.metrics;
 return <tr><td>{row.date}</td><td>{formatAt(row.startedAt,timeZone)}</td><td>{ready}</td><td>{row.durationMs!=null?Math.round(row.durationMs/60000)+'분':'—'}</td><td>{row.readyBeforeMorning==null?'—':row.readyBeforeMorning?'예':'아니오'}</td><td>{m?`${m.reused+m.mergeReused}/${m.leaves+m.merges}`:'—'}</td><td>{m?m.posts+'회':'—'}</td></tr>;
}

function History({status,timeZone}:{status:PlanStatus;timeZone:string}){
 const {done,morning,avg}=historySummary(status.history);
 return <details className="plan-status-history">
  <summary>최근 7일 준비 기록 · 준비 완료 {done}/{status.history.length}일 · 아침 {MORNING_HOUR}시 전 {morning}일{avg!==null?` · 평균 소요 ${avg}분`:''}</summary>
  <table><thead><tr><th>날짜</th><th>시작</th><th>준비 완료</th><th>소요</th><th>아침 전</th><th>재사용/전체</th><th>Hermes</th></tr></thead><tbody>{status.history.map(h=><HistoryRow key={h.turnId} row={h} timeZone={timeZone}/>)}</tbody></table>
 </details>;
}

// Observe only: this strip never posts to /api/agent/run.
export function PlanStatusStrip({demo,timeZone,proposals,onProposal}:Props){
 const {status,error}=usePlanStatus(demo);
 const steps=planSteps(status,demo,timeZone);
 const savedDate=[...proposals].filter(p=>p.brief).sort((a,b)=>b.date.localeCompare(a.date))[0]?.date;
 const viewDate=status?status.plan.state!=='none'?status.target.date:undefined:savedDate;
 const progressAt=status?.analysis.lastProgressAt??status?.collection.lastProgressAt;
 return <section className="today-review plan-status" role="status" aria-labelledby="plan-status-title">
  <div className="section-title"><h2 id="plan-status-title">계획 준비 상태</h2>{viewDate&&<button className="text-button" onClick={()=>onProposal(viewDate)}>계획 보기<ChevronRight size={15}/></button>}</div>
  <ol className="plan-status-steps">{steps.map(s=><li key={s.id} className={'is-'+s.state} aria-current={s.state==='active'?'step':undefined}><span className="plan-status-dot" aria-hidden="true"/><span><strong>{s.title}</strong><span>{s.summary}</span><small>{s.detail}</small></span></li>)}</ol>
  <p className="plan-status-basis">반영 기준 시각 {formatAt(status?.plan.basisAt,timeZone)} · 미확인 자료 {status?status.plan.unconfirmed.total+'건':'—'} · 마지막 진행 시각 {formatAt(progressAt,timeZone)}</p>
  {error&&<p role="alert" className="agent-error">{error}</p>}
  {status&&status.history.length>0&&<History status={status} timeZone={timeZone}/>}
 </section>;
}
