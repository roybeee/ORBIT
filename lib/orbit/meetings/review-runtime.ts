import {readWorkspace,readNote,type Database} from '../../../db/repository.ts';
import type {Runtime} from '../agent/integrations.ts';
import {runAgent} from '../agent/runner.ts';
import {AgentError} from '../agent/errors.ts';
import {enqueueMeetingStatement} from './review.ts';
import {toAction} from '../agent/repository.ts';
export async function requestMeetingReview(db:Database,owner:string,noteId:string,retry=false){
 const note=await readNote(db,owner,noteId);if(note.kind!=='meeting'||!note.body.trim())throw new AgentError('본문이 있는 회의록을 선택해 주세요.');
 await enqueueMeetingStatement(db,owner,note).run();
 if(retry){
  await advanceMeetingReviews(db,owner);
  const row=await db.prepare('SELECT turn_id,status,conversation_id FROM orbit_meeting_reviews WHERE owner_id=? AND note_id=? AND revision=?').bind(owner,note.id,note.revision??1).first<{turn_id:string;status:string;conversation_id:string}>();
  if(row&&['failed','completed'].includes(row.status)){
   const next=crypto.randomUUID(),now=new Date().toISOString();
   const changed=await db.batch([
    db.prepare("UPDATE orbit_meeting_reviews SET turn_id=?,status='queued',error='',updated_at=? WHERE owner_id=? AND note_id=? AND revision=? AND turn_id=? AND status=? AND NOT EXISTS(SELECT 1 FROM orbit_agent_actions a JOIN orbit_agent_turns t ON t.owner_id=a.owner_id AND t.id=a.turn_id WHERE a.owner_id=? AND t.conversation_id=? AND a.state='applying')").bind(next,now,owner,note.id,note.revision??1,row.turn_id,row.status,owner,row.conversation_id),
    db.prepare("UPDATE orbit_agent_actions SET state='rejected',note='새 분석으로 대체',updated_at=? WHERE owner_id=? AND state IN ('pending','deferred') AND turn_id IN (SELECT id FROM orbit_agent_turns WHERE owner_id=? AND conversation_id=?) AND EXISTS(SELECT 1 FROM orbit_meeting_reviews WHERE owner_id=? AND note_id=? AND revision=? AND turn_id=?)").bind(now,owner,owner,row.conversation_id,owner,note.id,note.revision??1,next)
   ]);if(changed[0].meta?.changes!==1)throw new AgentError('다른 검토가 진행 중입니다. 잠시 후 다시 시도해 주세요.','BUSY',409);
  }
 }
 return advanceMeetingReviews(db,owner,undefined,noteId);
}
export async function advanceMeetingReviews(db:Database,owner:string,env?:Runtime,noteId?:string){
 // Reconcile completed/failed turns without duplicating their approval cards.
 await db.prepare("UPDATE orbit_meeting_reviews SET status=(SELECT status FROM orbit_agent_turns t WHERE t.owner_id=orbit_meeting_reviews.owner_id AND t.id=turn_id),error=COALESCE((SELECT json_extract(response_json,'$.error') FROM orbit_agent_turns t WHERE t.owner_id=orbit_meeting_reviews.owner_id AND t.id=turn_id),''),updated_at=? WHERE owner_id=? AND status='running' AND EXISTS(SELECT 1 FROM orbit_agent_turns t WHERE t.owner_id=orbit_meeting_reviews.owner_id AND t.id=turn_id AND t.status IN ('completed','failed'))").bind(new Date().toISOString(),owner).run();
 if(!env)return {active:false};
 const row=await db.prepare("SELECT * FROM orbit_meeting_reviews WHERE owner_id=? AND status='queued' AND (? IS NULL OR note_id=?) ORDER BY created_at DESC LIMIT 1").bind(owner,noteId??null,noteId??null).first<{note_id:string;revision:number;turn_id:string;conversation_id:string}>();
 if(!row)return {active:false};
 const now=new Date().toISOString();
 try{
  const data=(await readWorkspace(db,owner)).data,meta=data.notes.find(n=>n.id===row.note_id);
  if(!meta||(meta.revision??1)!==row.revision){await db.prepare("UPDATE orbit_meeting_reviews SET status='superseded',updated_at=? WHERE owner_id=? AND note_id=? AND revision=? AND status='queued'").bind(now,owner,row.note_id,row.revision).run();return {active:true};}
  await db.prepare("INSERT OR IGNORE INTO orbit_conversations(owner_id,id,title,project_id,revision,created_at,updated_at) VALUES(?,?,?,NULL,0,?,?)").bind(owner,row.conversation_id,('회의 결재 · '+meta.title).slice(0,100),now,now).run();
  const status=await runAgent(db,owner,{id:row.turn_id,conversationId:row.conversation_id,message:'회의록 “'+meta.title+'”의 핵심 요약과 일정·할 일·신규 프로젝트·프로젝트 내용 변경 결재안을 준비해 주세요. 실제 등록은 제 승인 후에만 진행합니다.',meeting:{noteId:row.note_id,revision:row.revision},retryFailed:true},env,{defer:true});
  await db.prepare("UPDATE orbit_meeting_reviews SET status=?,error='',updated_at=? WHERE owner_id=? AND note_id=? AND revision=? AND status='queued'").bind(status,now,owner,row.note_id,row.revision).run();
 }catch(e){await db.prepare("UPDATE orbit_meeting_reviews SET status='failed',error=?,updated_at=? WHERE owner_id=? AND note_id=? AND revision=? AND status='queued'").bind(e instanceof Error?e.message:'회의록 분석 준비 실패',now,owner,row.note_id,row.revision).run();}
 return {active:true};
}
export async function meetingReviewDetail(db:Database,owner:string,noteId:string){
 const note=await readNote(db,owner,noteId);
 const row=await db.prepare('SELECT r.*,t.status AS turn_status,t.response_json FROM orbit_meeting_reviews r LEFT JOIN orbit_agent_turns t ON t.owner_id=r.owner_id AND t.id=r.turn_id WHERE r.owner_id=? AND r.note_id=? ORDER BY r.revision DESC LIMIT 1').bind(owner,noteId).first<any>();
 if(!row)return {status:'not_started',summary:'',actions:[],revision:note.revision??1,projects:[]};
 const response=JSON.parse(row.response_json??'{}');
 const cards=await db.prepare('SELECT a.*,t.conversation_id FROM orbit_agent_actions a JOIN orbit_agent_turns t ON t.owner_id=a.owner_id AND t.id=a.turn_id JOIN orbit_meeting_reviews r ON r.owner_id=a.owner_id AND r.conversation_id=t.conversation_id WHERE r.owner_id=? AND r.note_id=? ORDER BY r.revision DESC,a.created_at,a.rowid').bind(owner,noteId).all<any>();
 const data=(await readWorkspace(db,owner)).data;
 return {status:row.status==='queued'?'queued':row.turn_status??row.status,summary:response.text??'',error:response.error||row.error,progress:response.progress,revision:row.revision,stale:row.revision!==(note.revision??1),turnId:row.turn_id,actions:cards.results.filter(r=>r.note!=='새 분석으로 대체').map(toAction),projects:data.projects.map(p=>({id:p.id,name:p.name,goal:p.goal}))};
}
