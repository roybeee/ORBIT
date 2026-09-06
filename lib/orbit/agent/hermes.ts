import type {Database} from '../../../db/repository.ts';
import {AgentError} from './errors.ts';
import {fetchJson,keyOf,type Runtime} from './integrations.ts';
import {readConnection} from './secrets.ts';

export interface HermesConfig {endpoint:string;token:string;connectionId:string}
export function hermesEndpoint(value:string){
 let url:URL;try{url=new URL(value.trim())}catch{throw new AgentError('헤르메스의 HTTPS 연결 주소를 입력해 주세요.','HERMES_SETUP',422)}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!host.includes('.')||host.includes(':')||/^[\d.]+$/.test(host)||/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host))throw new AgentError('폰에서 접근할 수 있는 헤르메스 HTTPS 주소가 필요합니다. Mac의 localhost 주소는 사용할 수 없습니다.','HERMES_SETUP',422);
 if(!/^\/(?:[a-zA-Z0-9_-]+\/?)*$/.test(url.pathname))throw new AgentError('헤르메스 기본 주소 또는 프로필 주소를 입력해 주세요.','HERMES_SETUP',422);
 url.pathname=url.pathname.replace(/\/+$/,'').replace(/\/v1$/,'');
 return url.href.replace(/\/$/,'');
}
export async function hermesConfig(db:Database,owner:string,env:Runtime){
 const config=await readConnection<HermesConfig>(db,owner,'hermes',keyOf(env));
 if(!config?.endpoint||!config.token)throw new AgentError('연결에서 헤르메스 주소와 연결 암호를 먼저 등록해 주세요.','HERMES_SETUP',409);
 return config;
}
export async function hermesRequest(config:HermesConfig,path:string,init:RequestInit={}){
 const {response,data}=await fetchJson(config.endpoint+path,{...init,headers:{...init.headers,Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'}},12000);
 if(!response.ok)throw new AgentError(response.status===401||response.status===403?'헤르메스 연결 암호를 확인해 주세요.':response.status===404?'헤르메스 실행 기능을 찾지 못했습니다. 최신 gateway와 연결 주소를 확인해 주세요.':response.status===429||response.status===409?'헤르메스가 다른 작업을 처리 중입니다. 잠시 후 다시 확인합니다.':'헤르메스가 요청을 완료하지 못했습니다. Mac의 gateway 상태를 확인해 주세요.',response.status===401||response.status===403?'HERMES_AUTH':'HERMES_UPSTREAM',502);
 return data;
}
export async function verifyHermes(config:HermesConfig){
 const caps=await hermesRequest(config,'/v1/capabilities');
 if(caps.object!=='hermes.api_server.capabilities'||caps.platform!=='hermes-agent'||!caps.features?.run_submission||!caps.features?.run_status||!caps.features?.run_stop||!caps.features?.runs_idempotency||caps.features.runs_idempotency.enabled===false||caps.features.runs_idempotency.supported===false)throw new AgentError('Hermes Agent의 실행·상태 조회·중지·중복 방지 기능이 필요합니다. Mac에서 Hermes를 업데이트하고 gateway를 시작해 주세요.','HERMES_VERSION',422);
 // Check the authenticated native agent, never just an unauthenticated health page.
 const {response}=await fetchJson(config.endpoint+'/v1/capabilities',{},12000);
 if(![401,403].includes(response.status))throw new AgentError('헤르메스에 연결 암호 보호를 설정한 뒤 다시 연결해 주세요.','HERMES_AUTH',422);
 const models=await hermesRequest(config,'/v1/models');
 return typeof models.data?.[0]?.id==='string'?models.data[0].id.slice(0,100):'Hermes';
}
export const validRunId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(value);
