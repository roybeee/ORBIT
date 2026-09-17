import {syncActivity,activityStatus} from './agent/activity.ts';
import {readWorkspace,type Database} from '../../db/repository.ts';
import {todayInZone,addDays} from './dates.ts';
import {connections,type Runtime} from './agent/integrations.ts';
import {syncCalendar} from './agent/calendar.ts';
import {runAgent,advanceAgent} from './agent/runner.ts';
import {advanceOrder,listOrders} from './agent/orders.ts';
import {orderActive} from './agent/orders-schema.ts';
import {syncWikiMail} from './wiki/mail.ts';
import {briefMessage} from './brief/schema.ts';
import {localPlanning} from './brief/start.ts';
import {AgentError} from './agent/errors.ts';
import {recordSource,sourceStatuses} from './source-status.ts';
export type RuntimeConfig={enabled:boolean;eveningHour:number;syncAt?:string;syncCursor?:number;advanceCursor?:number;lastError?:string};
export const runtimeDefaults:RuntimeConfig={enabled:true,eveningHour:21};
export async function runtimeStatus(db:Database,owner:string){const row=await db.prepare('SELECT config_json,last_tick FROM orbit_daily_runtime WHERE owner_id=?').bind(owner).first<{config_json:string;last_tick:string|null}>();const runs=await db.prepare('SELECT date,state_json FROM orbit_daily_runs WHERE owner_id=? ORDER BY date DESC LIMIT 7').bind(owner).all<{date:string;state_json:string}>();return {config:row?JSON.parse(row.config_json) as RuntimeConfig:runtimeDefaults,lastTick:row?.last_tick??null,sources:await sourceStatuses(db,owner),runs:runs.results.map(r=>({date:r.date,...JSON.parse(r.state_json)}))};}
export async function runtimeSettings(db:Database,owner:string,input:{enabled:boolean;eveningHour:number}){const old=await runtimeStatus(db,owner);await db.prepare('INSERT INTO orbit_daily_runtime(owner_id,config_json,lease_until) VALUES(?,?,0) ON CONFLICT(owner_id) DO UPDATE SET config_json=excluded.config_json').bind(owner,JSON.stringify({...old.config,...input})).run();}
export function eveningDue(now:Date,timeZone:string,hour:number){const localHour=Number(new Intl.DateTimeFormat('en',{timeZone,hour:'numeric',hourCycle:'h23'}).format(now));return localHour>=hour;}
export async function tickRuntime(db:Database,owner:string,env:Runtime){
 await db.prepare('INSERT OR IGNORE INTO orbit_daily_runtime(owner_id,config_json,lease_until) VALUES(?,?,0)').bind(owner,JSON.stringify(runtimeDefaults)).run();
 const lease=Date.now()+180000,claimed=await db.prepare('UPDATE orbit_daily_runtime SET lease_until=? WHERE owner_id=? AND lease_until<?').bind(lease,owner,Date.now()).run();if(claimed.meta?.changes!==1)return {busy:true,active:true};
 try{
 const config=(await runtimeStatus(db,owner)).config;if(!config.enabled)return {disabled:true,active:false};
 const capture=await activityStatus(db,owner);if(!capture.lastSync||Date.now()-Date.parse(capture.lastSync)>=120000)try{await syncActivity(db,owner,env);}catch{/* independent collector error is visible in source status */}
 const finish=async(active:boolean)=>{const latest=(await runtimeStatus(db,owner)).config;await db.prepare('UPDATE orbit_daily_runtime SET config_json=? WHERE owner_id=? AND lease_until=?').bind(JSON.stringify({...config,enabled:latest.enabled,eveningHour:latest.eveningHour}),owner,lease).run();return {active};};
 // One bounded unit per tick. Collection happens before preparing a new brief.
 if(!config.syncAt||Date.now()-Date.parse(config.syncAt)>=900000){
  const connected=await connections(db,owner,env),cursor=config.syncCursor??0;
  if(cursor===0){if(connected.some(c=>c.provider==='google_calendar'&&c.connected))try{await syncCalendar(db,owner,env);config.lastError='';}catch{config.lastError='Google 일정 최신 동기화 실패';}config.syncCursor=1;return await finish(true);}
  if(connected.some(c=>c.provider==='google_mail'&&c.connected))try{const r=await syncWikiMail(db,owner,env);await recordSource(db,owner,'google_mail',{state:r.more||r.needsProject?'partial':'ok',detail:r.needsProject?'메일을 연결할 프로젝트가 필요합니다':r.more?'최근 30일 메일 수집 진행 중 · 다음 주기에 계속':'최근 30일 메일 조회 완료 · 첨부파일 제외',count:r.count});}catch{await recordSource(db,owner,'google_mail',{state:'error',detail:'메일 수집 실패 · 다음 수집에서 저장된 메일 이후부터 재확인'});config.lastError='Gmail 최신 수집 실패';}
  config.syncAt=new Date().toISOString();config.syncCursor=0;return await finish(true);
 }
 const snapshot=await readWorkspace(db,owner),zone=snapshot.data.preferences.timeZone,today=todayInZone(zone),afterEvening=eveningDue(new Date(),zone,config.eveningHour),target=afterEvening?addDays(today,1):today;
 const runs=await db.prepare('SELECT date,state_json FROM orbit_daily_runs WHERE owner_id=? ORDER BY date DESC LIMIT 7').bind(owner).all<{date:string;state_json:string}>();
 for(const r of runs.results){const state=JSON.parse(r.state_json);if(state.status!=='running')continue;const turn=await db.prepare('SELECT status,response_json FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,state.id).first<{status:string;response_json:string}>();if(turn&&turn.status!=='running'){const response=JSON.parse(turn.response_json);state.status=turn.status==='failed'&&state.attempts<3&&!/중지|cancel/i.test(response.error??'')&&r.date>=today?'queued':turn.status;await db.prepare('UPDATE orbit_daily_runs SET state_json=?,updated_at=? WHERE owner_id=? AND date=?').bind(JSON.stringify(state),new Date().toISOString(),owner,r.date).run();}}
 // After an overnight outage prepare today's missing plan; never backfill old days.
 let row=await db.prepare('SELECT state_json FROM orbit_daily_runs WHERE owner_id=? AND date=?').bind(owner,target).first<{state_json:string}>();
 const alreadyPlanned=snapshot.data.proposals.some(p=>p.date===target);
 if(!row&&!alreadyPlanned){await db.prepare('INSERT OR IGNORE INTO orbit_daily_runs(owner_id,date,state_json,updated_at) VALUES(?,?,?,?)').bind(owner,target,JSON.stringify({id:crypto.randomUUID(),status:'queued',attempts:0}),new Date().toISOString()).run();row=await db.prepare('SELECT state_json FROM orbit_daily_runs WHERE owner_id=? AND date=?').bind(owner,target).first<{state_json:string}>();}
 if(row){const state=JSON.parse(row.state_json);if(state.status==='queued'&&state.attempts<3){state.attempts++;try{const planning={date:target,energy:snapshot.data.reviews.find(r=>r.date===addDays(target,-1))?.energy??'normal' as const};try{await runAgent(db,owner,{id:state.id,message:briefMessage(planning),planning},env);state.status='running';}catch(e){if(e instanceof AgentError&&e.code==='HERMES_SETUP'){await localPlanning(db,owner,state.id+':local',planning);state.status='local';}else throw e;}}catch{state.message='자동 제안 준비 실패 · 연결을 확인한 뒤 내일 제안에서 다시 요청하세요.';if(state.attempts>=3)state.status='failed';}await db.prepare('UPDATE orbit_daily_runs SET state_json=?,updated_at=? WHERE owner_id=? AND date=?').bind(JSON.stringify(state),new Date().toISOString(),owner,target).run();return await finish(true);}}
 const jobs=await db.prepare("SELECT j.turn_id FROM orbit_hermes_jobs j JOIN orbit_agent_turns t ON t.owner_id=j.owner_id AND t.id=j.turn_id WHERE j.owner_id=? AND t.status='running' ORDER BY j.turn_id").bind(owner).all<{turn_id:string}>();
 const orders=(await listOrders(db,owner)).filter(o=>orderActive(o.status)&&o.status!=='waiting_for_approval');
 const work=[...jobs.results.map(j=>({id:'chat:'+j.turn_id,run:()=>advanceAgent(db,owner,j.turn_id,env)})),...orders.map(o=>({id:'order:'+o.id,run:()=>advanceOrder(db,owner,o.id,env,{action:'poll' as const,id:o.id})}))].sort((a,b)=>a.id.localeCompare(b.id));
 if(work.length){const index=(config.advanceCursor??0)%work.length;try{await work[index].run();config.lastError='';}catch{config.lastError='일부 실행 단계 재확인 필요 · 실행 결과에서 오류를 확인하세요.';}config.advanceCursor=index+1;return await finish(true);}
 return await finish(false);
 }finally{await db.prepare('UPDATE orbit_daily_runtime SET lease_until=0,last_tick=? WHERE owner_id=? AND lease_until=?').bind(new Date().toISOString(),owner,lease).run();}
}
