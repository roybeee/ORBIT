import {registrationOverlap} from '../overlap-review.ts';
import {guardMatches} from './action-guard.ts';
import {z} from 'zod';
import {dispatchOrder} from './orders.ts';
import {startPlanningAction} from '../brief/start.ts';
import {readWorkspace,writeCommand,RevisionConflict,type Database} from '../../../db/repository.ts';
import {dateSchema} from '../validation.ts';
import {addDays,todayInZone} from '../dates.ts';
import {AgentError} from './errors.ts';
import {claimAction,findAction,markApproved,resetAction} from './repository.ts';
import {createGoogleEvent,syncCalendar} from './calendar.ts';
import {deleteCalendarSeries} from './calendar-delete.ts';
import {parseAction,runAgent} from './runner.ts';
import type {Runtime} from './integrations.ts';
export const decisionSchema=z.object({id:z.string().uuid(),decision:z.enum(['approve','defer','reconsider','reject']),reason:z.string().max(2000).optional(),revisitDate:dateSchema.optional(),overlapConfirmation:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export async function decide(db:Database,owner:string,input:z.infer<typeof decisionSchema>,env:Runtime){
 const action=await findAction(db,owner,input.id);
 if(input.decision!=='approve'){
  if(action.state==='approved'||action.state==='applying')throw new AgentError('이미 적용되었거나 적용 중인 제안입니다.','CONFLICT',409);
  if(input.decision==='defer'){const current=await readWorkspace(db,owner);if(!input.reason?.trim()||!input.revisitDate||input.revisitDate<=todayInZone(current.data.preferences.timeZone))throw new AgentError('보류 이유와 이후의 검토일을 입력해 주세요.');}
  const state=input.decision==='defer'?'deferred':input.decision==='reject'?'rejected':'pending';
  const result=await db.prepare("UPDATE orbit_agent_actions SET state=?,note=?,revisit_date=?,updated_at=? WHERE owner_id=? AND id=? AND state=?").bind(state,input.reason?.trim()??'',input.revisitDate??null,new Date().toISOString(),owner,input.id,action.state).run();if(result.meta?.changes!==1)throw new AgentError('제안 상태가 변경됐습니다.','CONFLICT',409);return;
 }
 if(action.state==='approved')return;
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
    if(!receipt&&((action.guard&&!await guardMatches(action.guard,parsed,current.data))||(!action.guard&&current.revision!==action.expectedRevision)))throw new AgentError('이 제안의 대상 또는 근거가 변경되어 최신 내용으로 다시 확인합니다.','ACTION_CHANGED',409);
    let command=parsed;
    if(!receipt){
     const review=registrationOverlap(current.data,parsed);
     if(review&&(parsed.type==='event.upsert'||parsed.type==='proposal.approve')){
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([owner,action.id,review.confirmation])));
      const confirmation=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
      if(input.overlapConfirmation!==confirmation)throw new AgentError('겹치는 일정을 확인하고 등록 여부를 선택해 주세요.','CALENDAR_OVERLAP',409,{overlapConfirmation:confirmation,conflicts:review.conflicts.slice(0,20).map(({title,date,start,end})=>({title,date,start,end})),total:review.conflicts.length});
      command={...parsed,overlapConfirmation:review.confirmation};
     }
    }
    try{revision=(await writeCommand(db,owner,{operationId:action.id,expectedRevision:current.revision,action:command})).revision;break}catch(error){if(!(error instanceof RevisionConflict)||attempt===2)throw error}
   }
  }
  await markApproved(db,owner,action,lease,revision,result);
  if(parsed.type==='google.event.create'||parsed.type==='google.event.deleteSeries'){try{await syncCalendar(db,owner,env,parsed.type==='google.event.create'?parsed.event.date:undefined)}catch{/* External creation is acknowledged; sync can be retried separately. */}}
 }catch(error){
  if(error instanceof AgentError&&error.code==='ACTION_CHANGED'){
   const meeting=action.guard?.meeting;
   if(meeting){await resetAction(db,owner,action.id,lease);throw new AgentError('회의록 또는 연결 대상이 바뀌었습니다. 회의록에서 최신 내용으로 다시 분석한 뒤 승인해 주세요.','MEETING_CHANGED',409);}
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
  throw error;
 }
}
