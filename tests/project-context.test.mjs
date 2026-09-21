import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {linkEventProject,projectTimeline} from '../lib/orbit/project-context.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {chatContextData} from '../lib/orbit/agent/chat-context.ts';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
const project=(id,name,keywords=[])=>({id,name,keywords,color:'#5558e8',symbol:'O',goal:'연결 검증',due:'2026-10-01',priority:3});
const data=()=>({...emptyWorkspace(),projects:[project('ofd','올드페리도넛',['OFD','OLD FERRY']),project('oda','ODA PIZZA') ]});
const event={id:'meeting-1',title:'올드페리 미팅',date:'2026-09-25',start:600,end:660,kind:'meeting'};
test('short Korean brand names link schedules with a visible reason',()=>{
 const e=linkEventProject(event,data());assert.equal(e.projectId,'ofd');assert.ok(e.projectLink.matched.includes('올드페리'));
 assert.equal(linkEventProject(e,data()),e);
});
test('new internal schedule saves the project, not only its preview',()=>{
 const result=applyAction(data(),{type:'event.upsert',event},new Date('2026-09-20T00:00Z'));
 assert.equal(result.events[0].projectId,'ofd');
});
test('ambiguous brand names remain unassigned',()=>{
 const d=data();d.projects.push(project('ofd-other','올드페리 신규매장'));
 assert.equal(linkEventProject(event,d).projectId,undefined);
});
test('generic meeting title never inherits a guessed project',()=>{
 assert.equal(linkEventProject({...event,title:'회의 자료 검토'},data()).projectId,undefined);
});
test('manual project selection and explicit personal schedules survive reads',()=>{
 assert.equal(linkEventProject({...event,projectId:'oda'},data()).projectId,'oda');
 assert.equal(linkEventProject({...event,projectAutoLink:false},data()).projectId,undefined);
});
test('follow-up task schedule inherits the actual source project',()=>{
 const d=data();d.tasks.push({id:'task-1',title:'견적 검토',projectId:'ofd'});
 const e=linkEventProject({...event,title:'견적 검토',taskId:'task-1'},d);
 assert.equal(e.projectId,'ofd');assert.equal(e.projectLink.method,'related');
});
test('Google mirror inherits original project even with no identifying text',()=>{
 const d=data();d.events=[{...event,title:'후속 미팅',projectId:'ofd'}];
 assert.equal(linkEventProject({...event,id:'google:1',title:'후속 미팅',google:{orbitEventId:event.id}},d).projectId,'ofd');
});
test('unlinked Google calendar cache is joined without changing external source',async()=>{
 const db=createDatabase();try{
 await writeCommand(db,'owner',{operationId:crypto.randomUUID(),expectedRevision:0,action:{type:'project.upsert',project:data().projects[0]}});
 const snapshot=await readWorkspace(db,'owner');
 const cached=JSON.stringify([{...event,id:'google:g1:2026-09-25',google:{calendarId:'primary',eventId:'g1'}}]);
 await db.prepare('INSERT INTO orbit_calendar_cache(owner_id,events_json,time_zone,range_start,range_end,updated_at) VALUES(?,?,?,?,?,?)').bind('owner',cached,snapshot.data.preferences.timeZone,'2026-09-20','2026-10-01',new Date().toISOString()).run();
 assert.equal((await readWorkspace(db,'owner')).data.events[0].projectId,'ofd');
 assert.equal((await db.prepare('SELECT events_json FROM orbit_calendar_cache WHERE owner_id=?').bind('owner').first()).events_json,cached);
 assert.equal((await readWorkspace(db,'other')).data.events.length,0);
 }finally{db.close()}
});
test('chat resolves aliases and includes linked notes',()=>{
 const d=data();d.notes=[{id:'n1',title:'회의록',tags:[],projectId:'ofd'},{id:'n2',title:'문서',tags:[],projectId:'oda'}];
 const focused=chatContextData(d,'올드페리 진행 상황');assert.equal(focused.projects[0].id,'ofd');assert.deepEqual(focused.notes.map(n=>n.id),['n1']);
 assert.equal(chatContextData(d,'전체 프로젝트 비교'),d);
});
test('timeline combines records without mixing projects',()=>{
 const d=data();d.events=[linkEventProject(event,d)];d.notes=[{id:'n',title:'회의록',kind:'meeting',projectId:'ofd',updated:'2026-09-26'}];
 d.tasks=[{id:'t',title:'견적 확정',projectId:'ofd',due:'2026-09-28',noteId:'n'},{id:'t2',projectId:'oda',due:'2026-09-29'}];
 assert.deepEqual(projectTimeline(d,'ofd').map(x=>x.kind),['task','note','event']);
});
