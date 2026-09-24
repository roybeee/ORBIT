import {z} from 'zod';
import {readNote,readWorkspace,writeCommand,RevisionConflict,type Database,type SqlValue} from '../../../db/repository.ts';
import {dateSchema} from '../validation.ts';
import {projectStatus} from '../project-management.ts';
import {automaticProject,normalize} from '../classify.ts';
import {todayInZone} from '../dates.ts';
import type {Project,WorkspaceData} from '../model.ts';
import {authenticate,digest,Failure} from './directives.ts';

// Slack instructions (task or note) that become ORBIT records at once when the project is clear.
// Calendar events are not handled here: ORBIT reads Google Calendar itself.
export const SLACK_INBOX={id:'slack-inbox',name:'Slack 보관함'};
const id=z.string().min(1).max(160);
const sourceSchema=z.object({platform:z.literal('slack'),workspaceId:id,requesterId:id,channelId:id,messageTs:z.string().regex(/^\d{10}\.\d{6}$/),threadId:z.string().regex(/^\d{10}\.\d{6}$/).optional(),eventId:id.optional(),clientMsgId:id.optional()}).strict();
const projectHint=z.string().trim().min(1).max(160).optional();
const commandSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('task'),title:z.string().trim().min(1).max(160),due:dateSchema,duration:z.number().int().min(5).max(480).optional(),description:z.string().max(4000).optional(),project:projectHint,
  googleTask:z.object({taskListId:z.string().min(1).max(200),taskId:z.string().min(1).max(200)}).strict().optional()}).strict(),
 z.object({kind:z.literal('note'),title:z.string().trim().min(1).max(160),text:z.string().min(1).max(4000),project:projectHint}).strict(),
]);
const createSchema=z.object({operationKey:z.string().min(1).max(200),source:sourceSchema,command:commandSchema}).strict();
const chooseSchema=z.object({operationKey:z.string().min(1).max(200),source:sourceSchema,choice:z.number().int().min(1).max(20)}).strict();
type Create=z.infer<typeof createSchema>;
type Principal=Awaited<ReturnType<typeof authenticate>>;
type Candidate={number:number;id:string;name:string};
type Row={id:string;operation_key:string;payload_hash:string;payload_json:string;status:string;target_id:string|null;candidates_json:string};
type Resolution={project:{id:string;name:string}}|{candidates:{id:string;name:string}[]};

const authGate="EXISTS(SELECT 1 FROM orbit_slack_credentials WHERE token_hash=? AND owner_id=? AND workspace_id=? AND requester_id=? AND scope='directives:write' AND revoked=0 AND expires_at>?)";
const authValues=(p:Principal)=>[p.token_hash,p.owner_id,p.workspace_id,p.requester_id,Date.now()];
const pick=(p:Project)=>({id:p.id,name:p.name});

export function resolveProject(command:Create['command'],data:WorkspaceData):Resolution{
 const selectable=data.projects.filter(p=>projectStatus(p)!=='completed'&&p.id!==SLACK_INBOX.id);
 const hint=command.project;
 if(!hint){
  const text=command.kind==='note'?`${command.title} ${command.text}`:`${command.title} ${command.description??''}`;
  const auto=automaticProject(text,selectable,data.tasks,data.notes);
  const found=auto&&selectable.find(p=>p.id===auto.projectId);
  return {project:found?pick(found):SLACK_INBOX};
 }
 const byId=selectable.find(p=>p.id===hint);if(byId)return {project:pick(byId)};
 const wanted=normalize(hint);
 const exact=selectable.filter(p=>normalize(p.name)===wanted);if(exact.length===1)return {project:pick(exact[0])};
 const partial=selectable.filter(p=>{const name=normalize(p.name);return !!wanted&&!!name&&(name.includes(wanted)||wanted.includes(name))});
 if(partial.length===1)return {project:pick(partial[0])};
 if(partial.length>1)return {candidates:partial.slice(0,8).map(pick)};
 const auto=automaticProject(hint,selectable,data.tasks,data.notes);
 const found=auto&&selectable.find(p=>p.id===auto.projectId);if(found)return {project:pick(found)};
 return {candidates:selectable.filter(p=>projectStatus(p)==='active').slice(0,8).map(pick)};
}

async function lookup(db:Database,p:Principal,operationKey:string){return db.prepare('SELECT * FROM orbit_slack_commands WHERE owner_id=? AND workspace_id=? AND requester_id=? AND operation_key=?').bind(p.owner_id,p.workspace_id,p.requester_id,operationKey).first<Row>()}

async function readback(db:Database,p:Principal,row:Row){
 const input=JSON.parse(row.payload_json) as Create;
 const candidates=JSON.parse(row.candidates_json) as Candidate[];
 const base={id:row.id,operationKey:row.operation_key,kind:input.command.kind,candidates,project:null as {id:string;name:string}|null,target:null as Record<string,unknown>|null,inbox:false};
 if(row.status!=='completed'||!row.target_id)return {...base,status:row.status};
 const data=(await readWorkspace(db,p.owner_id)).data;
 let target:Record<string,unknown>|null=null;
 if(input.command.kind==='task'){const task=data.tasks.find(t=>t.id===row.target_id);if(task)target={type:'task',id:task.id,title:task.title,projectId:task.projectId,due:task.due,googleTask:task.googleTask??null}}
 else{try{const note=await readNote(db,p.owner_id,row.target_id);target={type:'note',id:note.id,title:note.title,projectId:note.projectId}}catch{target=null}}
 if(!target)return {...base,status:'target_missing'};
 const project=data.projects.find(v=>v.id===target.projectId);
 return {...base,status:'completed',target,project:project?pick(project):null,inbox:target.projectId===SLACK_INBOX.id};
}

async function ensureInbox(db:Database,owner:string,receiptId:string){
 const snapshot=await readWorkspace(db,owner);
 if(snapshot.data.projects.some(p=>p.id===SLACK_INBOX.id))return;
 await writeCommand(db,owner,{operationId:'slack-inbox:'+receiptId,expectedRevision:snapshot.revision,action:{type:'project.upsert',project:{...SLACK_INBOX,goal:'Slack에서 프로젝트 없이 받은 할 일과 메모',color:'#4a154b',symbol:'S',due:todayInZone(snapshot.data.preferences.timeZone),priority:1}}});
}

// Writes the ORBIT record and the receipt in one commit; retried when another device saved first.
async function commit(db:Database,p:Principal,input:Create,projectId:string,receiptId:string,receipt:(gate:string,values:SqlValue[])=>ReturnType<Database["prepare"]>,fence:{sql:string;values:SqlValue[]}){
 for(let attempt=0;;attempt++){
  if(projectId===SLACK_INBOX.id)await ensureInbox(db,p.owner_id,receiptId);
  const snapshot=await readWorkspace(db,p.owner_id);
  const command=input.command,recordId='slack-'+receiptId;
  const action=command.kind==='task'
   ?{type:'task.upsert' as const,task:{id:recordId,title:command.title,projectId,status:'todo' as const,duration:command.duration??30,due:command.due,impact:3,focus:false,definition:'',...(command.description?{description:command.description}:{}),...(command.googleTask?{googleTask:command.googleTask}:{})}}
   :{type:'note.upsert' as const,note:{id:recordId,kind:'knowledge' as const,title:command.title,body:command.text,projectId,summary:'',tags:[],updated:todayInZone(snapshot.data.preferences.timeZone)}};
  try{
   await writeCommand(db,p.owner_id,{operationId:'slack-command:'+receiptId,expectedRevision:snapshot.revision,action},new Date(),{gate:`${authGate} AND ${fence.sql}`,values:[...authValues(p),...fence.values],statements:(gate,values)=>[receipt(gate,values)]});
   return recordId;
  }catch(error){if(!(error instanceof RevisionConflict)||attempt>=2)throw error}
 }
}

async function create(db:Database,p:Principal,raw:unknown){
 const parsed=createSchema.safeParse(raw);if(!parsed.success)throw new Failure(422,'unsupported_or_invalid_command');
 const input=parsed.data;
 if(input.source.workspaceId!==p.workspace_id||input.source.requesterId!==p.requester_id)throw new Failure(403,'source_scope_mismatch');
 const hash=await digest(JSON.stringify(input));
 const prior=await lookup(db,p,input.operationKey);
 if(prior){if(prior.payload_hash!==hash)throw new Failure(409,'payload_conflict');return readback(db,p,prior)}
 const resolution=resolveProject(input.command,(await readWorkspace(db,p.owner_id)).data);
 const receiptId=crypto.randomUUID(),now=new Date().toISOString();
 const insert=(status:string,targetId:string|null,candidates:Candidate[])=>(gate:string,values:SqlValue[])=>db.prepare(`INSERT INTO orbit_slack_commands(owner_id,workspace_id,requester_id,operation_key,id,payload_hash,payload_json,status,target_id,candidates_json,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${gate}`)
  .bind(p.owner_id,p.workspace_id,p.requester_id,input.operationKey,receiptId,hash,JSON.stringify(input),status,targetId,JSON.stringify(candidates),now,now,...values);
 try{
  if('candidates' in resolution){
   const candidates=[...resolution.candidates,SLACK_INBOX].map((c,i)=>({number:i+1,...c}));
   await insert('needs_confirmation',null,candidates)(authGate,authValues(p)).run();
  }else{
   await commit(db,p,input,resolution.project.id,receiptId,insert('completed','slack-'+receiptId,[]),{sql:'NOT EXISTS(SELECT 1 FROM orbit_slack_commands WHERE owner_id=? AND workspace_id=? AND requester_id=? AND operation_key=?)',values:[p.owner_id,p.workspace_id,p.requester_id,input.operationKey]});
  }
 }catch(error){
  const winner=await lookup(db,p,input.operationKey);
  if(winner){if(winner.payload_hash!==hash)throw new Failure(409,'payload_conflict');return readback(db,p,winner)}
  throw error;
 }
 const saved=await lookup(db,p,input.operationKey);
 if(!saved)throw new Failure(409,'authorization_or_revision_changed');
 return readback(db,p,saved);
}

async function choose(db:Database,p:Principal,raw:unknown){
 const parsed=chooseSchema.safeParse(raw);if(!parsed.success)throw new Failure(422,'invalid_choice');
 const {operationKey,source,choice}=parsed.data;
 if(source.workspaceId!==p.workspace_id||source.requesterId!==p.requester_id)throw new Failure(403,'source_scope_mismatch');
 const row=await lookup(db,p,operationKey);if(!row)throw new Failure(404,'not_found');
 const candidates=JSON.parse(row.candidates_json) as Candidate[];
 const picked=candidates.find(c=>c.number===choice);
 if(row.status==='completed'){
  const current=await readback(db,p,row);
  if(picked&&current.target?.projectId===picked.id)return current;
  throw new Failure(409,'already_completed');
 }
 if(row.status!=='needs_confirmation')throw new Failure(409,'not_waiting_for_choice');
 if(!picked)throw new Failure(422,'choice_out_of_range');
 const input=JSON.parse(row.payload_json) as Create;
 const update=(gate:string,values:SqlValue[])=>db.prepare(`UPDATE orbit_slack_commands SET status='completed',target_id=?,updated_at=? WHERE id=? AND status='needs_confirmation' AND ${gate}`).bind('slack-'+row.id,new Date().toISOString(),row.id,...values);
 try{await commit(db,p,input,picked.id,row.id,update,{sql:"EXISTS(SELECT 1 FROM orbit_slack_commands WHERE id=? AND status='needs_confirmation')",values:[row.id]})}
 catch(error){const again=await lookup(db,p,operationKey);if(again?.status==='completed')return choose(db,p,raw);throw error}
 return readback(db,p,(await lookup(db,p,operationKey))!);
}

async function readJson(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Failure(415,'json_required');
 const text=await request.text();
 if(new TextEncoder().encode(text).byteLength>12000)throw new Failure(413,'body_too_large');
 try{return JSON.parse(text) as unknown}catch{throw new Failure(422,'invalid_json')}
}

export async function handleCommand(db:Database,request:Request):Promise<Response>{
 const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Authorization'}});
 try{
  const p=await authenticate(db,request);
  if(request.method==='GET'){
   const key=new URL(request.url).searchParams.get('operationKey');
   if(!key||key.length>200)throw new Failure(422,'lookup_required');
   const row=await lookup(db,p,key);if(!row)throw new Failure(404,'not_found');
   return respond(await readback(db,p,row));
  }
  if(request.method!=='POST')throw new Failure(405,'method_not_allowed');
  const raw=await readJson(request);
  const isChoice=typeof raw==='object'&&raw!==null&&'choice' in raw;
  return respond(isChoice?await choose(db,p,raw):await create(db,p,raw));
 }catch(error){return respond({error:error instanceof Failure?error.message:'reconcile_before_retry'},error instanceof Failure?error.status:503)}
}
