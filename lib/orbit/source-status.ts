import type {Database} from '../../db/repository.ts';
export interface SourceStatus {
 provider:string; state:'ok'|'partial'|'error'; attemptedAt:string; succeededAt?:string;
 detail:string; count?:number; from?:string; to?:string; targets?:string[];
}
export async function sourceStatuses(db:Database,owner:string):Promise<SourceStatus[]> {
 const {results}=await db.prepare('SELECT state_json FROM orbit_source_status WHERE owner_id=?').bind(owner).all<{state_json:string}>();
 return results.map(r=>JSON.parse(r.state_json));
}
export async function recordSource(db:Database,owner:string,provider:string,update:Omit<SourceStatus,'provider'|'attemptedAt'>,calendarVersion?:string) {
 const row=await db.prepare('SELECT state_json FROM orbit_source_status WHERE owner_id=? AND provider=?').bind(owner,provider).first<{state_json:string}>();
 const old:Partial<SourceStatus>=row?JSON.parse(row.state_json):{};
 const now=new Date().toISOString();
 const state:SourceStatus={...old,...update,provider,attemptedAt:now,...(update.state==='ok'?{succeededAt:now}:{})};
 if(calendarVersion!==undefined){await db.prepare("INSERT INTO orbit_source_status(owner_id,provider,state_json) SELECT ?,?,? WHERE COALESCE((SELECT updated_at FROM orbit_calendar_settings WHERE owner_id=?),'')=? ON CONFLICT(owner_id,provider) DO UPDATE SET state_json=excluded.state_json").bind(owner,provider,JSON.stringify(state),owner,calendarVersion).run();}
 else await db.prepare('INSERT INTO orbit_source_status(owner_id,provider,state_json) VALUES(?,?,?) ON CONFLICT(owner_id,provider) DO UPDATE SET state_json=excluded.state_json').bind(owner,provider,JSON.stringify(state)).run();
 return state;
}
