import {z} from 'zod';
import {after} from 'next/server';
import {flushCalendarOutbox} from '@/lib/orbit/agent/calendar-outbox';
import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {conversationIdSchema} from '@/lib/orbit/agent/conversations';
import {listAgent} from '@/lib/orbit/agent/repository';
import {connections} from '@/lib/orbit/agent/integrations';
import {agentInput,runAgent} from '@/lib/orbit/agent/runner';
import {driveAgent} from '@/lib/orbit/agent/driver';
import {directChatConfigured} from '@/lib/orbit/agent/direct-model';
import {decisionSchema,decide} from '@/lib/orbit/agent/decisions';
export const dynamic='force-dynamic';
function receiptId(value:string|null){const parsed=z.string().uuid().safeParse(value);if(!parsed.success)throw new AgentError('요청 번호를 확인해 주세요.');return parsed.data}
export async function GET(request:Request){try{const user=await owner(),query=new URL(request.url).searchParams;if(query.has('receipt')){const id=receiptId(query.get('receipt'));const row=await getDatabase().prepare('SELECT id,conversation_id,input,attachment_ids,status FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(user.id,id).first<{id:string;conversation_id:string;input:string;attachment_ids:string;status:string}>();return json({receipt:row?{id:row.id,conversationId:row.conversation_id,input:row.input,attachmentIds:JSON.parse(row.attachment_ids),status:row.status}:null})}if(query.has('actionReceipt')){const id=receiptId(query.get('actionReceipt'));const row=await getDatabase().prepare("SELECT id,state,note,revisit_date AS revisitDate,json_extract(result_json,'$.refreshTurnId') AS refreshTurnId,(SELECT t.status FROM orbit_agent_turns t WHERE t.owner_id=orbit_agent_actions.owner_id AND t.id=json_extract(orbit_agent_actions.result_json,'$.refreshTurnId')) AS refreshStatus FROM orbit_agent_actions WHERE owner_id=? AND id=?").bind(user.id,id).first();return json({receipt:row??null})}const conversationId=query.get('conversationId')??'legacy';if(conversationId!=='new'&&!conversationIdSchema.safeParse(conversationId).success)throw new AgentError('대화 번호를 확인해 주세요.');return json({...await listAgent(getDatabase(),user.id,query.get('before')??undefined,conversationId),directChatReady:directChatConfigured(env),connections:await connections(getDatabase(),user.id,env)})}catch(error){return failure(error)}}
export async function POST(request:Request){try{const user=await owner(request),parsed=agentInput.safeParse(await body(request));if(!parsed.success)throw new AgentError('8,000자 이내로 메시지를 입력해 주세요.');const status=await runAgent(getDatabase(),user.id,parsed.data,env,{defer:true});if(status==='running')after(()=>driveAgent(getDatabase(),user.id,parsed.data.id,env,{allowExternalReads:false}).catch(()=>{}));return json({ok:true,status})}catch(error){return failure(error)}}
export async function PATCH(request:Request){try{const user=await owner(request),parsed=decisionSchema.safeParse(await body(request));if(!parsed.success)throw new AgentError('제안 번호와 검토 내용을 확인해 주세요.');const result=await decide(getDatabase(),user.id,parsed.data,env);if(result?.refreshing)after(()=>driveAgent(getDatabase(),user.id,result.turnId,env,{allowExternalReads:false}).catch(()=>{}));after(()=>flushCalendarOutbox(getDatabase(),user.id,env).then(()=>{}));return json({ok:true,...result})}catch(error){return failure(error)}}
