import {getDatabase} from '@/db/storage';
import {owner,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {uploadContent,contentResponse,fileIds} from '@/lib/orbit/attachments/storage';
import {getBucket} from '@/lib/orbit/attachments/runtime';
export const dynamic='force-dynamic';
function id(request:Request){const id=new URL(request.url).searchParams.get('id');if(!fileIds.safeParse([id]).success)throw new AgentError('파일 번호를 확인해 주세요.');return id!}
export async function PUT(request:Request){try{const user=await owner(request);return json(await uploadContent(getDatabase(),getBucket(),user.id,id(request),request))}catch(e){return failure(e)}}
export async function GET(request:Request){try{const user=await owner();return await contentResponse(getDatabase(),getBucket(),user.id,id(request),request)}catch(e){return failure(e)}}
