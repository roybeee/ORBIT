import {collectNotifications} from './notifications/store.ts';
import {flushPushNotifications} from './notifications/push.ts';
import {processMeetingReviews} from './meetings/review-runtime.ts';
import {syncDiscord} from './discord/runtime.ts';
import {syncMeetings} from './meetings/sync.ts';
import {collectMetrics} from './metric-collector.ts';
import {replanBasis} from './reschedule.ts';
import {syncActivity,activityStatus} from './agent/activity.ts';
import {readWorkspace,writeCommand,type Database} from '../../db/repository.ts';
import {todayInZone,addDays} from './dates.ts';
import {connections,type Runtime} from './agent/integrations.ts';
import {syncCalendar} from './agent/calendar.ts';
import {runAgent} from './agent/runner.ts';
import {advanceRuntimeWork} from './runtime-work.ts';
import {syncWikiMail} from './wiki/mail.ts';
import {briefMessage} from './brief/schema.ts';
import {localPlanning} from './brief/start.ts';
import {AgentError} from './agent/errors.ts';
import {recordSource,sourceStatuses} from './source-status.ts';
export type RuntimeConfig={enabled:boolean;eveningHour:number;syncAt?:string;syncCursor?:number;metricCursor?:number;advanceCursor?:number;lastError?:string;workFirst?:boolean;lastSchedulerTick?:string};
export const runtimeDefaults:RuntimeConfig={enabled:true,eveningHour:21};
export async function runtimeStatus(db:Database,owner:string){
 const row=await db.prepare('SELECT config_json,last_tick FROM orbit_daily_runtime WHERE owner_id=?').bind(owner).first<{config_json:string;last_tick:string|null}>();
 const runs=await db.prepare('SELECT date,state_json FROM orbit_daily_runs WHERE owner_id=? ORDER BY date DESC LIMIT 7').bind(owner).all<{date:string;state_json:string}>();
 const config:RuntimeConfig=row?JSON.parse(row.config_json):{...runtimeDefaults};
 // SQLite JSON extraction may expose legacy booleans as 0/1. Keep API settings typed.
 config.enabled=Boolean(config.enabled);
 return {config,lastTick:row?.last_tick??null,sources:await sourceStatuses(db,owner),runs:runs.results.map(r=>({date:r.date,...JSON.parse(r.state_json)}))};
}
export async function runtimeSettings(db:Database,owner:string,input:{enabled:boolean;eveningHour:number}){await db.prepare("INSERT INTO orbit_daily_runtime(owner_id,config_json,lease_until) VALUES(?,?,0) ON CONFLICT(owner_id) DO UPDATE SET config_json=json_set(orbit_daily_runtime.config_json,'$.enabled',json(CASE WHEN json_extract(excluded.config_json,'$.enabled') THEN 'true' ELSE 'false' END),'$.eveningHour',json_extract(excluded.config_json,'$.eveningHour'))").bind(owner,JSON.stringify({...runtimeDefaults,...input})).run();}
export function eveningDue(now:Date,timeZone:string,hour:number){const localHour=Number(new Intl.DateTimeFormat('en',{timeZone,hour:'numeric',hourCycle:'h23'}).format(now));return localHour>=hour;}
export async function tickRuntime(db:Database,owner:string,env:Runtime,options:{scheduled?:boolean}={}){
 await db.prepare('INSERT OR IGNORE INTO orbit_daily_runtime(owner_id,config_json,lease_until) VALUES(?,?,0)').bind(owner,JSON.stringify(runtimeDefaults)).run();
 const lease=Date.now()+180000,claimed=await db.prepare('UPDATE orbit_daily_runtime SET lease_until=? WHERE owner_id=? AND lease_until<?').bind(lease,owner,Date.now()).run();if(claimed.meta?.changes!==1)return {busy:true,active:true};
 try{
 const config=(await runtimeStatus(db,owner)).config;if(!config.enabled)return {disabled:true,active:false};
 await processMeetingReviews(db,owner,env).catch(()=>{});
 const discord=await syncDiscord(db,owner,env).catch(()=>({active:false}));
 let meetingsActive=false;
 const finish=async(active:boolean)=>{await db.prepare("UPDATE orbit_daily_runtime SET config_json=json_set(?,'$.enabled',json(CASE WHEN json_extract(config_json,'$.enabled') THEN 'true' ELSE 'false' END),'$.eveningHour',json_extract(config_json,'$.eveningHour')) WHERE owner_id=? AND lease_until=?").bind(JSON.stringify(config),owner,lease).run();return {active:active||discord.active||meetingsActive};};
 const advance=async()=>{const result=await advanceRuntimeWork(db,owner,env,config.advanceCursor);if(result.active){config.advanceCursor=result.cursor;config.lastError=result.error;config.workFirst=false;}return result.active;};
 // Alternate active work with housekeeping: collection can never starve research.
 if(config.workFirst!==false&&await advance())return await finish(true);
 config.workFirst=true;
 // One independently checkpointed Plaud operation per housekeeping tick.
 meetingsActive=!!(await syncMeetings(db,owner,env).catch(()=>({active:false}))).active;
 await processMeetingReviews(db,owner,env).catch(()=>{});
 const capture=await activityStatus(db,owner);if(!capture.lastSync||Date.now()-Date.parse(capture.lastSync)>=120000)try{await syncActivity(db,owner,env);}catch{/* independent collector error is visible in source status */}
 // One bounded unit per tick. Collection happens before preparing a new brief.
 if(!config.syncAt||Date.now()-Date.parse(config.syncAt)>=900000){
  const connected=await connections(db,owner,env),cursor=config.syncCursor??0;
  if(cursor===0){if(connected.some(c=>c.provider==='google_calendar'&&c.connected))try{await syncCalendar(db,owner,env);config.lastError='';}catch{config.lastError='Google 일정 최신 동기화 실패';}config.syncCursor=1;return await finish(true);}
  if(cursor===1&&connected.some(c=>c.provider==='google_mail'&&c.connected))try{const r=await syncWikiMail(db,owner,env);await recordSource(db,owner,'google_mail',{state:r.more||r.needsProject?'partial':'ok',detail:r.needsProject?'메일을 연결할 프로젝트가 필요합니다':r.more?'최근 30일 메일 수집 진행 중 · 다음 주기에 계속':'최근 30일 메일 조회 완료 · 첨부파일 제외',count:r.count});}catch{await recordSource(db,owner,'google_mail',{state:'error',detail:'메일 수집 실패 · 다음 수집에서 저장된 메일 이후부터 재확인'});config.lastError='Gmail 최신 수집 실패';}
  if(cursor===1){config.syncCursor=2;return await finish(true);}
  try{await collectMetrics(db,owner,env,config.metricCursor??0);}catch{config.lastError='외부 수치 수집 상태를 확인해 주세요.';}finally{config.metricCursor=(config.metricCursor??0)+1;}
  config.syncAt=new Date().toISOString();config.syncCursor=0;return await finish(true);
 }
 const snapshot=await readWorkspace(db,owner),zone=snapshot.data.preferences.timeZone,today=todayInZone(zone),afterEvening=eveningDue(new Date(),zone,config.eveningHour),target=afterEvening?addDays(today,1):today;
 const previousMonth=addDays(today.slice(0,7)+'-01',-1).slice(0,7);
 if(!snapshot.data.monthlyReports?.some(r=>r.id===previousMonth)){try{await writeCommand(db,owner,{operationId:crypto.randomUUID(),expectedRevision:snapshot.revision,action:{type:'monthly.generate',month:previousMonth}});return await finish(true);}catch{config.lastError='월간 보고서 준비를 다음 실행에서 재시도합니다.';}}
 for(const p of snapshot.data.proposals.filter(p=>p.date>=today&&p.date<=addDays(today,1))){if((!p.replan||Date.now()-Date.parse(p.replan.generatedAt)>900000)&&p.replan?.basis!==replanBasis(snapshot.data,p.date)){try{await writeCommand(db,owner,{operationId:crypto.randomUUID(),expectedRevision:snapshot.revision,action:{type:'proposal.replan.prepare',date:p.date}});return await finish(true);}catch{config.lastError='일정 대안은 다음 실행에서 다시 계산합니다.';}}}
 const runs=await db.prepare('SELECT date,state_json FROM orbit_daily_runs WHERE owner_id=? ORDER BY date DESC LIMIT 7').bind(owner).all<{date:string;state_json:string}>();
 for(const r of runs.results){const state=JSON.parse(r.state_json);if(state.status!=='running')continue;const turn=await db.prepare('SELECT status,response_json FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,state.id).first<{status:string;response_json:string}>();if(turn&&turn.status!=='running'){const response=JSON.parse(turn.response_json);// A failed run that already left a plan for that date (the runner's rule-based fallback) is done:
// re-queuing it would spend another Hermes run to replace a plan the owner already has.
state.status=turn.status==='failed'&&state.attempts<3&&!/중지|cancel/i.test(response.error??'')&&r.date>=today&&!snapshot.data.proposals.some(p=>p.date===r.date)?'queued':turn.status;await db.prepare('UPDATE orbit_daily_runs SET state_json=?,updated_at=? WHERE owner_id=? AND date=?').bind(JSON.stringify(state),new Date().toISOString(),owner,r.date).run();}}
 // After an overnight outage prepare today's missing plan; never backfill old days.
 let row=await db.prepare('SELECT state_json FROM orbit_daily_runs WHERE owner_id=? AND date=?').bind(owner,target).first<{state_json:string}>();
 const alreadyPlanned=snapshot.data.proposals.some(p=>p.date===target);
 if(!row&&!alreadyPlanned){await db.prepare('INSERT OR IGNORE INTO orbit_daily_runs(owner_id,date,state_json,updated_at) VALUES(?,?,?,?)').bind(owner,target,JSON.stringify({id:crypto.randomUUID(),status:'queued',attempts:0}),new Date().toISOString()).run();row=await db.prepare('SELECT state_json FROM orbit_daily_runs WHERE owner_id=? AND date=?').bind(owner,target).first<{state_json:string}>();}
 if(row){const state=JSON.parse(row.state_json);if(state.status==='queued'&&state.attempts<3){state.attempts++;try{const planning={date:target,energy:snapshot.data.reviews.find(r=>r.date===addDays(target,-1))?.energy??'normal' as const};try{await runAgent(db,owner,{id:state.id,message:briefMessage(planning),planning},env);state.status='running';}catch(e){if(e instanceof AgentError&&e.code==='HERMES_SETUP'){await localPlanning(db,owner,state.id+':local',planning);state.status='local';}else throw e;}}catch{state.message='자동 제안 준비 실패 · 연결을 확인한 뒤 내일 제안에서 다시 요청하세요.';if(state.attempts>=3)state.status='failed';}await db.prepare('UPDATE orbit_daily_runs SET state_json=?,updated_at=? WHERE owner_id=? AND date=?').bind(JSON.stringify(state),new Date().toISOString(),owner,target).run();return await finish(true);}}
 if(await advance())return await finish(true);
 return await finish(false);
 }finally{await collectNotifications(db,owner).catch(()=>{});await flushPushNotifications(db,owner).catch(()=>{});const at=new Date().toISOString();await db.prepare("UPDATE orbit_daily_runtime SET lease_until=0,last_tick=?,config_json=CASE WHEN ? THEN json_set(config_json,'$.lastSchedulerTick',?) ELSE config_json END WHERE owner_id=? AND lease_until=?").bind(at,options.scheduled?1:0,at,owner,lease).run();}
}
