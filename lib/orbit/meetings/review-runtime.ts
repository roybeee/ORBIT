import {readWorkspace,readNote,type Database} from '../../../db/repository.ts';
import type {Runtime} from '../agent/integrations.ts';
import {runAgent} from '../agent/runner.ts';
import {AgentError} from '../agent/errors.ts';
import {enqueueMeetingStatement,hasReadableMeeting} from './review.ts';
import {driveAgent} from '../agent/driver.ts';
import {collectNotifications} from '../notifications/store.ts';
import {dateSchema} from '../validation.ts';
import {addDays,todayInZone} from '../dates.ts';
import type {WorkspaceData} from '../model.ts';
import {findAction} from '../agent/repository.ts';
import {applyAction} from '../reducer.ts';
import {guardFor,recordFingerprint} from '../agent/action-guard.ts';
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
    db.prepare("UPDATE orbit_meeting_reviews SET turn_id=?,status='queued',error='',attempts=0,engine_version=2,updated_at=? WHERE owner_id=? AND note_id=? AND revision=? AND turn_id=? AND status=? AND NOT EXISTS(SELECT 1 FROM orbit_agent_actions a JOIN orbit_agent_turns t ON t.owner_id=a.owner_id AND t.id=a.turn_id WHERE a.owner_id=? AND t.conversation_id=? AND a.state='applying')").bind(next,now,owner,note.id,note.revision??1,row.turn_id,row.status,owner,row.conversation_id),
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
 if(await db.prepare("SELECT turn_id FROM orbit_meeting_reviews WHERE owner_id=? AND status='running' LIMIT 1").bind(owner).first())return {active:true};
 const row=await db.prepare("SELECT * FROM orbit_meeting_reviews WHERE owner_id=? AND status='queued' AND (? IS NULL OR note_id=?) ORDER BY (SELECT json_extract(n.note_json,'$.updated') FROM orbit_note_revisions n WHERE n.owner_id=orbit_meeting_reviews.owner_id AND n.note_id=orbit_meeting_reviews.note_id AND n.revision=orbit_meeting_reviews.revision) DESC,created_at DESC LIMIT 1").bind(owner,noteId??null,noteId??null).first<{note_id:string;revision:number;turn_id:string;conversation_id:string}>();
 if(!row)return {active:false};
 const now=new Date().toISOString();
 try{
  const data=(await readWorkspace(db,owner)).data,meta=data.notes.find(n=>n.id===row.note_id);
  if(!meta||(meta.revision??1)!==row.revision){await db.prepare("UPDATE orbit_meeting_reviews SET status='superseded',updated_at=? WHERE owner_id=? AND note_id=? AND revision=? AND status='queued'").bind(now,owner,row.note_id,row.revision).run();return {active:true};}
  const note=await readNote(db,owner,row.note_id,row.revision);
  if(!hasReadableMeeting(note)){await db.prepare("UPDATE orbit_meeting_reviews SET status='waiting_source',error='Plaud에 텍스트 전사가 아직 없습니다. 전사가 들어오면 자동으로 분석합니다.',updated_at=? WHERE owner_id=? AND note_id=? AND revision=?").bind(now,owner,row.note_id,row.revision).run();return {active:true};}
  await db.prepare("INSERT OR IGNORE INTO orbit_conversations(owner_id,id,title,project_id,revision,created_at,updated_at) VALUES(?,?,?,NULL,0,?,?)").bind(owner,row.conversation_id,('회의 결재 · '+meta.title).slice(0,100),now,now).run();
  const status=await runAgent(db,owner,{id:row.turn_id,conversationId:row.conversation_id,message:'회의록 “'+meta.title+'”의 핵심 요약과 일정·할 일·신규 프로젝트·프로젝트 내용 변경 결재안을 준비해 주세요. 실제 등록은 제 승인 후에만 진행합니다.',meeting:{noteId:row.note_id,revision:row.revision},retryFailed:true},env,{defer:true});
  await db.prepare("UPDATE orbit_meeting_reviews SET status=?,error='',updated_at=? WHERE owner_id=? AND note_id=? AND revision=? AND status='queued'").bind(status,now,owner,row.note_id,row.revision).run();
 }catch(e){await db.prepare("UPDATE orbit_meeting_reviews SET status='failed',error=?,updated_at=? WHERE owner_id=? AND note_id=? AND revision=? AND status='queued'").bind(e instanceof Error?e.message:'회의록 분석 준비 실패',now,owner,row.note_id,row.revision).run();}
 return {active:true};
}
// Registered records a pending card may be folded into: open tasks and recent or upcoming local events.
export function mergeCandidates(data:WorkspaceData){
 const floor=addDays(todayInZone(data.preferences.timeZone),-30);
 return {tasks:data.tasks.filter(t=>t.status!=='done').sort((a,b)=>a.due.localeCompare(b.due)).slice(0,300).map(t=>({id:t.id,title:t.title,projectId:t.projectId,due:t.due})),events:data.events.filter(e=>e.date>=floor&&!e.id.startsWith('google:')&&!e.id.startsWith('approved:')&&!e.id.startsWith('task-due:')).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start).slice(0,300).map(e=>({id:e.id,title:e.title,date:e.date,start:e.start,end:e.end}))};
}
export async function meetingReviewDetail(db:Database,owner:string,noteId:string){
 const note=await readNote(db,owner,noteId);
 const row=await db.prepare('SELECT r.*,t.status AS turn_status,t.response_json FROM orbit_meeting_reviews r LEFT JOIN orbit_agent_turns t ON t.owner_id=r.owner_id AND t.id=r.turn_id WHERE r.owner_id=? AND r.note_id=? ORDER BY r.revision DESC LIMIT 1').bind(owner,noteId).first<any>();
 if(!row)return {status:'not_started',summary:'',actions:[],revision:note.revision??1,projects:[]};
 const response=JSON.parse(row.response_json??'{}');
 const cards=await db.prepare('SELECT a.*,t.conversation_id FROM orbit_agent_actions a JOIN orbit_agent_turns t ON t.owner_id=a.owner_id AND t.id=a.turn_id JOIN orbit_meeting_reviews r ON r.owner_id=a.owner_id AND r.conversation_id=t.conversation_id WHERE r.owner_id=? AND r.note_id=? ORDER BY r.revision DESC,a.created_at,a.rowid').bind(owner,noteId).all<any>();
 const data=(await readWorkspace(db,owner)).data;
 return {status:row.status==='queued'?'queued':row.turn_status??row.status,summary:response.text||row.summary||'',error:response.error||row.error,progress:response.progress,revision:row.revision,stale:row.revision!==(note.revision??1),turnId:row.turn_id,actions:cards.results.filter(r=>r.note!=='새 분석으로 대체').map(toAction),projects:data.projects.map(p=>({id:p.id,name:p.name,goal:p.goal})),candidates:mergeCandidates(data)};
}

// Scheduled and import callers use the same bounded worker as the UI. Reading a
// note is never a prerequisite for starting or completing analysis.
export async function processMeetingReviews(db:Database,owner:string,env:Runtime,noteId?:string){
 await collectNotifications(db,owner);
 await advanceMeetingReviews(db,owner);
 const snapshot=await readWorkspace(db,owner);
 const known=await db.prepare('SELECT note_id,revision,status,engine_version,attempts FROM orbit_meeting_reviews WHERE owner_id=?').bind(owner).all<{note_id:string;revision:number;status:string;engine_version:number;attempts:number}>();
 const missing=snapshot.data.notes.filter(n=>n.kind==='meeting'&&(!noteId||n.id===noteId)&&!known.results.some(r=>r.note_id===n.id&&r.revision===(n.revision??1))).sort((a,b)=>b.updated.localeCompare(a.updated)).slice(0,4);
 for(const meta of missing)await enqueueMeetingStatement(db,owner,await readNote(db,owner,meta.id)).run();
 // Upgrade the old failed extractor exactly once. Do not revive user-cancelled work.
 await db.prepare("UPDATE orbit_meeting_reviews SET turn_id=lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),status='queued',error='',engine_version=2,attempts=0 WHERE owner_id=? AND status='failed' AND engine_version<2 AND error NOT LIKE '%중지%'").bind(owner).run();
 await advanceMeetingReviews(db,owner,env,noteId);
 const row=await db.prepare("SELECT turn_id FROM orbit_meeting_reviews WHERE owner_id=? AND status='running' AND (? IS NULL OR note_id=?) ORDER BY updated_at LIMIT 1").bind(owner,noteId??null,noteId??null).first<{turn_id:string}>();
 if(row)try{await driveAgent(db,owner,row.turn_id,env,{maxMs:25000,allowExternalReads:false});}catch{/* durable turn records the error; notify below */}
 await advanceMeetingReviews(db,owner);
 await collectNotifications(db,owner);
 return {active:!!row||missing.length>0};
}

export async function setMeetingDue(db:Database,owner:string,noteId:string,actionId:string,due:string){
 if(!dateSchema.safeParse(due).success)throw new AgentError('마감일을 확인해 주세요.');
 const item=await findAction(db,owner,actionId),meeting=item.guard?.meeting;
 if(item.state!=='pending'||!meeting||meeting.noteId!==noteId)throw new AgentError('수정할 회의 결재안이 아닙니다.','CONFLICT',409);
 const snapshot=await readWorkspace(db,owner),note=snapshot.data.notes.find(n=>n.id===noteId);
 if(!note||(note.revision??1)!==meeting.revision)throw new AgentError('회의록이 바뀌었습니다. 최신 분석을 확인해 주세요.','MEETING_CHANGED',409);
 const action=structuredClone(item.action);
 if(action.type!=='task.upsert'&&action.type!=='project.upsert')throw new AgentError('이 결재안은 마감일을 수정할 수 없습니다.');
 // Existing target changes must still invalidate the proposal. New dependent
 // projects are absent until approved; preserve that guard for later checking.
 const oldGuard=item.guard!;
 const target=action.type==='task.upsert'?action.task:action.project;target.due=due;
 const guard=await guardFor(action,snapshot.data);guard.meeting={...meeting,needsDue:false};
 guard.values={...oldGuard.values};
 const statement=db.prepare("UPDATE orbit_agent_actions SET action_json=?,guard_json=?,reason=?,updated_at=? WHERE owner_id=? AND id=? AND state='pending' AND action_json=? AND guard_json=?").bind(JSON.stringify(action),JSON.stringify(guard),item.reason.replace('[마감일 확인 필요] 원문에 마감일이 없습니다. 승인 전에 날짜를 지정해 주세요.', '사용자가 마감일을 '+due+'로 지정했습니다.'),new Date().toISOString(),owner,actionId,JSON.stringify(item.action),JSON.stringify(oldGuard));
 const dependent=[];
 if(action.type==='project.upsert'){
  const key='projects:'+action.project.id,before=applyAction(snapshot.data,item.action as any).projects.find(p=>p.id===action.project.id),after=applyAction(snapshot.data,action).projects.find(p=>p.id===action.project.id),oldHash=await recordFingerprint('projects',before),newHash=await recordFingerprint('projects',after);
  const rows=await db.prepare("SELECT id,guard_json FROM orbit_agent_actions WHERE owner_id=? AND turn_id=? AND state='pending' AND id<>?").bind(owner,item.turnId,item.id).all<{id:string;guard_json:string}>();
  for(const row of rows.results){const g=JSON.parse(row.guard_json);if(g.meeting?.noteId!==noteId||g.values?.[key]!==oldHash)continue;g.values[key]=newHash;dependent.push(db.prepare("UPDATE orbit_agent_actions SET guard_json=? WHERE owner_id=? AND id=? AND state='pending' AND guard_json=? AND EXISTS(SELECT 1 FROM orbit_agent_actions a WHERE a.owner_id=? AND a.id=? AND a.action_json=?)").bind(JSON.stringify(g),owner,row.id,row.guard_json,owner,item.id,JSON.stringify(action)));}
 }
 const result=(await db.batch([statement,...dependent]))[0];
 if(result.meta?.changes!==1)throw new AgentError('결재안이 바뀌었습니다. 다시 확인해 주세요.','CONFLICT',409);
}
