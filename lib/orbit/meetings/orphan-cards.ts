import {readWorkspace,type Database} from '../../../db/repository.ts';
import {findAction} from '../agent/repository.ts';
import {guardFor,withoutProject} from '../agent/action-guard.ts';
import type {AgentAction} from '../agent/types.ts';

// Points a meeting task or event card at another project (used by "기존 프로젝트에 연결" and below).
export function relinked(action:AgentAction['action'],draftId:string,projectId:string){
 if(action.type==='task.upsert'&&action.task.projectId===draftId)return {...action,task:{...action.task,projectId}};
 if(action.type==='event.upsert'&&action.event.projectId===draftId)return {...action,event:{...action.event,projectId}};
 return null;
}
const projectOf=(action:AgentAction['action'])=>action.type==='task.upsert'?action.task.projectId:action.type==='event.upsert'?action.event.projectId:undefined;
export const ORPHAN_NOTICE='[프로젝트 확인 필요] 함께 제안된 새 프로젝트가 없어 회의록의 프로젝트로 옮겼습니다. 다른 프로젝트로 바꾸려면 수정 후 등록에서 고르세요.\n';

// A meeting card can depend on a new project proposed with it. Once that proposal is rejected (or
// gone), the card could never be approved. Such cards move to the meeting note's own project with a
// notice and stop watching the project that will never exist. Returns the ids of the cards moved.
export async function rehomeOrphanCards(db:Database,owner:string,noteId?:string){
 const {results}=await db.prepare("SELECT id FROM orbit_agent_actions WHERE owner_id=? AND state='pending' AND json_extract(guard_json,'$.meeting.noteId') IS NOT NULL AND (? IS NULL OR json_extract(guard_json,'$.meeting.noteId')=?)").bind(owner,noteId??null,noteId??null).all<{id:string}>();
 if(!results.length)return [];
 const cards=await Promise.all(results.map(r=>findAction(db,owner,r.id)));
 const data=(await readWorkspace(db,owner)).data;
 const proposed=new Set(cards.flatMap(c=>c.action.type==='project.upsert'?[c.action.project.id]:[]));
 const moved:string[]=[];
 for(const card of cards){
  const draftId=projectOf(card.action),note=data.notes.find(n=>n.id===card.guard?.meeting?.noteId);
  if(!draftId||!note||data.projects.some(p=>p.id===draftId)||proposed.has(draftId)||!data.projects.some(p=>p.id===note.projectId))continue;
  const next=relinked(card.action,draftId,note.projectId);if(!next)continue;
  const guard={...withoutProject(card.guard!,draftId),actionHash:(await guardFor(next,data)).actionHash};
  const reason=card.reason.startsWith('[프로젝트 확인 필요]')?card.reason:(ORPHAN_NOTICE+card.reason).slice(0,4000);
  const result=await db.prepare("UPDATE orbit_agent_actions SET action_json=?,guard_json=?,reason=?,updated_at=? WHERE owner_id=? AND id=? AND state='pending' AND action_json=? AND guard_json=?")
   .bind(JSON.stringify(next),JSON.stringify(guard),reason,new Date().toISOString(),owner,card.id,JSON.stringify(card.action),JSON.stringify(card.guard)).run();
  if(result.meta?.changes===1)moved.push(card.id);
 }
 return moved;
}
