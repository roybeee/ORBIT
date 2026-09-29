import {env} from 'cloudflare:workers';
import {releaseProbe,type ReleaseEnv} from '@/lib/orbit/release/auth';
import {APP_TREE} from '@/lib/orbit/app-version';
import {getDatabase} from '@/db/storage';
import {owner,json,failure} from '@/lib/orbit/agent/http';
import {gotemMetrics} from '@/lib/orbit/slack/gotem-metrics';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const probe=await releaseProbe(request,env as ReleaseEnv,APP_TREE,id=>gotemMetrics(getDatabase(),id));if(probe)return probe;const user=await owner();return json(await gotemMetrics(getDatabase(),user.id))}catch(error){return failure(error)}}
