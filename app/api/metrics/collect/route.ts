import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,json,failure} from '@/lib/orbit/agent/http';
import {collectMetrics} from '@/lib/orbit/metric-collector';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const user=await owner(request);return json(await collectMetrics(getDatabase(),user.id,env));}catch(e){return failure(e)}}
