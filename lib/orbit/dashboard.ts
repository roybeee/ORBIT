import type {WorkspaceData,Task} from './model.ts';
import {chiefOfStaff,goalIsActive,careEvents} from './chief.ts';
import {goalDashboard,questReadiness} from './pacemaker.ts';
import {focusIds} from './derived.ts';
import {addDays,todayInZone} from './dates.ts';

/** A derived view of the canonical workspace; no separate dashboard state. */
export function workspaceDashboard(data:WorkspaceData,now:Date){
  const today=todayInZone(data.preferences.timeZone,now),chief=chiefOfStaff(data,now);
  const goals=goalDashboard(data,today),activeGoals=goals.filter(g=>goalIsActive(data,g.goal.id));
  const focus=focusIds(data,today),active=data.tasks.find(t=>t.startedAt&&t.status!=='done');
  const ranked=(a:Task,b:Task)=>Number(focus.has(b.id))-Number(focus.has(a.id))||a.due.localeCompare(b.due)||b.impact-a.impact||a.id.localeCompare(b.id);
  const open=data.tasks.filter(t=>t.status!=='done');
  const ready=open.filter(t=>questReadiness(data,t,today).canStart).sort(ranked);
  const attention=open.filter(t=>{
    const state=questReadiness(data,t,today).state;
    if(state==='paused')return false;
    return t.due<today||['blocked','waiting'].includes(state)||!!(t.checkDate&&t.checkDate<=today);
  }).sort((a,b)=>Number(b.due<today)-Number(a.due<today)||ranked(a,b));
  const focusTasks=data.tasks.filter(t=>focus.has(t.id));
  const todayEvents=data.events.filter(e=>e.date===today).sort((a,b)=>a.start-b.start||a.end-b.end||a.id.localeCompare(b.id));
  const upcoming=data.events.filter(e=>e.date>today&&e.date<=addDays(today,7)).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start||a.id.localeCompare(b.id));
  const care=careEvents(data,today).map(e=>({event:e,routine:data.careRoutines!.find(r=>e.id===`care:${r.id}:${today}`)!}));
  const completed=data.tasks.filter(t=>t.status==='done'&&t.completedOn===today);
  const week=Array.from({length:7},(_,i)=>{const date=addDays(today,i-6);return {date,count:data.tasks.filter(t=>t.status==='done'&&t.completedOn===date).length}});
  const projects=data.projects.map(p=>{const tasks=data.tasks.filter(t=>t.projectId===p.id);return {project:p,total:tasks.length,done:tasks.filter(t=>t.status==='done').length,blocked:tasks.filter(t=>['blocked','waiting'].includes(questReadiness(data,t,today).state)).length}}).sort((a,b)=>b.blocked-a.blocked||a.project.due.localeCompare(b.project.due)||b.project.priority-a.project.priority);
  return {today,chief,goals,activeGoals,active,ready,attention,focusTasks,todayEvents,upcoming,care,completed,week,projects};
}
