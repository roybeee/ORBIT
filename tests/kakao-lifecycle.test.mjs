import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace} from '../db/repository.ts';
import {pendingActions} from '../lib/orbit/agent/repository.ts';
import {decide} from '../lib/orbit/agent/decisions.ts';
import {todayInZone,addDays} from '../lib/orbit/dates.ts';
import {reviewKakao} from '../lib/orbit/kakao/review.ts';
import {deleteKakaoReview} from '../lib/orbit/kakao/privacy.ts';
import {assertGroundedDate} from '../lib/orbit/kakao/evidence.ts';
import {buildKakaoActions} from '../lib/orbit/kakao/staging.ts';
const env={OPENAI_API_KEY:'test-model-key-not-real'};
function capture(){const at=new Date().toISOString();return {id:randomUUID(),capturedAt:at,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{id:'room-1',title:'프로젝트',unreadCount:0,verifiedAt:at,messages:[{id:'message-1',sender:'나',sentAt:at,text:'내일 14:00~15:00 회의 확정'}]}]};}
const final=(proposals=[])=>({summary:'확인한 대화를 정리했습니다.',proposals,solutions:[],questions:[]});
const response=result=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}
test('ordinary chat input stores no captured conversation bodies',()=>fixture(async db=>{
 const input=capture();globalThis.fetch=async()=>response(final());await reviewKakao(db,'owner',input,env);const row=await db.prepare('SELECT input FROM orbit_agent_turns WHERE owner_id=?').bind('owner').first();assert.doesNotMatch(row.input,/회의 확정|프로젝트|message-1/);assert.ok(Array.isArray(JSON.parse(row.input).messageHashes));
}));
test('incremental analysis only sends messages not completed in an earlier review',()=>fixture(async db=>{
 const input=capture();let payload;globalThis.fetch=async(url,options)=>{payload=JSON.parse(options.body);return response(final())};await reviewKakao(db,'owner',input,env);await db.prepare("UPDATE orbit_agent_turns SET created_at=? WHERE owner_id=?").bind(new Date(Date.now()-3000).toISOString(),'owner').run();const next=structuredClone(input);next.id=randomUUID();next.rooms[0].messages.push({...next.rooms[0].messages[0],id:'message-2',text:'새 자료를 검토해주세요.'});const review=await reviewKakao(db,'owner',next,env);assert.doesNotMatch(payload.input.at(-1).content,/회의 확정/);assert.match(payload.input.at(-1).content,/새 자료/);assert.equal(review.messageCount,1);
}));
test('a new scan composed only of already-reviewed messages requires no model request',()=>fixture(async db=>{
 const input=capture();input.rooms[0].messages.push({...input.rooms[0].messages[0],id:'message-2',text:'두 번째 메시지'});let calls=0;globalThis.fetch=async()=>{calls++;return response(final())};await reviewKakao(db,'owner',input,env);const next={...input,id:randomUUID(),rooms:[{...input.rooms[0],messages:[input.rooms[0].messages[1]]}]};const review=await reviewKakao(db,'owner',next,env);assert.equal(calls,1);assert.equal(review.replayed,true);
}));
test('bare morning-or-afternoon clock values are not treated as confirmed event times',()=>{
 const input=capture();input.rooms[0].messages[0].text='내일 3:00~4:00 회의 확정';assert.throws(()=>assertGroundedDate(input,[{messageId:'message-1',quote:input.rooms[0].messages[0].text}],addDays(todayInZone('Asia/Seoul'),1),180,240),e=>e.code==='KAKAO_EVIDENCE');
});
test('Korean conversation times are not staged into a workspace with another time zone',()=>fixture(async db=>{
 const input=capture(),snapshot=await readWorkspace(db,'owner');const proposal={kind:'event',title:'회의',date:addDays(todayInZone('Asia/Seoul'),1),start:840,end:900,confirmed:true,citations:[{messageId:'message-1',quote:input.rooms[0].messages[0].text}]};const result=await buildKakaoActions(input,final([proposal]),{...snapshot.data,preferences:{...snapshot.data.preferences,timeZone:'America/New_York'}},0,randomUUID(),[]);assert.equal(result.actions.length,0);assert.match(result.questions.join(' '),/시간대/);
}));
test('deleting one review removes its sources and pending proposals but preserves approved work',()=>fixture(async db=>{
 const input=capture();globalThis.fetch=async()=>response(final([{kind:'event',title:'회의',date:addDays(todayInZone('Asia/Seoul'),1),start:840,end:900,confirmed:true,citations:[{messageId:'message-1',quote:input.rooms[0].messages[0].text}]}]));await reviewKakao(db,'owner',input,env);const [card]=await pendingActions(db,'owner');await decide(db,'owner',{id:card.id,decision:'approve'},env);await assert.rejects(()=>deleteKakaoReview(db,'other',{id:input.id}),e=>e.code==='NOT_FOUND');await deleteKakaoReview(db,'owner',{id:input.id});const turn=await db.prepare('SELECT input,response_json FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind('owner',input.id).first();assert.equal(JSON.parse(turn.input).deleted,true);assert.equal(turn.response_json,'{}');assert.equal((await readWorkspace(db,'owner')).data.events.length,1);const storedCard=await db.prepare('SELECT reason FROM orbit_agent_actions WHERE owner_id=? AND id=?').bind('owner',card.id).first();assert.doesNotMatch(storedCard.reason,/회의 확정/);
}));
test('deleting a review removes unapproved cards and refuses running or applying work',()=>fixture(async db=>{
 const input=capture();globalThis.fetch=async()=>response(final([{kind:'event',title:'회의',date:addDays(todayInZone('Asia/Seoul'),1),start:840,end:900,confirmed:true,citations:[{messageId:'message-1',quote:input.rooms[0].messages[0].text}]}]));await reviewKakao(db,'owner',input,env);const [card]=await pendingActions(db,'owner');await db.prepare("UPDATE orbit_agent_actions SET state='applying' WHERE owner_id=? AND id=?").bind('owner',card.id).run();await assert.rejects(()=>deleteKakaoReview(db,'owner',{id:input.id}),e=>e.code==='BUSY');await db.prepare("UPDATE orbit_agent_actions SET state='pending' WHERE owner_id=? AND id=?").bind('owner',card.id).run();await db.prepare("UPDATE orbit_agent_turns SET status='running' WHERE owner_id=? AND id=?").bind('owner',input.id).run();await assert.rejects(()=>deleteKakaoReview(db,'owner',{id:input.id}),e=>e.code==='BUSY');await db.prepare("UPDATE orbit_agent_turns SET status='completed' WHERE owner_id=? AND id=?").bind('owner',input.id).run();await deleteKakaoReview(db,'owner',{id:input.id});assert.equal((await pendingActions(db,'owner')).length,0);
}));
