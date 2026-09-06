import type {WorkspaceData} from './model';
export function focusIds(data:WorkspaceData,date:string){return new Set([...data.tasks.filter(t=>t.focus&&t.focusDate===date).map(t=>t.id),...data.events.filter(e=>e.date===date&&e.taskId&&e.id.startsWith('approved:')).map(e=>e.taskId!)])}
