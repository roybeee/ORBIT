import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getDatabase} from '@/db/storage';
import {readNote,listNoteHistory,searchNotes,NoteNotFound,RevisionConflict} from '@/db/repository';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function GET(request:Request){
 const user=await getChatGPTUser();if(!user)return response({error:'로그인이 필요합니다.'},401);
 const params=new URL(request.url).searchParams,id=params.get('id'),revision=params.get('revision'),before=params.get('before');
 if(!id){const query=params.get('q')??'',kind=params.get('kind')??'wiki',offset=Number(params.get('offset')??0),expected=params.get('workspaceRevision');if(query.length>200||!['wiki','knowledge'].includes(kind)||!Number.isSafeInteger(offset)||offset<0||offset>100000||(expected!==null&&(!/^\d+$/.test(expected)||!Number.isSafeInteger(Number(expected)))))return response({error:'검색 조건을 확인해 주세요.'},400);try{return response(await searchNotes(getDatabase(),user.id,{query,kind:kind as 'wiki'|'knowledge',offset,expectedRevision:expected===null?undefined:Number(expected)}))}catch(error){if(error instanceof RevisionConflict)return response({error:error.message},409);console.error('Orbit note search unavailable');return response({error:'검색을 완료하지 못했습니다. 다시 시도해 주세요.'},503)}}
 if(id.length>100||[revision,before].some(v=>v!==null&&(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<1)))return response({error:'기록 주소를 확인해 주세요.'},400);
 try{return response(params.get('history')==='1'?await listNoteHistory(getDatabase(),user.id,id,before?Number(before):undefined):await readNote(getDatabase(),user.id,id,revision?Number(revision):undefined))}
 catch(error){if(error instanceof NoteNotFound)return response({error:error.message},404);console.error('Orbit note read unavailable');return response({error:'기록을 불러오지 못했습니다. 다시 시도해 주세요.'},503)}
}
