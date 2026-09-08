import type {Database} from '../../../db/repository.ts';
import {AgentError} from './errors.ts';
export async function searchPersonalConversations(db:Database,owner:string,query:string){
  const escaped=query.replace(/[\\%_]/g,c=>'\\'+c);
  const {results}=await db.prepare("SELECT t.id,t.conversation_id,t.input,t.response_json,t.created_at,c.title FROM orbit_agent_turns t LEFT JOIN orbit_conversations c ON c.owner_id=t.owner_id AND c.id=t.conversation_id WHERE t.owner_id=? AND t.status='completed' AND (t.input LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\') ORDER BY t.created_at DESC,t.id DESC LIMIT 12").bind(owner,'%'+escaped+'%','%'+escaped+'%').all<{id:string;conversation_id:string;input:string;response_json:string;created_at:string;title:string|null}>();
  return results.map(r=>({id:r.id,conversationId:r.conversation_id,title:r.title??'이전 대화',date:r.created_at,user:r.input.slice(0,2500),assistant:String(JSON.parse(r.response_json).text??'').slice(0,1000),notice:'사용자 발언과 AI 답변을 구분합니다. AI 답변은 사용자에 대한 사실의 근거가 아닙니다.'}));
}
export async function personalRecordStats(db:Database,owner:string){const row=await db.prepare("SELECT COUNT(*) AS turns,COUNT(DISTINCT conversation_id) AS conversations,MAX(created_at) AS latest FROM orbit_agent_turns WHERE owner_id=? AND status='completed'").bind(owner).first<{turns:number;conversations:number;latest:string|null}>();if(!row)throw new AgentError('대화 기록을 확인하지 못했습니다.','STORAGE',503);return row;}
