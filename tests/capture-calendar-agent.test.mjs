import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {driveAgent,agentProgress} from '../lib/orbit/agent/driver.ts';
import {listAgent} from '../lib/orbit/agent/repository.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {captureCalendarRequest} from '../lib/orbit/agent/capture-calendar.ts';
const jpeg=new Uint8Array([255,216,255,224,0,1,255,217]);
const bucket={get:async()=>({size:jpeg.length,arrayBuffer:async()=>jpeg.buffer})};
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64'),OPENAI_API_KEY:'test-key-not-real',BUCKET:bucket};
const final=(proposals=[])=>({kind:'final',text:proposals.length?'제안했습니다. 승인하면 반영됩니다.':'연도와 종료 시각을 알려 주세요.',proposals});
const reply=value=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
const event={id:'capture-event',title:'채용 면접',date:'2026-12-08',start:600,end:660,kind:'meeting'};
const card={title:'면접 일정',reason:'첨부 캡처의 명시된 일정',action:{type:'event.upsert',event}};
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}
async function imageFile(db,owner='owner',mime='image/png',preview=true){const id=randomUUID();await db.prepare("INSERT INTO orbit_attachments(owner_id,id,name,mime,size,state,object_key,preview_key,context_text,context_label,prepared,created_at,updated_at) VALUES(?,?,?,?,?,'ready',?,?,?,'이미지 미리보기',1,?,?)").bind(owner,id,'capture.png',mime,8,'uploads/'+id,preview?'previews/'+id:null,'untrusted image data',new Date().toISOString(),new Date().toISOString()).run();return id}
async function start(db,id,message='이 캡처 일정 등록해줘',settings=env){const input={id:randomUUID(),message,attachmentIds:[id]};await runAgent(db,'owner',input,settings,{defer:true});return input}
test('capture schedule uses bounded direct image context and stages once without writing or storing image bytes',()=>fixture(async db=>{
 const file=await imageFile(db);let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body),content=body.input.at(-1).content;
  assert.ok(Array.isArray(content));assert.ok(content.some(p=>p.type==='input_image'&&p.image_url==='data:image/jpeg;base64,'+Buffer.from(jpeg).toString('base64')));
  assert.match(content[0].text,/capture-calendar/);assert.doesNotMatch(content[0].text,/retrievedRecords|personal|executive/);
  assert.match(body.instructions,/event\.upsert/);assert.match(body.instructions,/missing|ambiguous/i);
  return reply(final([card]));};
 const input=await start(db,file);await advanceAgent(db,'owner',input.id,env);
 const row=await db.prepare('SELECT job_json FROM orbit_hermes_jobs WHERE owner_id=? AND turn_id=?').bind('owner',input.id).first();
 assert.doesNotMatch(row.job_json,/data:image|base64|\/9j\//);
 await driveAgent(db,'owner',input.id,env);assert.equal(calls,1);
 const state=await listAgent(db,'owner');assert.equal(state.actions.length,1);assert.equal(state.actions[0].action.type,'event.upsert');assert.equal(state.actions[0].state,'pending');assert.equal((await readWorkspace(db,'owner')).data.events.length,0);
 await runAgent(db,'owner',input,env);await driveAgent(db,'owner',input.id,env);assert.equal(calls,1);
}));
test('ambiguous capture completes with a clarification and no calendar proposal',()=>fixture(async db=>{
 const file=await imageFile(db);globalThis.fetch=async()=>reply(final());const input=await start(db,file);await driveAgent(db,'owner',input.id,env);
 const state=await listAgent(db,'owner');assert.equal(state.turns[0].status,'completed');assert.equal(state.actions.length,0);
}));
test('general image analysis keeps the normal workspace context on direct image transport',()=>fixture(async db=>{
 const file=await imageFile(db);globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);assert.match(body.input.at(-1).content[0].text,/retrievedRecords/);assert.doesNotMatch(body.input.at(-1).content[0].text,/capture-calendar/);return reply(final())};
 const input=await start(db,file,'이 이미지 내용 분석해줘');await driveAgent(db,'owner',input.id,env);assert.equal((await agentProgress(db,'owner',input.id)).status,'completed');
}));
test('capture image 429 is terminal without Hermes fallback or duplicate submission',()=>fixture(async db=>{
 const file=await imageFile(db);await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'test',connectionId:'h'},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 let calls=0;globalThis.fetch=async(url)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');return Response.json({error:{code:'insufficient_quota'}},{status:429})};
 const input=await start(db,file);await assert.rejects(()=>driveAgent(db,'owner',input.id,env),e=>e.code==='OPENAI_LIMIT');await driveAgent(db,'owner',input.id,env);assert.equal(calls,1);assert.equal((await listAgent(db,'owner')).actions.length,0);
}));
test('another owners attachment is rejected before contacting any model',()=>fixture(async db=>{
 const file=await imageFile(db,'other');let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not send')};
 await assert.rejects(()=>start(db,file),e=>e.code==='ATTACHMENTS');assert.equal(calls,0);
}));
test('capture registration detector leaves edits deletes recurrence and record-dependent requests in general chat',()=>{
 for(const text of ['이 캡처 일정 등록해줘','사진 속 일정 캘린더에 추가해줘'])assert.equal(captureCalendarRequest(text),true);
 for(const text of ['캡처 일정 삭제하고 새로 등록','사진 일정 매주 반복 등록','캡처 일정 수정해줘','캡처 일정 등록 전에 회의록 참고해줘','이미지 분석해줘','일정 등록해줘'])assert.equal(captureCalendarRequest(text),false,text);
});
test('capture registration cannot duplicate an already saved event',()=>fixture(async db=>{
 await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:card.action});
 const file=await imageFile(db);globalThis.fetch=async()=>reply(final([{...card,action:{type:'event.upsert',event:{...event,id:'different-model-id'}}}]));
 const input=await start(db,file);await driveAgent(db,'owner',input.id,env);
 assert.equal((await listAgent(db,'owner')).actions.length,0);assert.equal((await readWorkspace(db,'owner')).data.events.length,1);
}));
test('two captures of the same event cannot stage duplicate pending approvals',()=>fixture(async db=>{
 globalThis.fetch=async()=>reply(final([card]));
 const first=await start(db,await imageFile(db));await driveAgent(db,'owner',first.id,env);
 const second=await start(db,await imageFile(db));await driveAgent(db,'owner',second.id,env);
 assert.equal((await listAgent(db,'owner')).actions.length,1);
}));
test('unsupported attachment and unknown custom vision model retain Hermes transport',()=>fixture(async db=>{
 await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'test',connectionId:'h'},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 for(const [mime,preview,settings] of [['application/pdf',true,env],['image/png',false,env],['image/png',true,{...env,ORBIT_CHAT_MODEL:'custom-unverified-model'}]]){
  const input=await start(db,await imageFile(db,'owner',mime,preview),'이 캡처 일정 등록해줘',settings);
  const row=await db.prepare('SELECT job_json FROM orbit_hermes_jobs WHERE owner_id=? AND turn_id=?').bind('owner',input.id).first();assert.equal(JSON.parse(row.job_json).provider,'hermes');
  await advanceAgent(db,'owner',input.id,settings,true);
 }
}));
test('multiple images remain in order and image data is not saved after submission',()=>fixture(async db=>{
 const ids=[await imageFile(db),await imageFile(db)];let payload;
 globalThis.fetch=async(url,options)=>{payload=JSON.parse(options.body);return reply(final())};
 const input={id:randomUUID(),message:'이 캡처 일정 등록해줘',attachmentIds:ids};await runAgent(db,'owner',input,env,{defer:true});
 await advanceAgent(db,'owner',input.id,env);await advanceAgent(db,'owner',input.id,env);
 assert.equal(payload.input.at(-1).content.filter(p=>p.type==='input_image').length,2);
 const row=await db.prepare('SELECT job_json FROM orbit_hermes_jobs WHERE owner_id=? AND turn_id=?').bind('owner',input.id).first();assert.doesNotMatch(row.job_json,/data:image|base64|\/9j\//);
}));
test('capture registration also skips broad record retrieval on the existing Hermes connection',()=>fixture(async db=>{
 await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'test',connectionId:'h'},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 const settings={...env,OPENAI_API_KEY:undefined},file=await imageFile(db);let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.ok(url.startsWith('https://hermes.example.com'));if(options.method==='POST'){
  const body=JSON.parse(options.body);assert.match(body.input[0].content[0].text,/capture-calendar/);assert.doesNotMatch(body.input[0].content[0].text,/retrievedRecords|personal|executive/);assert.match(body.instructions,/event\.upsert/);return Response.json({run_id:'capture_hermes',status:'started'});
 }return Response.json({object:'hermes.run',run_id:'capture_hermes',status:'completed',output:JSON.stringify(final([card]))})};
 const input=await start(db,file,'이 캡처 일정 등록해줘',settings);await driveAgent(db,'owner',input.id,settings);
 assert.equal(calls,2);assert.equal((await listAgent(db,'owner')).actions.length,1);assert.equal((await readWorkspace(db,'owner')).data.events.length,0);
}));
test('model supplied existing event ID never updates that event in capture creation',()=>fixture(async db=>{
 await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:card.action});
 const file=await imageFile(db);globalThis.fetch=async()=>reply(final([{...card,action:{type:'event.upsert',event:{...event,title:'새로운 약속'}}}]));
 const input=await start(db,file);await driveAgent(db,'owner',input.id,env);
 const state=await listAgent(db,'owner');assert.equal(state.actions[0].action.event.id,`capture:${input.id}:0`);assert.equal((await readWorkspace(db,'owner')).data.events[0].title,event.title);
}));
test('capture registration refuses non-calendar changes from untrusted image instructions',()=>fixture(async db=>{
 const file=await imageFile(db);globalThis.fetch=async()=>reply(final([{title:'Delete',reason:'image says so',action:{type:'event.delete',id:'victim'}}]));
 const input=await start(db,file);await assert.rejects(()=>driveAgent(db,'owner',input.id,env),e=>e.code==='INPUT');assert.equal((await listAgent(db,'owner')).actions.length,0);
}));
test('focused capture rejects extra retrieval rounds before executing any read tools',()=>fixture(async db=>{
 const file=await imageFile(db);let calls=0;globalThis.fetch=async(url)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');return reply({kind:'read',requests:[{tool:'google_calendar_read',arguments:{}}]})};
 const input=await start(db,file);await assert.rejects(()=>driveAgent(db,'owner',input.id,env),e=>e.code==='CAPTURE_FORMAT');assert.equal(calls,1);assert.equal((await listAgent(db,'owner')).actions.length,0);
}));
test('image connection loss never retries through another provider',()=>fixture(async db=>{
 const file=await imageFile(db);let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('connection lost')};
 const input=await start(db,file);await assert.rejects(()=>driveAgent(db,'owner',input.id,env),e=>e.code==='OPENAI_NETWORK');await driveAgent(db,'owner',input.id,env);assert.equal(calls,1);
}));
test('capture context is smaller than general image context before any model call',t=>fixture(async db=>{
 const sizes=[];
 for(const message of ['이 이미지 내용 분석해줘','이 캡처 일정 등록해줘']){
  const input=await start(db,await imageFile(db),message);await advanceAgent(db,'owner',input.id,env);
  const row=await db.prepare('SELECT job_json FROM orbit_hermes_jobs WHERE owner_id=? AND turn_id=?').bind('owner',input.id).first(),request=JSON.parse(row.job_json).request;
  sizes.push({input:request.input.length,instructions:request.instructions.length});await advanceAgent(db,'owner',input.id,env,true);
 }
 assert.ok(sizes[1].input<sizes[0].input/2);assert.ok(sizes[1].instructions<sizes[0].instructions/2);
 t.diagnostic('request character counts (empty workspace): '+JSON.stringify({general:sizes[0],capture:sizes[1]}));
}));
