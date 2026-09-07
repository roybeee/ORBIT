import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand,RevisionConflict} from '../db/repository.ts';
import {applyAction,DomainError} from '../lib/orbit/reducer.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {generateProposal} from '../lib/orbit/planner.ts';
import {todayInZone,addDays,weekDates,validDate} from '../lib/orbit/dates.ts';
const now=new Date('2026-09-06T13:00:00Z');
const project={id:'project',name:'Release',color:'#5558e8',symbol:'O',goal:'Ship an observable result',due:'2026-09-13',priority:5};
const task={id:'task',title:'Prepare release',projectId:'project',status:'todo',duration:60,due:'2026-09-07',impact:5,focus:false,definition:'A reviewed release'};
const command=(expectedRevision,action,operationId=randomUUID())=>({expectedRevision,action,operationId});
test('new owners have independent empty workspaces and persisted reads survive reload',async()=>{
 const db=createDatabase();try{assert.equal((await readWorkspace(db,'alice')).revision,0);const saved=await writeCommand(db,'alice',command(0,{type:'project.upsert',project}),now);assert.equal(saved.revision,1);assert.equal((await readWorkspace(db,'alice')).data.projects[0].name,'Release');assert.equal((await readWorkspace(db,'bob')).data.projects.length,0);assert.equal((await readWorkspace(db,'bob')).revision,0)}finally{db.close()}
});
test('retrying one operation changes data once and rejects reusing its ID for a different action',async()=>{
 const db=createDatabase();try{const request=command(0,{type:'project.upsert',project});await writeCommand(db,'alice',request,now);assert.equal((await writeCommand(db,'alice',request,now)).revision,1);await assert.rejects(()=>writeCommand(db,'alice',{...request,action:{type:'project.upsert',project:{...project,name:'Changed'}}},now),RevisionConflict)}finally{db.close()}
});
test('stale devices cannot overwrite a newer revision',async()=>{
 const db=createDatabase();try{await writeCommand(db,'alice',command(0,{type:'project.upsert',project}),now);await assert.rejects(()=>writeCommand(db,'alice',command(0,{type:'project.upsert',project:{...project,name:'Lost update'}}),now),RevisionConflict);assert.equal((await readWorkspace(db,'alice')).data.projects[0].name,'Release')}finally{db.close()}
});
test('simultaneous first writes resolve to one committed command and a conflict',async()=>{
 const db=createDatabase();try{const outcomes=await Promise.allSettled([writeCommand(db,'alice',command(0,{type:'project.upsert',project}),now),writeCommand(db,'alice',command(0,{type:'project.upsert',project:{...project,name:'Other'}}),now)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal((await readWorkspace(db,'alice')).revision,1)}finally{db.close()}
});
test('references must exist in the authenticated owner workspace',async()=>{
 const db=createDatabase();try{await writeCommand(db,'alice',command(0,{type:'project.upsert',project}),now);await assert.rejects(()=>writeCommand(db,'bob',command(0,{type:'task.upsert',task}),now),DomainError);assert.equal((await readWorkspace(db,'bob')).revision,0)}finally{db.close()}
});
test('approval atomically persists the calendar block, focus and decision; replay stays unique',async()=>{
 const db=createDatabase();try{let state=await writeCommand(db,'alice',command(0,{type:'project.upsert',project}),now);state=await writeCommand(db,'alice',command(state.revision,{type:'task.upsert',task}),now);state=await writeCommand(db,'alice',command(state.revision,{type:'proposal.generate',date:'2026-09-07',energy:'normal'}),now);assert.equal(state.data.events.length,0);const proposal=state.data.proposals[0];const approve=command(state.revision,{type:'proposal.approve',date:proposal.date,itemId:proposal.items[0].id});state=await writeCommand(db,'alice',approve,now);state=await writeCommand(db,'alice',approve,now);assert.equal(state.data.events.length,1);assert.equal(state.data.proposals[0].items[0].state,'approved');assert.equal(state.data.tasks[0].focusDate,'2026-09-07');state=await writeCommand(db,'alice',command(state.revision,{type:'proposal.revoke',date:proposal.date,itemId:proposal.items[0].id}),now);assert.equal(state.data.events.length,0);assert.equal(state.data.proposals[0].items[0].state,'pending')}finally{db.close()}
});
test('a newly added fixed event prevents stale proposal approval without partial writes',async()=>{
 const db=createDatabase();try{let state=await writeCommand(db,'alice',command(0,{type:'project.upsert',project}),now);state=await writeCommand(db,'alice',command(state.revision,{type:'task.upsert',task}),now);state=await writeCommand(db,'alice',command(state.revision,{type:'proposal.generate',date:'2026-09-07',energy:'normal'}),now);const item=state.data.proposals[0].items[0];state=await writeCommand(db,'alice',command(state.revision,{type:'event.upsert',event:{id:'meeting',title:'Fixed',date:'2026-09-07',start:item.start,end:item.end,kind:'meeting'}}),now);await assert.rejects(()=>writeCommand(db,'alice',command(state.revision,{type:'proposal.approve',date:'2026-09-07',itemId:item.id}),now),DomainError);const reloaded=await readWorkspace(db,'alice');assert.equal(reloaded.revision,state.revision);assert.equal(reloaded.data.events.length,1);assert.equal(reloaded.data.proposals[0].items[0].state,'pending')}finally{db.close()}
});
test('deferred tasks remain excluded across days until the selected revisit date',()=>{
 let data={...emptyWorkspace(),projects:[project],tasks:[task]};data=applyAction(data,{type:'proposal.generate',date:'2026-09-07',energy:'normal'},now);const item=data.proposals[0].items[0];data=applyAction(data,{type:'proposal.defer',date:'2026-09-07',itemId:item.id,reason:'Need information',revisitDate:'2026-09-10'},now);assert.equal(generateProposal(data.tasks,[], '2026-09-08').items.length,0);assert.equal(generateProposal(data.tasks,[], '2026-09-10').items.length,1);data=applyAction(data,{type:'proposal.reconsider',date:'2026-09-07',itemId:item.id},now);assert.equal(data.tasks[0].planHoldUntil,undefined);
});
test('workdays and cycle validation reject impossible plans and references',()=>{
 let data={...emptyWorkspace(),projects:[project],tasks:[task]};assert.equal(generateProposal(data.tasks,[],'2026-09-06','normal',undefined,data.preferences).items.length,0);assert.throws(()=>applyAction(data,{type:'task.upsert',task:{...task,dependsOn:['task']}},now),DomainError);
});
test('local dates handle Korean midnight, month/year boundaries and leap years',()=>{
 assert.equal(todayInZone('Asia/Seoul',new Date('2026-09-06T15:01:00Z')),'2026-09-07');assert.equal(addDays('2026-12-31',1),'2027-01-01');assert.equal(validDate('2026-02-29'),false);assert.equal(validDate('2028-02-29'),true);assert.deepEqual(weekDates('2026-09-06'),['2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-05','2026-09-06']);
});

test('an evening review detail is written atomically with the workspace, replays once and exports', async () => {
  const db = createDatabase();
  try {
    const { readReview, listReviews, exportWorkspace } = await import('../db/repository.ts');
    let state = await writeCommand(db, 'alice', command(0, { type: 'project.upsert', project }), now);
    state = await writeCommand(db, 'alice', command(state.revision, { type: 'task.upsert', task }), now);
    const detail = {
      date: '2026-09-06',
      items: [{ taskId: 'task', title: task.title, outcome: 'done', estimateMinutes: 60, actualMinutes: 80 }],
      feedback: [
        { taskId: 'task', cause: '검토 대기', alternative: '오전 발송', rule: '검토 요청은 오전에 보낸다' },
      ],
      energy: { sleepMinutes: 400 },
      smallWins: ['릴리스 노트 완성'],
      gratitude: [],
      habitChecks: [],
    };
    const save = command(state.revision, {
      type: 'review.saveGenerate',
      review: { date: '2026-09-06', win: '', block: '', energy: 'normal' },
      detail,
    });
    await assert.rejects(
      () => writeCommand(db, 'alice', { ...save, expectedRevision: 0 }, now),
      RevisionConflict,
    );
    assert.equal(
      await readReview(db, 'alice', '2026-09-06'),
      null,
      'a rejected command writes no review row',
    );
    state = await writeCommand(db, 'alice', save, now);
    state = await writeCommand(db, 'alice', save, now);
    assert.equal(state.revision, 3);
    assert.deepEqual(await readReview(db, 'alice', '2026-09-06'), detail);
    assert.equal(await readReview(db, 'bob', '2026-09-06'), null);
    assert.equal(state.data.tasks[0].outcome, 'done');
    assert.equal(state.data.reviews[0].hasDetail, true);
    assert.equal(state.data.improvements.length, 1);
    assert.equal((await listReviews(db, 'alice', '2026-09-01', '2026-09-07')).length, 1);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM orbit_reviews WHERE owner_id='alice'").first()).n,
      1,
    );
    const revised = command(state.revision, {
      type: 'review.saveGenerate',
      review: { date: '2026-09-06', win: '', block: '', energy: 'high' },
      detail: { ...detail, smallWins: ['수정된 기록'] },
    });
    state = await writeCommand(db, 'alice', revised, now);
    assert.deepEqual((await readReview(db, 'alice', '2026-09-06')).smallWins, ['수정된 기록']);
    const output = await new Response(exportWorkspace(db, 'alice', state)).json();
    assert.equal(output.data.reviewDetails.length, 1);
    assert.equal(output.data.reviewDetails[0].date, '2026-09-06');
    assert.equal(output.data.reviews[0].highlight, '수정된 기록');
  } finally {
    db.close();
  }
});
