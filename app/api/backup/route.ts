import {z} from 'zod';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getDatabase} from '@/db/storage';
import {getBucket} from '@/lib/orbit/attachments/runtime';
import {readWorkspace,RevisionConflict} from '@/db/repository';
import {DomainError} from '@/lib/orbit/reducer';
import {backupArchive} from '@/lib/orbit/backup-export';
import {previewRestore,restoreContent,selectionSchema,digest} from '@/lib/orbit/backup';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
const response=(body:unknown,status=200)=>Response.json(body,{status,headers});
export async function GET(){const user=await getChatGPTUser();if(!user)return response({error:'로그인이 필요합니다.'},401);try{return new Response(await backupArchive(getDatabase(),user.id,getBucket()),{headers:{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="orbit-full-backup.zip"'}})}catch{return response({error:'백업을 만들지 못했습니다. 원문과 첨부 상태를 확인한 뒤 다시 시도해 주세요.'},503)}}
const inputSchema=z.object({action:z.enum(['preview','restore']),payload:z.unknown(),checksum:z.string().regex(/^[a-f0-9]{64}$/),selection:selectionSchema,expectedRevision:z.number().int().nonnegative(),operationId:z.string().uuid()}).strict();
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return response({error:'로그인이 필요합니다.'},401);
 const expected=request.headers.get('x-orbit-owner');if(expected&&expected!==user.id)return response({error:'로그인 계정이 변경됐습니다.'},409);
 if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin))return response({error:'요청 출처를 확인해 주세요.'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return response({error:'입력 형식을 확인해 주세요.'},415);
 try{const bytes=await request.arrayBuffer();if(bytes.byteLength>26000000)return response({error:'복원 자료는 25MB 이내여야 합니다.'},413);const parsed=inputSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));if(!parsed.success)return response({error:'복원 요청을 확인해 주세요.'},400);const input=parsed.data;
 if(await digest(input.payload)!==input.checksum)throw new DomainError('백업 검증값이 다릅니다. 원본 파일을 사용해 주세요.');
 const db=getDatabase();if(input.action==='preview'){const snapshot=await readWorkspace(db,user.id);if(snapshot.revision!==input.expectedRevision)throw new RevisionConflict('기록이 변경됐습니다. 새로고침 후 다시 검토하세요.');const plan=previewRestore(snapshot.data,input.payload,input.selection);return response({usage:plan.usage,inserted:plan.inserted,kept:plan.conflicts.length,dependencies:plan.dependencies,revision:snapshot.revision});}
 return response(await restoreContent(db,user.id,input.payload,input.selection,input.expectedRevision,input.operationId,input.checksum));
 }catch(e){if(e instanceof DomainError||e instanceof RevisionConflict)return response({error:e.message},e instanceof RevisionConflict?409:422);console.error('Backup request failed');return response({error:'복구 완료를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.'},503);}
}
