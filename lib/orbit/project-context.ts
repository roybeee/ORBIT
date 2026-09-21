import type {CalendarEvent, WorkspaceData} from './model.ts';
import {automaticProject, suggestProject} from './classify.ts';

// Resolve missing links only. An explicit choice (including opting out) wins.
export function linkEventProject(event:CalendarEvent,data:WorkspaceData):CalendarEvent {
 if(event.projectId||event.projectAutoLink===false)return event;
 const task=event.taskId?data.tasks.find(t=>t.id===event.taskId):undefined;
 const original=event.google?.orbitEventId?data.events.find(e=>e.id===event.google?.orbitEventId):undefined;
 const inherited=task?.projectId??original?.projectId;
 if(inherited&&data.projects.some(p=>p.id===inherited))return {...event,projectId:inherited,projectLink:{method:'related',matched:[task?.title??original?.title??'연결 기록']}};
 const match=automaticProject(event.title,data.projects,data.tasks,data.notes);
 return match?{...event,projectId:match.projectId,projectLink:{method:'keyword',matched:match.matched}}:event;
}

export function eventProjectReason(event:CalendarEvent){
 return event.projectLink?`${event.projectLink.method==='related'?'연결 기록에서 이어짐':'이름·키워드로 연결'} · ${event.projectLink.matched.join(', ')}`:'직접 지정한 프로젝트';
}

export function eventProjectCandidates(event:CalendarEvent,data:WorkspaceData){
 if(event.projectId||event.projectAutoLink===false)return [];
 return suggestProject(event.title,data.projects,data.tasks,data.notes).filter(p=>p.confidence==='high');
}

export function projectTimeline(data:WorkspaceData,projectId:string){
 return [
  ...data.events.filter(e=>e.projectId===projectId).map(e=>({id:e.id,kind:'event' as const,date:e.date,title:e.title,label:'일정',reason:eventProjectReason(e)})),
  ...data.notes.filter(n=>n.projectId===projectId).map(n=>({id:n.id,kind:'note' as const,date:n.updated,title:n.title,label:n.kind==='meeting'?'회의록':'기록',reason:n.source?`${n.source.provider} 원문 연결`:'프로젝트 기록'})),
  ...data.tasks.filter(t=>t.projectId===projectId).map(t=>({id:t.id,kind:'task' as const,date:t.completedOn??t.due,title:t.title,label:t.status==='done'?'완료한 일':'할 일',reason:t.noteId?'회의록·문서에서 이어진 후속 업무':'프로젝트 업무'})),
 ].sort((a,b)=>b.date.localeCompare(a.date)||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
}
