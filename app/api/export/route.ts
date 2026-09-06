import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getDatabase} from '@/db/storage';
import {readWorkspace,exportWorkspace} from '@/db/repository';
export const dynamic='force-dynamic';
export async function GET(){
 const user=await getChatGPTUser();
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
 if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401,headers});
 try{const db=getDatabase(),snapshot=await readWorkspace(db,user.id);return new Response(exportWorkspace(db,user.id,snapshot),{headers:{...headers,'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="orbit-backup.json"'}})}
 catch{console.error('Orbit export unavailable');return Response.json({error:'내보내기를 완료하지 못했습니다. 다시 시도해 주세요.'},{status:503,headers})}
}
