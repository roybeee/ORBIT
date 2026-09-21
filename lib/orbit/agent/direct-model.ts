import {AgentError} from './errors.ts';
import type {Runtime} from './integrations.ts';

export const DEFAULT_CHAT_MODEL='gpt-5.6-luna';
export function directChatConfigured(env:Runtime){return !!env.OPENAI_API_KEY?.trim()&&env.ORBIT_DIRECT_CHAT_ENABLED!=='false'}
export function chatModel(env:Runtime){return env.ORBIT_CHAT_MODEL?.trim()||DEFAULT_CHAT_MODEL}
export type ModelRequest={input:string;instructions:string;conversation_history:{role:'user'|'assistant';content:string}[]};

// This transport can only produce a proposal/read envelope. It has no write tools.
// A timeout is deliberately terminal: Responses submission idempotency is not assumed.
export async function directModelReply(env:Runtime,request:ModelRequest,model:string,timeoutMs=25000){
 if(!env.OPENAI_API_KEY?.trim())throw new AgentError('빠른 대화 연결이 해제되었습니다. 서버의 OpenAI 연결을 확인해 주세요.','OPENAI_SETUP',503);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1000,Math.min(25000,timeoutMs)));
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{
   method:'POST',cache:'no-store',redirect:'error',signal:controller.signal,
   headers:{Authorization:'Bearer '+env.OPENAI_API_KEY.trim(),'Content-Type':'application/json'},
   body:JSON.stringify({model,store:false,instructions:request.instructions+'\nReturn only the JSON envelope. For routine requests be concise. Never execute a change or claim a proposal has already been saved.',input:[...request.conversation_history,{role:'user',content:request.input}],text:{format:{type:'json_object'}},max_output_tokens:6000,...(/^gpt-(5|6)/.test(model)?{reasoning:{effort:'low'}}:{})}),
  });
  if(!response.ok)throw new AgentError(response.status===401||response.status===403?'OpenAI 연결 권한을 확인해 주세요.':response.status===429?'빠른 대화의 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.':'빠른 대화 응답을 받지 못했습니다. 다시 시도해 주세요.','OPENAI_UPSTREAM',502);
  const raw=await response.text();if(raw.length>1000000)throw new AgentError('응답이 너무 큽니다. 요청을 나눠 주세요.','OPENAI_FORMAT',422);
  const data=JSON.parse(raw);
  if(data.status!=='completed')throw new AgentError('응답을 끝까지 받지 못했습니다. 변경사항은 반영되지 않았습니다.','OPENAI_INCOMPLETE',502);
  const output=(Array.isArray(data.output)?data.output:[]).filter((item:any)=>item.type==='message'&&item.role==='assistant').flatMap((item:any)=>Array.isArray(item.content)?item.content:[]).filter((part:any)=>part.type==='output_text').map((part:any)=>part.text).join('');
  if(!output||output.length>300000)throw new AgentError('빠른 대화 응답 형식을 확인하지 못했습니다.','OPENAI_FORMAT',422);
  return output as string;
 }catch(error){
  if(error instanceof AgentError)throw error;
  throw new AgentError(controller.signal.aborted?'빠른 대화 응답 시간이 초과됐습니다. 변경사항은 반영되지 않았으며, 다시 요청할 수 있습니다.':'빠른 대화 연결이 끊겼습니다. 변경사항은 반영되지 않았습니다.','OPENAI_NETWORK',502);
 }finally{clearTimeout(timer)}
}
