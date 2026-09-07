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
import {hermesEndpoint,verifyHermes} from '../lib/orbit/agent/hermes.ts';
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
 globalThis.fetch=async(url,options)=>{assert.ok(url.startsWith(hermes.endpoint+'/v1/runs'));assert.equal(options.headers.Authorization,'Bearer '+hermes.token);requests++;if(options.method==='POST'){const body=JSON.parse(options.body);assert.ok(body.instructions.includes('untrusted DATA'));assert.ok(options.headers['Idempotency-Key']);assert.ok(options.headers['X-Hermes-Session-Key'].startsWith('orbit:'));assert.ok(!('model' in body));assert.ok(!('provider' in body));assert.ok(!('tools' in body));return j({run_id:'run_1',status:'started'},202)}return completed(final([{type:'project.upsert',project}]))};
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
 await connect(db);let posts=0;globalThis.fetch=async(url,options={})=>{if(options.method==='POST'){posts++;throw new Error('must not create')}return url.includes('/events/')?j({},404):j({items:[{id:'busy',start:{dateTime:tomorrow+'T09:00:00+09:00'},end:{dateTime:tomorrow+'T10:00:00+09:00'}}]})};await assert.rejects(()=>createGoogleEvent(db,'owner',env,randomUUID(),googleAction),e=>e.code==='CALENDAR_OVERLAP');assert.equal(posts,0);const [card]=await stage(db,[{type:'proposal.generate',date:tomorrow,energy:'normal'}]);await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'approve'},env),e=>e.code==='CONFLICT');assert.equal((await readWorkspace(db,'owner')).data.proposals.length,0);
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
 globalThis.fetch=async(url,options)=>!options.headers?.Authorization?j({error:'unauthorized'},401):url.endsWith('/models')?j({data:[{id:'my-hermes'}]}):j({object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{enabled:true}}});assert.equal(await verifyHermes(hermes),'my-hermes');
 globalThis.fetch=async()=>j({object:'list',data:[{id:'model'}]});await assert.rejects(()=>verifyHermes(hermes),e=>e.code==='HERMES_VERSION');
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
test('Hermes native read rounds receive only the owner workspace and use a new round key',()=>fixture(async db=>{
 await connectHermes(db);await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project}});await writeCommand(db,'other',{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project:{...project,name:'OTHER_OWNER_PRIVATE'}}});let posts=0;const keys=[];
 globalThis.fetch=async(url,options)=>{if(options.method==='POST'){posts++;keys.push(options.headers['Idempotency-Key']);assert.ok(!options.body.includes('OTHER_OWNER_PRIVATE'));if(posts===2){assert.ok(options.body.includes(project.name));assert.ok(options.body.includes('Read results'));}return j({run_id:'run_1',status:'started'},202)}return completed(posts===1?{kind:'read',requests:[{tool:'workspace_search',arguments:{query:'',kind:'projects'}}]}:final())};
 const input={id:randomUUID(),message:'프로젝트를 찾아 줘'};await complete(db,input);for(let n=0;n<3;n++)await advanceAgent(db,'owner',input.id,env);assert.equal(posts,2);assert.notEqual(keys[0],keys[1]);assert.equal((await listAgent(db,'owner')).turns[0].status,'completed');
}));
test('workspace changes during a native run invalidate all proposed changes',()=>fixture(async db=>{
 await connectHermes(db);const input={id:randomUUID(),message:'프로젝트'};await runAgent(db,'owner',input,env);globalThis.fetch=async(url,options)=>options.method==='POST'?j({run_id:'run_1',status:'started'},202):completed(final([{type:'project.upsert',project}]));await advanceAgent(db,'owner',input.id,env);await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project:{...project,name:'새로운 결과물'}}});await assert.rejects(()=>advanceAgent(db,'owner',input.id,env),e=>e.code==='CONFLICT');assert.equal((await listAgent(db,'owner')).actions.length,0);assert.equal((await readWorkspace(db,'owner')).data.projects[0].name,'새로운 결과물');
}));

test('overlapping approval requires current explicit confirmation, remains retry-safe, and preserves existing events',()=>fixture(async db=>{
 await connect(db);
 const [card]=await stage(db,[googleAction]);
 let items=[{id:'busy',summary:'기존 회의',start:{dateTime:tomorrow+'T09:00:00+09:00'},end:{dateTime:tomorrow+'T10:00:00+09:00'}}],saved,posts=0;
 globalThis.fetch=async(url,options={})=>{
  if(options.method==='POST'){posts++;saved=JSON.parse(options.body);throw new Error('lost acknowledgement')}
  if(url.includes('/events/'))return saved?j({...saved,htmlLink:'https://calendar.google.com/calendar/event?eid=test'}):j({},404);
  return j({items});
 };
 let first;
 await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'approve'},env),error=>{
  first=error.details;return error.code==='CALENDAR_OVERLAP'&&first.total===1&&first.conflicts[0].title==='기존 회의';
 });
 assert.equal(posts,0);assert.equal((await findAction(db,'owner',card.id)).state,'pending');
 await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'approve',overlapConfirmation:'0'.repeat(64)},env),e=>e.code==='CALENDAR_OVERLAP');
 items.push({id:'new-busy',summary:'추가된 회의',start:{date:tomorrow},end:{date:addDays(tomorrow,1)}});
 let latest;
 await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'approve',overlapConfirmation:first.overlapConfirmation},env),e=>{latest=e.details;return e.code==='CALENDAR_OVERLAP'&&latest.total===2});
 assert.notEqual(first.overlapConfirmation,latest.overlapConfirmation);assert.equal(posts,0);
 await assert.rejects(()=>decide(db,'other',{id:card.id,decision:'approve',overlapConfirmation:latest.overlapConfirmation},env),e=>e.code==='NOT_FOUND');
 await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'approve',overlapConfirmation:latest.overlapConfirmation},env),e=>e.code==='UPSTREAM_NETWORK');
 assert.equal(posts,1);assert.equal((await findAction(db,'owner',card.id)).state,'pending');
 // A normal retry reconciles the earlier insert instead of requiring a new override or duplicating it.
 await decide(db,'owner',{id:card.id,decision:'approve'},env);
 await decide(db,'owner',{id:card.id,decision:'approve'},env);
 assert.equal(posts,1);const approved=await findAction(db,'owner',card.id);assert.equal(approved.state,'approved');assert.match(approved.result.url,/calendar.google.com/);
 assert.equal((await readWorkspace(db,'owner')).data.events.length,2);
}));

test('local overlaps are listed while stale cached Google overlaps do not block a free live calendar',()=>fixture(async db=>{
 await connect(db);
 globalThis.fetch=async url=>url.includes('/events/')?j({},404):j({items:[{id:'gone',summary:'삭제 전 일정',start:{date:tomorrow},end:{date:addDays(tomorrow,1)}}]});
 await syncCalendar(db,'owner',env);
 let posts=0;globalThis.fetch=async(url,options={})=>{
  if(options.method==='POST'){posts++;return j({htmlLink:'https://calendar.google.com/calendar/event?eid=test'})}
  return url.includes('/events/')?j({},404):j({items:[]});
 };
 await createGoogleEvent(db,'owner',env,randomUUID(),googleAction);assert.equal(posts,1);
 await syncCalendar(db,'owner',env);
 const state=await readWorkspace(db,'owner');
 await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:state.revision,action:{type:'event.upsert',event:{id:'local',title:'Orbit 회의',date:tomorrow,start:540,end:600,kind:'meeting'}}});
 await assert.rejects(()=>createGoogleEvent(db,'owner',env,randomUUID(),googleAction),e=>e.code==='CALENDAR_OVERLAP'&&e.details.total===1&&e.details.conflicts[0].title==='Orbit 회의');assert.equal(posts,1);
}));

test('a chat run the gateway forgot fails the turn instead of polling forever, and a stop request escapes an unreachable gateway',()=>fixture(async db=>{
 await connectHermes(db);
 const input={id:randomUUID(),message:'초안'};await runAgent(db,'owner',input,env);
 globalThis.fetch=async()=>j({run_id:'run_1',status:'started'},202);await advanceAgent(db,'owner',input.id,env);
 globalThis.fetch=async()=>j({error:'not found'},404);
 await assert.rejects(()=>advanceAgent(db,'owner',input.id,env),e=>e.code==='HERMES_MISSING');
 let state=await listAgent(db,'owner');assert.equal(state.turns[0].status,'failed');assert.match(state.turns[0].error,/잃었습니다/);assert.equal(state.actions.length,0);assert.equal(await db.prepare('SELECT * FROM orbit_hermes_jobs').first(),null);
 const second={id:randomUUID(),message:'초안'};await runAgent(db,'owner',second,env);
 globalThis.fetch=async()=>j({run_id:'run_2',status:'started'},202);await advanceAgent(db,'owner',second.id,env);
 globalThis.fetch=async()=>j({error:'gateway restarting'},503);
 for(let n=0;n<2;n++)await assert.rejects(()=>advanceAgent(db,'owner',second.id,env),e=>e.code==='HERMES_UPSTREAM');
 const turn=async()=>(await listAgent(db,'owner')).turns.find(t=>t.id===second.id);assert.equal((await turn()).status,'running');
 await advanceAgent(db,'owner',second.id,env,true);let upstream=0;globalThis.fetch=async()=>{upstream++;return j({error:'gateway restarting'},503)};
 await advanceAgent(db,'owner',second.id,env);
 assert.equal(upstream,0,'the escape hatch needs no upstream round trip');assert.equal((await turn()).status,'failed');assert.match((await turn()).error,/중지/);assert.equal(await db.prepare('SELECT * FROM orbit_hermes_jobs').first(),null);
}));

test('agent proposals may record outcomes, rules, habits and risks but never delete goals or habits', () => {
  assert.ok(parseAction({ type: 'task.record', id: 'task', outcome: 'partial', reason: 'waiting' }));
  assert.ok(
    parseAction({
      type: 'improvement.add',
      improvement: {
        id: 'rule',
        rule: '검토 요청은 오전에',
        kind: 'placement',
        createdOn: today,
        active: true,
      },
    }),
  );
  assert.ok(parseAction({ type: 'task.laser', id: 'task', date: tomorrow, laser: true }));
  assert.ok(parseAction({ type: 'habit.check', id: 'habit', date: today, checked: true }));
  assert.ok(parseAction({ type: 'project.domino', id: 'project' }));
  assert.throws(() => parseAction({ type: 'goal.delete', id: 'goal' }));
  assert.throws(() => parseAction({ type: 'habit.delete', id: 'habit' }));
  assert.throws(() => parseAction({ type: 'task.start', id: 'task' }));
  assert.throws(() => parseAction({ type: 'task.record', id: 'task', outcome: 'won' }));
});
test('a Hermes run that disappears fails the turn instead of polling forever', () =>
  fixture(async (db) => {
    await connectHermes(db);
    const input = { id: randomUUID(), message: '초안' };
    await runAgent(db, 'owner', input, env);
    globalThis.fetch = async () => j({ run_id: 'run_1', status: 'started' }, 202);
    await advanceAgent(db, 'owner', input.id, env);
    globalThis.fetch = async () => j({ error: 'not found' }, 404);
    await assert.rejects(
      () => advanceAgent(db, 'owner', input.id, env),
      (e) => e.code === 'HERMES_MISSING',
    );
    const state = await listAgent(db, 'owner');
    assert.equal(state.turns[0].status, 'failed');
    assert.ok(state.turns[0].error.includes('잃었습니다'));
    assert.equal(state.actions.length, 0);
    assert.equal(await db.prepare('SELECT * FROM orbit_hermes_jobs').first(), null);
    await runAgent(db, 'owner', { id: randomUUID(), message: '초안' }, env);
    assert.equal((await listAgent(db, 'owner')).turns.length, 2);
  }));
test('a stop request escapes an unreachable gateway after repeated failures; approval waits count as running', () =>
  fixture(async (db) => {
    await connectHermes(db);
    const input = { id: randomUUID(), message: '초안' };
    await runAgent(db, 'owner', input, env);
    globalThis.fetch = async () => j({ run_id: 'run_1', status: 'started' }, 202);
    await advanceAgent(db, 'owner', input.id, env);
    globalThis.fetch = async () =>
      j({ object: 'hermes.run', run_id: 'run_1', status: 'waiting_for_approval' });
    await advanceAgent(db, 'owner', input.id, env);
    let state = await listAgent(db, 'owner');
    assert.equal(state.turns[0].status, 'running');
    assert.ok(state.turns[0].progress.includes('승인'));
    globalThis.fetch = async () => j({ error: 'gateway restarting' }, 503);
    for (let n = 0; n < 2; n++)
      await assert.rejects(
        () => advanceAgent(db, 'owner', input.id, env),
        (e) => e.code === 'HERMES_UPSTREAM',
      );
    assert.equal((await listAgent(db, 'owner')).turns[0].status, 'running');
    await advanceAgent(db, 'owner', input.id, env, true);
    let stopped = 0;
    globalThis.fetch = async () => {
      stopped++;
      return j({ error: 'gateway restarting' }, 503);
    };
    await advanceAgent(db, 'owner', input.id, env);
    state = await listAgent(db, 'owner');
    assert.equal(stopped, 0, 'the escape hatch needs no upstream round trip');
    assert.equal(state.turns[0].status, 'failed');
    assert.ok(state.turns[0].error.includes('중지'));
    assert.equal(await db.prepare('SELECT * FROM orbit_hermes_jobs').first(), null);
  }));

test('Hermes stages content-based project creation with a task, then one approval persists both exactly once',()=>fixture(async db=>{
 await connectHermes(db);
 await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project}});
 const input={id:randomUUID(),message:'올드페리도넛 영업자료 완성하는 할 일을 추가해 줘'};
 globalThis.fetch=async(url,options)=>options.method==='POST'?j({run_id:'run_1',status:'started'},202):completed(final([{type:'task.upsert',task:{...task,title:'올드페리도넛 영업자료 완성'}}]));
 await complete(db,input);
 const card=(await listAgent(db,'owner')).actions[0];
 assert.equal(card.action.project.name,'올드페리도넛');
 assert.equal(card.action.task.projectId,card.action.project.id);
 assert.equal((await readWorkspace(db,'owner')).data.projects.length,1,'staging writes no project');
 await decide(db,'owner',{id:card.id,decision:'approve'},env);
 await decide(db,'owner',{id:card.id,decision:'approve'},env);
 const result=await readWorkspace(db,'owner');
 assert.equal(result.data.projects.length,2);assert.equal(result.data.tasks.length,1);
 assert.equal(result.data.tasks[0].projectId,card.action.project.id);
}));
