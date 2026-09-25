import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionError} from '../lib/orbit/agent/client-request.ts';
import {AgentRequestError} from '../lib/orbit/agent/approval-feedback.ts';
import {sendDecision,deferActions} from '../lib/orbit/agent/decision-client.ts';

const card=(id,state='pending')=>({id,state,title:id});

test('a decision is one PATCH, and a defer carries its reason and revisit date',async()=>{
 const calls=[];
 const request=async(path,method,body)=>{calls.push({path,method,body});return {ok:true}};
 await sendDecision(card('a'),'approve',{reason:'x',revisitDate:'2026-10-01'},request);
 await sendDecision(card('b'),'defer',{reason:'나중에',revisitDate:'2026-10-01'},request);
 assert.deepEqual(calls.map(c=>c.body),[{id:'a',decision:'approve'},{id:'b',decision:'defer',reason:'나중에',revisitDate:'2026-10-01'}]);
});

test('after a lost connection the receipt decides whether the decision landed',async()=>{
 const landed=async(path)=>{if(path==='/api/agent')throw new ConnectionError('offline');return {receipt:{state:'deferred',note:'나중에',revisitDate:'2026-10-01'}}};
 assert.deepEqual(await sendDecision(card('a'),'defer',{reason:'나중에',revisitDate:'2026-10-01'},landed),{});
 const lost=async(path)=>{if(path==='/api/agent')throw new ConnectionError('offline');return {receipt:null}};
 await assert.rejects(sendDecision(card('a'),'defer',{reason:'나중에',revisitDate:'2026-10-01'},lost),ConnectionError);
});

test('bulk defer sends pending cards one by one, reports progress and keeps going after a failure',async()=>{
 const sent=[],progress=[];
 const request=async(path,method,body)=>{sent.push(body.id);if(body.id==='bad')throw new AgentRequestError('다른 곳에서 먼저 처리했습니다.','ACTION_CHANGED');return {ok:true}};
 const result=await deferActions([card('a'),card('running','applying'),card('bad'),card('c')],{reason:'지난 회의 정리',revisitDate:'2026-10-09'},{request,onProgress:(done,total)=>progress.push(`${done}/${total}`)});
 assert.deepEqual(sent,['a','bad','c'],'cards being applied are never deferred');
 assert.equal(result.deferred,2);
 assert.deepEqual(result.failed.map(f=>[f.item.id,f.message]),[['bad','다른 곳에서 먼저 처리했습니다.']]);
 assert.deepEqual(progress,['1/3','2/3','3/3']);
});

test('bulk defer stops at once when the session or connection is the problem, not the card',async()=>{
 const sent=[];
 const auth=async(path,method,body)=>{sent.push(body.id);throw new AgentRequestError('로그인을 다시 확인해 주세요.','AUTH')};
 const result=await deferActions([card('a'),card('b'),card('c')],{reason:'r',revisitDate:'2026-10-09'},{request:auth});
 assert.deepEqual(sent,['a'],'no more requests after an auth failure');
 assert.equal(result.stopped,'로그인을 다시 확인해 주세요.');
 assert.equal(result.remaining,2);
 const offline=async(path)=>{if(path==='/api/agent')throw new ConnectionError('연결이 끊겼습니다');return {receipt:null}};
 const cut=await deferActions([card('a'),card('b')],{reason:'r',revisitDate:'2026-10-09'},{request:offline});
 assert.equal(cut.deferred,0);assert.equal(cut.remaining,1);assert.match(cut.stopped,/연결/);
});

test('bulk defer stops after three failures in a row and can be cancelled',async()=>{
 const sent=[];
 const changed=async(path,method,body)=>{sent.push(body.id);throw new AgentRequestError('제안 상태가 변경됐습니다.','CONFLICT')};
 const result=await deferActions(['a','b','c','d','e'].map(id=>card(id)),{reason:'r',revisitDate:'2026-10-09'},{request:changed});
 assert.deepEqual(sent,['a','b','c']);assert.equal(result.failed.length,3);assert.equal(result.remaining,2);assert.ok(result.stopped);
 const controller=new AbortController();
 const ok=async(path,method,body)=>{if(body.id==='b')controller.abort();return {ok:true}};
 const cancelled=await deferActions(['a','b','c','d'].map(id=>card(id)),{reason:'r',revisitDate:'2026-10-09'},{request:ok,signal:controller.signal});
 assert.equal(cancelled.deferred,2);assert.equal(cancelled.remaining,2);assert.equal(cancelled.stopped,'중단했습니다.');
});
