import {z} from 'zod';
import type {Database} from '../../../db/repository.ts';
import {AgentError} from './errors.ts';
import {fetchJson,keyOf,type Runtime} from './integrations.ts';
import {saveConnection} from './secrets.ts';
export const settingsSchema=z.discriminatedUnion('provider',[
 z.object({provider:z.literal('openai'),key:z.string().trim().min(20).max(500),model:z.string().trim().regex(/^[a-zA-Z0-9._-]{1,100}$/).default('gpt-5.6-terra')}).strict(),
 z.object({provider:z.literal('google_calendar'),clientId:z.string().trim().regex(/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/),clientSecret:z.string().trim().min(10).max(500)}).strict(),
]);
export async function configure(db:Database,owner:string,input:z.infer<typeof settingsSchema>,env:Runtime){
 if(input.provider==='openai'){
  const {response}=await fetchJson('https://api.openai.com/v1/models/'+encodeURIComponent(input.model),{headers:{Authorization:`Bearer ${input.key}`}});
  if(!response.ok)throw new AgentError('API 키 또는 모델 접근 권한을 확인해 주세요.','AI_SETUP',422);
  await saveConnection(db,owner,'openai',{key:input.key,model:input.model},{connected:true,model:input.model},keyOf(env));
 }else await saveConnection(db,owner,'google_calendar',{clientId:input.clientId,clientSecret:input.clientSecret},{connected:false},keyOf(env));
}
export async function disconnect(db:Database,owner:string,provider:string){
 if(!['openai','plaud','google_calendar'].includes(provider))throw new AgentError('연결 종류를 확인해 주세요.');
 const statements=[db.prepare('DELETE FROM orbit_integrations WHERE owner_id=? AND provider=?').bind(owner,provider),db.prepare('DELETE FROM orbit_oauth_states WHERE owner_id=? AND provider=?').bind(owner,provider)];
 if(provider==='google_calendar')statements.push(db.prepare('DELETE FROM orbit_calendar_cache WHERE owner_id=?').bind(owner),db.prepare('UPDATE orbit_workspaces SET revision=revision+1,mutation_id=?,updated_at=? WHERE owner_id=?').bind(crypto.randomUUID(),new Date().toISOString(),owner));
 await db.batch(statements);
}
