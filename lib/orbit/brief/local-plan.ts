import {readWorkspace,writeCommand,type Database} from '../../../db/repository.ts';
import type {PlanningRequest} from './schema.ts';
// Without a usable Hermes run the deterministic BRAINY planner (Goal Laser first, rules, calibration)
// still produces the day's plan, so an evening review never ends without a next day. Kept in its own
// module because both the request path (brief/start) and the poller (agent/runner) need it, and the
// request path already imports the runner.
export async function localPlanning(db:Database,owner:string,operationId:string,planning:PlanningRequest){
 const current=await readWorkspace(db,owner);
 return writeCommand(db,owner,{operationId,expectedRevision:current.revision,action:{type:'proposal.generate',date:planning.date,energy:planning.energy}});
}
