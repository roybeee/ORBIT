import {advanceMeetingReviews} from '@/lib/orbit/meetings/review-runtime';
import {startPlanningAction} from '@/lib/orbit/brief/start';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getDatabase} from '@/db/storage';
import {writeCommand,RevisionConflict} from '@/db/repository';
import {workspaceWithRequestedPreferences} from '@/db/requested-preferences';
import {commandSchema} from '@/lib/orbit/validation';
import {DomainError} from '@/lib/orbit/reducer';
import {env} from 'cloudflare:workers';
import {after} from 'next/server';
import {flushCalendarOutbox,hasCalendarDeliveryWork} from '@/lib/orbit/agent/calendar-outbox';
import {AgentError} from '@/lib/orbit/agent/errors';
import {addDays} from '@/lib/orbit/dates';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function GET(request:Request){
 const user=await getChatGPTUser();if(!user)return response({error:'로그인이 필요합니다.',code:'AUTH'},401);
 const expected=request.headers.get('x-orbit-owner');if(expected&&expected!==user.id)return response({error:'로그인 계정이 변경되었습니다. 이전 계정의 입력은 임시 보관함에 유지됩니다.',code:'SESSION_CHANGED'},409);
 try{return response(await workspaceWithRequestedPreferences(getDatabase(),user.id))}catch{console.error('Orbit workspace read unavailable');return response({error:'저장된 내용을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',code:'STORAGE'},503)}
}
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return response({error:'로그인이 필요합니다.',code:'AUTH'},401);
 const expected=request.headers.get('x-orbit-owner');if(expected&&expected!==user.id)return response({error:'로그인 계정이 변경되었습니다. 이전 계정의 입력은 임시 보관함에 유지됩니다.',code:'SESSION_CHANGED'},409);
 const origin=request.headers.get('origin');
 if((origin&&origin!==new URL(request.url).origin)||request.headers.get('sec-fetch-site')==='cross-site')return response({error:'요청 출처를 확인할 수 없습니다.',code:'ORIGIN'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return response({error:'요청 형식이 올바르지 않습니다.',code:'INPUT'},415);
 const bytes=await request.arrayBuffer();if(bytes.byteLength>400000)return response({error:'입력 내용이 너무 큽니다. 내용을 나누어 저장해 주세요.',code:'INPUT'},413);
 let parsed;try{parsed=commandSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))}catch{return response({error:'입력 내용을 확인해 주세요.',code:'INPUT'},400)}
 if(!parsed.success)return response({error:parsed.error.issues[0]?.message??'입력 내용을 확인해 주세요.',code:'INPUT'},400);
 try{const action=parsed.data.action;if(action.type==='proposal.generate'||action.type==='review.saveGenerate')return response((await startPlanningAction(getDatabase(),user.id,{...parsed.data,action},env)).snapshot);const db=getDatabase(),snapshot=await writeCommand(db,user.id,parsed.data);if(action.type==='note.upsert'&&action.note.kind==='meeting')after(()=>advanceMeetingReviews(db,user.id,env,action.note.id).then(()=>{}));if(snapshot.data.tasks.length||['proposal.approve','event.upsert','task.delete','preferences.update'].includes(action.type))after(async()=>{if(action.type==='preferences.update'){const deadline=Date.now()+20000;for(let n=0;n<6&&Date.now()<deadline&&await hasCalendarDeliveryWork(db,user.id);n++)await flushCalendarOutbox(db,user.id,env,undefined,true);return}await flushCalendarOutbox(db,user.id,env,action.type==='task.schedule'?action.eventId:action.type==='event.upsert'?action.event.id:action.type==='proposal.approve'?'approved:'+action.itemId:action.type==='task.upsert'?'task-due:'+action.task.id:undefined)});return response(snapshot)}
 catch(error){if(error instanceof AgentError)return response({error:error.message,code:error.code},error.status);if(error instanceof RevisionConflict)return response({error:error.message,code:'CONFLICT'},409);if(error instanceof DomainError)return response({error:error.message,code:'INPUT'},422);console.error('Orbit workspace write unavailable');return response({error:'저장 완료를 확인하지 못했습니다. 입력 내용을 유지하고 있으니 다시 저장해 주세요.',code:'STORAGE'},503)}
}
