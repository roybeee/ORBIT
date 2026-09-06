import type {WorkspaceAction} from '../validation';
export type Provider='openai'|'plaud'|'google_calendar';
export interface Connection {provider:Provider;configured:boolean;connected:boolean;label:string;updatedAt?:string;model?:string}
export interface AgentAction {id:string;turnId:string;title:string;reason:string;action:WorkspaceAction|GoogleEventAction;expectedRevision:number;state:'pending'|'applying'|'approved'|'deferred'|'rejected';note:string;revisitDate:string|null;result?:{url?:string};createdAt:string}
export interface GoogleEventAction {type:'google.event.create';event:{title:string;date:string;start:number;end:number;timeZone:string;description:string}}
export interface AgentTurn {id:string;input:string;status:'running'|'completed'|'failed';text:string;error?:string;sources:{title:string;label:string}[];createdAt:string}
export interface AgentState {turns:AgentTurn[];actions:AgentAction[];connections:Connection[];hasMore:boolean;nextBefore:string|null}
