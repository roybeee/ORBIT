import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,body,json,failure} from '@/lib/orbit/agent/http';
import {configureKakaoModel,kakaoModelSettings,disconnectKakaoModel} from '@/lib/orbit/kakao/settings';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json(await kakaoModelSettings(getDatabase(),user.id))}catch(error){return failure(error)}}
export async function POST(request:Request){try{const user=await owner(request);return json(await configureKakaoModel(getDatabase(),user.id,await body(request,2000),env))}catch(error){return failure(error)}}
export async function DELETE(request:Request){try{const user=await owner(request);return json(await disconnectKakaoModel(getDatabase(),user.id))}catch(error){return failure(error)}}
