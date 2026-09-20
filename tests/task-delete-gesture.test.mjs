import test from 'node:test';
import assert from 'node:assert/strict';
import {taskDeleteDrag} from '../lib/orbit/task-delete-gesture.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction,DomainError} from '../lib/orbit/reducer.ts';
import {calendarTimeline} from '../lib/orbit/calendar-timeline.ts';

test('delete requires a deliberate rightward release, remains reachable on mobile, and cancels when returned',()=>{
  for(const width of [180,240,360,800]){
    assert.equal(taskDeleteDrag(30,0,width).ready,false);
    assert.equal(taskDeleteDrag(-160,0,width).ready,false);
    assert.equal(taskDeleteDrag(140,180,width).ready,false);
    assert.equal(taskDeleteDrag(140,10,width).ready,true);
    assert.equal(taskDeleteDrag(20,0,width).ready,false);
    assert.equal(taskDeleteDrag(-20,0,width).offset,0);
  }
});

const date='2026-09-21',now=new Date(date+'T00:00:00Z');
const task={id:'task',title:'자금 계획',projectId:'p',due:'2026-09-07',duration:75,status:'todo',impact:3,focus:false,definition:'초안 완료'};
function seed(){return {...emptyWorkspace(),projects:[{id:'p',name:'재무',goal:'조달 계획',due:date,priority:3,color:'#5484ed',symbol:'F'}],tasks:[{...task},{...task,id:'other',title:'다른 할 일'}]}}
test('swipe task deletion removes the underlying overdue task so it cannot reappear tomorrow',()=>{
  const data=seed();
  const after=applyAction(data,{type:'task.delete',id:'task'},now);
  assert.deepEqual(after.tasks.map(t=>t.id),['other']);
  for(const day of [date,'2026-09-22'])assert.ok(calendarTimeline(after.tasks,after.events,day,day).every(e=>e.taskId!=='task'));
  assert.equal(data.tasks.length,2);
});
test('a dependency rejection leaves both tasks intact rather than hiding the card optimistically',()=>{
  const data=seed();data.tasks[1].dependsOn=['task'];
  assert.throws(()=>applyAction(data,{type:'task.delete',id:'task'},now),DomainError);
  assert.deepEqual(data.tasks.map(t=>t.id),['task','other']);
});
