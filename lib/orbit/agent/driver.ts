import type {Database} from '../../../db/repository.ts';
import type {Runtime} from './integrations.ts';
import {advanceAgent} from './runner.ts';
import {AgentError} from './errors.ts';

export async function agentProgress(db:Database,owner:string,id:string){
 const row=await db.prepare('SELECT status,response_json FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,id).first<{status:string;response_json:string}>();
 if(!row)throw new AgentError('대화를 찾지 못했습니다.','NOT_FOUND',404);
 const value=JSON.parse(row.response_json);
 return {id,status:row.status,progress:typeof value.progress==='string'?value.progress:'메시지를 접수했습니다.',...(typeof value.error==='string'?{error:value.error}:{})};
}
// Advance local transitions without making the browser wait for the next poll.
// An unchanged remote run, a lease or provider backoff yields immediately.
export async function driveAgent(db:Database,owner:string,id:string,env:Runtime,options:{maxMs?:number;maxSteps?:number;onStep?:()=>Promise<void>;allowExternalReads?:boolean}={}){
 const started=Date.now(),maxMs=Math.min(options.maxMs??20000,25000),maxSteps=Math.min(options.maxSteps??16,24);
 const read=()=>db.prepare('SELECT job_json,lease_until FROM orbit_hermes_jobs WHERE owner_id=? AND turn_id=?').bind(owner,id).first<{job_json:string;lease_until:number}>();
 const fingerprint=(raw:string)=>{const j=JSON.parse(raw);return JSON.stringify([j.phase,j.round,j.runId,j.reads?.length,j.attempted,j.batch?.cursor,j.batch?.stage])};
 for(let step=0;step<maxSteps&&Date.now()-started<maxMs;step++){
  const before=await read();
  if(!before){await advanceAgent(db,owner,id,env);await options.onStep?.();break;}
  if(before.lease_until>Date.now())break;
  const job=JSON.parse(before.job_json);if(job.retryAt>Date.now())break;
  if(options.allowExternalReads===false&&job.phase==='read'&&/^plaud_|^google_/.test(job.reads?.[0]?.tool??''))break;
  const remaining=maxMs-(Date.now()-started);
  if(job.provider==='openai'&&job.phase==='submit'&&remaining<3000)break;
  await advanceAgent(db,owner,id,env,false,{timeoutMs:Math.max(1000,remaining-500)});await options.onStep?.();
  const after=await read();if(!after||fingerprint(after.job_json)===fingerprint(before.job_json))break;
 }
}
