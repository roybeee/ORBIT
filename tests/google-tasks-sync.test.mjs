import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {sourceStatuses} from '../lib/orbit/source-status.ts';
import {syncGoogleTasks} from '../lib/orbit/agent/google-tasks.ts';
import {todayInZone} from '../lib/orbit/dates.ts';

// ORBIT tasks linked to a Google Task (created together from Slack) stay in step both ways:
// title, due date and completion, plus deletion. When both sides changed, ORBIT wins.
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const project={id:'hr',name:'채용',goal:'채용',due:'2026-12-31',priority:3,color:'#5484ed',symbol:'H'};
const task={id:'slack-1',title:'계약서 검토',projectId:'hr',status:'todo',due:'2026-10-02',duration:30,impact:3,focus:false,definition:'',googleTask:{taskListId:'@default',taskId:'gt-1'}};
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}
async function act(db,action){const s=await readWorkspace(db,'a');return writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:s.revision,action})}
const mine=async db=>(await readWorkspace(db,'a')).data.tasks.find(t=>t.id==='slack-1');
const sync=db=>syncGoogleTasks(db,'a',env,{force:true});

function tasksApi({forbidden=false,forbiddenBody,onGet,broken=[]}={}){
 const items=new Map([['gt-1',{id:'gt-1',title:'계약서 검토',due:'2026-10-02T00:00:00.000Z',status:'needsAction',etag:'"1"',updated:'2026-09-25T00:00:00.000Z'}]]);
 let version=1;const calls=[];
 const touch=v=>({...v,etag:`"${++version}"`,updated:new Date(Date.now()+version*1000).toISOString()});
 globalThis.fetch=async(url,init={})=>{
  const method=init.method??'GET',u=new URL(url);calls.push(method+' '+u.pathname);
  if(forbidden)return Response.json(forbiddenBody??{error:{code:403}},{status:403});
  const m=/^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/.exec(u.pathname);if(!m)throw new Error('Unexpected '+url);
  const id=m[2]&&decodeURIComponent(m[2]),current=id&&items.get(id);
  if(!id)return Response.json({items:[...items.values()].filter(v=>!u.searchParams.get('updatedMin')||v.updated>=u.searchParams.get('updatedMin'))});
  if(method==='GET'){if(broken.includes(id))return Response.json({},{status:500});await onGet?.(id);return current?Response.json(current):Response.json({},{status:404})}
  if(init.headers?.['If-Match']&&current&&init.headers['If-Match']!==current.etag)return Response.json({},{status:412});
  if(method==='PATCH'){const next=touch({...current,...JSON.parse(init.body)});items.set(id,next);return Response.json(next)}
  if(method==='DELETE'){items.delete(id);return new Response(null,{status:204})}
  throw new Error('Unexpected '+method);
 };
 return {items,calls,edit(changes){items.set('gt-1',touch({...items.get('gt-1'),...changes}))}};
}
async function linked(db,options){
 await saveConnection(db,'a','google_calendar',{accessToken:'test',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 await act(db,{type:'project.upsert',project});await act(db,{type:'task.upsert',task});
 const g=tasksApi(options);await sync(db);return g;
}

test('completing in Google completes the ORBIT task; reopening in ORBIT reopens it in Google',()=>fixture(async db=>{
 const g=await linked(db);
 g.edit({status:'completed',completed:'2026-10-01T09:00:00.000Z'});
 await sync(db);
 assert.equal((await mine(db)).status,'done');assert.equal((await mine(db)).completedOn,todayInZone('Asia/Seoul'),'completion is dated in the owner time zone');
 await act(db,{type:'task.upsert',task:{...(await mine(db)),status:'todo',completedOn:undefined}});
 await sync(db);
 assert.equal(g.items.get('gt-1').status,'needsAction');
}));

test('completing and renaming in ORBIT reaches Google',()=>fixture(async db=>{
 const g=await linked(db);
 await act(db,{type:'task.upsert',task:{...task,title:'계약서 최종 검토',status:'done'}});
 await sync(db);
 assert.equal(g.items.get('gt-1').title,'계약서 최종 검토');assert.equal(g.items.get('gt-1').status,'completed');
}));

test('a new title or due date set in Google comes to ORBIT',()=>fixture(async db=>{
 const g=await linked(db);
 g.edit({title:'계약서 검토 (법무)',due:'2026-10-05T00:00:00.000Z'});
 await sync(db);
 const t=await mine(db);assert.deepEqual([t.title,t.due,t.status],['계약서 검토 (법무)','2026-10-05','todo']);
}));

test('when both sides changed, ORBIT wins',()=>fixture(async db=>{
 const g=await linked(db);
 g.edit({title:'Google 제목'});
 await act(db,{type:'task.upsert',task:{...task,title:'ORBIT 제목'}});
 await sync(db);
 assert.equal(g.items.get('gt-1').title,'ORBIT 제목');assert.equal((await mine(db)).title,'ORBIT 제목');
}));

test('deleting on either side deletes the other',()=>fixture(async db=>{
 const g=await linked(db);
 g.items.delete('gt-1');
 await sync(db);
 assert.equal(await mine(db),undefined);
 await act(db,{type:'task.upsert',task:{...task,id:'slack-2',googleTask:{taskListId:'@default',taskId:'gt-2'}}});
 g.items.set('gt-2',{id:'gt-2',title:'계약서 검토',due:'2026-10-02T00:00:00.000Z',status:'needsAction',etag:'"9"',updated:'2026-09-25T00:00:00.000Z'});
 await sync(db);
 await act(db,{type:'task.delete',id:'slack-2'});
 await sync(db);
 assert.equal(g.items.has('gt-2'),false);
}));

test('without the Google Tasks permission nothing changes and the status asks to reconnect',()=>fixture(async db=>{
 const g=await linked(db,{forbidden:true});
 await act(db,{type:'task.upsert',task:{...task,status:'done'}});
 await sync(db);
 assert.equal((await mine(db)).status,'done');
 const status=(await sourceStatuses(db,'a')).find(s=>s.provider==='google_tasks');
 assert.equal(status.state,'partial');assert.match(status.detail,/다시 연결/);
 assert.ok(g.calls.every(c=>!c.startsWith('PATCH')));
}));

test('syncs are throttled unless forced, and nothing is fetched without linked tasks',()=>fixture(async db=>{
 const g=await linked(db);const before=g.calls.length;
 await syncGoogleTasks(db,'a',env);
 assert.equal(g.calls.length,before);
 const empty=createDatabase();try{const h=tasksApi();await syncGoogleTasks(empty,'a',env,{force:true});assert.equal(h.calls.length,0)}finally{empty.close()}
}));

test('connecting Google Calendar also asks for Google Tasks',async()=>{
 const {GOOGLE}=await import('../lib/orbit/agent/integrations.ts');
 assert.ok(GOOGLE.scope.split(' ').includes('https://www.googleapis.com/auth/tasks'));
 assert.ok(GOOGLE.scope.split(' ').includes('https://www.googleapis.com/auth/calendar.events'));
});

test('a task Google has never shown is not deleted when Google answers 404',()=>fixture(async db=>{
 await saveConnection(db,'a','google_calendar',{accessToken:'test',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 await act(db,{type:'project.upsert',project});await act(db,{type:'task.upsert',task});
 const g=tasksApi();g.items.clear();
 await sync(db);await sync(db);
 assert.ok(await mine(db),'another account or a restored task must not lose the ORBIT task');
 assert.match((await sourceStatuses(db,'a')).find(s=>s.provider==='google_tasks').detail,/찾지 못한/);
}));

test('an ORBIT edit made while Google is being read is kept',()=>fixture(async db=>{
 const g=await linked(db);
 g.edit({status:'completed'});
 let once=true;
 globalThis.fetch=(inner=>async(url,init)=>{if(once&&(init?.method??'GET')==='GET'){once=false;const t=await mine(db);await act(db,{type:'task.upsert',task:{...t,duration:120}})}return inner(url,init)})(globalThis.fetch);
 await sync(db);
 const t=await mine(db);assert.equal(t.duration,120);assert.equal(t.status,'done');
}));

test('with the base stored at creation, a Google edit before the first sync comes to ORBIT',()=>fixture(async db=>{
 await saveConnection(db,'a','google_calendar',{accessToken:'test',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 await act(db,{type:'project.upsert',project});await act(db,{type:'task.upsert',task});
 await db.prepare('INSERT INTO orbit_google_task_links VALUES(?,?,?,?,?,?)').bind('a','slack-1','@default','gt-1',JSON.stringify({title:task.title,due:task.due,status:'needsAction',etag:''}),'').run();
 const g=tasksApi();g.edit({title:'Google에서 바꿈',status:'completed'});
 await sync(db);
 const t=await mine(db);assert.deepEqual([t.title,t.status],['Google에서 바꿈','done']);
}));

test('completing in Google closes a running focus session like completing in ORBIT',()=>fixture(async db=>{
 const g=await linked(db);
 await act(db,{type:'task.start',id:'slack-1'});
 assert.ok((await mine(db)).startedAt);
 g.edit({status:'completed'});
 await sync(db);
 const t=await mine(db);assert.equal(t.status,'done');assert.equal(t.startedAt,undefined);assert.equal(t.outcome,'done');
}));

test('one failing task does not stop the others',()=>fixture(async db=>{
 await saveConnection(db,'a','google_calendar',{accessToken:'test',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 await act(db,{type:'project.upsert',project});
 await act(db,{type:'task.upsert',task:{...task,id:'slack-0',googleTask:{taskListId:'@default',taskId:'gt-0'}}});
 await act(db,{type:'task.upsert',task});
 const g=tasksApi({broken:['gt-0']});await sync(db);
 g.edit({status:'completed'});await sync(db);
 assert.equal((await mine(db)).status,'done');
 assert.match((await sourceStatuses(db,'a')).find(s=>s.provider==='google_tasks').detail,/확인하지 못한/);
}));

test('a Slack task whose Google Task this account cannot see is kept, not deleted',()=>fixture(async db=>{
 await saveConnection(db,'a','google_calendar',{accessToken:'test',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 await act(db,{type:'project.upsert',project});await act(db,{type:'task.upsert',task});
 await db.prepare('INSERT INTO orbit_google_task_links VALUES(?,?,?,?,?,?)').bind('a','slack-1','@default','gt-1',JSON.stringify({title:task.title,due:task.due,status:'needsAction',etag:''}),'').run();
 const g=tasksApi();g.items.clear();
 await sync(db);
 assert.ok(await mine(db),'a base link never confirmed in Google is not proof of deletion');
}));

test('the status names the real cause Google gives for a 403',()=>fixture(async db=>{
 const disabled={error:{code:403,message:'Google Tasks API has not been used in project 123456789 before or it is disabled.',status:'PERMISSION_DENIED',
  details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'SERVICE_DISABLED',metadata:{consumer:'projects/123456789',service:'tasks.googleapis.com'}}]}};
 await linked(db,{forbidden:true,forbiddenBody:disabled});
 let status=(await sourceStatuses(db,'a')).find(s=>s.provider==='google_tasks');
 assert.equal(status.state,'partial');assert.match(status.detail,/Google Tasks API가 꺼져/);assert.match(status.detail,/123456789/);
 tasksApi({forbidden:true,forbiddenBody:{error:{code:403,status:'PERMISSION_DENIED',details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'ACCESS_TOKEN_SCOPE_INSUFFICIENT'}]}}});
 await sync(db);
 status=(await sourceStatuses(db,'a')).find(s=>s.provider==='google_tasks');
 assert.match(status.detail,/다시 연결/);assert.match(status.detail,/Tasks 권한/);
}));
