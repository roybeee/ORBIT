import {z} from 'zod';
import {readWorkspace,type Database} from '../../../db/repository.ts';
import {AgentError} from '../agent/errors.ts';
import {activeHold,classifyLimit,recordLimit} from '../agent/provider-hold.ts';
import {authenticate,Failure} from './directives.ts';
import {readJson,sourceSchema} from './commands.ts';
import {countCards,displayStatus,slackPermalink,statusLabel,summarize,type ReasonKind,type SlackRequestItem} from './request-view.ts';

// Slack messages to the assistant are saved here by the Hermes gateway before the model is called,
// so a failing provider can no longer lose an instruction. Hermes then reports how the turn ended.
type Principal=Awaited<ReturnType<typeof authenticate>>;
type Row={id:string;receipt_key:string;channel_id:string;message_ts:string;event_id:string;text:string;status:string;reason_kind:ReasonKind;hold_id:string;next_check_at:number;turn_id:string;conversation_id:string;deliveries:number;created_at:string;updated_at:string};
const receiveSchema=z.object({action:z.literal('receive'),source:sourceSchema,text:z.string().trim().min(1).max(4000)}).strict();
const outcomeSchema=z.object({action:z.literal('outcome'),source:sourceSchema,outcome:z.enum(['answered','limit','failed']),kind:z.enum(['quota','rate_limit','auth','other']).optional(),detail:z.string().max(500).optional(),retryAfterSeconds:z.number().int().min(0).max(30*86400).optional()}).strict();
const receiptKey=(s:z.infer<typeof sourceSchema>)=>`${s.workspaceId}:${s.channelId}:${s.messageTs}`;
const HERMES='hermes' as const;

function scoped(p:Principal,source:z.infer<typeof sourceSchema>){if(source.workspaceId!==p.workspace_id||source.requesterId!==p.requester_id)throw new Failure(403,'source_scope_mismatch')}
async function find(db:Database,owner:string,key:string){return db.prepare('SELECT * FROM orbit_slack_requests WHERE owner_id=? AND receipt_key=?').bind(owner,key).first<Row>()}
async function holdView(db:Database,owner:string){const hold=await activeHold(db,owner,HERMES);return hold?{id:hold.id,kind:hold.kind,nextCheckAt:hold.nextCheckAt}:null}

async function receive(db:Database,p:Principal,raw:unknown){
 const parsed=receiveSchema.safeParse(raw);if(!parsed.success)throw new Failure(422,'invalid_request');
 const {source,text}=parsed.data;scoped(p,source);
 const now=new Date().toISOString(),key=receiptKey(source);
 const inserted=await db.prepare("INSERT OR IGNORE INTO orbit_slack_requests(owner_id,id,workspace_id,requester_id,receipt_key,channel_id,message_ts,thread_ts,event_id,text,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'received',?,?)")
  .bind(p.owner_id,crypto.randomUUID(),p.workspace_id,p.requester_id,key,source.channelId,source.messageTs,source.threadId??'',source.eventId??'',text,now,now).run();
 const duplicate=inserted.meta?.changes!==1;
 // A redelivery (Slack retry, gateway restart) is the same request: count it, never store a second one.
 if(duplicate)await db.prepare('UPDATE orbit_slack_requests SET deliveries=deliveries+1 WHERE owner_id=? AND receipt_key=?').bind(p.owner_id,key).run();
 const row=(await find(db,p.owner_id,key))!;
 return {id:row.id,status:row.status,duplicate,hold:await holdView(db,p.owner_id)};
}

// The limit reason is written so the shared hold classifies it the same way (quota vs short rate limit).
function limitDetail(kind:string|undefined,detail:string|undefined,retryAfter:number|undefined){
 const base=kind==='rate_limit'?'Slack 지시 처리 중 AI 요청 제한(rate limit)':'Slack 지시 처리 중 AI 사용량 한도 소진(quota)';
 return `${base}${detail?' · '+detail.replace(/\s+/g,' ').slice(0,200):''}${retryAfter!==undefined?` · retry after ${retryAfter}s`:''}`;
}
async function outcome(db:Database,p:Principal,raw:unknown){
 const parsed=outcomeSchema.safeParse(raw);if(!parsed.success)throw new Failure(422,'invalid_outcome');
 const input=parsed.data;scoped(p,input.source);
 const row=await find(db,p.owner_id,receiptKey(input.source));if(!row)throw new Failure(404,'receive_first');
 const now=new Date().toISOString();
 if(input.outcome==='answered'){
  // Only a request still waiting for its first result: a reported limit is not undone by the error reply.
  await db.prepare("UPDATE orbit_slack_requests SET status='answered',updated_at=? WHERE owner_id=? AND id=? AND status IN ('received','unconfirmed')").bind(now,p.owner_id,row.id).run();
 }else if(input.outcome==='limit'){
  const detail=limitDetail(input.kind,input.detail,input.retryAfterSeconds);
  const kind=input.kind==='rate_limit'||input.kind==='quota'?input.kind:classifyLimit(detail)?.kind??'quota';
  const hold=await recordLimit(db,p.owner_id,HERMES,detail,{id:'slack:'+row.id,automatic:false});
  await db.prepare("UPDATE orbit_slack_requests SET status='waiting_quota',reason_kind=?,reason=?,hold_id=?,next_check_at=?,updated_at=? WHERE owner_id=? AND id=? AND status IN ('received','unconfirmed','waiting_quota')")
   .bind(kind,detail.slice(0,300),hold?.id??'',hold?.nextCheckAt??0,now,p.owner_id,row.id).run();
 }else{
  await db.prepare("UPDATE orbit_slack_requests SET status='failed',reason_kind=?,reason=?,updated_at=? WHERE owner_id=? AND id=? AND status IN ('received','unconfirmed')")
   .bind(input.kind??'other',(input.detail??'').slice(0,300),now,p.owner_id,row.id).run();
 }
 const saved=(await find(db,p.owner_id,row.receipt_key))!;
 return {id:saved.id,status:saved.status,hold:await holdView(db,p.owner_id)};
}

export async function handleSlackRequest(db:Database,request:Request):Promise<Response>{
 const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Authorization'}});
 try{
  const p=await authenticate(db,request);
  if(request.method!=='POST')throw new Failure(405,'method_not_allowed');
  const raw=await readJson(request) as {action?:unknown};
  return respond(raw?.action==='outcome'?await outcome(db,p,raw):await receive(db,p,raw));
 }catch(error){return respond({error:error instanceof Failure?error.message:'reconcile_before_retry'},error instanceof Failure?error.status:503)}
}

type Card={turn_id:string;state:string;action_json:string};
// Requests the owner may still act on: everything except those Slack answered or the owner cancelled.
export async function listSlackRequests(db:Database,owner:string):Promise<SlackRequestItem[]>{
 const since=new Date(Date.now()-14*86400000).toISOString();
 const rows=await db.prepare("SELECT * FROM orbit_slack_requests WHERE owner_id=? AND status NOT IN ('answered','cancelled') AND updated_at>=? ORDER BY created_at DESC LIMIT 50").bind(owner,since).all<Row>();
 if(!rows.results.length)return [];
 const timeZone=(await readWorkspace(db,owner)).data.preferences.timeZone;
 const cards=await db.prepare("SELECT a.turn_id,a.state,a.action_json FROM orbit_agent_actions a JOIN orbit_slack_requests r ON r.owner_id=a.owner_id AND r.turn_id=a.turn_id WHERE r.owner_id=? AND r.turn_id<>''").bind(owner).all<Card>();
 return rows.results.map(r=>{
  const counts=countCards(cards.results.filter(c=>c.turn_id===r.turn_id).map(c=>({state:c.state,action:JSON.parse(c.action_json)})),timeZone);
  const status=displayStatus(r.status,counts);
  return {id:r.id,createdAt:r.created_at,channelId:r.channel_id,messageTs:r.message_ts,summary:summarize(r.text),permalink:slackPermalink(r.channel_id,r.message_ts),status,statusLabel:statusLabel(status,r.reason_kind,r.next_check_at,counts,timeZone),reasonKind:r.reason_kind,holdId:r.hold_id,nextCheckAt:r.next_check_at,conversationId:r.conversation_id,counts,deliveries:r.deliveries};
 });
}

export const changeSchema=z.object({id:z.string().uuid(),action:z.enum(['retry','cancel'])}).strict();
// 다시 처리 queues a fresh resume now (an earlier resume's open drafts are closed first);
// 취소 closes the request and its open drafts. A resume that is running cannot be changed.
export async function changeSlackRequest(db:Database,owner:string,raw:unknown){
 const input=changeSchema.parse(raw);
 const row=await db.prepare('SELECT * FROM orbit_slack_requests WHERE owner_id=? AND id=?').bind(owner,input.id).first<Row>();
 if(!row||['answered','cancelled'].includes(row.status))throw new AgentError('요청을 찾지 못했습니다.','NOT_FOUND',404);
 if(row.status==='processing')throw new AgentError('지금 처리 중입니다. 끝난 뒤 다시 시도해 주세요.','BUSY',409);
 const now=new Date().toISOString(),note=input.action==='retry'?'새 처리로 대체':'Slack 요청 취소';
 const next=input.action==='retry'?"status='queued',turn_id='',conversation_id='',attempts=0":"status='cancelled'";
 const changed=await db.batch([
  db.prepare(`UPDATE orbit_slack_requests SET ${next},updated_at=? WHERE owner_id=? AND id=? AND status=?`).bind(now,owner,row.id,row.status),
  db.prepare("UPDATE orbit_agent_actions SET state='rejected',note=?,updated_at=? WHERE owner_id=? AND turn_id=? AND turn_id<>'' AND state IN ('pending','deferred') AND EXISTS(SELECT 1 FROM orbit_slack_requests WHERE owner_id=? AND id=? AND updated_at=?)").bind(note,now,owner,row.turn_id,owner,row.id,now),
 ]);
 if(changed[0].meta?.changes!==1)throw new AgentError('요청 상태가 바뀌었습니다. 목록을 새로 불러와 주세요.','CONFLICT',409);
 return {ok:true};
}
