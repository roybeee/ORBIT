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
type GoogleError={error?:{message?:string;errors?:{reason?:string}[];details?:{reason?:string;metadata?:{consumer?:string}}[]}};
// Google answers 403 both when the Tasks API is off in the OAuth client's Cloud project and when the
// connection lacks the Tasks scope; the fix differs, so the status names which one it is.
export function forbiddenReason(body:GoogleError){
 const reasons=[...(body.error?.details??[]).map(d=>d.reason),...(body.error?.errors??[]).map(e=>e.reason)].filter(Boolean);
 if(reasons.some(r=>r==='SERVICE_DISABLED'||r==='accessNotConfigured')){
  const project=body.error?.details?.find(d=>d.metadata?.consumer)?.metadata?.consumer?.replace('projects/','')??/project (\d+)/.exec(body.error?.message??'')?.[1];
  return `ORBIT의 Google Cloud 프로젝트${project?`(${project})`:''}에서 Google Tasks API가 꺼져 있습니다. Google Cloud Console에서 Google Tasks API를 사용 설정해 주세요.`;
 }
 if(reasons.some(r=>r==='ACCESS_TOKEN_SCOPE_INSUFFICIENT'||r==='insufficientPermissions'))return 'Google Tasks 권한이 없습니다. 연결 관리에서 Google Calendar를 다시 연결하고 Tasks 권한을 승인해 주세요.';
 return `Google Tasks 접근이 거부되었습니다(${reasons.join(', ')||'사유 없음'}). 연결 관리에서 Google Calendar를 다시 연결해 주세요.`;
}
// One list request per Google task list per sync: the first read (or any unconfirmed link) takes the
// whole list, later reads only what changed since the last successful sync (with a clock margin).
const THROTTLE_MS=30000,MARGIN_MS=5*60000,MAX_PAGES=10;
const sideOf=(t:Task):Side=>({title:t.title,due:t.due,status:t.status==='done'?'completed':'needsAction'});
const same=(a:Side,b:Side)=>a.title===b.title&&a.due===b.due&&a.status===b.status;

async function call(token:string,list:string,id:string,init:RequestInit={}){
 const url='https://tasks.googleapis.com/tasks/v1/lists/'+encodeURIComponent(list)+'/tasks/'+encodeURIComponent(id);
 const result=await fetchJson<Record<string,string|boolean>>(url,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...init.headers}},8000);
 if(result.response.status===401||result.response.status===403)throw new Forbidden(forbiddenReason(result.data as GoogleError));
 return result;
}
type Item={id:string;title?:string;due?:string;status?:string;etag?:string;completed?:string;deleted?:boolean};
async function listChanges(token:string,list:string,updatedMin?:string){
 const items=new Map<string,Item>();let page='';
 for(let n=0;n<MAX_PAGES;n++){
  const url=new URL('https://tasks.googleapis.com/tasks/v1/lists/'+encodeURIComponent(list)+'/tasks');
  url.search=new URLSearchParams({showCompleted:'true',showHidden:'true',showDeleted:'true',maxResults:'100',...(updatedMin?{updatedMin}:{}),...(page?{pageToken:page}:{})}).toString();
  const {response,data}=await fetchJson<{items?:Item[];nextPageToken?:string}&GoogleError>(url.href,{headers:{Authorization:'Bearer '+token}},8000);
  if(response.status===401||response.status===403)throw new Forbidden(forbiddenReason(data));
  if(!response.ok)throw new Error('Google Tasks 목록 조회 실패 '+response.status);
  for(const item of data.items??[])items.set(item.id,item);
  page=data.nextPageToken??'';if(!page)return items;
 }
 throw new Error('Google Tasks 목록이 너무 깁니다.');
}
function remoteOf(item:Item,fallbackDue:string):Remote|null{
 if(item.deleted)return null;
 // A Google Task can lose its due date; ORBIT tasks always have one, so keep ORBIT's.
 const due=typeof item.due==='string'?item.due.slice(0,10):fallbackDue;
 return {title:String(item.title??''),due,status:item.status==='completed'?'completed':'needsAction',etag:String(item.etag??''),...(item.completed?{completed:item.completed}:{})};
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

// remote: the Google state (null = gone); undefined = unchanged in Google since the last sync.
async function syncOne(db:Database,owner:string,token:string,task:Task,link:Link|undefined,found:Remote|null|undefined):Promise<'missing'|void>{
 const {taskListId:list,taskId:id}=task.googleTask!;
 const confirmed:Remote|undefined=link&&JSON.parse(link.state_json).etag?JSON.parse(link.state_json):undefined;
 const remote=found===undefined?confirmed??null:found;
 // Only a task this sync has seen in Google before can have been deleted there. Without a link
 // a 404 may mean another Google account or a task restored after its Google copy was removed.
 // A base link stored at creation (no etag yet) has not been confirmed in this account either.
 if(!remote){if(!link||!JSON.parse(link.state_json).etag)return 'missing';if(await update(db,owner,task.id,()=>({type:'task.delete',id:task.id})))await dropLink(db,owner,task.id);return}
 const local=sideOf(task),last:Side=link?JSON.parse(link.state_json):remote;
 if(!same(local,last)){
  if(same(local,remote)){await saveLink(db,owner,task,{...local,etag:remote.etag});return}
  const body={title:local.title,due:local.due+'T00:00:00.000Z',status:local.status,...(local.status==='needsAction'?{completed:null}:{})};
  const {response,data}=await call(token,list,id,{method:'PATCH',headers:{'If-Match':remote.etag},body:JSON.stringify(body)});
  if(response.ok){await saveLink(db,owner,task,{...local,etag:String(data.etag??'')});return}
  // 412: changed in Google meanwhile; the next change read brings it back for a fresh decision.
  if(response.status!==412)throw new Error('Google Tasks 수정 실패 '+response.status);
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
 // Open tasks and ones finished in the last two weeks; older finished work is left alone.
 const tasks=snapshot.data.tasks.filter(t=>t.googleTask&&(t.status!=='done'||(t.completedOn??t.due)>=addDays(today,-14)));
 const removed=links.filter(l=>!snapshot.data.tasks.some(t=>t.id===l.task_id));
 if(!tasks.length&&!removed.length)return;
 const last=(await sourceStatuses(db,owner)).find(s=>s.provider==='google_tasks');
 if(!options.force&&last&&Date.now()-Date.parse(last.attemptedAt)<THROTTLE_MS)return;
 try{
  const token=await accessToken(db,owner,'google_calendar',env);
  let missing=0,failed=0;
  for(const list of new Set(tasks.map(t=>t.googleTask!.taskListId))){
   const inList=tasks.filter(t=>t.googleTask!.taskListId===list);
   const confirmed=(t:Task)=>!!JSON.parse(links.find(l=>l.task_id===t.id)?.state_json??'{}').etag;
   // Incremental only when every task here has been seen in Google and the last sync succeeded.
   const since=last?.succeededAt&&inList.every(confirmed)?new Date(Date.parse(last.succeededAt)-MARGIN_MS).toISOString():undefined;
   const items=await listChanges(token,list,since);
   for(const task of inList){
    const item=items.get(task.googleTask!.taskId);
    // In a full read an absent task is gone (or belongs to another account); in a change read it is unchanged.
    const found=item?remoteOf(item,task.due):since?undefined:null;
    try{if(await syncOne(db,owner,token,task,links.find(l=>l.task_id===task.id),found)==='missing')missing++}
    catch(error){if(error instanceof Forbidden)throw error;failed++}
   }
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
  const detail=error instanceof Error&&error.message?error.message:'Google Tasks 동기화 실패';
  await recordSource(db,owner,'google_tasks',{state:error instanceof Forbidden?'partial':'error',detail});
 }
}
