import test from 'node:test';
import assert from 'node:assert/strict';
import {autoApproveToday,autoApproveCandidates,inAutoApproveWindow} from '../lib/orbit/plan-autoapprove.ts';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {DEFAULT_PREFERENCES} from '../lib/orbit/model.ts';
import {createDatabase} from './sqlite-d1.mjs';

const today='2026-10-06'; // Tuesday in Asia/Seoul
const morning=new Date('2026-10-05T23:30:00Z'); // 08:30 KST
const project={id:'p',name:'P',color:'#5558e8',symbol:'P',goal:'',due:'2026-12-31',priority:3};
const task=(id,extra={})=>({id,title:id,projectId:'p',status:'todo',duration:60,due:today,impact:5,focus:true,definition:'결과물',...extra});
async function seed(db,{auto=true,meeting=false}={}){
 let rev=0;const put=async action=>{const s=await writeCommand(db,'owner',{operationId:crypto.randomUUID(),expectedRevision:rev,action},morning);rev=s.revision;return s;};
 await put({type:'preferences.update',preferences:{...DEFAULT_PREFERENCES,rhythm:{...DEFAULT_PREFERENCES.rhythm},autoApprovePlan:auto}});
 await put({type:'project.upsert',project});
 await put({type:'task.upsert',task:task('a')});await put({type:'task.upsert',task:task('b',{focusDate:today})});
 await put({type:'proposal.generate',date:today,energy:'normal'});
 if(meeting){const plan=(await readWorkspace(db,'owner')).data.proposals.find(p=>p.date===today);const first=plan.items[0];
  await put({type:'event.upsert',event:{id:'m',title:'갑자기 잡힌 미팅',date:today,start:first.start,end:first.end,kind:'meeting'}});}
}

test('the window opens 90 minutes before work and closes at the end of the workday',()=>{
 assert.equal(inAutoApproveWindow({workStart:540,workEnd:1080},449),false);
 assert.equal(inAutoApproveWindow({workStart:540,workEnd:1080},450),true);
 assert.equal(inAutoApproveWindow({workStart:540,workEnd:1080},1080),false);
 assert.deepEqual(autoApproveCandidates({proposals:[{date:today,items:[{id:'late',state:'pending',start:500},{id:'x',state:'approved',start:700},{id:'y',state:'pending',start:800},{id:'z',state:'pending',start:600}]}]},today,520),['z','y']);
});

test('opted in: the morning tick approves today\'s plan once and reports it',async()=>{
 const db=createDatabase();
 try{
  await seed(db);
  const result=await autoApproveToday(db,'owner',today,morning);
  assert.ok(result.approved>=1);assert.equal(result.held,0);
  const data=(await readWorkspace(db,'owner')).data;
  const plan=data.proposals.find(p=>p.date===today);
  assert.ok(plan.items.every(i=>i.state==='approved'));
  assert.equal(data.events.filter(e=>e.id.startsWith('approved:')).length,plan.items.length);
  const again=await autoApproveToday(db,'owner',today,morning);
  assert.equal(again.skipped,'done','never twice a day');
  assert.equal((await autoApproveToday(db,'owner',today,morning,data)).skipped,'done','the tick passes its snapshot and stops at the marker');
  assert.equal((await autoApproveToday(db,'owner',today,morning,{preferences:{...data.preferences,autoApprovePlan:false}})).skipped,'off');
 }finally{db.close()}
});

test('a block that now overlaps a meeting stays in the inbox; opted out does nothing',async()=>{
 const db=createDatabase();
 try{
  await seed(db,{meeting:true});
  const result=await autoApproveToday(db,'owner',today,morning);
  assert.equal(result.held,1);
  const plan=(await readWorkspace(db,'owner')).data.proposals.find(p=>p.date===today);
  assert.equal(plan.items.filter(i=>i.state==='pending').length,1);
 }finally{db.close()}
 const off=createDatabase();
 try{await seed(off,{auto:false});assert.equal((await autoApproveToday(off,'owner',today,morning)).skipped,'off');}finally{off.close()}
});
