import {z} from 'zod';
import {startPlanningAction} from '../brief/start.ts';
import {readWorkspace,writeCommand,RevisionConflict,type Database} from '../../../db/repository.ts';
import {dateSchema} from '../validation.ts';
import {addDays,todayInZone} from '../dates.ts';
import {AgentError} from './errors.ts';
import {claimAction,findAction,markApproved,resetAction} from './repository.ts';
import {createGoogleEvent,syncCalendar} from './calendar.ts';
import {parseAction} from './runner.ts';
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
  if(parsed.type==='google.event.create'){result=await createGoogleEvent(db,owner,env,action.id,parsed,input.overlapConfirmation);}
  else if(parsed.type==='proposal.generate'||parsed.type==='review.saveGenerate'){const planning=await startPlanningAction(db,owner,{operationId:action.id,expectedRevision:action.expectedRevision,action:parsed},env);revision=planning.snapshot.revision;result={briefDate:planning.date};}
  else{
   if(['proposal.approve','event.upsert'].includes(parsed.type))await syncCalendar(db,owner,env,'date' in parsed?parsed.date:parsed.type==='event.upsert'?parsed.event.date:undefined);
   revision=(await writeCommand(db,owner,{operationId:action.id,expectedRevision:action.expectedRevision,action:parsed})).revision;
  }
  await markApproved(db,owner,action,lease,revision,result);
  if(parsed.type==='google.event.create'){try{await syncCalendar(db,owner,env,parsed.event.date)}catch{/* External creation is acknowledged; sync can be retried separately. */}}
 }catch(error){await resetAction(db,owner,action.id,lease);if(error instanceof RevisionConflict)throw new AgentError('제안 이후 업무나 일정이 변경됐습니다. 에이전트에게 최신 내용으로 다시 제안해 달라고 요청해 주세요.','CONFLICT',409);throw error}
}
