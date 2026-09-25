import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {advanceMeetingReviews,meetingReviewDetail} from '../lib/orbit/meetings/review-runtime.ts';
import {advanceAgent} from '../lib/orbit/agent/runner.ts';
import {decide,decisionSchema} from '../lib/orbit/agent/decisions.ts';
import {mergedNotePrefix} from '../lib/orbit/meetings/merge.ts';
import {linkMeetingProject} from '../lib/orbit/meetings/link-project.ts';

// "수정 후 등록" can send a meeting's new-project card to an existing project, or
// register a task/event under a project created from a typed name.
const owner='link-owner',env={OPENAI_API_KEY:'fixture-only',ORBIT_CHAT_MODEL:'gpt-5.6-luna'};
const project={id:'oda',name:'ODA',goal:'매장 운영',due:'2099-01-31',color:'#4455cc',symbol:'O',priority:3,status:'active'};
const source='새로운 바다 프로젝트를 시작한다.\n바다 프로젝트의 제안서를 2099년 1월 5일까지 작성한다.\n바다 프로젝트 회의는 2099년 1월 6일 오전 10시부터 11시까지다.\nODA 목표를 가맹 운영 매뉴얼 완성으로 수정한다.';
const note={id:'meeting-source',title:'사업 실행 회의',kind:'meeting',projectId:'oda',summary:'원본 요약',body:source,tags:[],updated:'2099-01-01'};
const line=n=>({line:n,quote:source.split('\n')[n-1]});
const proposals=()=>[
 {title:'바다 프로젝트 등록',reason:'새 사업 결정',source:line(1),action:{type:'project.upsert',project:{...project,id:'new-sea',name:'바다',goal:'제안서 완성'}}},
 {title:'제안서 작성',reason:'합의한 후속 업무',source:line(2),action:{type:'task.upsert',autoAssign:false,task:{id:'draft-task',title:'바다 제안서 작성',projectId:'new-sea',status:'todo',duration:30,due:'2099-01-05',impact:3,focus:false,definition:'제안서 초안 완성'}}},
 {title:'바다 회의 등록',reason:'일시 확정',source:line(3),action:{type:'event.upsert',event:{id:'draft-event',title:'바다 프로젝트 회의',projectId:'new-sea',date:'2099-01-06',start:600,end:660,kind:'meeting'}}},
 {title:'ODA 목표 수정',reason:'가맹 매뉴얼 목표 변경',source:line(4),action:{type:'project.upsert',project:{...project,goal:'가맹 운영 매뉴얼 완성'}}},
];
async function cmd(db,action){return writeCommand(db,owner,{operationId:crypto.randomUUID(),expectedRevision:(await readWorkspace(db,owner)).revision,action})}
async function analyze(db,before=async()=>{}){
 await cmd(db,{type:'project.upsert',project});await cmd(db,{type:'note.upsert',note});await before();
 await advanceMeetingReviews(db,owner,env);
 const row=await db.prepare('SELECT turn_id FROM orbit_meeting_reviews WHERE owner_id=? AND note_id=? ORDER BY revision DESC LIMIT 1').bind(owner,note.id).first();
 const real=globalThis.fetch;globalThis.fetch=async()=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({kind:'final',text:'핵심 요약\n바다 프로젝트 시작.',proposals:proposals()})}]}]});
 try{for(let i=0;i<5;i++){await advanceAgent(db,owner,row.turn_id,env);const d=await meetingReviewDetail(db,owner,note.id);if(d.status==='completed')return d}throw new Error('analysis did not complete')}finally{globalThis.fetch=real}
}
const card=(d,type,match=()=>true)=>d.actions.find(a=>a.action.type===type&&match(a.action));

test('a new-project card linked to an existing project closes, and its tasks and events register under that project',async()=>{const db=createDatabase();try{
 const d=await analyze(db),sea=card(d,'project.upsert',a=>a.project.name==='바다');
 const after=await linkMeetingProject(db,owner,note.id,sea.id,'oda');
 const closed=after.actions.find(a=>a.id===sea.id);
 assert.equal(closed.state,'rejected');
 assert.ok(closed.note.startsWith(mergedNotePrefix)&&closed.note.includes('ODA'),'the card says where it went');
 const task=card(after,'task.upsert'),event=card(after,'event.upsert');
 assert.equal(task.action.task.projectId,'oda');
 assert.equal(event.action.event.projectId,'oda');
 // The owner chose ODA; approving the meeting's own ODA update first must not block the linked cards.
 await decide(db,owner,{id:card(after,'project.upsert',a=>a.project.id==='oda').id,decision:'approve'},env);
 await decide(db,owner,{id:task.id,decision:'approve'},env);
 await decide(db,owner,{id:event.id,decision:'approve'},env);
 const saved=(await readWorkspace(db,owner)).data;
 assert.deepEqual(saved.projects.map(p=>p.id),['oda'],'no new project is created');
 assert.equal(saved.projects[0].goal,'가맹 운영 매뉴얼 완성','only the meeting\'s own ODA card changed the goal; linking did not');
 assert.equal(saved.projects[0].due,'2099-01-31');
 assert.equal(saved.tasks[0].projectId,'oda');
 assert.equal(saved.events.find(e=>e.title==='바다 프로젝트 회의').projectId,'oda');
}finally{db.close()}});

test('linking refuses a missing project, an update of an existing project, and a card already handled',async()=>{const db=createDatabase();try{
 const d=await analyze(db),sea=card(d,'project.upsert',a=>a.project.name==='바다'),oda=card(d,'project.upsert',a=>a.project.id==='oda');
 await assert.rejects(()=>linkMeetingProject(db,owner,note.id,sea.id,'missing'),e=>e.code==='NOT_FOUND');
 await assert.rejects(()=>linkMeetingProject(db,owner,note.id,oda.id,'oda'),e=>e.code==='MEETING_LINK');
 await linkMeetingProject(db,owner,note.id,sea.id,'oda');
 await assert.rejects(()=>linkMeetingProject(db,owner,note.id,sea.id,'oda'),e=>e.code==='CONFLICT');
}finally{db.close()}});

test('a task or event approved with a new project name creates that project and registers under it',async()=>{const db=createDatabase();try{
 const d=await analyze(db),task=card(d,'task.upsert'),event=card(d,'event.upsert');
 await decide(db,owner,{id:task.id,decision:'approve',overrides:{newProject:{name:'해외 파일럿'}}},env);
 let saved=(await readWorkspace(db,owner)).data;
 const created=saved.projects.find(p=>p.name==='해외 파일럿');
 assert.ok(created,'the typed project is created');
 assert.equal(created.status??'active','active');
 assert.equal(saved.tasks[0].projectId,created.id);
 // Typing a name that already exists links to it instead of creating a duplicate.
 await decide(db,owner,{id:event.id,decision:'approve',overrides:{newProject:{name:'해외  파일럿!'}}},env);
 saved=(await readWorkspace(db,owner)).data;
 assert.equal(saved.projects.filter(p=>p.name.includes('파일럿')).length,1);
 assert.equal(saved.events.find(e=>e.title==='바다 프로젝트 회의').projectId,created.id);
}finally{db.close()}});

test('a new project name cannot be combined with a chosen project, and is only for tasks and events',async()=>{const db=createDatabase();try{
 const request={id:crypto.randomUUID(),decision:'approve'};
 assert.equal(decisionSchema.safeParse({...request,overrides:{newProject:{name:'새 프로젝트'}}}).success,true);
 assert.equal(decisionSchema.safeParse({...request,overrides:{newProject:{name:'새 프로젝트'},projectId:'oda'}}).success,false);
 assert.equal(decisionSchema.safeParse({...request,overrides:{newProject:{name:'  '}}}).success,false);
 const d=await analyze(db),sea=card(d,'project.upsert',a=>a.project.name==='바다');
 await assert.rejects(()=>decide(db,owner,{id:sea.id,decision:'approve',overrides:{newProject:{name:'다른 이름'}}},env),e=>e.code==='ACTION_NOT_EDITABLE');
}finally{db.close()}});

test('an edited event that overlaps another is registered with the edits after the overlap is confirmed',async()=>{const db=createDatabase();try{
 const d=await analyze(db,()=>cmd(db,{type:'event.upsert',event:{id:'existing',title:'기존 일정',date:'2099-01-06',start:600,end:660,kind:'meeting',projectId:'oda'}}));
 const event=card(d,'event.upsert'),overrides={title:'바다 킥오프',newProject:{name:'바다 파일럿'}};
 let confirmation;
 await assert.rejects(()=>decide(db,owner,{id:event.id,decision:'approve',overrides},env),e=>{confirmation=e.details?.overlapConfirmation;return e.code==='CALENDAR_OVERLAP'});
 await decide(db,owner,{id:event.id,decision:'approve',overrides,overlapConfirmation:confirmation},env);
 const saved=(await readWorkspace(db,owner)).data,created=saved.events.find(e=>e.title==='바다 킥오프');
 assert.ok(created,'the edited title is registered');
 assert.equal(saved.projects.find(p=>p.id===created.projectId)?.name,'바다 파일럿');
}finally{db.close()}});

test('a link that cannot move every card of the meeting changes nothing',async()=>{const db=createDatabase();try{
 const d=await analyze(db),sea=card(d,'project.upsert',a=>a.project.name==='바다'),task=card(d,'task.upsert');
 // Another screen edits the task card between the link's read and its write.
 const racing=Object.create(db);
 racing.batch=async statements=>{await db.prepare("UPDATE orbit_agent_actions SET guard_json=guard_json||' ' WHERE owner_id=? AND id=?").bind(owner,task.id).run();return db.batch(statements)};
 await assert.rejects(()=>linkMeetingProject(racing,owner,note.id,sea.id,'oda'),e=>e.code==='CONFLICT');
 const after=await meetingReviewDetail(db,owner,note.id);
 assert.equal(after.actions.find(a=>a.id===sea.id).state,'pending','the project card stays open');
 assert.equal(card(after,'event.upsert').action.event.projectId,sea.action.project.id,'no card was moved');
}finally{db.close()}});

test('a project created while approving takes its due date from the card, not from the approval day',async()=>{const db=createDatabase();try{
 const d=await analyze(db),task=card(d,'task.upsert');
 await db.prepare('UPDATE orbit_agent_actions SET created_at=? WHERE owner_id=? AND id=?').bind('2099-01-01T03:00:00.000Z',owner,task.id).run();
 await decide(db,owner,{id:task.id,decision:'approve',overrides:{newProject:{name:'해외 파일럿'}}},env);
 assert.equal((await readWorkspace(db,owner)).data.projects.find(p=>p.name==='해외 파일럿').due,'2099-04-01');
}finally{db.close()}});
