import test from 'node:test';
import assert from 'node:assert/strict';
import {unsupportedHandoff,handoffCorrection} from '../lib/orbit/agent/execution-claims.ts';
test('plain team mention is not a dispatch',()=>assert.equal(unsupportedHandoff('@개발팀 확인 요청드립니다.',[]),true));
test('unrelated receipt cannot ground a claim',()=>assert.equal(unsupportedHandoff('개발팀이 작업 중입니다.',[{runId:'run-old',status:'running'}]),true));
test('a queued or failed run is not started development',()=>{for(const status of ['queued','failed','unknown','cancelled'])assert.equal(unsupportedHandoff('개발팀이 작업 중입니다. run-1',[{runId:'run-1',status}]),true)});
test('an identified running receipt can be reported',()=>assert.equal(unsupportedHandoff('에이전트가 진행 중입니다. run-1',[{runId:'run-1',status:'running'}]),false));
test('a proposal accurately remains pending execution',()=>{assert.equal(unsupportedHandoff('실행할 업무를 제안했습니다. 승인하면 실행됩니다.',[]),false);assert.match(handoffCorrection(true),/아직/)});

test('a parent receipt never proves a development team or child agent was dispatched',()=>{
 for(const status of ['running','completed','waiting_for_approval']){
  for(const claim of ['개발팀이 작업 중입니다.','dev-lead가 진행 중입니다.','하위 에이전트가 착수했습니다.','서브에이전트가 완료했습니다.','**개발팀**이 작업 중입니다.','@개발팀 확인 요청드립니다.','에이전트에게 위임했습니다.','에이전트가 전달했습니다.']){
   assert.equal(unsupportedHandoff(claim+' run-parent',[{runId:'run-parent',status}]),true,`${status}: ${claim}`);
  }
 }
});
test('parent completion and approval waiting cannot substantiate current execution',()=>{
 for(const status of ['queued','completed','waiting_for_approval','failed','unknown','cancelled','stopping']){
  assert.equal(unsupportedHandoff('에이전트가 진행 중입니다. run-parent',[{runId:'run-parent',status}]),true,status);
 }
});
test('honest completed and approval-waiting parent reports retain matching receipts',()=>{
 const cases=[['에이전트 실행이 종료되었습니다.','completed'],['Hermes가 승인 대기 중입니다.','waiting_for_approval']];
 for(const [claim,status] of cases){
  assert.equal(unsupportedHandoff(claim+' run-parent',[{runId:'run-parent',status}]),false);
  assert.equal(unsupportedHandoff(claim+' run-parent',[{runId:'run-parent',status:'running'}]),true);
  assert.equal(unsupportedHandoff(claim,[]),true);
 }
});
test('a similar run ID and an unrelated running order do not ground a status claim',()=>{
 assert.equal(unsupportedHandoff('에이전트가 작업 중입니다. run-10',[{runId:'run-1',status:'running'}]),true);
 assert.equal(unsupportedHandoff('에이전트가 작업 중입니다. run-parent',[{runId:'run-other',status:'running'},{runId:'run-parent',status:'completed'}]),true);
 assert.equal(unsupportedHandoff('에이전트가 작업 중입니다. `run-parent`',[{runId:'run-parent',status:'running'}]),false);
});
test('an unsupported handoff is not excused by an honest parent execution in the same response',()=>{
 assert.equal(unsupportedHandoff('Hermes가 실행 중입니다. run-parent\n개발팀이 작업 중입니다.',[{runId:'run-parent',status:'running'}]),true);
});
test('denials and pending proposals do not claim delegation',()=>{
 for(const text of ['개발팀에 위임하지 않았습니다.','개발팀 작업 착수는 확인되지 않았습니다.','에이전트 실행을 제안했습니다. 승인하면 시작됩니다.'])assert.equal(unsupportedHandoff(text,[]),false);
});
