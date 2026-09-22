// One orbit_brief_runs row per planning turn: when records were read (basis), when the plan
// became ready, reuse counts and the leaf manifest. Run status derives from orbit_agent_turns.
import type {Database} from '../../../db/repository.ts';

export interface RunMetrics {version:string;inline:boolean;leaves:number;reused:number;analyzed:number;merges:number;mergeReused:number;posts:number;changes:{added:number;modified:number;deleted:number;keys:string[]}}
export interface BriefRunRow {turn_id:string;date:string;started_at:string;basis_at:string;ready_at:string|null;source_revision:number;metrics_json:string;updated_at:string}
export type BriefRunHistoryRow=BriefRunRow&{turn_status:'running'|'completed'|'failed';turn_updated_at:string};
export interface BriefRunInput {date:string;startedAt:string;basisAt:string;sourceRevision:number;metrics:RunMetrics;manifest:Record<string,string>}

const ROW_COLUMNS='turn_id,date,started_at,basis_at,ready_at,source_revision,metrics_json,updated_at';

export async function beginBriefRun(db:Database,owner:string,turnId:string,input:BriefRunInput):Promise<void>{
 const now=new Date().toISOString();
 await db.prepare('INSERT INTO orbit_brief_runs(owner_id,turn_id,date,started_at,basis_at,ready_at,source_revision,metrics_json,manifest_json,updated_at) VALUES(?,?,?,?,?,NULL,?,?,?,?) ON CONFLICT(owner_id,turn_id) DO UPDATE SET basis_at=excluded.basis_at,source_revision=excluded.source_revision,metrics_json=excluded.metrics_json,manifest_json=excluded.manifest_json,updated_at=excluded.updated_at')
  .bind(owner,turnId,input.date,input.startedAt,input.basisAt,input.sourceRevision,JSON.stringify(input.metrics),JSON.stringify(input.manifest),now).run();
}
export async function updateBriefRun(db:Database,owner:string,turnId:string,metrics:RunMetrics):Promise<void>{
 await db.prepare('UPDATE orbit_brief_runs SET metrics_json=?,updated_at=? WHERE owner_id=? AND turn_id=?').bind(JSON.stringify(metrics),new Date().toISOString(),owner,turnId).run();
}
export async function finishBriefRun(db:Database,owner:string,turnId:string,readyAt:string,metrics:RunMetrics):Promise<void>{
 await db.batch([
  db.prepare('UPDATE orbit_brief_runs SET ready_at=?,metrics_json=?,updated_at=? WHERE owner_id=? AND turn_id=?').bind(readyAt,JSON.stringify(metrics),new Date().toISOString(),owner,turnId),
  db.prepare("UPDATE orbit_brief_runs SET manifest_json='' WHERE owner_id=? AND turn_id<>?").bind(owner,turnId),
 ]);
}
export async function lastManifest(db:Database,owner:string):Promise<Record<string,string>>{
 const row=await db.prepare("SELECT manifest_json FROM orbit_brief_runs WHERE owner_id=? AND ready_at IS NOT NULL AND manifest_json<>'' ORDER BY ready_at DESC LIMIT 1").bind(owner).first<{manifest_json:string}>();
 try{return row?JSON.parse(row.manifest_json):{}}catch{return {}}
}
export async function readBriefRun(db:Database,owner:string,turnId:string):Promise<BriefRunRow|null>{
 return db.prepare(`SELECT ${ROW_COLUMNS} FROM orbit_brief_runs WHERE owner_id=? AND turn_id=?`).bind(owner,turnId).first<BriefRunRow>();
}
export async function listBriefRuns(db:Database,owner:string,sinceDate:string):Promise<BriefRunHistoryRow[]>{
 const {results}=await db.prepare('SELECT r.turn_id,r.date,r.started_at,r.basis_at,r.ready_at,r.source_revision,r.metrics_json,r.updated_at,t.status AS turn_status,t.updated_at AS turn_updated_at FROM orbit_brief_runs r JOIN orbit_agent_turns t ON t.owner_id=r.owner_id AND t.id=r.turn_id WHERE r.owner_id=? AND r.date>=? ORDER BY r.date DESC,r.started_at DESC LIMIT 40').bind(owner,sinceDate).all<BriefRunHistoryRow>();
 return results;
}
