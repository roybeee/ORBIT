import {AgentError} from '../agent/errors.ts';
export class DiscordError extends AgentError {retryAfter:number;constructor(status:number,retryAfter=0){super(status===429?'Discord 요청이 많아 잠시 후 다시 연결합니다.':status===401?'Discord 봇 토큰을 확인하세요.':status===403?'Discord 채널 권한과 Message Content Intent를 확인하세요.':'Discord 응답을 확인하지 못했습니다.','DISCORD_UPSTREAM',502);this.retryAfter=retryAfter;}}
export async function discordRequest<T=unknown>(token:string,path:string,method='GET',body?:unknown):Promise<T>{
 if(!/^\/(?:users|channels|guilds|oauth2)\//.test(path))throw new Error('Unsupported Discord path');
 let response:Response;try{response=await fetch('https://discord.com/api/v10'+path,{method,redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bot '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{throw new DiscordError(503);}
 const raw=await response.text();if(raw.length>2000000)throw new DiscordError(502);let value;try{value=raw?JSON.parse(raw):{};}catch{throw new DiscordError(502);}
 if(!response.ok)throw new DiscordError(response.status,response.status===429?Math.min(3600,Math.max(1,Number(value.retry_after)||5)):0);
 return value;
}
export function channelPermissions(guildId:string,roles:{id:string;permissions:string}[],member:{roles:string[];user?:{id:string}},channel:{permission_overwrites?:{id:string;type:number;allow:string;deny:string}[]},userId:string){
 let bits=roles.filter(r=>r.id===guildId||member.roles.includes(r.id)).reduce((a,r)=>a|BigInt(r.permissions),BigInt(0));
 if(bits&BigInt(8))return (BigInt(1)<<BigInt(53))-BigInt(1);
 const rules=channel.permission_overwrites??[],everyone=rules.find(r=>r.id===guildId);if(everyone)bits=(bits&~BigInt(everyone.deny))|BigInt(everyone.allow);
 let allow=BigInt(0),deny=BigInt(0);for(const r of rules.filter(r=>r.type===0&&member.roles.includes(r.id))){allow|=BigInt(r.allow);deny|=BigInt(r.deny);}bits=(bits&~deny)|allow;
 const own=rules.find(r=>r.type===1&&r.id===userId);if(own)bits=(bits&~BigInt(own.deny))|BigInt(own.allow);return bits;
}
