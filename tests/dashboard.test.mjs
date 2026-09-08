import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {workspaceDashboard} from '../lib/orbit/dashboard.ts';
const now=new Date('2026-09-08T01:00:00Z'),date='2026-09-08';
const task=(id,rest={})=>({id,title:id,projectId:'p',status:'todo',duration:30,due:date,impact:3,focus:false,definition:'완료 기준',...rest});
const project={id:'p',name:'프로젝트',color:'#5558e8',symbol:'O',goal:'결과물',goalId:'g',due:'2026-09-30',priority:3};
const goal={id:'g',kind:'short',sentence:'실제 성과',deadline:'2026-09-30',progress:{baseline:0,current:2,target:10,unit:'개',startedOn:'2026-09-01',updatedOn:date}};
const fixture=(rest={})=>({...emptyWorkspace(),goals:[goal],projects:[project],tasks:[],...rest});
test('overview derives local dates and counts dated completions once without changing workspace',()=>{
 const data=fixture({tasks:[task('today',{status:'done',completedOn:date}),task('future',{status:'done',completedOn:'2026-09-09'}),task('undated',{status:'done'}),task('yesterday',{status:'done',completedOn:'2026-09-07'})]});const original=structuredClone(data),d=workspaceDashboard(data,new Date('2026-09-07T15:30:00Z'));
 assert.equal(d.today,date);assert.equal(d.completed.length,1);assert.equal(d.week.reduce((n,x)=>n+x.count,0),2);assert.deepEqual(data,original);assert.equal(d.goals[0].goal.progress.current,2);
});
test('dashboard preserves canonical focus, dependency and ancestor-goal protections',()=>{
 const data=fixture({goals:[goal,{...goal,id:'child',parentId:'g'}],projects:[project,{...project,id:'p2',goalId:'child'}],tasks:[task('focus',{focus:true,focusDate:date}),task('waiting',{dependsOn:['focus']}),task('expired',{due:'2026-09-07',projectId:'p2'})]});let d=workspaceDashboard(data,now);assert.equal(d.focusTasks.length,1);assert.equal(d.ready[0].id,'focus');assert.ok(d.attention.some(t=>t.id==='waiting'));assert.equal(d.attention[0].id,'expired');assert.equal(d.completed.length,0);
 data.goals[0]={...goal,status:'paused'};d=workspaceDashboard(data,now);assert.equal(d.activeGoals.length,0);assert.equal(d.ready.length,0);assert.equal(d.attention.length,0);
 data.goals[0]=goal;data.tasks[0].startedAt=now.toISOString();d=workspaceDashboard(data,now);assert.deepEqual(d.ready.map(t=>t.id),['focus']);
});
test('agenda is ordered, bounded to seven upcoming days and care follows local weekday',()=>{
 const event=(id,day,start)=>({id,title:id,date:day,start,end:start+30,kind:'meeting'});const data=fixture({events:[event('later',date,660),event('early',date,540),event('tomorrow','2026-09-09',540),event('far','2026-09-16',540)],careRoutines:[{id:'care',title:'학습',domain:'learning',minutes:10,days:[2],start:600,active:true,log:[date]}]});const d=workspaceDashboard(data,now);assert.deepEqual(d.todayEvents.map(e=>e.id),['early','later']);assert.deepEqual(d.upcoming.map(e=>e.id),['tomorrow']);assert.equal(d.care.length,1);assert.ok(d.care[0].routine.log.includes(date));
});
test('overlapping meetings use the existing union capacity and metrics never add descendant goal totals',()=>{
 const base=fixture({goals:[goal,{...goal,id:'child',parentId:'g'}],projects:[{...project,goalId:'child'}],tasks:[task('one',{status:'done',completedOn:date})]});const d=workspaceDashboard(base,now);assert.equal(d.completed.length,1);assert.equal(d.goals[0].done,1);assert.equal(d.goals[1].done,1);
 const meeting={id:'m',title:'회의',date,start:540,end:600,kind:'meeting'};const single=workspaceDashboard({...base,events:[meeting]},now),duplicate=workspaceDashboard({...base,events:[meeting,{...meeting,id:'m2'}]},now);assert.equal(single.chief.capacity,duplicate.chief.capacity);
});
