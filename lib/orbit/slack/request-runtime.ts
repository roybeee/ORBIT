import {readWorkspace,type Database} from '../../../db/repository.ts';
import type {Runtime} from '../agent/integrations.ts';
import {runAgent} from '../agent/runner.ts';
import {driveAgent} from '../agent/driver.ts';
import {directChatConfigured} from '../agent/direct-model.ts';
import {activeHold,classifyLimit,waitsForLimit} from '../agent/provider-hold.ts';
import {notify} from '../notifications/store.ts';
import {SLACK_REQUEST_CONVERSATION,summarize} from './request-view.ts';

// Resumes Slack requests that a provider limit stopped: one at a time, each exactly once per claim.
// The resume is an Orbit turn that may only propose approval cards; nothing is registered unapproved.
const UNCONFIRMED_AFTER_MS=30*60000;
const CLAIM_LEASE_MS=10*60000;
// Same provider choice runAgent makes for a turn without planning or attachments.
const resumeProvider=(env:Runtime)=>directChatConfigured(env)?'openai' as const:'hermes' as const;
type Row={id:string;text:string;channel_id:string;created_at:string;status:string;turn_id:string;conversation_id:string};

function resumeMessage(row:Row,timeZone:string){
 const received=new Intl.DateTimeFormat('ko-KR',{timeZone,year:'numeric',month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(row.created_at));
 return [
  `Slack 보관 요청 복구 · ${received}에 Slack으로 보낸 제 지시입니다. 당시 AI 사용량 한도로 처리되지 않아 원문을 보관했습니다.`,
  '원문을 해석해 필요한 일정·할 일·메모를 승인 카드(proposals)로만 준비해 주세요. 실제 등록은 제 승인 후에만 진행합니다.',
  '- 날짜가 없으면 접수한 날 기준으로 해석하고, 여러 건이면 건마다 카드를 하나씩 만드세요.',
  '- 일정은 event.upsert로 만들고 참석자와 안건은 description에 적으세요.',
  '- 예정 시각이 이미 지났더라도 원문대로 카드를 만드세요. 지난 일정은 등록 전에 제가 새 시간을 정합니다.',
  '- 원문에 없는 참석자·시간·안건은 지어내지 말고, 꼭 필요한 정보가 없으면 카드 대신 질문하세요.',
  '원문:',
  row.text,
 ].join('\n');
}

// Reconciles finished resumes and flags requests that never got an outcome from Slack.
async function reconcile(db:Database,owner:string){
 const done=await db.prepare("SELECT r.id,r.text,r.turn_id,r.conversation_id,t.status AS turn_status,COALESCE(json_extract(t.response_json,'$.error'),'') AS error FROM orbit_slack_requests r JOIN orbit_agent_turns t ON t.owner_id=r.owner_id AND t.id=r.turn_id WHERE r.owner_id=? AND r.status='processing' AND t.status IN ('completed','failed')").bind(owner).all<{id:string;text:string;turn_id:string;conversation_id:string;turn_status:string;error:string}>();
 const now=new Date().toISOString();
 for(const r of done.results){
  const limited=r.turn_status==='failed'&&waitsForLimit(r.error);
  // A resume stopped by a limit waits again without spending an attempt.
  const next=r.turn_status==='completed'?"status='done'":limited?`status='waiting_quota',attempts=MAX(0,attempts-1),reason_kind='${classifyLimit(r.error)?.kind==='rate_limit'?'rate_limit':'quota'}'`:"status='failed',reason_kind='other'";
  const changed=await db.prepare(`UPDATE orbit_slack_requests SET ${next},reason=?,updated_at=? WHERE owner_id=? AND id=? AND turn_id=? AND status='processing'`).bind(r.turn_status==='completed'?'':r.error.slice(0,300),now,owner,r.id,r.turn_id).run();
  if(changed.meta?.changes!==1||r.turn_status!=='completed')continue;
  const cards=await db.prepare("SELECT count(*) AS n FROM orbit_agent_actions WHERE owner_id=? AND turn_id=? AND state='pending'").bind(owner,r.turn_id).first<{n:number}>();
  if(cards?.n)await notify(db,owner,{id:'slack-request:'+r.id+':'+r.turn_id,kind:'approval',title:`Slack 보관 요청 초안 ${cards.n}건`,body:summarize(r.text)+' · 결재함에서 확인 후 등록하세요.',href:'/?conversation='+encodeURIComponent(r.conversation_id),createdAt:now}).catch(()=>{});
 }
 await db.prepare("UPDATE orbit_slack_requests SET status='unconfirmed',updated_at=? WHERE owner_id=? AND status='received' AND created_at<?").bind(now,owner,new Date(Date.now()-UNCONFIRMED_AFTER_MS).toISOString()).run();
 // A worker that died between claiming a request and creating its turn must not block every resume:
 // with no turn after the lease, the request waits again (nothing was sent for it).
 await db.prepare("UPDATE orbit_slack_requests SET status='waiting_quota',attempts=MAX(0,attempts-1),updated_at=? WHERE owner_id=? AND status='processing' AND updated_at<? AND NOT EXISTS(SELECT 1 FROM orbit_agent_turns t WHERE t.owner_id=orbit_slack_requests.owner_id AND t.id=orbit_slack_requests.turn_id)").bind(now,owner,new Date(Date.now()-CLAIM_LEASE_MS).toISOString()).run();
}

export async function advanceSlackRequests(db:Database,owner:string,env?:Runtime){
 await reconcile(db,owner);
 if(!env)return {active:false};
 if(await db.prepare("SELECT 1 FROM orbit_slack_requests WHERE owner_id=? AND status='processing' LIMIT 1").bind(owner).first())return {active:true};
 // A request the owner asked to process again starts now; limit-stopped ones wait for the shared hold.
 let row=await db.prepare("SELECT * FROM orbit_slack_requests WHERE owner_id=? AND status='queued' ORDER BY created_at LIMIT 1").bind(owner).first<Row>();
 if(!row){
  const hold=await activeHold(db,owner,resumeProvider(env));
  if(hold&&(Date.now()<hold.nextCheckAt||hold.probeUntil>Date.now()))return {active:false};
  row=await db.prepare("SELECT * FROM orbit_slack_requests WHERE owner_id=? AND status='waiting_quota' ORDER BY created_at LIMIT 1").bind(owner).first<Row>();
 }
 if(!row)return {active:false};
 const now=new Date().toISOString(),turnId=crypto.randomUUID(),conversationId=SLACK_REQUEST_CONVERSATION+row.id;
 // One statement claims the single running slot and fixes the turn id: a second worker cannot resume it again.
 const claimed=await db.prepare("UPDATE orbit_slack_requests SET status='processing',turn_id=?,conversation_id=?,attempts=attempts+1,updated_at=? WHERE owner_id=? AND id=? AND status=? AND NOT EXISTS(SELECT 1 FROM orbit_slack_requests r WHERE r.owner_id=? AND r.status='processing')")
  .bind(turnId,conversationId,now,owner,row.id,row.status,owner).run();
 if(claimed.meta?.changes!==1)return {active:true};
 const manual=row.status==='queued';
 try{
  const timeZone=(await readWorkspace(db,owner)).data.preferences.timeZone;
  await db.prepare('INSERT OR IGNORE INTO orbit_conversations(owner_id,id,title,project_id,revision,created_at,updated_at) VALUES(?,?,?,NULL,0,?,?)').bind(owner,conversationId,('Slack 보관 요청 · '+summarize(row.text)).slice(0,100),now,now).run();
  await runAgent(db,owner,{id:turnId,conversationId,message:resumeMessage(row,timeZone),slackRequest:{id:row.id,manual},retryFailed:true},env,{defer:true});
 }catch(error){
  await db.prepare("UPDATE orbit_slack_requests SET status='failed',reason_kind='other',reason=?,updated_at=? WHERE owner_id=? AND id=? AND turn_id=? AND status='processing'").bind((error instanceof Error?error.message:'보관 요청 처리 준비 실패').slice(0,300),new Date().toISOString(),owner,row.id,turnId).run();
 }
 return {active:true};
}

// Scheduled worker: reconcile, start at most one resume, move it forward, reconcile again.
export async function processSlackRequests(db:Database,owner:string,env:Runtime){
 await advanceSlackRequests(db,owner,env);
 const row=await db.prepare("SELECT turn_id FROM orbit_slack_requests WHERE owner_id=? AND status='processing' LIMIT 1").bind(owner).first<{turn_id:string}>();
 if(row)try{await driveAgent(db,owner,row.turn_id,env,{maxMs:25000,allowExternalReads:false})}catch{/* the durable turn records its error */}
 await advanceSlackRequests(db,owner);
 return {active:!!row};
}
