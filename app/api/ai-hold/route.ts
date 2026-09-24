import {getDatabase} from '@/db/storage';
import {owner,json,failure} from '@/lib/orbit/agent/http';
import {aiHoldStatus} from '@/lib/orbit/agent/hold-status';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json(await aiHoldStatus(getDatabase(),user.id))}catch(error){return failure(error)}}
