import {z} from 'zod';
export const snowflake=z.string().regex(/^[0-9]{17,20}$/);
export const discordSettings=z.object({token:z.string().trim().min(30).max(300).regex(/^[A-Za-z0-9._-]+$/).optional(),guildId:snowflake,channelId:snowflake,userId:snowflake,enabled:z.boolean(),origin:z.string().url().optional()}).strict();
export type DiscordConfig={token:string;guildId:string;channelId:string;userId:string;botId:string;botName:string;channelName:string;enabled:boolean;origin:string};
export const uuid=z.string().uuid();
export type Command={kind:'ask'|'run';text:string;projectId?:string|null}|{kind:'help'|'status'|'projects'}|{kind:'approve'|'reject'|'stop';id:string}|{kind:'defer';id:string;date:string;reason:string}|{kind:'allow'|'deny';id:string;requestId:string};
export function parseCommand(content:string):Command|null{
 const match=content.match(/^!orbit(?:\s+([\s\S]*))?$/i);if(!match)return null;
 const body=(match[1]??'').trim(),space=body.search(/\s/),verb=(space<0?body:body.slice(0,space)).toLowerCase(),rest=space<0?'':body.slice(space).trim();
 const aliases:Record<string,string>={'질문':'ask','실행':'run','상태':'status','프로젝트':'projects','도움말':'help','승인':'approve','거절':'reject','보류':'defer','중지':'stop','허용':'allow','차단':'deny'};
 const kind=aliases[verb]??verb;
 if(!kind||kind==='help')return {kind:'help'};
 if(kind==='status'||kind==='projects')return {kind};
 if(kind==='ask'||kind==='run'){
  if(!rest||rest.length>8000)throw Error('질문 또는 업무 내용을 8,000자 이내로 입력하세요.');
  const selected=rest.match(/^\[(?:프로젝트|project):([^\]\s]{1,100})\]\s+([\s\S]+)$/i);
  if(/^\[(?:프로젝트|project):/i.test(rest)&&!selected)throw Error('[프로젝트:프로젝트번호] 뒤에 업무 내용을 입력하세요.');
  return selected?{kind,text:selected[2].trim(),projectId:selected[1]}:{kind,text:rest};
 }
 if(kind==='approve'||kind==='reject'||kind==='stop'){if(!uuid.safeParse(rest).success)throw Error('알림에 표시된 전체 번호를 입력하세요.');return {kind,id:rest};}
 const parts=rest.split(/\s+/);
 if(kind==='defer'){const [id,date,...reason]=parts;if(!uuid.safeParse(id).success||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!reason.length)throw Error('!orbit 보류 제안번호 YYYY-MM-DD 보류이유 형식으로 입력하세요.');return {kind,id,date,reason:reason.join(' ')};}
 if(kind==='allow'||kind==='deny'){if(!uuid.safeParse(parts[0]).success||parts.length!==2||parts[1].length>200)throw Error('!orbit 허용/차단 업무번호 승인요청번호 형식으로 입력하세요.');return {kind,id:parts[0],requestId:parts[1]};}
 throw Error('지원하는 명령은 !orbit 도움말에서 확인하세요.');
}
export async function stableId(value:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export const snowflakeNow=()=>String(BigInt(Date.now()-1420070400000)<<BigInt(22));
export const discordHelp=`ORBIT 명령\n!orbit 프로젝트 — 내 프로젝트 번호\n!orbit 실행 [프로젝트:번호] 내용 — 프로젝트 지정 실행\n!orbit 질문 내용 — ORBIT 기록을 참고해 답변·제안\n!orbit 실행 내용 — HERMES 업무 실행\n!orbit 상태 — 진행 업무·검토할 제안\n!orbit 승인 제안번호\n!orbit 보류 제안번호 YYYY-MM-DD 이유\n!orbit 거절 제안번호\n!orbit 중지 업무번호\n!orbit 허용 업무번호 승인요청번호\n!orbit 차단 업무번호 승인요청번호\n첨부 원본은 ORBIT 또는 HERMES의 직접 대화에 올려 주세요. !orbit 명령은 텍스트만 처리합니다.`;
