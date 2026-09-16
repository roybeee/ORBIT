import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {runtimeSettings,runtimeStatus,tickRuntime} from '@/lib/orbit/daily-runtime';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json(await runtimeStatus(getDatabase(),user.id))}catch(e){return failure(e)}}
export async function PUT(request:Request){try{const user=await owner(request),input=z.object({enabled:z.boolean(),eveningHour:z.number().int().min(0).max(23)}).strict().safeParse(await body(request,1000));if(!input.success)throw new AgentError('운영 시간 설정을 확인해 주세요.');await runtimeSettings(getDatabase(),user.id,input.data);return json(await runtimeStatus(getDatabase(),user.id))}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request);await tickRuntime(getDatabase(),user.id,env);return json(await runtimeStatus(getDatabase(),user.id))}catch(e){return failure(e)}}
