import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {todayFocus,carriedImprovement} from '../lib/orbit/today-focus.ts';
import {composeGotem,planSignal} from '../lib/orbit/slack/gotem.ts';

// Pure functions take `now`, so a fixed date is safe here (no server-side "today" stamping).
const date='2026-09-24',origin='https://orbit.test';
const at=(time)=>new Date(`${date}T${time}:00+09:00`);
const task={id:'t1',title:'투자 제안서 초안',projectId:'p',status:'todo',due:date,impact:3,focus:false,duration:60,definition:'목차와 핵심 수치 한 장'};
const other={...task,id:'t2',title:'메일 정리',definition:''};
const item=(taskId,start,end,role)=>({id:'i-'+taskId,taskId,start,end,reason:'',state:'pending',...(role?{role}:{})});
const localProposal=()=>({id:'pr',date,items:[item('t2',540,570),item('t1',600,720,'laser')],unscheduled:[],budget:480,energy:'normal',laser:{taskId:'t1',status:'placed',minutes:120,note:''}});
const brief=()=>({headline:'제안서로 투자 대화를 연다',assessment:'a',progress:[],priorities:[{projectId:'p',taskId:'t1',title:'투자 제안서 초안',outcome:'초안 한 장',whyNow:'다음 주 미팅',approach:['지난 회의 쟁점 3개 적기','목차 확정'],minutes:60,evidence:['task:t1']}],tradeoffs:[],risks:[],success:'s',questions:[],date,cutoff:'c',generatedAt:'2026-09-23T12:00:00Z',sourceRevision:1,sourceTurnId:'turn',coverage:{},evidence:[]});
function workspace({proposal,reviews=[],tasks=[task,other]}={}){return {...emptyWorkspace(),projects:[{id:'p',name:'투자',goal:'g',due:'2026-12-31',priority:3,color:'#445566',symbol:'P'}],tasks,proposals:proposal?[proposal]:[],reviews};}
const signal=(state,extra={})=>({state,analysis:'completed',basisAt:'2026-09-23T12:00:00Z',changes:0,...extra});
const yesterdayReview={id:'2026-09-23',date:'2026-09-23',win:'',block:'',energy:'normal',completedIds:[],updatedAt:'2026-09-23T13:40:00Z',carry:'오전 첫 블록 전에는 메일을 열지 않는다'};

test('today focus prefers the brief priority, its first step and its planned slot',()=>{
 const focus=todayFocus(workspace({proposal:{...localProposal(),brief:brief()}}),date);
 assert.equal(focus.taskId,'t1');
 assert.equal(focus.title,'투자 제안서 초안');
 assert.equal(focus.firstStep,'지난 회의 쟁점 3개 적기');
 assert.deepEqual(focus.slot,{start:600,end:720});
 assert.equal(focus.source,'brief');
});

test('today focus falls back to the local plan laser block and the done definition',()=>{
 const focus=todayFocus(workspace({proposal:localProposal()}),date);
 assert.equal(focus.taskId,'t1');
 assert.equal(focus.source,'local');
 assert.match(focus.firstStep,/목차와 핵심 수치 한 장/);
 assert.deepEqual(focus.slot,{start:600,end:720});
 assert.equal(todayFocus(workspace(),date),null);
});

test('the improvement confirmed in yesterday\'s review is carried with its review date',()=>{
 const data=workspace({proposal:localProposal(),reviews:[yesterdayReview]});
 assert.deepEqual(carriedImprovement(data,date),{reviewDate:'2026-09-23',rule:'오전 첫 블록 전에는 메일을 열지 않는다'});
 assert.deepEqual(todayFocus(data,date).carry,{reviewDate:'2026-09-23',rule:'오전 첫 블록 전에는 메일을 열지 않는다'});
 assert.equal(carriedImprovement(workspace({reviews:[{...yesterdayReview,carry:undefined}]}),date),undefined);
});

test('morning message: one thing, first action, state, one link to the task',()=>{
 const data=workspace({proposal:{...localProposal(),brief:brief()},reviews:[yesterdayReview]});
 const m=composeGotem({slot:'morning',data,now:at('09:00'),plan:signal('ready'),origin});
 assert.equal(m.send,true);
 const lines=m.text.split('\n');
 assert.match(lines[0],/오늘의 한 가지/);
 assert.equal(lines[1],'투자 제안서 초안');
 assert.ok(lines.indexOf('첫 10분: 지난 회의 쟁점 3개 적기')>1);
 assert.match(m.text,/추천 시간 10:00–12:00/);
 assert.match(m.text,/어제 회고\(9\/23\) 반영: 오전 첫 블록 전에는 메일을 열지 않는다/);
 assert.match(m.text,/계획 준비 완료 · 9\/23 21:00 기준/);
 assert.equal(m.text.match(/https:\/\//g).length,1);
 assert.ok(m.text.endsWith(`${origin}/?task=t1#today`));
 assert.equal(m.taskId,'t1');
 assert.equal(m.carryReviewDate,'2026-09-23');
 assert.equal(m.planState,'ready');
});

test('morning message wording differs for ready, stale, local, failed and missing plans',()=>{
 const data=workspace({proposal:localProposal()});
 const text=(plan)=>composeGotem({slot:'morning',data,now:at('09:00'),plan,origin}).text;
 const states=[
  text(signal('ready')),
  text(signal('stale',{changes:4})),
  text(signal('local',{analysis:'idle'})),
  text(signal('local',{analysis:'running'})),
  text(signal('local',{analysis:'failed'})),
 ];
 assert.equal(new Set(states.map(t=>t.split('\n').find(l=>l.startsWith('상태:')))).size,states.length);
 assert.match(states[1],/이후 기록 4건 변경/);
 assert.match(states[4],/분석 실패 · 보존된 기본 계획으로 시작할 수 있어요/);
 const none=composeGotem({slot:'morning',data:workspace(),now:at('09:00'),plan:signal('none',{analysis:'idle',basisAt:null}),origin});
 assert.equal(none.send,true);
 assert.match(none.text,/오늘 계획이 아직 없어요/);
 assert.ok(none.text.endsWith(`${origin}/#proposal`));
});

test('afternoon message is skipped once the focus is started or done, or before its slot',()=>{
 const plan=signal('ready');
 const run=(tasks,time)=>composeGotem({slot:'afternoon',data:workspace({proposal:localProposal(),tasks}),now:at(time),plan,origin});
 assert.equal(run([{...task,startedAt:'2026-09-24T01:00:00Z'},other],'14:00').send,false);
 assert.equal(run([{...task,status:'done',completedOn:date},other],'14:00').reason,'focus_done');
 assert.equal(run([{...task,status:'doing'},other],'14:00').reason,'focus_started');
 assert.equal(run([task,other],'11:00').reason,'before_slot');
 assert.equal(composeGotem({slot:'afternoon',data:workspace(),now:at('14:00'),plan:signal('none'),origin}).reason,'no_plan');
 const due=run([task,other],'14:00');
 assert.equal(due.send,true);
 assert.match(due.text,/아직 시작 기록이 없어요/);
 assert.match(due.text,/막힌 이유/);
 assert.match(due.text,/계획 조정/);
 assert.ok(due.text.endsWith(`${origin}/?task=t1#today`));
});

test('night message links to the prefilled review and is skipped once the review is saved',()=>{
 const done={...task,status:'done',completedOn:date};
 const m=composeGotem({slot:'night',data:workspace({proposal:localProposal(),tasks:[done,other]}),now:at('22:30'),plan:null,origin});
 assert.equal(m.send,true);
 assert.match(m.text,/하루 마무리/);
 assert.match(m.text,/결과 후보 \d+개/);
 assert.match(m.text,/확인 전에는 저장되지 않/);
 assert.ok(m.text.endsWith(`${origin}/#review`));
 const saved=composeGotem({slot:'night',data:workspace({reviews:[{...yesterdayReview,id:date,date}]}),now:at('22:30'),plan:null,origin});
 assert.equal(saved.send,false);
 assert.equal(saved.reason,'review_saved');
});

test('plan signal maps the status API into the four message states',()=>{
 const status={plan:{state:'local',basisAt:null,unconfirmed:{workspaceRevisions:1,noteRevisions:2,conversations:0,collection:9,total:12}},analysis:{state:'failed'}};
 assert.deepEqual(planSignal(status),{state:'local',analysis:'failed',basisAt:null,changes:3});
});

test('saving a review with a carried improvement records it for the next day and as a rule',async()=>{
 const {applyAction}=await import('../lib/orbit/reducer.ts');
 const {actionSchema}=await import('../lib/orbit/validation.ts');
 const now=at('22:40');
 const detail={date,items:[],feedback:[{cause:'메일 확인이 길어짐',alternative:'',rule:'오전 첫 블록 전에는 메일을 열지 않는다',kind:'placement'}],energy:{},smallWins:[],gratitude:[],habitChecks:[],carry:'오전 첫 블록 전에는 메일을 열지 않는다'};
 const action=actionSchema.parse({type:'review.save',review:{date,win:'',block:'',energy:'normal'},detail});
 const next=applyAction(workspace({proposal:localProposal()}),action,now);
 assert.equal(next.reviews.find(r=>r.date===date).carry,'오전 첫 블록 전에는 메일을 열지 않는다');
 assert.ok(next.improvements.some(i=>i.rule==='오전 첫 블록 전에는 메일을 열지 않는다'&&i.createdOn===date&&i.active));
 assert.deepEqual(carriedImprovement(next,'2026-09-25'),{reviewDate:date,rule:'오전 첫 블록 전에는 메일을 열지 않는다'});
 const cleared=applyAction(next,actionSchema.parse({type:'review.save',review:{date,win:'',block:'',energy:'normal'},detail:{...detail,carry:'  '}}),now);
 assert.equal(cleared.reviews.find(r=>r.date===date).carry,undefined,'re-saving without a carry removes it');
 assert.throws(()=>actionSchema.parse({type:'review.save',review:{date,win:'',block:'',energy:'normal'},detail:{...detail,carry:'x'.repeat(201)}}));
});
