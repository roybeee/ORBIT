import type {WorkspaceData,Task,Proposal} from './model.ts';
import type {WorkspaceAction} from './validation.ts';
import {todayInZone,addDays} from './dates.ts';
import {meetingCandidates} from './meeting.ts';
import {focusIds} from './derived.ts';
import {generateProposal,approveProposalItem,overlaps} from './planner.ts';
export class DomainError extends Error{}
const fail=(message:string):never=>{throw new DomainError(message)};
function replace<T extends {id:string}>(list:T[],record:T){return list.some(x=>x.id===record.id)?list.map(x=>x.id===record.id?record:x):[...list,record]}
export function validateLinks(data:WorkspaceData){
 const projectIds=new Set(data.projects.map(p=>p.id));const taskIds=new Set(data.tasks.map(t=>t.id));const noteIds=new Set(data.notes.map(n=>n.id));
 for(const t of data.tasks){if(!projectIds.has(t.projectId))fail('연결할 프로젝트가 없습니다.');if(t.noteId&&!noteIds.has(t.noteId))fail('연결할 기록이 없습니다.');for(const id of t.dependsOn??[])if(id===t.id||!taskIds.has(id))fail('선행 작업을 확인해 주세요.')}
 const visit=(id:string,seen:Set<string>,done:Set<string>)=>{if(seen.has(id))fail('선행 작업이 순환하고 있습니다.');if(done.has(id))return;seen.add(id);for(const dep of data.tasks.find(t=>t.id===id)?.dependsOn??[])visit(dep,seen,done);seen.delete(id);done.add(id)};const done=new Set<string>();for(const t of data.tasks)visit(t.id,new Set(),done);
 for(const n of data.notes)if(!projectIds.has(n.projectId))fail('기록의 프로젝트를 확인해 주세요.');
 for(const e of data.events){if(e.projectId&&!projectIds.has(e.projectId))fail('일정의 프로젝트를 확인해 주세요.');if(e.taskId&&!taskIds.has(e.taskId))fail('일정의 할 일을 확인해 주세요.')}
}
export function applyAction(current:WorkspaceData,action:WorkspaceAction,now=new Date()):WorkspaceData{
 const data=structuredClone(current);const today=todayInZone(data.preferences.timeZone,now);
 const task=(id:string)=>data.tasks.find(t=>t.id===id)??fail('할 일을 찾을 수 없습니다.');
 const proposal=(date:string)=>data.proposals.find(p=>p.date===date)??fail('제안을 먼저 생성해 주세요.');
 const saveProposal=(p:Proposal)=>{data.proposals=replace(data.proposals,p)};
 switch(action.type){
 case 'project.upsert':data.projects=replace(data.projects,action.project);break;
 case 'project.delete':if(data.tasks.some(t=>t.projectId===action.id)||data.notes.some(n=>n.projectId===action.id)||data.events.some(e=>e.projectId===action.id))fail('연결된 할 일·기록·일정을 먼저 정리해 주세요.');data.projects=data.projects.filter(p=>p.id!==action.id);break;
 case 'task.upsert':{const t={...action.task};const old=data.tasks.find(x=>x.id===t.id);t.noteCitation=old?.noteId===t.noteId?old?.noteCitation:undefined;if(t.focus){t.focusDate=t.focusDate??today;if(data.tasks.filter(x=>x.id!==t.id&&x.focus&&x.focusDate===t.focusDate&&x.status!=='done').length>=data.preferences.focusLimit)fail('핵심 결과물 개수를 초과했습니다. 기존 항목을 조정해 주세요.')}if(t.status==='done')t.completedOn=t.completedOn??today;data.tasks=replace(data.tasks,t);for(const e of data.events.filter(e=>e.taskId===t.id)){e.title=t.title;e.projectId=t.projectId}break;}
 case 'task.status':{const t=task(action.id);t.status=action.status;t.completedOn=action.status==='done'?today:undefined;break;}
 case 'task.focus':{const t=task(action.id);if(action.focus&&data.tasks.filter(x=>x.id!==t.id&&x.focus&&x.focusDate===today&&x.status!=='done').length>=data.preferences.focusLimit)fail('오늘의 핵심 결과물이 충분합니다. 먼저 다른 항목을 해제해 주세요.');if(action.focus&&t.planHoldUntil&&t.planHoldUntil>today)fail('아직 보류 중인 업무입니다. 제안 화면에서 먼저 다시 검토해 주세요.');t.focus=action.focus;t.focusDate=action.focus?today:undefined;break;}
 case 'task.delete':if(data.tasks.some(t=>t.dependsOn?.includes(action.id)))fail('다른 업무의 선행 작업입니다. 연결을 먼저 해제해 주세요.');data.tasks=data.tasks.filter(t=>t.id!==action.id);data.events=data.events.filter(e=>e.taskId!==action.id);for(const p of data.proposals){p.items=p.items.filter(i=>i.taskId!==action.id);p.unscheduled=p.unscheduled.filter(id=>id!==action.id)}break;
 case 'note.upsert':data.notes=replace(data.notes,{...action.note,updated:today,revision:(data.notes.find(n=>n.id===action.note.id)?.revision??(data.notes.some(n=>n.id===action.note.id)?1:0))+1,bodyStored:false});break;
 case 'note.restore':fail('이전 내용은 서버에서 확인한 뒤 복원해 주세요.');break;
 case 'meeting.acceptActions':{
  const note=data.notes.find(n=>n.id===action.noteId)??fail('회의록을 찾을 수 없습니다.');
  if((note.revision??1)!==action.expectedNoteRevision)fail('회의록이 변경됐습니다. 최신 내용을 확인해 주세요.');
  const candidates=meetingCandidates(note);
  for(const item of action.items){
   const source=candidates.find(c=>c.line===item.line)??fail('원문에서 해당 행동을 확인할 수 없습니다.');
   if(data.tasks.some(t=>t.noteId===note.id&&t.noteCitation&&(t.noteCitation.quote===source.quote||(t.noteCitation.revision===action.expectedNoteRevision&&t.noteCitation.line===item.line))))continue;
   if(data.tasks.some(t=>t.id===item.id))fail('이미 사용 중인 할 일 번호입니다.');
   data.tasks.push({id:item.id,title:item.title,projectId:note.projectId,status:'todo',duration:item.duration,due:item.due,impact:3,focus:false,definition:item.definition,noteId:note.id,noteCitation:{revision:action.expectedNoteRevision,line:item.line,quote:source.quote}});
  }break;
 }
 case 'note.delete':if(data.tasks.some(t=>t.noteId===action.id))fail('이 기록을 참조하는 할 일이 있습니다. 연결을 먼저 해제해 주세요.');data.notes=data.notes.filter(n=>n.id!==action.id);break;
 case 'event.upsert':{const e=action.event;if(e.id.startsWith('google:'))fail('Google 일정은 원본 캘린더에서 수정해 주세요.');if(e.id.startsWith('approved:'))fail('승인한 집중 시간은 제안 화면에서 조정해 주세요.');if(data.events.some(x=>x.id!==e.id&&x.date===e.date&&overlaps(x,e)))fail('같은 시간에 다른 일정이 있습니다.');data.events=replace(data.events,e);break;}
 case 'event.attach':{if(!data.events.some(e=>e.id===action.id))fail('첨부할 일정을 찾을 수 없습니다.');break;}
 case 'event.delete':{if(action.id.startsWith('google:'))fail('Google 일정은 원본 캘린더에서 삭제해 주세요.');if(action.id.startsWith('approved:'))fail('집중 시간은 제안 화면에서 승인을 취소해 주세요.');data.events=data.events.filter(e=>e.id!==action.id);break;}
 case 'review.saveGenerate':{if(action.review.date>today)fail('미래 날짜의 회고는 아직 기록할 수 없습니다.');data.reviews=replace(data.reviews,{...action.review,id:action.review.date,completedIds:data.tasks.filter(t=>t.completedOn===action.review.date&&t.status==='done').map(t=>t.id),updatedAt:now.toISOString()});const date=addDays(action.review.date,1);saveProposal(generateProposal(data.tasks,data.events,date,action.review.energy,data.proposals.find(p=>p.date===date),data.preferences));break;}
 case 'proposal.generate':saveProposal(generateProposal(data.tasks,data.events,action.date,action.energy,data.proposals.find(p=>p.date===action.date),data.preferences));break;
 case 'proposal.approve':{const p=proposal(action.date);if(p.date<today)fail('지난 날짜의 제안은 승인할 수 없습니다.');const item=p.items.find(i=>i.id===action.itemId)??fail('제안 항목을 찾을 수 없습니다.');const count=data.tasks.filter(t=>t.id!==item.taskId&&focusIds(data,p.date).has(t.id)&&t.status!=='done').length;if(item.state!=='approved'&&count>=data.preferences.focusLimit)fail('이미 지정한 핵심 결과물이 있습니다. 먼저 계획을 조정해 주세요.');const out=approveProposalItem(p,action.itemId,data.tasks,data.events);if(out.error)fail(out.error);saveProposal(out.proposal);data.events=out.events;const t=task(item.taskId);if(!t.focus){t.focus=true;t.focusDate=p.date}delete t.planHoldUntil;delete t.planHoldReason;delete t.planHoldProposalId;break;}
 case 'proposal.defer':{const p=proposal(action.date),item=p.items.find(i=>i.id===action.itemId)??fail('제안 항목이 없습니다.');if(item.state==='approved')fail('먼저 승인을 취소해 주세요.');if(action.revisitDate<=p.date)fail('다음 검토일은 계획 날짜 이후로 지정해 주세요.');item.state='deferred';item.deferReason=action.reason;item.revisitDate=action.revisitDate;const t=task(item.taskId);t.planHoldUntil=action.revisitDate;t.planHoldReason=action.reason;t.planHoldProposalId=p.id;break;}
 case 'proposal.reconsider':{const item=proposal(action.date).items.find(i=>i.id===action.itemId)??fail('제안 항목이 없습니다.');if(item.state!=='deferred')fail('보류한 항목만 다시 검토할 수 있습니다.');item.state='pending';delete item.deferReason;delete item.revisitDate;const t=task(item.taskId);if(t.planHoldProposalId===proposal(action.date).id){delete t.planHoldUntil;delete t.planHoldReason;delete t.planHoldProposalId}break;}
 case 'proposal.revoke':{const p=proposal(action.date),item=p.items.find(i=>i.id===action.itemId)??fail('제안 항목이 없습니다.');if(item.state!=='approved')fail('승인한 항목만 취소할 수 있습니다.');item.state='pending';data.events=data.events.filter(e=>e.id!==`approved:${item.id}`);const t=task(item.taskId);if(t.focusDate===p.date){t.focus=false;t.focusDate=undefined}break;}
 case 'preferences.update':data.preferences={...action.preferences,workDays:[...new Set(action.preferences.workDays)]};break;
 }
 validateLinks(data);
 if(new TextEncoder().encode(JSON.stringify({...data,notes:data.notes.map(n=>({...n,body:''}))})).byteLength>950000)fail('현재 저장 용량에 가까워졌습니다. 기록을 내보내고 오래된 내용을 정리해 주세요.');
 return data;
}
