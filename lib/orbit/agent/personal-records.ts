import {listActivity} from './activity.ts';
import type {Database} from '../../../db/repository.ts';
import {AgentError} from './errors.ts';
export async function searchPersonalConversations(db:Database,owner:string,query:string){
  const escaped=query.replace(/[\\%_]/g,c=>'\\'+c);
  const {results}=await db.prepare("SELECT t.id,t.conversation_id,t.input,t.response_json,t.created_at,c.title FROM orbit_agent_turns t LEFT JOIN orbit_conversations c ON c.owner_id=t.owner_id AND c.id=t.conversation_id WHERE t.owner_id=? AND t.status='completed' AND (t.input LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\') ORDER BY t.created_at DESC,t.id DESC LIMIT 12").bind(owner,'%'+escaped+'%','%'+escaped+'%').all<{id:string;conversation_id:string;input:string;response_json:string;created_at:string;title:string|null}>();
  const external=await listActivity(db,owner,{query});
  const imported=await Promise.all(external.items.slice(0,6).map(async r=>{
    const found=await db.prepare("SELECT role,content,tool_name FROM orbit_activity_messages WHERE owner_id=? AND record_id=? AND (?='' OR instr(lower(content),lower(?))>0) ORDER BY timestamp DESC,id DESC LIMIT 8").bind(owner,String(r.id),query,query).all<{role:string;content:string;tool_name:string}>();
    const messages=found.results.reverse();
    return {id:String(r.id),conversationId:String(r.session_id),title:String(r.title),date:String(r.updated_at),source:String(r.source),user:messages.filter(m=>m.role==='user').map(m=>m.content).join('\n').slice(0,2500),assistant:messages.filter(m=>m.role==='assistant').map(m=>m.content).join('\n').slice(0,1500),tools:messages.filter(m=>m.role==='tool'||m.role==='function').map(m=>({name:m.tool_name,content:m.content.slice(0,1000)})),notice:'HERMES 외부 채널 수집 원문. 발언자별 자료를 구분하며 AI 답변과 도구 출력을 검증된 사실로 단정하지 않습니다.'};
  }));
  return [...imported,...results.map(r=>({id:r.id,conversationId:r.conversation_id,title:r.title??'이전 대화',date:r.created_at,user:r.input.slice(0,2500),assistant:String(JSON.parse(r.response_json).text??'').slice(0,1000),notice:'사용자 발언과 AI 답변을 구분합니다. AI 답변은 사용자에 대한 사실의 근거가 아닙니다.'}))];
}
export async function personalRecordStats(db:Database,owner:string){const row=await db.prepare("SELECT COUNT(*) AS turns,COUNT(DISTINCT conversation_id) AS conversations,MAX(created_at) AS latest FROM orbit_agent_turns WHERE owner_id=? AND status='completed'").bind(owner).first<{turns:number;conversations:number;latest:string|null}>();if(!row)throw new AgentError('대화 기록을 확인하지 못했습니다.','STORAGE',503);return row;}
