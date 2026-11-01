import {readWorkspace,type Database} from '../../../db/repository.ts';
import {beginTurn,finishTurn,failTurn,pendingActions} from '../agent/repository.ts';
import {resolveKakaoModel} from './settings.ts';
import {AgentError} from '../agent/errors.ts';
import type {Runtime} from '../agent/integrations.ts';
import {sourceRecord} from '../agent/evidence.ts';
import {validateCapture} from './validation.ts';
import {analyzeKakao,type KakaoModelResult} from './model.ts';
import {assertGroundedDate,messageRegistry,validateCitations} from './evidence.ts';
import type {KakaoCapture,KakaoReview,KakaoStatus} from './types.ts';
import {buildKakaoActions} from './staging.ts';
import {incrementalCapture} from './incremental.ts';

interface TurnRow {id:string;input:string;status:string;response_json:string;updated_at:string}
export async function kakaoUuid(value:string){
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const bytes=[...digest.slice(0,16)].map((v,i)=>i===6?(v&15)|80:i===8?(v&63)|128:v),hex=bytes.map(v=>v.toString(16).padStart(2,'0')).join('');
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
const conversationFor=(owner:string)=>kakaoUuid('orbit:kakao-read-review:conversation:'+owner);
function savedReview(row:TurnRow):KakaoReview|undefined{return JSON.parse(row.response_json).kakaoReview;}
async function fingerprint(capture:KakaoCapture){
 const rooms=[...capture.rooms].sort((a,b)=>a.id.localeCompare(b.id)).map(room=>({id:room.id,title:room.title,messages:[...room.messages].sort((a,b)=>(a.sentAt??a.sentOn).localeCompare(b.sentAt??b.sentOn)||a.id.localeCompare(b.id))}));
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rooms)));
 return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function kakaoStatus(db:Database,owner:string,env:Runtime):Promise<KakaoStatus>{
 const conversation=await conversationFor(owner);
 const {results}=await db.prepare("SELECT id,input,status,response_json,updated_at FROM orbit_agent_turns WHERE owner_id=? AND conversation_id=? AND status='completed' AND json_type(response_json,'$.kakaoReview')='object' ORDER BY created_at DESC,id DESC LIMIT 20").bind(owner,conversation).all<TurnRow>();
 const modelReady=!!await resolveKakaoModel(db,owner,env).catch(()=>null);
 return {modelReady,runs:results.flatMap(row=>{const review=savedReview(row);return review?[review]:[]})};
}
async function findReplay(db:Database,owner:string,conversation:string,input:KakaoCapture,hash:string){
 const byId=await db.prepare('SELECT id,input,status,response_json,updated_at FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,input.id).first<TurnRow>();
 if(byId){
  let stored;try{stored=JSON.parse(byId.input)}catch{/* another feature owns this identifier */}
  if(stored?.source!=='kakao-read-review'||stored.fingerprint!==hash)throw new AgentError('같은 조사 번호에 다른 대화 내용이 있습니다. 새 조사를 시작해 주세요.','CONFLICT',409);
  if(byId.status==='completed'&&savedReview(byId))return {row:byId,replay:true};
 }
 const row=await db.prepare("SELECT id,input,status,response_json,updated_at FROM orbit_agent_turns WHERE owner_id=? AND conversation_id=? AND json_valid(input) AND json_extract(input,'$.fingerprint')=? AND status IN ('completed','running') ORDER BY created_at LIMIT 1").bind(owner,conversation,hash).first<TurnRow>();
 if(row?.status==='completed'&&savedReview(row))return {row,replay:true};
 if(row?.status==='running')throw new AgentError('이 대화를 이미 분석 중입니다. 새 조사를 보내지 말고 결과를 기다려 주세요.','BUSY',409);
 return {row:byId,replay:false};
}
async function enforceRateLimit(db:Database,owner:string,conversation:string){
 const now=Date.now(),row=await db.prepare("SELECT COUNT(*) AS count,MAX(created_at) AS latest FROM orbit_agent_turns WHERE owner_id=? AND conversation_id=? AND created_at>?").bind(owner,conversation,new Date(now-3600000).toISOString()).first<{count:number;latest:string|null}>();
 if((row?.count??0)>=20||row?.latest&&Date.parse(row.latest)>now-2000)throw new AgentError('카카오톡 분석 요청이 많습니다. 잠시 후 다시 검토해 주세요.','KAKAO_RATE_LIMIT',429);
}
async function ensureConversation(db:Database,owner:string,id:string){
 const now=new Date().toISOString();
 await db.prepare("INSERT OR IGNORE INTO orbit_conversations(owner_id,id,title,project_id,revision,created_at,updated_at) VALUES(?,?,?,NULL,0,?,?)").bind(owner,id,'카카오톡 비서실장',now,now).run();
}
function groundedResult(capture:KakaoCapture,result:KakaoModelResult){
 for(const solution of result.solutions)validateCitations(capture,solution.evidence);
 for(const proposal of result.proposals){
  validateCitations(capture,proposal.citations);
  if(proposal.confirmed)assertGroundedDate(capture,proposal.citations,proposal.kind==='event'?proposal.date:proposal.due,...(proposal.kind==='event'?[proposal.start,proposal.end] as const:[]));
 }
 return result;
}
function reviewRecord(capture:KakaoCapture,result:KakaoModelResult,conversationId:string,actionCount:number,questions:string[]):KakaoReview{
 return {id:capture.id,capturedAt:capture.capturedAt,createdAt:new Date().toISOString(),status:'completed',roomCount:capture.rooms.length,messageCount:capture.rooms.reduce((sum,r)=>sum+r.messages.length,0),actionCount,conversationId,summary:result.summary,solutions:result.solutions,questions,
  sources:[...messageRegistry(capture).values()].map(m=>({id:m.id,room:m.room,sender:m.sender,excerpt:m.text.slice(0,350),...(m.sentAt?{sentAt:m.sentAt}:{sentOn:m.sentOn!,timePrecision:'day' as const})}))};
}
/** Stage grounded cards only. Existing approval transactions own all actual workspace/Google writes. */
export async function reviewKakao(db:Database,owner:string,input:unknown,env:Runtime):Promise<KakaoReview>{
 const capture=validateCapture(input),hash=await fingerprint(capture),conversationId=await conversationFor(owner);
 const previous=await findReplay(db,owner,conversationId,capture,hash);
 if(previous.replay)return {...savedReview(previous.row!)!,replayed:true};
 const incremental=await incrementalCapture(db,owner,conversationId,capture);
 if(!incremental.capture.rooms.length&&incremental.replay)return {...incremental.replay,replayed:true};
 const model=await resolveKakaoModel(db,owner,env);
 if(!model)throw new AgentError('카카오톡 분석용 무도구 AI 연결이 없습니다. 전용 AI 연결 또는 서버의 OpenAI 연결을 설정해 주세요. 일반 에이전트로 우회하지 않습니다.','KAKAO_MODEL_SETUP',503);
 if(!previous.row)await enforceRateLimit(db,owner,conversationId);
 await ensureConversation(db,owner,conversationId);
 const stored=JSON.stringify({source:capture.source,fingerprint:hash,capturedAt:capture.capturedAt,roomCount:capture.rooms.length,messageHashes:incremental.hashes});
 const lease=await beginTurn(db,owner,capture.id,previous.row?.input??stored,conversationId,[],previous.row?.status==='failed'?previous.row.updated_at:undefined);
 if(lease.replayed)throw new AgentError('조사 상태가 변경됐습니다. 목록에서 다시 확인해 주세요.','CONFLICT',409);
 try{
  // A first scan can finish between the optimistic replay check and this claim.
  // The conversation's unique running-turn constraint serializes this recheck.
  const duplicate=await db.prepare("SELECT id,input,status,response_json,updated_at FROM orbit_agent_turns WHERE owner_id=? AND conversation_id=? AND id<>? AND status='completed' AND json_valid(input) AND json_extract(input,'$.fingerprint')=? LIMIT 1").bind(owner,conversationId,capture.id,hash).first<TurnRow>();
  if(duplicate&&savedReview(duplicate)){
   await db.prepare("DELETE FROM orbit_agent_turns WHERE owner_id=? AND id=? AND status='running' AND updated_at=?").bind(owner,capture.id,lease.lease).run();
   return {...savedReview(duplicate)!,replayed:true};
  }
  const current=await incrementalCapture(db,owner,conversationId,capture);
  if(!current.capture.rooms.length&&current.replay){
   await db.prepare("DELETE FROM orbit_agent_turns WHERE owner_id=? AND id=? AND status='running' AND updated_at=?").bind(owner,capture.id,lease.lease).run();return {...current.replay,replayed:true};
  }
  const delta=current.capture,snapshot=await readWorkspace(db,owner),result=groundedResult(delta,await analyzeKakao(model,delta,snapshot.data.projects));
  const staged=await buildKakaoActions(delta,result,snapshot.data,snapshot.revision,conversationId,await pendingActions(db,owner));
  const review=reviewRecord(delta,result,conversationId,staged.actions.length,staged.questions);
  const response={text:`${review.summary}\n${review.actionCount}개 반영 후보를 제안했습니다. 결재함에서 승인하면 반영됩니다.`,sources:[...messageRegistry(delta).values()].slice(0,20).map(m=>sourceRecord('conversation',m.id,m.room,`${m.sender} · ${m.sentAt??m.sentOn}\n${m.text}`,{label:'카카오톡 · 이미 읽은 대화',date:m.sentOn??m.sentAt!.slice(0,10)})),kakaoReview:review};
  await finishTurn(db,owner,capture.id,lease.lease,response,staged.actions);return review;
 }catch(error){
  await failTurn(db,owner,capture.id,lease.lease,'카카오톡 분석을 완료하지 못했습니다. 실제 업무·일정은 변경하지 않았습니다.');throw error;
 }
}
