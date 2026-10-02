import test from 'node:test';
import assert from 'node:assert/strict';
import {planRules} from '../lib/orbit/plan-rules.ts';
import {generateProposal} from '../lib/orbit/planner.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {DEFAULT_PREFERENCES,emptyWorkspace} from '../lib/orbit/model.ts';

const date='2026-09-07'; // Monday
const prefs={...DEFAULT_PREFERENCES,rhythm:{...DEFAULT_PREFERENCES.rhythm}};
const rule=(id,text,kind='other',createdOn='2026-09-01')=>({id,rule:text,kind,createdOn,active:true});
const task=(id,extra={})=>({id,title:id,projectId:'p',status:'todo',duration:60,due:date,impact:5,focus:true,definition:'결과물',...extra});

test('rules in the owner\'s own words become explainable planner effects',()=>{
 const r=planRules([
  rule('b','미팅 사이에 20분 텀을 둔다','buffer'),
  rule('e','기획 일은 예상보다 1.5배 넉넉히 잡기','estimate'),
  rule('l','하루 핵심 결과물은 2개만'),
  rule('m','오전에는 미팅 잡지 않기','placement'),
  rule('d','급한 요청은 위임하기','decline'),
  rule('h','자기 전 스트레칭','habit'),
 ],prefs);
 assert.equal(r.breakMinutes,20);assert.ok(r.bufferFraction>prefs.bufferFraction);
 assert.equal(r.minFactor,1.5);assert.equal(r.focusLimit,2);assert.equal(r.externalAfter,720);assert.equal(r.declineC,true);
 assert.deepEqual(r.applied.map(a=>a.kind).sort(),['buffer','decline','estimate','external-window','limit']);
 assert.ok(!r.applied.some(a=>a.id==='h'),'a habit is not guessed into a scheduling constraint');
});

test('inactive and unrelated rules change nothing',()=>{
 const r=planRules([{...rule('x','오전에는 미팅 금지'),active:false},rule('y','감사한 일 세 가지 적기')],prefs);
 assert.deepEqual(r,{applied:[]});
 const tasks=[task('a'),task('b')];
 assert.deepEqual(generateProposal(tasks,[],date,'normal',undefined,prefs,{rules:r}),generateProposal(tasks,[],date,'normal',undefined,prefs));
});

test('the planner keeps meetings after the chosen hour, widens gaps, limits outcomes and cites the rule',()=>{
 const rules=planRules([rule('m','오전 11시 전에는 외부 미팅 금지'),rule('b','블록 사이 여유 시간 30분','buffer'),rule('l','하루 2개만')],prefs);
 assert.equal(rules.externalAfter,660);
 const tasks=[task('call',{cognition:'external',impact:5}),task('deep',{cognition:'high'}),task('third'),task('fourth')];
 const plan=generateProposal(tasks,[],date,'normal',undefined,prefs,{rules});
 assert.equal(plan.items.length,2,'핵심 결과물 2개');
 const call=plan.items.find(i=>i.taskId==='call');
 assert.ok(call,'the external task is placed');assert.ok(call.start>=660);assert.match(call.reason,/규칙 ★ .*오전 11시 전에는 외부 미팅 금지/);
 const sorted=[...plan.items].sort((a,b)=>a.start-b.start);
 for(let i=1;i<sorted.length;i++)assert.ok(sorted[i].start>=sorted[i-1].end+30);
 assert.equal(plan.rules.length,3);
});

test('a generous-estimate rule applies only where calibration has no evidence',()=>{
 const rules=planRules([rule('e','예상보다 넉넉히','estimate')],prefs);
 const plain=generateProposal([task('a')],[],date,'normal',undefined,prefs,{rules});
 assert.equal(plain.items[0].end-plain.items[0].start,75,'60 × 1.25');assert.match(plain.items[0].reason,/넉넉히/);
 const measured=generateProposal([task('a')],[],date,'normal',undefined,prefs,{rules,calibration:()=>0.8});
 assert.equal(measured.items[0].end-measured.items[0].start,50,'the owner\'s own measured factor wins');
});

test('a decline rule turns C work into delegation candidates unless it is due or marked must',()=>{
 const rules=planRules([rule('d','중요하지 않은 요청은 거절','decline')],prefs);
 const c=task('c',{impact:2,due:'2026-09-08'}),cDue=task('cdue',{impact:2}),b=task('b',{impact:5,due:'2026-09-20'});
 const plan=generateProposal([c,cDue,b],[],date,'normal',undefined,prefs,{rules});
 assert.ok(plan.delegate.includes('c'));assert.ok(plan.items.some(i=>i.taskId==='cdue'));assert.ok(plan.items.some(i=>i.taskId==='b'));
});

test('a rule saved in the evening review shapes the next generated plan',()=>{
 const data={...emptyWorkspace(),projects:[{id:'p',name:'P',color:'#5558e8',symbol:'P',goal:'',due:'2026-12-31',priority:3}],tasks:[task('call',{cognition:'external',due:'2026-09-08'}),task('work',{due:'2026-09-08'})],improvements:[rule('m','오전에는 미팅 안 잡기','placement','2026-09-06')]};
 const next=applyAction(data,{type:'proposal.generate',date:'2026-09-08',energy:'normal'},new Date('2026-09-07T12:00:00Z'));
 const plan=next.proposals.find(p=>p.date==='2026-09-08');
 const call=plan.items.find(i=>i.taskId==='call');
 assert.ok(call&&call.start>=720,'the call moved to the afternoon');
 assert.equal(plan.rules[0].id,'m');
});
