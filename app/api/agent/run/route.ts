import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {advanceAgent} from '@/lib/orbit/agent/runner';
const inputSchema=z.object({id:z.string().uuid(),action:z.enum(['poll','cancel'])}).strict();
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const user=await owner(request),input=inputSchema.safeParse(await body(request,1000));if(!input.success)throw new AgentError('실행할 대화를 확인해 주세요.');await advanceAgent(getDatabase(),user.id,input.data.id,env,input.data.action==='cancel');return json({ok:true})}catch(error){return failure(error)}}
