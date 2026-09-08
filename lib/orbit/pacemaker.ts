import type { WorkspaceData, Task, PersonalMemory } from './model.ts';
import { goalAllowsWork, goalPace } from './chief.ts';
import { addDays } from './dates.ts';

export type QuestState = 'ready' | 'doing' | 'blocked' | 'waiting' | 'held' | 'paused' | 'done';
export function questReadiness(data:WorkspaceData,task:Task,date:string):{state:QuestState;reason:string;canStart:boolean} {
  if(task.status==='done')return {state:'done',reason:task.completedOn?`${task.completedOn} 완료`:'완료 기록',canStart:false};
  if(!goalAllowsWork(data,task.projectId))return {state:'paused',reason:'연결 목표가 보류 또는 달성 상태입니다.',canStart:false};
  if(task.planHoldUntil&&task.planHoldUntil>date)return {state:'held',reason:`${task.planHoldUntil}까지 보류 · ${task.planHoldReason??'다음 검토를 기다립니다.'}`,canStart:false};
  const blockers=(task.dependsOn??[]).filter(id=>data.tasks.find(t=>t.id===id)?.status!=='done');
  if(blockers.length)return {state:'blocked',reason:'먼저 완료: '+blockers.map(id=>data.tasks.find(t=>t.id===id)?.title??'찾을 수 없는 선행 퀘스트').join(' · '),canStart:false};
  if(task.status==='waiting'||task.blocker?.trim())return {state:'waiting',reason:task.blocker||'필요한 답변이나 조건을 기다립니다.',canStart:false};
  const active=data.tasks.find(t=>t.id!==task.id&&t.startedAt&&t.status!=='done');
  if(active)return {state:'held',reason:`‘${active.title}’ 집중 세션을 먼저 마쳐주세요.`,canStart:false};
  return {state:task.startedAt||task.status==='doing'?'doing':'ready',reason:task.startedAt?'집중 세션 진행 중':task.status==='doing'?'진행 중 · 다음 단계를 이어갈 수 있습니다.':'지금 시작할 수 있습니다.',canStart:true};
}
export function goalDescendants(data:WorkspaceData,id:string) {
  const found=new Set([id]);let changed=true;
  while(changed){changed=false;for(const goal of data.goals??[])if(goal.parentId&&found.has(goal.parentId)&&!found.has(goal.id)){found.add(goal.id);changed=true}}
  return found;
}
export function goalDashboard(data:WorkspaceData,date:string) {
  return (data.goals??[]).map(goal=>{
    const ids=goalDescendants(data,goal.id),projects=data.projects.filter(p=>!!p.goalId&&ids.has(p.goalId)),projectIds=new Set(projects.map(p=>p.id));
    const quests=data.tasks.filter(t=>projectIds.has(t.projectId)).map(task=>({task,...questReadiness(data,task,date)}));
    const done=quests.filter(q=>q.state==='done').length;
    return {goal,projects,quests,done,total:quests.length,ratio:quests.length?done/quests.length:0,pace:goalPace(goal,date),ready:quests.filter(q=>q.canStart),blocked:quests.filter(q=>['blocked','waiting','held','paused'].includes(q.state)),notes:data.notes.filter(n=>projectIds.has(n.projectId))};
  });
}
export function memorySignature(data:WorkspaceData,source:PersonalMemory['sources'][number]) {
  const record=source.kind==='note'?data.notes.find(n=>n.id===source.id):source.kind==='task'?data.tasks.find(t=>t.id===source.id):data.reviews.find(r=>r.date===source.id);
  if(!record)return '';
  const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
  // Change detector, not an authentication or cryptographic signature.
  const text=JSON.stringify(stable(source.kind==='note'?{revision:(record as {revision?:number}).revision??1}:record));let a=2166136261,b=5381;
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
  return (a>>>0).toString(16)+':'+(b>>>0).toString(16);
}
export function memoryAvailable(data:WorkspaceData,memory:PersonalMemory) {
  return memory.sources.every(s=>{const signature=memorySignature(data,s);if(!signature)return false;if(s.signature&&s.signature!==signature)return false;return s.kind!=='note'||s.revision===undefined||data.notes.some(n=>n.id===s.id&&(n.revision??1)===s.revision);});
}
export function personalContext(data:WorkspaceData,date:string) {
  const memories=(data.memories??[]).filter(m=>memoryAvailable(data,m));
  const since=addDays(date,-30);
  const measured=data.tasks.filter(t=>t.status==='done'&&t.outcome==='done'&&typeof t.actualMinutes==='number'&&t.actualMinutes>0&&t.duration>0&&t.completedOn&&t.completedOn>=since&&t.completedOn<=date).sort((a,b)=>b.completedOn!.localeCompare(a.completedOn!));
  const ratios=measured.map(t=>t.actualMinutes!/t.duration).sort((a,b)=>a-b),mid=Math.floor(ratios.length/2);
  const median=ratios.length>=5?Math.round((ratios.length%2?ratios[mid]:(ratios[mid-1]+ratios[mid])/2)*100)/100:null;
  const factor=median===null?null:Math.max(.5,Math.min(2,median));
  const friction=data.tasks.filter(t=>t.outcome&&t.outcome!=='done'&&t.outcomeReason&&t.outcomeOn&&t.outcomeOn>=since&&t.outcomeOn<=date);
  const reasons=Object.entries(friction.reduce<Record<string,number>>((acc,t)=>{acc[t.outcomeReason!]=(acc[t.outcomeReason!]??0)+1;return acc},{})).sort((a,b)=>b[1]-a[1]);
  return {confirmed:memories.filter(m=>m.kind!=='reflection'),reflection:memories.filter(m=>m.kind==='reflection'),needsReview:(data.memories??[]).filter(m=>!memoryAvailable(data,m)),learning:{since,through:date,samples:measured.length,factor,median,taskIds:measured.slice(0,30).map(t=>t.id),topFriction:reasons[0]?{reason:reasons[0][0],count:reasons[0][1],taskIds:friction.filter(t=>t.outcomeReason===reasons[0][0]).slice(0,10).map(t=>t.id)}:null},rules:(data.improvements??[]).filter(r=>r.active)};
}
// A bounded, ordered dependency map. Off-screen prerequisites remain explicit stubs.
export function questMap(data:WorkspaceData,tasks:Task[],limit=36) {
  const visible=tasks.slice(0,limit),ids=new Set(visible.map(t=>t.id));
  const externalIds=[...new Set(visible.flatMap(t=>t.dependsOn??[]).filter(id=>!ids.has(id)))];
  const external=externalIds.slice(0,12).map(id=>({id,title:data.tasks.find(t=>t.id===id)?.title??'선행 퀘스트',external:true,task:data.tasks.find(t=>t.id===id)}));
  const all=[...external,...visible.map(task=>({id:task.id,title:task.title,external:false,task}))];
  const ranks=new Map<string,number>(),visiting=new Set<string>();
  const rank=(id:string):number=>{if(ranks.has(id))return ranks.get(id)!;if(visiting.has(id))return 0;visiting.add(id);const node=all.find(n=>n.id===id);const dependencies=node?.external?[]:(node?.task?.dependsOn??[]).filter(id=>all.some(n=>n.id===id));const value=dependencies.length?1+Math.max(...dependencies.map(rank)):0;visiting.delete(id);ranks.set(id,value);return value};
  for(const n of all)rank(n.id);
  const rows=new Map<number,number>();
  const nodes=all.map(n=>{const level=ranks.get(n.id)??0,row=rows.get(level)??0;rows.set(level,row+1);return {...n,level,x:30+level*240,y:30+row*106}});
  const edges=visible.flatMap(t=>(t.dependsOn??[]).filter(id=>all.some(n=>n.id===id)).map(id=>({from:id,to:t.id})));
  return {nodes,edges,width:Math.max(760,Math.max(0,...nodes.map(n=>n.x))+240),height:Math.max(210,Math.max(0,...nodes.map(n=>n.y))+110),omitted:Math.max(0,tasks.length-visible.length),omittedPrerequisites:Math.max(0,externalIds.length-external.length)};
}
