import {uploadContent,fileIds,type Bucket} from './attachments/storage.ts';
import {AgentError} from './agent/errors.ts';
import {streamHasher} from './stream-hash.ts';
import {z} from 'zod';
import type {Database} from '../../db/repository.ts';
import {readWorkspace,RevisionConflict} from '../../db/repository.ts';
import {digest} from './backup.ts';
import {DomainError} from './reducer.ts';
const id=z.string().min(1).max(100),stamp=z.string().min(1).max(40),json=z.string().max(250000);
const conversation=z.object({id:z.union([z.string().uuid(),z.literal('legacy')]),title:z.string().max(100),project_id:id.nullable().optional(),revision:z.number().int().nonnegative().optional(),created_at:stamp,updated_at:stamp}).passthrough();
const turn=z.object({id:z.string().uuid(),conversation_id:z.union([z.string().uuid(),z.literal('legacy')]).optional(),input:z.string().max(8000),attachment_ids:z.string().max(2000).optional(),status:z.enum(['running','completed','failed']),response_json:json,created_at:stamp,updated_at:stamp}).passthrough();
const order=z.object({id:z.string().uuid(),request_json:json,state_json:json,created_at:stamp}).passthrough();
const attachment=z.object({id:z.string().uuid(),name:z.string().max(200),size:z.number().positive().max(104857600),context_text:z.string().max(100000),context_label:z.string().max(200),target_type:z.enum(['turn','event']).nullable(),target_id:id.nullable(),created_at:stamp}).passthrough();
const sourceSchema=z.object({title:z.string().max(1000),label:z.string().max(1000),id:z.string().max(200).optional(),kind:z.enum(['metric','note','task','project','goal','event','review','conversation','decision','delegation','plaud','memory']).optional(),recordId:id.optional(),revision:z.number().int().positive().optional(),date:z.string().max(40).optional(),excerpt:z.string().max(10000).optional(),scope:z.enum(['metadata','excerpt','full']).optional(),retrievedAt:stamp.optional()});
const responseSchema=z.object({text:z.string().max(200000).default(''),sources:z.array(sourceSchema).max(100).default([]),error:z.string().max(2000).optional()});
export const historySchema=z.object({conversations:z.array(conversation).max(100).default([]),turns:z.array(turn).max(100).default([]),orders:z.array(order).max(100).default([]),attachments:z.array(attachment).max(100).default([])}).strict();
export async function restoreHistory(db:Database,owner:string,raw:unknown,operationId:string,checksum:string){
 const p=historySchema.safeParse(raw);if(!p.success)throw new DomainError('복구 이력의 형식을 확인해 주세요.');if(await digest(raw)!==checksum)throw new DomainError('복구 이력의 검증값이 다릅니다.');
 const prior=await db.prepare('SELECT action_hash FROM orbit_mutations WHERE owner_id=? AND operation_id=?').bind(owner,operationId).first<{action_hash:string}>();if(prior){if(prior.action_hash!=='history:'+checksum)throw new RevisionConflict('다른 내용으로 사용된 복구 번호입니다.');return {replayed:true,verified:true};}
 const {data,revision}=await readWorkspace(db,owner),at=new Date().toISOString(),statements=[];
 const knownConversations=new Set((await db.prepare('SELECT id FROM orbit_conversations WHERE owner_id=?').bind(owner).all<{id:string}>()).results.map(r=>r.id));
 for(const c of p.data.conversations){knownConversations.add(c.id);statements.push(db.prepare('INSERT OR IGNORE INTO orbit_conversations(owner_id,id,title,project_id,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(owner,c.id,c.title,data.projects.some(p=>p.id===c.project_id)?(c.project_id??null):null,c.revision??0,c.created_at,c.updated_at));}
 for(const t of p.data.turns){const conversationId=t.conversation_id??'legacy';if(!knownConversations.has(conversationId)){if(conversationId!=='legacy')throw new DomainError('대화 목록을 먼저 복원해 주세요.');knownConversations.add('legacy');statements.push(db.prepare("INSERT OR IGNORE INTO orbit_conversations(owner_id,id,title,project_id,revision,created_at,updated_at) VALUES(?,'legacy','복원한 이전 대화',NULL,0,?,?)").bind(owner,t.created_at,t.updated_at));}
  let response:Record<string,unknown>;try{response=JSON.parse(t.response_json)}catch{throw new DomainError('대화 응답 형식이 올바르지 않습니다.');}if(!response||typeof response!=='object'||Array.isArray(response))throw new DomainError('대화 응답 형식이 올바르지 않습니다.');
  const checked=responseSchema.safeParse(response);if(!checked.success)throw new DomainError('대화 응답의 내용과 근거 형식을 확인해 주세요.');response=checked.data;
  if(t.status==='running')response={...response,error:'백업 시 진행 중이던 대화입니다. 복원 시 실행을 재개하지 않았습니다.'};
  let ids:unknown;try{ids=JSON.parse(t.attachment_ids??'[]')}catch{throw new DomainError('대화 첨부 연결을 확인해 주세요.');}if(!z.array(z.string().uuid()).max(8).safeParse(ids).success)throw new DomainError('대화 첨부 연결을 확인해 주세요.');
  statements.push(db.prepare('INSERT OR IGNORE INTO orbit_agent_turns(owner_id,id,conversation_id,input,attachment_ids,status,response_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(owner,t.id,conversationId,t.input,JSON.stringify(ids),t.status==='running'?'failed':t.status,JSON.stringify(response),t.created_at,t.updated_at));
 }
 for(const o of p.data.orders){let state:Record<string,unknown>;try{state=JSON.parse(o.state_json)}catch{throw new DomainError('실행 결과 형식이 올바르지 않습니다.');}if(!state||typeof state!=='object'||typeof state.title!=='string'||typeof state.output!=='string')throw new DomainError('실행 결과 내용이 올바르지 않습니다.');
  const safe={id:o.id,title:state.title.slice(0,160),instruction:String(state.instruction??'').slice(0,8000),projectId:data.projects.some(p=>p.id===state.projectId)?state.projectId:null,taskIds:Array.isArray(state.taskIds)?state.taskIds.filter((id:unknown)=>data.tasks.some(t=>t.id===id)):[],conversationId:knownConversations.has(state.conversationId as string)?state.conversationId:null,mode:'native',status:state.status==='completed'?'completed':'cancelled',runId:null,output:state.output.slice(0,60000),error:state.status==='completed'?'':'백업에서 복원한 기록 · 실행은 재개하지 않습니다.',createdAt:o.created_at,updatedAt:state.updatedAt??o.created_at,approval:null,controls:{steer:false,approval:false},activity:[{at,text:'백업에서 읽기 전용 실행 결과를 복원했습니다.'}]};
  statements.push(db.prepare('INSERT OR IGNORE INTO orbit_agent_orders(owner_id,id,connection_id,request_json,state_json,lease_until,stop_requested,created_at) VALUES(?,?,?,?,?,0,1,?)').bind(owner,o.id,'restored','{}',JSON.stringify(safe),o.created_at));
 }
 for(const f of p.data.attachments){const found=await db.prepare('SELECT state,size,name,prepared FROM orbit_attachments WHERE owner_id=? AND id=?').bind(owner,f.id).first<{state:string;size:number;name:string;prepared:number}>();if(!found||found.state!=='ready'||found.size!==f.size||found.name!==f.name)throw new DomainError('첨부 원본 업로드를 먼저 완료해 주세요.');if(found.prepared)continue;
  const exists=f.target_type==='turn'?(p.data.turns.some(t=>t.id===f.target_id)||!!await db.prepare('SELECT id FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,f.target_id).first()):f.target_type==='event'&&data.events.some(e=>e.id===f.target_id);
  statements.push(db.prepare("UPDATE orbit_attachments SET prepared=1,context_text=?,context_label=?,target_type=?,target_id=?,created_at=?,updated_at=? WHERE owner_id=? AND id=? AND prepared=0 AND state='ready'").bind(f.context_text,f.context_label,exists?f.target_type:null,exists?f.target_id:null,f.created_at,at,owner,f.id));
 }
 statements.push(db.prepare('INSERT INTO orbit_mutations(owner_id,operation_id,action_hash,revision,created_at) VALUES(?,?,?,?,?)').bind(owner,operationId,'history:'+checksum,revision,at));
 await db.batch(statements);
 for(const [table,records] of [['orbit_conversations',p.data.conversations],['orbit_agent_turns',p.data.turns],['orbit_agent_orders',p.data.orders],['orbit_attachments',p.data.attachments]] as const)for(const r of records)if(!await db.prepare(`SELECT id FROM ${table} WHERE owner_id=? AND id=?`).bind(owner,r.id).first())throw Error('History restore verification failed');
 return {verified:true,replayed:false,processed:p.data.conversations.length+p.data.turns.length+p.data.orders.length+p.data.attachments.length};
}

export async function restoreFileContent(db:Database,bucket:Bucket,owner:string,id:string,expected:string,request:Request){
 if(!fileIds.safeParse([id]).success||!(/^[a-f0-9]{64}$/).test(expected)||!request.body)throw new AgentError('복원 파일 검증값을 확인해 주세요.');
 const hash=await streamHasher();const stream=request.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({async transform(chunk,controller){await hash.update(chunk);controller.enqueue(chunk)},async flush(){if(await hash.end()!==expected)throw new AgentError('복원 파일 검증값이 일치하지 않습니다.','FILE_CHECKSUM',422);}}));
 return uploadContent(db,bucket,owner,id,new Request(request,{body:stream,duplex:'half'} as RequestInit));
}
