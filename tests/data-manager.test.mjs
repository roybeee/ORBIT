import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {writeCommand,readWorkspace,readNote,listNoteHistory,NoteNotFound,RevisionConflict} from '../db/repository.ts';
import {changeData,listDataTrash,dataStorageOverview} from '../db/data-manager.ts';
import {DomainError} from '../lib/orbit/reducer.ts';
import {restoreContent,digest} from '../lib/orbit/backup.ts';
const now=new Date('2026-09-17T10:00:00Z');
const project={id:'p',name:'검증 프로젝트',color:'#5558e8',symbol:'O',goal:'결과물',due:'2026-09-30',priority:3};
const note={id:'n',title:'검증 문서',kind:'wiki',projectId:'p',summary:'요약',body:'원본 본문',tags:[],updated:'2026-09-17'};
const task={id:'t',title:'검증 할 일',projectId:'p',status:'todo',duration:30,due:'2026-09-20',impact:3,focus:false,definition:'완료 기준'};
const cmd=(revision,action)=>({operationId:randomUUID(),expectedRevision:revision,action});
const dataCmd=(revision,action,values)=>({operationId:randomUUID(),expectedRevision:revision,action,...values});
async function seed(db,owner='a'){let state=await writeCommand(db,owner,cmd(0,{type:'project.upsert',project}),now);return writeCommand(db,owner,cmd(state.revision,{type:'note.upsert',note}),now);}
const selection=(...categories)=>categories.map(category=>({category,id:{projects:'p',notes:'n',tasks:'t'}[category]}));

test('trash preserves note history and original restore pointer; IDs cannot be silently reused',async()=>{
 const db=createDatabase();try{let state=await seed(db);state=await writeCommand(db,'a',cmd(state.revision,{type:'note.upsert',note:{...note,body:'두 번째 본문'}}),now);const before=state.data.notes[0];
 state=(await changeData(db,'a',dataCmd(state.revision,'trash',{selection:selection('notes')}),now)).snapshot;
 await assert.rejects(()=>readNote(db,'a','n'),NoteNotFound);const trash=await listDataTrash(db,'a');assert.equal(trash.total,1);assert.equal('record' in trash.items[0],false);
 await assert.rejects(()=>writeCommand(db,'a',cmd(state.revision,{type:'note.upsert',note}),now),DomainError);
 await assert.rejects(()=>writeCommand(db,'a',cmd(state.revision,{type:'note.delete',id:'n'}),now),DomainError);
 state=(await changeData(db,'a',dataCmd(state.revision,'restore',{trashIds:[trash.items[0].id]}),now)).snapshot;
 assert.deepEqual(state.data.notes[0],before);assert.equal((await readNote(db,'a','n')).body,'두 번째 본문');assert.equal((await listNoteHistory(db,'a','n')).items.length,2);assert.equal((await listDataTrash(db,'a')).total,0);
 }finally{db.close();}
});
test('linked records block partial deletion; grouped deletion and restore preserve links',async()=>{
 const db=createDatabase();try{let state=await seed(db);state=await writeCommand(db,'a',cmd(state.revision,{type:'task.upsert',task:{...task,noteId:'n'}}),now);
 await assert.rejects(()=>changeData(db,'a',dataCmd(state.revision,'trash',{selection:selection('projects')}),now),DomainError);
 assert.equal((await listDataTrash(db,'a')).total,0);assert.equal((await readWorkspace(db,'a')).revision,state.revision);
 state=(await changeData(db,'a',dataCmd(state.revision,'trash',{selection:selection('projects','notes','tasks')}),now)).snapshot;
 assert.equal(state.data.projects.length+state.data.tasks.length+state.data.notes.length,0);const trash=await listDataTrash(db,'a');
 await assert.rejects(()=>changeData(db,'a',dataCmd(state.revision,'restore',{trashIds:[trash.items.find(r=>r.category==='tasks').id]}),now),DomainError);
 state=(await changeData(db,'a',dataCmd(state.revision,'restore',{trashIds:trash.items.map(r=>r.id)}),now)).snapshot;
 assert.equal(state.data.tasks[0].projectId,'p');assert.equal(state.data.tasks[0].noteId,'n');assert.equal((await readNote(db,'a','n')).body,note.body);
 }finally{db.close();}
});
test('purge removes only selected owner note versions; other owners remain unchanged',async()=>{
 const db=createDatabase();try{let state=await seed(db);await seed(db,'b');state=(await changeData(db,'a',dataCmd(state.revision,'trash',{selection:selection('notes')}),now)).snapshot;const trash=await listDataTrash(db,'a');
 await assert.rejects(()=>changeData(db,'b',dataCmd(2,'restore',{trashIds:[trash.items[0].id]}),now),DomainError);
 assert.equal((await listDataTrash(db,'b')).total,0);await changeData(db,'a',dataCmd(state.revision,'purge',{trashIds:[trash.items[0].id]}),now);
 assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM orbit_note_revisions WHERE owner_id=?').bind('a').first()).count,0);assert.equal((await readNote(db,'b','n')).body,note.body);assert.equal((await listDataTrash(db,'a')).total,0);
 }finally{db.close();}
});
test('repeat requests have one effect, stale writes fail, and failures roll back state plus trash',async()=>{
 const db=createDatabase();try{let state=await seed(db);const request=dataCmd(state.revision,'trash',{selection:selection('notes')});const first=await changeData(db,'a',request,now);const repeat=await changeData(db,'a',request,now);assert.equal(repeat.replayed,true);assert.equal(first.snapshot.revision,repeat.snapshot.revision);assert.equal((await listDataTrash(db,'a')).total,1);
 await assert.rejects(()=>changeData(db,'a',{...request,selection:selection('projects')},now),RevisionConflict);
 await assert.rejects(()=>changeData(db,'a',dataCmd(state.revision,'trash',{selection:selection('projects')}),now),RevisionConflict);
 state=repeat.snapshot;await db.prepare("CREATE TRIGGER reject_trash BEFORE INSERT ON orbit_data_trash BEGIN SELECT RAISE(ABORT,'failure'); END").run();
 await assert.rejects(()=>changeData(db,'a',dataCmd(state.revision,'trash',{selection:selection('projects')}),now));assert.equal((await readWorkspace(db,'a')).revision,state.revision);assert.equal((await readWorkspace(db,'a')).data.projects.length,1);assert.equal((await listDataTrash(db,'a')).total,1);
 }finally{db.close();}
});
test('restoring tasks does not resume timers or approvals; goal deadline can be cleared',async()=>{
 const db=createDatabase();try{let state=await seed(db);state=await writeCommand(db,'a',cmd(state.revision,{type:'task.upsert',task}),now);const stored=structuredClone(state.data);stored.tasks[0]={...stored.tasks[0],focus:true,focusDate:'2026-09-17',laserDate:'2026-09-17',startedAt:now.toISOString()};await db.prepare('UPDATE orbit_workspaces SET state_json=? WHERE owner_id=?').bind(JSON.stringify(stored),'a').run();
 state=(await changeData(db,'a',dataCmd(state.revision,'trash',{selection:selection('tasks')}),now)).snapshot;const trash=await listDataTrash(db,'a');state=(await changeData(db,'a',dataCmd(state.revision,'restore',{trashIds:[trash.items[0].id]}),now)).snapshot;assert.equal(state.data.tasks[0].focus,false);assert.equal(state.data.tasks[0].startedAt,undefined);assert.equal(state.data.tasks[0].focusDate,undefined);assert.equal(state.data.events.length,0);
 state=await writeCommand(db,'a',cmd(state.revision,{type:'goal.upsert',goal:{id:'g',sentence:'목표',kind:'short',deadline:'2026-09-30'}}),now);
 state=await writeCommand(db,'a',cmd(state.revision,{type:'goal.upsert',goal:{...state.data.goals[0]},clearFields:['deadline']}),now);assert.equal(state.data.goals[0].deadline,undefined);const overview=await dataStorageOverview(db,'a');assert.equal(overview.find(r=>r.table==='orbit_note_revisions').count,1);
 }finally{db.close();}
});
test('permanent deletion cannot strand related trash, and backup restore respects reserved IDs',async()=>{
 const db=createDatabase();try{let state=await seed(db);const backup={format:'orbit-backup/v2',capturedAt:now.toISOString(),data:{...state.data,notes:[await readNote(db,'a','n')]},noteHistory:[],reviewDetails:[]};
 state=(await changeData(db,'a',dataCmd(state.revision,'trash',{selection:selection('projects','notes')}),now)).snapshot;const trash=await listDataTrash(db,'a');
 await assert.rejects(()=>changeData(db,'a',dataCmd(state.revision,'purge',{trashIds:[trash.items.find(r=>r.category==='projects').id]}),now),DomainError);
 await assert.rejects(()=>writeCommand(db,'a',cmd(state.revision,{type:'project.delete',id:'p'}),now),DomainError);
 const checksum=await digest(backup);await assert.rejects(()=>restoreContent(db,'a',backup,[{category:'projects',id:'p'}],state.revision,randomUUID(),checksum),DomainError);
 await changeData(db,'a',dataCmd(state.revision,'purge',{trashIds:trash.items.map(r=>r.id)}),now);assert.equal((await listDataTrash(db,'a')).total,0);
 }finally{db.close();}
});
