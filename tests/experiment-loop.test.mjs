import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {actionSchema} from '../lib/orbit/validation.ts';
import {generateProposal} from '../lib/orbit/planner.ts';
import {suggestVerdict,experimentStage,experimentsToReview,repeatedIssues} from '../lib/orbit/experiment-review.ts';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {collectPlanningContext,completeBrief} from '../lib/orbit/brief/context.ts';
import {todayInZone,addDays} from '../lib/orbit/dates.ts';

const now=new Date('2026-09-17T00:00:00Z'),date='2026-09-17';
const project={id:'p',name:'사업',color:'#5558e8',symbol:'P',goal:'결과 검증',due:date,priority:4};
const note={id:'n',title:'실험 근거',kind:'wiki',projectId:'p',summary:'요약',body:'원문',tags:[],updated:date,revision:1};
const seed=()=>({...emptyWorkspace(),projects:[project],notes:[note],tasks:[]});
const experiment={id:'x',title:'회의 뒤 여유',projectId:'p',noteId:'n',noteRevision:1,hypothesis:'회의 뒤 여유를 두면 시작 지연이 줄어든다',action:'회의 뒤 30분 비우기',metric:'시작 지연',unit:'회',baseline:4,target:2,direction:'down',from:date,through:'2026-09-24',minutes:30};
const finished=(value,base=experiment)=>applyAction(applyAction(seed(),{type:'experiment.start',experiment:base},now),{type:'experiment.finish',id:base.id,value,evidence:'기록 7일',conclusion:'관찰'},new Date('2026-09-24T00:00:00Z'));

test('an unmeasured baseline is stored as unknown, never as a measured 0, and must be measured before comparison',()=>{
 const unknown={...experiment,baseline:null};
 assert.ok(actionSchema.safeParse({type:'experiment.start',experiment:unknown}).success);
 let d=applyAction(seed(),{type:'experiment.start',experiment:unknown},now);
 assert.equal(d.experiments[0].baseline,null);
 assert.match(d.tasks[0].definition,/기준값/);
 assert.equal(experimentStage(d.experiments[0],date),'measure');
 assert.throws(()=>applyAction(d,{type:'experiment.baseline',id:'x',value:1,evidence:'지난주 기록'},now),/방향/);
 d=applyAction(d,{type:'experiment.baseline',id:'x',value:5,evidence:'지난주 기록 5회'},now);
 assert.equal(d.experiments[0].baseline,5);assert.equal(d.experiments[0].baselineEvidence,'지난주 기록 5회');
 assert.equal(experimentStage(d.experiments[0],date),'running');
 assert.throws(()=>applyAction(d,{type:'experiment.baseline',id:'x',value:6,evidence:'다시'},now));
 // A measured 0 is still a real measurement.
 const zero=applyAction(seed(),{type:'experiment.start',experiment:{...experiment,id:'z',baseline:0,target:3,direction:'up'}},now);
 assert.equal(zero.experiments[0].baseline,0);assert.equal(experimentStage(zero.experiments[0],date),'running');
});

test('verdict suggestions are rule-based and explain the comparison',()=>{
 const adopt=suggestVerdict(finished(2).experiments[0]);assert.equal(adopt.verdict,'adopt');assert.ok(adopt.reasons.some(r=>r.includes('4')&&r.includes('2')));
 assert.equal(suggestVerdict(finished(3).experiments[0]).verdict,'retry');
 assert.equal(suggestVerdict(finished(4).experiments[0]).verdict,'drop');
 assert.equal(suggestVerdict(finished(6).experiments[0]).verdict,'drop');
 const blind=suggestVerdict(finished(1,{...experiment,baseline:null}).experiments[0]);
 assert.equal(blind.verdict,'retry');assert.ok(blind.reasons.some(r=>r.includes('기준값')));
 assert.equal(suggestVerdict(applyAction(seed(),{type:'experiment.start',experiment},now).experiments[0]),null);
});

test('the review date surfaces active experiments that reached their end and finished ones awaiting a decision',()=>{
 const d=applyAction(seed(),{type:'experiment.start',experiment},now);
 assert.deepEqual(experimentsToReview(d,'2026-09-23'),[]);
 assert.deepEqual(experimentsToReview(d,'2026-09-24').map(e=>e.id),['x']);
 assert.equal(experimentStage(d.experiments[0],'2026-09-24'),'review');
 const done=finished(2);assert.equal(experimentStage(done.experiments[0],'2026-09-24'),'decide');
 assert.deepEqual(experimentsToReview(done,'2026-09-24').map(e=>e.id),['x']);
});

test('adopting links a traceable rule to the experiment; retry and drop record the decision without a rule',()=>{
 const d=finished(2);
 assert.throws(()=>applyAction(d,{type:'experiment.decide',id:'x',verdict:'adopt'},now),/규칙/);
 const rule={id:'r1',rule:'회의 뒤 30분은 비워 둔다',kind:'buffer',effect:{type:'meetingBuffer',minutes:30}};
 assert.ok(actionSchema.safeParse({type:'experiment.decide',id:'x',verdict:'adopt',rule}).success);
 const adopted=applyAction(d,{type:'experiment.decide',id:'x',verdict:'adopt',rule},now);
 const saved=adopted.improvements.find(i=>i.id==='r1');
 assert.equal(saved.experimentId,'x');assert.deepEqual(saved.effect,{type:'meetingBuffer',minutes:30});assert.equal(saved.active,true);
 assert.equal(adopted.experiments[0].decision.verdict,'adopt');assert.equal(adopted.experiments[0].decision.suggested,'adopt');assert.equal(adopted.experiments[0].decision.ruleId,'r1');
 assert.equal(experimentStage(adopted.experiments[0],'2026-09-24'),'decided');
 assert.throws(()=>applyAction(adopted,{type:'experiment.decide',id:'x',verdict:'drop'},now));
 const dropped=applyAction(d,{type:'experiment.decide',id:'x',verdict:'drop',note:'효과 불명'},now);
 assert.equal(dropped.experiments[0].decision.verdict,'drop');assert.equal((dropped.improvements??[]).length,0);
 // An identical active rule is reused instead of silently losing the link.
 const existing=applyAction(d,{type:'improvement.add',improvement:{id:'old',rule:'회의 뒤 30분은 비워 둔다',kind:'buffer',createdOn:date,active:true}},now);
 assert.equal(applyAction(existing,{type:'experiment.decide',id:'x',verdict:'adopt',rule},now).experiments[0].decision.ruleId,'old');
 // A retry keeps its lineage.
 assert.throws(()=>applyAction(d,{type:'experiment.start',experiment:{...experiment,id:'x2',parentId:'missing'}},now));
 assert.equal(applyAction(d,{type:'experiment.start',experiment:{...experiment,id:'x2',parentId:'x',from:'2026-09-24',through:'2026-10-01'}},now).experiments[1].parentId,'x');
 assert.throws(()=>applyAction(applyAction(seed(),{type:'experiment.start',experiment},now),{type:'experiment.decide',id:'x',verdict:'drop'},now));
});

test('an adopted meeting-buffer rule moves the next plan and records why; retiring it undoes that',()=>{
 const meeting={id:'m',title:'주간 회의',date,start:540,end:660,kind:'meeting'};
 const task={id:'t',title:'핵심 작업',projectId:'p',status:'todo',duration:60,due:addDays(date,5),impact:4,focus:false,definition:'초안'};
 const rule={id:'r1',rule:'회의 뒤 30분은 비워 둔다',kind:'buffer',createdOn:date,active:true,experimentId:'x',effect:{type:'meetingBuffer',minutes:30}};
 const plain=generateProposal([task],[meeting],date,'normal');
 assert.equal(plain.items[0].start,660);assert.equal(plain.rules,undefined);
 const ruled=generateProposal([task],[meeting],date,'normal',undefined,undefined,{rules:[rule]});
 assert.ok(ruled.items[0].start>=690,'the block after the meeting stays free');
 assert.deepEqual(ruled.rules.map(r=>[r.id,r.experimentId,r.meetings]),[['r1','x',1]]);
 const retired=generateProposal([task],[meeting],date,'normal',undefined,undefined,{rules:[{...rule,active:false}]});
 assert.equal(retired.items[0].start,660);
 const free=generateProposal([task],[],date,'normal',undefined,undefined,{rules:[rule]});
 assert.equal(free.rules[0].meetings,0);
 // The reducer passes the workspace rules to the planner.
 const d={...seed(),tasks:[task],events:[meeting],improvements:[rule]};
 const planned=applyAction(d,{type:'proposal.generate',date,energy:'normal'},now).proposals[0];
 assert.equal(planned.rules[0].id,'r1');assert.ok(planned.items[0].start>=690);
});

test('repeated incomplete reasons in the last 14 days become experiment candidates',()=>{
 const rec=(i,reason,day)=>({id:'e'+i,taskId:'t'+i,title:'작업 '+i,projectId:'p',date:day,at:day+'T09:00:00.000Z',due:day,outcome:'partial',reason,estimate:30,actual:null,impact:3,buffer:null});
 const data={...seed(),executionHistory:[rec(1,'time','2026-09-10'),rec(2,'time','2026-09-12'),rec(3,'time','2026-09-15'),rec(4,'waiting','2026-09-15'),rec(5,'waiting','2026-09-16'),rec(6,'time','2026-08-01')]};
 const issues=repeatedIssues(data,date);
 assert.deepEqual(issues.map(i=>[i.reason,i.count]),[['time',3]]);
 assert.equal(issues[0].examples.length,3);
});

test('planning context lets the plan cite active rules by id, and retired rules are not offered',()=>{
 const db=createDatabase();
 return (async()=>{
  try{
   let revision=0;const send=async action=>{revision=(await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:revision,action})).revision};
   const today=todayInZone('Asia/Seoul');
   await send({type:'improvement.add',improvement:{id:'r1',rule:'회의 뒤 30분은 비워 둔다',kind:'buffer',createdOn:today,active:true,experimentId:'x',effect:{type:'meetingBuffer',minutes:30}}});
   await send({type:'improvement.add',improvement:{id:'r2',rule:'오래된 규칙',kind:'other',createdOn:today,active:true}});
   await send({type:'improvement.retire',id:'r2'});
   const planning={date:addDays(today,1),energy:'normal'};
   const context=await collectPlanningContext(db,'owner',await readWorkspace(db,'owner'),planning,[],{});
   const ids=context.evidence.map(e=>e.id);
   assert.ok(ids.includes('rule:r1'));assert.ok(!ids.includes('rule:r2'));
   assert.equal(context.catalog.brainy.rules[0].evidence,'rule:r1');
   const brief=completeBrief({headline:'h',assessment:'a',progress:[],priorities:[],tradeoffs:[],risks:[{risk:'회의 뒤 지연',response:'여유 확보',evidence:['rule:r1']}],success:'s',questions:[]},context,planning,revision,'turn');
   assert.equal(brief.evidence[0].kind,'rule');
  }finally{db.close()}
 })();
});
