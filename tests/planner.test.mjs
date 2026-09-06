import test from 'node:test';
import assert from 'node:assert/strict';
import {availableWindows,generateProposal,approveProposalItem,overlaps} from '../lib/orbit/planner.ts';
const date='2026-09-07';
const task=(id,extra={})=>({id,title:id,projectId:'p',status:'todo',duration:60,due:date,impact:5,focus:true,definition:'An observable outcome',...extra});
const meeting={id:'m',title:'Meeting',date,start:600,end:690,kind:'meeting'};
test('merges overlapping busy events and clips to work hours',()=>{
 assert.deepEqual(availableWindows([{...meeting,start:500,end:600},{...meeting,id:'2',start:570,end:630},{...meeting,id:'3',start:1050,end:1140}],date),[{start:630,end:1050}]);
});
test('respects capacity, fixed meetings, max three outcomes, and inter-task gaps',()=>{
 const tasks=Array.from({length:8},(_,i)=>task('t'+i));const plan=generateProposal(tasks,[meeting],date);
 assert.equal(plan.items.length,3);assert.ok(plan.items.reduce((s,i)=>s+i.end-i.start,0)<=plan.budget);
 for(const i of plan.items){assert.ok(i.start>=540&&i.end<=1080);assert.equal(overlaps(i,meeting),false)}
 for(let i=1;i<plan.items.length;i++)assert.ok(plan.items[i].start>=plan.items[i-1].end+10);
});
test('excludes done, waiting, unresolved dependencies and invalid duration',()=>{
 const plan=generateProposal([task('done',{status:'done'}),task('wait',{status:'waiting'}),task('blocked',{dependsOn:['wait']}),task('unknown',{dependsOn:['missing']}),task('bad',{duration:-15}),task('ready')],[],date);
 assert.deepEqual(plan.items.map(i=>i.taskId),['ready']);
});
test('approval is idempotent and creates exactly one matching calendar block',()=>{
 const tasks=[task('t')];const plan=generateProposal(tasks,[],date);const first=approveProposalItem(plan,plan.items[0].id,tasks,[]);const second=approveProposalItem(first.proposal,plan.items[0].id,tasks,first.events);
 assert.equal(second.events.length,1);assert.equal(second.events[0].taskId,'t');assert.equal(second.proposal.items[0].state,'approved');
});
test('approval rejects a stale task and a newly conflicting calendar event',()=>{
 const tasks=[task('t')];const plan=generateProposal(tasks,[],date);const id=plan.items[0].id;
 const conflict=approveProposalItem(plan,id,tasks,[{...meeting,start:540,end:555}]);assert.ok(conflict.error);assert.equal(conflict.events.length,1);assert.equal(conflict.proposal.items[0].state,'pending');
 assert.ok(approveProposalItem(plan,id,[task('t',{status:'done'})],[]).error);
});
test('regeneration preserves approved and deferred decisions without rescheduling them',()=>{
 const tasks=[task('a'),task('b'),task('c'),task('d')];let plan=generateProposal(tasks,[],date);const approved=approveProposalItem(plan,plan.items[0].id,tasks,[]);plan=approved.proposal;plan.items[1]={...plan.items[1],state:'deferred',deferReason:'Waiting for information'};
 const next=generateProposal(tasks,approved.events,date,'normal',plan);
 assert.equal(next.items.filter(i=>i.taskId==='a').length,1);assert.equal(next.items.find(i=>i.taskId==='a').state,'approved');assert.equal(next.items.find(i=>i.taskId==='b').state,'deferred');
 for(const item of next.items.filter(i=>i.state==='pending'))assert.equal(overlaps(item,approved.events[0]),false);
});
test('a fully booked day produces no impossible schedule',()=>{
 assert.equal(generateProposal([task('t')],[{...meeting,start:540,end:1080}],date).items.length,0);
});
test('low energy reduces the available planning budget',()=>{
 const tasks=[task('a'),task('b')];assert.ok(generateProposal(tasks,[],date,'low').budget<generateProposal(tasks,[],date,'normal').budget);
});
