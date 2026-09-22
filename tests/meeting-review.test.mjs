import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,readNote,writeCommand} from '../db/repository.ts';
import {advanceMeetingReviews,meetingReviewDetail,requestMeetingReview} from '../lib/orbit/meetings/review-runtime.ts';
import {advanceAgent} from '../lib/orbit/agent/runner.ts';
import {decide} from '../lib/orbit/agent/decisions.ts';
import {meetingProposals} from '../lib/orbit/meetings/review.ts';
import {importRecording} from '../lib/orbit/meetings/store.ts';
import {projectTimeline} from '../lib/orbit/project-context.ts';
const owner='meeting-owner',env={OPENAI_API_KEY:'fixture-only',ORBIT_CHAT_MODEL:'gpt-5.6-luna'};
const project={id:'oda',name:'ODA',goal:'매장 운영',due:'2099-01-31',color:'#4455cc',symbol:'O',priority:3,status:'active'};
const source='새로운 바다 프로젝트를 시작한다.\n바다 프로젝트의 제안서를 2099년 1월 5일까지 작성한다.\n바다 프로젝트 회의는 2099년 1월 6일 오전 10시부터 11시까지다.\nODA 목표를 가맹 운영 매뉴얼 완성으로 수정한다.';
const note={id:'meeting-source',title:'사업 실행 회의',kind:'meeting',projectId:'oda',summary:'원본 요약',body:source,tags:[],updated:'2099-01-01'};
async function cmd(db,action){return writeCommand(db,owner,{operationId:crypto.randomUUID(),expectedRevision:(await readWorkspace(db,owner)).revision,action})}
async function seed(db){await cmd(db,{type:'project.upsert',project});await cmd(db,{type:'note.upsert',note})}
const proposals=()=>[
 {title:'바다 프로젝트 등록',reason:'새 사업 결정',source:{line:1,quote:source.split('\n')[0]},action:{type:'project.upsert',project:{...project,id:'new-sea',name:'바다',goal:'제안서 완성'}}},
 {title:'제안서 작성',reason:'합의한 후속 업무 · 예상 30분 제안',source:{line:2,quote:source.split('\n')[1]},action:{type:'task.upsert',autoAssign:false,task:{id:'draft-task',title:'바다 제안서 작성',projectId:'new-sea',status:'todo',duration:30,due:'2099-01-05',impact:3,focus:false,definition:'제안서 초안 완성'}}},
 {title:'바다 회의 등록',reason:'일시 확정',source:{line:3,quote:source.split('\n')[2]},action:{type:'event.upsert',event:{id:'draft-event',title:'바다 프로젝트 회의',projectId:'new-sea',date:'2099-01-06',start:600,end:660,kind:'meeting'}}},
 {title:'ODA 목표 수정',reason:'가맹 매뉴얼 목표 변경',source:{line:4,quote:source.split('\n')[3]},action:{type:'project.upsert',project:{...project,goal:'가맹 운영 매뉴얼 완성'}}}
];
async function analyze(db,items=proposals(),inspect=()=>{}){
 await advanceMeetingReviews(db,owner,env);
 const row=await db.prepare('SELECT turn_id FROM orbit_meeting_reviews WHERE owner_id=? AND note_id=? ORDER BY revision DESC LIMIT 1').bind(owner,note.id).first();
 const real=globalThis.fetch;globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');inspect(JSON.parse(init.body));return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({kind:'final',text:'핵심 요약\n바다 프로젝트 시작과 ODA 목표 변경.\n결정 사항\n제안서와 회의 일시 확정.\n확인할 내용\n각 제안을 승인하면 등록됩니다.',proposals:items})}]}]})};
 try{for(let i=0;i<5;i++){await advanceAgent(db,owner,row.turn_id,env);const d=await meetingReviewDetail(db,owner,note.id);if(['completed','failed'].includes(d.status))return d}throw new Error('analysis did not complete')}finally{globalThis.fetch=real}
}
test('save queues once; full-source summary and four action kinds require approval and use normal project/calendar paths',async()=>{const db=createDatabase();try{
 await seed(db);const before=await readWorkspace(db,owner);const d=await analyze(db,proposals(),request=>{assert.match(JSON.stringify(request.input),/4: ODA 목표/)});
 assert.equal(d.status,'completed',d.error);assert.equal(d.actions.length,4);assert.match(d.summary,/핵심 요약/);assert.equal((await readWorkspace(db,owner)).revision,before.revision);assert.equal((await readNote(db,owner,note.id)).body,source);
 const act=d.actions;await decide(db,owner,{id:act[0].id,decision:'approve'},env);
 await decide(db,owner,{id:act[1].id,decision:'approve'},env);await decide(db,owner,{id:act[1].id,decision:'approve'},env);
 await decide(db,owner,{id:act[2].id,decision:'approve'},env);await decide(db,owner,{id:act[3].id,decision:'approve'},env);
 const saved=(await readWorkspace(db,owner)).data,sea=saved.projects.find(p=>p.name==='바다');assert.ok(sea);assert.equal(saved.tasks.length,1);assert.equal(saved.tasks[0].projectId,sea.id);assert.equal(saved.tasks[0].noteId,note.id);assert.equal(saved.tasks[0].noteCitation.line,2);assert.equal(saved.events[0].projectId,sea.id);assert.equal(saved.projects.find(p=>p.id==='oda').goal,'가맹 운영 매뉴얼 완성');assert.equal(projectTimeline(saved,sea.id).length,2);
 const delivery=await db.prepare('SELECT event_id FROM orbit_calendar_exports WHERE owner_id=?').bind(owner).all();assert.ok(delivery.results.some(r=>r.event_id==='task-due:'+saved.tasks[0].id));assert.ok(delivery.results.some(r=>r.event_id===saved.events[0].id));
 await advanceMeetingReviews(db,owner,env);assert.equal((await meetingReviewDetail(db,owner,note.id)).actions.length,4);await assert.rejects(()=>meetingReviewDetail(db,'other',note.id));
}finally{db.close()}});
test('reject/defer never register; changed source blocks old approvals; reanalysis replaces only pending cards',async()=>{const db=createDatabase();try{
 await seed(db);const d=await analyze(db);assert.equal(d.status,'completed',d.error);
 await decide(db,owner,{id:d.actions[0].id,decision:'reject'},env);await decide(db,owner,{id:d.actions[3].id,decision:'defer',reason:'검토 필요',revisitDate:'2099-02-01'},env);
 assert.equal((await readWorkspace(db,owner)).data.tasks.length,0);
 await requestMeetingReview(db,owner,note.id,true);assert.equal((await meetingReviewDetail(db,owner,note.id)).status,'queued');const old=await db.prepare('SELECT state,note FROM orbit_agent_actions WHERE owner_id=? AND id=?').bind(owner,d.actions[1].id).first();assert.equal(old.state,'rejected');assert.equal(old.note,'새 분석으로 대체');
 const meta=await readNote(db,owner,note.id);await cmd(db,{type:'note.upsert',note:{...meta,body:source+'\n추가 논의'},expectedNoteRevision:meta.revision});await assert.rejects(()=>decide(db,owner,{id:d.actions[1].id,decision:'approve'},env));
}finally{db.close()}});
test('source changes after analysis cannot apply a stale project update',async()=>{const db=createDatabase();try{await seed(db);const d=await analyze(db);const meta=await readNote(db,owner,note.id);await cmd(db,{type:'note.upsert',note:{...meta,body:'기존 합의를 철회함'},expectedNoteRevision:meta.revision});await assert.rejects(()=>decide(db,owner,{id:d.actions[3].id,decision:'approve'},env),/회의록 또는 연결 대상/);assert.equal((await readWorkspace(db,owner)).data.projects[0].goal,'매장 운영')}finally{db.close()}});
test('Plaud import queues text without waiting for Plaud summary, idempotently; long split sources each get a review',async()=>{const db=createDatabase();try{const record={id:'plaud-test',title:'녹음',started:'2026-09-22',duration:10,transcript:'원문',summary:'',pending:true};await importRecording(db,owner,record);assert.equal((await db.prepare('SELECT count(*) AS n FROM orbit_meeting_reviews').first()).n,1);await importRecording(db,owner,{...record,transcript:'가'.repeat(190000),summary:'회의',pending:false});const n=(await db.prepare('SELECT count(*) AS n FROM orbit_meeting_reviews').first()).n;assert.equal(n,4);await importRecording(db,owner,{...record,transcript:'가'.repeat(190000),summary:'회의',pending:false});assert.equal((await db.prepare('SELECT count(*) AS n FROM orbit_meeting_reviews').first()).n,n)}finally{db.close()}});
test('forged evidence and external execution cannot become meeting approval cards',async()=>{const db=createDatabase();try{await seed(db);const data=(await readWorkspace(db,owner)).data;await assert.rejects(()=>meetingProposals(note,data,[{...proposals()[0],source:{line:1,quote:'없는 발언'}}],[]),/원문 근거/);await assert.rejects(()=>meetingProposals(note,data,[{...proposals()[0],action:{type:'agent.dispatch',title:'메일 전송',instruction:'메일 전송',projectId:null,taskIds:[]}}],[]),/일정·할 일·프로젝트/)}finally{db.close()}});
test('overlapping meeting requires explicit second confirmation',async()=>{const db=createDatabase();try{await seed(db);await cmd(db,{type:'event.upsert',event:{id:'existing',title:'기존 일정',date:'2099-01-06',start:600,end:660,kind:'meeting',projectId:'oda'}});const p=proposals()[2];p.action.event.projectId='oda';const d=await analyze(db,[p]);assert.equal(d.status,'completed',d.error);let confirmation;await assert.rejects(()=>decide(db,owner,{id:d.actions[0].id,decision:'approve'},env),e=>{confirmation=e.details?.overlapConfirmation;return e.code==='CALENDAR_OVERLAP'});assert.equal((await readWorkspace(db,owner)).data.events.length,1);await decide(db,owner,{id:d.actions[0].id,decision:'approve',overlapConfirmation:confirmation},env);assert.equal((await readWorkspace(db,owner)).data.events.length,2)}finally{db.close()}});
