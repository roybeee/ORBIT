// "Today's one thing" read from the stored plan, shared by the home hero (client) and the Slack
// GoTEM messages (server). DB-free and deterministic: no AI call, only the saved proposal/brief.
import {addDays} from './dates.ts';
import type {WorkspaceData,Proposal} from './model.ts';

export interface CarriedImprovement {reviewDate:string;rule:string}
export interface TodayFocus {
 date:string;
 taskId?:string;
 title:string;
 firstStep?:string;
 slot?:{start:number;end:number};
 source:'brief'|'local';
 carry?:CarriedImprovement;
}

// The one improvement the owner confirmed in yesterday's review for use today.
export function carriedImprovement(data:WorkspaceData,date:string):CarriedImprovement|undefined{
 const reviewDate=addDays(date,-1);
 const rule=data.reviews.find(r=>r.date===reviewDate)?.carry?.trim();
 return rule?{reviewDate,rule}:undefined;
}

const withSlot=(slot:TodayFocus['slot'])=>slot?{slot}:{};
function plannedSlot(proposal:Proposal,taskId:string|undefined){
 const item=taskId?proposal.items.find(i=>i.taskId===taskId&&i.state!=='deferred'):undefined;
 return item?{start:item.start,end:item.end}:undefined;
}

function localTaskId(proposal:Proposal){
 const active=proposal.items.filter(i=>i.state!=='deferred');
 return proposal.laser?.taskId??active.find(i=>i.role==='laser')?.taskId??[...active].sort((a,b)=>a.start-b.start)[0]?.taskId;
}

export function todayFocus(data:WorkspaceData,date:string):TodayFocus|null{
 const proposal=data.proposals.find(p=>p.date===date);
 if(!proposal)return null;
 const carry=carriedImprovement(data,date);
 const priority=proposal.brief?.priorities[0];
 if(priority)return {date,...(priority.taskId?{taskId:priority.taskId}:{}),title:priority.title,firstStep:priority.approach[0],
  ...withSlot(plannedSlot(proposal,priority.taskId)),source:'brief',...(carry?{carry}:{})};
 const taskId=localTaskId(proposal),task=data.tasks.find(t=>t.id===taskId);
 if(!task)return null;
 const definition=task.definition.trim();
 return {date,taskId:task.id,title:task.title,...(definition?{firstStep:`완료 기준 확인 — ${definition}`}:{}),
  ...withSlot(plannedSlot(proposal,task.id)),source:'local',...(carry?{carry}:{})};
}
