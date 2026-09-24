// Machine endpoint for the Hermes GoTEM cron: the same provisioned Slack credential as the
// directives route identifies the owner. GET previews a message; POST claims the (date, slot)
// once and returns the text to post, or send:false (skipped / already claimed) to stay silent.
import {readWorkspace,type Database} from '../../../db/repository.ts';
import {planStatus} from '../brief/status.ts';
import {todayInZone} from '../dates.ts';
import type {Runtime} from '../agent/integrations.ts';
import {digest} from './directives.ts';
import {composeGotem,planSignal,GOTEM_SLOTS,type GotemMessage,type GotemSlot} from './gotem.ts';

class Failure extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status}}
const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Authorization'}});

async function authenticate(db:Database,request:Request):Promise<string>{
 const match=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('authorization')??'');
 if(!match)throw new Failure(401,'unauthorized');
 const row=await db.prepare("SELECT owner_id FROM orbit_slack_credentials WHERE token_hash=? AND scope='directives:write' AND revoked=0 AND expires_at>?")
  .bind(await digest(match[1]),Date.now()).first<{owner_id:string}>();
 if(!row)throw new Failure(401,'unauthorized');
 return row.owner_id;
}

function slotOf(value:unknown):GotemSlot{
 if(typeof value==='string'&&(GOTEM_SLOTS as readonly string[]).includes(value))return value as GotemSlot;
 throw new Failure(422,'unsupported_slot');
}

async function requestedSlot(request:Request):Promise<GotemSlot>{
 if(request.method==='GET')return slotOf(new URL(request.url).searchParams.get('slot'));
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Failure(415,'json_required');
 const text=await request.text();
 if(text.length>1000)throw new Failure(413,'body_too_large');
 try{return slotOf((JSON.parse(text) as {slot?:unknown}).slot)}catch(error){if(error instanceof Failure)throw error;throw new Failure(422,'invalid_json')}
}

async function compose(db:Database,owner:string,slot:GotemSlot,origin:string,now:Date):Promise<GotemMessage>{
 const snapshot=await readWorkspace(db,owner);
 // The night message reads the review candidates only; plan status is for morning/afternoon.
 const today=todayInZone(snapshot.data.preferences.timeZone,now);
 const plan=slot==='night'?null:planSignal(await planStatus(db,owner,{} as Runtime,now,today));
 return composeGotem({slot,data:snapshot.data,now,plan,origin});
}

// First decision wins for the day: a retry, a second cron or a manual run never posts twice.
async function claim(db:Database,owner:string,message:GotemMessage):Promise<boolean>{
 const payload={reason:message.reason,planState:message.planState??null,taskId:message.taskId??null,carryReviewDate:message.carryReviewDate??null,dataAt:message.dataAt};
 const result=await db.prepare('INSERT INTO orbit_gotem_sends(owner_id,date,slot,status,reason,payload_json,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,date,slot) DO NOTHING')
  .bind(owner,message.date,message.slot,message.send?'sent':'skipped',message.reason,JSON.stringify(payload),message.dataAt).run();
 return result.meta?.changes===1;
}

export async function handleGotem(db:Database,request:Request,now=new Date()):Promise<Response>{
 try{
  if(request.method!=='GET'&&request.method!=='POST')throw new Failure(405,'method_not_allowed');
  const owner=await authenticate(db,request);
  const slot=await requestedSlot(request);
  const message=await compose(db,owner,slot,new URL(request.url).origin,now);
  if(request.method==='GET')return respond({...message,preview:true});
  if(!await claim(db,owner,message))return respond({...message,send:false,reason:'duplicate',text:''});
  return respond(message);
 }catch(error){
  if(error instanceof Failure)return respond({error:error.message},error.status);
  console.error('GoTEM message failed',error);
  return respond({error:'gotem_unavailable'},503);
 }
}
