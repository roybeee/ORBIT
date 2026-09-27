import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceWrites,restoreWrites,rebaseWrite} from '../lib/orbit/workspace-write-client.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {readWorkspace,writeCommand,RevisionConflict} from '../db/repository.ts';
import {createDatabase} from './sqlite-d1.mjs';
const project=(id,name=id)=>({id,name,color:'#5558e8',symbol:'O',goal:'Ship',due:'2026-10-01',priority:5});
const action=(id,name=id)=>({type:'project.upsert',project:project(id,name)});
const snapshot=()=>({data:emptyWorkspace(),revision:0,updatedAt:null});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()}};
async function fixture(run){
 const db=createDatabase();let persisted=[],calls=[],online=true,hold=null,lost=false;
 const post=async cmd=>{calls.push(structuredClone(cmd));if(hold)await hold.promise;try{const result=await writeCommand(db,'owner',cmd);if(lost){lost=false;throw new Error('lost reply')}return result}catch(e){if(e instanceof RevisionConflict)throw {code:'CONFLICT',message:e.message};throw e}};
 const client=new WorkspaceWrites(snapshot(),{post,read:()=>readWorkspace(db,'owner'),persist:q=>{persisted=structuredClone(q)},change:()=>{},online:()=>online});
 const flush=async()=>{while(client.running)await new Promise(r=>setTimeout(r,1));};
 try{await run({db,client,flush,calls,get persisted(){return persisted},set online(v){online=v},set hold(v){hold=v},set lost(v){lost=v}});}finally{db.close()}
}
test('slow server: local display and subsequent saves proceed immediately, then commit in order',()=>fixture(async f=>{
 const gate=deferred();f.hold=gate;
 assert.equal(await f.client.enqueue(action('a')),true);
 assert.equal(f.client.view.data.projects[0].id,'a');
 assert.equal(await f.client.enqueue(action('b')),true);
 assert.equal(f.client.view.data.projects.length,2);assert.equal(f.calls.length,1);assert.equal(f.persisted.length,2);
 gate.resolve();await f.flush();
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].expectedRevision,1);assert.equal(f.client.snapshot.revision,2);assert.equal(f.persisted.length,0);
}));
test('unrelated remote changes automatically rebase while preserving both records',()=>fixture(async f=>{
 await writeCommand(f.db,'owner',{operationId:crypto.randomUUID(),expectedRevision:0,action:action('other')});
 await f.client.enqueue(action('mine'));await f.flush();
 assert.deepEqual(f.client.snapshot.data.projects.map(p=>p.id).sort(),['mine','other']);assert.equal(f.client.failure,null);
}));
test('lost reply replays identical operation before rebase, never duplicates a committed creation',()=>fixture(async f=>{
 f.lost=true;await f.client.enqueue(action('a'));await f.flush();
 assert.equal(f.client.queue.length,1);
 const recovered=new WorkspaceWrites(f.client.snapshot,{post:async c=>{assert.equal(c.operationId,f.calls[0].operationId);return writeCommand(f.db,'owner',c)},read:()=>readWorkspace(f.db,'owner'),persist:()=>{},change:()=>{},online:()=>true});
 recovered.queue=restoreWrites(f.persisted);await recovered.flush();
 assert.equal(recovered.snapshot.revision,1);assert.equal(recovered.snapshot.data.projects.length,1);assert.equal(recovered.queue.length,0);
}));
test('same field conflict preserves input and does not block an unrelated save',()=>fixture(async f=>{
 await f.client.enqueue(action('a'));await f.flush();
 await writeCommand(f.db,'owner',{operationId:crypto.randomUUID(),expectedRevision:1,action:action('a','Other device')});
 await f.client.enqueue(action('a','My edit'));await f.flush();
 assert.equal(f.client.queue[0].blocked,true);assert.equal(f.persisted[0].command.action.project.name,'My edit');
 assert.equal(f.client.view.data.projects[0].name,'Other device');
 await f.client.enqueue(action('b'));await f.flush();assert.equal(f.client.snapshot.data.projects.length,2);assert.equal(f.client.failure.code,'CONFLICT');
}));
test('different field edits to one entity merge without clobbering either field',()=>fixture(async f=>{
 await f.client.enqueue(action('a'));await f.flush();
 await writeCommand(f.db,'owner',{operationId:crypto.randomUUID(),expectedRevision:1,action:{type:'project.upsert',project:{...project('a'),goal:'Remote goal'}}});
 await f.client.enqueue(action('a','My name'));await f.flush();
 assert.equal(f.client.snapshot.data.projects[0].name,'My name');assert.equal(f.client.snapshot.data.projects[0].goal,'Remote goal');assert.equal(f.client.queue.length,0);
}));
test('offline local queue survives reload and sends once online',()=>fixture(async f=>{
 f.online=false;await f.client.enqueue(action('a'));assert.equal(f.calls.length,0);assert.equal(f.client.view.data.projects.length,1);
 f.client.queue=restoreWrites(f.persisted);f.online=true;await f.client.retry();assert.equal(f.client.snapshot.revision,1);
}));
test('a deleted record cannot be resurrected by rebase and malformed queue entries are ignored',()=>{
 assert.equal(rebaseWrite(action('a'),{revision:1,entity:project('a')},snapshot()),null);
 assert.deepEqual(restoreWrites([{command:{action:{type:'arbitrary'}}}]),[]);
});
test('local persistence failure prevents acknowledgement and network write',async()=>{
 let sent=false;
 const client=new WorkspaceWrites(snapshot(),{post:async()=>{sent=true;return snapshot()},read:async()=>snapshot(),persist:()=>{throw new Error('quota')},change:()=>{},online:()=>true});
 assert.equal(await client.enqueue(action('a')),false);assert.equal(sent,false);assert.equal(client.view.data.projects.length,0);
});
