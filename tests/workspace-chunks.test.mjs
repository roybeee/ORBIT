import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {createDatabase} from './sqlite-d1.mjs';
import {prepareWorkspace,decodeWorkspace} from '../db/workspace-storage.ts';
import {readWorkspace,writeCommand,readNote,RevisionConflict,queueTaskCalendarBackfill} from '../db/repository.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {backupArchive} from '../lib/orbit/backup-export.ts';
import {restoreContent} from '../lib/orbit/backup.ts';
import {changeData} from '../db/data-manager.ts';
import {disconnect} from '../lib/orbit/agent/settings.ts';
const date='2026-09-21',now=new Date(date+'T00:00:00Z');
const project={id:'p',name:'업무',color:'#5558e8',symbol:'O',goal:'보존',due:date,priority:5};
const task={id:'t',title:'전화',projectId:'p',status:'todo',duration:60,due:date,impact:5,focus:false,definition:'통화 완료',description:'한😀'.repeat(2000)};
const large=(count=240)=>({...emptyWorkspace(),projects:[project],tasks:Array.from({length:count},(_,i)=>({...task,id:'task-'+i}))});
const cmd=(revision,action,operationId=randomUUID())=>({expectedRevision:revision,action,operationId});
async function fixture(fn){const db=createDatabase();try{await fn(db)}finally{db.close()}}
async function seed(db,data,owner='a'){
 const storage=prepareWorkspace(data);
 await db.batch([db.prepare('INSERT INTO orbit_workspaces(owner_id,revision,state_json,mutation_id,updated_at) VALUES(?,1,?,?,?)').bind(owner,storage.stateJson,'seed',now.toISOString()),...storage.statements(db,owner,'1=1',[])]);
}
async function parts(db,owner='a'){return (await db.prepare('SELECT generation,part,content FROM orbit_workspace_chunks WHERE owner_id=? ORDER BY part').bind(owner).all()).results}

test('legacy data over 950 KB migrates losslessly when changing a task color; note history survives',()=>fixture(async db=>{
 const d=large(90);d.schemaVersion=2;d.notes=[{id:'n',title:'원문',projectId:'p',kind:'wiki',summary:'메모',tags:[],body:'기존 원문 😀',updated:date}];
 const raw=JSON.stringify(d);assert.ok(Buffer.byteLength(raw)>950000);assert.ok(Buffer.byteLength(raw)<2000000);
 await db.prepare('INSERT INTO orbit_workspaces VALUES(?,1,?,?,?)').bind('a',raw,'legacy',now.toISOString()).run();
 assert.deepEqual((await readWorkspace(db,'a')).data,d);
 const next=await writeCommand(db,'a',cmd(1,{type:'task.upsert',task:{...d.tasks[0],color:'yellow'}}),now);
 assert.equal(next.data.tasks[0].color,'yellow');assert.deepEqual(next.data.tasks.slice(1),d.tasks.slice(1));
 assert.equal((await readNote(db,'a','n')).body,d.notes[0].body);
 const header=await db.prepare('SELECT state_json FROM orbit_workspaces WHERE owner_id=?').bind('a').first();
 assert.ok(header.state_json.length<300);assert.ok((await parts(db)).length>1);
 assert.equal((await readWorkspace(db,'b')).data.tasks.length,0);
}));

test('more than 3 MB of Korean and emoji roundtrips exactly in bounded rows, then accepts edits and scheduling',()=>fixture(async db=>{
 const d=large();assert.ok(Buffer.byteLength(JSON.stringify(d))>3000000);await seed(db,d);
 assert.deepEqual((await readWorkspace(db,'a')).data,d);
 for(const p of await parts(db)){assert.ok(Buffer.byteLength(p.content)<100000);assert.ok(!/[\uD800-\uDBFF]$/.test(p.content));}
 let snapshot=await writeCommand(db,'a',cmd(1,{type:'task.upsert',task:{...d.tasks[0],color:'yellow',scope:'work',category:'phone',description:'수정한 메모'}}),now);
 snapshot=await writeCommand(db,'a',cmd(snapshot.revision,{type:'task.schedule',taskId:d.tasks[0].id,eventId:randomUUID(),date,start:600,minutes:60,color:'yellow'}),now);
 assert.equal(snapshot.data.events.length,1);assert.equal(snapshot.data.tasks[0].description,'수정한 메모');assert.equal(snapshot.data.tasks[0].color,'yellow');
 assert.deepEqual(snapshot.data.tasks.slice(1),d.tasks.slice(1));
 assert.ok((await db.prepare('SELECT event_id FROM orbit_calendar_exports WHERE owner_id=?').bind('a').all()).results.length>0);
}));

test('a failed chunk insert rolls back the legacy header, migration, receipt and calendar outbox',()=>fixture(async db=>{
 const d=large(90),raw=JSON.stringify(d);
 await db.prepare('INSERT INTO orbit_workspaces VALUES(?,1,?,?,?)').bind('a',raw,'legacy',now.toISOString()).run();
 await db.prepare("CREATE TRIGGER fail_chunk BEFORE INSERT ON orbit_workspace_chunks WHEN NEW.part=3 BEGIN SELECT RAISE(ABORT,'injected disk failure'); END").run();
 await assert.rejects(()=>writeCommand(db,'a',cmd(1,{type:'task.upsert',task:{...d.tasks[0],color:'yellow'}}),now),/injected disk failure/);
 assert.equal((await db.prepare('SELECT state_json FROM orbit_workspaces WHERE owner_id=?').bind('a').first()).state_json,raw);
 assert.equal((await parts(db)).length,0);assert.equal((await db.prepare('SELECT * FROM orbit_mutations').all()).results.length,0);
 assert.equal((await db.prepare('SELECT * FROM orbit_calendar_exports').all()).results.length,0);
 assert.deepEqual((await readWorkspace(db,'a')).data,d);
}));

test('simultaneous same-operation retries cannot replace the winning manifest with mismatched chunks',()=>fixture(async db=>{
 await seed(db,large());const request=cmd(1,{type:'task.upsert',task:{...task,id:'task-0',color:'yellow'}});
 const results=await Promise.all([writeCommand(db,'a',request,now),writeCommand(db,'a',request,now)]);
 assert.equal(results[0].revision,2);assert.equal(results[1].revision,2);
 const snapshot=await readWorkspace(db,'a');assert.equal(snapshot.data.tasks.length,240);assert.equal(snapshot.data.tasks[0].color,'yellow');
 await assert.rejects(()=>writeCommand(db,'a',cmd(1,{type:'task.upsert',task:{...task,id:'task-0',title:'stale'}}),now),RevisionConflict);
 assert.deepEqual(await readWorkspace(db,'a'),snapshot);
}));

test('missing or mixed-generation chunks fail closed and cannot be overwritten by a partial workspace',()=>fixture(async db=>{
 await seed(db,large());const header=(await db.prepare('SELECT state_json FROM orbit_workspaces WHERE owner_id=?').bind('a').first()).state_json,rows=await parts(db);
 assert.throws(()=>decodeWorkspace(header,rows.slice(1)),/Incomplete/);
 assert.throws(()=>decodeWorkspace(header,rows.map((p,i)=>i===1?{...p,generation:'other'}:p)),/Incomplete/);
 await db.prepare('DELETE FROM orbit_workspace_chunks WHERE owner_id=? AND part=1').bind('a').run();
 await assert.rejects(()=>readWorkspace(db,'a'),/Incomplete/);
 await assert.rejects(()=>writeCommand(db,'a',cmd(1,{type:'project.upsert',project}),now),/Incomplete/);
 assert.equal((await db.prepare('SELECT revision FROM orbit_workspaces WHERE owner_id=?').bind('a').first()).revision,1);
}));

test('large split workspaces export and restore complete content, not storage manifests',()=>fixture(async db=>{
 const d=large();await seed(db,d);
 const stream=await backupArchive(db,'a',{get:async()=>null});
 const files=unzipSync(new Uint8Array(await new Response(stream).arrayBuffer()));
 const bundle=JSON.parse(strFromU8(files['workspace.json']));assert.deepEqual(bundle.payload.data,d);assert.equal(bundle.payload.data._orbitStorage,undefined);
 const selection=d.tasks.map(t=>({category:'tasks',id:t.id}));
 const restored=await restoreContent(db,'b',bundle.payload,selection,0,randomUUID(),bundle.checksum);
 assert.equal(restored.verified,true);assert.deepEqual(restored.snapshot.data.tasks,d.tasks);
 assert.deepEqual(restored.snapshot.data.projects,d.projects);assert.ok((await parts(db,'b')).length>1);
 assert.deepEqual((await readWorkspace(db,'a')).data,d);
}));

test('trash and restore preserve large datasets; revision-only Google disconnect retains readable chunks',()=>fixture(async db=>{
 const d=large();await seed(db,d);const op=randomUUID();
 let result=await changeData(db,'a',{operationId:op,expectedRevision:1,action:'trash',selection:[{category:'tasks',id:'task-0'}]},now);
 assert.equal(result.snapshot.data.tasks.length,239);
 result=await changeData(db,'a',{operationId:randomUUID(),expectedRevision:result.snapshot.revision,action:'restore',trashIds:result.trashIds},now);
 assert.deepEqual([...result.snapshot.data.tasks].sort((a,b)=>a.id.localeCompare(b.id)),[...d.tasks].sort((a,b)=>a.id.localeCompare(b.id)));
 await disconnect(db,'a','google_calendar');
 const after=await readWorkspace(db,'a');assert.equal(after.revision,result.snapshot.revision+1);assert.deepEqual(after.data,result.snapshot.data);
}));


test('large memo collections keep bulk Google reconciliation and palette writes below SQLite binding limits',()=>fixture(async db=>{
 const d=large();await seed(db,d);
 const prepare=db.prepare.bind(db);db.prepare=sql=>{const statement=prepare(sql),bind=statement.bind.bind(statement);statement.bind=(...values)=>{for(const value of values)if(typeof value==='string')assert.ok(Buffer.byteLength(value)<2000000,'oversized SQL binding');return bind(...values)};return statement};
 await queueTaskCalendarBackfill(db,'a',date);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM orbit_calendar_exports WHERE owner_id=?').bind('a').first()).n,d.tasks.length);
 await queueTaskCalendarBackfill(db,'a',date);
 const changed=await writeCommand(db,'a',cmd(1,{type:'preferences.update',preferences:{...d.preferences,taskCategoryColors:{work:'yellow'}}}),now);
 assert.equal(changed.data.tasks.length,d.tasks.length);assert.equal(changed.data.preferences.taskCategoryColors.work,'yellow');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM orbit_calendar_exports WHERE owner_id=?').bind('a').first()).n,d.tasks.length);
}));
