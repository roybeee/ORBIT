import assert from 'node:assert/strict';
import test from 'node:test';
import {clientRequest,ConnectionError,deliverMessage,reconcileMessage,decisionReceiptMatches} from '../lib/orbit/agent/client-request.ts';
import {setRequestOwner} from '../lib/orbit/request-owner.ts';
const envelope={id:'turn',conversationId:'legacy',message:'private message',attachmentIds:['file']};
const receipt=status=>({...envelope,input:envelope.message,status});
const fast={pause:async()=>{}};
test('safe reads recover transient fetch and HTML gateway failures; writes never blindly retry',async()=>{
 let calls=0;const fetcher=async()=>{calls++;if(calls===1)throw new TypeError('Failed to fetch');return Response.json({ok:true})};
 assert.deepEqual(await clientRequest('/api/agent','GET',undefined,{...fast,fetcher}),{ok:true});assert.equal(calls,2);
 calls=0;await assert.rejects(()=>clientRequest('/api/agent','PATCH',{}, {...fast,fetcher}),e=>e instanceof ConnectionError&&!e.message.includes('Failed to fetch'));assert.equal(calls,1);
 calls=0;await clientRequest('/api/agent','GET',undefined,{...fast,fetcher:async()=>++calls===1?new Response('<h1>Unavailable</h1>',{status:503,headers:{'content-type':'text/html'}}):Response.json({ok:true})});assert.equal(calls,2);
});
test('lost submission acknowledgement reconciles stored running, completed and failed turns without rerunning',async()=>{
 for(const status of ['running','completed','failed']){const calls=[];const result=await deliverMessage(envelope,async(path,method,body)=>{calls.push({path,method,body});if(method==='POST')throw new ConnectionError('연결');return {receipt:receipt(status)}});assert.equal(result.status,status);assert.equal(calls.filter(c=>c.method==='POST').length,1)}
});
test('confirmed absence permits only identical ordinary resubmission, even for an explicit retry',async()=>{
 const bodies=[];await deliverMessage(envelope,async(path,method,body)=>{if(method==='POST'){bodies.push(body);if(bodies.length===1)throw new ConnectionError('연결');return {status:'running'}}return {receipt:null}},true);
 assert.equal(bodies.length,2);assert.deepEqual(bodies[0],{...envelope,retryFailed:true});assert.deepEqual(bodies[1],envelope);
 await assert.rejects(()=>reconcileMessage(envelope,async()=>({receipt:{...receipt('running'),input:'other'}})),e=>e.code==='CONFLICT');
});
test('account changes after a lost response never send the private envelope to another owner',async()=>{
 globalThis.window={};setRequestOwner('owner-a');let calls=0;
 try{await assert.rejects(()=>deliverMessage(envelope,async()=>{calls++;setRequestOwner('owner-b');throw new ConnectionError('연결')}),e=>e.code==='SESSION_CHANGED');assert.equal(calls,1)}finally{setRequestOwner('');delete globalThis.window}
});
test('owner identity is checked after parsing a successful response as well',async()=>{
 globalThis.window={};setRequestOwner('owner-a');try{await assert.rejects(()=>clientRequest('/api/agent','GET',undefined,{...fast,fetcher:async()=>{setRequestOwner('owner-b');return Response.json({ok:true})}}),e=>e.code==='SESSION_CHANGED')}finally{setRequestOwner('');delete globalThis.window}
});
test('approval acknowledgements reconcile exact defer details and accepted refresh receipts',()=>{
 assert.equal(decisionReceiptMatches({state:'deferred',note:'old',revisitDate:'2026-10-01'},{decision:'defer',reason:'new',revisitDate:'2026-10-01'}),false);
 assert.equal(decisionReceiptMatches({state:'deferred',note:'new',revisitDate:'2026-10-02'},{decision:'defer',reason:'new',revisitDate:'2026-10-01'}),false);
 assert.equal(decisionReceiptMatches({state:'deferred',note:'new',revisitDate:'2026-10-01'},{decision:'defer',reason:'new',revisitDate:'2026-10-01'}),true);
 assert.equal(decisionReceiptMatches({state:'pending',note:'',revisitDate:null,refreshTurnId:'refresh',refreshStatus:'running'},{decision:'approve'}),true);
});

test('a lost acknowledgement followed by receipt authentication failure remains uncertain',async()=>{
 const {AgentRequestError}=await import('../lib/orbit/agent/approval-feedback.ts');const {uncertainDelivery}=await import('../lib/orbit/agent/client-request.ts');
 await assert.rejects(()=>deliverMessage(envelope,async(_path,method)=>{if(method==='POST')throw new ConnectionError('연결');throw new AgentRequestError('로그인','AUTH')}),e=>e.code==='AUTH'&&uncertainDelivery(e));
 assert.equal(decisionReceiptMatches({state:'pending',note:'',revisitDate:null,refreshTurnId:'missing'},{decision:'approve'}),false);
});
