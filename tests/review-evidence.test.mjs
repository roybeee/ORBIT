import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {reviewDetailSchema} from '../lib/orbit/validation.ts';
import {reviewCandidates,reviewReflection,confirmationTrend,outcomeSignal,mentionsTask} from '../lib/orbit/review-evidence.ts';

const now=new Date('2026-09-21T09:00:00Z'),date='2026-09-21',past='2026-09-20';
const task=(id,title,extra={})=>({id,title,projectId:'p',status:'todo',duration:60,due:date,impact:3,focus:false,definition:'결과 확인',...extra});
function seed(){
 const d=emptyWorkspace();
 d.projects=[{id:'p',name:'맵달',goal:'결과',due:date,color:'#7788ee',symbol:'P',priority:3}];
 d.tasks=[task('deck','투자 제안서 초안 발송'),task('menu','신메뉴 원가표 작성'),task('call','유통사 회신 확인')];
 return d;
}
const note=(id,body,extra={})=>({id,title:'Slack · 9/21 운영',kind:'knowledge',projectId:'p',summary:'',body,tags:[],updated:date,...extra});
const empty={feedback:[],energy:{},smallWins:[],gratitude:[],habitChecks:[]};
const save=(d,day,items,at=now)=>applyAction(d,{type:'review.save',review:{date:day,win:'',block:'',energy:'normal'},detail:{date:day,items,...empty}},at);

test('record wording becomes a suggested outcome with its source line, negation is not completion',()=>{
 const d=seed();
 d.notes=[note('n1','오늘 투자 제안서 초안 발송 완료했습니다.\n신메뉴 원가표 작성은 완료 못했음, 내일 이어서')];
 const [deck,menu]=reviewCandidates(d,date,date,now,d.notes).filter(c=>c.taskId!=='call');
 assert.equal(deck.state,'suggested');assert.equal(deck.outcome,'done');
 assert.equal(deck.evidence[0].ref.id,'n1');assert.match(deck.evidence[0].quote,/발송 완료/);assert.equal(deck.evidence[0].label,'업무 기록 · Slack · 9/21 운영');
 assert.equal(menu.state,'suggested');assert.notEqual(menu.outcome,'done');
 assert.equal(outcomeSignal('회신 대기 중이라 못 끝냄').reason,'waiting');
 assert.equal(outcomeSignal('자료 정리'),undefined);
 assert.equal(outcomeSignal('제안서 초안 발송 완료','제안서 초안 발송').outcome,'done','title words are not progress wording');
 assert.equal(mentionsTask('투자 제안서 초안을 보냈다','투자 제안서 초안 발송'),false,'every distinctive word is needed');
 assert.equal(mentionsTask('투자제안서 초안 발송 끝','투자 제안서 초안 발송'),true,'spacing does not matter');
});

test('conflicting records give no guess; notes from another day and wiki pages are not evidence',()=>{
 const d=seed();
 d.notes=[note('a','투자 제안서 초안 발송 완료'),note('b','투자 제안서 초안 발송 연기됨',{kind:'meeting',title:'주간 회의'}),note('old','투자 제안서 초안 발송 완료',{updated:past}),note('w','신메뉴 원가표 작성 완료',{kind:'wiki'})];
 const byId=Object.fromEntries(reviewCandidates(d,date,date,now,d.notes).map(c=>[c.taskId,c]));
 assert.equal(byId.deck.state,'open');assert.equal(byId.deck.outcome,undefined);assert.match(byId.deck.basis,/달라/);
 assert.ok(!byId.deck.evidence.some(e=>e.ref?.id==='old'));
 assert.equal(byId.menu.evidence.length,0);assert.equal(byId.menu.state,'open');
});

test('already recorded results are confirmed; timer is attributed only after the last record; calendar is never actual',()=>{
 let d=seed();
 d=applyAction(d,{type:'task.record',id:'deck',outcome:'done',actualMinutes:50},now);
 Object.assign(d.tasks.find(t=>t.id==='menu'),{status:'doing',actualMinutes:40,startedAt:'2026-09-21T08:40:00Z'});
 d.executionHistory=[...d.executionHistory,{id:'execution:x',taskId:'menu',title:'신메뉴 원가표 작성',projectId:'p',date:past,at:'2026-09-20T09:00:00Z',due:date,outcome:'partial',reason:'time',estimate:60,actual:30,impact:3,buffer:null}];
 d.events=[{id:'approved:e',title:'유통사 회신 확인',date,start:600,end:690,kind:'focus',taskId:'call'}];
 const byId=Object.fromEntries(reviewCandidates(d,date,date,now).map(c=>[c.taskId,c]));
 assert.equal(byId.deck.state,'confirmed');assert.equal(byId.deck.outcome,'done');assert.equal(byId.deck.actual,50);
 assert.deepEqual(byId.menu.timer,{total:60,since:30,running:true});
 assert.equal(byId.menu.outcome,'partial');assert.match(byId.menu.basis,/타이머 30분/);
 assert.equal(byId.call.calendarMinutes,90);assert.equal(byId.call.actual,undefined);assert.equal(byId.call.state,'open');
 assert.equal(reviewCandidates(d,past,date,now).find(c=>c.taskId==='menu')?.timer,undefined,'past dates have no attributable timer');
});

test('work found only in records is offered as an extra candidate',()=>{
 const d=seed();d.tasks.push(task('extra','성수 팝업 계약서 서명',{due:'2026-10-01'}));
 d.notes=[note('n','성수 팝업 계약서 서명 끝냈습니다')];
 const extra=reviewCandidates(d,date,date,now,d.notes).find(c=>c.taskId==='extra');
 assert.equal(extra.source,'기록에서 발견');assert.equal(extra.outcome,'done');
 d.notes=[note('n','성수 팝업 계약서 서명 관련 메모')];
 assert.equal(reviewCandidates(d,date,date,now,d.notes).find(c=>c.taskId==='extra'),undefined,'a bare mention is not enough for an unplanned task');
});

test('saving: unanswered rows are untouched, duplicates are rejected, waiting work gets a next-day check',()=>{
 const d=seed();
 const next=save(d,date,[{taskId:'deck',title:'투자 제안서 초안 발송',estimateMinutes:60,actualMinutes:75,outcome:'done'},{taskId:'call',title:'유통사 회신 확인',estimateMinutes:60,outcome:'partial',reason:'waiting'}]);
 const menu=next.tasks.find(t=>t.id==='menu');
 assert.equal(menu.outcome,undefined);assert.equal(menu.status,'todo');assert.ok(!next.executionHistory.some(r=>r.taskId==='menu'));
 const call=next.tasks.find(t=>t.id==='call');
 assert.equal(call.status,'doing');assert.equal(call.checkDate,'2026-09-22');
 assert.throws(()=>save(d,date,[{taskId:'deck',title:'a',estimateMinutes:60,outcome:'done'},{taskId:'deck',title:'a',estimateMinutes:60,outcome:'partial',reason:'time'}]),/두 번/);
 const again=save(next,date,[{taskId:'deck',title:'투자 제안서 초안 발송',estimateMinutes:60,actualMinutes:75,outcome:'done'}]);
 assert.equal(again.executionHistory.filter(r=>r.taskId==='deck').length,1,'re-saving the same result adds no record');
});

test('re-saving a past review does not stack identical execution records',()=>{
 const d=seed(),item={taskId:'menu',title:'신메뉴 원가표 작성',estimateMinutes:60,actualMinutes:30,outcome:'partial',reason:'time'};
 const once=save(d,past,[item]),twice=save(once,past,[item]);
 assert.equal(twice.executionHistory.filter(r=>r.taskId==='menu'&&r.date===past).length,1);
 const changed=save(twice,past,[{...item,actualMinutes:45}]);
 assert.equal(changed.executionHistory.filter(r=>r.taskId==='menu'&&r.date===past).length,2,'a real correction is still recorded');
});

test('reflection explains tomorrow in planner terms and shows calibration progress',()=>{
 const d=seed();
 const detail={date,items:[{taskId:'deck',title:'투자 제안서 초안 발송',estimateMinutes:60,actualMinutes:90,outcome:'done'},{taskId:'call',title:'유통사 회신 확인',estimateMinutes:60,outcome:'partial',reason:'waiting'}],...empty};
 const r=reviewReflection(d,detail,date,now,['신메뉴 원가표 작성']);
 const text=r.lines.map(l=>l.text).join('\n');
 assert.equal(r.next,'2026-09-22');
 assert.match(text,/완료 1개.*내일 후보에서 빠집니다/);
 assert.match(text,/유통사 회신 확인’ 부분 진행/);
 assert.match(text,/9월 22일 ‘확인 필요’/);
 assert.match(text,/실제 90분 \(\+50%\)/);
 assert.match(text,/표본 1\/5개 — 4개 더/);
 assert.match(text,/아직 모름 1개/);
 // Five measured completions at 1.5× turn calibration on for the carried task.
 d.executionHistory=Array.from({length:5},(_,i)=>({id:'execution:'+i,taskId:'h'+i,title:'과거',projectId:'p',date:past,at:'2026-09-20T09:00:00Z',due:past,outcome:'done',reason:'',estimate:60,actual:90,impact:3,buffer:null}));
 d.tasks.push(...Array.from({length:5},(_,i)=>task('h'+i,'과거 '+i,{status:'done',completedOn:past})));
 const calibrated=reviewReflection(d,detail,date,now).lines.find(l=>l.kind==='calibration').text;
 assert.match(calibrated,/예상 60분 → 내일은 90분/);
 const history=reviewReflection(d,{...detail,date:past},date,now).lines.map(l=>l.kind);
 assert.equal(history[0],'history');assert.ok(!history.includes('carry'),'past reviews do not move task state');
});

test('confirmation metrics validate and compare the first 7 measured days with the next 7',()=>{
 const c=(shown,confirmed,seconds)=>({shown,confirmed,unknown:shown-confirmed,accepted:confirmed,edited:0,seconds});
 const detail=(day,conf)=>({date:day,items:[],...empty,...(conf?{confirmation:conf}:{})});
 assert.ok(reviewDetailSchema.safeParse(detail(date,c(4,3,70))).success);
 assert.ok(!reviewDetailSchema.safeParse(detail(date,{...c(4,3,70),extra:1})).success);
 assert.equal(confirmationTrend([detail(date)]),null);
 const t=confirmationTrend([detail('2026-09-01',c(4,2,120)),detail('2026-09-03',c(4,4,60)),detail('2026-09-08',c(5,5,40)),detail('2026-09-10',c(5,4,50)),detail('2026-09-20',c(3,3,10))]);
 assert.deepEqual(t.baseline,{from:'2026-09-01',to:'2026-09-07',days:2,shown:8,confirmed:6,rate:75,medianSeconds:90});
 assert.deepEqual(t.next,{from:'2026-09-08',to:'2026-09-14',days:2,shown:10,confirmed:9,rate:90,medianSeconds:45});
});

test('stored note bodies are read back as review evidence for the owner only',async()=>{
 const {createDatabase}=await import('./sqlite-d1.mjs');
 const {writeCommand,readWorkspace,readNoteBodies}=await import('../db/repository.ts');
 const {randomUUID}=await import('node:crypto');
 const at=new Date('2026-09-21T03:00:00Z'),cmd=(revision,action)=>({operationId:randomUUID(),expectedRevision:revision,action});
 const db=createDatabase();try{
  let state=await writeCommand(db,'a',cmd(0,{type:'project.upsert',project:{id:'p',name:'맵달',color:'#5558e8',symbol:'O',goal:'결과',due:'2026-09-30',priority:3}}),at);
  state=await writeCommand(db,'a',cmd(state.revision,{type:'task.upsert',task:task('deck','투자 제안서 초안 발송')}),at);
  await writeCommand(db,'a',cmd(state.revision,{type:'note.upsert',note:{id:'s',title:'Slack 운영 채널',kind:'knowledge',projectId:'p',summary:'',body:'투자 제안서 초안 발송 완료',tags:[],updated:date}}),at);
  const snapshot=await readWorkspace(db,'a');
  assert.equal(snapshot.data.notes[0].body,'','the aggregate keeps metadata only');
  const notes=await readNoteBodies(db,'a',snapshot.data.notes);
  assert.equal(notes[0].body,'투자 제안서 초안 발송 완료');
  assert.deepEqual(await readNoteBodies(db,'b',snapshot.data.notes),[],'another owner reads nothing');
  const [deck]=reviewCandidates(snapshot.data,date,date,at,notes);
  assert.equal(deck.outcome,'done');assert.equal(deck.evidence[0].ref.id,'s');
 }finally{db.close()}
});

test('a few timer minutes are shown but are not a guess',()=>{
 const d=seed();Object.assign(d.tasks.find(t=>t.id==='menu'),{status:'doing',actualMinutes:3});
 const menu=reviewCandidates(d,date,date,now).find(c=>c.taskId==='menu');
 assert.equal(menu.state,'open');assert.equal(menu.timer.since,3);assert.equal(menu.evidence[0].kind,'timer');
});
