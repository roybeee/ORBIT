import {z} from 'zod';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {getDatabase} from '@/db/storage';
import {getBucket} from '@/lib/orbit/attachments/runtime';
import {restoreHistory,restoreFileContent} from '@/lib/orbit/backup-history';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const user=await owner(request),p=z.object({records:z.unknown(),operationId:z.string().uuid(),checksum:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(await body(request,10000000));return json(await restoreHistory(getDatabase(),user.id,p.records,p.operationId,p.checksum))}catch(e){return failure(e)}}
export async function PUT(request:Request){try{const user=await owner(request),id=new URL(request.url).searchParams.get('id')??'',expected=request.headers.get('x-orbit-sha256')??'';return json(await restoreFileContent(getDatabase(),getBucket(),user.id,id,expected,request))}catch(e){return failure(e)}}
