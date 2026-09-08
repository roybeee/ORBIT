import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {dispatchOrder,advanceOrder,listOrders} from '../lib/orbit/agent/orders.ts';
import {researchRead,researchManifest,researchReadSchema} from '../lib/orbit/agent/order-research.ts';
import {readWorkspace,readNote,writeCommand} from '../db/repository.ts';
const caps={object:'hermes.api_server.capabilities',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{supported:true,durable:true,retention_seconds:86400}}};
const action={type:'agent.dispatch',title:'회의 통합 분석',instruction:'Plaud MCP로 start_at 2026-09-02 00:00부터 2026-09-08 23:59까지 분석. 9월 1일 시작 제외. 16건 여부 확인. 개인 위키 대조. 위키 수정·외부 전송 금지.',projectId:null,taskIds:[],mode:'research'};
const read=(...requests)=>({kind:'orbit.read',notes:'원래 날짜 범위와 제외 기준 유지. 확인된 내용만 인용.',requests});
const p=(name,args={})=>({tool:'plaud_read',arguments:{name,arguments:args}});
const report=(sources=[],status='complete')=>({kind:'orbit.report',status,report:'회의별 사실 · 결정 · 담당 · 기한 · 충돌 · 미확인\n내부 민감 리스크: 확인한 범위에만 한정.\n파일 f2, 위키 wiki. 수정·전송 없음.',sources});
async function fixture(fn){
 const db=createDatabase(),original=globalThis.fetch,objects=new Map(),env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64'),BUCKET:{async put(k,v){objects.set(k,v);return {size:v.length}},async get(k){const v=objects.get(k);return v?{size:v.length,arrayBuffer:async()=>v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength)}:null},async delete(k){objects.delete(k)}}};
 const body='원문에 기록된 확인 사실',note={id:'wiki',title:'기존 위키',kind:'wiki',projectId:'p',body,summary:'기존 기록',tags:[],updated:'2026-09-08'};
 try{
  await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'native-secret',connectionId:'c'},{connected:true},env.ORBIT_ENCRYPTION_KEY);
  await saveConnection(db,'owner','plaud',{clientId:'client',accessToken:'plaud-secret',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY);
  await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:{type:'wiki.import',project:{id:'p',name:'개인 위키',goal:'기록',due:'2026-09-08',priority:3,color:'#5558e8',symbol:'P'},notes:[note]}});
  const calls=[],posts=[],keys=[],replies=[];let long=false,deny=false;
  globalThis.fetch=async(url,init={})=>{
   if(url==='https://mcp.plaud.ai/mcp'){
    const m=JSON.parse(init.body);assert.equal(init.headers.Authorization,'Bearer plaud-secret');
    if(deny)return Response.json({error:'denied'},{status:401});
    if(m.method==='notifications/initialized')return new Response(null,{status:202});
    let result;
    if(m.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{}};
    else if(m.method==='tools/list')result={tools:['list_files','get_note','get_transcript','delete_file'].map(name=>({name,inputSchema:{type:'object'},annotations:{readOnlyHint:true}}))};
    else{calls.push(m.params);const {name,arguments:a}=m.params;if(name==='list_files')result={content:[{type:'text',text:JSON.stringify(a.cursor?{files:[{id:'f2',start_at:'2026-09-02T01:00:00+09:00'}],next_cursor:null}:{files:[{id:'f1',start_at:'2026-09-01T10:00:00+09:00'}],next_cursor:'page2'})}]};else result={content:[{type:'text',text:JSON.stringify({file_id:a.file_id,text:long?'긴 전사 '.repeat(9000):'실제 발화',next_cursor:a.cursor?null:'transcript2'})}]};}
    return Response.json({jsonrpc:'2.0',id:m.id,result});
   }
   assert.ok(url.startsWith('https://hermes.example.com'));assert.ok(!String(init.body).includes('plaud-secret'));
   if(url.endsWith('/v1/capabilities'))return Response.json(caps);if(url.endsWith('/v1/toolsets'))return Response.json({data:[]});
   if(init.method==='POST'){posts.push(JSON.parse(init.body));keys.push(init.headers['Idempotency-Key']);return Response.json({run_id:'r'+posts.length},{status:202});}
   const n=Number(url.split('/').pop().slice(1));return Response.json({object:'hermes.run',run_id:'r'+n,status:'completed',output:JSON.stringify(replies[n-1]??report([],'partial'))});
  };
  const finish=async(id)=>{for(let n=0;n<70;n++){const s=await advanceOrder(db,'owner',id,env,{action:'poll',id});if(['completed','failed','cancelled'].includes(s.status))return s;}throw Error('did not finish');};
  await fn({db,env,note,calls,posts,keys,replies,finish,set long(v){long=v},set deny(v){deny=v}});
 }finally{globalThis.fetch=original;db.close();}
}
test('no native Plaud tools needed: provider pages, wiki full body and report persist across independent rounds',()=>fixture(async f=>{
 f.replies.push(read({tool:'plaud_tools',arguments:{}},{tool:'wiki_search',arguments:{query:'',offset:0}}),read(p('list_files')),read(p('list_files',{cursor:'page2'})),read(p('get_note',{file_id:'f2'}),p('get_transcript',{file_id:'f2'})),read(p('get_transcript',{file_id:'f2',cursor:'transcript2'}),{tool:'wiki_read',arguments:{id:'wiki'}}),report(['read-1-0','read-2-0','read-3-0','read-3-1','read-4-0','read-4-1']));
 const id=randomUUID(),initial=await dispatchOrder(f.db,'owner',id,action,f.env);assert.equal(initial.mode,'research');assert.equal(initial.status,'running');assert.equal(initial.controls.steer,false);
 const result=await f.finish(id);assert.equal(result.status,'completed');assert.equal(result.coverage.status,'reported');assert.equal(result.coverage.reads,8);assert.equal(result.coverage.errors,0);assert.equal(f.posts.length,6);assert.equal(new Set(f.keys).size,6);
 assert.ok(f.calls.some(c=>c.name==='get_transcript'&&c.arguments.cursor==='transcript2'));assert.ok(f.posts.some(p=>p.input.includes('원문에 기록된 확인 사실')));assert.ok(f.posts.every(p=>p.input.includes(action.instruction)));
 assert.equal((await readNote(f.db,'owner','wiki')).body,f.note.body);assert.equal((await readWorkspace(f.db,'owner')).revision,1);assert.deepEqual(await listOrders(f.db,'stranger'),[]);assert.ok(!JSON.stringify(result).includes('object_key'));assert.ok(!JSON.stringify(result).includes('research":'));
}));
test('large source chunks are separate from provider pagination; gaps and cross-owner reads rejected',()=>fixture(async f=>{
 f.long=true;const id=randomUUID();const first=await researchRead(f.db,'owner',id,f.env,'read-0-0',p('get_transcript',{file_id:'f2'}));assert.equal(first.nextOffset,18000);assert.ok(first.totalChars>36000);
 await assert.rejects(()=>researchRead(f.db,'owner',id,f.env,'unused',{tool:'read_result',arguments:{id:'read-0-0',offset:36000}}));
 await assert.rejects(()=>researchRead(f.db,'stranger',id,f.env,'unused',{tool:'read_result',arguments:{id:'read-0-0',offset:0}}));
 let next=first.nextOffset;while(next!==null){const chunk=await researchRead(f.db,'owner',id,f.env,'unused',{tool:'read_result',arguments:{id:'read-0-0',offset:next}});next=chunk.nextOffset;}
 assert.equal((await researchManifest(f.db,'owner',id))[0].complete,true);assert.equal(f.calls.length,1);
 await researchRead(f.db,'owner',id,f.env,'read-0-0',p('get_transcript',{file_id:'f2'}));assert.equal(f.calls.length,1);
}));
test('source errors and unconsumed chunks cannot produce full-coverage status',()=>fixture(async f=>{
 f.long=true;f.replies.push(read(p('get_transcript',{file_id:'f2'})),report(['read-0-0']));const id=randomUUID();await dispatchOrder(f.db,'owner',id,action,f.env);const result=await f.finish(id);assert.equal(result.coverage.status,'partial');assert.match(result.output,/부분 결과/);
}));
test('Plaud permission failure is an explicit source error; wiki access still works and no provider writes',()=>fixture(async f=>{
 f.deny=true;const id=randomUUID();const r=await researchRead(f.db,'owner',id,f.env,'read-0-0',p('get_note',{file_id:'f2'}));assert.match(r.error,/다시 승인/);
 const wiki=await researchRead(f.db,'owner',id,f.env,'read-0-1',{tool:'wiki_read',arguments:{id:'wiki'}});assert.match(wiki.text,/원문에 기록/);
 f.deny=false;const forbidden=await researchRead(f.db,'owner',id,f.env,'read-0-2',p('delete_file',{file_id:'f2'}));assert.match(forbidden.error,/조회만 허용/);assert.equal(f.calls.length,0);
 assert.throws(()=>researchReadSchema.parse({tool:'wiki_write',arguments:{id:'wiki'}}));
}));
test('stop between model and pending reads performs no further provider call',()=>fixture(async f=>{
 f.replies.push(read(p('get_note',{file_id:'f2'})));const id=randomUUID();await dispatchOrder(f.db,'owner',id,action,f.env);const stopped=await advanceOrder(f.db,'owner',id,f.env,{action:'stop',id});assert.equal(stopped.status,'cancelled');assert.equal(f.calls.length,0);
}));

import {parseResearchResponse} from '../lib/orbit/agent/research-response.ts';
test('response parser accepts one wrapped JSON object and a 16-read batch but never ambiguous objects or writes',()=>{
 const batch={kind:'orbit.read',requests:Array.from({length:16},(_,i)=>p('get_note',{file_id:'f'+i}))};
 assert.equal(parseResearchResponse('다음 원문을 읽습니다.\n```json\n'+JSON.stringify(batch)+'\n```').requests.length,16);
 assert.equal(parseResearchResponse(batch).requests.length,16);
 assert.throws(()=>parseResearchResponse(JSON.stringify(batch)+'\n'+JSON.stringify(batch)));
 assert.throws(()=>parseResearchResponse({...batch,requests:[{tool:'wiki_write',arguments:{id:'wiki'}}]}));
 assert.throws(()=>parseResearchResponse({...batch,requests:[p('get_note',{file_id:'f'})],execute:'delete all'}));
 assert.throws(()=>parseResearchResponse('{"kind":"orbit.read",'));
});
test('separate format errors after successful reads reset the repair budget and preserve raw context',()=>fixture(async f=>{
 f.replies.push(read({tool:'plaud_tools',arguments:{}}),{kind:'bad'},read(p('get_note',{file_id:'f2'})),{kind:'bad-again'},read(p('get_transcript',{file_id:'f2'})),report(['read-0-0','read-2-0','read-4-0'],'partial'));
 const id=randomUUID();await dispatchOrder(f.db,'owner',id,action,f.env);const result=await f.finish(id);
 assert.equal(result.status,'completed');assert.equal(f.posts.length,6);assert.equal(f.calls.length,2);
 assert.ok(f.posts[2].input.includes('SCHEMA ISSUE:'));assert.ok(f.posts[2].input.includes('list_files'));assert.ok(f.posts[4].input.includes('실제 발화'));
 assert.ok(f.posts.every(r=>r.input.includes(action.instruction)));assert.equal(new Set(f.keys).size,f.keys.length);
}));
test('batched read requests are sequential; omitting notes retains previous working synthesis',()=>fixture(async f=>{
 f.replies.push({...read({tool:'plaud_tools',arguments:{}}),notes:'보존할 기한과 제외 기준'}, {kind:'orbit.read',requests:[p('get_note',{file_id:'f2'}),p('get_note',{file_id:'f3'}),p('get_note',{file_id:'f4'})]},report(['read-1-0','read-1-1','read-1-2'],'partial'));
 const id=randomUUID();await dispatchOrder(f.db,'owner',id,action,f.env);await f.finish(id);assert.equal(f.calls.length,3);assert.ok(f.posts[2].input.includes('보존할 기한과 제외 기준'));
}));
test('legacy format-failed orders resume the same saved reads without a new provider read or duplicate run',()=>fixture(async f=>{
 f.replies.push(read(p('get_note',{file_id:'f2'})),{kind:'bad'},{kind:'bad'},{kind:'bad'},{kind:'bad'},report(['read-0-0'],'partial'));
 const id=randomUUID();await dispatchOrder(f.db,'owner',id,action,f.env);const failed=await f.finish(id);assert.equal(failed.status,'failed');assert.equal(failed.canResume,true);assert.equal(f.calls.length,1);
 const row=await f.db.prepare('SELECT * FROM orbit_agent_orders WHERE owner_id=? AND id=?').bind('owner',id).first();const s=JSON.parse(row.state_json);delete s.research.formatStopped;delete s.research.repairBaseInput;s.research.invalid=2;s.error='연결 자료 분석 응답 형식을 읽지 못했습니다. 실제 분석 완료로 표시하지 않았습니다.';
 await f.db.prepare('UPDATE orbit_agent_orders SET state_json=?,request_json=? WHERE owner_id=? AND id=?').bind(JSON.stringify(s),JSON.stringify(f.posts[1]),'owner',id).run();assert.equal((await listOrders(f.db,'owner'))[0].canResume,true);
 await assert.rejects(()=>advanceOrder(f.db,'stranger',id,f.env,{action:'resume',id}));
 const resumed=await advanceOrder(f.db,'owner',id,f.env,{action:'resume',id});assert.equal(resumed.id,id);assert.equal(resumed.status,'queued');await advanceOrder(f.db,'owner',id,f.env,{action:'resume',id});assert.equal(f.posts.length,5);
 const finished=await f.finish(id);assert.equal(finished.status,'completed');assert.equal(f.calls.length,1);assert.equal(f.posts.length,6);assert.ok(f.posts[5].input.includes('실제 발화'));assert.ok(f.posts[5].input.includes(action.instruction));assert.equal((await readNote(f.db,'owner','wiki')).body,f.note.body);
}));
