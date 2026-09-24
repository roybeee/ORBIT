// Plan readiness for the home strip: collection (sources + collector queues), the latest planning
// turn, the target date's published brief and the 7-day orbit_brief_runs history. Read-only,
// owner-scoped, prepared parameters, no lease. Types live in the DB-free status-model.ts.
import {readWorkspace,type Database} from '../../../db/repository.ts';
import type {WorkspaceSnapshot} from '../model.ts';
import {runtimeStatus,eveningDue} from '../daily-runtime.ts';
import {activityStatus} from '../agent/activity.ts';
import type {Runtime} from '../agent/integrations.ts';
import {todayInZone,addDays} from '../dates.ts';
import {briefMessage} from './schema.ts';
import {readBriefRun,listBriefRuns} from './runs.ts';
import {MORNING_HOUR,localStamp,type PlanStatus,type RunSummary} from './status-model.ts';

type Collection=PlanStatus['collection'];
type Pending=Collection['pending'];
type Analysis=PlanStatus['analysis'];
type Plan=PlanStatus['plan'];
type RuntimeSummary=Awaited<ReturnType<typeof runtimeStatus>>;
type PlaudState={queue?:unknown;failed?:unknown;lastSync?:unknown};
type TurnRow={id:string;status:string;response_json:string;created_at:string;updated_at:string};

const SOURCE_LABELS:Record<string,string>={google_calendar:'Google 일정',google_mail:'Gmail',plaud:'Plaud 원문',hermes_activity:'Hermes 대화 기록'};
const ENERGIES=['low','normal','high'] as const;
const PLANNING_PREFIX='원페이지 실행 제안 · %';

function parseJson(text:string|null|undefined):Record<string,unknown>{
 try{const value=JSON.parse(text??'');return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}catch{return {}}
}
function parseMetrics(text:string|null|undefined):RunSummary|null{
 const value=parseJson(text);
 return typeof value.leaves==='number'&&typeof value.posts==='number'?value as unknown as RunSummary:null;
}
// History rows omit the (possibly long) list of changed keys; counts stay.
function summarize(metrics:RunSummary|null):RunSummary|null{
 return metrics?{...metrics,changes:{...metrics.changes,keys:[]}}:null;
}
function maxIso(values:(string|null|undefined)[]):string|null{
 return values.reduce<string|null>((max,value)=>value&&(!max||value>max)?value:max,null);
}
async function count(db:Database,sql:string,params:(string|number)[]):Promise<number>{
 const row=await db.prepare(sql).bind(...params).first<{n:number}>();
 return Number(row?.n??0);
}

async function plaudState(db:Database,owner:string):Promise<{queue:number;failed:number;lastSync:string|null}>{
 const row=await db.prepare('SELECT state_json FROM orbit_plaud_sync WHERE owner_id=?').bind(owner).first<{state_json:string}>();
 const state:PlaudState=row?parseJson(row.state_json):{};
 return {queue:Array.isArray(state.queue)?state.queue.length:0,failed:Array.isArray(state.failed)?state.failed.length:0,lastSync:typeof state.lastSync==='string'?state.lastSync:null};
}

async function collection(db:Database,owner:string,runtime:RuntimeSummary):Promise<Collection>{
 const sources:Collection['sources']=runtime.sources.filter(s=>Object.hasOwn(SOURCE_LABELS,s.provider))
  .map(s=>({provider:s.provider,label:SOURCE_LABELS[s.provider],state:s.state,detail:s.detail,attemptedAt:s.attemptedAt,...(s.succeededAt?{succeededAt:s.succeededAt}:{})}));
 const [plaud,activity,plaudImports,meetingReviews]=await Promise.all([
  plaudState(db,owner),
  activityStatus(db,owner),
  count(db,"SELECT count(*) AS n FROM orbit_plaud_imports WHERE owner_id=? AND json_extract(state_json,'$.status') IN ('pending','partial')",[owner]),
  count(db,"SELECT count(*) AS n FROM orbit_meeting_reviews WHERE owner_id=? AND status IN ('queued','running')",[owner]),
 ]);
 const mailSource=sources.find(s=>s.provider==='google_mail');
 const counts={plaudQueue:plaud.queue,plaudFailed:plaud.failed,plaudImports,activityPending:activity.pending,activityQuarantined:activity.quarantined,meetingReviews,mail:mailSource?.state==='partial'&&/진행 중/.test(mailSource.detail)?1:0};
 const pending:Pending={...counts,total:Object.values(counts).reduce((sum,n)=>sum+n,0)};
 const state:Collection['state']=sources.some(s=>s.state==='error')?'error'
  :sources.some(s=>s.state==='partial')||pending.total>0?'partial'
  :sources.length>0?'ok':'unknown';
 const lastProgressAt=maxIso([...sources.map(s=>s.attemptedAt),runtime.lastTick,plaud.lastSync,activity.lastSync,runtime.config.lastSchedulerTick]);
 return {state,lastProgressAt,sources,pending};
}

function turnState(status:string):Analysis['state']{
 return status==='running'||status==='completed'?status:'failed';
}
async function analysis(db:Database,owner:string,date:string):Promise<Analysis>{
 const turn=await db.prepare('SELECT id,status,response_json,created_at,updated_at FROM orbit_agent_turns WHERE owner_id=? AND input IN (?,?,?) ORDER BY created_at DESC,id DESC LIMIT 1')
  .bind(owner,...ENERGIES.map(energy=>briefMessage({date,energy}))).first<TurnRow>();
 if(!turn)return {state:'idle',turnId:null,startedAt:null,lastProgressAt:null,progress:'',error:'',basisAt:null,sourceRevision:null,metrics:null};
 const response=parseJson(turn.response_json),run=await readBriefRun(db,owner,turn.id);
 return {
  state:turnState(turn.status),turnId:turn.id,startedAt:turn.created_at,
  lastProgressAt:typeof response.progressAt==='string'?response.progressAt:turn.updated_at,
  progress:typeof response.progress==='string'?response.progress:'',error:typeof response.error==='string'?response.error:'',
  basisAt:run?.basis_at??null,sourceRevision:run?.source_revision??null,metrics:run?parseMetrics(run.metrics_json):null,
 };
}

async function plan(db:Database,owner:string,snapshot:WorkspaceSnapshot,date:string,collected:number):Promise<Plan>{
 const proposal=snapshot.data.proposals.find(p=>p.date===date),brief=proposal?.brief;
 if(!brief)return {state:proposal?'local':'none',date,readyAt:null,basisAt:null,cutoff:null,sourceRevision:null,currentRevision:snapshot.revision,durationMs:null,metrics:null,
  unconfirmed:{workspaceRevisions:0,noteRevisions:0,conversations:0,collection:collected,total:collected}};
 const run=await readBriefRun(db,owner,brief.sourceTurnId);
 const readyAt=run?.ready_at??brief.generatedAt,basisAt=run?.basis_at??brief.generatedAt;
 const workspaceRevisions=Math.max(0,snapshot.revision-brief.sourceRevision-1);
 const [noteRevisions,conversations]=await Promise.all([
  count(db,'SELECT count(*) AS n FROM orbit_note_revisions WHERE owner_id=? AND updated_at>?',[owner,basisAt]),
  count(db,"SELECT count(*) AS n FROM orbit_agent_turns WHERE owner_id=? AND status='completed' AND created_at>? AND input NOT LIKE ?",[owner,basisAt,PLANNING_PREFIX]),
 ]);
 // Staleness follows record changes only (AMENDMENTS A2); collector backlogs are shown, not blocking.
 const changed=workspaceRevisions+noteRevisions+conversations;
 return {
  state:changed>0?'stale':'ready',date,readyAt,basisAt,cutoff:brief.cutoff,sourceRevision:brief.sourceRevision,currentRevision:snapshot.revision,
  durationMs:run?Date.parse(readyAt)-Date.parse(run.started_at):null,metrics:run?parseMetrics(run.metrics_json):null,
  unconfirmed:{workspaceRevisions,noteRevisions,conversations,collection:collected,total:changed+collected},
 };
}

async function history(db:Database,owner:string,today:string,zone:string):Promise<PlanStatus['history']>{
 const rows=await listBriefRuns(db,owner,addDays(today,-6)),morning=`T${String(MORNING_HOUR).padStart(2,'0')}:00`;
 return rows.map(r=>{
  const readyAt=r.ready_at??(r.turn_status==='completed'?r.turn_updated_at:null);
  return {
   date:r.date,turnId:r.turn_id,status:r.turn_status,startedAt:r.started_at,basisAt:r.basis_at,readyAt,
   durationMs:readyAt?Date.parse(readyAt)-Date.parse(r.started_at):null,
   readyBeforeMorning:readyAt?localStamp(readyAt,zone)<r.date+morning:null,
   metrics:summarize(parseMetrics(r.metrics_json)),
  };
 });
}

// `date` pins the target (the GoTEM messages describe today's plan even after the evening hour).
export async function planStatus(db:Database,owner:string,_env:Runtime,now=new Date(),date?:string):Promise<PlanStatus>{
 const [snapshot,runtime]=await Promise.all([readWorkspace(db,owner),runtimeStatus(db,owner)]);
 const zone=snapshot.data.preferences.timeZone,today=todayInZone(zone,now),afterEvening=eveningDue(now,zone,runtime.config.eveningHour);
 const target={date:date??(afterEvening?addDays(today,1):today),timeZone:zone,eveningHour:runtime.config.eveningHour,afterEvening};
 const collected=await collection(db,owner,runtime);
 const [analyzed,planned,runs]=await Promise.all([analysis(db,owner,target.date),plan(db,owner,snapshot,target.date,collected.pending.total),history(db,owner,today,zone)]);
 return {now:now.toISOString(),target,collection:collected,analysis:analyzed,plan:planned,history:runs};
}
