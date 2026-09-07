import type {StoredAttachment} from '../attachments/types';
import type {WorkspaceAction} from '../validation';
export type Provider='hermes'|'plaud'|'google_calendar';
export interface Connection {provider:Provider;configured:boolean;connected:boolean;label:string;updatedAt?:string;model?:string;endpoint?:string}
export interface AgentAction {conversationId?:string;id:string;turnId:string;title:string;reason:string;action:WorkspaceAction|GoogleEventAction;expectedRevision:number;state:'pending'|'applying'|'approved'|'deferred'|'rejected';note:string;revisitDate:string|null;result?:{url?:string;briefDate?:string};createdAt:string}
export interface GoogleEventAction {type:'google.event.create';event:{title:string;date:string;start:number;end:number;timeZone:string;description:string}}
export interface AgentTurn {attachments?:StoredAttachment[];conversationId?:string;id:string;input:string;status:'running'|'completed'|'failed';text:string;error?:string;progress?:string;sources:{title:string;label:string}[];createdAt:string}
export interface AgentState {conversation?:Conversation|null;pendingActions?:AgentAction[];activeRun?:{id:string;conversationId:string}|null;turns:AgentTurn[];actions:AgentAction[];connections:Connection[];hasMore:boolean;nextBefore:string|null}

export interface Conversation {id:string;title:string;projectId:string|null;revision:number;createdAt:string;updatedAt:string}
export interface ConversationList {items:Conversation[];hasMore:boolean;nextBefore:string|null}
