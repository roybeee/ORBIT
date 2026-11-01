import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure} from '@/lib/orbit/agent/http';
import {reviewKakao,kakaoStatus} from '@/lib/orbit/kakao/review';
import {deleteKakaoReview} from '@/lib/orbit/kakao/privacy';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json(await kakaoStatus(getDatabase(),user.id,env))}catch(error){return failure(error)}}
export async function POST(request:Request){try{const user=await owner(request);return json(await reviewKakao(getDatabase(),user.id,await body(request,120000),env))}catch(error){return failure(error)}}
export async function DELETE(request:Request){try{const user=await owner(request);return json(await deleteKakaoReview(getDatabase(),user.id,await body(request,1000)))}catch(error){return failure(error)}}
