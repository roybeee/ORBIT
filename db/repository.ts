import {emptyWorkspace,type Note,type NoteRevision,type WorkspaceData,type WorkspaceSnapshot} from '../lib/orbit/model.ts';
import {applyAction,DomainError} from '../lib/orbit/reducer.ts';
import type {WorkspaceAction} from '../lib/orbit/validation.ts';
export type SqlValue=string|number|null;
export interface QueryResult {results?:unknown[];meta?:{changes?:number};success?:boolean}
export interface Statement {bind(...values:SqlValue[]):Statement;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>;run():Promise<QueryResult>}
export interface Database {prepare(sql:string):Statement;batch(statements:Statement[]):Promise<QueryResult[]>}
interface Row {revision:number;state_json:string;updated_at:string}
interface Receipt {action_hash:string;revision:number}
export class RevisionConflict extends Error{}
export class NoteNotFound extends Error{}
export async function readWorkspace(db:Database,ownerId:string):Promise<WorkspaceSnapshot>{
 const row=await db.prepare('SELECT revision, state_json, updated_at FROM orbit_workspaces WHERE owner_id = ?').bind(ownerId).first<Row>();
 if(!row)return {data:emptyWorkspace(),revision:0,updatedAt:null};
 const data=JSON.parse(row.state_json) as WorkspaceData;
 if(data.schemaVersion!==2&&data.schemaVersion!==3)throw new Error('Unsupported workspace schema');
 return {data,revision:row.revision,updatedAt:row.updated_at};
}
async function readVersion(db:Database,ownerId:string,id:string,revision:number):Promise<Note>{
 const row=await db.prepare('SELECT note_json FROM orbit_note_revisions WHERE owner_id = ? AND note_id = ? AND revision = ?').bind(ownerId,id,revision).first<{note_json:string}>();
 if(!row)throw new NoteNotFound('기록을 찾을 수 없습니다.');
 return JSON.parse(row.note_json) as Note;
}
export async function readNote(db:Database,ownerId:string,id:string,revision?:number):Promise<Note>{
 const snapshot=await readWorkspace(db,ownerId),meta=snapshot.data.notes.find(n=>n.id===id);
 if(!meta)throw new NoteNotFound('기록을 찾을 수 없습니다.');
 const selected=revision??meta.revision??1;
 if(selected>(meta.revision??1)||selected<1)throw new NoteNotFound('이전 내용을 찾을 수 없습니다.');
 if(!meta.bodyStored&&selected===(meta.revision??1))return {...meta,revision:selected,bodyStored:false};
 return readVersion(db,ownerId,id,selected);
}
export async function searchNotes(db:Database,ownerId:string,options:{query:string;kind:'wiki'|'knowledge';offset:number;expectedRevision?:number}):Promise<{items:Note[];hasMore:boolean;revision:number}>{
 const snapshot=await readWorkspace(db,ownerId);
 if(options.expectedRevision!==undefined&&options.expectedRevision!==snapshot.revision)throw new RevisionConflict('기록 목록이 변경됐습니다. 최신 내용을 불러와 주세요.');
 const {results}=await db.prepare(`SELECT meta.value AS metadata FROM json_each(?) AS meta
 LEFT JOIN orbit_note_revisions AS document ON document.owner_id = ? AND document.note_id = json_extract(meta.value, '$.id') AND document.revision = COALESCE(json_extract(meta.value, '$.revision'), 1)
 WHERE (CASE WHEN ? = 'knowledge' THEN json_extract(meta.value, '$.kind') = 'knowledge' ELSE json_extract(meta.value, '$.kind') IN ('meeting', 'wiki') END)
 AND instr(lower(json_extract(meta.value, '$.title') || char(10) || json_extract(meta.value, '$.summary') || char(10) || json_extract(meta.value, '$.tags') || char(10) || COALESCE(json_extract(document.note_json, '$.body'), json_extract(meta.value, '$.body'), '')), lower(?)) > 0
 ORDER BY json_extract(meta.value, '$.updated') DESC, json_extract(meta.value, '$.id') ASC LIMIT 25 OFFSET ?`).bind(JSON.stringify(snapshot.data.notes),ownerId,options.kind,options.query,options.offset).all<{metadata:string}>();
 return {items:results.slice(0,24).map(row=>({...JSON.parse(row.metadata),body:''})),hasMore:results.length>24,revision:snapshot.revision};
}
export async function listNoteHistory(db:Database,ownerId:string,id:string,before?:number):Promise<{items:NoteRevision[];nextBefore:number|null}>{
 const snapshot=await readWorkspace(db,ownerId),meta=snapshot.data.notes.find(n=>n.id===id);
 if(!meta)throw new NoteNotFound('기록을 찾을 수 없습니다.');
 if(!meta.bodyStored)return {items:!before||before>1?[{revision:1,title:meta.title,updatedAt:snapshot.updatedAt??meta.updated}]:[],nextBefore:null};
 const limit=Math.min(before??Number.MAX_SAFE_INTEGER,(meta.revision??1)+1);
 const {results}=await db.prepare('SELECT revision, title, updated_at AS updatedAt FROM orbit_note_revisions WHERE owner_id = ? AND note_id = ? AND revision < ? ORDER BY revision DESC LIMIT 11').bind(ownerId,id,limit).all<NoteRevision>();
 return {items:results.slice(0,10),nextBefore:results.length>10?results[9].revision:null};
}
// The snapshot's immutable version pointers make exports stable while notes are edited.
// A concurrent deletion fails the stream; the client only downloads a fully received file.
export function exportWorkspace(db:Database,ownerId:string,snapshot:WorkspaceSnapshot):ReadableStream<Uint8Array>{
 const encoder=new TextEncoder(),notes=snapshot.data.notes;
 let index=-1;
 return new ReadableStream({async pull(controller){try{
  if(index===-1){const {notes:_,...data}=snapshot.data;const header=JSON.stringify({exportedAt:new Date().toISOString(),revision:snapshot.revision,updatedAt:snapshot.updatedAt,data});controller.enqueue(encoder.encode(header.slice(0,-2)+',"notes":['));index=0;return}
  if(index<notes.length){const meta=notes[index],note=meta.bodyStored?await readVersion(db,ownerId,meta.id,meta.revision!):meta;controller.enqueue(encoder.encode((index?',':'')+JSON.stringify({...note,bodyStored:false})));index++;return}
  controller.enqueue(encoder.encode(']}}'));controller.close();
 }catch(error){controller.error(error)}}});
}
async function receipt(db:Database,owner:string,operationId:string){return db.prepare('SELECT action_hash, revision FROM orbit_mutations WHERE owner_id = ? AND operation_id = ?').bind(owner,operationId).first<Receipt>()}
export async function writeCommand(db:Database,ownerId:string,command:{operationId:string;expectedRevision:number;action:WorkspaceAction},now=new Date()):Promise<WorkspaceSnapshot>{
 const hashBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(command.action)));
 const hash=[...new Uint8Array(hashBytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
 const existing=await receipt(db,ownerId,command.operationId);
 if(existing){if(existing.action_hash!==hash)throw new RevisionConflict('같은 요청 번호에 다른 변경이 들어왔습니다. 새로 시도해 주세요.');return readWorkspace(db,ownerId)}
 const current=await readWorkspace(db,ownerId);
 if(current.revision!==command.expectedRevision)throw new RevisionConflict('다른 기기에서 내용이 변경됐습니다. 최신 내용을 불러온 뒤 다시 적용해 주세요.');
 let action=command.action;
 let working=current.data;
 if(action.type==='note.restore'){
  const restore=action;
  const meta=current.data.notes.find(n=>n.id===restore.id);
  if(!meta||(meta.revision??1)!==action.expectedNoteRevision)throw new RevisionConflict('기록이 변경됐습니다. 최신 내용을 확인한 뒤 복원해 주세요.');
  const note=await readNote(db,ownerId,action.id,action.revision);
  const {revision:_,bodyStored:__,...fields}=note;
  action={type:'note.upsert',note:fields};
 }
 if(action.type==='meeting.acceptActions'){
  const note=await readNote(db,ownerId,action.noteId);
  if((note.revision??1)!==action.expectedNoteRevision)throw new RevisionConflict('회의록이 변경됐습니다. 최신 내용을 확인해 주세요.');
  working={...current.data,notes:current.data.notes.map(n=>n.id===note.id?note:n)};
 }
 if(action.type==='note.upsert'&&action.expectedNoteRevision!==undefined){const editing=action;const meta=current.data.notes.find(n=>n.id===editing.note.id);if(!meta||(meta.revision??1)!==action.expectedNoteRevision)throw new RevisionConflict('기록이 변경됐습니다. 작성 중인 내용을 보관하고 최신 내용을 확인해 주세요.')}
 const next=applyAction(working,action,now);
 const timestamp=now.toISOString(),revision=current.revision+1;
 const changedNote=action.type==='note.upsert'?next.notes.find(n=>n.id===action.note.id):undefined;
 const legacy=current.data.notes.filter(n=>!n.bodyStored).map(n=>({...n,revision:n.revision??1,bodyStored:false}));
 next.schemaVersion=3;
 next.notes=next.notes.map(n=>({...n,body:'',bodyStored:true,revision:n.revision??1}));
 if(new TextEncoder().encode(JSON.stringify(next)).byteLength>950000)throw new DomainError('기록 목록의 저장 한도에 도달했습니다. 내보낸 뒤 오래된 기록을 정리해 주세요.');
 const update=db.prepare(`INSERT INTO orbit_workspaces (owner_id, revision, state_json, mutation_id, updated_at)
 VALUES (?, ?, ?, ?, ?)
 ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision, state_json=excluded.state_json, mutation_id=excluded.mutation_id, updated_at=excluded.updated_at
 WHERE orbit_workspaces.revision = ?`).bind(ownerId,revision,JSON.stringify(next),command.operationId,timestamp,command.expectedRevision);
 const gate='EXISTS (SELECT 1 FROM orbit_workspaces WHERE owner_id = ? AND mutation_id = ? AND revision = ?)';
 const gateValues:SqlValue[]=[ownerId,command.operationId,revision];
 const statements:Statement[]=[update];
 // Lazy v2 migration and the first v3 edit share the winning transaction. No data in SQL migrations.
 if(legacy.length)statements.push(db.prepare(`INSERT INTO orbit_note_revisions (owner_id, note_id, revision, title, note_json, updated_at)
 SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.revision'), json_extract(value, '$.title'), value, ? FROM json_each(?) WHERE ${gate}
 ON CONFLICT(owner_id, note_id, revision) DO NOTHING`).bind(ownerId,current.updatedAt??timestamp,JSON.stringify(legacy),...gateValues));
 if(changedNote)statements.push(db.prepare(`INSERT INTO orbit_note_revisions (owner_id, note_id, revision, title, note_json, updated_at)
 SELECT ?, ?, ?, ?, ?, ? WHERE ${gate}`).bind(ownerId,changedNote.id,changedNote.revision!,changedNote.title,JSON.stringify(changedNote),timestamp,...gateValues));
 if(action.type==='note.delete')statements.push(db.prepare(`DELETE FROM orbit_note_revisions WHERE owner_id = ? AND note_id = ? AND ${gate}`).bind(ownerId,action.id,...gateValues));
 statements.push(db.prepare(`INSERT INTO orbit_mutations (owner_id, operation_id, action_hash, revision, created_at)
 SELECT ?, ?, ?, ?, ? WHERE ${gate} ON CONFLICT(owner_id, operation_id) DO NOTHING`).bind(ownerId,command.operationId,hash,revision,timestamp,...gateValues));
 const results=await db.batch(statements);
 if(results[0]?.meta?.changes!==1){
  const replay=await receipt(db,ownerId,command.operationId);
  if(!replay||replay.action_hash!==hash)throw new RevisionConflict('다른 기기에서 먼저 저장했습니다. 최신 내용을 불러온 뒤 다시 적용해 주세요.');
 }
 return readWorkspace(db,ownerId);
}
