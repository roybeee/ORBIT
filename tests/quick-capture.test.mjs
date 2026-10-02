import test from 'node:test';
import assert from 'node:assert/strict';
import {readCapture,captureAction,findDate,findTime,findMinutes,CAPTURE_INBOX_ID,CAPTURE_TAG} from '../lib/orbit/quick-capture.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {commandSchema} from '../lib/orbit/validation.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {WorkspaceWrites,instantAction} from '../lib/orbit/workspace-write-client.ts';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {createDatabase} from './sqlite-d1.mjs';

// 2026-10-02 is a Friday.
const today='2026-10-02';
const now=new Date('2026-10-02T01:00:00Z');
const project=(id,name,keywords)=>({id,name,color:'#5558e8',symbol:name.slice(0,1),goal:'',due:'2026-12-31',priority:3,...(keywords?{keywords}:{})});
const projects=[project('mapdal','맵달 성수',['맵달','성수 매장']),project('ir','시리즈A 투자',['투자','IR'])];
const ctx={today,projects,tasks:[],notes:[]};
const data=()=>({...emptyWorkspace(),projects:structuredClone(projects)});
const valid=action=>assert.equal(commandSchema.safeParse({operationId:'00000000-0000-4000-8000-000000000001',expectedRevision:0,action}).success,true,JSON.stringify(action));

test('relative and Korean calendar dates resolve from the local day',()=>{
 assert.equal(findDate('내일 미팅',today).date,'2026-10-03');
 assert.equal(findDate('모레까지',today).date,'2026-10-04');
 assert.equal(findDate('내일모레 오후',today).date,'2026-10-04');
 assert.equal(findDate('월요일에 보내기',today).date,'2026-10-05');
 assert.equal(findDate('금요일',today).date,today,'today counts as the coming weekday');
 assert.equal(findDate('다음주 수요일',today).date,'2026-10-07');
 assert.equal(findDate('이번주 목요일',today).date,'2026-10-01');
 assert.equal(findDate('10월 15일 제출',today).date,'2026-10-15');
 assert.equal(findDate('1/10 출장',today).date,'2027-01-10','a month-day far in the past is next year');
 assert.equal(findDate('20일까지',today).date,'2026-10-20');
 assert.equal(findDate('1일까지',today).date,'2026-11-01','a passed day of month is next month');
 assert.equal(findDate('3일 동안 출장',today),undefined,'a duration is not a date');
 assert.equal(findDate('매출 1.5배',today),undefined);
});

test('clock times read meridiem, ranges and bare afternoon hours',()=>{
 assert.equal(findTime('3시 미팅').start,15*60);
 assert.equal(findTime('오전 10시 반').start,10*60+30);
 assert.equal(findTime('오후 2시 15분').start,14*60+15);
 assert.equal(findTime('9시 회의').start,9*60);
 assert.equal(findTime('저녁 7시').start,19*60);
 assert.equal(findTime('14:30 통화').start,14*60+30);
 const range=findTime('3시~4시 반 미팅');assert.equal(range.start,15*60);assert.equal(range.end,16*60+30);
 const morning=findTime('오전 11시부터 1시까지');assert.equal(morning.start,11*60);assert.equal(morning.end,13*60);
 assert.equal(findTime('2시간 작업'),undefined,'a duration is not a clock time');
 assert.equal(findMinutes('2시간 반'),150);assert.equal(findMinutes('30분 정도'),30);
});

test('the kind follows the text: time → event, action verb or deadline → task, long text → memo',()=>{
 const event=readCapture('내일 오후 3시 성수 파트너 미팅',ctx);
 assert.equal(event.kind,'event');assert.equal(event.date,'2026-10-03');assert.equal(event.start,900);assert.equal(event.title,'성수 파트너 미팅');
 const task=readCapture('금요일까지 IR 덱 수정본 보내기',ctx);
 assert.equal(task.kind,'task');assert.equal(task.date,today);assert.equal(task.title,'IR 덱 수정본 보내기');assert.equal(task.project.projectId,'ir');
 assert.equal(readCapture('세무사에게 부가세 자료 요청',ctx).kind,'task');
 const memo=readCapture('맵달 팝업 아이디어: 외국인 관광객 대상 매운맛 단계 챌린지',ctx);
 assert.equal(memo.kind,'note');assert.equal(memo.project.projectId,'mapdal');assert.match(memo.body,/챌린지/);
 const meeting=readCapture('투자사 미팅\n- 밸류 논의\n- 다음 자료 요청 받음\n- 2주 후 재미팅',ctx);
 assert.equal(meeting.kind,'meeting');assert.equal(meeting.title,'투자사 미팅');
 const long=readCapture('오늘 3시 미팅에서 들은 것\n1. 원가 구조 재검토\n2. 해외 파트너 샘플 발송\n3. 가격 테스트',ctx);
 assert.equal(long.kind,'meeting','a multi-line record with a time is a meeting note, not a calendar event');
});

test('explicit prefixes and checkboxes win over the guess',()=>{
 assert.deepEqual([readCapture('할 일: 아이디어 정리',ctx).kind,readCapture('메모: 내일 3시 미팅 생각',ctx).kind,readCapture('일정: 성수 답사',ctx).kind,readCapture('- [ ] 샘플 발송',ctx).kind],['task','note','event','task']);
 const prefixed=readCapture('메모: 내일 3시 미팅 생각',ctx);assert.equal(prefixed.explicit,true);assert.equal(prefixed.title,'내일 3시 미팅 생각');
});

test('every captured kind becomes one valid command that the reducer accepts',()=>{
 for(const [text,kind] of [['내일 3시 성수 파트너 미팅','event'],['IR 덱 수정본 보내기','task'],['아무 프로젝트와 무관한 생각','note'],['투자사 미팅\n- 밸류 논의\n- 자료 요청','meeting']]){
  const reading=readCapture(text,ctx);
  const action=captureAction(reading,kind,{id:'cap-'+kind,today,data:data(),nowMinute:600});
  valid(action);
  assert.equal(instantAction(action),true,kind+' saves without waiting for the server');
  const next=applyAction(data(),action,now);
  const saved=kind==='event'?next.events.find(e=>e.id==='cap-event'):kind==='task'?next.tasks.find(t=>t.id==='cap-task'):next.notes.find(n=>n.id==='cap-'+kind);
  assert.ok(saved,kind);
 }
});

test('records without a confident project land in 빠른 기록함, created in the same command',()=>{
 const reading=readCapture('그냥 떠오른 생각 하나',ctx);
 const action=captureAction(reading,'note',{id:'n1',today,data:data()});
 assert.equal(action.project.id,CAPTURE_INBOX_ID);
 const next=applyAction(data(),action,now);
 assert.equal(next.notes[0].projectId,CAPTURE_INBOX_ID);assert.ok(next.notes[0].tags.includes(CAPTURE_TAG));
 assert.equal(next.projects.filter(p=>p.id===CAPTURE_INBOX_ID).length,1);
 const second=captureAction(readCapture('또 다른 생각',ctx),'task',{id:'t1',today,data:next});
 assert.equal(second.project,undefined,'an existing inbox is reused without resending it');
 const after=applyAction(next,second,now);
 assert.equal(after.projects.filter(p=>p.id===CAPTURE_INBOX_ID).length,1);assert.equal(after.tasks[0].projectId,CAPTURE_INBOX_ID);
 const matched=captureAction(readCapture('맵달 성수 매장 동선 메모',ctx),'note',{id:'n2',today,data:data()});
 assert.equal(matched.project,undefined);assert.equal(matched.note.projectId,'mapdal');
});

test('a note.upsert carrying a project for another id is rejected',()=>{
 assert.throws(()=>applyAction(data(),{type:'note.upsert',project:project('x','X'),note:{id:'n',title:'t',kind:'wiki',projectId:'mapdal',summary:'',body:'',tags:[],updated:today}},now),/연결/);
});

test('events keep the day: an evening time near midnight is clipped and an untimed event gets the next half hour',()=>{
 const late=captureAction(readCapture('오후 11시 30분 해외 파트너 콜 2시간',ctx),'event',{id:'e1',today,data:data()});
 assert.equal(late.event.start,1410);assert.equal(late.event.end,1440);assert.equal(late.event.category,'phone');
 const untimed=captureAction(readCapture('성수 답사',ctx),'event',{id:'e2',today,data:data(),nowMinute:610});
 assert.equal(untimed.event.start,630);assert.equal(untimed.event.end,690);assert.equal(untimed.event.date,today);
});

test('instant memo: visible before the server answers, committed once, no blocking of later saves',async()=>{
 const db=createDatabase();
 try{
  let release;const gate=new Promise(r=>release=r);const calls=[];
  const client=new WorkspaceWrites({data:emptyWorkspace(),revision:0,updatedAt:null},{
   post:async cmd=>{calls.push(cmd.operationId);await gate;return writeCommand(db,'owner',cmd)},
   read:()=>readWorkspace(db,'owner'),persist:()=>{},change:()=>{},online:()=>true,
  });
  const memo=captureAction(readCapture('지금 떠오른 해외 파트너 제안 아이디어',{today,projects:[]}),'note',{id:'memo-1',today,data:emptyWorkspace()});
  assert.equal(await client.enqueue(memo),true);
  assert.equal(client.blocking,false,'a new memo never locks the screen');
  assert.equal(client.view.data.notes[0].id,'memo-1');
  const task=captureAction(readCapture('샘플 발송하기',{today,projects:client.view.data.projects}),'task',{id:'task-1',today,data:client.view.data});
  assert.equal(await client.enqueue(task),true);
  assert.equal(client.view.data.tasks[0].projectId,CAPTURE_INBOX_ID);
  release();while(client.running||client.queue.length)await new Promise(r=>setTimeout(r,1));
  const saved=await readWorkspace(db,'owner');
  assert.equal(saved.data.notes.length,1);assert.equal(saved.data.tasks.length,1);assert.equal(saved.data.projects.filter(p=>p.id===CAPTURE_INBOX_ID).length,1);
  assert.equal(calls.length,2);
 }finally{db.close()}
});

test('editing a loaded note still waits for the server revision check',()=>{
 assert.equal(instantAction({type:'note.upsert',expectedNoteRevision:2,note:{id:'n',title:'t',kind:'wiki',projectId:'p',summary:'',body:'',tags:[],updated:today}}),false);
});

test('captured tasks file themselves when a project that clearly matches them is created',()=>{
 let d={...emptyWorkspace(),projects:[]};
 for(const [id,text] of [['t1','올드페리도넛 가맹 제안서 보내기'],['t2','세탁소 맡기기']]){
  d=applyAction(d,captureAction(readCapture(text,{today,projects:d.projects}),'task',{id,today,data:d}),now);
 }
 d=applyAction(d,{type:'task.schedule',taskId:'t1',eventId:'ev1',date:'2026-10-05',start:600,minutes:30},now);
 assert.deepEqual(d.tasks.map(t=>t.projectId),[CAPTURE_INBOX_ID,CAPTURE_INBOX_ID]);
 d=applyAction(d,{type:'project.upsert',project:project('ofd','올드페리도넛',['올드페리도넛','가맹'])},now);
 assert.equal(d.tasks.find(t=>t.id==='t1').projectId,'ofd');
 assert.equal(d.events.find(e=>e.id==='ev1').projectId,'ofd','its calendar block moves with it');
 assert.equal(d.tasks.find(t=>t.id==='t2').projectId,CAPTURE_INBOX_ID,'unrelated captures stay in the inbox');
});
