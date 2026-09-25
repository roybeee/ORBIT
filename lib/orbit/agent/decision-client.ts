import {isConnectionError,decisionReceiptMatches} from './client-request.ts';

// One owner decision on an Orbit proposal (PATCH /api/agent). Shared by the single-card
// flow (components/orbit/agent/action-review.tsx) and the 결재함 bulk defer, so both apply
// the same lost-connection rule: ask for the action's receipt and accept the decision only
// when the receipt shows it landed.
export type Decision='approve'|'defer'|'reconsider'|'reject';
export interface DecisionResponse {refreshing?:boolean;receipt?:Parameters<typeof decisionReceiptMatches>[0]&{refreshTurnId?:string}}
export type DecisionRequest=(path:string,method?:string,body?:unknown)=>Promise<DecisionResponse>;
export interface DecisionInput {reason?:string;revisitDate?:string;overlapConfirmation?:string}

export async function sendDecision(item:{id:string},decision:Decision,input:DecisionInput,request:DecisionRequest):Promise<{refreshing?:boolean}>{
 const {reason,revisitDate,overlapConfirmation}=input;
 try{
  return await request('/api/agent','PATCH',{id:item.id,decision,...(overlapConfirmation?{overlapConfirmation}:{}),...(decision==='defer'?{reason,revisitDate}:{})});
 }catch(error){
  if(!isConnectionError(error))throw error;
  const check=await request('/api/agent?actionReceipt='+encodeURIComponent(item.id));
  const receipt=check.receipt??null;
  if(!decisionReceiptMatches(receipt,{decision,reason,revisitDate})||!receipt)throw error;
  return decision==='approve'&&receipt.refreshTurnId&&receipt.state!=='approved'?{refreshing:true}:{};
 }
}

export interface BulkResult<T> {deferred:number;failed:{item:T;message:string}[];remaining:number;stopped?:string}

// Errors about the session or the connection, not the card: continuing would only repeat them.
const SYSTEMIC=new Set(['AUTH','SESSION_CHANGED','ORIGIN']);
const MAX_FAILURES_IN_A_ROW=3;

// Defers pending cards one at a time (the server decides each card atomically) and keeps
// going after a card-level failure, but stops on a session/connection problem, after three
// failures in a row, or when the signal is aborted.
export async function deferActions<T extends {id:string;state:string}>(items:readonly T[],input:{reason:string;revisitDate:string},{request,onProgress,signal}:{request:DecisionRequest;onProgress?:(done:number,total:number)=>void;signal?:AbortSignal}):Promise<BulkResult<T>>{
 const pending=items.filter(item=>item.state==='pending');
 const result:BulkResult<T>={deferred:0,failed:[],remaining:0};
 let inARow=0;
 for(const [index,item] of pending.entries()){
  if(signal?.aborted){result.stopped='중단했습니다.';result.remaining=pending.length-index;break;}
  try{await sendDecision(item,'defer',input,request);result.deferred++;inARow=0;}
  catch(error){
   const message=error instanceof Error?error.message:'보류하지 못했습니다.';
   result.failed.push({item,message});inARow++;
   const code=(error as {code?:string})?.code;
   if(isConnectionError(error)||(code&&SYSTEMIC.has(code))||inARow>=MAX_FAILURES_IN_A_ROW){result.stopped=message;result.remaining=pending.length-index-1;onProgress?.(index+1,pending.length);break;}
  }
  onProgress?.(index+1,pending.length);
 }
 return result;
}
