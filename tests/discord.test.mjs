import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {parseCommand,stableId,snowflakeNow} from '../lib/orbit/discord/protocol.ts';
import {channelPermissions} from '../lib/orbit/discord/api.ts';
import {configureDiscord,readDiscord,discordStatus} from '../lib/orbit/discord/connection.ts';
import {queueDiscord,deliverDiscord,receiveDiscord,executeDiscordCommand,collectDiscordNotifications,syncDiscord,resolveDiscordProject} from '../lib/orbit/discord/runtime.ts';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
const owner='owner',guildId='111111111111111111',channelId='222222222222222222',userId='333333333333333333',botId='444444444444444444',token='discord-test-token-not-real-1234567890';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const config={token,guildId,channelId,userId,botId,botName:'Orbit',channelName:'private',enabled:true,origin:'https://orbit.example.com'};
const state=()=>({after:'100000000000000000',since:new Date().toISOString(),observed:{}});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status});
const fetchOriginal=globalThis.fetch;
test.afterEach(()=>{globalThis.fetch=fetchOriginal;});

test('commands require explicit prefix and preserve exact UUID, date and approval token',async()=>{
 const id=randomUUID();assert.equal(parseCommand('승인해줘'),null);assert.equal(parseCommand('hello !orbit 실행'),null);
 assert.deepEqual(parseCommand('!orbit 질문 오늘 할일'),{kind:'ask',text:'오늘 할일'});
 assert.deepEqual(parseCommand(`!orbit 보류 ${id} 2026-12-25 자료 대기`),{kind:'defer',id,date:'2026-12-25',reason:'자료 대기'});
 assert.deepEqual(parseCommand(`!orbit 허용 ${id} req-123`),{kind:'allow',id,requestId:'req-123'});
 assert.throws(()=>parseCommand('!orbit 승인 all'));assert.throws(()=>parseCommand('!orbit 실행'));
 assert.equal(await stableId('same'),await stableId('same'));assert.notEqual(await stableId('ownerA'),await stableId('ownerB'));
 assert.match(snowflakeNow(),/^\d{17,20}$/);
});
test('permissions apply guild role denies, then member overrides, without number precision loss',()=>{
 const roles=[{id:guildId,permissions:'68608'},{id:'role',permissions:'0'}],member={roles:['role']};
 assert.equal(channelPermissions(guildId,roles,member,{permission_overwrites:[{id:'role',type:0,allow:'0',deny:'2048'}]},botId)&2048n,0n);
 assert.equal(channelPermissions(guildId,roles,member,{permission_overwrites:[{id:'role',type:0,allow:'0',deny:'2048'},{id:botId,type:1,allow:'2048',deny:'0'}]},botId)&2048n,2048n);
});
test('connection validation checks identity, destination and permissions and stores encrypted token only',async()=>{
 const db=createDatabase();globalThis.fetch=async url=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/users/@me'))return response({id:botId,bot:true,username:'Orbit'});
  if(path.endsWith('/roles'))return response([{id:guildId,permissions:'68608'}]);
  if(path.includes('/members/'))return response({roles:[],user:{id:path.split('/').at(-1)}});
  if(path.endsWith('/messages'))return response([]);
  return response({id:channelId,guild_id:guildId,type:0,name:'private'});
 };
 await configureDiscord(db,owner,{token,guildId,channelId,userId,enabled:true},env,config.origin);
 assert.equal((await readDiscord(db,owner,env)).token,token);
 assert.ok(!JSON.stringify(await discordStatus(db,owner)).includes(token));
 const row=await db.prepare('SELECT secret_json FROM orbit_integrations WHERE owner_id=?').bind(owner).first();assert.ok(!row.secret_json.includes(token));
 await assert.rejects(()=>configureDiscord(db,owner,{token,guildId:'999999999999999999',channelId,userId,enabled:true},env,config.origin),/서버/);
 db.close();
});
test('unapproved humans, webhook messages and bot messages cannot invoke an owner command',async()=>{
 const db=createDatabase(),cursor=state();globalThis.fetch=async()=>response([
  {id:'100000000000000001',author:{id:'other'},content:'!orbit 실행 delete'},
  {id:'100000000000000002',author:{id:userId,bot:true},content:'!orbit 실행 delete'},
  {id:'100000000000000003',author:{id:userId},webhook_id:'webhook',content:'!orbit 실행 delete'},
  {id:'100000000000000004',author:{id:userId},content:'ordinary conversation'},
 ]);
 await receiveDiscord(db,owner,config,cursor,env);
 assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM orbit_discord_commands').first()).count,0);
 assert.equal(cursor.after,'100000000000000004');db.close();
});
test('replayed owner commands keep one receipt and one response; other owners cannot approve',async()=>{
 const db=createDatabase(),cursor=state(),message={id:'100000000000000001',author:{id:userId},content:'!orbit 도움말'};
 globalThis.fetch=async()=>response([message]);await receiveDiscord(db,owner,config,cursor,env);cursor.after='100000000000000000';await receiveDiscord(db,owner,config,cursor,env);
 assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM orbit_discord_commands').first()).count,1);
 assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM orbit_discord_outbox').first()).count,1);
 await assert.rejects(()=>executeDiscordCommand(db,'other',config,message.id,{kind:'approve',id:randomUUID()},env),/제안을 찾을 수 없습니다/);db.close();
});
test('outbound payload disables mentions, redacts tokens and enforces stable nonce; sent receipts are not redelivered',async()=>{
 const db=createDatabase(),cursor=state();await queueDiscord(db,owner,config,'event','@everyone '+token);
 await queueDiscord(db,owner,config,'event','duplicate');let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.deepEqual(body.allowed_mentions,{parse:[]});assert.equal(body.enforce_nonce,true);assert.ok(body.nonce.length<=25);assert.ok(!body.content.includes(token));assert.ok(!body.content.includes('@everyone'));return response({id:'555555555555555555'});};
 await deliverDiscord(db,owner,config,cursor);await deliverDiscord(db,owner,config,cursor);assert.equal(calls,1);assert.ok(cursor.lastSent);db.close();
});
test('rate limits schedule retries; ambiguous old sends are surfaced without duplicate post',async()=>{
 const db=createDatabase(),cursor=state();await queueDiscord(db,owner,config,'event','test');globalThis.fetch=async()=>response({retry_after:35},429);
 await assert.rejects(()=>deliverDiscord(db,owner,config,cursor));assert.ok(cursor.retryAt>Date.now()+30000);
 await db.prepare("UPDATE orbit_discord_outbox SET status='sending',next_at=?").bind(Date.now()-121000).run();
 globalThis.fetch=async()=>{throw Error('must not post')};await deliverDiscord(db,owner,config,cursor);
 assert.equal((await db.prepare('SELECT status FROM orbit_discord_outbox').first()).status,'uncertain');db.close();
});
test('notifications isolate owners and skip pre-connection history; repeated scans are idempotent',async()=>{
 const db=createDatabase(),cursor=state(),now=new Date(Date.now()+1000).toISOString();
 for(const [who,created,id] of [[owner,'2020-01-01T00:00:00Z',randomUUID()],['other',now,randomUUID()],[owner,now,randomUUID()]])await db.prepare("INSERT INTO orbit_agent_turns(owner_id,id,input,status,response_json,created_at,updated_at) VALUES(?,?,'question','completed',?,?,?)").bind(who,id,JSON.stringify({text:'answer'}),created,created).run();
 await collectDiscordNotifications(db,owner,config,cursor);await collectDiscordNotifications(db,owner,config,cursor);
 assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM orbit_discord_outbox').first()).count,1);db.close();
});
test('disabled connectors never fetch and active leases prevent concurrent consumers',async()=>{
 const db=createDatabase();globalThis.fetch=async()=>{throw Error('must not fetch')};await saveConnection(db,owner,'discord',{...config,enabled:false},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 assert.deepEqual(await syncDiscord(db,owner,env),{active:false});
 await saveConnection(db,owner,'discord',config,{connected:true},env.ORBIT_ENCRYPTION_KEY);
 await db.prepare('INSERT INTO orbit_discord_state VALUES(?,?,?)').bind(owner,JSON.stringify(state()),Date.now()+60000).run();assert.equal((await syncDiscord(db,owner,env)).busy,true);db.close();
});

test('project commands support explicit owner project IDs and reject malformed selectors',()=>{
 assert.deepEqual(parseCommand('!orbit 프로젝트'),{kind:'projects'});
 assert.deepEqual(parseCommand('!orbit 실행 [프로젝트:p] 자료 정리'),{kind:'run',text:'자료 정리',projectId:'p'});
 assert.throws(()=>parseCommand('!orbit 실행 [프로젝트:p]'));
});
const project={id:'p',name:'오로라테스트',keywords:['오로라테스트'],color:'#5558e8',symbol:'P',goal:'결과물',due:'2026-09-30',priority:3};
async function addProject(db){await readWorkspace(db,owner);await writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project}});}
test('project resolution uses owner data only and leaves ambiguous work unclassified',async()=>{
 const db=createDatabase();try{
  await addProject(db);
  assert.equal((await resolveDiscordProject(db,owner,{kind:'run',text:'오로라테스트 자료 확인'})).projectId,'p');
  assert.equal((await resolveDiscordProject(db,owner,{kind:'run',text:'일반 업무 확인'})).projectId,null);
  await assert.rejects(()=>resolveDiscordProject(db,'other',{kind:'run',text:'자료',projectId:'p'}),/프로젝트 번호/);
 }finally{db.close();}
});
test('Discord execution persists project and source IDs; receipt replay never submits twice',async()=>{
 const db=createDatabase();try{
  await addProject(db);
  await saveConnection(db,owner,'hermes',{endpoint:'https://hermes.example.com',token:'test-secret',connectionId:'connection-a'},{connected:true},env.ORBIT_ENCRYPTION_KEY);
  const message={id:'100000000000000001',channel_id:channelId,guild_id:guildId,author:{id:userId},timestamp:'2026-09-20T12:00:00Z',content:'!orbit 실행 [프로젝트:p] 테스트 자료 정리'};
  let submissions=0;
  globalThis.fetch=async(url,init={})=>{
   if(url.includes('discord.com'))return response([message]);
   if(url.endsWith('/v1/capabilities'))return response({object:'hermes.api_server.capabilities',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,retention_seconds:86400}}});
   if(url.endsWith('/v1/toolsets'))return response({data:[]});
   if(init.method==='POST'){submissions++;return response({run_id:'discord_test_run',status:'started'},202);}
   return response({object:'hermes.run',run_id:'discord_test_run',status:'running'});
  };
  await receiveDiscord(db,owner,config,state(),env);
  const receipt=JSON.parse((await db.prepare('SELECT command_json FROM orbit_discord_commands').first()).command_json);
  assert.equal(receipt.projectId,'p');assert.equal(receipt.source.platform,'discord');assert.equal(receipt.source.timestamp,message.timestamp);
  assert.equal(receipt.source.url,`https://discord.com/channels/${guildId}/${channelId}/${message.id}`);
  const order=JSON.parse((await db.prepare('SELECT state_json FROM orbit_agent_orders').first()).state_json);
  assert.equal(order.projectId,'p');assert.equal(order.runId,'discord_test_run');assert.equal(order.id,receipt.source.executionId);
  assert.equal((await db.prepare('SELECT project_id FROM orbit_conversations').first()).project_id,'p');
  // Emulate interruption after dispatch but before command acknowledgement.
  await db.prepare("UPDATE orbit_discord_commands SET status='processing',response=''").run();
  await receiveDiscord(db,owner,config,state(),env);
  assert.equal(submissions,1);assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM orbit_agent_orders').first()).count,1);
 }finally{db.close();}
});
test('messages with mismatched channel or guild cannot enter command receipts',async()=>{
 const db=createDatabase();try{
  globalThis.fetch=async()=>response([{id:'100000000000000001',channel_id:'999999999999999999',author:{id:userId},content:'!orbit 상태'},{id:'100000000000000002',guild_id:'999999999999999999',author:{id:userId},content:'!orbit 상태'}]);
  await receiveDiscord(db,owner,config,state(),env);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM orbit_discord_commands').first()).count,0);
 }finally{db.close();}
});
