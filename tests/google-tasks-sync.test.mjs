import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {sourceStatuses} from '../lib/orbit/source-status.ts';
import {syncGoogleTasks} from '../lib/orbit/agent/google-tasks.ts';

// ORBIT tasks linked to a Google Task (created together from Slack) stay in step both ways:
// title, due date and completion, plus deletion. When both sides changed, ORBIT wins.
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const project={id:'hr',name:'채용',goal:'채용',due:'2026-12-31',priority:3,color:'#5484ed',symbol:'H'};
const task={id:'slack-1',title:'계약서 검토',projectId:'hr',status:'todo',due:'2026-10-02',duration:30,impact:3,focus:false,definition:'',googleTask:{taskListId:'@default',taskId:'gt-1'}};
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}
async function act(db,action){const s=await readWorkspace(db,'a');return writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:s.revision,action})}
const mine=async db=>(await readWorkspace(db,'a')).data.tasks.find(t=>t.id==='slack-1');
const sync=db=>syncGoogleTasks(db,'a',env,{force:true});

function tasksApi({forbidden=false}={}){
 const items=new Map([['gt-1',{id:'gt-1',title:'계약서 검토',due:'2026-10-02T00:00:00.000Z',status:'needsAction',etag:'"1"',updated:'2026-09-25T00:00:00.000Z'}]]);
 let version=1;const calls=[];
 const touch=v=>({...v,etag:`"${++version}"`,updated:new Date(Date.now()+version*1000).toISOString()});
 globalThis.fetch=async(url,init={})=>{
  const method=init.method??'GET',u=new URL(url);calls.push(method+' '+u.pathname);
  if(forbidden)return Response.json({error:{code:403}},{status:403});
  const m=/^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/.exec(u.pathname);if(!m)throw new Error('Unexpected '+url);
  const id=m[2]&&decodeURIComponent(m[2]),current=id&&items.get(id);
  if(!id)return Response.json({items:[...items.values()].filter(v=>!u.searchParams.get('updatedMin')||v.updated>=u.searchParams.get('updatedMin'))});
  if(method==='GET')return current?Response.json(current):Response.json({},{status:404});
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
 assert.equal((await mine(db)).status,'done');assert.equal((await mine(db)).completedOn,'2026-10-01');
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
