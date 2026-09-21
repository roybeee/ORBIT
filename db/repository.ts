import {
  attachmentGate,
  attachmentGateValues,
  bindFiles,
  filesByIds,
} from '../lib/orbit/attachments/storage.ts';
import {
  emptyWorkspace,
  type Note,
  type NoteRevision,
  type ReviewDetail,
  type EventReview,
  type WorkspaceData,
  type WorkspaceSnapshot,
} from '../lib/orbit/model.ts';
import { applyAction, DomainError } from '../lib/orbit/reducer.ts';
import type { WorkspaceAction } from '../lib/orbit/validation.ts';
export type SqlValue = string | number | null;
export interface QueryResult {
  results?: unknown[];
  meta?: { changes?: number };
  success?: boolean;
}
export interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<QueryResult>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<QueryResult[]>;
}
interface Row {
  revision: number;
  state_json: string;
  updated_at: string;
}
interface Receipt {
  action_hash: string;
  revision: number;
}
export interface ProjectRelation {
  entityType:'event'|'task'|'note'|'meeting'|'document';
  entityId:string;
  projectId:string;
  sourceProvider:string;
  sourceId:string|null;
  sourceDate:string|null;
  resolution:'explicit'|'alias'|'existing'|'backfill';
  evidence:string[];
}
interface ProjectRelationRow {
  entity_type:ProjectRelation['entityType'];entity_id:string;project_id:string;source_provider:string;
  source_id:string|null;source_date:string|null;resolution:ProjectRelation['resolution'];evidence_json:string;
}
interface EventReviewRow {review_id:string;event_id:string;project_id:string;title:string;date:string;start:number;end:number;state:EventReview['state'];requested_at:string;resolved_at:string|null;follow_up_at:string|null;next_task_id:string|null}
const reviewFromRow=(row:EventReviewRow):EventReview=>({id:row.review_id,eventId:row.event_id,projectId:row.project_id,title:row.title,date:row.date,start:row.start,end:row.end,state:row.state,requestedAt:row.requested_at,...(row.resolved_at?{resolvedAt:row.resolved_at}:{}),...(row.follow_up_at?{followUpAt:row.follow_up_at}:{}),...(row.next_task_id?{nextTaskId:row.next_task_id}:{})});
function localClock(timeZone:string,now:Date){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(part=>[part.type,part.value]));return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)}}
function zonedEnd(date:string,minute:number,timeZone:string){const target=Date.parse(`${date}T00:00:00Z`)+minute*60000;let utc=target;for(let i=0;i<4;i++){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(utc)).map(part=>[part.type,part.value]));const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);if(local===target)return new Date(utc).toISOString();utc+=target-local}throw new DomainError('일정 종료 시각을 확인할 수 없습니다.')}
type EventRelationRow=Pick<ProjectRelationRow,'entity_type'|'entity_id'|'project_id'|'source_provider'|'source_id'|'source_date'>;
function googleEventSourceId(event:{id:string;date:string}){
  const prefix='google:',suffix=`:${event.date}`;
  return event.id.startsWith(prefix)&&event.id.endsWith(suffix)?event.id.slice(prefix.length,-suffix.length):null;
}
async function eventReviewId(canonicalEventId:string){
  // Keep existing short IDs stable for replay/migration compatibility. Only external IDs
  // that exceed the shared action-ID contract are replaced by a bounded internal key.
  if(canonicalEventId.length<=100)return canonicalEventId;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalEventId));
  return `event-review:${Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
}
function matchEventRelations(events:WorkspaceData['events'],relations:EventRelationRow[]){
  const matches=new Map<string,WorkspaceData['events'][number]>(),byEntity=new Map(events.map(event=>[event.id,event]));
  const currentBySource=new Map<string,WorkspaceData['events']>();
  const relationsBySource=new Map<string,EventRelationRow[]>();
  for(const event of events){
    const sourceId=googleEventSourceId(event);
    if(sourceId===null)continue;
    const key=`google_calendar\0${sourceId}`,values=currentBySource.get(key)??[];
    values.push(event);currentBySource.set(key,values);
  }
  for(const relation of relations){
    if(relation.source_id){
      const key=`${relation.source_provider}\0${relation.source_id}`,values=relationsBySource.get(key)??[];
      values.push(relation);relationsBySource.set(key,values);
    }
    const exact=byEntity.get(relation.entity_id);
    if(exact)matches.set(relation.entity_id,exact);
  }
  // Google singleEvents IDs identify one native instance. Date changes preserve that ID.
  // Only use it as a fallback when both the current event and canonical relation are unique;
  // multi-day slices or duplicate historical rows must not spread a project to another slice.
  for(const [key,candidates] of currentBySource){
    const sourceRelations=relationsBySource.get(key);
    if(candidates.length===1&&sourceRelations?.length===1)matches.set(sourceRelations[0].entity_id,candidates[0]);
  }
  return matches;
}
export async function upsertProjectRelation(db:Database,ownerId:string,relation:ProjectRelation,now=new Date()){
  const timestamp=now.toISOString();
  const row=await db.prepare("SELECT revision,state_json,updated_at FROM orbit_workspaces WHERE owner_id=? AND EXISTS(SELECT 1 FROM json_each(state_json,'$.projects') WHERE json_extract(value,'$.id')=?)").bind(ownerId,relation.projectId).first<Row>();
  if(!row)throw new DomainError('연결할 project가 이 owner의 워크스페이스에 없습니다.');
  const statements=[db.prepare(`INSERT INTO orbit_project_relations(owner_id,entity_type,entity_id,project_id,source_provider,source_id,source_date,resolution,evidence_json,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,entity_type,entity_id) DO UPDATE SET project_id=excluded.project_id,source_provider=excluded.source_provider,source_id=excluded.source_id,source_date=excluded.source_date,resolution=excluded.resolution,evidence_json=excluded.evidence_json,updated_at=excluded.updated_at`)
    .bind(ownerId,relation.entityType,relation.entityId,relation.projectId,relation.sourceProvider,relation.sourceId,relation.sourceDate,relation.resolution,JSON.stringify(relation.evidence),timestamp,timestamp)];
  const data=JSON.parse(row.state_json) as WorkspaceData,linked=data.projects.find(project=>project.id===relation.projectId),today=localClock(data.preferences.timeZone,now).date;
  if(relation.entityType==='event'&&relation.sourceDate&&relation.sourceDate>=today&&linked?.status==='completed'){
    linked.status='active';
    if(linked.statusHistory?.at(-1)?.status!=='active')linked.statusHistory=[...(linked.statusHistory??[]),{status:'active' as const,changedOn:today}].slice(-100);
    const mutation=crypto.randomUUID();
    statements.push(db.prepare('UPDATE orbit_workspaces SET revision=revision+1,state_json=?,mutation_id=?,updated_at=? WHERE owner_id=? AND revision=?').bind(JSON.stringify(data),mutation,timestamp,ownerId,row.revision));
  }
  const result=await db.batch(statements);
  if(result[0]?.meta?.changes!==1)throw new RevisionConflict('프로젝트 일정 연결을 저장하지 못했습니다. 다시 동기화해 주세요.');
  if(statements.length>1&&result[1]?.meta?.changes!==1)throw new RevisionConflict('일정 연결 중 프로젝트가 변경됐습니다. 다시 동기화해 주세요.');
}
export async function readProjectRelation(db:Database,ownerId:string,entityType:ProjectRelation['entityType'],entityId:string):Promise<ProjectRelation|null>{
  const row=await db.prepare('SELECT entity_type,entity_id,project_id,source_provider,source_id,source_date,resolution,evidence_json FROM orbit_project_relations WHERE owner_id=? AND entity_type=? AND entity_id=?').bind(ownerId,entityType,entityId).first<ProjectRelationRow>();
  return row?{entityType:row.entity_type,entityId:row.entity_id,projectId:row.project_id,sourceProvider:row.source_provider,sourceId:row.source_id,sourceDate:row.source_date,resolution:row.resolution,evidence:JSON.parse(row.evidence_json)}:null;
}
export class RevisionConflict extends Error {}
export class NoteNotFound extends Error {}
export async function readWorkspace(db: Database, ownerId: string, now = new Date()): Promise<WorkspaceSnapshot> {
  const row = await db
    .prepare('SELECT revision, state_json, updated_at FROM orbit_workspaces WHERE owner_id = ?')
    .bind(ownerId)
    .first<Row>();
  const data = row ? (JSON.parse(row.state_json) as WorkspaceData) : emptyWorkspace();
  const external = await db
    .prepare('SELECT events_json,time_zone FROM orbit_calendar_cache WHERE owner_id=?')
    .bind(ownerId)
    .first<{ events_json: string; time_zone: string }>();
  if (external?.time_zone === data.preferences.timeZone)
    data.events = [
      ...data.events.filter((e) => !e.id.startsWith('google:')),
      ...JSON.parse(external.events_json),
    ];
  const {results:relations}=await db.prepare("SELECT entity_type,entity_id,project_id,source_provider,source_id,source_date FROM orbit_project_relations WHERE owner_id=? AND entity_type='event'").bind(ownerId).all<EventRelationRow>();
  const matched=matchEventRelations(data.events,relations),linked=new Map<string,string>(),canonical=new Map<string,string>();
  for(const relation of relations){
    const event=matched.get(relation.entity_id);
    if(event){linked.set(event.id,relation.project_id);canonical.set(event.id,relation.entity_id)}
  }
  data.events=data.events.map(event=>linked.has(event.id)?{...event,projectId:linked.get(event.id)}:event);
  const {results:storedReviews}=await db.prepare('SELECT review_id,event_id,project_id,title,date,start,end,state,requested_at,resolved_at,follow_up_at,next_task_id FROM orbit_event_reviews WHERE owner_id=? ORDER BY requested_at,review_id').bind(ownerId).all<EventReviewRow>();
  const byId=new Map(storedReviews.map(review=>[review.review_id,review])),active=new Set<string>(),clock=localClock(data.preferences.timeZone,now),timestamp=now.toISOString();
  for(const event of data.events){
    if(!event.projectId||event.id.startsWith('approved:'))continue;
    const canonicalEventId=canonical.get(event.id)??event.id,reviewId=await eventReviewId(canonicalEventId);active.add(reviewId);
    const ended=event.date<clock.date||(event.date===clock.date&&event.end<=clock.minute),endAt=zonedEnd(event.date,event.end,data.preferences.timeZone),stored=byId.get(reviewId);
    if(!stored&&ended){
      await db.prepare("INSERT OR IGNORE INTO orbit_event_reviews(owner_id,review_id,event_id,project_id,title,date,start,end,state,requested_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending',?,?)").bind(ownerId,reviewId,event.id,event.projectId,event.title,event.date,event.start,event.end,timestamp,timestamp).run();
    }else if(stored){
      let state=stored.state,followUp=stored.follow_up_at;
      if(state==='pending'&&!ended){state='deferred';followUp=endAt}
      else if(state==='deferred'&&ended&&followUp&&Date.parse(followUp)<=now.getTime()){state='pending';followUp=null}
      await db.prepare("UPDATE orbit_event_reviews SET event_id=?,project_id=?,title=?,date=?,start=?,end=?,state=?,follow_up_at=?,updated_at=? WHERE owner_id=? AND review_id=? AND state NOT IN ('completed','cancelled')").bind(event.id,event.projectId,event.title,event.date,event.start,event.end,state,followUp,timestamp,ownerId,reviewId).run();
    }
  }
  for(const review of storedReviews)if(!active.has(review.review_id)&&(review.state==='pending'||review.state==='deferred'))await db.prepare("UPDATE orbit_event_reviews SET state='cancelled',updated_at=? WHERE owner_id=? AND review_id=? AND state IN ('pending','deferred')").bind(timestamp,ownerId,review.review_id).run();
  const {results:reviews}=await db.prepare('SELECT review_id,event_id,project_id,title,date,start,end,state,requested_at,resolved_at,follow_up_at,next_task_id FROM orbit_event_reviews WHERE owner_id=? ORDER BY requested_at,review_id').bind(ownerId).all<EventReviewRow>();
  data.eventReviews=reviews.map(reviewFromRow);
  if (data.schemaVersion !== 2 && data.schemaVersion !== 3) throw new Error('Unsupported workspace schema');
  return { data, revision: row?.revision ?? 0, updatedAt: row?.updated_at ?? null };
}
export async function projectTimeline(db:Database,ownerId:string,projectId:string):Promise<Record<string,unknown>[]>{
  const snapshot=await readWorkspace(db,ownerId),{results}=await db.prepare('SELECT entity_type,entity_id,project_id,source_provider,source_id,source_date FROM orbit_project_relations WHERE owner_id=? ORDER BY source_date DESC,entity_type,entity_id').bind(ownerId).all<EventRelationRow>();
  const eventMatches=matchEventRelations(snapshot.data.events,results.filter(row=>row.entity_type==='event')),timeline:Record<string,unknown>[]=[];
  for(const row of results){
    if(row.project_id!==projectId)continue;
    if(row.entity_type==='event'){const value=eventMatches.get(row.entity_id);if(value)timeline.push({...value,kind:'event',sourceId:row.source_id,sourceDate:row.source_date});continue;}
    if(row.entity_type==='task'){const value=snapshot.data.tasks.find(item=>item.id===row.entity_id);if(value)timeline.push({...value,kind:'task',sourceId:row.source_id,sourceDate:row.source_date});continue;}
    const value=snapshot.data.notes.find(item=>item.id===row.entity_id);if(value)timeline.push({...value,kind:row.entity_type,sourceId:row.source_id,sourceDate:row.source_date});
  }
  return timeline;
}
async function readVersion(db: Database, ownerId: string, id: string, revision: number): Promise<Note> {
  const row = await db
    .prepare('SELECT note_json FROM orbit_note_revisions WHERE owner_id = ? AND note_id = ? AND revision = ?')
    .bind(ownerId, id, revision)
    .first<{ note_json: string }>();
  if (!row) throw new NoteNotFound('기록을 찾을 수 없습니다.');
  return JSON.parse(row.note_json) as Note;
}
export async function readNote(db: Database, ownerId: string, id: string, revision?: number): Promise<Note> {
  const snapshot = await readWorkspace(db, ownerId),
    meta = snapshot.data.notes.find((n) => n.id === id);
  if (!meta) throw new NoteNotFound('기록을 찾을 수 없습니다.');
  const selected = revision ?? meta.revision ?? 1;
  if (selected > (meta.revision ?? 1) || selected < 1)
    throw new NoteNotFound('이전 내용을 찾을 수 없습니다.');
  if (!meta.bodyStored && selected === (meta.revision ?? 1))
    return { ...meta, revision: selected, bodyStored: false };
  return readVersion(db, ownerId, id, selected);
}
export async function searchNotes(
  db: Database,
  ownerId: string,
  options: { query: string; kind: 'wiki' | 'knowledge'; offset: number; expectedRevision?: number },
): Promise<{ items: Note[]; hasMore: boolean; revision: number }> {
  const snapshot = await readWorkspace(db, ownerId);
  if (options.expectedRevision !== undefined && options.expectedRevision !== snapshot.revision)
    throw new RevisionConflict('기록 목록이 변경됐습니다. 최신 내용을 불러와 주세요.');
  const { results } = await db
    .prepare(
      `SELECT meta.value AS metadata FROM json_each(?) AS meta
 LEFT JOIN orbit_note_revisions AS document ON document.owner_id = ? AND document.note_id = json_extract(meta.value, '$.id') AND document.revision = COALESCE(json_extract(meta.value, '$.revision'), 1)
 WHERE (CASE WHEN ? = 'knowledge' THEN json_extract(meta.value, '$.kind') = 'knowledge' ELSE json_extract(meta.value, '$.kind') IN ('meeting', 'wiki') END)
 AND instr(lower(json_extract(meta.value, '$.title') || char(10) || json_extract(meta.value, '$.summary') || char(10) || json_extract(meta.value, '$.tags') || char(10) || COALESCE(json_extract(document.note_json, '$.body'), json_extract(meta.value, '$.body'), '')), lower(?)) > 0
 ORDER BY json_extract(meta.value, '$.updated') DESC, json_extract(meta.value, '$.id') ASC LIMIT 25 OFFSET ?`,
    )
    .bind(JSON.stringify(snapshot.data.notes), ownerId, options.kind, options.query, options.offset)
    .all<{ metadata: string }>();
  return {
    items: results.slice(0, 24).map((row) => ({ ...JSON.parse(row.metadata), body: '' })),
    hasMore: results.length > 24,
    revision: snapshot.revision,
  };
}
export async function listNoteHistory(
  db: Database,
  ownerId: string,
  id: string,
  before?: number,
): Promise<{ items: NoteRevision[]; nextBefore: number | null }> {
  const snapshot = await readWorkspace(db, ownerId),
    meta = snapshot.data.notes.find((n) => n.id === id);
  if (!meta) throw new NoteNotFound('기록을 찾을 수 없습니다.');
  if (!meta.bodyStored)
    return {
      items:
        !before || before > 1
          ? [{ revision: 1, title: meta.title, updatedAt: snapshot.updatedAt ?? meta.updated }]
          : [],
      nextBefore: null,
    };
  const limit = Math.min(before ?? Number.MAX_SAFE_INTEGER, (meta.revision ?? 1) + 1);
  const { results } = await db
    .prepare(
      'SELECT revision, title, updated_at AS updatedAt FROM orbit_note_revisions WHERE owner_id = ? AND note_id = ? AND revision < ? ORDER BY revision DESC LIMIT 11',
    )
    .bind(ownerId, id, limit)
    .all<NoteRevision>();
  return { items: results.slice(0, 10), nextBefore: results.length > 10 ? results[9].revision : null };
}
export async function readReview(db: Database, ownerId: string, date: string): Promise<ReviewDetail | null> {
  const row = await db
    .prepare('SELECT review_json FROM orbit_reviews WHERE owner_id = ? AND date = ?')
    .bind(ownerId, date)
    .first<{ review_json: string }>();
  return row ? (JSON.parse(row.review_json) as ReviewDetail) : null;
}
export async function listReviews(
  db: Database,
  ownerId: string,
  from: string,
  to: string,
): Promise<ReviewDetail[]> {
  const { results } = await db
    .prepare(
      'SELECT review_json FROM orbit_reviews WHERE owner_id = ? AND date >= ? AND date <= ? ORDER BY date ASC LIMIT 62',
    )
    .bind(ownerId, from, to)
    .all<{ review_json: string }>();
  return results.map((row) => JSON.parse(row.review_json) as ReviewDetail);
}
// The snapshot's immutable version pointers make exports stable while notes are edited.
// A concurrent deletion fails the stream; the client only downloads a fully received file.
export function exportWorkspace(
  db: Database,
  ownerId: string,
  snapshot: WorkspaceSnapshot,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder(),
    notes = snapshot.data.notes;
  let index = -1;
  return new ReadableStream({
    async pull(controller) {
      try {
        if (index === -1) {
          const { notes: _, ...data } = snapshot.data;
          const header = JSON.stringify({
            exportedAt: new Date().toISOString(),
            revision: snapshot.revision,
            updatedAt: snapshot.updatedAt,
            data,
          });
          controller.enqueue(encoder.encode(header.slice(0, -2) + ',"notes":['));
          index = 0;
          return;
        }
        if (index < notes.length) {
          const meta = notes[index],
            note = meta.bodyStored ? await readVersion(db, ownerId, meta.id, meta.revision!) : meta;
          controller.enqueue(
            encoder.encode((index ? ',' : '') + JSON.stringify({ ...note, bodyStored: false })),
          );
          index++;
          return;
        }
        // Evening review details live in their own rows; export them after the documents.
        const { results } = await db
          .prepare('SELECT review_json FROM orbit_reviews WHERE owner_id = ? ORDER BY date ASC')
          .bind(ownerId)
          .all<{ review_json: string }>();
        controller.enqueue(
          encoder.encode('],"reviewDetails":[' + results.map((r) => r.review_json).join(',') + ']}}'),
        );
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
async function receipt(db: Database, owner: string, operationId: string) {
  return db
    .prepare('SELECT action_hash, revision FROM orbit_mutations WHERE owner_id = ? AND operation_id = ?')
    .bind(owner, operationId)
    .first<Receipt>();
}
export async function writeCommand(
  db: Database,
  ownerId: string,
  command: { operationId: string; expectedRevision: number; action: WorkspaceAction },
  now = new Date(),
): Promise<WorkspaceSnapshot> {
  const hashBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(command.action)),
  );
  const hash = [...new Uint8Array(hashBytes)].map((v) => v.toString(16).padStart(2, '0')).join('');
  const existing = await receipt(db, ownerId, command.operationId);
  if (existing) {
    if (existing.action_hash !== hash)
      throw new RevisionConflict('같은 요청 번호에 다른 변경이 들어왔습니다. 새로 시도해 주세요.');
    return readWorkspace(db, ownerId, now);
  }
  const current = await readWorkspace(db, ownerId, now);
  if (current.revision !== command.expectedRevision)
    throw new RevisionConflict(
      '다른 기기에서 내용이 변경됐습니다. 최신 내용을 불러온 뒤 다시 적용해 주세요.',
    );
  if(command.action.type==='project.delete'){
    const linked=await db.prepare('SELECT 1 AS found FROM orbit_project_relations WHERE owner_id=? AND project_id=? LIMIT 1').bind(ownerId,command.action.id).first<{found:number}>();
    if(linked)throw new DomainError('연결된 일정이나 기록이 있어 프로젝트를 삭제할 수 없습니다. 먼저 연결을 옮겨 주세요.');
  }
  let action = command.action;
  let working = current.data;
  if (action.type === 'note.restore') {
    const restore = action;
    const meta = current.data.notes.find((n) => n.id === restore.id);
    if (!meta || (meta.revision ?? 1) !== action.expectedNoteRevision)
      throw new RevisionConflict('기록이 변경됐습니다. 최신 내용을 확인한 뒤 복원해 주세요.');
    const note = await readNote(db, ownerId, action.id, action.revision);
    const { revision: _, bodyStored: __, ...fields } = note;
    action = { type: 'note.upsert', note: fields };
  }
  if (action.type === 'meeting.acceptActions') {
    const note = await readNote(db, ownerId, action.noteId);
    if ((note.revision ?? 1) !== action.expectedNoteRevision)
      throw new RevisionConflict('회의록이 변경됐습니다. 최신 내용을 확인해 주세요.');
    working = { ...current.data, notes: current.data.notes.map((n) => (n.id === note.id ? note : n)) };
  }
  if (action.type === 'note.upsert' && action.expectedNoteRevision !== undefined) {
    const editing = action;
    const meta = current.data.notes.find((n) => n.id === editing.note.id);
    if (!meta || (meta.revision ?? 1) !== action.expectedNoteRevision)
      throw new RevisionConflict('기록이 변경됐습니다. 작성 중인 내용을 보관하고 최신 내용을 확인해 주세요.');
  }
  const next = applyAction(working, action, now);
  const resolvedEventReview=action.type==='event.review'?next.eventReviews?.find(review=>review.id===action.reviewId):undefined;
  delete next.eventReviews;
  next.events = next.events.filter((e) => !e.id.startsWith('google:'));
  const timestamp = now.toISOString(),
    revision = current.revision + 1;
  const changedNotes = action.type === 'note.upsert' ? next.notes.filter(n=>n.id===action.note.id) :
    action.type === 'wiki.import' ? next.notes.filter(n=>!current.data.notes.some(old=>old.id===n.id)) : [];
  const legacy = current.data.notes
    .filter((n) => !n.bodyStored)
    .map((n) => ({ ...n, revision: n.revision ?? 1, bodyStored: false }));
  next.schemaVersion = 3;
  next.notes = next.notes.map((n) => ({ ...n, body: '', bodyStored: true, revision: n.revision ?? 1 }));
  if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 950000)
    throw new DomainError('기록 목록의 저장 한도에 도달했습니다. 내보낸 뒤 오래된 기록을 정리해 주세요.');
  const attachmentIds =
    action.type === 'event.upsert' || action.type === 'event.attach' ? action.attachmentIds : undefined;
  const attachmentTarget =
    action.type === 'event.upsert' ? action.event.id : action.type === 'event.attach' ? action.id : '';
  if (attachmentIds) await filesByIds(db, ownerId, attachmentIds);
  const update = db
    .prepare(
      `INSERT INTO orbit_workspaces (owner_id, revision, state_json, mutation_id, updated_at)
 SELECT ?, ?, ?, ?, ? WHERE ${attachmentGate(attachmentIds ?? [])}
 ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision, state_json=excluded.state_json, mutation_id=excluded.mutation_id, updated_at=excluded.updated_at
 WHERE orbit_workspaces.revision = ? AND ${attachmentGate(attachmentIds ?? [])}`,
    )
    .bind(
      ownerId,
      revision,
      JSON.stringify(next),
      command.operationId,
      timestamp,
      ...attachmentGateValues(ownerId, attachmentIds ?? [], 'event', attachmentTarget),
      command.expectedRevision,
      ...attachmentGateValues(ownerId, attachmentIds ?? [], 'event', attachmentTarget),
    );
  const gate =
    'EXISTS (SELECT 1 FROM orbit_workspaces WHERE owner_id = ? AND mutation_id = ? AND revision = ?)';
  const gateValues: SqlValue[] = [ownerId, command.operationId, revision];
  const statements: Statement[] = [update];
  // Lazy v2 migration and the first v3 edit share the winning transaction. No data in SQL migrations.
  if (legacy.length)
    statements.push(
      db
        .prepare(
          `INSERT INTO orbit_note_revisions (owner_id, note_id, revision, title, note_json, updated_at)
 SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.revision'), json_extract(value, '$.title'), value, ? FROM json_each(?) WHERE ${gate}
 ON CONFLICT(owner_id, note_id, revision) DO NOTHING`,
        )
        .bind(ownerId, current.updatedAt ?? timestamp, JSON.stringify(legacy), ...gateValues),
    );
  for (const changedNote of changedNotes)
    statements.push(
      db
        .prepare(
          `INSERT INTO orbit_note_revisions (owner_id, note_id, revision, title, note_json, updated_at)
 SELECT ?, ?, ?, ?, ?, ? WHERE ${gate}`,
        )
        .bind(
          ownerId,
          changedNote.id,
          changedNote.revision!,
          changedNote.title,
          JSON.stringify(changedNote),
          timestamp,
          ...gateValues,
        ),
    );
  if (action.type === 'note.delete')
    statements.push(
      db
        .prepare(`DELETE FROM orbit_note_revisions WHERE owner_id = ? AND note_id = ? AND ${gate}`)
        .bind(ownerId, action.id, ...gateValues),
    );
  if (attachmentIds) {
    statements.push(
      db
        .prepare(
          `UPDATE orbit_attachments SET target_type=NULL,target_id=NULL WHERE owner_id=? AND target_type='event' AND target_id=? AND id NOT IN (SELECT value FROM json_each(?)) AND ${gate}`,
        )
        .bind(ownerId, attachmentTarget, JSON.stringify(attachmentIds), ...gateValues),
    );
    statements.push(...bindFiles(db, ownerId, attachmentIds, 'event', attachmentTarget, gate, gateValues));
  }
  if (action.type === 'event.delete')
    statements.push(
      db
        .prepare(
          `UPDATE orbit_attachments SET target_type=NULL,target_id=NULL WHERE owner_id=? AND target_type='event' AND target_id=? AND ${gate}`,
        )
        .bind(ownerId, action.id, ...gateValues),
    );
  if (action.type === 'project.delete')
    statements.push(
      db
        .prepare(
          `UPDATE orbit_conversations SET project_id=NULL,revision=revision+1,updated_at=? WHERE owner_id=? AND project_id=? AND ${gate}`,
        )
        .bind(timestamp, ownerId, action.id, ...gateValues),
    );
  if(action.type==='event.review'&&resolvedEventReview)
    statements.push(db.prepare(`UPDATE orbit_event_reviews SET state=?,resolved_at=?,follow_up_at=?,next_task_id=?,updated_at=? WHERE owner_id=? AND review_id=? AND state='pending' AND ${gate}`)
      .bind(resolvedEventReview.state,resolvedEventReview.resolvedAt??null,resolvedEventReview.followUpAt??null,resolvedEventReview.nextTaskId??null,timestamp,ownerId,resolvedEventReview.id,...gateValues));
  if ((action.type === 'review.saveGenerate' || action.type === 'review.save') && action.detail)
    statements.push(
      db
        .prepare(
          `INSERT INTO orbit_reviews (owner_id, date, review_json, updated_at)
 SELECT ?, ?, ?, ? WHERE ${gate}
 ON CONFLICT(owner_id, date) DO UPDATE SET review_json=excluded.review_json, updated_at=excluded.updated_at`,
        )
        .bind(ownerId, action.detail.date, JSON.stringify(action.detail), timestamp, ...gateValues),
    );
  statements.push(
    db
      .prepare(
        `INSERT INTO orbit_mutations (owner_id, operation_id, action_hash, revision, created_at)
 SELECT ?, ?, ?, ?, ? WHERE ${gate} ON CONFLICT(owner_id, operation_id) DO NOTHING`,
      )
      .bind(ownerId, command.operationId, hash, revision, timestamp, ...gateValues),
  );
  const results = await db.batch(statements);
  if (results[0]?.meta?.changes !== 1) {
    const replay = await receipt(db, ownerId, command.operationId);
    if (!replay || replay.action_hash !== hash)
      throw new RevisionConflict(
        '다른 기기에서 먼저 저장했습니다. 최신 내용을 불러온 뒤 다시 적용해 주세요.',
      );
  }
  return readWorkspace(db, ownerId, now);
}
