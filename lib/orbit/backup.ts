import {prepareWorkspace} from '../../db/workspace-storage.ts';
import {workspaceUsage} from './storage-usage.ts';
import {storedExperimentSchema,storedContactSchema,executionRecordSchema,monthlyReportSchema} from './phase4-schema.ts';
import {z} from 'zod';
import {weeklyAllocationSchema,metricSchema,observationSchema,signalFollowupSchema,meetingRecordSchema} from './phase3-schema.ts';
import {eventSchema,projectSchema,taskSchema,noteSchema,goalSchema,preferencesSchema,improvementSchema,habitSchema,riskSchema,decisionSchema,delegationSchema,reviewDetailSchema,dateSchema} from './validation.ts';
import {validateLinks,DomainError} from './reducer.ts';
import {readWorkspace,RevisionConflict,type Database} from '../../db/repository.ts';
import type {WorkspaceData,Note} from './model.ts';
const historyDecision=z.object({at:z.string().datetime(),choice:z.string().max(2000),rationale:z.string().max(2000),alternatives:z.string().max(2000),status:z.enum(['active','revised','closed']),outcome:z.string().max(2000)}).strict();
const historyDelegation=z.object({at:z.string().datetime(),status:delegationSchema.shape.status,update:z.string().max(2000),evidence:z.string().max(2000),assignee:z.string().max(100),due:dateSchema,checkDate:dateSchema}).strict();
const noteStored=noteSchema.extend({revision:z.number().int().positive().optional(),bodyStored:z.boolean().optional(),wikiMentionIds:z.array(z.string()).max(300).optional()});
export const contentSchema=z.object({
 experiments:z.array(storedExperimentSchema).max(100).default([]),contacts:z.array(storedContactSchema).max(200).default([]),executionHistory:z.array(executionRecordSchema).max(1200).default([]),monthlyReports:z.array(monthlyReportSchema).max(24).default([]),
 weeklyAllocations:z.array(weeklyAllocationSchema).max(12).default([]),
 operatingMetrics:z.array(metricSchema.extend({updatedAt:z.string().datetime()})).max(60).default([]),
 metricObservations:z.array(observationSchema.extend({recordedAt:z.string().datetime()})).max(600).default([]),
 signalFollowups:z.array(signalFollowupSchema).max(200).default([]),meetingRecords:z.array(meetingRecordSchema).max(100).default([]),
 projects:z.array(projectSchema).max(500),tasks:z.array(taskSchema).max(3000),notes:z.array(noteStored).max(3000),
 goals:z.array(goalSchema).max(12).default([]),improvements:z.array(improvementSchema).max(40).default([]),habits:z.array(habitSchema).max(3).default([]),risks:z.array(riskSchema).max(10).default([]),
 decisions:z.array(decisionSchema.extend({createdAt:z.string().datetime(),updatedAt:z.string().datetime(),history:z.array(historyDecision).max(30)})).max(100).default([]),
 delegations:z.array(delegationSchema.extend({createdAt:z.string().datetime(),updatedAt:z.string().datetime(),history:z.array(historyDelegation).max(30)})).max(100).default([]),
 events:z.array(eventSchema.innerType().extend({google:z.object({calendarId:z.string(),eventId:z.string(),orbitEventId:z.string().optional()}).optional()}).refine(e=>e.end>e.start,'일정 시작·종료를 확인해 주세요.')).max(5000).default([]),
 reviews:z.array(z.object({id:z.string().max(100),date:dateSchema,win:z.string().max(6000),block:z.string().max(6000),energy:z.enum(['low','normal','high']),completedIds:z.array(z.string()).max(3000),updatedAt:z.string(),stats:z.object({planned:z.number(),done:z.number(),partial:z.number(),skipped:z.number(),laserMinutes:z.number(),executionRate:z.number()}).optional(),habitChecks:z.array(z.string()).optional(),highlight:z.string().optional(),hasDetail:z.boolean().optional(),carry:z.string().max(200).optional()}).strict()).max(5000).default([]),
 preferences:preferencesSchema,
});
export const categories=['experiments','contacts','executionHistory','monthlyReports','projects','tasks','notes','goals','improvements','habits','risks','decisions','delegations','events','reviews','weeklyAllocations','operatingMetrics','metricObservations','signalFollowups','meetingRecords'] as const;
export type Category=typeof categories[number];
export const categoryLabels:Record<Category,string>={experiments:'사업 실험',contacts:'사람·거래처',executionHistory:'실행 결과 이력',monthlyReports:'월간 보고서',projects:'프로젝트',tasks:'할 일',notes:'위키·회의록·지식',goals:'목표',improvements:'개선 규칙',habits:'습관',risks:'리스크',decisions:'의사결정',delegations:'위임 기록',events:'내부 일정',reviews:'회고',weeklyAllocations:'주간 배분 · 재승인 필요',operatingMetrics:'운영 지표',metricObservations:'확인한 운영 수치',signalFollowups:'운영 후속 확인',meetingRecords:'회의 결과 연결'};
export const payloadSchema=z.object({format:z.literal('orbit-backup/v2'),capturedAt:z.string().datetime(),data:contentSchema,noteHistory:z.array(noteStored).max(10000),reviewDetails:z.array(reviewDetailSchema).max(5000)}).passthrough();
export const selectionSchema=z.array(z.object({category:z.enum(categories),id:z.string().min(1).max(100)}).strict()).max(3000);
export async function digest(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('')}
export function previewRestore(current:WorkspaceData,raw:unknown,selection:z.infer<typeof selectionSchema>){
 const parsed=payloadSchema.safeParse(raw);if(!parsed.success)throw new DomainError('호환되는 백업인지 확인해 주세요. '+parsed.error.issues[0]?.path.join('.'));
 const source=parsed.data.data;for(const category of categories){const ids=source[category].map(r=>r.id);if(new Set(ids).size!==ids.length)throw new DomainError('백업에 중복된 기록 번호가 있습니다.');}
 const next=structuredClone(current),chosen=new Map<string,{category:Category;id:string}>(),conflicts:string[]=[];
 const add=(category:Category,id:string)=>{
  const key=category+':'+id;if(chosen.has(key))return;
  const existing=(current[category]??[]).find(r=>r.id===id),record=source[category].find(r=>r.id===id);
  if(!record)throw new DomainError('복원에 필요한 연결 기록이 백업에 없습니다: '+id);
  if(category==='events'&&id.startsWith('google:'))throw new DomainError('외부 캘린더 일정은 다시 동기화해 주세요.');
  chosen.set(key,{category,id});
  if(existing){conflicts.push(key);return;}
  if(category!=='executionHistory'&&'projectId'in record&&record.projectId)add('projects',record.projectId);
  if('goalId'in record&&record.goalId)add('goals',record.goalId);
  if(category==='projects'){const p=record as WorkspaceData['projects'][number];if(p.nextTaskId)add('tasks',p.nextTaskId);for(const m of p.milestones??[])for(const id of m.taskIds)add('tasks',id);}
  if(category==='goals'&&'parentId'in record&&record.parentId)add('goals',record.parentId);
  if(category!=='executionHistory'&&'taskId'in record&&record.taskId)add('tasks',record.taskId);
  if('noteId'in record&&record.noteId)add('notes',record.noteId);
  if('metricId'in record)add('operatingMetrics',record.metricId);
  if('supersedesId'in record&&record.supersedesId)add('metricObservations',record.supersedesId);
  if(category==='weeklyAllocations')for(const a of (record as NonNullable<WorkspaceData['weeklyAllocations']>[number]).allocations)add('projects',a.projectId);
  if(category==='signalFollowups'){const r=record as NonNullable<WorkspaceData['signalFollowups']>[number];add('metricObservations',r.observationId);add('metricObservations',r.baselineId);if(r.delegationId)add('delegations',r.delegationId);}
  if(category==='meetingRecords'){const r=record as NonNullable<WorkspaceData['meetingRecords']>[number];for(const id of r.taskIds)add('tasks',id);for(const id of r.delegationIds)add('delegations',id);if(r.decisionId)add('decisions',r.decisionId);}
  if(category==='contacts'){const c=record as NonNullable<WorkspaceData['contacts']>[number];for(const [ids,cat] of [[c.projectIds,'projects'],[c.noteIds,'notes'],[c.decisionIds,'decisions'],[c.delegationIds,'delegations'],[c.eventIds,'events']] as [string[],Category][])for(const id of ids)add(cat,id);}
  if(category==='tasks')for(const id of (record as WorkspaceData['tasks'][number]).dependsOn??[])add('tasks',id);
  if(category==='notes'){const n=record as Note;for(const id of [n.wiki?.parentId,...n.wiki?.links??[]].filter(Boolean) as string[])if(source.notes.some(n=>n.id===id))add('notes',id);}
  (next[category]??=[] as never).push(record as never);
 };
 for(const s of selection)add(s.category,s.id);
 // Imported tasks never resume an old timer or carry automatic plan holds.
 next.tasks=next.tasks.map(t=>current.tasks.some(o=>o.id===t.id)?t:{...t,startedAt:undefined,focus:false,focusDate:undefined,laserDate:undefined,planHoldProposalId:undefined,planHoldUntil:undefined,planHoldReason:undefined});
 next.weeklyAllocations=next.weeklyAllocations?.map(p=>current.weeklyAllocations?.some(o=>o.id===p.id)?p:{...p,active:false});
 validateLinks(next);
 const inserted=[...chosen.values()].filter(s=>!(current[s.category]??[]).some(r=>r.id===s.id));
 const history=parsed.data.noteHistory;
 for(const n of next.notes.filter(n=>inserted.some(s=>s.category==='notes'&&s.id===n.id))){
  const versions=history.filter(h=>h.id===n.id);if(new Set(versions.map(h=>h.revision??1)).size!==versions.length)throw new DomainError('문서 변경 이력이 중복되었습니다.');
  const latest=versions.find(h=>(h.revision??1)===(n.revision??1));
  if((n.bodyStored||versions.length>0)&&!latest)throw new DomainError('문서 원문이 빠진 백업입니다.');
  if(versions.some(h=>(h.revision??1)>(n.revision??1)))throw new DomainError('현재 버전보다 뒤의 문서 이력이 있습니다.');
  if(latest&&latest.body!==n.body)throw new DomainError('문서 원문과 변경 이력이 일치하지 않습니다.');
 }
 const reviewDates=next.reviews.map(r=>r.date);if(new Set(reviewDates).size!==reviewDates.length)throw new DomainError('같은 날짜의 회고가 이미 있습니다.');
 const detailDates=parsed.data.reviewDetails.map(r=>r.date);if(new Set(detailDates).size!==detailDates.length)throw new DomainError('회고 상세 날짜가 중복되었습니다.');
 for(const r of next.reviews.filter(r=>inserted.some(s=>s.category==='reviews'&&s.id===r.id)))if(r.hasDetail&&!parsed.data.reviewDetails.some(d=>d.date===r.date))throw new DomainError('회고 상세가 빠진 백업입니다.');
 const usage=workspaceUsage(next);
 return {next,usage,inserted,conflicts,dependencies:inserted.length-selection.filter(s=>inserted.some(i=>i.category===s.category&&i.id===s.id)).length,payload:parsed.data};
}
export async function restoreContent(db:Database,owner:string,raw:unknown,selection:z.infer<typeof selectionSchema>,expectedRevision:number,operationId:string,checksum:string){
 if(await digest(raw)!==checksum)throw new DomainError('백업 내용의 검증값이 일치하지 않습니다.');
 const hash=await digest({checksum,selection});const prior=await db.prepare('SELECT action_hash FROM orbit_mutations WHERE owner_id=? AND operation_id=?').bind(owner,operationId).first<{action_hash:string}>();
 if(prior){if(prior.action_hash!==hash)throw new RevisionConflict('같은 복구 번호에 다른 내용이 있습니다.');return {snapshot:await readWorkspace(db,owner),replayed:true,verified:false};}
 const snapshot=await readWorkspace(db,owner);if(snapshot.revision!==expectedRevision)throw new RevisionConflict('기록이 변경됐습니다. 복원 내용을 다시 확인해 주세요.');
 const plan=previewRestore(snapshot.data,raw,selection);if(!plan.inserted.length)throw new DomainError('새로 복원할 기록이 없습니다. 같은 번호의 기존 기록은 유지됩니다.');
 // New records must resolve to the exact historical evidence present in this account.
 for(const selected of plan.inserted){const record=(plan.next[selected.category]??[]).find(r=>r.id===selected.id);if(!record||!('noteId' in record)||!record.noteId||!('noteRevision' in record)||!record.noteRevision)continue;
  const existing=snapshot.data.notes.find(n=>n.id===record.noteId);if(!existing)continue;
  const revision=record.noteRevision as number,stored=!existing.bodyStored&&revision===(existing.revision??1)?existing:await db.prepare('SELECT note_json FROM orbit_note_revisions WHERE owner_id=? AND note_id=? AND revision=?').bind(owner,record.noteId,revision).first<{note_json:string}>().then(r=>r?JSON.parse(r.note_json) as Note:null);
  const original=plan.payload.noteHistory.find(n=>n.id===record.noteId&&(n.revision??1)===revision)??plan.payload.data.notes.find(n=>n.id===record.noteId&&(n.revision??1)===revision);
  if(!stored||!original||stored.body!==original.body||stored.title!==original.title)throw new DomainError('연결된 원문의 과거 버전이 없거나 다릅니다. 해당 기록의 근거를 먼저 확인해 주세요.');
 }
 const reserved=await db.prepare(`SELECT id FROM orbit_data_trash WHERE owner_id=? AND EXISTS(SELECT 1 FROM json_each(?) AS candidate WHERE json_extract(candidate.value,'$.category')=orbit_data_trash.category AND json_extract(candidate.value,'$.id')=orbit_data_trash.record_id) LIMIT 1`).bind(owner,JSON.stringify(plan.inserted)).first();
 if(reserved)throw new DomainError('휴지통에 보관 중인 항목이 포함되어 있습니다. 데이터 관리에서 먼저 복원해 주세요.');
 const next=plan.next,nextRevision=snapshot.revision+1,at=new Date().toISOString();next.schemaVersion=3;next.events=next.events.filter(e=>!e.id.startsWith('google:'));
 const notes=next.notes.filter(n=>plan.inserted.some(i=>i.category==='notes'&&i.id===n.id));
 next.notes=next.notes.map(n=>({...n,body:'',bodyStored:true,revision:n.revision??1}));
 const storage=prepareWorkspace(next);
 const activeGate=`NOT EXISTS(SELECT 1 FROM orbit_agent_turns WHERE owner_id=? AND status='running') AND NOT EXISTS(SELECT 1 FROM orbit_agent_actions WHERE owner_id=? AND state='applying') AND NOT EXISTS(SELECT 1 FROM orbit_calendar_exports WHERE owner_id=? AND json_extract(state_json,'$.status')='publishing' AND COALESCE(json_extract(state_json,'$.leaseUntil'),0)>?) AND NOT EXISTS(SELECT 1 FROM orbit_daily_runtime WHERE owner_id=? AND lease_until>?) AND NOT EXISTS(SELECT 1 FROM orbit_agent_orders WHERE owner_id=? AND json_extract(state_json,'$.status') NOT IN ('completed','failed','cancelled','unknown')) AND NOT EXISTS(SELECT 1 FROM orbit_aside_jobs WHERE owner_id=? AND json_extract(job_json,'$.status') IN ('queued','awaiting_approval','running','stop_requested','needs_attention'))`;
 const update=db.prepare(`INSERT INTO orbit_workspaces(owner_id,revision,state_json,mutation_id,updated_at) SELECT ?,?,?,?,? WHERE ${activeGate} ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json,mutation_id=excluded.mutation_id,updated_at=excluded.updated_at WHERE orbit_workspaces.revision=? AND ${activeGate}`).bind(owner,nextRevision,storage.stateJson,operationId,at,owner,owner,owner,Date.now(),owner,Date.now(),owner,owner,expectedRevision,owner,owner,owner,Date.now(),owner,Date.now(),owner,owner);
 const gate='EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND mutation_id=? AND revision=?)',values=[owner,operationId,nextRevision] as const;
 const statements=[update,...storage.statements(db,owner,gate,values)];
 const versions=[...snapshot.data.notes.filter(n=>!n.bodyStored),...notes.flatMap(n=>{const h=plan.payload.noteHistory.filter(h=>h.id===n.id);return h.length?h:[n]})];
 // Exact historical versions remain immutable; a collision rejects the whole batch.
 for(const n of versions)statements.push(db.prepare(`INSERT INTO orbit_note_revisions(owner_id,note_id,revision,title,note_json,updated_at) SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(owner,n.id,n.revision??1,n.title,JSON.stringify({...n,bodyStored:false,revision:n.revision??1}),at,...values));
 for(const r of plan.payload.reviewDetails.filter(r=>plan.inserted.some(i=>i.category==='reviews'&&plan.next.reviews.find(v=>v.id===i.id)?.date===r.date)))statements.push(db.prepare(`INSERT INTO orbit_reviews(owner_id,date,review_json,updated_at) SELECT ?,?,?,? WHERE ${gate} ON CONFLICT(owner_id,date) DO NOTHING`).bind(owner,r.date,JSON.stringify(r),at,...values));
 statements.push(db.prepare(`INSERT INTO orbit_mutations(owner_id,operation_id,action_hash,revision,created_at) SELECT ?,?,?,?,? WHERE ${gate}`).bind(owner,operationId,hash,nextRevision,at,...values));
 const result=await db.batch(statements);if(result[0]?.meta?.changes!==1)throw new RevisionConflict('다른 저장이나 실행이 진행 중입니다. 잠시 후 다시 확인해 주세요.');
 const verified=await readWorkspace(db,owner);
 for(const item of plan.inserted){const found=(verified.data[item.category]??[]).find(r=>r.id===item.id),wanted=(next[item.category]??[]).find(r=>r.id===item.id);if(!found||await digest(found)!==await digest(wanted))throw new Error('Restore verification failed');}
 for(const n of notes){const found=await db.prepare('SELECT note_json FROM orbit_note_revisions WHERE owner_id=? AND note_id=? AND revision=?').bind(owner,n.id,n.revision??1).first<{note_json:string}>();if(!found||JSON.parse(found.note_json).body!==n.body)throw new Error('Restore document verification failed');}
 for(const r of plan.payload.reviewDetails.filter(r=>plan.inserted.some(i=>i.category==='reviews'&&plan.next.reviews.find(v=>v.id===i.id)?.date===r.date))){const row=await db.prepare('SELECT review_json FROM orbit_reviews WHERE owner_id=? AND date=?').bind(owner,r.date).first<{review_json:string}>();if(!row||await digest(JSON.parse(row.review_json))!==await digest(r))throw new Error('Review verification failed');}
 return {snapshot:verified,verified:true,inserted:plan.inserted.length,kept:plan.conflicts.length};
}
