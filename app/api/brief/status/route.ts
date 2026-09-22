import {env} from 'cloudflare:workers';
import {getDatabase} from '@/db/storage';
import {owner,json,failure} from '@/lib/orbit/agent/http';
import {planStatus} from '@/lib/orbit/brief/status';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json(await planStatus(getDatabase(),user.id,env))}catch(error){return failure(error)}}
