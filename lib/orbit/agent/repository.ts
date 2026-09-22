import {notificationStatement} from '../notifications/store.ts';
import {readWorkspace} from '../../../db/repository.ts';
import {guardFor} from './action-guard.ts';
import {applyAction} from '../reducer.ts';
import type {Database} from '../../../db/repository.ts';
import {filesByIds,filesForTurns,attachmentGate,attachmentGateValues,bindFiles} from '../attachments/storage.ts';
import {AgentError} from './errors.ts';
import {ensureLegacyConversation,getConversation,parseCursor} from './conversations.ts';
import type {AgentAction,AgentTurn} from './types.ts';
interface TurnRow {attachment_ids:string;conversation_id:string;id:string;input:string;status:AgentTurn['status'];response_json:string;created_at:string;updated_at:string}
interface ActionRow {guard_json?:string;conversation_id?:string;id:string;turn_id:string;title:string;reason:string;action_json:string;expected_revision:number;state:AgentAction['state'];note:string;revisit_date:string|null;result_json:string;created_at:string;updated_at:string}
function publicResponse(json:string){const r=JSON.parse(json);return {text:r.text??'',sources:r.sources??[],...(r.error?{error:r.error}:{}),...(r.progress?{progress:r.progress}:{})}}
export const toAction=(r:ActionRow):AgentAction=>({...(r.guard_json&&JSON.parse(r.guard_json).version===1?{guard:JSON.parse(r.guard_json)}:{}),conversationId:r.conversation_id,id:r.id,turnId:r.turn_id,title:r.title,reason:r.reason,action:JSON.parse(r.action_json),expectedRevision:r.expected_revision,state:r.state,note:r.note,revisitDate:r.revisit_date,result:JSON.parse(r.result_json),createdAt:r.created_at});
export async function pendingActions(db:Database,owner:string){
 const {results}=await db.prepare("SELECT a.*,t.conversation_id FROM orbit_agent_actions a JOIN orbit_agent_turns t ON t.owner_id=a.owner_id AND t.id=a.turn_id WHERE a.owner_id=? AND a.state IN ('pending','deferred','applying') ORDER BY a.created_at,a.rowid").bind(owner).all<ActionRow>();return results.map(toAction);
}
export async function listAgent(db:Database,owner:string,before?:string,conversationId='legacy'){
 const cursor=parseCursor(before);
 const conversation=conversationId==='new'?null:await getConversation(db,owner,conversationId).catch(error=>{if(conversationId==='legacy'&&error.code==='NOT_FOUND')return null;throw error});
 const {results}=await db.prepare('SELECT * FROM orbit_agent_turns WHERE owner_id=? AND conversation_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 31').bind(owner,conversationId,cursor.at,cursor.at,cursor.id).all<TurnRow>();
 const page=results.slice(0,30),ids=page.map(t=>t.id),attachments=await filesForTurns(db,owner,ids);
 const actions=ids.length?(await db.prepare(`SELECT a.*,t.conversation_id FROM orbit_agent_actions a JOIN orbit_agent_turns t ON t.owner_id=a.owner_id AND t.id=a.turn_id WHERE a.owner_id=? AND a.turn_id IN (${ids.map(()=>'?').join(',')}) ORDER BY a.created_at,a.rowid`).bind(owner,...ids).all<ActionRow>()).results.map(toAction):[];
 const {results:running}=await db.prepare("SELECT id,conversation_id FROM orbit_agent_turns WHERE owner_id=? AND status='running' ORDER BY created_at,id").bind(owner).all<{id:string;conversation_id:string}>();
 const activeRuns=running.map(r=>({id:r.id,conversationId:r.conversation_id})),activeRun=activeRuns.find(r=>r.conversationId===conversationId)??null;
 return {conversation,turns:page.reverse().map(r=>({attachments:(JSON.parse(r.attachment_ids) as string[]).flatMap(id=>{const file=attachments.find(a=>a.id===id);return file?[file]:[]}),conversationId:r.conversation_id,id:r.id,input:r.input,status:r.status,...publicResponse(r.response_json),createdAt:r.created_at} as AgentTurn)),actions,pendingActions:await pendingActions(db,owner),activeRun,activeRuns,hasMore:results.length>30,nextBefore:results.length>30?results[29].created_at+'|'+results[29].id:null};
}
export async function beginTurn(db:Database,owner:string,id:string,input:string,conversationId='legacy',attachmentIds:string[]=[],retryLease?:string,queuedJob?:string){
 const old=await db.prepare('SELECT * FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,id).first<TurnRow>();
 if(old&&(old.input!==input||old.conversation_id!==conversationId||old.attachment_ids!==JSON.stringify(attachmentIds)))throw new AgentError('같은 메시지 번호에 다른 내용이나 대화가 있습니다. 새 메시지로 보내 주세요.','CONFLICT',409);
 if(old?.status==='completed')return {replayed:true,lease:''};
 await filesByIds(db,owner,attachmentIds);
 const now=new Date(Math.max(Date.now(),Date.parse(old?.updated_at??'')+1||0)).toISOString();
 if(conversationId==='legacy'){
  await ensureLegacyConversation(db,owner);
  await db.prepare("INSERT OR IGNORE INTO orbit_conversations(owner_id,id,title,project_id,revision,created_at,updated_at) VALUES(?,'legacy','이전 대화',NULL,0,?,?)").bind(owner,now,now).run();
 }else await getConversation(db,owner,conversationId);
 await db.prepare("UPDATE orbit_agent_turns SET status='failed',response_json=? WHERE owner_id=? AND status='running' AND updated_at<? AND NOT EXISTS(SELECT 1 FROM orbit_hermes_jobs j WHERE j.owner_id=orbit_agent_turns.owner_id AND j.turn_id=orbit_agent_turns.id)").bind(JSON.stringify({text:'',sources:[],error:'연결이 끝나지 않았습니다. 같은 메시지를 다시 시도해 주세요.'}),owner,new Date(Date.now()-300000).toISOString()).run();
 try{
  const results=await db.batch([
   db.prepare(`INSERT INTO orbit_agent_turns(owner_id,id,conversation_id,input,attachment_ids,status,response_json,created_at,updated_at) SELECT ?,?,?,?,?,'running','{}',?,? WHERE ${attachmentGate(attachmentIds)} ON CONFLICT(owner_id,id) DO UPDATE SET status='running',response_json='{}',updated_at=excluded.updated_at WHERE orbit_agent_turns.status='failed' AND orbit_agent_turns.updated_at=? AND orbit_agent_turns.input=excluded.input AND orbit_agent_turns.conversation_id=excluded.conversation_id AND orbit_agent_turns.attachment_ids=excluded.attachment_ids AND ${attachmentGate(attachmentIds)}`).bind(owner,id,conversationId,input,JSON.stringify(attachmentIds),now,now,...attachmentGateValues(owner,attachmentIds,'turn',id),retryLease??'',...attachmentGateValues(owner,attachmentIds,'turn',id)),
   db.prepare("UPDATE orbit_conversations SET title=CASE WHEN title='새 대화' THEN ? ELSE title END,revision=revision+1,updated_at=? WHERE owner_id=? AND id=? AND changes()=1 AND EXISTS(SELECT 1 FROM orbit_agent_turns WHERE owner_id=? AND id=? AND status='running' AND updated_at=?)").bind(input.replace(/\s+/g,' ').slice(0,60),now,owner,conversationId,owner,id,now),
   ...(queuedJob?[db.prepare("DELETE FROM orbit_hermes_jobs WHERE owner_id=? AND turn_id=? AND turn_lease<>? AND EXISTS(SELECT 1 FROM orbit_agent_turns WHERE owner_id=? AND id=? AND status='running' AND updated_at=?)").bind(owner,id,now,owner,id,now),db.prepare("INSERT OR IGNORE INTO orbit_hermes_jobs(owner_id,turn_id,turn_lease,job_json,lease_until) SELECT ?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM orbit_agent_turns WHERE owner_id=? AND id=? AND status='running' AND updated_at=?)").bind(owner,id,now,queuedJob,owner,id,now)]:[]),
   ...bindFiles(db,owner,attachmentIds,'turn',id,"EXISTS(SELECT 1 FROM orbit_agent_turns WHERE owner_id=? AND id=? AND updated_at=? AND attachment_ids=?)",[owner,id,now,JSON.stringify(attachmentIds)])
  ]);if(results[0].meta?.changes!==1)throw new Error('Busy');
 }catch{throw new AgentError('이 대화의 응답을 처리 중입니다. 다른 대화에서는 동시에 요청할 수 있습니다.','BUSY',409)}
 return {replayed:false,lease:now};
}
export async function finishTurn(db:Database,owner:string,id:string,lease:string,response:Pick<AgentTurn,'text'|'sources'>,actions:AgentAction[],refreshActionId?:string){
 const snapshot=actions.some(a=>!a.guard)?await readWorkspace(db,owner):null;let projected=snapshot?.data;
 for(const action of actions){if(!action.guard&&snapshot?.revision===action.expectedRevision&&projected){action.guard=await guardFor(action.action,projected);try{if(!action.action.type.startsWith('google.')&&action.action.type!=='agent.dispatch')projected=applyAction(projected,action.action as any)}catch{}}}
 const refreshGate=refreshActionId?"EXISTS(SELECT 1 FROM orbit_agent_actions WHERE owner_id=? AND id=? AND state='pending' AND json_extract(result_json,'$.refreshTurnId')=?)":'1';
 const refreshValues=refreshActionId?[owner,refreshActionId,id]:[];
 const now=new Date().toISOString(),receipt=crypto.randomUUID();const statements=[db.prepare(`UPDATE orbit_agent_turns SET status='completed',response_json=CASE WHEN ${refreshGate} THEN ? ELSE ? END,updated_at=? WHERE owner_id=? AND id=? AND status='running' AND updated_at=? AND NOT EXISTS(SELECT 1 FROM orbit_hermes_jobs WHERE owner_id=? AND turn_id=? AND cancel_requested=1)`).bind(...refreshValues,JSON.stringify({...response,_receipt:receipt}),JSON.stringify({text:'이전 제안의 검토 상태가 바뀌어 새 제안을 게시하지 않았습니다.',sources:[],_receipt:receipt}),now,owner,id,lease,owner,id)];
 for(const a of actions)statements.push(db.prepare(`INSERT INTO orbit_agent_actions(owner_id,id,turn_id,title,reason,action_json,expected_revision,guard_json,state,note,revisit_date,result_json,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,'pending','',NULL,'{}',?,? WHERE EXISTS(SELECT 1 FROM orbit_agent_turns WHERE owner_id=? AND id=? AND status='completed' AND json_extract(response_json,'$._receipt')=?) AND ${refreshGate}`).bind(owner,a.id,id,a.title,a.reason,JSON.stringify(a.action),a.expectedRevision,JSON.stringify(a.guard??{}),now,now,owner,id,receipt,...refreshValues));
 if(refreshActionId)statements.push(db.prepare("UPDATE orbit_agent_actions SET state='rejected',note='최신 기록으로 다시 검토한 결과가 아래 대화에 있습니다.',updated_at=? WHERE owner_id=? AND id=? AND state='pending' AND json_extract(result_json,'$.refreshTurnId')=? AND EXISTS(SELECT 1 FROM orbit_agent_turns WHERE owner_id=? AND id=? AND status='completed' AND json_extract(response_json,'$._receipt')=?)").bind(now,owner,refreshActionId,id,owner,id,receipt));
 const result=await db.batch(statements);if(result[0].meta?.changes!==1)throw new AgentError('대화 결과가 갱신됐습니다. 최신 대화를 불러와 주세요.','CONFLICT',409);
}
export async function failTurn(db:Database,owner:string,id:string,lease:string,message:string){await db.prepare("UPDATE orbit_agent_turns SET status='failed',response_json=?,updated_at=? WHERE owner_id=? AND id=? AND status='running' AND updated_at=?").bind(JSON.stringify({text:'',sources:[],error:message}),new Date().toISOString(),owner,id,lease).run()}
export async function findAction(db:Database,owner:string,id:string){const row=await db.prepare('SELECT a.*,t.conversation_id FROM orbit_agent_actions a JOIN orbit_agent_turns t ON t.owner_id=a.owner_id AND t.id=a.turn_id WHERE a.owner_id=? AND a.id=?').bind(owner,id).first<ActionRow>();if(!row)throw new AgentError('제안을 찾을 수 없습니다.','NOT_FOUND',404);return toAction(row)}
export async function claimAction(db:Database,owner:string,id:string){
 const now=new Date().toISOString();await db.prepare("UPDATE orbit_agent_actions SET state='pending' WHERE owner_id=? AND state='applying' AND updated_at<?").bind(owner,new Date(Date.now()-300000).toISOString()).run();
 try{const r=await db.prepare("UPDATE orbit_agent_actions SET state='applying',updated_at=? WHERE owner_id=? AND id=? AND state='pending'").bind(now,owner,id).run();if(r.meta?.changes!==1)throw new Error('Busy')}catch{throw new AgentError('다른 제안이 적용 중이거나 상태가 바뀌었습니다. 잠시 후 다시 확인해 주세요.','BUSY',409)}return now;
}
export async function resetAction(db:Database,owner:string,id:string,lease:string){await db.prepare("UPDATE orbit_agent_actions SET state='pending' WHERE owner_id=? AND id=? AND state='applying' AND updated_at=?").bind(owner,id,lease).run()}
export async function markApproved(db:Database,owner:string,action:AgentAction,lease:string,newRevision:number,result:unknown={}){
 await db.batch([
  db.prepare("UPDATE orbit_agent_actions SET state='approved',result_json=?,updated_at=? WHERE owner_id=? AND id=? AND state='applying' AND updated_at=?").bind(JSON.stringify(result),new Date().toISOString(),owner,action.id,lease),
  notificationStatement(db,owner,{id:'action:'+action.id,kind:action.action.type==='agent.dispatch'?'info':'completed',title:action.action.type==='agent.dispatch'?'승인한 업무 실행 접수':'승인한 변경 반영 완료',body:action.title,href:action.guard?.meeting?'/?note='+encodeURIComponent(action.guard.meeting.noteId):'/?conversation='+encodeURIComponent(action.conversationId??'legacy'),createdAt:new Date().toISOString()},"EXISTS(SELECT 1 FROM orbit_agent_actions WHERE owner_id=? AND id=? AND state='approved')",[owner,action.id]),
  db.prepare("UPDATE orbit_agent_actions SET expected_revision=? WHERE owner_id=? AND turn_id=? AND state='pending' AND expected_revision=? AND EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=? AND mutation_id=?)").bind(newRevision,owner,action.turnId,action.expectedRevision,owner,newRevision,action.id),
 ]);
}
