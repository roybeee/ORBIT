import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {
  projectTimeline,
  readProjectRelation,
  readWorkspace,
  upsertProjectRelation,
  writeCommand,
} from '../db/repository.ts';
import {createGoogleEvent,syncCalendar} from '../lib/orbit/agent/calendar.ts';
import {resolveEventProject} from '../lib/orbit/classify.ts';
import {parseAction} from '../lib/orbit/agent/protocol.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';

const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const owner='owner';
const project={id:'seongsu',name:'성수동 인테리어',color:'#5558e8',symbol:'성',goal:'계약 완료',due:'2026-10-01',priority:4,aliases:['성수동'],people:['송석민'],organizations:['송석민 대표 사무실']};
const action={type:'google.event.create',event:{title:'송석민 대표 미팅',date:'2026-09-22',start:930,end:990,timeZone:'Asia/Seoul',description:'인테리어·계약 관련, 성수동',projectId:project.id}};
const j=(data,status=200)=>Response.json(data,{status});
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}
async function seedProject(db,who=owner,value=project){await writeCommand(db,who,{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project:value}})}
async function connect(db){await saveConnection(db,owner,'google_calendar',{clientId:'orbit-client',accessToken:'private-access',refreshToken:'private-refresh',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY)}

 test('project relation migration is owner-scoped, idempotent and overlays cached events',()=>fixture(async db=>{
  await seedProject(db);
  const relation={entityType:'event',entityId:'google:native:2026-09-22',projectId:project.id,sourceProvider:'google_calendar',sourceId:'native',sourceDate:'2026-09-22',resolution:'explicit',evidence:['projectId']};
  await upsertProjectRelation(db,owner,relation);
  await upsertProjectRelation(db,owner,{...relation,evidence:['projectId','replay']});
  assert.equal((await db.prepare('SELECT count(*) AS count FROM orbit_project_relations WHERE owner_id=?').bind(owner).first()).count,1);
  assert.equal((await readProjectRelation(db,owner,'event',relation.entityId)).projectId,project.id);
  assert.equal(await readProjectRelation(db,'other','event',relation.entityId),null);
  await assert.rejects(()=>upsertProjectRelation(db,'other',relation),/project/i);
  const state=await readWorkspace(db,owner);
  await assert.rejects(()=>writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:state.revision,action:{type:'project.delete',id:project.id}}),/연결/);
  await db.prepare('INSERT INTO orbit_calendar_cache(owner_id,events_json,time_zone,range_start,range_end,updated_at) VALUES(?,?,?,?,?,?)').bind(owner,JSON.stringify([{id:relation.entityId,title:'송석민 대표 미팅',date:'2026-09-22',start:930,end:990,kind:'meeting'}]),'Asia/Seoul','2026-09-01','2026-10-01',new Date().toISOString()).run();
  assert.equal((await readWorkspace(db,owner)).data.events[0].projectId,project.id);
  assert.equal((await readWorkspace(db,'other')).data.events.length,0);
 }));

 test('explicit Google project relation survives lost acknowledgement, replay, sync and workspace edits',()=>fixture(async db=>{
  await seedProject(db);await connect(db);
  const id=randomUUID(),native='orbit'+id.replaceAll('-','');let saved,posts=0,lose=true;
  globalThis.fetch=async(url,options={})=>{
   if(options.method==='POST'){posts++;saved=JSON.parse(options.body);if(lose){lose=false;throw new Error('lost acknowledgement')}return j({...saved,htmlLink:'https://calendar.google.com/event'})}
   if(url.includes('/events/'))return saved?j({...saved,htmlLink:'https://calendar.google.com/event'}):j({},404);
   return j({items:saved?[{id:native,summary:saved.summary,start:saved.start,end:saved.end}]:[]});
  };
  await assert.rejects(()=>createGoogleEvent(db,owner,env,id,action));
  assert.equal(await readProjectRelation(db,owner,'event',`google:${native}:2026-09-22`),null);
  await createGoogleEvent(db,owner,env,id,action);
  await createGoogleEvent(db,owner,env,id,action);
  assert.equal(posts,1);
  await syncCalendar(db,owner,env,'2026-09-22');
  let state=await readWorkspace(db,owner),event=state.data.events.find(e=>e.id===`google:${native}:2026-09-22`);
  assert.equal(event.projectId,project.id);
  await writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:state.revision,action:{type:'project.upsert',project:{...project,goal:'계약 체결'}}});
  event=(await readWorkspace(db,owner)).data.events.find(e=>e.id===`google:${native}:2026-09-22`);
  assert.equal(event.projectId,project.id);
  assert.equal(saved.summary,action.event.title);assert.equal(saved.start.dateTime,'2026-09-22T06:30:00.000Z');assert.equal(saved.end.dateTime,'2026-09-22T07:30:00.000Z');assert.equal(saved.reminders.useDefault,false);assert.ok(!('attendees' in saved));
  const timeline=await projectTimeline(db,owner,project.id);
  assert.deepEqual(timeline.map(item=>[item.kind,item.id]),[['event',event.id]]);
  assert.equal((await projectTimeline(db,'other',project.id)).length,0);
  await assert.rejects(
   ()=>createGoogleEvent(db,owner,env,randomUUID(),{...action,event:{...action.event,projectId:'missing-project'}}),
   /프로젝트/,
  );
 }));

 test('nullable project contract and alias resolver prefer explicit IDs but leave ambiguous aliases unlinked',()=>{
  assert.equal(parseAction({...action,event:{...action.event,projectId:null}}).event.projectId,null);
  assert.equal(resolveEventProject(action.event,[project],[],[]).projectId,project.id);
  assert.equal(resolveEventProject({...action.event,projectId:null},[project],[],[]).projectId,project.id);
  assert.equal(resolveEventProject({title:'후속 일정',projectId:null},[project],[],[],project.id).resolution,'existing');
  assert.equal(resolveEventProject({...action.event,projectId:null},[project,{...project,id:'other',name:'다른 프로젝트'}],[],[]),null);
 });
