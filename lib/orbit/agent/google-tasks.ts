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
type Link={task_id:string;task_list_id:string;google_task_id:string;state_json:string;updated_at:string};
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

// Built from a fresh read, so an ORBIT edit made while Google was being fetched is kept.
type Action={type:'task.upsert';task:Task}|{type:'task.status';id:string;status:Task['status']}|{type:'task.delete';id:string};
async function update(db:Database,owner:string,taskId:string,build:(task:Task)=>Action|undefined){
 const snapshot=await readWorkspace(db,owner),task=snapshot.data.tasks.find(t=>t.id===taskId);
 const action=task&&build(task);if(!action)return false;
 try{await writeCommand(db,owner,{operationId:crypto.randomUUID(),expectedRevision:snapshot.revision,action});return true}
 catch(error){if(error instanceof RevisionConflict||error instanceof DomainError)return false;throw error}
}
const saveLink=(db:Database,owner:string,task:Task,state:Side&{etag:string})=>db.prepare('INSERT INTO orbit_google_task_links(owner_id,task_id,task_list_id,google_task_id,state_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,task_id) DO UPDATE SET task_list_id=excluded.task_list_id,google_task_id=excluded.google_task_id,state_json=excluded.state_json,updated_at=excluded.updated_at')
 .bind(owner,task.id,task.googleTask!.taskListId,task.googleTask!.taskId,JSON.stringify(state),new Date().toISOString()).run();
const dropLink=(db:Database,owner:string,taskId:string)=>db.prepare('DELETE FROM orbit_google_task_links WHERE owner_id=? AND task_id=?').bind(owner,taskId).run();

async function syncOne(db:Database,owner:string,token:string,task:Task,link:Link|undefined):Promise<'missing'|void>{
 const {taskListId:list,taskId:id}=task.googleTask!;
 const remote=await remoteOf(token,list,id,task.due);
 // Only a task this sync has seen in Google before can have been deleted there. Without a link
 // a 404 may mean another Google account or a task restored after its Google copy was removed.
 // A base link stored at creation (no etag yet) has not been confirmed in this account either.
 if(!remote){if(!link||!JSON.parse(link.state_json).etag)return 'missing';if(await update(db,owner,task.id,()=>({type:'task.delete',id:task.id})))await dropLink(db,owner,task.id);return}
 const local=sideOf(task),last:Side=link?JSON.parse(link.state_json):remote;
 if(!same(local,last)){
  if(same(local,remote)){await saveLink(db,owner,task,{...local,etag:remote.etag});return}
  const body={title:local.title,due:local.due+'T00:00:00.000Z',status:local.status,...(local.status==='needsAction'?{completed:null}:{})};
  const {response,data}=await call(token,list,id,{method:'PATCH',headers:{'If-Match':remote.etag},body:JSON.stringify(body)});
  if(response.ok)await saveLink(db,owner,task,{...local,etag:String(data.etag??'')});
  return;
 }
 if(!same(remote,last)){
  const title=remote.title||task.title;
  if((title!==task.title||remote.due!==task.due)&&!await update(db,owner,task.id,fresh=>({type:'task.upsert',task:{...fresh,title,due:remote.due}})))return;
  // task.status closes a running session and records the outcome like completing in ORBIT does.
  const status=remote.status==='completed'?'done':'todo';
  if(sideOf(task).status!==remote.status&&!await update(db,owner,task.id,fresh=>sideOf(fresh).status===remote.status?undefined:{type:'task.status',id:fresh.id,status}))return;
 }
 await saveLink(db,owner,task,{title:remote.title||task.title,due:remote.due,status:remote.status,etag:remote.etag});
}

export async function syncGoogleTasks(db:Database,owner:string,env:Runtime,options:{force?:boolean}={}){
 const snapshot=await readWorkspace(db,owner),today=todayInZone(snapshot.data.preferences.timeZone);
 const {results:links}=await db.prepare('SELECT task_id,task_list_id,google_task_id,state_json,updated_at FROM orbit_google_task_links WHERE owner_id=?').bind(owner).all<Link>();
 const checked=(t:Task)=>links.find(l=>l.task_id===t.id)?.updated_at??'';
 // Open tasks and ones finished in the last two weeks, least recently checked first so every
 // task gets its turn; older finished work is left alone.
 const tasks=snapshot.data.tasks.filter(t=>t.googleTask&&(t.status!=='done'||(t.completedOn??t.due)>=addDays(today,-14)))
  .sort((a,b)=>checked(a).localeCompare(checked(b))).slice(0,MAX_PER_RUN);
 const removed=links.filter(l=>!snapshot.data.tasks.some(t=>t.id===l.task_id));
 if(!tasks.length&&!removed.length)return;
 if(!options.force){const last=(await sourceStatuses(db,owner)).find(s=>s.provider==='google_tasks');if(last&&Date.now()-Date.parse(last.attemptedAt)<THROTTLE_MS)return}
 try{
  const token=await accessToken(db,owner,'google_calendar',env);
  let missing=0,failed=0;
  for(const task of tasks){
   try{if(await syncOne(db,owner,token,task,links.find(l=>l.task_id===task.id))==='missing')missing++}
   catch(error){if(error instanceof Forbidden)throw error;failed++}
  }
  for(const link of removed){
   const last=JSON.parse(link.state_json) as {etag?:string};
   const {response}=await call(token,link.task_list_id,link.google_task_id,{method:'DELETE',headers:last.etag?{'If-Match':last.etag}:{}});
   // 412: changed in Google after ORBIT deleted it, so it is kept there; either way the link ends.
   if(response.ok||[404,410,412].includes(response.status))await dropLink(db,owner,link.task_id);
  }
  const detail=missing?`Google Tasks에서 찾지 못한 할 일 ${missing}건(다른 Google 계정일 수 있음)`:failed?`확인하지 못한 할 일 ${failed}건, 다음에 다시 확인`:'연결된 할 일 확인 완료';
  await recordSource(db,owner,'google_tasks',{state:missing||failed?'partial':'ok',detail,count:tasks.length});
 }catch(error){
  const detail=error instanceof Forbidden?'Google Tasks 권한이 없습니다. 연결 관리에서 Google Calendar를 다시 연결해 주세요.':error instanceof Error?error.message:'Google Tasks 동기화 실패';
  await recordSource(db,owner,'google_tasks',{state:error instanceof Forbidden?'partial':'error',detail});
 }
}
