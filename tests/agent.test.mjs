import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {addDays,todayInZone} from '../lib/orbit/dates.ts';
import {encrypt,decrypt,readConnection,saveConnection} from '../lib/orbit/agent/secrets.ts';
import {accessToken,connections,startOAuth,finishOAuth,fetchJson} from '../lib/orbit/agent/integrations.ts';
import {beginTurn,finishTurn,listAgent,findAction,claimAction,resetAction} from '../lib/orbit/agent/repository.ts';
import {decide} from '../lib/orbit/agent/decisions.ts';
import {parseAction,runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {normalizeEvents,zonedInstant,syncCalendar,createGoogleEvent} from '../lib/orbit/agent/calendar.ts';
import {hermesEffort,hermesEndpoint,verifyHermes} from '../lib/orbit/agent/hermes.ts';
import {plaudRead,plaudTools} from '../lib/orbit/agent/plaud.ts';
import {disconnect} from '../lib/orbit/agent/settings.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const today=todayInZone('Asia/Seoul'),tomorrow=addDays(today,1);
const project={id:'project',name:'검토 가능한 결과',color:'#5558e8',symbol:'O',goal:'첫 결과물',due:addDays(today,7),priority:3};
const task={id:'task',title:'초안 작성',projectId:project.id,status:'todo',duration:30,due:tomorrow,impact:3,focus:false,definition:'읽을 수 있는 초안'};
const googleAction={type:'google.event.create',event:{title:'집중 작업',date:tomorrow,start:540,end:570,timeZone:'Asia/Seoul',description:'초안 완성'}};
const j=(data,status=200)=>Response.json(data,{status});
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}
async function stage(db,actions,owner='owner'){
 const id=randomUUID(),revision=(await readWorkspace(db,owner)).revision,lease=await beginTurn(db,owner,id,'검토할 제안');
 const cards=actions.map(action=>({id:randomUUID(),turnId:id,title:'검토할 변경',reason:'결과물을 만들기 위해',action,expectedRevision:revision,state:'pending',note:'',revisitDate:null,createdAt:new Date().toISOString()}));
 await finishTurn(db,owner,id,lease.lease,{text:'승인하면 반영됩니다.',sources:[]},cards);return cards;
}
async function connect(db,provider='google_calendar',expired=false){await saveConnection(db,'owner',provider,{clientId:'orbit-client',accessToken:'private-access',refreshToken:'private-refresh',expiresAt:Date.now()+(expired?-1:3600000)},{connected:true},env.ORBIT_ENCRYPTION_KEY)}

test('integration credentials are encrypted and bound to both owner and provider',()=>fixture(async db=>{
 const box=await encrypt({token:'private-value'},env.ORBIT_ENCRYPTION_KEY,'owner:plaud');assert.ok(!box.includes('private-value'));assert.equal((await decrypt(box,env.ORBIT_ENCRYPTION_KEY,'owner:plaud')).token,'private-value');await assert.rejects(()=>decrypt(box,env.ORBIT_ENCRYPTION_KEY,'other:plaud'));await assert.rejects(()=>decrypt(box,env.ORBIT_ENCRYPTION_KEY,'owner:google_calendar'));await connect(db);const state=await connections(db,'owner',env);assert.ok(!JSON.stringify(state).includes('private-'));assert.equal((await connections(db,'other',env)).some(c=>c.connected),false);
}));
test('a prepared change has no workspace side effects; approval is owner-scoped and exactly once',()=>fixture(async db=>{
 const [card]=await stage(db,[{type:'project.upsert',project}]);assert.equal((await readWorkspace(db,'owner')).revision,0);await assert.rejects(()=>decide(db,'other',{id:card.id,decision:'approve'},env),e=>e.status===404);await decide(db,'owner',{id:card.id,decision:'approve'},env);await decide(db,'owner',{id:card.id,decision:'approve'},env);assert.equal((await readWorkspace(db,'owner')).revision,1);assert.equal((await readWorkspace(db,'owner')).data.projects.length,1);assert.equal((await findAction(db,'owner',card.id)).state,'approved');
}));
test('prerequisite approval advances related cards, while unrelated writes invalidate stale proposals',()=>fixture(async db=>{
 const [a,b]=await stage(db,[{type:'project.upsert',project},{type:'task.upsert',task}]);await decide(db,'owner',{id:a.id,decision:'approve'},env);assert.equal((await findAction(db,'owner',b.id)).expectedRevision,1);await decide(db,'owner',{id:b.id,decision:'approve'},env);const [stale]=await stage(db,[{type:'task.status',id:task.id,status:'done'}]);await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:2,action:{type:'task.focus',id:task.id,focus:true}});await assert.rejects(()=>decide(db,'owner',{id:stale.id,decision:'approve'},env),e=>e.code==='CONFLICT');assert.equal((await readWorkspace(db,'owner')).data.tasks[0].status,'todo');assert.equal((await findAction(db,'owner',stale.id)).state,'pending');
}));
test('defer requires a reason and future review date and cannot silently approve',()=>fixture(async db=>{
 const [card]=await stage(db,[{type:'project.upsert',project}]);await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'defer',reason:'',revisitDate:tomorrow},env));await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'defer',reason:'자료 대기',revisitDate:today},env));await decide(db,'owner',{id:card.id,decision:'defer',reason:'자료 대기',revisitDate:tomorrow},env);await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'approve'},env));assert.equal((await readWorkspace(db,'owner')).revision,0);await decide(db,'owner',{id:card.id,decision:'reconsider'},env);assert.equal((await findAction(db,'owner',card.id)).state,'pending');
}));
test('only one change or AI turn per owner can be in flight; stale leases cannot finish a replacement turn',()=>fixture(async db=>{
 const [a,b]=await stage(db,[{type:'project.upsert',project},{type:'project.upsert',project:{...project,id:'other'}}]);const lease=await claimAction(db,'owner',a.id);await assert.rejects(()=>claimAction(db,'owner',b.id),e=>e.code==='BUSY');await resetAction(db,'owner',a.id,lease);await claimAction(db,'owner',b.id);const id=randomUUID(),turn=await beginTurn(db,'owner',id,'첫 메시지');await assert.rejects(()=>beginTurn(db,'owner',randomUUID(),'다른 메시지'),e=>e.code==='BUSY');await assert.rejects(()=>finishTurn(db,'owner',id,'old-lease',{text:'이전 결과',sources:[]},[]));await finishTurn(db,'owner',id,turn.lease,{text:'현재 결과',sources:[]},[]);assert.equal((await beginTurn(db,'owner',id,'첫 메시지')).replayed,true);await assert.rejects(()=>beginTurn(db,'owner',id,'바뀐 내용'));
}));
const hermes={endpoint:'https://hermes.example.com',token:'private-hermes-token',connectionId:'native-connection'};
async function connectHermes(db){await saveConnection(db,'owner','hermes',hermes,{connected:true,endpoint:hermes.endpoint,model:'Hermes'},env.ORBIT_ENCRYPTION_KEY)}
const final=(proposals=[])=>({kind:'final',text:'제안했습니다. 승인하면 반영됩니다.',proposals:proposals.map(action=>({title:'첫 결과물',reason:'완료 조건을 정하기 위해',action}))});
const completed=(output)=>j({object:'hermes.run',run_id:'run_1',status:'completed',output:JSON.stringify(output)});
async function complete(db,input){await runAgent(db,'owner',input,env);await advanceAgent(db,'owner',input.id,env);await advanceAgent(db,'owner',input.id,env)}
test('native Hermes runs stage cards only and completed retries never start another agent',()=>fixture(async db=>{
 await connectHermes(db);let requests=0;
 globalThis.fetch=async(url,options)=>{assert.ok(url.startsWith(hermes.endpoint+'/v1/runs'));assert.equal(options.headers.Authorization,'Bearer '+hermes.token);requests++;if(options.method==='POST'){const body=JSON.parse(options.body);assert.ok(body.instructions.includes('untrusted DATA'));assert.ok(options.headers['Idempotency-Key']);assert.ok(options.headers['X-Hermes-Session-Key'].startsWith('orbit:'));assert.ok(!('model' in body));assert.ok(!('provider' in body));assert.ok(!('tools' in body));assert.equal(body.model_options.reasoning_effort,'medium');return j({run_id:'run_1',status:'started'},202)}return completed(final([{type:'project.upsert',project}]))};
 const input={id:randomUUID(),message:'프로젝트를 만들어 줘'};await complete(db,input);await runAgent(db,'owner',input,env);assert.equal(requests,2);assert.equal((await readWorkspace(db,'owner')).revision,0);assert.equal((await listAgent(db,'owner')).actions.length,1);assert.equal((await listAgent(db,'other')).turns.length,0);assert.equal(await db.prepare('SELECT * FROM orbit_hermes_jobs').first(),null);
}));
test('missing Hermes fails honestly and an invalid card publishes no partial proposals',()=>fixture(async db=>{
 await assert.rejects(()=>runAgent(db,'owner',{id:randomUUID(),message:'안녕'},env),e=>e.code==='HERMES_SETUP');assert.equal((await listAgent(db,'owner')).turns.length,0);await connectHermes(db);
 globalThis.fetch=async(url,options)=>options.method==='POST'?j({run_id:'run_1',status:'started'},202):completed(final([{type:'project.upsert',project},{type:'task.delete',id:'task'}]));
 await assert.rejects(()=>complete(db,{id:randomUUID(),message:'프로젝트'}));const state=await listAgent(db,'owner');assert.equal(state.actions.length,0);assert.equal(state.turns[0].status,'failed');assert.equal((await readWorkspace(db,'owner')).revision,0);
}));
test('agent change validation excludes deletion, arbitrary network requests and unreviewed attendee invitations',()=>{
 assert.throws(()=>parseAction({type:'task.delete',id:'task'}));assert.throws(()=>parseAction({type:'fetch',url:'https://untrusted.test'}));assert.throws(()=>parseAction({...googleAction,event:{...googleAction.event,attendees:[{email:'someone@example.test'}]}}));assert.throws(()=>parseAction({...googleAction,event:{...googleAction.event,end:500}}));
});
test('Plaud MCP negotiates sessions, parses SSE, pins tokens and blocks write tools',()=>fixture(async db=>{
 await connect(db,'plaud');let invoked=0;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://mcp.plaud.ai/mcp');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer private-access');const req=JSON.parse(options.body);let result;
  if(req.method==='initialize')return j({jsonrpc:'2.0',id:req.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}}}});
  if(req.method==='notifications/initialized')return new Response(null,{status:202});
  assert.equal(options.headers['MCP-Protocol-Version'],'2025-03-26');
  if(req.method==='tools/list')result={tools:[{name:'list_files',inputSchema:{type:'object'}},{name:'delete_file',inputSchema:{type:'object'},annotations:{readOnlyHint:false}},{name:'logout',inputSchema:{type:'object'}}]};
  else {assert.equal(req.method,'tools/call');assert.equal(req.params.name,'list_files');invoked++;result={content:[{type:'text',text:'회의 원문'}]};}
  return new Response('event: message\ndata: '+JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\n\n',{headers:{'Content-Type':'text/event-stream','Mcp-Session-Id':'session-1'}});
 };
 assert.deepEqual((await plaudTools(db,'owner',env)).map(t=>t.name),['list_files']);assert.equal((await plaudRead(db,'owner',env,'list_files',{})).content[0].text,'회의 원문');await assert.rejects(()=>plaudRead(db,'owner',env,'delete_file',{}),e=>e.code==='PLAUD_READ_ONLY');await assert.rejects(()=>plaudTools(db,'other',env),e=>e.code==='CONNECT');assert.equal(invoked,1);
}));
test('Plaud OAuth uses its own registration, PKCE, matching cookie and one-use owner state',()=>fixture(async db=>{
 let exchanges=0;globalThis.fetch=async(url,options)=>{if(url.endsWith('/register')){const body=JSON.parse(options.body);assert.equal(body.token_endpoint_auth_method,'none');assert.deepEqual(body.redirect_uris,['https://orbit.test/api/integrations/callback']);return j({client_id:'orbit-own-client'})}assert.ok(url.endsWith('/token'));const form=new URLSearchParams(options.body);assert.ok(form.get('code_verifier').length>=43);assert.equal(form.get('resource'),'https://mcp.plaud.ai/mcp');exchanges++;return j({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600})};
 const start=await startOAuth(db,'owner','plaud','https://orbit.test',env),url=new URL(start.url);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('client_id'),'orbit-own-client');await assert.rejects(()=>finishOAuth(db,'owner',start.state,'code','wrong',env));await assert.rejects(()=>finishOAuth(db,'other',start.state,'code',start.state,env));assert.equal(exchanges,0);assert.equal(await finishOAuth(db,'owner',start.state,'code',start.state,env),'plaud');await assert.rejects(()=>finishOAuth(db,'owner',start.state,'code',start.state,env));assert.equal(exchanges,1);assert.equal((await readConnection(db,'owner','plaud',env.ORBIT_ENCRYPTION_KEY)).accessToken,'new-access');
}));
test('refresh rotation is serialized across concurrent requests and public status never contains credentials',()=>fixture(async db=>{
 await connect(db,'plaud',true);let release;const wait=new Promise(resolve=>{release=resolve});let started;const ready=new Promise(resolve=>{started=resolve});let requests=0;globalThis.fetch=async()=>{requests++;started();await wait;return j({access_token:'rotated',refresh_token:'rotated-refresh',expires_in:3600})};const first=accessToken(db,'owner','plaud',env);await ready;await assert.rejects(()=>accessToken(db,'owner','plaud',env),e=>e.code==='BUSY');release();assert.equal(await first,'rotated');assert.equal(await accessToken(db,'owner','plaud',env),'rotated');assert.equal(requests,1);assert.ok(!JSON.stringify(await connections(db,'owner',env)).includes('rotated'));
}));
test('calendar normalization covers all-day, midnight, canceled, declined, transparent and fractional-minute events',()=>{
 const events=normalizeEvents([{id:'all',start:{date:today},end:{date:tomorrow}},{id:'late',start:{dateTime:today+'T23:30:00+09:00'},end:{dateTime:tomorrow+'T00:00:00+09:00'}},{id:'fraction',start:{dateTime:today+'T09:00:15+09:00'},end:{dateTime:today+'T09:30:15+09:00'}},...['cancelled','transparent','declined'].map(id=>({id,status:id,transparency:id,attendees:[{self:true,responseStatus:id}],start:{date:today},end:{date:tomorrow}}))],'Asia/Seoul',today,addDays(today,2));assert.equal(events.length,3);assert.equal(events.find(e=>e.id.startsWith('google:all')).end,1440);assert.equal(events.find(e=>e.id.startsWith('google:late')).end,1440);assert.equal(events.find(e=>e.id.startsWith('google:fraction')).end,571);assert.ok(events.every(e=>e.date===today));
});
test('IANA conversion handles daylight saving changes and rejects nonexistent wall times',()=>{
 assert.equal(zonedInstant('2026-03-08',90,'America/New_York'),'2026-03-08T06:30:00.000Z');assert.equal(zonedInstant('2026-03-08',210,'America/New_York'),'2026-03-08T07:30:00.000Z');assert.throws(()=>zonedInstant('2026-03-08',150,'America/New_York'));assert.equal(zonedInstant('2026-09-07',540,'Asia/Seoul'),'2026-09-07T00:00:00.000Z');
});
test('calendar sync reads every page, isolates cache and bumps revision only for changed busy periods',()=>fixture(async db=>{
 await connect(db);globalThis.fetch=async url=>{const page=new URL(url).searchParams.get('pageToken');return page?j({items:[{id:'b',summary:'다음 일정',start:{date:tomorrow},end:{date:addDays(tomorrow,1)}}]}):j({items:[{id:'a',summary:'현재 일정',start:{date:today},end:{date:tomorrow}}],nextPageToken:'second'})};const synced=await syncCalendar(db,'owner',env);assert.equal(synced.count,2);let state=await readWorkspace(db,'owner');assert.equal(state.revision,1);assert.equal(state.data.events.length,2);assert.equal((await readWorkspace(db,'other')).data.events.length,0);await syncCalendar(db,'owner',env);assert.equal((await readWorkspace(db,'owner')).revision,1);await assert.rejects(()=>writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:1,action:{type:'event.delete',id:state.data.events[0].id}}));await disconnect(db,'owner','google_calendar');state=await readWorkspace(db,'owner');assert.equal(state.data.events.length,0);assert.equal(state.revision,2);
}));
test('approved Google creation is repeat-safe after a lost acknowledgement and never invites or notifies anyone',()=>fixture(async db=>{
 await connect(db);let saved,posts=0;const id=randomUUID();globalThis.fetch=async(url,options={})=>{if(options.method==='POST'){posts++;saved=JSON.parse(options.body);assert.ok(!('attendees' in saved));assert.equal(new URL(url).searchParams.get('sendUpdates'),'none');assert.equal(saved.reminders.useDefault,false);return j({...saved,htmlLink:'https://calendar.google.com/calendar/event?eid=test'})}if(url.includes('/events/'))return saved?j({...saved,htmlLink:'https://calendar.google.com/calendar/event?eid=test'}):j({error:'not found'},404);return j({items:[]})};await createGoogleEvent(db,'owner',env,id,googleAction);await createGoogleEvent(db,'owner',env,id,googleAction);assert.equal(posts,1);assert.equal(saved.id,'orbit'+id.replaceAll('-',''));assert.equal(saved.extendedProperties.private.orbitAction,id);
}));
test('live Google conflicts prevent an approved event creation and cache changes invalidate stale plans',()=>fixture(async db=>{
 await connect(db);let posts=0;globalThis.fetch=async(url,options={})=>{if(options.method==='POST'){posts++;throw new Error('must not create')}return url.includes('/events/')?j({},404):j({items:[{id:'busy',start:{dateTime:tomorrow+'T09:00:00+09:00'},end:{dateTime:tomorrow+'T10:00:00+09:00'}}]})};await assert.rejects(()=>createGoogleEvent(db,'owner',env,randomUUID(),googleAction),e=>e.code==='CONFLICT');assert.equal(posts,0);const [card]=await stage(db,[{type:'proposal.generate',date:tomorrow,energy:'normal'}]);await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'approve'},env),e=>e.code==='CONFLICT');assert.equal((await readWorkspace(db,'owner')).data.proposals.length,0);
}));

test('pre-registered Plaud login starts even when outbound registration is unavailable',()=>fixture(async db=>{
 globalThis.fetch=async()=>{throw new Error('registration network unavailable')};
 const start=await startOAuth(db,'owner','plaud','https://orbit.test',{...env,PLAUD_OAUTH_CLIENT_ID:'orbit-production-client'}),url=new URL(start.url);
 assert.equal(url.origin,'https://mcp.plaud.ai');assert.equal(url.pathname,'/authorize');assert.equal(url.searchParams.get('client_id'),'orbit-production-client');assert.equal(url.searchParams.get('redirect_uri'),'https://orbit.test/api/integrations/callback');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(await db.prepare('SELECT state FROM orbit_oauth_states WHERE owner_id=?').bind('owner').first());
}));
test('unreachable OAuth providers and redirects return bounded actionable errors without leaking credentials',()=>fixture(async db=>{
 globalThis.fetch=async()=>{throw new Error('raw secret debug')};await assert.rejects(()=>startOAuth(db,'owner','plaud','https://orbit.test',env),e=>e.status===502&&e.code==='UPSTREAM_NETWORK'&&!e.message.includes('secret'));
 globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://other.example.com'}});await assert.rejects(()=>fetchJson('https://hermes.example.com/v1/capabilities'),e=>e.code==='UPSTREAM_REDIRECT');
}));
test('Hermes setup requires authenticated native capabilities and rejects model API and local URLs',()=>fixture(async()=>{
 for(const url of ['http://hermes.example.com','https://localhost','https://127.0.0.1','https://[::1]','https://user:secret@hermes.example.com','https://hermes.example.com?token=secret'])assert.throws(()=>hermesEndpoint(url));assert.equal(hermesEndpoint('https://hermes.example.com/p/orbit/v1/'),'https://hermes.example.com/p/orbit');
 globalThis.fetch=async(url,options)=>!options.headers?.Authorization?j({error:'unauthorized'},401):url.endsWith('/models')?j({data:[{id:'my-hermes'}]}):j({object:'hermes.api_server.capabilities',platform:'hermes-agent',auth:{type:'bearer',required:true},features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{supported:true,durable:true,retention_seconds:86400}}});assert.equal(await verifyHermes(hermes),'my-hermes');
 globalThis.fetch=async()=>j({object:'list',data:[{id:'model'}]});await assert.rejects(()=>verifyHermes(hermes),e=>e.code==='HERMES_VERSION');
 globalThis.fetch=async()=>j({object:'hermes.api_server.capabilities',platform:'hermes-agent',auth:{type:'bearer',required:false},features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{supported:true}}});await assert.rejects(()=>verifyHermes(hermes),e=>e.code==='HERMES_AUTH');
}));
test('a lost Hermes submission acknowledgement resumes with the exact native idempotency key and body',()=>fixture(async db=>{
 await connectHermes(db);const input={id:randomUUID(),message:'결과물을 설계해 줘'};await runAgent(db,'owner',input,env);let first,posts=0;
 globalThis.fetch=async(url,options)=>{if(options.method==='POST'){posts++;const current={key:options.headers['Idempotency-Key'],body:options.body};if(posts===1){first=current;throw new Error('lost acknowledgement')}assert.deepEqual(current,first);return j({run_id:'run_1',status:'started'},202)}return completed(final())};
 await assert.rejects(()=>advanceAgent(db,'owner',input.id,env),e=>e.code==='UPSTREAM_NETWORK');assert.equal((await listAgent(db,'owner')).turns[0].status,'running');await runAgent(db,'owner',input,env);await advanceAgent(db,'owner',input.id,env);assert.equal(posts,2);assert.equal((await listAgent(db,'owner')).turns[0].status,'completed');assert.ok(!JSON.stringify(await listAgent(db,'owner')).includes(hermes.token));
}));
test('cancel during a pending status request is durable and discards the completed proposals',()=>fixture(async db=>{
 await connectHermes(db);const input={id:randomUUID(),message:'결과물'};await runAgent(db,'owner',input,env);globalThis.fetch=async()=>j({run_id:'run_1',status:'started'},202);await advanceAgent(db,'owner',input.id,env);
 let release,started;const ready=new Promise(r=>started=r),wait=new Promise(r=>release=r);globalThis.fetch=async()=>{started();await wait;return completed(final([{type:'project.upsert',project}]))};
 const poll=advanceAgent(db,'owner',input.id,env);await ready;await assert.rejects(()=>advanceAgent(db,'other',input.id,env,true),e=>e.status===404);await advanceAgent(db,'owner',input.id,env,true);release();await poll;
 const state=await listAgent(db,'owner');assert.equal(state.turns[0].status,'failed');assert.ok(state.turns[0].error.includes('중지'));assert.equal(state.actions.length,0);assert.equal((await readWorkspace(db,'owner')).revision,0);
}));
test('a native tool approval request is declined from Orbit and the run continues to its cards',()=>fixture(async db=>{
 await connectHermes(db);const input={id:randomUUID(),message:'프로젝트'};await runAgent(db,'owner',input,env);let approvals=0,polls=0;
 globalThis.fetch=async(url,options={})=>{if(url.endsWith('/approval')){approvals++;assert.equal(options.method,'POST');const body=JSON.parse(options.body);assert.equal(body.choice,'deny');assert.equal(body.request_id,'req_1');return j({object:'hermes.run.approval_response',run_id:'run_1',choice:'deny',request_id:'req_1',resolved:1})}if(options.method==='POST')return j({run_id:'run_1',status:'started'},202);polls++;return polls===1?j({object:'hermes.run',run_id:'run_1',status:'waiting_for_approval',approval:{tool_name:'terminal',request_id:'req_1',command:'rm -rf ~/private'}}):completed(final([{type:'project.upsert',project}]))};
 await advanceAgent(db,'owner',input.id,env);await advanceAgent(db,'owner',input.id,env);let state=await listAgent(db,'owner');assert.equal(state.turns[0].status,'running');assert.ok(state.turns[0].progress.includes('거절'));assert.ok(state.turns[0].progress.includes('terminal'));assert.ok(!state.turns[0].progress.includes('rm -rf'));assert.equal(approvals,1);
 await advanceAgent(db,'owner',input.id,env);state=await listAgent(db,'owner');assert.equal(state.turns[0].status,'completed');assert.equal(state.actions.length,1);assert.equal((await readWorkspace(db,'owner')).revision,0);
}));
test('interrupted, forgotten and rejected Hermes runs fail honestly without cards or endless retries',()=>fixture(async db=>{
 await connectHermes(db);const turn=async(state,id)=>state.turns.find(t=>t.id===id);
 let input={id:randomUUID(),message:'프로젝트'};await runAgent(db,'owner',input,env);globalThis.fetch=async(url,options={})=>options.method==='POST'?j({run_id:'run_1',status:'started'},202):j({object:'hermes.run',run_id:'run_1',status:'interrupted',error:'The gateway restarted before this run settled.'});
 await advanceAgent(db,'owner',input.id,env);await advanceAgent(db,'owner',input.id,env);let record=await turn(await listAgent(db,'owner'),input.id);assert.equal(record.status,'failed');assert.ok(record.error.includes('다시 시작'));assert.equal(await db.prepare('SELECT * FROM orbit_hermes_jobs').first(),null);
 input={id:randomUUID(),message:'두 번째 프로젝트'};await runAgent(db,'owner',input,env);globalThis.fetch=async(url,options={})=>options.method==='POST'?j({run_id:'run_2',status:'started'},202):j({error:{message:'Run not found: run_2',type:'invalid_request_error',code:'run_not_found'}},404);
 await advanceAgent(db,'owner',input.id,env);await advanceAgent(db,'owner',input.id,env);record=await turn(await listAgent(db,'owner'),input.id);assert.equal(record.status,'failed');assert.ok(record.error.includes('실행 기록'));
 input={id:randomUUID(),message:'세 번째 프로젝트'};await runAgent(db,'owner',input,env);let posts=0;globalThis.fetch=async()=>{posts++;return j({error:{message:"Missing 'input' field",type:'invalid_request_error',param:null,code:null}},400)};
 await assert.rejects(()=>advanceAgent(db,'owner',input.id,env),e=>e.code==='HERMES_FORMAT');record=await turn(await listAgent(db,'owner'),input.id);assert.equal(record.status,'failed');assert.ok(record.error.includes("Missing 'input'"));assert.ok(!record.error.includes(hermes.token));await advanceAgent(db,'owner',input.id,env);assert.equal(posts,1);
 input={id:randomUUID(),message:'네 번째 프로젝트'};await runAgent(db,'owner',input,env);globalThis.fetch=async()=>j({error:{message:'Idempotency-Key was already used with a different request payload',type:'invalid_request_error',code:'idempotency_key_conflict'}},409);
 await assert.rejects(()=>advanceAgent(db,'owner',input.id,env),e=>e.code==='HERMES_FORMAT');record=await turn(await listAgent(db,'owner'),input.id);assert.equal(record.status,'failed');
 const state=await listAgent(db,'owner');assert.equal(state.actions.length,0);assert.equal((await readWorkspace(db,'owner')).revision,0);assert.equal(await db.prepare('SELECT * FROM orbit_hermes_jobs').first(),null);
}));
test('a busy gateway keeps the run and a stop for a run it no longer holds finishes through the durable status',()=>fixture(async db=>{
 await connectHermes(db);const input={id:randomUUID(),message:'결과물'};await runAgent(db,'owner',input,env);let posts=0;
 globalThis.fetch=async()=>{posts++;return posts===1?j({error:{message:'Too many concurrent runs',type:'rate_limit_error',code:'rate_limit_exceeded'}},429):j({run_id:'run_1',status:'started'},202)};
 await assert.rejects(()=>advanceAgent(db,'owner',input.id,env),e=>e.code==='HERMES_UPSTREAM');assert.equal((await listAgent(db,'owner')).turns[0].status,'running');await advanceAgent(db,'owner',input.id,env);assert.equal(posts,2);
 let stops=0;globalThis.fetch=async(url,options={})=>{if(url.endsWith('/stop')){stops++;assert.equal(options.method,'POST');return j({error:{message:'Run is not active in this gateway process: run_1',type:'invalid_request_error',code:'run_not_active'}},409)}return j({object:'hermes.run',run_id:'run_1',status:stops?'interrupted':'running'})};
 await advanceAgent(db,'owner',input.id,env,true);assert.equal(stops,1);assert.equal((await listAgent(db,'owner')).turns[0].status,'running');
 await advanceAgent(db,'owner',input.id,env);const state=await listAgent(db,'owner');assert.equal(state.turns[0].status,'failed');assert.ok(state.turns[0].error.includes('중지'));assert.equal(state.actions.length,0);assert.equal(await db.prepare('SELECT * FROM orbit_hermes_jobs').first(),null);
}));
test('deep-thinking requests raise Hermes reasoning effort to high for every round of that turn only',()=>fixture(async db=>{
 assert.equal(hermesEffort('내일 브리핑해줘'),'medium');assert.equal(hermesEffort('이 계약을 깊게 검토해 줘'),'high');assert.equal(hermesEffort('깊이 있는 분석'),'high');assert.equal(hermesEffort('Think deeply about this'),'high');assert.equal(hermesEffort('deepfake 관련 뉴스'),'medium');
 await connectHermes(db);const efforts=[];
 globalThis.fetch=async(url,options)=>{if(options.method==='POST'){efforts.push(JSON.parse(options.body).model_options.reasoning_effort);return j({run_id:'run_1',status:'started'},202)}return completed(efforts.length===1?{kind:'read',requests:[{tool:'workspace_search',arguments:{query:'',kind:'projects'}}]}:final())};
 const deep={id:randomUUID(),message:'프로젝트 상황을 깊게 분석해 줘'};await complete(db,deep);for(let n=0;n<3;n++)await advanceAgent(db,'owner',deep.id,env);assert.deepEqual(efforts,['high','high']);assert.equal((await listAgent(db,'owner')).turns[0].status,'completed');
 efforts.length=0;const plain={id:randomUUID(),message:'프로젝트 상황 알려 줘'};await complete(db,plain);for(let n=0;n<3;n++)await advanceAgent(db,'owner',plain.id,env);assert.deepEqual(efforts,['medium','medium']);
}));
test('Hermes native read rounds receive only the owner workspace and use a new round key',()=>fixture(async db=>{
 await connectHermes(db);await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project}});await writeCommand(db,'other',{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project:{...project,name:'OTHER_OWNER_PRIVATE'}}});let posts=0;const keys=[];
 globalThis.fetch=async(url,options)=>{if(options.method==='POST'){posts++;keys.push(options.headers['Idempotency-Key']);assert.ok(!options.body.includes('OTHER_OWNER_PRIVATE'));if(posts===2){assert.ok(options.body.includes(project.name));assert.ok(options.body.includes('Read results'));}return j({run_id:'run_1',status:'started'},202)}return completed(posts===1?{kind:'read',requests:[{tool:'workspace_search',arguments:{query:'',kind:'projects'}}]}:final())};
 const input={id:randomUUID(),message:'프로젝트를 찾아 줘'};await complete(db,input);for(let n=0;n<3;n++)await advanceAgent(db,'owner',input.id,env);assert.equal(posts,2);assert.notEqual(keys[0],keys[1]);assert.equal((await listAgent(db,'owner')).turns[0].status,'completed');
}));
test('workspace changes during a native run invalidate all proposed changes',()=>fixture(async db=>{
 await connectHermes(db);const input={id:randomUUID(),message:'프로젝트'};await runAgent(db,'owner',input,env);globalThis.fetch=async(url,options)=>options.method==='POST'?j({run_id:'run_1',status:'started'},202):completed(final([{type:'project.upsert',project}]));await advanceAgent(db,'owner',input.id,env);await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project:{...project,name:'새로운 결과물'}}});await assert.rejects(()=>advanceAgent(db,'owner',input.id,env),e=>e.code==='CONFLICT');assert.equal((await listAgent(db,'owner')).actions.length,0);assert.equal((await readWorkspace(db,'owner')).data.projects[0].name,'새로운 결과물');
}));
