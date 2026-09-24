import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {writeCommand,readWorkspace} from '../db/repository.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {todayInZone,addDays} from '../lib/orbit/dates.ts';
import {gotemMetrics} from '../lib/orbit/slack/gotem-metrics.ts';

const today=todayInZone('Asia/Seoul');
const project={id:'p',name:'투자',goal:'g',due:'2099-01-01',priority:3,color:'#445566',symbol:'P',status:'active'};
const task=(id)=>({id,title:'업무 '+id,projectId:'p',status:'todo',due:today,impact:3,focus:false,duration:30,definition:''});
async function seeded(fn){const db=createDatabase();try{let revision=0;const send=async(action,operationId=randomUUID(),now)=>{const out=await writeCommand(db,'owner',{operationId,expectedRevision:revision,action},now);revision=out.revision;return out};
 await send({type:'preferences.update',preferences:{...emptyWorkspace().preferences,workDays:[0,1,2,3,4,5,6]}});await send({type:'project.upsert',project});await send({type:'task.upsert',task:task('a')});await send({type:'task.upsert',task:task('b')});
 await fn(db,send)}finally{db.close()}}
const starts=db=>db.prepare("SELECT task_id,started_at,date FROM orbit_task_starts WHERE owner_id='owner' ORDER BY started_at").all().then(r=>r.results.map(row=>({...row})));

test('every focus start is recorded once, with the workspace write that started it',async()=>{await seeded(async(db,send)=>{
 const first=new Date(today+'T09:20:00+09:00');
 await send({type:'task.start',id:'a'},'start-a',first);
 assert.deepEqual(await starts(db),[{task_id:'a',started_at:first.toISOString(),date:today}]);
 // Replaying the same command (lost response) does not add a second start.
 const {revision}=await readWorkspace(db,'owner');
 await writeCommand(db,'owner',{operationId:'start-a',expectedRevision:revision-1,action:{type:'task.start',id:'a'}},first);
 assert.equal((await starts(db)).length,1);
 // Starting a second task while one runs is refused by the reducer, so nothing is logged.
 await assert.rejects(()=>send({type:'task.start',id:'b'}));
 assert.equal((await starts(db)).length,1);
 await send({type:'task.stop',id:'a'},undefined,new Date(today+'T09:50:00+09:00'));
 const again=new Date(today+'T13:05:00+09:00');
 await send({type:'task.start',id:'a'},undefined,again);
 assert.deepEqual((await starts(db)).map(r=>r.started_at),[first.toISOString(),again.toISOString()]);
})});

async function sendRow(db,date,status,{taskId=null,carryReviewDate=null,at='09:00'}={}){
 const dataAt=new Date(`${date}T${at}:00+09:00`).toISOString();
 await db.prepare('INSERT INTO orbit_gotem_sends(owner_id,date,slot,status,reason,payload_json,created_at) VALUES(?,?,?,?,?,?,?)')
  .bind('owner',date,'morning',status,status==='sent'?'plan':'no_plan',JSON.stringify({reason:'plan',planState:'local',taskId,carryReviewDate,dataAt}),dataAt).run();
}
const startRow=(db,taskId,date,time)=>db.prepare('INSERT INTO orbit_task_starts(owner_id,task_id,started_at,date) VALUES(?,?,?,?)').bind('owner',taskId,new Date(`${date}T${time}:00+09:00`).toISOString(),date).run();

test('morning metric: share of sent mornings started within 60 minutes and the median delay',async()=>{await seeded(async(db)=>{
 const d=(n)=>addDays(today,-n);
 await sendRow(db,d(4),'sent',{taskId:'a'});await startRow(db,'b',d(4),'09:05');await startRow(db,'a',d(4),'09:25');
 await sendRow(db,d(3),'sent',{taskId:'a'});await startRow(db,'a',d(3),'10:30');
 await sendRow(db,d(2),'sent',{taskId:'b'});
 await sendRow(db,d(1),'skipped');
 await sendRow(db,today,'sent');await startRow(db,'b',today,'08:40');await startRow(db,'b',today,'09:10');
 const m=await gotemMetrics(db,'owner',new Date(today+'T23:00:00+09:00'));
 assert.equal(m.morning.sent,4);
 assert.equal(m.morning.started,3);
 assert.equal(m.morning.within60,2);
 assert.equal(m.morning.rate,50);
 assert.equal(m.morning.medianMinutes,25);
 const byDate=Object.fromEntries(m.morning.days.map(x=>[x.date,x]));
 assert.equal(byDate[d(4)].minutes,25,'the message\'s own task counts, not an earlier start of another task');
 assert.equal(byDate[d(3)].within60,false);
 assert.equal(byDate[d(2)].minutes,null);
 assert.equal(byDate[today].minutes,10,'without a task in the message any start after it counts; a start before it does not');
 assert.equal(byDate[d(1)],undefined,'skipped mornings are not in the denominator');
})});

test('carry metric: a chosen improvement counts as reflected when the next morning message carried it',async()=>{await seeded(async(db,send)=>{
 const d=(n)=>addDays(today,-n);
 const review=(date,carry)=>send({type:'review.save',review:{date,win:'',block:'',energy:'normal'},detail:{date,items:[],feedback:[],energy:{},smallWins:[],gratitude:[],habitChecks:[],...(carry?{carry}:{})}});
 await review(d(3),'메일은 오전 블록 뒤에');await sendRow(db,d(2),'sent',{taskId:'a',carryReviewDate:d(3)});
 await review(d(2),'회의 뒤 10분 정리');await sendRow(db,d(1),'sent',{taskId:'a'});
 await review(d(1),'');
 await review(today,'내일은 첫 블록 90분');
 const m=await gotemMetrics(db,'owner',new Date(today+'T23:00:00+09:00'));
 assert.equal(m.carry.eligible,2,'today\'s carry has no next morning yet; an empty review is not counted');
 assert.equal(m.carry.reflected,1);
 assert.equal(m.carry.rate,50);
 assert.deepEqual(m.carry.items.map(i=>[i.reviewDate,i.reflected]),[[d(3),true],[d(2),false]]);
})});
