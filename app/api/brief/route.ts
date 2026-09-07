import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {runAgent} from '@/lib/orbit/agent/runner';
import {dateSchema} from '@/lib/orbit/validation';
import {briefMessage} from '@/lib/orbit/brief/schema';
const input=z.object({id:z.string().uuid(),date:dateSchema,energy:z.enum(['low','normal','high'])}).strict();
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const user=await owner(request),parsed=input.safeParse(await body(request,1000));if(!parsed.success)throw new AgentError('제안 날짜와 컨디션을 확인해 주세요.');const {id,...planning}=parsed.data;await runAgent(getDatabase(),user.id,{id,message:briefMessage(planning),planning},env);return json({ok:true,id})}catch(error){return failure(error)}}
export async function GET(request:Request){try{const user=await owner(),parsed=dateSchema.safeParse(new URL(request.url).searchParams.get('date'));if(!parsed.success)throw new AgentError('제안 날짜를 확인해 주세요.');const date=parsed.data;
 const row=await getDatabase().prepare("SELECT id,status,response_json FROM orbit_agent_turns WHERE owner_id=? AND input IN (?,?,?) ORDER BY created_at DESC,id DESC LIMIT 1").bind(user.id,...(['low','normal','high'] as const).map(energy=>briefMessage({date,energy}))).first<{id:string;status:string;response_json:string}>();
 const response=row?JSON.parse(row.response_json):{};return json({run:row?{id:row.id,status:row.status,progress:response.progress,error:response.error}:null});
 }catch(error){return failure(error)}}
