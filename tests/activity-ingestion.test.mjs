import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {syncActivity,listActivity,activityDetail,activityStatus,classifyActivity} from '../lib/orbit/agent/activity.ts';

const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
async function fixture(fn){
 const db=createDatabase(),fetch=globalThis.fetch;
 try{await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'activity-secret',connectionId:'test'},{connected:true},env.ORBIT_ENCRYPTION_KEY);await fn(db)}
 finally{globalThis.fetch=fetch;db.close()}
}
function upstream(messages,overrides={}){
 const session={id:'slack-current',source:'slack',title:'업무 지시',last_active:1,message_count:messages.length},offsets=[];
 globalThis.fetch=async url=>{
  const u=new URL(url);
  if(u.pathname==='/api/sessions')return Response.json({object:'list',data:[session],has_more:false});
  assert.equal(u.searchParams.get('order'),'oldest');assert.equal(u.searchParams.get('limit'),'50');
  const offset=Number(u.searchParams.get('offset'));offsets.push(offset);const data=messages.slice(offset,offset+50);
  return Response.json({object:'list',session_id:session.id,data,pagination:{offset,order:'oldest',limit:50,returned:data.length},...overrides});
 };
 return {session,offsets};
}
const rows=async db=>(await db.prepare('SELECT * FROM orbit_activity_messages WHERE owner_id=? ORDER BY id').bind('owner').all()).results;

test('ID-less transcript pages keep repeated identical turns and overlap/retry does not duplicate them',()=>fixture(async db=>{
 const messages=Array.from({length:108},(_,i)=>({role:i%2?'assistant':'user',content:'동일한 메시지',timestamp:1}));
 const {session,offsets}=upstream(messages);
 for(let n=0;n<3;n++)await syncActivity(db,'owner',env);
 assert.deepEqual(offsets,[0,47,94]);assert.equal((await rows(db)).length,108);
 const before=(await rows(db)).map(m=>m.id);
 session.last_active=2;await syncActivity(db,'owner',env);
 assert.deepEqual((await rows(db)).map(m=>m.id),before);
 messages.push({role:'tool',content:'실행 근거',tool_name:'delegate_task',timestamp:2});session.last_active=3;session.message_count++;
 await syncActivity(db,'owner',env);
 assert.equal((await rows(db)).length,109);assert.equal((await activityStatus(db,'owner')).quarantined,0);
 assert.equal((await rows(db)).find(m=>m.content==='실행 근거').role,'tool');
}));

test('missing and native IDs remain distinct, and content edits update the same positional record',()=>fixture(async db=>{
 const messages=[{id:0,role:'user',content:'첫 메시지',timestamp:1},{id:null,role:'assistant',content:'수정 전',timestamp:2},{id:'orbit-position:000000000001',role:'tool',content:'별도 원본 ID',timestamp:3}];
 const {session}=upstream(messages);await syncActivity(db,'owner',env);assert.equal((await rows(db)).length,3);
 const record=(await listActivity(db,'owner')).items[0];await classifyActivity(db,'owner',record.id,null,'finance');
 messages[1].content='수정 후';session.last_active++;
 await syncActivity(db,'owner',env);const result=await activityDetail(db,'owner',record.id);
 assert.equal(result.messages.length,3);assert.ok(!result.messages.some(m=>m.content==='수정 전'));
 assert.equal(result.record.category,'finance');assert.equal(result.record.manual,1);
}));

test('upstream restoring native IDs replaces positional copies without duplicate messages',()=>fixture(async db=>{
 const messages=[{role:'user',content:'요청',timestamp:1},{role:'assistant',content:'응답',timestamp:2}];
 const {session}=upstream(messages);await syncActivity(db,'owner',env);
 messages[0].id=10;messages[1].id=11;session.last_active++;
 await syncActivity(db,'owner',env);assert.deepEqual((await rows(db)).map(m=>m.id),['10','11']);
}));

test('developer prompts and hidden compaction state never import content or tool arguments',()=>fixture(async db=>{
 upstream([{role:'developer',content:'PRIVATE PROMPT',tool_calls:[{secret:'PRIVATE TOOL'}]},
  {role:'assistant',display_kind:'hidden',content:'PRIVATE CARRIER',reasoning_content:'PRIVATE REASONING',tool_calls:[{input:'PRIVATE ARGUMENT'}]},
  {role:'tool',content:'actual result',tool_name:'delegate_task'}]);
 await syncActivity(db,'owner',env);const data=await rows(db);
 assert.equal(data.length,3);assert.deepEqual(data.map(m=>m.role),['developer','assistant','tool']);
 assert.ok(!JSON.stringify(data).includes('PRIVATE'));assert.equal(data[2].content,'actual result');
}));

test('legacy missing-ID quarantine retries immediately after parser upgrade',()=>fixture(async db=>{
 const {session}=upstream([{id:1,role:'user',content:'처음'}]);await syncActivity(db,'owner',env);
 const stored=await db.prepare('SELECT state_json FROM orbit_activity_sync WHERE owner_id=?').bind('owner').first(),state=JSON.parse(stored.state_json);
 delete state.messageVersion;state.offset=40;state.quarantine=[{id:session.id,signature:JSON.stringify([session.last_active,session.message_count,session.ended_at,session.title]),reason:'메시지 식별자를 확인하지 못했습니다.',retryAt:Date.now()+900000}];
 await db.prepare('DELETE FROM orbit_activity_sessions WHERE owner_id=?').bind('owner').run();
 await db.prepare('DELETE FROM orbit_activity_messages WHERE owner_id=?').bind('owner').run();
 await db.prepare('UPDATE orbit_activity_sync SET state_json=? WHERE owner_id=?').bind(JSON.stringify(state),'owner').run();
 upstream([{role:'assistant',content:'ID 없이 제공된 실제 응답'}]);await syncActivity(db,'owner',env);
 assert.equal((await rows(db)).length,1);assert.equal((await activityStatus(db,'owner')).quarantined,0);
}));

test('Hermes session metadata carriers are stored hidden instead of failing the whole source',()=>fixture(async db=>{
 upstream([{id:1,role:'user',content:'요청'},{id:2,role:'session_meta',content:null},{id:3,role:'assistant',content:'응답'}]);
 await syncActivity(db,'owner',env);const data=await rows(db);
 assert.deepEqual(data.map(m=>m.role),['user','session_meta','assistant']);
 assert.equal(data[1].content,'[시스템 메시지 제외]');
 assert.equal((await activityStatus(db,'owner')).quarantined,0);
}));

test('bad roles stay quarantined rather than being relabeled as user or assistant',()=>fixture(async db=>{
 upstream([{id:1,role:'unexpected',content:'untrusted'}]);
 await assert.rejects(()=>syncActivity(db,'owner',env),e=>e.code==='HERMES_FORMAT'&&/역할/.test(e.message));
 assert.equal((await rows(db)).length,0);assert.equal((await activityStatus(db,'owner')).quarantined,1);
}));

test('quarantine reasons are grouped so the blocking upstream shape is visible',()=>fixture(async db=>{
 upstream([{id:1,role:'unexpected',content:'untrusted'}]);
 await assert.rejects(()=>syncActivity(db,'owner',env),e=>e.code==='HERMES_FORMAT');
 const blocked=await activityStatus(db,'owner');
 assert.equal(blocked.quarantined,1);
 assert.deepEqual(blocked.quarantineReasons,[{reason:'Hermes 메시지 역할을 확인하지 못했습니다.',count:1}]);
 upstream([{id:2,role:'user',content:'다음 수집'}]);await syncActivity(db,'owner',env);
 assert.match((await activityStatus(db,'owner')).lastError,/가장 많은 사유: Hermes 메시지 역할을 확인하지 못했습니다\. \(1건\)/);
}));

test('wrong pagination and oversized pages cannot assign incorrect positional identities',()=>fixture(async db=>{
 upstream([{role:'user',content:'wrong page'}],{pagination:{offset:10,order:'latest',returned:1}});
 await assert.rejects(()=>syncActivity(db,'owner',env),e=>e.code==='HERMES_FORMAT');assert.equal((await rows(db)).length,0);
 upstream([],{data:Array.from({length:51},()=>({role:'user',content:'over limit'}))});
 await db.prepare('DELETE FROM orbit_activity_sync WHERE owner_id=?').bind('owner').run();
 await assert.rejects(()=>syncActivity(db,'owner',env),e=>e.code==='HERMES_FORMAT');assert.equal((await rows(db)).length,0);
}));

test('duplicate or malformed native IDs fail before advancing the cursor or overwriting a message',()=>fixture(async db=>{
 upstream([{id:1,role:'user',content:'first'},{id:'1',role:'assistant',content:'second'}]);
 await assert.rejects(()=>syncActivity(db,'owner',env),e=>e.code==='HERMES_FORMAT'&&/중복/.test(e.message));
 assert.equal((await rows(db)).length,0);
 upstream([{id:{value:1},role:'user',content:'invalid ID'}]);await db.prepare('DELETE FROM orbit_activity_sync WHERE owner_id=?').bind('owner').run();
 await assert.rejects(()=>syncActivity(db,'owner',env),e=>e.code==='HERMES_FORMAT'&&/식별자/.test(e.message));assert.equal((await rows(db)).length,0);
}));
