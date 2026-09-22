import {readWorkspace,type Database} from '../../../db/repository.ts';
import {AgentError} from '../agent/errors.ts';
import {findAction} from '../agent/repository.ts';
import {guardFor} from '../agent/action-guard.ts';
import type {AgentAction} from '../agent/types.ts';
import type {Task,CalendarEvent} from '../model.ts';
import {actionSchema} from '../validation.ts';
// Two approval cards from one meeting analysis may describe a single commitment
// (or two linked ones). Merging folds the second card into the first so the
// owner approves one registration. The absorbed card keeps its original action
// so a re-analysis still recognises it as already handled.
export const mergedNotePrefix='통합됨 · ';
const dueNotice='[마감일 확인 필요] 원문에 마감일이 없습니다. 승인 전에 날짜를 지정해 주세요.';
const joinText=(base:string|undefined,extra:string,max:number)=>[base?.trim(),extra].filter(Boolean).join('\n').slice(0,max);
export function mergeMeetingActions(primary:AgentAction,secondary:AgentAction){
 const a=primary.action,b=secondary.action;
 if(a.type!==b.type||!(a.type==='task.upsert'||a.type==='event.upsert'))throw new AgentError('같은 종류의 할 일 또는 일정끼리만 통합할 수 있습니다.','MEETING_MERGE',422);
 const reason=(primary.reason+'\n[통합된 결재안] '+secondary.title+'\n'+secondary.reason).slice(0,4000);
 if(a.type==='task.upsert'&&b.type==='task.upsert'){
  const needsDue=!!primary.guard?.meeting?.needsDue,otherNeedsDue=!!secondary.guard?.meeting?.needsDue;
  const due=needsDue&&!otherNeedsDue?b.task.due:!needsDue&&otherNeedsDue?a.task.due:a.task.due<b.task.due?a.task.due:b.task.due;
  const task={...a.task,due,duration:Math.min(480,a.task.duration+b.task.duration),impact:Math.max(a.task.impact,b.task.impact),definition:joinText(a.task.definition,'[통합] '+secondary.title+(b.task.definition.trim()?': '+b.task.definition.trim():''),4000)};
  return {action:{...a,task},needsDue:needsDue&&otherNeedsDue,reason:needsDue&&!otherNeedsDue?reason.replace(dueNotice,'통합한 결재안의 마감일 '+due+'을 사용합니다.'):reason};
 }
 if(a.type!=='event.upsert'||b.type!=='event.upsert')throw new AgentError('같은 종류의 할 일 또는 일정끼리만 통합할 수 있습니다.','MEETING_MERGE',422);
 const sameDay=a.event.date===b.event.date;
 const event={...a.event,start:sameDay?Math.min(a.event.start,b.event.start):a.event.start,end:sameDay?Math.max(a.event.end,b.event.end):a.event.end,description:joinText(a.event.description,'[통합] '+secondary.title+(b.event.description?.trim()?'\n'+b.event.description.trim():''),20000)};
 return {action:{...a,event},needsDue:false,reason};
}
export type MergeTarget={kind:'proposal',id:string}|{kind:'task'|'event',id:string};
// Folding a card into a record that is already registered turns the card into
// an update of that record: the card keeps waiting for approval, and the guard
// now also watches the target record so a concurrent edit blocks the update.
export function mergeIntoExisting(primary:AgentAction,target:Task|CalendarEvent,kind:'task'|'event'){
 const a=primary.action;
 if(a.type!=='task.upsert'&&a.type!=='event.upsert')throw new AgentError('같은 종류의 할 일 또는 일정끼리만 통합할 수 있습니다.','MEETING_MERGE',422);
 if((a.type==='task.upsert')!==(kind==='task'))throw new AgentError('같은 종류의 할 일 또는 일정끼리만 통합할 수 있습니다.','MEETING_MERGE',422);
 const label=kind==='task'?'[기존 할 일에 통합] ':'[기존 일정에 통합] ';
 const reason=(label+target.title+'\n'+primary.reason).slice(0,4000);
 if(a.type==='task.upsert'){
  const old=target as Task;
  if(old.status==='done')throw new AgentError('완료된 할 일에는 통합할 수 없습니다.','MEETING_MERGE',422);
  const needsDue=!!primary.guard?.meeting?.needsDue,due=needsDue?old.due:old.due<a.task.due?old.due:a.task.due;
  const task={...old,due,duration:Math.min(480,old.duration+a.task.duration),impact:Math.max(old.impact,a.task.impact),definition:joinText(old.definition,'[통합] '+primary.title+(a.task.definition.trim()?': '+a.task.definition.trim():''),4000),noteId:old.noteId??a.task.noteId,noteCitation:old.noteCitation};
  return {action:{type:'task.upsert' as const,task,autoAssign:false},title:old.title,needsDue:false,reason:needsDue?reason.replace(dueNotice,'기존 할 일의 마감일 '+due+'을 사용합니다.'):reason};
 }
 const old=target as CalendarEvent,sameDay=old.date===a.event.date;
 const event={...old,start:sameDay?Math.min(old.start,a.event.start):old.start,end:sameDay?Math.max(old.end,a.event.end):old.end,description:joinText(old.description,'[통합] '+primary.title+(a.event.description?.trim()?'\n'+a.event.description.trim():''),20000)};
 return {action:{type:'event.upsert' as const,event},title:old.title,needsDue:false,reason};
}
export async function mergeMeetingProposals(db:Database,owner:string,noteId:string,actionId:string,into:string|MergeTarget){
 const target:MergeTarget=typeof into==='string'?{kind:'proposal',id:into}:into;
 if(target.kind!=='proposal')return mergeIntoRecord(db,owner,noteId,actionId,target);
 const mergeId=target.id;
 if(actionId===mergeId)throw new AgentError('서로 다른 결재안을 선택해 주세요.');
 const [primary,secondary]=await Promise.all([findAction(db,owner,actionId),findAction(db,owner,mergeId)]);
 for(const item of [primary,secondary])if(item.state!=='pending'||!item.guard?.meeting||item.guard.meeting.noteId!==noteId)throw new AgentError('통합할 회의 결재안이 아닙니다.','CONFLICT',409);
 const meeting=primary.guard!.meeting!,other=secondary.guard!.meeting!;
 if(meeting.revision!==other.revision)throw new AgentError('같은 분석의 결재안끼리만 통합할 수 있습니다.','CONFLICT',409);
 const snapshot=await readWorkspace(db,owner),note=snapshot.data.notes.find(n=>n.id===noteId);
 if(!note||(note.revision??1)!==meeting.revision)throw new AgentError('회의록이 바뀌었습니다. 최신 분석을 확인해 주세요.','MEETING_CHANGED',409);
 const merged=mergeMeetingActions(primary,secondary),validated=actionSchema.safeParse(merged.action);
 if(!validated.success)throw new AgentError('통합한 결재안 형식 검증: '+validated.error.issues.slice(0,4).map(i=>i.path.join('.')+': '+i.message).join('; '),'MEETING_FORMAT',422);
 // The analysis-time basis of both cards stays authoritative, as in setMeetingDue.
 const guard={...await guardFor(validated.data,snapshot.data),meeting:{...meeting,needsDue:merged.needsDue},values:{...secondary.guard!.values,...primary.guard!.values}};
 const now=new Date().toISOString(),oldPrimary=JSON.stringify(primary.action),oldSecondary=JSON.stringify(secondary.action),next=JSON.stringify(validated.data);
 const results=await db.batch([
  db.prepare("UPDATE orbit_agent_actions SET action_json=?,guard_json=?,reason=?,updated_at=? WHERE owner_id=? AND id=? AND state='pending' AND action_json=? AND guard_json=? AND EXISTS(SELECT 1 FROM orbit_agent_actions b WHERE b.owner_id=? AND b.id=? AND b.state='pending' AND b.action_json=?)").bind(next,JSON.stringify(guard),merged.reason,now,owner,actionId,oldPrimary,JSON.stringify(primary.guard),owner,mergeId,oldSecondary),
  db.prepare("UPDATE orbit_agent_actions SET state='rejected',note=?,updated_at=? WHERE owner_id=? AND id=? AND state='pending' AND action_json=? AND EXISTS(SELECT 1 FROM orbit_agent_actions a WHERE a.owner_id=? AND a.id=? AND a.state='pending' AND a.action_json=?)").bind(mergedNotePrefix+primary.title,now,owner,mergeId,oldSecondary,owner,actionId,next)
 ]);
 if(results.some(r=>r.meta?.changes!==1))throw new AgentError('결재안이 바뀌었습니다. 다시 확인해 주세요.','CONFLICT',409);
}
async function mergeIntoRecord(db:Database,owner:string,noteId:string,actionId:string,target:{kind:'task'|'event';id:string}){
 const primary=await findAction(db,owner,actionId),meeting=primary.guard?.meeting;
 if(primary.state!=='pending'||!meeting||meeting.noteId!==noteId)throw new AgentError('통합할 회의 결재안이 아닙니다.','CONFLICT',409);
 const snapshot=await readWorkspace(db,owner),note=snapshot.data.notes.find(n=>n.id===noteId);
 if(!note||(note.revision??1)!==meeting.revision)throw new AgentError('회의록이 바뀌었습니다. 최신 분석을 확인해 주세요.','MEETING_CHANGED',409);
 const record=target.kind==='task'?snapshot.data.tasks.find(t=>t.id===target.id):snapshot.data.events.find(e=>e.id===target.id);
 if(!record)throw new AgentError('통합할 기존 '+(target.kind==='task'?'할 일':'일정')+'을 찾을 수 없습니다.','NOT_FOUND',404);
 const merged=mergeIntoExisting(primary,record,target.kind),validated=actionSchema.safeParse(merged.action);
 if(!validated.success)throw new AgentError('통합한 결재안 형식 검증: '+validated.error.issues.slice(0,4).map(i=>i.path.join('.')+': '+i.message).join('; '),'MEETING_FORMAT',422);
 // Fresh values for the target record; the analysis-time basis of the card stays authoritative for its own keys.
 const fresh=await guardFor(validated.data,snapshot.data);
 const guard={...fresh,meeting:{...meeting,needsDue:false},values:{...fresh.values,...primary.guard!.values}};
 const result=await db.prepare("UPDATE orbit_agent_actions SET action_json=?,guard_json=?,title=?,reason=?,updated_at=? WHERE owner_id=? AND id=? AND state='pending' AND action_json=? AND guard_json=?").bind(JSON.stringify(validated.data),JSON.stringify(guard),merged.title.slice(0,200),merged.reason,new Date().toISOString(),owner,actionId,JSON.stringify(primary.action),JSON.stringify(primary.guard)).run();
 if(result.meta?.changes!==1)throw new AgentError('결재안이 바뀌었습니다. 다시 확인해 주세요.','CONFLICT',409);
}
