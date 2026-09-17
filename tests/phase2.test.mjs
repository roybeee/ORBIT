import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand,searchNotes,readNote} from '../db/repository.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {calibrationEvidence,calibrationFactor} from '../lib/orbit/planner.ts';
import {backupArchive} from '../lib/orbit/backup-export.ts';
import {digest,previewRestore,restoreContent} from '../lib/orbit/backup.ts';
const date='2026-09-17',now=new Date(date+'T03:00:00Z');
const project={id:'p',name:'Project',color:'#123456',symbol:'P',goal:'Ship',due:date,priority:1};
const task={id:'t',title:'Review result',projectId:'p',status:'todo',duration:30,due:date,impact:3,focus:false,definition:'A verified result'};
const note={id:'n',title:'회의',kind:'meeting',projectId:'p',summary:'Summary',body:'매장 리뉴얼 결정을 기록합니다.',tags:['전략'],updated:date};
const decision={id:'d',title:'Launch decision',projectId:'p',choice:'Pilot first',rationale:'Measure demand',alternatives:'Launch everywhere',reviewDate:date,status:'active',outcome:'',noteId:'n',noteRevision:1,taskId:'t'};
async function fixture(fn){const db=createDatabase();try{await fn(db)}finally{db.close()}}
async function save(db,owner,action){const current=await readWorkspace(db,owner);return writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:current.revision,action},now)}
async function seed(db,owner='a'){await save(db,owner,{type:'project.upsert',project});await save(db,owner,{type:'task.upsert',task});await save(db,owner,{type:'note.upsert',note});await save(db,owner,{type:'decision.upsert',record:decision});}
const bucket={get:async()=>null};
async function archive(db,owner='a',b=bucket){const stream=await backupArchive(db,owner,b);const files=unzipSync(new Uint8Array(await new Response(stream).arrayBuffer()));return {files,...JSON.parse(strFromU8(files['workspace.json']))};}
test('decisions retain prior rationale, reject stale sources, and protect references',()=>fixture(async db=>{
 await seed(db);await save(db,'a',{type:'decision.upsert',record:{...decision,choice:'Revise pilot',rationale:'New evidence',status:'revised'}});
 const d=(await readWorkspace(db,'a')).data.decisions[0];assert.equal(d.history.length,2);assert.equal(d.history[0].rationale,'Measure demand');assert.equal(d.history[1].rationale,'New evidence');
 await assert.rejects(()=>save(db,'a',{type:'note.delete',id:'n'}));await assert.rejects(()=>save(db,'a',{type:'decision.upsert',record:{...decision,noteRevision:99}}));assert.equal((await readWorkspace(db,'b')).data.decisions,undefined);
}));
test('delegation requires received evidence before verification and never completes the linked task',()=>fixture(async db=>{
 await seed(db);const record={id:'dg',title:'Delegate review',projectId:'p',assignee:'담당자',deliverable:'검토 문서',due:date,checkDate:date,status:'requested',update:'요청함',evidence:'',taskId:'t'};
 await save(db,'a',{type:'delegation.upsert',record});await assert.rejects(()=>save(db,'a',{type:'delegation.upsert',record:{...record,status:'verified',evidence:'checked'}}));
 await save(db,'a',{type:'delegation.upsert',record:{...record,status:'delivered',evidence:'문서 링크'}});await save(db,'a',{type:'delegation.upsert',record:{...record,status:'verified',evidence:'문서 확인'}});
 const data=(await readWorkspace(db,'a')).data;assert.equal(data.delegations[0].history.length,3);assert.equal(data.tasks[0].status,'waiting');
}));
test('wiki searches stored full bodies with project/type/tag boundaries and snippets',()=>fixture(async db=>{
 await seed(db);const result=await searchNotes(db,'a',{kind:'wiki',query:'리뉴얼',offset:0,projectId:'p',tag:'전략',documentKind:'meeting'});assert.equal(result.items.length,1);assert.match(result.items[0].searchExcerpt,/리뉴얼/);
 assert.equal((await searchNotes(db,'b',{kind:'wiki',query:'리뉴얼',offset:0})).items.length,0);assert.equal((await searchNotes(db,'a',{kind:'wiki',query:'리뉴얼',offset:0,tag:'다른태그'})).items.length,0);
}));
test('displayed calibration matches planner and preserves estimate at outcome time',()=>{
 const data=emptyWorkspace();data.projects=[project];data.tasks=[task];const recorded=applyAction(data,{type:'task.record',id:'t',outcome:'done',actualMinutes:60},now).tasks[0];assert.equal(recorded.outcomeEstimateMinutes,30);
 const samples=Array.from({length:5},(_,i)=>({...recorded,id:'s'+i,duration:90,completedOn:date}));const e=calibrationEvidence(samples,task,date);assert.equal(e.factor,2);assert.equal(e.samples[0].estimate,30);assert.equal(e.tier,'같은 프로젝트·인지 유형');assert.equal(e.factor,calibrationFactor(samples,task,date));assert.equal(calibrationEvidence(samples.slice(0,4),task,date).sufficient,false);
});
test('full archive includes history and attachment bytes; selective restore closes dependencies and keeps unrelated data',()=>fixture(async db=>{
 await seed(db);await save(db,'a',{type:'note.upsert',note:{...note,body:'두 번째 리뉴얼 원문'}});
 const bytes=new TextEncoder().encode('private attachment');await db.prepare('INSERT INTO orbit_attachments(owner_id,id,name,mime,size,state,object_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind('a','file1','proof.txt','text/plain',bytes.length,'ready','a/file1',date,date).run();
 const b={get:async key=>key==='a/file1'?{body:new Blob([bytes]).stream(),size:bytes.length}:null};const bundle=await archive(db,'a',b);
 assert.equal(strFromU8(bundle.files['files/file1/original']),'private attachment');assert.equal(bundle.payload.noteHistory.length,2);assert.equal(await digest(bundle.payload),bundle.checksum);
 await save(db,'b',{type:'project.upsert',project:{...project,id:'keep',name:'Keep me'}});
 const selection=[{category:'decisions',id:'d'}],before=await readWorkspace(db,'b'),plan=previewRestore(before.data,bundle.payload,selection);assert.equal(plan.inserted.length,4);
 const op=randomUUID(),result=await restoreContent(db,'b',bundle.payload,selection,before.revision,op,bundle.checksum);assert.equal(result.verified,true);assert.equal(result.snapshot.data.projects.length,2);assert.equal((await readNote(db,'b','n')).body,'두 번째 리뉴얼 원문');assert.equal((await readNote(db,'b','n',1)).body,note.body);
 const replay=await restoreContent(db,'b',bundle.payload,selection,before.revision,op,bundle.checksum);assert.equal(replay.replayed,true);assert.equal((await readWorkspace(db,'b')).revision,result.snapshot.revision);
 assert.equal(await db.prepare('SELECT id FROM orbit_attachments WHERE owner_id=?').bind('b').first(),null);
}));
test('restore rejects altered digest, active execution, and stale revisions atomically',()=>fixture(async db=>{
 await seed(db);const bundle=await archive(db);const selection=[{category:'notes',id:'n'}];
 await assert.rejects(()=>restoreContent(db,'b',bundle.payload,selection,0,randomUUID(),'0'.repeat(64)));
 await db.prepare('INSERT INTO orbit_agent_turns(owner_id,id,input,status,response_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind('b','turn','active','running','{}',date,date).run();
 await assert.rejects(()=>restoreContent(db,'b',bundle.payload,selection,0,randomUUID(),bundle.checksum));assert.equal((await readWorkspace(db,'b')).revision,0);assert.equal(await db.prepare('SELECT note_id FROM orbit_note_revisions WHERE owner_id=?').bind('b').first(),null);
 await db.prepare('DELETE FROM orbit_agent_turns WHERE owner_id=?').bind('b').run();await assert.rejects(()=>restoreContent(db,'b',bundle.payload,selection,99,randomUUID(),bundle.checksum));
}));
test('backup fails rather than omit a missing original attachment',()=>fixture(async db=>{
 await seed(db);await db.prepare('INSERT INTO orbit_attachments(owner_id,id,name,mime,size,state,object_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind('a','missing','proof.txt','text/plain',3,'ready','missing',date,date).run();await assert.rejects(()=>archive(db));
}));
test('restore preview rejects missing current revision, invalid intervals and missing review details',()=>fixture(async db=>{
 await seed(db);const {payload}=await archive(db);const bad=structuredClone(payload);bad.data.notes[0].revision=2;bad.noteHistory[0].revision=1;assert.throws(()=>previewRestore(emptyWorkspace(),bad,[{category:'notes',id:'n'}]));
 const event=structuredClone(payload);event.data.events=[{id:'bad',title:'invalid',date,start:600,end:500,kind:'meeting'}];assert.throws(()=>previewRestore(emptyWorkspace(),event,[{category:'events',id:'bad'}]));
 const review=structuredClone(payload);review.data.reviews=[{id:'review',date,win:'win',block:'',energy:'normal',completedIds:[],updatedAt:now.toISOString(),hasDetail:true}];review.reviewDetails=[];assert.throws(()=>previewRestore(emptyWorkspace(),review,[{category:'reviews',id:'review'}]));
}));
