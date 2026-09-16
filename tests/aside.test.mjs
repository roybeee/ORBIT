import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {asideInput,changeAsideJob,listAsideJobs} from '../lib/orbit/aside/jobs.ts';
const enqueue=(id=randomUUID())=>({action:'enqueue',id,title:'Read reports',instruction:'Read the public reports and list source URLs.',workflow:'research',projectId:''});
test('ASIDE ownership, immutable inputs, project ownership, capacity and idempotency',async()=>{
 const db=createDatabase();try{
  const input=enqueue(),first=await changeAsideJob(db,'a',input);
  assert.deepEqual(await changeAsideJob(db,'a',input),first);
  assert.equal((await listAsideJobs(db,'b')).length,0);
  await assert.rejects(changeAsideJob(db,'b',{action:'cancel',id:first.id}),{status:404});
  await assert.rejects(changeAsideJob(db,'a',{...input,title:'Changed'}),{status:409});
  await assert.rejects(changeAsideJob(db,'a',{...enqueue(),projectId:'not-owned'}),{status:422});
  for(let i=1;i<30;i++)await changeAsideJob(db,'a',enqueue());
  await assert.rejects(changeAsideJob(db,'a',enqueue()),{status:409});
  assert.equal(asideInput.safeParse({...input,ownerId:'b'}).success,false);
 }finally{db.close()}
});
test('only one PC/run claims work; stop and terminal states cannot regress',async()=>{
 const db=createDatabase();try{
  const a=await changeAsideJob(db,'a',enqueue()),b=await changeAsideJob(db,'a',enqueue());
  const bridgeId=randomUUID();
  const claims=await Promise.allSettled([changeAsideJob(db,'a',{action:'claim',id:a.id,bridgeId,account:'account'}),changeAsideJob(db,'a',{action:'claim',id:b.id,bridgeId:randomUUID(),account:'account'})]);
  assert.equal(claims.filter(x=>x.status==='fulfilled').length,1);
  const running=claims.find(x=>x.status==='fulfilled').value;
  const queued=running.id===a.id?b:a;
  await assert.rejects(changeAsideJob(db,'a',{action:'claim',id:running.id,bridgeId:randomUUID(),account:'account'}),{status:409});
  await assert.rejects(changeAsideJob(db,'a',{action:'claim',id:running.id,bridgeId:running.bridgeId,account:'account'}),{status:409});
  assert.equal((await listAsideJobs(db,'a')).find(j=>j.id===running.id).runId,running.runId);
  const identity={id:running.id,bridgeId:running.bridgeId,runId:running.runId};
  const report={action:'report',...identity,seq:1,status:'running',progress:'one',result:''};
  await changeAsideJob(db,'a',report);
  const stale=await changeAsideJob(db,'a',{...report,progress:'stale'});assert.equal(stale.progress,'one');
  await changeAsideJob(db,'a',{action:'cancel',id:running.id});
  assert.equal((await changeAsideJob(db,'a',{...report,seq:2})).status,'stop_requested');
  assert.equal((await changeAsideJob(db,'a',{...report,seq:3,status:'needs_review',result:'Result'})).status,'needs_attention');
  assert.equal((await changeAsideJob(db,'a',{...report,seq:4})).status,'needs_attention');
  const late=await changeAsideJob(db,'a',{...report,seq:5,status:'needs_review',result:'Recovered final output'});assert.equal(late.status,'needs_attention');assert.equal(late.result,'Recovered final output');
  await assert.rejects(changeAsideJob(db,'a',{action:'claim',id:queued.id,bridgeId:randomUUID(),account:'account'}),{status:409});
  await changeAsideJob(db,'a',{action:'resolve',...identity});
  assert.equal((await changeAsideJob(db,'a',{...report,seq:6,status:'needs_review'})).status,'cancelled');
  assert.equal((await changeAsideJob(db,'a',{action:'claim',id:queued.id,bridgeId:randomUUID(),account:'account'})).status,'running');
 }finally{db.close()}
});
test('reconnect recovers the assigned run; completion requires explicit result review',async()=>{
 const db=createDatabase();try{
  const job=await changeAsideJob(db,'a',enqueue()),bridgeId=randomUUID();
  const running=await changeAsideJob(db,'a',{action:'claim',id:job.id,bridgeId,account:'paid-account'});
  await assert.rejects(changeAsideJob(db,'a',{action:'complete',id:job.id}),{status:409});
  await assert.rejects(changeAsideJob(db,'a',{action:'report',id:job.id,bridgeId:randomUUID(),runId:running.runId,seq:1,status:'needs_review',progress:'done',result:'answer'}),{status:409});
  const report={action:'report',id:job.id,bridgeId,runId:running.runId,seq:10,status:'needs_review',progress:'done',result:'answer'};
  assert.equal((await changeAsideJob(db,'a',report)).status,'needs_review');
  assert.equal((await changeAsideJob(db,'a',{action:'complete',id:job.id})).status,'completed');
  assert.equal((await changeAsideJob(db,'a',{...report,seq:11})).status,'completed');
 }finally{db.close()}
});
