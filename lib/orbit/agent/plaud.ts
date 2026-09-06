import type {Database} from '../../../db/repository.ts';
import {AgentError} from './errors.ts';
import {accessToken,PLAUD,type Runtime} from './integrations.ts';

type McpTool={name:string;description?:string;inputSchema:Record<string,unknown>;annotations?:{readOnlyHint?:boolean;destructiveHint?:boolean}};
const knownReads=new Set(['list_files','get_file','get_note','get_transcript','get_current_user']);
const isRead=(tool:McpTool)=>tool.annotations?.destructiveHint!==true&&tool.annotations?.readOnlyHint!==false&&(tool.annotations?.readOnlyHint===true||knownReads.has(tool.name));
// A dedicated Streamable HTTP client. Tokens only go to the pinned Plaud host.
// Server requests (sampling, roots, elicitation) are never executed by Orbit.
async function session(db:Database,owner:string,env:Runtime){
 const token=await accessToken(db,owner,'plaud',env);let sessionId='',version='2025-03-26';
 async function rpc(method:string,params:unknown,notification=false):Promise<any>{
  const id=crypto.randomUUID(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetch(PLAUD.server,{method:'POST',redirect:'manual',cache:'no-store',signal:controller.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(sessionId?{'Mcp-Session-Id':sessionId}:{}),...(method==='initialize'?{}:{'MCP-Protocol-Version':version})},body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,params})});
   if(!response.ok)throw new AgentError(response.status===401?'Plaud 연결이 만료됐습니다. 연결에서 다시 승인해 주세요.':'Plaud 기록 조회에 실패했습니다. 연결을 확인하고 다시 요청해 주세요.','PLAUD_MCP',502);
   if(notification){await response.body?.cancel();return {}}
   const sid=response.headers.get('Mcp-Session-Id');if(sid&&sid.length<=512)sessionId=sid;
   if(!response.body)throw new Error('empty');
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',size=0;
   const sse=response.headers.get('content-type')?.includes('text/event-stream');
   const result=(message:any)=>{if(message?.jsonrpc!=='2.0'||message.id!==id)return undefined;if(message.error||!('result' in message))throw new AgentError('Plaud가 기록을 반환하지 못했습니다. 녹음 범위와 접근 권한을 확인해 주세요.','PLAUD_MCP',502);return message.result};
   try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>900000)throw new AgentError('Plaud 기록이 너무 큽니다. 회의를 하나씩 요청해 주세요.','PLAUD_SIZE',422);buffer+=decoder.decode(value,{stream:true});
     if(sse){buffer=buffer.replaceAll('\r\n','\n');let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')continue;const match=result(JSON.parse(data));if(match!==undefined)return match;}}
    }
    if(!sse){const match=result(JSON.parse(buffer));if(match!==undefined)return match;}
    throw new Error('missing response');
   }finally{await reader.cancel().catch(()=>{})}
  }catch(error){if(error instanceof AgentError)throw error;throw new AgentError(controller.signal.aborted?'Plaud 조회 시간이 초과됐습니다. 회의를 하나씩 요청해 주세요.':'Plaud 응답을 읽지 못했습니다. 다시 요청해 주세요.','PLAUD_MCP',502)}finally{clearTimeout(timer)}
 }
 const initialized=await rpc('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'Orbit',version:'0.5.0'}});
 if(!['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(initialized.protocolVersion))throw new AgentError('Plaud 연결 규격을 확인할 수 없습니다.','PLAUD_MCP',502);
 version=initialized.protocolVersion;await rpc('notifications/initialized',{},true);
 async function list(){let cursor:string|undefined;const catalog:McpTool[]=[];for(let page=0;page<5;page++){const data=await rpc('tools/list',cursor?{cursor}:{});if(!Array.isArray(data.tools)||data.tools.length>100)throw new AgentError('Plaud 조회 도구를 확인하지 못했습니다.','PLAUD_MCP',502);catalog.push(...data.tools.filter((t:any)=>typeof t.name==='string'&&t.inputSchema&&isRead(t)));if(!data.nextCursor)return catalog;cursor=data.nextCursor}throw new AgentError('Plaud 조회 도구 목록이 너무 큽니다.','PLAUD_MCP',502)}
 return {rpc,list};
}
export async function plaudTools(db:Database,owner:string,env:Runtime){const client=await session(db,owner,env);return (await client.list()).map(t=>({name:t.name,description:t.description?.slice(0,2000),inputSchema:t.inputSchema}))}
export async function plaudRead(db:Database,owner:string,env:Runtime,name:string,args:Record<string,unknown>){
 const client=await session(db,owner,env),catalog=await client.list();
 if(!catalog.some(t=>t.name===name))throw new AgentError('Plaud의 확인된 읽기 도구만 사용할 수 있습니다.','PLAUD_READ_ONLY',422);
 const data=await client.rpc('tools/call',{name,arguments:args});
 if(data.isError)throw new AgentError('Plaud 기록을 찾지 못했습니다. 녹음 번호와 조회 범위를 확인해 주세요.','PLAUD_MCP',422);
 // No embedded resources, executable instructions, audio downloads or arbitrary URL fetches.
 return {content:(data.content??[]).filter((c:any)=>c.type==='text').map((c:any)=>({type:'text',text:c.text})),...(data.structuredContent?{structuredContent:data.structuredContent}:{})};
}
