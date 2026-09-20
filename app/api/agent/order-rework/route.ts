import {z} from 'zod';
import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {dispatchRework} from '@/lib/orbit/agent/order-rework';
export const dynamic='force-dynamic';
const inputSchema=z.object({orderId:z.string().uuid(),outputHash:z.string().regex(/^[a-f0-9]{64}$/),reviewHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export async function POST(request:Request){try{const user=await owner(request),input=inputSchema.safeParse(await body(request,2000));if(!input.success)throw new AgentError('보완할 결과와 검토 기준을 확인해 주세요.');return json({order:await dispatchRework(getDatabase(),user.id,input.data,env)})}catch(e){return failure(e)}}
