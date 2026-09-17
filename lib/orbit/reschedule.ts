import type {WorkspaceData,Task,Proposal} from './model.ts';
import {planningFloor} from './dates.ts';
import {generateProposal,calibrationFactor,overlaps} from './planner.ts';
import {careEvents,goalAllowsWork} from './chief.ts';
import {activeAllocation,allocationAllowsWork,protectedEvents,portfolioBasis} from './phase3.ts';
export function replanBasis(data:WorkspaceData,date:string,now=new Date()){
 const p=data.proposals.find(p=>p.date===date);
 return portfolioBasis(data,date)+':'+planningFloor(date,data.preferences.timeZone,now)+':'+JSON.stringify([data.dominoProjectId,p?.draftTasks,p?.items.filter(i=>i.draftTask).map(i=>i.draftTask)]);
}
export function prepareReplan(data:WorkspaceData,date:string,now=new Date()):NonNullable<Proposal['replan']>{
 const previous=data.proposals.find(p=>p.date===date),earliestStart=planningFloor(date,data.preferences.timeZone,now);
 const drafts=[...new Map([...previous?.draftTasks??[],...previous?.items.flatMap(i=>i.draftTask?[i.draftTask]:[])??[]].filter(t=>!data.tasks.some(x=>x.id===t.id)).map(t=>[t.id,t])).values()];
 const all=[...new Map([...drafts,...data.tasks].map(t=>[t.id,t])).values()];
 const pool=all.filter(t=>t.status==='done'||goalAllowsWork(data,t.projectId)&&allocationAllowsWork(data,t.projectId,date));
 const extras=[...careEvents(data,date),...protectedEvents(data,date)],events=[...data.events,...extras];
 const alternatives=(['normal','low'] as const).map(energy=>{
  const p=generateProposal(pool,events,date,energy,previous,data.preferences,{earliestStart,dominoProjectId:data.dominoProjectId,projectPriority:Object.fromEntries((activeAllocation(data,date)?.allocations??[]).map(a=>[a.projectId,a.stance==='focus'?50:0])),calibration:(t:Task)=>calibrationFactor(data.tasks,t,date)});
  p.draftTasks=drafts;p.items=p.items.map(i=>{const draft=drafts.find(t=>t.id===i.taskId);return i.state==='pending'&&draft?{...i,draftTask:draft}:i});return p;
 });
 const conflicts:string[]=[];
 for(const item of previous?.items.filter(i=>i.state==='approved')??[]){const title=all.find(t=>t.id===item.taskId)?.title??item.taskId;
  if(events.some(e=>e.date===date&&e.id!=='approved:'+item.id&&e.google?.orbitEventId!=='approved:'+item.id&&overlaps(e,item)))conflicts.push(title+' · 고정 일정과 겹칩니다. 승인한 시간을 직접 조정해 주세요.');
 }
 return {basis:replanBasis(data,date,now),generatedAt:now.toISOString(),earliestStart,alternatives,conflicts};
}
