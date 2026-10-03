import {env} from 'cloudflare:workers';
import {owner,json,failure,body} from '@/lib/orbit/agent/http';
import {organizeCapture} from '@/lib/orbit/capture-organize';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{await owner(request);return json(await organizeCapture(env,await body(request,20000)))}catch(error){return failure(error)}}
