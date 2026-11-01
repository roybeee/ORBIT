import {redactSecrets as redact} from './redaction.mjs';
// Local safety policy. No network, UI actions, generic tool calls or retained transcripts.
export const RECENT_MS=7*86400000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const reviewedIds=(value,max=1000)=>Array.isArray(value)&&value.length<=max&&new Set(value).size===value.length&&value.every(id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id));
const OPERATIONS=new Set(['health','list-metadata','capture-current','scan-recent','stop']);
export const AUTO_SCAN_MS=120000;
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
function roomReason(room,now,maxReadAgeMs=5000,futureToleranceMs=5000){
 if(!room||!validText(room.id,160)||!validText(room.title,160))return '방 식별을 확인하지 못했습니다.';
 if(room.layoutVerified!==true||room.unreadCount!==0)return '미읽음이 있거나 읽음 상태를 확인하지 못했습니다.';
 if(!(inWindow(room.lastActivityAt,now)||dayInWindow(room.lastActivityOn,now)))return '최근 7일 교신 시각이 확인되지 않았습니다.';
 const checked=instant(room.verifiedAt);
 if(!Number.isFinite(checked)||checked>now+futureToleranceMs||now-checked>maxReadAgeMs)return '읽음 확인 시각이 만료되었습니다.';
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
export function validateCapture(capture,now=new Date(),{maxReadAgeMs=5000,maxRooms=20,futureToleranceMs=5000}={}){
 const at=now.getTime();
 if(!capture||!UUID.test(capture.id??'')||capture.source!=='kakao-read-review'||capture.timeZone!=='Asia/Seoul'||!Number.isFinite(instant(capture.capturedAt))||Math.abs(at-instant(capture.capturedAt))>60000)throw fail('수집 출처와 시각을 확인해 주세요.','CAPTURE_SCOPE');
 if(!Array.isArray(capture.rooms)||capture.rooms.length<1||capture.rooms.length>maxRooms)throw fail('수집할 방의 범위를 확인해 주세요.','CAPTURE_SCOPE');
 const roomIds=new Set(),messageIds=new Set();
 const rooms=capture.rooms.map(room=>{
  if(roomReason(room,at,maxReadAgeMs,futureToleranceMs)||roomIds.has(room.id))throw fail('읽음 상태와 방 식별을 다시 확인해 주세요.','UNREAD_OR_UNKNOWN',409);
  roomIds.add(room.id);
  if(!Array.isArray(room.messages)||room.messages.length<1||messageIds.size+room.messages.length>250)throw fail('검증된 날짜의 메시지 범위를 초과했습니다.','MESSAGE_SCOPE',409);
  const messages=room.messages.map(message=>{
   if(!message||!validText(message.id,160)||messageIds.has(message.id))throw fail('메시지 식별이 중복되거나 잘못되었습니다.','MESSAGE_ID');
   messageIds.add(message.id);
   const precise=inWindow(message.sentAt,at)&&message.sentOn===undefined&&message.timePrecision===undefined;
   const day=message.sentAt===undefined&&message.timePrecision==='day'&&dayInWindow(message.sentOn,at);
   if((!precise&&!day)||!validText(message.sender,100)||!validText(message.text,4000))throw fail('최근 7일의 발신 날짜와 메시지를 확인하지 못했습니다.','MESSAGE_SCOPE',409);
   return {id:message.id,...(precise?{sentAt:message.sentAt}:{sentOn:message.sentOn,timePrecision:'day'}),sender:redact(message.sender),text:redact(message.text)};
  });
  return {id:room.id,title:redact(room.title),unreadCount:0,verifiedAt:room.verifiedAt,messages};
 });
 const result={id:capture.id,capturedAt:capture.capturedAt,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms};
 if(new TextEncoder().encode(JSON.stringify(result)).length>80000)throw fail('수집 결과가 큽니다. 구간을 나누어 검토해 주세요.','CAPTURE_SIZE',413);
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

/** A fixed native batch performs all rechecks and navigation; request data is never a target. */
export async function collectReadRooms(adapter,input,clock=()=>new Date(),signal,{reviewedRoomIds=[],reviewedMessageIds=[]}={}){
 if(!input||!UUID.test(input.id??'')||input.scope!=='recent_read_rooms'||Object.keys(input).some(key=>!['id','scope'].includes(key)))throw fail('최근 읽은 방 검토 입력을 확인해 주세요.');
 if(typeof adapter?.scanRecent!=='function')throw fail('이 연결 프로그램은 자동 방 이동을 지원하지 않습니다. 최신 버전으로 다시 실행해 주세요.','NAVIGATION_UNAVAILABLE',409);
 if(!reviewedIds(reviewedRoomIds)||!reviewedIds(reviewedMessageIds,10000))throw fail('이어갈 검토 범위를 확인하지 못했습니다. 연결 프로그램을 다시 시작해 주세요.');
 throwStopped(signal);
 const started=clock().getTime(),batch=await withAbort(()=>adapter.scanRecent(signal,{reviewedRoomIds:[...reviewedRoomIds],reviewedMessageIds:[...reviewedMessageIds]}),signal);
 throwStopped(signal);
 const ended=clock(),elapsed=ended.getTime()-started;
 if(!Number.isFinite(elapsed)||elapsed<0||elapsed>AUTO_SCAN_MS)throw fail('자동 검토 시간이 지나 수집을 폐기했습니다. 다시 시작해 주세요.','SCAN_TIMEOUT',409);
 if(!batch||!Array.isArray(batch.rooms)||!Array.isArray(batch.skipped)||batch.skipped.length>500||typeof batch.complete!=='boolean'||!Number.isInteger(batch.visited)||batch.visited<batch.rooms.length||batch.visited>500)throw fail('자동 검토 결과의 범위와 상태를 확인하지 못했습니다.','NATIVE_FORMAT',409);
 const completed=batch.reviewedRoomIds??[];
 if(!reviewedIds(completed)||new Set([...reviewedRoomIds,...completed]).size>1000)throw fail('자동 검토의 이어가기 범위를 확인하지 못했습니다.','NATIVE_FORMAT',409);
 if(batch.rooms.some(room=>!room||typeof room.historyComplete!=='boolean'||!room.historyComplete&&(batch.complete||completed.includes(room.id))))throw fail('일부만 검토한 방을 완료한 것으로 표시할 수 없습니다.','NATIVE_FORMAT',409);
 const skipped=batch.skipped.map(item=>({reason:typeof item?.reason==='string'?redact(item.reason).slice(0,200):'확인할 수 없는 방을 제외했습니다.'}));
 if(!batch.rooms.length)throw fail('최근 7일의 읽은 방에서 검증 가능한 대화를 찾지 못했습니다.'+(skipped[0]?` 제외 사유: ${skipped[0].reason}`:' 읽음 상태와 지원 화면을 확인해 주세요.'),'NO_ELIGIBLE_ROOMS',409);
 const capture=validateCapture({id:input.id,capturedAt:ended.toISOString(),source:'kakao-read-review',timeZone:'Asia/Seoul',rooms:batch.rooms},ended,{maxReadAgeMs:AUTO_SCAN_MS,maxRooms:10,futureToleranceMs:0});
 const completedMessages=batch.reviewedMessageIds,delivered=capture.rooms.flatMap(room=>room.messages.map(message=>message.id)),oldMessages=new Set(reviewedMessageIds);
 if(!reviewedIds(completedMessages,250)||completedMessages.length!==delivered.length||completedMessages.some(id=>!delivered.includes(id))||delivered.some(id=>oldMessages.has(id))||new Set([...reviewedMessageIds,...completedMessages]).size>10000)throw fail('메시지 이어가기 범위가 실제 전달한 대화와 일치하지 않습니다.','NATIVE_FORMAT',409);
 throwStopped(signal);
 return {capture,skipped,complete:batch.complete,visited:batch.visited,reviewedRoomIds:[...completed],reviewedMessageIds:[...completedMessages]};
}
