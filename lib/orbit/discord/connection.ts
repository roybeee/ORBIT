import type {Database} from '../../../db/repository.ts';
import {readConnection,saveConnection} from '../agent/secrets.ts';
import {keyOf,type Runtime} from '../agent/integrations.ts';
import {AgentError} from '../agent/errors.ts';
import {discordRequest,channelPermissions} from './api.ts';
import {discordSettings,snowflakeNow,type DiscordConfig} from './protocol.ts';
export interface DiscordState {after:string;since:string;observed:Record<string,string>;lastPoll?:string;lastReceived?:string;lastSent?:string;lastError?:string;retryAt?:number;}
export const readDiscord=(db:Database,owner:string,env:Runtime)=>readConnection<DiscordConfig>(db,owner,'discord',keyOf(env));
export async function discordStatus(db:Database,owner:string){
 const config=await db.prepare("SELECT public_json FROM orbit_integrations WHERE owner_id=? AND provider='discord'").bind(owner).first<{public_json:string}>();
 const row=await db.prepare('SELECT state_json FROM orbit_discord_state WHERE owner_id=?').bind(owner).first<{state_json:string}>();
 const counts=await db.prepare("SELECT status,COUNT(*) AS count FROM orbit_discord_outbox WHERE owner_id=? AND status IN ('pending','sending','uncertain','failed') GROUP BY status").bind(owner).all<{status:string;count:number}>();
 const state:Partial<DiscordState>=row?JSON.parse(row.state_json):{};
 return {config:config?JSON.parse(config.public_json):null,lastPoll:state.lastPoll??null,lastReceived:state.lastReceived??null,lastSent:state.lastSent??null,lastError:state.lastError??'',queue:counts.results};
}
export async function configureDiscord(db:Database,owner:string,raw:unknown,env:Runtime,origin:string){
 const parsed=discordSettings.safeParse(raw);if(!parsed.success)throw new AgentError('봇 토큰, 서버·채널·본인 사용자 ID를 확인하세요.');
 const input=parsed.data,previous=await readDiscord(db,owner,env),token=input.token??previous?.token;if(!token)throw new AgentError('Discord 봇 토큰을 입력하세요.');
 // Verify all IDs against Discord before saving. Credentials only go to Discord.
 const bot=await discordRequest(token,'/users/@me');if(bot.bot!==true||typeof bot.id!=='string')throw new AgentError('개인 계정 토큰은 사용할 수 없습니다. 봇 토큰을 입력하세요.');
 const channel=await discordRequest(token,'/channels/'+input.channelId);if(channel.guild_id!==input.guildId||channel.type!==0)throw new AgentError('선택한 서버의 일반 텍스트 채널을 지정하세요.');
 const roles=await discordRequest(token,'/guilds/'+input.guildId+'/roles');
 const botMember=await discordRequest(token,`/guilds/${input.guildId}/members/${bot.id}`);
 const member=await discordRequest(token,`/guilds/${input.guildId}/members/${input.userId}`);
 const permissions=channelPermissions(input.guildId,roles,botMember,channel,bot.id),needed=BigInt(1024)|BigInt(2048)|BigInt(65536);
 if((permissions&needed)!==needed)throw new AgentError('봇에 채널 보기·메시지 보내기·기록 읽기 권한이 필요합니다.');
 if(!(channelPermissions(input.guildId,roles,member,channel,input.userId)&BigInt(1024)))throw new AgentError('본인 계정에서 볼 수 있는 채널을 지정하세요.');
 await discordRequest(token,`/channels/${input.channelId}/messages?limit=1`);
 const lease=Date.now()+30000,now=new Date().toISOString();
 await db.prepare('INSERT OR IGNORE INTO orbit_discord_state(owner_id,state_json,lease_until) VALUES(?,?,0)').bind(owner,JSON.stringify({after:snowflakeNow(),since:now,observed:{}})).run();
 const lock=await db.prepare('UPDATE orbit_discord_state SET lease_until=? WHERE owner_id=? AND lease_until<?').bind(lease,owner,Date.now()).run();if(lock.meta?.changes!==1)throw new AgentError('Discord 동기화 중입니다. 잠시 후 다시 저장하세요.','BUSY',409);
 try{
  const config:DiscordConfig={...input,token,origin,botId:bot.id,botName:String(bot.username??'ORBIT'),channelName:String(channel.name??'' )};
  const reset=!previous||previous.channelId!==config.channelId||previous.botId!==config.botId||previous.userId!==config.userId||!previous.enabled&&config.enabled;
  if(reset)await db.batch([db.prepare('UPDATE orbit_discord_state SET state_json=? WHERE owner_id=?').bind(JSON.stringify({after:snowflakeNow(),since:now,observed:{}}),owner),db.prepare("UPDATE orbit_discord_outbox SET status='cancelled' WHERE owner_id=? AND status IN ('pending','sending')").bind(owner)]);
  await saveConnection(db,owner,'discord',config,{connected:true,enabled:config.enabled,guildId:config.guildId,channelId:config.channelId,userId:config.userId,botId:config.botId,botName:config.botName,channelName:config.channelName,verifiedAt:now},keyOf(env));
 }finally{await db.prepare('UPDATE orbit_discord_state SET lease_until=0 WHERE owner_id=? AND lease_until=?').bind(owner,lease).run();}
 return discordStatus(db,owner);
}

export async function disconnectDiscord(db:Database,owner:string){
 const lease=Date.now()+30000;
 const exists=await db.prepare('SELECT owner_id FROM orbit_discord_state WHERE owner_id=?').bind(owner).first();
 if(exists){const lock=await db.prepare('UPDATE orbit_discord_state SET lease_until=? WHERE owner_id=? AND lease_until<?').bind(lease,owner,Date.now()).run();if(lock.meta?.changes!==1)throw new AgentError('Discord 동기화 중입니다. 잠시 후 해제하세요.','BUSY',409);}
 try{await db.batch([db.prepare("DELETE FROM orbit_integrations WHERE owner_id=? AND provider='discord'").bind(owner),db.prepare("UPDATE orbit_discord_outbox SET status='cancelled' WHERE owner_id=? AND status IN ('pending','sending')").bind(owner)]);}
 finally{if(exists)await db.prepare('UPDATE orbit_discord_state SET lease_until=0 WHERE owner_id=? AND lease_until=?').bind(owner,lease).run();}
}
