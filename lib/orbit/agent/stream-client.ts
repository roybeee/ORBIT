import {requestSession} from './client-request.ts';
import {requestOwnerHeaders} from '../request-owner.ts';
export interface RunProgress {id:string;status:'running'|'completed'|'failed';progress:string;error?:string}

// Never pass provider JSON or unvalidated proposal text through the progress channel.
export async function watchAgent(id:string,signal:AbortSignal,onProgress:(progress:RunProgress)=>void){
 const check=requestSession();
 const response=await fetch('/api/agent/stream',{method:'POST',credentials:'same-origin',cache:'no-store',signal,headers:{...requestOwnerHeaders(),'Content-Type':'application/json'},body:JSON.stringify({id})});
 check();
 if(!response.ok||!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))throw new Error('진행 상태를 다시 확인합니다.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
 try{while(true){const {done,value}=await reader.read();check();if(done)break;pending+=decoder.decode(value,{stream:true}).replace(/\r/g,'');if(pending.length>65536)throw new Error('진행 상태를 다시 확인합니다.');let at;
  while((at=pending.indexOf('\n\n'))>=0){const event=pending.slice(0,at);pending=pending.slice(at+2);if(!event.startsWith('event: progress\n'))continue;const raw=event.split('\n').filter(line=>line.startsWith('data: ')).map(line=>line.slice(6)).join('\n');let item;try{item=JSON.parse(raw)}catch{continue}
   if(item.id===id&&['running','completed','failed'].includes(item.status)&&typeof item.progress==='string')onProgress({id,status:item.status,progress:item.progress.slice(0,1500),...(typeof item.error==='string'?{error:item.error.slice(0,1500)}:{})});
  }
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
