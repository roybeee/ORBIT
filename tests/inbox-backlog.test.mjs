import test from 'node:test';
import assert from 'node:assert/strict';
import {splitProposals,FRESH_DAYS,proposalQueueFull,PROPOSAL_LIMIT} from '../lib/orbit/inbox-backlog.ts';

const today='2026-09-25';
const note=(id,date,title=id)=>({id,title,kind:'meeting',projectId:'',summary:'',body:'',tags:[],updated:'2026-09-24',source:{provider:'plaud',externalId:id,date}});
const card=(id,over={})=>({id,turnId:'t',title:id,reason:'',expectedRevision:1,state:'pending',note:'',revisitDate:null,createdAt:'2026-09-24T01:00:00Z',action:{type:'task.upsert',task:{id:'x'+id,title:id}},...over});
const meeting=(id,noteId,over={})=>card(id,{guard:{meeting:{noteId,revision:1},version:1,actionHash:'h',values:{}},...over});

test('meeting proposals are dated by the meeting, not by when the card was made',()=>{
 const notes=[note('old','2026-09-04T01:24:00Z','09-04 주간 회의'),note('recent','2026-09-22')];
 const {fresh,backlog,backlogCount}=splitProposals([meeting('a','old'),meeting('b','old'),meeting('c','recent')],notes,today);
 assert.deepEqual(fresh.map(a=>a.id),['c'],'a card created yesterday for a 3-week-old meeting is backlog');
 assert.equal(backlogCount,2);
 assert.equal(backlog.length,1);
 assert.deepEqual({key:backlog[0].key,title:backlog[0].title,date:backlog[0].date,ids:backlog[0].actions.map(a=>a.id)},{key:'meeting:old',title:'09-04 주간 회의',date:'2026-09-04',ids:['a','b']});
});

test('the fresh window is the last seven days, inclusive',()=>{
 assert.equal(FRESH_DAYS,7);
 const notes=[note('edge','2026-09-18'),note('out','2026-09-17')];
 const {fresh,backlogCount}=splitProposals([meeting('in','edge'),meeting('outside','out')],notes,today);
 assert.deepEqual(fresh.map(a=>a.id),['in']);
 assert.equal(backlogCount,1);
});

test('chat proposals use their creation date and cards being applied always stay visible',()=>{
 const {fresh,backlog}=splitProposals([
  card('new',{createdAt:'2026-09-23T10:00:00Z'}),
  card('stale',{createdAt:'2026-09-01T10:00:00Z'}),
  meeting('running','gone',{state:'applying'}),
 ],[],today);
 assert.deepEqual(fresh.map(a=>a.id).sort(),['new','running']);
 assert.equal(backlog[0].key,'chat');
 assert.deepEqual(backlog[0].actions.map(a=>a.id),['stale']);
});

test('decided and deferred cards are not part of either list; groups are newest first',()=>{
 const notes=[note('a','2026-09-01'),note('b','2026-09-10')];
 const {fresh,backlog,backlogCount}=splitProposals([
  meeting('x','a'),meeting('y','b'),meeting('z','b',{state:'deferred'}),meeting('w','b',{state:'approved'}),
 ],notes,today);
 assert.equal(fresh.length,0);
 assert.equal(backlogCount,2);
 assert.deepEqual(backlog.map(g=>g.key),['meeting:b','meeting:a']);
});

test('a meeting card whose note is missing falls back to the card date',()=>{
 const {fresh,backlog}=splitProposals([meeting('lost','missing',{createdAt:'2026-09-02T00:00:00Z'}),meeting('lost2','missing2')],[],today);
 assert.deepEqual(fresh.map(a=>a.id),['lost2']);
 assert.equal(backlog[0].title,'회의록');
});

test('dates are taken in the owner\'s time zone and notes without a source use their update date',()=>{
 // 2026-09-18T20:00Z is 2026-09-19 05:00 in Seoul: inside the seven-day window for 2026-09-26.
 const early=splitProposals([card('kst',{createdAt:'2026-09-18T20:00:00Z'})],[],'2026-09-26','Asia/Seoul');
 assert.deepEqual(early.fresh.map(a=>a.id),['kst']);
 const manual={id:'m',title:'수동 회의록',kind:'meeting',projectId:'',summary:'',body:'',tags:[],updated:'2026-08-30'};
 const split=splitProposals([meeting('re','m',{createdAt:'2026-09-25T00:00:00Z'})],[manual],today,'Asia/Seoul');
 assert.equal(split.backlogCount,1,'a re-analysed old manual meeting is backlog, not fresh');
});


test('only current proposals count toward the proposal limit; the old-meeting backlog does not block new analysis',()=>{
 const notes=[note('old','2026-09-04'),note('recent','2026-09-22')];
 const backlog=Array.from({length:190},(_,i)=>meeting('old'+i,'old'));
 assert.equal(PROPOSAL_LIMIT,200);
 assert.equal(proposalQueueFull(backlog,notes,8,today),false,'190 old-meeting cards leave room for a new meeting');
 const current=Array.from({length:195},(_,i)=>meeting('new'+i,'recent'));
 assert.equal(proposalQueueFull([...backlog,...current],notes,5,today),false,'195 current + 5 new is exactly the limit');
 assert.equal(proposalQueueFull([...backlog,...current],notes,6,today),true,'current decisions still cap at 200');
 assert.equal(proposalQueueFull([meeting('d','recent',{state:'deferred'}),...current],notes,5,today),false,'deferred cards never count');
});
