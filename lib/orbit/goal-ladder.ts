import type {Goal,Project,WorkspaceData} from './model.ts';
import {projectStatus} from './project-management.ts';

// The 프로젝트 tab's goal ladder (꿈 → 중장기 → 단기): the nearest active short-term goal
// and the chain above it, with the domino project and how many active projects serve it.
export interface GoalLadder {life?:Goal;mid?:Goal;short?:Goal;domino?:Project;linkedProjects:number;empty:boolean}

const active=(g:Goal)=>g.status!=='paused'&&g.status!=='achieved';

// Every ancestor through parentId, nearest first. The reducer rejects cycles; the visited
// set keeps this finite for imported data anyway.
function ancestors(goal:Goal|undefined,all:readonly Goal[]):Goal[]{
 const chain:Goal[]=[],seen=new Set<string>();
 let current=goal;
 while(current?.parentId&&!seen.has(current.parentId)){
  seen.add(current.parentId);
  current=all.find(g=>g.id===current!.parentId);
  if(current)chain.push(current);
 }
 return chain;
}

// Upcoming deadlines first (soonest), then overdue ones (most recent), then undated.
function nearestShort(shorts:readonly Goal[],today:string):Goal|undefined{
 const upcoming=shorts.filter(g=>g.deadline&&g.deadline>=today).sort((a,b)=>a.deadline!.localeCompare(b.deadline!));
 const overdue=shorts.filter(g=>g.deadline&&g.deadline<today).sort((a,b)=>b.deadline!.localeCompare(a.deadline!));
 return upcoming[0]??overdue[0]??shorts.find(g=>!g.deadline);
}

export function goalLadder(data:WorkspaceData,today:string):GoalLadder{
 const all=data.goals??[],goals=all.filter(active);
 const firstOf=(kind:Goal['kind'])=>goals.find(g=>g.kind===kind);
 // Stay on one chain: use the nearest active ancestor of each kind. Borrow another chain's
 // goal only when the chain has no goal of that kind at all.
 const pick=(chain:Goal[],kind:Goal['kind'])=>{const own=chain.filter(g=>g.kind===kind);return own.length?own.find(active):firstOf(kind);};
 const short=nearestShort(goals.filter(g=>g.kind==='short'),today);
 const shortChain=ancestors(short,all);
 const mid=short?pick(shortChain,'mid'):firstOf('mid');
 const midIsAncestor=!!mid&&(!short||shortChain.includes(mid));
 const life=pick(midIsAncestor?[...shortChain,...ancestors(mid,all)]:mid?ancestors(mid,all):shortChain,'life');
 const running=data.projects.filter(p=>projectStatus(p)==='active');
 const domino=running.find(p=>p.id===data.dominoProjectId);
 const targets=new Set([short?.id,midIsAncestor?mid?.id:undefined].filter(Boolean));
 const linkedProjects=running.filter(p=>p.goalId&&targets.has(p.goalId)).length;
 return {life,mid,short,domino,linkedProjects,empty:!life&&!mid&&!short};
}
