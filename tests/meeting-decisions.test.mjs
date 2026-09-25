import test from 'node:test';
import assert from 'node:assert/strict';
import {bulkPlan,summarizeResults,bulkReject,meetingRejectIds} from '../lib/orbit/meeting-decisions.ts';

// The 결재함 lists every decision of one meeting and can approve the chosen ones and close the rest
// in one go. The plan decides the order and what cannot be approved yet.
const task=(id,extra={},guard={})=>({id,title:'할 일 '+id,state:'pending',guard:{meeting:{noteId:'n1',...guard}},action:{type:'task.upsert',task:{id,title:'할 일 '+id,projectId:'p1',due:'2026-10-01',duration:30,status:'todo',...extra}}});
const project=(id)=>({id:'card-'+id,title:'프로젝트 '+id,state:'pending',guard:{meeting:{noteId:'n1'}},action:{type:'project.upsert',project:{id,name:'새 프로젝트 '+id,due:'2026-12-31'}}});
const event=(id)=>({id,title:'일정 '+id,state:'pending',guard:{meeting:{noteId:'n1'}},action:{type:'event.upsert',event:{id,title:'일정 '+id,date:'2026-10-23',start:600,end:660}}});

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

test('the summary says what happened, including failures',()=>{
 assert.equal(summarizeResults([{decision:'approve',ok:true},{decision:'approve',ok:false},{decision:'reject',ok:true},{decision:'reject',ok:true}]),'승인 1건 · 반려 2건 · 실패 1건');
 assert.equal(summarizeResults([{decision:'reject',ok:true}]),'반려 1건');
});

test('a due date typed in the row or set for the whole selection lets 마감 미정 cards be approved',()=>{
 const items=[task('a',{},{needsDue:true}),task('b',{},{needsDue:true}),task('c')];
 const plan=bulkPlan(items,new Set(['a','b','c']),{rejectRest:false,dueOf:item=>item.id==='a'?'2026-10-10':'2026-10-20'});
 assert.deepEqual(plan.approve.map(i=>i.id),['a','b','c']);
 assert.deepEqual(plan.setDue.map(d=>[d.item.id,d.due]),[['a','2026-10-10'],['b','2026-10-20']],'due dates are saved before approving');
 assert.deepEqual(plan.blocked,[]);
 const none=bulkPlan(items,new Set(['a']),{rejectRest:false,dueOf:()=>undefined});
 assert.deepEqual(none.blocked.map(b=>b.item.id),['a']);assert.deepEqual(none.setDue,[]);
});

test('whole-meeting reject sends only open cards of the chosen meetings, 500 per request, and adds up the results',async()=>{
 const card=(id,noteId,state='pending')=>({id,state,guard:noteId?{meeting:{noteId}}:undefined,action:{type:'task.upsert'}});
 const items=[card('a','n1'),card('b','n1','applying'),card('c','n2'),card('d','n3'),card('e',undefined)];
 assert.deepEqual(meetingRejectIds(items,new Set(['n1','n2'])),['a','c']);
 const ids=Array.from({length:1203},(_,i)=>'id'+i),calls=[];
 const result=await bulkReject(ids,async(path,method,body)=>{calls.push([path,method,body.ids.length]);return {rejected:body.ids.length-1,skipped:1}});
 assert.deepEqual(calls,[['/api/agent/bulk-reject','POST',500],['/api/agent/bulk-reject','POST',500],['/api/agent/bulk-reject','POST',203]]);
 assert.deepEqual(result,{rejected:1200,skipped:3});
});
