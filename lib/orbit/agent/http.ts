import {getChatGPTUser} from '@/app/chatgpt-auth';
import {AgentError} from './errors.ts';
import {RevisionConflict} from '../../../db/repository.ts';
import {DomainError} from '../reducer.ts';
export {AgentError};
export const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function owner(request?:Request){const user=await getChatGPTUser();if(!user)throw new AgentError('로그인이 필요합니다.','AUTH',401);if(request){const origin=request.headers.get('origin');if((origin&&origin!==new URL(request.url).origin)||request.headers.get('sec-fetch-site')==='cross-site')throw new AgentError('요청 출처를 확인할 수 없습니다.','ORIGIN',403)}return user}
export async function body(request:Request,max=50000){if(!request.headers.get('content-type')?.startsWith('application/json'))throw new AgentError('JSON 입력이 필요합니다.','INPUT',415);const buffer=await request.arrayBuffer();if(buffer.byteLength>max)throw new AgentError('입력 내용이 너무 큽니다.','INPUT',413);try{return JSON.parse(new TextDecoder().decode(buffer))}catch{throw new AgentError('입력 형식을 확인해 주세요.')}}
export function failure(error:unknown){if(error instanceof AgentError)return json({error:error.message,code:error.code,...(error.details?{details:error.details}:{})},error.status);if(error instanceof RevisionConflict)return json({error:error.message,code:'CONFLICT'},409);if(error instanceof DomainError)return json({error:error.message,code:'INPUT'},422);console.error('Orbit agent request failed');return json({error:'요청을 완료하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.',code:'UNAVAILABLE'},503)}
