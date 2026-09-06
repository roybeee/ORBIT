import {z} from 'zod';
import type {Database} from '../../../db/repository.ts';
import {AgentError} from './errors.ts';
import {keyOf,type Runtime} from './integrations.ts';
import {hermesEndpoint,verifyHermes} from './hermes.ts';
import {readConnection,saveConnection} from './secrets.ts';
import type {HermesConfig} from './hermes.ts';
export const settingsSchema=z.discriminatedUnion('provider',[
 z.object({provider:z.literal('hermes'),endpoint:z.string().trim().min(10).max(500),token:z.string().trim().min(20).max(500).regex(/^[\x21-\x7e]+$/)}).strict(),
 z.object({provider:z.literal('google_calendar'),clientId:z.string().trim().regex(/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/),clientSecret:z.string().trim().min(10).max(500)}).strict(),
]);
export async function configure(db:Database,owner:string,input:z.infer<typeof settingsSchema>,env:Runtime){
 if(input.provider==='hermes'){
  const previous=await readConnection<HermesConfig>(db,owner,'hermes',keyOf(env)),endpoint=hermesEndpoint(input.endpoint);
  if(previous?.endpoint!==endpoint&&await db.prepare("SELECT id FROM orbit_agent_turns WHERE owner_id=? AND status='running'").bind(owner).first())throw new AgentError('진행 중인 헤르메스 대화를 먼저 마치거나 중지해 주세요.','BUSY',409);
  const config={endpoint,token:input.token,connectionId:previous?.endpoint===endpoint?previous.connectionId:crypto.randomUUID()};
  const model=await verifyHermes(config);
  await saveConnection(db,owner,'hermes',config,{connected:true,endpoint:config.endpoint,model},keyOf(env));
 }else await saveConnection(db,owner,'google_calendar',{clientId:input.clientId,clientSecret:input.clientSecret},{connected:false},keyOf(env));
}
export async function disconnect(db:Database,owner:string,provider:string){
 if(!['hermes','plaud','google_calendar'].includes(provider))throw new AgentError('연결 종류를 확인해 주세요.');
 if(provider==='hermes'&&await db.prepare("SELECT id FROM orbit_agent_turns WHERE owner_id=? AND status='running'").bind(owner).first())throw new AgentError('진행 중인 헤르메스 대화를 먼저 마치거나 중지해 주세요.','BUSY',409);
 const statements=[db.prepare('DELETE FROM orbit_integrations WHERE owner_id=? AND provider=?').bind(owner,provider),db.prepare('DELETE FROM orbit_oauth_states WHERE owner_id=? AND provider=?').bind(owner,provider)];
 if(provider==='google_calendar')statements.push(db.prepare('DELETE FROM orbit_calendar_cache WHERE owner_id=?').bind(owner),db.prepare('UPDATE orbit_workspaces SET revision=revision+1,mutation_id=?,updated_at=? WHERE owner_id=?').bind(crypto.randomUUID(),new Date().toISOString(),owner));
 await db.batch(statements);
}
