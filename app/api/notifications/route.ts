import {after} from 'next/server';
import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {collectNotifications,listNotifications,readNotifications,notify} from '@/lib/orbit/notifications/store';
import {pushPublicKey,subscribePush,unsubscribePush,flushPushNotifications} from '@/lib/orbit/notifications/push';
export const dynamic='force-dynamic';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('read'),ids:z.array(z.string().max(500)).max(100).default([]),through:z.string().datetime().optional()}).strict(),
 z.object({action:z.literal('subscribe'),subscription:z.object({endpoint:z.string().url().max(2048),keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]+$/).max(100),auth:z.string().regex(/^[A-Za-z0-9_-]+$/).max(30)}).strict()}).strict()}).strict(),
 z.object({action:z.literal('unsubscribe'),endpoint:z.string().url().max(2048)}).strict(),
 z.object({action:z.literal('test')}).strict(),
]);
export async function GET(request:Request){try{const user=await owner(),db=getDatabase();await collectNotifications(db,user.id);const url=new URL(request.url),before=url.searchParams.get('before')??undefined;if(before&&!z.string().datetime().safeParse(before).success)throw new AgentError('알림 조회 위치를 확인해 주세요.');const subs=await db.prepare('SELECT id,last_error FROM orbit_push_subscriptions WHERE owner_id=?').bind(user.id).all<{id:string;last_error:string}>();after(()=>flushPushNotifications(db,user.id));return json({...await listNotifications(db,user.id,before),publicKey:await pushPublicKey(db,user.id),subscriptions:subs.results.map(s=>({id:s.id,error:s.last_error})),serverTime:new Date().toISOString()})}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request),parsed=input.safeParse(await body(request,12000));if(!parsed.success)throw new AgentError('알림 요청을 확인해 주세요.');const db=getDatabase(),v=parsed.data;
 if(v.action==='read')await readNotifications(db,user.id,v.ids,v.through);
 if(v.action==='subscribe')await subscribePush(db,user.id,v.subscription,new URL(request.url).origin);
 if(v.action==='unsubscribe')await unsubscribePush(db,user.id,v.endpoint);
 if(v.action==='test')await notify(db,user.id,{id:'test:'+crypto.randomUUID(),kind:'info',title:'기기 알림 테스트',body:'이 알림이 기기에도 표시되면 설정이 완료됐습니다.',href:'/?notifications=1',createdAt:new Date().toISOString()});
 await collectNotifications(db,user.id);after(()=>flushPushNotifications(db,user.id));return json({ok:true,...await listNotifications(db,user.id)});
}catch(e){return failure(e)}}
