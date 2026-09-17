import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {actionSchema} from '../lib/orbit/validation.ts';
import {monthlyReport,contactContext,morningScript} from '../lib/orbit/phase4.ts';
import {restoreHistory,restoreFileContent} from '../lib/orbit/backup-history.ts';
import {previewRestore,digest} from '../lib/orbit/backup.ts';
import {readWorkspace,readNote,writeCommand} from '../db/repository.ts';
import {prepareUpload,findFile} from '../lib/orbit/attachments/storage.ts';
import {planDataTrash} from '../lib/orbit/data-manager.ts';
import {parseAction} from '../lib/orbit/agent/protocol.ts';
import {streamHasher} from '../lib/orbit/stream-hash.ts';
const now=new Date('2026-09-17T00:00:00Z'),date='2026-09-17';
const project={id:'p',name:'사업',color:'#5558e8',symbol:'P',goal:'결과 검증',due:date,priority:4};
const note={id:'n',title:'실험 근거',kind:'wiki',projectId:'p',summary:'요약',body:'첫 번째 원문',tags:[],updated:date,revision:1};
const task={id:'t',title:'결과 확인',projectId:'p',status:'todo',duration:30,due:'2026-08-01',impact:2,focus:false,definition:'검증'};
function seed(){return {...emptyWorkspace(),projects:[project],notes:[note],tasks:[task]};}
const experiment={id:'x',title:'추천 검증',projectId:'p',noteId:'n',noteRevision:1,hypothesis:'변경 후 전환율 상승',action:'한 매장에서 측정',metric:'전환율',unit:'%',baseline:10,target:15,direction:'up',from:date,through:'2026-09-30',minutes:30};
async function fixture(fn){const db=createDatabase();try{await fn(db)}finally{db.close()}}
async function save(db,action,at=now){const s=await readWorkspace(db,'a');return writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:s.revision,action},at);}
test('experiment validates exact evidence, creates its task atomically, and compares recorded results without completing work',()=>{
 const d=seed();assert.ok(actionSchema.safeParse({type:'experiment.start',experiment}).success);
 assert.throws(()=>applyAction(d,{type:'experiment.start',experiment:{...experiment,noteRevision:2}},now));
 assert.throws(()=>applyAction(d,{type:'experiment.start',experiment:{...experiment,projectId:'absent'}},now));assert.equal(d.tasks.length,1);
 let next=applyAction(d,{type:'experiment.start',experiment},now);assert.equal(next.experiments[0].taskId,next.tasks[1].id);
 assert.throws(()=>applyAction(next,{type:'experiment.start',experiment},now));
 next=applyAction(next,{type:'experiment.finish',id:'x',value:14,evidence:'원본 보고서 100건 중 14건',conclusion:'기준 미달'},now);
 assert.equal(next.experiments[0].result.met,false);assert.equal(next.tasks[1].status,'todo');assert.throws(()=>applyAction(next,{type:'experiment.finish',id:'x',value:20,evidence:'다른 값',conclusion:'변경'},now));
});
test('decision links retain exact historical note and meeting choice after edits',()=>fixture(async db=>{
 await save(db,{type:'project.upsert',project});await save(db,{type:'note.upsert',note});
 const event={id:'e',title:'사업 회의',date,start:600,end:660};await save(db,{type:'event.upsert',event:{...event,kind:'meeting'}});
 const s=await save(db,{type:'meeting.finish',id:'meeting-record',projectId:'p',event,summary:'처음 결정',changedConditions:'',body:'회의 원문',decision:{choice:'소규모 진행',rationale:'먼저 검증',reviewDate:'2026-09-24'},actions:[]});
 const record=s.data.meetingRecords[0],d=s.data.decisions[0];const {createdAt,updatedAt,history,...editable}=d;
 await save(db,{type:'decision.upsert',record:{...editable,choice:'확대 진행'}});
 await save(db,{type:'note.upsert',note:{...note,body:'두 번째 원문',revision:1}});
 assert.equal((await readNote(db,'a','n',1)).body,'첫 번째 원문');assert.equal((await readNote(db,'a','n')).body,'두 번째 원문');
 const next=(await readWorkspace(db,'a')).data;assert.equal(next.decisions[0].choice,'확대 진행');assert.equal(next.meetingRecords[0].decisionSnapshot.choice,'소규모 진행');assert.equal(next.meetingRecords[0].noteRevision,record.noteRevision);
}));
test('execution history keeps distinct days, corrects same-day counts, and produces evidence-bound monthly recommendations',()=>{
 let d=seed();d=applyAction(d,{type:'task.record',id:'t',outcome:'partial',reason:'waiting'},new Date('2026-08-02T00:00:00Z'));
 d=applyAction(d,{type:'task.record',id:'t',outcome:'partial',reason:'scope'},new Date('2026-08-03T00:00:00Z'));
 d=applyAction(d,{type:'task.record',id:'t',outcome:'done'},new Date('2026-08-03T01:00:00Z'));
 assert.equal(d.executionHistory.length,3);const r=monthlyReport(d,'2026-08',now);assert.equal(r.sampleCount,2);assert.equal(r.metrics.done,1);assert.equal(r.metrics.waiting,1);assert.equal(r.metrics.rework,0);assert.equal(r.recommendations.filter(x=>x.kind==='standardize').length,0);
 const before=d.executionHistory.length;d=applyAction(d,{type:'project.upsert',project},now);assert.equal(d.executionHistory.length,before);
 assert.throws(()=>applyAction(d,{type:'monthly.generate',month:'2026-09'},now));d=applyAction(d,{type:'monthly.generate',month:'2026-08'},now);const rec=d.monthlyReports[0].recommendations[0];assert.throws(()=>applyAction(d,{type:'monthly.review',month:'2026-08',id:rec.id,value:0,note:'확인'},now));
 d=applyAction(d,{type:'monthly.decide',month:'2026-08',id:rec.id,status:'adopted'},now);d=applyAction(d,{type:'monthly.review',month:'2026-08',id:rec.id,value:0,note:'동일 기준의 다음 달 기록을 확인'},now);assert.equal(d.monthlyReports[0].recommendations[0].review.value,0);
 assert.equal(monthlyReport(emptyWorkspace(),'2026-08',now).recommendations.length,0);
});
test('people context matches exact name or explicit links and rejects missing references',()=>{
 let d=seed();const contact={id:'c',name:'홍길동',organization:'거래처',role:'매니저',aliases:['길동'],projectIds:['p'],noteIds:['n'],decisionIds:[],delegationIds:[],eventIds:[],memo:''};
 d=applyAction(d,{type:'contact.upsert',contact},now);d.delegations=[{id:'one',assignee:'길동'},{id:'two',assignee:'홍길동2'}];assert.equal(contactContext(d,d.contacts[0]).promises.length,1);
 assert.throws(()=>applyAction(seed(),{type:'contact.upsert',contact:{...contact,noteIds:['missing']}},now));
 assert.match(morningScript(seed(),date),/아직 없습니다/);assert.ok(morningScript(seed(),date).length<=600);
});
test('backup restores experiment dependencies and historical execution without resurrecting deleted tasks',()=>{
 let d=applyAction(seed(),{type:'experiment.start',experiment},now);d=applyAction(d,{type:'task.record',id:'t',outcome:'done'},now);d.tasks=d.tasks.filter(t=>t.id!=='t');
 const payload={format:'orbit-backup/v2',capturedAt:now.toISOString(),data:d,noteHistory:[note],reviewDetails:[]};
 const plan=previewRestore(emptyWorkspace(),payload,[{category:'experiments',id:'x'},{category:'executionHistory',id:d.executionHistory[0].id}]);assert.equal(plan.next.experiments.length,1);assert.equal(plan.next.tasks.length,1);assert.equal(plan.next.executionHistory[0].taskId,'t');
});
test('history restoration is owner scoped, idempotent, non-destructive, and never resumes work',()=>fixture(async db=>{
 const c=randomUUID(),t=randomUUID(),o=randomUUID(),at=now.toISOString(),records={conversations:[{id:c,title:'과거 대화',created_at:at,updated_at:at}],turns:[{id:t,conversation_id:c,input:'질문',status:'running',response_json:JSON.stringify({text:'결과',sources:[],actions:[{type:'task.delete'}]}),created_at:at,updated_at:at}],orders:[{id:o,request_json:'{}',state_json:JSON.stringify({title:'과거 실행',output:'진행 결과',status:'running',runId:'live',approval:{pending:true},research:{resume:true}}),created_at:at}]};
 const op=randomUUID(),hash=await digest(records);assert.equal((await restoreHistory(db,'a',records,op,hash)).verified,true);assert.equal((await restoreHistory(db,'a',records,op,hash)).replayed,true);
 const restored=await db.prepare('SELECT * FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind('a',t).first();assert.equal(restored.status,'failed');assert.equal(JSON.parse(restored.response_json).actions,undefined);
 const order=await db.prepare('SELECT * FROM orbit_agent_orders WHERE owner_id=? AND id=?').bind('a',o).first();const state=JSON.parse(order.state_json);assert.equal(state.status,'cancelled');assert.equal(state.runId,null);assert.equal(state.research,undefined);assert.equal(order.stop_requested,1);
 assert.equal(await db.prepare('SELECT id FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind('b',t).first(),null);
 const changed={conversations:[{...records.conversations[0],title:'덮어쓰기'}]};await restoreHistory(db,'a',changed,randomUUID(),await digest(changed));assert.equal((await db.prepare('SELECT title FROM orbit_conversations WHERE owner_id=? AND id=?').bind('a',c).first()).title,'과거 대화');
 await assert.rejects(async()=>restoreHistory(db,'a',changed,op,await digest(changed)));
}));
test('malformed historical responses and cross-owner attachment restoration are rejected before writes',()=>fixture(async db=>{
 const at=now.toISOString(),c=randomUUID(),records={conversations:[{id:c,title:'대화',created_at:at,updated_at:at}],turns:[{id:randomUUID(),conversation_id:c,input:'질문',status:'completed',response_json:'{"text":{},"sources":[]}',created_at:at,updated_at:at}]};
 await assert.rejects(async()=>restoreHistory(db,'a',records,randomUUID(),await digest(records)));assert.equal(await db.prepare('SELECT id FROM orbit_conversations WHERE owner_id=?').bind('a').first(),null);
 const attachments={attachments:[{id:randomUUID(),name:'x.txt',size:3,context_text:'abc',context_label:'text',target_type:null,target_id:null,created_at:at}]};await assert.rejects(async()=>restoreHistory(db,'a',attachments,randomUUID(),await digest(attachments)));
}));
test('streaming attachment digest equals a SHA-256 of the exact file bytes',async()=>{const h=await streamHasher();await h.update(new Uint8Array([1,2]));await h.update(new Uint8Array([3,4]));assert.equal(await h.end(),createHash('sha256').update(new Uint8Array([1,2,3,4])).digest('hex'));});

test('file restore rejects changed bytes, retries safely, and links verified attachment context',()=>fixture(async db=>{
 const id=randomUUID(),bytes=new TextEncoder().encode('proof'),hash=createHash('sha256').update(bytes).digest('hex'),values=new Map();
 const bucket={put:async(key,body)=>{const b=new Uint8Array(await new Response(body).arrayBuffer());values.set(key,b);return {size:b.length}},delete:async key=>{values.delete(key)}};
 const req=()=>new Request('https://orbit.test/restore',{method:'PUT',body:bytes,headers:{'content-length':String(bytes.length)}});
 await prepareUpload(db,'a',{id,name:'proof.txt',size:bytes.length});await assert.rejects(()=>restoreFileContent(db,bucket,'a',id,'0'.repeat(64),req()));assert.equal((await findFile(db,'a',id)).state,'pending');assert.equal(values.size,0);
 await restoreFileContent(db,bucket,'a',id,hash,req());await restoreFileContent(db,bucket,'a',id,hash,req());assert.equal(values.size,1);
 const records={attachments:[{id,name:'proof.txt',size:bytes.length,context_text:'proof',context_label:'원본',target_type:'event',target_id:'deleted-event',created_at:now.toISOString()}]};await restoreHistory(db,'a',records,randomUUID(),await digest(records));const file=await findFile(db,'a',id);assert.equal(file.prepared,1);assert.equal(file.context_text,'proof');assert.equal(file.target_id,null);await assert.rejects(()=>restoreFileContent(db,bucket,'b',id,hash,req()));
}));
test('agent proposal protocol accepts complete reviewable experiment and rejects invented fields',()=>{
 assert.equal(parseAction({type:'experiment.start',experiment}).type,'experiment.start');assert.throws(()=>parseAction({type:'experiment.start',experiment:{...experiment,alreadyVerified:true}}));
});

test('data manager preserves experiment evidence and person links when records are moved to trash',()=>{
 const d=applyAction(seed(),{type:'experiment.start',experiment},now);for(const selection of [[{category:'notes',id:'n'}],[{category:'tasks',id:'experiment:x'}],[{category:'projects',id:'p'}]])assert.throws(()=>planDataTrash(d,selection));
 const contact={id:'c',name:'담당자',organization:'',role:'',aliases:[],projectIds:[],noteIds:[],decisionIds:[],delegationIds:[],eventIds:['event'],memo:''};let linked=seed();linked.events=[{id:'event',title:'면담',date,start:600,end:630,kind:'meeting'}];linked=applyAction(linked,{type:'contact.upsert',contact},now);assert.throws(()=>planDataTrash(linked,[{category:'events',id:'event'}]));
});
