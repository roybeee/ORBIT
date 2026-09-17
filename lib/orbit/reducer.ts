import {monthlyReport} from './phase4.ts';
import {prepareReplan,replanBasis} from './reschedule.ts';
import {planningFloor,minuteInZone} from './dates.ts';
import {careEvents,goalAllowsWork,goalIsActive} from './chief.ts';
import {allocationAllowsWork,activeAllocation,protectedEvents,weeklyCapacity,portfolioBasis,operatingSignals,meetingBrief} from './phase3.ts';
import {questReadiness,memorySignature} from './pacemaker.ts';
import { wikiMatches, wikiLinks } from './wiki/relations.ts';
import { automaticProject, normalize } from './classify.ts';
import { planFromBrief } from './brief/planning.ts';
import type { WorkspaceData, Task, Proposal, Improvement, Project } from './model.ts';
import type { WorkspaceAction } from './validation.ts';
import { todayInZone, addDays, weekDates } from './dates.ts';
import { meetingCandidates } from './meeting.ts';
import { focusIds } from './derived.ts';
import { generateProposal, approveProposalItem, overlaps, calibrationFactor } from './planner.ts';
export class DomainError extends Error {}
const fail = (message: string): never => {
  throw new DomainError(message);
};
function replace<T extends { id: string }>(list: T[], record: T) {
  return list.some((x) => x.id === record.id)
    ? list.map((x) => (x.id === record.id ? record : x))
    : [...list, record];
}
export const LIMITS = { goals: 12, improvements: 40, habits: 3, risks: 10, habitLog: 400 };
export function validateLinks(data: WorkspaceData) {
  if((data.experiments??[]).length>100||(data.contacts??[]).length>200)fail('실험 100개·사람 200개까지 보관할 수 있습니다.');
  for(const e of data.experiments??[])if(!data.projects.some(p=>p.id===e.projectId)||!data.notes.some(n=>n.id===e.noteId)||!data.tasks.some(t=>t.id===e.taskId&&t.projectId===e.projectId))fail('실험의 프로젝트·근거·업무 연결을 확인해 주세요.');
  for(const c of data.contacts??[]){for(const [ids,records] of [[c.projectIds,data.projects],[c.noteIds,data.notes],[c.decisionIds,data.decisions??[]],[c.delegationIds,data.delegations??[]],[c.eventIds,data.events]] as [string[],{id:string}[]][])if(ids.some(id=>!records.some(r=>r.id===id)))fail('사람 카드의 연결 기록을 확인해 주세요.');}

  const observations=data.metricObservations??[],replacedObservations=new Set(observations.map(o=>o.supersedesId));
  for(const o of observations){
    if(o.from>o.through)fail('운영 수치의 집계 시작·종료를 확인해 주세요.');
    const m=data.operatingMetrics?.find(m=>m.id===o.metricId);
    if(o.noteId&&!data.notes.some(n=>n.id===o.noteId&&n.projectId===m?.projectId))fail('운영 수치와 같은 프로젝트의 근거 문서를 연결해 주세요.');
    if(o.supersedesId){const old=observations.find(x=>x.id===o.supersedesId);if(!old||old.id===o.id||old.metricId!==o.metricId||old.from!==o.from||old.through!==o.through||old.recordedAt>o.recordedAt||observations.filter(x=>x.supersedesId===old.id).length>1)fail('운영 수치의 정정 이력을 확인해 주세요.');const seen=new Set([o.id]);let x=old;while(x){if(seen.has(x.id))fail('운영 수치의 정정 이력이 순환합니다.');seen.add(x.id);if(!x.supersedesId)break;const nextId=x.supersedesId;x=observations.find(v=>v.id===nextId)!;}}
    if(!replacedObservations.has(o.id)&&observations.some(x=>x.id!==o.id&&!replacedObservations.has(x.id)&&x.metricId===o.metricId&&x.from<=o.through&&x.through>=o.from))fail('같은 운영 지표에 집계 기간이 겹칩니다.');
  }
  for(const f of data.signalFollowups??[]){const projectId=data.operatingMetrics?.find(m=>m.id===f.metricId)?.projectId;if(f.taskId&&data.tasks.find(t=>t.id===f.taskId)?.projectId!==projectId||f.delegationId&&data.delegations?.find(d=>d.id===f.delegationId)?.projectId!==projectId)fail('신호와 같은 프로젝트의 후속 업무를 연결해 주세요.');}
  for(const p of data.weeklyAllocations??[]){if(weekDates(p.from)[0]!==p.from||p.id!==p.from||p.through!==addDays(p.from,6)||new Set(p.allocations.map(a=>a.projectId)).size!==p.allocations.length||p.allocations.some(a=>a.stance==='pause'&&a.minutes!==0)||p.protectedBlocks.some(b=>b.date<p.from||b.date>p.through||b.end<=b.start))fail('주간 배분의 기간·보호 시간·프로젝트를 확인해 주세요.');}
  for(const m of data.meetingRecords??[]){if(m.event.end<=m.event.start||data.notes.find(n=>n.id===m.noteId)?.projectId!==m.projectId||m.taskIds.some(id=>data.tasks.find(t=>t.id===id)?.projectId!==m.projectId)||m.delegationIds.some(id=>data.delegations?.find(d=>d.id===id)?.projectId!==m.projectId)||m.decisionId&&data.decisions?.find(d=>d.id===m.decisionId)?.projectId!==m.projectId)fail('회의 결과의 프로젝트·후속 기록 연결을 확인해 주세요.');}
  if((data.operatingMetrics??[]).length>60||(data.metricObservations??[]).length>600||(data.signalFollowups??[]).length>200||(data.meetingRecords??[]).length>100)fail('운영 기록의 보관 한도에 도달했습니다. 백업 후 기록을 정리해 주세요.');
  for(const m of data.operatingMetrics??[])if(!data.projects.some(p=>p.id===m.projectId))fail('운영 지표의 프로젝트를 확인해 주세요.');
  for(const o of data.metricObservations??[]){if(!data.operatingMetrics?.some(m=>m.id===o.metricId))fail('관측값의 지표를 확인해 주세요.');if(o.noteId&&!data.notes.some(n=>n.id===o.noteId))fail('관측값의 근거 문서를 확인해 주세요.');}
  for(const f of data.signalFollowups??[]){if(!data.operatingMetrics?.some(m=>m.id===f.metricId)||![f.observationId,f.baselineId].every(id=>data.metricObservations?.some(o=>o.id===id&&o.metricId===f.metricId)))fail('운영 신호의 비교 근거를 확인해 주세요.');if(f.taskId&&!data.tasks.some(t=>t.id===f.taskId)||f.delegationId&&!data.delegations?.some(d=>d.id===f.delegationId))fail('운영 신호의 후속 업무를 확인해 주세요.');}
  for(const p of data.weeklyAllocations??[])for(const a of p.allocations)if(!data.projects.some(p=>p.id===a.projectId))fail('주간 배분의 프로젝트를 확인해 주세요.');
  for(const m of data.meetingRecords??[]){if(!data.projects.some(p=>p.id===m.projectId)||!data.notes.some(n=>n.id===m.noteId))fail('회의의 프로젝트·원문 연결을 확인해 주세요.');if(m.taskIds.some(id=>!data.tasks.some(t=>t.id===id))||m.delegationIds.some(id=>!data.delegations?.some(d=>d.id===id))||m.decisionId&&!data.decisions?.some(d=>d.id===m.decisionId))fail('회의의 후속 기록을 확인해 주세요.');}
  if((data.memories??[]).length>60)fail('기억은 60개까지 보관합니다. 오래된 기억을 정리해 주세요.');
  if((data.decisions??[]).length>100||(data.delegations??[]).length>100)fail('의사결정과 위임 기록은 각각 100개까지 보관합니다.');
  for(const record of [...data.decisions??[],...data.delegations??[]]){
    if(!data.projects.some(p=>p.id===record.projectId))fail('장부의 프로젝트를 확인해 주세요.');
    if(record.taskId&&!data.tasks.some(t=>t.id===record.taskId&&t.projectId===record.projectId))fail('같은 프로젝트의 할 일을 연결해 주세요.');
    if(record.noteId&&!data.notes.some(n=>n.id===record.noteId))fail('장부의 원문 기록을 확인해 주세요.');
  }
  const projectIds = new Set(data.projects.map((p) => p.id));
  const taskIds = new Set(data.tasks.map((t) => t.id));
  const noteIds = new Set(data.notes.map((n) => n.id));
  const goalIds = new Set((data.goals ?? []).map((g) => g.id));
  if ((data.careRoutines ?? []).length > 12) fail('돌봄·학습 루틴은 12개까지 등록할 수 있습니다.');
  for (const r of data.careRoutines ?? []) if (r.goalId && !goalIds.has(r.goalId)) fail('루틴의 목표를 확인해 주세요.');
  for (const t of data.tasks) {
    if (!projectIds.has(t.projectId)) fail('연결할 프로젝트가 없습니다.');
    if (t.noteId && !noteIds.has(t.noteId)) fail('연결할 기록이 없습니다.');
    for (const id of t.dependsOn ?? [])
      if (id === t.id || !taskIds.has(id)) fail('선행 작업을 확인해 주세요.');
  }
  const visit = (id: string, seen: Set<string>, done: Set<string>) => {
    if (seen.has(id)) fail('선행 작업이 순환하고 있습니다.');
    if (done.has(id)) return;
    seen.add(id);
    for (const dep of data.tasks.find((t) => t.id === id)?.dependsOn ?? []) visit(dep, seen, done);
    seen.delete(id);
    done.add(id);
  };
  const done = new Set<string>();
  for (const t of data.tasks) visit(t.id, new Set(), done);
  for (const n of data.notes) if (!projectIds.has(n.projectId)) fail('기록의 프로젝트를 확인해 주세요.');
  for (const e of data.events) {
    if (e.projectId && !projectIds.has(e.projectId)) fail('일정의 프로젝트를 확인해 주세요.');
    if (e.taskId && !taskIds.has(e.taskId)) fail('일정의 할 일을 확인해 주세요.');
  }
  for (const p of data.projects)
    if (p.goalId && !goalIds.has(p.goalId)) fail('프로젝트의 목표를 확인해 주세요.');
  for (const g of data.goals ?? [])
    if (g.parentId && (g.parentId === g.id || !goalIds.has(g.parentId))) fail('상위 목표를 확인해 주세요.');
  for(const goal of data.goals??[]){const seen=new Set<string>();let node:typeof goal|undefined=goal;while(node){if(seen.has(node.id))fail('상위 목표가 순환하고 있습니다.');seen.add(node.id);node=(data.goals??[]).find(g=>g.id===node?.parentId)}}
  if (data.dominoProjectId && !projectIds.has(data.dominoProjectId)) fail('도미노 프로젝트를 확인해 주세요.');
  for (const r of data.risks ?? [])
    if (r.projectId && !projectIds.has(r.projectId)) fail('리스크의 프로젝트를 확인해 주세요.');
  const laserDates = data.tasks.filter((t) => t.laserDate).map((t) => t.laserDate!);
  if (new Set(laserDates).size !== laserDates.length) fail('하루의 Goal Laser는 하나입니다.');
  if (data.tasks.filter((t) => t.startedAt).length > 1) fail('집중 세션은 한 번에 하나만 진행합니다.');
  if ((data.goals ?? []).length > LIMITS.goals) fail(`목표는 ${LIMITS.goals}개까지 둘 수 있습니다.`);
  if ((data.habits ?? []).length > LIMITS.habits)
    fail('습관은 지킬 습관 1개와 버릴 습관 2개, 최대 3개입니다.');
  if ((data.risks ?? []).length > LIMITS.risks)
    fail(`상시 리스크는 ${LIMITS.risks}개까지 둡니다. 해결된 것을 닫아 주세요.`);
  if ((data.improvements ?? []).length > LIMITS.improvements)
    fail('지켜갈 규칙이 너무 많습니다. 오래된 규칙을 정리해 주세요.');
}
const elapsedMinutes = (startedAt: string, now: Date) =>
  Math.max(0, Math.round((now.getTime() - Date.parse(startedAt)) / 60000));
function addImprovement(data: WorkspaceData, improvement: Improvement) {
  const list = data.improvements ?? [];
  if (list.some((i) => i.rule.trim() === improvement.rule.trim() && i.active)) return;
  const next = replace(list, improvement);
  while (next.length > LIMITS.improvements) {
    const inactive = next.findIndex((i) => !i.active);
    if (inactive < 0) fail('지켜갈 규칙이 40개에 도달했습니다. 오래된 규칙을 정리해 주세요.');
    next.splice(inactive, 1);
  }
  data.improvements = next;
}
export function applyAction(
  current: WorkspaceData,
  action: WorkspaceAction,
  now = new Date(),
): WorkspaceData {
  const data = structuredClone(current);
  const today = todayInZone(data.preferences.timeZone, now);
  const createProject = (draft: Project) => {
    const byId = data.projects.find((p) => p.id === draft.id);
    if (byId && normalize(byId.name) !== normalize(draft.name)) fail('프로젝트 ID가 다른 프로젝트에서 사용 중입니다.');
    const existing = byId ?? data.projects.find((p) => normalize(p.name) === normalize(draft.name));
    if (existing) return existing.id;
    data.projects.push(structuredClone(draft));
    return draft.id;
  };
  const task = (id: string) => data.tasks.find((t) => t.id === id) ?? fail('할 일을 찾을 수 없습니다.');
  const proposal = (date: string) =>
    data.proposals.find((p) => p.date === date) ?? fail('제안을 먼저 생성해 주세요.');
  const saveProposal = (p: Proposal) => {
    data.proposals = replace(data.proposals, p);
  };
  const plannerOptions = (date: string) => ({
    earliestStart:date<today?0:planningFloor(date,data.preferences.timeZone,now),
    dominoProjectId: data.dominoProjectId,
    projectPriority: Object.fromEntries((activeAllocation(data,date)?.allocations??[]).map(a=>[a.projectId,a.stance==='focus'?50:0])),
    calibration: (t: Task) => calibrationFactor(data.tasks, t, date),
  });
  const finishSession = (t: Task) => {
    if (!t.startedAt) return;
    t.actualMinutes = (t.actualMinutes ?? 0) + elapsedMinutes(t.startedAt, now);
    delete t.startedAt;
  };
  const assertFocusRoom = (t: Task, date: string) => {
    if (
      data.tasks.filter((x) => x.id !== t.id && x.focus && x.focusDate === date && x.status !== 'done')
        .length >= data.preferences.focusLimit
    )
      fail('핵심 결과물 개수를 초과했습니다. 기존 항목을 조정해 주세요.');
  };
  switch (action.type) {
    case 'experiment.start': {
      const e=action.experiment,n=data.notes.find(n=>n.id===e.noteId);
      if(!n||(n.revision??1)!==e.noteRevision)fail('근거 원문이 변경됐습니다. 다시 확인해 주세요.');
      if(e.from>e.through||e.through<today||e.baseline===e.target)fail('실험 기간과 성공 기준을 확인해 주세요.');
      if(e.direction==='up'?e.target<e.baseline:e.target>e.baseline)fail('목표와 개선 방향이 다릅니다.');
      if(data.experiments?.some(x=>x.id===e.id)||data.tasks.some(t=>t.id==='experiment:'+e.id))fail('이미 등록된 실험입니다.');
      const taskId='experiment:'+e.id;
      data.tasks.push({id:taskId,title:e.title,projectId:e.projectId,status:'todo',duration:e.minutes,due:e.through,impact:3,focus:false,definition:e.action+'\n성공 기준: '+e.metric+' '+e.target+' '+e.unit,noteId:e.noteId});
      data.experiments=[...data.experiments??[],{...e,taskId,status:'active',createdAt:now.toISOString()}];break;
    }
    case 'experiment.finish': {
      const e=data.experiments?.find(e=>e.id===action.id)??fail('실험을 찾을 수 없습니다.');
      if(e.status!=='active'||today<e.from)fail('진행 중인 실험만 결과를 기록할 수 있습니다.');
      e.result={value:action.value,evidence:action.evidence,conclusion:action.conclusion,at:now.toISOString(),met:e.direction==='up'?action.value>=e.target:action.value<=e.target};e.status='completed';break;
    }
    case 'experiment.stop': {const e=data.experiments?.find(e=>e.id===action.id)??fail('실험을 찾을 수 없습니다.');if(e.status!=='active')fail('진행 중인 실험만 중단할 수 있습니다.');e.status='stopped';break;}
    case 'contact.upsert':data.contacts=replace(data.contacts??[],{...action.contact,updatedAt:now.toISOString()});break;
    case 'contact.delete':data.contacts=(data.contacts??[]).filter(c=>c.id!==action.id);break;
    case 'monthly.generate': {
      if(action.month>=today.slice(0,7))fail('완료된 월의 보고서를 생성해 주세요.');
      if(!data.monthlyReports?.some(r=>r.id===action.month))data.monthlyReports=[...data.monthlyReports??[],monthlyReport(data,action.month,now)].slice(-24);break;
    }
    case 'monthly.decide': {const r=data.monthlyReports?.find(r=>r.id===action.month)?.recommendations.find(r=>r.id===action.id)??fail('개선 제안을 찾을 수 없습니다.');r.status=action.status;break;}
    case 'monthly.review': {const r=data.monthlyReports?.find(r=>r.id===action.month)?.recommendations.find(r=>r.id===action.id)??fail('개선 제안을 찾을 수 없습니다.');if(r.status!=='adopted'||today.slice(0,7)<=action.month)fail('채택한 개선의 다음 달 결과를 기록해 주세요.');r.review={date:today,value:action.value,note:action.note};break;}

    case 'portfolio.approve': {
      const from=weekDates(action.week)[0],through=addDays(from,6);
      if(through<today||from>addDays(today,90))fail('이번 주부터 90일 이내의 주를 선택해 주세요.');
      if(action.basis!==portfolioBasis(data,action.week))fail('업무·일정이 바뀌었습니다. 배분안을 다시 계산한 뒤 승인해 주세요.');
      if(new Set(action.allocations.map(a=>a.projectId)).size!==action.allocations.length||action.allocations.length!==data.projects.length)fail('모든 프로젝트를 한 번씩 배분해 주세요.');
      for(const a of action.allocations){if(!data.projects.some(p=>p.id===a.projectId))fail('배분할 프로젝트가 없습니다.');if(a.stance==='pause'&&a.minutes>0)fail('보류한 프로젝트의 추가 투입 시간은 0분으로 설정해 주세요.');}
      if(new Set(action.protectedBlocks.map(b=>b.id)).size!==action.protectedBlocks.length)fail('보호 시간 번호가 중복되었습니다.');
      for(const b of action.protectedBlocks){if(b.date<from||b.date>through)fail('보호 시간은 선택한 주 안에 있어야 합니다.');if(data.events.some(e=>e.date===b.date&&e.kind!=='break'&&overlaps(e,b))||data.proposals.some(p=>p.date===b.date&&p.items.some(i=>i.state==='approved'&&overlaps(i,b))))fail('보호 시간이 기존 일정과 겹칩니다. 일정을 먼저 조정해 주세요.');}
      const capacity=weeklyCapacity(data,from,action.protectedBlocks,now);
      if(action.allocations.reduce((n,a)=>n+a.minutes,0)>capacity.budget)fail('남은 가용 시간을 넘었습니다. 배분안을 다시 계산하거나 시간을 줄여 주세요.');
      data.weeklyAllocations=replace(data.weeklyAllocations??[],{id:from,from,through,approvedAt:now.toISOString(),active:true,capacityAtApproval:capacity.budget,allocations:action.allocations,protectedBlocks:action.protectedBlocks}).sort((a,b)=>a.from.localeCompare(b.from)).slice(-12);break;
    }
    case 'portfolio.release':data.weeklyAllocations=(data.weeklyAllocations??[]).map(p=>p.id===action.id?{...p,active:false}:p);break;
    case 'metric.upsert': {
      if(action.metric.collector&&!['원','KRW'].includes(action.metric.unit))fail('ODA 정산 자동 수집의 단위는 원 또는 KRW로 지정하세요.');
      const old=data.operatingMetrics?.find(m=>m.id===action.metric.id);
      if(old?.collector&&data.metricObservations?.some(o=>o.metricId===old.id)&&['provider','storeId','field'].some(k=>old.collector![k as 'provider']!==action.metric.collector?.[k as 'provider']))fail('수치가 저장된 ODA 지표의 매장·항목은 변경할 수 없습니다. 새 지표를 만들거나 기존 수집을 일시 중지하세요.');
      if(old&&data.metricObservations?.some(o=>o.metricId===old.id)&&['projectId','unit','category','badDirection'].some(k=>old[k as keyof typeof old]!==action.metric[k as keyof typeof action.metric]))fail('값이 기록된 지표의 프로젝트·단위·구분·방향은 바꿀 수 없습니다. 별도 지표를 만드세요.');
      data.operatingMetrics=replace(data.operatingMetrics??[],{...action.metric,updatedAt:now.toISOString()});break;
    }
    case 'metric.observe': {
      const o=action.observation,m=data.operatingMetrics?.find(m=>m.id===o.metricId)??fail('지표를 먼저 등록해 주세요.');
      if(o.from>o.through||o.through>today)fail('집계 기간과 오늘까지의 확정 수치를 입력해 주세요.');
      const old=o.supersedesId?data.metricObservations?.find(x=>x.id===o.supersedesId):undefined;
      if(o.supersedesId&&(!old||old.metricId!==o.metricId||old.from!==o.from||old.through!==o.through||data.metricObservations?.some(x=>x.supersedesId===old.id)))fail('정정할 수치가 바뀌었습니다. 같은 지표·기간의 최신 기록을 선택하세요.');
      const replaced=new Set((data.metricObservations??[]).map(x=>x.supersedesId));
      if(data.metricObservations?.some(x=>x.id===o.id||!replaced.has(x.id)&&x.id!==o.supersedesId&&x.metricId===o.metricId&&x.from<=o.through&&x.through>=o.from))fail('같은 지표에 겹치는 집계 기간이 있습니다. 기간을 확인해 주세요.');
      if(o.noteId&&!data.notes.some(n=>n.id===o.noteId&&n.projectId===m.projectId&&(n.revision??1)===o.noteRevision))fail('같은 프로젝트의 최신 원문을 연결해 주세요.');
      data.metricObservations=[...data.metricObservations??[],{...o,recordedAt:now.toISOString()}];break;
    }
    case 'signal.followup': {
      const signal=operatingSignals(data,today).find(s=>s.metric.id===action.metricId&&s.latest?.id===action.observationId&&s.baseline?.id===action.baselineId)??fail('신호를 찾을 수 없습니다.');
      if(signal.state!=='attention')fail('신호의 근거가 바뀌었습니다. 최신 비교를 확인해 주세요.');
      if(signal.followup)fail('이 변화에 대한 후속 업무가 이미 등록되어 있습니다.');
      if(action.due<today)fail('확인 기한은 오늘 이후로 지정해 주세요.');
      const at=now.toISOString(),r={id:action.id,metricId:action.metricId,observationId:action.observationId,baselineId:action.baselineId,question:action.question,status:'open' as const,resolution:'',createdAt:at,updatedAt:at};
      if(data.tasks.some(t=>t.id===action.id)||data.delegations?.some(d=>d.id===action.id)||data.signalFollowups?.some(f=>f.id===action.id))fail('이미 사용한 기록 번호입니다.');
      const evidence=`${signal.metric.name}: ${signal.baseline!.value} → ${signal.latest!.value} ${signal.metric.unit}. ${signal.latest!.source}`;
      if(action.assignee){data.delegations=[...data.delegations??[],{id:action.id,title:action.title,projectId:signal.metric.projectId,assignee:action.assignee,deliverable:action.question,due:action.due,checkDate:action.due,status:'requested',update:evidence.slice(0,2000),evidence:'',createdAt:at,updatedAt:at,history:[{at,status:'requested',update:evidence.slice(0,2000),evidence:'',assignee:action.assignee,due:action.due,checkDate:action.due}]}];data.signalFollowups=[...data.signalFollowups??[],{...r,delegationId:action.id}];}
      else{data.tasks.push({id:action.id,title:action.title,projectId:signal.metric.projectId,status:'todo',duration:30,due:action.due,impact:4,focus:false,definition:action.question+'\n근거: '+evidence});data.signalFollowups=[...data.signalFollowups??[],{...r,taskId:action.id}];}break;
    }
    case 'signal.resolve': {
      const old=data.signalFollowups?.find(f=>f.id===action.id)??fail('등록한 후속 확인을 찾을 수 없습니다.');
      data.signalFollowups=replace(data.signalFollowups??[],{...old,status:action.status,resolution:action.resolution,updatedAt:now.toISOString()});break;
    }
    case 'meeting.finish': {
      const e=data.events.find(e=>e.id===action.event.id&&e.kind==='meeting')??fail('회의 일정을 찾을 수 없습니다.');
      if(['title','date','start','end'].some(k=>e[k as keyof typeof e]!==action.event[k as keyof typeof action.event]))fail('회의 일정이 변경됐습니다. 최신 일정을 확인해 주세요.');
      if(e.projectId&&e.projectId!==action.projectId)fail('회의 일정과 같은 프로젝트를 선택해 주세요.');
      if(e.date>today)fail('미래 회의는 결과 확정 후 기록해 주세요.');
      if(data.meetingRecords?.some(r=>r.id===action.id||r.event.id===e.id&&r.event.date===e.date))fail('이 회의의 결과가 이미 반영되었습니다. 연결된 기록에서 후속 내용을 수정하세요.');
      const at=now.toISOString(),brief=meetingBrief(data,e,action.projectId),noteId=action.id,taskIds:string[]=[],delegationIds:string[]=[];
      if(data.notes.some(n=>n.id===noteId))fail('이미 사용한 문서 번호입니다.');
      const body=`# ${e.title}\n\n## 확인한 결과\n${action.summary}\n\n## 바뀐 조건\n${action.changedConditions||'별도 기록 없음'}\n\n## 회의 원문\n${action.body}\n\n## 승인한 후속 행동\n${action.actions.map(a=>`${a.assignee||'나'} · ${a.title} · ${a.due}`).join('\n')}`;
      data.notes.push({id:noteId,title:(e.title+' · 회의 결과').slice(0,160),kind:'meeting',projectId:action.projectId,summary:action.summary.slice(0,500),body,tags:['회의 결과','3차 브리핑'],updated:today,revision:1,bodyStored:false});
      let decisionId:string|undefined;
      if(action.decision){decisionId='decision:'+action.id;const d=action.decision;if(data.decisions?.some(r=>r.id===decisionId))fail('이미 사용한 결정 번호입니다.');data.decisions=[...data.decisions??[],{id:decisionId,title:(e.title+' · 결정').slice(0,160),projectId:action.projectId,choice:d.choice,rationale:d.rationale,alternatives:'',reviewDate:d.reviewDate,status:'active',outcome:'',noteId,noteRevision:1,createdAt:at,updatedAt:at,history:[{at,choice:d.choice,rationale:d.rationale,alternatives:'',status:'active',outcome:''}]}];}
      for(const [i,a] of action.actions.entries()){
        const id='meeting:'+action.id+':'+i;if(data.tasks.some(t=>t.id===id)||data.delegations?.some(d=>d.id===id))fail('이미 사용한 후속 업무 번호입니다.');
        if(a.due<e.date)fail('후속 업무 기한은 회의 날짜 이후로 지정해 주세요.');
        if(a.assignee){delegationIds.push(id);data.delegations=[...data.delegations??[],{id,title:a.title,projectId:action.projectId,assignee:a.assignee,deliverable:a.title,due:a.due,checkDate:a.due,status:'requested',update:'회의 결과 검토 후 등록',evidence:'',noteId,noteRevision:1,createdAt:at,updatedAt:at,history:[{at,status:'requested',update:'회의 결과 검토 후 등록',evidence:'',assignee:a.assignee,due:a.due,checkDate:a.due}]}];}
        else{taskIds.push(id);data.tasks.push({id,title:a.title,projectId:action.projectId,status:'todo',duration:a.minutes,due:a.due,impact:3,focus:false,definition:a.title,noteId});}
      }
      data.meetingRecords=[...data.meetingRecords??[],{id:action.id,projectId:action.projectId,event:action.event,noteId,noteRevision:1,summary:action.summary,changedConditions:action.changedConditions,priorDecisions:brief.decisions.map(d=>({id:d.id,title:d.title,choice:d.choice,updatedAt:d.updatedAt})),decisionId,decisionSnapshot:action.decision?{choice:action.decision.choice,rationale:action.decision.rationale}:undefined,taskIds,delegationIds,createdAt:at}];break;
    }
    case 'decision.upsert': {
      const r=action.record,old=data.decisions?.find(d=>d.id===r.id);
      if(action.expectedUpdatedAt&&old?.updatedAt!==action.expectedUpdatedAt)fail('결정이 변경됐습니다. 최신 기록을 열고 다시 작성해 주세요.');
      if(r.noteId&&(!data.notes.some(n=>n.id===r.noteId&&(n.revision??1)===r.noteRevision)))fail('원문이 변경됐습니다. 최신 기록을 확인하고 다시 연결해 주세요.');
      if(r.status==='closed'&&!r.outcome.trim())fail('결정의 결과를 기록한 뒤 검토를 완료해 주세요.');
      if((old?.history.length??0)>=30)fail('변경 이력이 30개입니다. 새 결정으로 후속 기록을 남겨 주세요.');
      const at=now.toISOString();data.decisions=replace(data.decisions??[],{...r,createdAt:old?.createdAt??at,updatedAt:at,history:[...old?.history??[],{at,choice:r.choice,rationale:r.rationale,alternatives:r.alternatives,status:r.status,outcome:r.outcome}]});break;
    }
    case 'delegation.upsert': {
      const r=action.record,old=data.delegations?.find(d=>d.id===r.id);
      if(action.expectedUpdatedAt&&old?.updatedAt!==action.expectedUpdatedAt)fail('위임 기록이 변경됐습니다. 최신 기록을 열고 다시 작성해 주세요.');
      if(r.noteId&&!data.notes.some(n=>n.id===r.noteId&&(n.revision??1)===r.noteRevision))fail('원문이 변경됐습니다. 최신 기록을 확인하고 다시 연결해 주세요.');
      if(['delivered','verified'].includes(r.status)&&!r.evidence.trim())fail('받은 결과물이나 확인 근거를 기록해 주세요.');
      if(r.status==='verified'&&old?.status!=='delivered'&&old?.status!=='verified')fail('결과물을 받은 상태로 저장한 뒤 검토를 완료해 주세요.');
      if((old?.history.length??0)>=30)fail('변경 이력이 30개입니다. 새 위임으로 후속 기록을 남겨 주세요.');
      const at=now.toISOString();data.delegations=replace(data.delegations??[],{...r,createdAt:old?.createdAt??at,updatedAt:at,history:[...old?.history??[],{at,status:r.status,update:r.update,evidence:r.evidence,assignee:r.assignee,due:r.due,checkDate:r.checkDate}]});
      if(r.taskId&&['requested','accepted','working','blocked'].includes(r.status)){const linked=task(r.taskId);if(linked.status!=='done'){finishSession(linked);linked.status='waiting';linked.focus=false;delete linked.focusDate;linked.blocker='위임: '+r.assignee+' · '+r.deliverable.slice(0,1500);linked.checkDate=r.checkDate;}}
      break;
    }
    case 'memory.upsert': {
      const m={...action.memory,sources:action.memory.sources.map(s=>s.kind==='note'?{...s,revision:s.revision??data.notes.find(n=>n.id===s.id)?.revision??1}:s)};
      if(m.sources.some(s=>s.kind==='note'&&data.notes.find(n=>n.id===s.id)?.tags.includes('사주'))&&(m.kind!=='reflection'||m.origin!=='saju'))fail('사주 해석 자료는 사주·자기 탐색으로 구분해 보관해 주세요.');
      if(m.origin==='saju'&&m.kind!=='reflection')fail('사주 자료는 자기 탐색으로 보관합니다.');
      if(m.origin==='records'&&!m.sources.length)fail('근거 기록을 연결해 주세요.');
      for(const s of m.sources){const exists=s.kind==='note'?data.notes.some(n=>n.id===s.id&&(s.revision===undefined||(n.revision??1)===s.revision)):s.kind==='task'?data.tasks.some(t=>t.id===s.id):data.reviews.some(r=>r.date===s.id);if(!exists)fail('근거 기록이 변경되었거나 없습니다. 다시 확인해 주세요.');}
      const old=data.memories?.find(x=>x.id===m.id);
      data.memories=replace(data.memories??[],{...m,sources:m.sources.map(s=>({...s,signature:memorySignature(data,s)})),confirmedOn:old?.confirmedOn??today,updatedOn:today});
      break;
    }
    case 'memory.delete':
      data.memories=(data.memories??[]).filter(m=>m.id!==action.id);
      break;
    case 'quest.plan': {
      const goal=data.goals?.find(g=>g.id===action.goalId)??fail('목표를 먼저 등록해 주세요.');
      if(!goalIsActive(data,goal.id))fail('진행 중인 목표에 퀘스트를 추가해 주세요.');
      let createdId:string|undefined;
      if(action.project){if(action.project.goalId!==goal.id)fail('프로젝트의 목표 연결을 확인해 주세요.');if(!action.tasks.some(t=>t.projectId===action.project!.id))fail('연결할 퀘스트가 없는 새 프로젝트입니다.');createdId=createProject(action.project)}
      if(new Set(action.tasks.map(t=>t.id)).size!==action.tasks.length)fail('퀘스트 번호가 중복되었습니다.');
      for(const item of action.tasks){const draft={...item,projectId:action.project&&item.projectId===action.project.id?createdId!:item.projectId};if(data.tasks.some(t=>t.id===draft.id))fail('이미 등록된 퀘스트입니다. 기존 기록을 덮어쓸 수 없습니다.');if(data.projects.find(p=>p.id===draft.projectId)?.goalId!==goal.id)fail('선택한 목표의 프로젝트에 퀘스트를 연결해 주세요.');if(!draft.definition.trim())fail('각 퀘스트의 완료 조건을 입력해 주세요.');data.tasks.push({...draft,status:'todo',focus:false});}
      break;
    }
    case 'chief.settings':
      data.chief = { ...data.chief, settings: action.settings };
      break;
    case 'chief.checkin': {
      const checkins = (data.chief?.checkins ?? []).filter(c => c.date !== today);
      checkins.push({ date: today, energy: action.energy, strain: action.strain, note: action.note, updatedAt: now.toISOString() });
      data.chief = { ...data.chief, checkins: checkins.sort((a,b) => a.date.localeCompare(b.date)).slice(-90) };
      break;
    }
    case 'chief.respond': {
      if(action.kind==='blocked' && /^(task|followup):/.test(action.key)) {
        const id=action.key.replace(/^(task|followup):/,'');
        const blocked=task(id);
        if(blocked.status==='done') fail('이미 완료된 할 일입니다.');
        if(!action.reason.trim()) fail('막힌 이유를 알려주세요.');
        finishSession(blocked); blocked.status='waiting'; blocked.blocker=action.reason; blocked.checkDate=today;
      }
      const responses = (data.chief?.responses ?? []).filter(r => r.key !== action.key && Date.parse(r.until) > now.getTime());
      responses.push({ key: action.key, kind: action.kind, reason: action.reason, at: now.toISOString(), until: new Date(now.getTime() + action.minutes * 60000).toISOString() });
      data.chief = { ...data.chief, responses: responses.slice(-100) };
      break;
    }
    case 'care.upsert':
      data.careRoutines = replace(data.careRoutines ?? [], { ...action.routine, log: data.careRoutines?.find(r => r.id === action.routine.id)?.log ?? [] });
      break;
    case 'care.delete':
      data.careRoutines = data.careRoutines?.filter(r => r.id !== action.id);
      break;
    case 'care.check': {
      const routine = data.careRoutines?.find(r => r.id === action.id) ?? fail('루틴을 찾을 수 없습니다.');
      routine.log = routine.log.filter(d => d !== today);
      if (action.checked) routine.log.push(today);
      routine.log = routine.log.sort().slice(-400);
      break;
    }
    case 'project.upsert':
      data.projects = replace(data.projects, action.project);
      break;
    case 'project.delete':
      if (
        data.tasks.some((t) => t.projectId === action.id) ||
        data.notes.some((n) => n.projectId === action.id) ||
        data.events.some((e) => e.projectId === action.id)
      )
        fail('연결된 할 일·기록·일정을 먼저 정리해 주세요.');
      data.projects = data.projects.filter((p) => p.id !== action.id);
      if (data.dominoProjectId === action.id) delete data.dominoProjectId;
      data.risks = (data.risks ?? []).map((r) =>
        r.projectId === action.id ? { ...r, projectId: undefined } : r,
      );
      break;
    case 'project.domino':
      if (action.id === null) delete data.dominoProjectId;
      else {
        if (!data.projects.some((p) => p.id === action.id)) fail('도미노로 지정할 프로젝트가 없습니다.');
        data.dominoProjectId = action.id;
      }
      break;
    case 'goal.upsert':
      data.goals = replace(data.goals ?? [], { ...data.goals?.find(g => g.id === action.goal.id), ...action.goal });
      for (const field of action.clearFields ?? []) delete data.goals.find(g => g.id === action.goal.id)![field];
      break;
    case 'goal.delete':
      if (
        data.projects.some((p) => p.goalId === action.id) ||
        data.careRoutines?.some(r => r.goalId === action.id) ||
        (data.goals ?? []).some((g) => g.parentId === action.id)
      )
        fail('이 목표에 연결된 프로젝트나 하위 목표를 먼저 정리해 주세요.');
      data.goals = (data.goals ?? []).filter((g) => g.id !== action.id);
      break;
    case 'task.upsert': {
      const t = { ...action.task };
      const old = data.tasks.find((x) => x.id === t.id);
      if (action.project) {
        if (action.project.id !== t.projectId) fail('새 프로젝트와 할 일의 연결을 확인해 주세요.');
        t.projectId = createProject(action.project);
      }
      if (!old && action.autoAssign && !action.project) {
        t.projectId = automaticProject(`${t.title} ${t.definition}`, data.projects, data.tasks, data.notes)?.projectId ?? t.projectId;
      }
      t.noteCitation = old?.noteId === t.noteId ? old?.noteCitation : undefined;
      // Execution history survives edits that omit it (agent proposals send full records).
      for (const key of [
        'actualMinutes',
        'outcome',
        'outcomeReason',
        'outcomeOn',
        'startedAt',
        'laserDate',
        'unplanned',
      ] as const)
        if (t[key] === undefined && old?.[key] !== undefined) (t as Record<string, unknown>)[key] = old[key];
      if (
        !old &&
        t.due === today &&
        data.proposals.some((p) => p.date === today) &&
        t.unplanned === undefined
      )
        t.unplanned = true;
      if (t.focus) {
        t.focusDate = t.focusDate ?? today;
        assertFocusRoom(t, t.focusDate);
      }
      if (t.status === 'done') t.completedOn = t.completedOn ?? today;
      data.tasks = replace(data.tasks, t);
      for (const e of data.events.filter((e) => e.taskId === t.id)) {
        e.title = t.title;
        e.projectId = t.projectId;
      }
      break;
    }
    case 'task.status': {
      const t = task(action.id);
      t.status = action.status;
      t.completedOn = action.status === 'done' ? today : undefined;
      if (action.status === 'done') finishSession(t);
      if (action.status !== 'done') delete t.outcome;
      if (action.status === 'doing' || action.status === 'todo') { delete t.blocker; delete t.checkDate; }
      break;
    }
    case 'task.focus': {
      const t = task(action.id);
      if (action.focus) assertFocusRoom(t, today);
      if (action.focus && t.planHoldUntil && t.planHoldUntil > today)
        fail('아직 보류 중인 업무입니다. 제안 화면에서 먼저 다시 검토해 주세요.');
      t.focus = action.focus;
      t.focusDate = action.focus ? today : undefined;
      break;
    }
    case 'task.laser': {
      const t = task(action.id);
      if (action.laser) {
        if (t.status === 'done') fail('완료한 일은 Goal Laser로 지정할 수 없습니다.');
        const other = data.tasks.find((x) => x.id !== t.id && x.laserDate === action.date);
        if (other) fail(`${action.date}의 Goal Laser는 이미 "${other.title}"입니다. 하루에 하나만 둡니다.`);
        if (!(t.focus && t.focusDate === action.date)) assertFocusRoom(t, action.date);
        t.laserDate = action.date;
        t.focus = true;
        t.focusDate = action.date;
      } else if (t.laserDate === action.date) delete t.laserDate;
      break;
    }
    case 'task.assign': {
      const targets = new Map<string, string>();
      for (const draft of action.projects ?? []) {
        if (!action.assignments.some((a) => a.projectId === draft.id)) fail('연결할 할 일이 없는 새 프로젝트입니다.');
        targets.set(draft.id, createProject(draft));
      }
      for (const { id, projectId: proposedId } of action.assignments) {
        const projectId = targets.get(proposedId) ?? proposedId;
        const t = task(id);
        if (!data.projects.some((p) => p.id === projectId)) fail('옮길 프로젝트를 찾을 수 없습니다.');
        t.projectId = projectId;
        for (const e of data.events.filter((e) => e.taskId === t.id)) e.projectId = projectId;
      }
      break;
    }
    case 'task.start': {
      const t = task(action.id);
      const readiness=questReadiness(data,t,today);
      if(!readiness.canStart)fail(readiness.reason);
      if (t.status === 'done') fail('완료한 일은 다시 시작할 수 없습니다. 상태를 먼저 바꿔 주세요.');
      const running = data.tasks.find((x) => x.id !== t.id && x.startedAt);
      if (running) fail(`"${running.title}" 집중 세션이 진행 중입니다. 먼저 끝내 주세요.`);
      if (!t.startedAt) t.startedAt = now.toISOString();
      if (t.status === 'todo') t.status = 'doing';
      break;
    }
    case 'task.stop': {
      const t = task(action.id);
      if (!t.startedAt) fail('진행 중인 집중 세션이 없습니다.');
      finishSession(t);
      break;
    }
    case 'task.record': {
      const t = task(action.id);
      finishSession(t);
      if (action.actualMinutes !== undefined) t.actualMinutes = action.actualMinutes;
      t.outcomeEstimateMinutes = t.duration;
      t.outcome = action.outcome;
      t.outcomeOn = today;
      if (action.outcome === 'done') {
        t.status = 'done';
        t.completedOn = t.completedOn ?? today;
        delete t.outcomeReason;
      } else {
        t.outcomeReason = action.reason ?? 'other';
        if (action.outcome === 'partial' && t.status === 'todo') t.status = 'doing';
      }
      if (action.rule?.trim())
        addImprovement(data, {
          id: `rule:${t.id}:${today}`,
          rule: action.rule.trim(),
          kind: action.ruleKind ?? 'other',
          createdOn: today,
          active: true,
          source: t.title.slice(0, 60),
        });
      break;
    }
    case 'task.delete':
      if (data.tasks.some((t) => t.dependsOn?.includes(action.id)))
        fail('다른 업무의 선행 작업입니다. 연결을 먼저 해제해 주세요.');
      data.tasks = data.tasks.filter((t) => t.id !== action.id);
      data.events = data.events.filter((e) => e.taskId !== action.id);
      for (const p of data.proposals) {
        p.items = p.items.filter((i) => i.taskId !== action.id);
        p.unscheduled = p.unscheduled.filter((id) => id !== action.id);
        if (p.delegate) p.delegate = p.delegate.filter((id) => id !== action.id);
        if (p.laser?.taskId === action.id)
          p.laser = {
            status: 'none',
            minutes: 0,
            note: '삭제된 할 일이었습니다. 제안을 다시 생성해 주세요.',
          };
      }
      break;
    case 'wiki.import': {
      const projectId=createProject(action.project);
      for (const note of action.notes) {
        if (data.notes.some(n=>n.id===note.id)) continue;
        data.notes.push({...note,projectId,revision:1,bodyStored:false});
      }
      break;
    }
    case 'note.upsert':
      data.notes = replace(data.notes, {
        ...action.note,
        wiki: action.note.wiki ?? data.notes.find(n=>n.id===action.note.id)?.wiki,
        source: action.note.source ?? data.notes.find(n=>n.id===action.note.id)?.source,
        updated: today,
        revision:
          (data.notes.find((n) => n.id === action.note.id)?.revision ??
            (data.notes.some((n) => n.id === action.note.id) ? 1 : 0)) + 1,
        bodyStored: false,
      });
      {
        const saved=data.notes.find(n=>n.id===action.note.id)!;
        saved.wikiMentionIds=wikiMatches(`${saved.title} ${saved.summary} ${saved.body} ${saved.tags.join(' ')}`,data.notes).filter(id=>id!==saved.id);
        if(saved.wiki)saved.wiki={...saved.wiki,links:wikiLinks({...saved,wiki:{...saved.wiki,links:[]}},data.notes)};
      }
      break;
    case 'note.restore':
      fail('이전 내용은 서버에서 확인한 뒤 복원해 주세요.');
      break;
    case 'meeting.acceptActions': {
      const note = data.notes.find((n) => n.id === action.noteId) ?? fail('회의록을 찾을 수 없습니다.');
      if ((note.revision ?? 1) !== action.expectedNoteRevision)
        fail('회의록이 변경됐습니다. 최신 내용을 확인해 주세요.');
      const candidates = meetingCandidates(note);
      for (const item of action.items) {
        const source =
          candidates.find((c) => c.line === item.line) ?? fail('원문에서 해당 행동을 확인할 수 없습니다.');
        if (
          data.tasks.some(
            (t) =>
              t.noteId === note.id &&
              t.noteCitation &&
              (t.noteCitation.quote === source.quote ||
                (t.noteCitation.revision === action.expectedNoteRevision &&
                  t.noteCitation.line === item.line)),
          )
        )
          continue;
        if (data.tasks.some((t) => t.id === item.id)) fail('이미 사용 중인 할 일 번호입니다.');
        data.tasks.push({
          id: item.id,
          title: item.title,
          projectId: note.projectId,
          status: 'todo',
          duration: item.duration,
          due: item.due,
          impact: 3,
          focus: false,
          definition: item.definition,
          noteId: note.id,
          noteCitation: { revision: action.expectedNoteRevision, line: item.line, quote: source.quote },
        });
      }
      break;
    }
    case 'note.delete':
      if (data.tasks.some((t) => t.noteId === action.id))
        fail('이 기록을 참조하는 할 일이 있습니다. 연결을 먼저 해제해 주세요.');
      data.notes = data.notes.filter((n) => n.id !== action.id);
      break;
    case 'event.upsert': {
      const e = action.event;
      if (e.id.startsWith('google:')) fail('Google 일정은 원본 캘린더에서 수정해 주세요.');
      if (e.id.startsWith('approved:')) fail('승인한 집중 시간은 제안 화면에서 조정해 주세요.');
      if (data.events.some((x) => x.id !== e.id && x.date === e.date && overlaps(x, e)))
        fail('같은 시간에 다른 일정이 있습니다.');
      data.events = replace(data.events, e);
      break;
    }
    case 'event.attach': {
      if (!data.events.some((e) => e.id === action.id)) fail('첨부할 일정을 찾을 수 없습니다.');
      break;
    }
    case 'event.delete': {
      if (action.id.startsWith('google:')) fail('Google 일정은 원본 캘린더에서 삭제해 주세요.');
      if (action.id.startsWith('approved:')) fail('집중 시간은 제안 화면에서 승인을 취소해 주세요.');
      data.events = data.events.filter((e) => e.id !== action.id);
      break;
    }
    case 'review.save':
    case 'review.saveGenerate': {
      if (action.review.date > today) fail('미래 날짜의 회고는 아직 기록할 수 없습니다.');
      const detail = action.detail;
      if (detail && detail.date !== action.review.date) fail('회고 상세의 날짜가 다릅니다.');
      let stats: NonNullable<WorkspaceData['reviews'][number]['stats']> | undefined;
      if (detail) {
        for (const item of detail.items) {
          const t = data.tasks.find((x) => x.id === item.taskId);
          if (!t) continue;
          finishSession(t);
          if (item.actualMinutes !== undefined) t.actualMinutes = item.actualMinutes;
          t.outcome = item.outcome;
          t.outcomeOn = action.review.date;
          if (item.outcome === 'done') {
            if (t.status !== 'done') {
              t.status = 'done';
              t.completedOn = action.review.date;
            }
            delete t.outcomeReason;
          } else {
            t.outcomeReason = item.reason ?? 'other';
            if (item.outcome === 'partial' && t.status === 'todo') t.status = 'doing';
          }
        }
        for (const fb of detail.feedback)
          if (fb.rule.trim())
            addImprovement(data, {
              id: `rule:${action.review.date}:${fb.taskId ?? 'day'}:${(data.improvements ?? []).length}`,
              rule: fb.rule.trim(),
              kind: fb.kind ?? 'other',
              createdOn: action.review.date,
              active: true,
              source: fb.taskId
                ? data.tasks.find((t) => t.id === fb.taskId)?.title.slice(0, 60)
                : '저녁 회고',
            });
        for (const habitId of detail.habitChecks) {
          const habit = (data.habits ?? []).find((h) => h.id === habitId);
          if (habit && !habit.log.includes(action.review.date)) {
            habit.log = [...habit.log, action.review.date].sort().slice(-LIMITS.habitLog);
          }
        }
        const laserId = data.tasks.find((t) => t.laserDate === action.review.date)?.id;
        const laserItem = detail.items.find((i) => i.taskId === laserId);
        const done = detail.items.filter((i) => i.outcome === 'done').length;
        stats = {
          planned: detail.items.length,
          done,
          partial: detail.items.filter((i) => i.outcome === 'partial').length,
          skipped: detail.items.filter((i) => i.outcome === 'skipped').length,
          laserMinutes:
            laserItem?.actualMinutes ?? (laserItem?.outcome === 'done' ? laserItem.estimateMinutes : 0),
          executionRate: detail.items.length ? Math.round((done / detail.items.length) * 100) : 0,
        };
      }
      data.reviews = replace(data.reviews, {
        ...action.review,
        id: action.review.date,
        completedIds: data.tasks
          .filter((t) => t.completedOn === action.review.date && t.status === 'done')
          .map((t) => t.id),
        updatedAt: now.toISOString(),
        ...(stats ? { stats } : {}),
        ...(detail ? { habitChecks: detail.habitChecks, hasDetail: true } : {}),
        ...(detail?.smallWins[0] ? { highlight: detail.smallWins[0] } : {}),
      });
      if (action.type === 'review.save') break;
      const date = addDays(action.review.date, 1);
      saveProposal(
        generateProposal(
          data.tasks.filter(t=>t.status==='done'||goalAllowsWork(data,t.projectId)&&allocationAllowsWork(data,t.projectId,date)),
          [...data.events,...careEvents(data,date),...protectedEvents(data,date)],
          date,
          action.review.energy,
          data.proposals.find((p) => p.date === date),
          data.preferences,
          plannerOptions(date),
        ),
      );
      break;
    }
    case 'proposal.brief':
      saveProposal(planFromBrief(data, action.brief, action.energy,now));
      break;
    case 'proposal.replan.prepare': {
      const p=proposal(action.date);if(p.date<today)fail('지난 날짜는 자동 재배치할 수 없습니다.');
      p.replan=prepareReplan(data,action.date,now);break;
    }
    case 'proposal.replan.apply': {
      const p=proposal(action.date);if(p.date<today)fail('지난 날짜는 자동 재배치할 수 없습니다.');if(!p.replan||p.replan.basis!==action.basis||action.basis!==replanBasis(data,action.date,now))fail('일정이나 시각이 바뀌었습니다. 대안을 다시 계산해 주세요.');
      const next=prepareReplan(data,action.date,now).alternatives[action.choice];
      saveProposal(next);break;
    }
    case 'proposal.generate':
      saveProposal(
        generateProposal(
          data.tasks.filter(t=>t.status==='done'||goalAllowsWork(data,t.projectId)&&allocationAllowsWork(data,t.projectId,action.date)),
          [...data.events,...careEvents(data,action.date),...protectedEvents(data,action.date)],
          action.date,
          action.energy,
          data.proposals.find((p) => p.date === action.date),
          data.preferences,
          plannerOptions(action.date),
        ),
      );
      break;
    case 'proposal.approve': {
      const p = proposal(action.date);
      if (p.date < today) fail('지난 날짜의 제안은 승인할 수 없습니다.');
      const item = p.items.find((i) => i.id === action.itemId) ?? fail('제안 항목을 찾을 수 없습니다.');
      if(item.state!=='approved'&&p.date===today&&item.start<minuteInZone(data.preferences.timeZone,now))fail('이미 지난 시간입니다. 일정 대안을 다시 계산해 주세요.');
      const target = data.tasks.find(t=>t.id===item.taskId) ?? item.draftTask;
      if(item.state!=='approved' && target && (!goalAllowsWork(data,target.projectId)||!allocationAllowsWork(data,target.projectId,p.date))) fail('보류하거나 달성한 목표의 작업입니다. 목표 상태를 먼저 확인해 주세요.');
      if (item.draftTask && !data.tasks.some((t) => t.id === item.taskId)) {
        data.tasks.push({ ...item.draftTask });
      }
      const count = data.tasks.filter(
        (t) => t.id !== item.taskId && focusIds(data, p.date).has(t.id) && t.status !== 'done',
      ).length;
      if (item.state !== 'approved' && count >= data.preferences.focusLimit)
        fail('이미 지정한 핵심 결과물이 있습니다. 먼저 계획을 조정해 주세요.');
      if (item.state !== 'approved' && [...careEvents(data,p.date),...protectedEvents(data,p.date)].some(e => overlaps(e,item))) fail('등록한 돌봄·학습 시간과 겹칩니다. 제안을 다시 만들거나 루틴 시간을 조정해 주세요.');
      const out = approveProposalItem(p, action.itemId, data.tasks, data.events);
      if (out.error) fail(out.error);
      saveProposal(out.proposal);
      data.events = out.events;
      const t = task(item.taskId);
      if (!t.focus) {
        t.focus = true;
        t.focusDate = p.date;
      }
      if (item.role === 'laser') {
        const other = data.tasks.find((x) => x.id !== t.id && x.laserDate === p.date);
        if (other) delete other.laserDate;
        t.laserDate = p.date;
      }
      delete t.planHoldUntil;
      delete t.planHoldReason;
      delete t.planHoldProposalId;
      break;
    }
    case 'proposal.defer': {
      const p = proposal(action.date),
        item = p.items.find((i) => i.id === action.itemId) ?? fail('제안 항목이 없습니다.');
      if (item.state === 'approved') fail('먼저 승인을 취소해 주세요.');
      if (action.revisitDate <= p.date) fail('다음 검토일은 계획 날짜 이후로 지정해 주세요.');
      item.state = 'deferred';
      item.deferReason = action.reason;
      item.revisitDate = action.revisitDate;
      const t =
        data.tasks.find((t) => t.id === item.taskId) ??
        item.draftTask ??
        fail('제안 업무를 찾을 수 없습니다.');
      t.planHoldUntil = action.revisitDate;
      t.planHoldReason = action.reason;
      t.planHoldProposalId = p.id;
      break;
    }
    case 'proposal.reconsider': {
      const item =
        proposal(action.date).items.find((i) => i.id === action.itemId) ?? fail('제안 항목이 없습니다.');
      if (item.state !== 'deferred') fail('보류한 항목만 다시 검토할 수 있습니다.');
      item.state = 'pending';
      delete item.deferReason;
      delete item.revisitDate;
      const t =
        data.tasks.find((t) => t.id === item.taskId) ??
        item.draftTask ??
        fail('제안 업무를 찾을 수 없습니다.');
      if (t.planHoldProposalId === proposal(action.date).id) {
        delete t.planHoldUntil;
        delete t.planHoldReason;
        delete t.planHoldProposalId;
      }
      break;
    }
    case 'proposal.revoke': {
      const p = proposal(action.date),
        item = p.items.find((i) => i.id === action.itemId) ?? fail('제안 항목이 없습니다.');
      if (item.state !== 'approved') fail('승인한 항목만 취소할 수 있습니다.');
      item.state = 'pending';
      data.events = data.events.filter((e) => e.id !== `approved:${item.id}`);
      const t = task(item.taskId);
      if (t.focusDate === p.date) {
        t.focus = false;
        t.focusDate = undefined;
      }
      if (item.role === 'laser' && t.laserDate === p.date) delete t.laserDate;
      break;
    }
    case 'preferences.update':
      data.preferences = { ...action.preferences, workDays: [...new Set(action.preferences.workDays)] };
      break;
    case 'improvement.add':
      addImprovement(data, action.improvement);
      break;
    case 'improvement.retire':
      data.improvements = (data.improvements ?? []).map((i) =>
        i.id === action.id ? { ...i, active: false } : i,
      );
      break;
    case 'habit.upsert': {
      const list = data.habits ?? [];
      if (!list.some((h) => h.id === action.habit.id) && list.length >= LIMITS.habits)
        fail('습관은 최대 3개(지킬 습관 1개, 버릴 습관 2개)입니다.');
      data.habits = replace(list, {
        ...action.habit,
        log: [...new Set(action.habit.log)].sort().slice(-LIMITS.habitLog),
      });
      break;
    }
    case 'habit.delete':
      data.habits = (data.habits ?? []).filter((h) => h.id !== action.id);
      break;
    case 'habit.check': {
      const habit = (data.habits ?? []).find((h) => h.id === action.id) ?? fail('습관을 찾을 수 없습니다.');
      if (action.date > today) fail('미래 날짜의 습관은 체크할 수 없습니다.');
      habit.log = action.checked
        ? [...new Set([...habit.log, action.date])].sort().slice(-LIMITS.habitLog)
        : habit.log.filter((d) => d !== action.date);
      break;
    }
    case 'risk.upsert': {
      const list = data.risks ?? [];
      if (!list.some((r) => r.id === action.risk.id) && list.length >= LIMITS.risks)
        fail(`상시 리스크는 ${LIMITS.risks}개까지 둡니다. 해결된 것을 먼저 닫아 주세요.`);
      data.risks = replace(list, action.risk);
      break;
    }
    case 'risk.close':
      data.risks = (data.risks ?? []).filter((r) => r.id !== action.id);
      break;
  }
  for(const t of data.tasks){const previous=current.tasks.find(x=>x.id===t.id);if(t.outcome&&t.outcomeOn&&(!previous||previous.outcome!==t.outcome||previous.outcomeOn!==t.outcomeOn||previous.actualMinutes!==t.actualMinutes||previous.outcomeReason!==t.outcomeReason)){data.executionHistory=[...data.executionHistory??[],{id:`execution:${crypto.randomUUID()}`,taskId:t.id,title:t.title,projectId:t.projectId,date:t.outcomeOn,at:now.toISOString(),due:t.due,outcome:t.outcome,reason:t.outcomeReason??'',estimate:t.outcomeEstimateMinutes??t.duration,actual:t.actualMinutes??null,impact:t.impact,buffer:data.preferences.bufferFraction}].slice(-1200);}}
  validateLinks(data);
  if (
    new TextEncoder().encode(JSON.stringify({ ...data, notes: data.notes.map((n) => ({ ...n, body: '' })) }))
      .byteLength > 950000
  )
    fail('현재 저장 용량에 가까워졌습니다. 기록을 내보내고 오래된 내용을 정리해 주세요.');
  return data;
}
