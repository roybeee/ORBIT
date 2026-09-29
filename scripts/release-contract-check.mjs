import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {contract,schemaChecks} from '../lib/orbit/release/contract.ts';
export async function checkRelease({phase,tree,deploymentId,publishedAt,env=process.env,fetcher=fetch,required=contract}){
 const base=env.ORBIT_APP_URL??'https://orbit-personal-os.hflameb.chatgpt.site';
 const url=new URL(base);if(url.origin!==base||url.protocol!=='https:'||!url.hostname.endsWith('.chatgpt.site'))throw new Error('Invalid release origin');
 if(!/^[a-f0-9]{64}$/.test(env.ORBIT_RELEASE_CONTRACT_TOKEN??'')||!env.ORBIT_SITES_BEARER)throw new Error('Release probe credentials required');
 const headers={Authorization:'Bearer '+env.ORBIT_RELEASE_CONTRACT_TOKEN,'OAI-Sites-Authorization':'Bearer '+env.ORBIT_SITES_BEARER,'Content-Type':'application/json'};
 const response=await fetcher(base+'/api/release-health',{redirect:'error',signal:AbortSignal.timeout(60000),headers,...(phase==='verify'?{method:'POST',body:JSON.stringify({tree,deploymentId,publishedAt})}:{})});
 let data;try{data=await response.json()}catch{throw new Error('Release endpoint returned non-JSON')}
 if(phase==='preflight'){
  if(!response.ok||!data.inventory)throw new Error('Preflight unavailable: HTTP '+response.status);
  const checks=schemaChecks(data.inventory,required);return {phase,status:checks.every(c=>c.status==='passed')?'passed':'blocked',checks};
 }
 if(!response.ok&&response.status!==409)throw new Error('Release verification failed: HTTP '+response.status);
 if(!Array.isArray(data.checks)||data.tree!==tree||data.deploymentId!==deploymentId||data.publishedAt!==publishedAt)throw new Error('Release evidence mismatch');
 const requiredIds=['tree','publication','service-owner','migrations','hermes',...Object.keys(required.tables).map(t=>'table:'+t),...required.probes.map(p=>'api:'+p)];
 const verified=requiredIds.every(id=>data.checks.some(c=>c.id===id&&c.status==='passed'))&&data.status==='verified'&&data.checks.length>0&&data.checks.every(c=>c.status==='passed');
 return {...data,status:verified?'verified':data.status==='failed'?'failed':'pending'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [phase,tree]=process.argv.slice(2);
 if(!['preflight','verify'].includes(phase)){console.error('Usage: node --experimental-strip-types scripts/release-contract-check.mjs preflight|verify <tree>');process.exitCode=1;}
 else try{const required=process.env.ORBIT_RELEASE_CONTRACT_FILE?JSON.parse(readFileSync(process.env.ORBIT_RELEASE_CONTRACT_FILE,'utf8')):contract;const result=await checkRelease({phase,tree,required,deploymentId:process.env.ORBIT_DEPLOYMENT_ID,publishedAt:process.env.ORBIT_PUBLISHED_AT});const output=JSON.stringify(result,null,2)+'\n';console.log(output);if(process.env.ORBIT_RELEASE_REPORT_PATH)writeFileSync(process.env.ORBIT_RELEASE_REPORT_PATH,output,{mode:0o600});process.exitCode=['passed','verified'].includes(result.status)?0:1;}catch{console.error('Release contract check blocked: credentials, endpoint, timeout or evidence unavailable. No promotion.');process.exitCode=1;}
}
