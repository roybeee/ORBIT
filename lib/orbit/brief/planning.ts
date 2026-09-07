import type {WorkspaceData,Task,Proposal} from '../model.ts';
import type {DailyBrief} from './schema.ts';
import {generateProposal} from '../planner.ts';
import {DomainError} from '../reducer.ts';

export function planFromBrief(data:WorkspaceData,brief:DailyBrief,energy:Proposal['energy']):Proposal{
 const previous=data.proposals.find(p=>p.date===brief.date),drafts:Task[]=[],ordered:string[]=[];
 for(const priority of brief.priorities){
  const project=data.projects.find(p=>p.id===priority.projectId);if(!project)throw new DomainError('제안의 프로젝트가 변경됐습니다. 다시 분석해 주세요.');
  const existing=priority.taskId?data.tasks.find(t=>t.id===priority.taskId):undefined;
  if(priority.taskId&&(!existing||existing.projectId!==project.id))throw new DomainError('제안의 업무와 프로젝트를 확인할 수 없습니다. 다시 분석해 주세요.');
  if(existing&&(existing.status==='done'||existing.status==='waiting'||(existing.planHoldUntil&&existing.planHoldUntil>brief.date)||(existing.dependsOn??[]).some(id=>data.tasks.find(t=>t.id===id)?.status!=='done')))throw new DomainError('완료·보류·대기·선행 작업을 반영해 제안을 다시 분석해 주세요.');
  if(existing&&priority.minutes!==existing.duration)priority.minutes=existing.duration;
  const task=existing??{id:`brief:${brief.sourceTurnId}:${ordered.length}`,title:priority.title,projectId:project.id,status:'todo' as const,duration:priority.minutes,due:brief.date,impact:project.priority,focus:false,definition:priority.outcome};
  if(ordered.includes(task.id))throw new DomainError('같은 업무가 중복 제안됐습니다.');
  ordered.push(task.id);if(!existing)drafts.push(task);
 }
 const proposal=generateProposal([...data.tasks,...drafts],data.events,brief.date,energy,previous,data.preferences,ordered);
 proposal.brief=brief;
 proposal.items=proposal.items.map(item=>{const index=ordered.indexOf(item.taskId),priority=brief.priorities[index],draftTask=drafts.find(t=>t.id===item.taskId);return item.state==='pending'&&priority?{...item,reason:priority.whyNow,...(draftTask?{draftTask}:{})}:item});
 // Keep unslotted recommendations reviewable as draft work; never create tasks here.
 proposal.draftTasks=drafts;
 return proposal;
}
