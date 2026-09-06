import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {fileIds,filesByIds,publicFile,listFiles,prepareUpload,uploadSchema,removeFile} from '@/lib/orbit/attachments/storage';
import {getBucket} from '@/lib/orbit/attachments/runtime';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await owner(),query=new URL(request.url).searchParams,ids=query.get('ids'),type=query.get('type'),id=query.get('id');if(ids){const parsed=fileIds.safeParse(ids.split(','));if(!parsed.success)throw new AgentError('첨부파일 번호를 확인해 주세요.');return json({items:(await filesByIds(getDatabase(),user.id,parsed.data)).map(publicFile)})}if(type&&((type!=='turn'&&type!=='event')||!id||id.length>100))throw new AgentError('첨부할 위치를 확인해 주세요.');return json({items:await listFiles(getDatabase(),user.id,type&&id?{type:type as 'turn'|'event',id}:undefined)})}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request);getBucket();const parsed=uploadSchema.safeParse(await body(request,2000));if(!parsed.success)throw new AgentError('파일 이름과 크기를 확인해 주세요.');return json(await prepareUpload(getDatabase(),user.id,parsed.data))}catch(e){return failure(e)}}
export async function DELETE(request:Request){try{const user=await owner(request),input=await body(request,500);if(!fileIds.safeParse([input.id]).success)throw new AgentError('파일 번호를 확인해 주세요.');await removeFile(getDatabase(),getBucket(),user.id,input.id);return json({ok:true})}catch(e){return failure(e)}}
