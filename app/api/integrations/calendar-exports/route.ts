import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {calendarExports,exportFocus} from '@/lib/orbit/agent/calendar-export';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json({exports:await calendarExports(getDatabase(),user.id)})}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request),input=z.object({eventId:z.string().min(1).max(200)}).strict().safeParse(await body(request,1000));if(!input.success)throw new AgentError('집중 시간을 확인해 주세요.');return json(await exportFocus(getDatabase(),user.id,env,input.data.eventId))}catch(e){return failure(e)}}
