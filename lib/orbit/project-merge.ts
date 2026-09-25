import {normalize} from './classify.ts';
import type {Project,WorkspaceData} from './model.ts';
import type {WeeklyAllocation} from './phase3-model.ts';

// Folding duplicate projects into one. The kept project keeps its own goal, due,
// priority, status and colour; only the name is chosen at merge time.
export interface ProjectMerge {targetId:string;sourceIds:string[];name:string}

export const MAX_SOURCES=20;
const MAX_KEYWORDS=12,MAX_STAGES=30,MAX_KEYWORD=40,MAX_MINUTES=10080,MAX_REASON=500;

export function projectMergeProblem(data:WorkspaceData,merge:ProjectMerge):string|null{
 const ids=new Set(merge.sourceIds);
 if(!ids.size||ids.has(merge.targetId)||ids.size!==merge.sourceIds.length)return '서로 다른 프로젝트를 2개 이상 선택해 주세요.';
 if(ids.size>MAX_SOURCES)return `한 번에 ${MAX_SOURCES+1}개까지 합칠 수 있습니다.`;
 if(![merge.targetId,...merge.sourceIds].every(id=>data.projects.some(p=>p.id===id)))return '합칠 프로젝트를 찾을 수 없습니다. 목록을 새로 고친 뒤 다시 선택해 주세요.';
 const stages=[merge.targetId,...merge.sourceIds].reduce((sum,id)=>sum+(data.projects.find(p=>p.id===id)?.milestones?.length??0),0);
 if(stages>MAX_STAGES)return `합치면 실행 단계가 ${stages}개가 됩니다. 프로젝트마다 ${MAX_STAGES}개까지라 먼저 단계를 정리해 주세요.`;
 const name=merge.name.trim();
 if(!name)return '합친 프로젝트의 이름을 입력해 주세요.';
 const clash=data.projects.find(p=>p.id!==merge.targetId&&!ids.has(p.id)&&normalize(p.name)===normalize(name));
 if(clash)return `같은 이름의 프로젝트(${clash.name})가 이미 있습니다. 함께 합치거나 다른 이름을 입력해 주세요.`;
 return null;
}

// Records point at a project through `projectId` / `projectIds` wherever they are
// nested (plans, briefs, drafts included). Rewriting by key name keeps a collection
// added later from silently pointing at a deleted project. Unchanged branches are
// returned as-is.
function remapIds(ids:unknown[],to:(id:string)=>string|undefined){
 const next=[...new Set(ids.map(id=>typeof id==='string'?to(id)??id:id))];
 return next.length===ids.length&&next.every((id,i)=>id===ids[i])?ids:next;
}
function remapRefs(value:unknown,to:(id:string)=>string|undefined):unknown{
 if(Array.isArray(value)){
  const next=value.map(v=>remapRefs(v,to));
  return next.some((v,i)=>v!==value[i])?next:value;
 }
 if(!value||typeof value!=='object')return value;
 const entries=Object.entries(value),next=entries.map(([key,v])=>[key,
  key==='projectId'&&typeof v==='string'?to(v)??v
  :key==='projectIds'&&Array.isArray(v)?remapIds(v,to)
  :key==='recordId'&&typeof v==='string'&&(value as {kind?:unknown}).kind==='project'?to(v)??v // plan evidence
  :remapRefs(v,to)] as const);
 return next.some(([,v],i)=>v!==entries[i][1])?Object.fromEntries(next):value;
}

// A week allows one allocation per project; the absorbed project's minutes join the kept entry.
function combineAllocations(week:WeeklyAllocation,targetId:string):WeeklyAllocation{
 const mine=week.allocations.filter(a=>a.projectId===targetId);
 if(mine.length<2)return week;
 // A paused entry must stay at 0 minutes, so a combined entry takes a working stance when one exists.
 const lead=mine.find(a=>a.stance!=='pause')??mine[0];
 const combined={...lead,
  minutes:Math.min(MAX_MINUTES,mine.reduce((sum,a)=>sum+a.minutes,0)),
  reason:[...new Set(mine.map(a=>a.reason.trim()).filter(Boolean))].join(' · ').slice(0,MAX_REASON)};
 return {...week,allocations:week.allocations.flatMap(a=>a.projectId!==targetId?[a]:a===mine[0]?[combined]:[])};
}

function mergedProject(target:Project,absorbed:Project[],name:string):Project{
 const words=[...(target.keywords??[]),...absorbed.flatMap(p=>[...(p.keywords??[]),p.name]),target.name]
  .map(w=>w.trim().slice(0,MAX_KEYWORD)).filter(w=>w&&normalize(w)!==normalize(name));
 const keywords=words.filter((w,i)=>words.findIndex(x=>normalize(x)===normalize(w))===i).slice(0,MAX_KEYWORDS);
 const milestones=[target,...absorbed].flatMap(p=>p.milestones??[]);
 const nextTaskId=target.nextTaskId??absorbed.find(p=>p.nextTaskId)?.nextTaskId;
 return {...target,name,
  ...(keywords.length?{keywords}:{}),
  ...(milestones.length?{milestones}:{}),
  ...(nextTaskId?{nextTaskId}:{})};
}

// Pure: returns a new workspace. Callers check projectMergeProblem first.
export function mergeProjects(data:WorkspaceData,merge:ProjectMerge):WorkspaceData{
 const sources=new Set(merge.sourceIds),to=(id:string)=>sources.has(id)?merge.targetId:undefined;
 const target=data.projects.find(p=>p.id===merge.targetId)!,absorbed=data.projects.filter(p=>sources.has(p.id));
 const {projects,dominoProjectId,...records}=data;
 const moved=remapRefs(records,to) as typeof records;
 const kept=mergedProject(target,absorbed,merge.name.trim());
 return {
  ...moved,
  projects:projects.filter(p=>!sources.has(p.id)).map(p=>p.id===target.id?kept:p),
  ...(moved.weeklyAllocations?{weeklyAllocations:moved.weeklyAllocations.map(w=>combineAllocations(w,target.id))}:{}),
  ...(dominoProjectId?{dominoProjectId:to(dominoProjectId)??dominoProjectId}:{}),
 };
}

export function projectMergePreview(data:WorkspaceData,sourceIds:string[]){
 const ids=new Set(sourceIds),count=(rows:{projectId?:string}[]|undefined)=>(rows??[]).filter(r=>r.projectId&&ids.has(r.projectId)).length;
 return {
  tasks:count(data.tasks),events:count(data.events),notes:count(data.notes),
  others:count(data.decisions)+count(data.delegations)+count(data.meetingRecords)+count(data.risks)+count(data.experiments)+count(data.operatingMetrics),
 };
}

// Suggest projects that look like one project entered twice: the same name once
// spacing and symbols are ignored, or one name containing another (3+ letters).
export function duplicateProjectGroups(projects:Project[]):Project[][]{
 const keys=projects.map(p=>normalize(p.name));
 const alike=(a:string,b:string)=>a===b||Math.min(a.length,b.length)>=3&&(a.includes(b)||b.includes(a));
 const parent=projects.map((_,i)=>i),root=(i:number):number=>parent[i]===i?i:root(parent[i]);
 keys.forEach((a,i)=>keys.forEach((b,j)=>{if(j>i&&a&&b&&alike(a,b))parent[root(j)]=root(i)}));
 const groups=new Map<number,Project[]>();
 projects.forEach((p,i)=>groups.set(root(i),[...(groups.get(root(i))??[]),p]));
 return [...groups.values()].filter(g=>g.length>1);
}
