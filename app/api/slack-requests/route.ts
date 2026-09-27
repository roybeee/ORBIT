import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {changeSchema,changeSlackRequest,listSlackRequests} from '@/lib/orbit/slack/requests';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json({items:await listSlackRequests(getDatabase(),user.id)})}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request),parsed=changeSchema.safeParse(await body(request,1000));if(!parsed.success)throw new AgentError('처리할 요청을 확인해 주세요.');return json(await changeSlackRequest(getDatabase(),user.id,parsed.data))}catch(e){return failure(e)}}
