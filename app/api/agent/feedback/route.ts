import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {saveFeedback} from '@/lib/orbit/meetings/context';
export const dynamic='force-dynamic';
const input=z.object({turnId:z.string().min(1).max(100),kind:z.enum(['helpful','correction','outcome']),text:z.string().trim().min(1).max(2000)}).strict();
export async function GET(request:Request){try{const user=await owner(),id=new URL(request.url).searchParams.get('turnId')??'';return json(await getDatabase().prepare('SELECT kind,text,updated_at FROM orbit_answer_feedback WHERE owner_id=? AND turn_id=?').bind(user.id,id).first()??{})}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request),parsed=input.safeParse(await body(request,8000));if(!parsed.success)throw new AgentError('피드백 내용을 입력해 주세요.');await saveFeedback(getDatabase(),user.id,parsed.data.turnId,parsed.data.kind,parsed.data.text);return json({ok:true})}catch(e){return failure(e)}}
export async function DELETE(request:Request){try{const user=await owner(request),value=await body(request,1000);if(typeof value.turnId!=='string')throw new AgentError('답변을 확인해 주세요.');await getDatabase().prepare('DELETE FROM orbit_answer_feedback WHERE owner_id=? AND turn_id=?').bind(user.id,value.turnId).run();return json({ok:true})}catch(e){return failure(e)}}
