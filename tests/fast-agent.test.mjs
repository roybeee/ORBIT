import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {driveAgent,agentProgress} from '../lib/orbit/agent/driver.ts';
import {listAgent} from '../lib/orbit/agent/repository.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {chatContextData} from '../lib/orbit/agent/chat-context.ts';
import {beginTurn} from '../lib/orbit/agent/repository.ts';
import {watchAgent} from '../lib/orbit/agent/stream-client.ts';

const base={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const direct={...base,OPENAI_API_KEY:'test-key-not-real',ORBIT_CHAT_MODEL:'gpt-5.6-luna'};
const project={id:'oda',name:'ODA',color:'#5558e8',symbol:'O',goal:'매장 개점',due:'2026-12-31',priority:3};
const proposal={title:'프로젝트 등록',reason:'진행사항을 연결합니다.',action:{type:'project.upsert',project}};
const final=(proposals=[])=>({kind:'final',text:proposals.length?'제안했습니다. 승인하면 반영됩니다.':'확인했습니다.',proposals});
const response=payload=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(payload)}]}]});
const hermes=async db=>saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'native-secret',connectionId:'native'},{connected:true},base.ORBIT_ENCRYPTION_KEY);
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}
async function start(db,env=direct,message='ODA 프로젝트 등록'){const input={id:randomUUID(),message};await runAgent(db,'owner',input,env,{defer:true});return input}

test('direct chat acknowledges durably without Hermes, then stages once through the existing approval boundary',()=>fixture(async db=>{
 let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const payload=JSON.parse(options.body);assert.equal(payload.store,false);assert.equal(payload.model,'gpt-5.6-luna');assert.equal(payload.text.format.type,'json_object');assert.ok(!payload.tools);return response(final([proposal]))};
 const input=await start(db);assert.equal(calls,0);await driveAgent(db,'owner',input.id,direct);assert.equal(calls,1);
 const state=await listAgent(db,'owner');assert.equal(state.turns[0].status,'completed');assert.equal(state.actions.length,1);assert.equal(state.actions[0].state,'pending');assert.equal((await readWorkspace(db,'owner')).revision,0);
 await runAgent(db,'owner',input,direct);await driveAgent(db,'owner',input.id,direct);assert.equal(calls,1);assert.ok(!JSON.stringify(state).includes(direct.OPENAI_API_KEY));await assert.rejects(()=>agentProgress(db,'other',input.id),e=>e.status===404);
}));
test('normal conversation skips an unavailable Calendar even when the account is connected',()=>fixture(async db=>{
 await saveConnection(db,'owner','google_calendar',{clientId:'test',accessToken:'calendar-secret',expiresAt:Date.now()+3600000},{connected:true},base.ORBIT_ENCRYPTION_KEY);
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');assert.match(JSON.parse(options.body).input.at(-1).content,/saved-cache/);return response(final())};
 const input=await start(db);await driveAgent(db,'owner',input.id,direct);assert.equal((await agentProgress(db,'owner',input.id)).status,'completed');
}));
test('legacy Hermes job keeps its transport when direct chat becomes configured',()=>fixture(async db=>{
 await hermes(db);const input=await start(db,base);const row=await db.prepare('SELECT job_json FROM orbit_hermes_jobs').first();const job=JSON.parse(row.job_json);delete job.provider;await db.prepare('UPDATE orbit_hermes_jobs SET job_json=?').bind(JSON.stringify(job)).run();
 let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.ok(url.startsWith('https://hermes.example.com'));return options.method==='POST'?Response.json({run_id:'run_1',status:'started'}):Response.json({object:'hermes.run',run_id:'run_1',status:'completed',output:JSON.stringify(final())})};
 await runAgent(db,'owner',input,direct,{defer:true});await driveAgent(db,'owner',input.id,direct);assert.equal(calls,2);assert.equal((await agentProgress(db,'owner',input.id)).status,'completed');
}));
test('explicit live calendar read can stage a proposal without synchronizing or flushing exports',()=>fixture(async db=>{
 await saveConnection(db,'owner','google_calendar',{clientId:'test',accessToken:'calendar-secret',expiresAt:Date.now()+3600000},{connected:true},base.ORBIT_ENCRYPTION_KEY);let modelCalls=0,calendarCalls=0;
 globalThis.fetch=async(url,options)=>{if(url.startsWith('https://www.googleapis.com/')){calendarCalls++;assert.ok(!options.method||options.method==='GET');return Response.json({items:[]})}modelCalls++;return response(modelCalls===1?{kind:'read',requests:[{tool:'google_calendar_read',arguments:{}}]}:final([proposal]))};
 const input=await start(db);await driveAgent(db,'owner',input.id,direct);assert.equal(calendarCalls,1);assert.equal(modelCalls,2);assert.equal((await agentProgress(db,'owner',input.id)).status,'completed');assert.equal((await listAgent(db,'owner')).actions.length,1);assert.equal((await readWorkspace(db,'owner')).revision,0);assert.equal(await db.prepare('SELECT * FROM orbit_calendar_cache').first(),null);
}));
test('concurrent target edits after a live calendar lookup automatically revalidate before staging',()=>fixture(async db=>{
 await saveConnection(db,'owner','google_calendar',{clientId:'test',accessToken:'calendar-secret',expiresAt:Date.now()+3600000},{connected:true},base.ORBIT_ENCRYPTION_KEY);let modelCalls=0;
 globalThis.fetch=async(url)=>{if(url.startsWith('https://www.googleapis.com/')){await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:proposal.action});return Response.json({items:[]})}modelCalls++;return response(modelCalls===1?{kind:'read',requests:[{tool:'google_calendar_read',arguments:{}}]}:final([proposal]))};
 const input=await start(db);await driveAgent(db,'owner',input.id,direct);assert.equal(modelCalls,3);const cards=(await listAgent(db,'owner')).actions;assert.equal(cards.length,1);assert.equal(cards[0].expectedRevision,1);assert.equal(cards[0].state,'pending');assert.equal((await readWorkspace(db,'owner')).revision,1);
}));
test('read rounds run immediately and verified evidence survives direct transport',()=>fixture(async db=>{
 await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:proposal.action});let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;const payload=JSON.parse(options.body);if(calls===1)return response({kind:'read',requests:[{tool:'workspace_search',arguments:{kind:'projects',query:'ODA'}}]});assert.match(payload.input.at(-1).content,/project:oda/);return response({...final(),evidence:['project:oda']})};
 const input=await start(db);await driveAgent(db,'owner',input.id,direct);assert.equal(calls,2);const state=await listAgent(db,'owner');assert.equal(state.turns[0].status,'completed');assert.equal(state.turns[0].sources[0].recordId,'oda');
}));
test('concurrent advancement and cancellation during inference produce no duplicate request or cards',()=>fixture(async db=>{
 let release,started;const pending=new Promise(resolve=>{release=resolve}),ready=new Promise(resolve=>{started=resolve});let calls=0;
 globalThis.fetch=async()=>{calls++;started();await pending;return response(final([proposal]))};
 const input=await start(db);await advanceAgent(db,'owner',input.id,direct);const inflight=advanceAgent(db,'owner',input.id,direct);await ready;
 await advanceAgent(db,'owner',input.id,direct);await advanceAgent(db,'owner',input.id,direct,true);release();await inflight;await driveAgent(db,'owner',input.id,direct);
 assert.equal(calls,1);const state=await listAgent(db,'owner');assert.equal(state.turns[0].status,'failed');assert.equal(state.actions.length,0);assert.equal((await readWorkspace(db,'owner')).revision,0);
}));
test('ambiguous direct transport loss is terminal and never silently falls back or resubmits',()=>fixture(async db=>{
 await hermes(db);let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('network lost')};const input=await start(db);
 await assert.rejects(()=>driveAgent(db,'owner',input.id,direct),e=>e.code==='OPENAI_NETWORK');await driveAgent(db,'owner',input.id,direct);assert.equal(calls,1);assert.equal((await agentProgress(db,'owner',input.id)).status,'failed');
}));
test('saved attempted direct submission after interruption is not automatically duplicated',()=>fixture(async db=>{
 const input=await start(db);await advanceAgent(db,'owner',input.id,direct);const row=await db.prepare('SELECT job_json FROM orbit_hermes_jobs').first(),job=JSON.parse(row.job_json);job.attempted=true;await db.prepare('UPDATE orbit_hermes_jobs SET job_json=?').bind(JSON.stringify(job)).run();globalThis.fetch=async()=>{throw new Error('must not resubmit')};await assert.rejects(()=>driveAgent(db,'owner',input.id,direct),e=>e.code==='OPENAI_UNCERTAIN');assert.equal((await agentProgress(db,'owner',input.id)).status,'failed');
}));
test('stale workspace revisions and fabricated evidence never stage direct proposals',()=>fixture(async db=>{
 globalThis.fetch=async()=>response(final([proposal]));const input=await start(db);await advanceAgent(db,'owner',input.id,direct);await advanceAgent(db,'owner',input.id,direct);await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:proposal.action});await advanceAgent(db,'owner',input.id,direct);assert.equal((await agentProgress(db,'owner',input.id)).status,'running');assert.equal((await listAgent(db,'owner')).actions.length,0);await advanceAgent(db,'owner',input.id,direct,true);
 globalThis.fetch=async()=>response({...final([proposal]),evidence:['note:invented']});const other=await start(db);await assert.rejects(()=>driveAgent(db,'owner',other.id,direct),e=>e.code==='EVIDENCE_UNKNOWN');assert.equal((await listAgent(db,'owner')).actions.length,0);
}));
test('driver yields on an unchanged remote run instead of spinning',()=>fixture(async db=>{
 await hermes(db);let calls=0;globalThis.fetch=async(url,options)=>{calls++;return options.method==='POST'?Response.json({run_id:'run_1',status:'started'}):Response.json({object:'hermes.run',run_id:'run_1',status:'running'})};const input=await start(db,base);await driveAgent(db,'owner',input.id,base);assert.equal(calls,2);assert.equal((await agentProgress(db,'owner',input.id)).status,'running');
}));
test('driver recovers a stale running turn whose durable job was never inserted',()=>fixture(async db=>{
 const id=randomUUID();await beginTurn(db,'owner',id,'중단된 요청');await db.prepare('UPDATE orbit_agent_turns SET updated_at=? WHERE owner_id=? AND id=?').bind(new Date(Date.now()-360000).toISOString(),'owner',id).run();await driveAgent(db,'owner',id,base);assert.equal((await agentProgress(db,'owner',id)).status,'failed');
}));
test('progress stream handles split UTF-8 events and ignores another turn and unvalidated text',()=>fixture(async()=>{
 const id=randomUUID(),encoder=new TextEncoder(),received=[];
 const bytes=encoder.encode('event: heartbeat\ndata: {}\n\nevent: progress\ndata: '+JSON.stringify({id:'other',status:'completed',progress:'잘못된 대화'})+'\n\nevent: progress\ndata: '+JSON.stringify({id,status:'running',progress:'기록을 확인합니다.',text:'unvalidated',proposals:[proposal]})+'\n\nevent: progress\ndata: '+JSON.stringify({id,status:'completed',progress:'완료'})+'\n\n');
 globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close()}}),{headers:{'content-type':'text/event-stream'}});
 await watchAgent(id,new AbortController().signal,value=>received.push(value));assert.deepEqual(received.map(v=>v.status),['running','completed']);assert.equal(received[0].progress,'기록을 확인합니다.');assert.ok(received.every(v=>!('text' in v)&&!('proposals' in v)));
}));
test('project focus retains task prerequisites and broad requests preserve every project',()=>fixture(async db=>{
 const data=(await readWorkspace(db,'owner')).data;data.projects=[project,{...project,id:'orbit',name:'ORBIT'}];data.tasks=[{id:'a',projectId:'oda',dependsOn:['b']},{id:'b',projectId:'orbit'},{id:'c',projectId:'orbit'}];data.notes=[{id:'n1',projectId:'oda'},{id:'n2',projectId:'orbit'}];
 const focused=chatContextData(data,'ODA 진행사항에 추가');assert.deepEqual(focused.projects.map(p=>p.id),['oda']);assert.deepEqual(focused.tasks.map(t=>t.id),['a','b']);assert.equal(focused.notes.length,1);assert.equal(chatContextData(data,'전체 프로젝트 분석','oda'),data);assert.equal(data.tasks.length,3);
}));
