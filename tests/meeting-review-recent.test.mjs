import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace} from '../db/repository.ts';
import {advanceMeetingReviews,meetingReviewDetail,requestMeetingReview} from '../lib/orbit/meetings/review-runtime.ts';
import {importRecording} from '../lib/orbit/meetings/store.ts';
import {addDays,todayInZone} from '../lib/orbit/dates.ts';

// Only meetings recorded in the last 30 days are summarized automatically; older ones wait for an
// explicit request, so a bulk Plaud backfill cannot flood the AI quota or the notification inbox.
const owner='recent-owner',env={OPENAI_API_KEY:'fixture-only',ORBIT_CHAT_MODEL:'gpt-5.6-luna'};
const today=todayInZone('Asia/Seoul');
const record=(id,started)=>({id,title:'녹음 '+id,started,duration:10,transcript:'회의 원문 '+id,summary:'',pending:false});
async function noteOf(db,externalId){return (await readWorkspace(db,owner)).data.notes.find(n=>n.source?.externalId===externalId)}
async function review(db,noteId){return db.prepare('SELECT status,manual FROM orbit_meeting_reviews WHERE owner_id=? AND note_id=? ORDER BY revision DESC LIMIT 1').bind(owner,noteId).first()}
async function drain(db){for(let i=0;i<6;i++)await advanceMeetingReviews(db,owner,env)}
async function fixture(fn){const db=createDatabase(),real=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('no model call in this test')};try{await fn(db)}finally{globalThis.fetch=real;db.close()}}

test('an imported meeting older than 30 days is deferred, a recent one is started',()=>fixture(async db=>{
 await importRecording(db,owner,record('old','2026-05-12T01:00:00Z'));
 await importRecording(db,owner,record('new',addDays(today,-3)+'T01:00:00Z'));
 await drain(db);
 const old=await noteOf(db,'old'),recent=await noteOf(db,'new');
 assert.equal((await review(db,old.id)).status,'deferred');
 assert.notEqual((await review(db,recent.id)).status,'deferred');
 assert.equal((await meetingReviewDetail(db,owner,old.id)).status,'deferred');
}));

test('old meetings already waiting on the AI limit are deferred instead of resumed',()=>fixture(async db=>{
 await importRecording(db,owner,record('old','2026-06-09T01:00:00Z'));
 const old=await noteOf(db,'old');
 await db.prepare("UPDATE orbit_meeting_reviews SET status='waiting_quota' WHERE owner_id=? AND note_id=?").bind(owner,old.id).run();
 await drain(db);
 assert.equal((await review(db,old.id)).status,'deferred');
}));

test('asking for an old meeting summary runs it regardless of its date',()=>fixture(async db=>{
 await importRecording(db,owner,record('old','2026-05-12T01:00:00Z'));
 await drain(db);
 const old=await noteOf(db,'old');
 assert.equal((await review(db,old.id)).status,'deferred');
 await requestMeetingReview(db,owner,old.id,true);
 await drain(db);
 const row=await review(db,old.id);
 assert.equal(row.manual,1);assert.notEqual(row.status,'deferred');
}));

test('an old meeting with no review yet shows as deferred, not as running',()=>fixture(async db=>{
 await importRecording(db,owner,record('old','2026-04-06T01:00:00Z'));
 const old=await noteOf(db,'old');
 await db.prepare('DELETE FROM orbit_meeting_reviews WHERE owner_id=?').bind(owner).run();
 assert.equal((await meetingReviewDetail(db,owner,old.id)).status,'deferred');
}));

test('a deferred review whose earlier turn failed on the AI limit shows as deferred, without that error',()=>fixture(async db=>{
 await importRecording(db,owner,record('old','2026-05-12T01:00:00Z'));
 const old=await noteOf(db,'old');
 const row=await db.prepare('SELECT turn_id,conversation_id FROM orbit_meeting_reviews WHERE owner_id=? AND note_id=?').bind(owner,old.id).first();
 const now=new Date().toISOString();
 await db.prepare("INSERT INTO orbit_agent_turns(owner_id,id,conversation_id,input,status,response_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
  .bind(owner,row.turn_id,row.conversation_id,'회의록 요약','failed',JSON.stringify({error:'Codex provider quota exhausted (429)'}),now,now).run();
 await db.prepare("UPDATE orbit_meeting_reviews SET status='waiting_quota',error='Codex provider quota exhausted (429)' WHERE owner_id=? AND note_id=?").bind(owner,old.id).run();
 await drain(db);
 const detail=await meetingReviewDetail(db,owner,old.id);
 assert.equal(detail.status,'deferred');assert.equal(detail.error,'');
}));

// D1 is asynchronous: every statement is a network round trip, so workers interleave between them.
function interleaving(db){
 const tick=()=>new Promise(r=>setTimeout(r,1));
 const statement=s=>new Proxy(s,{get(t,k){if(k==='bind')return(...a)=>statement(t.bind(...a));if(['first','run','all'].includes(k))return async(...a)=>{await tick();return t[k](...a)};const v=t[k];return typeof v==='function'?v.bind(t):v}});
 return new Proxy(db,{get(t,k){if(k==='prepare')return(...a)=>statement(t.prepare(...a));if(k==='batch')return async(list)=>{await tick();return t.batch(list)};const v=t[k];return typeof v==='function'?v.bind(t):v}});
}
test('concurrent workers start at most one meeting review at a time',()=>fixture(async db=>{
 for(const id of ['a','b','c'])await importRecording(db,owner,record(id,addDays(today,-2)+'T01:00:00Z'));
 const shared=interleaving(db);
 // As in production: each request asks for its own meeting (POST /api/meetings/review per note).
 const ids=(await readWorkspace(db,owner)).data.notes.map(n=>n.id);
 await Promise.all(ids.map(id=>advanceMeetingReviews(shared,owner,env,id)));
 const {n}=await db.prepare("SELECT count(*) AS n FROM orbit_meeting_reviews WHERE owner_id=? AND status='running'").bind(owner).first();
 assert.equal(n,1);
}));

test('a running slot left without a turn (crashed worker) is released after ten minutes',()=>fixture(async db=>{
 for(const id of ['a','b'])await importRecording(db,owner,record(id,addDays(today,-2)+'T01:00:00Z'));
 const [stale]=(await db.prepare('SELECT note_id FROM orbit_meeting_reviews WHERE owner_id=?').bind(owner).all()).results;
 await db.prepare("UPDATE orbit_meeting_reviews SET status='running',updated_at=? WHERE owner_id=? AND note_id=?").bind(new Date(Date.now()-11*60000).toISOString(),owner,stale.note_id).run();
 await advanceMeetingReviews(db,owner,env);
 const running=(await db.prepare("SELECT r.note_id,t.id AS turn FROM orbit_meeting_reviews r LEFT JOIN orbit_agent_turns t ON t.owner_id=r.owner_id AND t.id=r.turn_id WHERE r.owner_id=? AND r.status='running'").bind(owner).all()).results;
 assert.equal(running.length,1);assert.ok(running[0].turn,'the running review has a real turn, the queue is not stuck');
}));
