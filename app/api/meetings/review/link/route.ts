import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {linkMeetingProject} from '@/lib/orbit/meetings/link-project';
export const dynamic='force-dynamic';
const input=z.object({noteId:z.string().min(1).max(100),actionId:z.string().uuid(),projectId:z.string().min(1).max(100)}).strict();
export async function POST(request:Request){try{const user=await owner(request),parsed=input.safeParse(await body(request,1000));if(!parsed.success)throw new AgentError('연결할 프로젝트를 확인해 주세요.');return json(await linkMeetingProject(getDatabase(),user.id,parsed.data.noteId,parsed.data.actionId,parsed.data.projectId))}catch(e){return failure(e)}}
