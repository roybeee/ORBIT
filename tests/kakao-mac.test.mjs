import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {createKakaoBridge,DEFAULT_ORIGIN} from '../integrations/orbit-kakao-mac/bridge.mjs';
import {eligibleRooms,collectReadRoom,validateCapture,allowedOperation} from '../integrations/orbit-kakao-mac/policy.mjs';
import {nativeCall} from '../integrations/orbit-kakao-mac/adapter.mjs';

const now='2026-11-01T10:00:00.000Z';
const meta=(overrides={})=>({id:'room-1',title:'업무 대화',lastActivityAt:'2026-10-31T08:00:00.000Z',unreadCount:0,layoutVerified:true,verifiedAt:now,...overrides});
const message=(overrides={})=>({id:'m1',sentAt:'2026-10-31T08:00:00.000Z',sender:'나',text:'11월 3일 오전 10시부터 11시까지 회의',...overrides});

test('eligible room metadata excludes unread/unknown/old rooms and never copies previews',()=>{
 const result=eligibleRooms([meta({preview:'unread private preview'}),meta({id:'unread',unreadCount:2}),meta({id:'unknown',unreadCount:null}),meta({id:'old',lastActivityAt:'2026-10-24T10:00:00Z'}),meta({id:'layout',layoutVerified:false})],new Date(now));
 assert.deepEqual(result.rooms.map(r=>r.id),['room-1']);
 assert.equal(JSON.stringify(result).includes('unread private preview'),false);
 assert.equal(result.skipped.length,4);
});
test('seven-day boundary uses instants and rejects future/invalid metadata',()=>{
 const rows=[meta({id:'boundary',lastActivityAt:'2026-10-25T10:00:00Z'}),meta({id:'before',lastActivityAt:'2026-10-25T09:59:59Z'}),meta({id:'future',lastActivityAt:'2026-11-02T10:00:00Z'}),meta({id:'invalid',lastActivityAt:'yesterday'})];
 assert.deepEqual(eligibleRooms(rows,new Date(now)).rooms.map(r=>r.id),['boundary']);
});
test('operation allowlist has no keyboard, sender, arbitrary coordinate, downloads or navigation',()=>{
 for(const op of ['health','list-metadata','capture-current','stop'])assert.equal(allowedOperation(op),true);
 for(const op of ['type','send','click','open-room','scroll','run-script','download','paste','capture-screen'])assert.equal(allowedOperation(op),false,op);
});
test('capture rechecks read status, identity and metadata before exposing content',async()=>{
 let reads=0;
 const adapter={inspectCurrent:async()=>meta(),readCurrent:async()=>{reads++;return {roomId:'room-1',messages:[message()]}}};
 const result=await collectReadRoom(adapter,{id:randomUUID(),scope:'current_read_room'},new Date(now));
 assert.equal(reads,1);assert.equal(result.capture.rooms[0].messages[0].text,message().text);
 assert.equal(result.capture.source,'kakao-read-review');
});
test('stale room checks, changed input/signature and mismatched capture room fail closed',async()=>{
 assert.equal(eligibleRooms([meta({verifiedAt:'2026-11-01T09:59:00Z'}),meta({lastActivityAt:undefined,lastActivityOn:'2026-11-03'})],new Date(now)).rooms.length,0);
 for(const [before,after,bodyId] of [[meta({lastInputAt:10}),meta({lastInputAt:11}),'room-1'],[meta({activitySignature:'a'}),meta({activitySignature:'b'}),'room-1'],[meta(),meta(),'other']]){
  let checks=0;await assert.rejects(()=>collectReadRoom({inspectCurrent:async()=>checks++?after:before,readCurrent:async()=>({roomId:bodyId,messages:[message()]})},{id:randomUUID(),scope:'current_read_room'},new Date(now)),e=>e.code==='ROOM_CHANGED');
 }
 await assert.rejects(()=>nativeCall('send-message'),e=>e.code==='OPERATION');
});
test('unread room is never read, and newly unread or changed room discards captured data',async()=>{
 let reads=0,checks=0;
 const readCurrent=async()=>{reads++;return {roomId:'room-1',messages:[message()]}};
 await assert.rejects(()=>collectReadRoom({inspectCurrent:async()=>meta({unreadCount:1}),readCurrent},{id:randomUUID(),scope:'current_read_room'},new Date(now)),e=>e.code==='UNREAD_OR_UNKNOWN');
 assert.equal(reads,0);
 await assert.rejects(()=>collectReadRoom({inspectCurrent:async()=>meta({unreadCount:checks++?1:0}),readCurrent},{id:randomUUID(),scope:'current_read_room'},new Date(now)),e=>e.code==='ROOM_CHANGED');
 checks=0;
 await assert.rejects(()=>collectReadRoom({inspectCurrent:async()=>meta({id:checks++?'other':'room-1'}),readCurrent},{id:randomUUID(),scope:'current_read_room'},new Date(now)),e=>e.code==='ROOM_CHANGED');
});
test('cancellation and old/missing message date never produce a capture',async()=>{
 const controller=new AbortController();
 const adapter={inspectCurrent:async()=>meta(),readCurrent:async()=>{controller.abort();return {roomId:'room-1',messages:[message()]}}};
 await assert.rejects(()=>collectReadRoom(adapter,{id:randomUUID(),scope:'current_read_room'},new Date(now),controller.signal),e=>e.code==='STOPPED');
 assert.throws(()=>validateCapture({id:randomUUID(),capturedAt:now,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{...meta(),messages:[message({sentAt:'2026-10-24T08:00:00Z'})]}]},new Date(now)),e=>e.code==='MESSAGE_SCOPE');
 assert.throws(()=>validateCapture({id:randomUUID(),capturedAt:now,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{...meta(),messages:[message({sentAt:'오후 2:30'})]}]},new Date(now)),e=>e.code==='MESSAGE_SCOPE');
});
test('capture output allowlists fields, redacts authentication material and rejects duplicate IDs',()=>{
 const capture={id:randomUUID(),capturedAt:now,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{...meta(),preview:'secret preview',messages:[message({text:'인증번호 123456',rawScreenshot:'never'})]}]};
 const safe=validateCapture(capture,new Date(now));
 assert.equal(JSON.stringify(safe).includes('123456'),false);assert.equal(JSON.stringify(safe).includes('secret preview'),false);assert.equal(JSON.stringify(safe).includes('rawScreenshot'),false);
 assert.throws(()=>validateCapture({...capture,rooms:[{...meta(),messages:[message(),message()]}]},new Date(now)),e=>e.code==='MESSAGE_ID');
});
test('authentication labels redact the entire message including natural Korean and English variants',()=>{
 // Deliberately literal synthetic fixtures: these are not real credentials.
 const samples=['카카오톡 인증번호는 [123456]입니다.','인증 번호 (123456)를 입력하세요','비밀번호는 SuperSecret123!','Your verification code is 123456','Your password is SuperSecret123!','passphrase: synthetic words only','OTP [123456]','2FA code: 123456','Your login code is 123456','apiKey: synthetic-key-only','API key is synthetic-key-only','API 키는 synthetic-key-only','sk-ant-synthetic-key-for-test-only','sk-proj-synthetic-key-for-test-only','Bearer abcdefghijklmnop','보안코드는 (123456)입니다','일회용 비밀번호는 123456','인증 토큰: synthetic-test-only','access_token=synthetic-test-only','refresh token: synthetic-test-only'];
 for(const text of samples){
  const input={id:randomUUID(),capturedAt:now,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{...meta(),messages:[message({text})]}]};
  const output=validateCapture(input,new Date(now));
  assert.equal(output.rooms[0].messages[0].text,'[인증 정보가 포함되어 분석에서 제외]',text);
  assert.equal(JSON.stringify(output).includes(text),false,text);
 }
 const ordinary='11월 3일 오전 10시부터 11시까지 회의';
 const safe=validateCapture({id:randomUUID(),capturedAt:now,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{...meta(),messages:[message({text:ordinary})]}]},new Date(now));
 assert.equal(safe.rooms[0].messages[0].text,ordinary);
});
test('date-only messages preserve precision and exclude the partial first day',()=>{
 const dateMessage={id:'day-message',sentOn:'2026-10-26',timePrecision:'day',sender:'나',text:'내일 오후 2시부터 3시 회의'};
 const capture={id:randomUUID(),capturedAt:now,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{...meta({lastActivityAt:undefined,lastActivityOn:'2026-10-26'}),messages:[dateMessage]}]};
 assert.deepEqual(validateCapture(capture,new Date(now)).rooms[0].messages[0],dateMessage);
 assert.throws(()=>validateCapture({...capture,rooms:[{...meta(),messages:[{...dateMessage,sentOn:'2026-10-25'}]}]},new Date(now)),e=>e.code==='MESSAGE_SCOPE');
 assert.throws(()=>validateCapture({...capture,rooms:[{...meta(),messages:[{...dateMessage,sentOn:'2026-02-30'}]}]},new Date(now)),e=>e.code==='MESSAGE_SCOPE');
});
test('invalid capture origin, empty rooms, unknown layout, empty content and oversized payload are refused',()=>{
 const base={id:randomUUID(),capturedAt:now,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{...meta(),messages:[message()]}]};
 for(const change of [{source:'other'},{id:'x'},{capturedAt:'invalid'},{rooms:[]}])assert.throws(()=>validateCapture({...base,...change},new Date(now)));
 for(const change of [{layoutVerified:false},{messages:[]},{messages:[message({text:''})]},{messages:[message({sender:''})]},{messages:[message({sentAt:'2026-11-02T10:00:00Z'})]}])assert.throws(()=>validateCapture({...base,rooms:[{...base.rooms[0],...change}]},new Date(now)));
 const large=Array.from({length:30},(_,i)=>message({id:'m'+i,text:'가'.repeat(4000)}));
 assert.throws(()=>validateCapture({...base,rooms:[{...base.rooms[0],messages:large}]},new Date(now)),e=>e.code==='CAPTURE_SIZE');
 assert.throws(()=>eligibleRooms('not rows',new Date(now)));
});

async function fixture(fn,options={}){
 const sentAt=new Date(Date.now()-1000).toISOString();
 const bridge=await createKakaoBridge({port:0,adapter:{health:async()=>({accessibility:true,connected:true,message:'수동 검토 준비'}),inspectCurrent:async()=>meta({verifiedAt:new Date().toISOString(),lastActivityAt:sentAt}),readCurrent:async()=>({roomId:'room-1',messages:[message({sentAt})]})},...options});
 try{await fn(bridge)}finally{await bridge.close()}
}
function request(bridge,path,options={}){return fetch(`http://127.0.0.1:${bridge.port}${path}`,{headers:{Origin:DEFAULT_ORIGIN,Authorization:`Bearer ${bridge.token}`,'Content-Type':'application/json',...options.headers},method:options.method??'GET',...(options.body?{body:JSON.stringify(options.body)}:{})})}
test('loopback bridge requires origin, host and bearer and refuses URL query tokens',()=>fixture(async bridge=>{
 assert.equal((await request(bridge,'/health')).status,200);
 assert.equal((await request(bridge,'/health',{headers:{Authorization:'Bearer wrong'}})).status,401);
 assert.equal((await request(bridge,'/health',{headers:{Origin:'https://attacker.invalid'}})).status,403);
 assert.equal((await request(bridge,'/health?token='+bridge.token)).status,400);
 const health=await (await request(bridge,'/health')).json();assert.equal(health.mode,'manual_only');assert.equal(JSON.stringify(health).includes(bridge.token),false);
}));
test('unsupported native layout is not reported as a ready connection',()=>fixture(async bridge=>{
 const health=await (await request(bridge,'/health')).json();
 assert.equal(health.connected,false);assert.match(health.message,/버전/);
 },{adapter:{health:async()=>({connected:true,accessibility:true,layoutSupported:false,message:'이 버전의 읽음 표시를 검증하지 못했습니다.'})}}));
test('preflight uses only configured origin and permitted headers',()=>fixture(async bridge=>{
 const allowed=await request(bridge,'/scan',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
 assert.equal(allowed.status,204);assert.equal(allowed.headers.get('access-control-allow-origin'),DEFAULT_ORIGIN);
 assert.equal((await request(bridge,'/scan',{method:'OPTIONS',headers:{Origin:'null'}})).status,403);
 assert.equal((await request(bridge,'/scan',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'DELETE'}})).status,405);
 assert.equal((await request(bridge,'/scan',{method:'OPTIONS',headers:{'Access-Control-Request-Headers':'x-unsafe'}})).status,403);
}));
test('bridge refuses hostile host, invalid JSON, oversized body and unsupported routes/methods',()=>fixture(async bridge=>{
 const hostile=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:bridge.port,path:'/health',headers:{Host:'attacker.invalid',Origin:DEFAULT_ORIGIN,Authorization:`Bearer ${bridge.token}`}},res=>{res.resume();resolve(res.statusCode)});req.once('error',reject);req.end()});
 assert.equal(hostile,403);
 assert.equal((await request(bridge,'/health',{method:'DELETE'})).status,404);
 assert.equal((await request(bridge,'/scan',{method:'POST',body:{id:'wrong'}})).status,400);
 assert.equal((await request(bridge,'/scan',{method:'POST',headers:{'Content-Type':'text/plain'},body:{id:randomUUID()}})).status,415);
 assert.equal((await request(bridge,'/stop',{method:'POST',body:{id:randomUUID(),command:'send'}})).status,400);
 const malformed=await fetch(`http://127.0.0.1:${bridge.port}/scan`,{method:'POST',headers:{Origin:DEFAULT_ORIGIN,Authorization:`Bearer ${bridge.token}`,'Content-Type':'application/json'},body:'{'});assert.equal(malformed.status,400);
 const large=await request(bridge,'/scan',{method:'POST',body:{id:randomUUID(),scope:'current_read_room',padding:'a'.repeat(2000)}});assert.equal(large.status,413);
}));
test('scan IDs cannot be replayed, arbitrary fields are refused, and no transcript retained',()=>fixture(async bridge=>{
 const id=randomUUID(),body={id,scope:'current_read_room'};
 const first=await request(bridge,'/scan',{method:'POST',body});assert.equal(first.status,200);assert.equal((await first.json()).capture.rooms.length,1);
 assert.equal((await request(bridge,'/scan',{method:'POST',body})).status,409);
 assert.equal((await request(bridge,'/scan',{method:'POST',body:{id:randomUUID(),scope:'all_rooms'}})).status,400);
 assert.equal((await request(bridge,'/scan',{method:'POST',body:{id:randomUUID(),scope:'current_read_room',command:'send'}})).status,400);
 assert.equal((await request(bridge,'/runs/'+id)).status,404);
}));
test('concurrent scan is blocked and stop aborts active scan and delayed same-ID dispatch',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve});
 const sentAt=new Date(Date.now()-1000).toISOString();
 await fixture(async bridge=>{
  const id=randomUUID();const first=request(bridge,'/scan',{method:'POST',body:{id,scope:'current_read_room'}});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal((await request(bridge,'/scan',{method:'POST',body:{id:randomUUID(),scope:'current_read_room'}})).status,409);
  assert.equal((await request(bridge,'/stop',{method:'POST',body:{id}})).status,200);release();
  assert.equal((await first).status,409);
  const stopped=randomUUID();await request(bridge,'/stop',{method:'POST',body:{id:stopped}});
  assert.equal((await request(bridge,'/scan',{method:'POST',body:{id:stopped,scope:'current_read_room'}})).status,409);
 },{adapter:{health:async()=>({accessibility:true,connected:true}),inspectCurrent:async()=>meta({verifiedAt:new Date().toISOString(),lastActivityAt:sentAt}),readCurrent:async()=>{await waiting;return {roomId:'room-1',messages:[message({sentAt})]}}}});
});
