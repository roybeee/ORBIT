import {env} from 'cloudflare:workers';
import {APP_TREE} from '@/lib/orbit/app-version';
import {getDatabase} from '@/db/storage';
import {getBucket} from '@/lib/orbit/attachments/runtime';
import {owner,body,json,failure,AgentError} from '@/lib/orbit/agent/http';
import {machineOwner,type ReleaseEnv} from '@/lib/orbit/release/auth';
import {contract,schemaInventory,schemaChecks,hermesCheck,type HermesEvidence} from '@/lib/orbit/release/contract';
import {runHealth,readEvidence,currentReport,type Report} from '@/lib/orbit/release/health';
export const dynamic='force-dynamic';
const runtime=()=>env as typeof env & ReleaseEnv;
async function principal(request:Request){
 if(request.headers.has('authorization')){const id=await machineOwner(request,runtime());if(!id)throw new AgentError('Unauthorized','AUTH',401);return id;}
 return (await owner(request)).id;
}
export async function GET(request:Request){try{
 const id=await principal(request),db=getDatabase();
 const inventory=await schemaInventory(db);
 const last=await readEvidence<Report>(getBucket(),id,'latest').catch(()=>null);
 const current=currentReport(last,APP_TREE),checks=[...schemaChecks(inventory),hermesCheck(await readEvidence<HermesEvidence>(getBucket(),id,'hermes').catch(()=>null))];
 // Never preserve an old green state after observable schema drift.
 if(checks.some(c=>c.status!=='passed'))current.status=checks.some(c=>c.status==='failed')?'failed':'pending';
 return json({...current,tree:APP_TREE,contract,inventory,schemaChecks:checks});
}catch(e){return failure(e)}}
export async function POST(request:Request){try{
 const id=await principal(request),input=await body(request,1000);
 const last=await readEvidence<Report>(getBucket(),id,'latest').catch(()=>null);
 const evidence={tree:typeof input.tree==='string'?input.tree:APP_TREE,deploymentId:typeof input.deploymentId==='string'?input.deploymentId:last?.tree===APP_TREE?last.deploymentId:'',publishedAt:typeof input.publishedAt==='string'?input.publishedAt:last?.tree===APP_TREE?last.publishedAt:''};
 const result=await runHealth(getDatabase(),getBucket(),id,runtime(),APP_TREE,evidence,'https://orbit-personal-os.hflameb.chatgpt.site');
 return json(result,result.status==='verified'?200:409);
}catch(e){return failure(e)}}
