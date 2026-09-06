import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {connections} from '@/lib/orbit/agent/integrations';
import {configure,disconnect,settingsSchema} from '@/lib/orbit/agent/settings';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json({connections:await connections(getDatabase(),user.id,env)})}catch(error){return failure(error)}}
export async function POST(request:Request){try{const user=await owner(request),parsed=settingsSchema.safeParse(await body(request,5000));if(!parsed.success)throw new AgentError('연결 정보를 확인해 주세요.');await configure(getDatabase(),user.id,parsed.data,env);return json({ok:true})}catch(error){return failure(error)}}
export async function DELETE(request:Request){try{const user=await owner(request),input=await body(request,1000);await disconnect(getDatabase(),user.id,input.provider);return json({ok:true})}catch(error){return failure(error)}}
