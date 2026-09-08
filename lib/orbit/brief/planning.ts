import {careEvents,goalAllowsWork} from '../chief.ts';
import type {WorkspaceData,Task,Proposal} from '../model.ts';
import type {DailyBrief} from './schema.ts';
import {generateProposal,calibrationFactor} from '../planner.ts';
import {DomainError} from '../reducer.ts';

// The brief's first priority becomes the day's Goal Laser: the planner gives it a contiguous
// block in the peak window first, then places the remaining priorities in the brief's order.
export function planFromBrief(data:WorkspaceData,brief:DailyBrief,energy:Proposal['energy']):Proposal{
 const previous=data.proposals.find(p=>p.date===brief.date),drafts:Task[]=[],ordered:string[]=[];
 for(const priority of brief.priorities){
  const project=data.projects.find(p=>p.id===priority.projectId);if(!project)throw new DomainError('제안의 프로젝트가 변경됐습니다. 다시 분석해 주세요.');
  if(!goalAllowsWork(data,project.id))throw new DomainError('보류하거나 달성한 목표의 작업입니다. 제안을 다시 분석해 주세요.');
  const existing=priority.taskId?data.tasks.find(t=>t.id===priority.taskId):undefined;
  if(priority.taskId&&(!existing||existing.projectId!==project.id))throw new DomainError('제안의 업무와 프로젝트를 확인할 수 없습니다. 다시 분석해 주세요.');
  if(existing&&(existing.status==='done'||existing.status==='waiting'||(existing.planHoldUntil&&existing.planHoldUntil>brief.date)||(existing.dependsOn??[]).some(id=>data.tasks.find(t=>t.id===id)?.status!=='done')))throw new DomainError('완료·보류·대기·선행 작업을 반영해 제안을 다시 분석해 주세요.');
  if(existing&&priority.minutes!==existing.duration)priority.minutes=existing.duration;
  const task=existing??{id:`brief:${brief.sourceTurnId}:${ordered.length}`,title:priority.title,projectId:project.id,status:'todo' as const,duration:priority.minutes,due:brief.date,impact:project.priority,focus:false,definition:priority.outcome,...(priority.cognition?{cognition:priority.cognition}:{}),...(priority.quadrant?{quadrant:priority.quadrant}:{})};
  if(ordered.includes(task.id))throw new DomainError('같은 업무가 중복 제안됐습니다.');
  ordered.push(task.id);if(!existing)drafts.push(task);
 }
 const pool=[...data.tasks.filter(t=>t.status==='done'||goalAllowsWork(data,t.projectId)),...drafts];
 // Goal Laser = the first priority that deserves a contiguous deep-work block (high cognition, a
 // long task, or substantial domino-project work). A quick unblocker ranked first stays quick.
 const laserTaskId=ordered.find(id=>{const t=pool.find(x=>x.id===id)!;return t.cognition==='high'||t.duration>=90||(!!data.dominoProjectId&&t.projectId===data.dominoProjectId&&t.duration>=45)});
 const proposal=generateProposal(pool,[...data.events,...careEvents(data,brief.date)],brief.date,energy,previous,data.preferences,{ordered,laserTaskId,dominoProjectId:data.dominoProjectId,calibration:t=>calibrationFactor(pool,t,brief.date)});
 proposal.brief=brief;
 proposal.items=proposal.items.map(item=>{const index=ordered.indexOf(item.taskId),priority=brief.priorities[index],draftTask=drafts.find(t=>t.id===item.taskId);return item.state==='pending'&&priority?{...item,reason:(item.role==='laser'?'오늘의 Goal Laser · ':'')+priority.whyNow+(item.factor&&item.factor!==1?` (최근 실적 ×${item.factor} 보정)`:''),...(draftTask?{draftTask}:{})}:item});
 // Keep unslotted recommendations reviewable as draft work; never create tasks here.
 proposal.draftTasks=drafts;
 return proposal;
}
