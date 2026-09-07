import {readWorkspace,type Database} from '../../../db/repository.ts';
import {applyAction} from '../reducer.ts';
import {AgentError} from '../agent/errors.ts';
import type {DailyBrief,PlanningRequest} from './schema.ts';

// Publishing the derived report and completing its run form one transaction.
// Cancellation or a newer workspace wins before either becomes visible.
export async function publishBrief(db:Database,owner:string,id:string,lease:string,brief:DailyBrief,planning:PlanningRequest){
 const current=await readWorkspace(db,owner);
 if(current.data.proposals.some(p=>p.brief?.sourceTurnId===id))return;
 if(current.revision!==brief.sourceRevision)throw new AgentError('분석 중 업무나 일정이 바뀌었습니다. 최신 기록으로 다시 분석해 주세요.','CONFLICT',409);
 const next=applyAction(current.data,{type:'proposal.brief',brief,energy:planning.energy});next.events=next.events.filter(e=>!e.id.startsWith('google:'));
 const now=new Date().toISOString(),revision=current.revision+1;
 const response=JSON.stringify({text:'원페이지 실행 제안을 만들었습니다. 내일 제안에서 근거와 우선순위를 검토하고 승인해 주세요.',sources:brief.evidence.slice(0,20).map(e=>({title:e.title,label:e.kind==='note'?'문서 v'+e.revision:e.kind==='plaud'?'Plaud':'분석 근거'}))});
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO orbit_workspaces(owner_id,revision,state_json,mutation_id,updated_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orbit_agent_turns t JOIN orbit_hermes_jobs j ON j.owner_id=t.owner_id AND j.turn_id=t.id WHERE t.owner_id=? AND t.id=? AND t.status='running' AND t.updated_at=? AND j.cancel_requested=0)
    ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json,mutation_id=excluded.mutation_id,updated_at=excluded.updated_at WHERE orbit_workspaces.revision=?`).bind(owner,revision,JSON.stringify(next),id,now,owner,id,lease,current.revision),
   db.prepare("UPDATE orbit_agent_turns SET status='completed',response_json=?,updated_at=? WHERE owner_id=? AND id=? AND status='running' AND updated_at=? AND EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=? AND mutation_id=?)").bind(response,now,owner,id,lease,owner,revision,id),
   db.prepare("DELETE FROM orbit_hermes_jobs WHERE owner_id=? AND turn_id=? AND EXISTS(SELECT 1 FROM orbit_agent_turns WHERE owner_id=? AND id=? AND status='completed')").bind(owner,id,owner,id),
  ]);
  if(result[0].meta?.changes!==1)throw new AgentError('분석 중 기록이 변경되었거나 중지를 요청했습니다. 기존 제안은 유지됩니다.','CONFLICT',409);
 }catch(error){if(error instanceof AgentError)throw error;throw new AgentError('원페이지 제안의 저장 결과를 확인하고 있습니다.','STORAGE',503)}
}
