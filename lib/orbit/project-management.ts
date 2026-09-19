import type {Project,ProjectStatus,WorkspaceData} from './model.ts';
import {workEligibility} from './work-policy.ts';

export const projectStatusLabel: Record<ProjectStatus,string> = {planned:'준비',active:'진행 중',paused:'보류',completed:'완료'};
export const projectStatus = (project: Project): ProjectStatus => project.status ?? 'active';
export const priorityLabel = (priority: number) => priority >= 4 ? '높음' : priority <= 2 ? '낮음' : '보통';

export function projectSummary(data: WorkspaceData,project:Project,today:string) {
  const tasks=data.tasks.filter(t=>t.projectId===project.id);
  const open=tasks.filter(t=>t.status!=='done'),done=tasks.length-open.length;
  const actionable=open.filter(t=>workEligibility(data,t,today).allowed).sort((a,b)=>
    Number(b.id===project.nextTaskId)-Number(a.id===project.nextTaskId)||Number(b.status==='doing')-Number(a.status==='doing')||a.due.localeCompare(b.due)||b.impact-a.impact||a.id.localeCompare(b.id));
  const waiting=open.filter(t=>t.status==='waiting'||!!t.blocker?.trim());
  const overdue=open.filter(t=>t.due<today);
  const dueOver=projectStatus(project)!=='completed'&&project.due<today;
  const attention=projectStatus(project)==='active'&&(dueOver||overdue.length>0||waiting.length>0||tasks.length===0||!actionable.length&&open.length>0);
  return {tasks,open,done,actionable,next:actionable[0],waiting,overdue,dueOver,attention,
    progress:tasks.length?Math.round(done/tasks.length*100):null,
    notes:data.notes.filter(n=>n.projectId===project.id),events:data.events.filter(e=>e.projectId===project.id),
    milestones:project.milestones??[]};
}

// A task moved or deleted elsewhere must not leave an invalid project stage or next action.
export function reconcileProjectWork(data: WorkspaceData) {
  for(const p of data.projects){
    const tasks=new Map(data.tasks.filter(t=>t.projectId===p.id).map(t=>[t.id,t]));
    if(p.nextTaskId&&(!tasks.has(p.nextTaskId)||tasks.get(p.nextTaskId)?.status==='done'))delete p.nextTaskId;
    for(const stage of p.milestones??[]){
      stage.taskIds=stage.taskIds.filter(id=>tasks.has(id));
      if(stage.done&&stage.taskIds.some(id=>tasks.get(id)?.status!=='done'))stage.done=false;
    }
  }
}
