import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {syncCalendar} from '@/lib/orbit/agent/calendar';
import {dateSchema} from '@/lib/orbit/validation';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const user=await owner(request),input=await body(request,1000);if(input.date!==undefined&&!dateSchema.safeParse(input.date).success)throw new AgentError('조회 날짜를 확인해 주세요.');return json(await syncCalendar(getDatabase(),user.id,env,input.date))}catch(error){return failure(error)}}
