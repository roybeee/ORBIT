import type {Database} from '../../../db/repository.ts';
import {AgentError} from './errors.ts';
import type {AgentAction,AgentTurn} from './types.ts';
interface TurnRow {id:string;input:string;status:AgentTurn['status'];response_json:string;created_at:string;updated_at:string}
interface ActionRow {id:string;turn_id:string;title:string;reason:string;action_json:string;expected_revision:number;state:AgentAction['state'];note:string;revisit_date:string|null;result_json:string;created_at:string;updated_at:string}
export const toAction=(r:ActionRow):AgentAction=>({id:r.id,turnId:r.turn_id,title:r.title,reason:r.reason,action:JSON.parse(r.action_json),expectedRevision:r.expected_revision,state:r.state,note:r.note,revisitDate:r.revisit_date,result:JSON.parse(r.result_json),createdAt:r.created_at});
export async function listAgent(db:Database,owner:string,before?:string){
 const {results}=await db.prepare('SELECT * FROM orbit_agent_turns WHERE owner_id=? AND created_at<? ORDER BY created_at DESC,rowid DESC LIMIT 31').bind(owner,before??'9999').all<TurnRow>();
 const actionRows=await db.prepare(`SELECT * FROM orbit_agent_actions WHERE owner_id=? AND (state IN ('pending','deferred','applying') OR turn_id IN (SELECT id FROM orbit_agent_turns WHERE owner_id=? AND created_at<? ORDER BY created_at DESC,rowid DESC LIMIT 30)) ORDER BY created_at DESC,rowid DESC`).bind(owner,owner,before??'9999').all<ActionRow>();
 return {turns:results.slice(0,30).reverse().map(r=>({id:r.id,input:r.input,status:r.status,text:'',sources:[],...JSON.parse(r.response_json),createdAt:r.created_at} as AgentTurn)),actions:actionRows.results.reverse().map(toAction),hasMore:results.length>30,nextBefore:results.length>30?results[29].created_at:null};
}
export async function beginTurn(db:Database,owner:string,id:string,input:string){
 const old=await db.prepare('SELECT * FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,id).first<TurnRow>();if(old&&old.input!==input)throw new AgentError('같은 대화 번호에 다른 내용이 있습니다. 새 메시지로 보내 주세요.','CONFLICT',409);if(old?.status==='completed')return {replayed:true,lease:''};
 const now=new Date().toISOString();await db.prepare("UPDATE orbit_agent_turns SET status='failed',response_json=? WHERE owner_id=? AND status='running' AND updated_at<?").bind(JSON.stringify({text:'',sources:[],error:'연결이 끝나지 않았습니다. 같은 메시지를 다시 시도해 주세요.'}),owner,new Date(Date.now()-300000).toISOString()).run();
 try{const r=await db.prepare("INSERT INTO orbit_agent_turns(owner_id,id,input,status,response_json,created_at,updated_at) VALUES(?,?,?,'running','{}',?,?) ON CONFLICT(owner_id,id) DO UPDATE SET status='running',response_json='{}',updated_at=excluded.updated_at WHERE orbit_agent_turns.status='failed'").bind(owner,id,input,now,now).run();if(r.meta?.changes!==1)throw new Error('Busy')}catch{throw new AgentError('앞선 대화를 처리 중입니다. 잠시 후 다시 시도해 주세요.','BUSY',409)}
 return {replayed:false,lease:now};
}
export async function finishTurn(db:Database,owner:string,id:string,lease:string,response:Pick<AgentTurn,'text'|'sources'>,actions:AgentAction[]){
 const now=new Date().toISOString();const statements=[db.prepare("UPDATE orbit_agent_turns SET status='completed',response_json=?,updated_at=? WHERE owner_id=? AND id=? AND status='running' AND updated_at=?").bind(JSON.stringify(response),now,owner,id,lease)];
 for(const a of actions)statements.push(db.prepare("INSERT INTO orbit_agent_actions(owner_id,id,turn_id,title,reason,action_json,expected_revision,state,note,revisit_date,result_json,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'pending','',NULL,'{}',?,? WHERE EXISTS(SELECT 1 FROM orbit_agent_turns WHERE owner_id=? AND id=? AND status='completed' AND updated_at=?)").bind(owner,a.id,id,a.title,a.reason,JSON.stringify(a.action),a.expectedRevision,now,now,owner,id,now));
 const result=await db.batch(statements);if(result[0].meta?.changes!==1)throw new AgentError('대화 결과가 갱신됐습니다. 최신 대화를 불러와 주세요.','CONFLICT',409);
}
export async function failTurn(db:Database,owner:string,id:string,lease:string,message:string){await db.prepare("UPDATE orbit_agent_turns SET status='failed',response_json=?,updated_at=? WHERE owner_id=? AND id=? AND status='running' AND updated_at=?").bind(JSON.stringify({text:'',sources:[],error:message}),new Date().toISOString(),owner,id,lease).run()}
export async function findAction(db:Database,owner:string,id:string){const row=await db.prepare('SELECT * FROM orbit_agent_actions WHERE owner_id=? AND id=?').bind(owner,id).first<ActionRow>();if(!row)throw new AgentError('제안을 찾을 수 없습니다.','NOT_FOUND',404);return toAction(row)}
export async function claimAction(db:Database,owner:string,id:string){
 const now=new Date().toISOString();await db.prepare("UPDATE orbit_agent_actions SET state='pending' WHERE owner_id=? AND state='applying' AND updated_at<?").bind(owner,new Date(Date.now()-300000).toISOString()).run();
 try{const r=await db.prepare("UPDATE orbit_agent_actions SET state='applying',updated_at=? WHERE owner_id=? AND id=? AND state='pending'").bind(now,owner,id).run();if(r.meta?.changes!==1)throw new Error('Busy')}catch{throw new AgentError('다른 제안이 적용 중이거나 상태가 바뀌었습니다. 잠시 후 다시 확인해 주세요.','BUSY',409)}return now;
}
export async function resetAction(db:Database,owner:string,id:string,lease:string){await db.prepare("UPDATE orbit_agent_actions SET state='pending' WHERE owner_id=? AND id=? AND state='applying' AND updated_at=?").bind(owner,id,lease).run()}
export async function markApproved(db:Database,owner:string,action:AgentAction,lease:string,newRevision:number,result:unknown={}){
 await db.batch([
  db.prepare("UPDATE orbit_agent_actions SET state='approved',result_json=?,updated_at=? WHERE owner_id=? AND id=? AND state='applying' AND updated_at=?").bind(JSON.stringify(result),new Date().toISOString(),owner,action.id,lease),
  db.prepare("UPDATE orbit_agent_actions SET expected_revision=? WHERE owner_id=? AND turn_id=? AND state='pending' AND expected_revision=? AND EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=? AND mutation_id=?)").bind(newRevision,owner,action.turnId,action.expectedRevision,owner,newRevision,action.id),
 ]);
}
