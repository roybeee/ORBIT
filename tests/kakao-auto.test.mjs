import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collectReadRooms,allowedOperation} from '../integrations/orbit-kakao-mac/policy.mjs';
import {createKakaoBridge,DEFAULT_ORIGIN} from '../integrations/orbit-kakao-mac/bridge.mjs';

const at='2026-11-01T10:00:00.000Z';
const clock=()=>new Date(at);
const hash=n=>n.toString(16).padStart(64,'0');
const room=(overrides={})=>({id:'r1',title:'읽은 방',unreadCount:0,layoutVerified:true,historyComplete:true,verifiedAt:at,lastActivityAt:'2026-11-01T09:00:00Z',messages:[{id:hash(1),sender:'나',text:'내일 14:00~15:00 회의 확정',sentAt:'2026-11-01T09:00:00Z'}],...overrides});
function batch(overrides={}){const result={rooms:[room()],skipped:[],complete:true,visited:1,reviewedRoomIds:[],...overrides};return {...result,reviewedMessageIds:overrides.reviewedMessageIds??result.rooms.flatMap(value=>value.messages.map(message=>message.id))}}
const input=()=>({id:randomUUID(),scope:'recent_read_rooms'});

test('recent read-room scan calls only the fixed native scan and projects validated capture data',async()=>{
 let calls=0;
 const result=await collectReadRooms({scanRecent:async()=>{calls++;return batch({rooms:[room({preview:'never send',rawScreenshot:'never send'})],skipped:[{reason:'미읽음 방 제외',preview:'never send'}]})}},input(),clock);
 assert.equal(calls,1);assert.equal(result.capture.rooms[0].id,'r1');
 assert.equal(result.capture.capturedAt,at);assert.equal(result.complete,true);assert.equal(result.visited,1);
 assert.equal(JSON.stringify(result).includes('never send'),false);
 assert.deepEqual(result.skipped,[{reason:'미읽음 방 제외'}]);
});
test('automatic scan allowlist does not expose arbitrary navigation targets or inputs',async()=>{
 assert.equal(allowedOperation('scan-recent'),true);
 for(const operation of ['send','type','click','open-room','press-key','run-script'])assert.equal(allowedOperation(operation),false);
 let called=false;
 await assert.rejects(()=>collectReadRooms({scanRecent:async()=>{called=true;return batch()}},{...input(),target:'another-room'},clock),e=>e.code==='INPUT');
 assert.equal(called,false);
});
test('unsupported automatic navigation never falls back to reading another room',async()=>{
 await assert.rejects(()=>collectReadRooms({readCurrent:async()=>{throw new Error('must not fall back')}},input(),clock),e=>e.code==='NAVIGATION_UNAVAILABLE');
});
test('a room collected earlier in a bounded batch retains its real verification time',async()=>{
 const verifiedAt='2026-11-01T09:58:01Z';
 const result=await collectReadRooms({scanRecent:async()=>batch({rooms:[room({verifiedAt})]})},input(),clock);
 assert.equal(result.capture.rooms[0].verifiedAt,verifiedAt);
});
test('stale or future room checks discard the entire automatic batch',async()=>{
 for(const verifiedAt of ['2026-11-01T09:57:59Z','2026-11-01T10:00:01Z']){
  await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch({rooms:[room({verifiedAt})]})},input(),clock),e=>e.code==='UNREAD_OR_UNKNOWN');
 }
});
test('unread unknown or changed room results cannot be forwarded',async()=>{
 for(const change of [{unreadCount:1},{unreadCount:null},{layoutVerified:false},{id:''}]){
  await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch({rooms:[room(change)]})},input(),clock),e=>e.code==='UNREAD_OR_UNKNOWN');
 }
});
test('automatic result excludes messages outside the final seven-day window',async()=>{
 const stale={id:'old',sender:'나',text:'오래된 원문',sentAt:'2026-10-25T09:59:59Z'};
 await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch({rooms:[room({messages:[stale]})]})},input(),clock),e=>e.code==='MESSAGE_SCOPE');
});
test('duplicate rooms or cross-room message IDs invalidate the batch',async()=>{
 for(const rooms of [[room(),room()],[room(),room({id:'r2'})]]){
  await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch({rooms,visited:2})},input(),clock));
 }
});
test('room and total-message caps reject oversized native output',async()=>{
 const rooms=Array.from({length:11},(_,i)=>room({id:'r'+i,messages:[{...room().messages[0],id:'m'+i}]}));
 await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch({rooms,visited:11})},input(),clock),e=>e.code==='CAPTURE_SCOPE');
 const messages=Array.from({length:251},(_,i)=>({...room().messages[0],id:'m'+i}));
 await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch({rooms:[room({messages})]})},input(),clock),e=>e.code==='MESSAGE_SCOPE');
});
test('automatic output removes authentication data from title sender and body',async()=>{
 const result=await collectReadRooms({scanRecent:async()=>batch({rooms:[room({title:'비밀번호: Synthetic',messages:[{...room().messages[0],sender:'client_secret: synthetic',text:'확인번호는 123456입니다.'}]})]})},input(),clock);
 assert.equal(JSON.stringify(result).includes('Synthetic'),false);assert.equal(JSON.stringify(result).includes('123456'),false);
 assert.equal(result.capture.rooms[0].messages[0].sender,'[인증 정보가 포함되어 분석에서 제외]');
});
test('partial batches remain explicitly incomplete rather than claiming all rooms were reviewed',async()=>{
 const result=await collectReadRooms({scanRecent:async()=>batch({complete:false,visited:3,skipped:[{reason:'이번 묶음 한도에 도달'}]})},input(),clock);
 assert.equal(result.complete,false);assert.equal(result.visited,3);
});
test('continuation IDs are bounded hashes and are never free-form native targets',async()=>{
 const reviewedRoomIds=['a'.repeat(64)];let received;
 const result=await collectReadRooms({scanRecent:async(_signal,options)=>{received=options;return batch({reviewedRoomIds:['b'.repeat(64)]})}},input(),clock,undefined,{reviewedRoomIds});
 assert.deepEqual(received,{reviewedRoomIds,reviewedMessageIds:[]});assert.deepEqual(result.reviewedRoomIds,['b'.repeat(64)]);
 await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch({reviewedRoomIds:['send-message']})},input(),clock),error=>error.code==='NATIVE_FORMAT');
});
test('empty or malformed native batches return a bounded failure',async()=>{
 for(const value of [null,{},batch({complete:'yes'}),batch({visited:-1}),batch({rooms:[],visited:0})]){
  await assert.rejects(()=>collectReadRooms({scanRecent:async()=>value},input(),clock));
 }
});
test('an empty scan explains its bounded skip reason without exposing authentication data',async()=>{
 await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch({rooms:[],visited:1,skipped:[{reason:'지원되는 방 열기 동작이 없습니다.'}]})},input(),clock),error=>error.code==='NO_ELIGIBLE_ROOMS'&&error.message.includes('방 열기'));
 await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch({rooms:[],visited:1,skipped:[{reason:'client_secret: synthetic-only'}]})},input(),clock),error=>!error.message.includes('synthetic-only'));
});
test('cancelled or timed-out batches never produce a capture',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(()=>collectReadRooms({scanRecent:async()=>{calls++;return batch()}},input(),clock,controller.signal),e=>e.code==='STOPPED');assert.equal(calls,0);
 const after=new AbortController();
 await assert.rejects(()=>collectReadRooms({scanRecent:async()=>{after.abort();return batch()}},input(),clock,after.signal),e=>e.code==='STOPPED');
 let ticks=0;
 await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch()},input(),()=>new Date(Date.parse(at)+(ticks++?120001:0))),e=>e.code==='SCAN_TIMEOUT');
});

const request=(bridge,path,body)=>fetch(`http://127.0.0.1:${bridge.port}${path}`,{method:body?'POST':'GET',headers:{Origin:DEFAULT_ORIGIN,Authorization:'Bearer '+bridge.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
async function bridgeFixture(fn,adapter={}){
 const bridge=await createKakaoBridge({port:0,adapter:{health:async()=>({connected:true,accessibility:true,layoutSupported:true,navigationSupported:true}),scanRecent:async()=>{const now=new Date().toISOString();return batch({rooms:[room({verifiedAt:now,lastActivityAt:now,messages:[{...room().messages[0],sentAt:now}]})]})},...adapter}});
 try{await fn(bridge)}finally{await bridge.close()}
}
test('bridge exposes automatic readiness only when the native adapter explicitly supports it',()=>bridgeFixture(async bridge=>{
 const result=await (await request(bridge,'/health')).json();assert.equal(result.mode,'read_rooms');
}));
test('bridge forwards the recent-read scope through the fixed native batch operation',()=>bridgeFixture(async bridge=>{
 const response=await request(bridge,'/scan',input());assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.capture.rooms.length,1);assert.equal(result.complete,true);
}));
test('bridge continues partial batches in memory and clears continuation after a complete pass',async()=>{
 const options=[],ids=['a','b','c','d'].map(value=>value.repeat(64));let call=0;
 await bridgeFixture(async bridge=>{
  for(let i=0;i<4;i++){
   const response=await request(bridge,'/scan',input());assert.equal(response.status,200);
   const result=await response.json();assert.equal('reviewedRoomIds' in result,false);assert.equal('reviewedMessageIds' in result,false);
  }
  assert.deepEqual(options,[[],[ids[0]],[ids[0],ids[1]],[]]);
 },{scanRecent:async(_signal,value)=>{options.push(value.reviewedRoomIds);const now=new Date().toISOString(),i=call++;return batch({complete:i===2,reviewedRoomIds:[ids[i]],rooms:[room({id:ids[i],verifiedAt:now,lastActivityAt:now,messages:[{...room().messages[0],id:hash(i+1),sentAt:now}]})]})}});
});
test('a room with five hundred messages resumes its second half without marking the room complete early',async()=>{
 const calls=[],all=Array.from({length:500},(_,i)=>({...room().messages[0],id:hash(i+1)}));
 await bridgeFixture(async bridge=>{
  const first=await (await request(bridge,'/scan',input())).json();
  assert.equal(first.complete,false);assert.equal(first.capture.rooms[0].messages.length,250);
  const second=await (await request(bridge,'/scan',input())).json();
  assert.equal(second.complete,true);assert.equal(second.capture.rooms[0].messages.length,250);
  assert.deepEqual(calls[1].reviewedRoomIds,[]);assert.equal(calls[1].reviewedMessageIds.length,250);
  const ids=[...first.capture.rooms[0].messages,...second.capture.rooms[0].messages].map(message=>message.id);
  assert.equal(new Set(ids).size,500);assert.deepEqual(new Set(ids),new Set(all.map(message=>message.id)));
 },{scanRecent:async(_signal,options)=>{
  calls.push(options);const remaining=all.filter(message=>!options.reviewedMessageIds.includes(message.id)),messages=remaining.slice(0,250),complete=remaining.length<=250,now=new Date().toISOString();
  return batch({complete,reviewedRoomIds:complete?[hash(1001)]:[],rooms:[room({id:hash(1001),historyComplete:complete,verifiedAt:now,lastActivityAt:now,messages:messages.map(message=>({...message,sentAt:now}))})]});
 }});
});
test('message continuation rejects malformed hashes or messages that were never delivered',async()=>{
 for(const reviewedMessageIds of [['not-a-hash'],[hash(999)]]){
  await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch({reviewedMessageIds})},input(),clock),error=>error.code==='NATIVE_FORMAT');
 }
 await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch()},input(),clock,undefined,{reviewedMessageIds:[hash(1)]}),error=>error.code==='NATIVE_FORMAT');
});
test('message continuation input caps stop the native call before memory can grow without bound',async()=>{
 let calls=0;
 const adapter={scanRecent:async()=>{calls++;return batch()}};
 await assert.rejects(()=>collectReadRooms(adapter,input(),clock,undefined,{reviewedMessageIds:Array.from({length:10001},(_,i)=>hash(i+1))}),error=>error.code==='INPUT');
 await assert.rejects(()=>collectReadRooms(adapter,input(),clock,undefined,{reviewedMessageIds:['send-message']}),error=>error.code==='INPUT');
 assert.equal(calls,0);
});
test('a partial room cannot be declared complete in room or batch continuation state',async()=>{
 for(const change of [{complete:true,reviewedRoomIds:[]},{complete:false,reviewedRoomIds:[hash(1001)]}]){
  await assert.rejects(()=>collectReadRooms({scanRecent:async()=>batch({...change,rooms:[room({id:hash(1001),historyComplete:false})]})},input(),clock),error=>error.code==='NATIVE_FORMAT');
 }
});
test('bridge stopping an automatic batch aborts the native adapter and rejects replay',async()=>{
 let entered;const started=new Promise(resolve=>{entered=resolve});
 await bridgeFixture(async bridge=>{
  const value=input(),pending=request(bridge,'/scan',value);await started;
  assert.equal((await request(bridge,'/stop',{id:value.id})).status,200);
  assert.equal((await pending).status,409);
  assert.equal((await request(bridge,'/scan',value)).status,409);
 },{scanRecent:async signal=>{entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('stopped'),{code:'STOPPED',status:409})),{once:true}))}});
});
test('disconnecting a browser request stops an automatic native scan',async()=>{
 let entered,aborted;
 const started=new Promise(resolve=>{entered=resolve}),stopped=new Promise(resolve=>{aborted=resolve});
 await bridgeFixture(async bridge=>{
  const controller=new AbortController(),value=input();
  const pending=fetch(`http://127.0.0.1:${bridge.port}/scan`,{method:'POST',headers:{Origin:DEFAULT_ORIGIN,Authorization:'Bearer '+bridge.token,'Content-Type':'application/json'},body:JSON.stringify(value),signal:controller.signal});
  await started;controller.abort();await assert.rejects(()=>pending);await stopped;
  assert.equal((await request(bridge,'/scan',value)).status,409);
 },{scanRecent:async signal=>{entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted();reject(Object.assign(new Error('stopped'),{code:'STOPPED',status:409}))},{once:true}))}});
});
