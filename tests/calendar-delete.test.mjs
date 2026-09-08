import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {prepareSeriesDeletion} from '../lib/orbit/agent/calendar-delete.ts';
import {parseAction} from '../lib/orbit/agent/protocol.ts';
import {decide} from '../lib/orbit/agent/decisions.ts';
import {beginTurn,finishTurn,findAction} from '../lib/orbit/agent/repository.ts';
import {readWorkspace,writeCommand} from '../db/repository.ts';

const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const title='결혼기념일계획체크',series='series123',action={type:'google.event.deleteSeries',eventId:'instance123',expectedTitle:title,scope:'all'};
async function fixture(fn){
 const db=createDatabase(),fetch=globalThis.fetch;let removed=false,deleteCount=0,etag='"v1"',account='owner@example.com',deny=false,failVerify=false,timeout=false,residual=false;
 const requests=[];
 globalThis.fetch=async(url,init={})=>{
  const u=new URL(url);requests.push({url:u.href,method:init.method??'GET'});
  if(deny)return Response.json({error:'denied'},{status:403});
  if(u.pathname.endsWith('/calendarList/primary'))return Response.json({id:account,accessRole:'owner'});
  if(init.method==='DELETE'){
   assert.equal(u.pathname.split('/').at(-1),series);assert.equal(init.headers['If-Match'],etag);assert.equal(u.searchParams.get('sendUpdates'),'none');deleteCount++;removed=true;
   if(timeout){timeout=false;throw new Error('lost response');}return new Response(null,{status:204});
  }
  if(u.pathname.endsWith('/instances')){if(failVerify)return Response.json({error:'unavailable'},{status:503});return Response.json({items:residual?[{id:'future',status:'confirmed'}]:[]});}
  if(u.pathname.endsWith('/events'))return Response.json({items:[]});
  const id=u.pathname.split('/').at(-1);
  if(removed)return Response.json({error:'gone'},{status:410});
  if(id==='instance123')return Response.json({id,summary:title,recurringEventId:series});
  if(id===series)return Response.json({id:series,summary:title,etag,iCalUID:'uid@example.com',recurrence:['RRULE:FREQ=YEARLY'],status:'confirmed'});
  return Response.json({error:'missing'},{status:404});
 };
 try{
  await saveConnection(db,'owner','google_calendar',{clientId:'client',accessToken:'token',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY);
  const project={id:'p',name:'개인',goal:'계획',due:'2026-12-31',priority:3,color:'#5558e8',symbol:'P'};
  await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project}});
  const task={id:'anniversary-plan-check-2026-09-08',projectId:'p',title,status:'todo',duration:30,due:'2026-09-08',impact:3,focus:false,definition:'기존 내용'};
  await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:1,action:{type:'task.upsert',task}});
  const stage=async(a=action)=>{
   const prepared=await prepareSeriesDeletion(db,'owner',env,a),id=randomUUID(),turn=randomUUID(),lease=await beginTurn(db,'owner',turn,'시리즈 전체 삭제. 기존 할 일 유지');
   await finishTurn(db,'owner',turn,lease.lease,{text:'승인하면 반영됩니다.',sources:[]},[{id,turnId:turn,title,reason:'사용자 요청',action:prepared,expectedRevision:2,state:'pending',note:'',revisitDate:null,createdAt:new Date().toISOString()}]);return id;
  };
  await fn({db,stage,task,requests,get deletes(){return deleteCount},set etag(v){etag=v},set account(v){account=v},set deny(v){deny=v},set failVerify(v){failVerify=v},set timeout(v){timeout=v},set residual(v){residual=v}});
 }finally{globalThis.fetch=fetch;db.close();}
}
test('live instance resolves master, approval deletes all series once, future requery and existing todo preserved',()=>fixture(async f=>{
 const id=await f.stage();assert.equal(f.deletes,0);const card=await findAction(f.db,'owner',id);assert.equal(card.action.verified.seriesId,series);
 await decide(f.db,'owner',{id,decision:'approve'},env);await decide(f.db,'owner',{id,decision:'approve'},env);assert.equal(f.deletes,1);
 assert.equal((await findAction(f.db,'owner',id)).result.calendarDeletion.status,'verified');
 assert.deepEqual((await readWorkspace(f.db,'owner')).data.tasks,[f.task]);
 assert.ok(f.requests.some(r=>r.url.includes('/instances?')));assert.ok(f.requests.some(r=>r.url.includes('iCalUID=uid')));
}));
test('wrong title, unknown ID, single occurrence scope and forged verification are not deletion authority',()=>fixture(async f=>{
 await assert.rejects(()=>f.stage({...action,expectedTitle:'다른 제목'}),e=>e.code==='CALENDAR_TARGET');
 await assert.rejects(()=>f.stage({...action,eventId:'unknown'}));
 assert.throws(()=>parseAction({...action,scope:'single'}));
 const id=await f.stage({...action,verified:{calendarId:'attacker',seriesId:'other',title:'forged',etag:'x',iCalUID:'x'}});
 assert.equal((await findAction(f.db,'owner',id)).action.verified.calendarId,'owner@example.com');assert.equal(f.deletes,0);
}));
test('changed title/version or connected account blocks deletion, owner isolation retained',()=>fixture(async f=>{
 const id=await f.stage();await assert.rejects(()=>decide(f.db,'other',{id,decision:'approve'},env));
 f.account='other@example.com';await assert.rejects(()=>decide(f.db,'owner',{id,decision:'approve'},env),e=>e.code==='CONFLICT');f.account='owner@example.com';
 f.etag='"changed"';await assert.rejects(()=>decide(f.db,'owner',{id,decision:'approve'},env),e=>e.code==='CONFLICT');assert.equal(f.deletes,0);
}));
test('missing Calendar permission gives Orbit reconnection instructions and no DELETE',()=>fixture(async f=>{
 const id=await f.stage();f.deny=true;await assert.rejects(()=>decide(f.db,'owner',{id,decision:'approve'},env),e=>e.code==='RECONNECT'&&e.message.includes('Google Calendar'));assert.equal(f.deletes,0);
}));
test('successful DELETE with failed verification stays pending; retry verifies without another delete',()=>fixture(async f=>{
 const id=await f.stage();f.failVerify=true;await assert.rejects(()=>decide(f.db,'owner',{id,decision:'approve'},env),e=>e.code==='CALENDAR_VERIFY');
 assert.equal((await findAction(f.db,'owner',id)).state,'pending');assert.equal((await findAction(f.db,'owner',id)).result.calendarDeletion.status,'verification_pending');
 f.failVerify=false;await decide(f.db,'owner',{id,decision:'approve'},env);assert.equal(f.deletes,1);assert.deepEqual((await readWorkspace(f.db,'owner')).data.tasks,[f.task]);
}));
test('ambiguous network failure keeps durable target checkpoint and safely resumes',()=>fixture(async f=>{
 const id=await f.stage();f.timeout=true;await assert.rejects(()=>decide(f.db,'owner',{id,decision:'approve'},env));
 assert.equal((await findAction(f.db,'owner',id)).result.calendarDeletion.status,'attempted');await decide(f.db,'owner',{id,decision:'approve'},env);assert.equal(f.deletes,1);
}));
test('remaining future instances cannot be reported as verified',()=>fixture(async f=>{
 const id=await f.stage();f.residual=true;await assert.rejects(()=>decide(f.db,'owner',{id,decision:'approve'},env),e=>e.code==='CALENDAR_VERIFY');assert.equal((await findAction(f.db,'owner',id)).state,'pending');
}));

import {runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {listAgent} from '../lib/orbit/agent/repository.ts';
test('Hermes chat without any Google native tool can stage and execute Orbit Calendar action',()=>fixture(async f=>{
 const googleFetch=globalThis.fetch;let nativePosts=0;
 await saveConnection(f.db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'native-token',connectionId:'native-a'},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 globalThis.fetch=async(url,init={})=>{
  if(!url.startsWith('https://hermes.example.com'))return googleFetch(url,init);
  if(init.method==='POST'){nativePosts++;assert.match(JSON.parse(init.body).instructions,/google.event.deleteSeries/);return Response.json({run_id:'run_calendar',status:'started'},{status:202});}
  return Response.json({object:'hermes.run',run_id:'run_calendar',status:'completed',output:JSON.stringify({kind:'final',text:'승인하면 반영됩니다.',proposals:[{title:'반복 시리즈 전체 삭제',reason:'기존 할 일 유지',action}]})});
 };
 const id=randomUUID();await runAgent(f.db,'owner',{id,message:'반복 시리즈 전체 삭제, 기존 할 일 유지'},env);await advanceAgent(f.db,'owner',id,env);await advanceAgent(f.db,'owner',id,env);
 const state=await listAgent(f.db,'owner');assert.equal(state.turns[0].status,'completed');assert.equal(state.actions.length,1);assert.equal(state.actions[0].action.verified.seriesId,series);assert.equal(f.deletes,0);
 await decide(f.db,'owner',{id:state.actions[0].id,decision:'approve'},env);assert.equal(f.deletes,1);assert.equal(nativePosts,1);assert.deepEqual((await readWorkspace(f.db,'owner')).data.tasks,[f.task]);
}));
