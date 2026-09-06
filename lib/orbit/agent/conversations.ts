import {z} from 'zod';
import type {Database} from '../../../db/repository.ts';
import type {Conversation} from './types.ts';
import {AgentError} from './errors.ts';

export const conversationIdSchema=z.union([z.literal('legacy'),z.string().uuid()]);
export const createConversationSchema=z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(100).default('새 대화'),projectId:z.string().min(1).max(100).nullable().default(null)}).strict();
export const updateConversationSchema=z.object({id:conversationIdSchema,title:z.string().trim().min(1).max(100),projectId:z.string().min(1).max(100).nullable(),expectedRevision:z.number().int().min(0)}).strict();
interface Row {id:string;title:string;project_id:string|null;revision:number;created_at:string;updated_at:string}
const toConversation=(r:Row):Conversation=>({id:r.id,title:r.title,projectId:r.project_id,revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at});
export function parseCursor(value?:string){
 if(!value)return {at:'9999',id:'\uffff'};
 const [at,id,...rest]=value.split('|');
 if(value.length>220||rest.length||!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(at)||(id!==undefined&&!/^[A-Za-z0-9_-]{1,100}$/.test(id)))throw new AgentError('목록의 다음 페이지를 확인할 수 없습니다.');
 return {at,id:id??''};
}
export async function ensureLegacyConversation(db:Database,owner:string){
 if(await db.prepare("SELECT id FROM orbit_conversations WHERE owner_id=? AND id='legacy'").bind(owner).first())return;
 await db.prepare(`INSERT OR IGNORE INTO orbit_conversations(owner_id,id,title,project_id,revision,created_at,updated_at)
  SELECT ?,'legacy','이전 대화',NULL,0,MIN(created_at),MAX(updated_at) FROM orbit_agent_turns
  WHERE owner_id=? AND conversation_id='legacy' HAVING COUNT(*)>0`).bind(owner,owner).run();
}
export async function getConversation(db:Database,owner:string,id:string){
 if(id==='legacy')await ensureLegacyConversation(db,owner);
 const row=await db.prepare('SELECT * FROM orbit_conversations WHERE owner_id=? AND id=?').bind(owner,id).first<Row>();
 if(!row)throw new AgentError('대화를 찾을 수 없습니다. 대화 목록을 다시 열어 주세요.','NOT_FOUND',404);
 return toConversation(row);
}
// The project check is part of the write so a concurrent project deletion
// cannot leave a newly assigned conversation pointing at a missing project.
const projectGate=`(? IS NULL OR EXISTS(SELECT 1 FROM orbit_workspaces w,json_each(w.state_json,'$.projects') p WHERE w.owner_id=? AND json_extract(p.value,'$.id')=?))`;
export async function createConversation(db:Database,owner:string,input:z.infer<typeof createConversationSchema>){
 const now=new Date().toISOString();
 await db.prepare(`INSERT INTO orbit_conversations(owner_id,id,title,project_id,revision,created_at,updated_at)
  SELECT ?,?,?,?,0,?,? WHERE ${projectGate} ON CONFLICT(owner_id,id) DO NOTHING`).bind(owner,input.id,input.title,input.projectId,now,now,input.projectId,owner,input.projectId).run();
 const row=await getConversation(db,owner,input.id).catch(()=>null);
 if(!row)throw new AgentError('내 워크스페이스에 있는 프로젝트를 선택해 주세요.','PROJECT',409);
 if(row.title!==input.title||row.projectId!==input.projectId)throw new AgentError('이미 다른 내용으로 생성된 대화입니다. 목록을 다시 열어 주세요.','CONFLICT',409);
 return row;
}
export async function updateConversation(db:Database,owner:string,input:z.infer<typeof updateConversationSchema>){
 await getConversation(db,owner,input.id);
 const result=await db.prepare(`UPDATE orbit_conversations SET title=?,project_id=?,revision=revision+1,updated_at=?
  WHERE owner_id=? AND id=? AND revision=? AND ${projectGate}
  AND NOT EXISTS(SELECT 1 FROM orbit_agent_turns WHERE owner_id=? AND conversation_id=? AND status='running')`).bind(input.title,input.projectId,new Date().toISOString(),owner,input.id,input.expectedRevision,input.projectId,owner,input.projectId,owner,input.id).run();
 if(result.meta?.changes!==1)throw new AgentError('응답이 진행 중이거나 대화·프로젝트가 변경됐습니다. 최신 목록에서 다시 정리해 주세요.','CONFLICT',409);
 return getConversation(db,owner,input.id);
}
export async function listConversations(db:Database,owner:string,options:{projectId?:string|null;before?:string}={}){
 await ensureLegacyConversation(db,owner);
 const cursor=parseCursor(options.before),project=options.projectId===undefined?'':' AND project_id IS ?';
 const {results}=await db.prepare(`SELECT * FROM orbit_conversations WHERE owner_id=? AND (updated_at<? OR (updated_at=? AND id<?))${project} ORDER BY updated_at DESC,id DESC LIMIT 51`).bind(owner,cursor.at,cursor.at,cursor.id,...(options.projectId===undefined?[]:[options.projectId])).all<Row>();
 return {items:results.slice(0,50).map(toConversation),hasMore:results.length>50,nextBefore:results.length>50?results[49].updated_at+'|'+results[49].id:null};
}
