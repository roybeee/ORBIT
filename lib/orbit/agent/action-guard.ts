import {todayInZone} from '../dates.ts';
import {normalize} from '../classify.ts';
import type {WorkspaceData} from '../model.ts';
import type {AgentAction} from './types.ts';
export interface ActionGuard {meeting?:{noteId:string;revision:number;needsDue?:boolean};version:1;actionHash:string;values:Record<string,string|null>}
export type WorkspaceBasis=Record<string,string>;
const canonical=(value:unknown):string=>JSON.stringify(value===undefined?null:value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).filter(([k])=>!['createdAt','updatedAt'].includes(k)).sort(([a],[b])=>a.localeCompare(b))):v);
async function hash(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),b=>b.toString(16).padStart(2,'0')).join('')}
export async function recordFingerprint(collection:string,value:unknown){
 if(collection==='notes'&&value&&typeof value==='object'){const {body,bodyStored,...meta}=value as Record<string,unknown>;return hash(meta)}
 return hash(value);
}
export async function captureWorkspaceBasis(data:WorkspaceData,now=new Date()):Promise<WorkspaceBasis>{
 const today=todayInZone(data.preferences.timeZone,now);
 const entries:[string,unknown][]=[['workspace',{...data,executionHistory:data.executionHistory?.map(({id,at,...record})=>record),notes:data.notes.map(({body,bodyStored,...note})=>note)}],['$today',today],['$timeZone',data.preferences.timeZone]];
 for(const name of new Set(data.projects.map(p=>normalize(p.name))))entries.push(['projectName:'+name,data.projects.filter(p=>normalize(p.name)===name).map(p=>p.id).sort()]);
 for(const check of data.chief?.checkins??[])entries.push(['chief.checkins:'+check.date,check]);
 for(const task of data.tasks)entries.push(['taskEvents:'+task.id,data.events.filter(e=>e.taskId===task.id)]);
 for(const [name,value] of Object.entries(data)){
  entries.push([name,value]);
  if(Array.isArray(value))for(const row of value)if(row&&typeof row==='object'&&(row.id||row.date))entries.push([name+':'+(row.id??row.date),row]);
 }
 return Object.fromEntries(await Promise.all(entries.map(async([key,value])=>[key,await recordFingerprint(key.split(':')[0],value)])));
}
// Guard keys read the action as a loose record: every referenced field is listed here.
type GuardRef={id:unknown;projectId:unknown;goalId:unknown;noteId:unknown;taskId:unknown;parentId:unknown;status:unknown;name:string;dependsOn:unknown[]|undefined;sources:{kind:unknown;id:unknown}[]|undefined};
type GuardAction={type:string;id:unknown;date:unknown;goalId:unknown;projectId:unknown;taskIds:unknown[];eventIds:unknown[]|undefined;assignments:GuardRef[];projects:GuardRef[]|undefined;tasks:GuardRef[];routine:GuardRef;project:GuardRef;task:GuardRef;note:GuardRef;event:GuardRef;goal:GuardRef;improvement:GuardRef;habit:GuardRef;risk:GuardRef;memory:GuardRef;record:GuardRef;contact:Record<string,unknown[]|undefined>};
function keysFor(action:AgentAction['action'],data:WorkspaceData):string[]{
 const a=action as unknown as GuardAction,keys=new Set<string>();
 const row=(collection:string,id:unknown)=>{if(typeof id==='string'&&id)keys.add(collection+':'+id)};
 const project=(id:unknown)=>{row('projects',id);const p=data.projects.find(p=>p.id===id);if(p?.goalId)row('goals',p.goalId)};
 const draftProject=(draft:GuardRef)=>{project(draft.id);keys.add('projectName:'+normalize(draft.name))};
 const task=(id:unknown)=>{row('tasks',id);row('taskEvents',id);const t=data.tasks.find(t=>t.id===id);if(t){project(t.projectId);for(const dep of t.dependsOn??[])row('tasks',dep);for(const event of data.events.filter(e=>e.taskId===id))row('events',event.id)}};
 const linked=(record:GuardRef)=>{project(record.projectId);row('notes',record.noteId);row('tasks',record.taskId);row('goals',record.goalId)};
 if(['project.upsert','task.upsert','task.status','task.focus','task.record','chief.checkin','care.check','review.saveGenerate','meeting.finish','quest.plan'].includes(a.type)){keys.add('$today');keys.add('$timeZone')}
 switch(a.type){
  case 'chief.checkin':keys.add('chief.checkins:'+todayInZone(data.preferences.timeZone));break;
  case 'care.upsert':row('careRoutines',a.routine.id);row('goals',a.routine.goalId);break;
  case 'care.check':row('careRoutines',a.id);break;
  case 'proposal.generate':break; // Explicitly requests a new plan using current data.
  case 'project.upsert':row('projects',a.project.id);row('goals',a.project.goalId);if(a.project.status&&a.project.status!=='active')for(const t of data.tasks.filter(t=>t.projectId===a.project.id))task(t.id);break;
  case 'task.upsert':task(a.task.id);project(a.task.projectId);row('notes',a.task.noteId);for(const id of a.task.dependsOn??[])task(id);if(a.project)draftProject(a.project);break;
  case 'task.status':case 'task.focus':case 'task.record':task(a.id);keys.add('preferences');break;
  case 'task.laser':task(a.id);keys.add('preferences');for(const t of data.tasks.filter(t=>t.laserDate===a.date))task(t.id);break;
  case 'task.assign':for(const assignment of a.assignments){task(assignment.id);project(assignment.projectId)}for(const p of a.projects??[])draftProject(p);break;
  case 'note.upsert':row('notes',a.note.id);project(a.note.projectId);break;
  case 'event.upsert':row('events',a.event.id);task(a.event.taskId);project(a.event.projectId);keys.add('preferences');break;
  case 'preferences.update':keys.add('preferences');break;
  case 'project.domino':keys.add('dominoProjectId');project(a.id);break;
  case 'goal.upsert':row('goals',a.goal.id);row('goals',a.goal.parentId);break;
  case 'improvement.add':row('improvements',a.improvement.id);break;
  case 'improvement.retire':row('improvements',a.id);break;
  case 'habit.upsert':row('habits',a.habit.id);break;
  case 'habit.check':row('habits',a.id);break;
  case 'risk.upsert':row('risks',a.risk.id);project(a.risk.projectId);break;
  case 'risk.close':row('risks',a.id);break;
  case 'memory.upsert':row('memories',a.memory.id);for(const source of a.memory.sources??[])row(source.kind==='note'?'notes':source.kind==='task'?'tasks':'reviews',source.id);break;
  case 'quest.plan':row('goals',a.goalId);if(a.project)draftProject(a.project);for(const t of a.tasks){task(t.id);project(t.projectId);for(const id of t.dependsOn??[])task(id)}break;
  case 'decision.upsert':row('decisions',a.record.id);linked(a.record);break;
  case 'delegation.upsert':row('delegations',a.record.id);linked(a.record);break;
  case 'contact.upsert':row('contacts',a.contact.id);for(const [key,collection] of [['projectIds','projects'],['noteIds','notes'],['decisionIds','decisions'],['delegationIds','delegations'],['eventIds','events']])for(const id of a.contact[key]??[])row(collection,id);break;
  // External actions keep their own live validation and durable execution receipts.
  case 'google.event.create':keys.add('preferences');break;
  case 'google.event.deleteSeries':break;
  case 'agent.dispatch':project(a.projectId);for(const id of a.taskIds)task(id);for(const id of a.eventIds??[])row('events',id);break;
  default:keys.add('workspace'); // Complex aggregate mutations remain conservative.
 }
 return [...keys].sort();
}
export async function guardFor(action:AgentAction['action'],data:WorkspaceData,basis?:WorkspaceBasis):Promise<ActionGuard>{
 const source=basis??await captureWorkspaceBasis(data);
 return {version:1,actionHash:await hash(action),values:Object.fromEntries(keysFor(action,data).map(key=>[key,source[key]??null]))};
}
// An owner editing a proposal's project (name, colour) rewrites that project's
// fingerprint, which would block every sibling proposal referencing it as "대상이
// 변경됨". Only the project fingerprints are rebased onto the workspace the owner
// just created; every other guard value keeps detecting outside changes.
export function rebaseProjectValues(guard:ActionGuard,basis:WorkspaceBasis):ActionGuard{
 const values=Object.fromEntries(Object.entries(guard.values).map(([key,value])=>
  key.startsWith('projects:')||key.startsWith('projectName:')||key==='projects'?[key,basis[key]??null]:[key,value]));
 return {...guard,values};
}
export async function guardMatches(guard:ActionGuard,action:AgentAction['action'],data:WorkspaceData,basis?:WorkspaceBasis){
 if(guard.version!==1||guard.actionHash!==await hash(action))return false;
 const current=basis??await captureWorkspaceBasis(data);
 return Object.entries(guard.values).every(([key,value])=>(current[key]??null)===value);
}
