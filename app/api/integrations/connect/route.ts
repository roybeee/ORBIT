import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {startOAuth} from '@/lib/orbit/agent/integrations';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const user=await owner(request),input=await body(request,1000);if(!['plaud','google_calendar','google_mail'].includes(input.provider))throw new AgentError('연결할 서비스를 선택해 주세요.');const {url,state}=await startOAuth(getDatabase(),user.id,input.provider,new URL(request.url).origin,env);const response=json({url});response.headers.set('Set-Cookie',`orbit_oauth_state=${state}; Path=/api/integrations/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);return response}catch(error){return failure(error)}}
