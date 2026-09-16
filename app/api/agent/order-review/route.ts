import {getDatabase} from '@/db/storage';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {orderReviewInput,readOrderReview,saveOrderReview} from '@/lib/orbit/agent/order-review';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await owner();return json(await readOrderReview(getDatabase(),user.id,new URL(request.url).searchParams.get('id')??''))}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request),input=orderReviewInput.safeParse(await body(request,16000));if(!input.success)throw new AgentError('완료 기준과 확인한 근거를 입력해 주세요.');return json(await saveOrderReview(getDatabase(),user.id,input.data))}catch(e){return failure(e)}}
