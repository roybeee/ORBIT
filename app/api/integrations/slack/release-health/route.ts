import {getDatabase} from '@/db/storage';
import {getBucket} from '@/lib/orbit/attachments/runtime';
import {authenticate,Failure} from '@/lib/orbit/slack/directives';
import {body} from '@/lib/orbit/agent/http';
import {contract} from '@/lib/orbit/release/contract';
import {writeEvidence} from '@/lib/orbit/release/health';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store','Vary':'Authorization'};
 try{
  const p=await authenticate(getDatabase(),request),input=await body(request,1000);
  if(typeof input.version!=='string'||!/^\d+\.\d+\.\d+$/.test(input.version)||!Array.isArray(input.hooks)||input.hooks.length>4||input.hooks.some((h:unknown)=>typeof h!=='string'||!contract.hermes.requiredHooks.includes(h)))return Response.json({error:'invalid_evidence'},{status:422,headers});
  await writeEvidence(getBucket(),p.owner_id,'hermes',{version:input.version,hooks:[...new Set(input.hooks)],checkedAt:new Date().toISOString()});
  return Response.json({status:'recorded'},{headers});
 }catch(e){return Response.json({error:'Evidence not recorded'},{status:e instanceof Failure?e.status:503,headers});}
}
