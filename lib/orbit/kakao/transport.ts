import {directModelReply} from '../agent/direct-model.ts';
import {AgentError} from '../agent/errors.ts';
import type {KakaoModelConfig} from './settings.ts';

/** Both transports are one stateless text request with no tool definitions or agent fallback. */
export async function kakaoModelReply(config:KakaoModelConfig,instructions:string,input:string){
 if(config.provider==='openai')return directModelReply({OPENAI_API_KEY:config.apiKey},{instructions,input,conversation_history:[],outputTokens:7000},config.model);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 try{
  const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'x-api-key':config.apiKey,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model:config.model,max_tokens:7000,system:instructions,messages:[{role:'user',content:input}]})});
  if(!response.ok)throw new AgentError(response.status===429?'카카오톡 분석 제공자의 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.':'카카오톡 분석 연결 권한과 모델을 확인해 주세요.','KAKAO_MODEL_UPSTREAM',502);
  const raw=await response.text();if(raw.length>1000000)throw new AgentError('카카오톡 분석 응답이 너무 큽니다.','KAKAO_MODEL_FORMAT',422);
  const data=JSON.parse(raw);
  if(data.type!=='message'||data.role!=='assistant'||data.stop_reason!=='end_turn'||!Array.isArray(data.content)||!data.content.length||data.content.some((part:{type?:string;text?:unknown})=>part.type!=='text'||typeof part.text!=='string'))throw new AgentError('카카오톡 분석이 완전한 텍스트 결과로 끝나지 않았습니다. 실제 변경은 반영하지 않았습니다.','KAKAO_MODEL_FORMAT',422);
  const text=data.content.map((part:{text:string})=>part.text).join('');if(!text||text.length>300000)throw new AgentError('카카오톡 분석 응답 형식을 확인하지 못했습니다.','KAKAO_MODEL_FORMAT',422);
  return text;
 }catch(error){
  if(error instanceof AgentError)throw error;
  throw new AgentError(controller.signal.aborted?'카카오톡 분석 응답 시간이 초과됐습니다. 실제 변경은 반영하지 않았습니다.':'카카오톡 분석 연결 또는 응답을 확인하지 못했습니다.','KAKAO_MODEL_UPSTREAM',502);
 }finally{clearTimeout(timer)}
}
