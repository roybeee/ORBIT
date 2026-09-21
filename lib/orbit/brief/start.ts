import {readWorkspace,writeCommand,RevisionConflict,type Database} from '../../../db/repository.ts';
import type {WorkspaceAction} from '../validation.ts';
import {addDays} from '../dates.ts';
import {runAgent} from '../agent/runner.ts';
import {syncCalendar} from '../agent/calendar.ts';
import {AgentError} from '../agent/errors.ts';
import type {Runtime} from '../agent/integrations.ts';
import {briefMessage,type PlanningRequest} from './schema.ts';
type PlanningAction=Extract<WorkspaceAction,{type:'proposal.generate'|'review.saveGenerate'}>;
// Without a connected Hermes the deterministic BRAINY planner (Goal Laser first, rules, calibration)
// still produces tomorrow's plan, so the evening review never ends without a next day.
export async function localPlanning(db:Database,owner:string,operationId:string,planning:PlanningRequest){
 const current=await readWorkspace(db,owner);
 return writeCommand(db,owner,{operationId,expectedRevision:current.revision,action:{type:'proposal.generate',date:planning.date,energy:planning.energy}});
}
export async function startPlanningAction(db:Database,owner:string,command:{operationId:string;expectedRevision:number;action:PlanningAction},env:Runtime){
 const {action}=command,planning=action.type==='proposal.generate'?{date:action.date,energy:action.energy}:{date:addDays(action.review.date,1),energy:action.review.energy};
 // Resolve an acknowledged fallback before revision checks or a newly connected
 // Hermes can turn the same request into a second analysis. writeCommand verifies
 // the action hash, including changed review details, on replay.
 const localReceipt=await db.prepare('SELECT revision FROM orbit_mutations WHERE owner_id=? AND operation_id=?').bind(owner,command.operationId+':local').first();
 if(localReceipt){
  const reviewReceipt=await db.prepare('SELECT operation_id FROM orbit_mutations WHERE owner_id=? AND operation_id=?').bind(owner,command.operationId).first();
  if(Boolean(reviewReceipt)!==(action.type==='review.saveGenerate'))throw new RevisionConflict('같은 요청 번호에 다른 종류의 작업이 있습니다.');
  if(action.type==='review.saveGenerate')await writeCommand(db,owner,{...command,action:{type:'review.save',review:action.review,...(action.detail?{detail:action.detail}:{})}});
  return {snapshot:await localPlanning(db,owner,command.operationId+':local',planning),date:planning.date,local:true as const};
 }
 const existing=await db.prepare('SELECT id FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,command.operationId).first();
 if(!existing){
  // The PAFI review detail (outcomes, rules, habits, stats) is saved before any analysis starts.
  if(action.type==='review.saveGenerate')await writeCommand(db,owner,{...command,action:{type:'review.save',review:action.review,...(action.detail?{detail:action.detail}:{})}});
  else if((await readWorkspace(db,owner)).revision!==command.expectedRevision)throw new RevisionConflict('제안 이후 업무나 일정이 바뀌었습니다. 최신 내용으로 다시 제안해 주세요.');
  // Collection may legitimately advance the workspace revision. Validate the
  // caller first, then let analysis use the refreshed snapshot.
  if(action.type==='proposal.generate')try{await syncCalendar(db,owner,env,planning.date)}catch{}
 }
 try{await runAgent(db,owner,{id:command.operationId,message:briefMessage(planning),planning,retryFailed:true},env)}
 catch(error){
  if(!(error instanceof AgentError&&error.code==='HERMES_SETUP'))throw error;
  const snapshot=await localPlanning(db,owner,command.operationId+':local',planning);
  return {snapshot,date:planning.date,local:true as const};
 }
 return {snapshot:await readWorkspace(db,owner),date:planning.date,local:false as const};
}
