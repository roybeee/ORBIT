export type View = 'today'|'calendar'|'tasks'|'projects'|'wiki'|'knowledge'|'review'|'proposal';
export type TaskStatus = 'todo'|'doing'|'waiting'|'done';
export interface Project {id:string;name:string;color:string;symbol:string;goal:string;due:string;priority:number}
export interface Task {id:string;title:string;projectId:string;status:TaskStatus;duration:number;due:string;impact:number;focus:boolean;focusDate?:string;definition:string;noteId?:string;noteCitation?:{revision:number;line:number;quote:string};blocker?:string;checkDate?:string;completedOn?:string;dependsOn?:string[];result?:string;planHoldUntil?:string;planHoldReason?:string;planHoldProposalId?:string}
export interface Note {id:string;title:string;kind:'meeting'|'wiki'|'knowledge';projectId:string;summary:string;body:string;tags:string[];updated:string;revision?:number;bodyStored?:boolean}
export interface NoteRevision {revision:number;title:string;updatedAt:string}
export interface CalendarEvent {id:string;title:string;date:string;start:number;end:number;kind:'meeting'|'focus'|'break';projectId?:string;taskId?:string}
export interface ProposalItem {id:string;taskId:string;start:number;end:number;reason:string;state:'pending'|'approved'|'deferred';deferReason?:string;revisitDate?:string}
export interface Proposal {id:string;date:string;items:ProposalItem[];unscheduled:string[];budget:number;energy:'low'|'normal'|'high'}
export interface Preferences {timeZone:string;workStart:number;workEnd:number;workDays:number[];focusLimit:number;breakMinutes:number;bufferFraction:number}
export interface DailyReview {id:string;date:string;win:string;block:string;energy:Proposal['energy'];completedIds:string[];updatedAt:string}
export interface WorkspaceData {schemaVersion:2|3;projects:Project[];tasks:Task[];notes:Note[];events:CalendarEvent[];proposals:Proposal[];reviews:DailyReview[];preferences:Preferences}
export interface WorkspaceSnapshot {data:WorkspaceData;revision:number;updatedAt:string|null}
export const DEFAULT_PREFERENCES:Preferences={timeZone:'Asia/Seoul',workStart:540,workEnd:1080,workDays:[1,2,3,4,5],focusLimit:3,breakMinutes:10,bufferFraction:.2};
export const emptyWorkspace=():WorkspaceData=>({schemaVersion:2,projects:[],tasks:[],notes:[],events:[],proposals:[],reviews:[],preferences:{...DEFAULT_PREFERENCES,workDays:[...DEFAULT_PREFERENCES.workDays]}});
export const TODAY='2026-09-06';
export const TOMORROW='2026-09-07';
export const formatTime=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
export const durationText=(minute:number)=>minute>=60?`${Math.floor(minute/60)}시간${minute%60?` ${minute%60}분`:''}`:`${minute}분`;
export const statusLabel:Record<TaskStatus,string>={todo:'예정',doing:'진행 중',waiting:'대기 중',done:'완료'};
