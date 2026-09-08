import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {chiefOfStaff,goalPace,careEvents} from '../lib/orbit/chief.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {actionSchema} from '../lib/orbit/validation.ts';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {chiefJobName,changeChiefSchedule,chiefScheduleStatus,scheduledPrompt,scheduleInput} from '../lib/orbit/agent/chief-jobs.ts';
const now=new Date('2026-09-08T01:00:00Z'),today='2026-09-08';
const goal={id:'g',kind:'short',sentence:'검증 가능한 결과',domain:'work',deadline:'2026-09-15',progress:{baseline:0,current:10,target:100,unit:'개',startedOn:'2026-09-01',updatedOn:today}};
const project={id:'p',name:'실행',color:'#5558e8',symbol:'O',goal:'결과',due:'2026-09-15',priority:3,goalId:'g'};
const task=(id,extra={})=>({id,title:id,projectId:'p',status:'todo',duration:30,due:'2026-09-10',impact:3,focus:false,definition:'확인할 수 있는 결과',...extra});
const fixture=(extra={})=>({...emptyWorkspace(),goals:[goal],projects:[project],tasks:[task('ready')],...extra});
const routine={id:'care',title:'걷기',domain:'health',minutes:10,days:[0,1,2,3,4,5,6],start:540,active:true,log:[]};
test('missing or stale metrics remain unknown; decreasing metrics work and success needs confirmation',()=>{
 assert.equal(goalPace({...goal,progress:undefined},today).status,'unknown');
 assert.equal(goalPace(goal,today).status,'behind');
 assert.equal(goalPace({...goal,progress:{...goal.progress,updatedOn:'2026-08-01'}},today).status,'unknown');
 assert.equal(goalPace({...goal,progress:{...goal.progress,baseline:100,current:80,target:80}},today).status,'confirm');
 assert.equal(goalPace({...goal,status:'achieved'},today).status,'achieved');
});
test('ready goal task wins over holds, dependencies, waiting and paused goals',()=>{
 const data=fixture({tasks:[task('held',{impact:5,planHoldUntil:'2026-09-09'}),task('dependent',{impact:5,dependsOn:['ready']}),task('waiting',{status:'waiting'}),task('ready')]});
 assert.equal(chiefOfStaff(data,now).primary.taskId,'ready');
 data.goals[0]={...goal,status:'paused'};
 assert.ok(!chiefOfStaff(data,now).signals.some(s=>s.kind==='task'));
});
test('low energy takes precedence over heavy workload; resting does not immediately suggest more work',()=>{
 let data=applyAction(fixture({tasks:[task('ready',{due:today,duration:480})]}),{type:'chief.checkin',energy:'low',strain:'heavy',note:'버겁다'},now);
 assert.equal(chiefOfStaff(data,now).primary.kind,'recovery');
 data=applyAction(data,{type:'chief.respond',key:`recovery:${today}`,kind:'snooze',minutes:5,reason:'5분 쉬기'},now);
 assert.equal(chiefOfStaff(data,now).primary.kind,'rest');
 data=applyAction(data,{type:'chief.respond',key:`recovery:${today}`,kind:'recovered',minutes:120,reason:'휴식 마침'},now);
 assert.equal(chiefOfStaff(data,now).primary.minutes,5);
});
test('snooze persists through serialization, expires, and completion removes the task reminder',()=>{
 let data=applyAction(fixture(),{type:'chief.respond',key:'task:ready',kind:'snooze',minutes:30,reason:''},now);
 data=JSON.parse(JSON.stringify(data));
 assert.ok(!chiefOfStaff(data,now).signals.some(s=>s.taskId==='ready'));
 assert.equal(chiefOfStaff(data,new Date(now.getTime()+31*60000)).primary.taskId,'ready');
 data=applyAction(data,{type:'task.status',id:'ready',status:'done'},now);
 assert.ok(!chiefOfStaff(data,new Date(now.getTime()+31*60000)).signals.some(s=>s.taskId==='ready'));
});
test('blocked response atomically records a wait and resurfaces as a follow-up after the delay',()=>{
 let data=applyAction(fixture(),{type:'chief.respond',key:'task:ready',kind:'blocked',minutes:60,reason:'견적 기다림'},now);
 assert.equal(data.tasks[0].status,'waiting');assert.equal(data.tasks[0].blocker,'견적 기다림');
 assert.ok(!chiefOfStaff(data,now).signals.some(s=>s.taskId==='ready'));
 assert.equal(chiefOfStaff(data,new Date(now.getTime()+61*60000)).primary.kind,'followup');
 data=applyAction(data,{type:'task.status',id:'ready',status:'doing'},now);assert.equal(data.tasks[0].blocker,undefined);
});
test('a running session is protected and quiet/meeting hours suppress attention',()=>{
 const data=fixture({tasks:[task('active',{startedAt:now.toISOString()}),task('later')]});
 const active=chiefOfStaff(data,now);assert.equal(active.primary.kind,'focus');assert.ok(!active.signals.some(s=>s.kind==='task'));
 assert.equal(chiefOfStaff(fixture(),new Date('2026-09-08T14:00:00Z')).attention,false);
 assert.equal(chiefOfStaff(fixture({events:[{id:'e',title:'회의',date:today,start:540,end:660,kind:'meeting'}]}),now).attention,false);
});
test('Seoul midnight rolls over check-in and care completion; original workspaces need no new fields',()=>{
 let data=applyAction(fixture({careRoutines:[routine]}),{type:'chief.checkin',energy:'high',strain:'light',note:''},now);
 data=applyAction(data,{type:'care.check',id:'care',checked:true},now);
 assert.equal(chiefOfStaff(data,now).care.length,1);assert.ok(!chiefOfStaff(data,now).signals.some(s=>s.kind==='care'));
 const next=chiefOfStaff(data,new Date('2026-09-08T15:01:00Z'));assert.equal(next.today,'2026-09-09');assert.equal(next.checkin,undefined);
 assert.equal(chiefOfStaff(emptyWorkspace(),now).primary.kind,'checkin');
});
test('care blocks protect proposal placement and late changes cannot be approved over them',()=>{
 let data=fixture({careRoutines:[{...routine,start:540,minutes:120}],preferences:{...emptyWorkspace().preferences,laserMinutes:30}});
 data=applyAction(data,{type:'proposal.generate',date:today,energy:'normal'},now);
 assert.ok(data.proposals[0].items.every(i=>i.start>=660||i.end<=540));
 const item=data.proposals[0].items[0];assert.ok(item);
 data.careRoutines=[{...routine,start:item.start,minutes:30}];
 assert.throws(()=>applyAction(data,{type:'proposal.approve',date:today,itemId:item.id},now),/돌봄/);
 assert.equal(data.events.length,0);
});
test('routine history survives edits, unknown goals are rejected and measurements are finite',()=>{
 let data=applyAction(fixture({careRoutines:[{...routine,log:[today]}]}),{type:'care.upsert',routine:{...routine,log:undefined,title:'가볍게 걷기'}},now);
 assert.deepEqual(data.careRoutines[0].log,[today]);
 assert.throws(()=>applyAction(data,{type:'care.upsert',routine:{...routine,goalId:'missing'}},now));
 assert.equal(actionSchema.safeParse({type:'goal.upsert',goal:{...goal,progress:{...goal.progress,target:Infinity}}}).success,false);
 const oldGoal={id:'g',kind:'short',sentence:'이름 수정'};data=applyAction(data,{type:'goal.upsert',goal:oldGoal},now);assert.equal(data.goals[0].progress.current,10);
});
test('check-ins use revision protection and cannot resolve on a stale write',async()=>{
 const db=createDatabase();try{const first=await readWorkspace(db,'owner'),action={type:'chief.checkin',energy:'low',strain:'heavy',note:'보고한 상태'};const saved=await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:first.revision,action});assert.equal(saved.data.chief.checkins.length,1);await assert.rejects(()=>writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:first.revision,action:{...action,energy:'high'}}));assert.equal((await readWorkspace(db,'owner')).data.chief.checkins[0].energy,'low');assert.equal((await readWorkspace(db,'other')).data.chief,undefined);}finally{db.close()}
});
test('overlapping meetings are counted once and expired/finished goals do not reserve care',()=>{
 const data=fixture({events:[{id:'a',title:'a',date:today,start:540,end:600,kind:'meeting'},{id:'b',title:'b',date:today,start:570,end:630,kind:'meeting'}]});
 assert.equal(chiefOfStaff(data,now).capacity,Math.round((540-90)*.8));
 data.careRoutines=[{...routine,goalId:'g'}];data.goals=[{...goal,status:'achieved'}];assert.equal(careEvents(data,today).length,0);
});
test('remaining capacity uses local time, workdays and excludes already scheduled demand',()=>{
 const late=chiefOfStaff(fixture(),new Date('2026-09-08T08:50:00Z'));assert.equal(late.capacity,8);
 const weekend=chiefOfStaff(fixture(),new Date('2026-09-12T01:00:00Z'));assert.equal(weekend.capacity,0);assert.ok(!weekend.signals.some(s=>s.kind==='task'));
 const data=fixture({tasks:[task('ready',{due:today,duration:180})],events:[{id:'focus',title:'reserved',taskId:'ready',date:today,start:660,end:840,kind:'focus'}]});assert.equal(chiefOfStaff(data,now).demand,0);
});
test('paused goals cannot generate work or approve a previously prepared item',()=>{
 let data=applyAction(fixture(),{type:'proposal.generate',date:today,energy:'normal'},now);
 const item=data.proposals[0].items[0];assert.ok(item);
 data=applyAction(data,{type:'goal.upsert',goal:{...goal,status:'paused'}},now);
 assert.throws(()=>applyAction(data,{type:'proposal.approve',date:today,itemId:item.id},now),/보류/);
 const fresh=applyAction({...data,proposals:[]},{type:'proposal.generate',date:today,energy:'normal'},now);assert.equal(fresh.proposals[0].items.length,0);
});
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
async function backgroundFixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'test-private',connectionId:'connection'},{connected:true},env.ORBIT_ENCRYPTION_KEY);await fn(db)}finally{globalThis.fetch=original;db.close()}}
const save={action:'save',hours:12,delivery:'local',research:'공식 최신 정보',includeCare:false,acknowledged:true};
test('native schedules create once, reconcile by owner name, update snapshots and pause only managed jobs',()=>backgroundFixture(async db=>{
 const jobs=[],calls=[];globalThis.fetch=async(url,init={})=>{calls.push({url,method:init.method});assert.equal(init.headers.Authorization,'Bearer test-private');if(!init.method)return Response.json({jobs});const payload=JSON.parse(init.body);if(init.method==='POST'&&url.endsWith('/api/jobs')){jobs.push({...payload,id:'abc123def456',enabled:true});return Response.json({job:jobs[0]})}if(url.endsWith('/pause'))jobs[0].enabled=false;else Object.assign(jobs[0],payload);return Response.json({job:jobs[0]})};
 let state=await changeChiefSchedule(db,'owner',save,env);assert.equal(state.job.enabled,true);assert.equal(jobs[0].schedule,'every 12h');assert.equal(jobs[0].deliver,'local');
 await changeChiefSchedule(db,'owner',save,env);assert.equal(jobs.length,1);assert.equal(calls.filter(c=>c.method==='POST'&&c.url.endsWith('/api/jobs')).length,1);
 state=await changeChiefSchedule(db,'owner',{action:'pause'},env);assert.equal(state.job.enabled,false);
 assert.equal((await chiefScheduleStatus(db,'owner',env)).scope,'snapshot');
 await assert.rejects(()=>chiefScheduleStatus(db,'other',env),e=>e.code==='HERMES_SETUP');
}));
test('uncertain create keeps the lease and reconciles the remote job without a duplicate',()=>backgroundFixture(async db=>{
 const jobs=[];let posts=0;globalThis.fetch=async(url,init={})=>{if(!init.method)return Response.json({jobs});const payload=JSON.parse(init.body);if(init.method==='POST'){posts++;jobs.push({...payload,id:'abc123def456',enabled:true});throw new Error('response lost')}Object.assign(jobs[0],payload);return Response.json({job:jobs[0]})};
 await assert.rejects(()=>changeChiefSchedule(db,'owner',save,env));
 await assert.rejects(()=>changeChiefSchedule(db,'owner',save,env),e=>e.code==='BUSY');
 await db.prepare('UPDATE orbit_chief_jobs SET lease_until=0 WHERE owner_id=?').bind('owner').run();
 await changeChiefSchedule(db,'owner',save,env);assert.equal(posts,1);
}));
test('job snapshot excludes note bodies and unselected care, requires owner consent and respects API size',async()=>{
 const data=fixture({goals:[goal,{...goal,id:'health',domain:'health',sentence:'private health goal'}],notes:[{body:'PRIVATE WIKI BODY'}],chief:{checkins:[{date:today,energy:'low',strain:'heavy',note:'private health note'}]}});
 const receipt={...save,name:'name',connectionId:'connection',snapshotAt:now.toISOString()};
 const prompt=scheduledPrompt(data,receipt,now);assert.ok(!prompt.includes('PRIVATE WIKI BODY'));assert.ok(!prompt.includes('private health'));assert.ok(prompt.length<=5000);assert.ok(prompt.includes('NOT live Orbit access'));assert.ok(prompt.includes('[SILENT]'));assert.ok(prompt.includes('direct source URLs'));
 assert.equal(scheduleInput.safeParse({...save,acknowledged:false}).success,false);
 assert.notEqual(await chiefJobName('owner','connection'),await chiefJobName('other','connection'));
});
test('a large native job snapshot remains valid JSON and retains quiet/pause controls',()=>{
 const data=fixture({goals:Array.from({length:12},(_,i)=>({...goal,id:'g'+i,sentence:'긴 목표 '.repeat(30)})),tasks:Array.from({length:20},(_,i)=>task('t'+i,{title:'진행할 업무 '.repeat(20),blocker:'긴 차단 사유 '.repeat(20)})),chief:{settings:{tone:'firm',quietStart:1320,quietEnd:480,pausedUntil:'2026-09-10T00:00:00Z'}}});
 const prompt=scheduledPrompt(data,{...save,name:'name',connectionId:'connection',snapshotAt:now.toISOString()},now),snapshot=JSON.parse(prompt.split('Snapshot DATA (bounded catalog): ')[1]);
 assert.equal(snapshot.quietEnd,480);assert.equal(snapshot.pausedUntil,'2026-09-10T00:00:00Z');assert.ok(prompt.length<=5000);
});
test('a failed remote change keeps confirmed settings and refresh retries all pending fields',()=>backgroundFixture(async db=>{
 let job,fail=false;globalThis.fetch=async(url,init={})=>{if(!init.method)return Response.json({jobs:job?[job]:[]});if(fail)throw new Error('unavailable');const payload=JSON.parse(init.body);job={...job,...payload,id:'abc123def456',enabled:true};return Response.json({job})};
 const first=await changeChiefSchedule(db,'owner',save,env);fail=true;await assert.rejects(()=>changeChiefSchedule(db,'owner',{...save,hours:6,delivery:'telegram'},env));
 const uncertain=await chiefScheduleStatus(db,'owner',env);assert.equal(uncertain.uncertain,true);assert.equal(uncertain.settings.hours,12);assert.equal(uncertain.settings.snapshotAt,first.settings.snapshotAt);
 await db.prepare('UPDATE orbit_chief_jobs SET lease_until=0 WHERE owner_id=?').bind('owner').run();fail=false;
 const refreshed=await changeChiefSchedule(db,'owner',{action:'refresh'},env);assert.equal(refreshed.uncertain,false);assert.equal(job.schedule,'every 6h');assert.equal(job.deliver,'telegram');
}));
test('foreground sync is opt-in and transfers new pause settings without resetting the timer',()=>backgroundFixture(async db=>{
 let requests=0,job,patch;
 globalThis.fetch=async(url,init={})=>{requests++;if(!init.method)return Response.json({jobs:job?[job]:[]});patch=JSON.parse(init.body);job={...job,...patch,id:'abc123def456',enabled:true};return Response.json({job})};
 assert.equal((await changeChiefSchedule(db,'owner',{action:'sync'},env)).inactive,true);assert.equal(requests,0);
 await changeChiefSchedule(db,'owner',save,env);
 const snapshot=await readWorkspace(db,'owner');await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'chief.settings',settings:{tone:'gentle',quietStart:1320,quietEnd:480,pausedUntil:'2099-09-10T00:00:00Z'}}});
 await changeChiefSchedule(db,'owner',{action:'sync'},env);assert.deepEqual(Object.keys(patch),['prompt']);assert.ok(job.prompt.includes('2099-09-10T00:00:00Z'));
}));
