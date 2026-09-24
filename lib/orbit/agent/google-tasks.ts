import {readWorkspace,writeCommand,RevisionConflict,type Database} from '../../../db/repository.ts';
import {DomainError} from '../reducer.ts';
import {addDays,todayInZone} from '../dates.ts';
import {recordSource,sourceStatuses} from '../source-status.ts';
import type {Task} from '../model.ts';
import {accessToken,fetchJson,type Runtime} from './integrations.ts';

// Two-way sync between ORBIT tasks and the Google Tasks they were created with (from Slack).
// Each link keeps the last state both sides agreed on; whichever side moved away from it is
// copied to the other, and when both moved, ORBIT wins. Deleting either side deletes the other.
type Side={title:string;due:string;status:'needsAction'|'completed'};
type Remote=Side&{etag:string;completed?:string};
type Link={task_id:string;task_list_id:string;google_task_id:string;state_json:string};
class Forbidden extends Error {}
const MAX_PER_RUN=25,THROTTLE_MS=60000;
const sideOf=(t:Task):Side=>({title:t.title,due:t.due,status:t.status==='done'?'completed':'needsAction'});
const same=(a:Side,b:Side)=>a.title===b.title&&a.due===b.due&&a.status===b.status;

async function call(token:string,list:string,id:string,init:RequestInit={}){
 const url='https://tasks.googleapis.com/tasks/v1/lists/'+encodeURIComponent(list)+'/tasks/'+encodeURIComponent(id);
 const result=await fetchJson<Record<string,string|boolean>>(url,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...init.headers}},8000);
 if(result.response.status===401||result.response.status===403)throw new Forbidden();
 return result;
}
async function remoteOf(token:string,list:string,id:string,fallbackDue:string):Promise<Remote|null>{
 const {response,data}=await call(token,list,id);
 if(response.status===404||response.status===410||(response.ok&&data.deleted===true))return null;
 if(!response.ok)throw new Error('Google Tasks 조회 실패 '+response.status);
 // A Google Task can lose its due date; ORBIT tasks always have one, so keep ORBIT's.
 const due=typeof data.due==='string'?data.due.slice(0,10):fallbackDue;
 return {title:String(data.title??''),due,status:data.status==='completed'?'completed':'needsAction',etag:String(data.etag??''),...(typeof data.completed==='string'?{completed:data.completed}:{})};
}

async function update(db:Database,owner:string,action:{type:'task.upsert';task:Task}|{type:'task.delete';id:string}){
 const snapshot=await readWorkspace(db,owner);
 try{await writeCommand(db,owner,{operationId:crypto.randomUUID(),expectedRevision:snapshot.revision,action});return true}
 catch(error){if(error instanceof RevisionConflict||error instanceof DomainError)return false;throw error}
}
const saveLink=(db:Database,owner:string,task:Task,state:Side&{etag:string})=>db.prepare('INSERT INTO orbit_google_task_links(owner_id,task_id,task_list_id,google_task_id,state_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,task_id) DO UPDATE SET task_list_id=excluded.task_list_id,google_task_id=excluded.google_task_id,state_json=excluded.state_json,updated_at=excluded.updated_at')
 .bind(owner,task.id,task.googleTask!.taskListId,task.googleTask!.taskId,JSON.stringify(state),new Date().toISOString()).run();
const dropLink=(db:Database,owner:string,taskId:string)=>db.prepare('DELETE FROM orbit_google_task_links WHERE owner_id=? AND task_id=?').bind(owner,taskId).run();

async function syncOne(db:Database,owner:string,token:string,task:Task,link:Link|undefined,today:string){
 const {taskListId:list,taskId:id}=task.googleTask!;
 const remote=await remoteOf(token,list,id,task.due);
 if(!remote){if(await update(db,owner,{type:'task.delete',id:task.id}))await dropLink(db,owner,task.id);return}
 const local=sideOf(task),last:Side=link?JSON.parse(link.state_json):remote;
 if(!same(local,last)){
  if(same(local,remote)){await saveLink(db,owner,task,{...local,etag:remote.etag});return}
  const body={title:local.title,due:local.due+'T00:00:00.000Z',status:local.status,...(local.status==='needsAction'?{completed:null}:{})};
  const {response,data}=await call(token,list,id,{method:'PATCH',headers:{'If-Match':remote.etag},body:JSON.stringify(body)});
  if(response.ok)await saveLink(db,owner,task,{...local,etag:String(data.etag??'')});
  return;
 }
 if(!same(remote,last)){
  const status=remote.status==='completed'?'done':task.status==='done'?'todo':task.status;
  const completedOn=remote.status==='completed'?(remote.completed?.slice(0,10)??today):undefined;
  if(!await update(db,owner,{type:'task.upsert',task:{...task,title:remote.title||task.title,due:remote.due,status,completedOn}}))return;
 }
 await saveLink(db,owner,task,{title:remote.title||task.title,due:remote.due,status:remote.status,etag:remote.etag});
}

export async function syncGoogleTasks(db:Database,owner:string,env:Runtime,options:{force?:boolean}={}){
 const snapshot=await readWorkspace(db,owner),today=todayInZone(snapshot.data.preferences.timeZone);
 const {results:links}=await db.prepare('SELECT task_id,task_list_id,google_task_id,state_json FROM orbit_google_task_links WHERE owner_id=?').bind(owner).all<Link>();
 // Open tasks and ones finished in the last two weeks; older finished work is left alone.
 const tasks=snapshot.data.tasks.filter(t=>t.googleTask&&(t.status!=='done'||(t.completedOn??t.due)>=addDays(today,-14))).slice(0,MAX_PER_RUN);
 const removed=links.filter(l=>!snapshot.data.tasks.some(t=>t.id===l.task_id));
 if(!tasks.length&&!removed.length)return;
 if(!options.force){const last=(await sourceStatuses(db,owner)).find(s=>s.provider==='google_tasks');if(last&&Date.now()-Date.parse(last.attemptedAt)<THROTTLE_MS)return}
 try{
  const token=await accessToken(db,owner,'google_calendar',env);
  for(const task of tasks)await syncOne(db,owner,token,task,links.find(l=>l.task_id===task.id),today);
  for(const link of removed){
   const last=JSON.parse(link.state_json) as {etag?:string};
   const {response}=await call(token,link.task_list_id,link.google_task_id,{method:'DELETE',headers:last.etag?{'If-Match':last.etag}:{}});
   // 412: changed in Google after ORBIT deleted it, so it is kept there; either way the link ends.
   if(response.ok||[404,410,412].includes(response.status))await dropLink(db,owner,link.task_id);
  }
  await recordSource(db,owner,'google_tasks',{state:'ok',detail:'연결된 할 일 확인 완료',count:tasks.length});
 }catch(error){
  const detail=error instanceof Forbidden?'Google Tasks 권한이 없습니다. 연결 관리에서 Google Calendar를 다시 연결해 주세요.':error instanceof Error?error.message:'Google Tasks 동기화 실패';
  await recordSource(db,owner,'google_tasks',{state:error instanceof Forbidden?'partial':'error',detail});
 }
}
