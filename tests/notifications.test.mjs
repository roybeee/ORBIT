import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,hkdfSync,createDecipheriv} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {notify,notificationState,collectNotifications,listNotifications,readNotifications,dismissNotifications} from '../lib/orbit/notifications/store.ts';
import {subscribePush,flushPushNotifications,subscriptionId,pushPublicKey} from '../lib/orbit/notifications/push.ts';
import {encryptPush,pushRequest,vapidKeys,base64url,unbase64,validPushEndpoint} from '../lib/orbit/notifications/web-push.ts';
import {beginTurn,finishTurn,failTurn} from '../lib/orbit/agent/repository.ts';
import {readWorkspace,writeCommand} from '../db/repository.ts';
const subscription=()=>{const ecdh=createECDH('prime256v1');ecdh.generateKeys();return {ecdh,sub:{endpoint:'https://fcm.googleapis.com/fcm/send/test-endpoint',keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,8).toString('base64url')},subject:'https://orbit.example'}}};
test('Web Push decrypts independently and VAPID validates for the subscription audience',async()=>{const {ecdh,sub}=subscription(),payload={title:'승인 필요',href:'/?note=record'},body=Buffer.from(await encryptPush(sub,JSON.stringify(payload))),salt=body.subarray(0,16),pub=body.subarray(21,86);assert.equal(body.readUInt32BE(16),4096);assert.equal(body[20],65);const shared=ecdh.computeSecret(pub),ikm=hkdfSync('sha256',shared,Buffer.from(sub.keys.auth,'base64url'),Buffer.concat([Buffer.from('WebPush: info\0'),ecdh.getPublicKey(),pub]),32),cek=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16),iv=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);const decipher=createDecipheriv('aes-128-gcm',cek,iv);decipher.setAuthTag(body.subarray(-16));const plain=Buffer.concat([decipher.update(body.subarray(86,-16)),decipher.final()]);assert.equal(plain.at(-1),2);assert.deepEqual(JSON.parse(plain.subarray(0,-1)),payload);
 const keys=await vapidKeys(),req=await pushRequest(sub,keys,payload),token=req.headers.Authorization.split('t=')[1].split(',')[0],parts=token.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));assert.equal(claims.aud,'https://fcm.googleapis.com');const publicKey=await crypto.subtle.importKey('raw',unbase64(keys.publicKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,unbase64(parts[2]),new TextEncoder().encode(parts.slice(0,2).join('.'))),true);assert.ok(validPushEndpoint('https://web.push.apple.com/Qabc'));for(const url of ['http://fcm.googleapis.com/x','https://localhost/x','https://fcm.googleapis.com.evil/x','https://user@fcm.googleapis.com/x','https://127.0.0.1/x'])assert.equal(validPushEndpoint(url),false);
});
test('notifications survive reloads, dedupe, isolate owners, preserve newer unread and report completed/failed turns',async()=>{const db=createDatabase();try{await notificationState(db,'a');for(const status of ['completed','failed']){const id=crypto.randomUUID(),turn=await beginTurn(db,'a',id,'업무 테스트');if(status==='completed')await finishTurn(db,'a',id,turn.lease,{text:'결과를 준비했습니다.',sources:[]},[]);else await failTurn(db,'a',id,turn.lease,'연결 실패');}await collectNotifications(db,'a');await collectNotifications(db,'a');let data=await listNotifications(db,'a');assert.equal(data.items.length,2);assert.equal(data.unread,2);assert.deepEqual(new Set(data.items.map(n=>n.kind)),new Set(['completed','failed']));await readNotifications(db,'b',data.items.map(n=>n.id));assert.equal((await listNotifications(db,'a')).unread,2);const through=new Date().toISOString();await notify(db,'a',{id:'new',kind:'approval',title:'새 승인',body:'결재',href:'/',createdAt:new Date(Date.now()+1000).toISOString()});await readNotifications(db,'a',[],through);assert.equal((await listNotifications(db,'a')).unread,1);assert.equal((await listNotifications(db,'b')).items.length,0)}finally{db.close()}});
test('push retries safely, expires invalid subscriptions, and never sends to a different owner',async()=>{const db=createDatabase(),real=globalThis.fetch;try{const {sub}=subscription();await subscribePush(db,'a',sub,sub.subject);await notify(db,'a',{id:'one',kind:'approval',title:'비공개 회의 제목',body:'비공개 본문',href:'/?note=1',createdAt:new Date(Date.now()+1).toISOString()});await collectNotifications(db,'a');let calls=0;globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,sub.endpoint);assert.equal(init.redirect,'error');assert.ok(init.body instanceof Uint8Array);return new Response('',{status:503})};await flushPushNotifications(db,'b');assert.equal(calls,0);await flushPushNotifications(db,'a');let row=await db.prepare('SELECT * FROM orbit_push_deliveries').first();assert.equal(row.status,'queued');assert.equal(row.attempts,1);await flushPushNotifications(db,'a');assert.equal(calls,1);await db.prepare('UPDATE orbit_push_deliveries SET next_at=0').run();globalThis.fetch=async()=>new Response('',{status:410});await flushPushNotifications(db,'a');assert.equal((await db.prepare('SELECT count(*) AS n FROM orbit_push_subscriptions').first()).n,0);assert.equal((await listNotifications(db,'a')).items.length,1)}finally{globalThis.fetch=real;db.close()}});

test('a dismissed notification disappears, stops counting as unread and is not rebuilt by collection',async()=>{
 const db=createDatabase();
 try{
  await notificationState(db,'a');
  await notify(db,'a',{id:'keep',kind:'info',title:'남는 알림',body:'본문',href:'/',createdAt:'2026-09-22T00:00:00.000Z'});
  await notify(db,'a',{id:'drop',kind:'failed',title:'지울 알림',body:'본문',href:'/',createdAt:'2026-09-22T00:00:01.000Z'});
  assert.equal((await listNotifications(db,'a')).unread,2);
  await dismissNotifications(db,'a',['drop']);
  const after=await listNotifications(db,'a');
  assert.deepEqual(after.items.map(i=>i.id),['keep']);
  assert.equal(after.unread,1);
  // Collection reinserts every notification it can still derive; the dismissal must win.
  await notify(db,'a',{id:'drop',kind:'failed',title:'지울 알림',body:'본문',href:'/',createdAt:'2026-09-22T00:00:01.000Z'});
  await collectNotifications(db,'a');
  assert.deepEqual((await listNotifications(db,'a')).items.map(i=>i.id),['keep']);
  await dismissNotifications(db,'a',[]);
  assert.equal((await listNotifications(db,'a')).items.length,1);
 }finally{db.close()}
});
