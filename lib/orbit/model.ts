export type View = 'today'|'calendar'|'tasks'|'projects'|'wiki'|'knowledge'|'review'|'proposal';
export type TaskStatus = 'todo'|'doing'|'waiting'|'done';
export interface Project {id:string;name:string;color:string;symbol:string;goal:string;due:string;priority:number}
export interface Task {id:string;title:string;projectId:string;status:TaskStatus;duration:number;due:string;impact:number;focus:boolean;definition:string;noteId?:string;blocker?:string;completedOn?:string;dependsOn?:string[]}
export interface Note {id:string;title:string;kind:'meeting'|'wiki'|'knowledge';projectId:string;summary:string;body:string;tags:string[];updated:string}
export interface CalendarEvent {id:string;title:string;date:string;start:number;end:number;kind:'meeting'|'focus'|'break';projectId?:string;taskId?:string}
export interface ProposalItem {id:string;taskId:string;start:number;end:number;reason:string;state:'pending'|'approved'|'deferred';deferReason?:string}
export interface Proposal {id:string;date:string;items:ProposalItem[];unscheduled:string[];budget:number;energy:'low'|'normal'|'high'}
export const TODAY='2026-09-06';
export const TOMORROW='2026-09-07';
export const formatTime=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
export const durationText=(minute:number)=>minute>=60?`${Math.floor(minute/60)}시간${minute%60?` ${minute%60}분`:''}`:`${minute}분`;
export const statusLabel:Record<TaskStatus,string>={todo:'예정',doing:'진행 중',waiting:'대기 중',done:'완료'};
