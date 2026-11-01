import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {collectReadRoom,fail} from './policy.mjs';

export const DEFAULT_ORIGIN='https://orbit-personal-os.hflameb.chatgpt.site';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS={health:'/health',scan:'/scan',stop:'/stop'};
const same=(left,right)=>Buffer.byteLength(left)===Buffer.byteLength(right)&&timingSafeEqual(Buffer.from(left),Buffer.from(right));

async function readInput(request){
 if(request.headers['content-type']?.split(';')[0]!=='application/json')throw fail('JSON 입력이 필요합니다.','CONTENT_TYPE',415);
 const chunks=[];let length=0;
 for await(const chunk of request){length+=chunk.length;if(length>1024)throw fail('입력 범위를 초과했습니다.','BODY_SIZE',413);chunks.push(chunk)}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw fail('JSON 입력을 확인해 주세요.')}
}
function validOrigin(value){
 try{const url=new URL(value);return url.origin===value&&(value===DEFAULT_ORIGIN||(url.protocol==='http:'&&url.hostname==='127.0.0.1'))}catch{return false}
}

/** Starts a browser-mediated bridge; no ORBIT credential or transcript is persisted. */
export async function createKakaoBridge({adapter,port=43128,origin=DEFAULT_ORIGIN}){
 if(!adapter||!validOrigin(origin))throw fail('연결 프로그램 설정을 확인해 주세요.');
 const token=randomBytes(32).toString('hex'),used=new Set();let active=null,closing=false;
 const health=async()=>{
  const result=await adapter.health();
  return {protocol:1,connected:result.connected===true&&result.layoutSupported!==false,mode:'manual_only',permissions:{accessibility:result.accessibility===true},active:!!active,message:result.message??'자동 방 이동은 미읽음 도착 경쟁 검증 전 비활성입니다. 현재 직접 읽은 방만 검토할 수 있습니다.'};
 };
 const server=http.createServer(async(request,response)=>{
  const send=(value,status=200)=>{response.writeHead(status,{'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Vary':'Origin'});response.end(status===204?'':JSON.stringify(value))};
  if(request.headers.host!==`127.0.0.1:${server.address().port}`||request.headers.origin!==origin)return send({error:'허용되지 않은 출처입니다.',code:'ORIGIN'},403);
  response.setHeader('Access-Control-Allow-Origin',origin);
  if(request.method==='OPTIONS'){
   if(!['GET','POST'].includes(request.headers['access-control-request-method']??'GET'))return send({error:'허용되지 않은 요청입니다.'},405);
   const headers=(request.headers['access-control-request-headers']??'').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);
   if(headers.some(value=>!['authorization','content-type'].includes(value)))return send({error:'허용되지 않은 헤더입니다.'},403);
   response.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');response.setHeader('Access-Control-Allow-Private-Network','true');return send({},204);
  }
  if(!same(request.headers.authorization??'',`Bearer ${token}`))return send({error:'연결 키를 확인해 주세요.',code:'AUTH'},401);
  try{
   const url=new URL(request.url,'http://127.0.0.1');
   if(url.search)throw fail('URL에 연결 키나 입력을 넣을 수 없습니다.');
   if(closing)throw fail('연결 프로그램이 종료 중입니다.','CLOSING',503);
   if(request.method==='GET'&&url.pathname===FIELDS.health)return send(await health());
   if(request.method!=='POST'||![FIELDS.scan,FIELDS.stop].includes(url.pathname))throw fail('지원하지 않는 요청입니다.','NOT_FOUND',404);
   const input=await readInput(request);
   if(!UUID.test(input?.id??''))throw fail('실행 번호를 확인해 주세요.');
   if(url.pathname===FIELDS.stop){
    if(Object.keys(input).some(key=>key!=='id'))throw fail('중지 입력을 확인해 주세요.');
    used.add(input.id);if(active?.id===input.id)active.controller.abort();
    return send({stopped:true,id:input.id});
   }
   if(Object.keys(input).some(key=>!['id','scope'].includes(key))||input.scope!=='current_read_room')throw fail('현재 읽은 방 검토만 지원합니다.');
   if(used.has(input.id))throw fail('이미 사용했거나 중지된 검토 번호입니다. 새 검토를 시작해 주세요.','REPLAY',409);
   if(active)throw fail('검토가 진행 중입니다. 먼저 중지하거나 완료해 주세요.','BUSY',409);
   if(used.size>=10000)throw fail('연결 프로그램을 다시 시작해 주세요.','SESSION_LIMIT',409);
   used.add(input.id);const controller=new AbortController();active={id:input.id,controller};
   const timer=setTimeout(()=>controller.abort(),25000);
   request.once('aborted',()=>controller.abort());
   try{const result=await collectReadRoom(adapter,input,new Date(),controller.signal);return send(result)}finally{clearTimeout(timer);if(active?.id===input.id)active=null}
  }catch(error){send({error:error.status?error.message:'연결 프로그램에서 검토를 완료하지 못했습니다.',code:error.code??'HELPER'},error.status??500)}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 return {token,port:server.address().port,close:async()=>{closing=true;active?.controller.abort();await new Promise(resolve=>server.close(resolve))}};
}
