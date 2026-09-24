import type {Database} from '../../../db/repository.ts';

// A spent provider limit is shared by every job that uses that provider. Without a shared record each
// queued meeting started, called the provider and failed with the same 429 in turn. An open hold makes
// automatic analysis wait, keeps its records, and lets one probe at a time check whether the limit is back.
export type Provider='hermes'|'openai';
export type LimitKind='rate_limit'|'quota';
export type Hold={id:string;provider:Provider;kind:LimitKind;reason:string;openedAt:string;nextCheckAt:number;retryKnown:boolean;failures:number;probeTurnId:string;probeUntil:number;probes:number;leaked:number;manual:number;clearedAt:string|null;clearedBy:string};
type Row={id:string;provider:Provider;kind:LimitKind;reason:string;opened_at:string;next_check_at:number;retry_known:number;failures:number;probe_turn_id:string;probe_until:number;probes:number;leaked:number;manual:number;cleared_at:string|null;cleared_by:string};

const LIMIT_WORDS=/quota|usage limit|insufficient_quota|rate.?limit|\b429\b|사용량 한도/i;
const QUOTA_WORDS=/quota|usage limit|insufficient_quota|한도가 소진/i;
// A limit that lifts within this window is a request-rate limit, not a spent allowance.
export const SHORT_LIMIT_MS=15*60000;
// A probe that never reports back (lost run, crashed worker) frees the slot after this long.
export const PROBE_LEASE_MS=45*60000;
const UNIT_MS:Record<string,number>={ms:1,s:1000,m:60000,h:3600000};

export function retryAfterMs(detail:string){
 const match=/retry.?after\D{0,3}(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hours?)?\b/i.exec(detail);
 if(!match)return undefined;
 const unit=(match[2]??'s').toLowerCase(),key=unit.startsWith('ms')||unit.startsWith('milli')?'ms':unit[0];
 return Math.round(Number(match[1])*(UNIT_MS[key]??1000));
}
// Authentication failures are not limits: they return null here and keep their own guidance.
export function classifyLimit(detail:string):{kind:LimitKind;retryAfterMs?:number}|null{
 if(!LIMIT_WORDS.test(detail))return null;
 const after=retryAfterMs(detail);
 if(after!==undefined)return {kind:after<=SHORT_LIMIT_MS?'rate_limit':'quota',retryAfterMs:after};
 return {kind:QUOTA_WORDS.test(detail)?'quota':'rate_limit'};
}
// A known reset time is honoured with a small spread; an unknown one backs off exponentially with jitter
// (quota: 30 min doubling to 6 h, rate limit: 1 min doubling to 15 min).
export function nextCheckAt(now:number,kind:LimitKind,failures:number,retryAfter?:number,random=Math.random){
 if(retryAfter!==undefined)return now+retryAfter+Math.round(random()*(kind==='quota'?300000:30000));
 const base=kind==='quota'?Math.min(1800000*2**failures,21600000):Math.min(60000*2**failures,SHORT_LIMIT_MS);
 return now+Math.round(base*(0.8+random()*0.4));
}

const toHold=(r:Row):Hold=>({id:r.id,provider:r.provider,kind:r.kind,reason:r.reason,openedAt:r.opened_at,nextCheckAt:r.next_check_at,retryKnown:!!r.retry_known,failures:r.failures,probeTurnId:r.probe_turn_id,probeUntil:r.probe_until,probes:r.probes,leaked:r.leaked,manual:r.manual,clearedAt:r.cleared_at,clearedBy:r.cleared_by});
export async function activeHold(db:Database,owner:string,provider:Provider){
 const row=await db.prepare('SELECT * FROM orbit_provider_holds WHERE owner_id=? AND provider=? AND cleared_at IS NULL ORDER BY opened_at DESC LIMIT 1').bind(owner,provider).first<Row>();
 return row?toHold(row):null;
}
export async function listHolds(db:Database,owner:string,since:string){
 const rows=await db.prepare('SELECT * FROM orbit_provider_holds WHERE owner_id=? AND (cleared_at IS NULL OR opened_at>=?) ORDER BY opened_at DESC LIMIT 50').bind(owner,since).all<Row>();
 return rows.results.map(toHold);
}

type Turn={id:string;automatic:boolean;submittedAt?:number};
// A record that failed on a provider limit waits for recovery instead of staying failed. A stop the owner
// asked for is never turned into waiting work.
export const waitsForLimit=(error:string)=>!!classifyLimit(error)&&!/중지/.test(error);
// Records a limit reported by a finished call. The first report opens the hold; a failed probe pushes the
// next check back; any other automatic call that was still sent after the hold opened is counted as leaked.
export async function recordLimit(db:Database,owner:string,provider:Provider,detail:string,turn:Turn,now=Date.now()){
 const limit=classifyLimit(detail);if(!limit)return null;
 const reason=detail.replace(/\s+/g,' ').trim().slice(0,300);
 const opened=await db.prepare("INSERT INTO orbit_provider_holds(owner_id,id,provider,kind,reason,opened_at,next_check_at,retry_known) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM orbit_provider_holds WHERE owner_id=? AND provider=? AND cleared_at IS NULL)")
  .bind(owner,crypto.randomUUID(),provider,limit.kind,reason,new Date(now).toISOString(),nextCheckAt(now,limit.kind,0,limit.retryAfterMs),limit.retryAfterMs===undefined?0:1,owner,provider).run();
 const hold=(await activeHold(db,owner,provider))!;
 if(opened.meta?.changes===1)return hold;
 if(hold.probeTurnId===turn.id){
  await db.prepare("UPDATE orbit_provider_holds SET kind=?,reason=?,failures=failures+1,next_check_at=?,retry_known=?,probe_turn_id='',probe_until=0 WHERE owner_id=? AND id=? AND probe_turn_id=?")
   .bind(limit.kind,reason,nextCheckAt(now,limit.kind,hold.failures+1,limit.retryAfterMs),limit.retryAfterMs===undefined?0:1,owner,hold.id,turn.id).run();
 }else if(turn.automatic&&turn.submittedAt!==undefined&&turn.submittedAt>=Date.parse(hold.openedAt)){
  await db.prepare('UPDATE orbit_provider_holds SET leaked=leaked+1 WHERE owner_id=? AND id=?').bind(owner,hold.id).run();
 }
 return activeHold(db,owner,provider);
}
// Asked before an automatic job calls the provider. 'free' = no hold, 'probe' = this turn holds the single
// recovery check, 'wait' = do not call. A manual request is never stopped; it is counted and may recover the hold.
export async function gateProvider(db:Database,owner:string,provider:Provider,turn:Turn,now=Date.now()):Promise<{state:'free'|'probe'|'manual'|'wait';hold?:Hold}>{
 const hold=await activeHold(db,owner,provider);if(!hold)return {state:'free'};
 if(!turn.automatic){await db.prepare('UPDATE orbit_provider_holds SET manual=manual+1 WHERE owner_id=? AND id=?').bind(owner,hold.id).run();return {state:'manual',hold}}
 if(hold.probeTurnId===turn.id&&hold.probeUntil>now)return {state:'probe',hold};
 if(now<hold.nextCheckAt)return {state:'wait',hold};
 const claimed=await db.prepare('UPDATE orbit_provider_holds SET probe_turn_id=?,probe_until=?,probes=probes+CASE WHEN probe_turn_id=? THEN 0 ELSE 1 END WHERE owner_id=? AND id=? AND cleared_at IS NULL AND next_check_at<=? AND (probe_until<=? OR probe_turn_id=?)')
  .bind(turn.id,now+PROBE_LEASE_MS,turn.id,owner,hold.id,now,now,turn.id).run();
 return claimed.meta?.changes===1?{state:'probe',hold}:{state:'wait',hold};
}
// Any successful answer from the provider ends the hold.
export async function clearHold(db:Database,owner:string,provider:Provider,by:string){
 const result=await db.prepare('UPDATE orbit_provider_holds SET cleared_at=?,cleared_by=?,probe_turn_id=\'\',probe_until=0 WHERE owner_id=? AND provider=? AND cleared_at IS NULL').bind(new Date().toISOString(),by,owner,provider).run();
 return (result.meta?.changes??0)>0;
}
// A probe that failed for another reason says nothing about the limit: free the slot and look again soon.
export async function releaseProbe(db:Database,owner:string,turnId:string,now=Date.now()){
 await db.prepare("UPDATE orbit_provider_holds SET probe_turn_id='',probe_until=0,next_check_at=? WHERE owner_id=? AND probe_turn_id=? AND cleared_at IS NULL").bind(now+300000,owner,turnId).run();
}
export function holdMessage(hold:Hold,timeZone='Asia/Seoul'){
 const at=new Intl.DateTimeFormat('ko-KR',{timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(hold.nextCheckAt));
 return `AI 사용량 한도로 분석을 잠시 보류했습니다(${hold.reason}). ${hold.retryKnown?'한도 회복 예정 '+at:'회복 시각 미확인 · '+at+'에 다시 확인'}. 기록은 그대로 보존되며 한도가 회복되면 자동으로 이어서 분석합니다.`;
}
