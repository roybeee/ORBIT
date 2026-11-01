import type {Database} from '../../../db/repository.ts';
import type {KakaoCapture,KakaoReview} from './types.ts';

async function digest(value:unknown){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
 return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function messageHashes(capture:KakaoCapture){
 return Promise.all(capture.rooms.flatMap(room=>room.messages.map(async message=>({roomId:room.id,messageId:message.id,hash:await digest([room.id,message.id,message.sender,message.sentAt??message.sentOn,message.timePrecision??'instant',message.text])}))));
}
/** Only successfully completed messages are reused; old source text is never reinjected into a model. */
export async function incrementalCapture(db:Database,owner:string,conversation:string,capture:KakaoCapture){
 const hashes=await messageHashes(capture),cutoff=new Date(Date.now()-7*86400000).toISOString();
 const {results}=await db.prepare("SELECT input,response_json FROM orbit_agent_turns WHERE owner_id=? AND conversation_id=? AND status='completed' AND created_at>=? ORDER BY created_at DESC,id DESC").bind(owner,conversation,cutoff).all<{input:string;response_json:string}>();
 const completed=results.map(row=>({input:JSON.parse(row.input),review:JSON.parse(row.response_json).kakaoReview as KakaoReview|undefined})).filter(row=>row.review);
 const seen=new Set(completed.flatMap(row=>Array.isArray(row.input.messageHashes)?row.input.messageHashes:[]));
 const fresh=new Set(hashes.filter(row=>!seen.has(row.hash)).map(row=>JSON.stringify([row.roomId,row.messageId])));
 const rooms=capture.rooms.map(room=>({...room,messages:room.messages.filter(message=>fresh.has(JSON.stringify([room.id,message.id])))})).filter(room=>room.messages.length);
 return {capture:{...capture,rooms},hashes:hashes.map(row=>row.hash),replay:completed.find(row=>row.input.messageHashes?.some((hash:string)=>hashes.some(h=>h.hash===hash)))?.review};
}
