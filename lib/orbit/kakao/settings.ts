import {z} from 'zod';
import type {Database} from '../../../db/repository.ts';
import {encrypt,decrypt} from '../agent/secrets.ts';
import {directChatConfigured,chatModel} from '../agent/direct-model.ts';
import {AgentError} from '../agent/errors.ts';
import type {Runtime} from '../agent/integrations.ts';

const PROVIDER='kakao_review_model';
export interface KakaoModelConfig {provider:'openai'|'anthropic';apiKey:string;model:string}
export interface KakaoModelSettings {configured:boolean;provider?:'openai'|'anthropic';model?:string}
const configSchema=z.object({provider:z.enum(['openai','anthropic']),apiKey:z.string().trim().min(20).max(500).regex(/^[\x21-\x7e]+$/),model:z.string().trim().min(3).max(100)}).strict().refine(c=>c.provider==='anthropic'?/^claude-[a-z0-9][a-z0-9.-]+$/.test(c.model):/^(?:gpt-[a-z0-9]|o[134](?:-|$))[a-z0-9.-]*$/.test(c.model));
export async function kakaoModelSettings(db:Database,owner:string):Promise<KakaoModelSettings>{
 const row=await db.prepare('SELECT public_json FROM orbit_integrations WHERE owner_id=? AND provider=?').bind(owner,PROVIDER).first<{public_json:string}>();
 if(!row)return {configured:false};
 const data=JSON.parse(row.public_json);
 return {configured:true,provider:data.provider,model:data.model};
}
export async function configureKakaoModel(db:Database,owner:string,input:unknown,env:Runtime){
 const parsed=configSchema.safeParse(input);if(!parsed.success)throw new AgentError('분석 제공자, API 키와 해당 제공자의 모델명을 확인해 주세요. 임의 연결 주소는 사용할 수 없습니다.','KAKAO_MODEL_INPUT',422);
 const encrypted=await encrypt(parsed.data,env.ORBIT_ENCRYPTION_KEY??'',`${owner}:${PROVIDER}`),settings={configured:true,provider:parsed.data.provider,model:parsed.data.model};
 await db.prepare('INSERT INTO orbit_integrations(owner_id,provider,secret_json,public_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,provider) DO UPDATE SET secret_json=excluded.secret_json,public_json=excluded.public_json,updated_at=excluded.updated_at').bind(owner,PROVIDER,encrypted,JSON.stringify(settings),new Date().toISOString()).run();
 return settings;
}
export async function disconnectKakaoModel(db:Database,owner:string){
 await db.prepare('DELETE FROM orbit_integrations WHERE owner_id=? AND provider=?').bind(owner,PROVIDER).run();return {configured:false};
}
export async function resolveKakaoModel(db:Database,owner:string,env:Runtime):Promise<KakaoModelConfig|null>{
 const row=await db.prepare('SELECT secret_json FROM orbit_integrations WHERE owner_id=? AND provider=?').bind(owner,PROVIDER).first<{secret_json:string}>();
 if(row){
  try{const result=configSchema.safeParse(await decrypt<unknown>(row.secret_json,env.ORBIT_ENCRYPTION_KEY??'',`${owner}:${PROVIDER}`));if(result.success)return result.data;}catch{/* return a fixed setup error below */}
  throw new AgentError('카카오톡 분석 연결을 읽지 못했습니다. 전용 AI 연결을 다시 저장해 주세요.','KAKAO_MODEL_SETUP',503);
 }
 return directChatConfigured(env)?{provider:'openai',apiKey:env.OPENAI_API_KEY!.trim(),model:chatModel(env)}:null;
}
