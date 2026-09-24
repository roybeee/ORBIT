import {getDatabase} from '@/db/storage';
import {owner,json,failure} from '@/lib/orbit/agent/http';
import {gotemMetrics} from '@/lib/orbit/slack/gotem-metrics';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();return json(await gotemMetrics(getDatabase(),user.id))}catch(error){return failure(error)}}
