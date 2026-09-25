import test from 'node:test';
import assert from 'node:assert/strict';
import {bulkPlan,decisionRow,summarizeResults} from '../lib/orbit/meeting-decisions.ts';

// The 결재함 lists every decision of one meeting and can approve the chosen ones and close the rest
// in one go. The plan decides the order and what cannot be approved yet.
const task=(id,extra={},guard={})=>({id,title:'할 일 '+id,state:'pending',guard:{meeting:{noteId:'n1',...guard}},action:{type:'task.upsert',task:{id,title:'할 일 '+id,projectId:'p1',due:'2026-10-01',duration:30,status:'todo',...extra}}});
const project=(id)=>({id:'card-'+id,title:'프로젝트 '+id,state:'pending',guard:{meeting:{noteId:'n1'}},action:{type:'project.upsert',project:{id,name:'새 프로젝트 '+id,due:'2026-12-31'}}});
const event=(id)=>({id,title:'일정 '+id,state:'pending',guard:{meeting:{noteId:'n1'}},action:{type:'event.upsert',event:{id,title:'일정 '+id,date:'2026-10-23',start:600,end:660}}});
const projects=[{id:'p1',name:'맵달SEOUL'}];

test('a new project is approved before the tasks that belong to it, and the rest is closed',()=>{
 const items=[task('a',{projectId:'new-x'}),project('new-x'),event('e'),task('b')];
 const plan=bulkPlan(items,new Set(['a','card-new-x','e']),{rejectRest:true});
 assert.deepEqual(plan.approve.map(i=>i.id),['card-new-x','a','e']);
 assert.deepEqual(plan.reject.map(i=>i.id),['b']);
 assert.deepEqual(plan.blocked,[]);
});

test('a task without a due date, or whose new project is not chosen, is not approved in bulk',()=>{
 const items=[task('a',{},{needsDue:true}),task('b',{projectId:'new-x'}),project('new-x'),task('c')];
 const plan=bulkPlan(items,new Set(['a','b','c']),{rejectRest:false});
 assert.deepEqual(plan.approve.map(i=>i.id),['c']);
 assert.deepEqual(plan.blocked.map(b=>[b.item.id,b.reason]),[['a','마감일을 먼저 지정해 주세요.'],['b','함께 제안된 새 프로젝트를 먼저 선택해 주세요.']]);
 assert.deepEqual(plan.reject,[]);
});

test('only pending cards take part; closing the rest never touches the chosen or blocked ones',()=>{
 const items=[task('a'),{...task('done'),state:'approved'},task('b',{},{needsDue:true})];
 const plan=bulkPlan(items,new Set(['a','b']),{rejectRest:true});
 assert.deepEqual(plan.approve.map(i=>i.id),['a']);
 assert.deepEqual(plan.reject,[],'a chosen but blocked card is kept for the owner, not closed');
});

test('each row shows its kind, the date that matters and the project',()=>{
 assert.deepEqual(decisionRow(task('a'),projects),{kind:'할 일',date:'10/1 마감',project:'맵달SEOUL',needsDue:false});
 assert.deepEqual(decisionRow(task('b',{},{needsDue:true}),projects),{kind:'할 일',date:'마감 미정',project:'맵달SEOUL',needsDue:true});
 assert.deepEqual(decisionRow(event('e'),projects),{kind:'일정',date:'10/23 10:00',project:'',needsDue:false});
 assert.deepEqual(decisionRow(project('new-x'),projects),{kind:'새 프로젝트',date:'12/31 목표',project:'새 프로젝트 new-x',needsDue:false});
});

test('the summary says what happened, including failures',()=>{
 assert.equal(summarizeResults([{decision:'approve',ok:true},{decision:'approve',ok:false},{decision:'reject',ok:true},{decision:'reject',ok:true}]),'승인 1건 · 반려 2건 · 실패 1건');
 assert.equal(summarizeResults([{decision:'reject',ok:true}]),'반려 1건');
});
