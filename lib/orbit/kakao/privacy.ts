import {z} from 'zod';
import type {Database} from '../../../db/repository.ts';
import {AgentError} from '../agent/errors.ts';
const deleteInput=z.object({id:z.string().uuid()}).strict();
/** Forget captured evidence while retaining any already approved workspace/Google records. */
export async function deleteKakaoReview(db:Database,owner:string,input:unknown){
 const parsed=deleteInput.safeParse(input);if(!parsed.success)throw new AgentError('삭제할 카카오톡 검토 기록을 선택해 주세요.','INPUT',422);
 const id=parsed.data.id,row=await db.prepare('SELECT input,conversation_id,status FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,id).first<{input:string;conversation_id:string;status:string}>();
 let source;try{source=row?JSON.parse(row.input):null}catch{/* foreign source below */}
 if(!row||source?.source!=='kakao-read-review')throw new AgentError('카카오톡 검토 기록을 찾을 수 없습니다.','NOT_FOUND',404);
 if(source.deleted)return {deleted:true};
 const now=new Date().toISOString(),tombstone=JSON.stringify({source:'kakao-read-review',deleted:true});
 const results=await db.batch([
  db.prepare("UPDATE orbit_agent_turns SET input=?,response_json='{}',updated_at=? WHERE owner_id=? AND id=? AND status IN ('completed','failed') AND NOT EXISTS(SELECT 1 FROM orbit_agent_turns t WHERE t.owner_id=? AND t.conversation_id=? AND t.status='running') AND NOT EXISTS(SELECT 1 FROM orbit_agent_actions a WHERE a.owner_id=? AND a.turn_id=? AND a.state='applying')").bind(tombstone,now,owner,id,owner,row.conversation_id,owner,id),
  db.prepare("DELETE FROM orbit_agent_actions WHERE owner_id=? AND turn_id=? AND state IN ('pending','deferred','rejected') AND EXISTS(SELECT 1 FROM orbit_agent_turns t WHERE t.owner_id=? AND t.id=? AND t.input=? AND t.updated_at=?)").bind(owner,id,owner,id,tombstone,now),
  db.prepare("UPDATE orbit_agent_actions SET reason='원문 검토 기록이 삭제되었습니다.',note='',updated_at=? WHERE owner_id=? AND turn_id=? AND state='approved' AND EXISTS(SELECT 1 FROM orbit_agent_turns t WHERE t.owner_id=? AND t.id=? AND t.input=? AND t.updated_at=?)").bind(now,owner,id,owner,id,tombstone,now),
 ]);
 if(results[0].meta?.changes!==1)throw new AgentError('분석 또는 승인을 처리 중입니다. 작업이 끝난 뒤 검토 기록을 삭제해 주세요.','BUSY',409);
 return {deleted:true};
}
