import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace} from '../db/repository.ts';
import {digest,handleDirective} from '../lib/orbit/slack/directives.ts';

const token='test-only-task-receipt-credential-1234567890';
const wire=()=>({operationKey:'origin:task-receipt',source:{platform:'slack',workspaceId:'TTEST',requesterId:'UTEST',channelId:'CTEST',messageTs:'1790055097.465089',eventId:'EvTASK'},providerStatus:'succeeded',providerError:'',change:{kind:'task',provider:'google_tasks',text:'LG U+ test payment',due:'2026-09-30',providerTaskListId:'test-list',providerTaskId:'test-task',providerEtag:'"test-etag"',providerTaskStatus:'needsAction',providerUrl:'https://tasks.google.com/task/test-task',notesSha256:'0'.repeat(64)}});
async function setup(){const db=createDatabase();await db.prepare("INSERT INTO orbit_slack_credentials(token_hash,owner_id,workspace_id,requester_id,scope,expires_at,revoked) VALUES(?,?,?,?,?,?,0)").bind(await digest(token),'owner','TTEST','UTEST','directives:write',4102444800000).run();return db}
async function call(db,body,query=''){const r=await handleDirective(db,new Request('https://orbit.test/api/integrations/slack/directives'+query,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));return {status:r.status,data:await r.json()}}

test('Google task result is a receipt only: no guessed project, no new Google or ORBIT task, exact replay/readback',async()=>{
 const db=await setup();try{
  const before=await readWorkspace(db,'owner');
  const first=await call(db,wire());assert.equal(first.status,200,JSON.stringify(first.data));
  assert.equal(first.data.status,'completed');assert.equal(first.data.receiptOnly,true);
  assert.equal(first.data.target.type,'google_task');assert.equal(first.data.target.id,'test-task');
  assert.equal(first.data.target.task.ownerId,'owner');assert.equal(first.data.target.task.taskListId,'test-list');
  assert.equal(first.data.target.task.etag,'"test-etag"');assert.equal(first.data.target.task.title,wire().change.text);
  const second=await call(db,wire());assert.equal(second.data.id,first.data.id);
  assert.deepEqual((await call(db,null,'?id='+first.data.id)).data,first.data);
  assert.deepEqual((await call(db,null,'?operationKey=origin%3Atask-receipt')).data,first.data);
  assert.deepEqual(await readWorkspace(db,'owner'),before);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM orbit_slack_directives').first()).n,1);
 }finally{db.close()}
});

test('Task receipts reject incomplete result, source mismatch and changed payload',async()=>{
 const db=await setup();try{
  const bad=wire();delete bad.change.providerEtag;assert.equal((await call(db,bad)).status,422);
  assert.equal((await call(db,{...wire(),source:{...wire().source,requesterId:'OTHER'}})).status,403);
  await call(db,wire());assert.equal((await call(db,{...wire(),change:{...wire().change,text:'invented'}})).status,409);
  await db.prepare('UPDATE orbit_slack_credentials SET revoked=1').run();assert.equal((await call(db,wire())).status,401);
 }finally{db.close()}
});
