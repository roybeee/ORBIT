import type {CalendarEvent} from './model.ts';
export const eventScopes=['personal','work','other'] as const;
export type EventScope=typeof eventScopes[number];
export const eventScopeLabels:Record<EventScope,string>={personal:'개인 일정',work:'업무',other:'기타'};
export function eventScope(event:Pick<CalendarEvent,'scope'|'projectId'|'taskId'>):EventScope{return event.scope??(event.projectId||event.taskId?'work':'personal')}
export function storedEventScope(value:unknown):EventScope|undefined{return eventScopes.includes(value as EventScope)?value as EventScope:undefined}
