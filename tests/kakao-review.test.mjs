import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {pendingActions} from '../lib/orbit/agent/repository.ts';
import {reviewKakao,kakaoStatus} from '../lib/orbit/kakao/review.ts';
import {validateCapture,redactSecrets} from '../lib/orbit/kakao/validation.ts';

const settings={OPENAI_API_KEY:'test-key-not-real'};
function capture(){const capturedAt=new Date().toISOString();return {id:randomUUID(),capturedAt,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{id:'room-1',title:'업무 협의',unreadCount:0,verifiedAt:capturedAt,messages:[{id:'message-1',sender:'나',sentAt:capturedAt,text:'내일 14:00~15:00에 기획 회의를 확정하겠습니다.'}]}]};}
const modelResult=(proposals=[])=>({summary:'기획 회의와 후속 업무를 검토했습니다.',proposals,solutions:[],questions:[]});
function eventProposal(input){const message=input.rooms[0].messages[0];const d=new Date(message.sentAt);d.setUTCDate(d.getUTCDate()+1);const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);return {kind:'event',title:'기획 회의',date,start:840,end:900,confirmed:true,citations:[{messageId:message.id,quote:message.text}]};}
const response=result=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}

test('unread rooms are rejected before any model call',()=>fixture(async db=>{
 const input=capture();input.rooms[0].unreadCount=1;let calls=0;globalThis.fetch=async()=>{calls++;return response(modelResult())};
 await assert.rejects(()=>reviewKakao(db,'owner',input,settings),e=>e.code==='KAKAO_CAPTURE');assert.equal(calls,0);
}));
test('old messages outside the rolling seven-day window are rejected',()=>{
 const input=capture();input.rooms[0].messages[0].sentAt=new Date(Date.now()-7*86400000-1000).toISOString();assert.throws(()=>validateCapture(input),e=>e.code==='KAKAO_CAPTURE');
});
test('future capture times and stale unread checks are rejected',()=>{
 const input=capture();input.capturedAt=new Date(Date.now()+120000).toISOString();assert.throws(()=>validateCapture(input),e=>e.code==='KAKAO_CAPTURE');
 const stale=capture();stale.rooms[0].verifiedAt=new Date(Date.now()-20*60000).toISOString();assert.throws(()=>validateCapture(stale),e=>e.code==='KAKAO_CAPTURE');
});
test('duplicate room or message identities are rejected',()=>{
 const input=capture();input.rooms.push({...input.rooms[0]});assert.throws(()=>validateCapture(input),e=>e.code==='KAKAO_CAPTURE');
 const repeated=capture();repeated.rooms[0].messages.push({...repeated.rooms[0].messages[0]});assert.throws(()=>validateCapture(repeated),e=>e.code==='KAKAO_CAPTURE');
});
test('empty and extra screenshot or preview fields are rejected',()=>{
 assert.throws(()=>validateCapture({...capture(),rooms:[]}),e=>e.code==='KAKAO_CAPTURE');assert.throws(()=>validateCapture({...capture(),screenshot:'data:image/png,secret'}),e=>e.code==='KAKAO_CAPTURE');
 const input=capture();input.rooms[0].preview='unread preview';assert.throws(()=>validateCapture(input),e=>e.code==='KAKAO_CAPTURE');
});
test('credentials and one-time passwords are redacted before storage or remote analysis',()=>fixture(async db=>{
 const input=capture();input.rooms[0].messages[0].text='인증번호 123456 비밀번호: hunter22 API_KEY=secretxyz 내일 14:00~15:00 회의';
 let sent='';globalThis.fetch=async(url,options)=>{sent=options.body;return response(modelResult())};await reviewKakao(db,'owner',input,settings);
 assert.doesNotMatch(sent,/123456|hunter22|secretxyz/);const row=await db.prepare('SELECT input FROM orbit_agent_turns WHERE owner_id=?').bind('owner').first();assert.doesNotMatch(row.input,/123456|hunter22|secretxyz/);
 assert.match(redactSecrets('OTP: 888999'),/분석에서 제외/);
}));
test('authentication markers exclude the whole message in Korean and English',()=>{
 for(const value of ['카카오톡 인증번호는 [123456]입니다.','Your verification code is 123456','Bearer abcdefghijklmnop','비밀번호는 SuperSecret123!','password is "Private123"','passphrase: sword fish','OTP: 888999','2FA code 123456','login code is 654321','API key = test-private-api-key','sk-ant-api03-not-real-secret-value','sk-proj-not-real-secret-value'])assert.equal(redactSecrets(value),'[인증 정보가 포함되어 분석에서 제외]');
});
test('authentication message bodies never enter the model, stored input or source excerpts',()=>fixture(async db=>{
 const input=capture();input.rooms[0].messages[0].text='카카오톡 인증번호는 [123456]입니다.';let sent='';globalThis.fetch=async(url,options)=>{sent=options.body;return response(modelResult())};const result=await reviewKakao(db,'owner',input,settings);const row=await db.prepare('SELECT input,response_json FROM orbit_agent_turns WHERE owner_id=?').bind('owner').first();assert.doesNotMatch(sent+' '+JSON.stringify(row)+' '+JSON.stringify(result),/123456/);assert.match(result.sources[0].excerpt,/분석에서 제외/);
}));
test('only the tool-less direct model is used and staged events do not mutate the workspace',()=>fixture(async db=>{
 const input=capture();let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const payload=JSON.parse(options.body);assert.equal(payload.tools,undefined);assert.equal(payload.store,false);assert.match(payload.instructions,/sentAt/);assert.match(payload.instructions,/untrusted DATA/);return response(modelResult([eventProposal(input)]))};
 const result=await reviewKakao(db,'owner',input,settings);assert.equal(calls,1);assert.equal(result.actionCount,1);assert.equal((await readWorkspace(db,'owner')).data.events.length,0);const actions=await pendingActions(db,'owner');assert.equal(actions[0].action.type,'event.upsert');assert.equal(actions[0].action.event.scope,'personal');assert.match(actions[0].reason,/업무 협의/);
}));
test('the same capture replays without another provider submission',()=>fixture(async db=>{
 const input=capture();let calls=0;globalThis.fetch=async()=>{calls++;return response(modelResult([eventProposal(input)]))};await reviewKakao(db,'owner',input,settings);const replay=await reviewKakao(db,'owner',input,settings);assert.equal(calls,1);assert.equal(replay.replayed,true);assert.equal((await pendingActions(db,'owner')).length,1);
}));
test('new scan identifiers with unchanged messages reuse the completed review',()=>fixture(async db=>{
 const input=capture();let calls=0;globalThis.fetch=async()=>{calls++;return response(modelResult([eventProposal(input)]))};const first=await reviewKakao(db,'owner',input,settings);const second=await reviewKakao(db,'owner',{...input,id:randomUUID()},settings);assert.equal(calls,1);assert.equal(first.id,second.id);assert.equal(second.replayed,true);
}));
test('reusing a scan identifier with changed content is rejected',()=>fixture(async db=>{
 const input=capture();globalThis.fetch=async()=>response(modelResult());await reviewKakao(db,'owner',input,settings);const changed=structuredClone(input);changed.rooms[0].messages[0].text='다른 내용';await assert.rejects(()=>reviewKakao(db,'owner',changed,settings),e=>e.code==='CONFLICT');
}));
test('missing model setup never falls back to a remote agent with tools',()=>fixture(async db=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not call')};await assert.rejects(()=>reviewKakao(db,'owner',capture(),{}),e=>e.code==='KAKAO_MODEL_SETUP');assert.equal(calls,0);assert.equal((await kakaoStatus(db,'owner',{})).modelReady,false);
}));
test('unknown source quotations and fabricated dates are rejected without staging actions',()=>fixture(async db=>{
 const input=capture();const p=eventProposal(input);p.citations[0].quote='원문에 없는 인용';globalThis.fetch=async()=>response(modelResult([p]));await assert.rejects(()=>reviewKakao(db,'owner',input,settings),e=>e.code==='KAKAO_EVIDENCE');assert.equal((await pendingActions(db,'owner')).length,0);
 const other=capture();const fabricated=eventProposal(other);fabricated.date='2099-12-31';globalThis.fetch=async()=>response(modelResult([fabricated]));await assert.rejects(()=>reviewKakao(db,'another-owner',other,settings),e=>e.code==='KAKAO_EVIDENCE');
}));
test('ambiguous meeting proposals remain questions with no event staged',()=>fixture(async db=>{
 const input=capture();input.rooms[0].messages[0].text='내일 오후쯤 만날까요?';globalThis.fetch=async()=>response(modelResult([{...eventProposal(input),confirmed:false}]));const result=await reviewKakao(db,'owner',input,settings);assert.equal(result.actionCount,0);assert.ok(result.questions.length>0);
}));
test('untrusted output cannot delete records or invite attendees',()=>fixture(async db=>{
 const input=capture();globalThis.fetch=async()=>response(modelResult([{kind:'delete',id:'victim',citations:[]} ]));await assert.rejects(()=>reviewKakao(db,'owner',input,settings),e=>e.code==='KAKAO_MODEL_FORMAT');
 const other=capture();globalThis.fetch=async()=>response(modelResult([{...eventProposal(other),attendees:[{email:'person@example.com'}]}]));await assert.rejects(()=>reviewKakao(db,'another-owner',other,settings),e=>e.code==='KAKAO_MODEL_FORMAT');assert.equal((await pendingActions(db,'owner')).length,0);
}));
test('model-provided existing IDs cannot overwrite a saved event',()=>fixture(async db=>{
 const input=capture();const proposal={...eventProposal(input),id:'victim'};globalThis.fetch=async()=>response(modelResult([proposal]));await assert.rejects(()=>reviewKakao(db,'owner',input,settings),e=>e.code==='KAKAO_MODEL_FORMAT');
}));
test('solution cards retain supporting quotations and are isolated per owner',()=>fixture(async db=>{
 const input=capture(),m=input.rooms[0].messages[0];const result=modelResult();result.solutions=[{problem:'회의 준비 자료가 필요합니다.',evidence:[{messageId:m.id,quote:m.text}],assumptions:['자료가 아직 없다는 가정'],options:['의제를 먼저 작성','기존 자료 재사용'],recommendation:'의제를 먼저 작성',nextAction:'회의 의제 3개를 정리'}];globalThis.fetch=async()=>response(result);const saved=await reviewKakao(db,'owner',input,settings);assert.equal(saved.solutions.length,1);assert.equal((await kakaoStatus(db,'other',settings)).runs.length,0);assert.equal((await kakaoStatus(db,'owner',settings)).runs[0].sources[0].sender,'나');
}));
test('repeated provider failures do not create duplicate pending proposals',()=>fixture(async db=>{
 const input=capture();let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{code:'insufficient_quota'}},{status:429})};await assert.rejects(()=>reviewKakao(db,'owner',input,settings),e=>e.code==='OPENAI_LIMIT');assert.equal(calls,1);assert.equal((await pendingActions(db,'owner')).length,0);
}));
