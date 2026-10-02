import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceWrites,instantAction} from '../lib/orbit/workspace-write-client.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {readWorkspace,writeCommand,RevisionConflict} from '../db/repository.ts';
import {createDatabase} from './sqlite-d1.mjs';

const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const project={id:'p',name:'P',color:'#5558e8',symbol:'P',goal:'',due:'2099-12-31',priority:3};
const task={id:'t',title:'샘플 발송',projectId:'p',status:'todo',duration:30,due:today,impact:3,focus:false,definition:'발송 확인'};
async function fixture(run){
 const db=createDatabase();
 try{
  await writeCommand(db,'owner',{operationId:crypto.randomUUID(),expectedRevision:0,action:{type:'project.upsert',project}});
  await writeCommand(db,'owner',{operationId:crypto.randomUUID(),expectedRevision:1,action:{type:'task.upsert',task}});
  await writeCommand(db,'owner',{operationId:crypto.randomUUID(),expectedRevision:2,action:{type:'habit.upsert',habit:{id:'h',title:'물 2L',mode:'keep',startedOn:today,log:[]}}});
  let release=()=>{};const gate={promise:Promise.resolve()},state={online:true};
  const client=new WorkspaceWrites(await readWorkspace(db,'owner'),{post:async cmd=>{await gate.promise;try{return await writeCommand(db,'owner',cmd)}catch(e){throw e instanceof RevisionConflict?{code:'CONFLICT',message:e.message}:{code:'INPUT',message:e.message}}},read:()=>readWorkspace(db,'owner'),persist:()=>{},change:()=>{},online:()=>state.online});
  const settle=async()=>{while(client.running)await new Promise(r=>setTimeout(r,1));};
  await run({db,client,settle,state,hold:()=>{gate.promise=new Promise(r=>release=r)},release:()=>release()});
 }finally{db.close()}
}

test('completing with a record, starting focus and checking a habit never lock the screen',()=>{
 for(const type of ['task.record','task.start','task.stop','habit.check','care.check','proposal.approve','proposal.defer'])assert.equal(instantAction({type}),true,type);
 for(const type of ['review.save','review.saveGenerate','proposal.generate','task.delete','project.delete','note.delete'])assert.equal(instantAction({type}),false,type);
});

test('a recorded completion shows before the server answers and commits once',()=>fixture(async f=>{
 f.hold();
 assert.equal(await f.client.enqueue({type:'task.record',id:'t',outcome:'done',actualMinutes:40}),true);
 assert.equal(f.client.blocking,false);
 assert.equal(f.client.view.data.tasks[0].status,'done');
 assert.equal(await f.client.enqueue({type:'habit.check',id:'h',date:today,checked:true}),true);
 assert.deepEqual(f.client.view.data.habits[0].log,[today]);
 f.release();await f.settle();
 const saved=(await readWorkspace(f.db,'owner')).data;
 assert.equal(saved.tasks[0].status,'done');assert.equal(saved.tasks[0].actualMinutes,40);assert.deepEqual(saved.habits[0].log,[today]);
 assert.equal(f.client.queue.length,0);
}));

test('a check-off on a task another device already changed is held, not applied over it',()=>fixture(async f=>{
 f.state.online=false;
 assert.equal(await f.client.enqueue({type:'task.record',id:'t',outcome:'partial',reason:'time'}),true);
 assert.equal(f.client.view.data.tasks[0].outcome,'partial');
 // While this device was offline, the other device completed the task.
 const current=await readWorkspace(f.db,'owner');
 await writeCommand(f.db,'owner',{operationId:crypto.randomUUID(),expectedRevision:current.revision,action:{type:'task.status',id:'t',status:'done'}});
 f.state.online=true;await f.client.flush();await f.settle();
 assert.equal(f.client.queue[0].blocked,true);assert.equal(f.client.failure.code,'CONFLICT');
 const saved=(await readWorkspace(f.db,'owner')).data.tasks[0];
 assert.equal(saved.status,'done');assert.notEqual(saved.outcome,'partial','the other device\'s completion stands');
}));
