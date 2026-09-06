import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {prepareUpload,uploadContent,saveContext,putPreview,findFile,filesByIds,listFiles,removeFile,contentResponse} from '../lib/orbit/attachments/storage.ts';
import {beginTurn,finishTurn,listAgent} from '../lib/orbit/agent/repository.ts';
import {createConversation} from '../lib/orbit/agent/conversations.ts';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
class Bucket {
 values=new Map();deleted=[];
 async put(key,body){const bytes=new Uint8Array(await new Response(body).arrayBuffer());this.values.set(key,bytes);return {size:bytes.length}}
 async get(key,options){const bytes=this.values.get(key);if(!bytes)return null;const selected=options?.range?bytes.slice(options.range.offset,options.range.offset+options.range.length):bytes;return {size:bytes.length,body:new Blob([selected]).stream(),arrayBuffer:async()=>selected.slice().buffer}}
 async delete(key){this.deleted.push(key);this.values.delete(key)}
}
function req(bytes,headers={}){return new Request('https://orbit.test/file',{method:'PUT',body:bytes,headers:{'content-length':String(bytes.length),...headers}})}
async function fixture(fn){const db=createDatabase(),bucket=new Bucket(),fetch=globalThis.fetch;try{await fn(db,bucket)}finally{db.close();globalThis.fetch=fetch}}
async function upload(db,bucket,{owner='a',name='회의.txt',bytes=new TextEncoder().encode('meeting notes'),prepared=true,preview=false}={}){const id=randomUUID();await prepareUpload(db,owner,{id,name,size:bytes.length});await uploadContent(db,bucket,owner,id,req(bytes));if(preview)await putPreview(db,bucket,owner,id,req(new Uint8Array([255,216,255,1,2,3])));if(prepared)await saveContext(db,owner,id,'회의 내용','텍스트 일부');return id}
async function conversation(db){return (await createConversation(db,'a',{id:randomUUID(),title:'자료 검토',projectId:null})).id}
const event=id=>({id,title:'검토 회의',date:'2026-09-10',start:600,end:660,kind:'meeting'});
async function write(db,action,revision){return writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:revision??(await readWorkspace(db,'a')).revision,action})}
// Wrap only the selected operation, preserving real transactional SQLite.
function failOnce(db,predicate,after=false){const original=db.prepare;let fired=false;db.prepare=function(sql){const wrap=stmt=>new Proxy(stmt,{get(target,key){if(key==='bind')return (...args)=>wrap(target.bind(...args));if(['first','all','run'].includes(key))return async(...args)=>{if(!fired&&predicate(sql,key)){fired=true;if(after)await target[key](...args);throw new Error('D1 acknowledgement unavailable')}return target[key](...args)};return target[key]}});return wrap(original.call(db,sql))};return()=>{db.prepare=original}}
test('uploads validate type and owner, and only finalized files can be attached',()=>fixture(async(db,bucket)=>{
 await assert.rejects(()=>prepareUpload(db,'a',{id:randomUUID(),name:'script.html',size:1}),e=>e.code==='FILE_TYPE');await assert.rejects(()=>prepareUpload(db,'a',{id:randomUUID(),name:'../../photo.png',size:1}),e=>e.code==='FILE_TYPE');await assert.rejects(()=>prepareUpload(db,'a',{id:randomUUID(),name:'big.pdf',size:26*1024*1024}),e=>e.code==='FILE_SIZE');
 const id=await upload(db,bucket,{prepared:false});assert.equal((await listFiles(db,'a')).length,0);await assert.rejects(()=>filesByIds(db,'a',[id]),e=>e.code==='ATTACHMENTS');await assert.rejects(()=>findFile(db,'b',id),e=>e.status===404);await assert.rejects(()=>contentResponse(db,bucket,'b',id,new Request('https://orbit.test')));
 await saveContext(db,'a',id,'本文','텍스트');assert.equal((await listFiles(db,'a'))[0].id,id);await saveContext(db,'a',id,'本文','텍스트');await assert.rejects(()=>saveContext(db,'a',id,'변경','텍스트'),e=>e.code==='CONFLICT');await assert.rejects(()=>putPreview(db,bucket,'a',id,req(new Uint8Array([255,216,255]))),e=>e.code==='CONFLICT');
}));
test('committed originals survive lost write acknowledgement and final read errors',()=>fixture(async(db,bucket)=>{
 for(const failure of ['write','read']){const id=randomUUID();await prepareUpload(db,'a',{id,name:'safe.txt',size:4});let ready=false;const put=bucket.put.bind(bucket);bucket.put=async(...args)=>{const result=await put(...args);ready=true;return result};const restore=failOnce(db,(sql,method)=>ready&&(failure==='write'?sql.includes("SET state='ready'")&&method==='run':sql.startsWith('SELECT * FROM orbit_attachments')&&method==='first'),failure==='write');const result=await uploadContent(db,bucket,'a',id,req(new Uint8Array([1,2,3,4])));restore();assert.equal(result.state,'ready');const row=await findFile(db,'a',id);assert.ok(bucket.values.has(row.object_key));assert.ok(!bucket.deleted.includes(row.object_key));}
}));
test('preview streaming enforces actual byte limit and remains immutable',()=>fixture(async(db,bucket)=>{
 const id=await upload(db,bucket,{prepared:false});await assert.rejects(()=>putPreview(db,bucket,'a',id,req(new Uint8Array(600001),{'content-length':'3'})),e=>e.code==='FILE_SIZE');await assert.rejects(()=>putPreview(db,bucket,'a',id,req(new Uint8Array([1,2,3]))),e=>e.code==='FILE_TYPE');await putPreview(db,bucket,'a',id,req(new Uint8Array([255,216,255,8])));const before=(await findFile(db,'a',id)).preview_key;await putPreview(db,bucket,'a',id,req(new Uint8Array([255,216,255,9])));assert.equal((await findFile(db,'a',id)).preview_key,before);assert.equal(bucket.values.get(before)[3],8);
}));
test('video ranges stream correct full, bounded and suffix bytes with private headers',()=>fixture(async(db,bucket)=>{
 const id=await upload(db,bucket,{name:'clip.mp4',bytes:new Uint8Array([0,1,2,3,4,5,6,7,8,9])});
 for(const [range,status,bytes,contentRange] of [[null,200,[0,1,2,3,4,5,6,7,8,9],null],['bytes=2-4',206,[2,3,4],'bytes 2-4/10'],['bytes=-3',206,[7,8,9],'bytes 7-9/10'],['bytes=8-',206,[8,9],'bytes 8-9/10'],['bytes=8-99',206,[8,9],'bytes 8-9/10']]){const r=await contentResponse(db,bucket,'a',id,new Request('https://orbit.test',{headers:range?{range}:{}}));assert.equal(r.status,status);assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],bytes);assert.equal(r.headers.get('content-range'),contentRange);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');}
 for(const range of ['bytes=11-','bytes=4-2','bytes=-0','bytes=0-1,3-4','not a range'])assert.equal((await contentResponse(db,bucket,'a',id,new Request('https://orbit.test',{headers:{range}}))).status,416);
 const doc=await upload(db,bucket);assert.match((await contentResponse(db,bucket,'a',doc,new Request('https://orbit.test'))).headers.get('content-disposition'),/^attachment;/);
}));
test('event attachment binding is transactional, owner-scoped and replay-safe',()=>fixture(async(db,bucket)=>{
 const id=await upload(db,bucket),foreign=await upload(db,bucket,{owner:'b'});const command={operationId:randomUUID(),expectedRevision:0,action:{type:'event.upsert',event:event('e1'),attachmentIds:[id]}};
 await db.prepare("CREATE TRIGGER reject_binding BEFORE UPDATE ON orbit_attachments WHEN NEW.target_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'binding failed'); END").run();await assert.rejects(()=>writeCommand(db,'a',command));assert.equal((await readWorkspace(db,'a')).revision,0);assert.equal((await findFile(db,'a',id)).target_id,null);await db.prepare('DROP TRIGGER reject_binding').run();
 await writeCommand(db,'a',command);await writeCommand(db,'a',command);assert.equal((await readWorkspace(db,'a')).revision,1);assert.equal((await findFile(db,'a',id)).target_id,'e1');await assert.rejects(()=>removeFile(db,bucket,'a',id),e=>e.code==='CONFLICT');await assert.rejects(()=>write(db,{type:'event.upsert',event:event('e2'),attachmentIds:[id]}));await assert.rejects(()=>write(db,{type:'event.attach',id:'e1',attachmentIds:[foreign]}));assert.equal((await readWorkspace(db,'a')).revision,1);
 await write(db,{type:'event.attach',id:'e1',attachmentIds:[]});assert.equal((await findFile(db,'a',id)).target_id,null);await write(db,{type:'event.attach',id:'e1',attachmentIds:[id]});await write(db,{type:'event.delete',id:'e1'});assert.equal((await findFile(db,'a',id)).target_id,null);
}));
test('turns bind the selected immutable attachments and reject changed retry inputs',()=>fixture(async(db,bucket)=>{
 const c=await conversation(db),a=await upload(db,bucket),b=await upload(db,bucket),id=randomUUID();const turn=await beginTurn(db,'a',id,'자료 검토',c,[b,a]);await finishTurn(db,'a',id,turn.lease,{text:'답변',sources:[]},[]);assert.deepEqual((await listAgent(db,'a',undefined,c)).turns[0].attachments.map(f=>f.id),[b,a]);await assert.rejects(()=>beginTurn(db,'a',id,'자료 검토',c,[a,b]),e=>e.code==='CONFLICT');await assert.rejects(()=>write(db,{type:'event.upsert',event:event('e1'),attachmentIds:[a]}));assert.equal((await readWorkspace(db,'a')).revision,0);await assert.rejects(()=>removeFile(db,bucket,'a',a),e=>e.code==='CONFLICT');
}));
test('Hermes image retries preserve the native body and key through D1/R2 outages',()=>fixture(async(db,bucket)=>{
 const env={BUCKET:bucket,ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};await saveConnection(db,'a','hermes',{endpoint:'https://hermes.example.com',token:'test',connectionId:'test'},{connected:true},env.ORBIT_ENCRYPTION_KEY);const file=await upload(db,bucket,{name:'photo.jpg',preview:true}),input={id:randomUUID(),conversationId:await conversation(db),message:'이미지를 검토해 줘',attachmentIds:[file]};let first,posts=0;
 globalThis.fetch=async(url,options)=>{if(options.method==='POST'){posts++;const request={key:options.headers['Idempotency-Key'],body:options.body};if(posts===1){first=request;throw new Error('lost acknowledgement')}assert.deepEqual(request,first);return Response.json({run_id:'run_1',status:'started'})}return Response.json({object:'hermes.run',run_id:'run_1',status:'completed',output:JSON.stringify({kind:'final',text:'자료 답변',proposals:[]})})};
 await runAgent(db,'a',input,env);await assert.rejects(()=>advanceAgent(db,'a',input.id,env));const body=JSON.parse(first.body);assert.equal(body.input[0].content[2].type,'image_url');assert.match(body.input[0].content[2].image_url.url,/^data:image\/jpeg;base64,/);const job=async()=>JSON.parse((await db.prepare('SELECT job_json FROM orbit_hermes_jobs').first()).job_json);const before=await job();assert.ok(!JSON.stringify(before).includes('base64'));
 const restore=failOnce(db,(sql,method)=>sql.includes("AND prepared=1 AND id IN")&&method==='all');await assert.rejects(()=>advanceAgent(db,'a',input.id,env),e=>e.code==='STORAGE');restore();assert.equal((await job()).sessionId,before.sessionId);
 const get=bucket.get;bucket.get=async()=>{throw new Error('R2 unavailable')};await assert.rejects(()=>advanceAgent(db,'a',input.id,env),e=>e.code==='STORAGE');bucket.get=get;assert.equal((await job()).sessionId,before.sessionId);
 // Simulate native acceptance followed by a failed D1 state save.
 const batch=db.batch;let failed=false;db.batch=async statements=>{if(!failed&&statements.some(s=>s.sql.includes('SET job_json=')&&s.params[0].includes('"phase":"poll"'))){failed=true;throw new Error('save acknowledgement lost')}return batch.call(db,statements)};await assert.rejects(()=>advanceAgent(db,'a',input.id,env),e=>e.code==='STORAGE');db.batch=batch;assert.equal((await job()).runId,'run_1');await advanceAgent(db,'a',input.id,env);assert.equal((await listAgent(db,'a',undefined,input.conversationId)).turns[0].status,'completed');assert.equal(posts,2);
}));
