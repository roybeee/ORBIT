import {requestOwnerHeaders} from '../request-owner.ts';
import {AgentRequestError} from './approval-feedback.ts';
export class ConnectionError extends AgentRequestError {
 retryable=true;
 constructor(message:string,code='TRANSPORT'){super(message,code)}
}
export const uncertainDelivery=(error:unknown)=>!!(error&&typeof error==='object'&&'deliveryUncertain' in error);
export const isConnectionError=(error:unknown)=>error instanceof ConnectionError;
export const connectionMessage=(offline=false)=>offline?'인터넷 연결이 끊겼습니다. 연결되면 저장된 요청을 이어서 확인합니다.':'연결을 다시 확인하고 있습니다. 입력한 내용과 접수된 요청은 유지됩니다.';
export function requestSession(){
 const owner=JSON.stringify(requestOwnerHeaders());
 return ()=>{if(JSON.stringify(requestOwnerHeaders())!==owner)throw new AgentRequestError('사용 계정이 변경되었습니다. 현재 계정에서 대화를 다시 열어 주세요.','SESSION_CHANGED')};
}
export function scopedRequest(request=clientRequest,valid:()=>void=()=>{}){
 const check=requestSession();
 return async(path:string,method='GET',body?:unknown)=>{check();valid();try{const result=await request(path,method,body);check();valid();return result}catch(error){check();valid();throw error}};
}
export async function clientRequest(path:string,method='GET',body?:unknown,options:{fetcher?:typeof fetch;pause?:(ms:number)=>Promise<void>;timeout?:number}={}){
 const check=requestSession(),ownerHeaders=requestOwnerHeaders(),encoded=body===undefined?undefined:JSON.stringify(body),safe=method==='GET'||path==='/api/agent/run'&&method==='POST'&&(body as {action?:string})?.action==='poll';
 const fetcher=options.fetcher??fetch,pause=options.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 for(let attempt=0;;attempt++){
  if(JSON.stringify(requestOwnerHeaders())!==JSON.stringify(ownerHeaders))throw new AgentRequestError('사용 계정이 변경되었습니다. 현재 계정에서 대화를 다시 열어 주세요.','SESSION_CHANGED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeout??(path.startsWith('/api/agent/orders')?150000:path==='/api/integrations/sync'?65000:45000));
  try{
   const response=await fetcher(path,{method,signal:controller.signal,credentials:'same-origin',cache:'no-store',headers:{...ownerHeaders,...(encoded!==undefined?{'Content-Type':'application/json'}:{})},...(encoded!==undefined?{body:encoded}:{})});
   check();
   if([502,503,504].includes(response.status))throw new ConnectionError(connectionMessage());
   if(response.redirected||[401,403].includes(response.status))throw new AgentRequestError('로그인을 다시 확인해 주세요. 작성한 내용은 이 기기에 보관되어 있습니다.','AUTH');
   if(response.headers.get('content-type')?.includes('text/html'))throw new ConnectionError(connectionMessage());
   let data;try{data=await response.json()}catch{throw new ConnectionError(connectionMessage())}
   check();
   if(!response.ok){if([502,503,504].includes(response.status))throw new ConnectionError(data.error??connectionMessage(),data.code??'TRANSPORT');throw new AgentRequestError(data.error??'요청을 완료하지 못했습니다.',data.code,data.details)}
   return data;
  }catch(error){
   check();
   const failure=error instanceof AgentRequestError?error:new ConnectionError(connectionMessage(typeof navigator!=='undefined'&&navigator.onLine===false),controller.signal.aborted?'TIMEOUT':'TRANSPORT');
   if(!safe||!isConnectionError(failure)||attempt>=1||typeof navigator!=='undefined'&&navigator.onLine===false)throw failure;
   await pause(500*(attempt+1));
  }finally{clearTimeout(timer)}
 }
}
export interface MessageEnvelope {id:string;conversationId:string;message:string;attachmentIds:string[]}
export interface TurnReceipt {id:string;conversationId:string;input:string;attachmentIds:string[];status:'running'|'completed'|'failed'}
export function matchesReceipt(envelope:MessageEnvelope,receipt:TurnReceipt){return envelope.id===receipt.id&&envelope.conversationId===receipt.conversationId&&envelope.message===receipt.input&&JSON.stringify(envelope.attachmentIds)===JSON.stringify(receipt.attachmentIds)}
// A read-only lookup distinguishes an absent request from a stored failed run.
// A stored failed run is acknowledged here; rerunning it needs an explicit user retry.
export async function reconcileMessage(envelope:MessageEnvelope,request=clientRequest){
 request=scopedRequest(request);
 const {receipt}=await request('/api/agent?receipt='+encodeURIComponent(envelope.id)) as {receipt:TurnReceipt|null};
 if(receipt&&!matchesReceipt(envelope,receipt))throw new AgentRequestError('저장된 메시지의 내용을 확인해 주세요.','CONFLICT');
 return receipt;
}
export async function deliverMessage(envelope:MessageEnvelope,request=clientRequest,retryFailed=false){
 request=scopedRequest(request);
 try{return await request('/api/agent','POST',{...envelope,...(retryFailed?{retryFailed:true}:{})})}catch(error){
  if(!isConnectionError(error))throw error;
  try{const receipt=await reconcileMessage(envelope,request);
   if(receipt)return {ok:true,status:receipt.status};
   // Confirmed absence permits one ordinary resubmission of the same envelope.
   return await request('/api/agent','POST',envelope);
  }catch(failure){if(failure&&typeof failure==='object')Object.assign(failure,{deliveryUncertain:true});throw failure}
 }
}

export function decisionReceiptMatches(receipt:{state:string;note:string;revisitDate:string|null;refreshTurnId?:string;refreshStatus?:string}|null,input:{decision:string;reason?:string;revisitDate?:string}){
 if(!receipt)return false;
 if(input.decision==='approve')return receipt.state==='approved'||receipt.state==='pending'&&!!receipt.refreshTurnId&&receipt.refreshStatus==='running';
 if(input.decision==='defer')return receipt.state==='deferred'&&receipt.note===(input.reason?.trim()??'')&&receipt.revisitDate===input.revisitDate;
 return receipt.state===(input.decision==='reject'?'rejected':'pending')&&receipt.note===''&&receipt.revisitDate===null;
}
