import type {Database} from '../../../db/repository.ts';
import type {Note,WorkspaceData} from '../model.ts';
import type {AgentAction} from '../agent/types.ts';
import {AgentError} from '../agent/errors.ts';
import {parseAction} from '../agent/protocol.ts';
import {normalize} from '../classify.ts';
export type MeetingAnalysis={noteId:string;revision:number};
export const meetingInstructions=`MEETING REVIEW MODE (takes precedence over general coaching): The supplied meetingSource is the full immutable source part, not a search excerpt. Read ALL its lines. Return kind final with Korean text organized as 핵심 요약 / 결정 사항 / 확인할 내용. Distinguish recorded decisions from guesses and questions. Summarize the whole supplied part, including the end. For a split recording clearly state this part's coverage. Propose concrete followups from ordinary speech, not just TODO markers. Only task.upsert (NEW todo), event.upsert (NEW local event), and project.upsert (new project or changes to existing project content) are allowed. Never dispatch agents, send messages, modify source notes, mark work complete, or approve anything. All business changes await individual approval. Existing tasks/events and earlier review cards are supplied to avoid duplicates. Group identical commitments. Return at most 24 proposals; if more, explicitly list remaining commitments under 확인할 내용 rather than claiming full proposal coverage.
Every proposal MUST include source:{line:1,quote:"exact contiguous quotation from that line of meetingSource.body"}. Line numbers start at 1, include headers and empty lines; quote max 2000 chars. The server verifies the quotation. For tasks preserve source noteId and noteCitation; choose a real project, or a new project card BEFORE dependent cards. Never create a project from an arbitrary task title. For an existing project preserve every unchanged field and only revise clearly supported content. Never reset status/milestones/progress. Describe exact changes in reason. If the project is ambiguous or a date/time is missing, put the question in 확인할 내용; do not invent a definite date. Task estimates may be clearly labeled suggestions. Resolve relative dates against the recording date, NOT upload date. A past commitment may already be completed: ask before recreating overdue tasks or events. Calendars must use event.upsert so Orbit's normal project linkage and Google delivery apply. Do not use google.event.create. For a known project set task.autoAssign:false. Include evidence IDs from the supplied registry. Final text says proposals await approval and never claims registration.`;
export function enqueueMeetingStatement(db:Database,owner:string,note:Note,gate='1',values:(string|number|null)[]=[]){
 return db.prepare(`INSERT INTO orbit_meeting_reviews(owner_id,note_id,revision,turn_id,conversation_id,status,error,created_at,updated_at) SELECT ?,?,?,?,?, 'queued','',?,? WHERE ${gate} ON CONFLICT(owner_id,note_id,revision) DO NOTHING`).bind(owner,note.id,note.revision??1,crypto.randomUUID(),crypto.randomUUID(),new Date().toISOString(),new Date().toISOString(),...values);
}
export async function stableMeetingId(noteId:string,kind:string,title:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([noteId,kind,normalize(title)])));return 'meeting-'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('').slice(0,40)}
type Proposal={title:string;reason:string;action?:unknown;source?:{line:number;quote:string}};
export async function meetingProposals(note:Note,data:WorkspaceData,proposals:Proposal[],previous:AgentAction[]){
 const out:Proposal[]=[],projects=new Map<string,string>(),seen=new Set<string>();
 for(const p of proposals){
  const a=parseAction(p.action),s=p.source,line=s&&note.body.split(/\r?\n/)[s.line-1];
  if(!s||!s.quote.trim()||!line?.includes(s.quote))throw new AgentError('회의록 제안의 원문 근거를 확인하지 못했습니다. 다시 분석해 주세요.','MEETING_EVIDENCE',422);
  if(!['project.upsert','task.upsert','event.upsert'].includes(a.type))throw new AgentError('회의록은 일정·할 일·프로젝트 변경만 제안할 수 있습니다.','MEETING_SCOPE',422);
  if(a.type==='project.upsert'){
   const old=data.projects.find(x=>x.id===a.project.id);
   if(old){if(a.project.status&&a.project.status!==old.status)throw new AgentError('회의록 분석은 프로젝트 완료 상태를 변경하지 않습니다.','MEETING_SCOPE',422);a.project={...old,...a.project,status:old.status,completedOn:old.completedOn,result:old.result,nextTaskId:old.nextTaskId,milestones:old.milestones};}
   else {const existing=data.projects.find(x=>normalize(x.name)===normalize(a.project.name));const id=existing?.id??await stableMeetingId(note.source?.externalId??note.id,'project',a.project.name);projects.set(a.project.id,id);if(existing)continue;a.project={...a.project,id,status:'active',completedOn:undefined,result:undefined,nextTaskId:undefined,milestones:undefined};}
  }
  if(a.type==='task.upsert'){
   if(a.task.status!=='todo'||a.project||data.tasks.some(t=>t.id===a.task.id))throw new AgentError('회의록 후속 업무는 새 할 일로 제안해야 합니다.','MEETING_SCOPE',422);
   a.task.projectId=projects.get(a.task.projectId)??a.task.projectId;
   if(data.tasks.some(t=>t.projectId===a.task.projectId&&normalize(t.title)===normalize(a.task.title)))continue;
   a.task={...a.task,id:await stableMeetingId(note.source?.externalId??note.id,'task',a.task.projectId+':'+a.task.title),focus:false,noteId:note.id,noteCitation:{revision:note.revision??1,line:s.line,quote:s.quote}};a.autoAssign=false;
  }
  if(a.type==='event.upsert'){
   if(data.events.some(e=>e.id===a.event.id)||a.attachmentIds?.length||a.event.taskId)throw new AgentError('회의록 일정은 별도의 새 일정으로 제안해야 합니다.','MEETING_SCOPE',422);
   if(a.event.projectId)a.event.projectId=projects.get(a.event.projectId)??a.event.projectId;
   if(data.events.some(e=>e.date===a.event.date&&e.start===a.event.start&&normalize(e.title)===normalize(a.event.title)))continue;
   a.event.id=await stableMeetingId(note.source?.externalId??note.id,'event',a.event.title+':'+a.event.date+':'+a.event.start);
   a.event.description=(a.event.description??'')+'\n회의 근거: '+note.title+' · '+note.updated+' · '+s.quote;
   delete a.overlapConfirmation;
  }
  const key=JSON.stringify(a);
  if(seen.has(key)||previous.some(x=>x.note!=='새 분석으로 대체'&&['pending','deferred','applying','approved','rejected'].includes(x.state)&&JSON.stringify(x.action)===key))continue;
  seen.add(key);out.push({...p,reason:(p.reason+'\n원문 '+s.line+'행: '+s.quote).slice(0,2000),action:a});
 }
 return out;
}
