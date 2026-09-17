import {z} from 'zod';
import type {Database} from '../../../db/repository.ts';
import {AgentError} from '../agent/errors.ts';
import {encrypt,decrypt} from '../agent/secrets.ts';
import {keyOf,type Runtime} from '../agent/integrations.ts';
import {hermesConfig} from '../agent/hermes.ts';

// A known ODA deployment is the sole destination for this connector's credentials.
export const ODA_ORIGIN='https://oda-web-wpts.onrender.com';
const ROOT='/api/v2/oda/integration';
export interface OdaConnection {token:string;connectedAt:string}
export async function readOda(db:Database,owner:string,env:Runtime){
  const row=await db.prepare('SELECT secret_json FROM orbit_automation_connections WHERE owner_id=?').bind(owner).first<{secret_json:string}>();
  return row?decrypt<OdaConnection>(row.secret_json,keyOf(env),`${owner}:oda-automation`):null;
}
export async function odaRequest(connection:OdaConnection,path:string,input?:unknown){
  if(!/^\/(?:capabilities|routines|runs|batches|metrics)(?:\/[a-zA-Z0-9_-]+)*(?:\?storeId=[^&]{1,400}&month=\d{4}-\d{2})?$/.test(path))throw new AgentError('지원하지 않는 자동화 요청입니다.');
  let response:Response;
  // Workers supports follow/manual only. Never forward credentials to a redirect.
  try{response=await fetch(ODA_ORIGIN+ROOT+path,{method:input===undefined?'GET':'POST',redirect:'manual',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json','Accept':'application/json'},body:input===undefined?undefined:JSON.stringify(input),signal:AbortSignal.timeout(25000)})}
  catch{throw new AgentError('ODA 서버에 연결하지 못했습니다. 작업을 중복 등록하지 말고 상태를 다시 확인해 주세요.','ODA_UNAVAILABLE',503)}
  if(response.status>=300&&response.status<400)throw new AgentError('ODA 연결 주소가 변경되어 연결을 중단했습니다. 연결 키는 다른 주소로 전달하지 않았습니다.','ODA_REDIRECT',502);
  if([401,403].includes(response.status))throw new AgentError('ODA 연결 키가 만료되었거나 이 작업의 권한이 없습니다. ODA 자동화 연결에서 매장과 권한을 확인해 주세요.','ODA_AUTH',409);
  if(response.status===404)throw new AgentError('ODA 자동화 기능을 찾지 못했습니다. ODA 배포 상태를 확인해 주세요.','ODA_VERSION',503);
  const raw=await response.text();if(raw.length>1500000)throw new AgentError('ODA 응답이 너무 큽니다. 조회 범위를 줄여 주세요.','ODA_SIZE',502);
  let data;try{data=JSON.parse(raw)}catch{throw new AgentError('ODA 응답 형식을 확인하지 못했습니다.','ODA_RESPONSE',502)}
  if(!response.ok){const message=typeof data.message==='string'?data.message:typeof data.error==='string'?data.error:'ODA에서 요청을 처리하지 못했습니다. 입력과 최신 상태를 확인해 주세요.';throw new AgentError(message.replaceAll(connection.token,'[연결 키]').slice(0,1000),'ODA_REQUEST',response.status>=400&&response.status<500?response.status:502)}
  return data;
}
export async function connectOda(db:Database,owner:string,env:Runtime,token:string){
  const connection={token,connectedAt:new Date().toISOString()},capabilities=await odaRequest(connection,'/capabilities');
  if(capabilities.version!==1||!Array.isArray(capabilities.stores)||capabilities.currency!=='KRW')throw new AgentError('ODA 연결 기능의 호환 버전을 확인하지 못했습니다.','ODA_VERSION',422);
  const encrypted=await encrypt(connection,keyOf(env),`${owner}:oda-automation`);
  await db.prepare('INSERT INTO orbit_automation_connections(owner_id,secret_json,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET secret_json=excluded.secret_json,updated_at=excluded.updated_at').bind(owner,encrypted,connection.connectedAt).run();
  return {connected:true,capabilities};
}
const id=z.string().uuid();
const money=z.number().int().min(-1000000000000).max(1000000000000);
const line=z.object({externalRef:z.string().trim().min(1).max(120),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),kind:z.enum(['revenue','expense']),channel:z.enum(['pos','baemin','coupang','yogiyo','ddangyo','manual']),category:z.enum(['sales','ingredients','labor','rent','utilities','fees','marketing','supplies','other']),description:z.string().trim().min(1).max(500),amountKrw:money,vatKrw:money.nullable()}).strict();
export const automationInput=z.discriminatedUnion('action',[
  z.object({action:z.literal('connect'),token:z.string().trim().min(40).max(250)}).strict(),
  z.object({action:z.literal('routine.save'),id,title:z.string().trim().min(1).max(160),prompt:z.string().trim().min(10).max(10000),storeId:z.string().min(1).max(100),timeZone:z.string().max(100),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7),enabled:z.boolean(),mode:z.enum(['report','oda_batch']),expectedVersion:z.number().int().positive().optional()}).strict(),
  z.object({action:z.enum(['routine.pause','routine.resume']),id,expectedVersion:z.number().int().positive()}).strict(),
  z.object({action:z.literal('routine.run'),id,invocationId:id}).strict(),
  z.object({action:z.literal('run.stop'),id}).strict(),
  z.object({action:z.literal('run.resolve'),id,confirmedStopped:z.literal(true),note:z.string().trim().min(10).max(1000)}).strict(),
  z.object({action:z.literal('run.approval'),id,requestId:z.string().min(1).max(160),choice:z.enum(['once','deny'])}).strict(),
  z.object({action:z.literal('batch.preview'),batchId:id,storeId:z.string().min(1).max(100),month:z.string().regex(/^\d{4}-\d{2}$/),source:z.object({system:z.string().min(1).max(120),accountRef:z.string().min(1).max(120),url:z.string().url().max(2000).refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash}),capturedAt:z.string().datetime()}).strict(),lines:z.array(line).min(1).max(200)}).strict(),
  z.object({action:z.literal('batch.commit'),id,digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
]);
export async function automationState(db:Database,owner:string,env:Runtime,filters?:{storeId:string;month:string}){
  const connection=await readOda(db,owner,env);if(!connection)return {connected:false,origin:ODA_ORIGIN};
  const capabilities=await odaRequest(connection,'/capabilities');
  const [routines,batches]=await Promise.allSettled([odaRequest(connection,'/routines'),filters?odaRequest(connection,`/batches?storeId=${encodeURIComponent(filters.storeId)}&month=${filters.month}`):Promise.resolve({batches:[]})]);
  return {connected:true,origin:ODA_ORIGIN,connectedAt:connection.connectedAt,capabilities,routineState:routines.status==='fulfilled'?routines.value:null,batchState:batches.status==='fulfilled'?batches.value:null,errors:[routines,batches].flatMap(r=>r.status==='rejected'?[(r.reason as Error).message]:[])};
}
export async function automationDetail(db:Database,owner:string,env:Runtime,kind:'runs'|'routines',detailId:string){
  const connection=await readOda(db,owner,env);if(!connection)throw new AgentError('ODA 자동화 연결 키를 먼저 등록해 주세요.','ODA_SETUP',409);
  return odaRequest(connection,`/${kind}/${detailId}`);
}
export async function changeAutomation(db:Database,owner:string,env:Runtime,input:z.infer<typeof automationInput>){
  if(input.action==='connect')return connectOda(db,owner,env,input.token);
  const connection=await readOda(db,owner,env);if(!connection)throw new AgentError('ODA 자동화 연결 키를 먼저 등록해 주세요.','ODA_SETUP',409);
  if(input.action==='routine.save'){
    const {action,...routine}=input;
    try{new Intl.DateTimeFormat('ko',{timeZone:routine.timeZone})}catch{throw new AgentError('시간대를 확인해 주세요.')}
    // Existing Hermes credential is sent only to the user's explicitly connected ODA backend.
    const hermes=await hermesConfig(db,owner,env);
    return odaRequest(connection,'/routines',{...routine,runner:{endpoint:hermes.endpoint,token:hermes.token}});
  }
  if(input.action==='routine.pause'||input.action==='routine.resume')return odaRequest(connection,`/routines/${input.id}/${input.action.split('.')[1]}`,{expectedVersion:input.expectedVersion});
  if(input.action==='routine.run')return odaRequest(connection,`/routines/${input.id}/run`,{id:input.invocationId});
  if(input.action==='run.stop')return odaRequest(connection,`/runs/${input.id}/stop`,{});
  if(input.action==='run.resolve')return odaRequest(connection,`/runs/${input.id}/resolve`,{confirmedStopped:input.confirmedStopped,note:input.note});
  if(input.action==='run.approval')return odaRequest(connection,`/runs/${input.id}/approval`,{requestId:input.requestId,choice:input.choice});
  if(input.action==='batch.preview'){const {action,...batch}=input;return odaRequest(connection,'/batches/preview',batch)}
  if(input.action==='batch.commit')return odaRequest(connection,`/batches/${input.id}/commit`,{digest:input.digest});
  throw new AgentError('지원하지 않는 자동화 요청입니다.');
}
