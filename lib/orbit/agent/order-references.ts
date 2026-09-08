import type {WorkspaceData} from '../model.ts';
import type {DispatchAction} from './orders-schema.ts';
import {AgentError} from './errors.ts';

// These are context references, never commands to reassign a task or edit an event.
export function orderReferences(data:WorkspaceData,order:DispatchAction){
 const project=order.projectId?data.projects.find(p=>p.id===order.projectId):null;
 const taskIds=order.taskIds,eventIds=order.eventIds??[];
 const missingTasks=taskIds.filter(id=>!data.tasks.some(t=>t.id===id));
 const missingEvents=eventIds.filter(id=>!data.events.some(e=>e.id===id));
 const mismatchedTasks=data.tasks.filter(t=>taskIds.includes(t.id)&&order.projectId&&t.projectId!==order.projectId);
 const duplicateTasks=new Set(taskIds).size!==taskIds.length,duplicateEvents=new Set(eventIds).size!==eventIds.length;
 if(order.projectId&&!project||missingTasks.length||missingEvents.length||mismatchedTasks.length||duplicateTasks||duplicateEvents){
  const reasons=[order.projectId&&!project?'연결할 프로젝트를 찾지 못했습니다.':'',missingTasks.length?'선택한 항목 중 Orbit 할 일로 등록되지 않은 항목이 있습니다.':'',missingEvents.length?'참고할 일정을 찾지 못했습니다.':'',mismatchedTasks.length?'다른 프로젝트에 속한 할 일이 포함되어 있습니다. 여러 프로젝트의 업무는 일반 업무로 연결해 주세요.':'',duplicateTasks||duplicateEvents?'같은 참고 항목이 중복 선택되었습니다.':''].filter(Boolean);
  throw new AgentError(reasons.join(' '),'ORDER_REFERENCES',422,{missingProject:order.projectId&&!project?order.projectId:null,missingTasks,missingEvents,mismatchedTasks:mismatchedTasks.map(t=>({id:t.id,projectId:t.projectId})),duplicateTasks,duplicateEvents,calendarIdsInTasks:missingTasks.filter(id=>data.events.some(e=>e.id===id))});
 }
 return {data,project:project??null,tasks:data.tasks.filter(t=>taskIds.includes(t.id)),events:data.events.filter(e=>eventIds.includes(e.id))};
}

export function orderLinkCatalog(data:WorkspaceData,orders:DispatchAction[]){
 const ids=new Set(orders.flatMap(o=>[...o.taskIds,...o.eventIds??[],o.projectId??'']));
 const text=orders.map(o=>o.instruction).join('\n').normalize('NFKC').replace(/\s/g,'').toLowerCase();
 const named=(title:string)=>text.includes(title.normalize('NFKC').replace(/\s/g,'').toLowerCase());
 // Prefer referenced or named records before the bounded general catalog.
 const ranked=<T extends {id:string}>(rows:T[],title:(r:T)=>string,limit:number)=>[...rows].sort((a,b)=>Number(ids.has(b.id)||named(title(b)))-Number(ids.has(a.id)||named(title(a)))).slice(0,limit);
 return {
  projects:ranked(data.projects,p=>p.name,80).map(p=>({id:p.id,name:p.name})),
  tasks:ranked(data.tasks,t=>t.title,160).map(t=>({id:t.id,title:t.title,projectId:t.projectId})),
  events:ranked(data.events,e=>e.title,100).map(e=>({id:e.id,title:e.title,date:e.date,start:e.start,end:e.end})),
  counts:{projects:data.projects.length,tasks:data.tasks.length,events:data.events.length},
 };
}
