import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {digest} from '../lib/orbit/slack/directives.ts';
import {handleSlackRequest,listSlackRequests,changeSlackRequest} from '../lib/orbit/slack/requests.ts';
import {advanceSlackRequests,processSlackRequests} from '../lib/orbit/slack/request-runtime.ts';
import {activeHold,recordLimit,clearHold} from '../lib/orbit/agent/provider-hold.ts';
import {advanceAgent} from '../lib/orbit/agent/runner.ts';
import {decide} from '../lib/orbit/agent/decisions.ts';
import {addDays,todayInZone} from '../lib/orbit/dates.ts';

const owner='owner',token='test-only-integration-credential-1234567890';
const env={OPENAI_API_KEY:'fixture-only',ORBIT_CHAT_MODEL:'gpt-5.6-luna'};
const project={id:'hantu',name:'한투파',goal:'해외 매출',due:'2099-01-31',color:'#4455cc',symbol:'H',priority:3,status:'active'};
const TEXT='오후 2시 미팅 진행, 참석자 이선미교수, 박혜영대표, 김동경대표, 나 안건은 한투파 프로젝트투자 해외매출건 관련으로 상파울루 추진 진행 타진의. 4시·6시 회의도 같이 등록해 줘';
const source={platform:'slack',workspaceId:'TTEST',requesterId:'UTEST',channelId:'C0B31KPEB61',messageTs:'1790313921.880000',eventId:'Ev01'};

async function setup(){
 const db=createDatabase();
 await writeCommand(db,owner,{operationId:'seed',expectedRevision:0,action:{type:'project.upsert',project}});
 await db.prepare('INSERT INTO orbit_slack_credentials(token_hash,owner_id,workspace_id,requester_id,scope,expires_at,revoked) VALUES(?,?,?,?,?,?,0)').bind(await digest(token),owner,'TTEST','UTEST','directives:write',4102444800000).run();
 return db;
}
function request(body,credential=token){return new Request('https://orbit.test/api/integrations/slack/requests',{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:JSON.stringify(body)})}
async function call(db,body,credential){const response=await handleSlackRequest(db,request(body,credential));return {status:response.status,data:await response.json()}}
const receive=(db,extra={})=>call(db,{action:'receive',source,text:TEXT,...extra});
const rowOf=db=>db.prepare('SELECT * FROM orbit_slack_requests WHERE owner_id=?').bind(owner).first();
const future=addDays(todayInZone('Asia/Seoul'),3);
const meeting=(id,start,date=future)=>({title:`${start/60}시 회의 등록`,reason:'Slack 지시 원문',action:{type:'event.upsert',event:{id,title:`${start/60}시 회의`,projectId:'hantu',date,start,end:start+60,kind:'meeting',description:'참석: 이선미교수 외'}}});
async function answer(db,proposals){
 const turn=(await rowOf(db)).turn_id;
 const real=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.match(JSON.parse(init.body).input.at(-1).content,/상파울루/);return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({kind:'final',text:'세 일정 초안을 준비했습니다. 승인하면 등록됩니다.',proposals})}]}]})};
 try{for(let i=0;i<5;i++){await advanceAgent(db,owner,turn,env);const t=await db.prepare('SELECT status FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,turn).first();if(t.status!=='running')break}}finally{globalThis.fetch=real}
 await advanceSlackRequests(db,owner);
 return calls;
}

test('a Slack message is stored before any AI call, and Slack retries of the same message share one receipt',async()=>{const db=await setup();try{
 const first=await receive(db);
 assert.equal(first.status,200,JSON.stringify(first.data));
 assert.equal(first.data.status,'received');assert.equal(first.data.duplicate,false);
 const again=await receive(db,{source:{...source,eventId:'Ev01-retry'}});
 assert.equal(again.data.id,first.data.id);assert.equal(again.data.duplicate,true);
 const rows=await db.prepare('SELECT * FROM orbit_slack_requests').all();
 assert.equal(rows.results.length,1);assert.equal(rows.results[0].deliveries,2);assert.equal(rows.results[0].text,TEXT);assert.equal(rows.results[0].event_id,'Ev01');
}finally{db.close()}});

test('only the registered requester can store requests; others are refused and nothing is kept',async()=>{const db=await setup();try{
 assert.equal((await call(db,{action:'receive',source:{...source,requesterId:'USOMEONE'},text:'hi'})).status,403);
 assert.equal((await call(db,{action:'receive',source,text:'hi'},'wrong-credential-000000000000000000000')).status,401);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM orbit_slack_requests').first()).n,0);
}finally{db.close()}});

test('a spent quota keeps the request waiting, joins the shared hold, and is never shown as an authentication failure',async()=>{const db=await setup();try{
 await receive(db);
 const before=Date.now();
 const limited=await call(db,{action:'outcome',source,outcome:'limit',kind:'quota',detail:'Codex provider quota exhausted (429). Credentials are still valid.',retryAfterSeconds:79663});
 assert.equal(limited.status,200,JSON.stringify(limited.data));
 assert.equal(limited.data.status,'waiting_quota');
 const hold=await activeHold(db,owner,'hermes');
 assert.ok(hold);assert.equal(hold.kind,'quota');assert.ok(hold.nextCheckAt>=before+79663000);
 const [item]=await listSlackRequests(db,owner);
 assert.equal(item.status,'waiting');assert.equal(item.reasonKind,'quota');assert.equal(item.holdId,hold.id);
 assert.match(item.statusLabel,/사용량 한도/);assert.doesNotMatch(item.statusLabel,/인증/);
 assert.ok(item.summary.length<=60);assert.equal(item.text,undefined);
 assert.match(item.permalink,/C0B31KPEB61\/p1790313921880000$/);
 // Hermes reports "answered" only for a turn that ended with an answer: the turn recovered after all.
 await call(db,{action:'outcome',source,outcome:'answered'});
 assert.equal((await rowOf(db)).status,'answered');
}finally{db.close()}});

test('once a resume has started, a late answer or limit report changes nothing and opens no hold',async()=>{const db=await setup();try{
 await receive(db);await call(db,{action:'outcome',source,outcome:'limit',kind:'quota',detail:'quota exhausted',retryAfterSeconds:0});
 await clearHold(db,owner,'hermes','test');
 await advanceSlackRequests(db,owner,env);
 assert.equal((await rowOf(db)).status,'processing');
 await call(db,{action:'outcome',source,outcome:'answered'});
 await call(db,{action:'outcome',source,outcome:'limit',kind:'quota',detail:'quota exhausted',retryAfterSeconds:3600});
 assert.equal((await rowOf(db)).status,'processing');
 assert.equal(await activeHold(db,owner,'hermes'),null);
}finally{db.close()}});

test('a request claimed by a worker that died before creating its turn waits again instead of blocking resumes',async()=>{const db=await setup();try{
 await receive(db);await call(db,{action:'outcome',source,outcome:'limit',kind:'quota',detail:'quota exhausted',retryAfterSeconds:0});
 await db.prepare("UPDATE orbit_slack_requests SET status='processing',turn_id='lost-turn',attempts=1,updated_at=?").bind(new Date(Date.now()-11*60000).toISOString()).run();
 await advanceSlackRequests(db,owner);
 const row=await rowOf(db);assert.equal(row.status,'waiting_quota');assert.equal(row.attempts,0);
}finally{db.close()}});

test('a short request-rate limit and an authentication failure get their own causes',async()=>{const db=await setup();try{
 await receive(db);
 await call(db,{action:'outcome',source,outcome:'limit',kind:'rate_limit',detail:'429 rate limited',retryAfterSeconds:30});
 let [item]=await listSlackRequests(db,owner);assert.equal(item.reasonKind,'rate_limit');assert.match(item.statusLabel,/일시적 요청 제한/);
 const other={...source,messageTs:'1790313999.000100'};
 await call(db,{action:'receive',source:other,text:'메모 남겨줘'});
 await call(db,{action:'outcome',source:other,outcome:'failed',kind:'auth',detail:'401 invalid token'});
 item=(await listSlackRequests(db,owner)).find(i=>i.messageTs===other.messageTs);
 assert.equal(item.status,'failed');assert.equal(item.reasonKind,'auth');assert.match(item.statusLabel,/인증/);
}finally{db.close()}});

test('an answered request is done in Slack and leaves the waiting list',async()=>{const db=await setup();try{
 await receive(db);await call(db,{action:'outcome',source,outcome:'answered'});
 assert.equal((await rowOf(db)).status,'answered');
 assert.equal((await listSlackRequests(db,owner)).length,0);
}finally{db.close()}});

test('after the limit recovers the saved text is interpreted exactly once into drafts; the calendar waits for approval',async()=>{const db=await setup();try{
 await receive(db);
 await call(db,{action:'outcome',source,outcome:'limit',kind:'quota',detail:'quota exhausted',retryAfterSeconds:3600});
 // While the provider ORBIT would use is on hold and not yet due, nothing starts.
 await recordLimit(db,owner,'openai','quota exhausted retry after 3600s',{id:'probe-x',automatic:true});
 await advanceSlackRequests(db,owner,env);
 assert.equal((await rowOf(db)).status,'waiting_quota');
 await clearHold(db,owner,'openai','test');
 await advanceSlackRequests(db,owner,env);await advanceSlackRequests(db,owner,env);
 const row=await rowOf(db);
 assert.equal(row.status,'processing');assert.equal(row.attempts,1);assert.ok(row.turn_id);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM orbit_agent_turns WHERE owner_id=?').bind(owner).first()).n,1);
 const calls=await answer(db,[meeting('m14',840),meeting('m16',960),meeting('m18',1080)]);
 assert.equal(calls,1);
 await advanceSlackRequests(db,owner,env);
 const [item]=await listSlackRequests(db,owner);
 assert.equal(item.status,'needs_review');assert.deepEqual({pending:item.counts.pending,total:item.counts.total},{pending:3,total:3});
 assert.equal((await readWorkspace(db,owner)).data.events.length,0);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM orbit_agent_turns WHERE owner_id=?').bind(owner).first()).n,1);
 const actions=await db.prepare('SELECT id FROM orbit_agent_actions WHERE owner_id=? ORDER BY rowid').bind(owner).all();
 for(const a of actions.results)await decide(db,owner,{id:a.id,decision:'approve'},env);
 assert.equal((await readWorkspace(db,owner)).data.events.length,3);
 const [done]=await listSlackRequests(db,owner);assert.equal(done.status,'completed');
}finally{db.close()}});

test('a draft whose time already passed is not registered as is; a new time can be approved',async()=>{const db=await setup();try{
 await receive(db);await call(db,{action:'outcome',source,outcome:'limit',kind:'quota',detail:'quota exhausted',retryAfterSeconds:0});
 await advanceSlackRequests(db,owner,env);
 const yesterday=addDays(todayInZone('Asia/Seoul'),-1);
 await answer(db,[meeting('past',840,yesterday)]);
 const [item]=await listSlackRequests(db,owner);
 assert.equal(item.status,'expired');assert.equal(item.counts.expired,1);
 const action=await db.prepare('SELECT id FROM orbit_agent_actions WHERE owner_id=?').bind(owner).first();
 await assert.rejects(()=>decide(db,owner,{id:action.id,decision:'approve'},env),e=>e.code==='SLACK_EXPIRED');
 assert.equal((await readWorkspace(db,owner)).data.events.length,0);
 await decide(db,owner,{id:action.id,decision:'approve',overrides:{date:future,start:900,end:960}},env);
 const event=(await readWorkspace(db,owner)).data.events[0];
 assert.deepEqual([event.date,event.start,event.end],[future,900,960]);
}finally{db.close()}});

test('a direct Google Calendar draft whose time passed is not created either',async()=>{const db=await setup();try{
 await receive(db);await call(db,{action:'outcome',source,outcome:'limit',kind:'quota',detail:'quota exhausted',retryAfterSeconds:0});
 await advanceSlackRequests(db,owner,env);
 const yesterday=addDays(todayInZone('Asia/Seoul'),-1);
 await answer(db,[meeting('past',840,yesterday)]);
 // The runner only proposes Google events with Google connected; the stored card is switched to one here.
 const action=await db.prepare('SELECT id FROM orbit_agent_actions WHERE owner_id=?').bind(owner).first();
 await db.prepare('UPDATE orbit_agent_actions SET action_json=? WHERE id=?').bind(JSON.stringify({type:'google.event.create',event:{title:'2시 미팅',date:yesterday,start:840,end:900,timeZone:'Asia/Seoul',description:''}}),action.id).run();
 const [item]=await listSlackRequests(db,owner);assert.equal(item.counts.expired,1);
 const real=globalThis.fetch;let google=0;globalThis.fetch=async()=>{google++;return new Response('{}',{status:500})};
 try{await assert.rejects(()=>decide(db,owner,{id:action.id,decision:'approve'},env),e=>e.code==='SLACK_EXPIRED')}finally{globalThis.fetch=real}
 assert.equal(google,0,'Google is never called for an expired draft');
}finally{db.close()}});

test('a resumed turn stopped by the limit again goes back to waiting without spending an attempt',async()=>{const db=await setup();try{
 await receive(db);await call(db,{action:'outcome',source,outcome:'limit',kind:'quota',detail:'quota exhausted',retryAfterSeconds:0});
 await advanceSlackRequests(db,owner,env);
 const turn=(await rowOf(db)).turn_id;
 const real=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'You exceeded your current quota',code:'insufficient_quota'}}),{status:429,headers:{'content-type':'application/json'}});
 try{for(let i=0;i<3;i++)await advanceAgent(db,owner,turn,env).catch(()=>{})}finally{globalThis.fetch=real}
 assert.equal((await db.prepare('SELECT status FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,turn).first()).status,'failed');
 await advanceSlackRequests(db,owner);
 const row=await rowOf(db);assert.equal(row.status,'waiting_quota');assert.equal(row.attempts,0);
}finally{db.close()}});

test('the owner can process a request again now or cancel it; cancelling closes its open drafts',async()=>{const db=await setup();try{
 await receive(db);await call(db,{action:'outcome',source,outcome:'failed',kind:'auth',detail:'401'});
 const [item]=await listSlackRequests(db,owner);
 await changeSlackRequest(db,owner,{id:item.id,action:'retry'});
 assert.equal((await rowOf(db)).status,'queued');
 await advanceSlackRequests(db,owner,env);
 await answer(db,[meeting('m14',840)]);
 // Processing again after something was registered would propose it twice.
 const action=await db.prepare('SELECT id FROM orbit_agent_actions WHERE owner_id=?').bind(owner).first();
 await db.prepare("UPDATE orbit_agent_actions SET state='approved' WHERE id=?").bind(action.id).run();
 await assert.rejects(()=>changeSlackRequest(db,owner,{id:item.id,action:'retry'}),/이미 등록한 초안/);
 await db.prepare("UPDATE orbit_agent_actions SET state='pending' WHERE id=?").bind(action.id).run();
 await changeSlackRequest(db,owner,{id:item.id,action:'cancel'});
 assert.equal((await rowOf(db)).status,'cancelled');
 assert.equal((await db.prepare("SELECT state FROM orbit_agent_actions WHERE owner_id=?").bind(owner).first()).state,'rejected');
 assert.equal((await listSlackRequests(db,owner)).length,0);
 await assert.rejects(()=>changeSlackRequest(db,'other',{id:item.id,action:'retry'}));
}finally{db.close()}});

test('a request with no outcome for 30 minutes is flagged as unconfirmed instead of silently staying received',async()=>{const db=await setup();try{
 await receive(db);
 await db.prepare("UPDATE orbit_slack_requests SET created_at=?,updated_at=?").bind(new Date(Date.now()-31*60000).toISOString(),new Date(Date.now()-31*60000).toISOString()).run();
 await advanceSlackRequests(db,owner);
 const [item]=await listSlackRequests(db,owner);assert.equal(item.status,'unconfirmed');
 await processSlackRequests(db,owner,env);
 assert.equal((await rowOf(db)).status,'unconfirmed');
}finally{db.close()}});
