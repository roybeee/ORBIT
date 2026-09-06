import type {Database} from '@/db/repository';
import type {Connection,Provider} from './types.ts';
import {AgentError} from './errors.ts';
import {decrypt,encrypt,readConnection,saveConnection} from './secrets.ts';
export const PLAUD={server:'https://mcp.plaud.ai/mcp',authorize:'https://mcp.plaud.ai/authorize',token:'https://mcp.plaud.ai/token',register:'https://mcp.plaud.ai/register'};
export const GOOGLE={authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly'};
export interface Runtime {ORBIT_ENCRYPTION_KEY?:string;OPENAI_API_KEY?:string;OPENAI_MODEL?:string}
export interface AuthConfig {clientId:string;clientSecret?:string;accessToken?:string;refreshToken?:string;expiresAt?:number;scope?:string}
export interface AiConfig {key:string;model:string}
export const keyOf=(env:Runtime)=>env.ORBIT_ENCRYPTION_KEY??'';
export async function fetchJson(url:string,init:RequestInit={},timeout=20000):Promise<{response:Response;data:Record<string,any>}>{
 const response=await fetch(url,{...init,signal:AbortSignal.timeout(timeout),redirect:'error'});
 const text=await response.text();if(text.length>2000000)throw new AgentError('연결 응답이 너무 큽니다. 범위를 줄여 주세요.','UPSTREAM',502);
 let data;try{data=JSON.parse(text)}catch{throw new AgentError('연결 서비스가 올바르게 응답하지 않았습니다.','UPSTREAM',502)}return{response,data};
}
export async function connections(db:Database,owner:string,env:Runtime):Promise<Connection[]>{
 const {results}=await db.prepare('SELECT provider,public_json,updated_at FROM orbit_integrations WHERE owner_id=?').bind(owner).all<{provider:Provider;public_json:string;updated_at:string}>();
 return (['openai','plaud','google_calendar'] as Provider[]).map(provider=>{const row=results.find(r=>r.provider===provider),data=row?JSON.parse(row.public_json):{};return {provider,configured:provider==='plaud'||!!row||(provider==='openai'&&!!env.OPENAI_API_KEY),connected:!!data.connected||(provider==='openai'&&!!env.OPENAI_API_KEY),label:provider==='openai'?'AI 에이전트':provider==='plaud'?'Plaud 회의 기록':'Google Calendar',updatedAt:row?.updated_at,...(provider==='openai'?{model:data.model??env.OPENAI_MODEL??'gpt-5.6-terra'}:{})}});
}
export async function aiConfig(db:Database,owner:string,env:Runtime):Promise<AiConfig>{const value=await readConnection<AiConfig>(db,owner,'openai',keyOf(env));if(value)return value;if(env.OPENAI_API_KEY)return {key:env.OPENAI_API_KEY,model:env.OPENAI_MODEL??'gpt-5.6-terra'};throw new AgentError('AI 연결 설정에서 OpenAI API 키를 등록해 주세요. 대화 입력은 그대로 보관됩니다.','AI_SETUP',409)}
export async function accessToken(db:Database,owner:string,provider:'plaud'|'google_calendar',env:Runtime){
 const config=await readConnection<AuthConfig>(db,owner,provider,keyOf(env));if(!config?.accessToken)throw new AgentError(`${provider==='plaud'?'Plaud':'Google Calendar'}에 먼저 연결해 주세요.`,'CONNECT',409);
 if(config.expiresAt&&config.expiresAt>Date.now()+60000)return config.accessToken;
 if(!config.refreshToken)throw new AgentError('연결 기간이 만료됐습니다. 다시 연결해 주세요.','RECONNECT',409);
 const lease=Date.now()+45000;
 const claim=await db.prepare('UPDATE orbit_integrations SET refresh_until=? WHERE owner_id=? AND provider=? AND refresh_until<?').bind(lease,owner,provider,Date.now()).run();
 if(claim.meta?.changes!==1)throw new AgentError('계정 연결을 갱신 중입니다. 잠시 후 다시 시도해 주세요.','BUSY',409);
 try{
  const latest=await readConnection<AuthConfig>(db,owner,provider,keyOf(env));if(latest?.accessToken&&latest.expiresAt&&latest.expiresAt>Date.now()+60000)return latest.accessToken;
  const form=new URLSearchParams({grant_type:'refresh_token',refresh_token:config.refreshToken,client_id:config.clientId});if(config.clientSecret)form.set('client_secret',config.clientSecret);if(provider==='plaud')form.set('resource',PLAUD.server);
  const {response,data}=await fetchJson(provider==='plaud'?PLAUD.token:GOOGLE.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
  if(!response.ok||typeof data.access_token!=='string'){await saveConnection(db,owner,provider,config,{connected:false},keyOf(env));throw new AgentError('연결을 갱신하지 못했습니다. 다시 연결해 주세요.','RECONNECT',409)}
  const next={...config,accessToken:data.access_token,refreshToken:data.refresh_token??config.refreshToken,expiresAt:Date.now()+Number(data.expires_in??3600)*1000};await saveConnection(db,owner,provider,next,{connected:true},keyOf(env));return next.accessToken;
 }finally{await db.prepare('UPDATE orbit_integrations SET refresh_until=0 WHERE owner_id=? AND provider=? AND refresh_until=?').bind(owner,provider,lease).run()}

}
export async function startOAuth(db:Database,owner:string,provider:'plaud'|'google_calendar',origin:string,env:Runtime){
 const redirectUri=origin+'/api/integrations/callback';let config=await readConnection<AuthConfig>(db,owner,provider,keyOf(env));
 if(provider==='google_calendar'&&!config?.clientId)throw new AgentError('Google 연결 설정에 Orbit용 OAuth 클라이언트 정보를 먼저 등록해 주세요.','GOOGLE_SETUP',409);
 if(provider==='plaud'&&!config?.clientId){
  const {response,data}=await fetchJson(PLAUD.register,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Orbit · Personal Manager',redirect_uris:[redirectUri],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})});
  if(!response.ok||typeof data.client_id!=='string')throw new AgentError('Plaud 연결을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.','CONNECT',502);
  config={clientId:data.client_id,...(data.client_secret?{clientSecret:data.client_secret}:{})};await saveConnection(db,owner,provider,config,{connected:false},keyOf(env));
 }
 const state=crypto.randomUUID()+crypto.randomUUID(),verifier=crypto.randomUUID()+crypto.randomUUID();const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 const encrypted=await encrypt({verifier,redirectUri,config},keyOf(env),`${owner}:oauth:${state}`);
 await db.prepare('DELETE FROM orbit_oauth_states WHERE expires_at<?').bind(new Date().toISOString()).run();
 await db.prepare('INSERT INTO orbit_oauth_states(state,owner_id,provider,secret_json,expires_at) VALUES(?,?,?,?,?)').bind(state,owner,provider,encrypted,new Date(Date.now()+600000).toISOString()).run();
 const url=new URL(provider==='plaud'?PLAUD.authorize:GOOGLE.authorize);url.search=new URLSearchParams({response_type:'code',client_id:config!.clientId,redirect_uri:redirectUri,state,code_challenge:challenge,code_challenge_method:'S256',...(provider==='plaud'?{resource:PLAUD.server}:{scope:GOOGLE.scope,access_type:'offline',prompt:'consent',include_granted_scopes:'true'})}).toString();
 return {url:url.href,state};
}
export async function finishOAuth(db:Database,owner:string,state:string,code:string,cookieState:string,env:Runtime){
 if(!state||state!==cookieState)throw new AgentError('연결 확인이 만료됐습니다. 연결 버튼부터 다시 시작해 주세요.','OAUTH',400);
 const row=await db.prepare('SELECT provider,secret_json FROM orbit_oauth_states WHERE state=? AND owner_id=? AND expires_at>?').bind(state,owner,new Date().toISOString()).first<{provider:'plaud'|'google_calendar';secret_json:string}>();if(!row)throw new AgentError('연결 요청을 찾을 수 없습니다. 다시 연결해 주세요.','OAUTH',400);
 const removed=await db.prepare('DELETE FROM orbit_oauth_states WHERE state=? AND owner_id=?').bind(state,owner).run();if(!removed.meta?.changes)throw new AgentError('이미 사용한 연결 요청입니다.','OAUTH',409);
 const saved=await decrypt<{verifier:string;redirectUri:string;config:AuthConfig}>(row.secret_json,keyOf(env),`${owner}:oauth:${state}`);
 const form=new URLSearchParams({grant_type:'authorization_code',code,client_id:saved.config.clientId,redirect_uri:saved.redirectUri,code_verifier:saved.verifier});if(saved.config.clientSecret)form.set('client_secret',saved.config.clientSecret);if(row.provider==='plaud')form.set('resource',PLAUD.server);
 const {response,data}=await fetchJson(row.provider==='plaud'?PLAUD.token:GOOGLE.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
 if(!response.ok||typeof data.access_token!=='string')throw new AgentError('계정 연결을 확인하지 못했습니다. 다시 연결해 주세요.','OAUTH',502);
 if(row.provider==='google_calendar'&&typeof data.scope==='string'&&!data.scope.split(' ').includes('https://www.googleapis.com/auth/calendar.events'))throw new AgentError('일정 권한을 승인해야 Calendar를 연결할 수 있습니다.','SCOPE',403);
 await saveConnection(db,owner,row.provider,{...saved.config,accessToken:data.access_token,refreshToken:data.refresh_token??saved.config.refreshToken,expiresAt:Date.now()+Number(data.expires_in??3600)*1000,scope:data.scope},{connected:true},keyOf(env));return row.provider;
}
export async function mcpTools(db:Database,owner:string,env:Runtime){
 const state=await connections(db,owner,env),tools:Record<string,unknown>[]=[];
 for(const provider of ['plaud','google_calendar'] as const){if(!state.find(c=>c.provider===provider)?.connected)continue;const token=await accessToken(db,owner,provider,env);tools.push({type:'mcp',server_label:provider,...(provider==='plaud'?{server_url:PLAUD.server}:{connector_id:'connector_googlecalendar'}),authorization:token,allowed_tools:{read_only:true},require_approval:'never'});}
 return tools;
}
