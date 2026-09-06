import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {saveContext} from '@/lib/orbit/attachments/storage';
export const dynamic='force-dynamic';
const input=z.object({id:z.string().uuid(),text:z.string().max(12000),label:z.string().max(160)}).strict();
export async function POST(request:Request){try{const user=await owner(request),parsed=input.safeParse(await body(request,60000));if(!parsed.success)throw new AgentError('첨부 내용을 확인해 주세요.');return json(await saveContext(getDatabase(),user.id,parsed.data.id,parsed.data.text,parsed.data.label))}catch(e){return failure(e)}}
