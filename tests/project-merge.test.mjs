import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {actionSchema} from '../lib/orbit/validation.ts';
import {duplicateProjectGroups,projectMergePreview,projectMergeProblem} from '../lib/orbit/project-merge.ts';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,readNote,writeCommand} from '../db/repository.ts';
import {createConversation,getConversation} from '../lib/orbit/agent/conversations.ts';

const now=new Date('2099-01-01T01:00:00.000Z');
const project=(id,name,extra={})=>({id,name,goal:name+' 목표',color:'#5558e8',symbol:name.slice(0,1),due:'2099-06-30',priority:3,status:'active',...extra});
const task=(id,projectId,extra={})=>({id,title:id+' 할 일',projectId,status:'todo',duration:30,due:'2099-01-10',impact:3,focus:false,definition:'완료',...extra});
function fixture(){
 const data=emptyWorkspace();
 data.projects=[
  project('keep','엑스더리그',{keywords:['리그'],milestones:[{id:'m-keep',title:'기획',due:'2099-02-01',done:false,taskIds:['t-keep']}]}),
  project('dup','엑스 더 리그',{keywords:['경기'],milestones:[{id:'m-dup',title:'확장',due:'2099-03-01',done:false,taskIds:['t-dup']}],nextTaskId:'t-dup'}),
  project('other','ODA'),
 ];
 data.tasks=[task('t-keep','keep'),task('t-dup','dup'),task('t-other','other')];
 data.events=[{id:'e-dup',title:'리그 회의',date:'2099-01-05',start:600,end:660,kind:'meeting',projectId:'dup'}];
 data.notes=[{id:'n-dup',title:'리그 회의록',kind:'meeting',projectId:'dup',summary:'',body:'본문',tags:[],updated:'2099-01-01'}];
 data.decisions=[{id:'d-dup',title:'결정',projectId:'dup',choice:'A',rationale:'',alternatives:'',reviewDate:'2099-02-01',status:'active',outcome:'',createdAt:now.toISOString(),updatedAt:now.toISOString(),history:[]}];
 data.risks=[{id:'r-dup',title:'리스크',checkDate:'2099-01-20',condition:'조건',projectId:'dup'}];
 data.weeklyAllocations=[{id:'2098-12-29',from:'2098-12-29',through:'2099-01-04',approvedAt:now.toISOString(),active:true,capacityAtApproval:600,allocations:[
  {projectId:'dup',minutes:0,stance:'pause',reason:'대기'},{projectId:'keep',minutes:120,stance:'focus',reason:'핵심'},{projectId:'other',minutes:30,stance:'maintain',reason:'유지'}],protectedBlocks:[]}];
 data.proposals=[{id:'p1',date:'2099-01-02',items:[],unscheduled:[],budget:0,energy:'normal',draftTasks:[task('draft','dup')]}];
 data.dominoProjectId='dup';
 return data;
}
const merge=(extra={})=>({type:'project.merge',targetId:'keep',sourceIds:['dup'],name:'엑스더리그 글로벌',...extra});

test('merging moves every record of the absorbed project to the kept one and removes the absorbed project',()=>{
 const before=fixture(),after=applyAction(before,merge(),now);
 assert.deepEqual(after.projects.map(p=>p.id),['keep','other']);
 const kept=after.projects.find(p=>p.id==='keep');
 assert.equal(kept.name,'엑스더리그 글로벌');
 assert.equal(kept.goal,'엑스더리그 목표','the kept project keeps its own goal');
 assert.equal(kept.due,'2099-06-30');
 assert.deepEqual(kept.milestones.map(m=>m.id),['m-keep','m-dup'],'stages are carried over');
 assert.equal(kept.nextTaskId,'t-dup','a next action is carried over when the kept project has none');
 assert.ok(kept.keywords.includes('리그')&&kept.keywords.includes('경기')&&kept.keywords.includes('엑스 더 리그'),'keywords and the old name keep automatic linking working');
 assert.equal(after.tasks.find(t=>t.id==='t-dup').projectId,'keep');
 assert.equal(after.tasks.find(t=>t.id==='t-other').projectId,'other','other projects are untouched');
 assert.equal(after.events[0].projectId,'keep');
 assert.equal(after.notes[0].projectId,'keep');
 assert.equal(after.decisions[0].projectId,'keep');
 assert.equal(after.risks[0].projectId,'keep');
 assert.equal(after.proposals[0].draftTasks[0].projectId,'keep','nested plan drafts follow too');
 assert.equal(after.dominoProjectId,'keep','the core project moves to the kept one');
 assert.deepEqual(after.weeklyAllocations[0].allocations.map(a=>[a.projectId,a.minutes,a.stance]),[['keep',120,'focus'],['other',30,'maintain']],'weekly entries become one, and a paused absorbed entry does not pause the kept project');
 assert.equal(JSON.stringify({...after,projects:[]}).includes('"dup"'),false,'no reference to the absorbed project remains');
 assert.equal(before.projects.length,3,'the input workspace is not mutated');
});

test('merge refuses invalid selections with a readable reason',()=>{
 const data=fixture();
 assert.match(projectMergeProblem(data,merge({sourceIds:[]}))??'',/2개/);
 assert.match(projectMergeProblem(data,merge({sourceIds:['keep']}))??'',/2개/);
 assert.match(projectMergeProblem(data,merge({sourceIds:['missing']}))??'',/찾을 수 없/);
 assert.match(projectMergeProblem(data,merge({name:'  '}))??'',/이름/);
 assert.match(projectMergeProblem(data,merge({name:'O.D.A'}))??'',/같은 이름/,'the merged name cannot collide with a project outside the merge');
 assert.equal(projectMergeProblem(data,merge({name:'엑스 더 리그'})),null,'reusing a merged project name is fine');
 assert.throws(()=>applyAction(data,merge({sourceIds:['missing']}),now),/찾을 수 없/);
 assert.match(projectMergeProblem({...data,projects:Array.from({length:22},(_,i)=>project('p'+i,'프로젝트'+i))},merge({targetId:'p0',sourceIds:Array.from({length:21},(_,i)=>'p'+(i+1))}))??'',/21개까지/);
 assert.equal(actionSchema.safeParse(merge()).success,true);
 assert.equal(actionSchema.safeParse(merge({sourceIds:['dup','dup']})).success,false);
});

test('duplicate suggestions group projects whose names only differ by spacing, symbols or containment',()=>{
 const groups=duplicateProjectGroups([project('a','엑스더리그'),project('b','엑스 더 리그!'),project('c','엑스더리그 사업 고도화 및 글로벌 확장'),project('d','ODA'),project('e','올드페리')]);
 assert.deepEqual(groups.map(g=>g.map(p=>p.id).sort()),[['a','b','c']]);
 assert.deepEqual(duplicateProjectGroups([project('x','A'),project('y','AB')]),[],'one-letter names are too short to suggest');
});

test('merge preview counts what moves',()=>{
 assert.deepEqual(projectMergePreview(fixture(),['dup']),{tasks:1,events:1,notes:1,others:2});
});

test('stored merge re-points project conversations and keeps the absorbed name as a search keyword',async()=>{
 const db=createDatabase(),owner='merge-owner';
 try{
  const cmd=async action=>writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:(await readWorkspace(db,owner)).revision,action});
  await cmd({type:'project.upsert',project:project('keep','엑스더리그')});
  await cmd({type:'project.upsert',project:project('dup','엑스 더 리그')});
  await cmd({type:'task.upsert',task:task('t-dup','dup')});
  const chat=await createConversation(db,owner,{id:randomUUID(),title:'리그 대화',projectId:'dup'});
  await cmd(merge());
  const saved=(await readWorkspace(db,owner)).data;
  assert.deepEqual(saved.projects.map(p=>p.id),['keep']);
  assert.equal(saved.tasks[0].projectId,'keep');
  assert.equal((await getConversation(db,owner,chat.id)).projectId,'keep','the project chat follows the merge');
 }finally{db.close()}
});

test('merged notes, Plaud imports, orders, Aside jobs and trashed records follow the kept project',async()=>{
 const db=createDatabase(),owner='merge-store';
 try{
  const cmd=async action=>writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:(await readWorkspace(db,owner)).revision,action});
  await cmd({type:'project.upsert',project:project('keep','엑스더리그')});
  await cmd({type:'project.upsert',project:project('dup','엑스 더 리그')});
  const body='회의\n할 일: 제안서 작성';
  await cmd({type:'note.upsert',note:{id:'n-dup',title:'리그 회의록',kind:'meeting',projectId:'dup',summary:'',body,tags:[],updated:'2099-01-01'}});
  const at=now.toISOString();
  await db.prepare('INSERT INTO orbit_plaud_imports(owner_id,external_id,hash,state_json,updated_at) VALUES(?,?,?,?,?)').bind(owner,'rec-1','h',JSON.stringify({title:'녹음',noteIds:['n-dup'],bodyHashes:[],status:'imported',matches:[{projectId:'dup',name:'엑스 더 리그',matched:['리그']}],manualProject:'dup',autoPrimary:'dup'}),at).run();
  await db.prepare('INSERT INTO orbit_aside_jobs(owner_id,id,status,job_json,version,created_at) VALUES(?,?,?,?,?,?)').bind(owner,'aside-1','queued',JSON.stringify({id:'aside-1',projectId:'dup'}),0,at).run();
  await db.prepare('INSERT INTO orbit_data_trash(owner_id,id,category,record_id,title,payload_json,deleted_at) VALUES(?,?,?,?,?,?,?)').bind(owner,'trash-1','tasks','t-old','지운 할 일',JSON.stringify(task('t-old','dup')),at).run();
  await cmd(merge());
  const note=await readNote(db,owner,'n-dup');
  assert.equal(note.projectId,'keep','the stored note revision names the kept project');
  const {revision,bodyStored,...fields}=note;
  await cmd({type:'note.upsert',note:{...fields,body:body+'\n추가'},expectedNoteRevision:revision});
  await cmd({type:'meeting.acceptActions',noteId:'n-dup',expectedNoteRevision:revision+1,items:[{id:'t-new',line:2,title:'제안서 작성',definition:'완료',due:'2099-01-10',duration:30}]});
  assert.equal((await readWorkspace(db,owner)).data.tasks.find(t=>t.id==='t-new').projectId,'keep','actions accepted from a merged meeting note land in the kept project');
  const plaud=JSON.parse((await db.prepare('SELECT state_json FROM orbit_plaud_imports WHERE owner_id=?').bind(owner).first()).state_json);
  assert.deepEqual([plaud.manualProject,plaud.autoPrimary,plaud.matches[0].projectId],['keep','keep','keep']);
  assert.equal(JSON.parse((await db.prepare('SELECT job_json FROM orbit_aside_jobs WHERE owner_id=?').bind(owner).first()).job_json).projectId,'keep');
  assert.equal(JSON.parse((await db.prepare('SELECT payload_json FROM orbit_data_trash WHERE owner_id=?').bind(owner).first()).payload_json).projectId,'keep');
 }finally{db.close()}
});

test('a merge whose projects together have more than 30 stages is refused before saving',()=>{
 const data=fixture(),stages=(p,n)=>Array.from({length:n},(_,i)=>({id:p+'-s'+i,title:'단계',due:'2099-02-01',done:false,taskIds:[]}));
 data.projects=data.projects.map(p=>p.id==='keep'?{...p,milestones:stages('k',20)}:p.id==='dup'?{...p,milestones:stages('d',20),nextTaskId:undefined}:p);
 assert.match(projectMergeProblem(data,merge())??'',/30/);
});

test('plan evidence that cites the absorbed project is re-pointed',()=>{
 const data=fixture();
 data.proposals[0].brief={evidence:[{id:'e1',kind:'project',recordId:'dup',title:'리그'},{id:'e2',kind:'task',recordId:'dup',title:'동명 할 일'}]};
 const after=applyAction(data,merge(),now);
 assert.deepEqual(after.proposals[0].brief.evidence.map(e=>e.recordId),['keep','dup'],'only project evidence changes');
});
