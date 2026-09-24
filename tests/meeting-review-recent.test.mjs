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
