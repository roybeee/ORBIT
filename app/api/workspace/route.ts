import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getDatabase} from '@/db/storage';
import {readWorkspace,writeCommand,RevisionConflict} from '@/db/repository';
import {commandSchema} from '@/lib/orbit/validation';
import {DomainError} from '@/lib/orbit/reducer';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function GET(){
 const user=await getChatGPTUser();if(!user)return response({error:'로그인이 필요합니다.',code:'AUTH'},401);
 try{return response(await readWorkspace(getDatabase(),user.id))}catch{console.error('Orbit workspace read unavailable');return response({error:'저장된 내용을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',code:'STORAGE'},503)}
}
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return response({error:'로그인이 필요합니다.',code:'AUTH'},401);
 const origin=request.headers.get('origin');
 if((origin&&origin!==new URL(request.url).origin)||request.headers.get('sec-fetch-site')==='cross-site')return response({error:'요청 출처를 확인할 수 없습니다.',code:'ORIGIN'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return response({error:'요청 형식이 올바르지 않습니다.',code:'INPUT'},415);
 const bytes=await request.arrayBuffer();if(bytes.byteLength>400000)return response({error:'입력 내용이 너무 큽니다. 내용을 나누어 저장해 주세요.',code:'INPUT'},413);
 let parsed;try{parsed=commandSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))}catch{return response({error:'입력 내용을 확인해 주세요.',code:'INPUT'},400)}
 if(!parsed.success)return response({error:parsed.error.issues[0]?.message??'입력 내용을 확인해 주세요.',code:'INPUT'},400);
 try{return response(await writeCommand(getDatabase(),user.id,parsed.data))}
 catch(error){if(error instanceof RevisionConflict)return response({error:error.message,code:'CONFLICT'},409);if(error instanceof DomainError)return response({error:error.message,code:'INPUT'},422);console.error('Orbit workspace write unavailable');return response({error:'저장 완료를 확인하지 못했습니다. 입력 내용을 유지하고 있으니 다시 저장해 주세요.',code:'STORAGE'},503)}
}
