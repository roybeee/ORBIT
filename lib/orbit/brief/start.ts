import {readWorkspace,writeCommand,RevisionConflict,type Database} from '../../../db/repository.ts';
import type {WorkspaceAction} from '../validation.ts';
import {addDays} from '../dates.ts';
import {runAgent} from '../agent/runner.ts';
import {syncCalendar} from '../agent/calendar.ts';
import type {Runtime} from '../agent/integrations.ts';
import {briefMessage} from './schema.ts';
type PlanningAction=Extract<WorkspaceAction,{type:'proposal.generate'|'review.saveGenerate'}>;
export async function startPlanningAction(db:Database,owner:string,command:{operationId:string;expectedRevision:number;action:PlanningAction},env:Runtime){
 const {action}=command,planning=action.type==='proposal.generate'?{date:action.date,energy:action.energy}:{date:addDays(action.review.date,1),energy:action.review.energy};
 const existing=await db.prepare('SELECT id FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,command.operationId).first();
 if(!existing){
  await syncCalendar(db,owner,env,planning.date);
  if(action.type==='review.saveGenerate')await writeCommand(db,owner,{...command,action:{type:'review.save',review:action.review}});
  else if((await readWorkspace(db,owner)).revision!==command.expectedRevision)throw new RevisionConflict('제안 이후 업무나 일정이 바뀌었습니다. 최신 내용으로 다시 제안해 주세요.');
 }
 await runAgent(db,owner,{id:command.operationId,message:briefMessage(planning),planning},env);
 return {snapshot:await readWorkspace(db,owner),date:planning.date};
}
