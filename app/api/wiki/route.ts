import {env} from 'cloudflare:workers';
import {getDatabase,} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {bootstrapWiki,type WikiRuntime} from '@/lib/orbit/wiki/bootstrap';
import {syncWikiMail} from '@/lib/orbit/wiki/mail';
import {syncCalendar} from '@/lib/orbit/agent/calendar';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 const user=await owner(request),input=await body(request,1000);
 if(input.action==='bootstrap')return json(await bootstrapWiki(getDatabase(),user,env as WikiRuntime));
 if(input.action==='sync'){
  const warnings:string[]=[];let mail;
  try{mail=await syncWikiMail(getDatabase(),user.id,env)}catch(e){warnings.push(e instanceof Error?e.message:'메일 조회 실패')}
  try{await syncCalendar(getDatabase(),user.id,env)}catch(e){warnings.push(e instanceof Error?e.message:'일정 조회 실패')}
  return json({mail,warnings});
 }
 throw new AgentError('위키 요청을 확인해 주세요.');
}catch(error){return failure(error)}}
