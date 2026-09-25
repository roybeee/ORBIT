import {addDays,todayInZone} from './dates.ts';
import type {Note} from './model.ts';
import type {AgentAction} from './agent/types.ts';

// The 결재함 badge counts decisions that are current: made in the last FRESH_DAYS days, or about a
// meeting held in that window. Older ones are shown as a backlog to clear in bulk instead, so a
// newly analyzed older meeting still shows up for its first week.
export const FRESH_DAYS=7;

export interface BacklogGroup {key:string;title:string;date:string;noteId?:string;actions:AgentAction[]}
export interface ProposalSplit {fresh:AgentAction[];backlog:BacklogGroup[];backlogCount:number}

const open=(a:AgentAction)=>a.state==='pending'||a.state==='applying';

// Meeting cards are dated by the meeting (recording date, else the note's date, as elsewhere
// in ORBIT): a full re-analysis can create cards today for a meeting held weeks ago. Other
// proposals are dated by when Orbit made them, in the owner's time zone.
function createdDay(action:AgentAction,timeZone:string){
 const created=new Date(action.createdAt);
 return Number.isNaN(created.getTime())?action.createdAt.slice(0,10):todayInZone(timeZone,created);
}
function proposalDay(action:AgentAction,notes:ReadonlyMap<string,Note>,timeZone:string):string{
 const noteId=action.guard?.meeting?.noteId,note=noteId?notes.get(noteId):undefined;
 const noteDay=note?.source?.date??note?.updated;
 if(noteDay)return noteDay.slice(0,10);
 return createdDay(action,timeZone);
}

export function splitProposals(actions:readonly AgentAction[],notes:readonly Note[],today:string,timeZone='Asia/Seoul'):ProposalSplit{
 const byId=new Map(notes.map(n=>[n.id,n]));
 const since=addDays(today,-FRESH_DAYS);
 const fresh:AgentAction[]=[],groups=new Map<string,BacklogGroup>();
 for(const action of actions.filter(open)){
  const day=proposalDay(action,byId,timeZone);
  // A card being applied is mid-flight and must stay in sight whatever its age.
  if(action.state==='applying'||day>=since||createdDay(action,timeZone)>=since){fresh.push(action);continue;}
  const noteId=action.guard?.meeting?.noteId;
  const key=noteId?'meeting:'+noteId:'chat';
  const group=groups.get(key)??{key,title:noteId?byId.get(noteId)?.title??'회의록':'Orbit 대화에서 나온 지난 제안',date:day,noteId,actions:[]};
  group.actions.push(action);
  if(day>group.date)group.date=day;
  groups.set(key,group);
 }
 const backlog=[...groups.values()].sort((a,b)=>b.date.localeCompare(a.date));
 return {fresh,backlog,backlogCount:backlog.reduce((n,g)=>n+g.actions.length,0)};
}

// Open proposals cap. Only current ones count: the old-meeting backlog is cleared in bulk from the
// 결재함 and must not stop recent meetings from being analyzed.
export const PROPOSAL_LIMIT=200;
export function proposalQueueFull(pending:readonly AgentAction[],notes:readonly Note[],adding:number,today:string,timeZone='Asia/Seoul'){
 return splitProposals(pending,notes,today,timeZone).fresh.length+adding>PROPOSAL_LIMIT;
}
