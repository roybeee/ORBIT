import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner} from '@/lib/orbit/agent/http';
import {finishOAuth} from '@/lib/orbit/agent/integrations';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 let query='connection_error=1';
 try{const user=await owner(),url=new URL(request.url),state=url.searchParams.get('state')??'',code=url.searchParams.get('code')??'',cookie=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('orbit_oauth_state='))?.slice('orbit_oauth_state='.length)??'';
  if(!url.searchParams.has('error')&&state.length<=200&&code.length<=4096&&code){const provider=await finishOAuth(getDatabase(),user.id,state,code,cookie,env);query='connected='+provider}
 }catch{/* Never echo authorization codes, tokens, upstream responses or error details. */}
 return new Response(null,{status:303,headers:{Location:'/?'+query+'#agent','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Set-Cookie':'orbit_oauth_state=; Path=/api/integrations/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});
}
