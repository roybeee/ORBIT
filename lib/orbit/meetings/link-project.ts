import {readWorkspace,type Database} from '../../../db/repository.ts';
import {AgentError} from '../agent/errors.ts';
import {findAction} from '../agent/repository.ts';
import {guardFor,withoutProject} from '../agent/action-guard.ts';
import type {AgentAction} from '../agent/types.ts';
import {actionSchema} from '../validation.ts';
import {mergedNotePrefix} from './merge.ts';
import {meetingReviewDetail} from './review-runtime.ts';
// A meeting may propose a "new" project that the owner already runs under another
// name. Linking closes that card without creating anything and moves the same
// meeting's task and event cards onto the chosen project. The existing project's
// goal and due date stay as they are.
function relinked(action:AgentAction['action'],draftId:string,projectId:string){
 if(action.type==='task.upsert'&&action.task.projectId===draftId)return {...action,task:{...action.task,projectId}};
 if(action.type==='event.upsert'&&action.event.projectId===draftId)return {...action,event:{...action.event,projectId}};
 return null;
}
export async function linkMeetingProject(db:Database,owner:string,noteId:string,actionId:string,projectId:string){
 const item=await findAction(db,owner,actionId),meeting=item.guard?.meeting;
 if(item.state!=='pending'||!meeting||meeting.noteId!==noteId)throw new AgentError('연결할 회의 결재안이 아닙니다.','CONFLICT',409);
 if(item.action.type!=='project.upsert')throw new AgentError('신규 프로젝트 결재안만 기존 프로젝트에 연결할 수 있습니다.','MEETING_LINK',422);
 const snapshot=await readWorkspace(db,owner),note=snapshot.data.notes.find(n=>n.id===noteId);
 if(!note||(note.revision??1)!==meeting.revision)throw new AgentError('회의록이 바뀌었습니다. 최신 분석을 확인해 주세요.','MEETING_CHANGED',409);
 const draftId=item.action.project.id;
 if(snapshot.data.projects.some(p=>p.id===draftId))throw new AgentError('이미 있는 프로젝트를 고치는 결재안입니다. 그대로 승인하거나 반려해 주세요.','MEETING_LINK',422);
 const target=snapshot.data.projects.find(p=>p.id===projectId);
 if(!target)throw new AgentError('연결할 프로젝트를 찾을 수 없습니다.','NOT_FOUND',404);
 const rows=await db.prepare("SELECT id FROM orbit_agent_actions WHERE owner_id=? AND turn_id=? AND state='pending' AND id<>?").bind(owner,item.turnId,item.id).all<{id:string}>();
 const siblings=(await Promise.all(rows.results.map(r=>findAction(db,owner,r.id)))).filter(s=>s.guard?.meeting?.noteId===noteId);
 const now=new Date().toISOString();
 const moved=siblings.flatMap(s=>{const next=relinked(s.action,draftId,projectId);return next?[{s,next}]:[]});
 const moves=await Promise.all(moved.map(async({s,next})=>{
  const validated=actionSchema.safeParse(next);
  if(!validated.success)throw new AgentError('연결한 결재안 형식 검증: '+validated.error.issues.slice(0,4).map(i=>i.path.join('.')+': '+i.message).join('; '),'MEETING_FORMAT',422);
  // The owner chose the project, as with the project picker in "수정 후 등록": the card
  // stops watching the draft project it will never create and keeps the rest of its
  // analysis-time basis, without starting to watch later edits of the chosen project.
  const guard={...withoutProject(s.guard!,draftId),actionHash:(await guardFor(validated.data,snapshot.data)).actionHash};
  // Runs after the close below, and only if that close landed.
  return db.prepare("UPDATE orbit_agent_actions SET action_json=?,guard_json=?,updated_at=? WHERE owner_id=? AND id=? AND state='pending' AND action_json=? AND guard_json=? AND EXISTS(SELECT 1 FROM orbit_agent_actions c WHERE c.owner_id=? AND c.id=? AND c.state='rejected' AND c.updated_at=?)").bind(JSON.stringify(validated.data),JSON.stringify(guard),now,owner,s.id,JSON.stringify(s.action),JSON.stringify(s.guard),owner,actionId,now);
 }));
 // A D1 batch does not roll back an UPDATE that matches nothing, so the close itself
 // checks that every card it moves is still as read; the moves then run only if it landed.
 const unchanged=moved.map(()=>" AND EXISTS(SELECT 1 FROM orbit_agent_actions s WHERE s.owner_id=? AND s.id=? AND s.state='pending' AND s.action_json=? AND s.guard_json=?)").join('');
 const close=db.prepare("UPDATE orbit_agent_actions SET state='rejected',note=?,updated_at=? WHERE owner_id=? AND id=? AND state='pending' AND action_json=?"+unchanged).bind(mergedNotePrefix+'기존 프로젝트 「'+target.name+'」에 연결',now,owner,actionId,JSON.stringify(item.action),...moved.flatMap(({s})=>[owner,s.id,JSON.stringify(s.action),JSON.stringify(s.guard)]));
 const results=await db.batch([close,...moves]);
 if(results.some(r=>r.meta?.changes!==1))throw new AgentError('결재안이 바뀌었습니다. 다시 확인해 주세요.','CONFLICT',409);
 return meetingReviewDetail(db,owner,noteId);
}
