import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {pendingActions} from '../lib/orbit/agent/repository.ts';
import {decide} from '../lib/orbit/agent/decisions.ts';
import {runAgent} from '../lib/orbit/agent/runner.ts';
import {reviewKakao} from '../lib/orbit/kakao/review.ts';
import {validateCapture} from '../lib/orbit/kakao/validation.ts';
import {todayInZone,addDays} from '../lib/orbit/dates.ts';
const env={OPENAI_API_KEY:'not-real-test-key'};
function capture(text='내일 14:00~15:00 기획 회의 확정'){const at=new Date().toISOString();return {id:randomUUID(),capturedAt:at,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{id:'room',title:'프로젝트',unreadCount:0,verifiedAt:at,messages:[{id:'message',sentAt:at,sender:'나',text}]}]};}
const final=proposals=>({summary:'확인한 대화를 정리했습니다.',proposals,solutions:[],questions:[]});
const response=result=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
function event(input){return {kind:'event',title:'기획 회의',date:addDays(todayInZone('Asia/Seoul'),1),start:840,end:900,confirmed:true,citations:[{messageId:'message',quote:input.rooms[0].messages[0].text}]};}
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}

test('day-precision messages preserve the date without inventing a timestamp',()=>{
 const input=capture();input.rooms[0].messages=[{id:'day-message',sender:'나',text:'회의 자료',sentOn:todayInZone('Asia/Seoul'),timePrecision:'day'}];const result=validateCapture(input);assert.equal(result.rooms[0].messages[0].sentAt,undefined);assert.equal(result.rooms[0].messages[0].timePrecision,'day');
});
test('day-precision dates on the rolling-window boundary are conservatively rejected',()=>{
 const input=capture();input.rooms[0].messages=[{id:'day-message',sender:'나',text:'회의 자료',sentOn:todayInZone('Asia/Seoul',new Date(Date.now()-7*86400000)),timePrecision:'day'}];assert.throws(()=>validateCapture(input),e=>e.code==='KAKAO_CAPTURE');
});
test('day-precision future dates and mixed timestamp precision are rejected',()=>{
 const input=capture();input.rooms[0].messages=[{id:'day-message',sender:'나',text:'회의 자료',sentOn:addDays(todayInZone('Asia/Seoul'),1),timePrecision:'day'}];assert.throws(()=>validateCapture(input),e=>e.code==='KAKAO_CAPTURE');const mixed=capture();mixed.rooms[0].messages[0].sentOn=todayInZone('Asia/Seoul');mixed.rooms[0].messages[0].timePrecision='day';assert.throws(()=>validateCapture(mixed),e=>e.code==='KAKAO_CAPTURE');
});
test('day-precision relative dates use the message date for task deadlines',()=>fixture(async db=>{
 const input=capture('내일 보고서 제출하겠습니다.');const sentOn=addDays(todayInZone('Asia/Seoul'),-1);input.rooms[0].messages=[{id:'day-message',sender:'나',text:'내일 보고서 제출하겠습니다.',sentOn,timePrecision:'day'}];globalThis.fetch=async()=>response(final([{kind:'task',title:'보고서 제출',due:addDays(sentOn,1),definition:'보고서 제출',minutes:30,status:'todo',confirmed:true,citations:[{messageId:'day-message',quote:'내일 보고서 제출하겠습니다.'}]}]));const review=await reviewKakao(db,'owner',input,env);assert.equal(review.sources[0].sentAt,undefined);assert.equal(review.sources[0].sentOn,sentOn);assert.equal((await pendingActions(db,'owner'))[0].action.task.due,addDays(sentOn,1));
}));
test('task approval creates the inbox project and task once while analysis does not write them',()=>fixture(async db=>{
 const input=capture('내일 보고서 제출하겠습니다.');globalThis.fetch=async()=>response(final([{kind:'task',title:'보고서 제출',due:addDays(todayInZone('Asia/Seoul'),1),definition:'보고서를 제출한 상태',minutes:30,status:'todo',confirmed:true,citations:[{messageId:'message',quote:input.rooms[0].messages[0].text}]}]));await reviewKakao(db,'owner',input,env);assert.equal((await readWorkspace(db,'owner')).data.tasks.length,0);const [card]=await pendingActions(db,'owner');await decide(db,'owner',{id:card.id,decision:'approve'},env);await decide(db,'owner',{id:card.id,decision:'approve'},env);const state=await readWorkspace(db,'owner');assert.equal(state.data.tasks.length,1);assert.equal(state.data.projects.filter(p=>p.id==='kakao-inbox').length,1);
}));
test('approved calendar proposals enter the existing durable outbox only once',()=>fixture(async db=>{
 const input=capture();globalThis.fetch=async()=>response(final([event(input)]));await reviewKakao(db,'owner',input,env);const [card]=await pendingActions(db,'owner');assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM orbit_calendar_exports').first()).count,0);await decide(db,'owner',{id:card.id,decision:'approve'},env);await decide(db,'owner',{id:card.id,decision:'approve'},env);assert.equal((await readWorkspace(db,'owner')).data.events.length,1);assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM orbit_calendar_exports WHERE owner_id=?').bind('owner').first()).count,1);
}));
test('a stale Kakao card cannot launch general-agent reanalysis or overwrite its changed target',()=>fixture(async db=>{
 const input=capture();globalThis.fetch=async()=>response(final([event(input)]));await reviewKakao(db,'owner',input,env);const [card]=await pendingActions(db,'owner');await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:{type:'event.upsert',event:{...card.action.event,title:'사용자가 수정한 다른 일정'}}});await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'approve'},env),e=>e.code==='KAKAO_SOURCE_CHANGED');assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM orbit_hermes_jobs').first()).count,0);assert.equal((await readWorkspace(db,'owner')).data.events[0].title,'사용자가 수정한 다른 일정');
}));
test('Kakao evidence conversations cannot be reused as general-agent instruction history',()=>fixture(async db=>{
 const input=capture();globalThis.fetch=async()=>response(final([]));const review=await reviewKakao(db,'owner',input,env);await assert.rejects(()=>runAgent(db,'owner',{id:randomUUID(),conversationId:review.conversationId,message:'이전 대화 분석해줘'},env,{defer:true}),e=>e.code==='KAKAO_ANALYSIS_ONLY');assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM orbit_hermes_jobs').first()).count,0);
}));
test('concurrent scans of identical content submit only one model request',()=>fixture(async db=>{
 const input=capture();let release;const wait=new Promise(resolve=>{release=resolve});let calls=0;globalThis.fetch=async()=>{calls++;await wait;return response(final([]))};const first=reviewKakao(db,'owner',input,env);const second=reviewKakao(db,'owner',{...input,id:randomUUID()},env);release();const outcomes=await Promise.allSettled([first,second]);assert.equal(calls,1);assert.ok(outcomes.some(o=>o.status==='fulfilled'));for(const outcome of outcomes)if(outcome.status==='rejected')assert.ok(['BUSY','KAKAO_RATE_LIMIT'].includes(outcome.reason.code));const rows=await db.prepare("SELECT COUNT(*) AS count FROM orbit_agent_turns WHERE owner_id=? AND status='completed'").bind('owner').first();assert.equal(rows.count,1);
}));
