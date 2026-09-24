// Effect check for the context-aware GoTEM loop (ORBIT-20260924-01), read-only and owner-scoped:
// 1) share of sent morning messages followed by a start within 60 minutes, and the median delay;
// 2) share of chosen review improvements that the next morning message actually carried.
// Sources: orbit_gotem_sends (what was sent, for which task), orbit_task_starts, saved reviews.
import {readWorkspace,type Database} from '../../../db/repository.ts';
import {addDays,todayInZone} from '../dates.ts';

export const START_WINDOW_MINUTES=60;
export interface MorningDay {date:string;sentAt:string;taskId:string|null;startedAt:string|null;minutes:number|null;within60:boolean}
export interface CarryItem {reviewDate:string;rule:string;reflected:boolean}
export interface GotemMetrics {
 from:string;to:string;
 morning:{sent:number;started:number;within60:number;rate:number|null;medianMinutes:number|null;days:MorningDay[]};
 carry:{eligible:number;reflected:number;rate:number|null;items:CarryItem[]};
}
type SendRow={date:string;status:string;payload_json:string;created_at:string};
type StartRow={task_id:string;started_at:string;date:string};

function payloadOf(text:string):{taskId?:unknown;carryReviewDate?:unknown}{
 try{const value=JSON.parse(text);return value&&typeof value==='object'?value:{}}catch{return {}}
}
const percent=(part:number,whole:number)=>whole?Math.round(part/whole*100):null;
function median(values:number[]):number|null{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
 return sorted.length%2?sorted[mid]:Math.round((sorted[mid-1]+sorted[mid])/2);
}

// The message's own task counts when it named one; otherwise any start after the message.
function morningDay(send:SendRow,starts:StartRow[]):MorningDay{
 const raw=payloadOf(send.payload_json).taskId,taskId=typeof raw==='string'?raw:null;
 const first=starts.filter(s=>s.date===send.date&&s.started_at>=send.created_at&&(!taskId||s.task_id===taskId)).sort((a,b)=>a.started_at.localeCompare(b.started_at))[0];
 const minutes=first?Math.round((Date.parse(first.started_at)-Date.parse(send.created_at))/60000):null;
 return {date:send.date,sentAt:send.created_at,taskId,startedAt:first?.started_at??null,minutes,within60:minutes!==null&&minutes<=START_WINDOW_MINUTES};
}

export async function gotemMetrics(db:Database,owner:string,now=new Date(),days=14):Promise<GotemMetrics>{
 const snapshot=await readWorkspace(db,owner);
 const to=todayInZone(snapshot.data.preferences.timeZone,now),from=addDays(to,-(days-1));
 const [sends,starts]=await Promise.all([
  db.prepare("SELECT date,status,payload_json,created_at FROM orbit_gotem_sends WHERE owner_id=? AND slot='morning' AND date BETWEEN ? AND ? ORDER BY date").bind(owner,from,to).all<SendRow>(),
  db.prepare('SELECT task_id,started_at,date FROM orbit_task_starts WHERE owner_id=? AND date BETWEEN ? AND ?').bind(owner,from,to).all<StartRow>(),
 ]);
 const sent=sends.results.filter(s=>s.status==='sent');
 const mornings=sent.map(s=>morningDay(s,starts.results));
 const started=mornings.filter(d=>d.minutes!==null);
 const within=mornings.filter(d=>d.within60).length;
 const carried=new Map(sent.map(s=>[s.date,payloadOf(s.payload_json).carryReviewDate]));
 // A carry is eligible once its next morning has come (inside the window); only non-empty carries count.
 const items=snapshot.data.reviews
  .filter(r=>r.carry?.trim()&&r.date>=addDays(from,-1)&&addDays(r.date,1)<=to)
  .sort((a,b)=>a.date.localeCompare(b.date))
  .map(r=>({reviewDate:r.date,rule:r.carry!.trim(),reflected:carried.get(addDays(r.date,1))===r.date}));
 const reflected=items.filter(i=>i.reflected).length;
 return {
  from,to,
  morning:{sent:mornings.length,started:started.length,within60:within,rate:percent(within,mornings.length),medianMinutes:median(started.map(d=>d.minutes!)),days:mornings},
  carry:{eligible:items.length,reflected,rate:percent(reflected,items.length),items},
 };
}
