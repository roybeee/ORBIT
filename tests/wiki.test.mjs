import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,readNote,writeCommand} from '../db/repository.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {actionSchema} from '../lib/orbit/validation.ts';
import {wikiConnections,wikiGraph,wikiLinks} from '../lib/orbit/wiki/relations.ts';
import {syncWikiMail,mailText} from '../lib/orbit/wiki/mail.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {startOAuth,finishOAuth} from '../lib/orbit/agent/integrations.ts';
const project={id:'personal-wiki',name:'개인 위키',color:'#6255dc',symbol:'W',goal:'',due:'2026-09-06',priority:3};
const note=(id,title,extra={})=>({id,title,kind:'wiki',projectId:project.id,summary:title,body:'# '+title,tags:[],updated:'2026-09-06',...extra});
const seed={type:'wiki.import',project,notes:[note('root','내 위키',{wiki:{aliases:[],links:['brand'],sources:['문서']}}),note('brand','샘플브랜드',{body:'## 목표\n원문 사실 보존 [[내 위키]]',wiki:{parentId:'root',aliases:['SAMPLE BRAND'],links:['root'],sources:['회의'],private:true}})]};
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=fetch;db.close()}}
const send=async(db,action,operationId=randomUUID())=>writeCommand(db,'owner',{operationId,expectedRevision:(await readWorkspace(db,'owner')).revision,action:actionSchema.parse(action)});
test('wiki import atomically stores full bodies, hierarchy, source flags and replays without overwriting edits',()=>fixture(async db=>{
 const id=randomUUID();await send(db,seed,id);let saved=await readWorkspace(db,'owner');assert.equal(saved.data.notes.length,2);assert.equal(saved.data.notes[1].body,'');
 const original=await readNote(db,'owner','brand');assert.match(original.body,/원문 사실/);assert.equal(original.wiki.private,true);
 await send(db,{type:'note.upsert',note:{...seed.notes[1],body:'새 사실 [[내 위키]]'}});
 await send(db,seed,id);assert.equal((await readNote(db,'owner','brand')).body,'새 사실 [[내 위키]]');
 assert.equal((await readNote(db,'owner','brand',1)).body,original.body);assert.equal((await readWorkspace(db,'other')).data.notes.length,0);
}));
test('wiki import rejects bad references and never leaves partially imported documents',()=>fixture(async db=>{
 const invalid={...seed,notes:[{...seed.notes[0],projectId:'missing',wiki:{parentId:'root',aliases:[],links:[],sources:[]}}]};
 // Import always maps documents into its chosen project. A conflicting existing ID is rejected.
 await send(db,{type:'project.upsert',project:{...project,name:'다른 프로젝트'}});
 await assert.rejects(()=>send(db,invalid),/ID/);assert.equal((await readWorkspace(db,'owner')).data.notes.length,0);
}));
test('body-only aliases survive metadata storage and new sources expand a focused wiki graph',()=>fixture(async db=>{
 await send(db,seed);
 await send(db,{type:'note.upsert',note:note('meeting','9월 회의',{kind:'meeting',body:'긴 원문 안의 SAMPLE BRAND 계약은 아직 검토 중'})});
 let data=(await readWorkspace(db,'owner')).data;assert.equal(data.notes.find(n=>n.id==='meeting').body,'');assert.ok(wikiConnections(data).some(c=>c.id==='meeting'&&c.wikiId==='brand'));
 data.events=[{id:'event',title:'샘플브랜드 미팅',date:'2026-09-10',start:600,end:630,kind:'meeting'}];
 const graph=wikiGraph(data,'brand');assert.ok(graph.nodes.some(n=>n.recordKind==='event'));assert.ok(graph.nodes.some(n=>n.refId==='meeting'));assert.ok(graph.edges.every(e=>graph.nodes.some(n=>n.id===e.a)&&graph.nodes.some(n=>n.id===e.b)));
 await send(db,{type:'note.upsert',note:note('meeting','9월 회의',{kind:'meeting',body:'해당 브랜드 언급이 삭제됨'})});data=(await readWorkspace(db,'owner')).data;assert.ok(!wikiConnections(data).some(c=>c.id==='meeting'));
 assert.deepEqual(wikiLinks(seed.notes[1],seed.notes),['root']);
}));
test('Gmail read connection requests only mail reading and stores messages once with source links',()=>fixture(async db=>{
 await send(db,seed);const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 await saveConnection(db,'owner','google_calendar',{clientId:'test.apps.googleusercontent.com',clientSecret:'secret-secret'},{connected:false},env.ORBIT_ENCRYPTION_KEY);
 const auth=await startOAuth(db,'owner','google_mail','https://orbit.test',env);assert.equal(new URL(auth.url).searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.readonly');
 globalThis.fetch=async()=>Response.json({access_token:'read-token',refresh_token:'refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'});
 assert.equal(await finishOAuth(db,'owner',auth.state,'code',auth.state,env),'google_mail');
 globalThis.fetch=async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer read-token');assert.ok(!options.method||options.method==='GET');return Response.json(url.includes('format=full')?{internalDate:String(Date.now()),snippet:'샘플브랜드 계약 검토',payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'샘플브랜드 계약 자료'},{name:'From',value:'test@example.test'}],body:{data:Buffer.from('검토 중이며 확정이 아님').toString('base64url')}}}:{messages:[{id:'abc'}]})};
 const result=await syncWikiMail(db,'owner',env);assert.equal(result.count,1);assert.equal((await syncWikiMail(db,'owner',env)).count,0);
 const mail=await readNote(db,'owner','gmail:abc');assert.equal(mail.source.provider,'gmail');assert.match(mail.body,/확정이 아님/);assert.ok(wikiConnections((await readWorkspace(db,'owner')).data).some(c=>c.id==='gmail:abc'));
 assert.equal(mailText({mimeType:'text/html',body:{data:Buffer.from('<script>bad</script>').toString('base64url')}}),'');
}));
