import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {tickRuntime} from '@/lib/orbit/daily-runtime';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const runtime=env as typeof env & {ORBIT_RUNTIME_KEY?:string;ORBIT_RUNTIME_OWNER?:string};const key=runtime.ORBIT_RUNTIME_KEY,owner=runtime.ORBIT_RUNTIME_OWNER,provided=request.headers.get('x-orbit-runtime-key')??'';
 if(!key||!owner||provided.length>200)return Response.json({error:'Unauthorized'},{status:401});
 const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const a=await hash(key),b=await hash(provided);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];if(diff)return Response.json({error:'Unauthorized'},{status:401});
 try{return Response.json(await tickRuntime(getDatabase(),owner,env),{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'Tick failed'},{status:503});}
}
