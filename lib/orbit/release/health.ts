import type {Database} from '../../../db/repository.ts';
import type {Bucket} from '../attachments/storage.ts';
import {contract,schemaInventory,schemaChecks,hermesCheck,readiness,type Check,type HermesEvidence} from './contract.ts';
import type {ReleaseEnv} from './auth.ts';
export type Evidence={tree:string;deploymentId:string;publishedAt:string};
export type Report=Evidence&{checkedAt:string;status:'verified'|'failed'|'pending';checks:Check[];elapsedSeconds:number;features:{slackRequests:boolean;gotem:boolean}};
const key=(owner:string,name:string)=>`release-health/${encodeURIComponent(owner)}/${name}.json`;
export async function readEvidence<T>(bucket:Bucket,owner:string,name:string):Promise<T|null>{const obj=await bucket.get(key(owner,name));return obj?JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())) as T:null;}
export async function writeEvidence(bucket:Bucket,owner:string,name:string,data:unknown){await bucket.put(key(owner,name),new TextEncoder().encode(JSON.stringify(data)),{httpMetadata:{contentType:'application/json'}});}
export async function runHealth(db:Database,bucket:Bucket,owner:string,env:ReleaseEnv,tree:string,evidence:Evidence,origin:string,fetcher:typeof fetch=fetch,now=Date.now()):Promise<Report>{
 let checks:Check[]=[];
 try{checks=schemaChecks(await schemaInventory(db));}catch{checks.push({id:'database',status:'blocked',reason:'DB 구조 조회 실패'});}
 try{const found=await db.prepare('SELECT owner_id FROM orbit_workspaces WHERE owner_id=?').bind(owner).first();checks.push({id:'service-owner',status:found?'passed':'failed',reason:found?'기존 소유자 작업공간 확인':'검사용 소유자 작업공간 없음'});}catch{checks.push({id:'service-owner',status:'blocked',reason:'소유자 작업공간 조회 실패'});}
 checks.push({id:'tree',status:/^[a-f0-9]{40}$/.test(tree)&&tree===evidence.tree?'passed':'failed',reason:tree===evidence.tree?'실행 소스 일치':'실행 소스 불일치 또는 unknown'});
 const validPublication=/^appgdep_[a-zA-Z0-9_]+$/.test(evidence.deploymentId)&&Number.isFinite(Date.parse(evidence.publishedAt))&&Date.parse(evidence.publishedAt)<=now;
 checks.push({id:'publication',status:validPublication?'passed':'blocked',reason:validPublication?'게시 증거 연결':'게시 ID·시각 필요'});
 let hermes:HermesEvidence|null=null;try{hermes=await readEvidence(bucket,owner,'hermes');}catch{}
 checks.push(hermesCheck(hermes,now));
 for(const path of contract.probes){
  const check:Check={id:'api:'+path,status:'blocked',reason:'검사용 서비스 자격 증명 미설정'};
  if(env.ORBIT_RELEASE_CONTRACT_TOKEN&&env.ORBIT_RELEASE_CONTRACT_OWNER===owner&&env.ORBIT_SITES_BEARER){
   try{
    const response=await fetcher(origin+path+'?release_probe=1',{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+env.ORBIT_RELEASE_CONTRACT_TOKEN,'OAI-Sites-Authorization':'Bearer '+env.ORBIT_SITES_BEARER}});
    if(!response.ok){check.status='failed';check.reason=`읽기 검사 실패 (HTTP ${response.status})`;checks.push(check);continue;}
    const data=await response.json() as {status?:string;probe?:string;tree?:string};
    const ok=response.ok&&data.status==='ok'&&data.probe===path&&data.tree===tree;
    check.status=ok?'passed':'failed';check.reason=ok?'인증된 읽기 검사 통과':`읽기 검사 실패 (HTTP ${response.status})`;
   }catch{check.status='blocked';check.reason='읽기 검사 시간 초과 또는 연결 실패';}
  }
  checks.push(check);
 }
 const pass=(ids:string[])=>ids.every(id=>checks.some(c=>c.id===id&&c.status==='passed'));
 const core=[...Object.keys(contract.tables).map(t=>'table:'+t),'service-owner','tree','publication','migrations','api:/api/version'];
 const report:Report={...evidence,tree,checkedAt:new Date(now).toISOString(),status:readiness(checks),checks,elapsedSeconds:validPublication?Math.max(0,Math.round((now-Date.parse(evidence.publishedAt))/1000)):0,features:{slackRequests:pass([...core,'table:orbit_slack_requests','api:/api/slack-requests','hermes']),gotem:pass([...core,'table:orbit_task_starts','table:orbit_gotem_sends','api:/api/gotem/metrics'])}};
 // Store only release metadata, never business records or credentials. No SQL writes/rollbacks.
 await writeEvidence(bucket,owner,'checks/'+crypto.randomUUID(),report);
 await writeEvidence(bucket,owner,'latest',report);
 return report;
}
export function currentReport(report:Report|null,tree:string,now=Date.now()){
 if(!report||report.tree!==tree||!Number.isFinite(Date.parse(report.checkedAt))||now-Date.parse(report.checkedAt)>86400000||Date.parse(report.checkedAt)>now)return {status:'pending' as const,lastCheck:report,reason:'현재 소스 검증 대기 또는 검증 시각 만료'};
 return {status:report.status,lastCheck:report,reason:''};
}
