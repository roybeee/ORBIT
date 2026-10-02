import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewNudge} from '../lib/orbit/review-nudge.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';

const today='2026-10-02';
const withDone=()=>({...emptyWorkspace(),tasks:[{id:'t',title:'t',projectId:'p',status:'done',duration:30,due:today,impact:3,focus:false,definition:'',completedOn:today}]});

test('an evening with closed work and no review gets one notice that opens the review',()=>{
 const n=reviewNudge(withDone(),today,true,new Date('2026-10-02T12:30:00Z'));
 assert.equal(n.id,'review-nudge:'+today);assert.equal(n.href,'/#review');assert.match(n.body,/완료 1건/);
});
test('no notice before evening, after a saved review, or on an empty day',()=>{
 assert.equal(reviewNudge(withDone(),today,false),null);
 assert.equal(reviewNudge({...withDone(),reviews:[{id:'r',date:today,win:'',block:'',energy:'normal',completedIds:[],updatedAt:''}]},today,true),null);
 assert.equal(reviewNudge(emptyWorkspace(),today,true),null);
});
