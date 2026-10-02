import test from 'node:test';
import assert from 'node:assert/strict';
import {historyFeed,historyItems} from '../lib/orbit/history.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';

const today='2026-10-02';
const data=()=>({...emptyWorkspace(),
 goals:[{id:'g',kind:'short',sentence:'해외 진출'}],
 projects:[{id:'p',name:'수출',color:'#5558e8',symbol:'P',goal:'',due:'2026-12-31',priority:3,goalId:'g'},{id:'q',name:'운영',color:'#5558e8',symbol:'Q',goal:'',due:'2026-12-31',priority:3}],
 tasks:[
  {id:'t1',title:'샘플 발송',projectId:'p',status:'done',duration:30,due:today,impact:3,focus:false,definition:'',completedOn:today,actualMinutes:45},
  {id:'t2',title:'단가표 정리',projectId:'q',status:'todo',duration:30,due:today,impact:3,focus:false,definition:'',outcome:'partial',outcomeReason:'time',outcomeOn:'2026-10-01'},
  {id:'t3',title:'미래',projectId:'q',status:'todo',duration:30,due:'2026-10-09',impact:3,focus:false,definition:''},
 ],
 notes:[{id:'n1',title:'바이어 미팅',kind:'meeting',projectId:'p',summary:'MOQ 협의',body:'',tags:[],updated:'2026-10-01',source:{provider:'plaud',externalId:'x',date:'2026-10-01'}},{id:'n2',title:'아이디어',kind:'wiki',projectId:'q',summary:'',body:'',tags:['개인 기록','빠른 기록'],updated:'2026-09-01'}],
 events:[{id:'e1',title:'콜',date:today,start:900,end:930,kind:'meeting',projectId:'p'},{id:'e2',title:'다음 주 미팅',date:'2026-10-08',start:600,end:660,kind:'meeting'}],
 reviews:[{id:'r1',date:'2026-10-01',win:'샘플 준비 완료',block:'단가 미정',energy:'normal',completedIds:[],updatedAt:'2026-10-01T12:00:00Z',carry:'오전에 미팅 금지'}],
 careRoutines:[{id:'run',title:'달리기',domain:'health',minutes:30,days:[5],start:420,active:true,log:[today]}],
});

test('one feed gathers completed, attempted, meetings, imports, reviews and routines by day, never the future',()=>{
 const {feed,total,older}=historyFeed(data(),{through:today});
 assert.deepEqual(feed.map(d=>d.date),[today,'2026-10-01']);
 assert.deepEqual(feed[0].items.map(i=>i.kind),['done','event','routine']);
 assert.equal(feed[0].done,1);assert.equal(feed[0].minutes,45+30+30);assert.equal(feed[0].meetings,1);
 const day=feed[1].items;
 assert.deepEqual(day.map(i=>i.kind),['review','attempt','meeting']);
 assert.match(day[0].detail,/내일 규칙: 오전에 미팅 금지/);
 assert.match(day[1].detail,/부분 △ · 시간 부족/);
 assert.equal(day[2].source,'Plaud');
 assert.equal(total,6);assert.equal(older,true,'the September note is outside the 14-day window');
 assert.ok(!feed.flatMap(d=>d.items).some(i=>i.title==='다음 주 미팅'));
});

test('filters by kind, goal, project and text; items carry the goal of their project',()=>{
 const d=data();
 assert.deepEqual(historyFeed(d,{through:today,filter:'meetings'}).feed.flatMap(x=>x.items).map(i=>i.title),['콜','바이어 미팅']);
 assert.deepEqual(historyFeed(d,{through:today,goalId:'g'}).feed.flatMap(x=>x.items).map(i=>i.title).sort(),['바이어 미팅','샘플 발송','콜']);
 assert.deepEqual(historyFeed(d,{through:today,projectId:'q'}).feed.flatMap(x=>x.items).map(i=>i.title),['단가표 정리']);
 assert.deepEqual(historyFeed(d,{through:today,text:'moq'}).feed.flatMap(x=>x.items).map(i=>i.title),['바이어 미팅']);
 assert.equal(historyItems(d,today).find(i=>i.id==='done:t1').goalId,'g');
 const wide=historyFeed(d,{through:today,days:45});
 assert.equal(wide.feed.at(-1).items[0].source,'빠른 기록');assert.equal(wide.older,false);
});

test('a review shows its execution rate as stored (a percentage)',()=>{
 const d=data();d.reviews[0]={...d.reviews[0],stats:{planned:4,done:3,partial:0,skipped:1,laserMinutes:0,executionRate:75}};
 assert.match(historyItems(d,today).find(i=>i.kind==='review').detail,/^실행률 75%/);
});
