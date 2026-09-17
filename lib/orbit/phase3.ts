import {activeAllocation,planningEvents} from './allocation-policy.ts';
import type {WorkspaceData,CalendarEvent} from './model.ts';
import type {ProtectedBlock,WeeklyAllocation,OperatingMetric} from './phase3-model.ts';
import {addDays,todayInZone,weekDates,weekday} from './dates.ts';
import {careEvents,goalAllowsWork,localMinute} from './chief.ts';
import {availableWindows} from './planner.ts';

export const metricCategories={sales:'매출',cost:'비용',evidence:'증빙',people:'인사',contract:'계약'};
export const stanceLabels={focus:'집중',maintain:'유지',pause:'이번 주 보류'};
export {activeAllocation,allocationAllowsWork,protectedEvents,planningEvents} from './allocation-policy.ts';
export function weeklyCapacity(data:WorkspaceData,week:string,blocks:ProtectedBlock[],now=new Date()){
  const days=weekDates(week),today=todayInZone(data.preferences.timeZone,now),p=data.preferences;
  const rows=days.map(date=>{
    const start=date===today?Math.max(p.workStart,localMinute(now,p.timeZone)):p.workStart;
    if(date<today||!p.workDays.includes(weekday(date))||start>=p.workEnd)return {date,free:0,budget:0};
    const approved=data.proposals.filter(p=>p.date===date).flatMap(p=>p.items.filter(i=>i.state==='approved').map(i=>({id:i.id,title:'승인한 집중 시간',date,start:i.start,end:i.end,kind:'focus' as const,taskId:i.taskId})));
    const busy=planningEvents([...data.events,...approved,...careEvents(data,date),...blocks.filter(b=>b.date===date).map(b=>({...b,kind:'break' as const}))],date,p);
    const free=availableWindows(busy,date,start,p.workEnd).reduce((n,w)=>n+w.end-w.start,0);
    const checkin=data.chief?.checkins?.find(c=>c.date===date),factor=checkin?.energy==='low'||checkin?.strain==='heavy'?Math.min(.5,1-p.bufferFraction):1-p.bufferFraction;
    return {date,free,budget:Math.floor(free*factor)};
  });
  return {from:days[0],through:days[6],days:rows,free:rows.reduce((n,r)=>n+r.free,0),budget:rows.reduce((n,r)=>n+r.budget,0)};
}
// Detect a stale preview; authorization and concurrency remain enforced by workspace commands.
export function portfolioBasis(data:WorkspaceData,week:string){
  const text=JSON.stringify({week:weekDates(week)[0],projects:data.projects,tasks:data.tasks,events:data.events,proposals:data.proposals.map(p=>({date:p.date,items:p.items})),preferences:data.preferences,goals:data.goals,care:data.careRoutines,chief:data.chief,allocations:data.weeklyAllocations});
  let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(16);
}
export function portfolioReview(data:WorkspaceData,week:string,blocks:ProtectedBlock[],now=new Date()){
  const capacity=weeklyCapacity(data,week,blocks,now),today=todayInZone(data.preferences.timeZone,now);
  const rows=data.projects.map(project=>{
    const tasks=data.tasks.filter(t=>t.projectId===project.id),open=tasks.filter(t=>t.status!=='done');
    const ready=open.filter(t=>goalAllowsWork(data,project.id)&&t.status!=='waiting'&&!t.blocker?.trim()&&(!t.planHoldUntil||t.planHoldUntil<=capacity.through)&&!(t.dependsOn??[]).some(id=>data.tasks.find(x=>x.id===id)?.status!=='done'));
    const urgent=ready.filter(t=>t.due<=capacity.through),measured=tasks.filter(t=>t.outcomeOn&&t.outcomeOn>=capacity.from&&t.outcomeOn<=today&&t.outcomeOn<=capacity.through&&typeof t.actualMinutes==='number');
    const promises=(data.delegations??[]).filter(d=>d.projectId===project.id&&!['verified','cancelled'].includes(d.status));
    const decisions=(data.decisions??[]).filter(d=>d.projectId===project.id&&d.status!=='closed');
    const score=project.priority*10+Math.min(30,urgent.length*5)+(project.id===data.dominoProjectId?20:0)+(project.due<=capacity.through?10:0);
    return {project,open:open.length,ready:ready.length,demand:ready.reduce((n,t)=>n+t.duration,0),blocked:open.filter(t=>!ready.includes(t)),urgent:urgent.length,recordedMinutes:measured.reduce((n,t)=>n+(t.actualMinutes??0),0),recordedCount:measured.length,promises,decisions,score,goalActive:goalAllowsWork(data,project.id)};
  }).sort((a,b)=>b.score-a.score||a.project.id.localeCompare(b.project.id));
  let remaining=capacity.budget,focused=0;
  const allocations:WeeklyAllocation['allocations']=rows.map(r=>{
    const minutes=Math.min(r.demand,Math.floor(remaining/5)*5),focus=minutes>0&&focused<3;
    if(focus)focused++;remaining-=minutes;
    const stance=!r.goalActive?'pause':focus?'focus':'maintain';
    const reason=!r.goalActive?'연결 목표가 보류·달성 상태입니다.':!r.open?'열린 업무가 없습니다.':!r.ready?'대기·선행 조건부터 확인해야 합니다.':minutes===0?'이번 주 여유 시간이 부족합니다. 범위 축소나 위임을 검토하세요.':`우선순위 ${r.project.priority} · 이번 주 마감 ${r.urgent}건 · 실행 가능한 업무 ${r.ready}건`;
    return {projectId:r.project.id,minutes,stance,reason};
  });
  return {capacity,rows,allocations,basis:portfolioBasis(data,week)};
}
const advice:Record<OperatingMetric['category'],{hypothesis:string;documents:string;question:string}>={
 sales:{hypothesis:'영업일·주문 수·객단가·취소 구성 변화 가능성',documents:'같은 기간의 POS·채널별 주문·취소·정산 원본',question:'일시적인 변동인가요? 채널이나 상품별 조치가 필요한가요?'},
 cost:{hypothesis:'단가·사용량·일회성 지출·귀속 기간 차이 가능성',documents:'계약 단가·발주·세금계산서·지급 내역',question:'정상 지출인가요? 재협상·차액 확인·통제가 필요한가요?'},
 evidence:{hypothesis:'자료 수집 지연·중복·누락 가능성',documents:'미수취 증빙 목록·거래 원장·담당자 확인',question:'누가 어떤 증빙을 언제까지 보완해야 하나요?'},
 people:{hypothesis:'근무 일정·결원·초과 근무 집계 차이 가능성',documents:'근무표·출퇴근·채용 진행·업무 배분 기록',question:'인력 재배치나 일정 조정이 필요한가요?'},
 contract:{hypothesis:'만기·협상 지연·서류 누락 가능성',documents:'계약 원문·만기 목록·협의 이력',question:'갱신·종료·조건 변경 중 무엇을 결정해야 하나요?'},
};
export function operatingSignals(data:WorkspaceData,today:string){
  const replaced=new Set((data.metricObservations??[]).map(o=>o.supersedesId).filter(Boolean));
  return (data.operatingMetrics??[]).map(metric=>{
    const samples=(data.metricObservations??[]).filter(o=>o.metricId===metric.id&&o.through<=today&&!replaced.has(o.id)).sort((a,b)=>b.through.localeCompare(a.through)||b.recordedAt.localeCompare(a.recordedAt));
    const latest=samples[0],length=(o:typeof latest)=>(Date.parse(o.through)-Date.parse(o.from))/86400000;
    const baseline=latest?samples.slice(1).find(o=>o.through<latest.from&&length(o)===length(latest)):undefined;
    const stale=!!latest&&latest.through<addDays(today,-metric.maxAgeDays);
    const sourceChanged=[latest,baseline].some(o=>o?.noteId&&!data.notes.some(n=>n.id===o.noteId&&(n.revision??1)===o.noteRevision));
    const delta=latest&&baseline?latest.value-baseline.value:null,percent=delta!==null&&baseline&&baseline.value!==0?delta/Math.abs(baseline.value)*100:null;
    const adverse=delta!==null?(metric.badDirection==='up'?delta:-delta):null;
    const thresholdMet=adverse!==null&&adverse>0&&adverse>=metric.thresholdAbsolute&&(percent===null?metric.thresholdAbsolute>0:Math.abs(percent)>=metric.thresholdPercent);
    const state=!latest?'missing':stale?'stale':sourceChanged?'source-changed':!baseline?'baseline':percent===null&&metric.thresholdAbsolute===0?'zero-baseline':thresholdMet?'attention':'normal';
    const followup=(data.signalFollowups??[]).find(f=>f.metricId===metric.id&&f.observationId===latest?.id&&f.baselineId===baseline?.id);
    return {metric,latest,baseline,delta,percent,state,followup,...advice[metric.category]};
  });
}
export function meetingBrief(data:WorkspaceData,event:Pick<CalendarEvent,'id'|'date'|'title'>,projectId:string){
  const project=data.projects.find(p=>p.id===projectId);
  const decisions=(data.decisions??[]).filter(d=>d.projectId===projectId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,12);
  const promises=(data.delegations??[]).filter(d=>d.projectId===projectId&&!['verified','cancelled'].includes(d.status));
  const tasks=data.tasks.filter(t=>t.projectId===projectId&&t.status!=='done');
  const signals=operatingSignals(data,event.date).filter(s=>s.metric.projectId===projectId&&s.state==='attention'&&s.followup?.status!=='resolved'&&s.followup?.status!=='dismissed');
  const notes=data.notes.filter(n=>n.projectId===projectId).sort((a,b)=>b.updated.localeCompare(a.updated)).slice(0,5);
  const questions=[...decisions.filter(d=>d.status!=='closed'&&d.reviewDate<=event.date).map(d=>`‘${d.title}’ 결정을 유지할 근거가 충분한가요?`),...promises.filter(d=>d.checkDate<=event.date||d.due<=event.date).map(d=>`${d.assignee}: ‘${d.deliverable}’ 결과와 남은 장애물은 무엇인가요?`),...signals.map(s=>`${s.metric.name}: ${s.question}`),...tasks.filter(t=>t.blocker||t.due<=event.date).map(t=>`‘${t.title}’의 ${t.blocker?'대기 조건을 누가 해소하나요?':'완료 기준과 마감을 조정해야 하나요?'}`)].slice(0,8);
  return {project,decisions,promises,tasks,signals,notes,questions:questions.length?questions:['이번 회의에서 확정할 결과와 담당자·기한은 무엇인가요?'],record:(data.meetingRecords??[]).find(r=>r.event.id===event.id&&r.event.date===event.date)};
}

export function executiveContext(data:WorkspaceData,date:string){
 const all=operatingSignals(data,date),operating=all.sort((a,b)=>Number(b.state==='attention')-Number(a.state==='attention')).slice(0,12).map(s=>({metricId:s.metric.id,name:s.metric.name,projectId:s.metric.projectId,unit:s.metric.unit,state:s.state,latest:s.latest?{value:s.latest.value,from:s.latest.from,through:s.latest.through,source:s.latest.source.slice(0,300)}:null,baseline:s.baseline?{value:s.baseline.value,from:s.baseline.from,through:s.baseline.through}:null,delta:s.delta,percent:s.percent,question:s.question,hypothesis:s.hypothesis,followup:s.followup?{id:s.followup.id,status:s.followup.status,taskId:s.followup.taskId,delegationId:s.followup.delegationId}:null}));
 const plan=activeAllocation(data,date);
 return {weeklyAllocation:plan?{...plan,allocations:plan.allocations.map(a=>({...a,reason:a.reason.slice(0,160)}))}:null,operating,operatingOmitted:Math.max(0,all.length-operating.length),meetingResults:(data.meetingRecords??[]).slice(-6).map(r=>({id:r.id,projectId:r.projectId,event:r.event,noteId:r.noteId,noteRevision:r.noteRevision,summary:r.summary.slice(0,350),changedConditions:r.changedConditions.slice(0,350),decisionId:r.decisionId,taskIds:r.taskIds,delegationIds:r.delegationIds}))};
}
