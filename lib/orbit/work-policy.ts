import type { Task, WorkspaceData } from './model.ts';

export type WorkContext = Pick<WorkspaceData, 'tasks'> & Partial<Pick<WorkspaceData, 'projects' | 'goals' | 'weeklyAllocations'>>;
export type WorkState = 'ready' | 'doing' | 'blocked' | 'waiting' | 'held' | 'paused' | 'done';

export function goalIsActive(data: Pick<WorkContext, 'goals'>, goalId?: string) {
  const visited = new Set<string>();
  while (goalId) {
    if (visited.has(goalId)) return false;
    visited.add(goalId);
    const goal = data.goals?.find(g => g.id === goalId);
    if (!goal || ['paused', 'achieved'].includes(goal.status ?? 'active')) return false;
    goalId = goal.parentId;
  }
  return true;
}

export function goalAllowsWork(data: Pick<WorkContext, 'projects' | 'goals'>, projectId: string) {
  const project=data.projects?.find(p=>p.id===projectId);
  return (!project || (project.status??'active')==='active') && goalIsActive(data, project?.goalId);
}

// Planning for a date and starting now share all durable constraints. Only starting
// now is blocked by a different live focus session; tomorrow can still be planned.
export function workEligibility(data: WorkContext, task: Task, date: string, mode: 'plan' | 'start' = 'plan'): { state: WorkState; reason: string; allowed: boolean } {
  const denied = (state: WorkState, reason: string) => ({ state, reason, allowed: false });
  if (task.status === 'done') return denied('done', task.completedOn ? `${task.completedOn} 완료` : '완료 기록');
  if (data.projects && !data.projects.some(p => p.id === task.projectId)) return denied('blocked', '연결할 프로젝트가 없습니다.');
  const project=data.projects?.find(p=>p.id===task.projectId);
  if(project&&(project.status??'active')!=='active')return denied('paused',project.status==='completed'?'완료한 프로젝트입니다.':project.status==='planned'?'준비 중인 프로젝트입니다. 진행 상태로 바꾸면 계획에 포함됩니다.':'보류 중인 프로젝트입니다.');
  const allocation = data.weeklyAllocations?.find(p => p.active && p.from <= date && p.through >= date);
  if (allocation?.allocations.find(a => a.projectId === task.projectId)?.stance === 'pause') return denied('paused', '승인한 주간 배분에서 이번 주 보류한 사업입니다.');
  if (!goalAllowsWork(data, task.projectId)) return denied('paused', '연결 목표가 보류 또는 달성 상태입니다.');
  if (task.planHoldUntil && task.planHoldUntil > date) return denied('held', `${task.planHoldUntil}까지 보류 · ${task.planHoldReason ?? '다음 검토를 기다립니다.'}`);
  const blockers = (task.dependsOn ?? []).filter(id => data.tasks.find(t => t.id === id)?.status !== 'done');
  if (blockers.length) return denied('blocked', '먼저 완료: ' + blockers.map(id => data.tasks.find(t => t.id === id)?.title ?? '찾을 수 없는 선행 퀘스트').join(' · '));
  if (task.status === 'waiting' || task.blocker?.trim()) return denied('waiting', task.blocker?.trim() || '필요한 답변이나 조건을 기다립니다.');
  const active = mode === 'start' && data.tasks.find(t => t.id !== task.id && t.startedAt && t.status !== 'done');
  if (active) return denied('held', `‘${active.title}’ 집중 세션을 먼저 마쳐주세요.`);
  return { state: task.startedAt || task.status === 'doing' ? 'doing' : 'ready', reason: task.startedAt ? '집중 세션 진행 중' : task.status === 'doing' ? '진행 중 · 다음 단계를 이어갈 수 있습니다.' : '지금 시작할 수 있습니다.', allowed: true };
}
