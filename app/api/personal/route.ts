import {getDatabase} from '@/db/storage';
import {owner,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {personalRecordStats,searchPersonalConversations} from '@/lib/orbit/agent/personal-records';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await owner(),q=new URL(request.url).searchParams.get('q');if(q!==null&&q.length>200)throw new AgentError('검색어를 200자 이내로 입력해 주세요.');return json(q===null?await personalRecordStats(getDatabase(),user.id):{items:await searchPersonalConversations(getDatabase(),user.id,q)});}catch(error){return failure(error)}}
