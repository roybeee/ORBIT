import type {Database} from '../../../db/repository.ts';
import {holdMessage,listHolds} from './provider-hold.ts';

const WEEK_MS=7*86400000;
// What the today banner and the 7-day evaluation read: open holds, the work waiting on them, and per episode
// the calls that still reached a spent provider (leaked, excluding probes) and how much waiting work finished.
export async function aiHoldStatus(db:Database,owner:string,now=Date.now()){
 const since=new Date(now-WEEK_MS).toISOString(),holds=await listHolds(db,owner,since);
 const meetings=await db.prepare("SELECT r.note_id,r.status,r.hold_id,n.title FROM orbit_meeting_reviews r LEFT JOIN orbit_note_revisions n ON n.owner_id=r.owner_id AND n.note_id=r.note_id AND n.revision=r.revision WHERE r.owner_id=? AND r.status IN ('queued','waiting_quota') AND r.hold_id<>'' ORDER BY r.updated_at DESC LIMIT 50").bind(owner).all<{note_id:string;status:string;hold_id:string;title:string|null}>();
 const runs=await db.prepare('SELECT date,state_json FROM orbit_daily_runs WHERE owner_id=? ORDER BY date DESC LIMIT 14').bind(owner).all<{date:string;state_json:string}>();
 const plans=runs.results.map(r=>({date:r.date,...JSON.parse(r.state_json) as {status:string;holdId?:string}}));
 const reviewed=await db.prepare("SELECT hold_id,count(*) AS affected,sum(status='completed') AS completed FROM orbit_meeting_reviews WHERE owner_id=? AND hold_id<>'' GROUP BY hold_id").bind(owner).all<{hold_id:string;affected:number;completed:number}>();
 const failures=await db.prepare("SELECT count(*) AS n FROM orbit_agent_turns WHERE owner_id=? AND status='failed' AND updated_at>=? AND (response_json LIKE '%quota%' OR response_json LIKE '%사용량 한도%' OR response_json LIKE '%429%')").bind(owner,since).first<{n:number}>();
 return {
  holds:holds.filter(h=>!h.clearedAt).map(h=>({id:h.id,provider:h.provider,kind:h.kind,reason:h.reason,openedAt:h.openedAt,nextCheckAt:h.nextCheckAt,retryKnown:h.retryKnown,message:holdMessage(h)})),
  waiting:{meetings:meetings.results.map(r=>({noteId:r.note_id,title:r.title??'회의록',status:r.status})),plans:plans.filter(p=>p.status==='waiting_quota').map(p=>({date:p.date}))},
  metrics:holds.map(h=>{
   const m=reviewed.results.find(r=>r.hold_id===h.id),p=plans.filter(x=>x.holdId===h.id);
   // Work is only counted as recovered once the limit actually came back.
   return {id:h.id,provider:h.provider,kind:h.kind,openedAt:h.openedAt,clearedAt:h.clearedAt,probes:h.probes,leaked:h.leaked,manual:h.manual,affected:(m?.affected??0)+p.length,completed:h.clearedAt?(m?.completed??0)+p.filter(x=>x.status==='completed').length:null};
  }),
  limitFailures7d:failures?.n??0,
 };
}
