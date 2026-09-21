import {z} from 'zod';
import {AgentError} from './errors.ts';

// Partial discovery is unknown, never proof that no execution tools exist.
const toolsetsSchema=z.object({object:z.literal('list'),platform:z.literal('api_server').optional(),data:z.array(z.object({enabled:z.boolean(),configured:z.boolean(),tools:z.array(z.string().min(1).max(200)).max(1000)})).max(500)});
export function configuredOrderTools(value:unknown){
 const {data}=toolsetsSchema.parse(value);
 return [...new Set(data.filter(v=>v.enabled&&v.configured).flatMap(v=>v.tools))].sort();
}
// Narrow positive commands only; historical and negative mentions stay optional.
const target=String.raw`(?:개발팀(?:\s*에이전트)?|dev[-_ ]lead|(?:하위|서브)\s*에이전트)`;
const imperative=String.raw`(?:해(?:\s*(?:줘|주세요|라))?|하라|하세요|해서|하여|하고)`;
const namedDelegation=new RegExp(String.raw`${target}[^.!?\n]{0,40}?(?:(?:소환|호출|위임|배정)${imperative}|맡겨(?:\s*(?:줘|주세요)|라|서)?)(?=\s|[,.!?]|$)`,'i');
const parallelDelegation=new RegExp(String.raw`(?:하위|서브)\s*에이전트(?:로|를\s*통해)\s*병렬(?:로)?\s*(?:작업|실행|진행)${imperative}(?=\s|[,.!?]|$)`,'i');
export const requiresNativeDelegation=(instruction:string)=>namedDelegation.test(instruction)||parallelDelegation.test(instruction);
export function assertOrderToolCapabilities(mode:'native'|'research'|'workflow',instruction:string,caps:{tools:readonly string[];discoveryError:string}){
 if(caps.discoveryError||mode==='research')return;
 if(mode==='native'&&!caps.tools.length)throw new AgentError('연결된 Hermes 프로필에 활성화되고 설정된 실행 도구가 없습니다. 코드 수정이나 에이전트 호출을 시작하지 않았습니다. Hermes의 API 실행 도구 설정을 확인해 주세요.','HERMES_TOOLS_MISSING',422);
 if(requiresNativeDelegation(instruction)&&!caps.tools.includes('delegate_task'))throw new AgentError('연결된 Hermes 프로필에서 하위 에이전트 실행 도구(delegate_task)를 사용할 수 없는 것으로 확인되었습니다. 요청한 에이전트 위임은 시작하지 않았습니다. Hermes의 위임 도구 설정을 확인해 주세요.','HERMES_DELEGATION_MISSING',422);
}
