import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {configureDiscord,discordStatus,readDiscord} from '@/lib/orbit/discord/connection';
import {syncDiscord,queueDiscord} from '@/lib/orbit/discord/runtime';
import {runtimeStatus} from '@/lib/orbit/daily-runtime';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner(),db=getDatabase();return json({...await discordStatus(db,user.id),runtime:await runtimeStatus(db,user.id)})}catch(error){return failure(error)}}
export async function POST(request:Request){try{const user=await owner(request),input=await body(request,5000),db=getDatabase();
 if(input.action==='save')return json(await configureDiscord(db,user.id,input.settings,env,new URL(request.url).origin));
 if(input.action==='sync'){await syncDiscord(db,user.id,env);return json(await discordStatus(db,user.id));}
 if(input.action==='test'){const config=await readDiscord(db,user.id,env);if(!config?.enabled)throw new AgentError('Discord를 연결하고 사용을 켜 주세요.');await queueDiscord(db,user.id,config,'test:'+crypto.randomUUID(),'ORBIT 연결 확인\n!orbit 도움말 또는 !orbit 상태를 입력하세요.');await syncDiscord(db,user.id,env);return json(await discordStatus(db,user.id));}
 throw new AgentError('요청 종류를 확인하세요.');
 }catch(error){return failure(error)}}
