import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {getDatabase} from '@/db/storage';
import {owner,body,failure,AgentError} from '@/lib/orbit/agent/http';
import {agentProgress,driveAgent} from '@/lib/orbit/agent/driver';
export const dynamic='force-dynamic';

export async function POST(request:Request){try{
 const user=await owner(request),input=z.object({id:z.string().uuid()}).strict().safeParse(await body(request,1000));
 if(!input.success)throw new AgentError('실행할 대화를 확인해 주세요.');
 const db=getDatabase(),id=input.data.id,initial=await agentProgress(db,user.id,id),encoder=new TextEncoder();
 let closed=false;
 const stream=new ReadableStream<Uint8Array>({
  async start(controller){
   const emit=(event:string,value:unknown)=>{if(closed||request.signal.aborted)return;try{controller.enqueue(encoder.encode('event: '+event+'\ndata: '+JSON.stringify(value)+'\n\n'))}catch{closed=true}};
   const started=Date.now();let latest=initial;
   const update=async()=>{latest=await agentProgress(db,user.id,id);emit('progress',latest)};
   const heartbeat=setInterval(()=>emit('heartbeat',{}),5000);
   try{
    emit('progress',initial);
    while(!closed&&!request.signal.aborted&&latest.status==='running'&&Date.now()-started<22000){
     await driveAgent(db,user.id,id,env,{maxMs:Math.max(1,22000-(Date.now()-started)),onStep:update});
     await update();
     if(latest.status==='running'&&!closed&&!request.signal.aborted)await new Promise(resolve=>setTimeout(resolve,1200));
    }
   }catch(error){await update().catch(()=>{});emit('issue',{message:error instanceof AgentError?error.message:'진행 상태 연결이 잠시 끊겼습니다. 다시 확인합니다.'})}
   finally{clearInterval(heartbeat);if(!closed){try{controller.close()}catch{}}closed=true}
  },cancel(){closed=true},
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store, no-transform','X-Accel-Buffering':'no','Vary':'Cookie'}});
}catch(error){return failure(error)}}
