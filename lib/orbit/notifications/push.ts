import type {Database} from '../../../db/repository.ts';
import {AgentError} from '../agent/errors.ts';
import {notificationState} from './store.ts';
import {vapidKeys,pushRequest,validPushEndpoint,unbase64,base64url,type Subscription} from './web-push.ts';
export async function pushPublicKey(db:Database,owner:string){let state=await notificationState(db,owner);if(!state.public_key){const keys=await vapidKeys();await db.prepare("UPDATE orbit_notification_state SET public_key=?,private_key=? WHERE owner_id=? AND public_key=''").bind(keys.publicKey,keys.privateKey,owner).run();state=await notificationState(db,owner);}return state.public_key;}
export const subscriptionId=async(endpoint:string)=>base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint))));
export async function subscribePush(db:Database,owner:string,input:{endpoint:string;keys:{p256dh:string;auth:string}},subject:string){
 if(!validPushEndpoint(input.endpoint)||unbase64(input.keys.p256dh).length!==65||unbase64(input.keys.auth).length!==16)throw new AgentError('기기의 알림 등록 정보를 확인해 주세요.');
 // Verify the point is a real curve point before persisting it.
 await crypto.subtle.importKey('raw',unbase64(input.keys.p256dh),{name:'ECDH',namedCurve:'P-256'},false,[]);
 await pushPublicKey(db,owner);const id=await subscriptionId(input.endpoint);
 // One browser subscription belongs to the account currently enabling it.
 await db.batch([db.prepare('DELETE FROM orbit_push_subscriptions WHERE id=? AND owner_id<>?').bind(id,owner),db.prepare("INSERT INTO orbit_push_subscriptions(owner_id,id,subscription_json,created_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET subscription_json=excluded.subscription_json,last_error=''").bind(owner,id,JSON.stringify({...input,subject}),new Date().toISOString())]);
 return id;
}
export async function unsubscribePush(db:Database,owner:string,endpoint:string){const id=await subscriptionId(endpoint);await db.batch([db.prepare('DELETE FROM orbit_push_subscriptions WHERE owner_id=? AND id=?').bind(owner,id),db.prepare('DELETE FROM orbit_push_deliveries WHERE owner_id=? AND subscription_id=?').bind(owner,id)]);}
export async function flushPushNotifications(db:Database,owner:string){
 const state=await notificationState(db,owner);if(!state.public_key)return;
 const rows=await db.prepare(`SELECT d.*,s.subscription_json,n.href,n.kind,n.read_at FROM orbit_push_deliveries d JOIN orbit_push_subscriptions s ON s.owner_id=d.owner_id AND s.id=d.subscription_id JOIN orbit_notifications n ON n.owner_id=d.owner_id AND n.id=d.notification_id WHERE d.owner_id=? AND d.status='queued' AND d.next_at<=? AND d.lease_until<? ORDER BY d.next_at LIMIT 2`).bind(owner,Date.now(),Date.now()).all<{notification_id:string;subscription_id:string;attempts:number;subscription_json:string;href:string;kind:string;read_at:string|null}>();
 for(const row of rows.results){const lease=Date.now()+30000,claim=await db.prepare("UPDATE orbit_push_deliveries SET lease_until=? WHERE owner_id=? AND notification_id=? AND subscription_id=? AND status='queued' AND lease_until<?").bind(lease,owner,row.notification_id,row.subscription_id,Date.now()).run();if(claim.meta?.changes!==1)continue;
  let status='sent',error='';const attempts=row.attempts+1;
  try{if(!row.read_at){const subscription:Subscription=JSON.parse(row.subscription_json);const request=await pushRequest(subscription,{publicKey:state.public_key,privateKey:state.private_key},{id:row.notification_id,title:row.kind==='approval'?'ORBIT · 승인할 항목이 있습니다':row.kind==='failed'?'ORBIT · 확인이 필요한 업무가 있습니다':'ORBIT · 새 업무 알림',body:'ORBIT 알림함에서 내용을 확인해 주세요.',href:row.href});
   const response=await fetch(subscription.endpoint,{method:'POST',...request,redirect:'error',signal:AbortSignal.timeout(5000)});
   if(response.status===404||response.status===410){await unsubscribePush(db,owner,subscription.endpoint);continue;}
   if(!response.ok)throw new Error('알림 서버 응답 '+response.status);
  }}catch(e){status=attempts<5?'queued':'failed';error=e instanceof Error?e.message:'기기 알림 전송 실패';}
  await db.batch([db.prepare('UPDATE orbit_push_deliveries SET status=?,attempts=?,next_at=?,lease_until=0,error=? WHERE owner_id=? AND notification_id=? AND subscription_id=? AND lease_until=?').bind(status,attempts,Date.now()+Math.min(3600000,30000*2**attempts),error,owner,row.notification_id,row.subscription_id,lease),db.prepare('UPDATE orbit_push_subscriptions SET last_error=? WHERE owner_id=? AND id=?').bind(error,owner,row.subscription_id)]);
 }
}
