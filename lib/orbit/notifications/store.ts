import type {Database} from '../../../db/repository.ts';
import {holdMessage,listHolds,waitsForLimit} from '../agent/provider-hold.ts';
export type OrbitNotification={id:string;kind:'approval'|'completed'|'failed'|'info';title:string;body:string;href:string;createdAt:string;readAt:string|null};
export async function notificationState(db:Database,owner:string){
 await db.prepare("INSERT OR IGNORE INTO orbit_notification_state(owner_id,started_at) VALUES(?,?)").bind(owner,new Date().toISOString()).run();
 return (await db.prepare('SELECT * FROM orbit_notification_state WHERE owner_id=?').bind(owner).first<{started_at:string;public_key:string;private_key:string}>())!;
}
export function notificationStatement(db:Database,owner:string,n:Omit<OrbitNotification,'readAt'>,gate='1',values:(string|number|null)[]=[]){
 return db.prepare(`INSERT OR IGNORE INTO orbit_notifications(owner_id,id,kind,title,body,href,created_at) SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(owner,n.id,n.kind,n.title.slice(0,180),n.body.slice(0,1200),n.href,n.createdAt,...values);
}
export async function notify(db:Database,owner:string,n:Omit<OrbitNotification,'readAt'>){await notificationStatement(db,owner,n).run();}
// Reconstruct notifications from durable receipts, so a crash after a business
// commit cannot lose its notification. Stable event IDs prevent repeated alerts.
export async function collectNotifications(db:Database,owner:string){
 const state=await notificationState(db,owner),now=new Date().toISOString();
 const turns=await db.prepare(`SELECT t.id,t.input,t.status,t.response_json,t.conversation_id,t.updated_at,r.note_id,r.summary,
 EXISTS(SELECT 1 FROM orbit_daily_runs d WHERE d.owner_id=t.owner_id AND json_extract(d.state_json,'$.id')=t.id) AS planning,
 (SELECT count(*) FROM orbit_agent_actions a WHERE a.owner_id=t.owner_id AND a.turn_id=t.id AND a.state='pending') AS pending
 FROM orbit_agent_turns t LEFT JOIN orbit_meeting_reviews r ON r.owner_id=t.owner_id AND r.turn_id=t.id
 WHERE t.owner_id=? AND (t.updated_at>=? OR EXISTS(SELECT 1 FROM orbit_agent_actions a WHERE a.owner_id=t.owner_id AND a.turn_id=t.id AND a.state='pending'))
 AND t.status IN ('completed','failed') ORDER BY t.updated_at DESC LIMIT 250`).bind(owner,state.started_at).all<{id:string;input:string;status:string;response_json:string;conversation_id:string;updated_at:string;note_id:string|null;summary:string|null;planning:number;pending:number}>();
 const writes=[];
 for(const t of turns.results){const response=JSON.parse(t.response_json),meeting=!!t.note_id,kind=t.status==='failed'?'failed':t.pending?'approval':'completed';
  // Automatic work stopped by a provider limit is waiting, not failed: the single hold notice below speaks for it.
  if(t.status==='failed'&&(meeting||t.planning)&&waitsForLimit(String(response.error??'')))continue;
  const title=meeting?(kind==='failed'?'회의 분석 실패':t.pending?`회의 요약 완료 · ${t.pending}건 결재 대기`:'회의 요약 완료'):(kind==='failed'?'업무 처리 실패':t.pending?`${t.pending}건 승인 요청`:'업무 처리 완료');
  writes.push(notificationStatement(db,owner,{id:'turn:'+t.id+':'+(t.status==='failed'?'failed':t.pending?'approval':'completed'),kind,title,body:String(response.error||response.text||t.input).slice(0,1200),href:meeting?'/?note='+encodeURIComponent(t.note_id!):'/?conversation='+encodeURIComponent(t.conversation_id),createdAt:t.updated_at}));
 }
 const reviews=await db.prepare("SELECT r.*,n.title FROM orbit_meeting_reviews r LEFT JOIN orbit_note_revisions n ON n.owner_id=r.owner_id AND n.note_id=r.note_id AND n.revision=r.revision WHERE r.owner_id=? AND r.status IN ('waiting_source','failed') ORDER BY r.created_at DESC LIMIT 100").bind(owner).all<{note_id:string;revision:number;turn_id:string;status:string;error:string;updated_at:string;title:string|null}>();
 for(const r of reviews.results.filter(r=>r.status!=='failed'||!turns.results.some(t=>t.id===r.turn_id)))writes.push(notificationStatement(db,owner,{id:'meeting:'+r.note_id+':'+r.revision+':'+r.status,kind:r.status!=='queued'?'failed':'info',title:r.status==='waiting_source'?'회의 원문 수집 대기':r.status==='failed'?'회의 분석 실패':'회의록 접수 · 자동 분석 중',body:(r.title||'회의록')+(r.error?' · '+r.error:''),href:'/?note='+encodeURIComponent(r.note_id),createdAt:r.updated_at}));
 for(const hold of await listHolds(db,owner,state.started_at)){
  writes.push(notificationStatement(db,owner,{id:'hold:'+hold.id,kind:'info',title:'AI 분석 대기 중',body:'기존 계획과 결과 기록은 사용 가능합니다. '+holdMessage(hold),href:'/',createdAt:hold.openedAt}));
  if(hold.clearedAt)writes.push(notificationStatement(db,owner,{id:'hold:'+hold.id+':recovered',kind:'completed',title:'AI 분석 재개',body:'AI 사용량 한도가 회복되어 대기하던 분석을 순서대로 이어서 진행합니다.',href:'/',createdAt:hold.clearedAt}));
 }
 const orders=await db.prepare('SELECT id,state_json FROM orbit_agent_orders WHERE owner_id=?').bind(owner).all<{id:string;state_json:string}>();
 for(const row of orders.results){const o=JSON.parse(row.state_json);if(!['waiting_for_approval','completed','failed'].includes(o.status)||o.status!=='waiting_for_approval'&&o.updatedAt<state.started_at)continue;
  const kind=o.status==='waiting_for_approval'?'approval':o.status==='failed'?'failed':'completed';
  writes.push(notificationStatement(db,owner,{id:'order:'+row.id+':'+o.status+':'+(o.status==='waiting_for_approval'?o.approval?.id??'wait':o.updatedAt),kind,title:kind==='approval'?'업무 진행 중 승인 필요':kind==='failed'?'업무 실행 실패':'업무 실행 완료 · 결과 확인',body:[o.title,o.error||o.output||o.message||''].filter(Boolean).join(' · '),href:'/?order='+encodeURIComponent(row.id)+'#agent',createdAt:o.updatedAt||now}));
 }
 for(let i=0;i<writes.length;i+=40)await db.batch(writes.slice(i,i+40));
 // One failing dependency can repeat the same notification for every retried record
 // (225 identical "회의 분석 실패" rows in one day). The inbox keeps them all as a log,
 // but a device is alerted once per title and kind: the oldest unread record of a group
 // represents it, and a group already delivered inside the window is skipped.
 const day=new Date(Date.now()-86400000).toISOString(),group=new Date(Date.now()-21600000).toISOString();
 await db.prepare(`INSERT OR IGNORE INTO orbit_push_deliveries(owner_id,notification_id,subscription_id)
 SELECT n.owner_id,n.id,s.id FROM orbit_notifications n JOIN orbit_push_subscriptions s ON s.owner_id=n.owner_id
 WHERE n.owner_id=? AND n.created_at>=s.created_at AND n.created_at>=? AND n.read_at IS NULL AND n.dismissed_at IS NULL
 AND n.id=(SELECT m.id FROM orbit_notifications m WHERE m.owner_id=n.owner_id AND m.kind=n.kind AND m.title=n.title
  AND m.created_at>=? AND m.read_at IS NULL AND m.dismissed_at IS NULL ORDER BY m.created_at,m.id LIMIT 1)
 AND NOT EXISTS(SELECT 1 FROM orbit_push_deliveries d JOIN orbit_notifications o ON o.owner_id=d.owner_id AND o.id=d.notification_id
  WHERE d.owner_id=n.owner_id AND d.subscription_id=s.id AND o.kind=n.kind AND o.title=n.title AND o.created_at>=? AND o.id<>n.id)`)
 .bind(owner,day,group,group).run();
}
export async function listNotifications(db:Database,owner:string,before?:string){
 const rows=await db.prepare('SELECT * FROM orbit_notifications WHERE owner_id=? AND dismissed_at IS NULL AND (? IS NULL OR created_at<?) ORDER BY created_at DESC,id DESC LIMIT 51').bind(owner,before??null,before??null).all<{id:string;kind:OrbitNotification['kind'];title:string;body:string;href:string;created_at:string;read_at:string|null}>();
 const count=await db.prepare('SELECT count(*) AS n FROM orbit_notifications WHERE owner_id=? AND dismissed_at IS NULL AND read_at IS NULL').bind(owner).first<{n:number}>();
 return {items:rows.results.slice(0,50).map(r=>({id:r.id,kind:r.kind,title:r.title,body:r.body,href:r.href,createdAt:r.created_at,readAt:r.read_at} as OrbitNotification)),unread:count?.n??0,hasMore:rows.results.length>50};
}
// Collection rebuilds notifications from durable receipts with stable IDs, so a row
// cannot simply be deleted: the next refresh would insert it again. The row stays and
// carries the dismissal, which INSERT OR IGNORE leaves untouched.
export async function dismissNotifications(db:Database,owner:string,ids:string[]){
 if(!ids.length)return;
 const now=new Date().toISOString();
 await db.prepare(`UPDATE orbit_notifications SET dismissed_at=?,read_at=COALESCE(read_at,?) WHERE owner_id=? AND id IN (${ids.map(()=>'?').join(',')})`).bind(now,now,owner,...ids).run();
}
export async function readNotifications(db:Database,owner:string,ids:string[],through?:string){
 if(through)await db.prepare('UPDATE orbit_notifications SET read_at=? WHERE owner_id=? AND read_at IS NULL AND created_at<=?').bind(new Date().toISOString(),owner,through).run();
 else if(ids.length)await db.prepare(`UPDATE orbit_notifications SET read_at=? WHERE owner_id=? AND id IN (${ids.map(()=>'?').join(',')})`).bind(new Date().toISOString(),owner,...ids).run();
}
