import {z} from 'zod';
import {readWorkspace,type Database} from '../../../db/repository.ts';
import {automaticProject} from '../classify.ts';
import {recordSource} from '../source-status.ts';
import {hermesConfig,hermesRequest} from './hermes.ts';
import type {Runtime} from './integrations.ts';
import {AgentError} from './errors.ts';

export const activityCategories=['general','research','development','meeting','finance','marketing','operations'] as const;
export const categoryLabels:Record<string,string>={general:'일반',research:'조사',development:'개발',meeting:'회의',finance:'재무',marketing:'마케팅',operations:'운영'};
export function redactActivity(value:unknown,token=''){
 let text=typeof value==='string'?value:JSON.stringify(value??'');
 if(token)text=text.replaceAll(token,'[인증정보 숨김]');
 return text.replace(/Bearer\s+[A-Za-z0-9_.\/-]+/gi,'Bearer [숨김]').replace(/(?:sk-[A-Za-z0-9_-]{15,}|github_pat_[A-Za-z0-9_]{15,}|ghp_[A-Za-z0-9]{15,}|xox[baprs]-[A-Za-z0-9-]+)/g,'[인증정보 숨김]').replace(/((?:password|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|secret|비밀번호|인증코드)["']?\s*[:=]\s*)["']?[^\s,"'}]+/gi,'$1[숨김]');
}
export function activityCategory(text:string){
 if(/개발|구현|버그|배포|코드|github|deploy|typescript/i.test(text))return 'development';
 if(/매출|정산|비용|회계|재무|자금|손익/.test(text))return 'finance';
 if(/마케팅|캠페인|광고|브랜딩|콘텐츠/.test(text))return 'marketing';
 if(/회의록|미팅|회의|meeting/i.test(text))return 'meeting';
 if(/조사|리서치|비교|research/i.test(text))return 'research';
 if(/운영|가맹|납품|물류|매장/.test(text))return 'operations';
 return 'general';
}
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const sessionSchema=z.object({id:z.string().min(1).max(250),source:z.string().max(100).nullish(),title:z.string().nullish(),preview:z.string().nullish(),last_active:z.union([z.string(),z.number()]).nullish(),started_at:z.union([z.string(),z.number()]).nullish(),ended_at:z.union([z.string(),z.number()]).nullish(),parent_session_id:z.string().nullish(),message_count:z.number().int().nonnegative().optional()});
type Session=z.infer<typeof sessionSchema>;
interface Cursor {connection?:string;messageVersion?:number;offset:number;pending:Session[];lastSync?:string;lastError?:string;cycles?:number;turns?:number;enabled?:boolean;omissions?:number;quarantine?:{id:string;signature:string;reason:string;retryAt:number}[]}
const sessionSignature=(s:Session)=>JSON.stringify([s.last_active,s.message_count,s.ended_at,s.title]);
const defaults=():Cursor=>({offset:0,pending:[],enabled:true});
const messageRoles=new Set(['user','assistant','tool','system','developer','function']);
const localMessageId=(position:number)=>`orbit-position:${String(position).padStart(12,'0')}`;
function messagePage(value:Record<string,unknown>,offset:number){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.object!=='list'||!Array.isArray(value.data)||value.data.length>50||typeof value.session_id!=='string'||!value.session_id)throw new AgentError('Hermes 대화 원문 형식을 확인하지 못했습니다.','HERMES_FORMAT',502);
 const pagination=value.pagination as Record<string,unknown>|undefined;
 if(pagination&&(typeof pagination!=='object'||Array.isArray(pagination)||(pagination.offset!==undefined&&pagination.offset!==offset)||(pagination.order!==undefined&&pagination.order!=='oldest')||(pagination.returned!==undefined&&pagination.returned!==value.data.length)))throw new AgentError('Hermes 메시지 순서가 요청한 수집 위치와 다릅니다.','HERMES_FORMAT',502);
 return value.data as unknown[];
}
function activityMessage(value:unknown,position:number,token:string){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AgentError('Hermes 메시지가 올바른 객체가 아닙니다.','HERMES_FORMAT',502);
 const m=value as Record<string,unknown>;
 if(typeof m.role!=='string'||!messageRoles.has(m.role))throw new AgentError('Hermes 메시지 역할을 확인하지 못했습니다.','HERMES_FORMAT',502);
 // When a transcript projection omits SQLite row IDs, the requested oldest-first
 // absolute position is stable across overlap/retry; a content hash alone loses repeated turns.
 const positional=m.id===undefined||m.id===null||m.id==='';
 if(!positional&&!(typeof m.id==='string'&&m.id.length<=500)&&!(typeof m.id==='number'&&Number.isSafeInteger(m.id)&&m.id>=0))throw new AgentError('Hermes 메시지 식별자 형식을 확인하지 못했습니다.','HERMES_FORMAT',502);
 const rawId=String(m.id),id=positional?localMessageId(position):rawId.startsWith('orbit-')?'orbit-source:'+rawId:rawId;
 // Do not turn hidden compaction carriers or developer/system prompts into user records.
 const hidden=m.display_kind==='hidden'||m.role==='system'||m.role==='developer';
 const content=hidden?'[시스템 메시지 제외]':redactActivity(m.content,token),tools=!hidden&&m.tool_calls?redactActivity(m.tool_calls,token):'';
 return {id,role:m.role,positional,content:content.slice(0,30000)+(content.length>30000?'\n[긴 메시지 일부만 보관 · Hermes 원본 확인]':''),tool:hidden?'':String(m.tool_name??'').slice(0,150),tools:tools.slice(0,8000),at:String(m.timestamp??'')};
}
export async function activityStatus(db:Database,owner:string){
 const r=await db.prepare('SELECT state_json FROM orbit_activity_sync WHERE owner_id=?').bind(owner).first<{state_json:string}>();
 const state:Cursor=r?JSON.parse(r.state_json):defaults();
 const count=await db.prepare('SELECT COUNT(*) AS sessions,COALESCE(SUM(message_offset),0) AS messages FROM orbit_activity_sessions WHERE owner_id=?').bind(owner).first<{sessions:number;messages:number}>();
  return {enabled:state.enabled!==false,lastSync:state.lastSync??null,lastError:state.lastError??'',pending:state.pending.length,cycles:state.cycles??0,quarantined:state.quarantine?.length??0,...count,coverage:'연결된 Hermes 프로필의 API에 노출된 세션과 하위 에이전트 기록. 숨김·보관 세션과 첨부파일 원본은 제외됩니다.'};
}
export async function syncActivity(db:Database,owner:string,env:Runtime){
 await db.prepare('INSERT OR IGNORE INTO orbit_activity_sync(owner_id,state_json,lease_until) VALUES(?,?,0)').bind(owner,JSON.stringify(defaults())).run();
 const lease=Date.now()+55000,lock=await db.prepare('UPDATE orbit_activity_sync SET lease_until=? WHERE owner_id=? AND lease_until<?').bind(lease,owner,Date.now()).run();
 if(lock.meta?.changes!==1)return {busy:true};
 let state:Cursor=defaults(),sessionAttempt:Session|undefined;
 try{
  const stored=await db.prepare('SELECT state_json FROM orbit_activity_sync WHERE owner_id=?').bind(owner).first<{state_json:string}>();state=JSON.parse(stored!.state_json);
  if(state.enabled===false)return {disabled:true};
  const config=await hermesConfig(db,owner,env),connection=await hash(config.endpoint+'\n'+config.connectionId);
  if(state.connection!==connection)state={...defaults(),connection};
  // Revisit the old missing-ID quarantine once when this transcript parser is deployed.
  if(state.messageVersion!==1)state={...state,messageVersion:1,offset:0,pending:[],quarantine:[]};
  state.turns=(state.turns??0)+1;
  if(state.pending.length&&state.turns%3===0){
   const head=await hermesRequest(config,'/api/sessions?limit=20&offset=0&include_children=true');
   const latest=z.array(sessionSchema).parse(head.data);
   state.pending=[...latest,...state.pending.filter(s=>!latest.some(h=>h.id===s.id))].slice(0,100);
  }
  if(!state.pending.length){
   const page=await hermesRequest(config,`/api/sessions?limit=20&offset=${state.offset}&include_children=true`);
   const parsed=z.array(sessionSchema).safeParse(page.data);if(!parsed.success||page.object!=='list')throw new AgentError('Hermes 세션 목록 형식을 확인하지 못했습니다.','HERMES_FORMAT',502);
   state.pending=parsed.data;state.offset=page.has_more===true?state.offset+20:0;if(!state.offset)state.cycles=(state.cycles??0)+1;
  }
  state.pending=state.pending.filter(s=>!state.quarantine?.some(q=>q.id===s.id&&q.signature===sessionSignature(s)&&q.retryAt>Date.now()));
  // Skip an entire unchanged page in one tick; do not spend two minutes per unchanged session.
  for(let i=0;i<40&&state.pending.length;i++){
   const candidate=state.pending[0],key=await hash(connection+'\n'+candidate.id);
   const known=await db.prepare('SELECT signature FROM orbit_activity_sessions WHERE owner_id=? AND id=?').bind(owner,key).first<{signature:string}>();
   if(known?.signature!==JSON.stringify([candidate.last_active,candidate.message_count,candidate.ended_at,candidate.title]))break;
   state.pending.shift();
  }
  let session=state.pending[0];
  if(session){
   sessionAttempt=session;
   let id=await hash(connection+'\n'+session.id),old=await db.prepare('SELECT * FROM orbit_activity_sessions WHERE owner_id=? AND id=?').bind(owner,id).first<{message_offset:number;signature:string;project_id:string|null;category:string;manual:number;summary:string}>();
   let signature=JSON.stringify([session.last_active,session.message_count,session.ended_at,session.title]);
   if(old?.signature===signature){state.pending.shift();}
   else{
    let offset=old?Math.max(0,old.message_offset-3):0;
    let page;
    try{page=await hermesRequest(config,`/api/sessions/${encodeURIComponent(session.id)}/messages?limit=50&offset=${offset}&order=oldest`);}catch(e){
     if(e instanceof AgentError&&e.code==='HERMES_MISSING'){state.pending.shift();state.omissions=(state.omissions??0)+1;return {omitted:true};}throw e;
    }
    messagePage(page,offset);
    const alias=session.id;
    if(page.session_id!==session.id){
     const canonical=await hermesRequest(config,'/api/sessions/'+encodeURIComponent(page.session_id));
     session=sessionSchema.parse(canonical.session);id=await hash(connection+'\n'+session.id);
     old=await db.prepare('SELECT * FROM orbit_activity_sessions WHERE owner_id=? AND id=?').bind(owner,id).first<{message_offset:number;signature:string;project_id:string|null;category:string;manual:number;summary:string}>();
     offset=old?Math.max(0,old.message_offset-3):0;
     page=await hermesRequest(config,`/api/sessions/${encodeURIComponent(session.id)}/messages?limit=50&offset=${offset}&order=oldest`);
     messagePage(page,offset);
     if(page.session_id!==session.id)throw new AgentError('압축된 대화가 변경되어 다음 수집에서 다시 확인합니다.','HERMES_FORMAT',502);
     signature=JSON.stringify([session.last_active,session.message_count,session.ended_at,session.title]);
    }
    const resolved=page.session_id,now=new Date().toISOString();
    const messages=messagePage(page,offset).map((m,index)=>activityMessage(m,offset+index,config.token));
    if(new Set(messages.map(m=>m.id)).size!==messages.length)throw new AgentError('Hermes 메시지 식별자가 중복되어 다음 수집에서 다시 확인합니다.','HERMES_FORMAT',502);
    const title=redactActivity(session.title||session.preview||'HERMES 대화',config.token).slice(0,180);
    const excerpt=messages.filter(m=>m.role==='user'||m.role==='assistant').map(m=>m.content).join('\n').slice(-5000);
    const summary=excerpt||old?.summary||'';
    const workspace=(await readWorkspace(db,owner)).data,match=automaticProject((title+'\n'+summary).slice(0,5000),workspace.projects);
    const project=old?.manual?old.project_id:(match?.projectId??old?.project_id??null),category=old?.manual?old.category:activityCategory(title+'\n'+summary);
    const more=page.data.length===50,next=offset+page.data.length;
    const meta={aliasSessionId:alias,source:String(session.source??'hermes'),parentSessionId:session.parent_session_id??null,resolvedSessionId:resolved,startedAt:session.started_at??null,endedAt:session.ended_at??null,matched:match?.matched??[],notice:'AI 답변은 검증된 사실과 구분해 검토하세요. 첨부파일은 원문 메시지에 포함된 설명만 보관합니다.'};
    const statements=[db.prepare('INSERT INTO orbit_activity_sessions(owner_id,id,connection_id,session_id,source,title,project_id,category,manual,summary,metadata_json,message_offset,signature,updated_at) VALUES(?,?,?,?,?,?,?,?,0,?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET source=excluded.source,title=excluded.title,project_id=CASE WHEN manual=1 THEN project_id ELSE excluded.project_id END,category=CASE WHEN manual=1 THEN category ELSE excluded.category END,summary=excluded.summary,metadata_json=excluded.metadata_json,message_offset=excluded.message_offset,signature=excluded.signature,updated_at=excluded.updated_at').bind(owner,id,connection,session.id,meta.source,title,project,category,summary,JSON.stringify(meta),next,more?'':signature,now)];
    // If an upstream upgrade restores native IDs, replace positional copies atomically.
    const replaced=messages.flatMap((m,index)=>m.positional?[]:[localMessageId(offset+index)]);
    if(replaced.length)statements.push(db.prepare(`DELETE FROM orbit_activity_messages WHERE owner_id=? AND connection_id=? AND session_id=? AND id IN (${replaced.map(()=>'?').join(',')})`).bind(owner,connection,resolved,...replaced));
    for(const m of messages){
     statements.push(db.prepare('INSERT INTO orbit_activity_messages(owner_id,connection_id,session_id,id,record_id,role,content,tool_name,tool_calls,timestamp) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,connection_id,session_id,id) DO UPDATE SET record_id=excluded.record_id,role=excluded.role,content=excluded.content,tool_name=excluded.tool_name,tool_calls=excluded.tool_calls,timestamp=excluded.timestamp').bind(owner,connection,resolved,m.id,id,m.role,m.content,m.tool,m.tools,m.at));
    }
    await db.batch(statements);state.quarantine=state.quarantine?.filter(q=>q.id!==alias&&q.id!==session.id);if(!more)state.pending.shift();else state.pending[0]=session;
   }
  }
  state.lastSync=new Date().toISOString();state.lastError=state.quarantine?.length?`형식 확인이 필요한 대화 ${state.quarantine.length}개는 분리해 재확인합니다. 나머지 기록은 계속 수집합니다.`:'';
  await recordSource(db,owner,'hermes_activity',{state:state.pending.length||state.offset||state.quarantine?.length?'partial':'ok',detail:state.lastError||'Hermes 채널 기록 수집 중 · 숨김/보관 세션 및 첨부 원본 제외'});
  return {synced:true,pending:state.pending.length};
 }catch(e){
  if(sessionAttempt&&e instanceof AgentError&&e.code==='HERMES_FORMAT'){
   state.quarantine=[...(state.quarantine??[]).filter(q=>q.id!==sessionAttempt!.id),{id:sessionAttempt.id,signature:sessionSignature(sessionAttempt),reason:e.message,retryAt:Date.now()+15*60000}].slice(-100);
   state.pending=state.pending.filter(s=>s.id!==sessionAttempt!.id);
  }
  state.lastError=e instanceof AgentError?e.message:'Hermes 기록 수집 실패 · 저장된 위치에서 다시 시도합니다.';await recordSource(db,owner,'hermes_activity',{state:'error',detail:state.lastError});throw e;
 }
 finally{await db.prepare('UPDATE orbit_activity_sync SET state_json=?,lease_until=0 WHERE owner_id=? AND lease_until=?').bind(JSON.stringify(state),owner,lease).run();}
}
export async function listActivity(db:Database,owner:string,options:{query?:string;source?:string;project?:string;offset?:number}={}){
 const {query='',source='',project='',offset=0}=options;
 const rows=await db.prepare("SELECT s.* FROM orbit_activity_sessions s WHERE s.owner_id=? AND (?='' OR source=?) AND (?='' OR COALESCE(project_id,'')=?) AND (?='' OR instr(lower(title||char(10)||summary),lower(?))>0 OR EXISTS(SELECT 1 FROM orbit_activity_messages m WHERE m.owner_id=s.owner_id AND m.record_id=s.id AND instr(lower(m.content),lower(?))>0)) ORDER BY updated_at DESC,id DESC LIMIT 21 OFFSET ?").bind(owner,source,source,project,project==='unassigned'?'':project,query,query,query,offset).all<Record<string,unknown>>();
 const sources=await db.prepare('SELECT source,COUNT(*) AS count FROM orbit_activity_sessions WHERE owner_id=? GROUP BY source').bind(owner).all<{source:string;count:number}>();
 return {items:rows.results.slice(0,20),hasMore:rows.results.length>20,sources:sources.results,status:await activityStatus(db,owner)};
}
export async function activityDetail(db:Database,owner:string,id:string,offset=0){
 const row=await db.prepare('SELECT * FROM orbit_activity_sessions WHERE owner_id=? AND id=?').bind(owner,id).first<Record<string,unknown>>();if(!row)throw new AgentError('기록을 찾지 못했습니다.','NOT_FOUND',404);
 const messages=await db.prepare('SELECT id,role,content,tool_name,tool_calls,timestamp FROM orbit_activity_messages WHERE owner_id=? AND record_id=? ORDER BY timestamp,id LIMIT 101 OFFSET ?').bind(owner,id,offset).all<Record<string,unknown>>();
 return {record:row,messages:messages.results.slice(0,100),hasMore:messages.results.length>100};
}
export async function classifyActivity(db:Database,owner:string,id:string,projectId:string|null,category:string){
 if(projectId&&!(await readWorkspace(db,owner)).data.projects.some(p=>p.id===projectId))throw new AgentError('프로젝트를 확인해 주세요.');
 const result=await db.prepare('UPDATE orbit_activity_sessions SET project_id=?,category=?,manual=1 WHERE owner_id=? AND id=?').bind(projectId,category,owner,id).run();if(result.meta?.changes!==1)throw new AgentError('기록을 찾지 못했습니다.','NOT_FOUND',404);
}
