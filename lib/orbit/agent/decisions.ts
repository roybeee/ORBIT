import {notify} from '../notifications/store.ts';
import {registrationOverlap} from '../overlap-review.ts';
import {guardMatches,captureWorkspaceBasis,rebaseProjectValues,withoutProject} from './action-guard.ts';
import {z} from 'zod';
import {dispatchOrder} from './orders.ts';
import {startPlanningAction} from '../brief/start.ts';
import {readWorkspace,writeCommand,RevisionConflict,type Database} from '../../../db/repository.ts';
import {dateSchema,actionSchema} from '../validation.ts';
import type {Project} from '../model.ts';
import {addDays,todayInZone} from '../dates.ts';
import {AgentError} from './errors.ts';
import {claimAction,findAction,markApproved,resetAction} from './repository.ts';
import {createGoogleEvent,syncCalendar} from './calendar.ts';
import {deleteCalendarSeries} from './calendar-delete.ts';
import {parseAction,runAgent} from './runner.ts';
import type {Runtime} from './integrations.ts';
import {rehomeOrphanCards} from '../meetings/orphan-cards.ts';
// An approval may rename the registration, recolor it or move it to another project,
// either an existing one or one created from a typed name. Only these fields, and only
// on the proposals that actually carry them.
export const overrideSchema=z.object({title:z.string().trim().min(1).max(200).optional(),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),projectId:z.string().min(1).max(100).nullable().optional(),newProject:z.object({name:z.string().trim().min(1).max(160)}).strict().optional()}).strict().refine(o=>!(o.newProject&&o.projectId!==undefined),'기존 프로젝트와 새 프로젝트 중 하나만 선택해 주세요.');
export const editableActions=['task.upsert','event.upsert','project.upsert'] as const;
export const decisionSchema=z.object({id:z.string().uuid(),decision:z.enum(['approve','defer','reconsider','reject']),reason:z.string().max(2000).optional(),revisitDate:dateSchema.optional(),overlapConfirmation:z.string().regex(/^[a-f0-9]{64}$/).optional(),overrides:overrideSchema.optional()}).strict();
type ParsedAction=ReturnType<typeof parseAction>;
type Overrides=z.infer<typeof overrideSchema>;
// The id and due date derive from the card (not the approval day) so a retried or
// replayed approval writes the same command. The reducer reuses an existing project
// with the same normalized name.
function newProjectDraft(actionId:string,name:string,today:string):Project{
 return {id:'project-'+actionId,name,goal:'',color:'#7f8fd2',symbol:name.slice(0,1),due:addDays(today,90),priority:3,status:'active'};
}
function withOverrides<T extends ParsedAction>(parsed:T,overrides:Overrides|undefined,context:{actionId:string;today:string}):T{
 if(!overrides||!Object.keys(overrides).length)return parsed;
 const {title,color,newProject}=overrides;
 if(newProject&&parsed.type!=='task.upsert'&&parsed.type!=='event.upsert')throw new AgentError('새 프로젝트는 할 일·일정을 등록할 때만 함께 만들 수 있습니다.','ACTION_NOT_EDITABLE',422);
 const project=newProject?newProjectDraft(context.actionId,newProject.name,context.today):undefined;
 const projectId=project?project.id:overrides.projectId;
 const edited=parsed.type==='project.upsert'
  ?{...parsed,project:{...parsed.project,...(title?{name:title}:{}),...(color?{color}:{})}} // a project always carries a colour, so "자동" keeps the proposed one
  :parsed.type==='task.upsert'
  ?{...parsed,task:{...parsed.task,...(title?{title}:{}),...(color!==undefined?{color}:{}),...(projectId!==undefined?{projectId}:{})},...(project?{project}:{})}
  :parsed.type==='event.upsert'
  ?{...parsed,event:{...parsed.event,...(title?{title}:{}),...(color!==undefined?{color}:{}),...(projectId!==undefined?{projectId}:{})},...(project?{project}:{})}
  :null;
 if(!edited)throw new AgentError('이 제안은 이름·색을 정해서 등록할 수 없습니다. 그대로 승인해 주세요.','ACTION_NOT_EDITABLE',422);
 const checked=actionSchema.safeParse(edited);
 if(!checked.success)throw new AgentError('등록할 이름과 색을 확인해 주세요.','ACTION_INVALID',422);
 return checked.data as T;
}
// Moving a proposal to another project drops its watch on the project it named,
// which may be a draft from the same meeting that will now never be created.
function movedFrom(parsed:ParsedAction,overrides?:Overrides){
 const old=parsed.type==='task.upsert'?parsed.task.projectId:parsed.type==='event.upsert'?parsed.event.projectId:undefined;
 return old&&(overrides?.newProject||overrides?.projectId!==undefined&&overrides.projectId!==old)?old:undefined;
}
async function rebaseSiblingGuards(db:Database,owner:string,turnId:string){
 const rows=await db.prepare("SELECT id,guard_json FROM orbit_agent_actions WHERE owner_id=? AND turn_id=? AND state='pending' AND guard_json IS NOT NULL").bind(owner,turnId).all<{id:string;guard_json:string}>();
 if(!rows.results.length)return;
 const basis=await captureWorkspaceBasis((await readWorkspace(db,owner)).data);
 const writes=rows.results.flatMap(row=>{
  const guard=JSON.parse(row.guard_json);
  if(guard?.version!==1)return [];
  return [db.prepare("UPDATE orbit_agent_actions SET guard_json=? WHERE owner_id=? AND id=? AND state='pending'").bind(JSON.stringify(rebaseProjectValues(guard,basis)),owner,row.id)];
 });
 if(writes.length)await db.batch(writes);
}
export async function decide(db:Database,owner:string,input:z.infer<typeof decisionSchema>,env:Runtime){
 const action=await findAction(db,owner,input.id);
 if(input.decision!=='approve'){
  if(action.state==='approved'||action.state==='applying')throw new AgentError('이미 적용되었거나 적용 중인 제안입니다.','CONFLICT',409);
  // A closed or replaced card (rejected, e.g. superseded by a new meeting analysis) must not come back through a defer.
  if(input.decision==='defer'&&action.state!=='pending'&&action.state!=='deferred')throw new AgentError('이미 닫힌 제안이라 보류할 수 없습니다.','CONFLICT',409);
  if(input.decision==='defer'){const current=await readWorkspace(db,owner);if(!input.reason?.trim()||!input.revisitDate||input.revisitDate<=todayInZone(current.data.preferences.timeZone))throw new AgentError('보류 이유와 이후의 검토일을 입력해 주세요.');}
  const state=input.decision==='defer'?'deferred':input.decision==='reject'?'rejected':'pending';
  const result=await db.prepare("UPDATE orbit_agent_actions SET state=?,note=?,revisit_date=?,updated_at=? WHERE owner_id=? AND id=? AND state=?").bind(state,input.reason?.trim()??'',input.revisitDate??null,new Date().toISOString(),owner,input.id,action.state).run();if(result.meta?.changes!==1){
   // Another request (a second tap, a bulk action) may have made the same decision first: not a failure.
   if((await findAction(db,owner,input.id)).state===state)return;
   throw new AgentError('제안 상태가 변경됐습니다.','CONFLICT',409);}
  // Rejecting a proposed project must not strand the same meeting's cards that belong to it.
  if(input.decision==='reject'&&action.action.type==='project.upsert'&&action.guard?.meeting)await rehomeOrphanCards(db,owner,action.guard.meeting.noteId);
  return;
 }
 if(action.state==='approved')return;
 if(action.guard?.meeting?.needsDue)throw new AgentError('회의록 결재안에서 마감일을 지정한 뒤 승인해 주세요.','MEETING_DUE',422);
 const lease=await claimAction(db,owner,input.id);
 try{
  const parsed=parseAction(action.action);let revision=action.expectedRevision,result:unknown={};
  if(parsed.type==='agent.dispatch'){const order=await dispatchOrder(db,owner,action.id,parsed,env,action.conversationId);result={orderId:order.id};}
  else if(parsed.type==='google.event.deleteSeries'){result=await deleteCalendarSeries(db,owner,env,action.id,lease,parsed);}
  else if(parsed.type==='google.event.create'){result=await createGoogleEvent(db,owner,env,action.id,parsed,input.overlapConfirmation);}
  else if(parsed.type==='proposal.generate'||parsed.type==='review.saveGenerate'){const current=await readWorkspace(db,owner);if(parsed.type==='review.saveGenerate'&&current.revision!==action.expectedRevision&&!await db.prepare('SELECT operation_id FROM orbit_mutations WHERE owner_id=? AND operation_id=?').bind(owner,action.id).first()&&(!action.guard||!await guardMatches(action.guard,parsed,current.data)))throw new AgentError('관련 기록이 변경되어 최신 내용으로 제안을 다시 확인합니다.','ACTION_CHANGED',409);const planning=await startPlanningAction(db,owner,{operationId:action.id,expectedRevision:current.revision,action:parsed},env);revision=planning.snapshot.revision;result={briefDate:planning.date};}
  else{
   for(let attempt=0;attempt<3;attempt++){
    const current=await readWorkspace(db,owner),receipt=await db.prepare('SELECT operation_id FROM orbit_mutations WHERE owner_id=? AND operation_id=?').bind(owner,action.id).first();
    const moved=movedFrom(parsed,input.overrides),guard=action.guard&&moved?withoutProject(action.guard,moved):action.guard,context={actionId:action.id,today:todayInZone(current.data.preferences.timeZone,new Date(action.createdAt))};
    if(!receipt&&((guard&&!await guardMatches(guard,parsed,current.data))||(!action.guard&&current.revision!==action.expectedRevision)))throw new AgentError('이 제안의 대상 또는 근거가 변경되어 최신 내용으로 다시 확인합니다.','ACTION_CHANGED',409);
    let command=withOverrides(parsed,input.overrides,context);
    if(!receipt){
     // The reducer checks the command it applies, so the confirmation covers the edited registration.
     const review=registrationOverlap(current.data,command);
     if(review&&(command.type==='event.upsert'||command.type==='proposal.approve')){
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([owner,action.id,review.confirmation])));
      const confirmation=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
      if(input.overlapConfirmation!==confirmation)throw new AgentError('겹치는 일정을 확인하고 등록 여부를 선택해 주세요.','CALENDAR_OVERLAP',409,{overlapConfirmation:confirmation,conflicts:review.conflicts.slice(0,20).map(({title,date,start,end})=>({title,date,start,end})),total:review.conflicts.length});
      command={...command,overlapConfirmation:review.confirmation};
     }
    }
    try{revision=(await writeCommand(db,owner,{operationId:action.id,expectedRevision:current.revision,action:command})).revision;break}catch(error){if(!(error instanceof RevisionConflict)||attempt===2)throw error}
   }
  }
  await markApproved(db,owner,action,lease,revision,result);
  if(input.overrides&&Object.keys(input.overrides).length)await rebaseSiblingGuards(db,owner,action.turnId);
  if(parsed.type==='google.event.create'||parsed.type==='google.event.deleteSeries'){try{await syncCalendar(db,owner,env,parsed.type==='google.event.create'?parsed.event.date:undefined)}catch{/* External creation is acknowledged; sync can be retried separately. */}}
 }catch(error){
  if(error instanceof AgentError&&error.code==='ACTION_CHANGED'){
   const meeting=action.guard?.meeting;
   if(meeting){await resetAction(db,owner,action.id,lease);
    // The usual cause: the new project this card belongs to was rejected. Move it and say so.
    if((await rehomeOrphanCards(db,owner,meeting.noteId)).includes(action.id))throw new AgentError('함께 제안된 새 프로젝트가 없어 이 결재안을 회의록의 프로젝트로 옮겼습니다. 프로젝트를 확인하고 다시 승인해 주세요.','MEETING_CHANGED',409);
    throw new AgentError('회의록 또는 연결 대상이 바뀌었습니다. 회의록에서 최신 내용으로 다시 분석한 뒤 승인해 주세요.','MEETING_CHANGED',409);}
   // Refresh is analysis only. The old card is retired atomically when the new
   // response is stored; refreshed changes always require a new approval.
   const existing=action.result?.refreshTurnId?await db.prepare('SELECT status FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,action.result.refreshTurnId).first<{status:string}>():null;
   const refreshTurnId=action.result?.refreshTurnId&&(!existing||existing.status==='running')?action.result.refreshTurnId:crypto.randomUUID();
   const claimed=await db.prepare("UPDATE orbit_agent_actions SET state='pending',result_json=json_set(result_json,'$.refreshTurnId',?) WHERE owner_id=? AND id=? AND state='applying' AND updated_at=?").bind(refreshTurnId,owner,action.id,lease).run();
   if(claimed.meta?.changes!==1)throw new AgentError('제안 상태를 다시 확인해 주세요.','BUSY',409);
   try{
    await runAgent(db,owner,{id:refreshTurnId,conversationId:action.conversationId,message:'관련 기록이 바뀐 제안을 최신 원문과 상태로 다시 검토해 주세요. 기존 값을 덮어쓰지 말고, 변경이 필요하면 새 승인 카드로 제안해 주세요. 검토 대상: '+action.title,refreshActionId:action.id},env,{defer:true});
    return {refreshing:true,turnId:refreshTurnId};
   }catch(refreshError){if(!(refreshError instanceof AgentError&&['HERMES_SETUP','BUSY'].includes(refreshError.code)))throw refreshError;throw new AgentError('관련 기록이 변경되었습니다. 연결 또는 진행 중인 대화를 확인한 뒤 이 카드에서 다시 시도하면 최신 제안을 준비합니다.','ACTION_CHANGED',409)}
  }
  await resetAction(db,owner,action.id,lease);
  if(!(error instanceof AgentError&&['CALENDAR_OVERLAP','ACTION_CHANGED','MEETING_CHANGED','BUSY','INPUT'].includes(error.code)))await notify(db,owner,{id:'action-failed:'+action.id+':'+lease,kind:'failed',title:'승인한 변경 처리 실패',body:action.title+' · '+(error instanceof Error?error.message:'등록 상태를 확인해 주세요.'),href:action.guard?.meeting?'/?note='+encodeURIComponent(action.guard.meeting.noteId):'/?conversation='+encodeURIComponent(action.conversationId??'legacy'),createdAt:new Date().toISOString()}).catch(()=>{});
  throw error;
 }
}
