import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,readNote,writeCommand} from '../db/repository.ts';
import {advanceMeetingReviews,meetingReviewDetail,requestMeetingReview} from '../lib/orbit/meetings/review-runtime.ts';
import {advanceAgent} from '../lib/orbit/agent/runner.ts';
import {decide,decisionSchema} from '../lib/orbit/agent/decisions.ts';
import {meetingProposals} from '../lib/orbit/meetings/review.ts';
import {mergeMeetingProposals,mergedNotePrefix} from '../lib/orbit/meetings/merge.ts';
import {mergeAndApply} from '../lib/orbit/meetings/merge-apply.ts';
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
const line=n=>({line:n,quote:source.split('\n')[n-1]});
const task=(id,title,extra={})=>({title,reason:title+' 근거',source:line(1),action:{type:'task.upsert',autoAssign:false,task:{id,title,projectId:'oda',status:'todo',duration:30,due:'2099-01-05',impact:3,focus:false,definition:title+' 완료 기준',...extra}}});
const event=(id,title,start,end,date='2099-01-06')=>({title,reason:title+' 근거',source:line(3),action:{type:'event.upsert',event:{id,title,projectId:'oda',date,start,end,kind:'meeting'}}});
test('merging two task cards combines content into one pending card; the other is marked merged and cannot be reused',async()=>{const db=createDatabase();try{
 await seed(db);const d=await analyze(db,[task('a','물류사 단가 문의'),task('b','물류사 공급 조건 확인',{duration:45,due:'2099-01-03',impact:4}),event('e1','웰스토리 미팅',600,660),event('e2','추가 물류사 소개',660,720)]);
 assert.equal(d.status,'completed',d.error);assert.equal(d.actions.length,4);
 const [a,b,e1,e2]=d.actions;
 await mergeMeetingProposals(db,owner,note.id,a.id,b.id);
 let detail=await meetingReviewDetail(db,owner,note.id);const merged=detail.actions.find(x=>x.id===a.id),gone=detail.actions.find(x=>x.id===b.id);
 assert.equal(merged.state,'pending');assert.equal(merged.title,'물류사 단가 문의');assert.equal(merged.action.task.duration,75);assert.equal(merged.action.task.due,'2099-01-03');assert.equal(merged.action.task.impact,4);
 assert.match(merged.action.task.definition,/물류사 단가 문의 완료 기준/);assert.match(merged.action.task.definition,/\[통합\] 물류사 공급 조건 확인: 물류사 공급 조건 확인 완료 기준/);assert.match(merged.reason,/\[통합된 결재안\] 물류사 공급 조건 확인/);assert.match(merged.reason,/물류사 공급 조건 확인 근거/);
 assert.equal(gone.state,'rejected');assert.equal(gone.note,mergedNotePrefix+'물류사 단가 문의');assert.equal(detail.actions.filter(x=>x.state==='pending').length,3);
 await assert.rejects(()=>mergeMeetingProposals(db,owner,note.id,a.id,b.id),/통합할 회의 결재안이 아닙니다/);
 await assert.rejects(()=>mergeMeetingProposals(db,owner,note.id,a.id,e1.id),/같은 종류/);
 await assert.rejects(()=>mergeMeetingProposals(db,owner,note.id,a.id,a.id),/서로 다른 결재안/);
 await assert.rejects(()=>mergeMeetingProposals(db,owner,'other-note',e1.id,e2.id),/통합할 회의 결재안이 아닙니다/);
 await mergeMeetingProposals(db,owner,note.id,e1.id,e2.id);
 detail=await meetingReviewDetail(db,owner,note.id);const meeting=detail.actions.find(x=>x.id===e1.id);
 assert.equal(meeting.action.event.start,600);assert.equal(meeting.action.event.end,720);assert.match(meeting.action.event.description,/\[통합\] 추가 물류사 소개/);assert.equal(detail.actions.find(x=>x.id===e2.id).state,'rejected');
 await decide(db,owner,{id:a.id,decision:'approve'},env);await decide(db,owner,{id:e1.id,decision:'approve'},env);
 const saved=(await readWorkspace(db,owner)).data;assert.equal(saved.tasks.length,1);assert.equal(saved.tasks[0].duration,75);assert.match(saved.tasks[0].definition,/\[통합\]/);assert.equal(saved.events.length,1);assert.equal(saved.events[0].end,720);
 await assert.rejects(()=>decide(db,owner,{id:b.id,decision:'approve'},env),/이미 적용|상태/);assert.equal((await readWorkspace(db,owner)).data.tasks.length,1);
}finally{db.close()}});
test('merging resolves a missing due date from the other card and keeps it required when both lack one',async()=>{const db=createDatabase();try{
 await seed(db);const undated=(id,title)=>{const t=task(id,title);delete t.action.task.due;return t};
 const d=await analyze(db,[undated('a','단가 문의'),task('b','공급 조건',{due:'2099-01-09'}),undated('c','샘플 요청'),undated('x','견적 정리')]);
 assert.equal(d.status,'completed',d.error);const [a,b,c,x]=d.actions;assert.equal(a.guard.meeting.needsDue,true);
 await mergeMeetingProposals(db,owner,note.id,a.id,b.id);
 let merged=(await meetingReviewDetail(db,owner,note.id)).actions.find(i=>i.id===a.id);
 assert.equal(merged.guard.meeting.needsDue,false);assert.equal(merged.action.task.due,'2099-01-09');assert.doesNotMatch(merged.reason,/\[마감일 확인 필요\]/);assert.match(merged.reason,/2099-01-09/);
 await decide(db,owner,{id:a.id,decision:'approve'},env);assert.equal((await readWorkspace(db,owner)).data.tasks[0].due,'2099-01-09');
 await mergeMeetingProposals(db,owner,note.id,c.id,x.id);merged=(await meetingReviewDetail(db,owner,note.id)).actions.find(i=>i.id===c.id);
 assert.equal(merged.guard.meeting.needsDue,true);await assert.rejects(()=>decide(db,owner,{id:c.id,decision:'approve'},env),/마감일을 지정/);
}finally{db.close()}});
test('a merged card cannot be applied after the source changes',async()=>{const db=createDatabase();try{
 await seed(db);const d=await analyze(db,[task('a','단가 문의'),task('b','공급 조건')]);const [a,b]=d.actions;await mergeMeetingProposals(db,owner,note.id,a.id,b.id);
 const meta=await readNote(db,owner,note.id);await cmd(db,{type:'note.upsert',note:{...meta,body:source+'\n추가 논의'},expectedNoteRevision:meta.revision});
 await assert.rejects(()=>decide(db,owner,{id:a.id,decision:'approve'},env),/회의록 또는 연결 대상/);await assert.rejects(()=>mergeMeetingProposals(db,owner,note.id,a.id,b.id));assert.equal((await readWorkspace(db,owner)).data.tasks.length,0);
}finally{db.close()}});
test('a task or event card can be merged into an already registered record; approval updates that record',async()=>{const db=createDatabase();try{
 await seed(db);
 await cmd(db,{type:'task.upsert',autoAssign:false,task:{id:'existing-task',title:'기존 물류 정리',projectId:'oda',status:'todo',duration:20,due:'2099-01-10',impact:2,focus:false,definition:'기존 기준'}});
 await cmd(db,{type:'task.upsert',autoAssign:false,task:{id:'done-task',title:'끝난 일',projectId:'oda',status:'done',duration:20,due:'2099-01-10',impact:2,focus:false,definition:''}});
 await cmd(db,{type:'event.upsert',event:{id:'existing-event',title:'기존 미팅',projectId:'oda',date:'2099-01-06',start:540,end:600,kind:'meeting'}});
 const undated=task('a','물류사 단가 문의');delete undated.action.task.due;
 const d=await analyze(db,[undated,event('e1','웰스토리 미팅',600,660),task('b','공급 조건 확인')]);assert.equal(d.status,'completed',d.error);
 assert.ok(d.candidates.tasks.some(t=>t.id==='existing-task'));assert.ok(!d.candidates.tasks.some(t=>t.id==='done-task'));assert.ok(d.candidates.events.some(e=>e.id==='existing-event'));
 const [a,e1,b]=d.actions;assert.equal(a.guard.meeting.needsDue,true);
 await assert.rejects(()=>mergeMeetingProposals(db,owner,note.id,a.id,{kind:'task',id:'missing'}),/찾을 수 없/);
 await assert.rejects(()=>mergeMeetingProposals(db,owner,note.id,a.id,{kind:'event',id:'existing-event'}),/같은 종류/);
 await assert.rejects(()=>mergeMeetingProposals(db,owner,note.id,b.id,{kind:'task',id:'done-task'}),/완료된 할 일/);
 await mergeMeetingProposals(db,owner,note.id,a.id,{kind:'task',id:'existing-task'});
 let detail=await meetingReviewDetail(db,owner,note.id);const merged=detail.actions.find(x=>x.id===a.id);
 assert.equal(merged.state,'pending');assert.equal(merged.title,'기존 물류 정리');assert.equal(merged.action.type,'task.upsert');assert.equal(merged.action.task.id,'existing-task');
 assert.equal(merged.action.task.duration,50);assert.equal(merged.action.task.impact,3);assert.equal(merged.action.task.due,'2099-01-10');assert.equal(merged.guard.meeting.needsDue,false);
 assert.match(merged.action.task.definition,/^기존 기준\n\[통합\] 물류사 단가 문의: 물류사 단가 문의 완료 기준/);assert.match(merged.reason,/\[기존 할 일에 통합\] 기존 물류 정리/);assert.doesNotMatch(merged.reason,/\[마감일 확인 필요\]/);
 assert.equal(detail.actions.filter(x=>x.state==='pending').length,3);
 await mergeMeetingProposals(db,owner,note.id,e1.id,{kind:'event',id:'existing-event'});
 detail=await meetingReviewDetail(db,owner,note.id);const meeting=detail.actions.find(x=>x.id===e1.id);
 assert.equal(meeting.action.event.id,'existing-event');assert.equal(meeting.action.event.start,540);assert.equal(meeting.action.event.end,660);assert.match(meeting.action.event.description,/\[통합\] 웰스토리 미팅/);
 await decide(db,owner,{id:a.id,decision:'approve'},env);await decide(db,owner,{id:e1.id,decision:'approve'},env);
 const saved=(await readWorkspace(db,owner)).data,task1=saved.tasks.find(t=>t.id==='existing-task');
 assert.equal(saved.tasks.length,2);assert.equal(task1.duration,50);assert.match(task1.definition,/\[통합\]/);assert.equal(task1.noteId,note.id);assert.equal(task1.status,'todo');
 assert.equal(saved.events.length,1);assert.equal(saved.events[0].id,'existing-event');assert.equal(saved.events[0].end,660);
}finally{db.close()}});
test('a card merged into an existing task cannot apply after that task changes',async()=>{const db=createDatabase();try{
 await seed(db);await cmd(db,{type:'task.upsert',autoAssign:false,task:{id:'existing-task',title:'기존 물류 정리',projectId:'oda',status:'todo',duration:20,due:'2099-01-10',impact:2,focus:false,definition:'기존 기준'}});
 const d=await analyze(db,[task('a','물류사 단가 문의')]);await mergeMeetingProposals(db,owner,note.id,d.actions[0].id,{kind:'task',id:'existing-task'});
 const current=(await readWorkspace(db,owner)).data.tasks.find(t=>t.id==='existing-task');await cmd(db,{type:'task.upsert',autoAssign:false,task:{...current,definition:'다른 사람이 바꿈'}});
 await assert.rejects(()=>decide(db,owner,{id:d.actions[0].id,decision:'approve'},env),/회의록 또는 연결 대상/);assert.equal((await readWorkspace(db,owner)).data.tasks[0].definition,'다른 사람이 바꿈');
}finally{db.close()}});

test('approving with edits registers the chosen name, colour and project without touching the rest of the proposal',async()=>{const db=createDatabase();try{
 await seed(db);const d=await analyze(db,proposals());
 const project=d.actions.find(a=>a.action.type==='project.upsert'),task=d.actions.find(a=>a.action.type==='task.upsert');
 await decide(db,owner,{id:project.id,decision:'approve',overrides:{title:'바다 해외 파일럿',color:'#f83a22'}},env);
 await decide(db,owner,{id:task.id,decision:'approve',overrides:{title:'파일럿 제안서 작성',color:'#7ae7bf',projectId:'oda'}},env);
 const saved=(await readWorkspace(db,owner)).data;
 const renamed=saved.projects.find(p=>p.name==='바다 해외 파일럿');
 assert.ok(renamed,'renamed project registered');
 assert.equal(renamed.color,'#f83a22');
 assert.equal(renamed.goal,proposals()[0].action.project.goal,'untouched fields keep the proposed value');
 assert.equal(saved.tasks.length,1);
 assert.equal(saved.tasks[0].title,'파일럿 제안서 작성');
 assert.equal(saved.tasks[0].color,'#7ae7bf');
 assert.equal(saved.tasks[0].projectId,'oda','the chosen project wins over the proposed one');
 assert.equal(saved.tasks[0].noteId,note.id,'the meeting citation survives the edit');
}finally{db.close()}});

test('an edit with a name or colour the proposal cannot carry registers nothing',async()=>{const db=createDatabase();try{
 await seed(db);const d=await analyze(db,proposals());
 const project=d.actions.find(a=>a.action.type==='project.upsert'),task=d.actions.find(a=>a.action.type==='task.upsert');
 // A blank name cannot register a project, and the edit must leave the card approvable.
 await assert.rejects(()=>decide(db,owner,{id:project.id,decision:'approve',overrides:{title:'   '}},env),e=>e.code==='ACTION_INVALID');
 assert.equal((await readWorkspace(db,owner)).data.projects.length,1,'a refused edit registers nothing');
 await decide(db,owner,{id:project.id,decision:'approve',overrides:{title:'바다 파일럿'}},env);
 assert.ok((await readWorkspace(db,owner)).data.projects.find(p=>p.name==='바다 파일럿'),'the card is still approvable after a refusal');
 // A task or event colour has to be one of the palette entries the app can render.
 await assert.rejects(()=>decide(db,owner,{id:task.id,decision:'approve',overrides:{color:'#123456'}},env),e=>e.code==='ACTION_INVALID');
 assert.equal((await readWorkspace(db,owner)).data.tasks.length,0,'a refused colour registers nothing');
}finally{db.close()}});

test('a model-supplied task noteId/noteCitation is replaced by the server citation instead of failing validation',async()=>{const db=createDatabase();try{await seed(db);const data=(await readWorkspace(db,owner)).data;const task=proposals()[1];
 // Hermes echoed the citation without a revision (and once as a plain string); the server owns both fields.
 for(const noteCitation of [{line:2,quote:source.split('\n')[1]},'바다 프로젝트 제안서']){
  const [out]=await meetingProposals(note,data,[{...task,action:{...task.action,task:{...task.action.task,projectId:'oda',noteId:'plaud:forged',noteCitation}}}],[]);
  assert.equal(out.action.task.noteId,note.id);assert.deepEqual(out.action.task.noteCitation,{revision:1,line:2,quote:source.split('\n')[1]});
 }}finally{db.close()}});

test('an extra key inside a proposal source (evidenceId) does not reject the whole meeting answer',async()=>{const db=createDatabase();try{await seed(db);
 const items=proposals().map(p=>({...p,source:{...p.source,evidenceId:'note:meeting-source:v1'}}));
 const d=await analyze(db,items);assert.equal(d.status,'completed',d.error);assert.ok(d.actions.length>0);
}finally{db.close()}});

test('a meeting repair after two unreadable answers still sends the meeting source, not only the correction',async()=>{const db=createDatabase();try{await seed(db);
 await advanceMeetingReviews(db,owner,env);
 const row=await db.prepare('SELECT turn_id FROM orbit_meeting_reviews WHERE owner_id=? AND note_id=? ORDER BY revision DESC LIMIT 1').bind(owner,note.id).first();
 const bodies=[],real=globalThis.fetch;
 const reply=text=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
 globalThis.fetch=async(url,init)=>{bodies.push(init.body);return reply(bodies.length<3?'{"kind":"final","text":"요약","proposals":[{"title":"x","reason":"y","action":{},"extra":1}]}':JSON.stringify({kind:'final',text:'핵심 요약\n바다 프로젝트.',proposals:proposals()}))};
 try{let d;for(let i=0;i<8;i++){await advanceAgent(db,owner,row.turn_id,env).catch(()=>{});d=await meetingReviewDetail(db,owner,note.id);if(['completed','failed'].includes(d.status))break}
  assert.ok(bodies.length>=3,'expected a repair request, got '+bodies.length);
  // The second answer is the one that fails; its correction must say why, and the repair must carry the source.
  assert.match(bodies[1],/proposals\.0/);
  assert.ok(bodies[2].includes('바다 프로젝트의 제안서'),'repair request lost the meeting source');
  assert.equal(d.status,'completed',d.error);assert.ok(d.actions.length>0);
 }finally{globalThis.fetch=real}
}finally{db.close()}});

test('the approval request accepts a non-UUID project id chosen in 수정 후 등록 (the route parses decisionSchema first)',()=>{
 // Project ids are any 1..100 char id (e.g. imported "classified-1ck5h0s"), not only UUIDs.
 const request={id:crypto.randomUUID(),decision:'approve',overrides:{title:'올드페리도넛-제주점 오픈비용 추정',color:'#5484ed',projectId:'classified-1ck5h0s'}};
 const parsed=decisionSchema.safeParse(request);
 assert.ok(parsed.success,JSON.stringify(parsed.error?.issues));
 assert.equal(parsed.data.overrides.projectId,'classified-1ck5h0s');
 assert.equal(decisionSchema.safeParse({...request,overrides:{projectId:''}}).success,false);
 assert.equal(decisionSchema.safeParse({...request,overrides:{projectId:'x'.repeat(101)}}).success,false);
});

test('merging a card into a registered record applies it at once and closes the card; merging two proposals still waits',async()=>{const db=createDatabase();try{
 await seed(db);
 await cmd(db,{type:'task.upsert',autoAssign:false,task:{id:'existing-task',title:'기존 물류 정리',projectId:'oda',status:'todo',duration:20,due:'2099-01-10',impact:2,focus:false,definition:'기존 기준'}});
 const undated=task('a','물류사 단가 문의');delete undated.action.task.due;
 const d=await analyze(db,[undated,task('b','공급 조건 확인'),task('c','공급 단가 비교')]);assert.equal(d.status,'completed',d.error);
 const [a,b,c]=d.actions;
 const applied=await mergeAndApply(db,owner,note.id,a.id,{kind:'task',id:'existing-task'},env);
 assert.equal(applied.applied,true);
 const detail=await meetingReviewDetail(db,owner,note.id);
 assert.equal(detail.actions.find(x=>x.id===a.id).state,'approved','the merged card is closed');
 const saved=(await readWorkspace(db,owner)).data.tasks.find(t=>t.id==='existing-task');
 assert.equal(saved.duration,50);assert.match(saved.definition,/\[통합\] 물류사 단가 문의/);
 const combined=await mergeAndApply(db,owner,note.id,b.id,{kind:'proposal',id:c.id},env);
 assert.equal(combined.applied,false,'two proposals combined into one card still wait for approval');
 assert.equal((await meetingReviewDetail(db,owner,note.id)).actions.find(x=>x.id===b.id).state,'pending');
}finally{db.close()}});

test('a meeting answer that lists a task before the new project it belongs to still completes',async()=>{const db=createDatabase();try{
 await seed(db);
 const [newProject,draftTask,draftEvent]=proposals();
 const d=await analyze(db,[draftTask,draftEvent,newProject]);
 assert.equal(d.status,'completed',d.error);
 const titles=d.actions.map(a=>a.title);
 assert.ok(titles.indexOf('바다 프로젝트 등록')<titles.indexOf('제안서 작성'),'the new project card comes before the cards that need it');
 const projectCard=d.actions.find(a=>a.title==='바다 프로젝트 등록');
 assert.equal(d.actions.find(a=>a.title==='제안서 작성').action.task.projectId,projectCard.action.project.id,'the task points at the proposed project');
}finally{db.close()}});
