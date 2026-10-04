import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {actionSchema} from '../lib/orbit/validation.ts';
import {generateProposal} from '../lib/orbit/planner.ts';
import {todayFocus} from '../lib/orbit/today-focus.ts';
import {settingsFromBackup,planSettings} from '../lib/orbit/backup-settings.ts';
import {WorkspaceWrites,instantAction,rebaseWrite} from '../lib/orbit/workspace-write-client.ts';
const date='2026-09-07',now=new Date('2026-09-07T08:00:00Z');
function fixture(){
 const data=emptyWorkspace();
 data.projects=[{id:'p',name:'Project',color:'#5558e8',symbol:'O',goal:'Ship',due:date,priority:5}];
 data.tasks=['a','b','c','d'].map(id=>({id,title:id,projectId:'p',status:'todo',duration:30,due:date,impact:5,focus:false,definition:'Result'}));
 data.proposals=[generateProposal(data.tasks,[],date,'normal',undefined,data.preferences,{dominoProjectId:'p'})];
 return data;
}
const command=data=>({type:'proposal.reject',date,itemId:data.proposals[0].items[0].id,reason:'오늘은 제외'});
test('reject command allows an optional reason and validates its boundary',()=>{
 const action=command(fixture());
 assert.equal(actionSchema.safeParse({...action,reason:undefined}).success,true);
 assert.equal(actionSchema.safeParse({...action,reason:'x'.repeat(2001)}).success,false);
});
test('rejecting a late pending proposal preserves original tasks and events',()=>{
 const data=fixture(),next=applyAction(data,command(data),now);
 assert.equal(next.proposals[0].items[0].state,'rejected');
 assert.equal(next.proposals[0].items[0].rejectReason,'오늘은 제외');
 assert.deepEqual(next.tasks,data.tasks);assert.deepEqual(next.events,data.events);
 assert.equal(data.proposals[0].items[0].state,'pending');
});
test('rejected decisions cannot be approved deferred or reconsidered by stale requests',()=>{
 const data=fixture();data.proposals[0].items[0].state='rejected';
 for(const type of ['proposal.approve','proposal.defer','proposal.reconsider'])assert.throws(()=>applyAction(data,{...command(data),type,revisitDate:'2026-09-08'},now));
});
test('only pending proposals can be rejected',()=>{
 for(const state of ['approved','deferred','rejected']){const data=fixture();data.proposals[0].items[0].state=state;assert.throws(()=>applyAction(data,command(data),now));}
});
test('same day regeneration retains rejection without consuming a focus slot or laser',()=>{
 const data=fixture(),previous=data.proposals[0];previous.items[0].state='rejected';
 const next=generateProposal(data.tasks,[],date,'normal',previous,data.preferences,{dominoProjectId:'p'});
 assert.equal(next.items.filter(i=>i.state==='pending').length,3);
 assert.equal(next.items.filter(i=>i.taskId===previous.items[0].taskId).length,1);
 assert.notEqual(next.laser?.taskId,previous.items[0].taskId);
});
test('rejection is limited to the plan date',()=>{
 const data=fixture(),previous=data.proposals[0];previous.items[0].state='rejected';
 const next=generateProposal(data.tasks,[],'2026-09-08','normal',previous,data.preferences);
 assert.ok(next.items.some(i=>i.taskId===previous.items[0].taskId&&i.state==='pending'));
});
test('today focus skips a rejected laser and rejected brief priority',()=>{
 const data=fixture(),plan=data.proposals[0],rejected=plan.items[0];rejected.state='rejected';
 assert.notEqual(todayFocus(data,date)?.taskId,rejected.taskId);
 plan.brief={priorities:[{taskId:rejected.taskId,title:'Rejected',approach:[]}]};
 assert.notEqual(todayFocus(data,date)?.taskId,rejected.taskId);
});
test('today focus skips rejected AI drafts using their original priority index',()=>{
 const data=fixture(),plan=data.proposals[0];
 plan.brief={sourceTurnId:'turn',priorities:[{taskId:'a',title:'Existing rejected',approach:[]},{title:'Draft rejected',approach:[]},{title:'Active draft',approach:['Start here']}]};
 plan.items=[{...plan.items[0],taskId:'a',state:'rejected'},{...plan.items[1],taskId:'brief:turn:1',state:'rejected'},{...plan.items[2],taskId:'brief:turn:2',state:'pending'}];
 assert.equal(todayFocus(data,date)?.title,'Active draft');
 assert.equal(todayFocus(data,date)?.taskId,undefined,'an unapproved draft stays a brief recommendation');
 assert.equal(todayFocus(data,date)?.firstStep,'Start here');
});
test('backup settings preserve rejected state and reason on restore',()=>{
 const data=fixture();data.proposals[0].items[0]={...data.proposals[0].items[0],state:'rejected',rejectReason:'오늘은 제외'};
 const backup=settingsFromBackup(data,now.toISOString());
 const target={...data,proposals:[]};
 const restored=planSettings(target,backup,['proposals']);
 assert.ok(JSON.stringify(restored).includes('"rejectReason":"오늘은 제외"'));
});
test('rejection waits for confirmation and detects competing approval while unrelated revisions can rebase',()=>{
 const data=fixture(),action=command(data),i=data.proposals[0].items[0];
 assert.equal(instantAction(action),false);
 const basis={revision:0,entity:{id:i.id,taskId:i.taskId,start:i.start,end:i.end,state:i.state}};
 assert.deepEqual(rebaseWrite(action,basis,{data,revision:1}),action);
 const changed=structuredClone(data);changed.proposals[0].items[0].state='approved';
 assert.equal(rebaseWrite(action,basis,{data:changed,revision:1}),null);
});
test('failed rejection keeps the pending card and durable reason',async()=>{
 const data=fixture();let persisted=[];
 const client=new WorkspaceWrites({data,revision:0},{post:async()=>{throw {code:'INPUT',message:'save failed'}},read:async()=>({data,revision:0}),persist:q=>{persisted=structuredClone(q)},change:()=>{},online:()=>true});
 assert.equal(await client.enqueue(command(data)),false);
 assert.equal(client.view.data.proposals[0].items[0].state,'pending');
 assert.equal(persisted[0].command.action.reason,'오늘은 제외');
});
test('successful rejection removes pending card only after server acknowledgement',async()=>{
 const data=fixture();let resolve;
 const response=new Promise(r=>{resolve=r});
 const client=new WorkspaceWrites({data,revision:0},{post:()=>response,read:async()=>({data,revision:0}),persist:()=>{},change:()=>{},online:()=>true});
 const saved=client.enqueue(command(data));
 assert.equal(client.view.data.proposals[0].items[0].state,'pending');
 resolve({data:applyAction(data,command(data),now),revision:1});
 assert.equal(await saved,true);
 assert.equal(client.view.data.proposals[0].items[0].state,'rejected');
});
