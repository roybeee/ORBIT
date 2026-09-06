import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {listAgent} from '@/lib/orbit/agent/repository';
import {connections} from '@/lib/orbit/agent/integrations';
import {agentInput,runAgent} from '@/lib/orbit/agent/runner';
import {decisionSchema,decide} from '@/lib/orbit/agent/decisions';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await owner(),before=new URL(request.url).searchParams.get('before')??undefined;if(before&&!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before))throw new AgentError('대화 페이지를 확인해 주세요.');return json({...await listAgent(getDatabase(),user.id,before),connections:await connections(getDatabase(),user.id,env)})}catch(error){return failure(error)}}
export async function POST(request:Request){try{const user=await owner(request),parsed=agentInput.safeParse(await body(request));if(!parsed.success)throw new AgentError('8,000자 이내로 메시지를 입력해 주세요.');await runAgent(getDatabase(),user.id,parsed.data,env);return json({ok:true})}catch(error){return failure(error)}}
export async function PATCH(request:Request){try{const user=await owner(request),parsed=decisionSchema.safeParse(await body(request));if(!parsed.success)throw new AgentError('제안 번호와 검토 내용을 확인해 주세요.');await decide(getDatabase(),user.id,parsed.data,env);return json({ok:true})}catch(error){return failure(error)}}
