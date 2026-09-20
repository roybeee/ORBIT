import type {Database} from '../../../db/repository.ts';
import {connections,type Runtime} from '../agent/integrations.ts';
import {plaudRead} from '../agent/plaud.ts';
import {AgentError} from '../agent/errors.ts';
import {recordSource} from '../source-status.ts';
import {listed,recording} from './plaud-data.ts';
import {importRecording} from './store.ts';
type Deferred={id:string;error:string;retryAt:number};
type SyncState={failed?:Deferred[];enabled:boolean;page:number;queue:string[];pageCount:number;recent:boolean;lastWasRecent?:boolean;backfillComplete:boolean;lastRecent:number;nextAt:number;lastSync?:string;error?:string;failedId?:string;attempts?:number};
const initial=():SyncState=>({enabled:true,page:1,queue:[],pageCount:0,recent:false,backfillComplete:false,lastRecent:0,nextAt:0});
export async function meetingStatus(db:Database,owner:string,env:Runtime){
 const row=await db.prepare('SELECT state_json FROM orbit_plaud_sync WHERE owner_id=?').bind(owner).first<{state_json:string}>();
 const records=await db.prepare('SELECT external_id,state_json,updated_at FROM orbit_plaud_imports WHERE owner_id=? ORDER BY updated_at DESC LIMIT 20').bind(owner).all<{external_id:string;state_json:string;updated_at:string}>();
 const totals=await db.prepare("SELECT count(*) AS total,sum(CASE WHEN json_extract(state_json,'$.status')='ready' THEN 1 ELSE 0 END) AS ready FROM orbit_plaud_imports WHERE owner_id=?").bind(owner).first<{total:number;ready:number}>();
 return {state:row?{...initial(),...JSON.parse(row.state_json)}:initial(),connected:(await connections(db,owner,env)).some(c=>c.provider==='plaud'&&c.connected),total:totals?.total??0,ready:totals?.ready??0,records:records.results.map(r=>({id:r.external_id,...JSON.parse(r.state_json),updatedAt:r.updated_at}))};
}
export async function setMeetingSync(db:Database,owner:string,enabled:boolean){await db.prepare("INSERT INTO orbit_plaud_sync(owner_id,state_json,lease_until) VALUES(?,?,0) ON CONFLICT(owner_id) DO UPDATE SET state_json=json_set(state_json,'$.enabled',json(?),'$.nextAt',0)").bind(owner,JSON.stringify({...initial(),enabled}),enabled?'true':'false').run();}
// A tick performs at most one provider list or one recording fetch. The durable queue
// advances only after successful local persistence; existing runtime also runs with app closed.
export async function syncMeetings(db:Database,owner:string,env:Runtime,force=false,reader=plaudRead){
 await db.prepare('INSERT OR IGNORE INTO orbit_plaud_sync(owner_id,state_json,lease_until) VALUES(?,?,0)').bind(owner,JSON.stringify(initial())).run();
 const lease=Date.now()+150000,result=await db.prepare('UPDATE orbit_plaud_sync SET lease_until=? WHERE owner_id=? AND lease_until<?').bind(lease,owner,Date.now()).run();if(result.meta?.changes!==1)return {active:false,busy:true};
 let state:SyncState|undefined;let retrying='';
 const completePage=()=>{if(!state||state.queue.length)return;if(state.recent){state.recent=false;state.lastWasRecent=true;}else if(state.pageCount<10){state.backfillComplete=true;state.page=1;state.nextAt=Date.now()+300000;}else{state.page++;state.lastWasRecent=false;}};
 try{
  const row=await db.prepare('SELECT state_json FROM orbit_plaud_sync WHERE owner_id=?').bind(owner).first<{state_json:string}>();state={...initial(),...JSON.parse(row!.state_json)};
  if(!state!.enabled||(!force&&state!.nextAt>Date.now()))return {active:false};
  if(!(await connections(db,owner,env)).some(c=>c.provider==='plaud'&&c.connected)){if(force)throw new AgentError('ORBIT에서 Plaud를 다시 연결해 주세요. ChatGPT의 연결과 별개입니다.','CONNECT',409);return {active:false};}
  const retry=state!.failed?.find(f=>f.retryAt<=Date.now());if(retry){retrying=retry.id;const parsed=recording(await reader(db,owner,env,'get_file',{file_id:retry.id}));if(parsed.id!==retry.id)throw new Error('녹음 식별자가 다릅니다.');await importRecording(db,owner,parsed);state!.failed=state!.failed!.filter(f=>f.id!==retry.id);state!.error='';state!.lastSync=new Date().toISOString();return {active:true};}
  if(state!.queue.length){
   const id=state!.queue[0],parsed=recording(await reader(db,owner,env,'get_file',{file_id:id}));if(parsed.id!==id)throw new Error('요청한 녹음과 응답이 다릅니다.');
   await importRecording(db,owner,parsed);state!.queue.shift();state!.attempts=0;state!.failedId=undefined;state!.error='';state!.lastSync=new Date().toISOString();
   completePage();
  }else{
   // Interleave a fresh head page with historical backfill. No filtered 500-record cap.
   const recent=!state!.lastWasRecent&&state!.page>1&&Date.now()-state!.lastRecent>300000;
   const page=recent?1:state!.page,ids=listed(await reader(db,owner,env,'list_files',{page,page_size:10}));
   state!.queue=ids;state!.recent=recent;if(page===1)state!.lastRecent=Date.now();if(!recent)state!.pageCount=ids.length;
   if(!ids.length){state!.backfillComplete=true;state!.page=1;state!.recent=false;state!.nextAt=Date.now()+300000;}
   state!.error='';
  }
  const status=await meetingStatus(db,owner,env);
  await recordSource(db,owner,'plaud',{state:state!.backfillComplete&&!state!.queue.length&&!state!.failed?.length&&status.ready===status.total?'ok':'partial',detail:state!.queue.length?'회의록 원문·요약 수집 중 · 남은 기록은 다음 실행에서 계속':'회의 목록 확인 완료 · 준비 중인 전사와 이전 자료는 재확인',count:status.total});
  return {active:true};
 }catch(e){
  if(state){state.error=e instanceof Error?e.message:'Plaud 수집 실패';state.attempts=(state.attempts??0)+1;const id=retrying||state.queue[0];state.failedId=id;if(id){state.failed=[...(state.failed??[]).filter(f=>f.id!==id),{id,error:state.error,retryAt:Date.now()+3600000}];if(!retrying){state.queue.shift();completePage();}}else state.nextAt=Date.now()+Math.min(3600000,60000*2**Math.min(state.attempts,6));}
  await recordSource(db,owner,'plaud',{state:'error',detail:state?.error??'회의록 수집 실패'});if(force)throw e;return {active:false};
 }finally{
  if(state)await db.prepare("UPDATE orbit_plaud_sync SET state_json=json_set(?,'$.enabled',json(CASE WHEN json_extract(state_json,'$.enabled') THEN 'true' ELSE 'false' END)),lease_until=0 WHERE owner_id=? AND lease_until=?").bind(JSON.stringify(state),owner,lease).run();
  else await db.prepare('UPDATE orbit_plaud_sync SET lease_until=0 WHERE owner_id=? AND lease_until=?').bind(owner,lease).run();
 }
}
