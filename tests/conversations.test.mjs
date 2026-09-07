import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {createConversation,getConversation,listConversations,updateConversation} from '../lib/orbit/agent/conversations.ts';
import {beginTurn,finishTurn,listAgent} from '../lib/orbit/agent/repository.ts';
import {runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {readWorkspace,writeCommand} from '../db/repository.ts';
const at='2026-09-06T00:00:00.000Z',project={id:'p',name:'프로젝트',color:'#5558e8',symbol:'P',goal:'결과물',due:'2026-09-30',priority:3};
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=fetch;db.close()}}
async function create(db,projectId=null,owner='a',title='새 대화'){return createConversation(db,owner,{id:randomUUID(),title,projectId})}
async function stage(db,conversationId,input='메시지',owner='a',withCard=false){const id=randomUUID(),turn=await beginTurn(db,owner,id,input,conversationId),cards=withCard?[{id:randomUUID(),turnId:id,title:input+' 카드',reason:'후속 행동',action:{type:'project.upsert',project},expectedRevision:0,state:'pending',note:'',revisitDate:null,createdAt:at}]:[];await finishTurn(db,owner,id,turn.lease,{text:input+' 답변',sources:[]},cards);return {id,cards}}
async function projectWrite(db,owner='a'){return writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project}})}
test('schema upgrade preserves old turns, proposals and serialized in-flight Hermes jobs',async()=>{
 const ids=[randomUUID(),randomUUID(),randomUUID()],card=randomUUID(),job=JSON.stringify({phase:'poll',sessionKey:'old-native-key',request:{input:'original body'},runId:'native-run'});
 const db=createDatabase((file,sqlite)=>{if(!file.startsWith('0007_'))return;for(let i=0;i<3;i++)sqlite.prepare("INSERT INTO orbit_agent_turns(owner_id,id,input,status,response_json,created_at,updated_at) VALUES('a',?,?,?,?,?,?)").run(ids[i],'기존 '+i,['completed','failed','running'][i],'{}',at,at);sqlite.prepare("INSERT INTO orbit_agent_actions(owner_id,id,turn_id,title,reason,action_json,expected_revision,state,note,revisit_date,result_json,created_at,updated_at) VALUES('a',?,?,'기존 제안','근거','{}',0,'deferred','보류',NULL,'{}',?,?)").run(card,ids[0],at,at);sqlite.prepare("INSERT INTO orbit_hermes_jobs(owner_id,turn_id,turn_lease,job_json,lease_until) VALUES('a',?,?,?,123)").run(ids[2],at,job)});
 try{for(let i=0;i<2;i++){const all=await listConversations(db,'a');assert.equal(all.items.length,1);assert.equal(all.items[0].title,'이전 대화');assert.equal(all.items[0].createdAt,at)}const state=await listAgent(db,'a');assert.deepEqual(new Set(state.turns.map(t=>t.id)),new Set(ids));assert.ok(state.turns.every(t=>t.conversationId==='legacy'&&t.createdAt===at));assert.equal(state.pendingActions[0].id,card);assert.equal(state.pendingActions[0].state,'deferred');assert.deepEqual(state.activeRun,{id:ids[2],conversationId:'legacy'});const saved=await db.prepare('SELECT * FROM orbit_hermes_jobs').first();assert.equal(saved.job_json,job);assert.equal(saved.turn_lease,at);assert.equal(saved.lease_until,123);assert.equal((await listConversations(db,'empty')).items.length,0)}finally{db.close()}
});
test('conversation ownership, project ownership and metadata revision checks are enforced',()=>fixture(async db=>{
 await projectWrite(db);const c=await create(db,'p');await assert.rejects(()=>getConversation(db,'b',c.id),e=>e.status===404);await assert.rejects(()=>create(db,'p','b'),e=>e.code==='PROJECT');await assert.rejects(()=>updateConversation(db,'b',{id:c.id,title:'변경',projectId:null,expectedRevision:0}),e=>e.status===404);
 const other=await createConversation(db,'b',{id:c.id,title:'다른 소유자',projectId:null});assert.equal(other.title,'다른 소유자');const renamed=await updateConversation(db,'a',{id:c.id,title:'회의 후속 업무',projectId:null,expectedRevision:0});assert.equal(renamed.revision,1);await assert.rejects(()=>updateConversation(db,'a',{id:c.id,title:'오래된 편집',projectId:null,expectedRevision:0}),e=>e.code==='CONFLICT');await stage(db,c.id,'첫 메시지');assert.equal((await getConversation(db,'a',c.id)).title,'회의 후속 업무');const auto=await create(db);await stage(db,auto.id,'첫 줄\n두 번째 줄');assert.equal((await getConversation(db,'a',auto.id)).title,'첫 줄 두 번째 줄');assert.equal((await getConversation(db,'b',c.id)).title,'다른 소유자');
}));
test('transcripts and running limits are conversation-scoped while review queue remains owner-wide',()=>fixture(async db=>{
 const a=await create(db),b=await create(db);const prior=await stage(db,a.id,'A_ONLY', 'a',true);await stage(db,b.id,'B_ONLY','a',true);const state=await listAgent(db,'a',undefined,b.id);assert.equal(state.turns.length,1);assert.equal(state.actions.length,1);assert.equal(state.pendingActions.length,2);assert.ok(state.pendingActions.some(c=>c.turnId===prior.id&&c.conversationId===a.id));assert.ok(!JSON.stringify(state.actions).includes('A_ONLY'));
 const pending=await beginTurn(db,'a',randomUUID(),'아직 실행 중',a.id);await beginTurn(db,'a',randomUUID(),'동시 실행',b.id);await assert.rejects(()=>beginTurn(db,'a',randomUUID(),'같은 대화 중복',b.id),e=>e.code==='BUSY');const current=await getConversation(db,'a',a.id);await assert.rejects(()=>updateConversation(db,'a',{id:a.id,title:'응답 중 이동',projectId:null,expectedRevision:current.revision}),e=>e.code==='CONFLICT');assert.equal((await listAgent(db,'a',undefined,b.id)).activeRun.conversationId,b.id);assert.equal((await listAgent(db,'a',undefined,b.id)).activeRuns.length,2);assert.equal((await listAgent(db,'a',undefined,'new')).activeRun,null);assert.ok(pending.lease);
}));
test('compound cursors never skip tied timestamps or leak another thread or owner',()=>fixture(async db=>{
 const a=await create(db),b=await create(db),ids=[];
 for(let i=0;i<61;i++){const id=randomUUID();ids.push(id);await db.prepare("INSERT INTO orbit_agent_turns(owner_id,id,conversation_id,input,status,response_json,created_at,updated_at) VALUES('a',?,?,'tied','completed','{}',?,?)").bind(id,a.id,at,at).run()}
 await stage(db,b.id,'DISTRACTOR');let cursor,found=[];do{const page=await listAgent(db,'a',cursor,a.id);found.push(...page.turns.map(t=>t.id));cursor=page.nextBefore??undefined}while(cursor);assert.deepEqual(new Set(found),new Set(ids));assert.equal(found.length,61);
 for(let i=0;i<51;i++)await create(db);await create(db,null,'b');await db.prepare('UPDATE orbit_conversations SET updated_at=?').bind(at).run();let chats=[];cursor=undefined;do{const page=await listConversations(db,'a',{before:cursor});chats.push(...page.items.map(c=>c.id));cursor=page.nextBefore??undefined}while(cursor);assert.equal(chats.length,53);assert.equal(new Set(chats).size,53);await assert.rejects(()=>listConversations(db,'a',{before:'bad'}));
}));
test('project deletion unassigns chats atomically, preserves messages and can be replayed',()=>fixture(async db=>{
 await projectWrite(db);await projectWrite(db,'b');const a=await create(db,'p'),b=await create(db,'p','b');await stage(db,a.id,'보존할 대화','a',true);const before=await getConversation(db,'a',a.id),command={operationId:randomUUID(),expectedRevision:1,action:{type:'project.delete',id:'p'}};
 await db.prepare("CREATE TRIGGER prevent_unassign BEFORE UPDATE ON orbit_conversations WHEN NEW.project_id IS NULL BEGIN SELECT RAISE(ABORT,'test failure'); END").run();await assert.rejects(()=>writeCommand(db,'a',command));assert.equal((await readWorkspace(db,'a')).revision,1);assert.equal((await getConversation(db,'a',a.id)).projectId,'p');assert.equal(await db.prepare('SELECT * FROM orbit_mutations WHERE operation_id=?').bind(command.operationId).first(),null);await db.prepare('DROP TRIGGER prevent_unassign').run();
 await writeCommand(db,'a',command);await writeCommand(db,'a',command);const after=await getConversation(db,'a',a.id);assert.equal(after.projectId,null);assert.equal(after.revision,before.revision+1);assert.equal((await listAgent(db,'a',undefined,a.id)).actions.length,1);assert.equal((await getConversation(db,'b',b.id)).projectId,'p');assert.equal((await listConversations(db,'a',{projectId:null})).items.length,1);await assert.rejects(()=>updateConversation(db,'a',{id:a.id,title:'재연결',projectId:'p',expectedRevision:after.revision}),e=>e.code==='CONFLICT');
}));
test('Hermes history and stable native sessions are conversation-scoped, including completed retries',()=>fixture(async db=>{
 const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};await saveConnection(db,'a','hermes',{endpoint:'https://hermes.example.com',token:'test-token',connectionId:'test-connection'},{connected:true},env.ORBIT_ENCRYPTION_KEY);const a=await create(db),b=await create(db);await stage(db,a.id,'A_PRIVATE','a',true);await stage(db,b.id,'B_PRIVATE','a',true);let current,keys=[],posts=0;
 globalThis.fetch=async(url,options)=>{if(options.method==='POST'){posts++;const body=JSON.parse(options.body),history=JSON.stringify(body.conversation_history);assert.ok(history.includes(current===a.id?'A_PRIVATE':'B_PRIVATE'));assert.ok(!history.includes(current===a.id?'B_PRIVATE':'A_PRIVATE'));assert.ok(!body.input.includes(current===a.id?'B_PRIVATE':'A_PRIVATE'));keys.push(options.headers['X-Hermes-Session-Key']);return Response.json({run_id:'run_1',status:'started'},{status:202})}return Response.json({run_id:'run_1',object:'hermes.run',status:'completed',output:JSON.stringify({kind:'final',text:'각 대화의 답변',proposals:[]})})};
 let last;for(current of [a.id,b.id,a.id]){last={id:randomUUID(),conversationId:current,message:'이어서'};await runAgent(db,'a',last,env);await advanceAgent(db,'a',last.id,env);await advanceAgent(db,'a',last.id,env)}assert.equal(keys[0],keys[2]);assert.notEqual(keys[0],keys[1]);await runAgent(db,'a',last,env);await assert.rejects(()=>runAgent(db,'a',{...last,conversationId:b.id},env),e=>e.code==='CONFLICT');assert.equal(posts,3);
}));

test('same-millisecond duplicate claims never update conversation metadata',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(at)});
 await fixture(async db=>{const c=await create(db),id=randomUUID();await beginTurn(db,'a',id,'처음 보내기',c.id);const before=await getConversation(db,'a',c.id);await assert.rejects(()=>beginTurn(db,'a',id,'처음 보내기',c.id),e=>e.code==='BUSY');assert.deepEqual(await getConversation(db,'a',c.id),before)});
});
test('approval cards preserve prerequisite order even when random IDs sort differently',()=>fixture(async db=>{
 const c=await create(db),id=randomUUID(),turn=await beginTurn(db,'a',id,'순서 보존',c.id);const cards=['ffffffff-ffff-4fff-8fff-ffffffffffff','00000000-0000-4000-8000-000000000000'].map((cardId,i)=>({id:cardId,turnId:id,title:i?'후속 업무':'선행 프로젝트',reason:'순서',action:{type:'project.upsert',project},expectedRevision:0,state:'pending',note:'',revisitDate:null,createdAt:at}));await finishTurn(db,'a',id,turn.lease,{text:'승인 순서',sources:[]},cards);const state=await listAgent(db,'a',undefined,c.id);assert.deepEqual(state.actions.map(c=>c.title),['선행 프로젝트','후속 업무']);assert.deepEqual(state.pendingActions.map(c=>c.title),['선행 프로젝트','후속 업무']);
}));
test('a different conversation cannot bypass the owner-wide 200-card review limit',()=>fixture(async db=>{
 const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};await saveConnection(db,'a','hermes',{endpoint:'https://hermes.example.com',token:'test',connectionId:'test'},{connected:true},env.ORBIT_ENCRYPTION_KEY);const a=await create(db),b=await create(db),turn=await stage(db,a.id);for(let i=0;i<200;i++)await db.prepare("INSERT INTO orbit_agent_actions(owner_id,id,turn_id,title,reason,action_json,expected_revision,state,note,revisit_date,result_json,created_at,updated_at) VALUES('a',?,?,'보류한 변경','근거','{}',0,'deferred','보류',NULL,'{}',?,?)").bind(randomUUID(),turn.id,at,at).run();globalThis.fetch=async(url,options)=>options.method==='POST'?Response.json({run_id:'run_1',status:'started'}):Response.json({object:'hermes.run',run_id:'run_1',status:'completed',output:JSON.stringify({kind:'final',text:'새 제안',proposals:[{title:'프로젝트',reason:'결과물',action:{type:'project.upsert',project}}]})});const input={id:randomUUID(),conversationId:b.id,message:'다른 대화에서 제안'};await runAgent(db,'a',input,env);await advanceAgent(db,'a',input.id,env);await assert.rejects(()=>advanceAgent(db,'a',input.id,env),e=>e.code==='QUEUE_FULL');assert.equal((await listAgent(db,'a',undefined,b.id)).actions.length,0);
}));

test('two native Hermes requests stay in flight together and completion or cancellation stays in its own thread',async t=>{
 t.setTimeout?.(10000);
 await fixture(async db=>{
  const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};await saveConnection(db,'a','hermes',{endpoint:'https://hermes.example.com',token:'test',connectionId:'parallel'},{connected:true},env.ORBIT_ENCRYPTION_KEY);
  const a=await create(db),b=await create(db),first={id:randomUUID(),conversationId:a.id,message:'A_PRIVATE'},second={id:randomUUID(),conversationId:b.id,message:'B_PRIVATE'};
  await runAgent(db,'a',first,env);await runAgent(db,'a',second,env);
  const startA=Promise.withResolvers(),startB=Promise.withResolvers(),releaseA=Promise.withResolvers(),releaseB=Promise.withResolvers(),keys=[];
  globalThis.fetch=async(url,options={})=>{
   if(url.endsWith('/stop'))return Response.json({status:'stopping'});
   if(options.method==='POST'){
    const request=JSON.parse(options.body),isA=request.input.includes('A_PRIVATE');assert.ok(!request.input.includes(isA?'B_PRIVATE':'A_PRIVATE'));
    keys.push({session:options.headers['X-Hermes-Session-Key'],idempotency:options.headers['Idempotency-Key'],body:request.session_id});
    (isA?startA:startB).resolve();await (isA?releaseA:releaseB).promise;return Response.json({run_id:isA?'run_a':'run_b',status:'started'},{status:202});
   }
   const isA=url.endsWith('/run_a');return Response.json({object:'hermes.run',run_id:isA?'run_a':'run_b',status:isA?'running':'completed',output:JSON.stringify({kind:'final',text:'B 결과',proposals:[]})});
  };
  const requestA=advanceAgent(db,'a',first.id,env);await startA.promise;
  const requestB=advanceAgent(db,'a',second.id,env);await startB.promise;
  assert.equal((await listAgent(db,'a',undefined,'new')).activeRuns.length,2);
  assert.notEqual(keys[0].session,keys[1].session);assert.notEqual(keys[0].idempotency,keys[1].idempotency);assert.notEqual(keys[0].body,keys[1].body);
  releaseB.resolve();await requestB;releaseA.resolve();await requestA;
  await advanceAgent(db,'a',second.id,env);
  assert.equal((await listAgent(db,'a',undefined,b.id)).turns[0].text,'B 결과');assert.equal((await listAgent(db,'a',undefined,a.id)).turns[0].status,'running');
  await advanceAgent(db,'a',first.id,env,true);assert.equal((await listAgent(db,'a',undefined,b.id)).turns[0].status,'completed');
  assert.equal((await listAgent(db,'other',undefined,'new')).activeRuns.length,0);
 });
});

test('daily strategy runs independently of chat and duplicate generation for the same date is serialized',()=>fixture(async db=>{
 const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};await saveConnection(db,'a','hermes',{endpoint:'https://hermes.example.com',token:'test',connectionId:'parallel'},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 const c=await create(db);await runAgent(db,'a',{id:randomUUID(),conversationId:c.id,message:'일반 대화'},env);
 const planning={date:'2026-09-10',energy:'normal'},id=randomUUID();await runAgent(db,'a',{id,message:'내일 전략',planning},env);
 let all=(await listAgent(db,'a',undefined,c.id)).activeRuns;assert.equal(all.length,2);assert.ok(all.find(r=>r.id===id).conversationId!==c.id);
 await assert.rejects(()=>runAgent(db,'a',{id:randomUUID(),message:'다시 생성',planning},env),e=>e.code==='BUSY');
 await runAgent(db,'a',{id:randomUUID(),message:'다른 날짜 전략',planning:{...planning,date:'2026-09-11'}},env);assert.equal((await listAgent(db,'a',undefined,c.id)).activeRuns.length,3);
}));

test('gateway capacity waits back off with the original submission key and do not block another conversation',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-08T00:00:00Z')});
 await fixture(async db=>{
  const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};await saveConnection(db,'a','hermes',{endpoint:'https://hermes.example.com',token:'test',connectionId:'parallel'},{connected:true},env.ORBIT_ENCRYPTION_KEY);
  const a=await create(db),b=await create(db),id=randomUUID();await runAgent(db,'a',{id,message:'한도 대기',conversationId:a.id},env);
  const keys=[];globalThis.fetch=async(url,options)=>{keys.push(options.headers['Idempotency-Key']);return keys.length===1?Response.json({error:'capacity'},{status:429}):Response.json({run_id:'run_resumed',status:'started'},{status:202})};
  await advanceAgent(db,'a',id,env);assert.match((await listAgent(db,'a',undefined,a.id)).turns[0].progress,/동시 실행 한도/);
  await advanceAgent(db,'a',id,env);assert.equal(keys.length,1);
  await runAgent(db,'a',{id:randomUUID(),message:'별도 대화',conversationId:b.id},env);assert.equal((await listAgent(db,'a',undefined,'new')).activeRuns.length,2);
  t.mock.timers.tick(5001);await advanceAgent(db,'a',id,env);assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
 });
});
