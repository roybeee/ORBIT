import {redactSecrets as redact} from './redaction.mjs';
// Local safety policy. No network, UI actions, generic tool calls or retained transcripts.
export const RECENT_MS=7*86400000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const OPERATIONS=new Set(['health','list-metadata','capture-current','stop']);
export const fail=(message,code='INPUT',status=400)=>Object.assign(new Error(message),{code,status});
export const allowedOperation=value=>OPERATIONS.has(value);
const validText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const instant=value=>typeof value==='string'&&ISO.test(value)?Date.parse(value):NaN;
const inWindow=(value,now)=>Number.isFinite(instant(value))&&instant(value)>=now-RECENT_MS&&instant(value)<=now;
const localDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00+09:00'))&&localDay(Date.parse(value+'T00:00:00+09:00'))===value;
const dayInWindow=(value,now)=>validDay(value)&&Date.parse(value+'T00:00:00+09:00')>=now-RECENT_MS&&value<=localDay(now);
const throwStopped=signal=>{if(signal?.aborted)throw fail('검토를 중지했습니다. 수집 내용은 전달하지 않았습니다.','STOPPED',409)};
async function withAbort(operation,signal){
 throwStopped(signal);
 if(!signal)return operation();
 let abort;
 const stopped=new Promise((_,reject)=>{abort=()=>reject(fail('검토가 중지되었습니다.','STOPPED',409));signal.addEventListener('abort',abort,{once:true})});
 try{return await Promise.race([operation(),stopped])}finally{signal.removeEventListener('abort',abort)}
}
function roomReason(room,now){
 if(!room||!validText(room.id,200)||!validText(room.title,200))return '방 식별을 확인하지 못했습니다.';
 if(room.layoutVerified!==true||room.unreadCount!==0)return '미읽음이 있거나 읽음 상태를 확인하지 못했습니다.';
 if(!(inWindow(room.lastActivityAt,now)||dayInWindow(room.lastActivityOn,now)))return '최근 7일 교신 시각이 확인되지 않았습니다.';
 if(!Number.isFinite(instant(room.verifiedAt))||Math.abs(now-instant(room.verifiedAt))>5000)return '읽음 확인 시각이 만료되었습니다.';
 return null;
}
function safeMeta(room){return {id:room.id,title:room.title,...(room.lastActivityAt?{lastActivityAt:room.lastActivityAt}:{lastActivityOn:room.lastActivityOn}),unreadCount:0,layoutVerified:true,verifiedAt:room.verifiedAt,...(room.activitySignature?{activitySignature:room.activitySignature}:{})}}

/** List qualification never copies a room preview, screenshot or other metadata. */
export function eligibleRooms(rows,now=new Date()){
 if(!Array.isArray(rows)||rows.length>500)throw fail('방 목록 범위를 확인해 주세요.');
 const entries=rows.map(room=>({room,reason:roomReason(room,now.getTime())}));
 return {rooms:entries.filter(row=>!row.reason).map(row=>safeMeta(row.room)),skipped:entries.filter(row=>row.reason).map(row=>({reason:row.reason}))};
}

/** Allowlist and validate all outbound capture data again before browser handoff. */
export function validateCapture(capture,now=new Date()){
 const at=now.getTime();
 if(!capture||!UUID.test(capture.id??'')||capture.source!=='kakao-read-review'||capture.timeZone!=='Asia/Seoul'||!Number.isFinite(instant(capture.capturedAt))||Math.abs(at-instant(capture.capturedAt))>60000)throw fail('수집 출처와 시각을 확인해 주세요.','CAPTURE_SCOPE');
 if(!Array.isArray(capture.rooms)||capture.rooms.length<1||capture.rooms.length>20)throw fail('수집할 방의 범위를 확인해 주세요.','CAPTURE_SCOPE');
 const roomIds=new Set();
 const rooms=capture.rooms.map(room=>{
  if(roomReason(room,at)||roomIds.has(room.id))throw fail('읽음 상태와 방 식별을 다시 확인해 주세요.','UNREAD_OR_UNKNOWN',409);
  roomIds.add(room.id);
  if(!Array.isArray(room.messages)||room.messages.length<1||room.messages.length>500)throw fail('검증된 날짜의 메시지가 없습니다.','MESSAGE_SCOPE',409);
  const ids=new Set();
  const messages=room.messages.map(message=>{
   if(!validText(message.id,200)||ids.has(message.id))throw fail('메시지 식별이 중복되거나 잘못되었습니다.','MESSAGE_ID');
   ids.add(message.id);
   const precise=inWindow(message.sentAt,at)&&message.sentOn===undefined&&message.timePrecision===undefined;
   const day=message.sentAt===undefined&&message.timePrecision==='day'&&dayInWindow(message.sentOn,at);
   if((!precise&&!day)||!validText(message.sender,200)||!validText(message.text,8000))throw fail('최근 7일의 발신 날짜와 메시지를 확인하지 못했습니다.','MESSAGE_SCOPE',409);
   return {id:message.id,...(precise?{sentAt:message.sentAt}:{sentOn:message.sentOn,timePrecision:'day'}),sender:message.sender,text:redact(message.text)};
  });
  return {id:room.id,title:room.title,unreadCount:0,verifiedAt:room.verifiedAt,messages};
 });
 const result={id:capture.id,capturedAt:capture.capturedAt,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms};
 if(JSON.stringify(result).length>80000)throw fail('수집 결과가 큽니다. 구간을 나누어 검토해 주세요.','CAPTURE_SIZE',413);
 return result;
}

/** Only reads a room the person has already opened. Navigation is never exposed. */
export async function collectReadRoom(adapter,input,now=new Date(),signal){
 if(!input||!UUID.test(input.id??'')||input.scope!=='current_read_room'||Object.keys(input).some(key=>!['id','scope'].includes(key)))throw fail('현재 읽은 대화방 검토만 지원합니다.');
 throwStopped(signal);
 const before=await withAbort(()=>adapter.inspectCurrent(signal),signal);
 if(roomReason(before,now.getTime()))throw fail('현재 방의 읽음 상태와 최근 교신 시각을 확인하지 못했습니다.','UNREAD_OR_UNKNOWN',409);
 throwStopped(signal);
 const content=await withAbort(()=>adapter.readCurrent(signal),signal);
 throwStopped(signal);
 const after=await withAbort(()=>adapter.inspectCurrent(signal),signal);
 const inputChanged=before.lastInputAt!==undefined&&after.lastInputAt!==undefined&&Math.abs(before.lastInputAt-after.lastInputAt)>=0.05;
 if(roomReason(after,now.getTime())||after.id!==before.id||after.title!==before.title||after.lastActivityAt!==before.lastActivityAt||after.lastActivityOn!==before.lastActivityOn||after.activitySignature!==before.activitySignature||inputChanged||content.roomId!==before.id)throw fail('검토 중 대화방 또는 입력·새 메시지 상태가 바뀌어 수집을 폐기했습니다.','ROOM_CHANGED',409);
 throwStopped(signal);
 const capture=validateCapture({id:input.id,capturedAt:now.toISOString(),timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{...safeMeta(after),messages:content.messages}]},now);
 return {capture,skipped:[]};
}
