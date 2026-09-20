import {readWorkspace,type Database} from '../../../db/repository.ts';
import {automaticProject} from '../classify.ts';
import {createConversation,getConversation} from '../agent/conversations.ts';
import {runAgent} from '../agent/runner.ts';
import {dispatchOrder,advanceOrder,listOrders} from '../agent/orders.ts';
import {orderStatusLabel} from '../agent/orders-schema.ts';
import {pendingActions} from '../agent/repository.ts';
import {decide} from '../agent/decisions.ts';
import {redactActivity} from '../agent/activity.ts';
import type {Runtime} from '../agent/integrations.ts';
import {AgentError} from '../agent/errors.ts';
import {DiscordError,discordRequest} from './api.ts';
import {readDiscord,type DiscordState} from './connection.ts';
import {parseCommand,stableId,discordHelp,type Command,type DiscordConfig} from './protocol.ts';
const stamp=()=>new Date().toISOString();
const safe=(s:string,config:DiscordConfig)=>redactActivity(s,config.token).replace(/@(everyone|here)/g,'＠$1');
export async function resolveDiscordProject(db:Database,owner:string,command:Command):Promise<Command>{
 if(command.kind!=='ask'&&command.kind!=='run')return command;
 const {data}=await readWorkspace(db,owner);
 if(command.projectId!==undefined){
  if(command.projectId!==null&&!data.projects.some(p=>p.id===command.projectId))throw new AgentError('내 프로젝트 번호를 확인하세요. !orbit 프로젝트로 조회할 수 있습니다.');
  return command;
 }
 const match=automaticProject(command.text,data.projects,data.tasks,data.notes);
 return {...command,projectId:match?.projectId??null};
}
export async function queueDiscord(db:Database,owner:string,config:DiscordConfig,event:string,content:string){
 const id=await stableId(owner+':discord:'+event),text=safe(content,config),suffix='\n\n전체 기록·검토: '+config.origin;
 await db.prepare("INSERT OR IGNORE INTO orbit_discord_outbox(owner_id,id,channel_id,content,status,created_at) VALUES(?,?,?,?,'pending',?)").bind(owner,id,config.channelId,text.slice(0,1900-suffix.length)+(text.length>1900-suffix.length?'\n[일부 생략]':'')+suffix,stamp()).run();
}
export async function deliverDiscord(db:Database,owner:string,config:DiscordConfig,state:DiscordState){
 const row=await db.prepare("SELECT * FROM orbit_discord_outbox WHERE owner_id=? AND channel_id=? AND status IN ('pending','sending') AND next_at<=? ORDER BY created_at,id LIMIT 1").bind(owner,config.channelId,Date.now()).first<{id:string;content:string;status:string;attempts:number;next_at:number}>();
 if(!row)return false;
 // Discord's nonce deduplication only covers recent messages. Never retry an
 // ambiguous old send automatically after the deduplication window.
 if(row.status==='sending'&&Date.now()-row.next_at>120000){await db.prepare("UPDATE orbit_discord_outbox SET status='uncertain' WHERE owner_id=? AND id=?").bind(owner,row.id).run();state.lastError='이전 알림의 전달 여부를 확인하지 못했습니다. 중복 발송하지 않았습니다.';return true;}
 if(row.attempts>=4){await db.prepare("UPDATE orbit_discord_outbox SET status='failed' WHERE owner_id=? AND id=?").bind(owner,row.id).run();state.lastError='Discord 알림 전달 실패 · 연결과 채널 권한을 확인하세요.';return true;}
 await db.prepare("UPDATE orbit_discord_outbox SET status='sending',attempts=attempts+1,next_at=? WHERE owner_id=? AND id=?").bind(row.status==='sending'?row.next_at:Date.now(),owner,row.id).run();
 try{
  const result=await discordRequest(config.token,`/channels/${config.channelId}/messages`,'POST',{content:row.content,nonce:row.id.replaceAll('-','').slice(0,24),enforce_nonce:true,allowed_mentions:{parse:[]}});
  if(typeof result.id!=='string')throw new DiscordError(502);
  await db.prepare("UPDATE orbit_discord_outbox SET status='sent',message_id=? WHERE owner_id=? AND id=?").bind(result.id,owner,row.id).run();state.lastSent=stamp();return true;
 }catch(error){
  if(error instanceof DiscordError&&error.retryAfter){await db.prepare("UPDATE orbit_discord_outbox SET status='pending',next_at=? WHERE owner_id=? AND id=?").bind(Date.now()+error.retryAfter*1000,owner,row.id).run();state.retryAt=Date.now()+error.retryAfter*1000;}
  throw error;
 }
}
export async function executeDiscordCommand(db:Database,owner:string,config:DiscordConfig,messageId:string,command:Command,env:Runtime){
 const id=await stableId(owner+':discord:message:'+messageId);
 if(command.kind==='help')return discordHelp;
 if(command.kind==='projects'){
  const {data}=await readWorkspace(db,owner);
  return '내 프로젝트\n'+(data.projects.map(p=>`${p.name} · ${p.id}`).join('\n')||'등록된 프로젝트 없음')+'\n\n!orbit 실행 [프로젝트:프로젝트번호] 업무 내용';
 }
 if(command.kind==='status'){
  const orders=(await listOrders(db,owner)).slice(0,8),actions=(await pendingActions(db,owner)).slice(0,6);
  return '업무 현황\n'+(orders.map(o=>`${orderStatusLabel[o.status]} · ${o.title}\n업무번호 ${o.id}${o.approval?'\n승인요청번호 '+o.approval.id:''}`).join('\n\n')||'등록된 실행 없음')+'\n\n검토할 제안\n'+(actions.map(a=>`${a.title} · ${a.state}\n제안번호 ${a.id}`).join('\n\n')||'없음');
 }
 if(command.kind==='ask'||command.kind==='run'){
  // One durable conversation per command prevents unrelated projects from
  // sharing context. Resolve once before receipt insertion for replay safety.
  const projectId=command.projectId??null;
  const conversationId=await stableId(command.projectId===undefined?owner+':discord:channel:'+config.channelId+':'+config.userId:owner+':discord:message-conversation:'+messageId);
  const existing=await getConversation(db,owner,conversationId).catch(e=>{if(e instanceof AgentError&&e.code==='NOT_FOUND')return null;throw e;});
  if(!existing)await createConversation(db,owner,{id:conversationId,title:('Discord · '+command.text).slice(0,100),projectId});
  if(command.kind==='ask'){await runAgent(db,owner,{id,conversationId,message:command.text},env,{defer:true});return '질문을 접수했습니다. 응답과 제안은 이 채널과 ORBIT에 저장됩니다.\n대화번호 '+id;}
  const order=await dispatchOrder(db,owner,id,{type:'agent.dispatch',title:command.text.slice(0,120),instruction:command.text,projectId,taskIds:[],mode:'workflow'},env,conversationId);
  return `${orderStatusLabel[order.status]} · ${order.title}\n업무번호 ${id}\n프로젝트 ${projectId??'미분류 · 프로젝트를 명시해 주세요.'}`;
 }
 if(command.kind==='stop'){const order=await advanceOrder(db,owner,command.id,env,{action:'stop',id:command.id});return `${orderStatusLabel[order.status]}\n업무번호 ${command.id}`;}
 if(command.kind==='allow'||command.kind==='deny'){const order=await advanceOrder(db,owner,command.id,env,{action:'approval',id:command.id,requestId:command.requestId,choice:command.kind==='allow'?'once':'deny'});return `승인 응답을 처리했습니다. ${orderStatusLabel[order.status]}\n업무번호 ${command.id}`;}
 if(command.kind==='defer')await decide(db,owner,{id:command.id,decision:'defer',reason:command.reason,revisitDate:command.date},env);
 else if(command.kind==='approve'||command.kind==='reject')await decide(db,owner,{id:command.id,decision:command.kind==='approve'?'approve':'reject'},env);
 if(!('id' in command))throw new AgentError('명령 형식을 확인하세요.');
 return `제안 ${command.id}: ${command.kind==='approve'?'적용 완료':command.kind==='defer'?'보류':'거절'}\n최신 상태와 결과는 ORBIT에서 확인하세요.`;
}
export async function receiveDiscord(db:Database,owner:string,config:DiscordConfig,state:DiscordState,env:Runtime){
 const messages=await discordRequest(config.token,`/channels/${config.channelId}/messages?after=${state.after}&limit=20`);
 if(!Array.isArray(messages))throw new DiscordError(502);
 const sorted=messages.filter((m:any)=>/^\d{17,20}$/.test(m.id)&&BigInt(m.id)>BigInt(state.after)).sort((a:any,b:any)=>BigInt(a.id)<BigInt(b.id)?-1:1);
 for(const message of sorted){
  if(message.channel_id&&message.channel_id!==config.channelId||message.guild_id&&message.guild_id!==config.guildId||message.author?.id!==config.userId||message.author?.bot||message.webhook_id){state.after=message.id;continue;}
  let command:Command|null;try{command=parseCommand(String(message.content??''));}catch(error){await queueDiscord(db,owner,config,'syntax:'+message.id,error instanceof Error?error.message:discordHelp);state.after=message.id;return true;}
  if(!command){if(!message.content)state.lastError='내용 없는 메시지를 받았습니다. 명령이 읽히지 않으면 봇의 Message Content Intent를 켜 주세요.';state.after=message.id;continue;}
  // Persist the original command BEFORE executing; stable execution IDs make a
  // resumed receive safe after process interruption or a lost network response.
  const known=await db.prepare('SELECT message_id FROM orbit_discord_commands WHERE owner_id=? AND message_id=?').bind(owner,message.id).first();
  if(!known){
   try{command=await resolveDiscordProject(db,owner,command);}catch(error){if(!(error instanceof AgentError))throw error;await queueDiscord(db,owner,config,'project-error:'+message.id,error.message);state.after=message.id;return true;}
   const source={platform:'discord',guildId:config.guildId,channelId:config.channelId,messageId:message.id,userId:config.userId,url:`https://discord.com/channels/${config.guildId}/${config.channelId}/${message.id}`,timestamp:message.timestamp??stamp(),executionId:await stableId(owner+':discord:message:'+message.id)};
   await db.prepare("INSERT OR IGNORE INTO orbit_discord_commands(owner_id,message_id,command_json,status,created_at) VALUES(?,?,?,'processing',?)").bind(owner,message.id,JSON.stringify({...command,source}),stamp()).run();
  }
  const receipt=await db.prepare('SELECT command_json,status,response FROM orbit_discord_commands WHERE owner_id=? AND message_id=?').bind(owner,message.id).first<{command_json:string;status:string;response:string}>();
  let response=receipt!.response;
  if(receipt!.status==='processing'){
   try{response=await executeDiscordCommand(db,owner,config,message.id,JSON.parse(receipt!.command_json),env);}
   catch(error){response=error instanceof AgentError?error.message:'업무 요청을 완료하지 못했습니다. ORBIT에서 진행 상태를 확인하세요.';}
   await db.prepare("UPDATE orbit_discord_commands SET status='handled',response=? WHERE owner_id=? AND message_id=?").bind(safe(response,config),owner,message.id).run();
  }
  await queueDiscord(db,owner,config,'reply:'+message.id,response);state.after=message.id;state.lastReceived=stamp();return true;
 }
 return false;
}
export async function collectDiscordNotifications(db:Database,owner:string,config:DiscordConfig,state:DiscordState){
 let changed=false;
 for(const order of await listOrders(db,owner)){
  if(order.createdAt<state.since)continue;
  const key='order:'+order.id,signature=order.status+':'+(order.approval?.id??'');if(state.observed[key]===signature)continue;
  state.observed[key]=signature;
  if(['queued','submitting','stopping'].includes(order.status))continue;
  const detail=order.approval?`\n${order.approval.description}\n!orbit 허용 ${order.id} ${order.approval.id}\n!orbit 차단 ${order.id} ${order.approval.id}`:order.output||order.error||'';
  await queueDiscord(db,owner,config,key+':'+signature,`${orderStatusLabel[order.status]} · ${order.title}\n업무번호 ${order.id}\n${detail}`);changed=true;
 }
 const turns=await db.prepare("SELECT id,response_json,status,updated_at FROM orbit_agent_turns WHERE owner_id=? AND created_at>=? AND status IN ('completed','failed') ORDER BY created_at DESC LIMIT 50").bind(owner,state.since).all<{id:string;response_json:string;status:string;updated_at:string}>();
 for(const turn of turns.results){const key='turn:'+turn.id;if(state.observed[key]===turn.status)continue;const result=JSON.parse(turn.response_json);await queueDiscord(db,owner,config,key+':'+turn.status,`${turn.status==='failed'?'응답 실패':'ORBIT 응답'}\n${result.text||result.error||'ORBIT에서 결과를 확인하세요.'}`);state.observed[key]=turn.status;changed=true;}
 for(const action of await pendingActions(db,owner)){
  if(action.createdAt<state.since||action.state!=='pending')continue;
  const key='action:'+action.id;if(state.observed[key]==='pending')continue;
  await queueDiscord(db,owner,config,key,`검토할 제안 · ${action.title}\n${action.reason}\n제안번호 ${action.id}\n!orbit 승인 ${action.id}\n!orbit 보류 ${action.id} YYYY-MM-DD 이유\n!orbit 거절 ${action.id}`);state.observed[key]='pending';changed=true;
 }
 // Receipts are authoritative; observed is only a bounded scan optimization.
 state.observed=Object.fromEntries(Object.entries(state.observed).slice(-600));return changed;
}
export async function syncDiscord(db:Database,owner:string,env:Runtime){
 let config=await readDiscord(db,owner,env);if(!config?.enabled)return {active:false};
 const lease=Date.now()+180000,lock=await db.prepare('UPDATE orbit_discord_state SET lease_until=? WHERE owner_id=? AND lease_until<?').bind(lease,owner,Date.now()).run();if(lock.meta?.changes!==1)return {active:false,busy:true};
 let state:DiscordState|undefined;
 try{
  config=await readDiscord(db,owner,env);if(!config?.enabled)return {active:false};
  const row=await db.prepare('SELECT state_json FROM orbit_discord_state WHERE owner_id=?').bind(owner).first<{state_json:string}>();if(!row)return {active:false};state=JSON.parse(row.state_json) as DiscordState;
  if((state.retryAt??0)>Date.now()||state.lastPoll&&Date.now()-Date.parse(state.lastPoll)<5000)return {active:false};
  state.lastPoll=stamp();state.lastError='';
  const received=await receiveDiscord(db,owner,config,state,env),collected=await collectDiscordNotifications(db,owner,config,state),sent=await deliverDiscord(db,owner,config,state);
  return {active:received||collected||sent};
 }catch(error){if(state){state.lastError=error instanceof AgentError?error.message:'Discord 동기화를 완료하지 못했습니다.';if(error instanceof DiscordError&&error.retryAfter)state.retryAt=Date.now()+error.retryAfter*1000;}return {active:false,error:state?.lastError};}
 finally{if(state)await db.prepare('UPDATE orbit_discord_state SET state_json=? WHERE owner_id=? AND lease_until=?').bind(JSON.stringify(state),owner,lease).run();await db.prepare('UPDATE orbit_discord_state SET lease_until=0 WHERE owner_id=? AND lease_until=?').bind(owner,lease).run();}
}
