import { z } from 'zod';
import type { Database } from '../../../db/repository.ts';
import { AgentError } from '../agent/errors.ts';
import type { AsideJob } from './types.ts';

const uuid = z.string().uuid();
const identity = { id: uuid, bridgeId: uuid, runId: uuid };
const operation=z.object({kind:z.enum(['send','payment','delete','submit']),destination:z.string().trim().min(3).max(1000),target:z.string().trim().min(2).max(500),content:z.string().trim().min(2).max(8000),amountKrw:z.number().int().positive().max(1000000000).optional()}).strict().refine(o=>o.kind!=='payment'||o.amountKrw!==undefined,'결제 금액이 필요합니다.');
export const asideInput = z.discriminatedUnion('action', [
  z.object({action:z.literal('enqueue'),id:uuid,title:z.string().trim().min(1).max(160),instruction:z.string().trim().min(10).max(12000),workflow:z.string().max(50),projectId:z.string().max(100),operation:operation.optional()}).strict(),
  z.object({action:z.literal('approve'),id:uuid,digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({action:z.literal('claim'),id:uuid,bridgeId:uuid,account:z.string().trim().min(1).max(150)}).strict(),
  z.object({action:z.literal('report'),...identity,seq:z.number().int().min(1).max(2147483647),status:z.enum(['running','needs_review','needs_attention']),progress:z.string().max(1000),result:z.string().max(30000)}).strict(),
  z.object({action:z.literal('cancel'),id:uuid}).strict(),
  z.object({action:z.literal('resolve'),...identity}).strict(),
  z.object({action:z.literal('complete'),id:uuid}).strict(),
]);
type Input = z.infer<typeof asideInput>;
type Row = { job_json:string; status:string; version:number };
const parse=(row:Row):AsideJob=>JSON.parse(row.job_json);
async function approvalDigest(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('')}
export async function listAsideJobs(db:Database,ownerId:string) {
  const rows=await db.prepare("SELECT job_json FROM orbit_aside_jobs WHERE owner_id=? ORDER BY CASE WHEN status IN ('running','stop_requested','needs_attention','queued','awaiting_approval') THEN 0 ELSE 1 END, created_at DESC LIMIT 100").bind(ownerId).all<Row>();
  return rows.results.map(parse);
}
export async function changeAsideJob(db:Database,ownerId:string,input:Input):Promise<AsideJob> {
  const now=new Date().toISOString();
  if(input.action==='enqueue') {
    if(input.projectId) {
      const row=await db.prepare('SELECT state_json FROM orbit_workspaces WHERE owner_id=?').bind(ownerId).first<{state_json:string}>();
      const state=row?JSON.parse(row.state_json):null;
      if(!state?.projects?.some((p:{id:string})=>p.id===input.projectId))throw new AgentError('프로젝트를 다시 선택해 주세요.','PROJECT',422);
    }
    const job:AsideJob={id:input.id,title:input.title,instruction:input.instruction,workflow:input.workflow,projectId:input.projectId,status:'queued',bridgeId:'',runId:'',account:'',seq:0,progress:'PC 연결 후 순서대로 실행합니다.',result:'',createdAt:now,updatedAt:now};
    if(input.operation){job.operation=input.operation;job.status='awaiting_approval';job.progress='대상과 내용을 확인한 뒤 이번 실행을 승인해 주세요.';job.approvalDigest=await approvalDigest({ownerId,id:job.id,title:job.title,instruction:job.instruction,operation:job.operation});}
    // INSERT and capacity check are one statement. Repeating an identical ID is idempotent.
    await db.prepare("INSERT INTO orbit_aside_jobs (owner_id,id,status,job_json,version,created_at) SELECT ?,?,?,?,0,? WHERE (SELECT COUNT(*) FROM orbit_aside_jobs WHERE owner_id=? AND status IN ('queued','awaiting_approval'))<30 ON CONFLICT(owner_id,id) DO NOTHING").bind(ownerId,job.id,job.status,JSON.stringify(job),now,ownerId).run();
    const row=await db.prepare('SELECT job_json FROM orbit_aside_jobs WHERE owner_id=? AND id=?').bind(ownerId,job.id).first<Row>();
    if(!row)throw new AgentError('대기 업무는 최대 30개입니다.','CAPACITY',409);
    const saved=parse(row);
    if(['title','instruction','workflow','projectId'].some(key=>saved[key as keyof AsideJob]!==job[key as keyof AsideJob])||JSON.stringify(saved.operation)!==JSON.stringify(job.operation))throw new AgentError('같은 작업 ID의 내용이 다릅니다.','CONFLICT',409);
    return saved;
  }
  for(let attempt=0;attempt<5;attempt++) {
    const row=await db.prepare('SELECT job_json,status,version FROM orbit_aside_jobs WHERE owner_id=? AND id=?').bind(ownerId,input.id).first<Row>();
    if(!row)throw new AgentError('업무를 찾을 수 없습니다.','NOT_FOUND',404);
    const old=parse(row), job={...old,updatedAt:now};
    let claim=false;
    if(input.action==='approve') {
      if(!old.operation||old.approvalDigest!==input.digest)throw new AgentError('승인할 업무 내용이 일치하지 않습니다.','STALE_APPROVAL',409);
      if(old.approvedAt)return old;
      if(old.status!=='awaiting_approval')throw new AgentError('현재 승인할 수 없는 업무입니다.','CONFLICT',409);
      job.approvedAt=now;job.status='queued';job.progress='표시된 외부 작업 한 건을 승인했습니다. 실행 대기 중입니다.';
    } else if(input.action==='claim') {
      if(old.status!=='queued') {
        throw new AgentError('이미 다른 실행에 배정된 업무입니다.','CONFLICT',409);
      }
      Object.assign(job,{status:'running',bridgeId:input.bridgeId,runId:crypto.randomUUID(),account:input.account,progress:'PC로 업무를 전달하고 있습니다.'});claim=true;
    } else if(input.action==='report') {
      if(old.bridgeId!==input.bridgeId||old.runId!==input.runId)throw new AgentError('실행 연결이 일치하지 않습니다.','CONFLICT',409);
      if(input.seq<=old.seq||['completed','cancelled','needs_review'].includes(old.status))return old;
      job.seq=input.seq;job.progress=input.progress;job.result=input.result;
      job.status=old.status==='needs_attention'?'needs_attention':old.status==='stop_requested'?(input.status==='running'?'stop_requested':'needs_attention'):input.status;
    } else if(input.action==='cancel') {
      if(old.status==='queued'||old.status==='awaiting_approval'){job.status='cancelled';job.progress='실행 전에 종료했습니다.';}
      else if(old.status==='running'){job.status='stop_requested';job.progress='PC에 중지를 요청했습니다. ASIDE 화면에서 실제 작업 상태를 확인해 주세요.';}
      else return old;
    } else if(input.action==='resolve') {
      if(old.bridgeId!==input.bridgeId||old.runId!==input.runId||!['needs_attention','stop_requested'].includes(old.status))throw new AgentError('이 PC에서 실행 상태를 먼저 확인해 주세요.','CONFLICT',409);
      job.status='cancelled';job.progress='사용자가 ASIDE 작업 종료를 확인했습니다.';
    } else {
      if(old.status==='completed')return old;
      if(old.status!=='needs_review')throw new AgentError('검토할 실행 결과가 아직 없습니다.','CONFLICT',409);
      job.status='completed';
    }
    const result=await db.prepare(`UPDATE orbit_aside_jobs SET job_json=?,status=?,version=version+1 WHERE owner_id=? AND id=? AND version=?${claim?" AND NOT EXISTS (SELECT 1 FROM orbit_aside_jobs WHERE owner_id=? AND status IN ('running','stop_requested','needs_attention'))":''}`).bind(JSON.stringify(job),job.status,ownerId,input.id,row.version,...(claim?[ownerId]:[])).run();
    if(result.meta?.changes)return job;
    if(claim)throw new AgentError('이전 실행의 완료 또는 PC 확인을 기다리고 있습니다.','BUSY',409);
  }
  throw new AgentError('업무 상태가 변경되었습니다. 다시 시도해 주세요.','CONFLICT',409);
}
