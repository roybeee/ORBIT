import {getBucket} from '@/lib/orbit/attachments/runtime';
import {recordReadProbe} from '@/lib/orbit/release/health';
import {env} from 'cloudflare:workers';
import {releaseProbe,type ReleaseEnv} from '@/lib/orbit/release/auth';
import { APP_BUILD, APP_TREE } from '@/lib/orbit/app-version';
import { owner, json, failure } from '@/lib/orbit/agent/http';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { const probe=await releaseProbe(request,env as ReleaseEnv,APP_TREE,async()=>({build:APP_BUILD,tree:APP_TREE}),(id,path)=>recordReadProbe(getBucket(),id,path,APP_TREE));if(probe)return probe; await owner(request); return json({ build: APP_BUILD, tree: APP_TREE }); }
  catch (error) { return failure(error); }
}
