import type { WorkspaceData, Note, Task } from '../model.ts';
import { AgentError } from './errors.ts';
export interface AgentSource {
  title:string; label:string;
  id?:string; kind?:'note'|'task'|'project'|'goal'|'event'|'review'|'conversation'|'plaud'|'memory';
  recordId?:string; revision?:number; date?:string; excerpt?:string;
  scope?:'metadata'|'excerpt'|'full'; retrievedAt?:string;
}
export type EvidenceRegistry=Record<string,AgentSource>;
export function sourceRecord(kind:NonNullable<AgentSource['kind']>,recordId:string,title:string,excerpt:string,extra:Partial<AgentSource>={}):AgentSource {
  return {id:`${kind}:${recordId}${extra.revision?':v'+extra.revision:''}`,kind,recordId,title:title.slice(0,160),label:kind==='note'?'연결 기록':kind==='conversation'?'사용자 발언 · AI 답변 구분':kind==='memory'?'내가 확인한 기억':'저장된 기록',excerpt:excerpt.slice(0,1200),scope:'excerpt',retrievedAt:new Date().toISOString(),...extra};
}
export const noteSource=(note:Note,full=false)=>sourceRecord('note',note.id,note.title,full?note.body:note.summary,{revision:note.revision??1,date:note.updated,scope:full?'full':'metadata',label:full?`문서 v${note.revision??1}`:'문서 요약'});
export const taskSource=(task:Task)=>sourceRecord('task',task.id,task.title,JSON.stringify({title:task.title,status:task.status,due:task.due,definition:task.definition,blocker:task.blocker,dependsOn:task.dependsOn,outcome:task.outcome,actualMinutes:task.actualMinutes}),{date:task.completedOn??task.due});
export function addEvidence(registry:EvidenceRegistry,sources:AgentSource[]) {const added:AgentSource[]=[];for(const source of sources){if(!source.id)continue;if(Object.keys(registry).length>=420&&!registry[source.id])break;const rank={metadata:0,excerpt:1,full:2},old=registry[source.id];const selected=old&&(rank[old.scope??'excerpt']>rank[source.scope??'excerpt'])?old:source;registry[source.id]=selected;added.push(selected)}return added;}
export function catalogEvidence(data:WorkspaceData,registry:EvidenceRegistry) {
  return addEvidence(registry,[
    ...data.projects.slice(0,60).map(p=>sourceRecord('project',p.id,p.name,p.goal)),
    ...data.tasks.slice(0,100).map(taskSource),
    ...data.events.slice(0,150).map(e=>sourceRecord('event',e.id,e.title,JSON.stringify(e),{date:e.date})),
    ...data.notes.slice(0,60).map(n=>noteSource(n)),
    ...(data.goals??[]).slice(0,12).map(g=>sourceRecord('goal',g.id,g.sentence,JSON.stringify(g),{date:g.progress?.updatedOn})),
    ...data.reviews.slice(-14).map(r=>sourceRecord('review',r.date,`${r.date} 회고`,JSON.stringify(r),{date:r.date})),
    ...(data.memories??[]).slice(0,60).map(m=>sourceRecord('memory',m.id,m.kind==='reflection'?'자기 탐색 · 해석 자료':'내가 확인한 기억',m.statement,{date:m.updatedOn})),
  ]);
}
export function selectEvidence(registry:EvidenceRegistry,ids:string[]|undefined,legacy:AgentSource[]=[]){
  if(ids===undefined)return legacy.slice(0,20);
  if(ids.some(id=>!Object.prototype.hasOwnProperty.call(registry,id)))throw new AgentError('답변의 근거를 실제로 읽은 기록과 확인하지 못했습니다. 다시 요청해 주세요.','EVIDENCE_UNKNOWN',422);
  return [...new Set(ids)].map(id=>registry[id]);
}
