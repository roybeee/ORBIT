import test from 'node:test';
import assert from 'node:assert/strict';
import {goalTrace,orbitCheck,goalMomentumSummary} from '../lib/orbit/goal-trace.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';

const today='2026-10-02';
const project=(id,goalId)=>({id,name:id,color:'#5558e8',symbol:'P',goal:'',due:'2026-12-31',priority:3,...(goalId?{goalId}:{})});
const task=(id,projectId,completedOn,extra={})=>({id,title:id,projectId,status:'done',duration:30,due:completedOn,impact:3,focus:false,definition:'',completedOn,...extra});
const workspace=()=>({...emptyWorkspace(),
 goals:[{id:'g-sales',kind:'short',sentence:'해외 파트너 3곳 계약',status:'active'},{id:'g-health',kind:'short',sentence:'주 3회 운동',domain:'health'},{id:'g-child',kind:'short',sentence:'하위 목표',parentId:'g-sales'},{id:'g-quiet',kind:'mid',sentence:'책 쓰기'}],
 projects:[project('export','g-sales'),project('sub','g-child'),project('ops'),project('book','g-quiet')],
 tasks:[
  task('t1','export','2026-10-01',{actualMinutes:90}),task('t2','export','2026-09-30'),task('t3','sub','2026-09-29'),
  task('t4','ops','2026-10-02',{actualMinutes:120}),
  task('old','export','2026-09-24'),task('book1','book','2026-09-10'),
  {...task('open','export','2026-10-01'),status:'todo',completedOn:undefined},
 ],
 notes:[{id:'n1',title:'바이어 미팅',kind:'meeting',projectId:'export',summary:'',body:'',tags:[],updated:'2026-10-01'},{id:'n2',title:'메모',kind:'wiki',projectId:'export',summary:'',body:'',tags:[],updated:'2026-09-20'}],
 events:[{id:'e1',title:'바이어 콜',date:'2026-09-30',start:600,end:660,kind:'meeting',projectId:'export'},{id:'e2',title:'미래 미팅',date:'2026-10-05',start:600,end:660,kind:'meeting',projectId:'export'}],
 careRoutines:[{id:'run',title:'달리기',domain:'health',minutes:40,days:[1,3,5],start:420,goalId:'g-health',active:true,log:['2026-09-28','2026-09-30','2026-10-02']}],
});

test('a goal gathers its own and its sub-goals\' finished work, meetings, notes and routines for the last 7 days',()=>{
 const {goals}=goalTrace(workspace(),today);
 const sales=goals.find(g=>g.goal.id==='g-sales');
 assert.deepEqual(sales.projectIds.sort(),['export','sub']);
 assert.equal(sales.current.done,3,'t1, t2 and the sub-goal task t3');
 assert.equal(sales.current.minutes,90+30+30+60,'actual minutes, else the estimate, plus the meeting event');
 assert.equal(sales.current.meetings,2,'one meeting note and one calendar meeting; a future event does not count');
 assert.equal(sales.previous.done,1);
 assert.equal(sales.momentum,'rising');
 assert.equal(sales.lastActivity,'2026-10-01');assert.equal(sales.idleDays,1);
 assert.ok(sales.recent.every(i=>i.date>='2026-09-26'&&i.date<=today));
 const health=goals.find(g=>g.goal.id==='g-health');
 assert.equal(health.current.routines,3);assert.equal(health.current.minutes,120);
 const quiet=goals.find(g=>g.goal.id==='g-quiet');
 assert.equal(quiet.momentum,'idle');assert.equal(quiet.idleDays,22);
});

test('alignment counts the share of finished work that served an active goal',()=>{
 const {alignment}=goalTrace(workspace(),today);
 assert.equal(alignment.done,4);assert.equal(alignment.aligned,3);assert.equal(alignment.ratio,.75);
 assert.equal(alignment.unlinked[0].projectId,'ops');assert.equal(alignment.unlinked[0].minutes,120);
});

test('Today names the quiet goal; no goals means no card',()=>{
 const check=orbitCheck(workspace(),today);
 assert.equal(check.quiet[0].goal.id,'g-quiet');
 assert.equal(orbitCheck(emptyWorkspace(),today),null);
 const paused=workspace();paused.goals=paused.goals.map(g=>({...g,status:'paused'}));
 assert.equal(orbitCheck(paused,today),null,'paused goals do not nag');
});

test('the AI brief summary is compact and lists active goals only',()=>{
 const data=workspace();data.goals[1]={...data.goals[1],status:'achieved'};
 const summary=goalMomentumSummary(data,today);
 assert.equal(summary.window,'2026-09-26~2026-10-02');
 assert.deepEqual(summary.goals.map(g=>g.goalId),['g-sales','g-child','g-quiet']);
 assert.equal(summary.goals[0].last7.done,3);
});

import {unlinkedProjects,weeklyOrbitReport} from '../lib/orbit/goal-trace.ts';
import {ruleEffect} from '../lib/orbit/rule-effect.ts';

test('recent work outside every goal is offered for linking, with the goal whose words match',()=>{
 const data=workspace();
 data.projects.push({id:'capture-inbox',name:'빠른 기록함',color:'#8a94a6',symbol:'✎',goal:'',due:'2027-01-01',priority:1});
 data.tasks.push({id:'x',title:'해외 바이어 샘플 회신',projectId:'capture-inbox',status:'done',duration:20,due:today,impact:3,focus:false,definition:'',completedOn:today});
 data.projects.find(p=>p.id==='ops').name='해외 파트너 계약 서류';
 const rows=unlinkedProjects(data,today);
 assert.deepEqual(rows.map(r=>r.project.id),['ops'],'inbox projects are never offered');
 assert.equal(rows[0].suggested.id,'g-sales');assert.equal(rows[0].minutes,120);
 assert.deepEqual(unlinkedProjects({...data,goals:[]},today),[]);
});

test('Monday brings one look back at last week; other days nothing',()=>{
 const data=workspace();
 assert.equal(weeklyOrbitReport(data,'2026-10-02'),null,'Friday');
 const report=weeklyOrbitReport(data,'2026-10-05');
 assert.equal(report.id,'weekly-orbit:2026-10-05');assert.equal(report.href,'/#goals');
 assert.match(report.body,/완료 4건 · 목표로 이어진 비율 75%/);
 assert.match(report.body,/가장 많이 나아간 목표: ‘해외 파트너 3곳 계약’/);
 assert.match(report.body,/기록이 없던 목표: ‘책 쓰기’$/,'the sub-goal had its own finished task');
});

test('a rule\'s effect compares reviewed execution rates before and after it, given enough days',()=>{
 const review=(date,rate)=>({id:date,date,win:'',block:'',energy:'normal',completedIds:[],updatedAt:'',stats:{planned:4,done:0,partial:0,skipped:0,laserMinutes:0,executionRate:rate}});
 const data={...workspace(),reviews:[review('2026-09-20',50),review('2026-09-21',60),review('2026-09-22',40),review('2026-09-24',80),review('2026-09-25',90),review('2026-09-26',70)]};
 assert.deepEqual(ruleEffect(data,{createdOn:'2026-09-23'},today),{before:50,after:80,delta:30,days:{before:3,after:3}});
 assert.equal(ruleEffect({...data,reviews:data.reviews.slice(0,4)},{createdOn:'2026-09-23'},today),null,'too few days after');
});
